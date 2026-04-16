import { useTranslation } from 'react-i18next'
import {
  AppDialogBody,
  AppDialogContent,
  AppDialogFooter,
  AppDialogHeader
} from '@/components/DialogShell'
import { Button } from '@/components/ui/button'
import { Dialog, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import type { ProviderConfig } from '@/types/providers'
import type { AnthropicHeaderOption } from './shared'

export function TestConnectionDialog({
  open,
  provider,
  options,
  usePreset,
  preservedExtras,
  onPresetChange,
  onConfirm,
  onClose
}: {
  open: boolean
  provider: ProviderConfig | null
  options: AnthropicHeaderOption[]
  usePreset: boolean
  preservedExtras: Record<string, string>
  onPresetChange: (value: boolean) => void
  onConfirm: () => Promise<void> | void
  onClose: () => void
}) {
  const { t } = useTranslation()

  if (!provider) return null

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <AppDialogContent className="max-w-2xl">
        <AppDialogHeader>
          <DialogTitle>{t('providers.testDialog.title')}</DialogTitle>
          <DialogDescription>
            {t('providers.testDialog.subtitle', { name: provider.label || provider.id })}
          </DialogDescription>
        </AppDialogHeader>
        <AppDialogBody className="space-y-4">
          <div className="rounded-xl bg-accent p-4 text-sm text-primary">
            {t('providers.testDialog.description')}
          </div>
          <div className="space-y-4 rounded-xl bg-secondary/50 p-4">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-2">
                <Label htmlFor="provider-test-preset">{t('providers.testDialog.presetLabel')}</Label>
                <p className="text-xs text-muted-foreground">{t('providers.testDialog.presetDescription')}</p>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  id="provider-test-preset"
                  checked={usePreset}
                  onCheckedChange={onPresetChange}
                />
              </div>
            </div>
            {usePreset ? (
              <div className="space-y-2">
                <details className="rounded-xl border border-transparent bg-card p-2 text-xs shadow-[var(--surface-shadow)]">
                  <summary className="cursor-pointer text-primary hover:underline">
                    {t('providers.testDialog.presetPreviewSummary')}
                  </summary>
                  <div className="mt-2 space-y-1">
                    {options.map((option) => (
                      <code key={option.key} className="block rounded-lg bg-secondary px-2 py-1 text-xs">
                        {option.key}: {option.value}
                      </code>
                    ))}
                  </div>
                </details>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">{t('providers.testDialog.presetDescription')}</p>
            )}
          </div>
          {Object.keys(preservedExtras).length > 0 && (
            <div className="space-y-2 rounded-xl bg-secondary/50 p-4 text-xs">
              <p className="font-medium">{t('providers.testDialog.preservedInfo')}</p>
              {Object.entries(preservedExtras).map(([key, value]) => (
                <code key={key} className="block rounded-lg border border-transparent bg-card px-2 py-1 shadow-[var(--surface-shadow)]">
                  {key}: {value}
                </code>
              ))}
            </div>
          )}
        </AppDialogBody>
        <AppDialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('providers.testDialog.cancel')}
          </Button>
          <Button onClick={() => void onConfirm()}>{t('providers.testDialog.primary')}</Button>
        </AppDialogFooter>
      </AppDialogContent>
    </Dialog>
  )
}
