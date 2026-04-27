import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface PageToolbarProps {
  info?: ReactNode
  status?: ReactNode
  actions?: ReactNode
  className?: string
}

export function PageToolbar({ info, status, actions, className }: PageToolbarProps) {
  if (!info && !status && !actions) return null
  return (
    <div
      className={cn(
        'flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between',
        className
      )}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs text-muted-foreground">
        {status}
        {info}
      </div>
      {actions ? (
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      ) : null}
    </div>
  )
}
