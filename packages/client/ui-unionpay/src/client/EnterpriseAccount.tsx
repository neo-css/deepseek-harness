/** Direct enterprise sign-in entry in the sidebar account position. */
import { useState } from 'react'
import clsx from 'clsx'
import { IconSettingsOutlineMedium, IconUserOutlineMedium, Modal, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { EnterpriseContent, type EnterpriseContentProps } from './EnterprisePage.tsx'
import css from './EnterpriseAccount.module.css'

/** Sidebar geometry and navigation with the shared enterprise account view. */
export type EnterpriseAccountProps = PropsRuntime<'settings.launcher'> & EnterpriseContentProps

/**
 * Open enterprise sign-in directly, retaining a separate settings action.
 * @param props - sidebar geometry, Host account view, and account actions.
 * @returns the account launcher and its dismissible dialog.
 */
export function EnterpriseAccount(props: EnterpriseAccountProps) {
  const { t, wide, openSettings, settingsShortcut } = props
  const member = props.useEnterprise(state => state.connection?.member)
  const [open, setOpen] = useState(false)
  const label = member?.name ?? t('signIn')
  return <div className={css.launcher} data-collapsed={!wide}>
    <Tooltip label={label} side="top" portal disabled={open || wide}>
      <button type="button" className={css.account} aria-label={label} aria-haspopup="dialog"
        aria-expanded={open} onClick={() => { setOpen(true) }}>
        <IconUserOutlineMedium size={18} />
        {wide && <span className={css.label}>{label}</span>}
      </button>
    </Tooltip>
    <Tooltip label={t('settings')} shortcutKeys={settingsShortcut?.keys} side="top" portal>
      <button type="button" className={css.settings} aria-label={t('settings')}
        aria-keyshortcuts={settingsShortcut?.aria} onClick={openSettings}>
        <IconSettingsOutlineMedium size={18} />
      </button>
    </Tooltip>
    {open && <Modal open title={member ? t('title') : t('signIn')} closeLabel={t('close')}
      onClose={() => { setOpen(false) }} className={clsx(css.dialog)} contentClassName={clsx(css.content)}>
      <EnterpriseContent {...props} />
    </Modal>}
  </div>
}
