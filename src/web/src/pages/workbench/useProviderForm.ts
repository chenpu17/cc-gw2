import { useCallback, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ProviderConfig } from '@/types/providers'
import {
  buildInitialState,
  createEmptyHeader,
  createEmptyModel,
  defaultAuthModeForType,
  mapPresetModel,
  PROVIDER_TYPE_PRESETS,
  type FormErrors,
  type FormHeader,
  type FormModel,
  type FormState
} from './ProviderDrawerSteps'

/** RFC 7230 header field name token: no spaces, colons or control characters. */
const HEADER_NAME_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/

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

  /** Append probed models, skipping IDs already present in the form. */
  const handleImportModels = (models: Array<{ id: string; label?: string }>) => {
    setForm((prev) => {
      const knownIds = new Set(prev.models.map((model) => model.id.trim()))
      const imported = models
        .filter((model) => model.id.trim().length > 0 && !knownIds.has(model.id.trim()))
        .map((model) => ({
          ...createEmptyModel(),
          id: model.id.trim(),
          label: model.label?.trim() ?? ''
        }))
      if (imported.length === 0) return prev
      return { ...prev, models: [...prev.models, ...imported] }
    })
  }

  const handleHeaderChange = (index: number, patch: Partial<FormHeader>) => {
    setForm((prev) => {
      const nextHeaders = [...prev.extraHeaders]
      nextHeaders[index] = { ...nextHeaders[index], ...patch }
      return { ...prev, extraHeaders: nextHeaders }
    })
  }

  const handleAddHeader = () => {
    setForm((prev) => ({
      ...prev,
      extraHeaders: [...prev.extraHeaders, createEmptyHeader()]
    }))
  }

  const handleRemoveHeader = (index: number) => {
    setForm((prev) => {
      if (index < 0 || index >= prev.extraHeaders.length) return prev
      const nextHeaders = prev.extraHeaders.filter((_, idx) => idx !== index)
      return { ...prev, extraHeaders: nextHeaders }
    })
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

  const handleUseAbsoluteUrlChange = (checked: boolean) => {
    setForm((prev) => ({
      ...prev,
      useAbsoluteUrl: checked
    }))
  }

  const handleStreamUsageChange = (checked: boolean) => {
    setForm((prev) => ({
      ...prev,
      streamUsage: checked
    }))
  }

  const handleModelNonStreamViaStreamChange = (index: number, value: string) => {
    const nextValue = value === 'inherit' ? undefined : value === 'enabled'
    handleModelChange(index, { nonStreamViaStream: nextValue })
  }

  const handleSetDefaultModel = (id: string) => {
    setForm((prev) => ({ ...prev, defaultModel: id }))
  }

  const validateErrors = (): FormErrors => {
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

    if (form.extraHeaders.length > 0) {
      const seenHeaderNames = new Set<string>()
      for (const header of form.extraHeaders) {
        const name = header.name.trim()
        if (name.length === 0) continue
        if (!HEADER_NAME_PATTERN.test(name)) {
          nextErrors.extraHeaders = t('providers.drawer.errors.headerNameInvalid')
          break
        }
        const lowerName = name.toLowerCase()
        if (seenHeaderNames.has(lowerName)) {
          nextErrors.extraHeaders = t('providers.drawer.errors.headerNameDuplicate')
          break
        }
        seenHeaderNames.add(lowerName)
      }
    }

    setErrors(nextErrors)
    return nextErrors
  }

  const validate = (): boolean => Object.keys(validateErrors()).length === 0

  const serialize = (): ProviderConfig => {
    const trimmedModels = form.models
      .map((model) => ({
        id: model.id.trim(),
        label: model.label?.trim() ? model.label.trim() : undefined,
        nonStreamViaStream: model.nonStreamViaStream
      }))
      .filter((model) => model.id.length > 0)

    const extraHeaders: Record<string, string> = {}
    for (const header of form.extraHeaders) {
      const name = header.name.trim()
      if (name.length > 0) {
        extraHeaders[name] = header.value
      }
    }
    const hasExtraHeaders = Object.keys(extraHeaders).length > 0
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
      extraHeaders: hasExtraHeaders ? extraHeaders : undefined,
      authMode
    }
    if (form.nonStreamViaStream) {
      payload.nonStreamViaStream = true
    }
    if (form.useAbsoluteUrl) {
      payload.useAbsoluteUrl = true
    }
    // Only send when explicitly on: absent field keeps older backends and
    // hand-edited configs on their default (off) behavior.
    if (form.streamUsage) {
      payload.streamUsage = true
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
    validateErrors,
    serialize,
    handleFieldChange,
    handleProviderIdChange,
    handleTypeChange,
    handleModelChange,
    handleModelIdChange,
    handleRemoveModel,
    handleAddModel,
    handleImportModels,
    handleHeaderChange,
    handleAddHeader,
    handleRemoveHeader,
    handleAuthModeChange,
    handleProviderNonStreamViaStreamChange,
    handleUseAbsoluteUrlChange,
    handleStreamUsageChange,
    handleModelNonStreamViaStreamChange,
    handleSetDefaultModel
  }
}

export type ProviderFormState = ReturnType<typeof useProviderForm>
