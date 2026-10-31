/** Deterministic external-provider replies used by both protocol and real-management integration tests. */
export type Protocol = 'openai-chat-completions' | 'openai-responses' | 'anthropic-messages'

/** One complete SSE response with known, overlapping cache and reasoning counters. */
export function modelResponse(protocol: Protocol, withUsage = true): string {
  const text = 'Enterprise connection verified.'
  let frames: object[]
  if (protocol === 'openai-responses') {
    const item = { type: 'message', id: 'msg_enterprise', role: 'assistant', content: [{ type: 'output_text', text, annotations: [] }] }
    frames = [
      { type: 'response.created', response: { id: 'resp_enterprise' } },
      { type: 'response.output_item.added', output_index: 0, item },
      { type: 'response.output_item.done', output_index: 0, item },
      { type: 'response.completed', response: { id: 'resp_enterprise', status: 'completed', output: [item],
        ...(withUsage ? { usage: { input_tokens: 120, output_tokens: 20, total_tokens: 140,
          input_tokens_details: { cached_tokens: 30 }, output_tokens_details: { reasoning_tokens: 5 } } } : {}) } },
    ]
    return frames.map(value => `data: ${JSON.stringify(value)}\n\n`).join('')
  }
  if (protocol === 'anthropic-messages') {
    frames = [
      { type: 'message_start', message: { id: 'msg_enterprise', type: 'message', role: 'assistant', model: 'enterprise-anthropic', content: [], stop_reason: null, stop_sequence: null,
        usage: { input_tokens: 90, cache_read_input_tokens: 30, output_tokens: 1 } } },
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text } },
      { type: 'content_block_stop', index: 0 },
      { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 20 } },
      { type: 'message_stop' },
    ]
    return frames.map(value => `event: ${'type' in value ? String(value.type) : ''}\ndata: ${JSON.stringify(value)}\n\n`).join('')
  }
  frames = [
    { choices: [{ index: 0, delta: { role: 'assistant', content: text }, finish_reason: null }] },
    { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], ...(withUsage ? { usage: { prompt_tokens: 120, completion_tokens: 20, total_tokens: 140, prompt_tokens_details: { cached_tokens: 30 }, completion_tokens_details: { reasoning_tokens: 5 } } } : {}) },
  ]
  return frames.map(value => `data: ${JSON.stringify(value)}\n\n`).join('') + 'data: [DONE]\n\n'
}
