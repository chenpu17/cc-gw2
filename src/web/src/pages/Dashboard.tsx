import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { BarChart3, TrendingUp, Activity, Timer } from 'lucide-react'
import { EChart, echarts, type EChartOption } from '@/components/EChart'
import { StatCardSkeleton, ChartSkeleton, TableRowSkeleton } from '@/components/Skeleton'
import { PageHeader } from '@/components/PageHeader'
import { PageSection } from '@/components/PageSection'
import { useToast } from '@/providers/ToastProvider'
import { useApiQuery } from '@/hooks/useApiQuery'
import { apiClient, type ApiError, toApiError } from '@/services/api'
import type { LogListResponse, LogRecord } from '@/types/logs'
import type { CustomEndpointsResponse } from '@/types/endpoints'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table'

interface OverviewStats {
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

interface DailyMetric {
  date: string
  requestCount: number
  inputTokens: number
  outputTokens: number
  cachedTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
  avgLatencyMs: number
}

interface ModelUsageMetric {
  model: string
  provider: string
  requests: number
  inputTokens: number
  outputTokens: number
  avgLatencyMs: number
  avgTtftMs: number | null
  avgTpotMs: number | null
}

interface ServiceStatus {
  port: number
  host?: string
  providers: number
  activeRequests?: number
  activeClientAddresses?: number
  activeClientSessions?: number
  uniqueClientAddressesLastHour?: number
  uniqueClientSessionsLastHour?: number
}

interface DatabaseInfo {
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

function formatLatencyValue(
  value: number | null | undefined,
  suffix: string,
  options?: Intl.NumberFormatOptions
): string {
  if (value === null || value === undefined) {
    return '-'
  }
  return `${value.toLocaleString(undefined, options)} ${suffix}`
}

function formatBytes(value: number | null | undefined): string {
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

const METRIC_COLORS = {
  requests: '#3b82f6',
  input: '#10b981',
  output: '#f59e0b',
  cacheRead: '#8b5cf6',
  cacheCreation: '#f43f5e',
  latency: '#06b6d4'
} as const

export default function DashboardPage() {
  const { t } = useTranslation()
  const { pushToast } = useToast()
  const [endpointFilter, setEndpointFilter] = useState<string>('all')
  const [compacting, setCompacting] = useState(false)
  const endpointParam = endpointFilter === 'all' ? undefined : endpointFilter

  const customEndpointsQuery = useApiQuery<CustomEndpointsResponse, ApiError>(
    ['custom-endpoints'],
    { url: '/api/custom-endpoints', method: 'GET' }
  )

  const overviewQuery = useApiQuery<OverviewStats, ApiError>(
    ['stats', 'overview', endpointFilter],
    {
      url: '/api/stats/overview',
      method: 'GET',
      params: endpointParam ? { endpoint: endpointParam } : undefined
    }
  )

  const dailyQuery = useApiQuery<DailyMetric[], ApiError>(
    ['stats', 'daily', 14, endpointFilter],
    {
      url: '/api/stats/daily',
      method: 'GET',
      params: {
        days: 14,
        ...(endpointParam ? { endpoint: endpointParam } : {})
      }
    }
  )

  const modelUsageQuery = useApiQuery<ModelUsageMetric[], ApiError>(
    ['stats', 'model', 7, 6, endpointFilter],
    {
      url: '/api/stats/model',
      method: 'GET',
      params: {
        days: 7,
        limit: 6,
        ...(endpointParam ? { endpoint: endpointParam } : {})
      }
    }
  )

  const statusQuery = useApiQuery<ServiceStatus, ApiError>(
    ['status', endpointFilter],
    {
      url: '/api/status',
      method: 'GET',
      params: endpointParam ? { endpoint: endpointParam } : undefined
    }
  )

  const dbInfoQuery = useApiQuery<DatabaseInfo, ApiError>(
    ['db', 'info'],
    { url: '/api/db/info', method: 'GET' }
  )
  const refetchDbInfo = dbInfoQuery.refetch ?? (async () => undefined)

  const latestLogsQuery = useApiQuery<LogListResponse, ApiError>(
    ['logs', 'recent', endpointFilter],
    {
      url: '/api/logs',
      method: 'GET',
      params: {
        limit: 5,
        ...(endpointParam ? { endpoint: endpointParam } : {})
      }
    },
    { refetchInterval: 30_000 }
  )

  useEffect(() => {
    if (overviewQuery.isError && overviewQuery.error) {
      pushToast({
        title: t('dashboard.toast.overviewError'),
        description: overviewQuery.error.message,
        variant: 'error'
      })
    }
  }, [overviewQuery.isError, overviewQuery.error, pushToast, t])

  useEffect(() => {
    if (dailyQuery.isError && dailyQuery.error) {
      pushToast({ title: t('dashboard.toast.dailyError'), description: dailyQuery.error.message, variant: 'error' })
    }
  }, [dailyQuery.isError, dailyQuery.error, pushToast, t])

  useEffect(() => {
    if (modelUsageQuery.isError && modelUsageQuery.error) {
      pushToast({ title: t('dashboard.toast.modelError'), description: modelUsageQuery.error.message, variant: 'error' })
    }
  }, [modelUsageQuery.isError, modelUsageQuery.error, pushToast, t])

  useEffect(() => {
    if (statusQuery.isError && statusQuery.error) {
      pushToast({ title: t('dashboard.toast.statusError'), description: statusQuery.error.message, variant: 'error' })
    }
  }, [statusQuery.isError, statusQuery.error, pushToast, t])

  useEffect(() => {
    if (dbInfoQuery.isError && dbInfoQuery.error) {
      pushToast({ title: t('dashboard.toast.dbError'), description: dbInfoQuery.error.message, variant: 'error' })
    }
  }, [dbInfoQuery.isError, dbInfoQuery.error, pushToast, t])

  const handleCompact = useCallback(async () => {
    if (compacting) return
    setCompacting(true)
    try {
      await apiClient.post('/api/db/compact')
      await refetchDbInfo()
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
  }, [compacting, pushToast, refetchDbInfo, t])

  useEffect(() => {
    if (latestLogsQuery.isError && latestLogsQuery.error) {
      pushToast({ title: t('dashboard.toast.recentError'), description: latestLogsQuery.error.message, variant: 'error' })
    }
  }, [latestLogsQuery.isError, latestLogsQuery.error, pushToast, t])

  const overview = overviewQuery.data
  const daily = dailyQuery.data ?? []
  const models = modelUsageQuery.data ?? []
  const status = statusQuery.data
  const dbInfo = dbInfoQuery.data
  const recentLogs = latestLogsQuery.data?.items ?? []
  const dbSizeDisplay = dbInfo ? formatBytes(dbInfo.totalBytes ?? dbInfo.sizeBytes) : '-'
  const memoryDisplay = formatBytes(dbInfo?.memoryRssBytes)
  const selectedEndpointLabel = endpointFilter === 'all'
    ? t('dashboard.filters.endpointAll')
    : endpointFilter === 'anthropic'
      ? t('dashboard.filters.endpointAnthropic')
      : endpointFilter === 'openai'
        ? t('dashboard.filters.endpointOpenAI')
        : customEndpointsQuery.data?.endpoints?.find((ep) => ep.id === endpointFilter)?.label || endpointFilter
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

  const dailyOption = useMemo<EChartOption>(() => {
    const dates = daily.map((item) => item.date)
    const requestLabel = t('dashboard.charts.barRequests')
    const inputLabel = t('dashboard.charts.lineInput')
    const outputLabel = t('dashboard.charts.lineOutput')
    const cacheReadLabel = t('dashboard.charts.lineCacheRead')
    const cacheCreationLabel = t('dashboard.charts.lineCacheCreation')
    return {
      tooltip: { trigger: 'axis' },
      legend: {
        data: [requestLabel, inputLabel, outputLabel, cacheReadLabel, cacheCreationLabel]
      },
      grid: { left: 60, right: 40, top: 60, bottom: 60 },
      xAxis: { type: 'category', data: dates },
      yAxis: { type: 'value' },
      series: [
        {
          name: requestLabel,
          type: 'bar',
          data: daily.map((item) => item.requestCount),
          itemStyle: { color: METRIC_COLORS.requests, borderRadius: [4, 4, 0, 0] }
        },
        {
          name: inputLabel,
          type: 'line',
          data: daily.map((item) => item.inputTokens),
          smooth: true,
          itemStyle: { color: METRIC_COLORS.input },
          lineStyle: { width: 2 }
        },
        {
          name: outputLabel,
          type: 'line',
          data: daily.map((item) => item.outputTokens),
          smooth: true,
          itemStyle: { color: METRIC_COLORS.output },
          lineStyle: { width: 2 }
        },
        {
          name: cacheReadLabel,
          type: 'line',
          data: daily.map((item) => item.cacheReadTokens),
          smooth: true,
          itemStyle: { color: METRIC_COLORS.cacheRead },
          lineStyle: { width: 2 }
        },
        {
          name: cacheCreationLabel,
          type: 'line',
          data: daily.map((item) => item.cacheCreationTokens),
          smooth: true,
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
      grid: { left: 80, right: 60, top: 60, bottom: 100 },
      xAxis: {
        type: 'category',
        data: categories,
        axisLabel: { rotate: 30 }
      },
      yAxis: [
        { type: 'value', name: requestLabel },
        { type: 'value', name: t('dashboard.charts.axisTokens'), position: 'right' }
      ],
      series: [
        {
          name: requestLabel,
          type: 'bar',
          data: models.map((item) => item.requests),
          itemStyle: { color: METRIC_COLORS.requests, borderRadius: [4, 4, 0, 0] }
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

  const ttftOption = useMemo<EChartOption>(() => {
    const categories = models.map((item) => `${item.provider}/${item.model}`)
    const ttftLabel = t('dashboard.charts.ttftLabel')

    return {
      tooltip: { trigger: 'axis' },
      grid: { left: 80, right: 50, top: 60, bottom: 100 },
      xAxis: { type: 'category', data: categories, axisLabel: { rotate: 30 } },
      yAxis: { type: 'value', name: t('dashboard.charts.ttftAxis') },
      series: [
        {
          name: ttftLabel,
          type: 'bar',
          data: models.map((item) => item.avgTtftMs ?? 0),
          itemStyle: { color: METRIC_COLORS.requests, borderRadius: [4, 4, 0, 0] }
        }
      ]
    }
  }, [models, t])

  const tpotOption = useMemo<EChartOption>(() => {
    const categories = models.map((item) => `${item.provider}/${item.model}`)
    const tpotLabel = t('dashboard.charts.tpotLabel')

    return {
      tooltip: { trigger: 'axis' },
      grid: { left: 80, right: 50, top: 60, bottom: 100 },
      xAxis: { type: 'category', data: categories, axisLabel: { rotate: 30 } },
      yAxis: { type: 'value', name: t('dashboard.charts.tpotAxis') },
      series: [
        {
          name: tpotLabel,
          type: 'bar',
          data: models.map((item) => item.avgTpotMs ?? 0),
          itemStyle: { color: METRIC_COLORS.output, borderRadius: [4, 4, 0, 0] }
        }
      ]
    }
  }, [models, t])

  if (overviewQuery.isPending || statusQuery.isPending || dbInfoQuery.isPending) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader
          icon={<BarChart3 className="h-5 w-5" aria-hidden="true" />}
          title={t('nav.dashboard')}
          description={t('dashboard.description')}
        />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <StatCardSkeleton key={i} />
          ))}
        </div>
        <div className="grid gap-6 lg:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <ChartSkeleton key={i} />
          ))}
        </div>
        <div className="rounded-[1.25rem] border border-border/70 bg-background/55">
          <table className="w-full">
            <tbody>
              {Array.from({ length: 5 }).map((_, i) => (
                <TableRowSkeleton key={i} columns={6} />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        icon={<BarChart3 className="h-5 w-5" aria-hidden="true" />}
        title={t('nav.dashboard')}
        description={t('dashboard.description')}
        badge={selectedEndpointLabel}
        actions={
          <div className="flex items-center gap-3">
            <span className="text-xs font-medium text-muted-foreground">
              {t('dashboard.filters.endpoint')}
            </span>
            <Select
              value={endpointFilter}
              onValueChange={setEndpointFilter}
            >
              <SelectTrigger className="w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('dashboard.filters.endpointAll')}</SelectItem>
                <SelectItem value="anthropic">{t('dashboard.filters.endpointAnthropic')}</SelectItem>
                <SelectItem value="openai">{t('dashboard.filters.endpointOpenAI')}</SelectItem>
                {customEndpointsQuery.data?.endpoints?.map((ep) => (
                  <SelectItem key={ep.id} value={ep.id}>
                    {ep.label || ep.id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        }
      />

      {/* Service Status */}
      {status && (
        <Card className="surface-1">
          <CardContent className="space-y-4 pt-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <div className="inline-flex items-center gap-2 rounded-full border border-emerald-300/90 bg-emerald-50 px-3.5 py-2 text-sm shadow-[0_10px_24px_-20px_rgba(5,150,105,0.85)] dark:border-emerald-800 dark:bg-emerald-950/50">
                  <span className="font-semibold text-emerald-800 dark:text-emerald-200">
                    {t('dashboard.status.listeningLabel')}
                  </span>
                  <span className="font-mono text-[13px] font-semibold tracking-normal text-emerald-950 dark:text-emerald-50">
                    {(status.host ?? '0.0.0.0')}:{status.port}
                  </span>
                </div>
                <Badge variant="outline">{selectedEndpointLabel}</Badge>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={handleCompact}
                disabled={compacting}
              >
                {compacting ? t('dashboard.actions.compacting') : t('dashboard.actions.compact')}
              </Button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-8">
              <StatusMiniCard
                label={t('dashboard.labels.providers')}
                value={status.providers.toLocaleString()}
              />
              <StatusMiniCard
                label={t('dashboard.labels.activeRequests')}
                value={(status.activeRequests ?? 0).toLocaleString()}
              />
              <StatusMiniCard
                label={t('dashboard.labels.activeClientAddresses')}
                value={(status.activeClientAddresses ?? 0).toLocaleString()}
              />
              <StatusMiniCard
                label={t('dashboard.labels.activeClientSessions')}
                value={(status.activeClientSessions ?? 0).toLocaleString()}
              />
              <StatusMiniCard
                label={t('dashboard.labels.uniqueClientAddressesLastHour')}
                value={(status.uniqueClientAddressesLastHour ?? 0).toLocaleString()}
              />
              <StatusMiniCard
                label={t('dashboard.labels.uniqueClientSessionsLastHour')}
                value={(status.uniqueClientSessionsLastHour ?? 0).toLocaleString()}
              />
              <StatusMiniCard
                label={t('dashboard.labels.todayRequests')}
                value={(overview?.today.requests ?? 0).toLocaleString()}
              />
              <StatusMiniCard
                label={t('dashboard.labels.database')}
                value={dbSizeDisplay}
              />
              <StatusMiniCard
                label={t('dashboard.labels.memory')}
                value={memoryDisplay}
              />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Statistics Cards */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <StatCard
          icon={<Activity className="h-5 w-5" />}
          title={t('dashboard.cards.todayRequests')}
          value={overview?.today.requests ?? 0}
          suffix={t('common.units.request')}
          color="blue"
        />
        <StatCard
          icon={<TrendingUp className="h-5 w-5" />}
          title={t('dashboard.cards.todayInput')}
          value={overview?.today.inputTokens ?? 0}
          suffix={t('common.units.token')}
          color="emerald"
        />
        <StatCard
          icon={<Activity className="h-5 w-5" />}
          title={t('dashboard.cards.todayCacheRead')}
          value={overview?.today.cacheReadTokens ?? 0}
          suffix={t('common.units.token')}
          color="violet"
        />
        <StatCard
          icon={<Activity className="h-5 w-5" />}
          title={t('dashboard.cards.todayCacheCreation')}
          value={overview?.today.cacheCreationTokens ?? 0}
          suffix={t('common.units.token')}
          color="rose"
        />
        <StatCard
          icon={<BarChart3 className="h-5 w-5" />}
          title={t('dashboard.cards.todayOutput')}
          value={overview?.today.outputTokens ?? 0}
          suffix={t('common.units.token')}
          color="amber"
        />
        <StatCard
          icon={<Timer className="h-5 w-5" />}
          title={t('dashboard.cards.avgLatency')}
          value={overview?.today.avgLatencyMs ?? 0}
          suffix={t('common.units.ms')}
          color="cyan"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-4">
        <InsightCard
          label={t('dashboard.insights.totalRequests')}
          value={totalRequestsInRange.toLocaleString()}
          hint={t('dashboard.insights.totalRequestsHint')}
        />
        <InsightCard
          label={t('dashboard.insights.busiestDay')}
          value={busiestDay ? `${busiestDay.date}` : '-'}
          hint={busiestDay ? t('dashboard.insights.busiestDayHint', { value: busiestDay.requestCount.toLocaleString() }) : t('common.noData')}
        />
        <InsightCard
          label={t('dashboard.insights.topModel')}
          value={topModel ? `${topModel.provider}/${topModel.model}` : '-'}
          hint={topModel ? t('dashboard.insights.topModelHint', { value: topModel.requests.toLocaleString() }) : t('common.noData')}
        />
        <InsightCard
          label={t('dashboard.insights.fastestTtft')}
          value={fastestTtftModel ? `${fastestTtftModel.provider}/${fastestTtftModel.model}` : '-'}
          hint={fastestTtftModel ? formatLatencyValue(fastestTtftModel.avgTtftMs, t('common.units.ms')) : t('common.noData')}
        />
      </div>

      {/* Charts Grid */}
      <div className="grid gap-6 lg:grid-cols-2">
        <ChartCard
          title={t('dashboard.charts.requestsTitle')}
          description={t('dashboard.charts.requestsDesc')}
          loading={dailyQuery.isPending}
          option={dailyOption}
          empty={!daily.length}
          emptyText={t('dashboard.charts.empty')}
        />
        <ChartCard
          title={t('dashboard.charts.modelTitle')}
          description={t('dashboard.charts.modelDesc')}
          loading={modelUsageQuery.isPending}
          option={modelRequestsOption}
          empty={!models.length}
          emptyText={t('dashboard.charts.empty')}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <ChartCard
          title={t('dashboard.charts.ttftTitle')}
          description={t('dashboard.charts.ttftDesc')}
          loading={modelUsageQuery.isPending}
          option={ttftOption}
          empty={!models.some((metric) => metric.avgTtftMs != null && metric.avgTtftMs > 0)}
          emptyText={t('dashboard.charts.ttftEmpty')}
        />
        <ChartCard
          title={t('dashboard.charts.tpotTitle')}
          description={t('dashboard.charts.tpotDesc')}
          loading={modelUsageQuery.isPending}
          option={tpotOption}
          empty={!models.some((metric) => metric.avgTpotMs != null && metric.avgTpotMs > 0)}
          emptyText={t('dashboard.charts.tpotEmpty')}
        />
      </div>

      <ModelMetricsTable models={models} loading={modelUsageQuery.isPending} />

      <RecentRequestsTable loading={latestLogsQuery.isPending} records={recentLogs} />
    </div>
  )
}

type StatCardColor = 'blue' | 'emerald' | 'amber' | 'violet' | 'rose' | 'cyan'

const colorConfig: Record<StatCardColor, { gradient: string; iconBg: string; iconColor: string }> = {
  blue: {
    gradient: 'bg-gradient-to-br from-blue-500/10 via-blue-500/5 to-transparent',
    iconBg: 'bg-blue-500/15',
    iconColor: 'text-blue-600 dark:text-blue-400'
  },
  emerald: {
    gradient: 'bg-gradient-to-br from-emerald-500/10 via-emerald-500/5 to-transparent',
    iconBg: 'bg-emerald-500/15',
    iconColor: 'text-emerald-600 dark:text-emerald-400'
  },
  amber: {
    gradient: 'bg-gradient-to-br from-amber-500/10 via-amber-500/5 to-transparent',
    iconBg: 'bg-amber-500/15',
    iconColor: 'text-amber-600 dark:text-amber-400'
  },
  violet: {
    gradient: 'bg-gradient-to-br from-violet-500/10 via-violet-500/5 to-transparent',
    iconBg: 'bg-violet-500/15',
    iconColor: 'text-violet-600 dark:text-violet-400'
  },
  rose: {
    gradient: 'bg-gradient-to-br from-rose-500/10 via-rose-500/5 to-transparent',
    iconBg: 'bg-rose-500/15',
    iconColor: 'text-rose-600 dark:text-rose-400'
  },
  cyan: {
    gradient: 'bg-gradient-to-br from-cyan-500/10 via-cyan-500/5 to-transparent',
    iconBg: 'bg-cyan-500/15',
    iconColor: 'text-cyan-600 dark:text-cyan-400'
  }
}

function StatCard({
  icon,
  title,
  value,
  suffix,
  color = 'blue'
}: {
  icon?: React.ReactNode
  title: string
  value: number
  suffix?: string
  color?: StatCardColor
}) {
  const config = colorConfig[color]
  return (
    <Card variant="interactive" className={cn('overflow-hidden', config.gradient)}>
      <CardContent className="pt-5">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{title}</span>
          {icon && (
            <div className={cn('flex h-10 w-10 items-center justify-center rounded-xl', config.iconBg, config.iconColor)}>
              {icon}
            </div>
          )}
        </div>
        <p className="text-3xl font-bold tracking-tight">
          {value.toLocaleString()}
          {suffix && <span className="ml-1.5 text-sm font-medium text-muted-foreground">{suffix}</span>}
        </p>
      </CardContent>
    </Card>
  )
}

function StatusMiniCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border/70 bg-background/70 px-4 py-3">
      <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">{label}</p>
      <p className="mt-2 text-lg font-semibold">{value}</p>
    </div>
  )
}

function InsightCard({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-[1.3rem] border border-white/50 bg-card/90 px-4 py-4 shadow-[0_1px_2px_rgba(15,23,42,0.03)] backdrop-blur">
      <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">{label}</p>
      <p className="mt-2 line-clamp-1 text-sm font-semibold">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
    </div>
  )
}

function ChartCard({
  title,
  description,
  option,
  loading,
  empty,
  emptyText
}: {
  title: string
  description: string
  option: EChartOption
  loading?: boolean
  empty?: boolean
  emptyText?: string
}) {
  const { t } = useTranslation()
  return (
    <Card className="surface-1">
      <CardContent className="space-y-4 pt-4">
        <div>
          <p className="text-base font-semibold">{title}</p>
          <p className="mt-1 text-xs text-muted-foreground">{description}</p>
        </div>
        {loading ? (
          <div className="flex min-h-[280px] h-[40vh] max-h-[420px] items-center justify-center">
            <span className="text-sm text-muted-foreground">{t('common.loadingShort')}</span>
          </div>
        ) : empty ? (
          <div className="flex min-h-[280px] h-[40vh] max-h-[420px] flex-col items-center justify-center rounded-[1.25rem] border border-dashed border-border/70 bg-background/45">
            <BarChart3 className="mb-2 h-10 w-10 text-muted-foreground/50" />
            <span className="text-sm text-muted-foreground">{emptyText ?? t('dashboard.charts.empty')}</span>
          </div>
        ) : (
          <EChart echarts={echarts} option={option} className="min-h-[280px] h-[40vh] max-h-[420px]" notMerge lazyUpdate />
        )}
      </CardContent>
    </Card>
  )
}

function ModelMetricsTable({ models, loading }: { models: ModelUsageMetric[]; loading?: boolean }) {
  const { t } = useTranslation()
  const hasData = models.length > 0

  return (
    <PageSection
      title={t('dashboard.modelTable.title')}
      description={t('dashboard.modelTable.description')}
    >
      {loading ? (
        <div className="flex h-32 items-center justify-center">
          <span className="text-sm text-muted-foreground">{t('common.loadingShort')}</span>
        </div>
      ) : !hasData ? (
        <div className="flex h-32 items-center justify-center rounded-[1.25rem] border border-dashed border-border/70 bg-background/45">
          <span className="text-sm text-muted-foreground">{t('dashboard.modelTable.empty')}</span>
        </div>
      ) : (
        <div className="max-h-80 overflow-auto rounded-[1.2rem]">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('dashboard.modelTable.columns.model')}</TableHead>
                <TableHead className="text-right">{t('dashboard.modelTable.columns.requests')}</TableHead>
                <TableHead className="text-right">{t('dashboard.modelTable.columns.latency')}</TableHead>
                <TableHead className="text-right">{t('dashboard.modelTable.columns.ttft')}</TableHead>
                <TableHead className="text-right">{t('dashboard.modelTable.columns.tpot')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {models.map((item) => (
                <TableRow key={`${item.provider}/${item.model}`}>
                  <TableCell>
                    <div className="flex flex-col">
                      <span className="font-medium">{item.provider}</span>
                      <span className="text-xs text-muted-foreground">{item.model}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    {item.requests.toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right">
                    {formatLatencyValue(item.avgLatencyMs, t('common.units.ms'))}
                  </TableCell>
                  <TableCell className="text-right">
                    {formatLatencyValue(item.avgTtftMs, t('common.units.ms'))}
                  </TableCell>
                  <TableCell className="text-right">
                    {formatLatencyValue(item.avgTpotMs, t('common.units.msPerToken'), { maximumFractionDigits: 2 })}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </PageSection>
  )
}

function RecentRequestsTable({ records, loading }: { records: LogRecord[]; loading?: boolean }) {
  const { t } = useTranslation()
  const successCount = records.filter((item) => !item.error && (item.status_code ?? 200) < 400).length
  const errorCount = records.filter((item) => item.error || (item.status_code ?? 200) >= 400).length

  return (
    <PageSection
      title={t('dashboard.recent.title')}
      description={t('dashboard.recent.subtitle', { count: 5 })}
    >
      {loading ? (
        <div className="flex h-32 items-center justify-center">
          <span className="text-sm text-muted-foreground">{t('dashboard.recent.loading')}</span>
        </div>
      ) : records.length === 0 ? (
        <div className="flex h-32 items-center justify-center rounded-[1.25rem] border border-dashed border-border/70 bg-background/45">
          <span className="text-sm text-muted-foreground">{t('dashboard.recent.empty')}</span>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">{records.length}</Badge>
            <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
              {t('common.status.success')}: {successCount}
            </Badge>
            <Badge variant="outline" className="border-destructive/30 bg-destructive/10 text-destructive">
              {t('common.status.error')}: {errorCount}
            </Badge>
          </div>
          <div className="max-h-80 overflow-auto rounded-[1.2rem]">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('dashboard.recent.columns.time')}</TableHead>
                <TableHead>{t('dashboard.recent.columns.endpoint')}</TableHead>
                <TableHead>{t('dashboard.recent.columns.provider')}</TableHead>
                <TableHead>{t('dashboard.recent.columns.route')}</TableHead>
                <TableHead className="text-right">{t('dashboard.recent.columns.latency')}</TableHead>
                <TableHead>{t('dashboard.recent.columns.status')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {records.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>
                    <div className="flex flex-col">
                      <span className="text-xs font-medium">{new Date(item.timestamp).toLocaleString()}</span>
                      <span className="text-[11px] text-muted-foreground">#{item.id}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-[11px]">
                      {item.endpoint === 'anthropic'
                        ? t('logs.table.endpointAnthropic')
                        : item.endpoint === 'openai'
                          ? t('logs.table.endpointOpenAI')
                          : item.endpoint}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col">
                      <span className="font-medium">{item.provider}</span>
                      <span className="text-[11px] text-muted-foreground">{item.stream ? 'stream' : 'sync'}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-1 text-xs">
                      <div className="flex items-center gap-1 text-muted-foreground">
                        <span>{item.client_model ?? t('dashboard.recent.routePlaceholder')}</span>
                        <span>→</span>
                        <span className="font-medium text-foreground">{item.model}</span>
                      </div>
                      {item.error ? (
                        <span className="truncate text-destructive">{item.error}</span>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    {formatLatencyValue(item.latency_ms, t('common.units.ms'))}
                  </TableCell>
                  <TableCell>
                    <Badge variant={item.error ? 'destructive' : 'default'} className="min-w-14 justify-center">
                      {(item.status_code ?? (item.error ? 500 : 200)).toString()}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        </div>
      )}
    </PageSection>
  )
}
