import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useBlocker, useSearchParams } from 'react-router-dom'
import { AlertTriangle, Plus, TableProperties } from 'lucide-react'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { PageState } from '@/components/PageState'
import { PageToolbar } from '@/components/PageToolbar'
import { Button } from '@/components/ui/button'
import type { CustomEndpoint } from '@/types/endpoints'
import type { RoutingPreset } from '@/types/providers'
import type { ConfirmAction } from './workbench/shared'
import { useWorkbenchConfig } from './workbench/useWorkbenchConfig'
import { useRoutingState } from './workbench/useRoutingState'
import { EndpointDialog } from './workbench/EndpointDialog'
import { EndpointSwitcher } from './workbench/EndpointSwitcher'
import { PresetDiffDialog } from './workbench/PresetDiffDialog'
import { RoutingPresetsDialog } from './workbench/RoutingPresetsDialog'
import { RoutingWorkspace } from './workbench/RoutingWorkspace'

/**
 * 路由页（/routing）—— per-endpoint routing rules, default forwarding and the
 * hit simulator. Split out of the old providers workbench: routing is
 * high-frequency tuning and gets the full page width; provider CRUD lives on
 * /providers. Unsaved rules/defaults drafts are guarded by a route blocker
 * (the old in-page tab switch could rely on the page not unmounting; two
 * separate pages cannot).
 */
export default function RoutingPage() {
  const { t } = useTranslation()
  const base = useWorkbenchConfig()
  const routing = useRoutingState(base)

  const [endpointDialogOpen, setEndpointDialogOpen] = useState(false)
  const [editingEndpoint, setEditingEndpoint] = useState<CustomEndpoint | undefined>(undefined)
  const [presetsOpen, setPresetsOpen] = useState(false)
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null)
  const [confirmingAction, setConfirmingAction] = useState(false)

  // Draft guard for SPA navigation: any unsaved route-rules or defaults draft
  // (per endpoint) must be confirmed before leaving the page. The old
  // workbench never guarded these drafts (same-page tab switches kept the
  // state alive); with routing on its own route, leaving would silently drop
  // them. Requires the data router in app/router.tsx.
  const hasDirtyDrafts =
    Object.values(routing.isDirtyByEndpoint).some(Boolean) ||
    Object.values(routing.isDefaultsDirtyByEndpoint).some(Boolean)
  const routeBlocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      hasDirtyDrafts && currentLocation.pathname !== nextLocation.pathname
  )

  // Full page exit (reload / tab close) needs the browser prompt too.
  useEffect(() => {
    if (!hasDirtyDrafts) return
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [hasDirtyDrafts])

  // The selected routing endpoint is deep-linkable via `?endpoint=<id>`.
  const [searchParams, setSearchParams] = useSearchParams()
  const endpointParam = searchParams.get('endpoint')
  const [selectedEndpointId, setSelectedEndpointId] = useState<string | null>(endpointParam)
  // Newly created endpoint waiting to appear in the (refetched) endpoint list
  // before it can be selected — selecting it earlier would trip the stale-id
  // cleanup below and clear the parameter again.
  const [pendingEndpointId, setPendingEndpointId] = useState<string | null>(null)

  useEffect(() => {
    setSelectedEndpointId(endpointParam)
  }, [endpointParam])

  // A bare /routing visit still shows the first endpoint's rules; reflect that
  // in the URL so the endpoint rail has an active row and dirty-guard messages
  // can name the endpoint being edited.
  const seededEndpointRef = useRef(false)
  useEffect(() => {
    if (seededEndpointRef.current) return
    if (endpointParam) {
      seededEndpointRef.current = true
      return
    }
    if (routing.endpointTabs.length === 0) return
    seededEndpointRef.current = true
    setSearchParams(
      (previous) => {
        const next = new URLSearchParams(previous)
        next.set('endpoint', routing.endpointTabs[0].key)
        return next
      },
      { replace: true }
    )
  }, [endpointParam, routing.endpointTabs, setSearchParams])

  const handleSelectEndpoint = useCallback(
    (endpointId: string) => {
      setSearchParams(
        (previous) => {
          const next = new URLSearchParams(previous)
          next.set('endpoint', endpointId)
          return next
        },
        { replace: true }
      )
    },
    [setSearchParams]
  )

  const handleClearEndpointSelection = useCallback(() => {
    setSearchParams(
      (previous) => {
        const next = new URLSearchParams(previous)
        next.delete('endpoint')
        return next
      },
      { replace: true }
    )
  }, [setSearchParams])

  // Select a just-created endpoint once the endpoint list has picked it up.
  useEffect(() => {
    if (!pendingEndpointId) return
    if (!routing.endpointTabs.some((tab) => tab.key === pendingEndpointId)) return
    setPendingEndpointId(null)
    handleSelectEndpoint(pendingEndpointId)
  }, [pendingEndpointId, routing.endpointTabs, handleSelectEndpoint])

  // Clear the selection when its endpoint no longer exists (deleted, or a
  // stale deep link) once the endpoint list has loaded.
  useEffect(() => {
    if (!selectedEndpointId) return
    if (base.customEndpointsQuery.isPending) return
    if (routing.endpointTabs.some((tab) => tab.key === selectedEndpointId)) return
    handleClearEndpointSelection()
  }, [selectedEndpointId, routing.endpointTabs, base.customEndpointsQuery.isPending, handleClearEndpointSelection])

  const handleOpenCreateEndpoint = () => {
    setEditingEndpoint(undefined)
    setEndpointDialogOpen(true)
  }
  const handleOpenEditEndpoint = (endpoint: CustomEndpoint) => {
    setEditingEndpoint(endpoint)
    setEndpointDialogOpen(true)
  }

  const handleConfirmDialog = async () => {
    if (!confirmAction) return

    setConfirmingAction(true)
    try {
      if (confirmAction.kind === 'preset') {
        await routing.handleDeletePreset(confirmAction.endpoint, confirmAction.preset)
      } else if (confirmAction.kind === 'endpoint') {
        await routing.handleDeleteEndpoint(confirmAction.endpoint.id)
      }
      setConfirmAction(null)
    } finally {
      setConfirmingAction(false)
    }
  }

  const confirmDialogTitle =
    confirmAction?.kind === 'preset'
      ? t('modelManagement.presets.delete')
      : confirmAction?.kind === 'endpoint'
        ? t('common.delete')
        : ''

  const confirmDialogDescription =
    confirmAction?.kind === 'preset'
      ? t('modelManagement.confirm.deletePreset', { name: confirmAction.preset.name })
      : confirmAction?.kind === 'endpoint'
        ? [
            t('modelManagement.deleteEndpointConfirm', { label: confirmAction.endpoint.label }),
            (routing.routesByEndpoint[confirmAction.endpoint.id]?.length ?? 0) > 0
              ? t('modelManagement.deleteEndpointImpactRoutes', {
                  count: routing.routesByEndpoint[confirmAction.endpoint.id]?.length ?? 0
                })
              : '',
            (routing.presetsByEndpoint[confirmAction.endpoint.id]?.length ?? 0) > 0
              ? t('modelManagement.deleteEndpointImpactPresets', {
                  count: routing.presetsByEndpoint[confirmAction.endpoint.id]?.length ?? 0
                })
              : ''
          ]
            .filter(Boolean)
            .join(' ')
        : ''

  const confirmDialogName =
    confirmAction?.kind === 'preset'
      ? confirmAction.preset.name
      : confirmAction?.kind === 'endpoint'
        ? confirmAction.endpoint.label
        : ''

  const endpointRouteCounts = Object.fromEntries(
    Object.entries(routing.routesByEndpoint).map(([endpoint, routes]) => [endpoint, routes?.length ?? 0])
  )
  const activeEndpoint = selectedEndpointId ?? routing.endpointTabs[0]?.key ?? 'anthropic'

  const handleRequestDeletePreset = (endpoint: string, preset: RoutingPreset) => {
    setConfirmAction({ kind: 'preset', endpoint, preset })
  }

  return (
    <div className="flex flex-col gap-6">
      <PageToolbar
        actions={
          <>
            <EndpointSwitcher
              tabs={routing.endpointTabs}
              customEndpoints={base.customEndpoints}
              routeCounts={endpointRouteCounts}
              selectedEndpointId={activeEndpoint}
              onSelect={handleSelectEndpoint}
              onEditEndpoint={handleOpenEditEndpoint}
              onDeleteEndpoint={(endpoint) => setConfirmAction({ kind: 'endpoint', endpoint })}
            />
            <Button variant="outline" size="sm" onClick={() => setPresetsOpen(true)}>
              <TableProperties className="h-4 w-4" aria-hidden />
              {t('workbench.templates')}
            </Button>
            <Button size="sm" onClick={handleOpenCreateEndpoint}>
              <Plus className="h-4 w-4" aria-hidden />
              {t('workbench.endpoints.create')}
            </Button>
          </>
        }
      />

      {!base.config && base.configQuery.isError ? (
        <PageState
          tone="danger"
          icon={<AlertTriangle className="h-5 w-5" aria-hidden="true" />}
          title={t('common.status.error')}
          description={base.configQuery.error?.message ?? t('common.status.error')}
          action={(
            <Button variant="outline" onClick={() => void base.configQuery.refetch()}>
              {t('common.actions.refresh')}
            </Button>
          )}
        />
      ) : (
        <RoutingWorkspace
          routing={routing}
          config={base.config}
          customEndpoints={base.customEndpoints}
          routeCounts={endpointRouteCounts}
          selectedEndpointId={selectedEndpointId}
          onSelectEndpoint={handleSelectEndpoint}
          onEditEndpoint={handleOpenEditEndpoint}
          onDeleteEndpoint={(endpoint) => setConfirmAction({ kind: 'endpoint', endpoint })}
        />
      )}

      <RoutingPresetsDialog
        open={presetsOpen}
        onOpenChange={setPresetsOpen}
        routing={routing}
        endpoint={activeEndpoint}
        onRequestDeletePreset={handleRequestDeletePreset}
      />

      <EndpointDialog
        open={endpointDialogOpen}
        endpoint={editingEndpoint}
        onClose={() => {
          setEndpointDialogOpen(false)
          setEditingEndpoint(undefined)
        }}
        onSuccess={(createdEndpointId) => {
          void base.configQuery.refetch()
          if (createdEndpointId) setPendingEndpointId(createdEndpointId)
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
          <div className="rounded-xl border border-destructive/20 bg-destructive/5 px-3 py-2 font-mono text-xs text-foreground">
            {confirmDialogName}
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
    </div>
  )
}
