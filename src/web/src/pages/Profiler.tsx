import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
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
import { PageHeader } from '@/components/PageHeader'
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

function relativeTimeLabel(timestamp: number, t: (key: string, options?: Record<string, unknown>) => string): string {
  const diffMs = Math.max(0, Date.now() - timestamp)
  const minutes = Math.floor(diffMs / 60_000)
  if (minutes < 1) return t('profiler.relativeTime.justNow')
  if (minutes < 60) return t('profiler.relativeTime.minutesAgo', { count: minutes })
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return t('profiler.relativeTime.hoursAgo', { count: hours })
  const days = Math.floor(hours / 24)
  return t('profiler.relativeTime.daysAgo', { count: days })
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
        'inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-medium',
        tone === 'accent'
          ? 'bg-primary/10 text-primary'
          : 'bg-secondary text-muted-foreground'
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
  const { t } = useTranslation()
  const dotColors = ['bg-indigo-500', 'bg-emerald-500', 'bg-amber-500']
  const dotColor = selected ? 'bg-indigo-500' : dotColors[index % dotColors.length]
  const totalTokens = (session.totalInputTokens ?? 0) + (session.totalOutputTokens ?? 0)

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'w-full border-b border-border/45 px-4 py-3 text-left transition-colors',
        selected
          ? 'bg-secondary'
          : 'hover:bg-secondary/50'
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className={cn('h-2 w-2 flex-shrink-0 rounded-full', dotColor)} />
          <span className={cn('truncate text-sm font-semibold', selected ? 'text-primary' : 'text-foreground')}>
            {sessionLabel(session)}
          </span>
        </div>
        <span className="text-[11px] text-muted-foreground">{relativeTimeLabel(session.startedAt, t)}</span>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2 pl-4">
        <SessionMetricPill tone={selected ? 'accent' : 'default'}>
          {t('profiler.metricTurns', { count: session.turnCount })}
        </SessionMetricPill>
        <SessionMetricPill>{fmtMsCompact(totalMs(session))}</SessionMetricPill>
        <SessionMetricPill>{t('profiler.metricTokens', { value: fmtCompactNumber(totalTokens) })}</SessionMetricPill>
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
        'inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-all',
        active
          ? 'border-primary/20 bg-primary/10 text-primary'
          : 'border-transparent bg-secondary text-muted-foreground hover:bg-secondary/80 hover:text-foreground'
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
        'inline-flex h-7 items-center gap-1.5 rounded-full border px-3 text-[11px] font-medium transition-all',
        active
          ? 'border-primary/20 bg-primary/10 text-primary'
          : 'border-transparent bg-transparent text-muted-foreground hover:bg-secondary hover:text-foreground'
      )}
    >
      <span>{label}</span>
      {typeof count === 'number' && (
        <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[11px] font-semibold text-amber-700">
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
  const { t } = useTranslation()
  const records = detail.records
  if (records.length === 0) {
    return (
      <PageState
        compact
        className="min-h-[220px]"
        title={t('profiler.empty.noTurnsTitle')}
        description={t('profiler.empty.noTurnsDescription')}
      />
    )
  }

  const totalDurationMs = totalMs(detail)
  const maxLatency = Math.max(1, ...records.map((record) => Math.max(record.latencyMs ?? 0, record.ttftMs ?? 0, 1)))
  const maxToolCalls = Math.max(1, ...records.map((record) => extractToolCalls(record).length))

  return (
    <div className="rounded-xl bg-card shadow-[var(--surface-shadow)]">
      <div className="flex items-center justify-between gap-4 border-b border-border/45 px-5 py-3.5">
        <p className="text-xs text-muted-foreground">
          Compressed overview · idle gaps folded · wraps as turns grow
        </p>
        <div className="flex items-center gap-2 text-[11px]">
          <span className="text-muted-foreground">Mode:</span>
          <span className="rounded-full border border-border bg-secondary/70 px-2.5 py-1 font-medium text-foreground">
            Compressed
          </span>
          <span className="rounded-full border border-border bg-card px-2.5 py-1 font-medium text-foreground">
            Session {fmtMsCompact(totalDurationMs)}
          </span>
        </div>
      </div>

      <div className="px-5 pb-4">
        <div className="mb-3 flex items-center justify-between text-[11px] text-muted-foreground/70">
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
                  'rounded-xl border border-transparent bg-card px-2 py-2 text-left shadow-sm transition-all',
                  isSelected
                    ? 'border-primary/20 bg-primary/5'
                    : 'hover:bg-secondary/50'
                )}
                title={`Turn ${record.turnIndex + 1}`}
              >
                <div className="flex min-w-0 items-center gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <span
                      className={cn(
                        'inline-flex h-5 min-w-5 items-center justify-center rounded-full border px-1.5 text-[11px] font-semibold',
                        isSelected
                          ? 'border-primary/30 bg-primary/10 text-primary'
                          : 'border-border bg-card text-foreground'
                      )}
                    >
                      {record.turnIndex + 1}
                    </span>
                    <span className="truncate text-[15px] font-semibold text-foreground">{fmtMsCompact(record.latencyMs)}</span>
                  </div>
                </div>
                <p className="mt-1 text-[11px] text-muted-foreground">start {(startOffset / 1000).toFixed(1)}s</p>

                <div className="mt-2">
                  <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                    <span>{fmtMs(record.ttftMs)} TTFT</span>
                  </div>
                  <div className="relative mt-1 h-4 rounded-sm bg-secondary">
                    <div className="h-4 rounded-sm bg-primary/20" style={{ width: latencyWidth }} />
                    {ttftOffset != null && (
                      <>
                        <span
                          className="absolute top-[-3px] h-5 w-[3px] -translate-x-1/2 rounded-full bg-violet-500 ring-1 ring-white"
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
                  <div className="mb-1 flex items-center justify-between text-[11px] text-muted-foreground">
                    <span>Tools</span>
                    <span>{toolCalls.length}</span>
                  </div>
                  <div className="flex h-5 items-center gap-1">
                    <span
                      className={cn(
                        'inline-flex h-5 min-w-5 items-center justify-center rounded-md border text-[11px] font-semibold',
                        toolCalls.length > 0
                          ? 'border-amber-400 bg-amber-200 text-amber-900'
                          : 'border-border bg-card text-muted-foreground'
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

        <div className="mt-4 flex flex-wrap items-center gap-4 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm bg-blue-200" />
            Total latency
          </span>
          <span className="flex items-center gap-1.5">
            <span className="relative inline-block h-2.5 w-2.5 rounded-full border border-white bg-violet-500 ring-1 ring-violet-500/35" />
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
    <div data-testid="profiler-turn-detail" className="mt-3 shrink-0 rounded-xl bg-card shadow-[var(--surface-shadow)]">
      <div className="flex items-center justify-between gap-4 border-b border-border px-5 py-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs">
          <span className="rounded-full bg-primary px-2 py-1 font-semibold text-primary-foreground">
            Turn {record.turnIndex + 1}
          </span>
          <span className="text-muted-foreground">{formatTurnRange(record, detail.startedAt)}</span>
          <span className="rounded-full bg-violet-50 border border-violet-200 px-2 py-1 font-semibold text-violet-700 dark:bg-violet-500/16 dark:border-violet-400/20 dark:text-violet-200">
            TTFT {fmtMs(record.ttftMs)}
          </span>
          <span className="rounded-full bg-sky-50 border border-sky-200 px-2 py-1 font-semibold text-sky-700 dark:bg-sky-500/16 dark:border-sky-400/20 dark:text-sky-200">
            {fmtCompactNumber(totalTokens)} tokens
          </span>
        </div>

        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <button
            type="button"
            onClick={() => onSelectTurn(Math.max(0, selectedTurn - 1))}
            disabled={selectedTurn === 0}
            className="rounded-full p-1.5 transition-colors hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-40"
            aria-label="Previous turn"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="min-w-10 text-center font-medium text-muted-foreground">
            {selectedTurn + 1} / {detail.records.length}
          </span>
          <button
            type="button"
            onClick={() => onSelectTurn(Math.min(detail.records.length - 1, selectedTurn + 1))}
            disabled={selectedTurn === detail.records.length - 1}
            className="rounded-full p-1.5 transition-colors hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-40"
            aria-label="Next turn"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="border-b border-border bg-secondary/30 px-5 py-2">
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

      <div className="bg-secondary/30 p-5">
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
    <div className="flex min-h-full flex-col">
      <TimelineOverview detail={detail} selectedTurn={selectedTurn} onSelectTurn={onSelectTurn} />
      <TurnDetail
        detail={detail}
        selectedTurn={selectedTurn}
        detailTab={detailTab}
        onDetailTabChange={onDetailTabChange}
        onSelectTurn={onSelectTurn}
      />
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
    <div className="rounded-xl border border-white/45 bg-white/88 p-3 shadow-[0_12px_28px_rgba(15,23,42,0.06)] dark:border-white/10 dark:bg-slate-950/[0.58] dark:shadow-[0_12px_28px_rgba(0,0,0,0.28)]">
      <p className={cn('mb-2 text-[11px] font-semibold uppercase tracking-wider', accentClass)}>{title}</p>
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
    <div className="rounded-xl bg-card p-4 shadow-sm">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={cn('metric-number mt-2 text-2xl font-semibold text-foreground', accentClass)}>{value}</p>
      {sub && <p className="mt-1 text-xs text-muted-foreground">{sub}</p>}
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
    <div className="overflow-hidden rounded-xl bg-card shadow-sm">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-4 px-4 py-3 text-left transition-colors hover:bg-secondary/50"
      >
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <span className="rounded-full bg-primary px-2 py-0.5 text-[11px] font-semibold text-primary-foreground">
            T{record.turnIndex + 1}
          </span>
          <div className="min-w-0">
            <div className="text-sm font-medium text-foreground">{formatTurnRange(record, sessionStart)}</div>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
              <span>Total {fmtMs(record.latencyMs)}</span>
              <span>TTFT {fmtMs(record.ttftMs)}</span>
              <span>TPOT {record.tpotMs != null ? `${record.tpotMs.toFixed(1)} ms/tok` : '-'}</span>
              <span>↑ {fmtNum(record.inputTokens)}</span>
              <span>↓ {fmtNum(record.outputTokens)}</span>
              <span>{toolCalls.length} tool calls</span>
              {record.error && (
                <span className="rounded-full bg-red-50 px-2 py-0.5 font-medium text-red-600 dark:bg-red-500/14 dark:text-red-300">Error</span>
              )}
            </div>
          </div>
        </div>
        <ChevronDown className={cn('h-4 w-4 flex-shrink-0 text-muted-foreground/70 transition-transform', expanded && 'rotate-180')} />
      </button>

      {expanded && (
        <div className="border-t border-border bg-secondary/30 p-4">
          <div className="grid gap-3 xl:grid-cols-2">
            <PayloadBlock title="Request" payload={record.clientRequest} accentClass="text-blue-600" />
            <PayloadBlock title="Response" payload={record.clientResponse} accentClass="text-violet-600" />
          </div>
          <div className="mt-3 grid gap-3 xl:grid-cols-[minmax(0,1fr)_280px]">
            <div className="rounded-xl bg-card p-3 shadow-sm">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-amber-600">Tool Calls</p>
              <pre className="max-h-64 overflow-auto rounded-lg bg-slate-950/95 p-3 text-xs leading-5 text-slate-200">
                {toolCalls.length > 0 ? JSON.stringify(toolCalls, null, 2) : '(no tool calls)'}
              </pre>
            </div>
            <div className="rounded-xl bg-card p-3 shadow-sm">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Turn Metrics</p>
              <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
                <div>
                  <dt className="text-muted-foreground">Duration</dt>
                  <dd className="mt-0.5 font-medium text-foreground">{fmtMs(record.latencyMs)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">TTFT</dt>
                  <dd className="mt-0.5 font-medium text-foreground">{fmtMs(record.ttftMs)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">TPOT</dt>
                  <dd className="mt-0.5 font-medium text-foreground">
                    {record.tpotMs != null ? `${record.tpotMs.toFixed(1)} ms/tok` : '-'}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Status</dt>
                  <dd className="mt-0.5 font-medium text-foreground">{record.statusCode ?? '-'}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Input</dt>
                  <dd className="mt-0.5 font-medium text-foreground">{fmtNum(record.inputTokens)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Output</dt>
                  <dd className="mt-0.5 font-medium text-foreground">{fmtNum(record.outputTokens)}</dd>
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
  const { t } = useTranslation()
  if (detail.records.length === 0) {
    return (
      <PageState
        compact
        className="min-h-[220px]"
        title={t('profiler.empty.noTurnsTitle')}
        description={t('profiler.empty.noTurnsDescription')}
      />
    )
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
            <h3 className="text-sm font-semibold text-foreground">Per-Turn Breakdown</h3>
            <p className="mt-1 text-xs text-muted-foreground">Expand a turn to inspect request, response, tool calls, and errors.</p>
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
  const { t } = useTranslation()
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
    if (!selectedId && filteredSessions.length > 0) {
      setSelectedId(filteredSessions[0].id)
    }
  }, [filteredSessions, selectedId])

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
    <div className="flex min-h-0 flex-col gap-3 lg:h-[calc(100vh-64px)]">
      <PageHeader
        className="flex-none"
        icon={<Activity className="h-5 w-5" aria-hidden="true" />}
        title={t('profiler.title')}
        description={t('profiler.description')}
        eyebrow={t('profiler.eyebrow')}
        breadcrumb={t('profiler.breadcrumb')}
        helper={selectedId ? t('profiler.empty.selectDescription') : undefined}
        badge={(
          <span className={cn('inline-flex items-center gap-1.5', isRecording ? 'text-red-600 dark:text-red-300' : 'text-muted-foreground')}>
            <span className={cn('inline-block h-1.5 w-1.5 rounded-full', isRecording ? 'bg-red-500' : 'bg-muted-foreground/70')} />
            {isRecording ? t('profiler.status.recording') : t('profiler.status.idle')}
          </span>
        )}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              variant="secondary"
              className="rounded-full px-3 py-1 text-[11px]"
            >
              {t('profiler.sessionsCount', { count: sessions.length })}
            </Badge>
            <Button
              size="sm"
              variant={isRecording ? 'destructive' : 'default'}
              onClick={() => (isRecording ? stopMutation.mutate() : startMutation.mutate())}
              disabled={startMutation.isPending || stopMutation.isPending}
            >
              {isRecording ? t('profiler.actions.stop') : t('profiler.actions.start')}
            </Button>
            <Button size="sm" variant="outline" onClick={exportSelectedSession} disabled={!detail}>
              <Download className="mr-1.5 h-3.5 w-3.5" />
              {t('profiler.actions.export')}
            </Button>
            <Button size="sm" variant="outline" onClick={() => clearMutation.mutate()} disabled={sessions.length === 0} className="border-red-200 bg-red-50 text-red-700 hover:bg-red-100 hover:text-red-800 dark:border-red-400/20 dark:bg-red-500/14 dark:text-red-300 dark:hover:bg-red-500/20 dark:hover:text-red-200">
              <Trash2 className="mr-1.5 h-3.5 w-3.5" />
              {t('profiler.actions.clear')}
            </Button>
          </div>
        }
      />

      <div className="flex min-h-0 flex-1 flex-col gap-3 bg-background lg:flex-row lg:gap-0 lg:overflow-hidden">
        <div className="flex w-full flex-shrink-0 flex-col overflow-hidden rounded-[1.2rem] border border-white/70 bg-card/96 shadow-[0_20px_48px_-42px_rgba(15,23,42,0.26)] lg:w-[300px]">
          <div className="flex items-center justify-between border-b border-border/45 px-4 py-3">
            <span className="text-sm font-semibold text-foreground">{t('profiler.sessionsTitle')}</span>
            <Badge variant="secondary" className="rounded-full px-2 py-0.5">
              {sessions.length}
            </Badge>
          </div>

          <div className="flex items-center gap-2 border-b border-border bg-secondary/50 px-3 py-2.5">
            <Search className="h-3.5 w-3.5 text-muted-foreground/70" />
            <input
              className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground/70"
              placeholder={t('profiler.searchPlaceholder')}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>

          <div className="max-h-[240px] overflow-y-auto lg:min-h-0 lg:max-h-none lg:flex-1">
            {sessionsQuery.isPending ? (
              <PageLoadingState compact className="min-h-[160px]" label={t('common.loading')} />
            ) : filteredSessions.length === 0 ? (
              <PageState
                compact
                className="m-4 min-h-[160px]"
                title={isRecording ? t('profiler.empty.waitingTitle') : t('profiler.empty.idleTitle')}
                description={isRecording ? t('profiler.empty.waitingDescription') : t('profiler.empty.idleDescription')}
                action={
                  isRecording ? (
                    <Button asChild variant="ghost" size="sm">
                      <Link to="/logs">{t('profiler.empty.actions.logs')}</Link>
                    </Button>
                  ) : (
                    <Button size="sm" onClick={() => startMutation.mutate()} disabled={startMutation.isPending}>
                      {t('profiler.actions.start')}
                    </Button>
                  )
                }
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

        <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-[1.2rem] border border-white/70 bg-card/96 shadow-[0_20px_48px_-42px_rgba(15,23,42,0.26)] lg:ml-3">
          {!selectedId ? (
            <div className="flex flex-1 items-center justify-center">
              <PageState
                title={t('profiler.empty.selectTitle')}
                description={t('profiler.empty.selectDescription')}
                icon={<Activity className="h-5 w-5" />}
              />
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between gap-4 border-b border-border bg-card px-5 py-3.5">
                <div className="flex min-w-0 items-center gap-2.5">
                  <span className="h-2.5 w-2.5 flex-shrink-0 rounded-full bg-indigo-500" />
                  <span className="truncate text-sm font-semibold text-foreground">
                    {detail?.sessionId ?? selectedSession?.sessionId ?? selectedId}
                  </span>
                  <span className="text-muted-foreground/70">·</span>
                  <span className="truncate text-sm text-muted-foreground">
                    {detail
                      ? t('profiler.sessionSummary', {
                          turns: detail.turnCount,
                          duration: fmtMsCompact(totalMs(detail)),
                          tokens: fmtCompactNumber((detail.totalInputTokens ?? 0) + (detail.totalOutputTokens ?? 0))
                        })
                      : t('profiler.loadingSession')}
                  </span>
                </div>

                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => selectedId && deleteMutation.mutate(selectedId)}
                  disabled={!selectedId || deleteMutation.isPending}
                  className="text-muted-foreground hover:text-red-700"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>

              <div className="border-b border-border bg-secondary/30 px-5 py-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <SegmentedTab active={tab === 'timeline'} icon={LayoutList} label={t('profiler.tabs.timeline')} onClick={() => setTab('timeline')} />
                  <SegmentedTab active={tab === 'breakdown'} icon={BarChart3} label={t('profiler.tabs.breakdown')} onClick={() => setTab('breakdown')} />
                </div>
              </div>

              <div data-testid="profiler-session-content" className="min-h-0 flex-1 overflow-auto bg-secondary/20">
                {detailQuery.isPending ? (
                  <PageLoadingState compact className="min-h-[240px]" label={t('profiler.loadingSession')} />
                ) : detailQuery.isError ? (
                  <PageState compact className="m-5 min-h-[220px]" tone="danger" title={t('profiler.errors.loadFailed')} />
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
                  <PageState compact className="m-5 min-h-[220px]" title={t('profiler.errors.notFound')} />
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
