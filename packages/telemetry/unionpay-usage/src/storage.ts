/** Versioned usage outbox; corrupt or unsupported data stops delivery instead of resetting it. */
import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { EnterpriseMemberId, EnterpriseModelId } from '@deepseek-ai/dsh-unionpay-connection/types'
import type { QueuedUsage, UsageClientId, UsageReport, UsageRequestId } from './types.ts'

const count = z.number().int().min(0).max(1000000000)
const requestId = z.uuid().transform(value => value as UsageRequestId)
const clientId = z.uuid().transform(value => value as UsageClientId)

/** The enterprise intake format, used before durable publication and after durable reads. */
export const reportSchema: z.ZodType<UsageReport> = z.strictObject({
  requestId, clientId, app: z.enum(['desktop', 'cli']), version: z.string().max(40).regex(/^[a-zA-Z0-9.+_-]+$/),
  at: z.iso.datetime(), modelId: z.string().min(1).max(200).regex(/^[\p{L}\p{N}_.:/-]+$/u).refine(value => !value.includes('://') && !value.startsWith('/')),
  source: z.enum(['enterprise', 'byok']), enterpriseModelId: z.uuid().transform(value => value as EnterpriseModelId).optional(),
  querySource: z.enum(['main_turn', 'subagent', 'compact', 'session_title', 'unknown']),
  status: z.enum(['completed', 'error', 'cancelled']), latencyMs: z.number().min(0).max(86400000),
  inputTokens: count.optional(), outputTokens: count.optional(), reasoningTokens: count.optional(),
  cacheReadTokens: count.optional(), cacheWriteTokens: count.optional(), totalTokens: count.optional(),
})

const queued: z.ZodType<QueuedUsage> = z.strictObject({
  owner: z.strictObject({ origin: z.url(), memberId: z.uuid().transform(value => value as EnterpriseMemberId).nullable() }),
  report: reportSchema,
})

/** Each outbox row has its own durable document; acknowledgements remove only the accepted UUIDs. */
export const usageDomain = defineDomain({
  name: 'unionpay_usage', version: 1, layout: 'per-record',
  global: { schema: z.object({ clientId: clientId.nullable() }), initial: { clientId: null } },
  tables: { records: domainTable<UsageRequestId, QueuedUsage>(queued) },
})
