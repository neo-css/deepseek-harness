/** Credential-free enterprise views and Host integration types. */
import type { Branded } from '@deepseek-ai/dsh-brand'

/** Stable member identity assigned by the enterprise service. */
export type EnterpriseMemberId = Branded<'EnterpriseMemberId'>
/** Stable managed model identity, distinct from the upstream model name. */
export type EnterpriseModelId = Branded<'EnterpriseModelId'>
/** Stable enterprise project identity. */
export type EnterpriseProjectId = Branded<'EnterpriseProjectId'>
/** Local authorization attempt identity. */
export type EnterpriseSignInId = Branded<'EnterpriseSignInId'>

/** Persistent reporting installation identity. */
export type EnterpriseClientId = Branded<'EnterpriseClientId'>
/** Enterprise-issued member-session identity. */
export type EnterpriseSessionId = Branded<'EnterpriseSessionId'>

/** Failures whose handling does not depend on server-authored error text. */
export type EnterpriseFailureCode =
  | 'not-configured' | 'invalid-response' | 'unavailable' | 'timeout'
  | 'unauthorized' | 'forbidden' | 'conflict' | 'rate-limited'
  | 'cancelled' | 'invalid-credential' | 'sign-in-busy' | 'invalid-input'

/** Display-safe member fields; roles never grant local Host authority. */
export interface EnterpriseMember {
  readonly id: EnterpriseMemberId
  readonly name: string
  readonly department: string
  readonly seat: 'developer' | 'observer'
}

/** A project visible to the authenticated member. */
export interface EnterpriseProject {
  readonly id: EnterpriseProjectId
  readonly name: string
}

/** Server-reported personal usage for the current calendar month. */
export interface EnterpriseQuota {
  readonly month: string
  readonly inputTokens: number
  readonly outputTokens: number
  readonly totalTokens?: number | undefined
  readonly requests: number
  readonly incompleteRequests?: number | undefined
  readonly budget: number | null
}

/** Model metadata authorized by the enterprise gateway, without upstream credentials or URLs. */
export interface EnterpriseModel {
  readonly id: EnterpriseModelId
  readonly name: string
  readonly modelId: string
  readonly protocol: 'openai-chat-completions' | 'openai-responses' | 'anthropic-messages'
  readonly contextWindow: number
  readonly maxOutputTokens: number
  readonly capabilities?: {
    readonly supportsImage?: boolean | null | undefined
    readonly supportsToolCall?: boolean | null | undefined
    readonly supportsJsonSchemaOutput?: boolean | null | undefined
    readonly reasoning?: { readonly profile: 'gateway-default' }
      | { readonly profile: 'openai-chat-effort' | 'openai-responses-effort' | 'anthropic-budget'; readonly levels: readonly ('low' | 'medium' | 'high')[] } | undefined
  } | undefined
}

/** A complete observation; unavailable never means that a member was signed out. */
export interface EnterpriseConnectionView {
  readonly origin: string
  readonly status: 'unconfigured' | 'signed-out' | 'connected' | 'expired' | 'unavailable'
  readonly member: EnterpriseMember | null
  readonly projects: readonly EnterpriseProject[]
  readonly quota: EnterpriseQuota | null
  readonly modelCount: number
  readonly error: EnterpriseFailureCode | null
  readonly signIn: {
    readonly id: EnterpriseSignInId
    readonly status: 'pending' | 'failed'
    readonly verificationUrl?: string
    readonly error?: EnterpriseFailureCode
  } | null
}

/** Identity captured before a model call; delivery must never assign it to another member. */
export interface EnterpriseUsageOwner {
  readonly origin: string
  readonly memberId: EnterpriseMemberId | null
}

/** Host-only inference grant; never return this value from a Remote method. */
export interface EnterpriseRuntime {
  readonly origin: string
  readonly memberId: EnterpriseMemberId
  readonly sessionId: EnterpriseSessionId
  readonly token: string
  readonly expiresAt: number
  readonly models: readonly EnterpriseModel[]
  readonly signal: AbortSignal
}

/** An acknowledged delivery is distinct from a server opt-out or an unavailable reporting identity. */
export type EnterpriseUsageDelivery = { readonly status: 'acknowledged'; readonly count: number }
  | { readonly status: 'disabled' } | { readonly status: 'waiting-for-member' }

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * The connection's credential-free state or model catalog changed.
     * @param view - complete display-safe state.
     * @mode emit
     */
    'unionpay/changed'(view: EnterpriseConnectionView): void
  }
}
