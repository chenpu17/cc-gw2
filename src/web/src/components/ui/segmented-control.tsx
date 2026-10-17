import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export interface SegmentedControlOption<T> {
  value: T
  label: ReactNode
  icon?: ReactNode
}

interface SegmentedControlProps<T extends string | number> {
  /** `null` = no segment active — legitimate when the current state is a
   *  custom combination that none of the presets describe. */
  value: T | null
  onChange: (value: T) => void
  options: readonly SegmentedControlOption<T>[]
  className?: string
  block?: boolean
  'aria-label'?: string
}

/**
 * Segmented toggle. Encapsulates the hand-rolled `bg-secondary p-1` pattern
 * used across range/density/view switches. Square under Modernist (zero radius).
 *
 * The active segment is ink (`bg-foreground`), never red: red is reserved for
 * the primary action of a screen, so selection must not compete with it.
 */
export function SegmentedControl<T extends string | number>({
  value,
  onChange,
  options,
  className,
  block,
  'aria-label': ariaLabel
}: SegmentedControlProps<T>) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={cn('flex items-center gap-1 bg-secondary p-1', className)}
    >
      {options.map((option) => {
        const active = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            aria-pressed={active}
            className={cn(
              'inline-flex h-8 items-center justify-center gap-1.5 whitespace-nowrap px-3.5 text-xs font-medium transition-all',
              block ? 'flex-1' : 'shrink-0',
              active
                ? 'bg-foreground text-background'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {option.icon}
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
