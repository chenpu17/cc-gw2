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
    <div className={cn('flex flex-col gap-5 rounded-[1.6rem] border border-[rgba(24,16,13,0.08)] bg-[linear-gradient(135deg,rgba(255,249,245,0.98),rgba(255,255,255,0.96))] p-5 shadow-[0_1px_2px_rgba(17,12,11,0.04),0_20px_40px_-34px_rgba(225,93,73,0.2)] sm:flex-row sm:items-start sm:justify-between', className)}>
      <div className="flex flex-1 flex-wrap items-start gap-4">
        {icon && (
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary shadow-[inset_0_0_0_1px_rgba(225,93,73,0.16)]">
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
            <div className="rounded-2xl border border-[rgba(24,16,13,0.08)] bg-[rgba(255,255,255,0.9)] px-3.5 py-2 text-xs text-muted-foreground">
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
