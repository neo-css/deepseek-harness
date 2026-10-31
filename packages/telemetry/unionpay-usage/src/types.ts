/** Usage delivery status and the white-listed persistent report format. */
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { EnterpriseClientId, EnterpriseFailureCode, EnterpriseModelId, EnterpriseUsageOwner } from '@deepseek-ai/dsh-unionpay-connection/types'

/** An idempotency key assigned once before a completed call enters the outbox. */
export type UsageRequestId = Branded<'UnionPayUsageRequestId'>
/** Persistent identity of this reporting installation. */
export type UsageClientId = EnterpriseClientId

/** Server-compatible call classification; external agents without a usage source are not inferred. */
export type UsageSource = 'main_turn' | 'subagent' | 'compact' | 'session_title' | 'unknown'

/** Only these counters and public identifiers can leave the Host. */
export interface UsageReport {
  readonly requestId: UsageRequestId
  readonly clientId: UsageClientId
  readonly app: 'desktop' | 'cli'
  readonly version: string
  readonly at: string
  readonly modelId: string
  readonly source: 'enterprise' | 'byok'
  readonly enterpriseModelId?: EnterpriseModelId | undefined
  readonly querySource: UsageSource
  readonly status: 'completed' | 'error' | 'cancelled'
  readonly latencyMs: number
  readonly inputTokens?: number | undefined
  readonly outputTokens?: number | undefined
  readonly reasoningTokens?: number | undefined
  readonly cacheReadTokens?: number | undefined
  readonly cacheWriteTokens?: number | undefined
  readonly totalTokens?: number | undefined
}

/** Durable delivery state keeps the request-start identity separate from the wire report. */
export interface QueuedUsage {
  readonly owner: EnterpriseUsageOwner
  readonly report: UsageReport
}

/** Display-safe delivery progress; counters reflect this plugin lifetime except pending. */
export interface UsageDeliveryView {
  readonly pending: number
  readonly collection: 'unknown' | 'enabled' | 'disabled' | 'unconfigured'
  readonly waitingForMember: boolean
  readonly lastDeliveryAt: string | null
  readonly error: EnterpriseFailureCode | 'queue-full' | 'storage' | 'invalid-usage' | null
  readonly failedToPersist: number
}

/** Deployment choices for collection and durable delivery. */
export interface Config {
  /** Include personal model calls as BYOK by default; false collects only enterprise calls. */
  includePersonalModels: boolean
  /** Product carrier accepted by the enterprise API; a Web Host uses cli. */
  app: 'desktop' | 'cli'
  /** Delay between attempts to send queued reports. */
  flushIntervalMs: number
  /** Interval for observing an administrator's collection switch. */
  collectionRefreshMs: number
  /** Maximum completed calls retained in the local outbox. */
  maxQueueRecords: number
  /** Maximum reports sent in one delivery batch; the server accepts at most 50. */
  batchSize: number
}
