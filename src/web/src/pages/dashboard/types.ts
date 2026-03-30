export interface OverviewStats {
  totals: {
    requests: number
    inputTokens: number
    outputTokens: number
    cachedTokens: number
    cacheReadTokens: number
    cacheCreationTokens: number
    avgLatencyMs: number
  }
  today: {
    requests: number
    inputTokens: number
    outputTokens: number
    cachedTokens: number
    cacheReadTokens: number
    cacheCreationTokens: number
    avgLatencyMs: number
  }
}

export interface DailyMetric {
  date: string
  requestCount: number
  inputTokens: number
  outputTokens: number
  cachedTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
  avgLatencyMs: number
}

export interface ModelUsageMetric {
  model: string
  provider: string
  requests: number
  inputTokens: number
  outputTokens: number
  avgLatencyMs: number
  avgTtftMs: number | null
  avgTpotMs: number | null
}

export interface ServiceStatus {
  port: number
  host?: string
  providers: number
  activeRequests?: number
  requestsPerMinute?: number
  outputTokensPerMinute?: number
  cpuUsagePercent?: number
  activeClientAddresses?: number
  activeClientSessions?: number
  uniqueClientAddressesLastHour?: number
  uniqueClientSessionsLastHour?: number
}

export interface DatabaseInfo {
  pageCount: number
  pageSize: number
  sizeBytes: number
  freelistPages?: number
  fileSizeBytes?: number
  walSizeBytes?: number
  totalBytes?: number
  memoryRssBytes?: number
  memoryHeapBytes?: number
  memoryExternalBytes?: number
}

export const LIVE_REFRESH_MS = 15_000
export const TREND_REFRESH_MS = 60_000

export const METRIC_COLORS = {
  requests: '#2563eb',
  input: '#059669',
  output: '#ea580c',
  cacheRead: '#7c3aed',
  cacheCreation: '#e11d48',
  latency: '#0891b2'
} as const

export function formatLatencyValue(
  value: number | null | undefined,
  suffix: string,
  options?: Intl.NumberFormatOptions
): string {
  if (value === null || value === undefined) {
    return '-'
  }

  return `${value.toLocaleString(undefined, options)} ${suffix}`
}

export function formatBytes(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return '-'
  }
  if (value < 1024) {
    return `${value} B`
  }

  const units = ['KB', 'MB', 'GB', 'TB'] as const
  let bytes = value / 1024
  let unitIndex = 0

  while (bytes >= 1024 && unitIndex < units.length - 1) {
    bytes /= 1024
    unitIndex += 1
  }

  return `${bytes.toFixed(bytes >= 100 ? 0 : bytes >= 10 ? 1 : 2)} ${units[unitIndex]}`
}

export function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return '-'
  }

  return `${value.toLocaleString(undefined, {
    maximumFractionDigits: value >= 10 ? 0 : 1
  })}%`
}
