/** Bounded usage observation preserves provider omissions while passing response bytes through unchanged. */
import { createParser } from 'eventsource-parser'
import type { TokenUsage } from '@deepseek-ai/dsh-llm'
import type { EnterpriseModel } from '@deepseek-ai/dsh-unionpay-connection/types'
import type { ManagedTokenCounts } from './types.ts'

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function count(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined
}

/** One observer is allocated for each stream attempt, including retries of a prepared call. */
export class UsageObserver {
  private values: ManagedTokenCounts = {}
  private anthropicInput: number | undefined
  private overflowed = false

  /**
   * @param protocol - enterprise model's upstream protocol.
   * @param maxEventChars - parser buffer bound.
   */
  constructor(private readonly protocol: EnterpriseModel['protocol'], private readonly maxEventChars: number) {}

  /**
   * Read observed counters.
   * @returns the exact total only when provided or when both input and output are known.
   */
  snapshot(): ManagedTokenCounts {
    if (this.overflowed) return {}
    const value = this.values
    return { ...value, ...(value.totalTokens !== undefined || value.inputTokens === undefined || value.outputTokens === undefined
      ? {} : { totalTokens: value.inputTokens + value.outputTokens }) }
  }

  /**
   * Project observed counters into the DSH log.
   * @returns disjoint counts, or undefined when aggregate counts are unknown.
   */
  tokenUsage(): TokenUsage | undefined {
    const usage = this.snapshot()
    if (usage.inputTokens === undefined || usage.outputTokens === undefined) return undefined
    const uncached = usage.inputTokens - (usage.cacheReadTokens ?? 0) - (usage.cacheWriteTokens ?? 0)
    if (uncached < 0) return undefined
    return {
      inputTokens: uncached, outputTokens: usage.outputTokens,
      ...(usage.totalTokens === undefined ? {} : { totalTokens: usage.totalTokens }),
      ...(usage.cacheReadTokens === undefined ? {} : { cacheReadTokens: usage.cacheReadTokens }),
      ...(usage.cacheWriteTokens === undefined ? {} : { cacheWriteTokens: usage.cacheWriteTokens }),
      ...(usage.reasoningTokens === undefined ? {} : { reasoningTokens: usage.reasoningTokens }),
    }
  }

  private accept(value: unknown): void {
    const frame = object(value)
    if (frame === undefined) return
    const response = object(frame.response)
    const message = object(frame.message)
    const first = Array.isArray(frame.choices) ? object(frame.choices[0]) : undefined
    const usage = object(response?.usage) ?? object(message?.usage) ?? object(frame.usage) ?? object(first?.usage)
    if (usage === undefined) return
    const anthropic = this.protocol === 'anthropic-messages'
    const chat = this.protocol === 'openai-chat-completions'
    const inputDetails = object(chat ? usage.prompt_tokens_details : usage.input_tokens_details)
    const outputDetails = object(chat ? usage.completion_tokens_details : usage.output_tokens_details)
    const cacheRead = count(anthropic ? usage.cache_read_input_tokens
      : inputDetails?.cached_tokens ?? usage.prompt_cache_hit_tokens ?? usage.cached_tokens)
    const cacheWrite = count(anthropic ? usage.cache_creation_input_tokens : inputDetails?.cache_write_tokens)
    const input = count(chat ? usage.prompt_tokens : usage.input_tokens)
    const output = count(chat ? usage.completion_tokens : usage.output_tokens)
    const reasoning = count(outputDetails?.reasoning_tokens)
    const total = count(usage.total_tokens)
    if (anthropic && input !== undefined) this.anthropicInput = input
    const aggregateInput = anthropic
      ? this.anthropicInput === undefined ? undefined
        : this.anthropicInput + (cacheRead ?? this.values.cacheReadTokens ?? 0) + (cacheWrite ?? this.values.cacheWriteTokens ?? 0)
      : input
    this.values = {
      ...this.values,
      ...(aggregateInput === undefined ? {} : { inputTokens: aggregateInput }),
      ...(output === undefined ? {} : { outputTokens: output }),
      ...(cacheRead === undefined ? {} : { cacheReadTokens: cacheRead }),
      ...(cacheWrite === undefined ? {} : { cacheWriteTokens: cacheWrite }),
      ...(reasoning === undefined ? {} : { reasoningTokens: reasoning }),
      ...(total === undefined ? {} : { totalTokens: total }),
    }
  }

  /**
   * Identify incomplete observation.
   * @returns whether parsing exceeded its buffer and discarded all counts.
   */
  exceededLimit(): boolean { return this.overflowed }

  /** Instance-owned Fetch implementation; no global fetch mutation or response-body copies. */
  readonly fetch: typeof globalThis.fetch = async (input, init) => {
    const response = await fetch(input, init)
    if (!response.ok || response.body === null || !response.headers.get('content-type')?.includes('text/event-stream')) return response
    const decoder = new TextDecoder()
    const parser = createParser({
      maxBufferSize: this.maxEventChars,
      onError: (error) => { if (error.type === 'max-buffer-size-exceeded') this.overflowed = true },
      onEvent: (event) => {
        if (event.data.length > this.maxEventChars) this.overflowed = true
        if (this.overflowed) return
        if (event.data === '[DONE]') return
        let value: unknown
        try { value = JSON.parse(event.data) }
        catch (_error) { return }
        this.accept(value)
      },
    })
    const observed = response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
      transform: (chunk, controller) => {
        if (!this.overflowed) parser.feed(decoder.decode(chunk, { stream: true }))
        controller.enqueue(chunk)
      },
      flush: () => { if (!this.overflowed) { parser.feed(decoder.decode()); parser.reset({ consume: true }) } },
    }))
    return new Response(observed, { status: response.status, statusText: response.statusText, headers: response.headers })
  }
}
