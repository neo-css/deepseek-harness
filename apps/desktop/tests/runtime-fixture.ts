/** Temporary materialized packages for Desktop resource and profile behavior tests. */

import { mkdirSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { DESKTOP_HOST_RUNTIME_FILES } from '../src/core-package-set.ts'
import { DESKTOP_HOST_PROTOCOL_VERSION } from '../src/host-protocol.ts'
import { writeDesktopRuntime, type DesktopRuntimeDescriptor } from '../src/runtime-tree.ts'
import { OPS_RUNTIME_METADATA_FILE } from '../scripts/ops-runtime.ts'

/**
 * Write a package fixture with explicit runtime exports.
 * @param modules - Owning node_modules directory.
 * @param name - Package name.
 * @param fields - Manifest fields.
 * @param source - ESM entry contents.
 * @returns Installed package directory.
 */
export function writePackage(modules: string, name: string, fields: Record<string, unknown> = {}, source = 'export const identity = {}\n'): string {
  const path = join(modules, name)
  mkdirSync(path, { recursive: true })
  writeFileSync(join(path, 'package.json'), JSON.stringify({ name, version: '1.0.0', type: 'module', exports: './index.js', ...fields }))
  writeFileSync(join(path, 'index.js'), source)
  return path
}

/**
 * Seal a minimal release containing Host entry files and a shared Cordis package.
 * @param root - New runtime directory.
 * @param version - Shell and dsh version.
 * @param nodeVersion - Bundled Node version recorded in resource metadata.
 * @returns Sealed runtime metadata.
 */
export function runtimeFixture(root: string, version = '1.0.0', nodeVersion = '24.17.0'): DesktopRuntimeDescriptor {
  const names = [
    '@deepseek-ai/dsh', '@deepseek-ai/dsh-desktop-host', '@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app',
    '@deepseek-ai/cordis', '@deepseek-ai/dsh-unionpay-bundle', 'dsh-ops',
  ]
  for (const name of names) {
    const bundle = name === '@deepseek-ai/dsh-base' || name === '@deepseek-ai/dsh-web-app'
      || name === '@deepseek-ai/dsh-unionpay-bundle' || name === 'dsh-ops'
    const path = writePackage(join(root, 'node_modules'), name, {
      version,
      ...(name === '@deepseek-ai/dsh' ? { dependencies: Object.fromEntries(names.slice(1).map(dependency => [dependency, version])) } : {}),
      ...(bundle ? { dsh: { bundle: { patch: './bundle.yml' } } } : {}),
    })
    if (bundle) writeFileSync(join(path, 'bundle.yml'), '[]\n')
    if (name === 'dsh-ops') {
      const directory = join(path, 'runtime/darwin-arm64')
      mkdirSync(directory, { recursive: true })
      writeFileSync(join(directory, 'dsh-ops-worker'), 'OPS worker fixture')
      writeFileSync(join(directory, OPS_RUNTIME_METADATA_FILE), JSON.stringify({
        version, target: 'darwin-arm64', executable: 'dsh-ops-worker',
        sha256: createHash('sha256').update('OPS worker fixture').digest('hex'),
      }))
    }
  }
  for (const file of DESKTOP_HOST_RUNTIME_FILES) {
    const path = join(root, 'node_modules', '@deepseek-ai/dsh-desktop-host', file)
    mkdirSync(join(path, '..'), { recursive: true })
    writeFileSync(path, '')
  }
  writeFileSync(join(root, 'package.json'), '{"type":"module"}\n')
  return writeDesktopRuntime(root, { schemaVersion: 1, version, nodeVersion, pnpmVersion: '11.7.0', hostProtocolVersion: DESKTOP_HOST_PROTOCOL_VERSION }, names)
}
