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
import { EChart, echarts, type EChartOption } from '@/components/EChart'
import { PageSection } from '@/components/PageSection'
import { PageLoadingState, PageState } from '@/components/PageState'
import { StatCardSkeleton, ChartSkeleton, TableRowSkeleton } from '@/components/Skeleton'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table'
import type { LogRecord } from '@/types/logs'
import { cn } from '@/lib/utils'
import { getLogStatusMeta } from '@/pages/logs/utils'
import { formatByteRate, formatLatencyValue, formatPercent, type DailyMetric, type ModelUsageMetric, type OverviewStats, type ServiceStatus } from './types'

export function DashboardLoading() {
  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }).map((_, index) => (
          <StatCardSkeleton key={index} />
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        {Array.from({ length: 4 }).map((_, index) => (
          <ChartSkeleton key={index} />
        ))}
      </div>
      <div className="rounded-lg border border-border">
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

export function DashboardSpotlight({
  dbSizeDisplay,
  memoryDisplay,
  selectedEndpointLabel,
  status,
  todayRequests
}: {
  dbSizeDisplay: string
  memoryDisplay: string
  selectedEndpointLabel: string
  status?: ServiceStatus
  todayRequests: number
}) {
  const { t } = useTranslation()

  return (
    <Card className="overflow-hidden border-primary/15 bg-[linear-gradient(145deg,hsl(var(--card))_0%,hsl(var(--accent)/0.55)_100%)]">
      <CardContent className="relative overflow-hidden pt-6">
        <div className="pointer-events-none absolute -right-14 top-0 h-40 w-40 rounded-full bg-primary/10 blur-3xl" />
        <div className="pointer-events-none absolute bottom-0 left-0 h-32 w-32 rounded-full bg-emerald-500/10 blur-3xl" />
        <div className="relative">
          <div className="grid gap-6 xl:grid-cols-[minmax(360px,0.94fr)_minmax(0,1.06fr)] xl:items-start">
            <div
              className="flex h-full flex-col justify-between rounded-[28px] border border-border/70 bg-background/30 p-5 shadow-[0_20px_48px_-36px_rgba(15,23,42,0.6)] backdrop-blur-sm"
              data-testid="dashboard-overview-panel"
            >
              <div className="space-y-5">
                <div className="inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-accent px-3 py-1 text-xs font-semibold text-primary">
                  <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                  Live Gateway
                </div>
                <div className="space-y-2">
                  <h2 className="text-[clamp(1.85rem,1.55rem+1vw,2.75rem)] font-semibold tracking-tight text-foreground">
                    {selectedEndpointLabel}
                  </h2>
                  <p className="max-w-xl text-sm leading-6 text-muted-foreground">
                    {t('dashboard.description')}
                  </p>
                </div>
                <div className="space-y-1">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                    {t('dashboard.status.listeningLabel')}
                  </p>
                  <p
                    className="text-[clamp(1.2rem,1rem+0.8vw,1.9rem)] font-semibold leading-tight text-foreground"
                    data-testid="dashboard-runtime-address"
                  >
                    {(status?.host ?? '0.0.0.0')}:{status?.port ?? '-'}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className="border-[hsl(var(--success)/0.3)] bg-[hsl(var(--success-bg))] text-[hsl(var(--success)/1)]">
                    {t('dashboard.status.listeningLabel')}
                  </Badge>
                  <Badge variant="secondary">{selectedEndpointLabel}</Badge>
                  <Badge variant="outline">{t('dashboard.labels.todayRequests')}: {todayRequests.toLocaleString()}</Badge>
                </div>
              </div>

              <div className="mt-6 grid gap-3 sm:grid-cols-2">
                <InfoMetric label={t('dashboard.labels.providers')} value={(status?.providers ?? 0).toLocaleString()} />
                <InfoMetric label={t('dashboard.labels.activeClientAddresses')} value={(status?.activeClientAddresses ?? 0).toLocaleString()} />
                <InfoMetric label={t('dashboard.labels.activeClientSessions')} value={(status?.activeClientSessions ?? 0).toLocaleString()} />
                <InfoMetric label={t('dashboard.labels.uniqueClientAddressesLastHour')} value={(status?.uniqueClientAddressesLastHour ?? 0).toLocaleString()} />
                <InfoMetric label={t('dashboard.labels.uniqueClientSessionsLastHour')} value={(status?.uniqueClientSessionsLastHour ?? 0).toLocaleString()} />
              </div>
            </div>

            <div
              className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4 xl:auto-rows-[minmax(168px,auto)]"
              data-testid="dashboard-spotlight-grid"
            >
              <SpotlightMetric
                icon={<Gauge className="h-4 w-4" aria-hidden="true" />}
                label={t('dashboard.labels.activeRequests')}
                value={(status?.activeRequests ?? 0).toLocaleString()}
                valueTestId="dashboard-spotlight-value-active"
              />
              <SpotlightMetric
                icon={<Activity className="h-4 w-4" aria-hidden="true" />}
                label={t('dashboard.labels.requestsPerMinute')}
                value={(status?.requestsPerMinute ?? 0).toLocaleString()}
                valueTestId="dashboard-spotlight-value-rpm"
              />
              <SpotlightMetric
                icon={<Zap className="h-4 w-4" aria-hidden="true" />}
                label={t('dashboard.labels.outputTokensPerMinute')}
                value={(status?.outputTokensPerMinute ?? 0).toLocaleString()}
                valueTestId="dashboard-spotlight-value-tpm"
              />
              <SpotlightMetric
                icon={<Cpu className="h-4 w-4" aria-hidden="true" />}
                label={t('dashboard.labels.cpu')}
                value={formatPercent(status?.cpuUsagePercent)}
                valueTestId="dashboard-spotlight-value-cpu"
              />
              <SpotlightMetric
                icon={<ArrowDownToLine className="h-4 w-4" aria-hidden="true" />}
                label={t('dashboard.labels.networkIngress')}
                value={formatByteRate(status?.networkIngressBytesPerSecond)}
                valueTestId="dashboard-spotlight-value-ingress"
              />
              <SpotlightMetric
                icon={<ArrowUpToLine className="h-4 w-4" aria-hidden="true" />}
                label={t('dashboard.labels.networkEgress')}
                value={formatByteRate(status?.networkEgressBytesPerSecond)}
                valueTestId="dashboard-spotlight-value-egress"
              />
              <SpotlightMetric icon={<Database className="h-4 w-4" aria-hidden="true" />} label={t('dashboard.labels.database')} value={dbSizeDisplay} valueTestId="dashboard-spotlight-value-database" />
              <SpotlightMetric icon={<MemoryStick className="h-4 w-4" aria-hidden="true" />} label={t('dashboard.labels.memory')} value={memoryDisplay} valueTestId="dashboard-spotlight-value-memory" />
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

export function DashboardStatsGrid({ overview }: { overview?: OverviewStats }) {
  const { t } = useTranslation()

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      <StatCard icon={<Activity className="h-5 w-5" />} title={t('dashboard.cards.todayRequests')} value={overview?.today.requests ?? 0} suffix={t('common.units.request')} iconClass="bg-blue-50 text-blue-600 dark:bg-blue-950 dark:text-blue-400" />
      <StatCard icon={<TrendingUp className="h-5 w-5" />} title={t('dashboard.cards.todayInput')} value={overview?.today.inputTokens ?? 0} suffix={t('common.units.token')} iconClass="bg-emerald-50 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-400" />
      <StatCard icon={<Zap className="h-5 w-5" />} title={t('dashboard.cards.todayCacheRead')} value={overview?.today.cacheReadTokens ?? 0} suffix={t('common.units.token')} iconClass="bg-violet-50 text-violet-600 dark:bg-violet-950 dark:text-violet-400" />
      <StatCard icon={<Sparkles className="h-5 w-5" />} title={t('dashboard.cards.todayCacheCreation')} value={overview?.today.cacheCreationTokens ?? 0} suffix={t('common.units.token')} iconClass="bg-rose-50 text-rose-600 dark:bg-rose-950 dark:text-rose-400" />
      <StatCard icon={<BarChart3 className="h-5 w-5" />} title={t('dashboard.cards.todayOutput')} value={overview?.today.outputTokens ?? 0} suffix={t('common.units.token')} iconClass="bg-amber-50 text-amber-600 dark:bg-amber-950 dark:text-amber-400" />
      <StatCard icon={<Timer className="h-5 w-5" />} title={t('dashboard.cards.avgLatency')} value={overview?.today.avgLatencyMs ?? 0} suffix={t('common.units.ms')} iconClass="bg-cyan-50 text-cyan-600 dark:bg-cyan-950 dark:text-cyan-400" />
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
    <div className="grid gap-4 lg:grid-cols-4">
      <InsightCard label={t('dashboard.insights.totalRequests')} value={totalRequestsInRange.toLocaleString()} hint={t('dashboard.insights.totalRequestsHint')} />
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
        <div className="overflow-auto rounded-lg border border-border">
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
            <Badge variant="outline" className="border-[hsl(var(--success)/0.3)] bg-[hsl(var(--success-bg))] text-[hsl(var(--success)/1)]">
              {t('common.status.success')}: {successCount}
            </Badge>
            <Badge variant="outline" className="border-destructive/30 bg-destructive/10 text-destructive">
              {t('common.status.error')}: {errorCount}
            </Badge>
            {pendingCount > 0 ? (
              <Badge variant="outline" className="border-amber-300/60 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/60 dark:text-amber-300">
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
        <div className="overflow-auto rounded-lg border border-border">
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

function SpotlightMetric({
  icon,
  label,
  value,
  valueTestId
}: {
  icon: ReactNode
  label: string
  value: string
  valueTestId?: string
}) {
  const parts = splitMetricValue(value)

  return (
    <div className="flex min-h-[168px] min-w-0 flex-col rounded-2xl border border-border/80 bg-background/78 px-4 py-4 shadow-[0_14px_32px_-26px_rgba(15,23,42,0.5)] backdrop-blur">
      <div className="min-w-0 flex items-center gap-2 text-xs text-muted-foreground">
        <span className="flex h-6 w-6 items-center justify-center rounded-md bg-primary/10 text-primary">{icon}</span>
        <span className="min-w-0 break-words">{label}</span>
      </div>
      <div className="mt-auto pt-6">
        <MetricValueDisplay parts={parts} testId={valueTestId} compact={false} />
      </div>
    </div>
  )
}

function MetricValueDisplay({
  parts,
  testId,
  compact
}: {
  parts: ReturnType<typeof splitMetricValue>
  testId?: string
  compact: boolean
}) {
  if (!parts.unit) {
    return (
      <p
        className={cn(
          'mt-2 overflow-hidden font-semibold leading-tight text-foreground [overflow-wrap:anywhere]',
          compact ? 'text-[clamp(1rem,0.9rem+0.45vw,1.2rem)]' : 'text-[clamp(1.5rem,1.1rem+1vw,2rem)]'
        )}
        data-testid={testId}
      >
        {parts.primary}
      </p>
    )
  }

  return (
    <div
      className={cn(
        'mt-2 flex min-w-0 flex-wrap items-end gap-x-1.5 gap-y-1 text-foreground [overflow-wrap:anywhere]',
        compact ? 'min-h-[2.5rem]' : 'min-h-[2.75rem]'
      )}
      data-testid={testId}
    >
      <span
        className={cn(
          'min-w-0 overflow-hidden font-semibold leading-none [overflow-wrap:anywhere]',
          compact ? 'text-[clamp(1rem,0.9rem+0.45vw,1.2rem)]' : 'text-[clamp(1.5rem,1.1rem+1vw,2rem)]'
        )}
      >
        {parts.primary}
      </span>
      <span className={cn('shrink-0 whitespace-nowrap text-muted-foreground', compact ? 'text-xs' : 'pb-0.5 text-sm')}>
        {parts.unit}
      </span>
    </div>
  )
}

function splitMetricValue(value: string) {
  if (value === '-') {
    return { primary: value, unit: '' }
  }

  const spacedUnit = value.match(/^(.+?)\s+([A-Za-z]+(?:\/[A-Za-z]+)?)$/)
  if (spacedUnit) {
    return {
      primary: spacedUnit[1],
      unit: spacedUnit[2]
    }
  }

  const trailingPercent = value.match(/^(.+?)(%)$/)
  if (trailingPercent) {
    return {
      primary: trailingPercent[1],
      unit: trailingPercent[2]
    }
  }

  return { primary: value, unit: '' }
}

function InfoMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border/65 bg-background/58 px-3.5 py-3 shadow-[0_12px_28px_-28px_rgba(15,23,42,0.55)]">
      <p className="text-[11px] leading-5 text-muted-foreground">{label}</p>
      <p className="mt-1.5 text-base font-semibold leading-tight text-foreground">{value}</p>
    </div>
  )
}

function StatCard({
  icon,
  iconClass,
  suffix,
  title,
  value
}: {
  icon?: ReactNode
  iconClass?: string
  suffix?: string
  title: string
  value: number
}) {
  return (
    <Card>
      <CardContent className="pt-5">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-medium text-muted-foreground">{title}</p>
          {icon ? <div className={cn('flex h-9 w-9 items-center justify-center rounded-lg', iconClass)}>{icon}</div> : null}
        </div>
        <p className="mt-3 text-2xl font-bold text-foreground">
          {value.toLocaleString()}
          {suffix ? <span className="ml-1.5 text-sm font-normal text-muted-foreground">{suffix}</span> : null}
        </p>
      </CardContent>
    </Card>
  )
}

function InsightCard({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <Card>
      <CardContent className="pt-4">
        <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
        <p className="mt-2 line-clamp-1 text-sm font-semibold text-foreground">{value}</p>
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
          <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
        </div>
        {loading ? (
          <PageLoadingState compact className="min-h-[320px]" label={t('common.loadingShort')} />
        ) : empty ? (
          <PageState compact className="min-h-[320px]" icon={<BarChart3 className="h-5 w-5" aria-hidden="true" />} title={emptyText ?? t('dashboard.charts.empty')} />
        ) : (
          <EChart echarts={echarts} option={option} className="h-[40vh] min-h-[280px] max-h-[420px]" notMerge lazyUpdate />
        )}
      </CardContent>
    </Card>
  )
}
