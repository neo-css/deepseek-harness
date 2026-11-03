/** Public page-bootstrap options shared by the Host and Client halves. */

import z from '@deepseek-ai/schemastery'

/** Model settings and onboarding options after schema defaults are applied. */
export interface Config {
  /** Show the browser preview notice before entering a new workspace. */
  welcomeNotice: boolean
  /** Offer automatic account and API-key onboarding in Web and Desktop. */
  credentialOnboarding: boolean
}

/** Validate Host configuration and its public page-bootstrap payload. */
export const Config: z<Partial<Config>, Config> = z.object({
  welcomeNotice: z.boolean().default(true),
  credentialOnboarding: z.boolean().default(true),
})

/** Page-global key carrying public model settings and onboarding options. */
export const ONBOARDING_CONFIG_GLOBAL = '__DSH_MODELS_ONBOARDING__'
