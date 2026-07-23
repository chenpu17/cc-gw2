import { useCallback, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ProviderConfig } from '@/types/providers'
import {
  buildInitialState,
  createEmptyModel,
  defaultAuthModeForType,
  mapPresetModel,
  PROVIDER_TYPE_PRESETS,
  type FormErrors,
  type FormModel,
  type FormState
} from './ProviderDrawerSteps'

interface UseProviderFormOptions {
  mode: 'create' | 'edit'
  provider?: ProviderConfig
  existingProviderIds: string[]
}

/**
 * Provider create/edit form state: field handlers with type presets,
 * validation and serialization. Shared by the workbench drawer and the
 * setup wizard so both stay on the same rules.
 */
export function useProviderForm({ mode, provider, existingProviderIds }: UseProviderFormOptions) {
  const { t } = useTranslation()
  const [form, setForm] = useState<FormState>(() => buildInitialState(provider))
  const [errors, setErrors] = useState<FormErrors>({})
  const [advancedOpen, setAdvancedOpen] = useState(mode === 'edit')
  const providerIdRef = useRef<HTMLInputElement | null>(null)

  const resetForm = useCallback(() => {
    setForm(buildInitialState(provider))
    setErrors({})
    setAdvancedOpen(mode === 'edit')
  }, [provider, mode])

  const handleFieldChange = (field: keyof FormState) => (value: string) => {
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

  const handleSetDefaultModel = (id: string) => {
    setForm((prev) => ({ ...prev, defaultModel: id }))
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

  return {
    form,
    errors,
    advancedOpen,
    setAdvancedOpen,
    providerIdRef,
    isCreate: mode === 'create',
    resetForm,
    validate,
    serialize,
    handleFieldChange,
    handleProviderIdChange,
    handleTypeChange,
    handleModelChange,
    handleModelIdChange,
    handleRemoveModel,
    handleAddModel,
    handleAuthModeChange,
    handleProviderNonStreamViaStreamChange,
    handleModelNonStreamViaStreamChange,
    handleSetDefaultModel
  }
}

export type ProviderFormState = ReturnType<typeof useProviderForm>
