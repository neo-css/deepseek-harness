/** Usage evidence remains independent of arbitrary SSE chunk boundaries and provider omissions. */
import { afterEach, describe, expect, it } from 'vitest'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { UsageObserver } from '../src/usage-observer.ts'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })

async function observe(observer: UsageObserver, text: string) {
  const bytes = new TextEncoder().encode(text)
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/event-stream' })
    for (let index = 0; index < bytes.length; index++) response.write(bytes.slice(index, index + 1))
    response.end()
  })
  cleanups.push(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() =>{  resolve() })) })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('Missing test endpoint')
  const response = await observer.fetch('http://127.0.0.1:' + String(address.port))
  expect(await response.text()).toBe(text)
}

describe('enterprise usage observation', () => {
  it('preserves explicit zeros and reasoning without mistaking model text for counters', async () => {
    const observer = new UsageObserver('openai-chat-completions', 4096)
    await observe(observer, 'data: {"choices":[{"delta":{"content":"用量 usage 999"}}]}\r\n\r\ndata: {"usage":{"prompt_tokens":0,"completion_tokens":0,"total_tokens":0,"completion_tokens_details":{"reasoning_tokens":0}}}\r\n\r\ndata: [DONE]\r\n\r\n')
    expect(observer.snapshot()).toEqual({ inputTokens: 0, outputTokens: 0, totalTokens: 0, reasoningTokens: 0 })
    expect(observer.tokenUsage()).toEqual({ inputTokens: 0, outputTokens: 0, totalTokens: 0, reasoningTokens: 0 })
  })

  it('retains partial counters while withholding incomplete DSH token usage', async () => {
    const observer = new UsageObserver('openai-responses', 4096)
    await observe(observer, 'data: {"response":{"usage":{"input_tokens":120}}}\n\n')
    expect(observer.snapshot()).toEqual({ inputTokens: 120 })
    expect(observer.tokenUsage()).toBeUndefined()
  })

  it('keeps Anthropic cache counters when a later update contains only ordinary input and output', async () => {
    const observer = new UsageObserver('anthropic-messages', 4096)
    await observe(observer, 'data: {"message":{"usage":{"input_tokens":90,"cache_read_input_tokens":30,"output_tokens":1}}}\n\ndata: {"usage":{"input_tokens":90,"output_tokens":20}}\n\n')
    expect(observer.snapshot()).toEqual({ inputTokens: 120, outputTokens: 20, cacheReadTokens: 30, totalTokens: 140 })
    expect(observer.tokenUsage()).toMatchObject({ inputTokens: 90, outputTokens: 20, cacheReadTokens: 30 })
  })

  it('discards uncertain counters after a bounded parser overflow without changing response bytes', async () => {
    const observer = new UsageObserver('openai-chat-completions', 32)
    await observe(observer, 'data: ' + 'x'.repeat(100) + '\n\ndata: {"usage":{"prompt_tokens":1,"completion_tokens":1}}\n\n')
    expect(observer.exceededLimit()).toBe(true)
    expect(observer.snapshot()).toEqual({})
  })

  it('keeps missing or malformed provider counters unknown', async () => {
    const observer = new UsageObserver('openai-chat-completions', 4096)
    await observe(observer, 'data: not-json\n\ndata: {"usage":{"prompt_tokens":"100","completion_tokens":-1}}\n\n')
    expect(observer.snapshot()).toEqual({})
  })
})
