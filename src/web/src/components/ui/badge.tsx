import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

// Modernist: mono palette — one red accent voice. Semantic colors are
// subverted (ok = dark neutral, warn/err = red family). All variants read
// from CSS tokens so light/dark follow automatically.
const badgeVariants = cva(
  'inline-flex items-center rounded-md border-0 px-2 py-0.5 text-[11px] font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
  {
    variants: {
      variant: {
        default:
          'bg-primary/10 text-primary',
        secondary:
          'border-transparent bg-secondary text-muted-foreground',
        destructive:
          'bg-error-bg text-error',
        outline:
          'border border-border bg-transparent text-muted-foreground',
        // ok = dark neutral (no green in Modernist); live dot stays round
        success:
          'gap-1.5 bg-success-bg text-success before:h-1.5 before:w-1.5 before:rounded-full before:bg-success before:animate-live-pulse',
        warning:
          'bg-warning-bg text-warning',
        info:
          'bg-info-bg text-info',
        // collapsed into the single accent voice
        purple:
          'bg-primary/10 text-primary',
        pink:
          'bg-primary/10 text-primary'
      }
    },
    defaultVariants: {
      variant: 'default'
    }
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  )
}

export { Badge, badgeVariants }
