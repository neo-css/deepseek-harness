/** External member and model HTTP fixture; model text and usage come from the selected Session. */
import { createServer } from 'node:http'
import { once } from 'node:events'
import { readFile } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'

export const name = 'unionpay-snapshot-gateway'

/** @param ctx - fixture lifetime. @returns the external HTTP listener disposer. */
export async function apply(ctx) {
  const rows = (await readFile(process.env.DSH_SNAPSHOT_FILE, 'utf8')).trim().split('\n').map(line => JSON.parse(line))
  const result = rows.filter(row => row.type === 'assistant/message').at(-1).data
  const text = result.message.content.filter(block => block.type === 'text').map(block => block.text).join('')
  const usage = result.usage
  const memberId = '11111111-1111-4111-8111-111111111111'
  const modelId = '22222222-2222-4222-8222-222222222222'
  const code = randomBytes(32).toString('base64url')
  const token = randomBytes(32).toString('base64url')
  const sessionId = randomBytes(32).toString('base64url')
  const expiresAt = new Date(Date.now() + 3600000).toISOString()
  let origin
  let signedIn = false
  const server = createServer((request, response) => {
    void (async () => {
      const path = new URL(request.url, origin).pathname.replace('/api/enterprise-client', '')
      const chunks = []
      for await (const chunk of request) chunks.push(chunk)
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks)) : {}
      const json = (value, status = 200) => { response.writeHead(status, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(value)) }
      if (path === '/connection') return json({ product: 'UnionPay Code', protocolVersion: 1, origin })
      if (path === '/session' && body.code === code) {
        signedIn = true
        response.setHeader('Set-Cookie', 'unionpay_client_session=' + token + '; HttpOnly')
        return json({ authenticated: true, authentication: 'access-code', csrfToken: token, sessionId, expiresAt })
      }
      if (!signedIn) return json({}, 401)
      if (path === '/snapshot') return json({ member: { id: memberId, name: 'Snapshot member', department: '', seat: 'developer' }, projects: [], quota: { month: '2026-10', inputTokens: 0, outputTokens: 0, totalTokens: 0, requests: 0, incompleteRequests: 0, budget: null } })
      if (path === '/model-runtime/authorize') return json({ origin, token, expiresAt })
      if (path === '/model-runtime/catalog') return json({ memberId, sessionId, revision: 1, expiresAt, models: [{ id: modelId, name: 'Enterprise snapshot', modelId: 'enterprise-snapshot', protocol: 'openai-chat-completions', contextWindow: 32768, maxOutputTokens: 2048, capabilities: { supportsToolCall: true, supportsImage: false } }] })
      if (path === '/collection/config') return json({ enabled: true, sampleRate: 1, ticket: token, memberId })
      if (path === '/collection/usage') return json({ accepted: body.records.length, duplicates: 0 })
      if (path === '/models/' + modelId + '/v1/chat/completions') {
        if (request.headers.authorization !== 'Bearer ' + token) return json({}, 401)
        response.writeHead(200, { 'Content-Type': 'text/event-stream' })
        const frames = [
          { choices: [{ index: 0, delta: { role: 'assistant', content: text }, finish_reason: null }] },
          { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: usage.inputTokens + (usage.cacheReadTokens ?? 0), completion_tokens: usage.outputTokens, total_tokens: usage.totalTokens, prompt_tokens_details: { cached_tokens: usage.cacheReadTokens }, completion_tokens_details: { reasoning_tokens: usage.reasoningTokens } } },
        ]
        response.end(frames.map(frame => 'data: ' + JSON.stringify(frame) + '\n\n').join('') + 'data: [DONE]\n\n')
        return
      }
      json({}, 404)
    })().catch(error => { response.destroy(error) })
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  origin = 'http://127.0.0.1:' + server.address().port
  ctx.provide('unionpayFixture', { origin, code })
  return async () => { server.closeAllConnections(); await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())) }
}
