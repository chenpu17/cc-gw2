import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface PageSectionProps {
  title?: ReactNode
  description?: ReactNode
  eyebrow?: ReactNode
  actions?: ReactNode
  className?: string
  contentClassName?: string
  children: ReactNode
}

export function PageSection({
  title,
  description,
  eyebrow,
  actions,
  className,
  contentClassName,
  children
}: PageSectionProps) {
  const hasHeader = title || description || eyebrow || actions

  return (
    <div className={cn('rounded-[1.35rem] border border-white/70 bg-card/95 shadow-[0_22px_56px_-46px_rgba(15,23,42,0.24)] backdrop-blur', className)}>
      {hasHeader && (
        <div className="flex flex-col gap-4 p-6 pb-0 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 space-y-1.5">
            {eyebrow ? (
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-primary/78">
                {eyebrow}
              </div>
            ) : null}
            {typeof title === 'string' ? (
              <h2 className="text-base font-semibold text-foreground">{title}</h2>
            ) : (
              title
            )}
            {description && (
              typeof description === 'string' ? (
                <p className="text-sm text-muted-foreground/70">{description}</p>
              ) : (
                <div className="text-sm text-muted-foreground/70">{description}</div>
              )
            )}
          </div>
          {actions && (
            <div className="w-full shrink-0 sm:w-auto">
              {actions}
            </div>
          )}
        </div>
      )}
      <div className={cn('p-6', !hasHeader && 'pt-6', contentClassName)}>
        {children}
      </div>
    </div>
  )
}
