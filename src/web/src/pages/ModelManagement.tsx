import { Layers } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import { ProviderDrawer } from './providers/ProviderDrawer'
import { EndpointDrawer } from './model-management/EndpointDrawer'
import { ModelManagementOverviewCard } from './model-management/ModelManagementOverviewCard'
import { PresetDiffDialog } from './model-management/PresetDiffDialog'
import { ProvidersWorkspace } from './model-management/ProvidersWorkspace'
import { RoutingWorkspace } from './model-management/RoutingWorkspace'
import { TestConnectionDialog } from './model-management/TestConnectionDialog'
import { useModelManagementState } from './model-management/useModelManagementState'

export default function ModelManagementPage() {
  const { t } = useTranslation()
  const state = useModelManagementState()
  const dirtyCount = Object.values(state.isDirtyByEndpoint).filter(Boolean).length
  const workspaceCount = Math.max(0, state.systemTabs.length - 1) + state.customTabs.length
  const headerHelper = state.activeTab === 'providers'
    ? t('modelManagement.header.providersHelper')
    : t('modelManagement.header.routingHelper', { name: state.activeTabInfo?.label ?? state.activeTab })

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        icon={<Layers className="h-5 w-5" aria-hidden="true" />}
        title={t('modelManagement.title')}
        description={t('modelManagement.description')}
        eyebrow="Routing Control"
        breadcrumb="Gateway / Model Management"
        helper={headerHelper}
        badge={dirtyCount > 0 ? t('modelManagement.overview.unsavedCount', { count: dirtyCount }) : undefined}
        actions={(
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:justify-end">
            <div className="rounded-2xl border border-border/70 bg-background/80 px-3 py-2 text-xs text-muted-foreground">
              {t('modelManagement.tabs.providers')}
              {' · '}
              {state.providerCount}
              {' / '}
              {t('modelManagement.overview.routeWorkspacesStat')}
              {' · '}
              {workspaceCount}
            </div>
            <Button onClick={state.handleOpenCreateEndpoint} className="w-full sm:w-auto">
              {t('modelManagement.addEndpoint')}
            </Button>
          </div>
        )}
      />

      <ModelManagementOverviewCard
        activeTab={state.activeTab}
        activeTabInfo={state.activeTabInfo}
        customEndpoints={state.customEndpoints}
        customTabs={state.customTabs}
        isDirtyByEndpoint={state.isDirtyByEndpoint}
        onDeleteEndpoint={state.setConfirmAction}
        onEditEndpoint={state.handleOpenEditEndpoint}
        onSelectTab={state.setActiveTab}
        providerCount={state.providerCount}
        systemTabs={state.systemTabs}
      />

      {state.activeTab === 'providers' ? (
        <ProvidersWorkspace
          configPending={state.configQuery.isPending || (!state.config && state.configQuery.isFetching)}
          configFetching={state.configQuery.isFetching}
          defaultLabels={state.defaultLabels}
          filteredProviders={state.filteredProviders}
          onOpenCreate={state.handleOpenCreate}
          onOpenEdit={state.handleOpenEdit}
          onRefresh={() => void state.configQuery.refetch()}
          onRequestDelete={(provider: typeof state.filteredProviders[number]) => state.setConfirmAction({ kind: 'provider', provider })}
          onResetFilters={() => {
            state.setProviderSearch('')
            state.setProviderTypeFilter('all')
          }}
          onProviderSearchChange={state.setProviderSearch}
          onProviderTypeChange={state.setProviderTypeFilter}
          onTestConnection={state.initiateTestConnection}
          providerCount={state.providerCount}
          providerSearch={state.providerSearch}
          providerTypeFilter={state.providerTypeFilter}
          providersLength={state.providers.length}
          testingProviderId={state.testingProviderId}
        />
      ) : (
        <RoutingWorkspace
          endpoint={state.activeTab}
          applyingPreset={state.applyingPreset?.endpoint === state.activeTab ? state.applyingPreset.name : null}
          config={state.config}
          customEndpoints={state.customEndpoints}
          deletingPreset={state.deletingPreset?.endpoint === state.activeTab ? state.deletingPreset.name : null}
          isDirty={state.isDirtyByEndpoint[state.activeTab] ?? false}
          onAddRoute={() => state.handleAddRoute(state.activeTab)}
          onAddSuggestion={(model) => state.handleAddSuggestion(state.activeTab, model)}
          onPresetNameChange={(value) => state.handlePresetNameChange(state.activeTab, value)}
          onRequestDeletePreset={(preset) => state.setConfirmAction({ kind: 'preset', endpoint: state.activeTab, preset })}
          onRequestPresetDiff={(preset) => state.setPresetDiffDialog({ endpoint: state.activeTab, preset })}
          onRemoveRoute={(id) => state.handleRemoveRoute(state.activeTab, id)}
          onResetRoutes={() => state.handleResetRoutes(state.activeTab)}
          onRouteChange={(id, field, value) => state.handleRouteChange(state.activeTab, id, field, value)}
          onSavePreset={() => void state.handleSavePreset(state.activeTab)}
          onSaveRoutes={() => void state.handleSaveRoutes(state.activeTab)}
          onToggleClaudeValidation={(enabled) => void state.handleToggleClaudeValidation(state.activeTab, enabled)}
          onTogglePresetsExpanded={() => state.setPresetsExpanded((previous) => ({ ...previous, [state.activeTab]: !previous[state.activeTab] }))}
          presetError={state.presetErrorByEndpoint[state.activeTab]}
          presetName={state.presetNameByEndpoint[state.activeTab] ?? ''}
          presets={state.presetsByEndpoint[state.activeTab] ?? []}
          presetsExpanded={state.presetsExpanded[state.activeTab] === true}
          providerModelOptions={state.providerModelOptions}
          routeError={state.routeError[state.activeTab]}
          routes={state.routesByEndpoint[state.activeTab] || []}
          savingClaudeValidation={state.savingClaudeValidation}
          savingPreset={state.savingPresetFor === state.activeTab}
          savingRoute={state.savingRouteFor === state.activeTab}
          tabs={state.tabs}
        />
      )}

      <ProviderDrawer
        open={state.drawerOpen}
        mode={state.drawerMode}
        provider={state.drawerMode === 'edit' ? state.editingProvider : undefined}
        existingProviderIds={state.providers
          .map((item) => item.id)
          .filter((id) => (state.drawerMode === 'edit' && state.editingProvider ? id !== state.editingProvider.id : true))}
        onClose={() => {
          state.setDrawerOpen(false)
          state.setEditingProvider(undefined)
          state.setDrawerMode('create')
        }}
        onSubmit={state.handleProviderSubmit}
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

      <TestConnectionDialog
        open={state.testDialogOpen}
        provider={state.testDialogProvider}
        options={state.anthropicTestHeaderOptions}
        preservedExtras={state.testDialogPreservedExtras}
        usePreset={state.testDialogUsePreset}
        onPresetChange={state.setTestDialogUsePreset}
        onConfirm={state.confirmTestDialog}
        onClose={state.closeTestDialog}
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
