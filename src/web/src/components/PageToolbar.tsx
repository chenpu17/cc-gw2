import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { useActivePageMeta } from '@/hooks/useActivePageMeta'

interface PageToolbarProps {
  /** Overrides the active route's title. */
  title?: ReactNode
  /** Overrides the active route's description. */
  description?: ReactNode
  info?: ReactNode
  status?: ReactNode
  actions?: ReactNode
  className?: string
}

/**
 * The page header band: title + description on the left, the page's primary
 * action on the right, secondary facts underneath.
 *
 * Title and description default to the active route's metadata, so the header
 * band is the one place a page announces itself — the global app header keeps
 * only a muted breadcrumb.
 */
export function PageToolbar({
  title,
  description,
  info,
  status,
  actions,
  className
}: PageToolbarProps) {
  const meta = useActivePageMeta()
  const resolvedTitle = title ?? meta.title
  const resolvedDescription = description ?? meta.description
  const facts = status || info

  if (!resolvedTitle && !facts && !actions) return null

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      {(resolvedTitle || actions) && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0 space-y-1">
            {resolvedTitle ? (
              <h1 className="truncate text-xl text-foreground">{resolvedTitle}</h1>
            ) : null}
            {resolvedDescription ? (
              <p className="text-sm leading-6 text-muted-foreground">{resolvedDescription}</p>
            ) : null}
          </div>
          {actions ? (
            <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
          ) : null}
        </div>
      )}
      {facts ? (
        <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs text-muted-foreground">
          {status}
          {info}
        </div>
      ) : null}
    </div>
  )
}
