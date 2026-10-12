import { requestJson } from '@/services/api'
import type { GatewayEvent } from '@/types/events'
import type { LogListResponse } from '@/types/logs'
import type {
  DailyMetric,
  DatabaseInfo,
  ModelUsageMetric,
  OverviewStats,
  RecentThroughput,
  ServiceStatus
} from '@/pages/dashboard/types'

/** Aggregated first-screen payload from GET /api/dashboard/summary */
export interface DashboardSummary {
  status: ServiceStatus
  overview: OverviewStats
  daily: DailyMetric[]
  modelStats: ModelUsageMetric[]
  recentThroughput?: RecentThroughput
  /** Rolling 1-hour per-agent-client usage rollup (v0.14). */
  clientActivity?: ClientActivityEntry[]
  recentRequests: LogListResponse
  recentErrors: GatewayEvent[]
  dbInfo: DatabaseInfo
}

export interface ClientActivityEntry {
  clientKind: string
  requests: number
  sessions: number
  inputTokens: number
  outputTokens: number
}

export const dashboardApi = {
  summary: async (endpoint?: string): Promise<DashboardSummary> => {
    return requestJson<DashboardSummary>({
      url: '/api/dashboard/summary',
      method: 'GET',
      params: endpoint ? { endpoint } : undefined
    })
  }
}
