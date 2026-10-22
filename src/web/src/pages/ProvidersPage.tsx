import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useBlocker } from 'react-router-dom'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { PageToolbar } from '@/components/PageToolbar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { storageKeys } from '@/services/storageKeys'
import type { ProviderConfig } from '@/types/providers'
import type { ConfirmAction } from './workbench/shared'
import { summarizeProviderReferences } from './workbench/shared'
import { useWorkbenchConfig } from './workbench/useWorkbenchConfig'
import { useProvidersState } from './workbench/useProvidersState'
import { CreateProviderDialog } from './workbench/CreateProviderDialog'
import { NoModelConfiguredDialog } from './workbench/NoModelConfiguredDialog'
import { ProvidersMasterDetail } from './workbench/ProvidersMasterDetail'
import { TestConnectionDialog } from './workbench/TestConnectionDialog'

/**
 * 提供商页（/providers）—— upstream provider CRUD, keys, models and balance.
 * Split out of the old providers workbench: provider config is low-frequency
 * resource management; the routing workspace lives on /routing. The provider
 * selection persists across reloads via localStorage.
 */
export default function ProvidersPage() {
  const { t } = useTranslation()
  const base = useWorkbenchConfig()
  const providers = useProvidersState(base)

  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null)
  const [confirmingAction, setConfirmingAction] = useState(false)
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  // Unsaved inline-draft flag from the providers detail panel.
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

  // Draft guard for SPA navigation. Covers route leaves (sidebar links and
  // history pops share this single confirm — a browser-back is a POP that
  // never goes through a click handler, so the guard must live at the router
  // level rather than in a click handler). beforeunload still covers full
  // page exits. Requires the data router in app/router.tsx.
  const routeBlocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      providersPanelDirty && currentLocation.pathname !== nextLocation.pathname
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

  const handleConfirmDialog = async () => {
    if (!confirmAction) return

    setConfirmingAction(true)
    try {
      if (confirmAction.kind === 'provider') {
        await providers.handleDeleteProvider(confirmAction.provider)
      }
      setConfirmAction(null)
    } finally {
      setConfirmingAction(false)
    }
  }

  const providerImpact =
    confirmAction?.kind === 'provider'
      ? summarizeProviderReferences(base.config, base.customEndpoints, confirmAction.provider.id)
      : { routes: 0, defaults: 0, aggregateMembers: 0 }

  return (
    <div className="flex flex-col gap-6">
      <PageToolbar
        status={<Badge variant="secondary">{t('providers.groupCount', { count: providers.providerCount })}</Badge>}
        actions={
          <Button size="sm" onClick={() => setCreateDialogOpen(true)}>
            {t('providers.actions.add')}
          </Button>
        }
      />

      <ProvidersMasterDetail
        providers={providers}
        configPending={base.configQuery.isPending || (!base.config && base.configQuery.isFetching)}
        configError={
          !base.config && base.configQuery.isError
            ? base.configQuery.error?.message ?? t('common.status.error')
            : null
        }
        onRetryConfig={() => void base.configQuery.refetch()}
        selectedProviderId={selectedProviderId}
        onSelectProvider={setSelectedProviderId}
        onTest={(provider) => providers.initiateTestConnection(provider)}
        onRequestDelete={(provider) => setConfirmAction({ kind: 'provider', provider })}
        onDirtyChange={handlePanelDirtyChange}
        autoEditProviderId={autoEditProviderId}
      />

      <CreateProviderDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        existingProviderIds={providers.providers.map((item) => item.id)}
        onSubmit={providers.handleCreateProvider}
        onCreated={(providerId) => {
          // Wait for the refetched config so the stale-selection guard above
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

      <ConfirmDialog
        open={!!confirmAction}
        onOpenChange={(open) => {
          if (!open && !confirmingAction) {
            setConfirmAction(null)
          }
        }}
        title={confirmAction?.kind === 'provider' ? t('providers.actions.delete') : ''}
        description={
          confirmAction?.kind === 'provider'
            ? t('providers.confirm.delete', { name: confirmAction.provider.label || confirmAction.provider.id })
            : ''
        }
        confirmLabel={confirmingAction ? t('common.actions.loading') : t('common.delete')}
        cancelLabel={t('common.actions.cancel')}
        loading={confirmingAction}
        onConfirm={handleConfirmDialog}
      >
        {confirmAction?.kind === 'provider' ? (
          <div className="space-y-2">
            <div className="rounded-xl border border-destructive/20 bg-destructive/5 px-3 py-2 font-mono text-xs text-foreground">
              {confirmAction.provider.label || confirmAction.provider.id}
            </div>
            {providerImpact.routes > 0 ? (
              <p className="text-xs text-muted-foreground">
                {t('providers.confirm.deleteImpact', { count: providerImpact.routes })}
              </p>
            ) : null}
            {providerImpact.defaults > 0 ? (
              <p className="text-xs text-muted-foreground">
                {t('providers.confirm.deleteDefaultsImpact', { count: providerImpact.defaults })}
              </p>
            ) : null}
            {providerImpact.aggregateMembers > 0 ? (
              <p className="text-xs text-muted-foreground">
                {t('providers.confirm.deleteAggregateImpact', {
                  count: providerImpact.aggregateMembers
                })}
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
