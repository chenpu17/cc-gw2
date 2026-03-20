import type { Dispatch, RefObject, SetStateAction } from 'react'
import { AlertTriangle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ApiKeySummary } from '@/types/apiKeys'
import type { LogRecord } from '@/types/logs'
import { PageState } from '@/components/PageState'
import { TableRowSkeleton } from '@/components/Skeleton'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { LogRow } from './LogRow'
import { PAGE_SIZE_OPTIONS, type LogColumnId, type RowDensity } from './shared'

interface LogsTableCardProps {
  tableScrollRef: RefObject<HTMLDivElement>
  visibleColumnSet: ReadonlySet<LogColumnId>
  visibleColumnCount: number
  logsError?: string | null
  logsPending: boolean
  items: LogRecord[]
  activeFiltersCount: number
  handleResetFilters: () => void
  handleRetry: () => void
  providerLabelMap: Map<string, string>
  apiKeyMap: Map<number, ApiKeySummary>
  handleOpenDetail: (id: number) => void
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
    logsError,
    logsPending,
    items,
    activeFiltersCount,
    handleResetFilters,
    handleRetry,
    providerLabelMap,
    apiKeyMap,
    handleOpenDetail,
    rowDensity,
    showScrollHint,
    pageSize,
    setPageSize,
    page,
    totalPages,
    setPage
  } = props

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-0">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-secondary px-4 py-3">
          <div className="space-y-1">
            <p className="text-sm font-semibold">{t('logs.title')}</p>
            <p className="text-xs text-muted-foreground">
              {t('logs.actions.visibleCount', { count: visibleColumnCount - 2 })}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">Wide Table</Badge>
            <Badge variant="outline">{rowDensity === 'compact' ? t('logs.table.density.compact') : t('logs.table.density.comfortable')}</Badge>
            {showScrollHint ? (
              <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300">Scroll for more</Badge>
            ) : null}
          </div>
        </div>
        <div className="relative">
          <div ref={tableScrollRef} className="overflow-x-auto">
            <table className="w-full min-w-[1480px] text-sm">
              <thead className="border-b bg-muted/50">
                <tr>
                  <th className="sticky left-0 z-20 bg-muted/95 px-3 py-2 text-left text-xs font-medium backdrop-blur">
                    {t('logs.table.columns.time')}
                  </th>
                  {visibleColumnSet.has('endpoint') && <th className="px-3 py-2 text-left text-xs font-medium">{t('logs.table.columns.endpoint')}</th>}
                  {visibleColumnSet.has('provider') && <th className="px-3 py-2 text-left text-xs font-medium">{t('logs.table.columns.provider')}</th>}
                  {visibleColumnSet.has('requestedModel') && <th className="px-3 py-2 text-left text-xs font-medium">{t('logs.table.columns.requestedModel')}</th>}
                  {visibleColumnSet.has('routedModel') && <th className="px-3 py-2 text-left text-xs font-medium">{t('logs.table.columns.routedModel')}</th>}
                  {visibleColumnSet.has('apiKey') && <th className="px-3 py-2 text-left text-xs font-medium">{t('logs.table.columns.apiKey')}</th>}
                  {visibleColumnSet.has('inputTokens') && <th className="px-3 py-2 text-right text-xs font-medium">{t('logs.table.columns.inputTokens')}</th>}
                  {visibleColumnSet.has('cacheReadTokens') && <th className="px-3 py-2 text-right text-xs font-medium">{t('logs.table.columns.cacheReadTokens')}</th>}
                  {visibleColumnSet.has('cacheCreationTokens') && <th className="px-3 py-2 text-right text-xs font-medium">{t('logs.table.columns.cacheCreationTokens')}</th>}
                  {visibleColumnSet.has('outputTokens') && <th className="px-3 py-2 text-right text-xs font-medium">{t('logs.table.columns.outputTokens')}</th>}
                  {visibleColumnSet.has('latency') && <th className="px-3 py-2 text-right text-xs font-medium">{t('logs.table.columns.latency')}</th>}
                  {visibleColumnSet.has('ttft') && <th className="px-3 py-2 text-right text-xs font-medium">{t('logs.table.columns.ttft')}</th>}
                  {visibleColumnSet.has('tpot') && <th className="px-3 py-2 text-right text-xs font-medium">{t('logs.table.columns.tpot')}</th>}
                  {visibleColumnSet.has('status') && <th className="px-3 py-2 text-center text-xs font-medium">{t('logs.table.columns.status')}</th>}
                  {visibleColumnSet.has('error') && <th className="px-3 py-2 text-left text-xs font-medium">{t('logs.table.columns.error')}</th>}
                  <th className="sticky right-0 z-20 bg-muted/95 px-3 py-2 text-center text-xs font-medium backdrop-blur">
                    {t('logs.table.columns.actions')}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {logsPending ? (
                  Array.from({ length: 8 }).map((_, i) => (
                    <TableRowSkeleton key={i} columns={visibleColumnCount} />
                  ))
                ) : logsError && items.length === 0 ? (
                  <tr>
                    <td colSpan={visibleColumnCount} className="px-3 py-6">
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
                    </td>
                  </tr>
                ) : items.length === 0 ? (
                  <tr>
                    <td colSpan={visibleColumnCount} className="px-3 py-8 text-center text-sm text-muted-foreground">
                      <div className="flex flex-col items-center gap-3 py-4">
                        <span>{t('logs.table.empty')}</span>
                        {activeFiltersCount > 0 && (
                          <Button variant="outline" size="sm" onClick={handleResetFilters}>
                            {t('common.actions.reset')}
                          </Button>
                        )}
                      </div>
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
                      isEven={index % 2 === 0}
                      density={rowDensity}
                      visibleColumnSet={visibleColumnSet}
                    />
                  ))
                )}
              </tbody>
            </table>
          </div>
          {showScrollHint && <div className="table-scroll-hint" />}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-4 border-t p-4">
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">{t('logs.table.pagination.perPage')}</span>
            <Select value={pageSize.toString()} onValueChange={(v) => setPageSize(Number(v))}>
              <SelectTrigger className="w-[80px]">
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
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setPage((prev) => Math.max(prev - 1, 1))} disabled={page <= 1}>
              {t('logs.table.pagination.previous')}
            </Button>
            <span className="text-sm text-muted-foreground">
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
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
