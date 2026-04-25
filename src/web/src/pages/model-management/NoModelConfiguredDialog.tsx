import { useTranslation } from 'react-i18next'
import {
  AppDialogBody,
  AppDialogContent,
  AppDialogFooter,
  AppDialogHeader
} from '@/components/DialogShell'
import { Button } from '@/components/ui/button'
import { Dialog, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import type { ProviderConfig } from '@/types/providers'

export function NoModelConfiguredDialog({
  open,
  provider,
  onClose,
  onEdit
}: {
  open: boolean
  provider: ProviderConfig | null
  onClose: () => void
  onEdit: (provider: ProviderConfig) => void
}) {
  const { t } = useTranslation()

  if (!provider) return null

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <AppDialogContent className="max-w-md">
        <AppDialogHeader>
          <DialogTitle>{t('providers.noModelDialog.title')}</DialogTitle>
          <DialogDescription>
            {t('providers.noModelDialog.subtitle', { name: provider.label || provider.id })}
          </DialogDescription>
        </AppDialogHeader>
        <AppDialogBody className="space-y-4">
          <div className="rounded-xl bg-accent p-4 text-sm text-primary">
            {t('providers.noModelDialog.description')}
          </div>
          <p className="text-sm text-muted-foreground">
            {t('providers.noModelDialog.hint')}
          </p>
        </AppDialogBody>
        <AppDialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('common.actions.close')}
          </Button>
          <Button onClick={() => onEdit(provider)}>
            {t('providers.noModelDialog.primary')}
          </Button>
        </AppDialogFooter>
      </AppDialogContent>
    </Dialog>
  )
}
