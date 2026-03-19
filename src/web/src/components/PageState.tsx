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
  default: 'border-border/70 bg-background/55',
  primary: 'border-primary/15 bg-[linear-gradient(135deg,rgba(225,93,73,0.1),rgba(217,169,64,0.05),rgba(255,255,255,0.84))]',
  danger: 'border-destructive/20 bg-[linear-gradient(135deg,rgba(239,68,68,0.08),rgba(248,113,113,0.04),rgba(255,255,255,0.82))]'
}

const iconToneClasses: Record<NonNullable<PageStateProps['tone']>, string> = {
  default: 'bg-background/80 text-primary shadow-[0_14px_32px_-24px_rgba(225,93,73,0.42)]',
  primary: 'bg-primary/10 text-primary shadow-[0_14px_32px_-24px_rgba(225,93,73,0.42)]',
  danger: 'bg-destructive/10 text-destructive shadow-[0_14px_32px_-24px_rgba(239,68,68,0.45)]'
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
        'flex flex-col items-center justify-center rounded-[1.35rem] border border-dashed px-6 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.35)]',
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
