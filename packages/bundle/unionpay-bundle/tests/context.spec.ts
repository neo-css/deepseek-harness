/** Published context statistics consume enterprise adapter usage through durable Session events. */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, onTestFinished } from 'vitest'
import * as ContextPlugin from 'dsh-context'
import SessionStore from '@deepseek-ai/dsh-session'
import SessionProjections from '@deepseek-ai/dsh-session-projection'
import TokenMeter from '@deepseek-ai/dsh-token-meter'
import { createMessage, createUserMessage, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { enterpriseFixture } from './fixtures/server.ts'
import { enterpriseHost } from './fixtures/host.ts'

it.each(['openai-chat-completions', 'openai-responses', 'anthropic-messages'] as const)(
  'counts actual enterprise %s tokens in the published context plugin', async (protocol) => {
    const server = await enterpriseFixture()
    onTestFinished(() => server.close())
    const root = await mkdtemp(join(tmpdir(), 'dsh-enterprise-context-'))
    onTestFinished(() => rm(root, { recursive: true, force: true }))
    const { ctx } = await enterpriseHost(server.origin, root)
    onTestFinished(() => ctx.fiber.dispose())
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjections)
    await ctx.plugin(TokenMeter)
    const context = await ctx.plugin(ContextPlugin, ContextPlugin.Config({}))
    await ctx.unionpayConnection.signInCode(server.code())
    const model = server.models.find(entry => entry.protocol === protocol)!
    const provider = 'unionpay-' + model.id
    const session = ctx.sessions.create()
    session.append('request/context', { provider, model: model.modelId, contextWindow: model.contextWindow })

    // Cache reads are included in the provider's 120 input tokens; reasoning is included in its 20 output tokens.
    for (const turn of [1, 2]) {
      session.append('step/start', { turn, step: turn })
      const message = createUserMessage({ content: [{ type: 'text', text: 'Check enterprise usage.' }], source: { kind: 'user' } })
      session.append('user/message', message, { surfaceOp: 'append' })
      const chunks: StreamChunk[] = []
      for await (const chunk of ctx.llm.stream({ provider, model: model.modelId, messages: [message] })) chunks.push(chunk)
      expect(chunks.at(-1)).toMatchObject({ type: 'finish', reason: { kind: 'stop' } })
      const usage = chunks.find(chunk => chunk.type === 'usage')
      expect(usage).toMatchObject({ usage: { inputTokens: 90, cacheReadTokens: 30, outputTokens: 20, totalTokens: 140 } })
      session.append('assistant/message', {
        turn, step: turn,
        stream: chunks.map(chunk => ({ type: 'chunk', time: 0, chunk })),
        message: createMessage({ role: 'assistant', content: [{ type: 'text', text: 'Enterprise connection verified.' }], source: { kind: 'model', provider, model: model.modelId } }),
        ...usage?.type === 'usage' ? { usage: usage.usage } : {},
      }, { surfaceOp: 'append' })
      session.append('step/end', { turn, step: turn })
      const { values } = ctx.sessionProjections.snapshot(session)
      expect(values.tokenUsage)
        .toEqual({ uncachedInputTokens: 90 * turn, cacheReadTokens: 30 * turn, cacheWriteTokens: 0, outputTokens: 20 * turn })
      expect(ctx.sessionProjections.stateOf(session, 'contextTimeline')?.requests.at(-1)?.prompt).toBe(120)
      expect(values.contextTimeline?.cost?.[provider]?.[model.modelId]?.peak)
        .toEqual({ uncached: 90 * turn, cacheRead: 30 * turn, cacheWrite: 0, output: 20 * turn })
    }

    if (protocol === 'openai-chat-completions') {
      server.control.omitUsage = true
      const chunks: StreamChunk[] = []
      for await (const chunk of ctx.llm.stream({ provider, model: model.modelId, messages: [] })) chunks.push(chunk)
      expect(chunks.some(chunk => chunk.type === 'usage')).toBe(false)
      session.append('assistant/message', {
        turn: 3, step: 3, stream: chunks.map(chunk => ({ type: 'chunk', time: 0, chunk })),
        message: createMessage({ role: 'assistant', content: [{ type: 'text', text: 'Usage unavailable.' }], source: { kind: 'model', provider, model: model.modelId } }),
      }, { surfaceOp: 'append' })
      const { values } = ctx.sessionProjections.snapshot(session)
      expect(values.tokenUsage).toEqual({ uncachedInputTokens: 180, cacheReadTokens: 60, cacheWriteTokens: 0, outputTokens: 40 })
      expect(ctx.sessionProjections.stateOf(session, 'contextTimeline')?.requests.at(-1)).not.toHaveProperty('prompt')
    }

    await context.dispose()
    expect(ctx.sessionProjections.snapshot(session).values).not.toHaveProperty('contextTimeline')
    expect(ctx.sessionProjections.snapshot(session).values).not.toHaveProperty('contextActivity')
  },
)
