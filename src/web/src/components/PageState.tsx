import type { ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

interface PageStateProps {
  icon?: ReactNode
  title: ReactNode
  description?: ReactNode
  action?: ReactNode
  className?: string
  compact?: boolean
  tone?: 'default' | 'primary' | 'danger'
}

const toneClasses: Record<NonNullable<PageStateProps['tone']>, string> = {
  default: 'border-border bg-secondary',
  primary: 'border-primary/15 bg-accent',
  danger: 'border-destructive/20 bg-destructive/10'
}

const iconToneClasses: Record<NonNullable<PageStateProps['tone']>, string> = {
  default: 'bg-secondary text-primary',
  primary: 'bg-primary/10 text-primary',
  danger: 'bg-destructive/10 text-destructive'
}

export function PageState({
  icon,
  title,
  description,
  action,
  className,
  compact = false,
  tone = 'default'
}: PageStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center rounded-lg border border-dashed px-6 text-center',
        compact ? 'min-h-[180px] py-8' : 'min-h-[260px] py-12',
        toneClasses[tone],
        className
      )}
    >
      {icon ? (
        <div className={cn('mb-4 flex h-12 w-12 items-center justify-center rounded-2xl', iconToneClasses[tone])}>
          {icon}
        </div>
      ) : null}
      <div className="max-w-xl space-y-1.5">
        <div className="text-base font-semibold tracking-[-0.01em]">{title}</div>
        {description ? <div className="text-sm text-muted-foreground">{description}</div> : null}
      </div>
      {action ? <div className="mt-5 flex flex-wrap items-center justify-center gap-2">{action}</div> : null}
    </div>
  )
}

export function PageLoadingState({
  label,
  className,
  compact = false
}: {
  label: ReactNode
  className?: string
  compact?: boolean
}) {
  return (
    <PageState
      className={className}
      compact={compact}
      tone="primary"
      icon={<Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />}
      title={label}
    />
  )
}
