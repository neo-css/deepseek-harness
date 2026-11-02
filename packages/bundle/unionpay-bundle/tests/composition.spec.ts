/** Enterprise distribution defaults composed from fresh Web and Desktop profiles. */
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it, onTestFinished } from 'vitest'
import { composeEntries, initProfile, loadProfileDirectory, PROFILE_TEMPLATES } from '@deepseek-ai/dsh-app-boot'

type PluginEntry = ReturnType<typeof composeEntries>[number]

const bundleRoot = fileURLToPath(new URL('..', import.meta.url))
const installAnchor = fileURLToPath(new URL('../../../../apps/cli/package.json', import.meta.url))

it.each(['web', 'desktop'])('disables external integrations in a fresh enterprise %s profile', (name) => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-enterprise-profile-'))
  onTestFinished(() => { rmSync(root, { recursive: true, force: true }) })
  const profileDir = join(root, name)
  initProfile(profileDir, [...PROFILE_TEMPLATES.web!.bundles, '@deepseek-ai/dsh-unionpay-bundle'])
  const scope = join(profileDir, 'node_modules/@deepseek-ai')
  mkdirSync(scope, { recursive: true })
  symlinkSync(bundleRoot, join(scope, 'dsh-unionpay-bundle'), 'junction')

  const profile = loadProfileDirectory('dsh', profileDir, installAnchor)
  expect(profile.skippedBundles).toEqual([])
  const warnings: string[] = []
  const rows = composeEntries(profile.layers.map(layer => layer.patches), warning => warnings.push(warning))
  expect(warnings).toEqual([])
  expect(rows.find(row => row.id === 'ui-settings-models')?.config)
    .toEqual({ welcomeNotice: false, credentialOnboarding: false })
  expect(rows.find(row => row.id === 'ui-brand-official')).toMatchObject({ disabled: true })
  for (const id of [
    'plugin-package-inventory-deepseek', 'otel', 'session-telemetry-otel', 'command-feedback',
    'web', 'web-search-deepseek', 'web-deepseek-api', 'web-fetch-http', 'tool-web', 'llm-deepseek',
  ]) {
    expect(rows.find(row => row.id === id), id).toMatchObject({ disabled: true })
  }
  for (const id of ['unionpay-connection', 'llm-unionpay', 'unionpay-usage', 'ui-unionpay']) {
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
