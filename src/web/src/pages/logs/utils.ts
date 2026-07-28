import type { TFunction } from 'i18next'
import type { LogRecord } from '@/types/logs'

const SESSION_ROW_HUES = [168, 184, 198, 208, 218, 228, 238, 248, 258, 268, 278, 292] as const
const MAX_PRETTY_PRINT_PAYLOAD_LENGTH = 200_000
const MAX_RENDER_PAYLOAD_LENGTH = 120_000

export interface PayloadDisplay {
  displayedLength: number
  isTruncated: boolean
  originalLength: number
  text: string
}

export function formatDateTime(timestamp: number): string {
  const date = new Date(timestamp)
  return `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, '0')}-${`${date.getDate()}`.padStart(2, '0')} ${`${date.getHours()}`.padStart(2, '0')}:${`${date.getMinutes()}`.padStart(2, '0')}:${`${date.getSeconds()}`.padStart(2, '0')}`
}

export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) return '-'
  return value.toLocaleString()
}

export function formatLatency(value: number | null | undefined, suffix: string): string {
  const formatted = formatNumber(value)
  return formatted === '-' ? '-' : `${formatted} ${suffix}`
}

export function formatStreamLabel(stream: boolean): string {
  return stream ? 'true' : 'false'
}

export function formatPayloadDisplay(value: string | null | undefined, fallback: string): string {
  if (!value || value.trim().length === 0) {
    return fallback
  }
  // Avoid allocating another large parsed object plus a reformatted copy for very large payloads.
  if (value.length > MAX_PRETTY_PRINT_PAYLOAD_LENGTH) {
    return value
  }
  try {
    const parsed = JSON.parse(value)
    return JSON.stringify(parsed, null, 2)
  } catch {
    return value
  }
}

export function buildTextDisplay(text: string): PayloadDisplay {
  if (text.length <= MAX_RENDER_PAYLOAD_LENGTH) {
    return {
      displayedLength: text.length,
      isTruncated: false,
      originalLength: text.length,
      text
    }
  }

  return {
    displayedLength: MAX_RENDER_PAYLOAD_LENGTH,
    isTruncated: true,
    originalLength: text.length,
    text: `${text.slice(0, MAX_RENDER_PAYLOAD_LENGTH)}\n\n...`
  }
}

export function buildPayloadDisplay(value: string | null | undefined, fallback: string): PayloadDisplay {
  return buildTextDisplay(formatPayloadDisplay(value, fallback))
}

export function getLogStatusMeta(
  record: Pick<LogRecord, 'status_code' | 'error'>,
  t: TFunction
) {
  if (record.status_code === null || record.status_code === undefined) {
    if (!record.error) {
      return {
        label: t('common.status.pending'),
        tone: 'pending' as const,
        variant: 'warning' as const
      }
    }

    return {
      label: t('common.status.error'),
      tone: 'error' as const,
      variant: 'destructive' as const
    }
  }

  if (record.error || record.status_code >= 400) {
    return {
      label: record.status_code.toString(),
      tone: 'error' as const,
      variant: 'destructive' as const
    }
  }

  return {
    label: record.status_code.toString(),
    tone: 'success' as const,
    variant: 'success' as const
  }
}

export function getLogErrorSourceMeta(
  record: Pick<LogRecord, 'error_source' | 'status_code' | 'error'>,
  t: TFunction
) {
  const hasError = Boolean(record.error) || (record.status_code ?? 0) >= 400
  if (!hasError) {
    return {
      label: t('logs.detail.errorSource.none'),
      tone: 'none' as const
    }
  }

  switch (record.error_source) {
    case 'client':
      return {
        label: t('logs.detail.errorSource.client'),
        tone: 'client' as const
      }
    case 'gateway':
      return {
        label: t('logs.detail.errorSource.gateway'),
        tone: 'gateway' as const
      }
    case 'upstream':
      return {
        label: t('logs.detail.errorSource.upstream'),
        tone: 'upstream' as const
      }
    default:
      return {
        label: t('logs.detail.errorSource.unknown'),
        tone: 'unknown' as const
      }
  }
}

export type LogTraceTone = 'accent' | 'ok' | 'warn' | 'error'

export interface LogTraceStep {
  id: string
  title: string
  atLabel: string
  durLabel: string | null
  detail: string
  tone: LogTraceTone
  /** Phase duration as a share of total latency, 0–100. */
  barPct: number
}

/**
 * Derive a request-trace timeline from the timing fields we actually store.
 * The backend doesn't record per-step timestamps yet (gateway auth/route
 * phases are not instrumented), so we honestly surface only the phases we can
 * compute: arrival (0), upstream first token (ttft), and completion (latency).
 * When ttft is missing the trace degrades to arrival + completion and the UI
 * shows a "derived" hint.
 */
export function buildLogTrace(
  record: LogRecord,
  providerLabel: string,
  t: TFunction
): LogTraceStep[] {
  const total = record.latency_ms
  const ttft = record.ttft_ms
  const hasTotal = total != null && total > 0
  const isError = Boolean(record.error) || (record.status_code ?? 0) >= 400
  const steps: LogTraceStep[] = []

  steps.push({
    id: 'arrived',
    title: t('logs.detail.trace.arrived'),
    atLabel: '0 ms',
    durLabel: null,
    detail: [
      record.endpoint || '-',
      record.stream ? t('logs.detail.trace.streamOn') : t('logs.detail.trace.streamOff')
    ].join(' · '),
    tone: 'accent',
    barPct: 0
  })

  if (ttft != null && ttft > 0) {
    steps.push({
      id: 'ttft',
      title: t('logs.detail.trace.ttft'),
      atLabel: `+${formatNumber(ttft)} ms`,
      durLabel: `${formatNumber(ttft)} ms`,
      detail: `${providerLabel} · ${record.model}`,
      tone: 'warn',
      barPct: hasTotal ? Math.min(100, Math.round((ttft / (total as number)) * 100)) : 100
    })
  }

  if (hasTotal) {
    const streamDur = (total as number) - (ttft ?? 0)
    const detailParts = [
      `${formatNumber(record.output_tokens)} ${t('common.units.token')}`,
      record.tpot_ms != null
        ? `${t('logs.detail.trace.tpot')} ${formatNumber(record.tpot_ms)} ${t('common.units.msPerToken')}`
        : null
    ].filter((part): part is string => Boolean(part))
    steps.push({
      id: 'complete',
      title: t('logs.detail.trace.complete'),
      atLabel: `+${formatNumber(total)} ms`,
      durLabel: streamDur > 0 ? `${formatNumber(streamDur)} ms` : null,
      detail: detailParts.join(' · '),
      tone: isError ? 'error' : 'ok',
      barPct: streamDur > 0 ? Math.min(100, Math.round((streamDur / (total as number)) * 100)) : 0
    })
  } else {
    steps.push({
      id: 'pending',
      title: t('logs.detail.trace.pending'),
      atLabel: '',
      durLabel: null,
      detail: '',
      tone: 'warn',
      barPct: 0
    })
  }

  return steps
}

function hashSessionId(value: string): number {
  let hash = 0
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0
  }
  return hash
}

export function getSessionRowTone(sessionId: string | null | undefined) {
  const normalized = sessionId?.trim()
  if (!normalized) {
    return null
  }

  const hash = hashSessionId(normalized)
  const hue = SESSION_ROW_HUES[hash % SESSION_ROW_HUES.length]
  const accent = `hsl(${hue} 74% 46% / 0.55)`

  // Subtle session marker only: a thin colored left bar on the first cell.
  // No full-row background tint — same-session rows stay visually grouped via
  // the shared hue without the heavy purple wash.
  return {
    sessionId: normalized,
    colorKey: `${hue}`,
    accentStyle: {
      borderLeft: `2px solid ${accent}`
    }
  }
}
