/** Bounded, origin-pinned enterprise requests. Response bodies never become error messages. */
import type { z } from 'zod'
import type { EnterpriseFailureCode } from './types.ts'

/** Sanitized failure shared by Host consumers and UI projections. */
export class EnterpriseError extends Error {
  /**
   * @param code - stable handling identity.
   */
  constructor(readonly code: EnterpriseFailureCode) { super(`UnionPay enterprise operation failed: ${code}`) }
}

/** Request bounds configured by the owning connection. */
export interface TransportLimits {
  readonly requestTimeoutMs: number
  readonly maxResponseBytes: number
}

/** HTTP result with headers needed only by the Host's session exchange. */
export interface EnterpriseResponse {
  readonly status: number
  readonly value: unknown
  readonly cookie: string | null
}

/**
 * Fetch one fixed enterprise endpoint; redirects and oversized responses fail closed.
 * @param origin - validated enterprise origin.
 * @param path - plugin-owned absolute API path.
 * @param init - method, authentication headers, and optional JSON body.
 * @param limits - complete-response and request limits.
 * @param signal - operation lifetime.
 * @returns decoded JSON and the session cookie header.
 */
export async function enterpriseRequest(
  origin: string, path: string, init: { method?: string; headers?: Record<string, string>; body?: string },
  limits: TransportLimits, signal: AbortSignal,
): Promise<EnterpriseResponse> {
  const timeout = AbortSignal.timeout(limits.requestTimeoutMs)
  const requestSignal = AbortSignal.any([signal, timeout])
  try {
    const response = await fetch(origin + '/api/enterprise-client' + path, {
      ...init, redirect: 'error', signal: requestSignal,
      headers: { Origin: origin, Accept: 'application/json', 'Content-Type': 'application/json', ...init.headers },
    })
    if (!response.ok) {
      await response.body?.cancel()
      throw new EnterpriseError(response.status === 401 ? 'unauthorized'
        : response.status === 403 ? 'forbidden' : response.status === 409 ? 'conflict'
          : response.status === 429 ? 'rate-limited' : response.status === 400 ? 'invalid-input' : 'unavailable')
    }
    const reader = response.body?.getReader()
    if (reader === undefined) throw new EnterpriseError('invalid-response')
    const chunks: Uint8Array[] = []
    let length = 0
    try {
      for (;;) {
        const next = await reader.read()
        if (next.done) break
        length += next.value.byteLength
        if (length > limits.maxResponseBytes) throw new EnterpriseError('invalid-response')
        chunks.push(next.value)
      }
    } finally {
      await reader.cancel()
    }
    let value: unknown
    try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')) }
    catch (_error) { throw new EnterpriseError('invalid-response') }
    return { status: response.status, value, cookie: response.headers.get('set-cookie')?.split(';')[0] ?? null }
  } catch (error) {
    if (error instanceof EnterpriseError) throw error
    throw new EnterpriseError(signal.aborted ? 'cancelled' : timeout.aborted ? 'timeout' : 'unavailable')
  }
}

/**
 * Validate received JSON without including untrusted values in diagnostics.
 * @param schema - expected response fields.
 * @param value - external JSON or a stored credential payload.
 * @returns validated fields.
 */
export function decode<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value)
  if (!parsed.success) throw new EnterpriseError('invalid-response')
  return parsed.data
}

/**
 * Reduce an unexpected failure to the display-safe transport category.
 * @param error - caught operation failure.
 * @returns an existing structured category or unavailable.
 */
export function failureCode(error: unknown): EnterpriseFailureCode {
  return error instanceof EnterpriseError ? error.code : 'unavailable'
}
