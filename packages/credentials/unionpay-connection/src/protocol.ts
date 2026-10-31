/** Validates enterprise HTTP responses and persisted grants before use. */
import { z } from 'zod'
import type { EnterpriseMemberId, EnterpriseModelId, EnterpriseProjectId, EnterpriseSessionId } from './types.ts'

const token = z.string().regex(/^[A-Za-z0-9_-]{43}$/)
const sessionId = token.transform(value => value as EnterpriseSessionId)
const memberId = z.uuid().transform(value => value as EnterpriseMemberId)
const modelId = z.uuid().transform(value => value as EnterpriseModelId)
const projectId = z.uuid().transform(value => value as EnterpriseProjectId)
const timestamp = z.iso.datetime()

/**
 * Accept explicit HTTP or HTTPS origins, including enterprise intranets.
 * @param value - configured service address.
 * @returns normalized origin, without a path or credentials.
 */
export function enterpriseOrigin(value: string): string {
  const url = new URL(value)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password
    || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('UnionPay origin must be an HTTP(S) origin without credentials, path, query, or fragment')
  }
  return url.origin
}

/** Product and protocol discovery before any credential is sent. */
export const discovery = z.object({ product: z.literal('UnionPay Code'), protocolVersion: z.literal(1), origin: z.string() })
/** Successful member-session exchange, before storing its separate Cookie header. */
export const sessionResponse = z.object({
  authenticated: z.literal(true), authentication: z.enum(['sso', 'access-code']),
  csrfToken: token, sessionId, expiresAt: timestamp,
})
/** Member-owned display information from the versioned snapshot API. */
export const snapshotResponse = z.object({
  member: z.object({ id: memberId, name: z.string(), department: z.string(), seat: z.enum(['developer', 'observer']) }),
  projects: z.array(z.object({ id: projectId, name: z.string() })).max(10000),
  quota: z.object({
    month: z.string(), inputTokens: z.number().nonnegative(), outputTokens: z.number().nonnegative(),
    totalTokens: z.number().nonnegative().optional(), requests: z.number().nonnegative(),
    incompleteRequests: z.number().int().nonnegative().optional(), budget: z.number().nonnegative().nullable(),
  }),
})
/** Short-lived Host-only model bearer issued by the configured enterprise origin. */
export const runtimeGrant = z.object({ origin: z.string(), token, expiresAt: timestamp })
/** Member and session binding checked before installing model routes. */
export const runtimeCatalog = z.object({
  memberId, sessionId, revision: z.number().int().nonnegative(), expiresAt: timestamp,
  models: z.array(z.object({
    id: modelId, name: z.string().min(1).max(120), modelId: z.string().min(1).max(120),
    protocol: z.enum(['openai-chat-completions', 'openai-responses', 'anthropic-messages']),
    contextWindow: z.number().int().positive(), maxOutputTokens: z.number().int().positive(),
    capabilities: z.object({
      supportsImage: z.boolean().nullable().optional(), supportsToolCall: z.boolean().nullable().optional(),
      supportsJsonSchemaOutput: z.boolean().nullable().optional(),
      reasoning: z.discriminatedUnion('profile', [
        z.object({ profile: z.literal('gateway-default') }),
        z.object({ profile: z.enum(['openai-chat-effort', 'openai-responses-effort', 'anthropic-budget']), levels: z.array(z.enum(['low', 'medium', 'high'])).min(1).max(3) }),
      ]).optional(),
    }).optional(),
  })).max(500).refine(models => new Set(models.map(model => model.id)).size === models.length, { message: 'Model IDs must be unique' }),
})
/** Bounded polling instructions and browser approval URL for one SSO attempt. */
export const deviceStart = z.object({
  deviceCode: token, verificationUri: z.url(), expiresAt: timestamp,
  intervalMs: z.number().int().min(1000).max(10000),
})
/** Pending device authorization; the server may adjust its polling interval. */
export const devicePending = z.object({ status: z.literal('pending'), expiresAt: timestamp, intervalMs: z.number().int().min(1000).max(10000).optional() })
/** Versioned credential payload owned by the Host credential store. */
export const storedGrant = z.strictObject({
  version: z.literal(1), status: z.literal('signed-in'), origin: z.string(), cookie: z.string().regex(/^unionpay_client_session=[A-Za-z0-9_-]{43}$/),
  csrfToken: token, sessionId, expiresAt: timestamp, memberId,
})
/** Validated Host-only member credential. */
export type StoredGrant = z.infer<typeof storedGrant>
/** Persisted member grant or explicit local retirement marker. */
export const storedCredential = z.discriminatedUnion('status', [storedGrant,
  z.strictObject({ version: z.literal(1), status: z.literal('signed-out'), origin: z.string(), reason: z.enum(['logout', 'expired']) }),
])

/** Collection policy and identity-bound intake ticket. */
export const collectionConfig = z.object({
  enabled: z.boolean(), sampleRate: z.number().min(0).max(1), ticket: token.optional(),
  memberId: memberId.optional(), sessionId: z.string().optional(),
})
/** Acknowledgement for a completed server-side session mutation. */
export const okResponse = z.object({ ok: z.literal(true) })
