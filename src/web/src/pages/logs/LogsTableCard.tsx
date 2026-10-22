import type { Dispatch, RefObject, SetStateAction } from 'react'
import { AlertTriangle, ChevronLeft, ChevronRight, FileText } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import type { ApiKeySummary } from '@/types/apiKeys'
import type { LogRecord } from '@/types/logs'
import { PageState } from '@/components/PageState'
import { Skeleton, TableRowSkeleton } from '@/components/Skeleton'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { LogCard } from './LogCard'
import { LogRow } from './LogRow'
import { PAGE_SIZE_OPTIONS, type LogColumnId, type RowDensity } from './shared'

/** Shared header-cell metrics; each `th` appends its own alignment. */
const TH = 'whitespace-nowrap px-1.5 py-2.5 text-xs font-semibold text-muted-foreground'

interface LogsTableCardProps {
  tableScrollRef: RefObject<HTMLDivElement>
  visibleColumnSet: ReadonlySet<LogColumnId>
  visibleColumnCount: number
  /** Columns dropped by the width-driven responsive pass. */
  autoHiddenColumns: LogColumnId[]
  logsError?: string | null
  logsPending: boolean
  items: LogRecord[]
  /** Display currency for the cost column (billing, v0.16). */
  costCurrency?: string
  activeFiltersCount: number
  total: number
  handleResetFilters: () => void
  handleRetry: () => void
  providerLabelMap: Map<string, string>
  apiKeyMap: Map<number, ApiKeySummary>
  handleOpenDetail: (id: number) => void
  expandedLogId: number | null
  onToggleExpand: (id: number) => void
  rowDensity: RowDensity
  showScrollHint: boolean
  pageSize: number
  setPageSize: (value: number) => void
  page: number
  totalPages: number
  setPage: Dispatch<SetStateAction<number>>
}

export function LogsTableCard(props: LogsTableCardProps) {
  const { t } = useTranslation()
  const {
    tableScrollRef,
    visibleColumnSet,
    visibleColumnCount,
    autoHiddenColumns,
    logsError,
    logsPending,
    items,
    costCurrency,
    activeFiltersCount,
    total,
    handleResetFilters,
    handleRetry,
    providerLabelMap,
    apiKeyMap,
    handleOpenDetail,
    expandedLogId,
    onToggleExpand,
    rowDensity,
    showScrollHint,
    pageSize,
    setPageSize,
    page,
    totalPages,
    setPage
  } = props

  const errorState = (
    <PageState
      compact
      tone="danger"
      icon={<AlertTriangle className="h-5 w-5" aria-hidden="true" />}
      title={t('logs.toast.listError.title')}
      description={logsError}
      action={(
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button variant="outline" size="sm" onClick={handleRetry}>
            {t('common.actions.refresh')}
          </Button>
          {activeFiltersCount > 0 ? (
            <Button variant="ghost" size="sm" onClick={handleResetFilters}>
              {t('common.actions.reset')}
            </Button>
          ) : null}
        </div>
      )}
    />
  )

  const emptyState = (
    <PageState
      compact
      tone="primary"
      icon={<FileText className="h-5 w-5" aria-hidden="true" />}
      title={activeFiltersCount > 0 ? t('logs.empty.filteredTitle') : t('logs.empty.title')}
      description={activeFiltersCount > 0 ? t('logs.empty.filteredSubtitle') : t('logs.empty.subtitle')}
      action={(
        <div className="flex flex-wrap items-center justify-center gap-2">
          {activeFiltersCount > 0 ? (
            <Button variant="outline" size="sm" onClick={handleResetFilters}>
              {t('logs.empty.actions.reset')}
            </Button>
          ) : null}
          <Button asChild variant="ghost" size="sm">
            <Link to="/api-keys">{t('logs.empty.actions.apiKeys')}</Link>
          </Button>
        </div>
      )}
    />
  )

  return (
    <Card variant="solid" className="overflow-hidden bg-card shadow-[var(--surface-shadow)]">
      <CardContent className="p-0">
        <div className="flex flex-wrap items-center justify-between gap-3 bg-secondary/50 px-4 py-3 border-b border-border">
          <div className="space-y-1">
            <p className="text-sm font-semibold">{t('logs.title')}</p>
            <p className="text-xs text-muted-foreground">
              <span className="metric-number">{t('logs.summary.total', { value: total.toLocaleString() })}</span>
              <span className="mx-1.5 text-muted-foreground/50">·</span>
              {t('logs.table.visibleColumns', { count: visibleColumnCount })}
            </p>
          </div>
          {autoHiddenColumns.length > 0 || showScrollHint ? (
            <div className="hidden items-center gap-2 md:flex">
              {autoHiddenColumns.length > 0 ? (
                <Badge
                  variant="outline"
                  className="bg-background text-muted-foreground"
                  title={t('logs.table.autoHiddenHint', {
                    columns: autoHiddenColumns.map((id) => t(`logs.table.columns.${id}`)).join(' · ')
                  })}
                >
                  {t('logs.table.autoHiddenColumns', { count: autoHiddenColumns.length })}
                </Badge>
              ) : null}
              <Badge variant="outline" className="bg-background text-muted-foreground">
                {rowDensity === 'compact' ? t('logs.table.density.compact') : t('logs.table.density.comfortable')}
              </Badge>
            </div>
          ) : null}
        </div>
        <div className="relative hidden md:block">
          <div ref={tableScrollRef} className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border/50 bg-secondary/50">
                <tr>
                  {/* No `uppercase`: these headers are Chinese in zh and Title
                      Case in en, so forcing caps only mangled the ASCII half
                      of a mixed-language row (PROVIDER next to 端点). */}
                  <th className={cn(TH, 'sticky left-0 z-20 bg-secondary text-left')}>
                    {t('logs.table.columns.time')}
                  </th>
                  {visibleColumnSet.has('endpoint') && <th className={cn(TH, 'text-left')}>{t('logs.table.columns.endpoint')}</th>}
                  {visibleColumnSet.has('provider') && <th className={cn(TH, 'text-left')}>{t('logs.table.columns.provider')}</th>}
                  {visibleColumnSet.has('client') && <th className={cn(TH, 'text-left')}>{t('logs.table.columns.client')}</th>}
                  {visibleColumnSet.has('requestedModel') && <th className={cn(TH, 'text-left')}>{t('logs.table.columns.requestedModel')}</th>}
                  {visibleColumnSet.has('routedModel') && <th className={cn(TH, 'text-left')}>{t('logs.table.columns.routedModel')}</th>}
                  {visibleColumnSet.has('apiKey') && <th className={cn(TH, 'text-left')}>{t('logs.table.columns.apiKey')}</th>}
                  {visibleColumnSet.has('tokens') && <th className={cn(TH, 'text-right')} title={t('logs.table.tokensHeaderHint')}>{t('logs.table.columns.tokens')}</th>}
                  {visibleColumnSet.has('cost') && <th className={cn(TH, 'text-right')}>{t('logs.table.columns.cost')}</th>}
                  {visibleColumnSet.has('duration') && <th className={cn(TH, 'text-right')} title={t('logs.table.durationHeaderHint')}>{t('logs.table.columns.duration')}</th>}
                  {visibleColumnSet.has('status') && <th className={cn(TH, 'text-center')}>{t('logs.table.columns.status')}</th>}
                  {visibleColumnSet.has('error') && <th className={cn(TH, 'text-left')}>{t('logs.table.columns.error')}</th>}
                  <th className={cn(TH, 'sticky right-0 z-20 bg-secondary text-center')}>
                    {t('logs.table.columns.actions')}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {logsPending ? (
                  Array.from({ length: 8 }).map((_, i) => (
                    <TableRowSkeleton key={i} columns={visibleColumnCount} />
                  ))
                ) : logsError && items.length === 0 ? (
                  <tr>
                    <td colSpan={visibleColumnCount} className="px-3 py-6">
                      {errorState}
                    </td>
                  </tr>
                ) : items.length === 0 ? (
                  <tr>
                    <td colSpan={visibleColumnCount} className="px-3 py-8 text-center text-sm text-muted-foreground">
                      {emptyState}
                    </td>
                  </tr>
                ) : (
                  items.map((item, index) => (
                    <LogRow
                      key={item.id}
                      record={item}
                      providerLabelMap={providerLabelMap}
                      apiKeyMap={apiKeyMap}
                      onSelect={handleOpenDetail}
                      isExpanded={item.id === expandedLogId}
                      onToggleExpand={onToggleExpand}
                      isEven={index % 2 === 0}
                      density={rowDensity}
                      visibleColumnSet={visibleColumnSet}
                      costCurrency={costCurrency}
                    />
                  ))
                )}
              </tbody>
            </table>
          </div>
          {showScrollHint && <div className="table-scroll-hint" />}
        </div>
        <div className="md:hidden">
          {logsPending ? (
            <div className="space-y-3 p-4">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-20 w-full" />
              ))}
            </div>
          ) : logsError && items.length === 0 ? (
            <div className="px-3 py-6">{errorState}</div>
          ) : items.length === 0 ? (
            <div className="px-3 py-8">{emptyState}</div>
          ) : (
            items.map((item) => (
              <LogCard
                key={item.id}
                record={item}
                providerLabelMap={providerLabelMap}
                onSelect={handleOpenDetail}
                costCurrency={costCurrency}
              />
            ))
          )}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-4 bg-secondary/50 p-4 border-t border-border">
          <div className="flex items-center gap-2 border border-border bg-secondary px-3 py-1.5">
            <span className="text-sm text-muted-foreground">{t('logs.table.pagination.perPage')}</span>
            <Select value={pageSize.toString()} onValueChange={(v) => setPageSize(Number(v))}>
              <SelectTrigger className="h-8 w-[80px] bg-background">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAGE_SIZE_OPTIONS.map((size) => (
                  <SelectItem key={size} value={size.toString()}>
                    {size}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2 border border-border bg-secondary px-2 py-1.5">
            <Button variant="outline" size="sm" onClick={() => setPage((prev) => Math.max(prev - 1, 1))} disabled={page <= 1}>
              <ChevronLeft className="mr-1 h-4 w-4" aria-hidden="true" />
              {t('logs.table.pagination.previous')}
            </Button>
            <span className="metric-number px-1 text-sm text-muted-foreground">
              {t('logs.table.pagination.pageLabel', {
                page: totalPages === 0 ? 0 : page,
                total: totalPages
              })}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((prev) => (totalPages === 0 ? prev : Math.min(prev + 1, totalPages)))}
              disabled={totalPages === 0 || page >= totalPages}
            >
              {t('logs.table.pagination.next')}
              <ChevronRight className="ml-1 h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
