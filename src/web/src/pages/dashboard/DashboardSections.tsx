import type { ReactNode } from 'react'
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
  Sparkles,
  Timer,
  TrendingUp,
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
import { cn } from '@/lib/utils'
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
  selectedEndpointLabel,
  status,
  todayRequests
}: {
  selectedEndpointLabel: string
  status?: ServiceStatus
  todayRequests: number
}) {
  const { t } = useTranslation()

  return (
    <div className="flex flex-col gap-4 rounded-xl bg-card p-6 shadow-[var(--surface-shadow)] sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
          <Sparkles className="h-5 w-5 text-primary" aria-hidden="true" />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold text-foreground">{selectedEndpointLabel}</h2>
            <Badge variant="success">{t('dashboard.status.listeningLabel')}</Badge>
          </div>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {(status?.host ?? '0.0.0.0')}:{status?.port ?? '-'}
            <span className="mx-2 text-border">·</span>
            {t('dashboard.labels.todayRequests')}: {todayRequests.toLocaleString()}
            <span className="mx-2 text-border">·</span>
            {t('dashboard.labels.providers')}: {(status?.providers ?? 0).toLocaleString()}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
        <span>{t('dashboard.labels.activeClientAddresses')}: <strong className="text-foreground">{(status?.activeClientAddresses ?? 0).toLocaleString()}</strong></span>
        <span className="text-border">·</span>
        <span>{t('dashboard.labels.activeClientSessions')}: <strong className="text-foreground">{(status?.activeClientSessions ?? 0).toLocaleString()}</strong></span>
      </div>
    </div>
  )
}

export function MonitoringGrid({
  dbSizeDisplay,
  memoryDisplay,
  overview,
  status
}: {
  dbSizeDisplay: string
  memoryDisplay: string
  overview?: OverviewStats
  status?: ServiceStatus
}) {
  const { t } = useTranslation()
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
      suffix: t('common.units.request')
    },
    {
      icon: <TrendingUp className="h-4 w-4" />,
      label: t('dashboard.cards.todayInput'),
      value: (overview?.today.inputTokens ?? 0).toLocaleString(),
      suffix: t('common.units.token')
    },
    {
      icon: <BarChart3 className="h-4 w-4" />,
      label: t('dashboard.cards.todayOutput'),
      value: (overview?.today.outputTokens ?? 0).toLocaleString(),
      suffix: t('common.units.token')
    },
    {
      icon: <Timer className="h-4 w-4" />,
      label: t('dashboard.cards.avgLatency'),
      value: formatLatencyValue(overview?.today.avgLatencyMs ?? 0, t('common.units.ms'))
    },
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
    <div className="space-y-3">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        {spotlightMetrics.map((item, index) => (
          <MonitoringCard
            key={item.label}
            className={index === 0 ? 'md:col-span-2 xl:col-span-2' : undefined}
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
          <MonitoringCard
            key={item.label}
            compact
            icon={item.icon}
            label={item.label}
            suffix={item.suffix}
            value={item.value}
            valueTestId={item.testId}
          />
        ))}
      </div>
    </div>
  )
}

export function DashboardInsightsGrid({
  busiestDay,
  fastestTtftModel,
  topModel,
  totalRequestsInRange
}: {
  busiestDay: DailyMetric | null
  fastestTtftModel?: ModelUsageMetric
  topModel?: ModelUsageMetric
  totalRequestsInRange: number
}) {
  const { t } = useTranslation()

  return (
    <div className="grid gap-3 lg:grid-cols-[1.4fr_repeat(3,minmax(0,1fr))]">
      <InsightCard featured label={t('dashboard.insights.totalRequests')} value={totalRequestsInRange.toLocaleString()} hint={t('dashboard.insights.totalRequestsHint')} />
      <InsightCard
        label={t('dashboard.insights.busiestDay')}
        value={busiestDay ? busiestDay.date : '-'}
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
  )
}

export function DashboardGettingStarted({
  endpointCount,
  providerCount,
  selectedEndpointLabel,
}: {
  endpointCount: number
  providerCount: number
  selectedEndpointLabel: string
}) {
  const steps = [
    {
      title: '先配置 Provider',
      description: providerCount > 0 ? `当前已检测到 ${providerCount} 个 Provider，可直接继续下一步。` : '先在模型供应商里接入至少 1 个上游模型服务。',
      href: '/models',
      cta: '去模型供应商',
      tone: 'from-indigo-100 to-cyan-100',
    },
    {
      title: '确认默认路由入口',
      description: endpointCount > 0 ? `当前已有 ${endpointCount} 个自定义端点，可继续检查默认映射是否合理。` : '把一个端点或默认路由配置清楚，后续客户端就能稳定接入。',
      href: '/routing',
      cta: '去路由管理',
      tone: 'from-violet-100 to-fuchsia-100',
    },
    {
      title: '发起第一条真实请求',
      description: '创建 API Key，然后从常用客户端打进来一条请求，让日志、路由和延迟开始有数据。',
      href: '/api-keys',
      cta: '去 API 密钥',
      tone: 'from-emerald-100 to-cyan-100',
    },
  ]

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(300px,0.8fr)]">
      <Card className="overflow-hidden border-white/80 bg-[linear-gradient(135deg,rgba(255,255,255,0.98),hsl(var(--primary)/0.08),rgba(236,253,245,0.8))] shadow-[0_22px_56px_-40px_rgba(15,23,42,0.24)]">
        <CardContent className="space-y-5 pt-5">
          <div className="space-y-2">
            <div className="inline-flex items-center rounded-full bg-primary/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-primary">
              Cold Start Guide
            </div>
            <div>
              <h3 className="text-lg font-semibold text-foreground">当前还是冷启动状态，这是正常的</h3>
              <p className="mt-1.5 text-sm leading-6 text-muted-foreground">
                这个仪表盘会在第一条真实请求进来后明显更有价值。现在最适合做的是把 Provider、路由和 API Key 三件事顺次走通。
              </p>
            </div>
          </div>

          <div className="grid gap-3 lg:grid-cols-3">
            {steps.map((step, index) => (
              <div key={step.title} className="rounded-[1.1rem] border border-white/70 bg-card/88 p-4 shadow-[0_16px_40px_-34px_rgba(15,23,42,0.18)]">
                <div className={cn('flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br text-sm font-semibold text-primary', step.tone)}>
                  0{index + 1}
                </div>
                <h4 className="mt-3 text-sm font-semibold text-foreground">{step.title}</h4>
                <p className="mt-1.5 text-xs leading-6 text-muted-foreground">{step.description}</p>
                <Button asChild variant="ghost" size="sm" className="mt-3 h-8 rounded-full px-0 text-primary hover:bg-transparent hover:text-primary/80">
                  <Link to={step.href}>{step.cta}</Link>
                </Button>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card className="border-white/80 bg-card/96 shadow-[0_20px_48px_-40px_rgba(15,23,42,0.24)]">
        <CardContent className="space-y-4 pt-5">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/80">Workspace Snapshot</p>
            <h3 className="mt-2 text-base font-semibold text-foreground">{selectedEndpointLabel}</h3>
            <p className="mt-1 text-xs leading-6 text-muted-foreground">等第一批流量进来后，这里会逐步展示趋势、模型表现和最近请求。</p>
          </div>

          <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-1">
            {[
              { label: '已配置 Provider', value: String(providerCount) },
              { label: '自定义端点', value: String(endpointCount) },
              { label: '建议下一步', value: '发起请求' },
            ].map((item) => (
              <div key={item.label} className="rounded-[1rem] bg-secondary/45 px-4 py-3 ring-1 ring-white/70">
                <div className="text-[11px] font-medium text-muted-foreground">{item.label}</div>
                <div className="mt-1 text-lg font-semibold text-foreground">{item.value}</div>
              </div>
            ))}
          </div>

          <div className="rounded-[1rem] border border-dashed border-border/45 bg-secondary/35 px-4 py-3">
            <p className="text-xs leading-6 text-muted-foreground">
              如果你还没确定从哪一步开始，优先去 <span className="font-medium text-foreground">API 密钥</span> 创建一个客户端专用 key，再从常用工具发起一条最小请求。
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
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

function MonitoringCard({
  className,
  compact,
  featured,
  icon,
  label,
  value,
  suffix,
  valueTestId
}: {
  className?: string
  compact?: boolean
  featured?: boolean
  icon: ReactNode
  label: string
  value: string
  suffix?: string
  valueTestId?: string
}) {
  return (
    <div
      className={cn(
        'group flex flex-col justify-between rounded-[1.15rem] border border-white/70 bg-card/95 shadow-[0_18px_42px_-36px_rgba(15,23,42,0.24)] transition-all hover:-translate-y-0.5 hover:shadow-[0_24px_48px_-38px_rgba(59,130,246,0.2)]',
        featured
          ? 'bg-[linear-gradient(135deg,hsl(var(--primary)/0.1),rgba(255,255,255,0.95)_46%,rgba(236,253,245,0.74))] p-5'
          : compact
            ? 'p-3.5'
            : 'p-5',
        className
      )}
    >
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className={cn('inline-flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary', compact && 'h-6 w-6 rounded-md')}>
          {icon}
        </span>
        <span>{label}</span>
      </div>
      <p
        className={cn(
          'metric-number mt-3 font-semibold tracking-tight text-foreground',
          featured ? 'text-3xl' : compact ? 'text-lg' : 'text-2xl'
        )}
        data-testid={valueTestId}
      >
        {value}
        {suffix ? <span className="ml-1 text-sm font-normal text-muted-foreground">{suffix}</span> : null}
      </p>
    </div>
  )
}

function InsightCard({ featured, label, value, hint }: { featured?: boolean; label: string; value: string; hint: string }) {
  return (
    <Card className={featured ? 'overflow-hidden bg-[linear-gradient(135deg,rgba(255,255,255,0.98),hsl(var(--primary)/0.08))]' : undefined}>
      <CardContent className={cn('pt-4', featured && 'pb-4')}>
        <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
        <p className={cn('mt-2 line-clamp-1 font-semibold text-foreground', featured ? 'metric-number text-2xl tracking-tight' : 'text-base')}>{value}</p>
        <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
      </CardContent>
    </Card>
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
            className="min-h-[188px] rounded-[1rem] border border-dashed border-border/45 bg-secondary/35"
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
