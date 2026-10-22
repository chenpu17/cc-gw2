import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, ChevronLeft, ChevronRight, ShieldAlert } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { AnimatePresence, motion } from 'framer-motion'
import { PageToolbar } from '@/components/PageToolbar'
import { PageLoadingState, PageState } from '@/components/PageState'
import { useApiQuery } from '@/hooks/useApiQuery'
import { useEventStream } from '@/hooks/useEventStream'
import { cn } from '@/lib/utils'
import { useToast } from '@/providers/ToastProvider'
import type { ApiError } from '@/services/api'
import { queryKeys } from '@/services/queryKeys'
import type { EventStats, EventsResponse, GatewayEvent } from '@/types/events'
import { formatRelativeTime, formatTimestamp } from '@/utils/date'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Disclosure } from '@/components/ui/disclosure'
import { SegmentedControl } from '@/components/ui/segmented-control'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'

type LevelFilter = '' | 'info' | 'warn' | 'error'

const LEVEL_VARIANT: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  info: 'secondary',
  warn: 'outline',
  error: 'destructive'
}

export default function EventsPage() {
  const { t } = useTranslation()
  const { pushToast } = useToast()
  const [cursor, setCursor] = useState<number | null>(null)
  const [level, setLevel] = useState<LevelFilter>('')
  const [type, setType] = useState('')

  const queryParams = useMemo(
    () => ({
      limit: 50,
      cursor: cursor ?? undefined,
      level: level || undefined,
      type: type || undefined
    }),
    [cursor, level, type]
  )

  const eventsQuery = useApiQuery<EventsResponse, ApiError>(
    queryKeys.events.list(queryParams),
    {
      url: '/api/events',
      method: 'GET',
      params: queryParams
    }
  )

  // Header stat cards use true all-time totals (not the loaded 50-event window).
  // Polled so the counts drift upward as the live stream delivers new events.
  const statsQuery = useApiQuery<EventStats, ApiError>(
    queryKeys.events.stats(),
    { url: '/api/events/stats', method: 'GET' },
    { refetchInterval: 15_000 }
  )
  const errorTotal = statsQuery.data?.error ?? 0
  const warnTotal = statsQuery.data?.warn ?? 0
  const infoTotal = statsQuery.data?.info ?? 0
  const eventsTotal = statsQuery.data?.total ?? 0

  // Live stream: only meaningful on the newest page (no cursor); events
  // arriving via SSE are prepended onto the REST snapshot, deduped by id.
  const live = useEventStream({
    level: level || undefined,
    type: type || undefined,
    maxEvents: 50,
    enabled: cursor === null
  })

  const eventsErrorShownRef = useRef(false)
  useEffect(() => {
    const isError = eventsQuery.isError
    if (isError && eventsQuery.error && !eventsErrorShownRef.current) {
      // Fire once per error streak; both queries poll, so without dedup a down
      // backend would push a toast on every refetch tick.
      eventsErrorShownRef.current = true
      pushToast({
        title: t('events.toast.loadFailure', { message: eventsQuery.error.message }),
        variant: 'error'
      })
    }
    if (!isError) {
      eventsErrorShownRef.current = false
    }
  }, [eventsQuery.error, eventsQuery.isError, pushToast, t])

  const statsErrorShownRef = useRef(false)
  useEffect(() => {
    const isError = statsQuery.isError
    if (isError && statsQuery.error && !statsErrorShownRef.current) {
      statsErrorShownRef.current = true
      pushToast({
        title: t('events.toast.statsLoadFailure', { message: statsQuery.error.message }),
        variant: 'error'
      })
    }
    if (!isError) {
      statsErrorShownRef.current = false
    }
  }, [statsQuery.error, statsQuery.isError, pushToast, t])

  const handleResetFilters = () => {
    setCursor(null)
    setLevel('')
    setType('')
  }

  const snapshot = eventsQuery.data?.events ?? []
  const nextCursor = eventsQuery.data?.nextCursor ?? null
  const isLoading = eventsQuery.isLoading

  const events = useMemo(() => {
    if (cursor !== null) return snapshot
    const seen = new Set<number>()
    return [...live.events, ...snapshot]
      .filter((event) => {
        if (seen.has(event.id)) return false
        seen.add(event.id)
        return true
      })
      .slice(0, 50)
  }, [cursor, live.events, snapshot])

  // enum options for the type filter, aggregated from everything we've seen
  const typeOptions = useMemo(() => {
    const types = new Set<string>()
    snapshot.forEach((event) => types.add(event.type))
    live.events.forEach((event) => types.add(event.type))
    return Array.from(types).sort()
  }, [snapshot, live.events])

  const activeFilters = useMemo(() => {
    const items: string[] = []
    if (level) items.push(t(`events.levels.${level}` as const))
    if (type) items.push(type)
    return items
  }, [level, type, t])

  return (
    <div className="flex flex-col gap-5">
      <PageToolbar
        status={
          cursor === null ? (
            <span
              className={cn(
                'inline-flex items-center gap-1.5 text-xs font-medium',
                live.connected ? 'text-success' : live.failed ? 'text-destructive' : 'text-warning'
              )}
            >
              <span aria-hidden="true" className={cn('h-1.5 w-1.5 rounded-full', live.connected ? 'bg-success animate-live-pulse' : live.failed ? 'bg-destructive' : 'bg-warning')} />
              {live.connected ? t('events.live') : live.failed ? t('events.failed') : t('events.reconnecting')}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">{t('events.actions.older')}</span>
          )
        }
        actions={
          <div className="flex items-center gap-2">
            {!live.connected && cursor === null ? (
              <Button variant="outline" size="sm" onClick={() => void eventsQuery.refetch()}>
                {t('common.actions.refresh')}
              </Button>
            ) : null}
            {/* Same group as the logs footer pagination: bordered strip, the
                page readout between the two direction buttons. */}
            <div className="flex items-center gap-2 border border-border bg-secondary px-2 py-1.5">
              <Button variant="outline" size="sm" disabled={!cursor} onClick={() => setCursor(null)}>
                <ChevronLeft className="mr-1 h-4 w-4" aria-hidden="true" />
                {t('events.actions.newest')}
              </Button>
              {events.length > 0 ? (
                <span className="metric-number px-1 text-sm text-muted-foreground">
                  {t('events.pageCount', { count: events.length })}
                </span>
              ) : null}
              <Button variant="outline" size="sm" disabled={!nextCursor} onClick={() => setCursor(nextCursor)}>
                {t('events.actions.older')}
                <ChevronRight className="ml-1 h-4 w-4" aria-hidden="true" />
              </Button>
            </div>
          </div>
        }
      />

      <div className="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-center" data-testid="events-filters-card">
        {/* Level filter doubles as the severity readout: the all-time counts
            from /api/events/stats ride on the segments, so the page does not
            need a separate row of stat cards repeating the same four levels. */}
        <SegmentedControl<LevelFilter>
          value={level}
          onChange={(value) => {
            setCursor(null)
            setLevel(value)
          }}
          className="min-w-max overflow-x-auto"
          options={[
            { value: '', label: <LevelOption label={t('events.filters.allLevels')} count={eventsTotal} testId="events-stat-total" /> },
            { value: 'info', label: <LevelOption label={t('events.levels.info')} count={infoTotal} testId="events-stat-info" /> },
            { value: 'warn', label: <LevelOption label={t('events.levels.warn')} count={warnTotal} testId="events-stat-warn" /> },
            { value: 'error', label: <LevelOption label={t('events.levels.error')} count={errorTotal} testId="events-stat-error" /> }
          ]}
          aria-label={t('events.filters.title')}
        />
        <Select
          value={type || 'all'}
          onValueChange={(value) => {
            setCursor(null)
            setType(value === 'all' ? '' : value)
          }}
        >
          <SelectTrigger className="h-8 w-full md:w-[200px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('events.filters.allTypes')}</SelectItem>
            {typeOptions.map((option) => (
              <SelectItem key={option} value={option}>{option}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {activeFilters.length > 0 ? (
          <>
            <div className="flex flex-wrap gap-2">
              {activeFilters.map((item) => (
                <Badge key={item} variant="secondary">{item}</Badge>
              ))}
            </div>
            <Button variant="ghost" size="sm" onClick={handleResetFilters} className="h-8 px-3 text-xs">
              {t('common.actions.reset')}
            </Button>
          </>
        ) : null}
      </div>

      {/* No section wrapper: the page h1 above already names this list, and the
          toolbar status already says which page of it you are on. */}
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
          <AnimatePresence initial={false}>
            {events.map((event) => (
              <motion.div
                key={event.id}
                layout
                initial={{ opacity: 0, y: -12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.18 }}
              >
                <EventCard event={event} />
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  )
}

/**
 * Segment label for the level filter: the level name plus its all-time count.
 * The count inherits the segment's colour via opacity so it stays legible on
 * both the idle and the ink-filled active segment.
 */
function LevelOption({ label, count, testId }: { label: string; count: number; testId: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {label}
      <span className="tabular-nums opacity-60" data-testid={testId}>
        {count.toLocaleString()}
      </span>
    </span>
  )
}

function EventCard({ event }: { event: GatewayEvent }) {
  const { t } = useTranslation()

  const borderClass =
    event.level === 'error'
      ? 'border-l-error'
      : event.level === 'warn'
        ? 'border-l-warning'
        : 'border-l-success'

  return (
    <Card
      className={cn('overflow-hidden border-l-2 hover:bg-muted/30', borderClass)}
    >
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={LEVEL_VARIANT[event.level] || 'secondary'} className="text-[10px]">
                {t(`events.levels.${event.level}` as const)}
              </Badge>
              <Badge variant="outline" className="text-[10px]">#{event.id}</Badge>
              {event.mode ? <Badge variant="secondary" className="text-[10px]">{event.mode}</Badge> : null}
              {event.endpoint ? <Badge variant="outline" className="text-[10px]">{event.endpoint}</Badge> : null}
            </div>
            <div className="min-w-0">
              <h3 className="truncate text-[15px] font-semibold tracking-[-0.01em]">{event.title || t('events.defaultTitle')}</h3>
              <p className="mt-1 line-clamp-2 break-words text-sm leading-5 text-muted-foreground [overflow-wrap:anywhere]">{event.message || t('events.defaultMessage')}</p>
            </div>
          </div>
          <div className="shrink-0 space-y-0.5 text-xs text-muted-foreground lg:text-right">
            {/* Both read "now" for an event seeded moments earlier — masked so
                the baseline does not drift on every run. */}
            <p data-visual-volatile="true">{formatTimestamp(event.createdAt)}</p>
            <p data-visual-volatile="true">{formatRelativeTime(event.createdAt)}</p>
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
          <Disclosure
            summary={t('events.details')}
            className="rounded-lg bg-secondary px-3 py-2 text-sm"
            summaryClassName="px-0 py-0 text-xs font-medium text-foreground underline decoration-muted-foreground/40 underline-offset-2 hover:decoration-foreground"
            contentClassName="mt-2.5"
          >
            <pre className="overflow-x-auto rounded-lg bg-secondary p-3 text-xs leading-6">
              {JSON.stringify(event.details, null, 2)}
            </pre>
          </Disclosure>
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
    <div className="inline-flex max-w-full items-center gap-1.5 border border-border/60 bg-secondary/55 px-2.5 py-1 text-[11px] text-muted-foreground">
      <span className="font-medium">{label}:</span>
      <span className="truncate text-foreground" title={value}>{value}</span>
    </div>
  )
}
