import { useMemo, useState } from 'react'
import { toApiError } from '@/services/api'
import { gatewayApi } from '@/services/gateway'
import { modelManagementApi } from '@/services/modelManagement'
import type { GatewayConfig, ProviderConfig } from '@/types/providers'
import type { WorkbenchConfigState } from './useWorkbenchConfig'
import {
  resolveModelLabel,
  type AnthropicHeaderOption,
  type ProviderTestResult
} from './shared'

/**
 * Provider state for the providers workbench: list filtering, drawer
 * create/edit flow, deletion (including route cleanup) and connection
 * testing with the latest result kept per provider.
 */
export function useProvidersState(
  base: WorkbenchConfigState,
  deps?: { sanitizeDraftsForProvider?: (providerId: string) => void }
) {
  const { t, pushToast, config, setConfig, configQuery, customEndpoints, ensureConfig } = base
  const { sanitizeDraftsForProvider } = deps ?? {}

  const [providerSearch, setProviderSearch] = useState('')
  const [providerTypeFilter, setProviderTypeFilter] = useState<string>('all')
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [drawerMode, setDrawerMode] = useState<'create' | 'edit'>('create')
  const [editingProvider, setEditingProvider] = useState<ProviderConfig | undefined>(undefined)
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null)
  const [testingProviderId, setTestingProviderId] = useState<string | null>(null)
  const [testResults, setTestResults] = useState<Record<string, ProviderTestResult>>({})
  const [testDialogOpen, setTestDialogOpen] = useState(false)
  const [testDialogProvider, setTestDialogProvider] = useState<ProviderConfig | null>(null)
  const [testDialogUsePreset, setTestDialogUsePreset] = useState(true)
  const [testDialogPreservedExtras, setTestDialogPreservedExtras] = useState<Record<string, string>>({})
  const [noModelDialogProvider, setNoModelDialogProvider] = useState<ProviderConfig | null>(null)

  const providers = config?.providers ?? []
  const providerCount = providers.length

  const filteredProviders = useMemo(() => {
    return providers.filter((provider) => {
      const matchesType = providerTypeFilter === 'all' || (provider.type ?? 'custom') === providerTypeFilter
      if (!matchesType) return false

      const keyword = providerSearch.trim().toLowerCase()
      if (!keyword) return true

      const haystack = [
        provider.id,
        provider.label ?? '',
        provider.baseUrl,
        provider.defaultModel ?? '',
        ...(provider.models?.map((model) => model.id) ?? [])
      ]
        .join(' ')
        .toLowerCase()

      return haystack.includes(keyword)
    })
  }, [providerSearch, providerTypeFilter, providers])

  const selectedProvider = useMemo(
    () => providers.find((provider) => provider.id === selectedProviderId) ?? null,
    [providers, selectedProviderId]
  )

  const defaultLabels = useMemo(() => {
    const labels = new Map<string, string>()
    for (const provider of providers) {
      if (!provider.defaultModel || !provider.models) continue
      const matched = provider.models.find((model) => model.id === provider.defaultModel)
      if (matched) {
        labels.set(provider.id, resolveModelLabel(matched))
      }
    }
    return labels
  }, [providers])

  const anthropicTestHeaderOptions = useMemo<AnthropicHeaderOption[]>(
    () => [
      {
        key: 'anthropic-beta',
        value: 'claude-code-20250219,interleaved-thinking-2025-05-14,fine-grained-tool-streaming-2025-05-14',
        label: t('providers.testDialog.options.beta.label'),
        description: t('providers.testDialog.options.beta.description')
      }
    ],
    [t]
  )

  const handleOpenCreate = () => {
    if (!ensureConfig()) return
    setDrawerMode('create')
    setEditingProvider(undefined)
    setDrawerOpen(true)
  }

  const handleOpenEdit = (provider: ProviderConfig) => {
    if (!ensureConfig()) return
    setDrawerMode('edit')
    setEditingProvider(provider)
    setDrawerOpen(true)
  }

  const handleProviderSubmit = async (payload: ProviderConfig) => {
    if (!config) {
      throw new Error(t('settings.toast.missingConfig'))
    }

    const nextProviders =
      drawerMode === 'create'
        ? [...providers, payload]
        : providers.map((item) =>
            editingProvider && item.id === editingProvider.id
              ? { ...payload, id: editingProvider.id }
              : item
          )

    const nextConfig: GatewayConfig = {
      ...config,
      providers: nextProviders
    }

    await gatewayApi.saveConfig(nextConfig)
    setConfig(nextConfig)
    void configQuery.refetch()

    if (drawerMode === 'create') {
      setSelectedProviderId(payload.id)
    }

    pushToast({
      title:
        drawerMode === 'create'
          ? t('providers.toast.createSuccess', { name: payload.label || payload.id })
          : t('providers.toast.updateSuccess', { name: payload.label || payload.id }),
      variant: 'success'
    })
  }

  const recordTestResult = (providerId: string, result: ProviderTestResult) => {
    setTestResults((previous) => ({
      ...previous,
      [providerId]: result
    }))
  }

  const handleTestConnection = async (
    provider: ProviderConfig,
    options?: { headers?: Record<string, string>; query?: string }
  ) => {
    setTestingProviderId(provider.id)
    try {
      const payload =
        options && (options.headers || options.query)
          ? {
              headers:
                options.headers && Object.keys(options.headers).length > 0
                  ? options.headers
                  : undefined,
              query: options.query && options.query.trim().length > 0 ? options.query.trim() : undefined
            }
          : undefined

      const response = await modelManagementApi.testProvider(provider.id, payload)
      if (response.ok) {
        recordTestResult(provider.id, {
          ok: true,
          status: response.status,
          statusText: response.statusText,
          durationMs: response.durationMs,
          testedAt: Date.now()
        })
        pushToast({
          title: t('providers.toast.testSuccess'),
          description: t('providers.toast.testSuccessDesc', {
            status: response.status,
            duration: response.durationMs ? `${response.durationMs} ms` : '—'
          }),
          variant: 'success'
        })
        return
      }

      recordTestResult(provider.id, {
        ok: false,
        status: response.status,
        statusText: response.statusText,
        durationMs: response.durationMs,
        message: `${response.status} ${response.statusText}`,
        testedAt: Date.now()
      })
      pushToast({
        title: t('providers.toast.testFailure', {
          message: `${response.status} ${response.statusText}`
        }),
        variant: 'error'
      })
    } catch (error) {
      const apiError = toApiError(error)
      const message = apiError.status ? `${apiError.status} ${apiError.message}` : apiError.message
      recordTestResult(provider.id, {
        ok: false,
        status: apiError.status,
        message,
        testedAt: Date.now()
      })
      pushToast({
        title: t('providers.toast.testFailure', { message }),
        variant: 'error'
      })
    } finally {
      setTestingProviderId(null)
    }
  }

  const initiateTestConnection = (provider: ProviderConfig) => {
    const hasConfiguredModel =
      Boolean(provider.defaultModel?.trim()) ||
      Boolean(provider.models?.some((model) => model.id.trim().length > 0))
    if (!hasConfiguredModel) {
      setNoModelDialogProvider(provider)
      return
    }

    if (provider.type !== 'anthropic') {
      void handleTestConnection(provider)
      return
    }

    const providerHeaders = provider.extraHeaders ?? {}
    const recommendedLookup = new Map(
      anthropicTestHeaderOptions.map((option) => [option.key.toLowerCase(), option])
    )
    const preservedExtras: Record<string, string> = {}
    let presetDefault = true

    for (const option of anthropicTestHeaderOptions) {
      const match = Object.entries(providerHeaders).find(
        ([headerKey]) => headerKey.toLowerCase() === option.key.toLowerCase()
      )
      if (!match) continue

      const [headerName, headerValue] = match
      if (String(headerValue ?? '') !== option.value) {
        presetDefault = false
        preservedExtras[headerName] = String(headerValue ?? '')
      }
    }

    for (const [headerKey, headerValue] of Object.entries(providerHeaders)) {
      if (recommendedLookup.has(headerKey.toLowerCase())) continue
      preservedExtras[headerKey] = String(headerValue ?? '')
    }

    setTestDialogPreservedExtras(preservedExtras)
    setTestDialogUsePreset(presetDefault)
    setTestDialogProvider(provider)
    setTestDialogOpen(true)
  }

  const closeTestDialog = () => {
    setTestDialogOpen(false)
    setTestDialogProvider(null)
    setTestDialogUsePreset(true)
    setTestDialogPreservedExtras({})
  }

  const confirmTestDialog = async () => {
    if (!testDialogProvider) return

    const selectedHeaders: Record<string, string> = {}
    if (testDialogUsePreset) {
      for (const option of anthropicTestHeaderOptions) {
        selectedHeaders[option.key] = option.value
      }
    }

    const recognizedHeaders = new Map(
      anthropicTestHeaderOptions.map((option) => [option.key.toLowerCase(), option])
    )
    for (const [key, value] of Object.entries(testDialogPreservedExtras)) {
      const matchedOption = recognizedHeaders.get(key.toLowerCase())
      if (matchedOption && testDialogUsePreset) continue
      selectedHeaders[key] = value
    }

    const targetProvider = testDialogProvider
    closeTestDialog()
    await handleTestConnection(targetProvider, {
      headers: Object.keys(selectedHeaders).length > 0 ? selectedHeaders : undefined
    })
  }

  const handleDeleteProvider = async (provider: ProviderConfig) => {
    if (!ensureConfig()) return

    const nextProviders = providers.filter((item) => item.id !== provider.id)
    const sanitizeRoutes = (routes: Record<string, string> | undefined): Record<string, string> => {
      const nextRoutes: Record<string, string> = {}
      if (!routes) return nextRoutes

      for (const [source, target] of Object.entries(routes)) {
        if (!target) continue
        const [targetProvider] = target.split(':')
        if ((targetProvider && targetProvider === provider.id) || target === provider.id) {
          continue
        }
        nextRoutes[source] = target
      }

      return nextRoutes
    }

    const currentRouting = config?.endpointRouting ?? {}
    const sanitizedAnthropic = sanitizeRoutes(currentRouting.anthropic?.modelRoutes ?? config?.modelRoutes ?? {})
    const sanitizedOpenAI = sanitizeRoutes(currentRouting.openai?.modelRoutes ?? {})
    const sanitizedCustomEndpoints = (config?.customEndpoints ?? customEndpoints).map((endpoint) => {
      const currentRoutingConfig = endpoint.routing
      const currentRoutes = currentRoutingConfig?.modelRoutes
      if (!currentRoutes) {
        return endpoint
      }

      return {
        ...endpoint,
        routing: {
          ...currentRoutingConfig,
          defaults: currentRoutingConfig.defaults ?? config!.defaults,
          modelRoutes: sanitizeRoutes(currentRoutes)
        }
      }
    })

    const nextConfig: GatewayConfig = {
      ...config!,
      providers: nextProviders,
      modelRoutes: sanitizedAnthropic,
      customEndpoints: sanitizedCustomEndpoints,
      endpointRouting: {
        anthropic: {
          defaults: currentRouting.anthropic?.defaults ?? config!.defaults,
          modelRoutes: sanitizedAnthropic,
          compatibility: currentRouting.anthropic?.compatibility
        },
        openai: {
          defaults: currentRouting.openai?.defaults ?? config!.defaults,
          modelRoutes: sanitizedOpenAI,
          compatibility: currentRouting.openai?.compatibility
        }
      }
    }

    try {
      await gatewayApi.saveConfig(nextConfig)
      setConfig(nextConfig)
      // Drop route drafts pointing at the deleted provider; the merge effect
      // would otherwise keep them (they are dirty) and a later save could
      // persist a dangling route. Saved routes were sanitized in nextConfig.
      sanitizeDraftsForProvider?.(provider.id)
      if (selectedProviderId === provider.id) {
        setSelectedProviderId(null)
      }
      pushToast({
        title: t('providers.toast.deleteSuccess', { name: provider.label || provider.id }),
        variant: 'success'
      })
      void configQuery.refetch()
    } catch (error) {
      pushToast({
        title: t('providers.toast.deleteFailure', {
          message: toApiError(error).message
        }),
        variant: 'error'
      })
    }
  }

  return {
    providers,
    providerCount,
    filteredProviders,
    providerSearch,
    setProviderSearch,
    providerTypeFilter,
    setProviderTypeFilter,
    defaultLabels,
    selectedProvider,
    setSelectedProviderId,
    drawerOpen,
    setDrawerOpen,
    drawerMode,
    setDrawerMode,
    editingProvider,
    setEditingProvider,
    testingProviderId,
    testResults,
    testDialogOpen,
    testDialogProvider,
    testDialogUsePreset,
    setTestDialogUsePreset,
    testDialogPreservedExtras,
    noModelDialogProvider,
    setNoModelDialogProvider,
    anthropicTestHeaderOptions,
    handleOpenCreate,
    handleOpenEdit,
    handleProviderSubmit,
    handleDeleteProvider,
    handleTestConnection,
    initiateTestConnection,
    closeTestDialog,
    confirmTestDialog
  }
}

export type ProvidersState = ReturnType<typeof useProvidersState>
