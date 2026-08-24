import { useCallback, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { FailoverPolicyConfig, ProviderConfig } from '@/types/providers'
import {
  buildInitialState,
  createEmptyHeader,
  createEmptyMember,
  createEmptyModel,
  defaultAuthModeForType,
  mapPresetModel,
  PROVIDER_TYPE_PRESETS,
  type FormErrors,
  type FormFailover,
  type FormHeader,
  type FormModel,
  type FormState
} from './ProviderDrawerSteps'

/** RFC 7230 header field name token: no spaces, colons or control characters. */
const HEADER_NAME_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/

const RPM_LIMIT_MAX = 1_000_000
const RPM_WAIT_SECONDS_MAX = 3600
const FAILOVER_THRESHOLD_MAX = 100
const FAILOVER_COOLDOWN_MAX = 86_400
const FAILOVER_WINDOW_MAX = 86_400

/** `providerId:modelId` / `providerId:*`; the member-target grammar. */
const MEMBER_TARGET_PATTERN = /^[^:\s]+:[^:\s]+$/

/** Status-code trigger tokens: `1xx`-`5xx` classes or literal 100-599. */
function isValidStatusCodeToken(token: string): boolean {
  if (/^[1-5]xx$/.test(token)) return true
  if (/^\d{3}$/.test(token)) {
    const code = Number(token)
    return code >= 100 && code <= 599
  }
  return false
}

/** Empty string inputs omit the field entirely — the gateway default applies. */
function serializeFailover(failover: FormFailover): FailoverPolicyConfig | undefined {
  const result: FailoverPolicyConfig = {}
  const consecutiveFailures = Number(failover.consecutiveFailures.trim())
  if (failover.consecutiveFailures.trim() && Number.isInteger(consecutiveFailures)) {
    result.consecutiveFailures = consecutiveFailures
  }
  const cooldownSeconds = Number(failover.cooldownSeconds.trim())
  if (failover.cooldownSeconds.trim() && Number.isInteger(cooldownSeconds)) {
    result.cooldownSeconds = cooldownSeconds
  }
  const failureWindowSeconds = Number(failover.failureWindowSeconds.trim())
  if (failover.failureWindowSeconds.trim() && Number.isInteger(failureWindowSeconds)) {
    result.failureWindowSeconds = failureWindowSeconds
  }
  const codes = failover.triggerStatusCodes
    .split(',')
    .map((token) => token.trim())
    .filter(Boolean)
  if (codes.length > 0) {
    result.triggerStatusCodes = codes
  }
  return Object.keys(result).length > 0 ? result : undefined
}

interface UseProviderFormOptions {
  mode: 'create' | 'edit'
  provider?: ProviderConfig
  existingProviderIds: string[]
  /**
   * Full provider list (workbench only) — lets aggregate validation reject
   * members pointing at missing or nested-aggregate providers. Absent (setup
   * wizard) skips the reference checks.
   */
  providers?: ProviderConfig[]
}

/**
 * Provider create/edit form state: field handlers with type presets,
 * validation and serialization. Shared by the workbench drawer and the
 * setup wizard so both stay on the same rules.
 */
export function useProviderForm({ mode, provider, existingProviderIds, providers }: UseProviderFormOptions) {
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

  /** Aggregate member chain editing — all keyed by _key so dnd reorders stay stable. */
  const patchModelByKey = (modelKey: string, patch: (model: FormModel) => FormModel) => {
    setForm((prev) => ({
      ...prev,
      models: prev.models.map((model) => (model._key === modelKey ? patch(model) : model))
    }))
  }

  const handleAddMember = (modelKey: string) => {
    patchModelByKey(modelKey, (model) => ({
      ...model,
      members: [...model.members, createEmptyMember()]
    }))
  }

  const handleRemoveMember = (modelKey: string, memberKey: string) => {
    patchModelByKey(modelKey, (model) => ({
      ...model,
      members: model.members.filter((member) => member._key !== memberKey)
    }))
  }

  const handleMemberTargetChange = (modelKey: string, memberKey: string, target: string) => {
    patchModelByKey(modelKey, (model) => ({
      ...model,
      members: model.members.map((member) =>
        member._key === memberKey ? { ...member, target } : member
      )
    }))
  }

  const handleReorderMembers = (modelKey: string, activeKey: string, overKey: string) => {
    if (activeKey === overKey) return
    patchModelByKey(modelKey, (model) => {
      const from = model.members.findIndex((member) => member._key === activeKey)
      const to = model.members.findIndex((member) => member._key === overKey)
      if (from < 0 || to < 0) return model
      const next = [...model.members]
      const [moved] = next.splice(from, 1)
      next.splice(to, 0, moved)
      return { ...model, members: next }
    })
  }

  const handleModelFailoverChange = (modelKey: string, patch: Partial<FormFailover>) => {
    patchModelByKey(modelKey, (model) => ({
      ...model,
      failover: { ...model.failover, ...patch }
    }))
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

    // Aggregate providers have no upstream URL of their own.
    if (form.type !== 'aggregate') {
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
    }

    if (form.type === 'aggregate') {
      if (form.models.length === 0) {
        nextErrors.models = t('providers.drawer.errors.modelsRequired')
      }
      const memberErrors: Record<string, string> = {}
      const failoverErrors: Record<string, string> = {}
      const providerById = new Map((providers ?? []).map((item) => [item.id, item]))
      for (const model of form.models) {
        const targets = model.members
          .map((member) => member.target.trim())
          .filter((target) => target.length > 0)
        if (targets.length === 0) {
          memberErrors[model._key] = t('providers.aggregate.errors.memberRequired')
        } else {
          const seen = new Set<string>()
          for (const target of targets) {
            if (!MEMBER_TARGET_PATTERN.test(target)) {
              memberErrors[model._key] = t('providers.aggregate.errors.memberInvalid')
              break
            }
            const [memberProviderId] = target.split(':')
            if (providers) {
              const referenced = providerById.get(memberProviderId)
              if (!referenced) {
                memberErrors[model._key] = t('providers.aggregate.errors.memberDangling', {
                  provider: memberProviderId
                })
                break
              }
              if (referenced.type === 'aggregate' || memberProviderId === form.id.trim()) {
                memberErrors[model._key] = t('providers.aggregate.errors.memberNested', {
                  provider: memberProviderId
                })
                break
              }
            }
            if (seen.has(target)) {
              memberErrors[model._key] = t('providers.aggregate.errors.memberDuplicate', {
                target
              })
              break
            }
            seen.add(target)
          }
        }

        const numericRanges: Array<[string, number, number]> = [
          [model.failover.consecutiveFailures, 1, FAILOVER_THRESHOLD_MAX],
          [model.failover.cooldownSeconds, 1, FAILOVER_COOLDOWN_MAX],
          [model.failover.failureWindowSeconds, 1, FAILOVER_WINDOW_MAX]
        ]
        const numericInvalid = numericRanges.some(([raw, min, max]) => {
          const trimmed = raw.trim()
          if (!trimmed) return false
          const parsed = Number(trimmed)
          return !Number.isInteger(parsed) || parsed < min || parsed > max
        })
        const codeTokens = model.failover.triggerStatusCodes
          .split(',')
          .map((token) => token.trim())
          .filter(Boolean)
        if (numericInvalid) {
          failoverErrors[model._key] = t('providers.aggregate.errors.failoverInvalid')
        } else if (codeTokens.some((token) => !isValidStatusCodeToken(token))) {
          failoverErrors[model._key] = t('providers.aggregate.errors.triggerCodesInvalid')
        }
      }
      if (Object.keys(memberErrors).length > 0) {
        nextErrors.members = memberErrors
      }
      if (Object.keys(failoverErrors).length > 0) {
        nextErrors.failover = failoverErrors
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

    const trimmedRpmLimit = form.rpmLimit.trim()
    if (trimmedRpmLimit.length > 0) {
      const parsed = Number(trimmedRpmLimit)
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > RPM_LIMIT_MAX) {
        nextErrors.rpmLimit = t('providers.drawer.errors.rpmLimitInvalid')
      }
    }

    const trimmedRpmWait = form.rpmMaxWaitSeconds.trim()
    if (trimmedRpmWait.length > 0) {
      const parsed = Number(trimmedRpmWait)
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > RPM_WAIT_SECONDS_MAX) {
        nextErrors.rpmMaxWaitSeconds = t('providers.drawer.errors.rpmMaxWaitInvalid')
      }
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
    const isAggregate = form.type === 'aggregate'
    const trimmedModels = form.models
      .map((model) => ({
        id: model.id.trim(),
        label: model.label?.trim() ? model.label.trim() : undefined,
        nonStreamViaStream: model.nonStreamViaStream,
        ...(isAggregate
          ? {
              members: model.members
                .map((member) => ({ target: member.target.trim() }))
                .filter((member) => member.target.length > 0),
              failover: serializeFailover(model.failover)
            }
          : null)
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
      // Aggregate providers forward through their member backends; they have
      // no base URL of their own and the field is omitted on the wire.
      baseUrl: isAggregate ? undefined : form.baseUrl.trim(),
      apiKey: isAggregate ? undefined : form.apiKey.trim() || undefined,
      type: form.type ?? 'custom',
      defaultModel: isAggregate ? undefined : form.defaultModel || undefined,
      models: trimmedModels.length > 0 ? trimmedModels : undefined,
      extraHeaders: isAggregate ? undefined : hasExtraHeaders ? extraHeaders : undefined,
      authMode: isAggregate ? undefined : authMode
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
    // Empty inputs omit the fields entirely: absent keeps the unlimited /
    // default-wait behavior on the backend.
    const rpmLimit = Number(form.rpmLimit.trim())
    if (form.rpmLimit.trim().length > 0 && Number.isInteger(rpmLimit) && rpmLimit >= 1) {
      payload.rpmLimit = rpmLimit
    }
    const rpmMaxWaitSeconds = Number(form.rpmMaxWaitSeconds.trim())
    if (
      form.rpmMaxWaitSeconds.trim().length > 0 &&
      Number.isInteger(rpmMaxWaitSeconds) &&
      rpmMaxWaitSeconds >= 1
    ) {
      payload.rpmMaxWaitSeconds = rpmMaxWaitSeconds
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
    handleSetDefaultModel,
    handleAddMember,
    handleRemoveMember,
    handleMemberTargetChange,
    handleReorderMembers,
    handleModelFailoverChange
  }
}

export type ProviderFormState = ReturnType<typeof useProviderForm>
