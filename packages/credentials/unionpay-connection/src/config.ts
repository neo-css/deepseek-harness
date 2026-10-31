/** Deployment limits and enterprise endpoint configuration. */
import Schema from '@deepseek-ai/schemastery'
import type { Volatile } from '@deepseek-ai/cordis'

/** An empty origin leaves the plugin available for configuration without starting network activity. */
export interface Config {
  /** Enterprise HTTP(S) origin; empty means not configured. */
  origin: Volatile<string>
  /** Deadline for one enterprise API request, including its body. */
  requestTimeoutMs: number
  /** Maximum bytes accepted in one enterprise JSON response. */
  maxResponseBytes: number
  /** Interval between authenticated catalog and membership refreshes. */
  refreshIntervalMs: number
  /** Renew inference grants this long before their expiry. */
  renewBeforeMs: number
  /** Maximum local lifetime of a browser sign-in attempt. */
  signInTimeoutMs: number
}

/** The endpoint is live; request limits are deployment configuration. */
export const Config = Schema.object({
  origin: Schema.string().pattern(/^(?:|https?:\/\/[^\s/?#@]+\/?)$/).default('').volatile(),
  requestTimeoutMs: Schema.number().min(1).max(120000).step(1).default(30000),
  maxResponseBytes: Schema.number().min(1024).max(16777216).step(1).default(2097152),
  refreshIntervalMs: Schema.number().min(1000).max(3600000).step(1).default(60000),
  renewBeforeMs: Schema.number().min(0).max(300000).step(1).default(60000),
  signInTimeoutMs: Schema.number().min(1000).max(3600000).step(1).default(600000),
})
