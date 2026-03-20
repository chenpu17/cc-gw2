import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

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
  const hasHeader = title || description || actions

  return (
    <Card
      className={cn(
        'overflow-hidden',
        className
      )}
    >
      {hasHeader && (
        <CardHeader className="flex flex-col gap-4 border-b border-border bg-secondary sm:flex-row sm:items-start sm:justify-between sm:space-y-0">
          <div className="min-w-0 space-y-1.5">
            {eyebrow ? (
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                {eyebrow}
              </div>
            ) : null}
            {typeof title === 'string' ? (
              <CardTitle className="text-base font-semibold">{title}</CardTitle>
            ) : (
              title
            )}
            {description && (
              typeof description === 'string' ? (
                <CardDescription>{description}</CardDescription>
              ) : (
                <div className="text-sm text-muted-foreground">{description}</div>
              )
            )}
          </div>
          {actions && (
            <div className="w-full shrink-0 sm:w-auto">
              {actions}
            </div>
          )}
        </CardHeader>
      )}
      <CardContent className={cn(!hasHeader && 'pt-6', hasHeader && 'pt-5', contentClassName)}>
        {children}
      </CardContent>
    </Card>
  )
}
