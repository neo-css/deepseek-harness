/** Loopback enterprise-protocol fixture; the real management router is exercised separately. */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { randomBytes, randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { modelResponse } from './model-response.ts'

const secret = () => randomBytes(32).toString('base64url')
const expires = () => new Date(Date.now() + 3600000).toISOString()

export async function enterpriseFixture(reply: typeof modelResponse = modelResponse) {
  const members = ['Alice', 'Bob'].map(name => ({ id: randomUUID(), name, department: 'Engineering', seat: 'developer' }))
  const models = (['openai-chat-completions', 'openai-responses', 'anthropic-messages'] as const).map((protocol, index) => ({
    id: randomUUID(), name: `Enterprise ${index}`, modelId: `enterprise-${index}`, protocol,
    contextWindow: 32768, maxOutputTokens: 2048, capabilities: { supportsToolCall: true, supportsImage: false },
  }))
  const codes = new Map<string, typeof members[number]>()
  const sessions = new Map<string, { member: typeof members[number]; csrfToken: string; sessionId: string }>()
  const grants = new Map<string, { memberId: string; sessionId: string; cookie: string }>()
  const requests: { path: string; body: unknown; authorization: string | undefined }[] = []
  const reports = new Map<string, Record<string, unknown>>()
  const tickets = new Map<string, { clientId: string; memberId?: string }>()
  const pendingDevices = new Set<string>()
  const control = {
    collectionEnabled: true, failAfterAccept: false, approveSso: false, omitUsage: false,
    modelGate: null as Promise<void> | null, snapshotGate: null as Promise<void> | null,
    rejectModel: false, rejectMembership: false, modelEntered: null as (() => void) | null,
  }
  let origin = ''

  const json = (response: ServerResponse, value: unknown, status = 200): void => {
    response.writeHead(status, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify(value))
  }
  const session = (request: IncomingMessage) => sessions.get(request.headers.cookie ?? '')
  const establish = (response: ServerResponse, member: typeof members[number]): void => {
    const cookie = 'unionpay_client_session=' + secret()
    const value = { member, csrfToken: secret(), sessionId: secret() }
    sessions.set(cookie, value)
    response.setHeader('Set-Cookie', cookie + '; Path=/api/enterprise-client; HttpOnly')
    json(response, { authenticated: true, authentication: 'access-code', csrfToken: value.csrfToken, sessionId: value.sessionId, expiresAt: expires() })
  }
  const server = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url!, origin)
      const path = url.pathname.replace('/api/enterprise-client', '')
      const parts: Buffer[] = []
      for await (const part of request) parts.push(Buffer.from(part as Uint8Array))
      const body: Record<string, unknown> = parts.length ? JSON.parse(Buffer.concat(parts).toString()) as Record<string, unknown> : {}
      if (request.method === 'POST' && !path.startsWith('/models/') && request.headers.origin !== origin) {  json(response, {}, 403); return }
      if (path === '/connection') {  json(response, { product: 'UnionPay Code', protocolVersion: 1, origin }); return }
      if (path === '/session' && request.method === 'POST') {
        const member = codes.get(String(body.code))
        if (!member) {  json(response, {}, 401); return }
        codes.delete(String(body.code)); establish(response, member); return
      }
      if (path === '/session' && request.method === 'DELETE') { sessions.delete(request.headers.cookie ?? '');  json(response, { ok: true }); return }
      if (path === '/sso/device' && request.method === 'POST') {
        const deviceCode = secret(); pendingDevices.add(deviceCode)
        json(response, { deviceCode, verificationUri: origin + '/api/enterprise-client/sso/start?device=public-ticket', expiresAt: expires(), intervalMs: 1000 }); return
      }
      if (path === '/sso/device' && request.method === 'DELETE') { pendingDevices.delete(String(body.deviceCode));  json(response, { ok: true }); return }
      if (path === '/sso/device/poll') {
        if (!pendingDevices.has(String(body.deviceCode))) {  json(response, {}, 401); return }
        if (!control.approveSso) {  json(response, { status: 'pending', expiresAt: expires() }, 202); return }
        establish(response, members[0]!); pendingDevices.delete(String(body.deviceCode)); return
      }
      if (path === '/snapshot') {
        const owner = session(request)
        if (!owner || control.rejectMembership) {  json(response, {}, 401); return }
        await control.snapshotGate
        json(response, { member: owner.member, projects: [{ id: '11111111-1111-4111-8111-111111111111', name: 'Project' }],
          quota: { month: '2026-10', inputTokens: 0, outputTokens: 0, totalTokens: 0, requests: 0, incompleteRequests: 0, budget: null } }); return
      }
      if (path === '/model-runtime/authorize') {
        const owner = session(request)
        if (!owner) {  json(response, {}, 401); return }
        if (request.headers['x-csrf-token'] !== owner.csrfToken) {  json(response, {}, 403); return }
        const token = secret()
        grants.set(token, { memberId: owner.member.id, sessionId: owner.sessionId, cookie: request.headers.cookie! })
        json(response, { origin, token, expiresAt: expires() }); return
      }
      if (path === '/model-runtime/catalog' || path.startsWith('/models/')) {
        const grant = grants.get(request.headers.authorization?.replace('Bearer ', '') ?? '')
        if (!grant || !sessions.has(grant.cookie)) {  json(response, {}, 401); return }
        if (path === '/model-runtime/catalog') {  json(response, { memberId: grant.memberId, sessionId: grant.sessionId, revision: 1, expiresAt: expires(), models: control.rejectModel ? [] : models }); return }
        const model = models.find(value => path.includes('/' + value.id + '/'))
        if (!model || control.rejectModel) {  json(response, {}, 403); return }
        const expected = model.protocol === 'openai-chat-completions' ? 'chat/completions' : model.protocol === 'anthropic-messages' ? 'messages' : 'responses'
        if (path !== `/models/${model.id}/v1/${expected}`) {  json(response, {}, 404); return }
        requests.push({ path, body, authorization: request.headers.authorization })
        control.modelEntered?.()
        await control.modelGate
        if (response.destroyed) return
        response.writeHead(200, { 'Content-Type': 'text/event-stream' })
        response.end(reply(model.protocol, !control.omitUsage))
        return
      }
      if (path === '/collection/config') {
        const member = request.headers['x-collection-anonymous'] === '1' ? undefined : session(request)?.member
        const ticket = secret()
        tickets.set(ticket, { clientId: url.searchParams.get('clientId')!, ...(member ? { memberId: member.id } : {}) })
        json(response, { enabled: control.collectionEnabled, sampleRate: 1, ticket, ...(member ? { memberId: member.id } : {}) }); return
      }
      if (path === '/collection/usage') {
        if (!control.collectionEnabled) {  json(response, {}, 403); return }
        const ticket = tickets.get(String(request.headers['x-collection-ticket']))
        const member = request.headers['x-collection-anonymous'] === '1' ? undefined : session(request)?.member
        if (!ticket || ticket.memberId !== member?.id || ticket.memberId !== body.memberId || ticket.clientId !== body.clientId) {
          json(response, {}, 401)
          return
        }
        const records = body.records as Record<string, unknown>[]
        let duplicates = 0
        for (const record of records) {
          const key = String(record.requestId)
          if (reports.has(key)) duplicates++
          else reports.set(key, { ...record, ...(member ? { memberId: member.id } : {}) })
        }
        if (control.failAfterAccept) { control.failAfterAccept = false;  json(response, {}, 503); return }
        json(response, { accepted: records.length - duplicates, duplicates }); return
      }
      json(response, {}, 404)
    })().catch(() => { if (!response.destroyed) json(response, {}, 500) })
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('Missing fixture address')
  origin = 'http://127.0.0.1:' + String(address.port)
  return { origin, members, models, control, requests, reports, pendingDevices,
    code(member = members[0]!) { const code = secret(); codes.set(code, member); return code },
    revoke() { sessions.clear() },
    async close() {
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) => server.close((error) => { if (error) reject(error); else resolve() }))
    },
  }
}
