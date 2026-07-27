import { useTranslation } from 'react-i18next'
import { Activity, BarChart3, CheckCircle2 } from 'lucide-react'
import { AnimatePresence, motion } from 'framer-motion'
import { Link } from 'react-router-dom'
import { EChart, echarts, type EChartOption } from '@/components/EChart'
import { PageSection } from '@/components/PageSection'
import { PageLoadingState, PageState } from '@/components/PageState'
import { ChartSkeleton, StatCardSkeleton, TableRowSkeleton } from '@/components/Skeleton'
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
import type { GatewayEvent } from '@/types/events'
import type { LogRecord } from '@/types/logs'
import { getLogStatusMeta } from '@/pages/logs/utils'
import {
  formatByteRate,
  formatLatencyValue,
  formatPercent,
  type DatabaseInfo,
  type ModelUsageMetric,
  type OverviewStats,
  type ServiceStatus
} from './types'

export function DashboardLoading() {
  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <StatCardSkeleton key={index} />
        ))}
      </div>
      <ChartSkeleton />
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

/** Layer 1 — gateway status + live traffic, typography-first, no decorative icons */
export function StatusBand({ status }: { status?: ServiceStatus }) {
  const { t } = useTranslation()

  return (
    <div className="space-y-3" data-testid="dashboard-spotlight-grid">
      <div
        className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm"
        data-testid="dashboard-overview-panel"
      >
        <span className="inline-flex items-center gap-1.5 rounded-md bg-success-bg px-1.5 py-0.5 text-[11px] font-medium text-success before:h-1.5 before:w-1.5 before:rounded-full before:bg-success">
          {t('dashboard.status.listeningLabel')}
        </span>
        <span
          data-testid="dashboard-runtime-address"
          className="metric-number text-sm font-semibold tracking-tight text-foreground"
        >
          {(status?.host ?? '0.0.0.0')}:{status?.port ?? '-'}
        </span>
        <span className="text-xs text-muted-foreground">
          {t('dashboard.status.providers', { value: status?.providers ?? 0 })}
        </span>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          size="md"
          label={t('dashboard.labels.activeRequests')}
          value={(status?.activeRequests ?? 0).toLocaleString()}
          rawValue={status?.activeRequests ?? 0}
          valueTestId="dashboard-spotlight-value-active"
        />
        <MetricCard
          size="md"
          label={t('dashboard.labels.requestsPerMinute')}
          value={(status?.requestsPerMinute ?? 0).toLocaleString()}
          rawValue={status?.requestsPerMinute ?? 0}
          valueTestId="dashboard-spotlight-value-rpm"
        />
        <MetricCard
          size="md"
          label={t('dashboard.labels.uniqueClientAddressesLastHour')}
          value={(status?.uniqueClientAddressesLastHour ?? 0).toLocaleString()}
          rawValue={status?.uniqueClientAddressesLastHour ?? 0}
        />
        <MetricCard
          size="md"
          label={t('dashboard.labels.cpu')}
          value={formatPercent(status?.cpuUsagePercent)}
          valueTestId="dashboard-spotlight-value-cpu"
        />
      </div>
    </div>
  )
}

function eventLevelBadge(level: GatewayEvent['level']) {
  switch (level) {
    case 'error':
      return <Badge variant="destructive">error</Badge>
    case 'warn':
      return <Badge variant="warning">warn</Badge>
    default:
      return <Badge variant="secondary">info</Badge>
  }
}

/** Layer 1b — today's consumption + health: requests, tokens, cache hit, error rate */
export function TodaySummaryBand({ overview }: { overview?: OverviewStats }) {
  const { t } = useTranslation()
  const today = overview?.today
  const requests = today?.requests ?? 0
  const inputTokens = today?.inputTokens ?? 0
  const outputTokens = today?.outputTokens ?? 0
  const cacheRead = today?.cacheReadTokens ?? 0
  const errorCount = today?.errorCount ?? 0

  const errorRate = requests > 0 ? (errorCount / requests) * 100 : 0
  const hitBase = cacheRead + inputTokens
  const hitRate = hitBase > 0 ? (cacheRead / hitBase) * 100 : 0

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5" data-testid="dashboard-today-grid">
      <MetricCard
        size="md"
        label={t('dashboard.cards.todayRequests')}
        value={requests.toLocaleString()}
        rawValue={requests}
        valueTestId="dashboard-today-value-requests"
      />
      <MetricCard
        size="md"
        label={t('dashboard.cards.todayInput')}
        value={inputTokens.toLocaleString()}
        rawValue={inputTokens}
        suffix={t('common.units.token')}
        valueTestId="dashboard-today-value-input"
      />
      <MetricCard
        size="md"
        label={t('dashboard.cards.todayOutput')}
        value={outputTokens.toLocaleString()}
        rawValue={outputTokens}
        suffix={t('common.units.token')}
        valueTestId="dashboard-today-value-output"
      />
      <MetricCard
        size="md"
        label={t('dashboard.cards.todayCacheRead')}
        value={cacheRead.toLocaleString()}
        rawValue={cacheRead}
        suffix={t('common.units.token')}
        hint={hitBase > 0 ? t('dashboard.cards.cacheHitHint', { value: hitRate.toFixed(1) }) : undefined}
        valueTestId="dashboard-today-value-cache-read"
      />
      <MetricCard
        size="md"
        label={t('dashboard.cards.todayErrorRate')}
        value={
          errorRate > 0 ? (
            <span className="text-destructive">{errorRate.toFixed(1)}%</span>
          ) : (
            `${errorRate.toFixed(1)}%`
          )
        }
        hint={errorCount > 0 ? t('dashboard.cards.errorCountHint', { value: errorCount }) : undefined}
        valueTestId="dashboard-today-value-error-rate"
      />
    </div>
  )
}

/** Layer 2 — live warn/error feed; only rendered while there is something to show */
export function AttentionFeed({
  connected,
  failed,
  events
}: {
  connected: boolean
  failed?: boolean
  events: GatewayEvent[]
}) {
  const { t } = useTranslation()

  if (events.length === 0) return null

  return (
    <PageSection
      title={t('dashboard.attention.title')}
      description={t('dashboard.attention.subtitle')}
      actions={
        <div className="flex items-center gap-2">
          <span
            className={
              failed
                ? 'inline-flex items-center gap-1 text-[11px] font-medium text-destructive before:h-1.5 before:w-1.5 before:rounded-full before:bg-destructive'
                : connected
                  ? 'inline-flex items-center gap-1 text-[11px] font-medium text-success before:h-1.5 before:w-1.5 before:rounded-full before:bg-success'
                  : 'inline-flex items-center gap-1 text-[11px] font-medium text-warning before:h-1.5 before:w-1.5 before:rounded-full before:bg-warning'
            }
          >
            {failed
              ? t('dashboard.attention.failed')
              : connected
                ? t('dashboard.attention.live')
                : t('dashboard.attention.reconnecting')}
          </span>
          <Button asChild variant="ghost" size="sm" className="h-7">
            <Link to="/events">{t('dashboard.attention.viewAll')}</Link>
          </Button>
        </div>
      }
    >
      <ul className="divide-y divide-border">
        <AnimatePresence initial={false}>
          {events.map((event) => (
            <motion.li
              key={event.id}
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="flex items-start gap-3 py-2.5 first:pt-0 last:pb-0"
            >
              <div className="pt-0.5">{eventLevelBadge(event.level)}</div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">
                  {event.title ?? event.type}
                </p>
                {event.message ? (
                  <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{event.message}</p>
                ) : null}
              </div>
              <span className="shrink-0 pt-0.5 text-[11px] tabular-nums text-muted-foreground/70">
                {new Date(event.createdAt).toLocaleTimeString()}
              </span>
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
    </PageSection>
  )
}

/** Layer 2 fallback — slim all-clear strip shown at the end of the StatusBand area */
export function AttentionAllClear({ connected, failed }: { connected: boolean; failed?: boolean }) {
  const { t } = useTranslation()

  return (
    <motion.div
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18 }}
      data-testid="dashboard-all-clear"
      className="flex h-8 flex-wrap items-center gap-x-2 gap-y-1 rounded-full bg-success-bg px-3 text-xs text-success"
    >
      <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span className="font-medium">{t('dashboard.attention.allClear')}</span>
      <span
        className={
          failed
            ? 'ml-auto inline-flex items-center gap-1.5 text-[11px] font-medium text-destructive before:h-1.5 before:w-1.5 before:rounded-full before:bg-destructive'
            : connected
              ? 'ml-auto inline-flex items-center gap-1.5 text-[11px] font-medium before:h-1.5 before:w-1.5 before:rounded-full before:bg-success'
              : 'ml-auto inline-flex items-center gap-1.5 text-[11px] font-medium text-warning before:h-1.5 before:w-1.5 before:rounded-full before:bg-warning'
        }
      >
        {failed
          ? t('dashboard.attention.failed')
          : connected
            ? t('dashboard.attention.live')
            : t('dashboard.attention.reconnecting')}
      </span>
      <Link to="/events" className="shrink-0 underline-offset-2 hover:underline">
        {t('dashboard.attention.viewAll')}
      </Link>
    </motion.div>
  )
}

/** Layer 3a — single aggregated 14-day trend chart (requests + avg latency) */
export function TrendChart({
  empty,
  loading,
  option
}: {
  empty: boolean
  loading?: boolean
  option: EChartOption
}) {
  const { t } = useTranslation()
  return (
    <ChartCard
      title={t('dashboard.charts.trendTitle')}
      description={t('dashboard.charts.trendDesc')}
      loading={loading}
      option={option}
      empty={empty}
      emptyText={t('dashboard.charts.empty')}
    />
  )
}

/** Layer 3b — performance details, collapsed by default */
export function PerformanceDisclosure({
  modelRequestsOption,
  models,
  ttftOption,
  tpotOption
}: {
  modelRequestsOption: EChartOption
  models: ModelUsageMetric[]
  ttftOption: EChartOption
  tpotOption: EChartOption
}) {
  const { t } = useTranslation()

  return (
    <Disclosure
      variant="card"
      summaryClassName="px-4 py-3"
      contentClassName="border-t border-border px-4 py-4"
      summary={
        <span className="text-sm font-medium text-foreground">
          {t('dashboard.sections.performance')}
        </span>
      }
    >
      <div className="grid gap-4 lg:grid-cols-3">
        <InlineChart
          title={t('dashboard.charts.modelTitle')}
          option={modelRequestsOption}
          empty={!models.length}
        />
        <InlineChart
          title={t('dashboard.charts.ttftTitle')}
          option={ttftOption}
          empty={!models.some((metric) => metric.avgTtftMs != null && metric.avgTtftMs > 0)}
        />
        <InlineChart
          title={t('dashboard.charts.tpotTitle')}
          option={tpotOption}
          empty={!models.some((metric) => metric.avgTpotMs != null && metric.avgTpotMs > 0)}
        />
      </div>
      <div className="mt-4">
        <ModelMetricsTable models={models} embedded />
      </div>
    </Disclosure>
  )
}

/** Layer 3c — infrastructure details, collapsed by default; hosts DB compact */
export function InfraDisclosure({
  compacting,
  dbInfo,
  dbSizeDisplay,
  memoryDisplay,
  onCompact,
  status
}: {
  compacting: boolean
  dbInfo?: DatabaseInfo
  dbSizeDisplay: string
  memoryDisplay: string
  onCompact: () => void
  status?: ServiceStatus
}) {
  const { t } = useTranslation()
  void dbInfo

  return (
    <Disclosure
      variant="card"
      summaryClassName="px-4 py-3"
      contentClassName="border-t border-border px-4 py-4"
      summary={
        <span className="text-sm font-medium text-foreground">
          {t('dashboard.cards.systemResources')}
        </span>
      }
      badge={
        <span className="text-xs tabular-nums text-muted-foreground">
          {dbSizeDisplay} · {memoryDisplay}
        </span>
      }
    >
      <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          size="sm"
          label={t('dashboard.labels.networkIngress')}
          value={formatByteRate(status?.networkIngressBytesPerSecond)}
          valueTestId="dashboard-spotlight-value-ingress"
        />
        <MetricCard
          size="sm"
          label={t('dashboard.labels.networkEgress')}
          value={formatByteRate(status?.networkEgressBytesPerSecond)}
          valueTestId="dashboard-spotlight-value-egress"
        />
        <MetricCard
          size="sm"
          label={t('dashboard.labels.database')}
          value={dbSizeDisplay}
          valueTestId="dashboard-spotlight-value-database"
        />
        <MetricCard
          size="sm"
          label={t('dashboard.labels.memory')}
          value={memoryDisplay}
          valueTestId="dashboard-spotlight-value-memory"
        />
      </div>
      <div className="mt-4 flex justify-end">
        <Button variant="outline" size="sm" onClick={onCompact} disabled={compacting}>
          {compacting ? t('dashboard.actions.compacting') : t('dashboard.actions.compact')}
        </Button>
      </div>
    </Disclosure>
  )
}

/** Cold-start progress strip: always visible while setup is incomplete, never dismissible */
export function SetupProgressStrip({ doneCount, total }: { doneCount: number; total: number }) {
  const { t } = useTranslation()
  const percent = Math.min(100, Math.round((doneCount / total) * 100))

  return (
    <div
      data-testid="dashboard-setup-progress"
      className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-full bg-secondary/60 px-4 py-2"
    >
      <span className="text-xs font-medium text-foreground">
        {t('dashboard.setupProgress.label', { done: doneCount, total })}
      </span>
      <div className="h-1.5 min-w-24 flex-1 overflow-hidden rounded-full bg-border/60">
        <div className="h-1.5 rounded-full bg-primary transition-all" style={{ width: `${percent}%` }} />
      </div>
      <Link to="/setup" className="shrink-0 text-xs font-medium text-primary underline-offset-2 hover:underline">
        {t('dashboard.setupProgress.cta')}
      </Link>
    </div>
  )
}

export function DashboardGettingStarted({
  endpointCount,
  providerCount
}: {
  endpointCount: number
  providerCount: number
}) {
  const { t } = useTranslation()
  const steps = [
    {
      title: t('dashboard.guide.step1Title'),
      description: providerCount > 0
        ? t('dashboard.guide.step1DescDone', { count: providerCount })
        : t('dashboard.guide.step1Desc'),
      href: '/providers',
      cta: t('dashboard.guide.step1Cta'),
    },
    {
      title: t('dashboard.guide.step2Title'),
      description: endpointCount > 0
        ? t('dashboard.guide.step2DescDone', { count: endpointCount })
        : t('dashboard.guide.step2Desc'),
      href: '/providers',
      cta: t('dashboard.guide.step2Cta'),
    },
    {
      title: t('dashboard.guide.step3Title'),
      description: t('dashboard.guide.step3Desc'),
      href: '/api-keys',
      cta: t('dashboard.guide.step3Cta'),
    },
  ]

  return (
    <Card className="relative overflow-hidden">
      <CardContent className="space-y-5 pt-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1.5">
            <h3 className="text-base font-semibold text-foreground">{t('dashboard.guide.title')}</h3>
            <p className="text-sm leading-6 text-muted-foreground">
              {t('dashboard.guide.subtitle')}
            </p>
          </div>
          <Button asChild size="sm">
            <Link to="/setup">{t('dashboard.guide.startWizard')}</Link>
          </Button>
        </div>

        <ol className="grid gap-3 lg:grid-cols-3">
          {steps.map((step, index) => (
            <li key={step.title} className="rounded-lg border border-border p-4">
              <span className="metric-number text-xs font-semibold text-muted-foreground">
                {String(index + 1).padStart(2, '0')}
              </span>
              <h4 className="mt-2 text-sm font-semibold text-foreground">{step.title}</h4>
              <p className="mt-1.5 text-xs leading-6 text-muted-foreground">{step.description}</p>
              <Button asChild variant="ghost" size="sm" className="mt-2 h-8 px-0 text-primary hover:bg-transparent hover:text-primary/80">
                <Link to={step.href}>{step.cta}</Link>
              </Button>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  )
}

export function ModelMetricsTable({ models, loading, embedded }: { models: ModelUsageMetric[]; loading?: boolean; embedded?: boolean }) {
  const { t } = useTranslation()

  const body = loading ? (
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
  )

  if (embedded) return body

  return (
    <PageSection title={t('dashboard.modelTable.title')} description={t('dashboard.modelTable.description')}>
      {body}
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

function InlineChart({
  empty,
  option,
  title
}: {
  empty?: boolean
  option: EChartOption
  title: string
}) {
  const { t } = useTranslation()

  return (
    <div className="rounded-lg border border-border p-3">
      <p className="mb-2 text-xs font-medium text-muted-foreground">{title}</p>
      {empty ? (
        <PageState
          compact
          className="min-h-[160px]"
          icon={<BarChart3 className="h-4 w-4" aria-hidden="true" />}
          title={t('dashboard.charts.empty')}
        />
      ) : (
        <EChart echarts={echarts} option={option} className="h-[220px]" notMerge lazyUpdate />
      )}
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
            <EChart echarts={echarts} option={option} className="h-[36vh] min-h-[260px] max-h-[400px]" notMerge lazyUpdate />
          </div>
        )}
      </CardContent>
    </Card>
  )
}
