import { useTranslation } from 'react-i18next'
import { Activity, AlertTriangle, BarChart3, CheckCircle2 } from 'lucide-react'
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
import { SegmentedControl } from '@/components/ui/segmented-control'
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
import type { ClientActivityEntry } from '@/services/dashboard'
import type { DimensionUsageMetric } from '@/services/stats'
import { getLogStatusMeta } from '@/pages/logs/utils'
import { formatCost } from '@/utils/currency'
import { type UsageDistributionTab, USAGE_WINDOW_DAYS } from './useDashboardPageState'
import {
  formatByteRate,
  formatLatencyValue,
  formatPercent,
  type DailyMetric,
  type DatabaseInfo,
  type ModelUsageMetric,
  type OverviewStats,
  type RecentThroughput,
  type ServiceStatus
} from './types'

export function DashboardLoading() {
  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        {Array.from({ length: 6 }).map((_, index) => (
          <StatCardSkeleton key={index} />
        ))}
      </div>
      <ChartSkeleton />
      <div className="border border-border bg-card">
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
export function StatusBand({
  status,
  recentThroughput
}: {
  status?: ServiceStatus
  recentThroughput?: RecentThroughput
}) {
  const { t } = useTranslation()

  return (
    <div className="space-y-3" data-testid="dashboard-spotlight-grid">
      <div
        className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm"
        data-testid="dashboard-overview-panel"
      >
        <span className="inline-flex items-center gap-1.5 rounded-md bg-success-bg px-1.5 py-0.5 text-[11px] font-medium text-success before:h-1.5 before:w-1.5 before:rounded-full before:bg-success before:animate-live-pulse">
          {t('dashboard.status.listeningLabel')}
        </span>
        <span
          data-testid="dashboard-runtime-address"
          className="metric-number text-sm font-semibold tracking-tight text-foreground"
        >
          {/* The port is whatever the harness happened to bind, so it differs
              on every run — masked for visual tests. */}
          <span data-visual-volatile="true">
            {(status?.host ?? '0.0.0.0')}:{status?.port ?? '-'}
          </span>
        </span>
        <span className="text-xs text-muted-foreground">
          {t('dashboard.status.providers', { value: status?.providers ?? 0 })}
        </span>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
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
          label={t('dashboard.labels.inputTpm10m', { value: recentThroughput?.windowMinutes ?? 10 })}
          value={(recentThroughput?.inputTokensPerMinute ?? 0).toLocaleString()}
          rawValue={recentThroughput?.inputTokensPerMinute ?? 0}
          valueTestId="dashboard-spotlight-value-tpm-in"
        />
        <MetricCard
          size="md"
          label={t('dashboard.labels.outputTpm10m', { value: recentThroughput?.windowMinutes ?? 10 })}
          value={(recentThroughput?.outputTokensPerMinute ?? 0).toLocaleString()}
          rawValue={recentThroughput?.outputTokensPerMinute ?? 0}
          valueTestId="dashboard-spotlight-value-tpm-out"
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
          value={<span data-visual-volatile="true">{formatPercent(status?.cpuUsagePercent)}</span>}
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

/**
 * Logs deep link that carries the dashboard's endpoint scope, so a drill-down
 * from a scoped dashboard does not silently widen to all endpoints.
 */
function logsLink(endpointFilter?: string, status?: 'error'): string {
  const params = new URLSearchParams()
  if (endpointFilter && endpointFilter !== 'all') params.set('endpoint', endpointFilter)
  if (status) params.set('status', status)
  const query = params.toString()
  return query ? `/logs?${query}` : '/logs'
}

/** Layer 1b — today's consumption + health: requests, tokens, cache hit, cost, error rate */
export function TodaySummaryBand({
  overview,
  endpointFilter
}: {
  overview?: OverviewStats
  endpointFilter?: string
}) {
  const { t } = useTranslation()
  const today = overview?.today
  const yesterday = overview?.yesterday
  const requests = today?.requests ?? 0
  const inputTokens = today?.inputTokens ?? 0
  const outputTokens = today?.outputTokens ?? 0
  const cacheRead = today?.cacheReadTokens ?? 0
  const errorCount = today?.errorCount ?? 0
  // No fallback here: while the overview is loading (or after a failed fetch)
  // the backend hasn't reported any currency — guessing CNY would mislabel a
  // USD-configured deployment. formatCost renders a symbol-less number when
  // the currency is missing.
  const costCurrency = overview?.costCurrency
  const unpriced = today?.unpricedRequests ?? 0

  const errorRate = requests > 0 ? (errorCount / requests) * 100 : 0
  const yesterdayErrorRate =
    yesterday && (yesterday.requests ?? 0) > 0
      ? (yesterday.errorCount / yesterday.requests) * 100
      : undefined
  const hitBase = cacheRead + inputTokens
  const hitRate = hitBase > 0 ? (cacheRead / hitBase) * 100 : 0

  // Relative % change vs yesterday. Returns undefined when yesterday is missing
  // or zero — MetricCard hides the delta chip entirely when delta is undefined,
  // so cards degrade gracefully on a fresh install with no prior-day data.
  const relDelta = (cur: number | undefined, prev: number | undefined): number | undefined =>
    prev !== undefined && prev > 0 ? (((cur ?? 0) - prev) / prev) * 100 : undefined
  const formatDeltaPct = (value: number) => `${value > 0 ? '+' : ''}${value.toFixed(1)}%`
  // Hide the chip when the change rounds to 0.0% — a "↑0.0%" pill reads as movement
  // when today merely matches yesterday. Also guards sub-0.05% noise.
  const deltaChip = (value: number | undefined, invert = false) =>
    value !== undefined && Math.abs(value) >= 0.05
      ? { value, invertColor: invert, format: formatDeltaPct }
      : undefined
  // Error rate is undefined when there's no traffic today (0/0), so a -100% chip
  // would imply "errors eliminated" rather than "no requests" — suppress it.
  const errorRateDelta = requests > 0 ? relDelta(errorRate, yesterdayErrorRate) : undefined

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6" data-testid="dashboard-today-grid">
      <MetricCard
        size="md"
        label={t('dashboard.cards.todayRequests')}
        value={requests.toLocaleString()}
        rawValue={requests}
        delta={deltaChip(relDelta(requests, yesterday?.requests))}
        hint={
          yesterday && yesterday.requests > 0
            ? t('dashboard.cards.yesterdayHint', { value: yesterday.requests.toLocaleString() })
            : undefined
        }
        valueTestId="dashboard-today-value-requests"
      />
      <MetricCard
        size="md"
        label={t('dashboard.cards.todayInput')}
        value={inputTokens.toLocaleString()}
        rawValue={inputTokens}
        suffix={t('common.units.token')}
        delta={deltaChip(relDelta(inputTokens, yesterday?.inputTokens))}
        valueTestId="dashboard-today-value-input"
      />
      <MetricCard
        size="md"
        label={t('dashboard.cards.todayOutput')}
        value={outputTokens.toLocaleString()}
        rawValue={outputTokens}
        suffix={t('common.units.token')}
        delta={deltaChip(relDelta(outputTokens, yesterday?.outputTokens))}
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
        label={t('dashboard.cards.todayCost')}
        value={formatCost(today?.cost, costCurrency)}
        delta={deltaChip(relDelta(today?.cost ?? undefined, yesterday?.cost ?? undefined))}
        hint={
          unpriced > 0
            ? t('dashboard.cards.unpricedHint', { count: unpriced })
            : undefined
        }
        valueTestId="dashboard-today-value-cost"
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
        delta={deltaChip(errorRateDelta, true)}
        hint={
          errorCount > 0 ? (
            <span className="inline-flex flex-wrap items-center gap-1">
              {t('dashboard.cards.errorCountHint', { value: errorCount })}
              <Link
                to={logsLink(endpointFilter, 'error')}
                className="font-medium text-foreground underline decoration-muted-foreground/40 underline-offset-2 hover:decoration-foreground"
              >
                {t('dashboard.cards.viewErrors')}
              </Link>
            </span>
          ) : undefined
        }
        valueTestId="dashboard-today-value-error-rate"
      />
    </div>
  )
}

/** Layer 1c — per-agent-client activity: in-flight count + 1h usage rollup.
 *  Hidden entirely while no client traffic exists in the window. */
export function ClientActivityBand({
  status,
  entries
}: {
  status?: ServiceStatus
  entries: ClientActivityEntry[]
}) {
  const { t } = useTranslation()

  if (entries.length === 0) return null

  const kindLabel = (kind: string) =>
    kind === 'unknown'
      ? t('dashboard.usage.clientKinds.unknown')
      : t(`dashboard.usage.clientKinds.${kind}`, { defaultValue: kind })

  return (
    <div data-testid="dashboard-client-activity" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {entries.map((entry) => {
        const active = status?.activeByClientKind?.[entry.clientKind] ?? 0
        return (
          <div
            key={entry.clientKind}
            data-testid="dashboard-client-activity-card"
            className="rounded-lg border border-border bg-card px-4 py-3"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-foreground">
                  {kindLabel(entry.clientKind)}
                </div>
                <div className="font-mono text-[10.5px] text-muted-foreground">{entry.clientKind}</div>
              </div>
              <span
                className={
                  active > 0
                    ? 'inline-flex shrink-0 items-center gap-1 rounded-md bg-success-bg px-1.5 py-0.5 text-[11px] font-medium text-success before:h-1.5 before:w-1.5 before:rounded-full before:bg-success before:animate-live-pulse'
                    : 'shrink-0 rounded-md bg-secondary px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground'
                }
              >
                {t('dashboard.clientActivity.active', { value: active })}
              </span>
            </div>
            <dl className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] tabular-nums text-muted-foreground">
              <div className="flex items-baseline justify-between gap-2">
                <dt>{t('dashboard.clientActivity.requests')}</dt>
                <dd className="font-medium text-foreground">{entry.requests.toLocaleString()}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-2">
                <dt>{t('dashboard.clientActivity.sessions')}</dt>
                <dd className="font-medium text-foreground">{entry.sessions.toLocaleString()}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-2">
                <dt>{t('dashboard.clientActivity.input')}</dt>
                <dd>{entry.inputTokens.toLocaleString()}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-2">
                <dt>{t('dashboard.clientActivity.output')}</dt>
                <dd>{entry.outputTokens.toLocaleString()}</dd>
              </div>
            </dl>
          </div>
        )
      })}
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
                  ? 'inline-flex items-center gap-1 text-[11px] font-medium text-success before:h-1.5 before:w-1.5 before:rounded-full before:bg-success before:animate-live-pulse'
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
              {/* Second-granularity, so it differs on every visual run. */}
              <span data-visual-volatile="true" className="shrink-0 pt-0.5 text-[11px] tabular-nums text-muted-foreground/70">
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
      className="flex h-8 flex-wrap items-center gap-x-2 gap-y-1 bg-success-bg px-3 text-xs text-success"
    >
      <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span className="font-medium">{t('dashboard.attention.allClear')}</span>
      <span
        className={
          failed
            ? 'ml-auto inline-flex items-center gap-1.5 text-[11px] font-medium text-destructive before:h-1.5 before:w-1.5 before:rounded-full before:bg-destructive'
            : connected
              ? 'ml-auto inline-flex items-center gap-1.5 text-[11px] font-medium before:h-1.5 before:w-1.5 before:rounded-full before:bg-success before:animate-live-pulse'
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

/** Layer 3a — aggregated 14-day trend (traffic: requests + latency; cost:
 *  cost line + faded request bars), switchable via segmented control. */
export function TrendChart({
  empty,
  loading,
  option,
  mode,
  onModeChange
}: {
  empty: boolean
  loading?: boolean
  option: EChartOption
  mode: 'traffic' | 'cost'
  onModeChange: (mode: 'traffic' | 'cost') => void
}) {
  const { t } = useTranslation()
  return (
    <ChartCard
      title={t('dashboard.charts.trendTitle')}
      description={
        mode === 'cost'
          ? t('dashboard.charts.trendCostDesc')
          : t('dashboard.charts.trendDesc')
      }
      loading={loading}
      option={option}
      empty={empty}
      emptyText={t('dashboard.charts.empty')}
      actions={
        <SegmentedControl
          value={mode}
          onChange={onModeChange}
          aria-label={t('dashboard.charts.trendModeLabel')}
          options={[
            {
              value: 'traffic' as const,
              label: <span data-testid="dashboard-trend-mode-traffic">{t('dashboard.charts.trendModeTraffic')}</span>
            },
            {
              value: 'cost' as const,
              label: <span data-testid="dashboard-trend-mode-cost">{t('dashboard.charts.trendModeCost')}</span>
            }
          ]}
        />
      }
    />
  )
}

/** Layer 2c — 4-card insights grid: trend total / busiest day / top model / fastest TTFT.
 *  Pure derivation from existing daily + model stats (no backend gap). Hides during cold start. */
export function InsightsGrid({
  daily,
  models
}: {
  daily: DailyMetric[]
  models: ModelUsageMetric[]
}) {
  const { t } = useTranslation()

  if (daily.length === 0 && models.length === 0) return null

  const totalRequests = daily.reduce((sum, item) => sum + item.requestCount, 0)
  const busiestDay = daily.length > 0
    ? daily.reduce((max, item) => (item.requestCount > max.requestCount ? item : max), daily[0])
    : null
  const topModel = models.length > 0
    ? models.reduce((max, item) => (item.requests > max.requests ? item : max), models[0])
    : null
  const fastestTtft = models
    .filter((item) => item.avgTtftMs != null && item.avgTtftMs > 0)
    .sort((a, b) => (a.avgTtftMs ?? Number.POSITIVE_INFINITY) - (b.avgTtftMs ?? Number.POSITIVE_INFINITY))[0]

  const cards = [
    {
      label: t('dashboard.insights.totalRequests'),
      value: totalRequests > 0 ? totalRequests.toLocaleString() : '—',
      hint: totalRequests > 0 ? t('dashboard.insights.totalRequestsHint') : undefined
    },
    {
      label: t('dashboard.insights.busiestDay'),
      value: busiestDay ? busiestDay.date.slice(5) : '—',
      hint: busiestDay
        ? t('dashboard.insights.busiestDayHint', { value: busiestDay.requestCount.toLocaleString() })
        : undefined
    },
    {
      label: t('dashboard.insights.topModel'),
      value: topModel ? topModel.model : '—',
      hint: topModel ? t('dashboard.insights.topModelHint', { value: topModel.requests.toLocaleString() }) : undefined
    },
    {
      label: t('dashboard.insights.fastestTtft'),
      value: fastestTtft ? fastestTtft.model : '—',
      hint: fastestTtft
        ? t('dashboard.insights.fastestTtftHint', { value: Math.round(fastestTtft.avgTtftMs ?? 0) })
        : undefined
    }
  ]

  return (
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-4" data-testid="dashboard-insights-grid">
      {cards.map((card) => (
        <div key={card.label} className="rounded-lg border border-border bg-card px-4 py-3">
          <div className="text-[10.5px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
            {card.label}
          </div>
          <div className="metric-number mt-2 truncate text-base font-bold tracking-tight text-foreground">
            {card.value}
          </div>
          {card.hint ? <div className="mt-0.5 text-[11px] text-muted-foreground">{card.hint}</div> : null}
        </div>
      ))}
    </div>
  )
}

/** Layer 3a-2 — usage distribution across provider / endpoint / client / api-key tabs */
export function UsageDistributionSection({
  dimension,
  onDimensionChange,
  rows,
  loading,
  error,
  onRetry,
  customEndpoints,
  costCurrency
}: {
  dimension: UsageDistributionTab
  onDimensionChange: (dimension: UsageDistributionTab) => void
  rows: DimensionUsageMetric[]
  loading?: boolean
  error?: string | null
  onRetry?: () => void
  customEndpoints: { id: string; label?: string }[]
  costCurrency?: string
}) {
  const { t } = useTranslation()

  const tabs: { value: UsageDistributionTab; label: string }[] = [
    { value: 'providers', label: t('dashboard.usage.tabs.providers') },
    { value: 'endpoints', label: t('dashboard.usage.tabs.endpoints') },
    { value: 'clients', label: t('dashboard.usage.tabs.clients') },
    { value: 'apiKeys', label: t('dashboard.usage.tabs.apiKeys') }
  ]

  const endpointLabel = (key: string): string => {
    if (key === 'anthropic') return t('dashboard.filters.endpointAnthropic')
    if (key === 'openai') return t('dashboard.filters.endpointOpenAI')
    return customEndpoints.find((endpoint) => endpoint.id === key)?.label || key
  }
  const clientKindLabel = (key: string): string =>
    key === 'unknown'
      ? t('dashboard.usage.clientKinds.unknown')
      : t(`dashboard.usage.clientKinds.${key}`, { defaultValue: key })

  const keyCell = (row: DimensionUsageMetric) => {
    switch (dimension) {
      case 'endpoints':
        return <Badge variant="outline" className="text-[11px]">{endpointLabel(row.key)}</Badge>
      case 'clients':
        return (
          <div className="flex flex-col">
            <span className="font-medium">{clientKindLabel(row.key)}</span>
            <span className="font-mono text-[11px] text-muted-foreground">{row.key}</span>
          </div>
        )
      case 'apiKeys':
        return <span className="font-medium">{row.key}</span>
      default:
        return <span className="font-mono text-[13px] font-medium">{row.key}</span>
    }
  }

  return (
    <PageSection
      title={t('dashboard.usage.title')}
      description={t('dashboard.usage.description', { value: USAGE_WINDOW_DAYS })}
      actions={
        <SegmentedControl
          value={dimension}
          onChange={onDimensionChange}
          aria-label={t('dashboard.usage.title')}
          options={tabs.map((tab) => ({
            value: tab.value,
            label: (
              <span data-testid={`dashboard-usage-tab-${tab.value}`}>
                {tab.label}
              </span>
            )
          }))}
        />
      }
    >
      {loading ? (
        <PageLoadingState compact label={t('common.loadingShort')} />
      ) : error && rows.length === 0 ? (
        // A failed stats query must not masquerade as "no traffic" — show the
        // failure with a retry entry instead (stale cached rows still render).
        <PageState
          compact
          tone="danger"
          icon={<AlertTriangle className="h-5 w-5" aria-hidden="true" />}
          title={t('dashboard.usage.error')}
          description={error}
          action={onRetry ? (
            <Button variant="outline" size="sm" onClick={onRetry}>
              {t('common.actions.retry')}
            </Button>
          ) : undefined}
        />
      ) : rows.length === 0 ? (
        <PageState
          inline
          icon={<BarChart3 className="h-3.5 w-3.5" aria-hidden="true" />}
          title={t('dashboard.usage.empty')}
        />
      ) : (
        <div className="overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('dashboard.usage.columns.dimension')}</TableHead>
                <TableHead className="text-right">{t('dashboard.usage.columns.requests')}</TableHead>
                <TableHead className="text-right">{t('dashboard.usage.columns.input')}</TableHead>
                <TableHead className="text-right">{t('dashboard.usage.columns.output')}</TableHead>
                <TableHead className="text-right">{t('dashboard.usage.columns.cacheRead')}</TableHead>
                <TableHead className="text-right">{t('dashboard.usage.columns.cacheCreation')}</TableHead>
                <TableHead className="text-right">{t('dashboard.usage.columns.cost')}</TableHead>
                <TableHead className="text-right">{t('dashboard.usage.columns.latency')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={`${dimension}:${row.key}`} data-testid="dashboard-usage-row">
                  <TableCell>{keyCell(row)}</TableCell>
                  <TableCell className="text-right font-medium">{row.requests.toLocaleString()}</TableCell>
                  <TableCell className="text-right">{row.inputTokens.toLocaleString()}</TableCell>
                  <TableCell className="text-right">{row.outputTokens.toLocaleString()}</TableCell>
                  <TableCell className="text-right">{row.cacheReadTokens.toLocaleString()}</TableCell>
                  <TableCell className="text-right">{row.cacheCreationTokens.toLocaleString()}</TableCell>
                  <TableCell className="text-right tabular-nums" data-testid="dashboard-usage-cost">
                    {/* `*` marks partial pricing: the row sums priced requests
                        only, unpriced ones are counted separately. */}
                    {row.unpricedRequests > 0 ? (
                      <span
                        className="inline-flex items-baseline gap-0.5"
                        title={t('dashboard.usage.unpricedHint', { count: row.unpricedRequests })}
                      >
                        {formatCost(row.cost, costCurrency)}
                        <span aria-hidden="true">*</span>
                      </span>
                    ) : (
                      formatCost(row.cost, costCurrency)
                    )}
                  </TableCell>
                  {/* Measured, so it differs on every visual run. */}
                  <TableCell className="text-right"><span data-visual-volatile="true">{formatLatencyValue(row.avgLatencyMs, t('common.units.ms'))}</span></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </PageSection>
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

/** Layer 3c — infrastructure details, collapsed by default; hosts DB size + memory readouts */
export function InfraDisclosure({
  dbInfo,
  dbSizeDisplay,
  memoryDisplay,
  status
}: {
  dbInfo?: DatabaseInfo
  dbSizeDisplay: string
  memoryDisplay: string
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
        <span data-visual-volatile="true" className="text-xs tabular-nums text-muted-foreground">
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
      className="flex flex-wrap items-center gap-x-3 gap-y-2 bg-secondary/60 px-4 py-2"
    >
      <span className="text-xs font-medium text-foreground">
        {t('dashboard.setupProgress.label', { done: doneCount, total })}
      </span>
      <div className="h-1.5 min-w-24 flex-1 overflow-hidden bg-border/60">
        <div className="h-1.5 bg-primary transition-all" style={{ width: `${percent}%` }} />
      </div>
      <Link to="/setup" className="shrink-0 text-xs font-medium text-foreground underline decoration-muted-foreground/40 underline-offset-2 hover:decoration-foreground">
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
      href: '/routing',
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
              <Button asChild variant="ghost" size="sm" className="mt-2 h-8 px-0 text-foreground underline decoration-muted-foreground/40 underline-offset-2 hover:bg-transparent hover:decoration-foreground">
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
    <PageState inline icon={<BarChart3 className="h-3.5 w-3.5" aria-hidden="true" />} title={t('dashboard.modelTable.empty')} />
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
              <TableCell className="text-right"><span data-visual-volatile="true">{formatLatencyValue(item.avgLatencyMs, t('common.units.ms'))}</span></TableCell>
              <TableCell className="text-right"><span data-visual-volatile="true">{formatLatencyValue(item.avgTtftMs, t('common.units.ms'))}</span></TableCell>
              <TableCell className="text-right"><span data-visual-volatile="true">{formatLatencyValue(item.avgTpotMs, t('common.units.msPerToken'), { maximumFractionDigits: 2 })}</span></TableCell>
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

export function RecentRequestsTable({
  records,
  loading,
  endpointFilter
}: {
  records: LogRecord[]
  loading?: boolean
  endpointFilter?: string
}) {
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
            <Link
              to={logsLink(endpointFilter)}
              className="ml-1 text-xs font-medium text-foreground underline decoration-muted-foreground/40 underline-offset-2 hover:decoration-foreground"
            >
              {t('dashboard.recent.viewAll')}
            </Link>
          </div>
        ) : (
          <Link
            to={logsLink(endpointFilter)}
            className="text-xs font-medium text-foreground underline decoration-muted-foreground/40 underline-offset-2 hover:decoration-foreground"
          >
            {t('dashboard.recent.viewAll')}
          </Link>
        )
      }
    >
      {loading ? (
        <PageLoadingState compact label={t('dashboard.recent.loading')} />
      ) : records.length === 0 ? (
        <PageState inline icon={<Activity className="h-3.5 w-3.5" aria-hidden="true" />} title={t('dashboard.recent.empty')} />
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
                        <span data-visual-volatile="true" className="text-xs font-medium">{new Date(item.timestamp).toLocaleString()}</span>
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
                    <TableCell className="text-right font-medium"><span data-visual-volatile="true">{formatLatencyValue(item.latency_ms, t('common.units.ms'))}</span></TableCell>
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
          inline
          icon={<BarChart3 className="h-3.5 w-3.5" aria-hidden="true" />}
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
  title,
  actions
}: {
  description: string
  empty?: boolean
  emptyText?: string
  loading?: boolean
  option: EChartOption
  title: string
  actions?: React.ReactNode
}) {
  const { t } = useTranslation()

  return (
    <Card>
      <CardContent className="space-y-4 pt-5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-sm font-semibold">{title}</p>
            <p className="mt-0.5 text-xs text-muted-foreground/70">{description}</p>
          </div>
          {actions}
        </div>
        {loading ? (
          <PageLoadingState compact className="min-h-[220px]" label={t('common.loadingShort')} />
        ) : empty ? (
          <PageState
            inline
            icon={<BarChart3 className="h-3.5 w-3.5" aria-hidden="true" />}
            title={emptyText ?? t('dashboard.charts.empty')}
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
