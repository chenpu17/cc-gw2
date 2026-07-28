import { useApiQuery } from '@/hooks/useApiQuery'
import { queryKeys } from '@/services/queryKeys'
import type { DashboardSummary } from '@/services/dashboard'

const RPM_POLL_MS = 15_000

/**
 * Live rpm source for the app header. Reuses the dashboard summary query key so
 * it dedupes against the dashboard page and just refreshes on a slow cadence.
 * Silent on error — the badge simply holds the last known value.
 */
export function useHeaderRpm(): number {
  const { data } = useApiQuery<DashboardSummary>(
    queryKeys.dashboard.summary(),
    {
      url: '/api/dashboard/summary',
      method: 'GET'
    },
    {
      refetchInterval: RPM_POLL_MS,
      refetchOnWindowFocus: true,
      staleTime: RPM_POLL_MS,
      retry: false
    }
  )
  return data?.status?.requestsPerMinute ?? 0
}
