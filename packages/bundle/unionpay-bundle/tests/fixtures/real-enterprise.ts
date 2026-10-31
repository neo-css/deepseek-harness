/** Builds the selected UnionPay Code management sources unchanged and serves them over loopback HTTP. */
import { build } from 'esbuild'
import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { generateKeyPair, exportJWK, SignJWT } from 'jose'
import { createHash, randomBytes } from 'node:crypto'
import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { modelResponse, type Protocol } from './model-response.ts'

interface ManagementRouters {
  app: Hono
  clientApp: Hono
  telemetryApp: Hono
  usageApp: Hono
  dispose(): Promise<void>
}

interface ManagementModule {
  createEnterpriseAdminRouter(options: { directory: string; bootstrapToken: string; publicOrigin: string }): Promise<ManagementRouters>
}

interface AdminState {
  revision: number
  members: { id: string; name: string }[]
  models: { id: string; name: string; modelId: string; protocol: Protocol }[]
  projects: { id: string }[]
}

/**
 * Uses the owning checkout's package exports and an explicitly supplied dependency installation.
 * No DSH resolver or enterprise production source is changed by this fixture build.
 */
async function managementModule(root: string, dependencyRoot: string, directory: string): Promise<ManagementModule> {
  const require = createRequire(join(dependencyRoot, 'package.json'))
  const shared = JSON.parse(await readFile(join(root, 'packages/shared/package.json'), 'utf8')) as { exports: Record<string, string> }
  const alias: Record<string, string> = {}
  for (const [entry, target] of Object.entries(shared.exports)) alias['@zcode/shared' + (entry === '.' ? '' : entry.slice(1))] = resolve(root, 'packages/shared', target)
  for (const module of ['zod', 'hono', 'hono/cookie', 'hono/body-limit', 'jose', 'ws']) alias[module] = require.resolve(module)
  const outfile = join(directory, 'enterprise-router.mjs')
  await build({
    stdin: { contents: `export { createEnterpriseAdminRouter } from ${JSON.stringify(join(root, 'packages', 'server', 'src', 'enterprise-admin', 'index.ts'))}`, resolveDir: root },
    bundle: true, platform: 'node', format: 'esm', target: 'node24', outfile, alias,
    banner: { js: 'import { createRequire as fixtureRequire } from "node:module"; const require = fixtureRequire(import.meta.url);' },
    logLevel: 'silent',
  })
  // The dynamically selected checkout is outside this TypeScript project; its callable entry is checked by the integration run.
  return await import(pathToFileURL(outfile).href) as ManagementModule
}

/** Start original management routes; only the upstream model and OIDC provider are deterministic fixtures. */
export async function realEnterprise(root: string, dependencyRoot: string, directory: string) {
  const module = await managementModule(root, dependencyRoot, directory)
  const app = new Hono()
  const server = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' })
  await new Promise<void>((resolve) => { if (server.listening) resolve(); else server.once('listening', resolve) })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('Management server has no address')
  const origin = 'http://127.0.0.1:' + String(address.port)
  const adminToken = randomBytes(40).toString('base64url')
  const providerKey = randomBytes(32).toString('base64url')
  let routers: ManagementRouters | undefined
  const close = async (): Promise<void> => {
    await routers?.dispose()
    if ('closeAllConnections' in server) server.closeAllConnections()
    await new Promise<void>((resolve, reject) => server.close((error) => { if (error) reject(error); else resolve() }))
  }
  try {
    routers = await module.createEnterpriseAdminRouter({ directory: join(directory, 'management'), bootstrapToken: adminToken, publicOrigin: origin })
    const calls: { protocol: Protocol; model: string; secretWasServerOwned: boolean }[] = []
    const fault = { loseReceipt: false, omitUsage: false }
    app.use('/api/enterprise-client/collection/usage', async (c, next) => {
      await next()
      if (fault.loseReceipt && c.res.ok) { fault.loseReceipt = false; c.res = Response.json({ error: 'fixture transport failure after commit' }, { status: 503 }) }
    })
    app.route('/api/enterprise-admin', routers.app)
    app.route('/api/enterprise-client', routers.clientApp)
    app.route('/api/enterprise-telemetry', routers.telemetryApp)
    app.route('/api/enterprise-usage', routers.usageApp)
    for (const [route, protocol] of Object.entries({ 'chat/completions': 'openai-chat-completions', responses: 'openai-responses', messages: 'anthropic-messages' } as const)) {
      app.post('/provider/v1/' + route, async (c) => {
        const body = await c.req.json<{ model: string }>()
        const key = protocol === 'anthropic-messages' ? c.req.header('x-api-key') : c.req.header('Authorization')?.replace('Bearer ', '')
        calls.push({ protocol, model: body.model, secretWasServerOwned: key === providerKey })
        if (key !== providerKey) return c.json({ error: 'Wrong provider credential' }, 401)
        return c.body(modelResponse(protocol, !fault.omitUsage), 200, { 'Content-Type': 'text/event-stream' })
      })
    }

    const issuer = origin + '/idp'
    const keys = await generateKeyPair('ES256', { extractable: true })
    const jwk = { ...await exportJWK(keys.publicKey), kid: 'fixture-key', alg: 'ES256', use: 'sig' }
    const authorizations = new Map<string, URL>()
    app.get('/idp/.well-known/openid-configuration', c => c.json({
      issuer, authorization_endpoint: issuer + '/authorize', token_endpoint: issuer + '/token', jwks_uri: issuer + '/jwks',
      response_types_supported: ['code'], subject_types_supported: ['public'], id_token_signing_alg_values_supported: ['ES256'], code_challenge_methods_supported: ['S256'],
    }))
    app.get('/idp/jwks', c => c.json({ keys: [jwk] }))
    app.get('/idp/authorize', (c) => {
      const request = new URL(c.req.url)
      const code = randomBytes(32).toString('base64url')
      authorizations.set(code, request)
      const callback = new URL(request.searchParams.get('redirect_uri')!)
      callback.searchParams.set('state', request.searchParams.get('state')!)
      callback.searchParams.set('code', code)
      callback.searchParams.set('iss', issuer)
      return c.redirect(callback.href)
    })
    app.post('/idp/token', async (c) => {
      const fields = new URLSearchParams(await c.req.text())
      const code = fields.get('code') ?? ''
      const authorization = authorizations.get(code)
      const challenge = createHash('sha256').update(fields.get('code_verifier') ?? '').digest('base64url')
      if (!authorization || authorization.searchParams.get('code_challenge') !== challenge
      || authorization.searchParams.get('client_id') !== fields.get('client_id')
      || authorization.searchParams.get('redirect_uri') !== fields.get('redirect_uri')) return c.json({ error: 'invalid_grant' }, 400)
      authorizations.delete(code)
      const idToken = await new SignJWT({ nonce: authorization.searchParams.get('nonce') })
        .setProtectedHeader({ alg: 'ES256', kid: 'fixture-key' }).setIssuer(issuer).setSubject('dsh-fixture-member')
        .setAudience('dsh-enterprise-fixture').setIssuedAt().setExpirationTime('5m').sign(keys.privateKey)
      return c.json({ access_token: randomBytes(32).toString('base64url'), token_type: 'Bearer', id_token: idToken, expires_in: 300 })
    })

    const login = await fetch(origin + '/api/enterprise-admin/session', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'root', password: adminToken }) })
    const session = await login.json() as { csrfToken: string }
    if (!login.ok) throw new Error('Management fixture bootstrap failed')
    const adminCookie = login.headers.get('set-cookie')!.split(';')[0]!
    const admin = async <T>(path: string, method = 'GET', body?: object): Promise<T> => {
      const response = await fetch(origin + '/api/enterprise-admin' + path, { method, headers: { Origin: origin, Cookie: adminCookie, 'X-CSRF-Token': session.csrfToken, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
      if (!response.ok) throw new Error(`Management fixture operation ${path} failed (${response.status}): ${await response.text()}`)
      return await response.json() as T
    }
    const command = async (command: object): Promise<AdminState> => {
      const state = await admin<AdminState>('/state')
      return admin('/commands', 'POST', { revision: state.revision, command })
    }
    await command({ type: 'capacity.save', input: { seats: 10, monthlyTokenBudget: null, alertPercent: 80 } })
    await command({ type: 'member.save', input: { subject: 'dsh-alice', name: 'DSH Alice', department: 'Integration', role: 'developer', status: 'enabled', ssoIdentity: { issuer, subject: 'dsh-fixture-member' } } })
    await command({ type: 'member.save', input: { subject: 'dsh-bob', name: 'DSH Bob', department: 'Integration', role: 'developer', status: 'enabled' } })
    await command({ type: 'sso.save', input: { issuer, clientId: 'dsh-enterprise-fixture', enabled: true, clientAuth: 'none' } })
    const protocols: Protocol[] = ['openai-chat-completions', 'openai-responses', 'anthropic-messages']
    const modelInputs = protocols.map((protocol, index) => ({ name: `DSH validation ${index}`, modelId: `enterprise-${index}`, baseUrl: origin + '/provider/v1', protocol, credentialRef: '', maxConcurrency: 4, dailyTokenBudget: 100000, status: 'enabled', contextWindow: 32768, maxOutputTokens: 2048, capabilities: { supportsToolCall: true, supportsImage: false } }))
    for (const input of modelInputs) await command({ type: 'model.save', input })
    const state = await admin<AdminState>('/state')
    for (const model of state.models) await admin('/model-credentials', 'POST', { modelId: model.id, secret: providerKey })
    await command({ type: 'project.save', input: { name: 'DSH integration', repositoryUrl: 'https://example.test/integration.git', memberIds: state.members.map(member => member.id), modelIds: state.models.map(model => model.id) } })

    return {
      origin, calls, fault, state,
      async code(member = state.members[0]!) { return (await admin<{ code: string }>('/client-access', 'POST', { memberId: member.id })).code },
      async revoke(member = state.members[0]!) { await admin('/client-access', 'DELETE', { memberId: member.id }) },
      async disableModel(index: number) { await command({ type: 'model.save', input: { ...modelInputs[index], id: state.models[index]!.id, status: 'disabled' } }) },
      async collection(enabled: boolean) { await command({ type: 'observability.save', input: { enabled, sampleRate: 1, retentionDays: 30 } }) },
      async operations() { return JSON.parse(await readFile(join(directory, 'management/operations.json'), 'utf8')) as { clientUsage: Record<string, unknown>[] } },
      async completeSso(verificationUrl: string) {
        const start = await fetch(verificationUrl, { redirect: 'manual' })
        const browserCookie = start.headers.get('set-cookie')!.split(';')[0]!
        const authorization = await fetch(start.headers.get('location')!, { redirect: 'manual' })
        const callback = await fetch(authorization.headers.get('location')!, { redirect: 'manual', headers: { Cookie: browserCookie } })
        const ticket = new URL(callback.headers.get('location')!, origin).searchParams.get('sso_approval')
        if (!ticket) throw new Error('Original OIDC callback did not authorize a device approval')
        const approval = await fetch(origin + '/api/enterprise-client/sso/approval?ticket=' + ticket, { headers: { Cookie: browserCookie } })
        const details = await approval.json() as { csrfToken: string }
        const confirmed = await fetch(origin + '/api/enterprise-client/sso/approve', { method: 'POST', headers: { Origin: origin, Cookie: browserCookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ ticket, csrfToken: details.csrfToken, approve: true }) })
        if (!confirmed.ok) throw new Error('Original device approval failed')
      },
      close,
    }
  } catch (error) { await close(); throw error }
}
