import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Activity,
  BarChart3,
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
import { formatLatencyValue, type DailyMetric, type ModelUsageMetric, type OverviewStats, type ServiceStatus } from './types'

type StatCardColor = 'blue' | 'emerald' | 'amber' | 'violet' | 'rose' | 'cyan'

const statTone: Record<StatCardColor, { gradient: string; iconBg: string; iconColor: string; accent: string }> = {
  blue: {
    gradient: 'bg-[linear-gradient(135deg,rgba(37,99,235,0.12),rgba(14,165,233,0.04),rgba(255,255,255,0.94))]',
    iconBg: 'bg-blue-500/14',
    iconColor: 'text-blue-700 dark:text-blue-300',
    accent: 'from-blue-500/20'
  },
  emerald: {
    gradient: 'bg-[linear-gradient(135deg,rgba(5,150,105,0.12),rgba(16,185,129,0.04),rgba(255,255,255,0.94))]',
    iconBg: 'bg-emerald-500/14',
    iconColor: 'text-emerald-700 dark:text-emerald-300',
    accent: 'from-emerald-500/20'
  },
  amber: {
    gradient: 'bg-[linear-gradient(135deg,rgba(234,88,12,0.15),rgba(245,158,11,0.05),rgba(255,250,242,0.96))]',
    iconBg: 'bg-amber-500/14',
    iconColor: 'text-amber-700 dark:text-amber-300',
    accent: 'from-amber-500/20'
  },
  violet: {
    gradient: 'bg-[linear-gradient(135deg,rgba(124,58,237,0.12),rgba(168,85,247,0.04),rgba(255,255,255,0.94))]',
    iconBg: 'bg-violet-500/14',
    iconColor: 'text-violet-700 dark:text-violet-300',
    accent: 'from-violet-500/20'
  },
  rose: {
    gradient: 'bg-[linear-gradient(135deg,rgba(225,93,73,0.16),rgba(244,63,94,0.04),rgba(255,248,245,0.96))]',
    iconBg: 'bg-rose-500/14',
    iconColor: 'text-rose-700 dark:text-rose-300',
    accent: 'from-rose-500/20'
  },
  cyan: {
    gradient: 'bg-[linear-gradient(135deg,rgba(8,145,178,0.12),rgba(34,211,238,0.04),rgba(255,255,255,0.94))]',
    iconBg: 'bg-cyan-500/14',
    iconColor: 'text-cyan-700 dark:text-cyan-300',
    accent: 'from-cyan-500/20'
  }
}

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
      <div className="rounded-[1.25rem] border border-border/70 bg-background/55">
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
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(320px,0.9fr)]">
      <Card className="overflow-hidden border-[rgba(24,16,13,0.08)] bg-[radial-gradient(circle_at_top_left,rgba(225,93,73,0.16),transparent_34%),radial-gradient(circle_at_bottom_right,rgba(37,99,235,0.12),transparent_34%),linear-gradient(135deg,rgba(255,249,245,0.98),rgba(255,255,255,0.94))] shadow-[0_24px_60px_-36px_rgba(225,93,73,0.28)]">
        <CardContent className="pt-6">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-2xl space-y-4">
              <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-white/80 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-primary shadow-[0_10px_24px_-20px_rgba(225,93,73,0.35)]">
                <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                Live gateway cockpit
              </div>
              <div className="space-y-2">
                <h2 className="text-2xl font-semibold tracking-[-0.03em] text-slate-950 dark:text-slate-50">
                  {selectedEndpointLabel}
                </h2>
                <p className="max-w-xl text-sm leading-6 text-muted-foreground">
                  {t('dashboard.description')}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
                  {t('dashboard.status.listeningLabel')}
                </Badge>
                <Badge variant="secondary">{selectedEndpointLabel}</Badge>
                <Badge variant="outline">{t('dashboard.labels.todayRequests')}: {todayRequests.toLocaleString()}</Badge>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-3 lg:min-w-[360px] lg:max-w-[420px] lg:flex-1">
              <SpotlightMetric
                icon={<Gauge className="h-4 w-4" aria-hidden="true" />}
                label={t('dashboard.labels.activeRequests')}
                value={(status?.activeRequests ?? 0).toLocaleString()}
              />
              <SpotlightMetric
                icon={<Database className="h-4 w-4" aria-hidden="true" />}
                label={t('dashboard.labels.database')}
                value={dbSizeDisplay}
              />
              <SpotlightMetric
                icon={<MemoryStick className="h-4 w-4" aria-hidden="true" />}
                label={t('dashboard.labels.memory')}
                value={memoryDisplay}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="overflow-hidden border-white/10 bg-[linear-gradient(160deg,rgba(18,18,18,0.98),rgba(37,26,21,0.98))] text-slate-50 shadow-[0_24px_60px_-36px_rgba(17,12,11,0.65)]">
        <CardContent className="pt-6">
          <div className="space-y-5">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-300">Gateway runtime</p>
              <p className="mt-2 text-2xl font-semibold tracking-[-0.03em]">
                {(status?.host ?? '0.0.0.0')}:{status?.port ?? '-'}
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <DarkMetric label={t('dashboard.labels.providers')} value={(status?.providers ?? 0).toLocaleString()} />
              <DarkMetric label={t('dashboard.labels.activeClientAddresses')} value={(status?.activeClientAddresses ?? 0).toLocaleString()} />
              <DarkMetric label={t('dashboard.labels.activeClientSessions')} value={(status?.activeClientSessions ?? 0).toLocaleString()} />
              <DarkMetric label={t('dashboard.labels.uniqueClientSessionsLastHour')} value={(status?.uniqueClientSessionsLastHour ?? 0).toLocaleString()} />
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

export function DashboardStatsGrid({ overview }: { overview?: OverviewStats }) {
  const { t } = useTranslation()

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      <StatCard icon={<Activity className="h-5 w-5" />} title={t('dashboard.cards.todayRequests')} value={overview?.today.requests ?? 0} suffix={t('common.units.request')} color="blue" />
      <StatCard icon={<TrendingUp className="h-5 w-5" />} title={t('dashboard.cards.todayInput')} value={overview?.today.inputTokens ?? 0} suffix={t('common.units.token')} color="emerald" />
      <StatCard icon={<Zap className="h-5 w-5" />} title={t('dashboard.cards.todayCacheRead')} value={overview?.today.cacheReadTokens ?? 0} suffix={t('common.units.token')} color="violet" />
      <StatCard icon={<Sparkles className="h-5 w-5" />} title={t('dashboard.cards.todayCacheCreation')} value={overview?.today.cacheCreationTokens ?? 0} suffix={t('common.units.token')} color="rose" />
      <StatCard icon={<BarChart3 className="h-5 w-5" />} title={t('dashboard.cards.todayOutput')} value={overview?.today.outputTokens ?? 0} suffix={t('common.units.token')} color="amber" />
      <StatCard icon={<Timer className="h-5 w-5" />} title={t('dashboard.cards.avgLatency')} value={overview?.today.avgLatencyMs ?? 0} suffix={t('common.units.ms')} color="cyan" />
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
        <div className="overflow-auto rounded-[1.2rem] border border-border/70 bg-background/70">
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
  const successCount = records.filter((item) => !item.error && (item.status_code ?? 200) < 400).length
  const errorCount = records.filter((item) => item.error || (item.status_code ?? 200) >= 400).length

  return (
    <PageSection
      title={t('dashboard.recent.title')}
      description={t('dashboard.recent.subtitle', { count: 5 })}
      actions={
        records.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">{records.length}</Badge>
            <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
              {t('common.status.success')}: {successCount}
            </Badge>
            <Badge variant="outline" className="border-destructive/30 bg-destructive/10 text-destructive">
              {t('common.status.error')}: {errorCount}
            </Badge>
          </div>
        ) : null
      }
    >
      {loading ? (
        <PageLoadingState compact label={t('dashboard.recent.loading')} />
      ) : records.length === 0 ? (
        <PageState compact icon={<Activity className="h-5 w-5" aria-hidden="true" />} title={t('dashboard.recent.empty')} />
      ) : (
        <div className="overflow-auto rounded-[1.2rem] border border-border/70 bg-background/70">
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
                        <span>{'->'}</span>
                        <span className="font-medium text-foreground">{item.model}</span>
                      </div>
                      {item.error ? <span className="truncate text-destructive">{item.error}</span> : null}
                    </div>
                  </TableCell>
                  <TableCell className="text-right font-medium">{formatLatencyValue(item.latency_ms, t('common.units.ms'))}</TableCell>
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
      )}
    </PageSection>
  )
}

function SpotlightMetric({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-[1.25rem] border border-white/55 bg-white/75 px-4 py-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)] backdrop-blur">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
        <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/10 text-primary">{icon}</span>
        {label}
      </div>
      <p className="mt-3 text-xl font-semibold tracking-[-0.02em]">{value}</p>
    </div>
  )
}

function DarkMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[1.15rem] border border-white/10 bg-white/5 px-4 py-3 backdrop-blur">
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-300">{label}</p>
      <p className="mt-2 text-lg font-semibold text-white">{value}</p>
    </div>
  )
}

function StatCard({
  color = 'blue',
  icon,
  suffix,
  title,
  value
}: {
  color?: StatCardColor
  icon?: ReactNode
  suffix?: string
  title: string
  value: number
}) {
  const tone = statTone[color]

  return (
    <Card variant="interactive" className={cn('overflow-hidden border-white/55', tone.gradient)}>
      <CardContent className="relative pt-5">
        <div className={cn('absolute inset-x-0 top-0 h-16 bg-gradient-to-r to-transparent opacity-70', tone.accent)} />
        <div className="relative flex items-center justify-between gap-3">
          <span className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">{title}</span>
          {icon ? <div className={cn('flex h-10 w-10 items-center justify-center rounded-xl', tone.iconBg, tone.iconColor)}>{icon}</div> : null}
        </div>
        <p className="relative mt-4 text-3xl font-bold tracking-tight text-slate-950 dark:text-slate-50">
          {value.toLocaleString()}
          {suffix ? <span className="ml-1.5 text-sm font-medium text-muted-foreground">{suffix}</span> : null}
        </p>
      </CardContent>
    </Card>
  )
}

function InsightCard({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-[1.3rem] border border-white/55 bg-[linear-gradient(135deg,rgba(255,255,255,0.94),rgba(248,250,252,0.86))] px-4 py-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)] backdrop-blur">
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{label}</p>
      <p className="mt-2 line-clamp-1 text-sm font-semibold text-slate-950 dark:text-slate-50">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
    </div>
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
    <Card className="overflow-hidden border-white/55 bg-[linear-gradient(180deg,rgba(255,255,255,0.94),rgba(248,250,252,0.84))] shadow-[0_1px_2px_rgba(15,23,42,0.04),0_20px_40px_-32px_rgba(59,130,246,0.16)]">
      <CardContent className="space-y-4 pt-5">
        <div>
          <p className="text-base font-semibold">{title}</p>
          <p className="mt-1 text-xs text-muted-foreground">{description}</p>
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
