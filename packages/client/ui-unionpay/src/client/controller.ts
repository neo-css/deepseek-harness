/** One Host-state observation per enterprise page plugin, independent of page mount lifetimes. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-gateway/client'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import { SettingsFormModel, settingsTextField, type SettingsFieldState, type SettingsFormActions, type SettingsFormScope, type SettingsFormShell } from '@deepseek-ai/dsh-client-ui-primitives'
import type { EnterpriseConnectionView, EnterpriseSignInId } from '@deepseek-ai/dsh-unionpay-connection/types'
import type { UsageDeliveryView } from '@deepseek-ai/dsh-unionpay-usage/types'
import type {} from '@deepseek-ai/dsh-unionpay-connection/remote'
import type {} from '@deepseek-ai/dsh-unionpay-usage/remote'
import type { LocaleKey } from './locales.ts'

/** Only the endpoint is edited on this page; delivery limits remain plugin configuration. */
export interface EnterpriseSettings { origin?: string }
/** Staged endpoint configuration. */
export interface EnterpriseFormState extends SettingsFormShell { origin: SettingsFieldState }
/** The two authoritative Host views plus local transport/action status. */
export interface EnterprisePageState {
  connection: EnterpriseConnectionView | null
  delivery: UsageDeliveryView | null
  transportFailed: boolean
  busy: boolean
}
/** Transient action feedback survives navigation away from the settings page. */
export interface EnterpriseNotice { id: number; key: LocaleKey; success: boolean }
/** Narrow callbacks and observables bound by the slot renderer. */
export interface EnterprisePageFace extends SettingsFormActions {
  hooks: { enterpriseForm: SnapshotStore<EnterpriseFormState>; enterprise: SnapshotStore<EnterprisePageState> }
  signInCode(code: string): Promise<boolean>
  startSso(): void
  cancelSignIn(id: EnterpriseSignInId): void
  signOut(): void
  refresh(): void
  flush(): void
}

/** Owns endpoint drafts and joined Remote observers; no credentials are cached in this controller. */
export class EnterprisePageController {
  private readonly form: SettingsFormModel<EnterpriseSettings>
  private readonly formState: SnapshotStore<EnterpriseFormState>
  private readonly state = createSnapshotStore<EnterprisePageState>({
    connection: null, delivery: null, transportFailed: false, busy: false,
  })
  /** Latest action feedback, independent of page mount lifetime. */
  readonly notice = createSnapshotStore<EnterpriseNotice | null>(null)
  private readonly closeStreams: Array<() => Promise<void>> = []
  private sequence = 0
  private closed = false

  /**
   * @param ctx - generated enterprise Remote services.
   * @param scope - connection plugin's configuration form.
   */
  constructor(private readonly ctx: Context, scope: SettingsFormScope<EnterpriseSettings>) {
    this.form = new SettingsFormModel(scope, [settingsTextField('origin')])
    this.formState = this.form.bind(() => ({ ...this.form.shell(), origin: this.form.field('origin') }))
    const fail = (): void => { this.state.set({ ...this.state.getSnapshot(), transportFailed: true }) }
    const connection = ctx.remote.$stream<EnterpriseConnectionView>({
      name: 'Enterprise connection', open: signal => ctx.remote.unionpay.follow(signal),
      ended: () => new Error('Enterprise connection stream ended'), carrierFailed: fail,
    })
    const delivery = ctx.remote.$stream<UsageDeliveryView>({
      name: 'Enterprise usage delivery', open: signal => ctx.remote.unionpayUsage.follow(signal),
      ended: () => new Error('Enterprise usage stream ended'), carrierFailed: fail,
    })
    const observeConnection = (async () => {
      try {
        for await (const item of connection) {
          const previous = this.state.getSnapshot()
          this.state.set({ ...previous, connection: item.value, transportFailed: false })
          if (previous.connection?.signIn?.status === 'pending' && item.value.signIn?.status === 'failed') this.show('signInFailed', false)
          if (previous.connection?.signIn?.status === 'pending' && item.value.signIn === null && item.value.status === 'connected') this.show('signedIn', true)
          item.accept()
        }
      } catch (_error) { if (!this.closed) fail() }
    })()
    const observeDelivery = (async () => {
      try {
        for await (const item of delivery) {
          this.state.set({ ...this.state.getSnapshot(), delivery: item.value })
          item.accept()
        }
      } catch (_error) { if (!this.closed) fail() }
    })()
    this.closeStreams.push(
      async () => { await connection.dispose(); await observeConnection },
      async () => { await delivery.dispose(); await observeDelivery },
    )
  }

  private show(key: LocaleKey, success: boolean): void { this.notice.set({ id: ++this.sequence, key, success }) }

  private async action(run: () => Promise<boolean>, success: LocaleKey | null): Promise<boolean> {
    if (this.state.getSnapshot().busy) return false
    this.state.set({ ...this.state.getSnapshot(), busy: true })
    try {
      const ok = await run()
      if (!ok) this.show('operationFailed', false)
      else if (success !== null) this.show(success, true)
      return ok
    } catch (_error) { this.show('operationFailed', false); return false }
    finally { this.state.set({ ...this.state.getSnapshot(), busy: false }) }
  }

  /**
   * Bind the page's callbacks and observations.
   * @returns data and actions; injected hooks own subscription lifetimes.
   */
  face(): EnterprisePageFace {
    return {
      ...this.form.actions(), hooks: { enterpriseForm: this.formState, enterprise: this.state },
      signInCode: code => this.action(async () => {
        const result = await this.ctx.remote.unionpay.signInCode(code)
        return result.ok && result.value.status === 'connected' && result.value.signIn === null
      }, null),
      startSso: () => { void this.action(async () => { const result = await this.ctx.remote.unionpay.startSso(); return result.ok && result.value.signIn?.status === 'pending' }, null) },
      cancelSignIn: (id) => { void this.action(async () => (await this.ctx.remote.unionpay.cancelSignIn(id)).ok, null) },
      signOut: () => { void this.action(async () => { const result = await this.ctx.remote.unionpay.signOut(); return result.ok && result.value.error === null }, 'signedOutNotice') },
      refresh: () => { void this.action(async () => { const result = await this.ctx.remote.unionpay.refresh(); return result.ok && result.value.error === null }, 'refreshed') },
      flush: () => { void this.action(async () => { const result = await this.ctx.remote.unionpayUsage.flush(); return result.ok && result.value.error === null }, 'deliveryChecked') },
    }
  }

  /**
   * Dismiss only the displayed notice.
   * @param id - notice shown by the overlay; newer feedback is preserved.
   */
  dismissNotice(id: number): void { if (this.notice.getSnapshot()?.id === id) this.notice.set(null) }

  /** Stop and join Remote streams before releasing staged form subscriptions. */
  async dispose(): Promise<void> {
    this.closed = true
    await Promise.all(this.closeStreams.map(close => close()))
    this.form.dispose()
  }
}
