import type { ProfilerSessionDetail } from '@/types/profiler'

// ─── Lanes ────────────────────────────────────────────────────────────────────
// Three fixed lanes: Agent | LLM | Tools. All tool calls share the Tools lane;
// each arrow carries the concrete tool name as part of its label.

export type LaneId = 'agent' | 'llm' | 'tools'

export interface FlowLane {
  id: LaneId
  label: string
  /** sub-label rendered under the lane title (e.g. concrete model name) */
  sublabel?: string
}

// ─── Event types ──────────────────────────────────────────────────────────────

export interface RequestEvent {
  kind: 'request'
  id: string
  turnIndex: number
  messageKind: 'user' | 'tool-results' | 'mixed' | 'unknown'
  messageExcerpt: string
  inputTokens: number | null
  rawMessages: unknown
}

export interface ResponseEvent {
  kind: 'response'
  id: string
  turnIndex: number
  textExcerpt: string | null
  toolUseCount: number
  stopReason: string | null
  outputTokens: number | null
  latencyMs: number | null
  ttftMs: number | null
  rawContent: unknown
}

export interface ToolInvokeEvent {
  kind: 'tool-invoke'
  id: string
  turnIndex: number
  toolName: string
  toolCallId: string
  inputPreview: string
  rawInput: unknown
}

export interface ToolResultEvent {
  kind: 'tool-result'
  id: string
  turnIndex: number
  toolName: string
  toolCallId: string
  resultPreview: string
  isError: boolean
  rawResult: unknown
  /** ms between the originating tool-invoke and this result (best-effort: latency of the next request that carried this result) */
  durationMs: number | null
}

export interface ErrorEvent {
  kind: 'error'
  id: string
  turnIndex: number
  message: string
  statusCode: number | null
}

export type FlowEvent =
  | RequestEvent
  | ResponseEvent
  | ToolInvokeEvent
  | ToolResultEvent
  | ErrorEvent

// ─── Turn & graph ─────────────────────────────────────────────────────────────

export interface FlowTurn {
  index: number
  events: FlowEvent[]
  startOffsetMs: number
  endOffsetMs: number
  inputTokens: number | null
  outputTokens: number | null
  latencyMs: number | null
  ttftMs: number | null
  hasError: boolean
  toolCallCount: number
}

export interface FlowGraph {
  lanes: FlowLane[]
  turns: FlowTurn[]
  sessionDurationMs: number
  totalToolCalls: number
  uniqueToolNames: string[]
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function safeParseJson(raw: string | null | undefined): unknown {
  if (!raw) return null
  try { return JSON.parse(raw) } catch { return null }
}

function isObj(val: unknown): val is Record<string, unknown> {
  return val !== null && typeof val === 'object' && !Array.isArray(val)
}

function trunc(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max - 1) + '…'
}

function textFromContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    for (const item of content) {
      if (isObj(item) && item.type === 'text' && typeof item.text === 'string') return item.text
    }
  }
  return ''
}

function inputPreview(input: unknown): string {
  if (!isObj(input)) return ''
  const entries = Object.entries(input)
  if (!entries.length) return ''
  const [k, v] = entries[0]
  const s = typeof v === 'string' ? `"${trunc(v, 60)}"` : String(v)
  return `${k}: ${s}`
}

function resultPreview(content: unknown): string {
  if (typeof content === 'string') return trunc(content, 120)
  if (Array.isArray(content)) {
    for (const item of content) {
      if (isObj(item) && item.type === 'text' && typeof item.text === 'string') return trunc(item.text, 120)
    }
    return trunc(JSON.stringify(content), 120)
  }
  if (isObj(content)) return trunc(JSON.stringify(content), 120)
  return ''
}

// ─── Protocol detection ───────────────────────────────────────────────────────

type Protocol = 'anthropic' | 'openai' | 'unknown'

function detectProtocol(req: unknown, res: unknown): Protocol {
  if (isObj(res) && Array.isArray(res.choices)) return 'openai'
  if (isObj(res) && Array.isArray(res.content)) return 'anthropic'
  if (isObj(req) && Array.isArray(req.messages)) {
    for (const m of req.messages as unknown[]) {
      if (isObj(m) && m.role === 'tool') return 'openai'
    }
    return 'anthropic'
  }
  return 'unknown'
}

// ─── Tool extraction ──────────────────────────────────────────────────────────

interface ToolUseInfo { id: string; name: string; input: unknown }
interface ToolResultInfo { toolCallId: string; content: unknown; isError: boolean }

function extractToolUses(res: unknown, proto: Protocol): ToolUseInfo[] {
  if (proto === 'openai') {
    if (!isObj(res) || !Array.isArray(res.choices)) return []
    const msg = (res.choices[0] as Record<string, unknown>)?.message
    if (!isObj(msg) || !Array.isArray(msg.tool_calls)) return []
    return (msg.tool_calls as Record<string, unknown>[])
      .filter(tc => tc.id && isObj(tc.function) && (tc.function as Record<string, unknown>).name)
      .map(tc => {
        const fn = tc.function as Record<string, unknown>
        let input: unknown = {}
        try { input = JSON.parse(String(fn.arguments ?? '{}')) } catch { /* keep empty */ }
        return { id: String(tc.id), name: String(fn.name), input }
      })
  }
  // Anthropic
  if (!isObj(res) || !Array.isArray(res.content)) return []
  return (res.content as Record<string, unknown>[])
    .filter(b => b.type === 'tool_use' && b.id && b.name)
    .map(b => ({ id: String(b.id), name: String(b.name), input: b.input }))
}

function extractToolResults(req: unknown, proto: Protocol): ToolResultInfo[] {
  if (!isObj(req) || !Array.isArray(req.messages)) return []
  const msgs = req.messages as Record<string, unknown>[]

  if (proto === 'openai') {
    return msgs
      .filter(m => m.role === 'tool' && m.tool_call_id)
      .map(m => ({ toolCallId: String(m.tool_call_id), content: m.content, isError: false }))
  }
  // Anthropic: look for user messages with tool_result blocks
  const results: ToolResultInfo[] = []
  for (const msg of msgs) {
    if (msg.role !== 'user' || !Array.isArray(msg.content)) continue
    for (const block of msg.content as Record<string, unknown>[]) {
      if (block.type === 'tool_result' && block.tool_use_id) {
        results.push({
          toolCallId: String(block.tool_use_id),
          content: block.content,
          isError: block.is_error === true,
        })
      }
    }
  }
  return results
}

function extractRequestInfo(req: unknown, proto: Protocol): {
  messageKind: RequestEvent['messageKind']
  messageExcerpt: string
} {
  if (!isObj(req) || !Array.isArray(req.messages)) return { messageKind: 'unknown', messageExcerpt: '' }
  const msgs = (req.messages as Record<string, unknown>[]).filter(m => m.role !== 'system')
  if (!msgs.length) return { messageKind: 'unknown', messageExcerpt: '' }
  const last = msgs[msgs.length - 1]

  if (proto === 'openai') {
    if (last.role === 'tool') {
      const count = msgs.filter(m => m.role === 'tool').length
      return { messageKind: 'tool-results', messageExcerpt: `${count} tool result${count !== 1 ? 's' : ''}` }
    }
    if (last.role === 'user') {
      return { messageKind: 'user', messageExcerpt: trunc(String(last.content ?? ''), 80) }
    }
    return { messageKind: 'unknown', messageExcerpt: '' }
  }

  // Anthropic
  if (last.role === 'user') {
    if (Array.isArray(last.content)) {
      const blocks = last.content as Record<string, unknown>[]
      const hasToolResult = blocks.some(b => b.type === 'tool_result')
      const hasText = blocks.some(b => b.type === 'text')
      if (hasToolResult && hasText) return { messageKind: 'mixed', messageExcerpt: '' }
      if (hasToolResult) {
        const count = blocks.filter(b => b.type === 'tool_result').length
        return { messageKind: 'tool-results', messageExcerpt: `${count} tool result${count !== 1 ? 's' : ''}` }
      }
      return { messageKind: 'user', messageExcerpt: trunc(textFromContent(last.content), 80) }
    }
    return { messageKind: 'user', messageExcerpt: trunc(String(last.content ?? ''), 80) }
  }
  return { messageKind: 'unknown', messageExcerpt: '' }
}

function extractResponseText(res: unknown, proto: Protocol): string | null {
  if (proto === 'openai') {
    if (!isObj(res) || !Array.isArray(res.choices)) return null
    const msg = (res.choices[0] as Record<string, unknown>)?.message
    if (!isObj(msg)) return null
    const text = String(msg.content ?? '')
    return text ? trunc(text, 80) : null
  }
  if (!isObj(res)) return null
  const text = textFromContent(res.content)
  return text ? trunc(text, 80) : null
}

function extractStopReason(res: unknown, proto: Protocol): string | null {
  if (!isObj(res)) return null
  if (proto === 'anthropic') return typeof res.stop_reason === 'string' ? res.stop_reason : null
  if (proto === 'openai') {
    const choice = (res.choices as unknown[])?.[0]
    if (isObj(choice)) return typeof choice.finish_reason === 'string' ? choice.finish_reason : null
  }
  return null
}

function extractRawContent(res: unknown, proto: Protocol): unknown {
  if (!isObj(res)) return null
  if (proto === 'anthropic') return res.content ?? null
  if (proto === 'openai') return res.choices ?? null
  return null
}

// ─── Main builder ─────────────────────────────────────────────────────────────

export function buildFlowGraph(detail: ProfilerSessionDetail): FlowGraph {
  const { records, startedAt } = detail
  if (!records.length) {
    return { lanes: [], turns: [], sessionDurationMs: 0, totalToolCalls: 0, uniqueToolNames: [] }
  }

  const sorted = [...records].sort((a, b) => a.turnIndex - b.turnIndex)

  // Collect unique tool names in order of first appearance
  const uniqueToolNames: string[] = []
  const seenTools = new Set<string>()
  for (const r of sorted) {
    const res = safeParseJson(r.clientResponse)
    const req = safeParseJson(r.clientRequest)
    for (const t of extractToolUses(res, detectProtocol(req, res))) {
      if (!seenTools.has(t.name)) { seenTools.add(t.name); uniqueToolNames.push(t.name) }
    }
  }

  const agentLabel = (() => {
    switch (sorted[0].clientKind) {
      case 'claude-code': return 'Claude Code'
      case 'codex': return 'Codex'
      case 'opencode': return 'OpenCode'
      default: return 'Agent'
    }
  })()

  const lanes: FlowLane[] = [
    { id: 'agent', label: agentLabel },
    { id: 'llm', label: 'LLM', sublabel: trunc(sorted[0].model ?? '', 32) || undefined },
    {
      id: 'tools',
      label: 'Tools',
      sublabel: uniqueToolNames.length
        ? `${uniqueToolNames.length} tool${uniqueToolNames.length !== 1 ? 's' : ''}`
        : undefined,
    },
  ]

  // Registry not strictly needed since results come in the immediate next request,
  // but kept to attribute totals.
  let totalToolCalls = 0
  const turns: FlowTurn[] = []

  for (let i = 0; i < sorted.length; i++) {
    const r = sorted[i]
    const next = sorted[i + 1]

    const req = safeParseJson(r.clientRequest)
    const res = safeParseJson(r.clientResponse)
    const proto = detectProtocol(req, res)

    const startOffset = r.timestamp - startedAt
    const endOffset = startOffset + (r.latencyMs ?? 0)
    const events: FlowEvent[] = []

    // 1. Request (Agent → LLM)
    const { messageKind, messageExcerpt } = extractRequestInfo(req, proto)
    events.push({
      kind: 'request',
      id: `t${r.turnIndex}-req`,
      turnIndex: r.turnIndex,
      messageKind,
      messageExcerpt,
      inputTokens: r.inputTokens,
      rawMessages: isObj(req) ? req.messages : null,
    } satisfies RequestEvent)

    // 2. Response (LLM → Agent)
    const toolUses = extractToolUses(res, proto)

    events.push({
      kind: 'response',
      id: `t${r.turnIndex}-res`,
      turnIndex: r.turnIndex,
      textExcerpt: extractResponseText(res, proto),
      toolUseCount: toolUses.length,
      stopReason: extractStopReason(res, proto),
      outputTokens: r.outputTokens,
      latencyMs: r.latencyMs,
      ttftMs: r.ttftMs,
      rawContent: extractRawContent(res, proto),
    } satisfies ResponseEvent)

    // 3. Error (if any)
    if (r.error) {
      events.push({
        kind: 'error',
        id: `t${r.turnIndex}-err`,
        turnIndex: r.turnIndex,
        message: r.error,
        statusCode: r.statusCode,
      } satisfies ErrorEvent)
    }

    // 4. Tool invocations (Agent → Tools), one per tool_use, immediately followed
    //    by the matching result if it was carried in the next request.
    const nextReq = next ? safeParseJson(next.clientRequest) : null
    const nextProto = next ? detectProtocol(nextReq, null) : 'unknown' as const
    const nextResults = next ? extractToolResults(nextReq, nextProto) : []
    const resultByCallId = new Map(nextResults.map(r => [r.toolCallId, r] as const))
    const nextLatency = next?.latencyMs ?? null

    for (const t of toolUses) {
      events.push({
        kind: 'tool-invoke',
        id: `t${r.turnIndex}-invoke-${t.id}`,
        turnIndex: r.turnIndex,
        toolName: t.name,
        toolCallId: t.id,
        inputPreview: inputPreview(t.input),
        rawInput: t.input,
      } satisfies ToolInvokeEvent)
      totalToolCalls++

      const result = resultByCallId.get(t.id)
      if (result) {
        events.push({
          kind: 'tool-result',
          id: `t${r.turnIndex}-result-${t.id}`,
          turnIndex: r.turnIndex,
          toolName: t.name,
          toolCallId: t.id,
          resultPreview: resultPreview(result.content),
          isError: result.isError,
          rawResult: result.content,
          durationMs: nextLatency,
        } satisfies ToolResultEvent)
      }
    }

    turns.push({
      index: r.turnIndex,
      events,
      startOffsetMs: startOffset,
      endOffsetMs: endOffset,
      inputTokens: r.inputTokens,
      outputTokens: r.outputTokens,
      latencyMs: r.latencyMs,
      ttftMs: r.ttftMs,
      hasError: !!r.error,
      toolCallCount: toolUses.length,
    })
  }

  const lastRecord = sorted[sorted.length - 1]
  const sessionDurationMs =
    (detail.endedAt ?? (lastRecord.timestamp + (lastRecord.latencyMs ?? 0))) - startedAt

  return { lanes, turns, sessionDurationMs, totalToolCalls, uniqueToolNames }
}
