/** Enterprise member authentication and gateway grants, owned by one DSH Host instance. */
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { Context, Service } from '@deepseek-ai/cordis'
import { credentialKey, type CredentialRecord } from '@deepseek-ai/dsh-credentials'
import type { AuthorizationSession } from '@deepseek-ai/dsh-authorization'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import { z } from 'zod'
import { Config } from './config.ts'
import { collectionConfig, devicePending, deviceStart, discovery, enterpriseOrigin, okResponse, runtimeCatalog, runtimeGrant, sessionResponse, snapshotResponse, storedCredential, storedGrant } from './protocol.ts'
import type { StoredGrant } from './protocol.ts'
import { decode, enterpriseRequest, EnterpriseError, failureCode } from './transport.ts'
import type { EnterpriseResponse } from './transport.ts'
import type { EnterpriseClientId, EnterpriseConnectionView, EnterpriseModel, EnterpriseRuntime, EnterpriseSignInId, EnterpriseUsageOwner, EnterpriseUsageDelivery } from './types.ts'

export { EnterpriseError } from './transport.ts'
export type * from './types.ts'

const KEY = credentialKey('unionpay-connection', 'member')
const ACCEPT = 'application/vnd.unionpay.enterprise-snapshot.v2+json'

interface Attempt {
  readonly id: EnterpriseSignInId
  readonly controller: AbortController
  readonly ready: Promise<void>
  announce(): void
  running: Promise<void>
  done: Promise<void>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** One enterprise member connection and its Host-only model grants. */
    unionpayConnection: UnionPayConnection
  }
}

/** Owns member sessions independently of administrator credentials and local Host authorization. */
export class UnionPayConnection extends TypertRemoteService {
  static inject = ['credentials', 'authorization']
  static Config = Config
  private readonly config: Config
  private origin: string
  private readonly lifetime = new AbortController()
  private identityLifetime = new AbortController()
  private readonly tasks = new Set<Promise<unknown>>()
  private readonly listeners = new Set<() => void>()
  private version = 0
  private revision = 0
  private refreshWanted = 0
  private refreshing: Promise<EnterpriseConnectionView> | undefined
  private runtimePending: { revision: number; refreshCatalog: boolean; promise: Promise<EnterpriseRuntime> } | undefined
  private runtimeValue: EnterpriseRuntime | undefined
  private models: readonly EnterpriseModel[] = []
  private attempt: Attempt | undefined
  private view: EnterpriseConnectionView

  /**
   * @param ctx - Host credential and authorization services.
   * @param config - validated endpoint and request limits.
   */
  constructor(ctx: Context, config: Config) {
    super(ctx, 'unionpayConnection', { namespace: 'unionpay' })
    this.config = config
    this.origin = config.origin.get() === '' ? '' : enterpriseOrigin(config.origin.get())
    this.view = { origin: this.origin, status: this.origin ? 'signed-out' : 'unconfigured', member: null, projects: [], quota: null, modelCount: 0, error: null, signIn: null }
    ctx.inject(['settings'], (child) => { child.effect(() => child.settings.configure({ auto: false }, ctx.fiber)) })
    ctx.on('internal/config', function (this: import('@deepseek-ai/cordis').Fiber, _raw, next) {
      const raw: unknown = next()
      if (this !== ctx.fiber) return raw
      const candidate = Config(raw as Parameters<typeof Config>[0])
      if (candidate.origin.get()) enterpriseOrigin(candidate.origin.get())
      return raw
    })
    ctx.on('loader/volatile-update', () => {
      const origin = config.origin.get() === '' ? '' : enterpriseOrigin(config.origin.get())
      if (origin === this.origin) return
      this.attempt?.controller.abort()
      this.origin = origin
      this.invalidateIdentity()
      this.publish({ origin, error: null, signIn: null })
      void this.refresh()
    })
    ctx.authorization.registerFlow({
      key: KEY, label: 'UnionPay Code', methods: [{ id: 'sso', label: 'Enterprise SSO' }, { id: 'code', label: 'Access code' }],
      run: (session) => {
        const running = this.track(this.authorize(session))
        if (this.attempt !== undefined) this.attempt.running = running
        return running
      },
    })
    ctx.on('credentials/record-updated', (key) => {
      if (key !== KEY || this.lifetime.signal.aborted) return
      this.invalidateIdentity()
      void this.refresh()
    })
    ctx.effect(() => async () => {
      this.lifetime.abort()
      this.identityLifetime.abort()
      this.attempt?.controller.abort()
      for (const wake of this.listeners) wake()
      await Promise.allSettled([...this.tasks])
    }, 'unionpay: requests and authorization lifetime')
  }

  /** Restore saved identity before consumers observe this service. */
  async [Service.init](): Promise<void> {
    await this.refresh()
    void this.track(this.supervise())
  }

  private invalidateIdentity(): void {
    this.revision++
    this.identityLifetime.abort()
    this.identityLifetime = new AbortController()
    this.runtimeValue = undefined
    this.models = []
    this.publish({ status: this.origin ? 'signed-out' : 'unconfigured', member: null, projects: [], quota: null, modelCount: 0 })
  }

  private track<T>(promise: Promise<T>): Promise<T> {
    this.tasks.add(promise)
    void promise.then(() => this.tasks.delete(promise), () => this.tasks.delete(promise))
    return promise
  }

  private publish(patch: Partial<EnterpriseConnectionView>): void {
    if (this.lifetime.signal.aborted) return
    this.view = { ...this.view, ...patch }
    this.version++
    for (const wake of this.listeners) wake()
    try { this.ctx.emit('unionpay/changed', this.view) }
    catch (_error) { this.ctx.logger.warn('UnionPay state listener failed; read the enterprise connection state again') }
  }

  private async supervise(): Promise<void> {
    try {
      while (!this.lifetime.signal.aborted) {
        await delay(this.config.refreshIntervalMs, undefined, { signal: this.lifetime.signal })
        await this.refresh()
      }
    } catch (_error) {
      if (!this.lifetime.signal.aborted) this.ctx.logger.warn('UnionPay refresh stopped; reload the enterprise plugin')
    }
  }

  private request(
    path: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {},
    signal = this.lifetime.signal, origin = this.origin,
  ): Promise<EnterpriseResponse> {
    if (!origin) return Promise.reject(new EnterpriseError('not-configured'))
    return this.track(enterpriseRequest(origin, path, init, this.config, AbortSignal.any([signal, this.lifetime.signal])))
  }

  private async credential(): Promise<z.infer<typeof storedCredential> | null> {
    const record = await this.ctx.credentials.readRecord(KEY)
    if (record === undefined) return null
    const parsed = record.kind === 'grant' ? storedCredential.safeParse(record.payload) : null
    if (!parsed?.success) throw new EnterpriseError('invalid-credential')
    return parsed.data.origin === this.origin ? parsed.data : null
  }

  private async grant(): Promise<StoredGrant> {
    const grant = await this.credential()
    if (grant?.status !== 'signed-in') throw new EnterpriseError('unauthorized')
    if (Date.parse(grant.expiresAt) <= Date.now()) {
      await this.retire(grant, 'expired')
      throw new EnterpriseError('unauthorized')
    }
    return grant
  }

  private async retire(grant: StoredGrant, reason: 'logout' | 'expired'): Promise<void> {
    await this.ctx.credentials.modifyRecord(KEY, (current) => {
      if (current?.kind !== 'grant') return Promise.resolve(undefined)
      const parsed = storedGrant.safeParse(current.payload)
      if (!parsed.success || parsed.data.cookie !== grant.cookie || parsed.data.origin !== grant.origin) return Promise.resolve(undefined)
      return Promise.resolve<CredentialRecord>({ kind: 'grant', payload: { version: 1, status: 'signed-out', origin: grant.origin, reason } })
    })
  }

  private async probe(signal: AbortSignal, origin: string): Promise<void> {
    const result = decode(discovery, (await this.request('/connection', {}, signal, origin)).value)
    if (result.origin !== origin) throw new EnterpriseError('invalid-response')
  }

  /**
   * Read current display-safe state without creating a login or making a network request.
   * @returns the latest complete view.
   */
  @Remote
  getState(): EnterpriseConnectionView { return this.view }

  /**
   * Refresh membership, personal usage, and the authorized model catalog.
   * Network failures preserve the last display data and mark it unavailable; revoked grants are retired.
   * @returns the complete state after the coalesced refresh.
   */
  @Remote
  refresh(): Promise<EnterpriseConnectionView> {
    this.refreshWanted++
    if (this.refreshing !== undefined) return this.refreshing
    const task = async (): Promise<EnterpriseConnectionView> => {
      let observed: number
      do {
        observed = this.refreshWanted
        await this.refreshOnce()
      } while (observed !== this.refreshWanted && !this.lifetime.signal.aborted)
      return this.view
    }
    this.refreshing = this.track(task().finally(() => { this.refreshing = undefined }))
    return this.refreshing
  }

  private async refreshOnce(): Promise<void> {
    if (!this.origin || this.lifetime.signal.aborted) return
    const revision = this.revision
    let grant: StoredGrant | undefined
    try {
      const stored = await this.credential()
      if (stored?.status !== 'signed-in') {
        this.models = []
        this.publish({ status: stored?.reason === 'expired' ? 'expired' : 'signed-out', member: null, quota: null, projects: [], modelCount: 0, error: null })
        return
      }
      grant = await this.grant()
      const snapshot = decode(snapshotResponse, (await this.request('/snapshot', {
        headers: { Cookie: grant.cookie, Accept: ACCEPT, 'X-UnionPay-Client-Usage': '1' },
      }, this.identityLifetime.signal, grant.origin)).value)
      if (snapshot.member.id !== grant.memberId) throw new EnterpriseError('invalid-response')
      if (revision !== this.revision) return
      try { await this.runtime(true) }
      catch (error) {
        if (error instanceof EnterpriseError && error.code === 'forbidden') {
          this.models = []
          this.runtimeValue = undefined
          this.publish({ status: 'connected', member: snapshot.member, projects: snapshot.projects, quota: snapshot.quota, modelCount: 0, error: 'forbidden' })
          return
        }
        throw error
      }
      if (revision === this.revision) this.publish({ status: 'connected', member: snapshot.member, projects: snapshot.projects, quota: snapshot.quota, modelCount: this.models.length, error: null })
    } catch (error) {
      // oxlint-disable-next-line typescript/no-unnecessary-condition -- Disposal can run while the network request is awaited.
      if (revision !== this.revision || this.lifetime.signal.aborted) return
      const code = failureCode(error)
      if (code === 'unauthorized' && grant !== undefined) await this.retire(grant, 'expired')
      else if (code !== 'cancelled') {
        this.publish({ status: 'unavailable', error: code })
        this.ctx.logger.warn('UnionPay connection unavailable (%s); open the enterprise page to retry', code)
      }
    }
  }

  /**
   * Follow complete views from the current version until the caller disconnects.
   * @param signal - observation lifetime, independent of sign-in lifetime.
   * @returns the initial state and subsequent states; no credentials cross this stream.
   */
  @Remote({ mode: 'stream' })
  async *follow(signal: AbortSignal): AsyncIterable<EnterpriseConnectionView> {
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

  /**
   * Redeem a member's one-time access code and store the resulting member session.
   * @param code - administrator-issued member code, never an administrator password.
   * @returns connection state after authorization and initial synchronization.
   */
  @Remote
  async signInCode(code: string): Promise<EnterpriseConnectionView> {
    if (!/^[A-Za-z0-9_-]{43}$/.test(code)) throw new EnterpriseError('invalid-input')
    const attempt = this.begin('code', code)
    await attempt.done
    return this.view
  }

  /**
   * Start browser SSO and return its verification link once available.
   * @returns the pending attempt or its failure.
   */
  @Remote
  async startSso(): Promise<EnterpriseConnectionView> {
    const attempt = this.begin('sso')
    await Promise.race([attempt.ready, attempt.done])
    return this.view
  }

  /**
   * Cancel only the named authorization attempt; an admitted credential commit is allowed to settle.
   * @param id - attempt shown to the caller.
   * @returns state after polling and cancellation have settled.
   */
  @Remote
  async cancelSignIn(id: EnterpriseSignInId): Promise<EnterpriseConnectionView> {
    if (this.attempt?.id === id) { this.attempt.controller.abort(); await this.attempt.done }
    return this.view
  }

  private begin(method: 'code' | 'sso', code?: string): Attempt {
    if (!this.origin) throw new EnterpriseError('not-configured')
    if (this.attempt !== undefined) throw new EnterpriseError('sign-in-busy')
    const origin = this.origin
    let announce!: () => void
    const ready = new Promise<void>((resolve) => { announce = resolve })
    const attempt: Attempt = {
      id: randomUUID() as EnterpriseSignInId, controller: new AbortController(), ready, announce,
      running: Promise.resolve(), done: Promise.resolve(),
    }
    this.attempt = attempt
    this.publish({ signIn: { id: attempt.id, status: 'pending' } })
    attempt.done = this.track((async () => {
      try {
        const outcome = await this.ctx.authorization.begin({
          key: KEY, method, signal: AbortSignal.any([attempt.controller.signal, this.lifetime.signal]),
          interaction: {
            notify: (notice) => {
              if (notice.url) this.publish({ signIn: { id: attempt.id, status: 'pending', verificationUrl: notice.url } })
              attempt.announce()
            },
            prompt: () => {
              if (code === undefined) return Promise.reject(new EnterpriseError('invalid-input'))
              return Promise.resolve(code)
            },
          },
        })
        if (outcome.status === 'authorized') await this.refresh()
        if (this.origin === origin) this.publish({ signIn: null })
      } catch (error) {
        if (this.origin === origin) this.publish({ signIn: { id: attempt.id, status: 'failed', error: failureCode(error) } })
      } finally {
        // Authorization cancellation can settle before its provider's network cleanup.
        await Promise.allSettled([attempt.running])
        if (this.attempt === attempt) this.attempt = undefined
        attempt.announce()
      }
    })())
    return attempt
  }

  private async authorize(session: AuthorizationSession): Promise<void> {
    const origin = this.origin
    const signal = AbortSignal.any([session.signal, this.lifetime.signal, AbortSignal.timeout(this.config.signInTimeoutMs)])
    await this.probe(signal, origin)
    let response: EnterpriseResponse
    let deviceCode: string | undefined
    let committed = false
    try {
      if (session.method === 'code') {
        const code = await session.prompt({ kind: 'secret', message: 'Enterprise access code', signal })
        response = await this.request('/session', { method: 'POST', body: JSON.stringify({ code }) }, signal, origin)
      } else {
        const device = decode(deviceStart, (await this.request('/sso/device', { method: 'POST', body: '{}' }, signal, origin)).value)
        deviceCode = device.deviceCode
        const url = new URL(device.verificationUri)
        if (url.origin !== origin || url.pathname !== '/api/enterprise-client/sso/start' || Date.parse(device.expiresAt) <= Date.now()) {
          throw new EnterpriseError('invalid-response')
        }
        session.notify({ message: 'Continue enterprise sign-in in your browser', url: device.verificationUri })
        let interval = device.intervalMs
        for (;;) {
          await delay(interval, undefined, { signal })
          if (Date.parse(device.expiresAt) <= Date.now()) throw new EnterpriseError('timeout')
          response = await this.request('/sso/device/poll', { method: 'POST', body: JSON.stringify({ deviceCode }) }, signal, origin)
          if (response.status !== 202) break
          interval = decode(devicePending, response.value).intervalMs ?? interval
        }
      }
      const value = decode(sessionResponse, response.value)
      if (response.cookie === null || Date.parse(value.expiresAt) <= Date.now()) throw new EnterpriseError('invalid-response')
      const snapshot = decode(snapshotResponse, (await this.request('/snapshot', {
        headers: { Cookie: response.cookie, Accept: ACCEPT, 'X-UnionPay-Client-Usage': '1' },
      }, signal, origin)).value)
      const grant = decode(storedGrant, { version: 1, status: 'signed-in', origin, cookie: response.cookie,
        csrfToken: value.csrfToken, sessionId: value.sessionId, expiresAt: value.expiresAt, memberId: snapshot.member.id })
      await session.commit({ kind: 'grant', payload: grant })
      committed = true
    } finally {
      if (deviceCode !== undefined && !committed && !this.lifetime.signal.aborted) {
        try { await this.request('/sso/device', { method: 'DELETE', body: JSON.stringify({ deviceCode }) }, this.lifetime.signal, origin) }
        catch (_error) { this.ctx.logger.warn('UnionPay sign-in cancellation could not reach the server; the device request will expire') }
      }
    }
  }

  /**
   * Revoke the current server session and retire the local credential even if the server is unavailable.
   * @returns signed-out state, with a failure code when remote revocation could not be confirmed.
   */
  @Remote
  async signOut(): Promise<EnterpriseConnectionView> {
    const pending = this.attempt
    if (pending !== undefined) { pending.controller.abort(); await pending.done }
    const grant = await this.credential()
    if (grant?.status !== 'signed-in') return this.view
    await this.retire(grant, 'logout')
    await this.refresh()
    try {
      decode(okResponse, (await this.request('/session', {
        method: 'DELETE', headers: { Cookie: grant.cookie, 'X-CSRF-Token': grant.csrfToken },
      }, this.lifetime.signal, grant.origin)).value)
    } catch (error) {
      if (failureCode(error) !== 'unauthorized') this.publish({ error: failureCode(error) })
    }
    return this.view
  }

  /**
   * Read the last authorized catalog without network activity.
   * @returns model metadata owned by this member session.
   */
  catalog(): readonly EnterpriseModel[] { return this.models }

  /**
   * Resolve a Host-only inference grant, coalescing renewal and binding it to the current member session.
   * Invalid runtime responses withdraw cached model routes and expose an unavailable state.
   * @param refreshCatalog - when true, wait for any ordinary pending read, then revalidate even while the grant is usable.
   * @returns credential and cancellation lifetime for an authorized model call.
   */
  runtime(refreshCatalog: boolean = false): Promise<EnterpriseRuntime> {
    const revision = this.revision
    const pending = this.runtimePending
    if (pending?.revision === revision) {
      if (!refreshCatalog || pending.refreshCatalog) return pending.promise
      return pending.promise.then(() => this.runtime(true))
    }
    const promise = this.track(this.acquireRuntime(refreshCatalog).catch((error: unknown) => {
      if (revision === this.revision && error instanceof EnterpriseError && error.code === 'invalid-response') {
        this.models = []
        this.runtimeValue = undefined
        this.publish({ status: 'unavailable', modelCount: 0, error: error.code })
      }
      throw error
    }).finally(() => {
      if (this.runtimePending?.promise === promise) this.runtimePending = undefined
    }))
    this.runtimePending = { revision, refreshCatalog, promise }
    return promise
  }

  private async acquireRuntime(refreshCatalog: boolean): Promise<EnterpriseRuntime> {
    const revision = this.revision
    const grant = await this.grant()
    const signal = AbortSignal.any([this.lifetime.signal, this.identityLifetime.signal])
    const cached = this.runtimeValue
    const reusable = cached !== undefined && cached.memberId === grant.memberId && cached.sessionId === grant.sessionId
      && cached.expiresAt > Date.now() + this.config.renewBeforeMs && !cached.signal.aborted
    if (reusable && !refreshCatalog) return cached
    const issued = reusable ? { origin: this.origin, token: cached.token, expiresAt: new Date(cached.expiresAt).toISOString() }
      : decode(runtimeGrant, (await this.request('/model-runtime/authorize', {
        method: 'POST', headers: { Cookie: grant.cookie, 'X-CSRF-Token': grant.csrfToken }, body: '{}',
      }, signal, grant.origin)).value)
    if (issued.origin !== this.origin || Date.parse(issued.expiresAt) <= Date.now()) throw new EnterpriseError('invalid-response')
    const catalog = decode(runtimeCatalog, (await this.request('/model-runtime/catalog', {
      headers: { Authorization: 'Bearer ' + issued.token },
    }, signal, grant.origin)).value)
    if (catalog.memberId !== grant.memberId || catalog.sessionId !== grant.sessionId) throw new EnterpriseError('invalid-response')
    if (revision !== this.revision || signal.aborted) throw new EnterpriseError('cancelled')
    this.models = catalog.models
    this.runtimeValue = {
      origin: grant.origin, memberId: grant.memberId, sessionId: grant.sessionId, token: issued.token,
      expiresAt: Math.min(Date.parse(issued.expiresAt), Date.parse(catalog.expiresAt)), models: catalog.models, signal,
    }
    this.publish({ modelCount: catalog.models.length })
    return this.runtimeValue
  }

  /**
   * Capture the reporting owner before starting a model request.
   * @returns the configured origin and current member, or null without an origin.
   */
  async usageOwner(): Promise<EnterpriseUsageOwner | null> {
    if (!this.origin) return null
    const credential = await this.credential()
    return { origin: this.origin, memberId: credential?.status === 'signed-in' && Date.parse(credential.expiresAt) > Date.now() ? credential.memberId : null }
  }

  /**
   * Read the enterprise collection switch without changing any queue.
   * @param clientId - the reporting plugin's persisted device UUID.
   * @returns the administrator's collection setting, or null before an origin is configured.
   */
  async collectionEnabled(clientId: EnterpriseClientId): Promise<boolean | null> {
    if (!this.origin) return null
    const credential = await this.credential()
    const headers = credential?.status === 'signed-in' ? { Cookie: credential.cookie } : undefined
    return decode(collectionConfig, (await this.request('/collection/config?clientId=' + encodeURIComponent(clientId), {
      ...(headers === undefined ? {} : { headers }),
    }, this.identityLifetime.signal, credential?.origin ?? this.origin)).value).enabled
  }

  /**
   * Submit one already-persisted usage batch for its captured owner.
   * A different signed-in member cannot receive the batch; anonymous batches stay anonymous.
   * @param owner - identity captured when the calls began.
   * @param clientId - persistent reporting-device UUID.
   * @param records - white-listed reports validated by the usage plugin.
   * @returns acknowledged rows, an explicit collection opt-out, or a request to wait for the original member.
   */
  async reportUsage(
    owner: EnterpriseUsageOwner, clientId: EnterpriseClientId, records: readonly object[],
  ): Promise<EnterpriseUsageDelivery> {
    if (owner.origin !== this.origin) return { status: 'waiting-for-member' }
    const credential = await this.credential()
    const grant = credential?.status === 'signed-in' ? credential : null
    let headers: Record<string, string>
    if (owner.memberId === null) headers = { 'X-Collection-Anonymous': '1' }
    else {
      if (grant === null || grant.memberId !== owner.memberId) return { status: 'waiting-for-member' }
      headers = { Cookie: grant.cookie }
    }
    const config = decode(collectionConfig, (await this.request('/collection/config?clientId=' + encodeURIComponent(clientId), {
      headers,
    }, this.identityLifetime.signal, owner.origin)).value)
    if (!config.enabled) return { status: 'disabled' }
    if ((config.memberId ?? null) !== owner.memberId || config.ticket === undefined) throw new EnterpriseError('unauthorized')
    const result = await this.request('/collection/usage', {
      method: 'POST', headers: { ...headers, 'X-Collection-Ticket': config.ticket },
      body: JSON.stringify({ clientId, ...(owner.memberId === null ? {} : { memberId: owner.memberId }), records }),
    }, this.identityLifetime.signal, owner.origin)
    const receipt = decode(z.object({ accepted: z.number().int().nonnegative(), duplicates: z.number().int().nonnegative() }), result.value)
    if (receipt.accepted + receipt.duplicates !== records.length) throw new EnterpriseError('invalid-response')
    return { status: 'acknowledged', count: records.length }
  }
}

export default UnionPayConnection
