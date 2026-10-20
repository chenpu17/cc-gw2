import { useTranslation } from 'react-i18next'
import { AppDialogBody, AppDialogContent, AppDialogHeader } from '@/components/DialogShell'
import { Dialog, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import type { RoutingPreset } from '@/types/providers'
import { RoutingPresetsCard } from './RoutingPresetsCard'
import type { RoutingState } from './useRoutingState'

/**
 * Toolbar「模板」dialog hosting the routing-presets card. The card used to live
 * permanently in the workspace's main column — presets are a low-frequency
 * operation, so they moved out of the grid; the card itself (and its testids)
 * is unchanged, just re-hosted.
 */
export function RoutingPresetsDialog({
  open,
  onOpenChange,
  routing,
  endpoint,
  onRequestDeletePreset
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  routing: RoutingState
  endpoint: string
  onRequestDeletePreset: (endpoint: string, preset: RoutingPreset) => void
}) {
  const { t } = useTranslation()

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <AppDialogContent className="max-w-lg">
        <AppDialogHeader>
          <DialogTitle>{t('modelManagement.presets.title')}</DialogTitle>
          <DialogDescription className="text-xs">
            {t('modelManagement.presets.description')}
          </DialogDescription>
        </AppDialogHeader>
        <AppDialogBody>
          <RoutingPresetsCard routing={routing} endpoint={endpoint} embedded onRequestDeletePreset={onRequestDeletePreset} />
        </AppDialogBody>
      </AppDialogContent>
    </Dialog>
  )
}
