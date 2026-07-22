import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { StepNav, type StepStatus } from '@/components/ui/step-nav'
import type { ProviderConfig } from '@/types/providers'
import {
  AuthStep,
  BasicStep,
  buildInitialState,
  createEmptyModel,
  defaultAuthModeForType,
  describeAuthMode,
  FormErrors,
  FormModel,
  FormState,
  mapPresetModel,
  ModelsStep,
  PROVIDER_STEPS,
  PROVIDER_TYPE_OPTIONS,
  PROVIDER_TYPE_PRESETS,
  ProviderStepId,
  ProviderStepShared,
  TypeStep
} from './ProviderDrawerSteps'

export interface ProviderDrawerProps {
  open: boolean
  mode: 'create' | 'edit'
  provider?: ProviderConfig
  existingProviderIds: string[]
  onClose: () => void
  onSubmit: (payload: ProviderConfig) => Promise<void>
}

export function ProviderDrawer({
  open,
  mode,
  provider,
  existingProviderIds,
  onClose,
  onSubmit
}: ProviderDrawerProps) {
  const { t } = useTranslation()
  const [form, setForm] = useState<FormState>(() => buildInitialState(provider))
  const [errors, setErrors] = useState<FormErrors>({})
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [advancedOpen, setAdvancedOpen] = useState(mode === 'edit')
  const [activeStep, setActiveStep] = useState<ProviderStepId>('type')
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const closeButtonRef = useRef<HTMLButtonElement | null>(null)
  const providerIdRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (open) {
      setForm(buildInitialState(provider))
      setErrors({})
      setSubmitError(null)
      setSubmitting(false)
      setAdvancedOpen(mode === 'edit')
      setActiveStep('type')
    }
  }, [open, provider, mode])

  useEffect(() => {
    if (!open) return undefined
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

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

  const handleInputChange = (field: keyof FormState) => (value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  const handleProviderIdChange = (value: string) => {
    setForm((prev) => {
      const shouldSyncLabel =
        !advancedOpen || prev.label.trim().length === 0 || prev.label === prev.id
      const nextLabel = shouldSyncLabel ? value : prev.label
      return { ...prev, id: value, label: nextLabel }
    })
  }

  const handleTypeChange = (value: ProviderConfig['type']) => {
    setForm((prev) => {
      const presetKey = value ?? 'custom'
      const preset = PROVIDER_TYPE_PRESETS[presetKey] ?? PROVIDER_TYPE_PRESETS.custom
      const previousDefaultAuthMode = defaultAuthModeForType(prev.type)
      const nextDefaultAuthMode = defaultAuthModeForType(value)
      const knownBaseUrls = Object.values(PROVIDER_TYPE_PRESETS)
        .map((item) => item.baseUrl)
        .filter((item): item is string => Boolean(item))
      const shouldReplaceBaseUrl = !prev.baseUrl || knownBaseUrls.includes(prev.baseUrl)
      const shouldApplyModels =
        mode === 'create' && (prev.models.length === 0 || prev.models.every((model) => model.id.trim().length === 0))

      const next: FormState = {
        ...prev,
        type: value,
        authMode: prev.authMode === previousDefaultAuthMode ? nextDefaultAuthMode : prev.authMode
      }

      if (preset?.baseUrl && shouldReplaceBaseUrl) {
        next.baseUrl = preset.baseUrl
      }

      if (preset?.models && shouldApplyModels) {
        next.models = preset.models.map(mapPresetModel)
        next.defaultModel = preset.defaultModel ?? preset.models[0]?.id ?? ''
      }

      return next
    })
  }

  const handleModelChange = (index: number, patch: Partial<FormModel>) => {
    setForm((prev) => {
      const nextModels = [...prev.models]
      nextModels[index] = { ...nextModels[index], ...patch }
      return { ...prev, models: nextModels }
    })
  }

  const handleModelIdChange = (index: number, value: string) => {
    setForm((prev) => {
      const nextModels = [...prev.models]
      const current = nextModels[index]
      if (!current) return prev
      const shouldSyncLabel =
        !advancedOpen || !current.label || current.label === current.id
      const nextModel: FormModel = {
        ...current,
        id: value,
        label: shouldSyncLabel ? value : current.label
      }
      nextModels[index] = nextModel

      const nextDefault = prev.defaultModel === current.id ? value : prev.defaultModel

      return { ...prev, models: nextModels, defaultModel: nextDefault }
    })
  }

  const handleRemoveModel = (index: number) => {
    setForm((prev) => {
      if (index < 0 || index >= prev.models.length) return prev
      const nextModels = prev.models.filter((_, idx) => idx !== index)
      let nextDefault = prev.defaultModel
      if (!nextModels.some((model) => model.id === nextDefault)) {
        nextDefault = ''
      }
      return { ...prev, models: nextModels, defaultModel: nextDefault }
    })
  }

  const handleAddModel = () => {
    setForm((prev) => ({
      ...prev,
      models: [...prev.models, createEmptyModel()]
    }))
  }

  const handleAuthModeChange = (value: 'apiKey' | 'authToken' | 'xAuthToken') => {
    setForm((prev) => ({
      ...prev,
      authMode: value
    }))
  }

  const handleProviderNonStreamViaStreamChange = (checked: boolean) => {
    setForm((prev) => ({
      ...prev,
      nonStreamViaStream: checked
    }))
  }

  const handleModelNonStreamViaStreamChange = (index: number, value: string) => {
    const nextValue = value === 'inherit' ? undefined : value === 'enabled'
    handleModelChange(index, { nonStreamViaStream: nextValue })
  }

  const validate = (): boolean => {
    const nextErrors: FormErrors = {}
    const trimmedId = form.id.trim()
    const trimmedUrl = form.baseUrl.trim()

    if (mode === 'create') {
      if (trimmedId.length === 0) {
        nextErrors.id = t('providers.drawer.errors.idRequired')
      } else if (existingProviderIds.includes(trimmedId)) {
        nextErrors.id = t('providers.drawer.errors.idDuplicate')
      }
    }

    if (mode === 'edit' && trimmedId.length === 0) {
      nextErrors.id = t('providers.drawer.errors.idRequired')
    }

    if (trimmedUrl.length === 0) {
      nextErrors.baseUrl = t('providers.drawer.errors.baseUrlInvalid')
    } else {
      try {
        // eslint-disable-next-line no-new
        new URL(trimmedUrl)
      } catch {
        nextErrors.baseUrl = t('providers.drawer.errors.baseUrlInvalid')
      }
    }

    if (form.models.length > 0) {
      const modelIds = new Set<string>()
      const invalidModel = form.models.some((model) => {
        const id = model.id.trim()
        if (id.length === 0) {
          return true
        }
        if (modelIds.has(id)) {
          return true
        }
        modelIds.add(id)
        return false
      })

      if (invalidModel) {
        nextErrors.models = t('providers.drawer.errors.modelInvalid')
      }
    }

    if (form.defaultModel && !form.models.some((model) => model.id === form.defaultModel)) {
      nextErrors.models = t('providers.drawer.errors.defaultInvalid')
    }

    setErrors(nextErrors)
    return Object.keys(nextErrors).length === 0
  }

  const serialize = (): ProviderConfig => {
    const trimmedModels = form.models
      .map((model) => ({
        id: model.id.trim(),
        label: model.label?.trim() ? model.label.trim() : undefined,
        nonStreamViaStream: model.nonStreamViaStream
      }))
      .filter((model) => model.id.length > 0)

    const extraHeaders = provider?.extraHeaders && Object.keys(provider.extraHeaders).length > 0 ? provider.extraHeaders : undefined
    const authMode =
      form.authMode === 'apiKey' && form.type !== 'anthropic'
        ? undefined
        : form.authMode

    const payload: ProviderConfig = {
      id: form.id.trim(),
      label: form.label.trim() || form.id.trim(),
      baseUrl: form.baseUrl.trim(),
      apiKey: form.apiKey.trim() || undefined,
      type: form.type ?? 'custom',
      defaultModel: form.defaultModel || undefined,
      models: trimmedModels.length > 0 ? trimmedModels : undefined,
      extraHeaders,
      authMode
    }
    if (form.nonStreamViaStream) {
      payload.nonStreamViaStream = true
    }
    return payload
  }

  const handleSubmit = async () => {
    setSubmitError(null)
    if (!validate()) {
      // Jump to the first step that has an error so the user sees it.
      if (errors.baseUrl || errors.id) {
        setActiveStep('basic')
      } else if (errors.models) {
        setActiveStep('models')
      }
      return
    }
    setSubmitting(true)
    try {
      const payload = serialize()
      await onSubmit(payload)
    } catch (error) {
      setSubmitError(t('providers.drawer.toast.saveFailure', { message: error instanceof Error ? error.message : 'unknown' }))
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
    type: true,
    basic: idValid && urlValid,
    auth: true,
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
    onAdvancedOpenChange: setAdvancedOpen,
    idInputRef: providerIdRef,
    onProviderIdChange: handleProviderIdChange,
    onFieldChange: handleInputChange,
    onTypeChange: handleTypeChange,
    onAuthModeChange: handleAuthModeChange,
    onNonStreamViaStreamChange: handleProviderNonStreamViaStreamChange,
    onModelIdChange: handleModelIdChange,
    onModelChange: handleModelChange,
    onAddModel: handleAddModel,
    onRemoveModel: handleRemoveModel,
    onModelNonStreamViaStreamChange: handleModelNonStreamViaStreamChange,
    onSetDefaultModel: (id: string) => setForm((prev) => ({ ...prev, defaultModel: id }))
  }

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-background/80 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />
      <aside
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="provider-drawer-title"
        aria-describedby="provider-drawer-desc"
        className="flex h-full min-h-0 w-full max-w-5xl flex-col border-l border-border bg-background shadow-[var(--surface-shadow-lg)] backdrop-blur"
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

            {activeStep === 'type' ? <TypeStep {...stepProps} /> : null}
            {activeStep === 'basic' ? <BasicStep {...stepProps} /> : null}
            {activeStep === 'auth' ? <AuthStep {...stepProps} /> : null}
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
          <div className="flex flex-col text-xs text-destructive" aria-live="polite">
            {submitError ? <span>{submitError}</span> : null}
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
    </div>
  )
}
