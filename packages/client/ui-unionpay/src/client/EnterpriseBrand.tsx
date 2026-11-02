/** UPH sidebar name. */
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'

/**
 * Render the enterprise name without build metadata.
 * @param props - localized enterprise copy supplied by the brand slot.
 * @returns the sidebar name.
 */
export function EnterpriseBrand({ t }: PropsLocale<'unionpay'>) {
  return <span>{t('brand')}</span>
}
