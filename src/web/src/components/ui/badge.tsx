import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

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
          'bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400',
        outline:
          'border border-border bg-transparent text-muted-foreground',
        success:
          'gap-1.5 bg-emerald-100 text-emerald-800 before:h-1.5 before:w-1.5 before:rounded-full before:bg-emerald-500 dark:bg-emerald-950/40 dark:text-emerald-400',
        warning:
          'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-400',
        info:
          'bg-indigo-100 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-400',
        purple:
          'bg-violet-100 text-violet-700 dark:bg-violet-950/40 dark:text-violet-400',
        pink:
          'bg-pink-100 text-pink-700 dark:bg-pink-950/40 dark:text-pink-400'
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
