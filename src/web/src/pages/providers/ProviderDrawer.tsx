import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ProviderConfig, ProviderModelConfig } from '@/types/providers'
import { cn } from '@/lib/utils'

export interface ProviderDrawerProps {
  open: boolean
  mode: 'create' | 'edit'
  provider?: ProviderConfig
  existingProviderIds: string[]
  onClose: () => void
  onSubmit: (payload: ProviderConfig) => Promise<void>
}

interface FormModel extends ProviderModelConfig {
  _key: string
}

interface FormState {
  id: string
  label: string
  baseUrl: string
  apiKey: string
  type: ProviderConfig['type']
  defaultModel: string
  models: FormModel[]
  authMode: 'apiKey' | 'authToken' | 'xAuthToken'
}

interface FormErrors {
  id?: string
  baseUrl?: string
  models?: string
}

function createKey(): string {
  if (typeof globalThis.crypto !== 'undefined' && typeof globalThis.crypto.randomUUID === 'function') {
    return globalThis.crypto.randomUUID()
  }
  return Math.random().toString(36).slice(2, 10)
}

function createEmptyModel(): FormModel {
  return {
    _key: createKey(),
    id: '',
    label: ''
  }
}

const PROVIDER_TYPE_PRESETS: Record<Exclude<ProviderConfig['type'], undefined> | 'openai', {
  baseUrl?: string
  models?: Array<Omit<FormModel, '_key'>>
  defaultModel?: string
}> = {
  openai: {
    baseUrl: 'https://api.openai.com/v1'
  },
  deepseek: {
    baseUrl: 'https://api.deepseek.com/v1'
  },
  huawei: {
    baseUrl: 'https://api.modelarts-maas.com/v1'
  },
  kimi: {
    baseUrl: 'https://api.moonshot.cn/v1'
  },
  anthropic: {
    baseUrl: 'https://api.anthropic.com/v1'
  },
  custom: {}
}

const PROVIDER_TYPE_OPTIONS: Array<{ value: ProviderConfig['type']; label: string }> = [
  { value: 'openai', label: 'OpenAI' },
  { value: 'deepseek', label: 'DeepSeek' },
  { value: 'huawei', label: 'Huawei Cloud' },
  { value: 'kimi', label: 'Kimi' },
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'custom', label: 'Custom' }
]

function buildInitialState(provider?: ProviderConfig): FormState {
  if (!provider) {
    return {
      id: '',
      label: '',
      baseUrl: '',
      apiKey: '',
      type: 'custom',
      defaultModel: '',
      models: [],
      authMode: 'apiKey'
    }
  }

  return {
    id: provider.id,
    label: provider.label ?? provider.id,
    baseUrl: provider.baseUrl,
    apiKey: provider.apiKey ?? '',
    type: provider.type ?? 'custom',
    defaultModel: provider.defaultModel ?? '',
    models: (provider.models ?? []).map((model) => ({
      ...model,
      _key: createKey()
    })),
    authMode: provider.authMode ?? 'apiKey'
  }
}

function mapPresetModel(model: Omit<FormModel, '_key'>): FormModel {
  return {
    _key: createKey(),
    id: model.id,
    label: model.label
  }
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
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const closeButtonRef = useRef<HTMLButtonElement | null>(null)
  const providerIdRef = useRef<HTMLInputElement | null>(null)
  const [showAdvanced, setShowAdvanced] = useState(mode === 'edit')

  useEffect(() => {
    if (open) {
      setForm(buildInitialState(provider))
      setErrors({})
      setSubmitError(null)
      setSubmitting(false)
      setShowAdvanced(mode === 'edit')
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
        value:
          form.authMode === 'apiKey'
            ? t('providers.drawer.fields.authModeApiKey')
            : form.authMode === 'authToken'
              ? t('providers.drawer.fields.authModeAuthToken')
              : t('providers.drawer.fields.authModeXAuthToken')
      },
      {
        label: t('providers.drawer.summary.models'),
        value: availableDefaultModels.length.toLocaleString()
      }
    ],
    [availableDefaultModels.length, form.authMode, selectedTypeLabel, t]
  )

  const handleInputChange = (field: keyof FormState) => (value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  const handleProviderIdChange = (value: string) => {
    setForm((prev) => {
      const shouldSyncLabel =
        !showAdvanced || prev.label.trim().length === 0 || prev.label === prev.id
      const nextLabel = shouldSyncLabel ? value : prev.label
      return { ...prev, id: value, label: nextLabel }
    })
  }

  const handleTypeChange = (value: ProviderConfig['type']) => {
    setForm((prev) => {
      const presetKey = value ?? 'custom'
      const preset = PROVIDER_TYPE_PRESETS[presetKey] ?? PROVIDER_TYPE_PRESETS.custom
      const knownBaseUrls = Object.values(PROVIDER_TYPE_PRESETS)
        .map((item) => item.baseUrl)
        .filter((item): item is string => Boolean(item))
      const shouldReplaceBaseUrl = !prev.baseUrl || knownBaseUrls.includes(prev.baseUrl)
      const shouldApplyModels =
        mode === 'create' && (prev.models.length === 0 || prev.models.every((model) => model.id.trim().length === 0))

      const next: FormState = {
        ...prev,
        type: value,
        authMode: prev.authMode ?? 'apiKey'
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
        !showAdvanced || !current.label || current.label === current.id
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
    const trimmedModels: ProviderModelConfig[] = form.models
      .map((model) => ({
        id: model.id.trim(),
        label: model.label?.trim() ? model.label.trim() : undefined
      }))
      .filter((model) => model.id.length > 0)

    const extraHeaders = provider?.extraHeaders && Object.keys(provider.extraHeaders).length > 0 ? provider.extraHeaders : undefined
    const authMode = form.authMode !== 'apiKey' ? form.authMode : undefined

    return {
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
  }

  const handleSubmit = async () => {
    setSubmitError(null)
    if (!validate()) return
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

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-background/80 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />
      <aside
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="provider-drawer-title"
        aria-describedby="provider-drawer-desc"
        className="flex h-full w-full max-w-5xl flex-col border-l border-border bg-background shadow-lg"
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
            <button
              type="button"
              ref={closeButtonRef}
              onClick={onClose}
              className="rounded-full border border-border bg-card px-4 py-2 text-sm transition hover:border-primary/20 hover:bg-accent/50"
            >
              {t('common.actions.close')}
            </button>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-3">
            {providerSummaryItems.map((item) => (
              <div
                key={item.label}
                className="rounded-lg border border-border bg-card px-4 py-3"
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

        <div className="grid flex-1 overflow-hidden xl:grid-cols-[minmax(0,1fr)_280px]">
          <div className="overflow-y-auto px-6 py-5">
            <section className="space-y-5" aria-labelledby="provider-type-fields">
              <div className="space-y-1">
                <h3 id="provider-type-fields" className="text-sm font-semibold">{t('providers.drawer.sections.type')}</h3>
                <p className="text-xs text-muted-foreground">{t('providers.drawer.hints.type')}</p>
              </div>

              <div className="grid gap-2 md:grid-cols-3">
                {PROVIDER_TYPE_OPTIONS.map((option) => {
                  const active = option.value === form.type
                  return (
                    <button
                      key={option.value ?? 'custom'}
                      type="button"
                      onClick={() => handleTypeChange(option.value)}
                      className={cn(
                        'rounded-2xl border px-4 py-3 text-left transition',
                        active
                          ? 'border-primary bg-primary/10 text-primary shadow-sm'
                          : 'border-border bg-card text-foreground hover:border-primary/20 hover:bg-accent/50'
                      )}
                    >
                      <div className="text-sm font-semibold">{option.label}</div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {PROVIDER_TYPE_PRESETS[option.value ?? 'custom']?.baseUrl ?? t('providers.drawer.hints.customProvider')}
                      </div>
                    </button>
                  )
                })}
              </div>
            </section>

            <section className="mt-8 space-y-4" aria-labelledby="provider-basic-info">
              <div className="flex items-center justify-between gap-4">
                <div className="space-y-1">
                  <h3 id="provider-basic-info" className="text-sm font-semibold">{t('providers.drawer.sections.basic')}</h3>
                  <p className="text-xs text-muted-foreground">{t('providers.drawer.hints.basic')}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowAdvanced((prev) => !prev)}
                  className="rounded-full border border-border bg-card px-3 py-1.5 text-xs transition hover:border-primary/20 hover:bg-accent/50"
                >
                  {showAdvanced
                    ? t('providers.drawer.fields.hideAdvanced')
                    : t('providers.drawer.fields.showAdvanced')}
                </button>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <label className="flex flex-col gap-2 text-sm">
                  <span className="text-xs text-muted-foreground">{t('providers.drawer.fields.id')}</span>
                  <input
                    value={form.id}
                    ref={providerIdRef}
                    onChange={(event) => handleProviderIdChange(event.target.value)}
                    disabled={!isCreate}
                    placeholder={t('providers.drawer.fields.idPlaceholder')}
                    className="h-10 rounded-md border border-input bg-background px-3 py-2 text-sm transition-all focus:border-primary/40 focus:outline-none focus:ring-2 focus:ring-ring disabled:bg-muted/60 disabled:text-muted-foreground"
                    aria-invalid={Boolean(errors.id)}
                  />
                  {errors.id ? <span className="text-xs text-red-500">{errors.id}</span> : null}
                </label>
                <label className="flex flex-col gap-2 text-sm">
                  <span className="text-xs text-muted-foreground">{t('providers.drawer.fields.label')}</span>
                  <input
                    value={form.label}
                    onChange={(event) => handleInputChange('label')(event.target.value)}
                    placeholder={t('providers.drawer.fields.labelPlaceholder')}
                    className="h-10 rounded-md border border-input bg-background px-3 py-2 text-sm transition-all focus:border-primary/40 focus:outline-none focus:ring-2 focus:ring-ring disabled:bg-muted/60 disabled:text-muted-foreground"
                  />
                </label>
              </div>

              <label className="flex flex-col gap-2 text-sm">
                <span className="text-xs text-muted-foreground">{t('providers.drawer.fields.baseUrl')}</span>
                <input
                  value={form.baseUrl}
                  onChange={(event) => handleInputChange('baseUrl')(event.target.value)}
                  placeholder={t('providers.drawer.fields.baseUrlPlaceholder')}
                  className="h-10 rounded-md border border-input bg-background px-3 py-2 text-sm transition-all focus:border-primary/40 focus:outline-none focus:ring-2 focus:ring-ring disabled:bg-muted/60 disabled:text-muted-foreground"
                  aria-invalid={Boolean(errors.baseUrl)}
                />
                {errors.baseUrl ? <span className="text-xs text-red-500">{errors.baseUrl}</span> : null}
              </label>
            </section>

            <section className="mt-8 space-y-4" aria-labelledby="provider-auth-fields">
              <div className="space-y-1">
                <h3 id="provider-auth-fields" className="text-sm font-semibold">{t('providers.drawer.sections.auth')}</h3>
                <p className="text-xs text-muted-foreground">{t('providers.drawer.hints.auth')}</p>
              </div>

              <label className="flex flex-col gap-2 text-sm">
                <span className="text-xs text-muted-foreground">{t('providers.drawer.fields.apiKey')}</span>
                <input
                  value={form.apiKey}
                  onChange={(event) => handleInputChange('apiKey')(event.target.value)}
                  placeholder={t('providers.drawer.fields.apiKeyPlaceholder')}
                  className="h-10 rounded-md border border-input bg-background px-3 py-2 text-sm transition-all focus:border-primary/40 focus:outline-none focus:ring-2 focus:ring-ring disabled:bg-muted/60 disabled:text-muted-foreground"
                />
              </label>

              <fieldset className="grid gap-2 rounded-lg border border-border bg-card p-4 text-xs">
                <legend className="px-1 text-muted-foreground">
                  {t('providers.drawer.fields.authMode')}
                </legend>
                <p className="text-[11px] text-muted-foreground">
                  {t('providers.drawer.fields.authModeHint')}
                </p>
                <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-transparent px-3 py-2 transition hover:bg-primary/5">
                  <input
                    type="radio"
                    name="provider-auth-mode"
                    value="apiKey"
                    checked={form.authMode === 'apiKey'}
                    onChange={() => handleAuthModeChange('apiKey')}
                    className="mt-0.5"
                  />
                  <span>{t('providers.drawer.fields.authModeApiKey')}</span>
                </label>
                <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-transparent px-3 py-2 transition hover:bg-primary/5">
                  <input
                    type="radio"
                    name="provider-auth-mode"
                    value="authToken"
                    checked={form.authMode === 'authToken'}
                    onChange={() => handleAuthModeChange('authToken')}
                    className="mt-0.5"
                  />
                  <span>{t('providers.drawer.fields.authModeAuthToken')}</span>
                </label>
                <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-transparent px-3 py-2 transition hover:bg-primary/5">
                  <input
                    type="radio"
                    name="provider-auth-mode"
                    value="xAuthToken"
                    checked={form.authMode === 'xAuthToken'}
                    onChange={() => handleAuthModeChange('xAuthToken')}
                    className="mt-0.5"
                  />
                  <span>{t('providers.drawer.fields.authModeXAuthToken')}</span>
                </label>
              </fieldset>
            </section>

            <section className="mt-8 space-y-4" aria-labelledby="provider-model-fields">
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-1">
                  <h3 id="provider-model-fields" className="text-sm font-semibold">{t('providers.drawer.fields.models')}</h3>
                  <p className="text-xs text-muted-foreground">{t('providers.drawer.modelsDescription')}</p>
                </div>
                <button
                  type="button"
                  onClick={handleAddModel}
                  className="rounded-full border border-border bg-card px-3 py-1.5 text-xs transition hover:border-primary/20 hover:bg-accent/50"
                >
                  {t('providers.drawer.fields.addModel')}
                </button>
              </div>

              {errors.models ? <p className="text-xs text-red-500">{errors.models}</p> : null}

              <div className="space-y-4">
                {form.models.map((model, index) => (
                  <div
                    key={model._key}
                    className="rounded-lg border border-border bg-card p-4"
                  >
                    <div className="grid gap-4 md:grid-cols-2">
                      <label className="flex flex-col gap-2 text-sm">
                        <span className="text-xs text-muted-foreground">{t('providers.drawer.fields.modelId')}</span>
                        <input
                          value={model.id}
                          onChange={(event) => handleModelIdChange(index, event.target.value)}
                          placeholder={t('providers.drawer.fields.modelIdPlaceholder')}
                          className="h-10 rounded-md border border-input bg-background px-3 py-2 text-sm transition-all focus:border-primary/40 focus:outline-none focus:ring-2 focus:ring-ring disabled:bg-muted/60 disabled:text-muted-foreground"
                        />
                      </label>
                      {showAdvanced ? (
                        <label className="flex flex-col gap-2 text-sm">
                          <span className="text-xs text-muted-foreground">{t('providers.drawer.fields.modelLabel')}</span>
                          <input
                            value={model.label ?? ''}
                            onChange={(event) => handleModelChange(index, { label: event.target.value })}
                            placeholder={t('providers.drawer.fields.modelLabelPlaceholder')}
                            className="h-10 rounded-md border border-input bg-background px-3 py-2 text-sm transition-all focus:border-primary/40 focus:outline-none focus:ring-2 focus:ring-ring disabled:bg-muted/60 disabled:text-muted-foreground"
                          />
                        </label>
                      ) : null}
                    </div>

                    <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs">
                      <label className="flex items-center gap-2 text-muted-foreground">
                        <input
                          type="radio"
                          name="defaultModel"
                          value={model.id}
                          checked={form.defaultModel === model.id}
                          onChange={() => setForm((prev) => ({ ...prev, defaultModel: model.id }))}
                          disabled={model.id.trim().length === 0}
                        />
                        {t('providers.drawer.fields.setDefault')}
                      </label>
                      <button
                        type="button"
                        className="text-red-500 transition hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-40"
                        onClick={() => handleRemoveModel(index)}
                        disabled={form.models.length === 0}
                      >
                        {t('providers.drawer.fields.removeModel')}
                      </button>
                    </div>
                  </div>
                ))}

                {form.models.length === 0 ? (
                  <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-5 dark:border-amber-700/50 dark:bg-amber-900/20">
                    <div className="space-y-2">
                      <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">
                        {t('providers.drawer.noModelsTitle')}
                      </p>
                      <p className="text-xs leading-relaxed text-amber-800 dark:text-amber-300">
                        {t('providers.drawer.noModelsHint', { providerId: form.id || 'provider-id' })}
                      </p>
                      <div className="rounded-md border border-border bg-secondary p-2.5">
                        <p className="mb-1.5 text-xs font-medium text-foreground">
                          {t('providers.drawer.routeExample')}
                        </p>
                        <code className="block rounded-md border border-border bg-card px-2.5 py-1.5 font-mono text-xs text-foreground">
                          &quot;claude-*&quot;: &quot;{(form.id || 'provider-id').trim() || 'provider-id'}:*&quot;
                        </code>
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>

              {availableDefaultModels.length > 1 ? (
                <div className="text-xs text-muted-foreground">
                  {t('providers.drawer.defaultHint', { model: form.defaultModel || t('providers.card.noDefault') })}
                </div>
              ) : null}
            </section>
          </div>

          <aside className="hidden border-l border-border bg-secondary px-5 py-5 xl:block">
            <div className="sticky top-0 space-y-5">
              <div className="rounded-lg border border-border bg-card p-4">
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

              <div className="rounded-lg border border-border bg-card p-4">
                <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                  {t('providers.drawer.sections.checklist')}
                </p>
                <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
                  <li>{t('providers.drawer.hints.checkUrl')}</li>
                  <li>{t('providers.drawer.hints.checkAuth')}</li>
                  <li>{t('providers.drawer.hints.checkModels')}</li>
                </ul>
              </div>

              {showAdvanced && (
                <div className="rounded-lg border border-primary/20 bg-accent p-4 text-sm text-foreground">
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
          <div className="flex flex-col text-xs text-red-500" aria-live="polite">
            {submitError ? <span>{submitError}</span> : null}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-full border border-border bg-card px-4 py-2 transition hover:border-primary/20 hover:bg-accent/50"
              disabled={submitting}
            >
              {t('common.actions.cancel')}
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              className="rounded-full bg-primary px-5 py-2 text-primary-foreground shadow-[0_8px_20px_-12px_rgba(59,130,246,0.65)] transition hover:-translate-y-0.5 hover:bg-primary/95 disabled:opacity-60"
              disabled={submitting}
            >
              {submitting ? t('common.actions.saving') : t('common.actions.save')}
            </button>
          </div>
        </footer>
      </aside>
    </div>
  )
}
