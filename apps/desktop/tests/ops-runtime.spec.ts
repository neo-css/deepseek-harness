/** OPS metadata follows signed worker bytes before Desktop seals its inventory. */
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, onTestFinished } from 'vitest'
import { OPS_RUNTIME_METADATA_FILE, refreshOpsWorkerHashes } from '../scripts/ops-runtime.ts'
import { runtimeFixture } from './runtime-fixture.ts'

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'desktop-ops-metadata-'))
  onTestFinished(() => { rmSync(root, { recursive: true, force: true }) })
  runtimeFixture(root)
  const directory = join(root, 'node_modules/dsh-ops/runtime/darwin-arm64')
  return { root, worker: join(directory, 'dsh-ops-worker'), metadata: join(directory, OPS_RUNTIME_METADATA_FILE) }
}

it('updates the worker checksum after signing and preserves other metadata', () => {
  const f = fixture()
  const before = JSON.parse(readFileSync(f.metadata, 'utf8')) as Record<string, unknown>
  writeFileSync(f.worker, 'signed OPS worker')
  refreshOpsWorkerHashes(f.root)
  const expected = { ...before, sha256: createHash('sha256').update('signed OPS worker').digest('hex') }
  expect(expected.sha256).not.toBe(before.sha256)
  expect(JSON.parse(readFileSync(f.metadata, 'utf8'))).toEqual(expected)
  const sealed = readFileSync(f.metadata, 'utf8')
  refreshOpsWorkerHashes(f.root)
  expect(readFileSync(f.metadata, 'utf8')).toBe(sealed)
})

it('rejects mismatched metadata and missing workers before replacing the checksum', () => {
  const f = fixture()
  const original = readFileSync(f.metadata, 'utf8')
  const receipt = JSON.parse(original) as Record<string, unknown>
  writeFileSync(f.metadata, JSON.stringify({ ...receipt, executable: '../other-worker' }))
  expect(() => { refreshOpsWorkerHashes(f.root) }).toThrow('metadata mismatch')
  writeFileSync(f.metadata, original)
  rmSync(f.worker)
  expect(() => { refreshOpsWorkerHashes(f.root) }).toThrow('ENOENT')
  expect(readFileSync(f.metadata, 'utf8')).toBe(original)
})
