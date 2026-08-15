import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { StepNav, type StepStatus } from '@/components/ui/step-nav'
import { toApiError } from '@/services/api'
import { modelManagementApi } from '@/services/modelManagement'
import type { ProviderConfig } from '@/types/providers'
import type { ProviderTestResult } from './shared'
import {
  BasicsStep,
  describeAuthMode,
  ModelsStep,
  PROVIDER_STEPS,
  PROVIDER_TYPE_OPTIONS,
  ProviderStepId,
  ProviderStepShared
} from './ProviderDrawerSteps'
import { ProbeModelsDialog } from './ProbeModelsDialog'
import { useProviderForm } from './useProviderForm'

export interface ProviderDrawerProps {
  open: boolean
  mode: 'create' | 'edit'
  provider?: ProviderConfig
  existingProviderIds: string[]
  onClose: () => void
  onSubmit: (payload: ProviderConfig) => Promise<void>
  /** latest recorded test result for the provider being edited */
  testResult?: ProviderTestResult | null
  testing?: boolean
  onTest?: () => void
  /** edit-mode only: opens the delete confirmation flow (hidden in create mode) */
  onDelete?: () => void
}

export function ProviderDrawer({
  open,
  mode,
  provider,
  existingProviderIds,
  onClose,
  onSubmit,
  testResult,
  testing,
  onTest,
  onDelete
}: ProviderDrawerProps) {
  const { t } = useTranslation()
  const providerForm = useProviderForm({ mode, provider, existingProviderIds })
  const { form, errors, advancedOpen, providerIdRef } = providerForm
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [activeStep, setActiveStep] = useState<ProviderStepId>('basics')
  const [probeOpen, setProbeOpen] = useState(false)
  // Create-mode connection test runs against the unsaved draft, so its state
  // lives here instead of the page-level testResults map (keyed by saved id).
  const [draftTesting, setDraftTesting] = useState(false)
  const [draftTestResult, setDraftTestResult] = useState<ProviderTestResult | null>(null)
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const closeButtonRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    if (open) {
      providerForm.resetForm()
      setSubmitError(null)
      setSubmitting(false)
      setActiveStep('basics')
      setProbeOpen(false)
      setDraftTesting(false)
      setDraftTestResult(null)
    }
  }, [open, provider, mode, providerForm.resetForm])

  // Keep the latest onClose in a ref so the keydown listener only re-subscribes
  // when `open` flips — not on every parent render. The workbench polls config
  // every 10s, which would otherwise detach/reattach the listener each tick and
  // could drop an Escape press mid-render.
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  useEffect(() => {
    if (!open) return undefined
    const handler = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      // Yield to any open Radix overlay stacked on top of the drawer: a Radix
      // Dialog (delete confirm), or a Select/Combobox/Popover popper (the model
      // "non-stream via stream" Select, target combobox) which renders as a
      // [role="listbox"] or inside [data-radix-popper-content-wrapper]. Without
      // this, Escape on those inner poppers would also dismiss the whole drawer
      // and lose the in-progress edit.
      if (document.querySelector(
        '[role="dialog"][data-state="open"], [role="listbox"][data-state="open"], [data-radix-popper-content-wrapper]'
      )) return
      onCloseRef.current()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open])

  useEffect(() => {
    if (!open) return
    if (mode === 'create' && providerIdRef.current) {
      providerIdRef.current.focus()
      return
    }
    if (closeButtonRef.current) {
      closeButtonRef.current.focus()
    }
  }, [open, mode])

  const isCreate = mode === 'create'
  const availableDefaultModels = useMemo(
    () => form.models.filter((model) => model.id.trim().length > 0),
    [form.models]
  )
  const selectedTypeLabel = useMemo(
    () => PROVIDER_TYPE_OPTIONS.find((item) => item.value === form.type)?.label ?? 'Custom',
    [form.type]
  )
  const draftProviderName = form.label.trim() || form.id.trim() || t('providers.drawer.summary.untitled')
  const providerSummaryItems = useMemo(
    () => [
      {
        label: t('providers.drawer.summary.type'),
        value: selectedTypeLabel
      },
      {
        label: t('providers.drawer.summary.auth'),
        value: describeAuthMode(form.type, form.authMode, t)
      },
      {
        label: t('providers.drawer.summary.models'),
        value: availableDefaultModels.length.toLocaleString()
      }
    ],
    [availableDefaultModels.length, form.authMode, form.type, selectedTypeLabel, t]
  )

  const handleSubmit = async () => {
    setSubmitError(null)
    const validationErrors = providerForm.validateErrors()
    if (Object.keys(validationErrors).length > 0) {
      // Jump to the first step that has an error so the user sees it.
      if (validationErrors.baseUrl || validationErrors.id || validationErrors.extraHeaders) {
        setActiveStep('basics')
        if (validationErrors.extraHeaders) {
          providerForm.setAdvancedOpen(true)
        }
      } else if (validationErrors.models) {
        setActiveStep('models')
      }
      return
    }
    setSubmitting(true)
    try {
      const payload = providerForm.serialize()
      await onSubmit(payload)
    } catch (error) {
      setSubmitError(t('providers.drawer.toast.saveFailure', { message: toApiError(error).message }))
      setSubmitting(false)
      return
    }
    setSubmitting(false)
    onClose()
  }

  if (!open) {
    return null
  }

  const stepIndex = PROVIDER_STEPS.findIndex((step) => step.id === activeStep)
  const isLastStep = stepIndex === PROVIDER_STEPS.length - 1

  const trimmedId = form.id.trim()
  const idValid = trimmedId.length > 0 && (mode === 'edit' || !existingProviderIds.includes(trimmedId))
  const trimmedUrl = form.baseUrl.trim()
  let urlValid = trimmedUrl.length > 0
  if (urlValid) {
    try {
      // eslint-disable-next-line no-new
      new URL(trimmedUrl)
    } catch {
      urlValid = false
    }
  }
  let modelsValid = !form.defaultModel || form.models.some((model) => model.id === form.defaultModel)
  if (modelsValid) {
    const modelIds = new Set<string>()
    modelsValid = !form.models.some((model) => {
      const id = model.id.trim()
      if (id.length === 0) return true
      if (modelIds.has(id)) return true
      modelIds.add(id)
      return false
    })
  }
  const validity: Record<ProviderStepId, boolean> = {
    basics: idValid && urlValid,
    models: modelsValid
  }

  const stepItems = PROVIDER_STEPS.map((step, index) => {
    let status: StepStatus
    if (index === stepIndex) {
      status = 'current'
    } else if (index < stepIndex) {
      status = validity[step.id] ? 'complete' : 'error'
    } else {
      status = 'upcoming'
    }
    return { id: step.id, label: t(step.labelKey), status }
  })

  const handleStepSelect = (id: string) => {
    setActiveStep(id as ProviderStepId)
  }

  const handleDraftTest = async () => {
    setDraftTesting(true)
    setDraftTestResult(null)
    try {
      const response = await modelManagementApi.testProvider(form.id.trim() || 'draft', {
        provider: providerForm.serialize()
      })
      setDraftTestResult({
        ok: response.ok,
        status: response.status,
        statusText: response.statusText,
        durationMs: response.durationMs,
        message: response.ok ? undefined : response.statusText,
        testedAt: Date.now()
      })
    } catch (error) {
      setDraftTestResult({
        ok: false,
        message: toApiError(error).message,
        testedAt: Date.now()
      })
    } finally {
      setDraftTesting(false)
    }
  }
  const handleNext = () => {
    if (stepIndex < PROVIDER_STEPS.length - 1) {
      setActiveStep(PROVIDER_STEPS[stepIndex + 1].id)
    }
  }
  const handleBack = () => {
    if (stepIndex > 0) {
      setActiveStep(PROVIDER_STEPS[stepIndex - 1].id)
    }
  }

  const stepProps: ProviderStepShared = {
    form,
    errors,
    isCreate,
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
    testVerification:
      mode === 'edit'
        ? onTest
          ? {
              available: true,
              testing: testing ?? false,
              result: testResult ?? null,
              onTest
            }
          : undefined
        : {
            // Create mode: test the unsaved draft via the inline provider payload.
            available: true,
            testing: draftTesting,
            result: draftTestResult,
            onTest: () => void handleDraftTest()
          },
    probeModels: {
      // Probing needs at least a base URL to aim at; the backend probes the
      // unsaved draft so unsaved edits (URL, key, headers) are respected.
      available: form.baseUrl.trim().length > 0,
      onProbe: () => setProbeOpen(true)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-background/95" aria-hidden="true" />
      <aside
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="provider-drawer-title"
        aria-describedby="provider-drawer-desc"
        className="flex h-full min-h-0 w-full max-w-5xl flex-col border-l border-border bg-background shadow-[var(--surface-shadow-lg)]"
      >
        <header className="border-b border-border bg-secondary px-6 py-5">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-2">
              <div className="inline-flex rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.18em] text-primary">
                {isCreate ? t('providers.drawer.quickStart') : t('providers.drawer.editTitle')}
              </div>
              <div>
                <h2 id="provider-drawer-title" className="text-lg font-semibold tracking-[-0.02em]">
                  {isCreate ? t('providers.drawer.createTitle') : t('providers.drawer.editTitle')}
                </h2>
                <p id="provider-drawer-desc" className="text-sm text-muted-foreground">
                  {t('providers.drawer.description')}
                </p>
              </div>
            </div>
            <Button
              type="button"
              ref={closeButtonRef}
              variant="outline"
              onClick={onClose}
              className="bg-card"
            >
              {t('common.actions.close')}
            </Button>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-3">
            {providerSummaryItems.map((item) => (
              <div
                key={item.label}
                className="rounded-xl border border-transparent bg-card px-4 py-3 shadow-[var(--surface-shadow)]"
              >
                <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                  {item.label}
                </p>
                <p className="mt-2 text-sm font-semibold text-foreground">
                  {item.value}
                </p>
              </div>
            ))}
          </div>
        </header>

        <div className="grid min-h-0 flex-1 overflow-hidden xl:grid-cols-[minmax(0,1fr)_280px]">
          <div className="min-h-0 overflow-y-auto px-6 py-5 pb-10">
            <StepNav steps={stepItems} current={activeStep} onSelect={handleStepSelect} className="mb-6" />

            {activeStep === 'basics' ? <BasicsStep {...stepProps} /> : null}
            {activeStep === 'models' ? <ModelsStep {...stepProps} /> : null}
          </div>

          <aside className="hidden min-h-0 overflow-y-auto border-l border-border/45 bg-secondary/40 px-5 py-5 xl:block">
            <div className="sticky top-0 space-y-5">
              <div className="rounded-xl border border-transparent bg-card p-4 shadow-[var(--surface-shadow)]">
                <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                  {t('providers.drawer.formSummary')}
                </p>
                <p className="mt-2 text-base font-semibold">{draftProviderName}</p>
                <div className="mt-4 space-y-3 text-sm">
                  {providerSummaryItems.map((item) => (
                    <div key={item.label} className="flex items-start justify-between gap-3">
                      <span className="text-muted-foreground">{item.label}</span>
                      <span className="text-right font-medium">{item.value}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-xl border border-transparent bg-card p-4 shadow-[var(--surface-shadow)]">
                <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                  {t('providers.drawer.sections.checklist')}
                </p>
                <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
                  <li>{t('providers.drawer.hints.checkUrl')}</li>
                  <li>{t('providers.drawer.hints.checkAuth')}</li>
                  <li>{t('providers.drawer.hints.checkModels')}</li>
                </ul>
              </div>

              {advancedOpen && (
                <div className="rounded-xl bg-accent p-4 text-sm text-foreground">
                  <p className="font-medium text-primary">{t('providers.drawer.hints.advancedTitle')}</p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {t('providers.drawer.hints.advancedBody')}
                  </p>
                </div>
              )}
            </div>
          </aside>
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-border bg-secondary px-6 py-4 text-sm">
          <div className="flex flex-col gap-1 text-xs">
            {!isCreate && onDelete ? (
              <button
                type="button"
                onClick={onDelete}
                disabled={submitting}
                className="text-muted-foreground underline-offset-2 hover:text-destructive hover:underline disabled:opacity-50"
              >
                {t('providers.actions.delete')}
              </button>
            ) : null}
            {submitError ? <span className="text-destructive" aria-live="polite">{submitError}</span> : null}
          </div>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={submitting}
              className="bg-card"
            >
              {t('common.actions.cancel')}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={handleBack}
              disabled={submitting || stepIndex === 0}
              className="bg-card"
            >
              {t('common.actions.previous')}
            </Button>
            {isLastStep ? null : (
              <Button type="button" onClick={handleNext} disabled={submitting}>
                {t('common.actions.next')}
              </Button>
            )}
            <Button type="button" onClick={handleSubmit} disabled={submitting}>
              {submitting ? t('common.actions.saving') : t('common.actions.save')}
            </Button>
          </div>
        </footer>
      </aside>
      <ProbeModelsDialog
        open={probeOpen}
        providerId={provider?.id ?? (form.id.trim() || 'draft')}
        providerName={provider?.label || form.label.trim() || form.id.trim() || t('providers.drawer.summary.untitled')}
        existingModelIds={form.models.map((model) => model.id.trim()).filter(Boolean)}
        draft={providerForm.serialize()}
        onImport={providerForm.handleImportModels}
        onClose={() => setProbeOpen(false)}
      />
    </div>
  )
}
