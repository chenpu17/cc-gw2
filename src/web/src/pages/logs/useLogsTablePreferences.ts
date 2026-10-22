import { useCallback, useMemo } from 'react'
import { useHorizontalScrollHint } from '@/hooks/useHorizontalScrollHint'
import { usePersistentState } from '@/hooks/usePersistentState'
import { storageKeys } from '@/services/storageKeys'
import {
  DEFAULT_VISIBLE_COLUMNS,
  LOG_COLUMN_ORDER,
  loadStoredDensity,
  type LogColumnId,
  type RowDensity
} from './shared'
import { useResponsiveLogColumns } from './useResponsiveLogColumns'

/** v2 key (pre-billing); its value migrates into v3 on first read. */
const LEGACY_VISIBLE_COLUMNS_V2 = 'cc-gw.logs.visible-columns-v2'

/**
 * v3 first-run migration: carry over the user's v2 column selection (filtered
 * to known v3 ids) and default the new `cost` column ON — existing users see
 * the billing column without touching their other choices. No v2 value →
 * defaults. Invalid/empty v2 → defaults.
 */
function migrateVisibleColumns(): LogColumnId[] {
  if (typeof window === 'undefined') return DEFAULT_VISIBLE_COLUMNS
  const raw = window.localStorage.getItem(LEGACY_VISIBLE_COLUMNS_V2)
  if (!raw) return DEFAULT_VISIBLE_COLUMNS
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return DEFAULT_VISIBLE_COLUMNS
    const migrated = parsed.filter((value): value is LogColumnId =>
      LOG_COLUMN_ORDER.includes(value)
    )
    if (migrated.length === 0) return DEFAULT_VISIBLE_COLUMNS
    if (!migrated.includes('cost')) migrated.push('cost')
    return migrated.sort(
      (a, b) => LOG_COLUMN_ORDER.indexOf(a) - LOG_COLUMN_ORDER.indexOf(b)
    )
  } catch {
    return DEFAULT_VISIBLE_COLUMNS
  }
}

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
    migrateVisibleColumns,
    {
      serialize: JSON.stringify,
      deserialize: (raw) => {
        try {
          const parsed = JSON.parse(raw)
          if (!Array.isArray(parsed)) return DEFAULT_VISIBLE_COLUMNS
          const next = parsed.filter((value): value is LogColumnId => LOG_COLUMN_ORDER.includes(value))
          return next.length > 0 ? next : DEFAULT_VISIBLE_COLUMNS
        } catch {
          return DEFAULT_VISIBLE_COLUMNS
        }
      }
    }
  )
  const { scrollRef: tableScrollRef, showScrollHint } = useHorizontalScrollHint<HTMLDivElement>()
  const responsive = useResponsiveLogColumns(tableScrollRef, visibleColumns)

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
    autoHiddenColumns: responsive.autoHiddenColumns,
    effectiveVisibleColumns: responsive.effectiveVisibleColumns,
    effectiveVisibleColumnCount: responsive.effectiveVisibleColumnCount,
    effectiveVisibleColumnSet: responsive.effectiveVisibleColumnSet,
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
