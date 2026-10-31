/** Member authentication, actual adapter protocols, and durable outbox behavior against loopback HTTP. */
import { afterEach, describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { LlmAdapter } from '@deepseek-ai/dsh-llm'
import { enterpriseFixture } from './fixtures/server.ts'
import { enterpriseHost } from './fixtures/host.ts'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })

async function setup() {
  const server = await enterpriseFixture()
  cleanups.push(() => server.close())
  const root = await mkdtemp(join(tmpdir(), 'dsh-unionpay-'))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  const boot = async (usageConfig = {}) => {
    const host = await enterpriseHost(server.origin, root, usageConfig)
    cleanups.push(() => host.ctx.fiber.dispose())
    return host
  }
  return { server, root, boot }
}

async function call(ctx: Context, model: { id: string; modelId: string }, controls: Partial<GenerateOptions> = {}) {
  const chunks: StreamChunk[] = []
  for await (const chunk of ctx.llm.stream({ provider: 'unionpay-' + model.id, model: model.modelId, messages: [{ role: 'user', content: [{ type: 'text', text: 'Verify enterprise connectivity.' }] }], ...controls })) chunks.push(chunk)
  return chunks
}

describe('UnionPay enterprise integration', () => {
  it.each([
    { label: 'collects personal calls by default', config: {}, count: 1 },
    { label: 'honors an explicit personal collection opt-out', config: { includePersonalModels: false }, count: 0 },
  ])('$label', async ({ config, count }) => {
    const { server, boot } = await setup()
    const { ctx } = await boot(config)
    await ctx.unionpayConnection.signInCode(server.code())
    ctx.llm.registerAdapter(['personal'], new class extends LlmAdapter {
      async *stream(): AsyncIterable<StreamChunk> {
        yield { type: 'usage', usage: { inputTokens: 90, outputTokens: 20, cacheReadTokens: 30, totalTokens: 140 } }
        yield { type: 'finish', reason: { kind: 'stop' } }
      }
    }())
    expect((await call(ctx, server.models[0]!, { provider: 'personal', model: 'personal-code' })).at(-1))
      .toMatchObject({ type: 'finish', reason: { kind: 'stop' } })
    expect(ctx.unionpayUsage.getState().pending).toBe(count)
    await ctx.unionpayUsage.flush()
    expect(server.reports.size).toBe(count)
    if (count === 1) {
      const report = [...server.reports.values()][0]!
      expect(report).toMatchObject({
        source: 'byok', modelId: 'personal-code', memberId: server.members[0]!.id,
        inputTokens: 120, outputTokens: 20, cacheReadTokens: 30, totalTokens: 140,
      })
      expect(report).not.toHaveProperty('enterpriseModelId')
      server.control.collectionEnabled = false
      await ctx.unionpayUsage.flush()
      await call(ctx, server.models[0]!, { provider: 'personal', model: 'personal-code' })
      expect(ctx.unionpayUsage.getState()).toMatchObject({ collection: 'disabled', pending: 0 })
      expect(server.reports.size).toBe(1)
    }
  })

  it.skip('changes enterprise origins live without transferring grants or queued ownership', () => {})

  it('uses each enterprise protocol without exposing member credentials in UI state', async () => {
    const { server, root, boot } = await setup()
    const { ctx } = await boot()
    const code = server.code()
    expect((await ctx.unionpayConnection.signInCode(code)).status).toBe('connected')
    expect(ctx.llm.listProviders()).toHaveLength(3)
    expect(JSON.stringify(ctx.unionpayConnection.getState())).not.toMatch(/cookie|csrfToken|deviceCode|"token"/)
    for (const model of server.models) {
      const chunks = await call(ctx, model)
      expect(chunks.at(-1)).toMatchObject({ type: 'finish', reason: { kind: 'stop' } })
      expect(JSON.stringify(chunks)).toContain('Enterprise connection verified.')
    }
    expect(server.requests.map(request => request.path)).toEqual(server.models.map(model => `/models/${model.id}/v1/${model.protocol === 'openai-chat-completions' ? 'chat/completions' : model.protocol === 'anthropic-messages' ? 'messages' : 'responses'}`))
    expect(await readFile(join(root, 'credentials.yml'), 'utf8')).not.toContain(code)
    await ctx.unionpayUsage.flush()
    expect(server.reports.size).toBe(3)
    for (const row of server.reports.values()) {
      expect(row).toMatchObject({ memberId: server.members[0]!.id, inputTokens: 120, outputTokens: 20, totalTokens: 140, cacheReadTokens: 30, source: 'enterprise' })
      expect(JSON.stringify(row)).not.toMatch(/Verify enterprise|cookie|Authorization|sessionId|providerId/)
    }
    await ctx.unionpayConnection.signOut()
    expect(ctx.llm.listProviders()).toEqual([])
  })

  it('retains accepted reports after a lost receipt and retries with the same request IDs', async () => {
    const { server, boot } = await setup()
    const { ctx } = await boot()
    await ctx.unionpayConnection.signInCode(server.code())
    await call(ctx, server.models[0]!)
    server.control.failAfterAccept = true
    expect((await ctx.unionpayUsage.flush()).pending).toBe(1)
    expect(server.reports.size).toBe(1)
    const ids = [...server.reports.keys()]
    expect((await ctx.unionpayUsage.flush()).pending).toBe(0)
    expect([...server.reports.keys()]).toEqual(ids)
  })

  it('restores the original device and pending reports after the Host restarts', async () => {
    const { server, boot } = await setup()
    const first = await boot()
    await first.ctx.unionpayConnection.signInCode(server.code())
    await call(first.ctx, server.models[0]!)
    expect(first.ctx.unionpayUsage.getState().pending).toBe(1)
    await first.ctx.fiber.dispose()
    const second = await boot()
    expect(second.ctx.unionpayConnection.getState().status).toBe('connected')
    expect(second.ctx.unionpayUsage.getState().pending).toBe(1)
    await second.ctx.unionpayUsage.flush()
    const clientId = [...server.reports.values()][0]!.clientId
    await call(second.ctx, server.models[1]!)
    await second.ctx.unionpayUsage.flush()
    expect([...server.reports.values()].map(row => row.clientId)).toEqual([clientId, clientId])
  })

  it('keeps reports with their request-start member across account changes', async () => {
    const { server, boot } = await setup()
    const { ctx } = await boot()
    await ctx.unionpayConnection.signInCode(server.code(server.members[0]))
    await call(ctx, server.models[0]!)
    await ctx.unionpayConnection.signOut()
    await ctx.unionpayConnection.signInCode(server.code(server.members[1]))
    expect((await ctx.unionpayUsage.flush()).waitingForMember).toBe(true)
    expect(server.reports.size).toBe(0)
    await call(ctx, server.models[1]!)
    await ctx.unionpayUsage.flush()
    expect([...server.reports.values()].map(row => row.memberId)).toEqual([server.members[1]!.id])
    await ctx.unionpayConnection.signOut()
    await ctx.unionpayConnection.signInCode(server.code(server.members[0]))
    await ctx.unionpayUsage.flush()
    expect([...server.reports.values()].map(row => row.memberId)).toEqual([server.members[1]!.id, server.members[0]!.id])
  })

  it('aborts a prepared model call on sign-out and preserves the original reporting owner', async () => {
    const { server, boot } = await setup()
    const { ctx } = await boot()
    await ctx.unionpayConnection.signInCode(server.code())
    let release!: () => void
    server.control.modelGate = new Promise<void>((resolve) => { release = resolve })
    const entered = new Promise<void>((resolve) => { server.control.modelEntered = resolve })
    const pending = call(ctx, server.models[0]!)
    await entered
    await ctx.unionpayConnection.signOut()
    release()
    const chunks = await pending
    expect(chunks.at(-1)).toMatchObject({ type: 'finish', reason: { kind: 'aborted' } })
    expect(ctx.unionpayUsage.getState().pending).toBe(1)
    await ctx.unionpayConnection.signInCode(server.code())
    await ctx.unionpayUsage.flush()
    expect([...server.reports.values()][0]).toMatchObject({ memberId: server.members[0]!.id, status: 'cancelled' })
  })

  it('revalidates the catalog when forced refresh overlaps a cached runtime read', async () => {
    const { server, boot } = await setup()
    const { ctx } = await boot()
    await ctx.unionpayConnection.signInCode(server.code())
    server.control.rejectModel = true
    const ordinary = ctx.unionpayConnection.runtime()
    const forced = ctx.unionpayConnection.runtime(true)
    const concurrent = ctx.unionpayConnection.runtime(true)
    expect((await ordinary).models).toHaveLength(3)
    expect((await forced).models).toEqual([])
    expect(await concurrent).toBe(await forced)
    expect(ctx.llm.listProviders()).toEqual([])
  })

  it('withdraws routes on a duplicate catalog and recovers with the next valid catalog', async () => {
    const { server, boot } = await setup()
    const { ctx } = await boot()
    await ctx.unionpayConnection.signInCode(server.code())
    const kept = server.models[0]!
    server.models.splice(0, server.models.length, kept, { ...kept })
    await expect(ctx.unionpayConnection.runtime(true)).rejects.toMatchObject({ code: 'invalid-response' })
    expect(ctx.unionpayConnection.getState()).toMatchObject({ status: 'unavailable', error: 'invalid-response', modelCount: 0 })
    expect(ctx.unionpayConnection.catalog()).toEqual([])
    expect(ctx.llm.listProviders()).toEqual([])
    server.models.splice(1, 1)
    await ctx.unionpayConnection.refresh()
    expect(ctx.unionpayConnection.getState()).toMatchObject({ status: 'connected', error: null, modelCount: 1 })
    expect(ctx.llm.listProviders().map(provider => provider.id)).toEqual(['unionpay-' + kept.id])
    expect((await call(ctx, kept)).at(-1)).toMatchObject({ type: 'finish', reason: { kind: 'stop' } })
  })

  it('removes revoked model routes and retires a server-revoked membership', async () => {
    const { server, boot } = await setup()
    const { ctx } = await boot()
    await ctx.unionpayConnection.signInCode(server.code())
    server.control.rejectModel = true
    await ctx.unionpayConnection.refresh()
    expect(ctx.llm.listProviders()).toEqual([])
    server.revoke()
    await ctx.unionpayConnection.refresh()
    expect(ctx.unionpayConnection.getState().status).toBe('expired')
  })

  it('pauses collection after observing the administrator switch without deleting pending reports', async () => {
    const { server, boot } = await setup()
    const { ctx } = await boot()
    await ctx.unionpayConnection.signInCode(server.code())
    await call(ctx, server.models[0]!)
    server.control.collectionEnabled = false
    await ctx.unionpayUsage.flush()
    expect(ctx.unionpayUsage.getState()).toMatchObject({ collection: 'disabled', pending: 1 })
    await call(ctx, server.models[0]!)
    expect(ctx.unionpayUsage.getState().pending).toBe(1)
    server.control.collectionEnabled = true
    await ctx.unionpayUsage.flush()
    expect(ctx.unionpayUsage.getState()).toMatchObject({ collection: 'enabled', pending: 0 })
  })

  it('never replaces missing usage with zeros and labels auxiliary calls', async () => {
    const { server, boot } = await setup()
    const { ctx } = await boot()
    await ctx.unionpayConnection.signInCode(server.code())
    server.control.omitUsage = true
    await call(ctx, server.models[0]!, { purpose: 'session-title' })
    await ctx.unionpayUsage.flush()
    const report = [...server.reports.values()][0]!
    expect(report.querySource).toBe('session_title')
    expect(report).not.toHaveProperty('inputTokens')
    expect(report).not.toHaveProperty('totalTokens')
  })

  it('cancels a browser sign-in without publishing the secret device code', async () => {
    const { server, boot } = await setup()
    const { ctx } = await boot()
    const state = await ctx.unionpayConnection.startSso()
    expect(state.signIn?.verificationUrl).toBe(server.origin + '/api/enterprise-client/sso/start?device=public-ticket')
    expect(server.pendingDevices.size).toBe(1)
    expect(JSON.stringify(state)).not.toContain([...server.pendingDevices][0])
    await ctx.unionpayConnection.cancelSignIn(state.signIn!.id)
    expect(server.pendingDevices.size).toBe(0)
    expect(ctx.unionpayConnection.getState().member).toBeNull()
  })

  it('commits a browser-authorized member session and closes its polling lifetime', async () => {
    const { server, boot } = await setup()
    const { ctx } = await boot()
    server.control.approveSso = true
    await ctx.unionpayConnection.startSso()
    await expect.poll(() => ctx.unionpayConnection.getState().status, { timeout: 10000 }).toBe('connected')
    expect(ctx.llm.listProviders()).toHaveLength(3)
    expect(server.pendingDevices.size).toBe(0)
  })

  it('removes all registered routes when the model plugin unloads', async () => {
    const { server, boot } = await setup()
    const { ctx, models } = await boot()
    await ctx.unionpayConnection.signInCode(server.code())
    await models.dispose()
    expect(ctx.llm.listProviders()).toEqual([])
    await ctx.unionpayConnection.refresh()
    expect(ctx.llm.listProviders()).toEqual([])
  })

  it('reports outbox saturation visibly while preserving the successful model response', async () => {
    const { server, boot } = await setup()
    const { ctx } = await boot({ maxQueueRecords: 1 })
    await ctx.unionpayConnection.signInCode(server.code())
    await call(ctx, server.models[0]!)
    expect((await call(ctx, server.models[0]!)).at(-1)).toMatchObject({ type: 'finish', reason: { kind: 'stop' } })
    expect(ctx.unionpayUsage.getState()).toMatchObject({ pending: 1, failedToPersist: 1, error: 'queue-full' })
  })
})
