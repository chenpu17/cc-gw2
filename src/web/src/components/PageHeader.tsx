import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'

interface PageHeaderProps {
  icon?: ReactNode
  title: string
  description?: ReactNode
  badge?: ReactNode
  actions?: ReactNode
  className?: string
}

export function PageHeader({
  icon,
  title,
  description,
  badge,
  actions,
  className
}: PageHeaderProps) {
  return (
    <div className={cn('flex flex-col gap-4 rounded-[1.6rem] border border-white/50 bg-background/60 p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)] backdrop-blur sm:flex-row sm:items-start sm:justify-between', className)}>
      <div className="flex flex-1 flex-wrap items-start gap-4">
        {icon && (
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary shadow-[inset_0_0_0_1px_rgba(59,130,246,0.08)]">
            {icon}
          </div>
        )}
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-[-0.02em]">
              {title}
            </h1>
            {badge && <Badge variant="secondary">{badge}</Badge>}
          </div>
          {description && (
            <p className="max-w-2xl text-sm text-muted-foreground">
              {description}
            </p>
          )}
        </div>
      </div>
      {actions && (
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {actions}
        </div>
      )}
    </div>
  )
}
