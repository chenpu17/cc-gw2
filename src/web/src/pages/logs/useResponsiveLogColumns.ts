import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { useTranslation } from 'react-i18next'
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
 * the content column measures ~1154px. These are only the *floor* — header and
 * value text width differs by locale (en is ~40px wider than zh), so the
 * overflow pass below hides an extra column when the rendered table still does
 * not fit.
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
  // 0 means the desktop table is not rendered at all (the mobile LogCard has
  // replaced it); note this is the *container* width, not the viewport.
  if (!Number.isFinite(width) || width <= 0) return 0
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
 * Measures the scroll container (never the `<table>` itself for the threshold
 * pass): hiding columns changes table width, and observing that would feed
 * back into the observer. The table *is* observed for the overflow pass, but
 * that pass only ever hides more columns while the width is unchanged, so it
 * cannot oscillate.
 */
export function useResponsiveLogColumns(
  containerRef: RefObject<HTMLElement | null>,
  visibleColumns: LogColumnId[]
): ResponsiveLogColumns {
  const { i18n } = useTranslation()
  const language = i18n.resolvedLanguage ?? i18n.language
  const [hiddenCount, setHiddenCount] = useState(0)
  const hiddenCountRef = useRef(hiddenCount)
  hiddenCountRef.current = hiddenCount
  const widthRef = useRef(0)

  useEffect(() => {
    const element = containerRef.current
    if (!element) return

    let frame = 0
    let settleFrames = 0
    let applied = hiddenCountRef.current
    // Force a threshold reset on mount, language switch or column toggle:
    // en headers/values are wider than zh, and the container alone can't say so.
    widthRef.current = -1

    const measure = () => {
      frame = 0
      // Give React one or two frames to commit a previous hide before judging
      // overflow again — otherwise the stale DOM reports the old width and we
      // hide an extra column (observed as 12 -> 10 columns at 1440 in en).
      if (settleFrames > 0) {
        settleFrames -= 1
        if (settleFrames > 0) {
          schedule()
          return
        }
      }

      const width = element.clientWidth
      if (!Number.isFinite(width) || width <= 0) {
        applied = 0
        hiddenCountRef.current = 0
        widthRef.current = width
        setHiddenCount(0)
        return
      }

      const table = element.firstElementChild as HTMLElement | null
      // Only columns the user still has enabled can be auto-hidden; a manually
      // hidden priority column must not make the cap exceed the real candidate
      // list (otherwise the badge count and the hidden set drift apart).
      const maxHidden = LOG_COLUMN_AUTO_HIDE_PRIORITY.filter((id) =>
        visibleColumns.includes(id)
      ).length
      const base = hiddenCountForWidth(width)
      const overflowing = Boolean(table && table.scrollWidth > width + 1)

      const update = (next: number): boolean => {
        if (next === applied) return false
        applied = next
        hiddenCountRef.current = next
        setHiddenCount(next)
        settleFrames = 2
        schedule()
        return true
      }

      if (Math.abs(width - widthRef.current) > 1) {
        widthRef.current = width
        if (update(base)) return
      }

      // Same container width: the table changed because columns were hidden or
      // text/content changed. Only ever hide more, never restore — restoring
      // here would toggle against the threshold at the boundary.
      if (overflowing && applied < maxHidden) {
        update(applied + 1)
      }
    }

    const schedule = () => {
      if (frame === 0) frame = window.requestAnimationFrame(measure)
    }

    measure()
    const observer = new ResizeObserver(schedule)
    observer.observe(element)
    const table = element.firstElementChild
    if (table) observer.observe(table)
    window.addEventListener('resize', schedule)

    return () => {
      if (frame !== 0) window.cancelAnimationFrame(frame)
      observer.disconnect()
      window.removeEventListener('resize', schedule)
    }
  }, [containerRef, language, visibleColumns])

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
