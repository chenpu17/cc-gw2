import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'
import { Boxes, GitBranch } from 'lucide-react'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { PageToolbar } from '@/components/PageToolbar'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { CustomEndpoint } from '@/types/endpoints'
import type { ConfirmAction } from './workbench/shared'
import { countProviderRouteReferences } from './workbench/shared'
import { useWorkbenchConfig } from './workbench/useWorkbenchConfig'
import { useRoutingState } from './workbench/useRoutingState'
import { useProvidersState } from './workbench/useProvidersState'
import { EndpointDialog } from './workbench/EndpointDialog'
import { ProviderDetailDialog } from './workbench/ProviderDetailDialog'
import { NoModelConfiguredDialog } from './workbench/NoModelConfiguredDialog'
import { PresetDiffDialog } from './workbench/PresetDiffDialog'
import { ProviderDrawer } from './workbench/ProviderDrawer'
import { ProvidersTable } from './workbench/ProvidersTable'
import { RouteEditorDialog } from './workbench/RouteEditorDialog'
import { RoutingWorkspace } from './workbench/RoutingWorkspace'
import { TestConnectionDialog } from './workbench/TestConnectionDialog'

type WorkbenchView = 'providers' | 'routing'

export default function ProvidersWorkbenchPage() {
  const { t } = useTranslation()
  const base = useWorkbenchConfig()
  const routing = useRoutingState(base)
  const providers = useProvidersState(base, {
    sanitizeDraftsForProvider: routing.sanitizeDraftsForProvider
  })

  const [searchParams, setSearchParams] = useSearchParams()
  const tabParam = searchParams.get('tab')
  // `tab=endpoints` is kept as a legacy alias of the routing view, which now
  // hosts the endpoint table itself.
  const view: WorkbenchView = tabParam === 'routing' || tabParam === 'endpoints' ? 'routing' : 'providers'

  useEffect(() => {
    if (tabParam !== 'endpoints') return
    setSearchParams((previous) => {
      const next = new URLSearchParams(previous)
      next.set('tab', 'routing')
      return next
    }, { replace: true })
  }, [tabParam, setSearchParams])

  const [endpointDialogOpen, setEndpointDialogOpen] = useState(false)
  const [editingEndpoint, setEditingEndpoint] = useState<CustomEndpoint | undefined>(undefined)
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null)
  const [confirmingAction, setConfirmingAction] = useState(false)

  // The route editor dialog is deep-linkable via `?tab=routing&endpoint=<id>`.
  const endpointParam = searchParams.get('endpoint')
  const [routeEditorEndpoint, setRouteEditorEndpoint] = useState<string | null>(endpointParam)

  useEffect(() => {
    setRouteEditorEndpoint(endpointParam)
  }, [endpointParam])

  const handleCloseRouteEditor = () => {
    setSearchParams((previous) => {
      const next = new URLSearchParams(previous)
      next.delete('endpoint')
      return next
    }, { replace: true })
  }

  // Close the dialog when its endpoint no longer exists (deleted, or a stale
  // deep link) once the endpoint list has loaded.
  useEffect(() => {
    if (!routeEditorEndpoint) return
    if (base.customEndpointsQuery.isPending) return
    if (routing.endpointTabs.some((tab) => tab.key === routeEditorEndpoint)) return
    handleCloseRouteEditor()
  }, [routeEditorEndpoint, routing.endpointTabs, base.customEndpointsQuery.isPending])

  const handleOpenCreateEndpoint = () => {
    setEditingEndpoint(undefined)
    setEndpointDialogOpen(true)
  }
  const handleOpenEditEndpoint = (endpoint: CustomEndpoint) => {
    setEditingEndpoint(endpoint)
    setEndpointDialogOpen(true)
  }
  const handleOpenRouteEditor = (endpointId: string) => {
    setSearchParams((previous) => {
      const next = new URLSearchParams(previous)
      next.set('tab', 'routing')
      next.set('endpoint', endpointId)
      return next
    }, { replace: true })
  }

  const handleViewChange = (nextView: WorkbenchView) => {
    // The provider detail dialog only belongs to the providers view.
    providers.setSelectedProviderId(null)
    setSearchParams((previous) => {
      const next = new URLSearchParams(previous)
      if (nextView === 'providers') {
        next.delete('tab')
      } else {
        next.set('tab', nextView)
      }
      return next
    }, { replace: true })
  }

  const handleGoToRouting = () => {
    setSearchParams((previous) => {
      const next = new URLSearchParams(previous)
      next.set('tab', 'routing')
      return next
    }, { replace: true })
  }

  const handleConfirmDialog = async () => {
    if (!confirmAction) return

    setConfirmingAction(true)
    try {
      if (confirmAction.kind === 'provider') {
        await providers.handleDeleteProvider(confirmAction.provider)
      } else if (confirmAction.kind === 'preset') {
        await routing.handleDeletePreset(confirmAction.endpoint, confirmAction.preset)
      } else {
        await routing.handleDeleteEndpoint(confirmAction.endpoint.id)
      }
      setConfirmAction(null)
    } finally {
      setConfirmingAction(false)
    }
  }

  const providerRouteImpact =
    confirmAction?.kind === 'provider'
      ? countProviderRouteReferences(base.config, base.customEndpoints, confirmAction.provider.id)
      : 0

  const confirmDialogTitle =
    confirmAction?.kind === 'provider'
      ? t('providers.actions.delete')
      : confirmAction?.kind === 'preset'
        ? t('modelManagement.presets.delete')
        : confirmAction?.kind === 'endpoint'
          ? t('common.delete')
          : ''

  const confirmDialogDescription =
    confirmAction?.kind === 'provider'
      ? t('providers.confirm.delete', { name: confirmAction.provider.label || confirmAction.provider.id })
      : confirmAction?.kind === 'preset'
        ? t('modelManagement.confirm.deletePreset', { name: confirmAction.preset.name })
        : confirmAction?.kind === 'endpoint'
          ? t('modelManagement.deleteEndpointConfirm', { label: confirmAction.endpoint.label })
          : ''

  const confirmDialogName =
    confirmAction?.kind === 'provider'
      ? confirmAction.provider.label || confirmAction.provider.id
      : confirmAction?.kind === 'preset'
        ? confirmAction.preset.name
        : confirmAction?.kind === 'endpoint'
          ? confirmAction.endpoint.label
          : ''

  const selectedProvider = providers.selectedProvider

  const routeRuleCount = Object.values(routing.routesByEndpoint).reduce(
    (sum, routes) => sum + (routes?.length ?? 0),
    0
  )

  const endpointRouteCounts = Object.fromEntries(
    Object.entries(routing.routesByEndpoint).map(([endpoint, routes]) => [endpoint, routes?.length ?? 0])
  )

  const viewTabs = [
    {
      value: 'providers' as const,
      icon: Boxes,
      label: t('workbench.viewSwitch.providers'),
      description: t('workbench.viewSwitch.providersDesc'),
      count: providers.providerCount
    },
    {
      value: 'routing' as const,
      icon: GitBranch,
      label: t('workbench.viewSwitch.routing'),
      description: t('workbench.viewSwitch.routingDesc'),
      count: routeRuleCount
    }
  ]

  return (
    <div className="flex flex-col gap-6">
      <PageToolbar
        actions={view === 'providers' ? (
          <Button size="sm" onClick={providers.handleOpenCreate}>
            {t('providers.actions.add')}
          </Button>
        ) : (
          <Button size="sm" onClick={handleOpenCreateEndpoint}>
            {t('workbench.endpoints.create')}
          </Button>
        )}
      />

      <div role="tablist" aria-label={t('workbench.viewSwitch.label')} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {viewTabs.map((tab) => {
          const Icon = tab.icon
          const isActive = view === tab.value
          return (
            <button
              key={tab.value}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => handleViewChange(tab.value)}
              className={cn(
                'motion-surface flex items-center gap-3 rounded-xl border p-4 text-left',
                isActive
                  ? 'border-primary/40 bg-primary/5'
                  : 'border-border bg-card hover:bg-muted/40'
              )}
            >
              <span
                className={cn(
                  'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
                  isActive ? 'bg-primary/10 text-primary' : 'bg-secondary text-muted-foreground'
                )}
              >
                <Icon className="h-5 w-5" aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className={cn('text-sm font-semibold', isActive ? 'text-foreground' : 'text-muted-foreground')}>
                    {tab.label}
                  </span>
                  <Badge variant={isActive ? 'default' : 'secondary'} className="text-[10px]">
                    {tab.count}
                  </Badge>
                </span>
                <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                  {tab.description}
                </span>
              </span>
            </button>
          )
        })}
      </div>

      {view === 'providers' ? (
        <ProvidersTable
          configPending={base.configQuery.isPending || (!base.config && base.configQuery.isFetching)}
          testResults={providers.testResults}
          filteredProviders={providers.filteredProviders}
          providerSearch={providers.providerSearch}
          providerTypeFilter={providers.providerTypeFilter}
          providersLength={providers.providers.length}
          defaultLabels={providers.defaultLabels}
          onSelect={(provider) => providers.setSelectedProviderId(provider.id)}
          onProviderSearchChange={providers.setProviderSearch}
          onProviderTypeChange={providers.setProviderTypeFilter}
          onResetFilters={() => {
            providers.setProviderSearch('')
            providers.setProviderTypeFilter('all')
          }}
        />
      ) : (
        <RoutingWorkspace
          tabs={routing.endpointTabs}
          customEndpoints={base.customEndpoints}
          routeCounts={endpointRouteCounts}
          defaultsByEndpoint={routing.defaultsByEndpoint}
          onEditRoute={handleOpenRouteEditor}
          onEditEndpoint={handleOpenEditEndpoint}
          onDeleteEndpoint={(endpoint) => setConfirmAction({ kind: 'endpoint', endpoint })}
        />
      )}

      <RouteEditorDialog
        endpoint={routeEditorEndpoint}
        tabs={routing.endpointTabs}
        config={base.config}
        customEndpoints={base.customEndpoints}
        routing={routing}
        onRequestDeletePreset={(endpoint, preset) => setConfirmAction({ kind: 'preset', endpoint, preset })}
        onClose={handleCloseRouteEditor}
      />

      <ProviderDetailDialog
        provider={selectedProvider}
        defaultModel={selectedProvider ? providers.defaultLabels.get(selectedProvider.id) : undefined}
        config={base.config}
        customEndpoints={base.customEndpoints}
        tabs={base.tabs}
        testResult={selectedProvider ? providers.testResults[selectedProvider.id] ?? null : null}
        isTesting={selectedProvider ? providers.testingProviderId === selectedProvider.id : false}
        onClose={() => providers.setSelectedProviderId(null)}
        onEdit={() => {
          if (selectedProvider) {
            // Close the dialog first so the edit drawer can take focus.
            providers.setSelectedProviderId(null)
            providers.handleOpenEdit(selectedProvider)
          }
        }}
        onTest={() => {
          if (selectedProvider) providers.initiateTestConnection(selectedProvider)
        }}
        onDelete={() => {
          if (selectedProvider) setConfirmAction({ kind: 'provider', provider: selectedProvider })
        }}
        onViewRoute={(endpoint) => {
          providers.setSelectedProviderId(null)
          handleOpenRouteEditor(endpoint)
        }}
        onAddRule={() => {
          providers.setSelectedProviderId(null)
          handleGoToRouting()
        }}
      />

      <ProviderDrawer
        open={providers.drawerOpen}
        mode={providers.drawerMode}
        provider={providers.drawerMode === 'edit' ? providers.editingProvider : undefined}
        existingProviderIds={providers.providers
          .map((item) => item.id)
          .filter((id) => (providers.drawerMode === 'edit' && providers.editingProvider ? id !== providers.editingProvider.id : true))}
        testResult={providers.editingProvider ? providers.testResults[providers.editingProvider.id] ?? null : null}
        testing={providers.editingProvider ? providers.testingProviderId === providers.editingProvider.id : false}
        onTest={() => {
          if (providers.editingProvider) {
            void providers.handleTestConnection(providers.editingProvider)
          }
        }}
        onClose={() => {
          providers.setDrawerOpen(false)
          providers.setEditingProvider(undefined)
          providers.setDrawerMode('create')
        }}
        onSubmit={providers.handleProviderSubmit}
      />

      <TestConnectionDialog
        open={providers.testDialogOpen}
        provider={providers.testDialogProvider}
        options={providers.anthropicTestHeaderOptions}
        preservedExtras={providers.testDialogPreservedExtras}
        usePreset={providers.testDialogUsePreset}
        onPresetChange={providers.setTestDialogUsePreset}
        onConfirm={providers.confirmTestDialog}
        onClose={providers.closeTestDialog}
      />

      <NoModelConfiguredDialog
        open={!!providers.noModelDialogProvider}
        provider={providers.noModelDialogProvider}
        onClose={() => providers.setNoModelDialogProvider(null)}
        onEdit={(provider) => {
          providers.setNoModelDialogProvider(null)
          providers.handleOpenEdit(provider)
        }}
      />

      <EndpointDialog
        open={endpointDialogOpen}
        endpoint={editingEndpoint}
        onClose={() => {
          setEndpointDialogOpen(false)
          setEditingEndpoint(undefined)
        }}
        onSuccess={() => {
          void base.configQuery.refetch()
        }}
      />

      <PresetDiffDialog
        dialog={routing.presetDiffDialog}
        currentRoutes={routing.presetDiffDialog ? routing.routesByEndpoint[routing.presetDiffDialog.endpoint] || [] : []}
        onConfirm={(endpoint, preset) => {
          routing.setPresetDiffDialog(null)
          void routing.handleApplyPreset(endpoint, preset)
        }}
        onClose={() => routing.setPresetDiffDialog(null)}
      />

      <ConfirmDialog
        open={!!confirmAction}
        onOpenChange={(open) => {
          if (!open && !confirmingAction) {
            setConfirmAction(null)
          }
        }}
        title={confirmDialogTitle}
        description={confirmDialogDescription}
        confirmLabel={confirmingAction ? t('common.actions.loading') : t('common.delete')}
        cancelLabel={t('common.actions.cancel')}
        loading={confirmingAction}
        onConfirm={handleConfirmDialog}
      >
        {confirmDialogName ? (
          <div className="space-y-2">
            <div className="rounded-xl border border-destructive/20 bg-destructive/5 px-3 py-2 font-mono text-xs text-foreground">
              {confirmDialogName}
            </div>
            {confirmAction?.kind === 'provider' && providerRouteImpact > 0 ? (
              <p className="text-xs text-muted-foreground">
                {t('providers.confirm.deleteImpact', { count: providerRouteImpact })}
              </p>
            ) : null}
          </div>
        ) : null}
      </ConfirmDialog>
    </div>
  )
}
