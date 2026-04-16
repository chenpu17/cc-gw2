import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { AlertTriangle, ChevronLeft, ChevronRight, Filter, RefreshCw, ShieldAlert, Siren, ShieldCheck } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { PageHeader } from '@/components/PageHeader'
import { PageSection } from '@/components/PageSection'
import { PageLoadingState, PageState } from '@/components/PageState'
import { useApiQuery } from '@/hooks/useApiQuery'
import { cn } from '@/lib/utils'
import { useToast } from '@/providers/ToastProvider'
import type { ApiError } from '@/services/api'
import { queryKeys } from '@/services/queryKeys'
import type { EventsResponse, GatewayEvent } from '@/types/events'
import { formatRelativeTime, formatTimestamp } from '@/utils/date'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'

interface FilterState {
  level: string
  type: string
}

const LEVEL_VARIANT: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  info: 'secondary',
  warn: 'outline',
  error: 'destructive'
}

export default function EventsPage() {
  const { t } = useTranslation()
  const { pushToast } = useToast()
  const [cursor, setCursor] = useState<number | null>(null)
  const [filters, setFilters] = useState<FilterState>({ level: '', type: '' })

  const queryParams = useMemo(
    () => ({
      limit: 50,
      cursor: cursor ?? undefined,
      level: filters.level || undefined,
      type: filters.type.trim() || undefined
    }),
    [cursor, filters.level, filters.type]
  )

  const eventsQuery = useApiQuery<EventsResponse, ApiError>(
    queryKeys.events.list(queryParams),
    {
      url: '/api/events',
      method: 'GET',
      params: queryParams
    }
  )

  useEffect(() => {
    if (eventsQuery.isError && eventsQuery.error) {
      pushToast({
        title: t('events.toast.loadFailure', { message: eventsQuery.error.message }),
        variant: 'error'
      })
    }
  }, [eventsQuery.error, eventsQuery.isError, pushToast, t])

  const handleResetFilters = () => {
    setCursor(null)
    setFilters({ level: '', type: '' })
  }

  const events = eventsQuery.data?.events ?? []
  const nextCursor = eventsQuery.data?.nextCursor ?? null
  const isLoading = eventsQuery.isLoading
  const isRefreshing = eventsQuery.isFetching && !eventsQuery.isLoading

  const activeFilters = useMemo(() => {
    const items: string[] = []
    if (filters.level) {
      items.push(t(`events.levels.${filters.level}` as const))
    }
    if (filters.type.trim()) {
      items.push(filters.type.trim())
    }
    return items
  }, [filters.level, filters.type, t])

  const infoCount = events.filter((event) => event.level === 'info').length
  const warnCount = events.filter((event) => event.level === 'warn').length
  const errorCount = events.filter((event) => event.level === 'error').length

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        icon={<ShieldAlert className="h-5 w-5" aria-hidden="true" />}
        title={t('events.title')}
        description={t('events.description')}
        eyebrow="Audit"
        breadcrumb="Gateway / Events"
        helper={t('events.filters.title')}
        badge={events.length > 0 ? `${events.length} events` : undefined}
        actions={
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:justify-end">
            <div className="rounded-lg bg-secondary px-3 py-1.5 text-xs font-semibold text-muted-foreground">
              {cursor ? t('events.actions.older') : t('events.actions.newest')}
            </div>
            <Button variant="outline" size="sm" onClick={() => void eventsQuery.refetch()} disabled={isRefreshing} className="w-full sm:w-auto">
              <RefreshCw className={cn('mr-2 h-4 w-4', isRefreshing && 'animate-spin')} aria-hidden="true" />
              {isRefreshing ? t('common.actions.refreshing') : t('common.actions.refresh')}
            </Button>
          </div>
        }
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <SummaryCard icon={<ShieldCheck className="h-4 w-4" aria-hidden="true" />} title={t('events.levels.info')} value={infoCount.toLocaleString()} tone="emerald" />
        <SummaryCard icon={<AlertTriangle className="h-4 w-4" aria-hidden="true" />} title={t('events.levels.warn')} value={warnCount.toLocaleString()} tone="amber" />
        <SummaryCard icon={<Siren className="h-4 w-4" aria-hidden="true" />} title={t('events.levels.error')} value={errorCount.toLocaleString()} tone="rose" />
      </div>

      <Card
        data-testid="events-filters-card"
        className="overflow-hidden rounded-[1.25rem] border border-white/70 bg-card/95 shadow-[0_20px_50px_-42px_rgba(15,23,42,0.24)]"
      >
        <CardContent className="space-y-3 p-4">
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  <Filter className="h-4 w-4 text-primary" aria-hidden="true" />
                  {t('events.filters.title')}
                  <Badge variant="outline">{events.length}</Badge>
                </div>
                <p className="text-xs text-muted-foreground">{t('events.description')}</p>
              </div>
              <div className="grid gap-2 sm:flex sm:flex-wrap sm:items-center">
                {activeFilters.length > 0 ? (
                  <Button variant="ghost" size="sm" onClick={handleResetFilters} className="h-8 rounded-full px-3 text-xs sm:w-auto">
                    {t('common.actions.reset')}
                  </Button>
                ) : null}
                <Button variant="outline" size="sm" disabled={!cursor} onClick={() => setCursor(null)} className="h-8 rounded-full px-3 text-xs sm:w-auto">
                  <ChevronLeft className="mr-1 h-4 w-4" aria-hidden="true" />
                  {t('events.actions.newest')}
                </Button>
                <Button variant="outline" size="sm" disabled={!nextCursor} onClick={() => setCursor(nextCursor)} className="h-8 rounded-full px-3 text-xs sm:w-auto">
                  {t('events.actions.older')}
                  <ChevronRight className="ml-1 h-4 w-4" aria-hidden="true" />
                </Button>
              </div>
            </div>

            <div className="flex flex-col gap-2 md:flex-row md:flex-wrap md:items-center">
              <Select
                value={filters.level}
                onValueChange={(value) => {
                  setCursor(null)
                  setFilters((prev) => ({ ...prev, level: value === 'all' ? '' : value }))
                }}
              >
                <SelectTrigger className="w-full md:w-[160px]">
                  <SelectValue placeholder={t('events.filters.allLevels')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('events.filters.allLevels')}</SelectItem>
                  <SelectItem value="info">{t('events.levels.info')}</SelectItem>
                  <SelectItem value="warn">{t('events.levels.warn')}</SelectItem>
                  <SelectItem value="error">{t('events.levels.error')}</SelectItem>
                </SelectContent>
              </Select>
              <Input
                className="w-full md:w-[220px]"
                placeholder={t('events.filters.typePlaceholder')}
                value={filters.type}
                onChange={(event) => {
                  setCursor(null)
                  setFilters((prev) => ({ ...prev, type: event.target.value }))
                }}
              />
              <Button variant="ghost" size="sm" onClick={handleResetFilters} disabled={activeFilters.length === 0} className="h-8 rounded-full px-3 text-xs md:w-auto">
                {t('common.actions.reset')}
              </Button>
            </div>

            {activeFilters.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {activeFilters.map((item) => (
                  <Badge key={item} variant="secondary">{item}</Badge>
                ))}
              </div>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <PageSection
        title={t('events.title')}
        description={cursor ? t('events.actions.older') : t('events.actions.newest')}
      >
        {isLoading ? (
          <PageLoadingState label={t('common.loading')} />
        ) : eventsQuery.isError ? (
          <PageState
            icon={<AlertTriangle className="h-5 w-5" aria-hidden="true" />}
            tone="danger"
            title={t('common.status.error')}
            description={t('events.toast.loadFailure', { message: eventsQuery.error?.message ?? t('common.unknownError') })}
            action={(
              <Button variant="outline" size="sm" onClick={() => void eventsQuery.refetch()}>
                {t('common.actions.refresh')}
              </Button>
            )}
          />
        ) : events.length === 0 ? (
          <PageState
            icon={<ShieldAlert className="h-5 w-5" aria-hidden="true" />}
            tone="primary"
            title={activeFilters.length > 0 ? t('events.empty.filteredTitle') : t('events.empty.title')}
            description={activeFilters.length > 0 ? t('events.empty.filteredSubtitle') : t('events.empty.subtitle')}
            action={
              <div className="flex flex-wrap items-center justify-center gap-2">
                {activeFilters.length > 0 ? (
                  <Button variant="outline" size="sm" onClick={handleResetFilters}>
                    {t('common.actions.reset')}
                  </Button>
                ) : null}
                <Button asChild variant="ghost" size="sm">
                  <Link to="/logs">{t('events.empty.actions.logs')}</Link>
                </Button>
              </div>
            }
          />
        ) : (
          <div className="grid gap-3">
            {events.map((event) => (
              <EventCard key={event.id} event={event} />
            ))}
          </div>
        )}
      </PageSection>
    </div>
  )
}

function SummaryCard({
  icon,
  title,
  tone,
  value
}: {
  icon: ReactNode
  title: string
  tone: 'emerald' | 'amber' | 'rose'
  value: string
}) {
  return (
      <Card className="rounded-[1.15rem] border border-white/70 bg-card/95 shadow-[0_18px_42px_-38px_rgba(15,23,42,0.22)]">
      <CardContent className="flex items-center justify-between gap-3 p-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{title}</p>
          <p className="metric-number mt-1 text-[1.85rem] font-bold tracking-tight text-foreground">{value}</p>
        </div>
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-secondary text-muted-foreground">{icon}</div>
      </CardContent>
    </Card>
  )
}

function EventCard({ event }: { event: GatewayEvent }) {
  const { t } = useTranslation()

  const borderClass =
    event.level === 'error'
      ? 'border-l-destructive'
      : event.level === 'warn'
        ? 'border-l-amber-500'
        : 'border-l-emerald-500'

  return (
    <Card
      className={cn('overflow-hidden rounded-[1.05rem] border border-white/70 border-l-2 bg-card/96 shadow-[0_18px_38px_-34px_rgba(15,23,42,0.2)]', borderClass)}
    >
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={LEVEL_VARIANT[event.level] || 'secondary'} className="rounded-full text-[10px]">
                {t(`events.levels.${event.level}` as const)}
              </Badge>
              <Badge variant="outline" className="rounded-full text-[10px]">#{event.id}</Badge>
              {event.mode ? <Badge variant="secondary" className="rounded-full text-[10px]">{event.mode}</Badge> : null}
              {event.endpoint ? <Badge variant="outline" className="rounded-full text-[10px]">{event.endpoint}</Badge> : null}
            </div>
            <div className="min-w-0">
              <h3 className="truncate text-[15px] font-semibold tracking-[-0.01em]">{event.title || t('events.defaultTitle')}</h3>
              <p className="mt-1 line-clamp-2 text-sm leading-5 text-muted-foreground">{event.message || t('events.defaultMessage')}</p>
            </div>
          </div>
          <div className="shrink-0 space-y-0.5 text-xs text-muted-foreground lg:text-right">
            <p>{formatTimestamp(event.createdAt)}</p>
            <p>{formatRelativeTime(event.createdAt)}</p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 text-sm">
          <EventMeta label="Type" value={event.type} />
          <EventMeta label="Source" value={event.source} />
          <EventMeta label="IP" value={event.ipAddress} />
          <EventMeta label="API Key" value={event.apiKeyName} />
          <EventMeta label="User Agent" value={event.userAgent} />
        </div>

        {event.details ? (
          <details className="rounded-[0.9rem] bg-secondary/50 px-3 py-2 text-sm">
            <summary className="cursor-pointer text-xs font-medium text-primary">{t('events.details')}</summary>
            <pre className="mt-2.5 overflow-x-auto rounded-lg bg-secondary p-3 text-xs leading-6">
              {JSON.stringify(event.details, null, 2)}
            </pre>
          </details>
        ) : null}
      </CardContent>
    </Card>
  )
}

function EventMeta({ label, value }: { label: string; value: string | null }) {
  if (!value) {
    return null
  }

  return (
    <div className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-border/60 bg-secondary/55 px-2.5 py-1 text-[11px] text-muted-foreground">
      <span className="font-medium">{label}:</span>
      <span className="truncate text-foreground" title={value}>{value}</span>
    </div>
  )
}
