import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Activity,
  BarChart3,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  LayoutList,
  Search,
  Trash2,
} from 'lucide-react'
import { PageLoadingState, PageState } from '@/components/PageState'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { formatPayloadDisplay } from '@/pages/logs/utils'
import { profilerApi } from '@/services/profiler'
import { queryKeys } from '@/services/queryKeys'
import type { ProfilerRecord, ProfilerSession, ProfilerSessionDetail } from '@/types/profiler'

type ActiveTab = 'timeline' | 'breakdown'
type TimelineDetailTab = 'request' | 'response' | 'tools'

function fmtMs(ms: number | null | undefined): string {
  if (ms == null) return '-'
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`
  return `${Math.round(ms)}ms`
}

function fmtMsCompact(ms: number | null | undefined): string {
  if (ms == null) return '-'
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.round(ms)}ms`
}

function fmtNum(value: number | null | undefined): string {
  if (value == null) return '-'
  return value.toLocaleString()
}

function fmtCompactNumber(value: number | null | undefined): string {
  if (value == null) return '-'
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`
  return value.toLocaleString()
}

function totalMs(session: ProfilerSession): number {
  if (session.endedAt == null || session.turnCount === 0) return session.totalLatencyMs ?? 0
  return session.endedAt - session.startedAt
}

function sessionLabel(session: ProfilerSession): string {
  const id = session.sessionId
  return id.length > 18 ? `${id.slice(0, 8)}…${id.slice(-6)}` : id
}

function relativeTimeLabel(timestamp: number): string {
  const diffMs = Math.max(0, Date.now() - timestamp)
  const minutes = Math.floor(diffMs / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} hr ago`
  const days = Math.floor(hours / 24)
  return `${days} day${days === 1 ? '' : 's'} ago`
}

function parseJsonPayload(payload: string | null | undefined): unknown | null {
  if (!payload) return null
  try {
    return JSON.parse(payload)
  } catch {
    return null
  }
}

function collectToolCalls(value: unknown, output: unknown[]): void {
  if (Array.isArray(value)) {
    for (const item of value) collectToolCalls(item, output)
    return
  }

  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    const directToolCalls = record.tool_calls
    if (Array.isArray(directToolCalls)) {
      output.push(...directToolCalls)
    }

    const content = record.content
    if (Array.isArray(content)) {
      for (const item of content) {
        if (item && typeof item === 'object') {
          const contentItem = item as Record<string, unknown>
          if (contentItem.type === 'tool_use') output.push(contentItem)
        }
      }
    }

    for (const child of Object.values(record)) collectToolCalls(child, output)
  }
}

function extractToolCalls(record: ProfilerRecord): unknown[] {
  const output: unknown[] = []
  collectToolCalls(parseJsonPayload(record.clientResponse), output)
  return output
}

function formatTurnRange(record: ProfilerRecord, sessionStart: number): string {
  const start = record.timestamp - sessionStart
  const end = start + (record.latencyMs ?? 0)
  return `${(start / 1000).toFixed(3)}s → ${(end / 1000).toFixed(3)}s`
}

function codeBlockContent(payload: string | null | undefined, emptyLabel: string): string {
  return formatPayloadDisplay(payload ?? null, emptyLabel)
}

function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

function SessionMetricPill({
  tone = 'default',
  children,
}: {
  tone?: 'default' | 'accent'
  children: React.ReactNode
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium',
        tone === 'accent' ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100 text-slate-600'
      )}
    >
      {children}
    </span>
  )
}

function SessionItem({
  session,
  selected,
  index,
  onClick,
}: {
  session: ProfilerSession
  selected: boolean
  index: number
  onClick: () => void
}) {
  const dotColors = ['bg-indigo-500', 'bg-emerald-500', 'bg-amber-500']
  const dotColor = selected ? 'bg-indigo-500' : dotColors[index % dotColors.length]
  const totalTokens = (session.totalInputTokens ?? 0) + (session.totalOutputTokens ?? 0)

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'w-full border-b border-border px-4 py-3 text-left transition-colors',
        selected ? 'bg-indigo-50/70' : 'hover:bg-slate-50'
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className={cn('h-2 w-2 flex-shrink-0 rounded-full', dotColor)} />
          <span className={cn('truncate text-sm font-semibold', selected ? 'text-indigo-700' : 'text-slate-800')}>
            {sessionLabel(session)}
          </span>
        </div>
        <span className="text-[10px] text-muted-foreground">{relativeTimeLabel(session.startedAt)}</span>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2 pl-4">
        <SessionMetricPill tone={selected ? 'accent' : 'default'}>{session.turnCount} turns</SessionMetricPill>
        <SessionMetricPill>{fmtMsCompact(totalMs(session))}</SessionMetricPill>
        <SessionMetricPill>{fmtCompactNumber(totalTokens)} tok</SessionMetricPill>
      </div>
    </button>
  )
}

function SegmentedTab({
  active,
  icon: Icon,
  label,
  onClick,
}: {
  active: boolean
  icon: React.ComponentType<{ className?: string }>
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex h-7 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors',
        active
          ? 'border-indigo-200 bg-indigo-50 text-indigo-700'
          : 'border-transparent bg-slate-50 text-slate-500 hover:bg-slate-100 hover:text-slate-700'
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </button>
  )
}

function DetailTabButton({
  active,
  label,
  count,
  onClick,
}: {
  active: boolean
  label: string
  count?: number
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex h-6 items-center gap-1.5 rounded-full border px-2.5 text-[11px] font-medium transition-colors',
        active
          ? 'border-indigo-200 bg-indigo-50 text-indigo-700'
          : 'border-transparent bg-transparent text-slate-500 hover:bg-slate-100 hover:text-slate-700'
      )}
    >
      <span>{label}</span>
      {typeof count === 'number' && (
        <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">
          {count}
        </span>
      )}
    </button>
  )
}

function TimelineOverview({
  detail,
  selectedTurn,
  onSelectTurn,
}: {
  detail: ProfilerSessionDetail
  selectedTurn: number
  onSelectTurn: (index: number) => void
}) {
  const records = detail.records
  if (records.length === 0) {
    return <PageState compact className="min-h-[220px]" title="No turns recorded" />
  }

  const totalDurationMs = totalMs(detail)
  const maxLatency = Math.max(1, ...records.map((record) => Math.max(record.latencyMs ?? 0, record.ttftMs ?? 0, 1)))
  const maxToolCalls = Math.max(1, ...records.map((record) => extractToolCalls(record).length))

  return (
    <div className="border-b border-border bg-white">
      <div className="flex items-center justify-between gap-4 px-5 py-3">
        <p className="text-xs text-slate-500">
          Compressed overview · idle gaps folded · wraps as turns grow
        </p>
        <div className="flex items-center gap-2 text-[11px]">
          <span className="text-slate-500">Mode:</span>
          <span className="rounded border border-slate-200 bg-slate-100 px-2 py-0.5 font-medium text-slate-700">
            Compressed
          </span>
          <span className="rounded border border-slate-200 bg-white px-2 py-0.5 font-medium text-slate-700">
            Session {fmtMsCompact(totalDurationMs)}
          </span>
        </div>
      </div>

      <div className="px-5 pb-4">
        <div className="mb-3 flex items-center justify-between text-[10px] text-slate-400">
          <span>start</span>
          <span>{(totalDurationMs / 1000).toFixed(1)}s</span>
        </div>

        <div
          className="grid gap-x-2 gap-y-5"
          style={{ gridTemplateColumns: 'repeat(10, minmax(0, 1fr))' }}
        >
          {records.map((record, index) => {
            const isSelected = index === selectedTurn
            const latency = Math.max(record.latencyMs ?? 0, 1)
            const latencyWidth = `${Math.max(28, Math.min(100, (latency / maxLatency) * 100))}%`
            const ttftOffset =
              record.ttftMs != null
                ? `${Math.max(0, Math.min(100, (Math.min(record.ttftMs, maxLatency) / maxLatency) * 100))}%`
                : null
            const startOffset = Math.max(0, record.timestamp - detail.startedAt)
            const toolCalls = extractToolCalls(record)

            return (
              <button
                key={record.id}
                type="button"
                onClick={() => onSelectTurn(index)}
                className={cn(
                  'border border-transparent px-1.5 py-1 text-left transition-colors',
                  isSelected ? 'rounded-md border-rose-300' : 'hover:bg-slate-50/40'
                )}
                title={`Turn ${record.turnIndex + 1}`}
              >
                <div className="flex min-w-0 items-center gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <span
                      className={cn(
                        'inline-flex h-5 min-w-5 items-center justify-center rounded-full border px-1.5 text-[11px] font-semibold',
                        isSelected
                          ? 'border-indigo-300 bg-indigo-100 text-indigo-700'
                          : 'border-slate-200 bg-white text-slate-700'
                      )}
                    >
                      {record.turnIndex + 1}
                    </span>
                    <span className="truncate text-[15px] font-semibold text-slate-800">{fmtMsCompact(record.latencyMs)}</span>
                  </div>
                </div>
                <p className="mt-1 text-[10px] text-slate-500">start {(startOffset / 1000).toFixed(1)}s</p>

                <div className="mt-2">
                  <div className="flex items-center justify-between text-[10px] text-slate-500">
                    <span>{fmtMs(record.ttftMs)} TTFT</span>
                  </div>
                  <div className="relative mt-1 h-4 rounded-sm bg-slate-100">
                    <div className="h-4 rounded-sm bg-blue-200" style={{ width: latencyWidth }} />
                    {ttftOffset != null && (
                      <>
                        <span
                          className="absolute top-[-3px] h-5 w-[3px] -translate-x-1/2 rounded-full bg-violet-500 shadow-[0_0_0_1px_rgba(255,255,255,0.9)]"
                          style={{ left: ttftOffset }}
                        />
                        <span
                          className="absolute top-[-6px] h-2.5 w-2.5 -translate-x-1/2 rounded-full border border-white bg-violet-500"
                          style={{ left: ttftOffset }}
                        />
                      </>
                    )}
                  </div>
                </div>

                <div className="mt-2">
                  <div className="mb-1 flex items-center justify-between text-[10px] text-slate-500">
                    <span>Tools</span>
                    <span>{toolCalls.length}</span>
                  </div>
                  <div className="flex h-5 items-center gap-1">
                    <span
                      className={cn(
                        'inline-flex h-5 min-w-5 items-center justify-center rounded-md border text-[10px] font-semibold',
                        toolCalls.length > 0
                          ? 'border-amber-400 bg-amber-200 text-amber-900'
                          : 'border-slate-300 bg-white text-slate-500'
                      )}
                    >
                      {toolCalls.length}
                    </span>
                  </div>
                </div>
              </button>
            )
          })}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-4 text-[11px] text-slate-500">
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm bg-blue-200" />
            Total latency
          </span>
          <span className="flex items-center gap-1.5">
            <span className="relative inline-block h-2.5 w-2.5 rounded-full border border-white bg-violet-500 shadow-[0_0_0_1px_rgba(139,92,246,0.35)]" />
            First token (TTFT)
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm border border-amber-400 bg-amber-200" />
            Tool executing
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm border border-rose-300 bg-rose-50" />
            Selected turn
          </span>
        </div>
      </div>
    </div>
  )
}

function TurnDetail({
  detail,
  selectedTurn,
  detailTab,
  onDetailTabChange,
  onSelectTurn,
}: {
  detail: ProfilerSessionDetail
  selectedTurn: number
  detailTab: TimelineDetailTab
  onDetailTabChange: (tab: TimelineDetailTab) => void
  onSelectTurn: (index: number) => void
}) {
  const record = detail.records[selectedTurn]
  if (!record) return null

  const toolCalls = extractToolCalls(record)
  const totalTokens = (record.inputTokens ?? 0) + (record.outputTokens ?? 0)
  const tabContent =
    detailTab === 'request'
      ? codeBlockContent(record.clientRequest, '(empty request)')
      : detailTab === 'response'
        ? codeBlockContent(record.clientResponse, '(empty response)')
        : toolCalls.length > 0
          ? JSON.stringify(toolCalls, null, 2)
          : '(no tool calls)'

  return (
    <div className="bg-slate-50">
      <div className="flex items-center justify-between gap-4 border-b border-slate-200 bg-white px-5 py-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs">
          <span
            className="rounded-full px-2 py-1 font-semibold text-white"
            style={{ background: 'linear-gradient(135deg, #6E63FF, #4E8DFF)' }}
          >
            Turn {record.turnIndex + 1}
          </span>
          <span className="text-slate-500">{formatTurnRange(record, detail.startedAt)}</span>
          <span className="rounded-full bg-violet-100 px-2 py-1 font-semibold text-violet-700">
            TTFT {fmtMs(record.ttftMs)}
          </span>
          <span className="rounded-full bg-blue-100 px-2 py-1 font-semibold text-blue-700">
            {fmtCompactNumber(totalTokens)} tokens
          </span>
        </div>

        <div className="flex items-center gap-2 text-xs text-slate-500">
          <button
            type="button"
            onClick={() => onSelectTurn(Math.max(0, selectedTurn - 1))}
            disabled={selectedTurn === 0}
            className="rounded p-1 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
            aria-label="Previous turn"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="min-w-10 text-center font-medium text-slate-600">
            {selectedTurn + 1} / {detail.records.length}
          </span>
          <button
            type="button"
            onClick={() => onSelectTurn(Math.min(detail.records.length - 1, selectedTurn + 1))}
            disabled={selectedTurn === detail.records.length - 1}
            className="rounded p-1 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
            aria-label="Next turn"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="border-b border-slate-200 bg-white px-5 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <DetailTabButton active={detailTab === 'request'} label="Request" onClick={() => onDetailTabChange('request')} />
          <DetailTabButton active={detailTab === 'response'} label="Response" onClick={() => onDetailTabChange('response')} />
          <DetailTabButton
            active={detailTab === 'tools'}
            label="Tool Calls"
            count={toolCalls.length}
            onClick={() => onDetailTabChange('tools')}
          />
        </div>
      </div>

      <div className="p-5">
        <pre className="max-h-[420px] overflow-auto rounded-xl bg-[#1E1E2E] p-4 text-xs leading-5 text-slate-200">
          {tabContent}
        </pre>
        {record.error && (
          <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {record.error}
          </p>
        )}
      </div>
    </div>
  )
}

function TimelinePanel({
  detail,
  selectedTurn,
  detailTab,
  onSelectTurn,
  onDetailTabChange,
}: {
  detail: ProfilerSessionDetail
  selectedTurn: number
  detailTab: TimelineDetailTab
  onSelectTurn: (index: number) => void
  onDetailTabChange: (tab: TimelineDetailTab) => void
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <TimelineOverview detail={detail} selectedTurn={selectedTurn} onSelectTurn={onSelectTurn} />
      <div className="min-h-0 flex-1 overflow-auto">
        <TurnDetail
          detail={detail}
          selectedTurn={selectedTurn}
          detailTab={detailTab}
          onDetailTabChange={onDetailTabChange}
          onSelectTurn={onSelectTurn}
        />
      </div>
    </div>
  )
}

function PayloadBlock({
  title,
  payload,
  accentClass,
}: {
  title: string
  payload: string | null | undefined
  accentClass: string
}) {
  return (
    <div className="rounded-xl border border-border bg-white p-3">
      <p className={cn('mb-2 text-[11px] font-semibold uppercase tracking-[0.16em]', accentClass)}>{title}</p>
      <pre className="max-h-64 overflow-auto rounded-lg bg-slate-950/95 p-3 text-xs leading-5 text-slate-200">
        {codeBlockContent(payload, '(empty)')}
      </pre>
    </div>
  )
}

function MetricCard({
  label,
  value,
  sub,
  accentClass,
}: {
  label: string
  value: string
  sub?: string
  accentClass?: string
}) {
  return (
    <div className="rounded-2xl border border-border bg-white p-4">
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">{label}</p>
      <p className={cn('mt-2 text-2xl font-semibold text-slate-900', accentClass)}>{value}</p>
      {sub && <p className="mt-1 text-xs text-slate-500">{sub}</p>}
    </div>
  )
}

function BreakdownRow({
  record,
  sessionStart,
  expanded,
  onToggle,
}: {
  record: ProfilerRecord
  sessionStart: number
  expanded: boolean
  onToggle: () => void
}) {
  const toolCalls = extractToolCalls(record)

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-white">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-4 px-4 py-3 text-left hover:bg-slate-50"
      >
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <span
            className="rounded-full px-2 py-0.5 text-[11px] font-semibold text-white"
            style={{ background: 'linear-gradient(135deg, #6E63FF, #4E8DFF)' }}
          >
            T{record.turnIndex + 1}
          </span>
          <div className="min-w-0">
            <div className="text-sm font-medium text-slate-900">{formatTurnRange(record, sessionStart)}</div>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
              <span>Total {fmtMs(record.latencyMs)}</span>
              <span>TTFT {fmtMs(record.ttftMs)}</span>
              <span>TPOT {record.tpotMs != null ? `${record.tpotMs.toFixed(1)} ms/tok` : '-'}</span>
              <span>↑ {fmtNum(record.inputTokens)}</span>
              <span>↓ {fmtNum(record.outputTokens)}</span>
              <span>{toolCalls.length} tool calls</span>
              {record.error && (
                <span className="rounded-full bg-red-50 px-2 py-0.5 font-medium text-red-600">Error</span>
              )}
            </div>
          </div>
        </div>
        <ChevronDown className={cn('h-4 w-4 flex-shrink-0 text-slate-400 transition-transform', expanded && 'rotate-180')} />
      </button>

      {expanded && (
        <div className="border-t border-border bg-slate-50/70 p-4">
          <div className="grid gap-3 xl:grid-cols-2">
            <PayloadBlock title="Request" payload={record.clientRequest} accentClass="text-blue-600" />
            <PayloadBlock title="Response" payload={record.clientResponse} accentClass="text-violet-600" />
          </div>
          <div className="mt-3 grid gap-3 xl:grid-cols-[minmax(0,1fr)_280px]">
            <div className="rounded-xl border border-border bg-white p-3">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-amber-600">Tool Calls</p>
              <pre className="max-h-64 overflow-auto rounded-lg bg-slate-950/95 p-3 text-xs leading-5 text-slate-200">
                {toolCalls.length > 0 ? JSON.stringify(toolCalls, null, 2) : '(no tool calls)'}
              </pre>
            </div>
            <div className="rounded-xl border border-border bg-white p-3">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Turn Metrics</p>
              <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
                <div>
                  <dt className="text-slate-500">Duration</dt>
                  <dd className="mt-0.5 font-medium text-slate-900">{fmtMs(record.latencyMs)}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">TTFT</dt>
                  <dd className="mt-0.5 font-medium text-slate-900">{fmtMs(record.ttftMs)}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">TPOT</dt>
                  <dd className="mt-0.5 font-medium text-slate-900">
                    {record.tpotMs != null ? `${record.tpotMs.toFixed(1)} ms/tok` : '-'}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-500">Status</dt>
                  <dd className="mt-0.5 font-medium text-slate-900">{record.statusCode ?? '-'}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Input</dt>
                  <dd className="mt-0.5 font-medium text-slate-900">{fmtNum(record.inputTokens)}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Output</dt>
                  <dd className="mt-0.5 font-medium text-slate-900">{fmtNum(record.outputTokens)}</dd>
                </div>
              </dl>
              {record.error && (
                <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                  {record.error}
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function BreakdownPanel({
  detail,
  expandedTurn,
  onToggleTurn,
}: {
  detail: ProfilerSessionDetail
  expandedTurn: number | null
  onToggleTurn: (index: number) => void
}) {
  if (detail.records.length === 0) {
    return <PageState compact className="min-h-[220px]" title="No turns recorded" />
  }

  const totalDurationMs = totalMs(detail)
  const llmMs = detail.records.reduce((sum, record) => {
    const latency = record.latencyMs ?? 0
    const ttft = record.ttftMs ?? 0
    return sum + Math.max(latency - ttft, 0)
  }, 0)
  const llmPct = totalDurationMs > 0 ? ((llmMs / totalDurationMs) * 100).toFixed(1) : '-'
  const ttftValues = detail.records.map((record) => record.ttftMs).filter((value): value is number => value != null)
  const tpotValues = detail.records.map((record) => record.tpotMs).filter((value): value is number => value != null)
  const avgTtftMs = ttftValues.length > 0 ? ttftValues.reduce((sum, value) => sum + value, 0) / ttftValues.length : null
  const avgTpotMs = tpotValues.length > 0 ? tpotValues.reduce((sum, value) => sum + value, 0) / tpotValues.length : null

  return (
    <div className="space-y-5 p-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <MetricCard label="Total Duration" value={fmtMs(totalDurationMs)} sub={`${detail.records.length} turns`} />
        <MetricCard label="LLM Time" value={fmtMs(llmMs)} sub={`${llmPct}% of session`} accentClass="text-violet-700" />
        <MetricCard label="Avg TTFT" value={fmtMs(avgTtftMs)} />
        <MetricCard label="Avg TPOT" value={avgTpotMs != null ? `${avgTpotMs.toFixed(1)} ms/tok` : '-'} />
        <MetricCard label="Input Tokens" value={fmtNum(detail.totalInputTokens)} />
        <MetricCard label="Output Tokens" value={fmtNum(detail.totalOutputTokens)} />
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">Per-Turn Breakdown</h3>
            <p className="mt-1 text-xs text-slate-500">Expand a turn to inspect request, response, tool calls, and errors.</p>
          </div>
        </div>
        {detail.records.map((record) => (
          <BreakdownRow
            key={record.id}
            record={record}
            sessionStart={detail.startedAt}
            expanded={expandedTurn === record.turnIndex}
            onToggle={() => onToggleTurn(record.turnIndex)}
          />
        ))}
      </div>
    </div>
  )
}

export default function ProfilerPage() {
  const queryClient = useQueryClient()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [tab, setTab] = useState<ActiveTab>('timeline')
  const [timelineDetailTab, setTimelineDetailTab] = useState<TimelineDetailTab>('request')
  const [selectedTurn, setSelectedTurn] = useState(0)
  const [expandedTurn, setExpandedTurn] = useState<number | null>(0)
  const [search, setSearch] = useState('')

  const statusQuery = useQuery({
    queryKey: queryKeys.profiler.status(),
    queryFn: () => profilerApi.getStatus(),
    refetchInterval: 3000,
  })
  const isRecording = statusQuery.data?.active ?? false

  const sessionsQuery = useQuery({
    queryKey: queryKeys.profiler.sessions({}),
    queryFn: () => profilerApi.listSessions({ limit: 100 }),
    refetchInterval: isRecording ? 2000 : false,
  })

  const sessions = sessionsQuery.data?.items ?? []

  const detailQuery = useQuery({
    queryKey: queryKeys.profiler.session(selectedId),
    queryFn: () => profilerApi.getSession(selectedId!),
    enabled: selectedId != null,
    refetchInterval: isRecording && selectedId != null ? 2000 : false,
  })

  const startMutation = useMutation({
    mutationFn: () => profilerApi.start(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.profiler.status() })
      void queryClient.invalidateQueries({ queryKey: queryKeys.profiler.sessions({}) })
    },
  })

  const stopMutation = useMutation({
    mutationFn: () => profilerApi.stop(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.profiler.status() })
      void queryClient.invalidateQueries({ queryKey: queryKeys.profiler.sessions({}) })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => profilerApi.deleteSession(id),
    onSuccess: (_data, id) => {
      if (selectedId === id) setSelectedId(null)
      void queryClient.invalidateQueries({ queryKey: queryKeys.profiler.sessions({}) })
    },
  })

  const clearMutation = useMutation({
    mutationFn: () => profilerApi.clearAll(),
    onSuccess: () => {
      setSelectedId(null)
      void queryClient.invalidateQueries({ queryKey: queryKeys.profiler.sessions({}) })
    },
  })

  const filteredSessions = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return sessions
    return sessions.filter((session) => session.sessionId.toLowerCase().includes(query))
  }, [search, sessions])

  const detail = detailQuery.data
  const selectedSession = sessions.find((session) => session.id === selectedId) ?? null
  const selectedRecord = detail?.records[selectedTurn] ?? null

  useEffect(() => {
    if (selectedId && !sessions.some((session) => session.id === selectedId)) {
      setSelectedId(null)
    }
  }, [selectedId, sessions])

  useEffect(() => {
    setSelectedTurn(0)
    setExpandedTurn(0)
    setTimelineDetailTab('request')
  }, [selectedId])

  useEffect(() => {
    if (!detail) {
      setSelectedTurn(0)
      setExpandedTurn(0)
      return
    }

    setSelectedTurn((current) => Math.min(current, Math.max(detail.records.length - 1, 0)))
    setExpandedTurn((current) => {
      if (current == null) return 0
      return Math.min(current, Math.max(detail.records.length - 1, 0))
    })
  }, [detail])

  const exportSelectedSession = () => {
    if (!detail) return
    downloadJson(`profiler-${detail.sessionId}.json`, detail)
  }

  return (
    <div className="flex h-full min-h-0 flex-col" style={{ height: 'calc(100vh - 64px)' }}>
      <div className="flex items-center justify-between gap-4 border-b border-border bg-white px-6 py-3">
        <div className="flex items-center gap-3">
          <Activity className="h-5 w-5 text-indigo-500" />
          <span className="text-base font-semibold text-slate-900">Profiler</span>
          <Badge
            variant="outline"
            className={cn(
              'rounded-full border px-2.5 py-1 text-xs font-semibold',
              isRecording ? 'border-red-200 bg-red-50 text-red-600' : 'border-slate-200 bg-slate-50 text-slate-500'
            )}
          >
            <span className={cn('mr-2 inline-block h-1.5 w-1.5 rounded-full', isRecording ? 'bg-red-500' : 'bg-slate-400')} />
            {isRecording ? 'Recording' : 'Not Recording'}
          </Badge>
        </div>

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant={isRecording ? 'destructive' : 'default'}
            onClick={() => (isRecording ? stopMutation.mutate() : startMutation.mutate())}
            disabled={startMutation.isPending || stopMutation.isPending}
          >
            {isRecording ? 'Stop Recording' : 'Start Recording'}
          </Button>
          <Button size="sm" variant="outline" onClick={exportSelectedSession} disabled={!detail}>
            <Download className="mr-1.5 h-3.5 w-3.5" />
            Export
          </Button>
          <Button size="sm" variant="outline" onClick={() => clearMutation.mutate()} disabled={sessions.length === 0} className="border-red-200 bg-red-50 text-red-700 hover:bg-red-100 hover:text-red-800">
            <Trash2 className="mr-1.5 h-3.5 w-3.5" />
            Clear
          </Button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 overflow-hidden bg-[#F1F3F4]">
        <div className="flex w-80 flex-shrink-0 flex-col border-r border-border bg-white">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <span className="text-sm font-semibold text-slate-900">Sessions</span>
            <Badge variant="secondary" className="rounded-full px-2 py-0.5">
              {sessions.length}
            </Badge>
          </div>

          <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
            <Search className="h-3.5 w-3.5 text-slate-400" />
            <input
              className="w-full bg-transparent text-sm outline-none placeholder:text-slate-400"
              placeholder="Search sessions..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {sessionsQuery.isPending ? (
              <PageLoadingState compact className="min-h-[160px]" label="Loading..." />
            ) : filteredSessions.length === 0 ? (
              <PageState
                compact
                className="m-4 min-h-[160px]"
                title={isRecording ? 'Waiting for requests…' : 'No sessions'}
                description={isRecording ? 'Requests with session_id will appear here.' : 'Start recording to capture LLM sessions.'}
              />
            ) : (
              filteredSessions.map((session, index) => (
                <SessionItem
                  key={session.id}
                  session={session}
                  selected={selectedId === session.id}
                  index={index}
                  onClick={() => setSelectedId(session.id)}
                />
              ))
            )}
          </div>
        </div>

        <div className="flex min-w-0 flex-1 flex-col bg-white">
          {!selectedId ? (
            <div className="flex flex-1 items-center justify-center">
              <PageState
                title="Select a session"
                description="Choose a session from the left to inspect its timeline, message payloads, and stats."
                icon={<Activity className="h-5 w-5" />}
              />
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between gap-4 border-b border-border bg-white px-5 py-3">
                <div className="flex min-w-0 items-center gap-2.5">
                  <span className="h-2.5 w-2.5 flex-shrink-0 rounded-full bg-indigo-500" />
                  <span className="truncate text-sm font-semibold text-slate-900">
                    {detail?.sessionId ?? selectedSession?.sessionId ?? selectedId}
                  </span>
                  <span className="text-slate-300">·</span>
                  <span className="truncate text-sm text-slate-500">
                    {detail
                      ? `${detail.turnCount} turns · ${fmtMsCompact(totalMs(detail))} · ${fmtCompactNumber((detail.totalInputTokens ?? 0) + (detail.totalOutputTokens ?? 0))} tokens`
                      : 'Loading session…'}
                  </span>
                </div>

                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => selectedId && deleteMutation.mutate(selectedId)}
                  disabled={!selectedId || deleteMutation.isPending}
                  className="text-slate-500 hover:text-red-700"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>

              <div className="border-b border-border bg-white px-5 py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <SegmentedTab active={tab === 'timeline'} icon={LayoutList} label="Timeline" onClick={() => setTab('timeline')} />
                  <SegmentedTab active={tab === 'breakdown'} icon={BarChart3} label="Breakdown" onClick={() => setTab('breakdown')} />
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-auto bg-slate-50">
                {detailQuery.isPending ? (
                  <PageLoadingState compact className="min-h-[240px]" label="Loading session..." />
                ) : detailQuery.isError ? (
                  <PageState compact className="m-5 min-h-[220px]" tone="danger" title="Failed to load session" />
                ) : detail ? (
                  tab === 'timeline' ? (
                    <TimelinePanel
                      detail={detail}
                      selectedTurn={selectedTurn}
                      detailTab={timelineDetailTab}
                      onSelectTurn={setSelectedTurn}
                      onDetailTabChange={setTimelineDetailTab}
                    />
                  ) : (
                    <BreakdownPanel
                      detail={detail}
                      expandedTurn={expandedTurn}
                      onToggleTurn={(index) => setExpandedTurn((current) => (current === index ? null : index))}
                    />
                  )
                ) : (
                  <PageState compact className="m-5 min-h-[220px]" title="Session not found" />
                )}
              </div>

              {selectedRecord && <span className="sr-only">Selected turn {selectedRecord.turnIndex + 1}</span>}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
