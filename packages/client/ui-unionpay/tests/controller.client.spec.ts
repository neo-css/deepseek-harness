// @vitest-environment jsdom
/** Browser handoff through the enterprise controller's real click and Host observation paths. */
import { Context } from '@deepseek-ai/cordis'
import type { RemoteResult } from '@deepseek-ai/dsh-api-remotes/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SettingsFormScopeSnapshot } from '@deepseek-ai/dsh-client-ui-primitives'
import type { EnterpriseConnectionView, EnterpriseSignInId } from '@deepseek-ai/dsh-unionpay-connection/types'
import type { UsageDeliveryView } from '@deepseek-ai/dsh-unionpay-usage/types'
import { afterEach, expect, it, vi } from 'vitest'
import { EnterprisePageController, type EnterpriseSettings } from '../src/client/controller.ts'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const signedOut: EnterpriseConnectionView = {
  origin: 'https://enterprise.test', status: 'signed-out', member: null, projects: [], quota: null,
  modelCount: 0, error: null, signIn: null,
}
const pending: EnterpriseConnectionView = {
  ...signedOut, signIn: {
    id: 'attempt' as EnterpriseSignInId, status: 'pending',
    verificationUrl: 'https://enterprise.test/api/enterprise-client/sso/start?device=public-ticket',
  },
}

function hostStream<T>(initial: T) {
  const values = [initial]
  let closed = false
  let wake = (): void => {}
  return {
    push(value: T) { values.push(value); wake() },
    async dispose() { closed = true; wake() },
    async *[Symbol.asyncIterator]() {
      while (!closed) {
        const value = values.shift()
        if (value !== undefined) { yield { value, accept() {} }; continue }
        await new Promise<void>((resolve) => { wake = resolve })
      }
    },
  }
}

async function setup(blocked = false) {
  const close = vi.fn()
  const replace = vi.fn()
  const popup: { closed: boolean; opener: Window | null } = { closed: false, opener: window }
  const open = vi.spyOn(window, 'open').mockReturnValue(blocked ? null : new Proxy(window, {
    get(target, property, receiver): unknown {
      if (property === 'closed') return popup.closed
      if (property === 'opener') return popup.opener
      if (property === 'close') return close
      if (property === 'location') return { replace }
      return Reflect.get(target, property, receiver)
    },
    set(target, property, value: unknown, receiver) {
      if (property === 'opener' && value === null) { popup.opener = null; return true }
      return Reflect.set(target, property, value, receiver)
    },
  }))
  const response = Promise.withResolvers<RemoteResult<EnterpriseConnectionView>>()
  const startSso = vi.fn(() => response.promise)
  const connection = hostStream(signedOut)
  const delivery = hostStream<UsageDeliveryView>({
    pending: 0, collection: 'enabled', waitingForMember: false, lastDeliveryAt: null, error: null, failedToPersist: 0,
  })
  const ctx = new Context()
  ctx.provide('remote', {
    unionpay: { startSso },
    $stream: (options: { name: string }) => options.name === 'Enterprise connection' ? connection : delivery,
  })
  const scope = createSnapshotStore<SettingsFormScopeSnapshot<EnterpriseSettings>>({
    status: 'ready', value: { origin: signedOut.origin }, base: {}, user: {}, writable: true, revision: 0,
  })
  const controller = new EnterprisePageController(ctx, { ...scope, mutate: async () => true })
  cleanups.push(async () => { await controller.dispose(); await ctx.fiber.dispose() })
  await vi.waitFor(() => { expect(controller.face().hooks.enterprise.getSnapshot().connection).toEqual(signedOut) })
  return { controller, connection, response, startSso, popup, open, close, replace }
}

it('preopens during the click and navigates once after the Host provides the login URL', async () => {
  const b = await setup()
  b.controller.face().startSso()
  expect(b.open).toHaveBeenCalledExactlyOnceWith('about:blank', '_blank')
  expect(b.popup.opener).toBeNull()
  expect(b.startSso).toHaveBeenCalledOnce()
  expect(b.replace).not.toHaveBeenCalled()
  b.response.resolve({ ok: true, value: pending })
  await vi.waitFor(() => { expect(b.replace).toHaveBeenCalledExactlyOnceWith(pending.signIn!.verificationUrl) })
  b.connection.push(pending)
  b.connection.push(pending)
  await vi.waitFor(() => { expect(b.controller.face().hooks.enterprise.getSnapshot().connection).toEqual(pending) })
  expect(b.open).toHaveBeenCalledOnce()
  expect(b.replace).toHaveBeenCalledOnce()
})

it('keeps the Host login pending when the browser blocks the popup', async () => {
  const b = await setup(true)
  b.controller.face().startSso()
  b.response.resolve({ ok: true, value: pending })
  await vi.waitFor(() => { expect(b.controller.face().hooks.enterprise.getSnapshot().busy).toBe(false) })
  expect(b.startSso).toHaveBeenCalledOnce()
  expect(b.open.mock.calls).toEqual([
    ['about:blank', '_blank'],
    [pending.signIn!.verificationUrl, '_blank', 'noopener,noreferrer'],
  ])
  expect(b.replace).not.toHaveBeenCalled()
  expect(b.controller.notice.getSnapshot()).toBeNull()
})

it('opens the login URL through the Desktop external-window handler without a blank page', async () => {
  vi.stubGlobal('dshDesktop', {})
  const b = await setup(true)
  b.controller.face().startSso()
  expect(b.open).not.toHaveBeenCalled()
  b.response.resolve({ ok: true, value: pending })
  await vi.waitFor(() => {
    expect(b.open).toHaveBeenCalledExactlyOnceWith(pending.signIn!.verificationUrl, '_blank', 'noopener,noreferrer')
  })
})

it.each(['request', 'authorization'] as const)('closes the unused page on %s failure', async (failure) => {
  const b = await setup()
  b.controller.face().startSso()
  if (failure === 'request') b.response.reject(new Error('disconnected'))
  else b.response.resolve({ ok: true, value: { ...signedOut, signIn: { id: pending.signIn!.id, status: 'failed', error: 'unavailable' } } })
  await vi.waitFor(() => { expect(b.close).toHaveBeenCalledOnce() })
  expect(b.replace).not.toHaveBeenCalled()
  expect(b.controller.notice.getSnapshot()).toMatchObject({ key: 'operationFailed', success: false })
})

it('closes an opened login page when the Host cancels the attempt', async () => {
  const b = await setup()
  b.controller.face().startSso()
  b.response.resolve({ ok: true, value: pending })
  await vi.waitFor(() => { expect(b.replace).toHaveBeenCalledOnce() })
  b.connection.push(pending)
  b.connection.push(signedOut)
  await vi.waitFor(() => { expect(b.close).toHaveBeenCalledOnce() })
})

it('leaves the completed login page open after success and controller disposal', async () => {
  const b = await setup()
  b.controller.face().startSso()
  b.response.resolve({ ok: true, value: pending })
  await vi.waitFor(() => { expect(b.replace).toHaveBeenCalledOnce() })
  b.connection.push(pending)
  b.connection.push({ ...signedOut, status: 'connected' })
  await vi.waitFor(() => { expect(b.controller.notice.getSnapshot()?.key).toBe('signedIn') })
  await b.controller.dispose()
  expect(b.close).not.toHaveBeenCalled()
})

it('closes the blank page and skips navigation if the controller unloads before the Host responds', async () => {
  const b = await setup()
  b.controller.face().startSso()
  await b.controller.dispose()
  b.response.resolve({ ok: true, value: pending })
  await vi.waitFor(() => { expect(b.controller.face().hooks.enterprise.getSnapshot().busy).toBe(false) })
  expect(b.close).toHaveBeenCalledOnce()
  expect(b.replace).not.toHaveBeenCalled()
})

it('closes a blank page when streamed success arrives before the initial response', async () => {
  const b = await setup()
  b.controller.face().startSso()
  b.connection.push(pending)
  b.connection.push({ ...signedOut, status: 'connected' })
  await vi.waitFor(() => { expect(b.close).toHaveBeenCalledOnce() })
  b.response.resolve({ ok: true, value: pending })
  await vi.waitFor(() => { expect(b.controller.face().hooks.enterprise.getSnapshot().busy).toBe(false) })
  expect(b.replace).not.toHaveBeenCalled()
  expect(b.controller.notice.getSnapshot()?.key).toBe('signedIn')
})
