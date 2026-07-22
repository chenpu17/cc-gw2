import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export interface SegmentedControlOption<T> {
  value: T
  label: ReactNode
  icon?: ReactNode
}

interface SegmentedControlProps<T extends string | number> {
  value: T
  onChange: (value: T) => void
  options: readonly SegmentedControlOption<T>[]
  className?: string
  block?: boolean
  'aria-label'?: string
}

/**
 * Pill-style segmented toggle. Encapsulates the hand-rolled
 * `rounded-full bg-secondary p-1` pattern used across range/density/view switches.
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
      className={cn('flex items-center gap-1 rounded-full bg-secondary p-1', className)}
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
              'inline-flex h-8 items-center justify-center gap-1.5 whitespace-nowrap rounded-full px-3.5 text-xs font-medium transition-all',
              block ? 'flex-1' : 'shrink-0',
              active
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-primary/5 hover:text-foreground'
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
