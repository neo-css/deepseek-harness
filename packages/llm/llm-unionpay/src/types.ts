/** Managed request accounting and deployment controls. */
import type { GenerateOptions } from '@deepseek-ai/dsh-llm'
import type { EnterpriseModelId, EnterpriseUsageOwner } from '@deepseek-ai/dsh-unionpay-connection/types'

/** Provider-reported counts; omitted fields remain unknown, including on interrupted requests. */
export interface ManagedTokenCounts {
  readonly inputTokens?: number | undefined
  readonly outputTokens?: number | undefined
  readonly reasoningTokens?: number | undefined
  readonly cacheReadTokens?: number | undefined
  readonly cacheWriteTokens?: number | undefined
  readonly totalTokens?: number | undefined
}

/** One settled enterprise inference attempt, with its actual credential owner and white-listed metadata. */
export interface ManagedModelCall {
  readonly owner: EnterpriseUsageOwner
  readonly enterpriseModelId: EnterpriseModelId
  readonly model: string
  readonly startedAt: number
  readonly latencyMs: number
  readonly status: 'completed' | 'error' | 'cancelled'
  readonly purpose?: NonNullable<GenerateOptions['purpose']>
  readonly sessionId?: NonNullable<GenerateOptions['sessionId']>
  readonly usage: ManagedTokenCounts
}

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * An enterprise inference attempt settled; reporting consumers finish before the observer releases it.
     * @param call - request-start identity and provider-reported usage, without content or credentials.
     * @mode serial
     */
    'unionpay-model/call'(call: ManagedModelCall): Promise<void>
  }
}

/** Deployment controls of the managed-model adapter. */
export interface Config {
  /** Maximum idle time between upstream stream chunks. */
  streamIdleTimeoutMs: number
  /** Maximum total pixels in each image request version. */
  requestImagePixelBudget: number
  /** Maximum raw bytes in each image request version. */
  requestImageMaxBytes: number
  /** Maximum aggregate encoded image bytes per request. */
  maxRequestImageBytes: number
  /** Additional attempts allowed for transient model failures. */
  maxRetries: number
  /** Maximum buffered SSE event characters while extracting provider usage. */
  maxUsageEventChars: number
}
