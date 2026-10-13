import type { AxiosRequestConfig } from 'axios'

export type UsageDimensionId = 'providers' | 'endpoints' | 'clients'

/** Usage grouped by provider / endpoint / agent client kind (v0.14 dimension stats). */
export interface DimensionUsageMetric {
  key: string
  requests: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
  avgLatencyMs: number
  /** Sum of priced requests' cost (display currency); null = nothing priced (v0.16). */
  cost: number | null
  unpricedRequests: number
}

export const statsApi = {
  dimensionRequest(dimension: UsageDimensionId, days: number, limit: number, endpoint?: string) {
    return {
      url: `/api/stats/${dimension}`,
      method: 'GET' as const,
      params: {
        days,
        limit,
        ...(endpoint ? { endpoint } : {})
      }
    } satisfies AxiosRequestConfig
  }
}
