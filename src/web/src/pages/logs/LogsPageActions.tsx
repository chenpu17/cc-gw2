import { Download, RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import {
  DEFAULT_VISIBLE_COLUMNS,
  type LogColumnId,
  type RowDensity
} from './shared'

interface LogsPageActionsProps {
  autoRefresh: boolean
  columnOptions: Array<{ id: LogColumnId; label: string }>
  exporting: boolean
  onExport: () => void
  onRefresh: () => void
  onResetColumns: () => void
  onSetDensity: (density: RowDensity) => void
  onToggleAutoRefresh: (enabled: boolean) => void
  onToggleColumn: (column: LogColumnId) => void
  refreshing: boolean
  rowDensity: RowDensity
  visibleColumns: LogColumnId[]
  visibleColumnSet: ReadonlySet<LogColumnId>
  /** Checked columns the narrow-window pass is currently hiding. */
  autoHiddenColumns: LogColumnId[]
}

export function LogsPageActions({
  autoRefresh,
  columnOptions,
  exporting,
  onExport,
  onRefresh,
  onResetColumns,
  onSetDensity,
  onToggleAutoRefresh,
  onToggleColumn,
  refreshing,
  rowDensity,
  visibleColumns,
  visibleColumnSet,
  autoHiddenColumns
}: LogsPageActionsProps) {
  const { t } = useTranslation()
  const isDefaultColumns = JSON.stringify(visibleColumns) === JSON.stringify(DEFAULT_VISIBLE_COLUMNS)
  const autoHiddenSet = new Set(autoHiddenColumns)

  return (
    <div className="flex w-full flex-col gap-3 xl:w-auto xl:flex-row xl:items-center">
      <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:flex-row sm:flex-wrap sm:items-center xl:w-auto xl:flex-nowrap">
        <SegmentedControl
          block
          className="col-span-2 w-full overflow-x-auto sm:w-auto"
          value={rowDensity}
          onChange={onSetDensity}
          options={[
            { value: 'comfortable', label: t('logs.table.density.comfortable') },
            { value: 'compact', label: t('logs.table.density.compact') }
          ]}
        />

        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="w-full sm:w-auto">
              {t('logs.actions.columns')}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-64 p-3">
            <div className="mb-3 flex items-center justify-between">
              {/* No "N columns visible" echo here: the checkboxes below already
                  say which ones, and the table card reports the real total. */}
              <p className="text-sm font-semibold">{t('logs.actions.columns')}</p>
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
                      checked && 'bg-secondary text-foreground'
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => onToggleColumn(column.id)}
                      className="h-4 w-4 rounded border-border"
                    />
                    <span>{column.label}</span>
                    {autoHiddenSet.has(column.id) ? (
                      <span className="ml-auto rounded-sm bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                        {t('logs.table.narrowHiddenPill')}
                      </span>
                    ) : null}
                  </label>
                )
              })}
            </div>
            <p className="mt-3 text-[11px] leading-snug text-muted-foreground">
              {t('logs.table.autoHiddenNote')}
            </p>
          </PopoverContent>
        </Popover>

        <Button variant="outline" onClick={onExport} disabled={exporting} className="w-full sm:w-auto">
          <Download className="mr-2 h-4 w-4" />
          {exporting ? t('logs.actions.exporting') : t('logs.actions.export')}
        </Button>
      </div>

      <div className="flex w-full items-center gap-3 xl:w-auto">
        <label className="flex shrink-0 cursor-pointer items-center gap-2 text-sm text-muted-foreground">
          <Switch
            checked={autoRefresh}
            onCheckedChange={onToggleAutoRefresh}
            aria-label={t('logs.actions.autoRefresh')}
          />
          {t('logs.actions.autoRefresh')}
        </label>
        <Button variant="outline" size="sm" onClick={onRefresh} disabled={refreshing} className="shrink-0">
          <RefreshCw className={cn('mr-2 h-4 w-4', refreshing && 'animate-spin')} />
          {refreshing ? t('common.actions.refreshing') : t('logs.actions.manualRefresh')}
        </Button>
      </div>
    </div>
  )
}
