/** Captures completed DSH model calls and delivers white-listed counters through a durable outbox. */
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { Context, Service } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { APP_IDENTITY, type GenerateOptions, type StreamChunk, type TokenUsage } from '@deepseek-ai/dsh-llm'
import { EnterpriseError } from '@deepseek-ai/dsh-unionpay-connection'
import type { EnterpriseModel, EnterpriseUsageOwner } from '@deepseek-ai/dsh-unionpay-connection'
import type {} from '@deepseek-ai/dsh-llm-unionpay'
import type { ManagedTokenCounts } from '@deepseek-ai/dsh-llm-unionpay'
import type {} from '@deepseek-ai/dsh-session'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { Domain } from '@deepseek-ai/dsh-storage-domain'
import { reportSchema, usageDomain } from './storage.ts'
import type { Config, QueuedUsage, UsageClientId, UsageDeliveryView, UsageReport, UsageRequestId, UsageSource } from './types.ts'

export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Durable, member-bound enterprise usage delivery. */
    unionpayUsage: UnionPayUsage
  }
}

/** Collection is optional and never changes a model call's result when reporting fails. */
export class UnionPayUsage extends TypertRemoteService {
  static inject = ['llm', 'unionpayConnection', 'unionpayModels', 'storageDomain']
  static Config = Schema.object({
    includePersonalModels: Schema.boolean().default(true),
    app: Schema.union(['cli', 'desktop']).default('cli'),
    flushIntervalMs: Schema.number().min(1).max(3600000).step(1).default(15000),
    collectionRefreshMs: Schema.number().min(1).max(3600000).step(1).default(60000),
    maxQueueRecords: Schema.number().min(1).max(50000).step(1).default(50000),
    batchSize: Schema.number().min(1).max(50).step(1).default(50),
  })
  private readonly config: Config
  private readonly lifetime = new AbortController()
  private domain?: Domain<typeof usageDomain>
  private clientId?: UsageClientId
  private writes: Promise<void> = Promise.resolve()
  private flushing: Promise<UsageDeliveryView> | undefined
  private loop?: Promise<void>
  private checkedCollectionAt = 0
  private view: UsageDeliveryView = { pending: 0, collection: 'unknown', waitingForMember: false, lastDeliveryAt: null, error: null, failedToPersist: 0 }
  private readonly listeners = new Set<() => void>()
  private version = 0

  /**
   * @param ctx - enterprise connection, model routing, and domain storage.
   * @param config - collection and delivery limits.
   */
  constructor(ctx: Context, config: Config) {
    super(ctx, 'unionpayUsage', { namespace: 'unionpayUsage' })
    this.config = UnionPayUsage.Config(config)
    ctx.effect(() => async () => {
      this.lifetime.abort()
      for (const wake of this.listeners) wake()
      await this.loop
      await this.flushing
      await this.writes
      await this.domain?.close()
    }, 'unionpay usage: outbox and delivery lifetime')
  }

  /** Open and validate the durable queue before observing any model calls. */
  async [Service.init](): Promise<void> {
    this.domain = await this.ctx.storageDomain.open(usageDomain)
    const saved = this.domain.global.get()
    this.clientId = saved.clientId ?? randomUUID() as UsageClientId
    if (saved.clientId === null) await this.domain.global.set({ clientId: this.clientId })
    this.publish({ pending: this.domain.table('records').size })
    this.ctx.on('llm/stream', (options, next) => this.observe(options, next))
    this.ctx.on('unionpay-model/call', async (call) => {
      if (this.lifetime.signal.aborted || this.view.collection === 'disabled') return
      await this.enqueue(
        call.owner, call.enterpriseModelId, call.model, this.source(call), call.startedAt, call.latencyMs, call.status, call.usage,
      )
    })
    await this.checkCollection()
    this.loop = this.supervise()
  }

  private publish(patch: Partial<UsageDeliveryView>): void {
    this.view = { ...this.view, ...patch }
    this.version++
    for (const wake of this.listeners) wake()
  }

  private async checkCollection(): Promise<void> {
    if (this.clientId === undefined) return
    try {
      const enabled = await this.ctx.unionpayConnection.collectionEnabled(this.clientId)
      this.checkedCollectionAt = Date.now()
      this.publish({ collection: enabled === null ? 'unconfigured' : enabled ? 'enabled' : 'disabled' })
    } catch (error) {
      this.failed(error)
    }
  }

  private failed(error: unknown): void {
    const code = error instanceof EnterpriseError ? error.code : 'storage'
    this.publish({ error: code })
    this.ctx.logger.warn('UnionPay usage delivery paused (%s); retained reports will retry while the plugin is enabled', code)
  }

  private async supervise(): Promise<void> {
    try {
      while (!this.lifetime.signal.aborted) {
        await delay(this.config.flushIntervalMs, undefined, { signal: this.lifetime.signal })
        await this.flush()
      }
    } catch (error) {
      if (!this.lifetime.signal.aborted) this.failed(error)
    }
  }

  /**
   * Read delivery state without starting a network operation.
   * @returns the persisted pending count and latest delivery outcome.
   */
  @Remote
  getState(): UsageDeliveryView { return this.view }

  /**
   * Retry one bounded batch, retaining it unless the server acknowledges every row.
   * @returns delivery state, including opt-out, identity wait, or a sanitized failure.
   */
  @Remote
  flush(): Promise<UsageDeliveryView> {
    if (this.flushing !== undefined) return this.flushing
    this.flushing = this.deliver().finally(() => { this.flushing = undefined })
    return this.flushing
  }

  private async deliver(): Promise<UsageDeliveryView> {
    try {
      if (this.lifetime.signal.aborted || this.domain === undefined || this.clientId === undefined) return this.view
      if (Date.now() - this.checkedCollectionAt >= this.config.collectionRefreshMs) await this.checkCollection()
      if (this.view.collection === 'disabled') return this.view
      await this.writes
      const owner = await this.ctx.unionpayConnection.usageOwner()
      const table = this.domain.table('records')
      const eligible = [...table.entries()].filter(([, row]) => row.owner.origin === owner?.origin
        && (row.owner.memberId === null || row.owner.memberId === owner.memberId))
      const firstEntry = eligible[0]
      if (firstEntry === undefined) {
        this.publish({ pending: table.size, waitingForMember: table.size > 0 })
        return this.view
      }
      const first = firstEntry[1].owner
      const selected = eligible.filter(([, row]) => row.owner.memberId === first.memberId).slice(0, this.config.batchSize)
      const result = await this.ctx.unionpayConnection.reportUsage(first, this.clientId, selected.map(([, row]) => row.report))
      switch (result.status) {
        case 'disabled': this.publish({ collection: 'disabled' }); break
        case 'waiting-for-member': this.publish({ waitingForMember: true }); break
        case 'acknowledged':
          for (const [id] of selected) await table.delete(id)
          this.publish({ pending: table.size, waitingForMember: false, lastDeliveryAt: new Date().toISOString(), error: null, collection: 'enabled' })
          break
      }
    } catch (error) { this.failed(error) }
    return this.view
  }

  /**
   * Follow complete delivery states while the caller is connected.
   * @param signal - observation lifetime.
   * @returns initial and subsequent queue states; reports and identities are not exposed.
   */
  @Remote({ mode: 'stream' })
  async *follow(signal: AbortSignal): AsyncIterable<UsageDeliveryView> {
    const stop = AbortSignal.any([signal, this.lifetime.signal])
    let seen = -1
    while (!stop.aborted) {
      if (seen !== this.version) { seen = this.version; yield this.view; continue }
      await new Promise<void>((resolve) => {
        const wake = (): void => { this.listeners.delete(wake); stop.removeEventListener('abort', wake); resolve() }
        this.listeners.add(wake)
        stop.addEventListener('abort', wake, { once: true })
        if (stop.aborted || seen !== this.version) wake()
      })
    }
  }

  private source(options: Pick<GenerateOptions, 'purpose' | 'sessionId'>): UsageSource {
    if (options.purpose === 'compaction') return 'compact'
    if (options.purpose === 'session-title') return 'session_title'
    if (options.sessionId === undefined) return 'unknown'
    const session = this.ctx.get('sessions')?.get(options.sessionId)
    return session?.header.origin === 'subagent' ? 'subagent' : 'main_turn'
  }

  private async *observe(options: GenerateOptions, next: () => AsyncIterable<StreamChunk>): AsyncIterable<StreamChunk> {
    const modelId = this.ctx.unionpayModels.modelIdFor(options.provider)
    if (this.lifetime.signal.aborted || this.view.collection === 'disabled' || modelId !== null || !this.config.includePersonalModels) {
      yield* next()
      return
    }
    let owner: EnterpriseUsageOwner | null = null
    try { owner = await this.ctx.unionpayConnection.usageOwner() }
    catch (error) { this.failed(error) }
    const started = Date.now()
    const startClock = performance.now()
    let usage: TokenUsage | undefined
    let status: UsageReport['status'] = 'cancelled'
    try {
      for await (const chunk of next()) {
        if (chunk.type === 'usage') usage = chunk.usage
        if (chunk.type === 'finish') status = chunk.reason.kind === 'error' ? 'error' : chunk.reason.kind === 'aborted' ? 'cancelled' : 'completed'
        yield chunk
      }
    } catch (error) {
      status = options.signal?.aborted ? 'cancelled' : 'error'
      throw error
    } finally {
      if (owner !== null && !(this.lifetime.signal.aborted as boolean) && this.getState().collection !== 'disabled') {
        const inputTokens = usage === undefined ? undefined
          : usage.inputTokens + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0)
        await this.enqueue(
          owner, modelId, options.model, this.source(options), started, performance.now() - startClock, status,
          usage === undefined ? {} : { ...usage, inputTokens },
        )
      }
    }
  }

  private enqueue(owner: EnterpriseUsageOwner, modelId: EnterpriseModel['id'] | null, model: string, querySource: UsageSource, started: number, latencyMs: number, status: UsageReport['status'], usage: ManagedTokenCounts): Promise<void> {
    const parsed = reportSchema.safeParse({
      requestId: randomUUID() as UsageRequestId, clientId: this.clientId, app: this.config.app, version: 'dsh-' + APP_IDENTITY.version,
      at: new Date(started).toISOString(), modelId: model, source: modelId === null ? 'byok' : 'enterprise',
      ...(modelId === null ? {} : { enterpriseModelId: modelId }), querySource, status, latencyMs,
      ...(usage.inputTokens === undefined ? {} : { inputTokens: usage.inputTokens }),
      ...(usage.outputTokens === undefined ? {} : { outputTokens: usage.outputTokens }),
      ...(usage.reasoningTokens === undefined ? {} : { reasoningTokens: usage.reasoningTokens }),
      ...(usage.cacheReadTokens === undefined ? {} : { cacheReadTokens: usage.cacheReadTokens }),
      ...(usage.cacheWriteTokens === undefined ? {} : { cacheWriteTokens: usage.cacheWriteTokens }),
      ...(usage.totalTokens === undefined ? {} : { totalTokens: usage.totalTokens }),
    })
    if (!parsed.success) {
      this.publish({ error: 'invalid-usage', failedToPersist: this.view.failedToPersist + 1 })
      this.ctx.logger.warn('UnionPay usage could not be recorded because its counters or model identifier exceed the intake limits')
      return Promise.resolve()
    }
    const row: QueuedUsage = { owner, report: parsed.data }
    this.writes = this.writes.then(async () => {
      if (this.domain === undefined) return
      const table = this.domain.table('records')
      if (table.size >= this.config.maxQueueRecords) {
        this.publish({ error: 'queue-full', failedToPersist: this.view.failedToPersist + 1 })
        this.ctx.logger.warn('UnionPay usage queue is full; this call was not recorded. Restore delivery before making further calls.')
        return
      }
      await table.put(row.report.requestId, row)
      this.publish({ pending: table.size })
    }).catch((error: unknown) => {
      this.publish({ failedToPersist: this.view.failedToPersist + 1 })
      this.failed(error)
    })
    return this.writes
  }
}

export default UnionPayUsage
