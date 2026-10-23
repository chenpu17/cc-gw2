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
import type { ModelRouteEntry, RouteScope } from './shared'
import { collectPresetRoutes, getRouteScopeLabel } from './shared'

interface DiffRoute {
  key: string
  source: string
  scope: RouteScope
  target: string
}

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

  const currentMap = new Map<string, DiffRoute>()
  for (const entry of currentRoutes) {
    const source = entry.source.trim()
    const target = entry.target.trim()
    if (source && target) {
      const scope = entry.scope ?? 'all'
      currentMap.set(`${scope}:${source}`, { key: `${scope}:${source}`, source, scope, target })
    }
  }
  const presetMap = new Map<string, DiffRoute>()
  for (const route of collectPresetRoutes(preset)) {
    presetMap.set(`${route.scope}:${route.source}`, { key: `${route.scope}:${route.source}`, ...route })
  }

  const allKeys = new Set([...currentMap.keys(), ...presetMap.keys()])
  const added: DiffRoute[] = []
  const removed: DiffRoute[] = []
  const changed: Array<{ current: DiffRoute; next: DiffRoute }> = []

  for (const key of allKeys) {
    const current = currentMap.get(key)
    const next = presetMap.get(key)
    if (next && !current) {
      added.push(next)
    } else if (current && !next) {
      removed.push(current)
    } else if (current && next && current.target !== next.target) {
      changed.push({ current, next })
    }
  }

  const hasChanges = added.length > 0 || removed.length > 0 || changed.length > 0

  const scopeBadge = (scope: RouteScope) =>
    scope === 'all' ? null : (
      <Badge variant="secondary" className="shrink-0 text-[10px] font-normal">
        {getRouteScopeLabel(scope, t)}
      </Badge>
    )

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
              {added.map((route) => (
                <div
                  key={`add-${route.key}`}
                  className="flex items-center gap-2 rounded-xl bg-success-bg px-2 py-1.5 text-success"
                >
                  <Badge variant="outline" className="border-success/30 text-xs">
                    {t('modelManagement.presets.diffAdded')}
                  </Badge>
                  {scopeBadge(route.scope)}
                  <span className="truncate">{route.source}</span>
                  <ArrowRight className="h-3 w-3 flex-shrink-0" />
                  <span className="truncate">{route.target}</span>
                </div>
              ))}
              {removed.map((route) => (
                <div
                  key={`rm-${route.key}`}
                  className="flex items-center gap-2 rounded-xl bg-error-bg px-2 py-1.5 text-error"
                >
                  <Badge variant="outline" className="border-error/30 text-xs">
                    {t('modelManagement.presets.diffRemoved')}
                  </Badge>
                  {scopeBadge(route.scope)}
                  <span className="truncate">{route.source}</span>
                  <ArrowRight className="h-3 w-3 flex-shrink-0" />
                  <span className="truncate">{route.target}</span>
                </div>
              ))}
              {changed.map(({ current, next }) => (
                <div
                  key={`chg-${next.key}`}
                  className="flex items-center gap-2 rounded-xl bg-warning-bg px-2 py-1.5 text-warning"
                >
                  <Badge variant="outline" className="border-warning/30 text-xs">
                    {t('modelManagement.presets.diffChanged')}
                  </Badge>
                  {scopeBadge(next.scope)}
                  <span className="truncate">{next.source}</span>
                  <ArrowRight className="h-3 w-3 flex-shrink-0" />
                  <span className="truncate line-through opacity-60">{current.target}</span>
                  <ArrowRight className="h-3 w-3 flex-shrink-0" />
                  <span className="truncate">{next.target}</span>
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
