/** Native startup validates the Models plugin's cross-process onboarding policy. */
import { expect, it } from 'vitest'
import { credentialOnboardingEnabled } from '../src/welcome-api.ts'

function policy(value: unknown) {
  return { kind: 'global', name: '__DSH_MODELS_ONBOARDING__', value }
}

it.each([false, true])('honors the published credential onboarding choice: %s', (enabled) => {
  expect(credentialOnboardingEnabled([policy({ credentialOnboarding: enabled, welcomeNotice: false })])).toBe(enabled)
})

it('retains the native entry when no plugin publishes an onboarding policy', () => {
  expect(credentialOnboardingEnabled([{ kind: 'html', placement: 'head', html: '' }])).toBe(true)
})

it.each([null, {}, { credentialOnboarding: 'false' }])('rejects malformed Host policy: %j', (value) => {
  expect(() => credentialOnboardingEnabled([policy(value)]))
    .toThrow('invalid credential onboarding policy')
})

it('rejects conflicting policy publishers', () => {
  const entry = policy({ credentialOnboarding: false })
  expect(() => credentialOnboardingEnabled([entry, entry])).toThrow('invalid credential onboarding policy')
})
