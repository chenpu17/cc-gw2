import { useEffect, useMemo, useState, type RefObject } from 'react'
import { type LogColumnId } from './shared'

/**
 * Low-priority columns give way first as the table container narrows. Core
 * metric columns (tokens / cost / duration / status / endpoint / provider)
 * and the two sticky columns are never auto-hidden.
 */
export const LOG_COLUMN_AUTO_HIDE_PRIORITY: LogColumnId[] = [
  'error',
  'client',
  'apiKey',
  'requestedModel',
  'routedModel'
]

/**
 * Container-width steps. `below` is exclusive: at the canonical 1440 viewport
 * the content column measures ~1154px, so every user-selected column stays
 * visible and only narrower windows start collapsing. At ~910px (a 1000px
 * viewport) all five secondary columns are gone.
 */
const HIDE_STEPS: Array<{ below: number; hidden: number }> = [
  { below: 1140, hidden: 1 },
  { below: 1080, hidden: 2 },
  { below: 1020, hidden: 3 },
  { below: 960, hidden: 4 },
  { below: 920, hidden: 5 }
]

const EMPTY: LogColumnId[] = []

function hiddenCountForWidth(width: number): number {
  // Below md the desktop table is replaced by LogCard; keep the user's set so
  // the transition back to desktop does not animate columns in/out.
  if (!Number.isFinite(width) || width <= 0 || width < 768) return 0
  // Steps are ordered narrowest-last; a width under several steps must take
  // the deepest one (the loop overwrites, so return the last match).
  let hidden = 0
  for (const step of HIDE_STEPS) {
    if (width < step.below) hidden = step.hidden
  }
  return hidden
}

interface ResponsiveLogColumns {
  autoHiddenColumns: LogColumnId[]
  effectiveVisibleColumns: LogColumnId[]
  effectiveVisibleColumnSet: ReadonlySet<LogColumnId>
  /** Effective columns + the sticky time and actions columns. */
  effectiveVisibleColumnCount: number
}

/**
 * Measures the scroll container (never the `<table>` itself): hiding columns
 * changes table width, and observing that would feed back into the observer.
 */
export function useResponsiveLogColumns(
  containerRef: RefObject<HTMLElement | null>,
  visibleColumns: LogColumnId[]
): ResponsiveLogColumns {
  const [hiddenCount, setHiddenCount] = useState(0)

  useEffect(() => {
    const element = containerRef.current
    if (!element) return

    let frame = 0
    const measure = () => {
      frame = 0
      const next = hiddenCountForWidth(element.clientWidth)
      setHiddenCount((previous) => (previous === next ? previous : next))
    }
    const schedule = () => {
      if (frame === 0) frame = window.requestAnimationFrame(measure)
    }

    measure()
    const observer = new ResizeObserver(schedule)
    observer.observe(element)
    window.addEventListener('resize', schedule)

    return () => {
      if (frame !== 0) window.cancelAnimationFrame(frame)
      observer.disconnect()
      window.removeEventListener('resize', schedule)
    }
  }, [containerRef])

  const autoHiddenColumns = useMemo(() => {
    if (hiddenCount === 0) return EMPTY
    return LOG_COLUMN_AUTO_HIDE_PRIORITY
      .filter((id) => visibleColumns.includes(id))
      .slice(0, hiddenCount)
  }, [hiddenCount, visibleColumns])

  const effectiveVisibleColumns = useMemo(() => {
    if (autoHiddenColumns.length === 0) return visibleColumns
    const hidden = new Set(autoHiddenColumns)
    return visibleColumns.filter((id) => !hidden.has(id))
  }, [autoHiddenColumns, visibleColumns])

  const effectiveVisibleColumnSet = useMemo(
    () => new Set(effectiveVisibleColumns),
    [effectiveVisibleColumns]
  )

  return {
    autoHiddenColumns,
    effectiveVisibleColumns,
    effectiveVisibleColumnSet,
    effectiveVisibleColumnCount: effectiveVisibleColumns.length + 2
  }
}
