import { ArrowRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  AppDialogBody,
  AppDialogContent,
  AppDialogFooter,
  AppDialogHeader
} from '@/components/DialogShell'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import type { RoutingPreset } from '@/types/providers'
import type { ModelRouteEntry } from './shared'

export function PresetDiffDialog({
  dialog,
  currentRoutes,
  onConfirm,
  onClose
}: {
  dialog: { endpoint: string; preset: RoutingPreset } | null
  currentRoutes: ModelRouteEntry[]
  onConfirm: (endpoint: string, preset: RoutingPreset) => void
  onClose: () => void
}) {
  const { t } = useTranslation()

  if (!dialog) return null

  const { endpoint, preset } = dialog
  const presetRoutes = preset.modelRoutes ?? {}

  const currentMap: Record<string, string> = {}
  for (const entry of currentRoutes) {
    const source = entry.source.trim()
    const target = entry.target.trim()
    if (source && target) currentMap[source] = target
  }

  const allKeys = new Set([...Object.keys(currentMap), ...Object.keys(presetRoutes)])
  const added: Array<[string, string]> = []
  const removed: Array<[string, string]> = []
  const changed: Array<[string, string, string]> = []

  for (const key of allKeys) {
    const inCurrent = key in currentMap
    const inPreset = key in presetRoutes
    if (inPreset && !inCurrent) {
      added.push([key, presetRoutes[key]])
    } else if (inCurrent && !inPreset) {
      removed.push([key, currentMap[key]])
    } else if (inCurrent && inPreset && currentMap[key] !== presetRoutes[key]) {
      changed.push([key, currentMap[key], presetRoutes[key]])
    }
  }

  const hasChanges = added.length > 0 || removed.length > 0 || changed.length > 0

  return (
    <Dialog open onOpenChange={(isOpen) => !isOpen && onClose()}>
      <AppDialogContent className="max-w-2xl">
        <AppDialogHeader>
          <DialogTitle>{t('modelManagement.presets.diffTitle')}</DialogTitle>
          <DialogDescription>
            {t('modelManagement.presets.diffDescription', { name: preset.name })}
          </DialogDescription>
        </AppDialogHeader>
        <AppDialogBody>
          {!hasChanges ? (
            <p className="rounded-xl bg-secondary/50 py-8 text-center text-sm text-muted-foreground">
              {t('modelManagement.presets.diffEmpty')}
            </p>
          ) : (
            <div className="max-h-80 space-y-2 rounded-xl bg-secondary/50 p-3 text-sm">
              {added.map(([source, target]) => (
                <div
                  key={`add-${source}`}
                  className="flex items-center gap-2 rounded-xl bg-emerald-50 px-2 py-1.5 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200"
                >
                  <Badge variant="outline" className="border-emerald-300 text-xs dark:border-emerald-700">
                    {t('modelManagement.presets.diffAdded')}
                  </Badge>
                  <span className="truncate">{source}</span>
                  <ArrowRight className="h-3 w-3 flex-shrink-0" />
                  <span className="truncate">{target}</span>
                </div>
              ))}
              {removed.map(([source, target]) => (
                <div
                  key={`rm-${source}`}
                  className="flex items-center gap-2 rounded-xl bg-red-50 px-2 py-1.5 text-red-800 dark:bg-red-950 dark:text-red-200"
                >
                  <Badge variant="outline" className="border-red-300 text-xs dark:border-red-700">
                    {t('modelManagement.presets.diffRemoved')}
                  </Badge>
                  <span className="truncate">{source}</span>
                  <ArrowRight className="h-3 w-3 flex-shrink-0" />
                  <span className="truncate">{target}</span>
                </div>
              ))}
              {changed.map(([source, oldTarget, newTarget]) => (
                <div
                  key={`chg-${source}`}
                  className="flex items-center gap-2 rounded-xl bg-amber-50 px-2 py-1.5 text-amber-800 dark:bg-amber-950 dark:text-amber-200"
                >
                  <Badge variant="outline" className="border-amber-300 text-xs dark:border-amber-700">
                    {t('modelManagement.presets.diffChanged')}
                  </Badge>
                  <span className="truncate">{source}</span>
                  <ArrowRight className="h-3 w-3 flex-shrink-0" />
                  <span className="truncate line-through opacity-60">{oldTarget}</span>
                  <ArrowRight className="h-3 w-3 flex-shrink-0" />
                  <span className="truncate">{newTarget}</span>
                </div>
              ))}
            </div>
          )}
        </AppDialogBody>
        <AppDialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button onClick={() => onConfirm(endpoint, preset)} disabled={!hasChanges}>
            {t('modelManagement.presets.diffConfirm')}
          </Button>
        </AppDialogFooter>
      </AppDialogContent>
    </Dialog>
  )
}
