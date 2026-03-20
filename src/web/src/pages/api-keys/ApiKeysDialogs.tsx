import { Check, Copy } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import {
  AppDialogBody,
  AppDialogContent,
  AppDialogFooter,
  AppDialogHeader
} from '@/components/DialogShell'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogDescription,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import type { ApiKeySummary, NewApiKeyResponse } from '@/types/apiKeys'
import { EndpointSelector, type EndpointOption } from './shared'

export function CreateApiKeyDialog({
  availableEndpoints,
  isOpen,
  keyDescription,
  keyName,
  onDescriptionChange,
  onEndpointsChange,
  onKeyNameChange,
  onOpenChange,
  onSubmit,
  selectedEndpoints
}: {
  availableEndpoints: EndpointOption[]
  isOpen: boolean
  keyDescription: string
  keyName: string
  onDescriptionChange: (value: string) => void
  onEndpointsChange: (next: string[]) => void
  onKeyNameChange: (value: string) => void
  onOpenChange: (open: boolean) => void
  onSubmit: () => void
  selectedEndpoints: string[]
}) {
  const { t } = useTranslation()

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <AppDialogContent className="max-w-2xl">
        <AppDialogHeader>
          <DialogTitle>{t('apiKeys.createNew')}</DialogTitle>
          <DialogDescription>{t('apiKeys.createDescription')}</DialogDescription>
        </AppDialogHeader>
        <AppDialogBody className="space-y-4">
          <div className="rounded-lg border border-primary/20 bg-accent px-4 py-3 text-xs text-primary">
            {t('apiKeys.selectEndpoints')}
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-[1rem] border border-blue-200 bg-blue-50/70 px-3 py-3 text-xs text-blue-900 dark:border-blue-800 dark:bg-blue-950/30 dark:text-blue-100">
              <p className="font-semibold">Restricted</p>
              <p className="mt-1 text-blue-800/85 dark:text-blue-100/80">Select explicit endpoints before saving.</p>
            </div>
            <div className="rounded-[1rem] border border-amber-200 bg-amber-50/70 px-3 py-3 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100">
              <p className="font-semibold">Unrestricted</p>
              <p className="mt-1 text-amber-800/85 dark:text-amber-100/80">Leave endpoint selection empty for broad access.</p>
            </div>
            <div className="rounded-[1rem] border border-rose-200 bg-rose-50/70 px-3 py-3 text-xs text-rose-900 dark:border-rose-800 dark:bg-rose-950/30 dark:text-rose-100">
              <p className="font-semibold">Wildcard</p>
              <p className="mt-1 text-rose-800/85 dark:text-rose-100/80">Special-case key with the highest blast radius.</p>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="keyName">{t('apiKeys.keyNamePlaceholder')} *</Label>
            <Input
              id="keyName"
              value={keyName}
              onChange={(event) => onKeyNameChange(event.target.value)}
              placeholder={t('apiKeys.keyNamePlaceholder')}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  onSubmit()
                }
              }}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="keyDescription">{t('apiKeys.descriptionLabel')}</Label>
            <Textarea
              id="keyDescription"
              value={keyDescription}
              onChange={(event) => onDescriptionChange(event.target.value)}
              placeholder={t('apiKeys.keyDescriptionPlaceholder')}
              rows={3}
            />
          </div>
          <div className="space-y-2">
            <Label>{t('apiKeys.allowedEndpoints')}</Label>
            <EndpointSelector
              available={availableEndpoints}
              selected={selectedEndpoints}
              onChange={onEndpointsChange}
              hint={t('apiKeys.selectEndpoints')}
            />
          </div>
        </AppDialogBody>
        <AppDialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.actions.cancel')}
          </Button>
          <Button onClick={onSubmit}>{t('apiKeys.createAction')}</Button>
        </AppDialogFooter>
      </AppDialogContent>
    </Dialog>
  )
}

export function ApiKeyCreatedDialog({
  createdKey,
  onClose,
  onCopy
}: {
  createdKey: NewApiKeyResponse | null
  onClose: () => void
  onCopy: (key: string) => void
}) {
  const { t } = useTranslation()

  return (
    <Dialog open={!!createdKey} onOpenChange={(open) => { if (!open) onClose() }}>
      <AppDialogContent className="max-w-xl">
        <AppDialogHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600">
              <Check className="h-5 w-5" aria-hidden="true" />
            </div>
            <DialogTitle>{t('apiKeys.keyCreated')}</DialogTitle>
          </div>
        </AppDialogHeader>
        <AppDialogBody className="space-y-4">
          <p className="text-sm font-medium text-amber-600 dark:text-amber-400">
            {t('apiKeys.saveKeyWarning')}
          </p>
          <div className="rounded-lg border border-border bg-secondary px-4 py-3 font-mono text-sm">
            {createdKey?.key}
          </div>
          {createdKey?.description ? (
            <p className="whitespace-pre-wrap text-sm text-muted-foreground">{createdKey.description}</p>
          ) : null}
        </AppDialogBody>
        <AppDialogFooter>
          <Button onClick={() => onCopy(createdKey?.key ?? '')}>
            <Copy className="mr-2 h-4 w-4" aria-hidden="true" />
            {t('common.actions.copy')}
          </Button>
          <Button variant="outline" onClick={onClose}>
            {t('common.actions.close')}
          </Button>
        </AppDialogFooter>
      </AppDialogContent>
    </Dialog>
  )
}

export function EditApiKeyEndpointsDialog({
  apiKey,
  availableEndpoints,
  onClose,
  onEndpointsChange,
  onSave,
  selectedEndpoints
}: {
  apiKey: ApiKeySummary | null
  availableEndpoints: EndpointOption[]
  onClose: () => void
  onEndpointsChange: (next: string[]) => void
  onSave: () => void
  selectedEndpoints: string[]
}) {
  const { t } = useTranslation()

  return (
    <Dialog open={!!apiKey} onOpenChange={(open) => { if (!open) onClose() }}>
      <AppDialogContent className="max-w-2xl">
        <AppDialogHeader>
          <DialogTitle>{t('apiKeys.editEndpoints')}</DialogTitle>
          <DialogDescription>{apiKey?.name}</DialogDescription>
        </AppDialogHeader>
        <AppDialogBody className="space-y-4">
          <div className="rounded-lg border border-[hsl(var(--warning)/0.3)] bg-[hsl(var(--warning-bg))] px-4 py-3 text-xs text-[hsl(var(--warning)/1)]">
            {t('apiKeys.allEndpoints')}
          </div>
          <div className="rounded-lg border border-border bg-secondary px-4 py-3 text-xs text-muted-foreground">
            Empty selection means unrestricted access. Only explicit selections create a restricted key scope.
          </div>
          <EndpointSelector
            available={availableEndpoints}
            selected={selectedEndpoints}
            onChange={onEndpointsChange}
            hint={t('apiKeys.selectEndpoints')}
          />
        </AppDialogBody>
        <AppDialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('common.actions.cancel')}
          </Button>
          <Button onClick={onSave}>{t('common.save')}</Button>
        </AppDialogFooter>
      </AppDialogContent>
    </Dialog>
  )
}

export function DeleteApiKeyDialog({
  deleteTarget,
  isDeleting,
  onConfirm,
  onOpenChange
}: {
  deleteTarget: ApiKeySummary | null
  isDeleting: number | null
  onConfirm: () => void
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation()

  return (
    <ConfirmDialog
      open={!!deleteTarget}
      onOpenChange={onOpenChange}
      title={t('apiKeys.deleteDialogTitle')}
      description={t('apiKeys.confirmDelete')}
      confirmLabel={deleteTarget && isDeleting === deleteTarget.id ? t('common.actions.loading') : t('apiKeys.actions.delete')}
      cancelLabel={t('common.actions.cancel')}
      loading={deleteTarget ? isDeleting === deleteTarget.id : false}
      onConfirm={onConfirm}
    >
      {deleteTarget ? (
        <div className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 font-mono text-xs text-foreground">
          {deleteTarget.name}
        </div>
      ) : null}
    </ConfirmDialog>
  )
}
