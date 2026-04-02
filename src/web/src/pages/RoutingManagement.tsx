import { GitBranch, Layers } from 'lucide-react'
import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import { EndpointDrawer } from './model-management/EndpointDrawer'
import { ModelManagementOverviewCard } from './model-management/ModelManagementOverviewCard'
import { PresetDiffDialog } from './model-management/PresetDiffDialog'
import { RoutingWorkspace } from './model-management/RoutingWorkspace'
import { useModelManagementState } from './model-management/useModelManagementState'

export default function RoutingManagementPage() {
  const { t } = useTranslation()
  const state = useModelManagementState()
  const routingSystemTabs = state.systemTabs.filter((tab) => tab.key !== 'providers')
  const currentEndpoint = state.activeTab === 'providers' ? 'anthropic' : state.activeTab
  const currentTabInfo = state.tabs.find((tab) => tab.key === currentEndpoint) ?? null

  useEffect(() => {
    if (state.activeTab === 'providers') {
      state.setActiveTab('anthropic')
    }
  }, [state.activeTab, state.setActiveTab])

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        icon={<GitBranch className="h-5 w-5" aria-hidden="true" />}
        title={t('routingManagement.title')}
        description={t('routingManagement.description')}
        eyebrow={t('routingManagement.eyebrow')}
        breadcrumb="Gateway / Routing"
        badge={currentTabInfo?.label ?? currentEndpoint}
        actions={(
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:justify-end">
            <Button asChild variant="outline" className="w-full sm:w-auto">
              <Link to="/models">
                <Layers className="h-4 w-4" aria-hidden="true" />
                {t('nav.models')}
              </Link>
            </Button>
            <Button onClick={state.handleOpenCreateEndpoint} className="w-full sm:w-auto">
              {t('modelManagement.addEndpoint')}
            </Button>
          </div>
        )}
      />

      <ModelManagementOverviewCard
        activeTab={currentEndpoint}
        customEndpoints={state.customEndpoints}
        customTabs={state.customTabs}
        isDirtyByEndpoint={state.isDirtyByEndpoint}
        onDeleteEndpoint={state.setConfirmAction}
        onEditEndpoint={state.handleOpenEditEndpoint}
        onSelectTab={state.setActiveTab}
        systemTabs={routingSystemTabs}
      />

      <RoutingWorkspace
        endpoint={currentEndpoint}
        applyingPreset={state.applyingPreset?.endpoint === currentEndpoint ? state.applyingPreset.name : null}
        config={state.config}
        customEndpoints={state.customEndpoints}
        deletingPreset={state.deletingPreset?.endpoint === currentEndpoint ? state.deletingPreset.name : null}
        isDirty={state.isDirtyByEndpoint[currentEndpoint] ?? false}
        onAddRoute={() => state.handleAddRoute(currentEndpoint)}
        onAddSuggestion={(model) => state.handleAddSuggestion(currentEndpoint, model)}
        onPresetNameChange={(value) => state.handlePresetNameChange(currentEndpoint, value)}
        onRequestDeletePreset={(preset) => state.setConfirmAction({ kind: 'preset', endpoint: currentEndpoint, preset })}
        onRequestPresetDiff={(preset) => state.setPresetDiffDialog({ endpoint: currentEndpoint, preset })}
        onRemoveRoute={(id) => state.handleRemoveRoute(currentEndpoint, id)}
        onResetRoutes={() => state.handleResetRoutes(currentEndpoint)}
        onRouteChange={(id, field, value) => state.handleRouteChange(currentEndpoint, id, field, value)}
        onSavePreset={() => void state.handleSavePreset(currentEndpoint)}
        onSaveRoutes={() => void state.handleSaveRoutes(currentEndpoint)}
        onValidationModeChange={(mode) => void state.handleValidationModeChange(currentEndpoint, mode)}
        onTogglePresetsExpanded={() => state.setPresetsExpanded((previous) => ({ ...previous, [currentEndpoint]: !previous[currentEndpoint] }))}
        presetError={state.presetErrorByEndpoint[currentEndpoint]}
        presetName={state.presetNameByEndpoint[currentEndpoint] ?? ''}
        presets={state.presetsByEndpoint[currentEndpoint] ?? []}
        presetsExpanded={state.presetsExpanded[currentEndpoint] === true}
        providerModelOptions={state.providerModelOptions}
        routeError={state.routeError[currentEndpoint]}
        routes={state.routesByEndpoint[currentEndpoint] || []}
        savingClaudeValidation={state.savingClaudeValidation}
        savingPreset={state.savingPresetFor === currentEndpoint}
        savingRoute={state.savingRouteFor === currentEndpoint}
        tabs={state.tabs.filter((tab) => tab.key !== 'providers')}
      />

      <EndpointDrawer
        open={state.endpointDrawerOpen}
        endpoint={state.editingEndpoint}
        onClose={() => {
          state.setEndpointDrawerOpen(false)
          state.setEditingEndpoint(undefined)
        }}
        onSuccess={() => {
          void state.configQuery.refetch()
        }}
      />

      <PresetDiffDialog
        dialog={state.presetDiffDialog}
        currentRoutes={state.presetDiffDialog ? state.routesByEndpoint[state.presetDiffDialog.endpoint] || [] : []}
        onConfirm={(endpoint, preset) => {
          state.setPresetDiffDialog(null)
          void state.handleApplyPreset(endpoint, preset)
        }}
        onClose={() => state.setPresetDiffDialog(null)}
      />

      <ConfirmDialog
        open={!!state.confirmAction}
        onOpenChange={(open) => {
          if (!open && !state.confirmingAction) {
            state.setConfirmAction(null)
          }
        }}
        title={state.confirmDialogTitle}
        description={state.confirmDialogDescription}
        confirmLabel={state.confirmingAction ? t('common.actions.loading') : t('common.delete')}
        cancelLabel={t('common.actions.cancel')}
        loading={state.confirmingAction}
        onConfirm={state.handleConfirmDialog}
      >
        {state.confirmDialogName ? (
          <div className="rounded-[1rem] border border-destructive/20 bg-destructive/5 px-3 py-2 font-mono text-xs text-foreground">
            {state.confirmDialogName}
          </div>
        ) : null}
      </ConfirmDialog>
    </div>
  )
}
