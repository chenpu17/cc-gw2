import { requestJson } from '@/services/api'
import type { GatewayEvent } from '@/types/events'
import type { LogListResponse } from '@/types/logs'
import type {
  DailyMetric,
  DatabaseInfo,
  ModelUsageMetric,
  OverviewStats,
  ServiceStatus
} from '@/pages/dashboard/types'

/** Aggregated first-screen payload from GET /api/dashboard/summary */
export interface DashboardSummary {
  status: ServiceStatus
  overview: OverviewStats
  daily: DailyMetric[]
  modelStats: ModelUsageMetric[]
  recentRequests: LogListResponse
  recentErrors: GatewayEvent[]
  dbInfo: DatabaseInfo
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
