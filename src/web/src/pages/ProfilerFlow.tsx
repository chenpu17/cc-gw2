import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ProfilerSessionDetail } from '@/types/profiler'
import {
  buildFlowGraph,
  type FlowEvent,
  type FlowGraph,
  type FlowLane,
  type FlowTurn,
  type LaneId,
} from './profilerFlowGraph'

// ─── Layout constants ─────────────────────────────────────────────────────────

const HEADER_HEIGHT = 64        // lane title row
const TURN_HEADER_HEIGHT = 28   // "Turn N" separator
const ROW_HEIGHT = 56           // height per event row
const TURN_PADDING_BOTTOM = 12  // small spacer below each turn
const SIDE_PADDING = 24
const MIN_WIDTH = 640

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtMs(ms: number | null | undefined): string {
  if (ms == null) return '–'
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`
  return `${Math.round(ms)}ms`
}

function fmtTokens(n: number | null | undefined): string {
  if (n == null) return ''
  return n.toLocaleString()
}

function trunc(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max - 1) + '…'
}

// ─── Lane mapping ─────────────────────────────────────────────────────────────

interface LaneGeom {
  id: LaneId
  label: string
  sublabel?: string
  x: number    // center x
}

function computeLaneGeom(lanes: FlowLane[], width: number): LaneGeom[] {
  const usable = Math.max(width - SIDE_PADDING * 2, 200)
  const step = usable / (lanes.length - 1 || 1)
  return lanes.map((l, i) => ({
    id: l.id,
    label: l.label,
    sublabel: l.sublabel,
    x: SIDE_PADDING + step * i,
  }))
}

// ─── Layout: turns → row positions ────────────────────────────────────────────

interface RowPlacement {
  turnIndex: number
  /** y of row centerline */
  y: number
  event: FlowEvent
}

interface TurnPlacement {
  turn: FlowTurn
  /** y at which the turn header divider sits */
  headerY: number
  /** y at which the turn block ends (after last row + padding) */
  endY: number
  rows: RowPlacement[]
}

function layoutTurns(graph: FlowGraph): { turns: TurnPlacement[]; totalHeight: number } {
  const turns: TurnPlacement[] = []
  let cursor = HEADER_HEIGHT

  for (const turn of graph.turns) {
    const headerY = cursor + TURN_HEADER_HEIGHT / 2
    cursor += TURN_HEADER_HEIGHT

    const rows: RowPlacement[] = turn.events.map((event) => {
      const y = cursor + ROW_HEIGHT / 2
      cursor += ROW_HEIGHT
      return { turnIndex: turn.index, y, event }
    })

    cursor += TURN_PADDING_BOTTOM
    turns.push({ turn, headerY, endY: cursor, rows })
  }

  return { turns, totalHeight: cursor + 12 }
}

// ─── Event → arrow descriptor ─────────────────────────────────────────────────

interface ArrowDescriptor {
  src: LaneId
  tgt: LaneId
  /** primary label rendered above the arrow */
  label: string
  /** sub-label rendered below the arrow */
  sublabel?: string
  /** stroke style */
  style: 'solid' | 'dashed'
  /** color theme */
  tone: 'request' | 'response' | 'invoke' | 'result' | 'error'
  /** isError variant for tool-result */
  isError?: boolean
}

function arrowFor(event: FlowEvent): ArrowDescriptor | null {
  switch (event.kind) {
    case 'request': {
      const kindTag = event.messageKind === 'tool-results' ? 'tool results'
        : event.messageKind === 'mixed' ? 'mixed'
        : event.messageKind === 'user' ? 'user'
        : 'request'
      const label = event.messageExcerpt
        ? `${kindTag}: ${trunc(event.messageExcerpt, 80)}`
        : kindTag
      const sublabel = event.inputTokens != null ? `↑ ${fmtTokens(event.inputTokens)} tok` : undefined
      return { src: 'agent', tgt: 'llm', label, sublabel, style: 'solid', tone: 'request' }
    }
    case 'response': {
      const parts: string[] = []
      if (event.textExcerpt) parts.push(`"${trunc(event.textExcerpt, 60)}"`)
      if (event.toolUseCount > 0) parts.push(`${event.toolUseCount} tool_use`)
      if (event.stopReason) parts.push(event.stopReason)
      const label = parts.join(' · ') || '(empty)'
      const subParts: string[] = []
      if (event.outputTokens != null) subParts.push(`↓ ${fmtTokens(event.outputTokens)} tok`)
      if (event.ttftMs != null) subParts.push(`TTFT ${fmtMs(event.ttftMs)}`)
      if (event.latencyMs != null) subParts.push(fmtMs(event.latencyMs))
      return { src: 'llm', tgt: 'agent', label, sublabel: subParts.join(' · ') || undefined, style: 'dashed', tone: 'response' }
    }
    case 'tool-invoke': {
      const label = event.inputPreview
        ? `${event.toolName}(${trunc(event.inputPreview, 80)})`
        : `${event.toolName}()`
      return { src: 'agent', tgt: 'tools', label, style: 'solid', tone: 'invoke' }
    }
    case 'tool-result': {
      const label = event.isError
        ? `error: ${trunc(event.resultPreview || 'error', 80)}`
        : trunc(event.resultPreview || '(empty)', 100)
      const sublabel = event.durationMs != null ? fmtMs(event.durationMs) : undefined
      return {
        src: 'tools', tgt: 'agent', label, sublabel, style: 'dashed',
        tone: event.isError ? 'error' : 'result',
        isError: event.isError,
      }
    }
    case 'error': {
      const label = `${event.statusCode ?? 'ERR'} · ${trunc(event.message, 100)}`
      return { src: 'llm', tgt: 'agent', label, style: 'dashed', tone: 'error' }
    }
  }
}

// ─── Tone styling ─────────────────────────────────────────────────────────────

const TONE: Record<ArrowDescriptor['tone'], { stroke: string; fill: string; text: string; activation?: string }> = {
  request:  { stroke: 'stroke-indigo-500',  fill: 'fill-indigo-500',  text: 'fill-indigo-700  dark:fill-indigo-300' },
  response: { stroke: 'stroke-violet-500',  fill: 'fill-violet-500',  text: 'fill-violet-700  dark:fill-violet-300', activation: 'fill-violet-400/40 dark:fill-violet-500/30' },
  invoke:   { stroke: 'stroke-amber-500',   fill: 'fill-amber-500',   text: 'fill-amber-700   dark:fill-amber-300' },
  result:   { stroke: 'stroke-emerald-500', fill: 'fill-emerald-500', text: 'fill-emerald-700 dark:fill-emerald-300', activation: 'fill-emerald-400/40 dark:fill-emerald-500/25' },
  error:    { stroke: 'stroke-rose-500',    fill: 'fill-rose-500',    text: 'fill-rose-700    dark:fill-rose-300' },
}

// ─── Activation bars ──────────────────────────────────────────────────────────
// Compute LLM activation bars (between request and response of the same turn)
// and Tool activation bars (between tool-invoke and matching tool-result).

interface ActivationBar {
  laneId: LaneId
  y1: number
  y2: number
  tone: 'response' | 'result'
}

function computeActivations(turns: TurnPlacement[]): ActivationBar[] {
  const bars: ActivationBar[] = []
  for (const t of turns) {
    let reqY: number | null = null
    const invokeMap = new Map<string, number>()
    for (const row of t.rows) {
      const ev = row.event
      if (ev.kind === 'request') reqY = row.y
      else if (ev.kind === 'response' && reqY != null) {
        bars.push({ laneId: 'llm', y1: reqY, y2: row.y, tone: 'response' })
        reqY = null
      } else if (ev.kind === 'tool-invoke') {
        invokeMap.set(ev.toolCallId, row.y)
      } else if (ev.kind === 'tool-result') {
        const y1 = invokeMap.get(ev.toolCallId)
        if (y1 != null) {
          bars.push({ laneId: 'tools', y1, y2: row.y, tone: 'result' })
          invokeMap.delete(ev.toolCallId)
        }
      }
    }
  }
  return bars
}

// ─── Arrow rendering ──────────────────────────────────────────────────────────

interface ArrowRowProps {
  y: number
  arrow: ArrowDescriptor
  laneByX: Record<LaneId, number>
  active: boolean
  onClick: () => void
  eventId: string
}

function ArrowRow({ y, arrow, laneByX, active, onClick, eventId }: ArrowRowProps) {
  const x1 = laneByX[arrow.src]
  const x2 = laneByX[arrow.tgt]
  const tone = TONE[arrow.tone]
  const dir = x2 > x1 ? 1 : -1
  // Arrow head insets so it doesn't overlap lifeline:
  const HEAD_INSET = 6
  const lineX1 = x1
  const lineX2 = x2 - dir * HEAD_INSET
  const labelX = (x1 + x2) / 2
  const labelY = y - 8
  const sublabelY = y + 16

  return (
    <g
      data-event-id={eventId}
      className="cursor-pointer"
      onClick={onClick}
    >
      {/* Hover hit area */}
      <rect
        x={Math.min(x1, x2) - 12}
        y={y - ROW_HEIGHT / 2 + 2}
        width={Math.abs(x2 - x1) + 24}
        height={ROW_HEIGHT - 4}
        className={cn(
          'transition-colors',
          active ? 'fill-foreground/[0.06]' : 'fill-transparent hover:fill-foreground/[0.04]',
        )}
        rx={6}
      />

      {/* The line */}
      <line
        x1={lineX1}
        y1={y}
        x2={lineX2}
        y2={y}
        className={cn(tone.stroke, 'pointer-events-none')}
        strokeWidth={1.6}
        strokeDasharray={arrow.style === 'dashed' ? '5 4' : undefined}
      />

      {/* Arrow head (filled triangle) */}
      <polygon
        points={`${x2},${y} ${x2 - dir * 7},${y - 4} ${x2 - dir * 7},${y + 4}`}
        className={cn(tone.fill, 'pointer-events-none')}
      />

      {/* Label */}
      <text
        x={labelX}
        y={labelY}
        textAnchor="middle"
        className={cn('pointer-events-none select-none text-[11px] font-medium', tone.text)}
      >
        {arrow.label}
      </text>

      {/* Sublabel */}
      {arrow.sublabel && (
        <text
          x={labelX}
          y={sublabelY}
          textAnchor="middle"
          className="pointer-events-none select-none fill-muted-foreground text-[10px]"
        >
          {arrow.sublabel}
        </text>
      )}
    </g>
  )
}

// ─── Lane header ──────────────────────────────────────────────────────────────

function LaneHeader({ lane }: { lane: LaneGeom }) {
  const labelColor = lane.id === 'agent' ? 'fill-indigo-700 dark:fill-indigo-300'
    : lane.id === 'llm' ? 'fill-violet-700 dark:fill-violet-300'
    : 'fill-amber-700 dark:fill-amber-300'
  const bgColor = lane.id === 'agent' ? 'fill-indigo-50 dark:fill-indigo-500/10'
    : lane.id === 'llm' ? 'fill-violet-50 dark:fill-violet-500/10'
    : 'fill-amber-50 dark:fill-amber-500/10'
  const borderColor = lane.id === 'agent' ? 'stroke-indigo-300 dark:stroke-indigo-500/40'
    : lane.id === 'llm' ? 'stroke-violet-300 dark:stroke-violet-500/40'
    : 'stroke-amber-300 dark:stroke-amber-500/40'

  const padX = 14
  const labelLen = Math.max(lane.label.length, lane.sublabel?.length ?? 0)
  const boxW = Math.max(96, labelLen * 7 + padX * 2)
  const boxH = lane.sublabel ? 44 : 28

  return (
    <g>
      <rect
        x={lane.x - boxW / 2}
        y={10}
        width={boxW}
        height={boxH}
        rx={6}
        className={cn(bgColor, borderColor)}
        strokeWidth={1}
      />
      <text
        x={lane.x}
        y={lane.sublabel ? 24 : 28}
        textAnchor="middle"
        className={cn('select-none text-[12px] font-semibold', labelColor)}
      >
        {lane.label}
      </text>
      {lane.sublabel && (
        <text
          x={lane.x}
          y={40}
          textAnchor="middle"
          className="select-none fill-muted-foreground text-[10px]"
        >
          {lane.sublabel}
        </text>
      )}
    </g>
  )
}

// ─── Detail panel (side drawer) ───────────────────────────────────────────────

function JsonBlock({ data }: { data: unknown }) {
  if (data == null) return <span className="text-muted-foreground">(empty)</span>
  return (
    <pre className="overflow-auto rounded bg-muted/60 p-3 text-[11px] leading-relaxed text-foreground">
      {JSON.stringify(data, null, 2)}
    </pre>
  )
}

function MetricRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium tabular-nums">{value}</span>
    </div>
  )
}

function DetailSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <h4 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</h4>
      {children}
    </div>
  )
}

const KIND_BADGE: Record<FlowEvent['kind'], { label: string; classes: string }> = {
  request:       { label: 'Request',     classes: 'bg-indigo-50  text-indigo-700  border-indigo-200  dark:bg-indigo-500/15  dark:text-indigo-300  dark:border-indigo-500/30' },
  response:      { label: 'Response',    classes: 'bg-violet-50  text-violet-700  border-violet-200  dark:bg-violet-500/15  dark:text-violet-300  dark:border-violet-500/30' },
  'tool-invoke': { label: 'Tool Invoke', classes: 'bg-amber-50   text-amber-700   border-amber-200   dark:bg-amber-500/15   dark:text-amber-300   dark:border-amber-500/30' },
  'tool-result': { label: 'Tool Result', classes: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-500/30' },
  error:         { label: 'Error',       classes: 'bg-rose-50    text-rose-700    border-rose-200    dark:bg-rose-500/15    dark:text-rose-300    dark:border-rose-500/30' },
}

function DetailPanel({ event, onClose }: { event: FlowEvent; onClose: () => void }) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  const renderContent = () => {
    if (event.kind === 'request') {
      return (
        <div className="space-y-4">
          <DetailSection title="Info">
            <MetricRow label="Turn" value={`#${event.turnIndex + 1}`} />
            <MetricRow label="Kind" value={event.messageKind} />
            {event.inputTokens != null && <MetricRow label="Input tokens" value={event.inputTokens.toLocaleString()} />}
          </DetailSection>
          <DetailSection title="Messages">
            <JsonBlock data={event.rawMessages} />
          </DetailSection>
        </div>
      )
    }
    if (event.kind === 'response') {
      return (
        <div className="space-y-4">
          <DetailSection title="Metrics">
            <MetricRow label="Turn" value={`#${event.turnIndex + 1}`} />
            {event.latencyMs != null && <MetricRow label="Latency" value={fmtMs(event.latencyMs)} />}
            {event.ttftMs != null && <MetricRow label="TTFT" value={fmtMs(event.ttftMs)} />}
            {event.outputTokens != null && <MetricRow label="Output tokens" value={event.outputTokens.toLocaleString()} />}
            {event.stopReason && <MetricRow label="Stop reason" value={event.stopReason} />}
          </DetailSection>
          <DetailSection title="Content">
            <JsonBlock data={event.rawContent} />
          </DetailSection>
        </div>
      )
    }
    if (event.kind === 'tool-invoke') {
      return (
        <div className="space-y-4">
          <DetailSection title="Info">
            <MetricRow label="Turn" value={`#${event.turnIndex + 1}`} />
            <MetricRow label="Tool" value={event.toolName} />
            <MetricRow label="Call ID" value={event.toolCallId} />
          </DetailSection>
          <DetailSection title="Input">
            <JsonBlock data={event.rawInput} />
          </DetailSection>
        </div>
      )
    }
    if (event.kind === 'tool-result') {
      return (
        <div className="space-y-4">
          <DetailSection title="Info">
            <MetricRow label="Turn" value={`#${event.turnIndex + 1}`} />
            <MetricRow label="Tool" value={event.toolName} />
            <MetricRow label="Status" value={event.isError ? 'error' : 'success'} />
            {event.durationMs != null && <MetricRow label="Duration" value={fmtMs(event.durationMs)} />}
          </DetailSection>
          <DetailSection title="Result">
            <JsonBlock data={event.rawResult} />
          </DetailSection>
        </div>
      )
    }
    return (
      <div className="space-y-4">
        <DetailSection title="Info">
          <MetricRow label="Turn" value={`#${event.turnIndex + 1}`} />
          {event.statusCode != null && <MetricRow label="Status code" value={String(event.statusCode)} />}
        </DetailSection>
        <DetailSection title="Message">
          <p className="text-sm text-rose-600 dark:text-rose-400">{event.message}</p>
        </DetailSection>
      </div>
    )
  }

  const badge = KIND_BADGE[event.kind]

  return (
    <>
      <div className="fixed inset-0 z-30 bg-black/10" onClick={onClose} aria-hidden="true" />
      <div
        className="fixed right-0 top-0 z-40 flex h-full w-[440px] flex-col border-l border-border bg-background shadow-xl"
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <span className={cn('rounded border px-2 py-0.5 text-xs font-semibold', badge.classes)}>
              {badge.label}
            </span>
            <span className="text-sm font-medium text-foreground">Turn {event.turnIndex + 1}</span>
          </div>
          <button type="button" onClick={onClose} className="rounded p-1 text-muted-foreground hover:bg-muted">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 overflow-auto p-4">{renderContent()}</div>
      </div>
    </>
  )
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyFlow() {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
      <p className="text-sm font-medium text-muted-foreground">No flow data available</p>
      <p className="max-w-xs text-xs text-muted-foreground/70">
        This session has no parseable request/response payloads.
      </p>
    </div>
  )
}

// ─── Main FlowPanel ───────────────────────────────────────────────────────────

export function FlowPanel({ detail }: { detail: ProfilerSessionDetail }) {
  const { t } = useTranslation()
  const graph = useMemo(() => buildFlowGraph(detail), [detail])
  const [activeId, setActiveId] = useState<string | null>(null)

  const containerRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(MIN_WIDTH)

  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el) return
    const update = () => setWidth(Math.max(el.clientWidth, MIN_WIDTH))
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const lanes = useMemo(() => computeLaneGeom(graph.lanes, width), [graph.lanes, width])
  const laneByX = useMemo(() => {
    const m = {} as Record<LaneId, number>
    for (const l of lanes) m[l.id] = l.x
    return m
  }, [lanes])

  const { turns: placedTurns, totalHeight } = useMemo(() => layoutTurns(graph), [graph])
  const activations = useMemo(() => computeActivations(placedTurns), [placedTurns])

  const activeEvent = useMemo(() => {
    if (!activeId) return null
    for (const tp of placedTurns) {
      const r = tp.rows.find(r => r.event.id === activeId)
      if (r) return r.event
    }
    return null
  }, [activeId, placedTurns])

  if (!graph.turns.length) return <EmptyFlow />

  return (
    <div ref={containerRef} className="relative overflow-x-auto overflow-y-hidden">
      {/* Summary bar */}
      <div className="flex items-center gap-3 border-b border-border bg-secondary/30 px-4 py-1.5 text-[11px] text-muted-foreground">
        <span>{graph.turns.length} turn{graph.turns.length !== 1 ? 's' : ''}</span>
        {graph.totalToolCalls > 0 && (
          <span className="rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
            ⚡ {graph.totalToolCalls} tool call{graph.totalToolCalls !== 1 ? 's' : ''}
          </span>
        )}
        <span className="ml-auto tabular-nums">{fmtMs(graph.sessionDurationMs)} total</span>
      </div>

      <svg
        width={width}
        height={totalHeight}
        viewBox={`0 0 ${width} ${totalHeight}`}
        className="block"
      >
        {/* Lifelines */}
        {lanes.map(l => (
          <line
            key={l.id}
            x1={l.x}
            x2={l.x}
            y1={HEADER_HEIGHT}
            y2={totalHeight - 8}
            className="stroke-border"
            strokeWidth={1}
            strokeDasharray="3 4"
          />
        ))}

        {/* Lane headers (sticky-ish: drawn first, but we also overlay a background to mask scroll) */}
        <rect x={0} y={0} width={width} height={HEADER_HEIGHT} className="fill-background" />
        {lanes.map(l => <LaneHeader key={l.id} lane={l} />)}
        <line
          x1={0} x2={width}
          y1={HEADER_HEIGHT - 0.5} y2={HEADER_HEIGHT - 0.5}
          className="stroke-border"
          strokeWidth={1}
        />

        {/* Activation bars (drawn before arrows so arrows sit on top) */}
        {activations.map((a, i) => {
          const x = laneByX[a.laneId]
          const tone = a.tone === 'response' ? TONE.response : TONE.result
          return (
            <rect
              key={i}
              x={x - 5}
              y={a.y1}
              width={10}
              height={Math.max(a.y2 - a.y1, 4)}
              rx={2}
              className={cn(tone.activation)}
            />
          )
        })}

        {/* Turns */}
        {placedTurns.map(tp => {
          const turn = tp.turn
          const headerLabel = `${t('profiler.turn.title', { index: turn.index + 1 })}` +
            (turn.latencyMs != null ? ` · ${fmtMs(turn.latencyMs)}` : '') +
            (turn.inputTokens != null ? ` · ↑${turn.inputTokens.toLocaleString()}` : '') +
            (turn.outputTokens != null ? ` ↓${turn.outputTokens.toLocaleString()}` : '')
          return (
            <g key={turn.index}>
              {/* Turn separator line */}
              <line
                x1={SIDE_PADDING - 8}
                x2={width - SIDE_PADDING + 8}
                y1={tp.headerY}
                y2={tp.headerY}
                className="stroke-border"
                strokeWidth={1}
              />
              {/* Turn label pill */}
              <g>
                {(() => {
                  const labelW = Math.max(120, headerLabel.length * 6.2)
                  const labelX = (width - labelW) / 2
                  return (
                    <>
                      <rect
                        x={labelX}
                        y={tp.headerY - 9}
                        width={labelW}
                        height={18}
                        rx={9}
                        className="fill-muted stroke-border"
                        strokeWidth={1}
                      />
                      <text
                        x={width / 2}
                        y={tp.headerY + 4}
                        textAnchor="middle"
                        className="select-none fill-muted-foreground text-[10px] font-semibold tracking-wide"
                      >
                        {headerLabel}
                      </text>
                    </>
                  )
                })()}
              </g>

              {/* Time offset on the left */}
              <text
                x={4}
                y={tp.headerY + 4}
                className="select-none fill-muted-foreground/60 text-[9px] tabular-nums"
              >
                {(turn.startOffsetMs / 1000).toFixed(2)}s
              </text>

              {/* Event arrows */}
              {tp.rows.map(row => {
                const arrow = arrowFor(row.event)
                if (!arrow) return null
                return (
                  <ArrowRow
                    key={row.event.id}
                    eventId={row.event.id}
                    y={row.y}
                    arrow={arrow}
                    laneByX={laneByX}
                    active={activeId === row.event.id}
                    onClick={() => setActiveId(prev => prev === row.event.id ? null : row.event.id)}
                  />
                )
              })}
            </g>
          )
        })}
      </svg>

      {activeEvent && <DetailPanel event={activeEvent} onClose={() => setActiveId(null)} />}
    </div>
  )
}
