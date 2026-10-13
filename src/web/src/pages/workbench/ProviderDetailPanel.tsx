import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import type { ProviderConfig } from '@/types/providers'
import { BasicsStep, ModelsStep, providerTypeLabel } from './ProviderDrawerSteps'
import { AggregateModelsStep } from './AggregateModelsStep'
import { ProbeModelsDialog } from './ProbeModelsDialog'
import { ProviderBalanceSection } from './ProviderBalanceSection'
import { ProviderSurfacesSection } from './ProviderSurfacesSection'
import type { ProviderTestResult } from './shared'
import type { TargetOption } from './TargetCombobox'
import { useProviderDetailState } from './useProviderDetailState'

interface ProviderDetailPanelProps {
  provider: ProviderConfig
  /** Full provider list — aggregate member options + reference validation. */
  allProviders: ProviderConfig[]
  testResult: ProviderTestResult | null
  testing: boolean
  /** Receives the unsaved draft, so tests respect in-progress edits. */
  onTest: (draft: ProviderConfig) => void
  onRequestDelete: (provider: ProviderConfig) => void
  onSubmit: (payload: ProviderConfig) => Promise<void>
  /** Reports draft dirtiness upward so navigation away can guard against loss. */
  onDirtyChange?: (dirty: boolean) => void
}

/**
 * Right-hand detail surface of the providers master-detail layout. All
 * sections edit one shared draft inline (no wizard steps, no drawer); the
 * sticky footer saves or discards the whole draft at once.
 */
export function ProviderDetailPanel({
  provider,
  allProviders,
  testResult,
  testing,
  onTest,
  onRequestDelete,
  onSubmit,
  onDirtyChange
}: ProviderDetailPanelProps) {
  const { t } = useTranslation()
  const [probeOpen, setProbeOpen] = useState(false)
  const { providerForm, dirty, saving, saveError, save, discard } = useProviderDetailState({
    provider,
    providers: allProviders,
    onSubmit
  })
  const { form, errors, advancedOpen, providerIdRef } = providerForm
  const isAggregate = form.type === 'aggregate'

  // Unmount (provider switch/delete) must not leave a stale dirty flag behind.
  useEffect(() => {
    onDirtyChange?.(dirty)
    return () => onDirtyChange?.(false)
  }, [dirty, onDirtyChange])

  /** Member-backends for aggregate models: every concrete provider model,
   * excluding aggregate providers themselves (no nested aggregation in v1). */
  const memberOptions = useMemo<TargetOption[]>(() => {
    const options: TargetOption[] = []
    for (const item of allProviders) {
      if (item.type === 'aggregate') continue
      const providerDisplay =
        item.label && item.label !== item.id ? `${item.label} (${item.id})` : item.id
      const models = item.models?.length
        ? item.models
        : item.defaultModel
          ? [{ id: item.defaultModel }]
          : []
      for (const model of models) {
        options.push({
          value: `${item.id}:${model.id}`,
          label: `${providerDisplay} · ${model.label ?? model.id}`,
          providerId: item.id,
          providerLabel: providerDisplay,
          modelId: model.id,
          modelLabel: model.label ?? model.id,
          kind: 'model'
        })
      }
    }
    return options
  }, [allProviders])

  // Untyped on purpose: the concrete member/failover handlers must stay
  // non-optional for AggregateModelsStep's Required<...> props.
  const stepProps = {
    form,
    errors,
    isCreate: false,
    advancedOpen,
    onAdvancedOpenChange: providerForm.setAdvancedOpen,
    idInputRef: providerIdRef,
    onProviderIdChange: providerForm.handleProviderIdChange,
    onFieldChange: providerForm.handleFieldChange,
    onTypeChange: providerForm.handleTypeChange,
    onAuthModeChange: providerForm.handleAuthModeChange,
    onNonStreamViaStreamChange: providerForm.handleProviderNonStreamViaStreamChange,
    onUseAbsoluteUrlChange: providerForm.handleUseAbsoluteUrlChange,
    onStreamUsageChange: providerForm.handleStreamUsageChange,
    onAddHeader: providerForm.handleAddHeader,
    onRemoveHeader: providerForm.handleRemoveHeader,
    onHeaderChange: providerForm.handleHeaderChange,
    onModelIdChange: providerForm.handleModelIdChange,
    onModelChange: providerForm.handleModelChange,
    onAddModel: providerForm.handleAddModel,
    onRemoveModel: providerForm.handleRemoveModel,
    onModelNonStreamViaStreamChange: providerForm.handleModelNonStreamViaStreamChange,
    onSetDefaultModel: providerForm.handleSetDefaultModel,
    memberOptions,
    onAddMember: providerForm.handleAddMember,
    onRemoveMember: providerForm.handleRemoveMember,
    onMemberTargetChange: providerForm.handleMemberTargetChange,
    onReorderMembers: providerForm.handleReorderMembers,
    onModelFailoverChange: providerForm.handleModelFailoverChange,
    testVerification: isAggregate
      ? undefined
      : {
          available: true,
          testing,
          result: testResult,
          // Tests run against the serialized draft, not the saved provider —
          // unsaved URL/key/model edits count (same semantics as the header).
          onTest: () => onTest(providerForm.serialize())
        },
    probeModels: isAggregate
      ? undefined
      : {
          // Probing needs at least a base URL to aim at; the backend probes
          // the unsaved draft so unsaved edits (URL, key, headers) count.
          available: form.baseUrl.trim().length > 0,
          onProbe: () => setProbeOpen(true)
        }
  }

  return (
    <Card className="overflow-hidden" data-testid="provider-detail-panel">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border bg-secondary/50 px-5 py-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="truncate text-base font-semibold tracking-[-0.02em]">
              {provider.label || provider.id}
            </h2>
            <Badge variant="secondary" className="text-[10px]">
              {providerTypeLabel(provider.type, t)}
            </Badge>
          </div>
          <p className="mt-0.5 font-mono text-xs text-muted-foreground">{provider.id}</p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="bg-card text-xs"
            onClick={() => onTest(providerForm.serialize())}
            disabled={testing}
          >
            {testing ? t('common.actions.testingConnection') : t('providers.actions.test')}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-xs text-destructive hover:text-destructive"
            onClick={() => onRequestDelete(provider)}
            disabled={saving}
          >
            {t('providers.actions.delete')}
          </Button>
        </div>
      </header>

      <CardContent className="p-5">
        <div className="space-y-8">
          <BasicsStep {...stepProps} />
          {isAggregate ? null : (
            <>
              <ProviderSurfacesSection
                form={form}
                errors={errors}
                onEndpointChange={providerForm.handleEndpointChange}
                onAddEndpoint={providerForm.handleAddEndpoint}
                onRemoveEndpoint={providerForm.handleRemoveEndpoint}
                onKeyChange={providerForm.handleKeyChange}
                onAddKey={providerForm.handleAddKey}
                onRemoveKey={providerForm.handleRemoveKey}
              />
              <ProviderBalanceSection
                providerId={provider.id}
                adapter={form.balanceAdapter}
                savedAdapter={provider.balanceAdapter}
                onAdapterChange={providerForm.handleBalanceAdapterChange}
              />
            </>
          )}
          {isAggregate ? <AggregateModelsStep {...stepProps} /> : <ModelsStep {...stepProps} />}
        </div>
      </CardContent>

      {dirty || saveError ? (
        <footer className="sticky bottom-0 flex flex-wrap items-center justify-between gap-3 border-t border-border bg-card px-5 py-3">
          <div className="min-w-0 text-xs">
            <span
              className={cn(
                'font-medium',
                saveError ? 'text-destructive' : 'text-primary'
              )}
              aria-live="polite"
            >
              {saveError
                ? t('providers.drawer.toast.saveFailure', { message: saveError })
                : t('providers.masterDetail.dirtyHint')}
            </span>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="bg-card text-xs"
              onClick={discard}
              disabled={saving}
            >
              {t('providers.masterDetail.discard')}
            </Button>
            <Button type="button" size="sm" data-testid="provider-save" onClick={() => void save()} disabled={saving}>
              {saving ? t('common.actions.saving') : t('providers.masterDetail.save')}
            </Button>
          </div>
        </footer>
      ) : null}

      <ProbeModelsDialog
        open={probeOpen}
        providerId={provider.id}
        providerName={provider.label || provider.id}
        existingModelIds={form.models.map((model) => model.id.trim()).filter(Boolean)}
        draft={providerForm.serialize()}
        onImport={providerForm.handleImportModels}
        onClose={() => setProbeOpen(false)}
      />
    </Card>
  )
}
