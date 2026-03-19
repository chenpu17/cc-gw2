import type { HTMLAttributes, ReactNode } from 'react'
import { DialogContent, DialogFooter, DialogHeader } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

export function AppDialogContent({
  children,
  className
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <DialogContent className={cn('gap-0 overflow-hidden p-0', className)}>
      {children}
    </DialogContent>
  )
}

export function AppDialogHeader({
  children,
  className
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'border-b border-border/70 bg-[linear-gradient(180deg,rgba(255,255,255,0.92),rgba(248,250,252,0.82))] px-6 py-5',
        className
      )}
    >
      <DialogHeader>{children}</DialogHeader>
    </div>
  )
}

export function AppDialogBody({
  children,
  className
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('min-h-0 overflow-y-auto px-6 py-5', className)}>
      {children}
    </div>
  )
}

export function AppDialogFooter({
  children,
  className
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <DialogFooter className={cn('border-t border-border/70 bg-background/80 px-6 py-4', className)}>
      {children}
    </DialogFooter>
  )
}
