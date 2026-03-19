import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { AlertTriangle, ChevronLeft, ChevronRight, Filter, RefreshCw, ShieldAlert, Siren, ShieldCheck } from 'lucide-react'
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
    <div className="flex flex-col gap-6">
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
            <div className="rounded-2xl border border-border/70 bg-background/80 px-3 py-2 text-xs text-muted-foreground">
              {cursor ? t('events.actions.older') : t('events.actions.newest')}
            </div>
            <Button variant="outline" size="sm" onClick={() => void eventsQuery.refetch()} disabled={isRefreshing} className="w-full sm:w-auto">
              <RefreshCw className={cn('mr-2 h-4 w-4', isRefreshing && 'animate-spin')} aria-hidden="true" />
              {isRefreshing ? t('common.actions.refreshing') : t('common.actions.refresh')}
            </Button>
          </div>
        }
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <SummaryCard icon={<ShieldCheck className="h-4 w-4" aria-hidden="true" />} title={t('events.levels.info')} value={infoCount.toLocaleString()} tone="emerald" />
        <SummaryCard icon={<AlertTriangle className="h-4 w-4" aria-hidden="true" />} title={t('events.levels.warn')} value={warnCount.toLocaleString()} tone="amber" />
        <SummaryCard icon={<Siren className="h-4 w-4" aria-hidden="true" />} title={t('events.levels.error')} value={errorCount.toLocaleString()} tone="rose" />
      </div>

      <Card className="sticky top-20 z-20 border-[rgba(24,16,13,0.08)] bg-[linear-gradient(135deg,rgba(255,255,255,0.96),rgba(252,249,245,0.9))] shadow-[0_18px_44px_-34px_rgba(17,12,11,0.22)]">
        <CardContent className="pt-5">
          <div className="flex flex-col gap-4">
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
                  <Button variant="ghost" size="sm" onClick={handleResetFilters} className="w-full sm:w-auto">
                    {t('common.actions.reset')}
                  </Button>
                ) : null}
                <Button variant="outline" size="sm" disabled={!cursor} onClick={() => setCursor(null)} className="w-full sm:w-auto">
                  <ChevronLeft className="mr-1 h-4 w-4" aria-hidden="true" />
                  {t('events.actions.newest')}
                </Button>
                <Button variant="outline" size="sm" disabled={!nextCursor} onClick={() => setCursor(nextCursor)} className="w-full sm:w-auto">
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
              <Button variant="ghost" size="sm" onClick={handleResetFilters} disabled={activeFilters.length === 0} className="w-full md:w-auto">
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
        actions={
          events.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950/30 dark:text-blue-300">
                {t('events.levels.info')}: {infoCount}
              </Badge>
              <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
                {t('events.levels.warn')}: {warnCount}
              </Badge>
              <Badge variant="outline" className="border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-800 dark:bg-rose-950/30 dark:text-rose-300">
                {t('events.levels.error')}: {errorCount}
              </Badge>
            </div>
          ) : null
        }
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
            title={t('events.empty.title')}
            description={t('events.empty.subtitle')}
            action={
              activeFilters.length > 0 ? (
                <Button variant="outline" size="sm" onClick={handleResetFilters}>
                  {t('common.actions.reset')}
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div className="grid gap-4">
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
  const toneClass = {
    emerald: 'bg-[linear-gradient(135deg,rgba(5,150,105,0.14),rgba(16,185,129,0.05),rgba(255,255,255,0.92))] text-emerald-700 dark:text-emerald-300',
    amber: 'bg-[linear-gradient(135deg,rgba(234,88,12,0.14),rgba(245,158,11,0.05),rgba(255,255,255,0.92))] text-amber-700 dark:text-amber-300',
    rose: 'bg-[linear-gradient(135deg,rgba(225,29,72,0.14),rgba(244,63,94,0.05),rgba(255,255,255,0.92))] text-rose-700 dark:text-rose-300'
  }[tone]

  return (
    <Card className={cn('overflow-hidden border-white/55 shadow-[0_1px_2px_rgba(15,23,42,0.04)]', toneClass)}>
      <CardContent className="flex items-center justify-between gap-3 pt-5">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">{title}</p>
          <p className="mt-2 text-3xl font-bold tracking-tight text-slate-950 dark:text-slate-50">{value}</p>
        </div>
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/70">{icon}</div>
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
    <Card className={cn('overflow-hidden border-l-4 border-white/55 bg-[linear-gradient(135deg,rgba(255,255,255,0.94),rgba(248,250,252,0.84))]', borderClass)}>
      <CardContent className="space-y-4 pt-5">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={LEVEL_VARIANT[event.level] || 'secondary'}>
                {t(`events.levels.${event.level}` as const)}
              </Badge>
              <Badge variant="outline">#{event.id}</Badge>
              {event.mode ? <Badge variant="secondary">{event.mode}</Badge> : null}
              {event.endpoint ? <Badge variant="outline">{event.endpoint}</Badge> : null}
            </div>
            <div>
              <h3 className="text-base font-semibold tracking-[-0.01em]">{event.title || t('events.defaultTitle')}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{event.message || t('events.defaultMessage')}</p>
            </div>
          </div>
          <div className="space-y-1 text-sm text-muted-foreground xl:text-right">
            <p>{formatTimestamp(event.createdAt)}</p>
            <p>{formatRelativeTime(event.createdAt)}</p>
          </div>
        </div>

        <div className="grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-4">
          <EventMeta label="Type" value={event.type} />
          <EventMeta label="Source" value={event.source} />
          <EventMeta label="IP" value={event.ipAddress} />
          <EventMeta label="API Key" value={event.apiKeyName} />
          <EventMeta label="User Agent" value={event.userAgent} wide />
        </div>

        {event.details ? (
          <details className="rounded-[1rem] border border-border/70 bg-background/65 p-3 text-sm">
            <summary className="cursor-pointer text-sm font-medium text-primary">{t('events.details')}</summary>
            <pre className="mt-3 overflow-x-auto rounded-[1rem] border border-border/70 bg-background/85 p-3 text-xs leading-6">
              {JSON.stringify(event.details, null, 2)}
            </pre>
          </details>
        ) : null}
      </CardContent>
    </Card>
  )
}

function EventMeta({ label, value, wide = false }: { label: string; value: string | null; wide?: boolean }) {
  if (!value) {
    return null
  }

  return (
    <div className={cn('rounded-[1rem] border border-border/60 bg-background/70 px-3 py-3', wide && 'sm:col-span-2 xl:col-span-2')}>
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{label}</p>
      <p className="mt-1 break-all text-sm text-foreground">{value}</p>
    </div>
  )
}
