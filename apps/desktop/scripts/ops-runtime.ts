/** Keep OPS worker checksums aligned with the signed Desktop payload. */
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'

/** Filename fixed by the published OPS worker and Bash IPC format. */
export const OPS_RUNTIME_METADATA_FILE = 'provenance.json'

const receiptSchema = z.object({
  version: z.string(), target: z.string(), executable: z.string(), sha256: z.string().regex(/^[a-f0-9]{64}$/u),
}).passthrough()
const ipcSchema = z.object({
  version: z.literal(1), platform: z.literal('win32-x64'), msysSha256: z.string(),
  files: z.object({ 'opsipc.dll': z.string(), 'opsnt.dll': z.string() }).passthrough(),
}).passthrough()

function checksum(file: string): string {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

/**
 * Update retained OPS worker metadata after signing and before integrity sealing.
 * @param root - Materialized Desktop runtime containing dsh-ops.
 * @throws If worker metadata is malformed, references another target/version, or lacks its executable.
 */
export function refreshOpsWorkerHashes(root: string): void {
  const packageRoot = join(root, 'node_modules/dsh-ops')
  const { version } = z.object({ version: z.string() }).parse(JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')))
  const runtime = join(packageRoot, 'runtime')
  for (const entry of readdirSync(runtime, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^(?:darwin-(?:arm64|x64)|linux-x64|win32-x64)$/u.test(entry.name)) {
      throw new Error(`desktop OPS: unexpected runtime entry ${entry.name}`)
    }
    const directory = join(runtime, entry.name)
    const file = join(directory, OPS_RUNTIME_METADATA_FILE)
    const receipt = receiptSchema.parse(JSON.parse(readFileSync(file, 'utf8')))
    const executable = entry.name.startsWith('win32-') ? 'dsh-ops-worker.exe' : 'dsh-ops-worker'
    if (receipt.target !== entry.name || receipt.version !== version || receipt.executable !== executable) {
      throw new Error(`desktop OPS: worker metadata mismatch for ${entry.name}`)
    }
    receipt.sha256 = checksum(join(directory, executable))
    writeFileSync(file, `${JSON.stringify(receipt, undefined, 2)}\n`)
    if (entry.name === 'win32-x64') {
      const proxies = join(directory, 'bash-ipc')
      const metadata = join(proxies, OPS_RUNTIME_METADATA_FILE)
      const ipc = ipcSchema.parse(JSON.parse(readFileSync(metadata, 'utf8')))
      ipc.msysSha256 = checksum(join(root, 'node_modules/@dsh-ops/bash-win32-x64/usr/bin/msys-2.0.dll'))
      for (const name of ['opsipc.dll', 'opsnt.dll'] as const) ipc.files[name] = checksum(join(proxies, name))
      writeFileSync(metadata, `${JSON.stringify(ipc, undefined, 2)}\n`)
    }
  }
}
