import { storageKeys } from '@/services/storageKeys'

export const PAGE_SIZE_OPTIONS = [20, 50, 100]

export type StatusFilter = 'all' | 'success' | 'error'
export type RowDensity = 'comfortable' | 'compact'
export type QuickView = 'all' | 'errors' | 'today' | 'anthropic' | 'openai'
export type LogColumnId =
  | 'endpoint'
  | 'provider'
  | 'requestedModel'
  | 'routedModel'
  | 'apiKey'
  | 'inputTokens'
  | 'cacheReadTokens'
  | 'cacheCreationTokens'
  | 'outputTokens'
  | 'latency'
  | 'ttft'
  | 'tpot'
  | 'status'
  | 'error'

export type DateInput = string

export const DEFAULT_VISIBLE_COLUMNS: LogColumnId[] = [
  'endpoint',
  'provider',
  'requestedModel',
  'routedModel',
  'apiKey',
  'inputTokens',
  'cacheReadTokens',
  'cacheCreationTokens',
  'outputTokens',
  'latency',
  'ttft',
  'tpot',
  'status',
  'error'
]

export const LOG_COLUMN_ORDER: LogColumnId[] = [
  'endpoint',
  'provider',
  'requestedModel',
  'routedModel',
  'apiKey',
  'inputTokens',
  'cacheReadTokens',
  'cacheCreationTokens',
  'outputTokens',
  'latency',
  'ttft',
  'tpot',
  'status',
  'error'
]

export function loadStoredColumns(): LogColumnId[] {
  if (typeof window === 'undefined') return DEFAULT_VISIBLE_COLUMNS
  try {
    const raw = window.localStorage.getItem(storageKeys.logs.visibleColumns)
    if (!raw) return DEFAULT_VISIBLE_COLUMNS
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return DEFAULT_VISIBLE_COLUMNS
    const next = parsed.filter((value): value is LogColumnId => LOG_COLUMN_ORDER.includes(value))
    return next.length > 0 ? next : DEFAULT_VISIBLE_COLUMNS
  } catch {
    return DEFAULT_VISIBLE_COLUMNS
  }
}

export function loadStoredDensity(): RowDensity {
  if (typeof window === 'undefined') return 'comfortable'
  const raw = window.localStorage.getItem(storageKeys.logs.density)
  return raw === 'compact' ? 'compact' : 'comfortable'
}

export function loadStoredPageSize(): number {
  if (typeof window === 'undefined') return PAGE_SIZE_OPTIONS[0]
  const raw = window.localStorage.getItem(storageKeys.logs.pageSize)
  const next = Number(raw)
  return PAGE_SIZE_OPTIONS.includes(next) ? next : PAGE_SIZE_OPTIONS[0]
}

export function loadStoredApiKeyFilters(): number[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(storageKeys.logs.selectedApiKeys)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value) && value > 0)
  } catch {
    return []
  }
}

export function toTimestamp(value: DateInput, endOfDay = false): number | undefined {
  if (!value) return undefined
  const base = endOfDay ? `${value}T23:59:59.999` : `${value}T00:00:00.000`
  const timestamp = Date.parse(base)
  return Number.isFinite(timestamp) ? timestamp : undefined
}

export function isSameDateFilter(fromDate: DateInput, toDate: DateInput, date: string): boolean {
  return fromDate === date && toDate === date
}
