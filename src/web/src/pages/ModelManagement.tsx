import { ArrowRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { PageToolbar } from '@/components/PageToolbar'
import { Button } from '@/components/ui/button'
import { NoModelConfiguredDialog } from './model-management/NoModelConfiguredDialog'
import { ProvidersWorkspace } from './model-management/ProvidersWorkspace'
import { TestConnectionDialog } from './model-management/TestConnectionDialog'
import { useModelManagementState } from './model-management/useModelManagementState'
import { ProviderDrawer } from './providers/ProviderDrawer'

export default function ModelManagementPage() {
  const { t } = useTranslation()
  const state = useModelManagementState()

  return (
    <div className="flex flex-col gap-6">
      <PageToolbar
        info={
          <span className="rounded-full bg-secondary px-2.5 py-1 text-xs text-muted-foreground">
            {t('providers.count', { count: state.providerCount })}
          </span>
        }
        actions={(
          <>
            <Button asChild variant="outline" size="sm">
              <Link to="/routing">
                {t('nav.routing')}
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </Button>
            <Button size="sm" onClick={state.handleOpenCreate}>
              {t('providers.actions.add')}
            </Button>
          </>
        )}
      />

      <ProvidersWorkspace
        configPending={state.configQuery.isPending || (!state.config && state.configQuery.isFetching)}
        defaultLabels={state.defaultLabels}
        filteredProviders={state.filteredProviders}
        onOpenEdit={state.handleOpenEdit}
        onRequestDelete={(provider: typeof state.filteredProviders[number]) => state.setConfirmAction({ kind: 'provider', provider })}
        onResetFilters={() => {
          state.setProviderSearch('')
          state.setProviderTypeFilter('all')
        }}
        onProviderSearchChange={state.setProviderSearch}
        onProviderTypeChange={state.setProviderTypeFilter}
        onTestConnection={state.initiateTestConnection}
        providerSearch={state.providerSearch}
        providerTypeFilter={state.providerTypeFilter}
        providersLength={state.providers.length}
        testingProviderId={state.testingProviderId}
      />

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

      <NoModelConfiguredDialog
        open={!!state.noModelDialogProvider}
        provider={state.noModelDialogProvider}
        onClose={() => state.setNoModelDialogProvider(null)}
        onEdit={(provider) => {
          state.setNoModelDialogProvider(null)
          state.handleOpenEdit(provider)
        }}
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
          <div className="rounded-xl border border-destructive/20 bg-destructive/5 px-3 py-2 font-mono text-xs text-foreground">
            {state.confirmDialogName}
          </div>
        ) : null}
      </ConfirmDialog>
    </div>
  )
}
