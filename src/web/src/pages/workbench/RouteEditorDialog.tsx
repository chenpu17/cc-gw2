import { useState } from 'react'
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
import type { CustomEndpoint, EndpointProtocol } from '@/types/endpoints'
import type { GatewayConfig, RoutingPreset } from '@/types/providers'
import { RouteEditor } from './RouteEditor'
import { getEndpointProtocolLabel, type ManagementTab } from './shared'
import type { RoutingState } from './useRoutingState'

/**
 * Large dialog hosting the per-endpoint RouteEditor. Opened from the routing
 * view's endpoint table (row click or the "routes" action) and deep-linkable
 * via `?tab=routing&endpoint=<id>`. Clicking outside must not close it —
 * unsaved route edits would be lost — so onInteractOutside is prevented;
 * Escape, the X and the close button still close it.
 */
export function RouteEditorDialog({
  endpoint,
  tabs,
  config,
  customEndpoints,
  routing,
  onRequestDeletePreset,
  onClose
}: {
  endpoint: string | null
  tabs: ManagementTab[]
  config: GatewayConfig | null
  customEndpoints: CustomEndpoint[]
  routing: RoutingState
  onRequestDeletePreset: (endpoint: string, preset: RoutingPreset) => void
  onClose: () => void
}) {
  const { t } = useTranslation()
  // Keep the last endpoint around so the dialog body stays populated during
  // the close animation instead of blanking out.
  const [lastEndpoint, setLastEndpoint] = useState<string | null>(endpoint)
  if (endpoint && endpoint !== lastEndpoint) {
    setLastEndpoint(endpoint)
  }
  const activeEndpoint = endpoint ?? lastEndpoint

  const tabInfo = activeEndpoint ? tabs.find((tab) => tab.key === activeEndpoint) : undefined
  const protocols = (tabInfo?.protocols ?? []) as EndpointProtocol[]
  const primaryProtocol = protocols.find((protocol) => protocol.startsWith('openai')) ?? protocols[0]
  const protocolLabel = primaryProtocol
    ? getEndpointProtocolLabel(primaryProtocol, t)
    : t('modelManagement.tabs.customEndpoint')
  const hasUnsavedChanges = activeEndpoint
    ? (routing.isDirtyByEndpoint[activeEndpoint] ?? false) ||
      (routing.isDefaultsDirtyByEndpoint[activeEndpoint] ?? false)
    : false

  return (
    // Non-modal on purpose: a modal dialog locks pointer events and scroll to
    // its own content (react-remove-scroll), which breaks the portaled
    // TargetCombobox popovers. The full-viewport overlay still blocks pointer
    // events to the page behind, and outside interaction does not dismiss a
    // non-modal dialog — Escape, the X and the close button still close it.
    <Dialog modal={false} open={endpoint !== null} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <AppDialogContent
        className="max-w-4xl"
        data-testid="route-editor-dialog"
        onInteractOutside={(event) => event.preventDefault()}
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        {activeEndpoint ? (
          <>
            <AppDialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <span className="truncate">{tabInfo?.label ?? activeEndpoint}</span>
                <Badge variant="outline" className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-normal">
                  {protocolLabel}
                </Badge>
              </DialogTitle>
              <DialogDescription className="truncate font-mono text-xs">
                {activeEndpoint}
              </DialogDescription>
            </AppDialogHeader>

            <AppDialogBody>
              <RouteEditor
                endpoint={activeEndpoint}
                tabInfo={tabInfo}
                config={config}
                customEndpoints={customEndpoints}
                routes={routing.routesByEndpoint[activeEndpoint] || []}
                routeError={routing.routeError[activeEndpoint]}
                savingRoute={routing.savingRouteFor === activeEndpoint}
                isDirty={routing.isDirtyByEndpoint[activeEndpoint] ?? false}
                defaults={routing.defaultsByEndpoint[activeEndpoint] ?? null}
                defaultsDirty={routing.isDefaultsDirtyByEndpoint[activeEndpoint] ?? false}
                savingDefaults={routing.savingDefaultsFor === activeEndpoint}
                presets={routing.presetsByEndpoint[activeEndpoint] ?? []}
                presetName={routing.presetNameByEndpoint[activeEndpoint] ?? ''}
                presetError={routing.presetErrorByEndpoint[activeEndpoint]}
                savingPreset={routing.savingPresetFor === activeEndpoint}
                applyingPreset={routing.applyingPreset?.endpoint === activeEndpoint ? routing.applyingPreset.name : null}
                deletingPreset={routing.deletingPreset?.endpoint === activeEndpoint ? routing.deletingPreset.name : null}
                presetsExpanded={routing.presetsExpanded[activeEndpoint] === true}
                savingCompatibilityPolicy={routing.savingCompatibilityPolicy}
                providerModelOptions={routing.providerModelOptions}
                onDefaultsChange={(field, value) => routing.handleDefaultsChange(activeEndpoint, field, value)}
                onSaveDefaults={() => void routing.handleSaveDefaults(activeEndpoint)}
                onTogglePresetsExpanded={() =>
                  routing.setPresetsExpanded((previous) => ({
                    ...previous,
                    [activeEndpoint]: !previous[activeEndpoint]
                  }))
                }
                onPresetNameChange={(value) => routing.handlePresetNameChange(activeEndpoint, value)}
                onSavePreset={() => void routing.handleSavePreset(activeEndpoint)}
                onRequestPresetDiff={(preset) => routing.setPresetDiffDialog({ endpoint: activeEndpoint, preset })}
                onRequestDeletePreset={(preset) => onRequestDeletePreset(activeEndpoint, preset)}
                onCompatibilityEnabledChange={(enabled) =>
                  void routing.handleCompatibilityEnabledChange(activeEndpoint, enabled)
                }
                onRouteChange={(id, field, value) => routing.handleRouteChange(activeEndpoint, id, field, value)}
                onRemoveRoute={(id) => routing.handleRemoveRoute(activeEndpoint, id)}
                onAddSuggestion={(model) => routing.handleAddSuggestion(activeEndpoint, model)}
                onAddRoute={() => routing.handleAddRoute(activeEndpoint)}
                onResetRoutes={() => routing.handleResetRoutes(activeEndpoint)}
                onSaveRoutes={() => void routing.handleSaveRoutes(activeEndpoint)}
              />
            </AppDialogBody>

            <AppDialogFooter>
              <p className="mr-auto self-center text-xs text-muted-foreground">
                {hasUnsavedChanges
                  ? t('modelManagement.actions.footerDirtyHint')
                  : t('modelManagement.actions.footerSavedHint')}
              </p>
              <Button variant="outline" onClick={onClose}>
                {t('common.actions.close')}
              </Button>
            </AppDialogFooter>
          </>
        ) : null}
      </AppDialogContent>
    </Dialog>
  )
}
