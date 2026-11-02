/** Tool catalog discovery separates package manifests from deleted-workspace build residue. */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, onTestFinished } from 'vitest'
import { assertManifestComplete, type ToolPackage } from './gen-tool-catalog.ts'

it('accepts build residue and still requires every tool package in the manifest', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-tool-catalog-'))
  onTestFinished(() => { rmSync(root, { recursive: true, force: true }) })
  const entry: ToolPackage = {
    pkg: '@deepseek-ai/dsh-tool-new', dir: 'tool-new', source: 'packages/core/tool-new/src/index.ts',
    requires: [], writes: [], mount: () => Promise.resolve(),
  }
  expect(() => { assertManifestComplete([entry], root) }).toThrow('no tool package manifests')
  mkdirSync(join(root, 'packages/core/tool-retired/lib'), { recursive: true })
  mkdirSync(join(root, 'packages/core/tool-retired/node_modules'), { recursive: true })
  expect(() => { assertManifestComplete([], root) }).not.toThrow()

  const directory = join(root, 'packages/core/tool-new')
  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-tool-new' }))
  expect(() => { assertManifestComplete([], root) }).toThrow('tool-new')
  expect(() => { assertManifestComplete([entry], root) }).not.toThrow()
})
