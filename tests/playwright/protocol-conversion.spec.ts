import { expect, test } from '@playwright/test'
import { createGatewayHarness } from './harness'

// Wire-level protocol-conversion coverage through the real built gateway.
// The Rust tests assert the same transformations in-process; these specs prove
// the full proxy path (auth → routing → conversion → SSE relay → client) keeps
// the standard shapes: per-block Responses items, `created_at`, and refusal
// handling on both streamed and non-streamed paths.
const harness = createGatewayHarness({ protocolFixtures: true })

test.beforeAll(async () => {
  await harness.start()
})

test.afterAll(async () => {
  await harness.stop()
})

function parseSse(raw: string): any[] {
  return raw
    .split(/\r?\n\r?\n/)
    .flatMap((block) => {
      const data = block
        .split(/\r?\n/)
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trim())
      if (data.length === 0) return []
      const joined = data.join('\n')
      if (joined === '[DONE]') return []
      try {
        return [JSON.parse(joined)]
      } catch {
        return []
      }
    })
}

function sseEventsOfType(events: any[], type: string): any[] {
  return events.filter((event) => event.type === type)
}

const jsonHeaders = { 'content-type': 'application/json' }

test('anthropic stream maps every content block to its own Responses item', async ({ request }) => {
  const response = await request.post(`${harness.baseUrl()}/openai/v1/responses`, {
    data: {
      model: 'anthropic-model',
      stream: true,
      input: 'e2e-multi-block',
    },
    headers: jsonHeaders,
  })
  expect(response.status()).toBe(200)
  const events = parseSse(await response.text())
  expect(events.length).toBeGreaterThan(0)

  // The stream opens with the standard event and a numeric `created_at`.
  const created = events[0]
  expect(created.type).toBe('response.created')
  expect(typeof created.response.created_at).toBe('number')
  expect(created.response).not.toHaveProperty('created')

  // Empty text block consumes no output index; thinking/text blocks each get
  // one, announced in stream order with matching output_index values.
  const added = sseEventsOfType(events, 'response.output_item.added')
  expect(added.map((event) => event.item.type)).toEqual([
    'reasoning',
    'message',
    'reasoning',
    'message',
  ])
  expect(added.map((event) => event.output_index)).toEqual([0, 1, 2, 3])

  const textDeltas = sseEventsOfType(events, 'response.output_text.delta')
  expect(textDeltas.map((event) => event.delta)).toEqual(['hello ', 'world', 'again'])
  expect(textDeltas.map((event) => event.output_index)).toEqual([1, 1, 3])
  // Text deltas must reference the item they belong to, not a shared singleton.
  expect(textDeltas[0].item_id).toBe(added[1].item.id)
  expect(textDeltas[2].item_id).toBe(added[3].item.id)
  expect(textDeltas[0].item_id).not.toBe(textDeltas[2].item_id)

  const reasoningDeltas = sseEventsOfType(events, 'response.reasoning_summary_text.delta')
  expect(reasoningDeltas.map((event) => event.delta)).toEqual(['plan-a', 'plan-b'])
  expect(reasoningDeltas.map((event) => event.output_index)).toEqual([0, 2])

  expect(sseEventsOfType(events, 'response.output_item.done')).toHaveLength(4)

  const completed = sseEventsOfType(events, 'response.completed')
  expect(completed).toHaveLength(1)
  expect(completed[0].response.status).toBe('completed')
  expect(typeof completed[0].response.created_at).toBe('number')
  expect(completed[0].response).not.toHaveProperty('created')
  expect(completed[0].response.output.map((item: any) => item.type)).toEqual([
    'reasoning',
    'message',
    'reasoning',
    'message',
  ])
  expect(completed[0].response.output[1].content[0].text).toBe('hello world')
  expect(completed[0].response.output[3].content[0].text).toBe('again')
  expect(completed[0].output_text).toBe('hello worldagain')
})

test('streamed Responses refusal becomes Anthropic refusal stop_reason without duplicating text', async ({ request }) => {
  const response = await request.post(`${harness.baseUrl()}/v1/messages`, {
    data: {
      model: 'responses-model',
      max_tokens: 64,
      stream: true,
      messages: [{ role: 'user', content: [{ type: 'text', text: 'e2e-responses-refusal' }] }],
    },
    headers: jsonHeaders,
  })
  expect(response.status()).toBe(200)
  const events = parseSse(await response.text())

  const textDeltas = sseEventsOfType(events, 'content_block_delta')
    .map((event) => event.delta)
    .filter((delta) => delta.type === 'text_delta')
  expect(textDeltas.map((delta) => delta.text)).toEqual(['I cannot'])

  const messageDelta = sseEventsOfType(events, 'message_delta')
  expect(messageDelta).toHaveLength(1)
  expect(messageDelta[0].delta.stop_reason).toBe('refusal')
})

test('Responses items stream into separate Anthropic content blocks', async ({ request }) => {
  const response = await request.post(`${harness.baseUrl()}/v1/messages`, {
    data: {
      model: 'responses-model',
      max_tokens: 2048,
      thinking: { type: 'enabled', budget_tokens: 1024 },
      stream: true,
      messages: [{ role: 'user', content: [{ type: 'text', text: 'e2e-responses-multi-item' }] }],
    },
    headers: jsonHeaders,
  })
  expect(response.status()).toBe(200)
  const events = parseSse(await response.text())

  const starts = sseEventsOfType(events, 'content_block_start').map((event) => ({
    index: event.index,
    type: event.content_block.type,
  }))
  expect(starts).toEqual([
    { index: 0, type: 'thinking' },
    { index: 1, type: 'text' },
    { index: 2, type: 'thinking' },
    { index: 3, type: 'text' },
  ])

  const deltas = sseEventsOfType(events, 'content_block_delta').map((event) => ({
    index: event.index,
    type: event.delta.type,
    value: event.delta.text ?? event.delta.thinking,
  }))
  expect(deltas).toEqual([
    { index: 0, type: 'thinking_delta', value: 'plan' },
    { index: 1, type: 'text_delta', value: 'hello ' },
    { index: 1, type: 'text_delta', value: 'world' },
    { index: 2, type: 'thinking_delta', value: 'again' },
    { index: 3, type: 'text_delta', value: 'again' },
  ])

  expect(sseEventsOfType(events, 'content_block_stop').map((event) => event.index)).toEqual([0, 1, 2, 3])
  expect(sseEventsOfType(events, 'message_delta')[0].delta.stop_reason).toBe('end_turn')
})

test('terminal-only Responses refusal is synthesized for Anthropic clients', async ({ request }) => {
  const response = await request.post(`${harness.baseUrl()}/v1/messages`, {
    data: {
      model: 'responses-model',
      max_tokens: 64,
      stream: true,
      messages: [{ role: 'user', content: [{ type: 'text', text: 'e2e-responses-terminal-refusal' }] }],
    },
    headers: jsonHeaders,
  })
  expect(response.status()).toBe(200)
  const events = parseSse(await response.text())

  const textDeltas = sseEventsOfType(events, 'content_block_delta')
    .map((event) => event.delta)
    .filter((delta) => delta.type === 'text_delta')
  expect(textDeltas.map((delta) => delta.text)).toEqual(['Terminal refusal'])
  expect(sseEventsOfType(events, 'message_delta')[0].delta.stop_reason).toBe('refusal')
})

test('non-stream Responses refusal becomes Anthropic refusal stop_reason', async ({ request }) => {
  const response = await request.post(`${harness.baseUrl()}/v1/messages`, {
    data: {
      model: 'responses-model',
      max_tokens: 64,
      messages: [{ role: 'user', content: [{ type: 'text', text: 'e2e-responses-nonstream-refusal' }] }],
    },
    headers: jsonHeaders,
  })
  expect(response.status()).toBe(200)
  const body = await response.json()

  expect(body.content).toEqual([{ type: 'text', text: 'No.' }])
  expect(body.stop_reason).toBe('refusal')
})

test('non-stream Chat legacy function_call and refusal convert exactly once', async ({ request }) => {
  const response = await request.post(`${harness.baseUrl()}/v1/messages`, {
    data: {
      model: 'stub-model',
      max_tokens: 2048,
      thinking: { type: 'enabled', budget_tokens: 1024 },
      messages: [{ role: 'user', content: [{ type: 'text', text: 'e2e-chat-legacy-refusal' }] }],
    },
    headers: jsonHeaders,
  })
  expect(response.status()).toBe(200)
  const body = await response.json()

  expect(body.content.map((block: any) => block.type)).toEqual(['thinking', 'text', 'tool_use'])
  expect(body.content[0].thinking).toBe('legacy plan')
  expect(body.content[1].text).toBe('I cannot help with that.')
  expect(body.content[2]).toMatchObject({ id: 'call_legacy', name: 'lookup', input: { q: 'x' } })
  expect(body.stop_reason).toBe('refusal')
})

test('anthropic server-side web_search tool is not forwarded to OpenAI upstreams', async ({ request }) => {
  // Claude Code's WebSearch issues an internal Anthropic request whose only
  // tool is the server-executed `web_search_20250305`. Forwarding it as an
  // OpenAI function with empty `parameters` makes strict upstreams reject the
  // whole call ("tools.0.function.parameters must be a JSON Schema of type
  // object"), so the gateway must drop it and its forced tool_choice.
  const before = harness.stubRequests().length
  const response = await request.post(`${harness.baseUrl()}/v1/messages`, {
    data: {
      model: 'stub-model',
      max_tokens: 64,
      messages: [{ role: 'user', content: 'what is new in vLLM' }],
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 8 }],
      tool_choice: { type: 'tool', name: 'web_search' },
    },
    headers: jsonHeaders,
  })
  expect(response.status()).toBe(200)
  expect((await response.json()).content[0].text).toContain('Stub response')

  const upstreamCalls = harness
    .stubRequests()
    .slice(before)
    .filter((item) => item.url === '/v1/chat/completions')
  expect(upstreamCalls).toHaveLength(1)
  expect(upstreamCalls[0].toolNames ?? []).toEqual([])
})

test('non-stream Responses conversion emits created_at instead of created', async ({ request }) => {
  const response = await request.post(`${harness.baseUrl()}/openai/v1/responses`, {
    data: { model: 'anthropic-model', input: 'plain conversion' },
    headers: jsonHeaders,
  })
  expect(response.status()).toBe(200)
  const body = await response.json()

  expect(body.object).toBe('response')
  expect(typeof body.created_at).toBe('number')
  expect(body).not.toHaveProperty('created')
  expect(body.output_text).toContain('anthropic response')
})

test('materialized non-stream Responses keeps the full multi-block output', async ({ request }) => {
  const before = harness.stubRequests().filter((item) => item.url === '/v1/messages').length
  const response = await request.post(`${harness.baseUrl()}/openai/v1/responses`, {
    data: { model: 'anthropic-materialized', stream: false, input: 'e2e-multi-block' },
    headers: jsonHeaders,
  })
  expect(response.status()).toBe(200)
  const body = await response.json()

  // The client asked for a non-stream response; the gateway must have opened
  // an upstream stream to materialize it.
  const upstreamCalls = harness.stubRequests().filter((item) => item.url === '/v1/messages')
  expect(upstreamCalls.length).toBeGreaterThan(before)
  expect(upstreamCalls[upstreamCalls.length - 1].stream).toBe(true)

  expect(typeof body.created_at).toBe('number')
  expect(body).not.toHaveProperty('created')
  // Non-stream conversions must keep the same per-block item order and raw
  // text concatenation as the streamed path above.
  expect(body.output_text).toBe('hello worldagain')
  expect(body.output.map((item: any) => item.type)).toEqual([
    'reasoning',
    'message',
    'reasoning',
    'message',
  ])
  expect(body.output[1].content[0].text).toBe('hello world')
  expect(body.output[3].content[0].text).toBe('again')
})
