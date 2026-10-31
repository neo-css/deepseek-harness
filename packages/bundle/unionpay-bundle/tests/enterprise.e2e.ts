/** Compatibility acceptance against an explicitly selected UnionPay Code checkout and its installed server dependencies. */
import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import type { Context } from '@deepseek-ai/cordis'
import type { StreamChunk } from '@deepseek-ai/dsh-llm'
import { realEnterprise } from './fixtures/real-enterprise.ts'
import { enterpriseHost } from './fixtures/host.ts'

const source = process.env.UNIONPAY_CODE_ROOT
const dependencies = process.env.UNIONPAY_NODE_MODULES_ROOT
const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })

async function invoke(ctx: Context, model: { id: string; modelId: string }) {
  const chunks: StreamChunk[] = []
  for await (const chunk of ctx.llm.stream({ provider: 'unionpay-' + model.id, model: model.modelId, messages: [{ role: 'user', content: [{ type: 'text', text: 'Verify the enterprise model connection.' }] }] })) chunks.push(chunk)
  expect(chunks.at(-1)).toMatchObject({ type: 'finish', reason: { kind: 'stop' } })
  return chunks
}

describe.skipIf(!source || !dependencies)('original UnionPay Code management service', () => {
  it('accepts SSO, three model protocols, original-member retries, restart recovery, and administrative revocation', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-enterprise-real-'))
    cleanups.push(() => rm(directory, { recursive: true, force: true }))
    const server = await realEnterprise(source!, dependencies!, directory)
    cleanups.push(() => server.close())
    const home = join(directory, 'dsh')
    const first = await enterpriseHost(server.origin, home)
    cleanups.push(() => first.ctx.fiber.dispose())
    let ctx = first.ctx
    const attempt = await ctx.unionpayConnection.startSso()
    expect(attempt.signIn?.verificationUrl).toBeTruthy()
    await server.completeSso(attempt.signIn!.verificationUrl!)
    await expect.poll(() => ctx.unionpayConnection.getState().status, { timeout: 15000 }).toBe('connected')
    expect(ctx.unionpayConnection.getState().member?.id).toBe(server.state.members[0]!.id)
    const flows = []
    for (const model of server.state.models) {
      const chunks = await invoke(ctx, model)
      expect(chunks.find(chunk => chunk.type === 'usage')).toMatchObject({
        type: 'usage', usage: { inputTokens: 90, outputTokens: 20, cacheReadTokens: 30, totalTokens: 140 },
      })
      flows.push(model.protocol)
    }
    server.fault.loseReceipt = true
    expect((await ctx.unionpayUsage.flush()).pending).toBe(3)
    expect((await server.operations()).clientUsage).toHaveLength(3)
    expect((await ctx.unionpayUsage.flush()).pending).toBe(0)
    const firstReports = (await server.operations()).clientUsage
    expect(firstReports).toHaveLength(3)
    for (const row of firstReports) expect(row).toMatchObject({ memberId: server.state.members[0]!.id, inputTokens: 120, outputTokens: 20, totalTokens: 140, source: 'enterprise' })
    expect(firstReports.filter(row => row.reasoningTokens === 5)).toHaveLength(2)
    await ctx.unionpayConnection.refresh()
    expect(ctx.unionpayConnection.getState().quota).toMatchObject({ requests: 3, totalTokens: 420, inputTokens: 360, outputTokens: 60 })
    expect(server.calls.every(call => call.secretWasServerOwned)).toBe(true)

    server.fault.omitUsage = true
    await invoke(ctx, server.state.models[0]!)
    await ctx.unionpayUsage.flush()
    const unknown = (await server.operations()).clientUsage.at(-1)!
    expect(unknown).not.toHaveProperty('inputTokens')
    expect(unknown).not.toHaveProperty('totalTokens')
    server.fault.omitUsage = false

    await invoke(ctx, server.state.models[0]!)
    await ctx.unionpayConnection.signOut()
    await ctx.unionpayConnection.signInCode(await server.code(server.state.members[1]))
    expect((await ctx.unionpayUsage.flush()).waitingForMember).toBe(true)
    expect((await server.operations()).clientUsage).toHaveLength(4)
    await invoke(ctx, server.state.models[1]!)
    await ctx.unionpayUsage.flush()
    expect((await server.operations()).clientUsage.at(-1)).toMatchObject({ memberId: server.state.members[1]!.id })
    await ctx.unionpayConnection.signOut()
    await ctx.unionpayConnection.signInCode(await server.code())
    await ctx.unionpayUsage.flush()
    expect((await server.operations()).clientUsage.at(-1)).toMatchObject({ memberId: server.state.members[0]!.id })

    await invoke(ctx, server.state.models[0]!)
    await ctx.fiber.dispose()
    const restored = await enterpriseHost(server.origin, home)
    cleanups.push(() => restored.ctx.fiber.dispose())
    ctx = restored.ctx
    expect(ctx.unionpayConnection.getState().status).toBe('connected')
    expect(ctx.unionpayUsage.getState().pending).toBe(1)
    await ctx.unionpayUsage.flush()
    expect(new Set((await server.operations()).clientUsage.map(row => row.clientId)).size).toBe(1)

    await server.collection(false)
    await ctx.unionpayUsage.flush()
    const before = (await server.operations()).clientUsage.length
    await invoke(ctx, server.state.models[0]!)
    expect(ctx.unionpayUsage.getState()).toMatchObject({ collection: 'disabled', pending: 0 })
    expect((await server.operations()).clientUsage).toHaveLength(before)
    await server.collection(true)
    await ctx.unionpayUsage.flush()

    await server.disableModel(0)
    await ctx.unionpayConnection.refresh()
    expect(ctx.llm.listProviders()).toHaveLength(2)
    await server.revoke()
    await ctx.unionpayConnection.refresh()
    expect(ctx.unionpayConnection.getState().status).toBe('expired')
    expect(ctx.llm.listProviders()).toHaveLength(0)

    const evidence = { managementSource: source, protocols: flows, sso: 'OIDC authorization code + PKCE with signed fixture IdP', provider: 'deterministic local HTTP/SSE fixture', serverOwnedProviderCredentials: true, knownUsage: { inputTokens: 360, outputTokens: 60, totalTokens: 420, requests: 3 }, missingUsagePreserved: true, lostReceiptDeduplicated: true, accountSwitchIsolated: true, restartRecovered: true, collectionDisabled: true, modelRevoked: true, membershipRevoked: true }
    const output = resolve('tmp/unionpay-integration')
    await mkdir(output, { recursive: true })
    await writeFile(join(output, 'management-acceptance.json'), JSON.stringify(evidence, null, 2) + '\n')
  }, 60000)
})
