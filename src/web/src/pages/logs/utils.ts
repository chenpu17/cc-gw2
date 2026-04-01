import type { TFunction } from 'i18next'
import type { LogRecord } from '@/types/logs'

const SESSION_ROW_HUES = [12, 28, 48, 88, 112, 152, 184, 208, 228, 262, 292, 332] as const

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
  const accent = `hsl(${hue} 82% 42%)`

  return {
    sessionId: normalized,
    colorKey: `${hue}`,
    rowStyle: {
      backgroundColor: `hsl(${hue} 82% 42% / 0.08)`
    },
    hoverStyle: {
      backgroundColor: `hsl(${hue} 82% 42% / 0.12)`
    },
    stickyStyle: {
      backgroundColor: `hsl(${hue} 82% 42% / 0.1)`
    },
    accentStyle: {
      borderLeft: `3px solid ${accent}`
    }
  }
}
