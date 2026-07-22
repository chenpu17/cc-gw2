import { useTranslation } from 'react-i18next'
import {
  Activity,
  ArrowDownToLine,
  ArrowUpToLine,
  BarChart3,
  Cpu,
  Database,
  Gauge,
  MemoryStick,
  Server,
  Sparkles,
  Timer,
  TrendingUp,
  X,
  Zap
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { EChart, echarts, type EChartOption } from '@/components/EChart'
import { PageSection } from '@/components/PageSection'
import { PageLoadingState, PageState } from '@/components/PageState'
import { StatCardSkeleton, ChartSkeleton, TableRowSkeleton } from '@/components/Skeleton'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Disclosure } from '@/components/ui/disclosure'
import { MetricCard } from '@/components/ui/metric-card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table'
import type { LogRecord } from '@/types/logs'
import { getLogStatusMeta } from '@/pages/logs/utils'
import { formatByteRate, formatLatencyValue, formatPercent, type DailyMetric, type ModelUsageMetric, type OverviewStats, type ServiceStatus } from './types'

export function DashboardLoading() {
  return (
    <div className="flex flex-col gap-6">
      {/* Status bar skeleton */}
      <div className="h-20 animate-pulse rounded-xl bg-card shadow-[var(--surface-shadow)]" />
      {/* Monitoring grid skeleton */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {Array.from({ length: 12 }).map((_, index) => (
          <StatCardSkeleton key={index} />
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        {Array.from({ length: 4 }).map((_, index) => (
          <ChartSkeleton key={index} />
        ))}
      </div>
      <div className="rounded-xl bg-card shadow-[var(--surface-shadow)]">
        <table className="w-full">
          <tbody>
            {Array.from({ length: 5 }).map((_, index) => (
              <TableRowSkeleton key={index} columns={6} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export function GatewayStatusBar({
  status
}: {
  status?: ServiceStatus
}) {
  const { t } = useTranslation()

  return (
    <div
      className="flex flex-col gap-4 rounded-xl bg-card p-6 shadow-[var(--surface-shadow)] sm:flex-row sm:items-center sm:justify-between"
      data-testid="dashboard-overview-panel"
    >
      <div className="flex items-center gap-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
          <Sparkles className="h-5 w-5 text-primary" aria-hidden="true" />
        </div>
        <div>
          <Badge variant="success">{t('dashboard.status.listeningLabel')}</Badge>
          <h2
            data-testid="dashboard-runtime-address"
            className="metric-number mt-1.5 text-lg font-semibold tracking-tight text-foreground"
          >
            {(status?.host ?? '0.0.0.0')}:{status?.port ?? '-'}
          </h2>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
        <span>{t('dashboard.labels.activeClientAddresses')}: <strong className="metric-number text-foreground">{(status?.activeClientAddresses ?? 0).toLocaleString()}</strong></span>
        <span className="text-border">·</span>
        <span>{t('dashboard.labels.activeClientSessions')}: <strong className="metric-number text-foreground">{(status?.activeClientSessions ?? 0).toLocaleString()}</strong></span>
      </div>
    </div>
  )
}

export function MonitoringGrid({
  daily,
  dbSizeDisplay,
  memoryDisplay,
  overview,
  status
}: {
  daily: DailyMetric[]
  dbSizeDisplay: string
  memoryDisplay: string
  overview?: OverviewStats
  status?: ServiceStatus
}) {
  const { t } = useTranslation()
  const requestTrend = daily.map((item) => item.requestCount)
  const inputTrend = daily.map((item) => item.inputTokens)
  const outputTrend = daily.map((item) => item.outputTokens)
  const spotlightMetrics = [
    {
      icon: <Gauge className="h-4 w-4" />,
      label: t('dashboard.labels.activeRequests'),
      value: (status?.activeRequests ?? 0).toLocaleString(),
      testId: 'dashboard-spotlight-value-active'
    },
    {
      icon: <Activity className="h-4 w-4" />,
      label: t('dashboard.labels.requestsPerMinute'),
      value: (status?.requestsPerMinute ?? 0).toLocaleString(),
      testId: 'dashboard-spotlight-value-rpm'
    },
    {
      icon: <Zap className="h-4 w-4" />,
      label: t('dashboard.labels.outputTokensPerMinute'),
      value: (status?.outputTokensPerMinute ?? 0).toLocaleString(),
      testId: 'dashboard-spotlight-value-tpm'
    },
    {
      icon: <Cpu className="h-4 w-4" />,
      label: t('dashboard.labels.cpu'),
      value: formatPercent(status?.cpuUsagePercent),
      testId: 'dashboard-spotlight-value-cpu'
    }
  ]
  const secondaryMetrics = [
    {
      icon: <Activity className="h-4 w-4" />,
      label: t('dashboard.cards.todayRequests'),
      value: (overview?.today.requests ?? 0).toLocaleString(),
      rawValue: overview?.today.requests ?? 0,
      suffix: t('common.units.request'),
      sparkline: requestTrend
    },
    {
      icon: <TrendingUp className="h-4 w-4" />,
      label: t('dashboard.cards.todayInput'),
      value: (overview?.today.inputTokens ?? 0).toLocaleString(),
      rawValue: overview?.today.inputTokens ?? 0,
      suffix: t('common.units.token'),
      sparkline: inputTrend
    },
    {
      icon: <BarChart3 className="h-4 w-4" />,
      label: t('dashboard.cards.todayOutput'),
      value: (overview?.today.outputTokens ?? 0).toLocaleString(),
      rawValue: overview?.today.outputTokens ?? 0,
      suffix: t('common.units.token'),
      sparkline: outputTrend
    },
    {
      icon: <Timer className="h-4 w-4" />,
      label: t('dashboard.cards.avgLatency'),
      value: formatLatencyValue(overview?.today.avgLatencyMs ?? 0, t('common.units.ms'))
    }
  ]
  const infraMetrics = [
    {
      icon: <ArrowDownToLine className="h-4 w-4" />,
      label: t('dashboard.labels.networkIngress'),
      value: formatByteRate(status?.networkIngressBytesPerSecond),
      testId: 'dashboard-spotlight-value-ingress'
    },
    {
      icon: <ArrowUpToLine className="h-4 w-4" />,
      label: t('dashboard.labels.networkEgress'),
      value: formatByteRate(status?.networkEgressBytesPerSecond),
      testId: 'dashboard-spotlight-value-egress'
    },
    {
      icon: <Database className="h-4 w-4" />,
      label: t('dashboard.labels.database'),
      value: dbSizeDisplay,
      testId: 'dashboard-spotlight-value-database'
    },
    {
      icon: <MemoryStick className="h-4 w-4" />,
      label: t('dashboard.labels.memory'),
      value: memoryDisplay,
      testId: 'dashboard-spotlight-value-memory'
    }
  ]

  return (
    <div className="space-y-3" data-testid="dashboard-spotlight-grid">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        {spotlightMetrics.map((item, index) => (
          <MetricCard
            key={item.label}
            className={index === 0 ? 'md:col-span-2 xl:col-span-2' : undefined}
            size={index === 0 ? 'lg' : 'md'}
            featured={index === 0}
            icon={item.icon}
            label={item.label}
            value={item.value}
            valueTestId={item.testId}
          />
        ))}
      </div>
      <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
        {secondaryMetrics.map((item) => (
          <MetricCard
            key={item.label}
            size="sm"
            icon={item.icon}
            label={item.label}
            value={item.value}
            rawValue={item.rawValue}
            suffix={item.suffix}
            sparkline={item.sparkline ? { data: item.sparkline } : undefined}
          />
        ))}
      </div>
      <Disclosure
        variant="card"
        summaryClassName="px-4 py-3"
        contentClassName="border-t border-border px-4 py-4"
        summary={(
          <span className="inline-flex items-center gap-2 text-muted-foreground">
            <Server className="h-4 w-4" aria-hidden="true" />
            {t('dashboard.cards.systemResources')}
          </span>
        )}
      >
        <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
          {infraMetrics.map((item) => (
            <MetricCard
              key={item.label}
              size="sm"
              icon={item.icon}
              label={item.label}
              value={item.value}
              valueTestId={item.testId}
            />
          ))}
        </div>
      </Disclosure>
    </div>
  )
}

export function DashboardInsightsGrid({
  busiestDay,
  fastestTtftModel,
  totalRequestsInRange
}: {
  busiestDay: DailyMetric | null
  fastestTtftModel?: ModelUsageMetric
  totalRequestsInRange: number
}) {
  const { t } = useTranslation()

  return (
    <div className="grid gap-3 lg:grid-cols-[1.4fr_repeat(2,minmax(0,1fr))]">
      <MetricCard
        featured
        size="md"
        label={t('dashboard.insights.totalRequests')}
        value={totalRequestsInRange.toLocaleString()}
        rawValue={totalRequestsInRange}
        hint={t('dashboard.insights.totalRequestsHint')}
      />
      <MetricCard
        size="sm"
        label={t('dashboard.insights.busiestDay')}
        value={busiestDay ? busiestDay.date : '-'}
        hint={busiestDay ? t('dashboard.insights.busiestDayHint', { value: busiestDay.requestCount.toLocaleString() }) : t('common.noData')}
      />
      <MetricCard
        size="sm"
        label={t('dashboard.insights.fastestTtft')}
        value={fastestTtftModel ? `${fastestTtftModel.provider}/${fastestTtftModel.model}` : '-'}
        hint={fastestTtftModel ? formatLatencyValue(fastestTtftModel.avgTtftMs, t('common.units.ms')) : t('common.noData')}
      />
    </div>
  )
}

export function DashboardGettingStarted({
  endpointCount,
  providerCount,
  onDismiss
}: {
  endpointCount: number
  providerCount: number
  onDismiss?: () => void
}) {
  const { t } = useTranslation()
  const steps = [
    {
      title: '先配置 Provider',
      description: providerCount > 0 ? `当前已检测到 ${providerCount} 个 Provider，可直接继续下一步。` : '先在模型供应商里接入至少 1 个上游模型服务。',
      href: '/models',
      cta: '去模型供应商',
    },
    {
      title: '确认默认路由入口',
      description: endpointCount > 0 ? `当前已有 ${endpointCount} 个自定义端点，可继续检查默认映射是否合理。` : '把一个端点或默认路由配置清楚，后续客户端就能稳定接入。',
      href: '/routing',
      cta: '去路由管理',
    },
    {
      title: '发起第一条真实请求',
      description: '创建 API Key，然后从常用客户端打进来一条请求，让日志、路由和延迟开始有数据。',
      href: '/api-keys',
      cta: '去 API 密钥',
    },
  ]

  return (
    <Card className="relative overflow-hidden">
      {onDismiss ? (
        <Button
          variant="ghost"
          size="icon"
          onClick={onDismiss}
          aria-label={t('common.actions.close')}
          className="absolute right-3 top-3 h-8 w-8 text-muted-foreground hover:text-foreground"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </Button>
      ) : null}
      <CardContent className="space-y-5 pt-5">
        <div className="space-y-2">
          <div className="inline-flex items-center rounded-full bg-primary/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-primary">
            Cold Start Guide
          </div>
          <div>
            <h3 className="text-lg font-semibold text-foreground">先走通这三步</h3>
            <p className="mt-1.5 text-sm leading-6 text-muted-foreground">
              把 Provider、路由和 API Key 配好后发起一条请求，仪表盘就会开始有数据。
            </p>
          </div>
        </div>

        <div className="grid gap-3 lg:grid-cols-3">
          {steps.map((step, index) => (
            <Card key={step.title} className="p-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary/10 text-sm font-semibold text-primary">
                0{index + 1}
              </div>
              <h4 className="mt-3 text-sm font-semibold text-foreground">{step.title}</h4>
              <p className="mt-1.5 text-xs leading-6 text-muted-foreground">{step.description}</p>
              <Button asChild variant="ghost" size="sm" className="mt-3 h-8 rounded-full px-0 text-primary hover:bg-transparent hover:text-primary/80">
                <Link to={step.href}>{step.cta}</Link>
              </Button>
            </Card>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

export function DashboardChartsGrid({
  dailyEmpty,
  dailyOption,
  dailyPending,
  models,
  modelRequestsOption,
  modelUsagePending,
  ttftOption,
  tpotOption
}: {
  dailyEmpty: boolean
  dailyOption: EChartOption
  dailyPending: boolean
  models: ModelUsageMetric[]
  modelRequestsOption: EChartOption
  modelUsagePending: boolean
  ttftOption: EChartOption
  tpotOption: EChartOption
}) {
  const { t } = useTranslation()

  return (
    <>
      <div className="grid gap-6 lg:grid-cols-2">
        <ChartCard title={t('dashboard.charts.requestsTitle')} description={t('dashboard.charts.requestsDesc')} loading={dailyPending} option={dailyOption} empty={dailyEmpty} emptyText={t('dashboard.charts.empty')} />
        <ChartCard title={t('dashboard.charts.modelTitle')} description={t('dashboard.charts.modelDesc')} loading={modelUsagePending} option={modelRequestsOption} empty={!models.length} emptyText={t('dashboard.charts.empty')} />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <ChartCard
          title={t('dashboard.charts.ttftTitle')}
          description={t('dashboard.charts.ttftDesc')}
          loading={modelUsagePending}
          option={ttftOption}
          empty={!models.some((metric) => metric.avgTtftMs != null && metric.avgTtftMs > 0)}
          emptyText={t('dashboard.charts.ttftEmpty')}
        />
        <ChartCard
          title={t('dashboard.charts.tpotTitle')}
          description={t('dashboard.charts.tpotDesc')}
          loading={modelUsagePending}
          option={tpotOption}
          empty={!models.some((metric) => metric.avgTpotMs != null && metric.avgTpotMs > 0)}
          emptyText={t('dashboard.charts.tpotEmpty')}
        />
      </div>
    </>
  )
}

export function ModelMetricsTable({ models, loading }: { models: ModelUsageMetric[]; loading?: boolean }) {
  const { t } = useTranslation()

  return (
    <PageSection title={t('dashboard.modelTable.title')} description={t('dashboard.modelTable.description')}>
      {loading ? (
        <PageLoadingState compact label={t('common.loadingShort')} />
      ) : models.length === 0 ? (
        <PageState compact icon={<BarChart3 className="h-5 w-5" aria-hidden="true" />} title={t('dashboard.modelTable.empty')} />
      ) : (
        <div className="overflow-auto">
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
                  <TableCell className="text-right font-medium">{item.requests.toLocaleString()}</TableCell>
                  <TableCell className="text-right">{formatLatencyValue(item.avgLatencyMs, t('common.units.ms'))}</TableCell>
                  <TableCell className="text-right">{formatLatencyValue(item.avgTtftMs, t('common.units.ms'))}</TableCell>
                  <TableCell className="text-right">{formatLatencyValue(item.avgTpotMs, t('common.units.msPerToken'), { maximumFractionDigits: 2 })}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </PageSection>
  )
}

export function RecentRequestsTable({ records, loading }: { records: LogRecord[]; loading?: boolean }) {
  const { t } = useTranslation()
  const statusMeta = records.map((item) => getLogStatusMeta(item, t))
  const successCount = statusMeta.filter((item) => item.tone === 'success').length
  const errorCount = statusMeta.filter((item) => item.tone === 'error').length
  const pendingCount = statusMeta.filter((item) => item.tone === 'pending').length

  return (
    <PageSection
      title={t('dashboard.recent.title')}
      description={t('dashboard.recent.subtitle', { count: 5 })}
      actions={
        records.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">{records.length}</Badge>
            <Badge variant="success">
              {t('common.status.success')}: {successCount}
            </Badge>
            <Badge variant="outline" className="border-destructive/30 bg-destructive/10 text-destructive">
              {t('common.status.error')}: {errorCount}
            </Badge>
            {pendingCount > 0 ? (
            <Badge variant="warning">
                {t('common.status.pending')}: {pendingCount}
              </Badge>
            ) : null}
          </div>
        ) : null
      }
    >
      {loading ? (
        <PageLoadingState compact label={t('dashboard.recent.loading')} />
      ) : records.length === 0 ? (
        <PageState compact icon={<Activity className="h-5 w-5" aria-hidden="true" />} title={t('dashboard.recent.empty')} />
      ) : (
        <div className="overflow-auto">
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
              {records.map((item) => {
                const itemStatus = getLogStatusMeta(item, t)

                return (
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
                          ? t('logs.endpointAnthropic')
                          : item.endpoint === 'openai'
                            ? t('logs.endpointOpenAI')
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
                          <span>{'->'}</span>
                          <span className="font-medium text-foreground">{item.model}</span>
                        </div>
                        {item.error ? <span className="truncate text-destructive">{item.error}</span> : null}
                      </div>
                    </TableCell>
                    <TableCell className="text-right font-medium">{formatLatencyValue(item.latency_ms, t('common.units.ms'))}</TableCell>
                    <TableCell>
                      <Badge variant={itemStatus.variant} className="min-w-14 justify-center">
                        {itemStatus.label}
                      </Badge>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </PageSection>
  )
}

function ChartCard({
  description,
  empty,
  emptyText,
  loading,
  option,
  title
}: {
  description: string
  empty?: boolean
  emptyText?: string
  loading?: boolean
  option: EChartOption
  title: string
}) {
  const { t } = useTranslation()

  return (
    <Card>
      <CardContent className="space-y-4 pt-5">
        <div>
          <p className="text-sm font-semibold">{title}</p>
          <p className="mt-0.5 text-xs text-muted-foreground/70">{description}</p>
        </div>
        {loading ? (
          <PageLoadingState compact className="min-h-[220px]" label={t('common.loadingShort')} />
        ) : empty ? (
          <PageState
            compact
            className="min-h-[188px] rounded-xl border border-dashed border-border/45 bg-muted"
            icon={<BarChart3 className="h-5 w-5" aria-hidden="true" />}
            title={emptyText ?? t('dashboard.charts.empty')}
            description={description}
          />
        ) : (
          <div className="pt-2">
            <EChart echarts={echarts} option={option} className="h-[40vh] min-h-[280px] max-h-[420px]" notMerge lazyUpdate />
          </div>
        )}
      </CardContent>
    </Card>
  )
}
