/** Enterprise sign-in, authorized resources, and durable delivery status. */
import { useState } from 'react'
import { Button, Input, SettingsForm, SettingsValueField, StateDot, Toast } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type { EnterpriseNotice, EnterprisePageFace } from './controller.ts'
import { errorKey, formLabels } from './locales.ts'
import css from './EnterprisePage.module.css'

/** Shared account fields in the sidebar dialog and settings page. */
export type EnterpriseContentProps = PropsLocale<'unionpay'> & InjectFace<EnterprisePageFace>

/** Props bound to the enterprise account settings section. */
export type EnterprisePageProps = PropsRuntime<'settings.section'> & EnterpriseContentProps

/**
 * Render the enterprise account settings section.
 * @param props - configuration drafts, Host views, and narrow actions.
 * @returns the member connection and delivery controls.
 */
export function EnterprisePage(props: EnterprisePageProps) {
  return <EnterpriseContent {...props} />
}

/**
 * Render the enterprise connection and delivery state.
 * @param props - configuration drafts, Host views, and narrow actions.
 * @returns the member connection and delivery controls.
 */
export function EnterpriseContent(props: EnterpriseContentProps) {
  const { t } = props
  const form = props.useEnterpriseForm(value => value)
  const state = props.useEnterprise(value => value)
  const [code, setCode] = useState('')
  const connection = state.connection
  const delivery = state.delivery
  const attempt = connection?.signIn
  const pending = attempt?.status === 'pending'
  const disabled = state.busy || pending || form.dirty || !connection?.origin
  const failure = connection?.signIn?.error ?? connection?.error
  return (
    <section className={css.section}>
      <SettingsForm labels={formLabels(t)} state={form} onSave={props.save} onDiscard={props.discard}>
        <SettingsValueField id="unionpay-origin" label={t('origin')} hint={t('originHint')}
          overriddenLabel={t('overridden')} resetLabel={t('reset')} invalidLabel={t('invalidOrigin')}
          disabled={!form.writable || state.busy || pending} {...form.origin}
          onEdit={(text) =>{  props.edit('origin', text) }} onReset={() =>{  props.resetField('origin') }} />
      </SettingsForm>
      {connection === null
        ? <div className={css.loading} aria-label={t('loading')}><StateDot state="ongoing" /></div>
        : <div className={css.card}>
          <div className={css.row}>
            <div className={css.identity}>
              <strong>{connection.member?.name ?? t('notSignedIn')}</strong>
              <span className={css.secondary}>{connection.member?.department ?? t('memberOnly')}</span>
            </div>
            <Button size="sm" variant="ghost" disabled={state.busy} onClick={props.refresh}>{t('refresh')}</Button>
          </div>
          {state.transportFailed && <p role="alert">{t('transportFailed')}</p>}
          {failure && <p role="alert">{t(errorKey(failure))}</p>}
          {connection.member === null
            ? <div className={css.signIn}>
              <Button disabled={disabled} onClick={props.startSso}>{t('sso')}</Button>
              <form className={css.code} onSubmit={(event) => {
                event.preventDefault()
                const entered = code.trim()
                setCode('')
                void props.signInCode(entered)
              }}>
                <Input type="password" autoComplete="off" spellCheck={false} aria-label={t('code')}
                  placeholder={t('code')} value={code} disabled={disabled} onChange={(event) =>{  setCode(event.target.value) }} />
                <Button type="submit" variant="outline" disabled={disabled || code.trim().length === 0}>{t('connect')}</Button>
              </form>
            </div>
            : <>
              <dl className={css.facts}>
                <dt>{t('models')}</dt><dd>{connection.modelCount}</dd>
                <dt>{t('projects')}</dt><dd>{connection.projects.length ? connection.projects.map(project => project.name).join(' · ') : t('none')}</dd>
                <dt>{t('monthUsage')}</dt><dd>{connection.quota?.totalTokens ?? t('unknown')}</dd>
                <dt>{t('requests')}</dt><dd>{connection.quota?.requests ?? t('unknown')}</dd>
              </dl>
              <div className={css.actions}>
                <a href={connection.origin + '/workbench'} target="_blank" rel="noreferrer">{t('workbench')}</a>
                <Button size="sm" variant="outline" disabled={state.busy} onClick={props.signOut}>{t('signOut')}</Button>
              </div>
            </>}
          {attempt?.status === 'pending' && <div className={css.pending} role="status">
            <span>{t(attempt.verificationUrl ? 'awaitingBrowser' : 'signingIn')}</span>
            {attempt.verificationUrl && <a href={attempt.verificationUrl} target="_blank" rel="noreferrer">{t('openBrowser')}</a>}
            <Button size="sm" variant="ghost" onClick={() =>{  props.cancelSignIn(attempt.id) }}>{t('cancel')}</Button>
          </div>}
        </div>}
      {delivery && <div className={css.card}>
        <div className={css.row}><strong>{t('usageDelivery')}</strong><Button size="sm" variant="ghost" disabled={state.busy} onClick={props.flush}>{t('retryDelivery')}</Button></div>
        <dl className={css.facts}><dt>{t('pending')}</dt><dd>{delivery.pending}</dd><dt>{t('failedToPersist')}</dt><dd>{delivery.failedToPersist}</dd></dl>
        {delivery.collection === 'disabled' && <p role="status">{t('collectionDisabled')}</p>}
        {delivery.waitingForMember && <p role="status">{t('waitingForMember')}</p>}
        {delivery.error && <p role="alert">{t(errorKey(delivery.error))}</p>}
        <p className={css.secondary}>{t('privacy')}</p>
      </div>}
    </section>
  )
}

/** Overlay injection keeps feedback alive after the settings page closes. */
export interface EnterpriseToastFace {
  hooks: { enterpriseNotice: SnapshotStore<EnterpriseNotice | null> }
  dismissNotice(id: number): void
}

/**
 * Display action feedback in the application overlay.
 * @param props - latest notice and localized copy.
 * @returns transient feedback in the shared app overlay.
 */
export function EnterpriseToast(props: PropsRuntime<'shell.overlay'> & PropsLocale<'unionpay'> & InjectFace<EnterpriseToastFace>) {
  const notice = props.useEnterpriseNotice(value => value)
  if (notice === null) return null
  return <Toast key={notice.id} text={props.t(notice.key)} {...notice.success ? { tone: 'success' as const } : {}} onDone={() =>{  props.dismissNotice(notice.id) }} />
}
