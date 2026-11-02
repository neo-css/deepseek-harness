/** Enterprise account entry, settings page, and feedback through existing UI slots. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import connectionRemote from '@deepseek-ai/dsh-unionpay-connection/remote'
import usageRemote from '@deepseek-ai/dsh-unionpay-usage/remote'
import { EnterprisePageController } from './controller.ts'
import { EnterprisePage, EnterpriseToast } from './EnterprisePage.tsx'
import { EnterpriseAccount } from './EnterpriseAccount.tsx'
import { EnterpriseBrand } from './EnterpriseBrand.tsx'
import { en, zh, type LocaleKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { unionpay: LocaleKey }
}

export const inject = ['slots', 'locale', 'configForms', 'remote']

function registerUi(ctx: Context): void {
  ctx.effect(() => ctx.locale.register('unionpay', { en, zh }), 'unionpay: page dictionaries')
  const t = ctx.locale.bind('unionpay')
  ctx.slots.inject('sidebar.brand.name', () => ctx.slots.register({
    name: 'sidebar.brand.name', locale: 'unionpay',
  }, EnterpriseBrand))
  const controller = new EnterprisePageController(ctx, ctx.configForms.get('unionpay-connection'))
  ctx.effect(() => () => controller.dispose(), 'unionpay: page observations')
  ctx.effect(() => ctx.configForms.whileServed(['unionpay-connection'], () => ctx.effect(function* () {
    yield ctx.slots.inject('settings.launcher', () => ctx.slots.register({
      name: 'settings.launcher', locale: 'unionpay', inject: () => controller.face(),
    }, EnterpriseAccount))
    yield ctx.slots.inject('settings.section', () => ctx.slots.register({
      name: 'settings.section', id: 'unionpay', order: -10, label: () => t('title'),
      locale: 'unionpay', inject: () => controller.face(),
    }, EnterprisePage))
  })), 'unionpay: enterprise account')
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay', id: 'unionpay-notice', locale: 'unionpay',
    inject: () => ({ hooks: { enterpriseNotice: controller.notice }, dismissNotice: (id: number) =>{  controller.dismissNotice(id) } }),
  }, EnterpriseToast))
}

/**
 * Mount enterprise Remote definitions and their UI together without changing the built-in API assembly.
 * @param ctx - client services owning configuration, transport, localization, and slots.
 * @returns disposer joining UI observers before withdrawing Remote definitions.
 */
export async function apply(ctx: Context): Promise<() => Promise<void>> {
  const disposeConnection = await ctx.remote.$mount(connectionRemote)
  let disposeUsage: () => Promise<void>
  try { disposeUsage = await ctx.remote.$mount(usageRemote) }
  catch (error) { await disposeConnection(); throw error }
  const ui = ctx.inject(['remote.unionpay', 'remote.unionpayUsage', 'slots', 'locale', 'configForms'], registerUi)
  try { await ui }
  catch (error) { await ui.dispose(); await disposeUsage(); await disposeConnection(); throw error }
  return async () => { await ui.dispose(); await disposeUsage(); await disposeConnection() }
}
