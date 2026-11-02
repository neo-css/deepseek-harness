// @vitest-environment jsdom
/** Enterprise page behavior through the same injected views used by the account settings. */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { EnterpriseMemberId, EnterpriseSignInId } from '@deepseek-ai/dsh-unionpay-connection/types'
import type { GlobalStandardProps } from '@deepseek-ai/dsh-client-ui-slots'
import { EnterprisePage, type EnterprisePageProps } from '../src/client/EnterprisePage.tsx'
import { EnterpriseAccount } from '../src/client/EnterpriseAccount.tsx'
import { EnterpriseBrand } from '../src/client/EnterpriseBrand.tsx'
import { en, zh, errorKey } from '../src/client/locales.ts'
import type { EnterpriseFormState, EnterprisePageState } from '../src/client/controller.ts'
import type {} from '../src/client/index.ts'

afterEach(() => { cleanup(); vi.unstubAllEnvs() })

describe('enterprise sidebar brand', () => {
  it('shows only UPH even when build metadata is available', () => {
    vi.stubEnv('DSH_CLIENT_VERSION', '0.2.1-rc.5')
    vi.stubEnv('DSH_CLIENT_COMMIT_HASH', 'abc1234')
    vi.stubEnv('DSH_CLIENT_GIT_DIRTY', 'true')
    const mounted = render(<EnterpriseBrand t={key => key === 'brand' ? en.brand : key} />)
    expect(mounted.container.textContent).toBe('UPH')
    expect(zh.brand).toBe(en.brand)
  })
})

function page(overrides: Partial<EnterprisePageState> = {}, dirty = false, account = false) {
  const state = createSnapshotStore<EnterprisePageState>({ connection: { origin: 'http://enterprise.test', status: 'signed-out', member: null, projects: [], quota: null, modelCount: 0, error: null, signIn: null }, delivery: { pending: 0, collection: 'enabled', waitingForMember: false, lastDeliveryAt: null, error: null, failedToPersist: 0 }, transportFailed: false, busy: false, ...overrides })
  const form = createSnapshotStore<EnterpriseFormState>({ available: true, writable: true, dirty, invalid: false, saving: false, failed: false, origin: { text: 'http://enterprise.test', overridden: true, invalid: false } })
  const actions = {
    edit: vi.fn(), resetField: vi.fn(), save: vi.fn(), discard: vi.fn(), signInCode: vi.fn(async () => true),
    startSso: vi.fn(), cancelSignIn: vi.fn(), signOut: vi.fn(), refresh: vi.fn(), flush: vi.fn(),
    openSettings: vi.fn(), openOnboarding: vi.fn(),
  }
  // This component consumes only its injected enterprise hooks; the slot supplies global hooks in the application.
  const globals = {} as GlobalStandardProps
  const props: EnterprisePageProps = {
    ...globals, ...actions, close: vi.fn(), t: key => key in en ? en[key as keyof typeof en] : key,
    useEnterpriseForm: bindSnapshotSelector(form), useEnterprise: bindSnapshotSelector(state),
  }
  const view = (wide: boolean) => account
    ? <EnterpriseAccount {...props} wide={wide} settingsOpen={false}
      openSettings={actions.openSettings} openOnboarding={actions.openOnboarding} />
    : <EnterprisePage {...props} />
  const rendered = render(view(true))
  return { state, form, actions, resize: (wide: boolean) => { rendered.rerender(view(wide)) } }
}

describe('enterprise page', () => {
  it('opens enterprise sign-in directly from the sidebar while retaining settings access', () => {
    const { actions } = page({}, false, true)
    expect(screen.getAllByRole('button').map(button => button.getAttribute('aria-label'))).toMatchInlineSnapshot(`
      [
        "Enterprise sign-in",
        "Settings",
      ]
    `)
    fireEvent.click(screen.getByRole('button', { name: en.signIn }))
    expect(screen.getByRole('dialog', { name: en.signIn })).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: en.sso }))
    expect(actions.startSso).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: en.close }))
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: en.settings }))
    expect(actions.openSettings).toHaveBeenCalledOnce()
  })

  it('keeps the account trigger mounted when the sidebar collapses', () => {
    const { resize } = page({}, false, true)
    const trigger = screen.getByRole('button', { name: en.signIn })
    trigger.focus()
    resize(false)
    expect(screen.getByRole('button', { name: en.signIn })).toBe(trigger)
    expect(document.activeElement).toBe(trigger)
    fireEvent.click(trigger)
    expect(screen.getByRole('dialog', { name: en.signIn })).toBeDefined()
  })

  it('shows the signed-in member in the sidebar and exposes sign-out in the account dialog', () => {
    const { actions } = page({ connection: {
      origin: 'http://enterprise.test', status: 'connected',
      member: { id: 'member-a' as EnterpriseMemberId, name: 'Enterprise member', department: 'Engineering', seat: 'developer' },
      projects: [], quota: null, modelCount: 3, error: null, signIn: null,
    } }, false, true)
    fireEvent.click(screen.getByRole('button', { name: 'Enterprise member' }))
    expect(screen.getByRole('dialog', { name: en.title })).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: en.signOut }))
    expect(actions.signOut).toHaveBeenCalledOnce()
  })

  it('requires saving an endpoint draft before initiating either login flow', () => {
    const { actions } = page({}, true)
    expect(screen.getByRole('button', { name: en.sso })).toHaveProperty('disabled', true)
    fireEvent.change(screen.getByLabelText(en.origin), { target: { value: 'http://new-enterprise.test' } })
    fireEvent.click(screen.getByRole('button', { name: en.save }))
    expect(actions.edit).toHaveBeenCalledWith('origin', 'http://new-enterprise.test')
    expect(actions.save).toHaveBeenCalledOnce()
  })

  it('clears a member code from the form when submitting and never treats it as a saved setting', () => {
    const { actions } = page()
    const input = screen.getByLabelText(en.code)
    fireEvent.change(input, { target: { value: ' member-code ' } })
    fireEvent.click(screen.getByRole('button', { name: en.connect }))
    expect(actions.signInCode).toHaveBeenCalledWith('member-code')
    expect(input).toHaveProperty('value', '')
    expect(actions.save).not.toHaveBeenCalled()
  })

  it('retains a manual login link and cancellation while browser approval is pending', () => {
    const id = 'attempt' as EnterpriseSignInId
    const verificationUrl = 'https://enterprise.test/api/enterprise-client/sso/start?device=public-ticket'
    const { actions } = page({ connection: {
      origin: 'https://enterprise.test', status: 'signed-out', member: null, projects: [], quota: null,
      modelCount: 0, error: null, signIn: { id, status: 'pending', verificationUrl },
    } })
    expect(screen.getByRole('link', { name: en.openBrowser })).toHaveProperty('href', verificationUrl)
    expect(screen.getByRole('button', { name: en.sso })).toHaveProperty('disabled', true)
    fireEvent.click(screen.getByRole('button', { name: en.cancel }))
    expect(actions.cancelSignIn).toHaveBeenCalledExactlyOnceWith(id)
  })

  it('preserves usage details while displaying a persistent delivery failure', () => {
    const { actions } = page({ delivery: { pending: 2, collection: 'disabled', waitingForMember: true, lastDeliveryAt: null, error: 'unavailable', failedToPersist: 0 } })
    expect(screen.getByText(en.collectionDisabled)).toBeDefined()
    expect(screen.getByText(en.waitingForMember)).toBeDefined()
    expect(screen.getByText(en.serviceUnavailable)).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: en.retryDelivery }))
    expect(actions.flush).toHaveBeenCalledOnce()
  })

  it('reports Host transport loss without hiding the configured address', () => {
    page({ transportFailed: true })
    expect(screen.getByText(en.transportFailed)).toBeDefined()
    expect(screen.getByLabelText(en.origin)).toHaveProperty('value', 'http://enterprise.test')
  })

  it('has localized corrective messages for invalid credentials and unavailable storage', () => {
    expect(zh[errorKey('invalid-credential')]).toContain('重新登录')
    expect(zh[errorKey('storage')]).toContain('本地存储')
  })
})
