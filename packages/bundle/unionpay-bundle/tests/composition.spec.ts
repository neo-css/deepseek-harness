/** Enterprise distribution defaults composed from a fresh Web profile. */
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it, onTestFinished } from 'vitest'
import { composeEntries, initProfile, loadProfileDirectory, PROFILE_TEMPLATES } from '@deepseek-ai/dsh-app-boot'

type PluginEntry = ReturnType<typeof composeEntries>[number]

const bundleRoot = fileURLToPath(new URL('..', import.meta.url))
const installAnchor = fileURLToPath(new URL('../../../../apps/cli/package.json', import.meta.url))

it('disables external integrations in a fresh enterprise Web profile', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-enterprise-profile-'))
  onTestFinished(() => { rmSync(root, { recursive: true, force: true }) })
  const profileDir = join(root, 'web')
  initProfile(profileDir, PROFILE_TEMPLATES.web!.bundles)
  const scope = join(profileDir, 'node_modules/@deepseek-ai')
  mkdirSync(scope, { recursive: true })
  symlinkSync(bundleRoot, join(scope, 'dsh-unionpay-bundle'), 'junction')

  const profile = loadProfileDirectory('dsh', profileDir, installAnchor)
  expect(profile.skippedBundles).toEqual([])
  const warnings: string[] = []
  const rows = composeEntries(profile.layers.map(layer => layer.patches), warning => warnings.push(warning))
  expect(warnings).toEqual([])
  expect(profile.layers.map(layer => layer.packageName)).toEqual([
    '@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'dsh-ops', '@deepseek-ai/dsh-unionpay-bundle',
  ])
  for (const id of ['mode-minimal', 'mode-standard', 'mode-ptc', 'mode-cordis', 'discovery']) {
    expect(rows.find(row => row.id === `dsh-ops-${id}`), id).toBeDefined()
    expect(rows.find(row => row.id === `dsh-ops-${id}`)?.disabled, id).not.toBe(true)
  }
  for (const id of ['compat', 'panel', 'tui']) {
    expect(rows.find(row => row.id === `dsh-ops-${id}`), id).toMatchObject({ disabled: true })
  }
  expect(rows.find(row => row.id === 'ui-settings-models')?.config)
    .toEqual({ welcomeNotice: false, credentialOnboarding: false })
  expect(rows.find(row => row.id === 'ui-brand-official')).toMatchObject({ disabled: true })
  expect(rows.find(row => row.id === 'michengai-btw')).toMatchObject({ name: '@michengai/dsh-btw' })
  for (const id of [
    'plugin-package-inventory-deepseek', 'otel', 'desktop-product-telemetry', 'session-telemetry-otel', 'command-feedback',
    'message-feedback', 'ui-message-feedback', 'ui-settings-session-log',
    'web', 'web-search-deepseek', 'web-deepseek-api', 'web-fetch-http', 'tool-web', 'llm-deepseek',
    'ui-settings-account', 'account-controller', 'deepseek-account', 'llm-deepseek-account', 'session-log-deepseek',
  ]) {
    expect(rows.find(row => row.id === id), id).toMatchObject({ disabled: true })
  }
  for (const id of ['dsh-context', 'michengai-btw', 'unionpay-connection', 'llm-unionpay', 'unionpay-usage', 'ui-unionpay']) {
    expect(rows.find(row => row.id === id), id).toMatchObject({ id })
    expect(rows.find(row => row.id === id)?.disabled, id).not.toBe(true)
  }

  const upstream = composeEntries(profile.layers.slice(0, -1).map(layer => layer.patches))
  for (const id of ['standard', 'ptc', 'cordis', 'minimal']) {
    const original = upstream.find(row => row.id === `preset-${id}`)!
    const expected = structuredClone(original.config) as { plugins: PluginEntry[] }
    const web = expected.plugins.find(row => row.id === 'tool-web')
    if (web !== undefined) web.disabled = true
    expect(rows.find(row => row.id === original.id)?.config, id).toEqual(expected)
  }
  expect(rows.find(row => row.id === 'unionpay-connection')?.config).toEqual({ origin: '' })
  expect(profile.patches).toEqual([])
})
