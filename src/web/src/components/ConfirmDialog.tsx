import type { ReactNode } from 'react'
import {
  AppDialogBody,
  AppDialogContent,
  AppDialogFooter,
  AppDialogHeader
} from '@/components/DialogShell'
import {
  Dialog,
  DialogDescription,
  DialogTitle
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

interface ConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: ReactNode
  description?: ReactNode
  confirmLabel: ReactNode
  cancelLabel: ReactNode
  onConfirm: () => void | Promise<void>
  loading?: boolean
  confirmDisabled?: boolean
  confirmVariant?: 'default' | 'destructive'
  children?: ReactNode
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel,
  onConfirm,
  loading = false,
  confirmDisabled = false,
  confirmVariant = 'destructive',
  children
}: ConfirmDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <AppDialogContent className="max-w-md">
        <AppDialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </AppDialogHeader>
        <AppDialogBody className="space-y-4">
          {children ? <div className="text-sm text-muted-foreground">{children}</div> : null}
        </AppDialogBody>
        <AppDialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button variant={confirmVariant} onClick={() => void onConfirm()} disabled={loading || confirmDisabled}>
            {confirmLabel}
          </Button>
        </AppDialogFooter>
      </AppDialogContent>
    </Dialog>
  )
}
