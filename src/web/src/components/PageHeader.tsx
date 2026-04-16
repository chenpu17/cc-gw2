import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

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
    <div className={cn('flex flex-col gap-4 rounded-[1.45rem] border border-white/70 bg-[linear-gradient(180deg,rgba(255,255,255,0.78)_0%,rgba(255,255,255,0.46)_100%)] p-5 shadow-[0_24px_64px_-48px_rgba(15,23,42,0.22)] backdrop-blur dark:border-white/10 dark:bg-[linear-gradient(180deg,rgba(15,23,42,0.78)_0%,rgba(2,6,23,0.52)_100%)] dark:shadow-[0_24px_64px_-48px_rgba(0,0,0,0.7)] sm:flex-row sm:items-start sm:justify-between sm:p-6', className)}>
      <div className="min-w-0 space-y-3">
        {(eyebrow || breadcrumb) && (
          <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/75">
            {eyebrow ? (
              <span className="inline-flex items-center rounded-full bg-primary/10 px-2.5 py-1 text-primary/80">
                {eyebrow}
              </span>
            ) : null}
            {breadcrumb ? <span>{breadcrumb}</span> : null}
          </div>
        )}

        <div className="flex flex-wrap items-start gap-3">
          {icon ? (
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[linear-gradient(135deg,hsl(var(--primary)/0.14),hsl(var(--primary)/0.04))] text-primary shadow-[inset_0_1px_0_rgba(255,255,255,0.68)] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
              {icon}
            </span>
          ) : null}
          <div className="min-w-0 space-y-1.5">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-[1.75rem] font-semibold tracking-[-0.03em] text-foreground">
                {title}
              </h1>
              {badge && (
                <span className="inline-flex items-center rounded-full bg-secondary px-3 py-1 text-xs font-medium text-muted-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.68)] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
                  {badge}
                </span>
              )}
            </div>
            {description && (
              <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
                {description}
              </p>
            )}
            {helper && (
              <div className="inline-flex max-w-full items-center rounded-full border border-border/55 bg-background/72 px-3 py-1.5 text-xs text-muted-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] dark:border-white/10 dark:bg-slate-950/42 dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
                {helper}
              </div>
            )}
          </div>
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
