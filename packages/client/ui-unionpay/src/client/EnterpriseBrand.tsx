/** UPH sidebar identity. */
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { HeroBrandMarkOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import clsx from 'clsx'
import s from './EnterpriseBrand.module.css'

/**
 * Render the enterprise artwork at the size supplied by its brand slot.
 * @param props - mark dimensions and optional host presentation.
 * @returns the decorative enterprise mark.
 */
export function EnterpriseBrandMark({ size, className }: HeroBrandMarkOwnerProps) {
  return <span aria-hidden="true" className={clsx(s.mark, className)} style={{ width: size, height: size }} />
}

/**
 * Render the enterprise name without build metadata.
 * @param props - localized enterprise copy supplied by the brand slot.
 * @returns the sidebar name.
 */
export function EnterpriseBrand({ t }: PropsLocale<'unionpay'>) {
  return <span>{t('brand')}</span>
}
