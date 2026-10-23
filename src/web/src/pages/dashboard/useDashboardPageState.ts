import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { type EChartOption } from '@/components/EChart'
import { useChartTheme } from '@/components/chartTheme'
import { useApiQuery } from '@/hooks/useApiQuery'
import { useEventStream } from '@/hooks/useEventStream'
import { usePersistentState } from '@/hooks/usePersistentState'
import { useToast } from '@/providers/ToastProvider'
import { type ApiError } from '@/services/api'
import { apiKeysApi } from '@/services/apiKeys'
import type { DashboardSummary } from '@/services/dashboard'
import { gatewayApi } from '@/services/gateway'
import { queryKeys } from '@/services/queryKeys'
import { statsApi, type DimensionUsageMetric, type UsageDimensionId } from '@/services/stats'
import { storageKeys } from '@/services/storageKeys'
import type { ApiKeySummary, ApiKeyUsageMetric } from '@/types/apiKeys'
import type { CustomEndpointsResponse } from '@/types/endpoints'
import type { EndpointRoutingConfig, GatewayConfig } from '@/types/providers'
import {
  LIVE_REFRESH_MS,
  TREND_REFRESH_MS,
  type DailyMetric,
  type ModelUsageMetric
} from './types'

export const SETUP_TOTAL_STEPS = 4

/** Usage-distribution tabs: three server dimensions + the api-key rollup. */
export type UsageDistributionTab = UsageDimensionId | 'apiKeys'
export const USAGE_WINDOW_DAYS = 7
const USAGE_ROW_LIMIT = 10

/** Route rules across system endpoints, custom endpoints and the legacy top-level map */
function countConfiguredRouteRules(config: GatewayConfig | undefined): number {
  if (!config) return 0
  const countRouting = (routing: EndpointRoutingConfig | undefined) =>
    Object.keys(routing?.modelRoutes ?? {}).length +
    Object.keys(routing?.modelRoutesByProtocol?.anthropic ?? {}).length +
    Object.keys(routing?.modelRoutesByProtocol?.openai ?? {}).length
  let count = Object.keys(config.modelRoutes ?? {}).length
  for (const routing of Object.values(config.endpointRouting ?? {})) {
    count += countRouting(routing)
  }
  for (const endpoint of config.customEndpoints ?? []) {
    count += countRouting(endpoint.routing)
  }
  return count
}

export function useDashboardPageState() {
  const { t } = useTranslation()
  const { pushToast } = useToast()
  const chart = useChartTheme()
  const [endpointFilter, setEndpointFilter] = usePersistentState<string>(
    storageKeys.dashboard.endpointFilter,
    'all'
  )
  const endpointParam = endpointFilter === 'all' ? undefined : endpointFilter

  const summaryQuery = useApiQuery<DashboardSummary, ApiError>(
    queryKeys.dashboard.summary(endpointFilter),
    {
      url: '/api/dashboard/summary',
      method: 'GET',
      params: endpointParam ? { endpoint: endpointParam } : undefined
    },
    { refetchInterval: LIVE_REFRESH_MS }
  )

  const customEndpointsQuery = useApiQuery<CustomEndpointsResponse, ApiError>(
    queryKeys.customEndpoints.all(),
    { url: '/api/custom-endpoints', method: 'GET' },
    { refetchInterval: TREND_REFRESH_MS }
  )

  // Usage distribution across provider / endpoint / client / api-key dimensions,
  // scoped to the dashboard's endpoint filter like every other card.
  const [usageDimension, setUsageDimension] = usePersistentState<UsageDistributionTab>(
    storageKeys.dashboard.usageDimension,
    'providers'
  )
  const usageDimensionQuery = useApiQuery<DimensionUsageMetric[] | ApiKeyUsageMetric[], ApiError>(
    usageDimension === 'apiKeys'
      ? queryKeys.apiKeys.usage(USAGE_WINDOW_DAYS, endpointFilter)
      : queryKeys.stats.usageDimension(usageDimension, USAGE_WINDOW_DAYS, USAGE_ROW_LIMIT, endpointFilter),
    usageDimension === 'apiKeys'
      ? apiKeysApi.usageRequest(USAGE_WINDOW_DAYS, USAGE_ROW_LIMIT, endpointParam)
      : statsApi.dimensionRequest(usageDimension, USAGE_WINDOW_DAYS, USAGE_ROW_LIMIT, endpointParam),
    { refetchInterval: TREND_REFRESH_MS }
  )
  const usageRows = useMemo<DimensionUsageMetric[]>(() => {
    const rows = usageDimensionQuery.data ?? []
    if (usageDimension !== 'apiKeys') return rows as DimensionUsageMetric[]
    // Normalize the api-key rollup into the shared row shape (name or #id as key).
    return (rows as ApiKeyUsageMetric[]).map((row) => ({
      key: row.apiKeyName ?? (row.apiKeyId != null ? `#${row.apiKeyId}` : '—'),
      requests: row.requests,
      inputTokens: row.inputTokens,
      outputTokens: row.outputTokens,
      cacheReadTokens: row.cacheReadTokens ?? 0,
      cacheCreationTokens: row.cacheCreationTokens ?? 0,
      avgLatencyMs: row.avgLatencyMs ?? 0,
      cost: row.cost ?? null,
      unpricedRequests: row.unpricedRequests ?? 0
    }))
  }, [usageDimensionQuery.data, usageDimension])

  // Live warn/error event feed via SSE; prepended onto the snapshot from summary
  const liveEvents = useEventStream({ level: 'warn,error', maxEvents: 20 })

  const summaryErrorShownRef = useRef(false)
  useEffect(() => {
    // v5 keeps `isError` false while cached data exists and a background
    // refetch fails (the failure only surfaces on `query.error`). Gate on
    // `error` directly so a downed backend after first load still toasts once.
    const hasError = summaryQuery.error != null
    if (hasError && !summaryErrorShownRef.current) {
      summaryErrorShownRef.current = true
      pushToast({
        title: t('dashboard.toast.overviewError'),
        description: summaryQuery.error?.message ?? '',
        variant: 'error'
      })
    }
    if (!hasError) {
      summaryErrorShownRef.current = false
    }
  }, [summaryQuery.error, pushToast, t])

  const handleRefresh = useCallback(async () => {
    await Promise.all([
      summaryQuery.refetch(),
      customEndpointsQuery.refetch(),
      usageDimensionQuery.refetch()
    ])
  }, [summaryQuery, customEndpointsQuery, usageDimensionQuery])

  const summary = summaryQuery.data
  const overview = summary?.overview
  const daily = useMemo(() => summary?.daily ?? [], [summary])
  const models = useMemo(() => summary?.modelStats ?? [], [summary])
  const status = summary?.status
  const recentThroughput = summary?.recentThroughput
  const clientActivity = useMemo(() => summary?.clientActivity ?? [], [summary])
  const dbInfo = summary?.dbInfo
  const recentLogs = summary?.recentRequests.items ?? []

  // Cold-start completion: provider + route rule + API key + first request log.
  // The extra queries stay disabled until the previous step is satisfied.
  const hasProviders = (status?.providers ?? 0) > 0
  const hasRequestLogs = recentLogs.length > 0

  const setupConfigQuery = useApiQuery<GatewayConfig, ApiError>(
    queryKeys.config.full(),
    gatewayApi.configRequest(),
    { enabled: hasProviders }
  )
  const routeRuleCount = useMemo(
    () => countConfiguredRouteRules(setupConfigQuery.data),
    [setupConfigQuery.data]
  )
  const hasRouteRules = routeRuleCount > 0

  const apiKeysQuery = useApiQuery<ApiKeySummary[], ApiError>(
    queryKeys.apiKeys.all(),
    apiKeysApi.listRequest(),
    { enabled: hasProviders && hasRouteRules }
  )
  const hasApiKeys = (apiKeysQuery.data?.length ?? 0) > 0

  const setupComplete = hasProviders && hasRouteRules && hasApiKeys && hasRequestLogs
  const setupDoneCount = [hasProviders, hasRouteRules, hasApiKeys, hasRequestLogs].filter(Boolean).length

  // Merge live SSE events with the snapshot, dedup by id, newest first
  const attentionEvents = useMemo(() => {
    const snapshot = summary?.recentErrors ?? []
    const seen = new Set<number>()
    const merged = [...liveEvents.events, ...snapshot].filter((event) => {
      if (seen.has(event.id)) return false
      seen.add(event.id)
      // Live SSE events arrive globally; when the dashboard is scoped to one
      // endpoint, drop events that don't belong to it (incl. system events with
      // no endpoint) so the feed matches the server-side scoped snapshot.
      if (endpointParam && event.endpoint !== endpointParam) return false
      return true
    })
    return merged.slice(0, 10)
  }, [liveEvents.events, summary, endpointParam])

  const selectedEndpointLabel = endpointFilter === 'all'
    ? t('dashboard.filters.endpointAll')
    : endpointFilter === 'anthropic'
      ? t('dashboard.filters.endpointAnthropic')
      : endpointFilter === 'openai'
        ? t('dashboard.filters.endpointOpenAI')
        : customEndpointsQuery.data?.endpoints?.find((item) => item.id === endpointFilter)?.label || endpointFilter

  const fastestTtftModel = models
    .filter((item) => item.avgTtftMs != null && item.avgTtftMs > 0)
    .sort((a, b) => (a.avgTtftMs ?? Number.POSITIVE_INFINITY) - (b.avgTtftMs ?? Number.POSITIVE_INFINITY))[0]

  const isRefreshing = summaryQuery.isFetching || customEndpointsQuery.isFetching
  const isBootstrapping = summaryQuery.isPending
  // A failed REFETCH must not evict the cached dashboard: React Query keeps the
  // last good data, so only a failure with no data at all is fatal.
  const bootstrapError = summaryQuery.data ? null : summaryQuery.error?.message ?? null
  const refreshError = summaryQuery.data ? summaryQuery.error?.message ?? null : null

  const [trendMode, setTrendMode] = usePersistentState<'traffic' | 'cost'>(
    storageKeys.dashboard.trendMode,
    'traffic'
  )
  const trafficTrendOption = useMemo<EChartOption>(() => {
    const requestLabel = t('dashboard.charts.barRequests')
    const latencyLabel = t('dashboard.charts.latencyLabel')

    return {
      ...chart.base,
      color: chart.palette,
      tooltip: { trigger: 'axis', ...chart.base.tooltip },
      legend: { data: [requestLabel, latencyLabel], ...chart.base.legend },
      grid: chart.base.grid,
      xAxis: {
        type: 'category',
        data: daily.map((item) => item.date.slice(5)),
        axisLabel: { color: chart.axis },
        axisLine: { lineStyle: { color: chart.splitLine } }
      },
      yAxis: [
        {
          type: 'value',
          name: requestLabel,
          nameTextStyle: { color: chart.axis },
          axisLabel: { color: chart.axis },
          splitLine: { lineStyle: { color: chart.splitLine } }
        },
        {
          type: 'value',
          name: latencyLabel,
          nameTextStyle: { color: chart.axis },
          axisLabel: { color: chart.axis },
          splitLine: { show: false }
        }
      ],
      series: [
        {
          name: requestLabel,
          type: 'bar',
          data: daily.map((item) => item.requestCount),
          itemStyle: { color: chart.palette[0], borderRadius: [4, 4, 0, 0] },
          barMaxWidth: 24
        },
        {
          name: latencyLabel,
          type: 'line',
          yAxisIndex: 1,
          smooth: true,
          showSymbol: false,
          data: daily.map((item) => Math.round(item.avgLatencyMs)),
          itemStyle: { color: chart.palette[3] },
          lineStyle: { width: 2 }
        }
      ]
    }
  }, [daily, chart, t])

  // 成本模式：请求量淡化为背景柱，成本折线走第二轴。未计价日为 null，
  // 折线自然断开 —— 与「null 表示未计价而非 0」的口径一致。
  const costTrendOption = useMemo<EChartOption>(() => {
    const requestLabel = t('dashboard.charts.barRequests')
    const costLabel = t('dashboard.charts.costLabel')

    return {
      ...chart.base,
      color: chart.palette,
      tooltip: { trigger: 'axis', ...chart.base.tooltip },
      legend: { data: [requestLabel, costLabel], ...chart.base.legend },
      grid: chart.base.grid,
      xAxis: {
        type: 'category',
        data: daily.map((item) => item.date.slice(5)),
        axisLabel: { color: chart.axis },
        axisLine: { lineStyle: { color: chart.splitLine } }
      },
      yAxis: [
        {
          type: 'value',
          name: requestLabel,
          nameTextStyle: { color: chart.axis },
          axisLabel: { color: chart.axis },
          splitLine: { lineStyle: { color: chart.splitLine } }
        },
        {
          type: 'value',
          name: costLabel,
          nameTextStyle: { color: chart.axis },
          axisLabel: { color: chart.axis },
          splitLine: { show: false }
        }
      ],
      series: [
        {
          name: requestLabel,
          type: 'bar',
          data: daily.map((item) => item.requestCount),
          itemStyle: { color: chart.palette[0], opacity: 0.35, borderRadius: [4, 4, 0, 0] },
          barMaxWidth: 24
        },
        {
          name: costLabel,
          type: 'line',
          yAxisIndex: 1,
          smooth: true,
          showSymbol: false,
          data: daily.map((item) => item.cost),
          itemStyle: { color: chart.palette[1] },
          lineStyle: { width: 2 }
        }
      ]
    }
  }, [daily, chart, t])

  const trendOption = trendMode === 'cost' ? costTrendOption : trafficTrendOption

  const buildModelBarOption = useCallback(
    (
      label: string,
      pick: (item: ModelUsageMetric) => number,
      color: string
    ): EChartOption => ({
      ...chart.base,
      tooltip: { trigger: 'axis', ...chart.base.tooltip },
      grid: { ...chart.base.grid, bottom: 24 },
      xAxis: {
        type: 'category',
        data: models.map((item) => `${item.provider}/${item.model}`),
        axisLabel: { color: chart.axis, rotate: 28 },
        axisLine: { lineStyle: { color: chart.splitLine } }
      },
      yAxis: {
        type: 'value',
        name: label,
        nameTextStyle: { color: chart.axis },
        axisLabel: { color: chart.axis },
        splitLine: { lineStyle: { color: chart.splitLine } }
      },
      series: [
        {
          name: label,
          type: 'bar',
          data: models.map(pick),
          itemStyle: { color, borderRadius: [4, 4, 0, 0] },
          barMaxWidth: 32
        }
      ]
    }),
    [models, chart]
  )

  const ttftOption = useMemo<EChartOption>(
    () => buildModelBarOption(t('dashboard.charts.ttftAxis'), (item) => item.avgTtftMs ?? 0, chart.palette[2]),
    [buildModelBarOption, chart, t]
  )

  const tpotOption = useMemo<EChartOption>(
    () => buildModelBarOption(t('dashboard.charts.tpotAxis'), (item) => item.avgTpotMs ?? 0, chart.palette[4]),
    [buildModelBarOption, chart, t]
  )

  const modelRequestsOption = useMemo<EChartOption>(() => {
    const requestLabel = t('dashboard.charts.barRequests')
    const inputLabel = t('dashboard.charts.lineInput')
    const outputLabel = t('dashboard.charts.lineOutput')

    return {
      ...chart.base,
      color: chart.palette,
      tooltip: { trigger: 'axis', ...chart.base.tooltip },
      legend: { data: [requestLabel, inputLabel, outputLabel], ...chart.base.legend },
      grid: { ...chart.base.grid, bottom: 24 },
      xAxis: {
        type: 'category',
        data: models.map((item) => `${item.provider}/${item.model}`),
        axisLabel: { color: chart.axis, rotate: 28 },
        axisLine: { lineStyle: { color: chart.splitLine } }
      },
      yAxis: [
        {
          type: 'value',
          name: requestLabel,
          nameTextStyle: { color: chart.axis },
          axisLabel: { color: chart.axis },
          splitLine: { lineStyle: { color: chart.splitLine } }
        },
        {
          type: 'value',
          name: t('dashboard.charts.axisTokens'),
          position: 'right',
          nameTextStyle: { color: chart.axis },
          axisLabel: { color: chart.axis },
          splitLine: { show: false }
        }
      ],
      series: [
        {
          name: requestLabel,
          type: 'bar',
          data: models.map((item) => item.requests),
          itemStyle: { color: chart.palette[0], borderRadius: [4, 4, 0, 0] },
          barMaxWidth: 24
        },
        {
          name: inputLabel,
          type: 'line',
          yAxisIndex: 1,
          smooth: true,
          showSymbol: false,
          data: models.map((item) => item.inputTokens ?? 0),
          itemStyle: { color: chart.palette[1] },
          lineStyle: { width: 2 }
        },
        {
          name: outputLabel,
          type: 'line',
          yAxisIndex: 1,
          smooth: true,
          showSymbol: false,
          data: models.map((item) => item.outputTokens ?? 0),
          itemStyle: { color: chart.palette[2] },
          lineStyle: { width: 2 }
        }
      ]
    }
  }, [models, chart, t])

  return {
    attentionEvents,
    customEndpoints: customEndpointsQuery.data?.endpoints ?? [],
    daily,
    dbInfo,
    clientActivity,
    endpointFilter,
    fastestTtftModel,
    handleRefresh,
    bootstrapError,
    refreshError,
    isBootstrapping,
    isRefreshing,
    liveConnected: liveEvents.connected,
    liveFailed: liveEvents.failed,
    modelRequestsOption,
    models,
    overview,
    recentLogs,
    recentThroughput,
    selectedEndpointLabel,
    setEndpointFilter,
    setupComplete,
    setupDoneCount,
    status,
    summaryPending: summaryQuery.isPending,
    trendMode,
    setTrendMode,
    trendOption,
    ttftOption,
    tpotOption,
    usageDimension,
    usageDimensionLoading: usageDimensionQuery.isPending,
    usageDimensionError: usageDimensionQuery.error?.message ?? null,
    refetchUsageDimension: () => void usageDimensionQuery.refetch(),
    usageRows,
    setUsageDimension
  }
}

export type { DailyMetric }
