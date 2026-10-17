import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useBlocker, useSearchParams } from 'react-router-dom'
import { Boxes, GitBranch } from 'lucide-react'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { PageToolbar } from '@/components/PageToolbar'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { storageKeys } from '@/services/storageKeys'
import type { CustomEndpoint } from '@/types/endpoints'
import type { ConfirmAction } from './workbench/shared'
import { countProviderRouteReferences } from './workbench/shared'
import { useWorkbenchConfig } from './workbench/useWorkbenchConfig'
import { useRoutingState } from './workbench/useRoutingState'
import { useProvidersState } from './workbench/useProvidersState'
import { CreateProviderDialog } from './workbench/CreateProviderDialog'
import { EndpointDialog } from './workbench/EndpointDialog'
import { NoModelConfiguredDialog } from './workbench/NoModelConfiguredDialog'
import { PresetDiffDialog } from './workbench/PresetDiffDialog'
import { ProvidersMasterDetail } from './workbench/ProvidersMasterDetail'
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
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  // Unsaved inline-draft flag from the providers detail panel, guarding the
  // view switch (the panel unmounts when the view changes).
  const [providersPanelDirty, setProvidersPanelDirty] = useState(false)
  // Mirror of the flag for async callbacks: the post-create auto-select runs
  // in a .then() after the config refetch — reading the state there sees the
  // value captured at creation time, so edits started while the refetch is in
  // flight must be visible via the ref, updated synchronously here.
  const providersPanelDirtyRef = useRef(false)
  const handlePanelDirtyChange = useCallback((dirty: boolean) => {
    providersPanelDirtyRef.current = dirty
    setProvidersPanelDirty(dirty)
  }, [])
  // Creating a provider auto-selects it, which unmounts the previous dirty
  // panel without touching the URL — the blocker below cannot see it.
  const [pendingCreatedProvider, setPendingCreatedProvider] = useState<string | null>(null)

  // Draft guard for SPA navigation. Covers both route leaves (sidebar links)
  // and same-path view switches via the `tab` search param — a browser-back
  // from the provider panel to `?tab=routing` is a POP that never goes
  // through the tab buttons, so the guard must live here at the router level
  // rather than in a click handler. Tab clicks and history pops share this
  // single confirm. beforeunload still covers full page exits. Requires the
  // data router in app/router.tsx.
  const viewOfSearch = (search: string): WorkbenchView => {
    const tab = new URLSearchParams(search).get('tab')
    return tab === 'routing' || tab === 'endpoints' ? 'routing' : 'providers'
  }
  const routeBlocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      providersPanelDirty
      && (currentLocation.pathname !== nextLocation.pathname
        || viewOfSearch(currentLocation.search) !== viewOfSearch(nextLocation.search))
  )

  // Providers-view selection is deep-linkable via session state only — the
  // chosen detail panel persists across reloads via localStorage.
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null
    return window.localStorage.getItem(storageKeys.workbench.providerSelection)
  })

  // Providers that should open straight in edit mode (freshly created, or an
  // external edit intent like the no-model dialog). Cleared once the
  // selection moves elsewhere so revisiting them later opens the profile.
  const [autoEditProviderId, setAutoEditProviderId] = useState<string | null>(null)
  useEffect(() => {
    if (autoEditProviderId && selectedProviderId !== autoEditProviderId) {
      setAutoEditProviderId(null)
    }
  }, [autoEditProviderId, selectedProviderId])

  useEffect(() => {
    if (!selectedProviderId) {
      window.localStorage.removeItem(storageKeys.workbench.providerSelection)
      return
    }
    window.localStorage.setItem(storageKeys.workbench.providerSelection, selectedProviderId)
  }, [selectedProviderId])

  // Clear a stale selection once the config has loaded and settled (deleted
  // provider or a hand-edited config that no longer contains it). While a
  // refetch is in flight the list may not contain a just-created provider.
  useEffect(() => {
    if (!selectedProviderId) return
    if (base.configQuery.isPending || base.configQuery.isFetching) return
    if (providers.providers.some((item) => item.id === selectedProviderId)) return
    setSelectedProviderId(null)
  }, [selectedProviderId, providers.providers, base.configQuery.isPending, base.configQuery.isFetching])

  // The selected routing endpoint is deep-linkable via `?tab=routing&endpoint=<id>`.
  // (Was the route editor dialog; now selects the endpoint in the col-1 rail.)
  const endpointParam = searchParams.get('endpoint')
  const [selectedEndpointId, setSelectedEndpointId] = useState<string | null>(endpointParam)

  useEffect(() => {
    setSelectedEndpointId(endpointParam)
  }, [endpointParam])

  const handleSelectEndpoint = (endpointId: string) => {
    setSearchParams((previous) => {
      const next = new URLSearchParams(previous)
      next.set('tab', 'routing')
      next.set('endpoint', endpointId)
      return next
    }, { replace: true })
  }

  const handleClearEndpointSelection = () => {
    setSearchParams((previous) => {
      const next = new URLSearchParams(previous)
      next.delete('endpoint')
      return next
    }, { replace: true })
  }

  // Clear the selection when its endpoint no longer exists (deleted, or a stale
  // deep link) once the endpoint list has loaded.
  useEffect(() => {
    if (!selectedEndpointId) return
    if (base.customEndpointsQuery.isPending) return
    if (routing.endpointTabs.some((tab) => tab.key === selectedEndpointId)) return
    handleClearEndpointSelection()
  }, [selectedEndpointId, routing.endpointTabs, base.customEndpointsQuery.isPending])

  const handleOpenCreateEndpoint = () => {
    setEditingEndpoint(undefined)
    setEndpointDialogOpen(true)
  }
  const handleOpenEditEndpoint = (endpoint: CustomEndpoint) => {
    setEditingEndpoint(endpoint)
    setEndpointDialogOpen(true)
  }
  // Tab clicks go straight through applyViewChange (below): when a dirty
  // provider panel would unmount, the route blocker intercepts the
  // search-param navigation and shows the shared confirm — the same path
  // browser-back takes, so click and history navigation can't diverge.

  const applyViewChange = (nextView: WorkbenchView) => {
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
          <Button size="sm" onClick={() => setCreateDialogOpen(true)}>
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
              onClick={() => applyViewChange(tab.value)}
              className={cn(
                'motion-surface flex items-center gap-3 rounded-xl border p-4 text-left',
                isActive
                  ? 'border-foreground bg-secondary'
                  : 'border-border bg-card hover:bg-muted/40'
              )}
            >
              <span
                className={cn(
                  'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
                  isActive ? 'bg-foreground text-background' : 'bg-secondary text-muted-foreground'
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
        <ProvidersMasterDetail
          providers={providers}
          configPending={base.configQuery.isPending || (!base.config && base.configQuery.isFetching)}
          selectedProviderId={selectedProviderId}
          onSelectProvider={setSelectedProviderId}
          onTest={(provider) => providers.initiateTestConnection(provider)}
          onRequestDelete={(provider) => setConfirmAction({ kind: 'provider', provider })}
          onDirtyChange={handlePanelDirtyChange}
          autoEditProviderId={autoEditProviderId}
        />
      ) : (
        <RoutingWorkspace
          routing={routing}
          config={base.config}
          customEndpoints={base.customEndpoints}
          routeCounts={endpointRouteCounts}
          selectedEndpointId={selectedEndpointId}
          onSelectEndpoint={handleSelectEndpoint}
          onCreateEndpoint={handleOpenCreateEndpoint}
          onEditEndpoint={handleOpenEditEndpoint}
          onDeleteEndpoint={(endpoint) => setConfirmAction({ kind: 'endpoint', endpoint })}
          onRequestDeletePreset={(endpoint, preset) => setConfirmAction({ kind: 'preset', endpoint, preset })}
        />
      )}

      <CreateProviderDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        existingProviderIds={providers.providers.map((item) => item.id)}
        onSubmit={providers.handleCreateProvider}
        onCreated={(providerId) => {
          // Wait for the refetched config so the stale-selection guard below
          // sees the new provider before the selection lands.
          void base.configQuery.refetch().then(() => {
            // Auto-selecting the new provider unmounts the previous dirty
            // panel with no URL change — the blocker cannot intercept, so
            // confirm here like the rail does for manual selection. Read the
            // ref, not the state: this closure captured the dirty value at
            // creation time, and edits started while the refetch was in
            // flight would otherwise be dropped silently.
            if (providersPanelDirtyRef.current) {
              setPendingCreatedProvider(providerId)
              return
            }
            setSelectedProviderId(providerId)
            setAutoEditProviderId(providerId)
          })
        }}
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
          // The panel is where models are edited now — select the provider
          // and open it straight in edit mode.
          setSelectedProviderId(provider.id)
          setAutoEditProviderId(provider.id)
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

      <ConfirmDialog
        open={routeBlocker.state === 'blocked'}
        onOpenChange={(open) => {
          if (!open && routeBlocker.state === 'blocked') routeBlocker.reset()
        }}
        title={t('providers.masterDetail.unsavedTitle')}
        description={t('providers.masterDetail.unsavedBody')}
        confirmLabel={t('providers.masterDetail.unsavedConfirm')}
        cancelLabel={t('common.actions.cancel')}
        onConfirm={() => {
          if (routeBlocker.state === 'blocked') routeBlocker.proceed()
        }}
      />

      <ConfirmDialog
        open={!!pendingCreatedProvider}
        onOpenChange={(open) => {
          if (!open) setPendingCreatedProvider(null)
        }}
        title={t('providers.masterDetail.unsavedTitle')}
        description={t('providers.masterDetail.unsavedBody')}
        confirmLabel={t('providers.masterDetail.unsavedConfirm')}
        cancelLabel={t('common.actions.cancel')}
        onConfirm={() => {
          if (pendingCreatedProvider) setSelectedProviderId(pendingCreatedProvider)
          setPendingCreatedProvider(null)
        }}
      />
    </div>
  )
}
