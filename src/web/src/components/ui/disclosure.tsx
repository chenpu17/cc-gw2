import { useState, type MouseEvent, type ReactNode, type SyntheticEvent } from 'react'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { cardVariants } from '@/components/ui/card'

interface DisclosureProps {
  summary: ReactNode
  /** optional chip pinned to the right of the summary (e.g. an error count) */
  badge?: ReactNode
  defaultOpen?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
  /** 'card' renders as a bordered surface card; 'plain' is a bare details (default) */
  variant?: 'card' | 'plain'
  className?: string
  summaryClassName?: string
  contentClassName?: string
  children: ReactNode
}

/**
 * Thin, styled wrapper over native `<details>`. Supports both uncontrolled
 * (`defaultOpen`) and controlled (`open` + `onOpenChange`) usage. The chevron
 * rotates via the `group-open` variant and content fades in; the global
 * `prefers-reduced-motion` rule neutralizes both.
 */
export function Disclosure({
  summary,
  badge,
  defaultOpen = false,
  open,
  onOpenChange,
  variant = 'plain',
  className,
  summaryClassName,
  contentClassName,
  children
}: DisclosureProps) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen)
  const controlled = open !== undefined
  const isOpen = controlled ? open : internalOpen

  const handleSummaryClick = (event: MouseEvent) => {
    if (controlled) {
      event.preventDefault()
      onOpenChange?.(!isOpen)
    }
  }

  const handleToggle = (event: SyntheticEvent<HTMLDetailsElement>) => {
    if (!controlled) {
      const next = event.currentTarget.open
      setInternalOpen(next)
      onOpenChange?.(next)
    }
  }

  return (
    <details
      open={isOpen}
      onToggle={handleToggle}
      className={cn('group', variant === 'card' ? cardVariants({ variant: 'default' }) : '', className)}
    >
      <summary
        onClick={handleSummaryClick}
        className={cn(
          'flex cursor-pointer select-none list-none items-center gap-2 rounded-lg px-1 py-1 text-sm font-medium text-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background [&::-webkit-details-marker]:hidden',
          summaryClassName
        )}
      >
        <ChevronRight
          aria-hidden
          className="h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-160 group-open:rotate-90"
        />
        <span className="min-w-0 flex-1">{summary}</span>
        {badge ? <span className="ml-auto shrink-0">{badge}</span> : null}
      </summary>
      <div className={cn('animate-fade-in', contentClassName)}>{children}</div>
    </details>
  )
}
