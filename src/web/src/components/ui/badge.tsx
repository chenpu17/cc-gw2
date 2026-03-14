import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

const badgeVariants = cva(
  'inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold tracking-[0.02em] transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
  {
    variants: {
      variant: {
        default:
          'border-primary/15 bg-primary/10 text-primary hover:bg-primary/15 dark:border-primary/25 dark:bg-primary/15 dark:text-primary-foreground',
        secondary:
          'border-border/70 bg-secondary/90 text-secondary-foreground hover:bg-secondary dark:border-border dark:bg-secondary/70 dark:text-secondary-foreground',
        destructive:
          'border-red-200 bg-red-50 text-red-700 hover:bg-red-100 dark:border-red-900 dark:bg-red-950/60 dark:text-red-300',
        outline:
          'border-border bg-transparent text-muted-foreground hover:bg-accent dark:border-border dark:text-muted-foreground dark:hover:bg-accent',
        success:
          'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:border-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-300',
        warning:
          'border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100 dark:border-amber-900 dark:bg-amber-950/60 dark:text-amber-300',
        info:
          'border-cyan-200 bg-cyan-50 text-cyan-700 hover:bg-cyan-100 dark:border-cyan-900 dark:bg-cyan-950/60 dark:text-cyan-300',
        purple:
          'border-violet-200 bg-violet-50 text-violet-700 hover:bg-violet-100 dark:border-violet-900 dark:bg-violet-950/60 dark:text-violet-300',
        pink:
          'border-pink-200 bg-pink-50 text-pink-700 hover:bg-pink-100 dark:border-pink-900 dark:bg-pink-950/60 dark:text-pink-300'
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
