import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'

interface PageHeaderProps {
  icon?: ReactNode
  title: string
  description?: ReactNode
  badge?: ReactNode
  eyebrow?: ReactNode
  breadcrumb?: ReactNode
  helper?: ReactNode
  actions?: ReactNode
  className?: string
}

export function PageHeader({
  icon,
  title,
  description,
  badge,
  eyebrow,
  breadcrumb,
  helper,
  actions,
  className
}: PageHeaderProps) {
  return (
    <div className={cn('flex flex-col gap-5 rounded-lg border border-border bg-card p-5 sm:flex-row sm:items-start sm:justify-between', className)}>
      <div className="flex flex-1 flex-wrap items-start gap-4">
        {icon && (
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
            {icon}
          </div>
        )}
        <div className="min-w-0 space-y-2">
          {(eyebrow || breadcrumb) && (
            <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              {eyebrow ? <span>{eyebrow}</span> : null}
              {eyebrow && breadcrumb ? <span className="h-1 w-1 rounded-full bg-muted-foreground/50" /> : null}
              {breadcrumb ? <span className="text-muted-foreground/90">{breadcrumb}</span> : null}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-[-0.02em]">
              {title}
            </h1>
            {badge && <Badge variant="secondary">{badge}</Badge>}
          </div>
          {description && (
            <p className="max-w-3xl text-sm text-muted-foreground">
              {description}
            </p>
          )}
          {helper && (
            <div className="rounded-lg border border-border bg-secondary px-3 py-2 text-xs text-muted-foreground">
              {helper}
            </div>
          )}
        </div>
      </div>
      {actions && (
        <div className="w-full shrink-0 self-start sm:w-auto">
          {actions}
        </div>
      )}
    </div>
  )
}
