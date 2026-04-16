import type { TFunction } from 'i18next'
import type { LogRecord } from '@/types/logs'

const SESSION_ROW_HUES = [168, 184, 198, 208, 218, 228, 238, 248, 258, 268, 278, 292] as const
const MAX_PRETTY_PRINT_PAYLOAD_LENGTH = 200_000

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
  const accent = `hsl(${hue} 74% 46%)`

  return {
    sessionId: normalized,
    colorKey: `${hue}`,
    rowStyle: {
      backgroundColor: `hsl(${hue} 74% 46% / 0.05)`
    },
    hoverStyle: {
      backgroundColor: `hsl(${hue} 74% 46% / 0.09)`
    },
    stickyStyle: {
      backgroundColor: `hsl(${hue} 74% 46% / 0.08)`
    },
    accentStyle: {
      borderLeft: `3px solid ${accent}`
    }
  }
}
