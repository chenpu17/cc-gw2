import http from 'node:http'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'

export interface GatewayHarness {
  tempHome: string
  gatewayPort: number
  stubPort: number
  secondaryPort: number
  gatewayProcess: ChildProcessWithoutNullStreams | null
  stubServer: http.Server | null
  secondaryServer: http.Server | null
  /** Every request the primary stub upstream received (for endpoint/key
   * routing assertions); also served as `GET /__test/requests`. */
  stubRequests: () => RecordedStubRequest[]
  start: () => Promise<void>
  stop: () => Promise<void>
  baseUrl: () => string
}

export interface RecordedStubRequest {
  method: string
  url: string
  authorization: string | null
  xApiKey: string | null
  model: string | null
  /** `stream` from the JSON body; null for GETs and unparseable bodies. */
  stream: boolean | null
  /** Tool names from the JSON body (`function.name` or bare `name`); null when
   * the request had no tools array. */
  toolNames: string[] | null
}

export interface GatewayHarnessOptions {
  auth?: {
    enabled: boolean
    username: string
    password: string
  }
  /** Aggregate-failover fixture: adds `stub-model-failing` (always 500) to the
   * stub provider and an `agg` aggregate provider whose `agg-model` tries the
   * failing member first, then the healthy one. */
  aggregate?: boolean
  /** Spawns a second, independent stub upstream (own port/process) as the
   * `secondary` provider. Combined with `aggregate`, also adds `agg-cross-model`
   * whose member chain spans both providers — for cross-provider failover e2e. */
  secondaryUpstream?: boolean
  /** Version the stub registry advertises as `dist-tags.latest`. Defaults to the
   * root package version (i.e. no update available). */
  registryVersion?: string
  /** Adds `anthropic` and `openai-responses` providers backed by the same stub,
   * for protocol-conversion e2e (marker-driven upstream fixtures above). */
  protocolFixtures?: boolean
}

function resolveBuiltServerBinary(): string | null {
  const executable = process.platform === 'win32' ? 'cc-gw-server.exe' : 'cc-gw-server'
  const candidates = [
    path.join(process.cwd(), 'target', 'release', executable),
    path.join(process.cwd(), 'target', 'debug', executable),
  ]

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate
    }
  }

  return null
}

async function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = http.createServer()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('Unable to determine free port')))
        return
      }
      server.close((error) => {
        if (error) reject(error)
        else resolve(address.port)
      })
    })
  })
}

function recordGet(req: http.IncomingMessage): RecordedStubRequest {
  return {
    method: req.method ?? 'GET',
    url: req.url ?? '',
    authorization: (req.headers.authorization as string | undefined) ?? null,
    xApiKey: (req.headers['x-api-key'] as string | undefined) ?? null,
    model: null,
    stream: null,
    toolNames: null,
  }
}

async function startStubProvider(
  port: number,
  options: { marker?: string; registryVersion?: string } = {}
): Promise<{ server: http.Server; requests: RecordedStubRequest[] }> {
  const marker = options.marker ?? 'Stub'
  const requests: RecordedStubRequest[] = []
  const rootPackage = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8')) as { version?: string }
  const currentVersion = options.registryVersion ?? rootPackage.version ?? '0.0.0'
  const server = http.createServer((req, res) => {
    // Test-introspection route: dump what the stub has received so far.
    if (req.method === 'GET' && req.url === '/__test/requests') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ requests }))
      return
    }

    if (req.method === 'GET' && req.url === '/user/balance') {
      requests.push(recordGet(req))
      // DeepSeek dashboard shape — the deepseek balance adapter's fixture.
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({
        is_available: true,
        balance_infos: [{ currency: 'CNY', total_balance: '110.00' }],
      }))
      return
    }

    if (req.method === 'GET' && req.url?.includes('cc-gw')) {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({
        'dist-tags': { latest: currentVersion },
        time: { [currentVersion]: '2026-03-30T03:45:32.000Z' },
      }))
      return
    }

    if (req.method === 'GET' && req.url === '/v1/models') {
      requests.push(recordGet(req))
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({
        object: 'list',
        data: [
          { id: 'stub-model', object: 'model' },
          { id: 'stub-model-probe', object: 'model', display_name: 'Stub Probe Model' },
        ],
      }))
      return
    }

    if (req.method !== 'POST') {
      res.statusCode = 405
      res.end()
      return
    }

    const chunks: Buffer[] = []
    req.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
    req.on('end', () => {
      let body: any = {}
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      } catch {}

      requests.push({
        method: req.method ?? 'POST',
        url: req.url ?? '',
        authorization: (req.headers.authorization as string | undefined) ?? null,
        xApiKey: (req.headers['x-api-key'] as string | undefined) ?? null,
        model: typeof body?.model === 'string' ? body.model : null,
        stream: typeof body?.stream === 'boolean' ? body.stream : null,
        toolNames: Array.isArray(body?.tools)
          ? body.tools
              .map((tool: any) => tool?.function?.name ?? tool?.name)
              .filter((name: any) => typeof name === 'string')
          : null,
      })

      if (req.url === '/v1/messages') {
        const rawMessages = JSON.stringify(body.messages ?? '')

        // Minimal Anthropic Messages surface (native anthropic-endpoint legs).
        if (body.stream === true) {
          // Protocol-conversion fixture: an empty text block followed by
          // interleaved thinking/text blocks, incl. two text blocks across one
          // message. Exercises per-block Responses item mapping and the
          // materialized (non-stream-via-stream) path.
          const events: Array<[string, Record<string, unknown>]> = rawMessages.includes('e2e-multi-block')
            ? [
                ['message_start', { type: 'message_start', message: { id: 'msg_multiblock', type: 'message', role: 'assistant', model: body.model ?? 'stub-model', content: [], usage: { input_tokens: 11, output_tokens: 1 } } }],
                ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }],
                ['content_block_stop', { type: 'content_block_stop', index: 0 }],
                ['content_block_start', { type: 'content_block_start', index: 1, content_block: { type: 'thinking', thinking: '' } }],
                ['content_block_delta', { type: 'content_block_delta', index: 1, delta: { type: 'thinking_delta', thinking: 'plan-a' } }],
                ['content_block_stop', { type: 'content_block_stop', index: 1 }],
                ['content_block_start', { type: 'content_block_start', index: 2, content_block: { type: 'text', text: '' } }],
                ['content_block_delta', { type: 'content_block_delta', index: 2, delta: { type: 'text_delta', text: 'hello ' } }],
                ['content_block_delta', { type: 'content_block_delta', index: 2, delta: { type: 'text_delta', text: 'world' } }],
                ['content_block_stop', { type: 'content_block_stop', index: 2 }],
                ['content_block_start', { type: 'content_block_start', index: 3, content_block: { type: 'thinking', thinking: '' } }],
                ['content_block_delta', { type: 'content_block_delta', index: 3, delta: { type: 'thinking_delta', thinking: 'plan-b' } }],
                ['content_block_stop', { type: 'content_block_stop', index: 3 }],
                ['content_block_start', { type: 'content_block_start', index: 4, content_block: { type: 'text', text: '' } }],
                ['content_block_delta', { type: 'content_block_delta', index: 4, delta: { type: 'text_delta', text: 'again' } }],
                ['content_block_stop', { type: 'content_block_stop', index: 4 }],
                ['message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 8 } }],
                ['message_stop', { type: 'message_stop' }],
              ]
            : [
                ['message_start', { type: 'message_start', message: { id: 'msg_stub', type: 'message', role: 'assistant', model: body.model ?? 'stub-model', content: [], usage: { input_tokens: 9, output_tokens: 1 } } }],
                ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }],
                ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: `${marker} anthropic stream` } }],
                ['content_block_stop', { type: 'content_block_stop', index: 0 }],
                ['message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 4 } }],
                ['message_stop', { type: 'message_stop' }],
              ]
          res.writeHead(200, { 'content-type': 'text/event-stream' })
          for (const [event, payload] of events) {
            res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`)
          }
          res.end()
          return
        }

        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({
          id: 'msg_stub',
          type: 'message',
          role: 'assistant',
          model: body.model ?? 'stub-model',
          content: [{ type: 'text', text: `${marker} anthropic response` }],
          stop_reason: 'end_turn',
          stop_sequence: null,
          usage: { input_tokens: 9, output_tokens: 4 },
        }))
        return
      }

      if (req.url === '/v1/chat/completions') {
        const message = Array.isArray(body.messages) && body.messages.length > 0
          ? body.messages[body.messages.length - 1]?.content ?? ''
          : ''
        const messageText = typeof message === 'string' ? message : ''

        // The aggregate-failover fixtures' "always broken" backends: lets e2e
        // exercise priority failover without tearing down the stub server.
        // `stub-model-broken` is a second dead model so the cross-provider
        // case starts from a fresh (not-yet-cooling) health key.
        if (body.model === 'stub-model-failing' || body.model === 'stub-model-broken') {
          res.writeHead(500, { 'content-type': 'application/json' })
          res.end(JSON.stringify({
            error: { message: `${body.model} always fails`, type: 'server_error', code: 500 },
          }))
          return
        }

        // Streaming requests get an OpenAI-style SSE stream. The trailing
        // prompt marker switches between the two usage chunk shapes real
        // upstreams use: top-level `usage` vs GLM-style nested in
        // choices[0].delta.usage — e2e asserts both reach the client. The
        // `no-usage` marker omits usage entirely: e2e asserts the gateway
        // then records NULL tokens instead of zeros.
        if (body.stream === true) {
          // Marker detection over the raw body: the converted content shape
          // varies (string vs content-part array), so match anywhere.
          const rawBody = JSON.stringify(body.messages ?? '')
          const nestUsageInDelta = rawBody.includes('delta-usage')
          const omitUsage = rawBody.includes('no-usage')
          const usageChunk = nestUsageInDelta
            ? { id: 'chatcmpl_stub', object: 'chat.completion.chunk', model: body.model ?? 'stub-model', choices: [{ index: 0, delta: { usage: { prompt_tokens: 41, completion_tokens: 7, total_tokens: 48 } } }] }
            : { id: 'chatcmpl_stub', object: 'chat.completion.chunk', model: body.model ?? 'stub-model', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 12, completion_tokens: 4, total_tokens: 16 } }
          res.writeHead(200, { 'content-type': 'text/event-stream' })
          res.write(`data: ${JSON.stringify({ id: 'chatcmpl_stub', object: 'chat.completion.chunk', model: body.model ?? 'stub-model', choices: [{ index: 0, delta: { role: 'assistant', content: `${marker} stream` } }] })}\n\n`)
          if (!omitUsage) {
            res.write(`data: ${JSON.stringify(usageChunk)}\n\n`)
          }
          res.end('data: [DONE]\n\n')
          return
        }

        const rawMessages = JSON.stringify(body.messages ?? '')
        // Protocol-conversion fixture: deprecated single `function_call`, a
        // separate `refusal` field, and `reasoning_content` — all in one
        // non-stream completion. Anthropic clients must see each exactly once.
        if (rawMessages.includes('e2e-chat-legacy-refusal')) {
          res.writeHead(200, { 'content-type': 'application/json' })
          res.end(JSON.stringify({
            id: 'chatcmpl_legacy',
            object: 'chat.completion',
            created: 1700000000,
            model: body.model ?? 'stub-model',
            choices: [{
              index: 0,
              message: {
                role: 'assistant',
                content: null,
                reasoning_content: 'legacy plan',
                refusal: 'I cannot help with that.',
                function_call: { id: 'call_legacy', name: 'lookup', arguments: '{"q":"x"}' },
              },
              finish_reason: 'stop',
            }],
            usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
          }))
          return
        }

        const omitUsage = rawMessages.includes('no-usage')
        const completion: Record<string, unknown> = {
          id: 'chatcmpl_stub',
          object: 'chat.completion',
          model: body.model ?? 'stub-model',
          choices: [{
            index: 0,
            message: { role: 'assistant', content: `${marker} response:${messageText}` },
            finish_reason: 'stop',
          }],
        }
        if (!omitUsage) {
          completion.usage = {
            prompt_tokens: 12,
            completion_tokens: 4,
            total_tokens: 16,
          }
        }
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify(completion))
        return
      }

      if (req.url === '/v1/responses') {
        const rawBody = JSON.stringify(body)
        const model = body.model ?? 'stub-model'

        if (body.stream === true) {
          const created = { id: 'resp_e2e', object: 'response', created_at: 1700000000, model, status: 'in_progress' }
          res.writeHead(200, { 'content-type': 'text/event-stream' })

          if (rawBody.includes('e2e-responses-multi-item')) {
            // Two reasoning/message pairs streamed as distinct Responses items.
            // The Anthropic conversion must keep one content block per item and
            // must not replay streamed text from `output_item.done`.
            const itemSources = [
              { id: 'rs_1', type: 'reasoning' },
              { id: 'msg_1', type: 'message' },
              { id: 'rs_2', type: 'reasoning' },
              { id: 'msg_2', type: 'message' },
            ]
            res.write(`data: ${JSON.stringify({ type: 'response.created', response: created })}\n\n`)
            res.write(`data: ${JSON.stringify({ type: 'response.output_item.added', output_index: 0, item: itemSources[0] })}\n\n`)
            res.write(`data: ${JSON.stringify({ type: 'response.reasoning_summary_text.delta', item_id: 'rs_1', output_index: 0, delta: 'plan' })}\n\n`)
            res.write(`data: ${JSON.stringify({
              type: 'response.output_item.done',
              output_index: 0,
              item: { id: 'rs_1', type: 'reasoning', summary: [{ type: 'summary_text', text: 'plan' }] },
            })}\n\n`)
            res.write(`data: ${JSON.stringify({ type: 'response.output_item.added', output_index: 1, item: itemSources[1] })}\n\n`)
            res.write(`data: ${JSON.stringify({ type: 'response.output_text.delta', item_id: 'msg_1', output_index: 1, delta: 'hello ' })}\n\n`)
            res.write(`data: ${JSON.stringify({ type: 'response.output_text.delta', item_id: 'msg_1', output_index: 1, delta: 'world' })}\n\n`)
            res.write(`data: ${JSON.stringify({ type: 'response.output_text.done', item_id: 'msg_1', output_index: 1, text: 'hello world' })}\n\n`)
            res.write(`data: ${JSON.stringify({
              type: 'response.output_item.done',
              output_index: 1,
              item: { id: 'msg_1', type: 'message', content: [{ type: 'output_text', text: 'hello world' }] },
            })}\n\n`)
            res.write(`data: ${JSON.stringify({ type: 'response.reasoning_summary_text.delta', item_id: 'rs_2', output_index: 2, delta: 'again' })}\n\n`)
            res.write(`data: ${JSON.stringify({ type: 'response.output_text.delta', item_id: 'msg_2', output_index: 3, delta: 'again' })}\n\n`)
            res.write(`data: ${JSON.stringify({
              type: 'response.completed',
              response: {
                ...created,
                status: 'completed',
                output: [
                  { id: 'rs_1', type: 'reasoning', summary: [{ type: 'summary_text', text: 'plan' }] },
                  { id: 'msg_1', type: 'message', content: [{ type: 'output_text', text: 'hello world' }] },
                  { id: 'rs_2', type: 'reasoning', summary: [{ type: 'summary_text', text: 'again' }] },
                  { id: 'msg_2', type: 'message', content: [{ type: 'output_text', text: 'again' }] },
                ],
                usage: { input_tokens: 6, output_tokens: 4, total_tokens: 10 },
              },
            })}\n\n`)
            res.end('data: [DONE]\n\n')
            return
          }

          if (rawBody.includes('e2e-responses-terminal-refusal')) {
            // Refusal appears only in the terminal output — no refusal delta.
            // The Anthropic conversion must still synthesize visible text and
            // a `refusal` stop reason from the completed snapshot.
            res.write(`data: ${JSON.stringify({ type: 'response.created', response: created })}\n\n`)
            res.write(`data: ${JSON.stringify({
              type: 'response.completed',
              response: {
                ...created,
                status: 'completed',
                output: [{
                  id: 'msg_terminal',
                  type: 'message',
                  role: 'assistant',
                  content: [{ type: 'refusal', refusal: 'Terminal refusal' }],
                }],
                usage: { input_tokens: 7, output_tokens: 2, total_tokens: 9 },
              },
            })}\n\n`)
            res.end('data: [DONE]\n\n')
            return
          }

          if (rawBody.includes('e2e-responses-refusal')) {
            res.write(`data: ${JSON.stringify({ type: 'response.created', response: created })}\n\n`)
            res.write(`data: ${JSON.stringify({
              type: 'response.refusal.delta',
              item_id: 'msg_refusal',
              output_index: 0,
              content_index: 0,
              delta: 'I cannot',
            })}\n\n`)
            res.write(`data: ${JSON.stringify({
              type: 'response.completed',
              response: {
                ...created,
                status: 'completed',
                output: [{
                  id: 'msg_refusal',
                  type: 'message',
                  role: 'assistant',
                  content: [{ type: 'refusal', refusal: 'I cannot' }],
                }],
                usage: { input_tokens: 7, output_tokens: 2, total_tokens: 9 },
              },
            })}\n\n`)
            res.end('data: [DONE]\n\n')
            return
          }

          res.write(`data: ${JSON.stringify({ type: 'response.created', response: created })}\n\n`)
          res.write(`data: ${JSON.stringify({
            type: 'response.output_text.delta',
            item_id: 'msg_stub',
            output_index: 0,
            content_index: 0,
            delta: 'Stub responses stream',
          })}\n\n`)
          res.write(`data: ${JSON.stringify({
            type: 'response.completed',
            response: {
              ...created,
              status: 'completed',
              output: [{
                id: 'msg_stub',
                type: 'message',
                role: 'assistant',
                content: [{ type: 'output_text', text: 'Stub responses stream', annotations: [] }],
              }],
              usage: { input_tokens: 8, output_tokens: 3, total_tokens: 11 },
            },
          })}\n\n`)
          res.end('data: [DONE]\n\n')
          return
        }

        if (rawBody.includes('e2e-responses-nonstream-refusal')) {
          res.writeHead(200, { 'content-type': 'application/json' })
          res.end(JSON.stringify({
            id: 'resp_refusal',
            object: 'response',
            created_at: 1700000000,
            model,
            status: 'completed',
            output: [{
              id: 'msg_refusal',
              type: 'message',
              role: 'assistant',
              content: [{ type: 'refusal', refusal: 'No.' }],
            }],
            usage: { input_tokens: 7, output_tokens: 1, total_tokens: 8 },
          }))
          return
        }

        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({
          id: 'resp_stub',
          object: 'response',
          created_at: 1700000000,
          model,
          status: 'completed',
          output: [{
            id: 'out_1',
            type: 'output_message',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'Stub responses output' }],
          }],
          output_text: 'Stub responses output',
          usage: {
            input_tokens: 8,
            output_tokens: 3,
            total_tokens: 11,
            prompt_tokens: 8,
            completion_tokens: 3,
          },
        }))
        return
      }

      res.statusCode = 404
      res.end()
    })
  })

  await new Promise<void>((resolve) => {
    server.listen(port, '127.0.0.1', () => resolve())
  })

  return { server, requests }
}

function createLegacyPasswordRecord(password: string): { passwordHash: string; passwordSalt: string } {
  const passwordSalt = crypto.randomBytes(16).toString('hex')
  const passwordHash = crypto
    .createHash('sha256')
    .update(passwordSalt, 'utf8')
    .update(password, 'utf8')
    .digest('hex')

  return { passwordHash, passwordSalt }
}

function writeConfig(
  tempHome: string,
  gatewayPort: number,
  stubPort: number,
  secondaryPort: number,
  options: GatewayHarnessOptions = {}
): void {
  const configDir = path.join(tempHome, '.cc-gw')
  fs.mkdirSync(configDir, { recursive: true })
  const configPath = path.join(configDir, 'config.json')
  const baseDefaults = {
    completion: 'stub-model',
    reasoning: null,
    background: null,
    longContextThreshold: 60_000,
  }

  const authRecord = options.auth?.enabled ? createLegacyPasswordRecord(options.auth.password) : null

  const stubProvider: Record<string, unknown> = {
    id: 'stub',
    label: 'Stub Provider',
    type: 'openai',
    baseUrl: `http://127.0.0.1:${stubPort}`,
    apiKey: 'stub-key',
    defaultModel: 'stub-model',
    models: [{ id: 'stub-model', label: 'Stub Model' }],
  }
  const providers: Array<Record<string, unknown>> = [stubProvider]
  if (options.secondaryUpstream) {
    // A second, genuinely separate upstream (own port + server process) so
    // aggregate member chains can span two providers.
    providers.push({
      id: 'secondary',
      label: 'Secondary Provider',
      type: 'openai',
      baseUrl: `http://127.0.0.1:${secondaryPort}`,
      apiKey: 'stub-key',
      defaultModel: 'stub-model-secondary',
      models: [{ id: 'stub-model-secondary', label: 'Secondary Model' }],
    })
  }
  if (options.protocolFixtures) {
    providers.push({
      id: 'anthropic-upstream',
      label: 'Anthropic Upstream',
      type: 'anthropic',
      baseUrl: `http://127.0.0.1:${stubPort}`,
      apiKey: 'stub-key',
      defaultModel: 'anthropic-model',
      models: [
        { id: 'anthropic-model', label: 'Anthropic Model' },
        { id: 'anthropic-materialized', label: 'Anthropic Materialized', nonStreamViaStream: true },
      ],
    })
    providers.push({
      id: 'responses-upstream',
      label: 'Responses Upstream',
      type: 'openai-responses',
      baseUrl: `http://127.0.0.1:${stubPort}`,
      apiKey: 'stub-key',
      defaultModel: 'responses-model',
      models: [{ id: 'responses-model', label: 'Responses Model' }],
    })
  }
  if (options.aggregate) {
    ;(stubProvider.models as Array<Record<string, unknown>>).push({
      id: 'stub-model-failing',
      label: 'Stub Failing Model',
    })
    const aggregateModels: Array<Record<string, unknown>> = [
      {
        id: 'agg-model',
        members: [{ target: 'stub:stub-model-failing' }, { target: 'stub:stub-model' }],
        failover: { consecutiveFailures: 1, cooldownSeconds: 60 },
      },
    ]
    if (options.secondaryUpstream) {
      ;(stubProvider.models as Array<Record<string, unknown>>).push({
        id: 'stub-model-broken',
        label: 'Stub Broken Model',
      })
      aggregateModels.push({
        id: 'agg-cross-model',
        members: [{ target: 'stub:stub-model-broken' }, { target: 'secondary:stub-model-secondary' }],
        failover: { consecutiveFailures: 1, cooldownSeconds: 60 },
      })
    }
    providers.push({
      id: 'agg',
      label: '聚合测试',
      type: 'aggregate',
      models: aggregateModels,
    })
  }

  const config = {
    host: '127.0.0.1',
    port: gatewayPort,
    providers,
    defaults: { ...baseDefaults },
    endpointRouting: {
      anthropic: { defaults: { ...baseDefaults }, modelRoutes: {} },
      openai: { defaults: { ...baseDefaults }, modelRoutes: {} },
    },
    logRetentionDays: 30,
    modelRoutes: {},
    storeRequestPayloads: true,
    storeResponsePayloads: true,
    logLevel: 'error',
    webAuth: {
      enabled: options.auth?.enabled ?? false,
      username: options.auth?.enabled ? options.auth.username : '',
      passwordHash: authRecord?.passwordHash ?? '',
      passwordSalt: authRecord?.passwordSalt ?? '',
    },
  }

  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8')
}

async function waitForServer(port: number): Promise<void> {
  const url = `http://127.0.0.1:${port}/health`
  for (let attempt = 0; attempt < 240; attempt += 1) {
    try {
      const response = await fetch(url)
      if (response.ok) {
        return
      }
    } catch {}
    await delay(250)
  }
  throw new Error(`Gateway did not become ready in time: ${url}`)
}

async function startGateway(tempHome: string, gatewayPort: number): Promise<ChildProcessWithoutNullStreams> {
  const cliPath = path.join(process.cwd(), 'src/cli/dist/index.js')
  const serverBinary = resolveBuiltServerBinary()
  const child = spawn(process.execPath, [cliPath, 'start', '--foreground', '--port', String(gatewayPort)], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      HOME: tempHome,
      NODE_ENV: 'test',
      ...(serverBinary ? { CC_GW_SERVER_BIN: serverBinary } : {}),
    },
    stdio: 'pipe',
  })

  child.stdout.on('data', (chunk) => {
    process.stdout.write(`[gateway] ${chunk}`)
  })
  child.stderr.on('data', (chunk) => {
    process.stderr.write(`[gateway-err] ${chunk}`)
  })

  return child
}

async function startGatewayWithStubRegistry(
  tempHome: string,
  gatewayPort: number,
  stubPort: number
): Promise<ChildProcessWithoutNullStreams> {
  const cliPath = path.join(process.cwd(), 'src/cli/dist/index.js')
  const serverBinary = resolveBuiltServerBinary()
  const child = spawn(process.execPath, [cliPath, 'start', '--foreground', '--port', String(gatewayPort)], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      HOME: tempHome,
      NODE_ENV: 'test',
      CC_GW_VERSION_CHECK_REGISTRY_BASE_URL: `http://127.0.0.1:${stubPort}`,
      ...(serverBinary ? { CC_GW_SERVER_BIN: serverBinary } : {}),
    },
    stdio: 'pipe',
  })

  child.stdout.on('data', (chunk) => {
    process.stdout.write(`[gateway] ${chunk}`)
  })
  child.stderr.on('data', (chunk) => {
    process.stderr.write(`[gateway-err] ${chunk}`)
  })

  return child
}

export function createGatewayHarness(options: GatewayHarnessOptions = {}): GatewayHarness {
  let stubRequestLog: RecordedStubRequest[] = []
  const harness: GatewayHarness = {
    tempHome: '',
    gatewayPort: 0,
    stubPort: 0,
    secondaryPort: 0,
    gatewayProcess: null,
    stubServer: null,
    secondaryServer: null,
    stubRequests: () => stubRequestLog,
    baseUrl: () => `http://127.0.0.1:${harness.gatewayPort}`,
    start: async () => {
      harness.stubPort = await findFreePort()
      harness.gatewayPort = await findFreePort()
      harness.tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-gw-web-e2e-'))
      const stub = await startStubProvider(harness.stubPort, {
        registryVersion: options.registryVersion,
      })
      harness.stubServer = stub.server
      stubRequestLog = stub.requests
      if (options.secondaryUpstream) {
        harness.secondaryPort = await findFreePort()
        const secondary = await startStubProvider(harness.secondaryPort, { marker: 'Secondary stub' })
        harness.secondaryServer = secondary.server
      }
      writeConfig(harness.tempHome, harness.gatewayPort, harness.stubPort, harness.secondaryPort, options)
      harness.gatewayProcess = await startGatewayWithStubRegistry(harness.tempHome, harness.gatewayPort, harness.stubPort)
      await waitForServer(harness.gatewayPort)
    },
    stop: async () => {
      if (harness.gatewayProcess) {
        harness.gatewayProcess.kill('SIGINT')
        await new Promise<void>((resolve) => {
          harness.gatewayProcess?.once('exit', () => resolve())
          setTimeout(() => resolve(), 2_000)
        })
      }
      if (harness.stubServer) {
        await new Promise<void>((resolve) => harness.stubServer?.close(() => resolve()))
      }
      if (harness.secondaryServer) {
        await new Promise<void>((resolve) => harness.secondaryServer?.close(() => resolve()))
      }
      if (harness.tempHome && fs.existsSync(harness.tempHome)) {
        fs.rmSync(harness.tempHome, { recursive: true, force: true })
      }
    },
  }
  return harness
}
