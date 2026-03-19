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
        'surface-1 overflow-hidden border-[rgba(24,16,13,0.08)] bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(252,249,245,0.92))] shadow-[0_1px_2px_rgba(17,12,11,0.04),0_20px_40px_-32px_rgba(17,12,11,0.14)]',
        className
      )}
    >
      {hasHeader && (
        <CardHeader className="flex flex-col gap-4 border-b border-border/60 bg-[linear-gradient(135deg,rgba(225,93,73,0.06),rgba(217,169,64,0.03),rgba(255,255,255,0.78))] sm:flex-row sm:items-start sm:justify-between sm:space-y-0">
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
