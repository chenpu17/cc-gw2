import { useCallback, useMemo } from 'react'
import { useHorizontalScrollHint } from '@/hooks/useHorizontalScrollHint'
import { usePersistentState } from '@/hooks/usePersistentState'
import { storageKeys } from '@/services/storageKeys'
import {
  DEFAULT_VISIBLE_COLUMNS,
  LOG_COLUMN_ORDER,
  loadStoredColumns,
  loadStoredDensity,
  type LogColumnId,
  type RowDensity
} from './shared'

export function useLogsTablePreferences() {
  const [rowDensity, setRowDensity] = usePersistentState<RowDensity>(
    storageKeys.logs.density,
    loadStoredDensity,
    {
      serialize: (value) => value,
      deserialize: (raw) => (raw === 'compact' ? 'compact' : 'comfortable')
    }
  )
  const [visibleColumns, setVisibleColumns] = usePersistentState<LogColumnId[]>(
    storageKeys.logs.visibleColumns,
    loadStoredColumns
  )
  const { scrollRef: tableScrollRef, showScrollHint } = useHorizontalScrollHint<HTMLDivElement>()

  const visibleColumnSet = useMemo(() => new Set(visibleColumns), [visibleColumns])
  const visibleColumnCount = visibleColumns.length + 2

  const toggleColumn = useCallback((column: LogColumnId) => {
    setVisibleColumns((previous) => {
      if (previous.includes(column)) {
        if (previous.length === 1) return previous
        return previous.filter((item) => item !== column)
      }

      const next = [...previous, column]
      next.sort((a, b) => LOG_COLUMN_ORDER.indexOf(a) - LOG_COLUMN_ORDER.indexOf(b))
      return next
    })
  }, [])

  const resetVisibleColumns = useCallback(() => {
    setVisibleColumns(DEFAULT_VISIBLE_COLUMNS)
  }, [])

  return {
    resetVisibleColumns,
    rowDensity,
    setRowDensity,
    showScrollHint,
    tableScrollRef,
    toggleColumn,
    visibleColumnCount,
    visibleColumns,
    visibleColumnSet
  }
}
