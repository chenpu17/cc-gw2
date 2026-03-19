import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { type EChartOption } from '@/components/EChart'
import { useApiQuery } from '@/hooks/useApiQuery'
import { usePersistentState } from '@/hooks/usePersistentState'
import { useToast } from '@/providers/ToastProvider'
import { apiClient, type ApiError, toApiError } from '@/services/api'
import { queryKeys } from '@/services/queryKeys'
import { storageKeys } from '@/services/storageKeys'
import type { CustomEndpointsResponse } from '@/types/endpoints'
import type { LogListResponse } from '@/types/logs'
import {
  formatBytes,
  LIVE_REFRESH_MS,
  METRIC_COLORS,
  TREND_REFRESH_MS,
  type DailyMetric,
  type DatabaseInfo,
  type ModelUsageMetric,
  type OverviewStats,
  type ServiceStatus
} from './types'

export function useDashboardPageState() {
  const { t } = useTranslation()
  const { pushToast } = useToast()
  const [endpointFilter, setEndpointFilter] = usePersistentState<string>(
    storageKeys.dashboard.endpointFilter,
    'all'
  )
  const [compacting, setCompacting] = useState(false)
  const endpointParam = endpointFilter === 'all' ? undefined : endpointFilter

  const customEndpointsQuery = useApiQuery<CustomEndpointsResponse, ApiError>(
    queryKeys.customEndpoints.all(),
    { url: '/api/custom-endpoints', method: 'GET' },
    { refetchInterval: TREND_REFRESH_MS, refetchIntervalInBackground: true }
  )

  const overviewQuery = useApiQuery<OverviewStats, ApiError>(
    queryKeys.stats.overview(endpointFilter),
    {
      url: '/api/stats/overview',
      method: 'GET',
      params: endpointParam ? { endpoint: endpointParam } : undefined
    },
    { refetchInterval: LIVE_REFRESH_MS, refetchIntervalInBackground: true }
  )

  const dailyQuery = useApiQuery<DailyMetric[], ApiError>(
    queryKeys.stats.daily(14, endpointFilter),
    {
      url: '/api/stats/daily',
      method: 'GET',
      params: {
        days: 14,
        ...(endpointParam ? { endpoint: endpointParam } : {})
      }
    },
    { refetchInterval: TREND_REFRESH_MS, refetchIntervalInBackground: true }
  )

  const modelUsageQuery = useApiQuery<ModelUsageMetric[], ApiError>(
    queryKeys.stats.model(7, 6, endpointFilter),
    {
      url: '/api/stats/model',
      method: 'GET',
      params: {
        days: 7,
        limit: 6,
        ...(endpointParam ? { endpoint: endpointParam } : {})
      }
    },
    { refetchInterval: TREND_REFRESH_MS, refetchIntervalInBackground: true }
  )

  const statusQuery = useApiQuery<ServiceStatus, ApiError>(
    queryKeys.status.byEndpoint(endpointFilter),
    {
      url: '/api/status',
      method: 'GET',
      params: endpointParam ? { endpoint: endpointParam } : undefined
    },
    { refetchInterval: LIVE_REFRESH_MS, refetchIntervalInBackground: true }
  )

  const dbInfoQuery = useApiQuery<DatabaseInfo, ApiError>(
    queryKeys.db.info(),
    { url: '/api/db/info', method: 'GET' },
    { refetchInterval: LIVE_REFRESH_MS, refetchIntervalInBackground: true }
  )

  const latestLogsQuery = useApiQuery<LogListResponse, ApiError>(
    queryKeys.logs.recent(endpointFilter),
    {
      url: '/api/logs',
      method: 'GET',
      params: {
        limit: 5,
        ...(endpointParam ? { endpoint: endpointParam } : {})
      }
    },
    { refetchInterval: LIVE_REFRESH_MS, refetchIntervalInBackground: true }
  )

  useEffect(() => {
    if (overviewQuery.isError && overviewQuery.error) {
      pushToast({
        title: t('dashboard.toast.overviewError'),
        description: overviewQuery.error.message,
        variant: 'error'
      })
    }
  }, [overviewQuery.error, overviewQuery.isError, pushToast, t])

  useEffect(() => {
    if (dailyQuery.isError && dailyQuery.error) {
      pushToast({ title: t('dashboard.toast.dailyError'), description: dailyQuery.error.message, variant: 'error' })
    }
  }, [dailyQuery.error, dailyQuery.isError, pushToast, t])

  useEffect(() => {
    if (modelUsageQuery.isError && modelUsageQuery.error) {
      pushToast({ title: t('dashboard.toast.modelError'), description: modelUsageQuery.error.message, variant: 'error' })
    }
  }, [modelUsageQuery.error, modelUsageQuery.isError, pushToast, t])

  useEffect(() => {
    if (statusQuery.isError && statusQuery.error) {
      pushToast({ title: t('dashboard.toast.statusError'), description: statusQuery.error.message, variant: 'error' })
    }
  }, [statusQuery.error, statusQuery.isError, pushToast, t])

  useEffect(() => {
    if (dbInfoQuery.isError && dbInfoQuery.error) {
      pushToast({ title: t('dashboard.toast.dbError'), description: dbInfoQuery.error.message, variant: 'error' })
    }
  }, [dbInfoQuery.error, dbInfoQuery.isError, pushToast, t])

  useEffect(() => {
    if (latestLogsQuery.isError && latestLogsQuery.error) {
      pushToast({ title: t('dashboard.toast.recentError'), description: latestLogsQuery.error.message, variant: 'error' })
    }
  }, [latestLogsQuery.error, latestLogsQuery.isError, pushToast, t])

  const handleRefresh = useCallback(async () => {
    await Promise.all([
      customEndpointsQuery.refetch(),
      overviewQuery.refetch(),
      dailyQuery.refetch(),
      modelUsageQuery.refetch(),
      statusQuery.refetch(),
      dbInfoQuery.refetch(),
      latestLogsQuery.refetch()
    ])
  }, [customEndpointsQuery, dbInfoQuery, dailyQuery, latestLogsQuery, modelUsageQuery, overviewQuery, statusQuery])

  const handleCompact = useCallback(async () => {
    if (compacting) {
      return
    }

    setCompacting(true)
    try {
      await apiClient.post('/api/db/compact')
      await dbInfoQuery.refetch()
      pushToast({
        title: t('dashboard.toast.compactSuccess.title'),
        description: t('dashboard.toast.compactSuccess.desc'),
        variant: 'success'
      })
    } catch (error) {
      const apiError = toApiError(error)
      pushToast({
        title: t('dashboard.toast.compactError.title'),
        description: apiError.message,
        variant: 'error'
      })
    } finally {
      setCompacting(false)
    }
  }, [compacting, dbInfoQuery, pushToast, t])

  const overview = overviewQuery.data
  const daily = dailyQuery.data ?? []
  const models = modelUsageQuery.data ?? []
  const status = statusQuery.data
  const dbInfo = dbInfoQuery.data
  const recentLogs = latestLogsQuery.data?.items ?? []

  const selectedEndpointLabel = endpointFilter === 'all'
    ? t('dashboard.filters.endpointAll')
    : endpointFilter === 'anthropic'
      ? t('dashboard.filters.endpointAnthropic')
      : endpointFilter === 'openai'
        ? t('dashboard.filters.endpointOpenAI')
        : customEndpointsQuery.data?.endpoints?.find((item) => item.id === endpointFilter)?.label || endpointFilter

  const totalRequestsInRange = daily.reduce((sum, item) => sum + item.requestCount, 0)
  const busiestDay = daily.reduce<DailyMetric | null>((best, item) => {
    if (!best || item.requestCount > best.requestCount) {
      return item
    }
    return best
  }, null)
  const topModel = models[0]
  const fastestTtftModel = models
    .filter((item) => item.avgTtftMs != null && item.avgTtftMs > 0)
    .sort((a, b) => (a.avgTtftMs ?? Number.POSITIVE_INFINITY) - (b.avgTtftMs ?? Number.POSITIVE_INFINITY))[0]

  const isRefreshing =
    customEndpointsQuery.isFetching ||
    overviewQuery.isFetching ||
    dailyQuery.isFetching ||
    modelUsageQuery.isFetching ||
    statusQuery.isFetching ||
    dbInfoQuery.isFetching ||
    latestLogsQuery.isFetching

  const isBootstrapping = overviewQuery.isPending || statusQuery.isPending || dbInfoQuery.isPending
  const bootstrapError =
    overviewQuery.error?.message ??
    statusQuery.error?.message ??
    dbInfoQuery.error?.message ??
    null

  const dbSizeDisplay = dbInfo ? formatBytes(dbInfo.totalBytes ?? dbInfo.sizeBytes) : '-'
  const memoryDisplay = formatBytes(dbInfo?.memoryRssBytes)

  const dailyOption = useMemo<EChartOption>(() => {
    const dates = daily.map((item) => item.date)
    const requestLabel = t('dashboard.charts.barRequests')
    const inputLabel = t('dashboard.charts.lineInput')
    const outputLabel = t('dashboard.charts.lineOutput')
    const cacheReadLabel = t('dashboard.charts.lineCacheRead')
    const cacheCreationLabel = t('dashboard.charts.lineCacheCreation')

    return {
      tooltip: { trigger: 'axis' },
      legend: { data: [requestLabel, inputLabel, outputLabel, cacheReadLabel, cacheCreationLabel] },
      grid: { left: 56, right: 28, top: 56, bottom: 54 },
      xAxis: { type: 'category', data: dates },
      yAxis: { type: 'value' },
      series: [
        {
          name: requestLabel,
          type: 'bar',
          data: daily.map((item) => item.requestCount),
          itemStyle: { color: METRIC_COLORS.requests, borderRadius: [6, 6, 0, 0] }
        },
        {
          name: inputLabel,
          type: 'line',
          smooth: true,
          data: daily.map((item) => item.inputTokens),
          itemStyle: { color: METRIC_COLORS.input },
          lineStyle: { width: 2 }
        },
        {
          name: outputLabel,
          type: 'line',
          smooth: true,
          data: daily.map((item) => item.outputTokens),
          itemStyle: { color: METRIC_COLORS.output },
          lineStyle: { width: 2 }
        },
        {
          name: cacheReadLabel,
          type: 'line',
          smooth: true,
          data: daily.map((item) => item.cacheReadTokens),
          itemStyle: { color: METRIC_COLORS.cacheRead },
          lineStyle: { width: 2 }
        },
        {
          name: cacheCreationLabel,
          type: 'line',
          smooth: true,
          data: daily.map((item) => item.cacheCreationTokens),
          itemStyle: { color: METRIC_COLORS.cacheCreation },
          lineStyle: { width: 2 }
        }
      ]
    }
  }, [daily, t])

  const modelRequestsOption = useMemo<EChartOption>(() => {
    const categories = models.map((item) => `${item.provider}/${item.model}`)
    const requestLabel = t('dashboard.charts.barRequests')
    const inputLabel = t('dashboard.charts.lineInput')
    const outputLabel = t('dashboard.charts.lineOutput')

    return {
      tooltip: { trigger: 'axis' },
      legend: { data: [requestLabel, inputLabel, outputLabel] },
      grid: { left: 72, right: 52, top: 56, bottom: 96 },
      xAxis: { type: 'category', data: categories, axisLabel: { rotate: 28 } },
      yAxis: [
        { type: 'value', name: requestLabel },
        { type: 'value', name: t('dashboard.charts.axisTokens'), position: 'right' }
      ],
      series: [
        {
          name: requestLabel,
          type: 'bar',
          data: models.map((item) => item.requests),
          itemStyle: { color: METRIC_COLORS.requests, borderRadius: [6, 6, 0, 0] }
        },
        {
          name: inputLabel,
          type: 'line',
          yAxisIndex: 1,
          smooth: true,
          data: models.map((item) => item.inputTokens ?? 0),
          itemStyle: { color: METRIC_COLORS.input }
        },
        {
          name: outputLabel,
          type: 'line',
          yAxisIndex: 1,
          smooth: true,
          data: models.map((item) => item.outputTokens ?? 0),
          itemStyle: { color: METRIC_COLORS.output }
        }
      ]
    }
  }, [models, t])

  const ttftOption = useMemo<EChartOption>(() => ({
    tooltip: { trigger: 'axis' },
    grid: { left: 72, right: 40, top: 56, bottom: 96 },
    xAxis: {
      type: 'category',
      data: models.map((item) => `${item.provider}/${item.model}`),
      axisLabel: { rotate: 28 }
    },
    yAxis: { type: 'value', name: t('dashboard.charts.ttftAxis') },
    series: [
      {
        name: t('dashboard.charts.ttftLabel'),
        type: 'bar',
        data: models.map((item) => item.avgTtftMs ?? 0),
        itemStyle: { color: METRIC_COLORS.latency, borderRadius: [6, 6, 0, 0] }
      }
    ]
  }), [models, t])

  const tpotOption = useMemo<EChartOption>(() => ({
    tooltip: { trigger: 'axis' },
    grid: { left: 72, right: 40, top: 56, bottom: 96 },
    xAxis: {
      type: 'category',
      data: models.map((item) => `${item.provider}/${item.model}`),
      axisLabel: { rotate: 28 }
    },
    yAxis: { type: 'value', name: t('dashboard.charts.tpotAxis') },
    series: [
      {
        name: t('dashboard.charts.tpotLabel'),
        type: 'bar',
        data: models.map((item) => item.avgTpotMs ?? 0),
        itemStyle: { color: METRIC_COLORS.output, borderRadius: [6, 6, 0, 0] }
      }
    ]
  }), [models, t])

  return {
    compacting,
    customEndpoints: customEndpointsQuery.data?.endpoints ?? [],
    daily,
    dailyOption,
    dailyPending: dailyQuery.isPending,
    dbInfo,
    dbSizeDisplay,
    endpointFilter,
    fastestTtftModel,
    handleCompact,
    handleRefresh,
    bootstrapError,
    isBootstrapping,
    isRefreshing,
    latestLogsPending: latestLogsQuery.isPending,
    memoryDisplay,
    modelRequestsOption,
    modelUsagePending: modelUsageQuery.isPending,
    models,
    overview,
    recentLogs,
    selectedEndpointLabel,
    setEndpointFilter,
    status,
    topModel,
    totalRequestsInRange,
    busiestDay,
    ttftOption,
    tpotOption
  }
}
