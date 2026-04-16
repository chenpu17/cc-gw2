import { Download, RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import {
  DEFAULT_VISIBLE_COLUMNS,
  type LogColumnId,
  type RowDensity
} from './shared'

interface LogsPageActionsProps {
  columnOptions: Array<{ id: LogColumnId; label: string }>
  exporting: boolean
  onExport: () => void
  onRefresh: () => void
  onResetColumns: () => void
  onSetDensity: (density: RowDensity) => void
  onToggleColumn: (column: LogColumnId) => void
  refreshing: boolean
  rowDensity: RowDensity
  total: number
  visibleColumns: LogColumnId[]
  visibleColumnSet: ReadonlySet<LogColumnId>
}

export function LogsPageActions({
  columnOptions,
  exporting,
  onExport,
  onRefresh,
  onResetColumns,
  onSetDensity,
  onToggleColumn,
  refreshing,
  rowDensity,
  total,
  visibleColumns,
  visibleColumnSet
}: LogsPageActionsProps) {
  const { t } = useTranslation()
  const isDefaultColumns = JSON.stringify(visibleColumns) === JSON.stringify(DEFAULT_VISIBLE_COLUMNS)

  return (
    <div className="flex w-full flex-col gap-3 xl:w-auto xl:flex-row xl:items-center">
      <div className="flex w-full flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center xl:w-auto xl:flex-nowrap">
        <div className="flex w-full items-center gap-1 overflow-x-auto rounded-full bg-secondary p-1 sm:w-auto">
          <button
            type="button"
            onClick={() => onSetDensity('comfortable')}
            className={cn(
              'inline-flex h-8 flex-1 items-center justify-center whitespace-nowrap rounded-full px-3.5 text-xs font-medium transition-all sm:flex-none',
              rowDensity === 'comfortable'
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-accent hover:text-foreground'
            )}
          >
            {t('logs.table.density.comfortable')}
          </button>
          <button
            type="button"
            onClick={() => onSetDensity('compact')}
            className={cn(
              'inline-flex h-8 flex-1 items-center justify-center whitespace-nowrap rounded-full px-3.5 text-xs font-medium transition-all sm:flex-none',
              rowDensity === 'compact'
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-accent hover:text-foreground'
            )}
          >
            {t('logs.table.density.compact')}
          </button>
        </div>

        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="w-full sm:w-auto">
              {t('logs.actions.columns')}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-64 p-3">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold">{t('logs.actions.columns')}</p>
                <p className="text-xs text-muted-foreground">
                  {t('logs.actions.visibleCount', { count: visibleColumns.length })}
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={onResetColumns}
                disabled={isDefaultColumns}
              >
                {t('common.actions.reset')}
              </Button>
            </div>
            <div className="grid gap-1.5">
              {columnOptions.map((column) => {
                const checked = visibleColumnSet.has(column.id)
                return (
                  <label
                    key={column.id}
                    className={cn(
                      'flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2 text-sm transition hover:bg-accent',
                      checked && 'bg-primary/10 text-primary'
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => onToggleColumn(column.id)}
                      className="h-4 w-4 rounded border-border"
                    />
                    <span>{column.label}</span>
                  </label>
                )
              })}
            </div>
          </PopoverContent>
        </Popover>

        <Button onClick={onExport} disabled={exporting} className="w-full sm:w-auto">
          <Download className="mr-2 h-4 w-4" />
          {exporting ? t('logs.actions.exporting') : t('logs.actions.export')}
        </Button>
      </div>

      <div className="flex w-full items-center justify-between gap-3 xl:w-auto xl:justify-start">
        <span className="text-xs text-muted-foreground sm:text-sm">
          {t('logs.summary.total', { value: total.toLocaleString() })}
        </span>
        <Button variant="outline" size="sm" onClick={onRefresh} disabled={refreshing} className="shrink-0">
          <RefreshCw className={cn('mr-2 h-4 w-4', refreshing && 'animate-spin')} />
          {refreshing ? t('common.actions.refreshing') : t('logs.actions.manualRefresh')}
        </Button>
      </div>
    </div>
  )
}
