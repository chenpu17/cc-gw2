import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

interface PageSectionProps {
  title?: ReactNode
  description?: ReactNode
  actions?: ReactNode
  className?: string
  contentClassName?: string
  children: ReactNode
}

export function PageSection({
  title,
  description,
  actions,
  className,
  contentClassName,
  children
}: PageSectionProps) {
  const hasHeader = title || description || actions

  return (
    <Card className={cn('surface-1 overflow-hidden', className)}>
      {hasHeader && (
        <CardHeader className="flex flex-col gap-4 border-b border-border/60 bg-background/35 sm:flex-row sm:items-start sm:justify-between sm:space-y-0">
          <div className="space-y-1.5">
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
            <div className="flex shrink-0 flex-wrap items-center gap-2">
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
