import type { ReactNode } from 'react'
import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'

export type StepStatus = 'complete' | 'current' | 'upcoming' | 'error'

export interface StepNavItem {
  id: string
  label: ReactNode
  status: StepStatus
}

interface StepNavProps {
  steps: StepNavItem[]
  current: string
  /** invoked when a complete/current step is selected; upcoming steps are not clickable */
  onSelect?: (id: string) => void
  className?: string
}

const circleByStatus: Record<StepStatus, string> = {
  complete: 'border-primary bg-primary text-primary-foreground',
  current: 'border-primary bg-card text-primary ring-2 ring-primary/20',
  error: 'border-destructive bg-card text-destructive ring-2 ring-destructive/20',
  upcoming: 'border-border bg-card text-muted-foreground'
}

const labelByStatus: Record<StepStatus, string> = {
  complete: 'text-foreground',
  current: 'text-foreground font-medium',
  error: 'text-destructive font-medium',
  upcoming: 'text-muted-foreground'
}

/**
 * Horizontal numbered step indicator. Carries completion/error semantics that
 * plain tabs cannot. Steps marked complete or current are selectable (and
 * keyboard-accessible); upcoming steps render as inert.
 */
export function StepNav({ steps, current, onSelect, className }: StepNavProps) {
  return (
    <nav aria-label="steps" className={cn('flex items-start', className)}>
      {steps.map((step, index) => {
        const clickable = onSelect && (step.status === 'complete' || step.status === 'current')
        const isLast = index === steps.length - 1
        const connectorTone = step.status === 'complete' ? 'bg-primary/40' : 'bg-border'

        const circle = (
          <span
            className={cn(
              'motion-surface flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold',
              circleByStatus[step.status]
            )}
            aria-current={step.id === current ? 'step' : undefined}
          >
            {step.status === 'complete' ? <Check className="h-3.5 w-3.5" aria-hidden /> : index + 1}
          </span>
        )

        const labelId = `stepnav-${step.id}-label`
        return (
          <div key={step.id} className="flex flex-1 items-start">
            <div className="flex min-w-0 flex-col items-center gap-1.5">
              {clickable ? (
                <button
                  type="button"
                  onClick={() => onSelect?.(step.id)}
                  aria-labelledby={labelId}
                  className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-surface"
                >
                  {circle}
                </button>
              ) : (
                circle
              )}
              <span
                id={labelId}
                className={cn('text-center text-[11px] leading-tight', labelByStatus[step.status])}
              >
                {step.label}
              </span>
            </div>
            {!isLast ? (
              <span aria-hidden className={cn('mx-1.5 mt-3.5 h-px flex-1', connectorTone)} />
            ) : null}
          </div>
        )
      })}
    </nav>
  )
}
