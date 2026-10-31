/** Managed model routes reuse the pi-ai adapter while enterprise authentication stays in the connection service. */
import { Context, Service } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { InMemoryCredentialStore } from '@earendil-works/pi-ai'
import { LlmAdapter, LlmError, resolveImageAttachmentAccess, resolveRetryPolicy } from '@deepseek-ai/dsh-llm'
import type { AdapterRegistrationHandle, GenerateOptions, LlmModelInfo, LlmResolvedModelInfo, PreparedAdapterCall, StreamChunk } from '@deepseek-ai/dsh-llm'
import { PiAiAdapter } from '@deepseek-ai/dsh-llm-pi-ai'
import type { PiAiProviderProfile, PiAiReasoningEfforts } from '@deepseek-ai/dsh-llm-pi-ai'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { EnterpriseModel, EnterpriseRuntime } from '@deepseek-ai/dsh-unionpay-connection'
import type {} from '@deepseek-ai/dsh-fs'
import type { Config } from './types.ts'
import type { ManagedModelCall } from './types.ts'
import { UsageObserver } from './usage-observer.ts'

export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Enterprise model-route ownership used by the usage reporter. */
    unionpayModels: UnionPayModels
  }
}

const PREFIX = 'unionpay-'

/** Registers exactly the current member's authorized model routes and removes them on logout or unload. */
export class UnionPayModels extends Service {
  static inject = ['llm', 'unionpayConnection']
  static Config = Schema.object({
    streamIdleTimeoutMs: Schema.number().min(1).max(2147483647).step(1).default(300000),
    requestImagePixelBudget: Schema.number().min(1).step(1).default(4194304),
    requestImageMaxBytes: Schema.number().min(1).step(1).default(1048576),
    maxRequestImageBytes: Schema.number().min(1).step(1).default(20971520),
    maxRetries: Schema.number().min(0).max(10).step(1).default(2),
    maxUsageEventChars: Schema.number().min(1024).max(67108864).step(1).default(4194304),
  })
  private registration?: AdapterRegistrationHandle
  private readonly adapter: ManagedAdapter
  private routes: readonly string[] = []
  private catalogFingerprint = ''

  /**
   * @param ctx - model registry and enterprise connection.
   * @param config - streaming and retry limits.
   */
  constructor(ctx: Context, config: Config) {
    super(ctx, 'unionpayModels')
    this.adapter = new ManagedAdapter(ctx, UnionPayModels.Config(config))
    const synchronize = (): void => {
      const catalog = ctx.unionpayConnection.catalog()
      const fingerprint = JSON.stringify(catalog)
      if (this.catalogFingerprint === fingerprint) return
      const routes = catalog.map(model => PREFIX + model.id)
      if (routes.length === 0 && this.registration === undefined) return
      if (this.registration === undefined) this.registration = ctx.llm.registerAdapter(routes, this.adapter)
      else this.registration.replace(routes)
      this.routes = routes
      this.catalogFingerprint = fingerprint
      ctx.emit('llm/adapters-updated')
    }
    ctx.on('unionpay/changed', synchronize)
    synchronize()
  }

  /**
   * Identify one route while capturing a model call's reporting metadata.
   * @param provider - selected DSH provider route.
   * @returns the managed model UUID, or null for a route this plugin does not own.
   */
  modelIdFor(provider: string): EnterpriseModel['id'] | null {
    if (!this.routes.includes(provider)) return null
    return this.ctx.unionpayConnection.catalog().find(model => PREFIX + model.id === provider)?.id ?? null
  }
}

class ManagedAdapter extends LlmAdapter {
  private readonly retryPolicy
  constructor(private readonly ctx: Context, private readonly config: Config) {
    super()
    this.retryPolicy = resolveRetryPolicy({ mode: 'normal', maxRetries: config.maxRetries }, 'UnionPay model retries')
  }

  override providerInfo(provider: string) {
    const model = this.model(provider)
    return { id: provider, name: model.name }
  }

  override providerRetryPolicy() { return this.retryPolicy }

  private model(provider: string): EnterpriseModel {
    const model = this.ctx.unionpayConnection.catalog().find(entry => PREFIX + entry.id === provider)
    if (model === undefined) throw new LlmError('The enterprise model is no longer authorized. Refresh the enterprise connection.', 'UNKNOWN_MODEL')
    return model
  }

  private delegate(model: EnterpriseModel, token?: string, fetcher?: typeof globalThis.fetch): PiAiAdapter {
    const provider = PREFIX + model.id
    const origin = this.ctx.unionpayConnection.getState().origin
    const reasoning = model.capabilities?.reasoning
    const efforts: PiAiReasoningEfforts = {}
    if (reasoning !== undefined && reasoning.profile !== 'gateway-default') {
      for (const level of reasoning.levels) efforts[level] = level
    }
    const profile: PiAiProviderProfile = {
      displayName: model.name,
      api: model.protocol === 'openai-chat-completions' ? 'openai-completions' : model.protocol,
      baseURL: `${origin}/api/enterprise-client/models/${model.id}${model.protocol === 'anthropic-messages' ? '' : '/v1'}`,
      ...(token === undefined ? {} : { headers: { Authorization: 'Bearer ' + token } }),
      models: [{
        id: model.modelId, name: model.name, contextWindow: model.contextWindow, maxTokens: model.maxOutputTokens,
        input: model.capabilities?.supportsImage === true ? ['text', 'image'] : ['text'],
        reasoningEfforts: reasoning === undefined || reasoning.profile === 'gateway-default' ? false : efforts,
      }],
      streamIdleTimeoutMs: this.config.streamIdleTimeoutMs,
      requestImagePixelBudget: this.config.requestImagePixelBudget,
      requestImageMaxBytes: this.config.requestImageMaxBytes,
      maxRequestImageBytes: this.config.maxRequestImageBytes,
      retryPolicy: { mode: 'normal', maxRetries: this.config.maxRetries },
    }
    const profiles = PiAiAdapter.resolveProfiles({ [provider]: profile })
    return new PiAiAdapter({
      ...(fetcher === undefined ? {} : { fetch: fetcher }),
      profiles: () => profiles,
      resolveApiKey: () => {
        if (token === undefined) return Promise.reject(new LlmError('Sign in to the enterprise service before calling this model.', 'MISSING_CREDENTIAL'))
        return Promise.resolve(token)
      },
      auth: {
        credentials: new InMemoryCredentialStore(),
        authContext: { env: () => Promise.resolve(undefined), fileExists: () => Promise.resolve(false) },
      },
      resolveAttachments: () => this.ctx.get('attachments'),
      resolveImageAccess: (attachments, ref) => resolveImageAttachmentAccess(attachments, hostPath => this.ctx.get('fs')?.processPathFromHostPath(hostPath), ref),
      onReplayDegrade: () =>{  this.ctx.logger.warn('UnionPay model history uses provider-neutral replay for this request') },
    })
  }

  override listModels(provider: string): Promise<readonly LlmModelInfo[]> {
    const model = this.model(provider)
    return Promise.resolve([{ provider, id: model.modelId, name: model.name,
      inputModalities: model.capabilities?.supportsImage === true ? ['text', 'image'] : ['text'] }])
  }

  override resolveModel(provider: string, model: string, signal?: AbortSignal): Promise<LlmResolvedModelInfo> {
    return this.delegate(this.model(provider)).resolveModel(provider, model, signal)
  }

  override imageRequestTarget(provider: string, model: string, image: ImageAttachmentRef) {
    return this.delegate(this.model(provider)).imageRequestTarget(provider, model, image)
  }

  override async prepareCall(provider: string, model: string, signal?: AbortSignal): Promise<PreparedAdapterCall> {
    const runtime = await this.ctx.unionpayConnection.runtime()
    signal?.throwIfAborted()
    runtime.signal.throwIfAborted()
    const entry = runtime.models.find(value => PREFIX + value.id === provider && value.modelId === model)
    if (entry === undefined) throw new LlmError('The enterprise model is no longer authorized. Refresh the enterprise connection.', 'UNKNOWN_MODEL')
    const resolved = await this.delegate(entry).resolveModel(provider, model, signal)
    return { model: resolved, stream: options => this.boundStream(runtime, entry, options) }
  }

  private async *boundStream(runtime: EnterpriseRuntime, model: EnterpriseModel, options: GenerateOptions): AsyncIterable<StreamChunk> {
    const signal = options.signal === undefined ? runtime.signal : AbortSignal.any([options.signal, runtime.signal])
    signal.throwIfAborted()
    if (model.capabilities?.supportsToolCall === false && (options.tools?.length ?? 0) > 0) {
      throw new LlmError('This enterprise model does not support tools. Select a model authorized for tool calls.', 'UNSUPPORTED_OPTION')
    }
    const observer = new UsageObserver(model.protocol, this.config.maxUsageEventChars)
    const startedAt = Date.now()
    const startedClock = performance.now()
    let status: ManagedModelCall['status'] = 'cancelled'
    try {
      for await (const chunk of this.delegate(model, runtime.token, observer.fetch).stream({ ...options, signal })) {
        if (chunk.type === 'usage') continue
        if (chunk.type === 'finish') {
          const usage = observer.tokenUsage()
          if (usage !== undefined) yield { type: 'usage', usage }
          status = chunk.reason.kind === 'error' ? 'error' : chunk.reason.kind === 'aborted' ? 'cancelled' : 'completed'
        }
        yield chunk
      }
    } catch (error) {
      status = signal.aborted ? 'cancelled' : 'error'
      throw error
    } finally {
      if (observer.exceededLimit()) this.ctx.logger.warn('UnionPay usage was unavailable because an SSE event exceeded maxUsageEventChars; the model response was preserved')
      try {
        await this.ctx.serial('unionpay-model/call', {
          owner: { origin: runtime.origin, memberId: runtime.memberId }, enterpriseModelId: model.id, model: model.modelId,
          startedAt, latencyMs: performance.now() - startedClock, status, usage: observer.snapshot(),
          ...(options.purpose === undefined ? {} : { purpose: options.purpose }),
          ...(options.sessionId === undefined ? {} : { sessionId: options.sessionId }),
        })
      } catch (_error) { this.ctx.logger.warn('UnionPay usage observer failed; this call may be missing from enterprise reporting') }
    }
  }

  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const call = await this.prepareCall(options.provider, options.model, options.signal)
    yield* call.stream(options)
  }
}

export default UnionPayModels
