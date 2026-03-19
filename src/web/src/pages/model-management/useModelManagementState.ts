import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { customEndpointsApi, toApiError, type ApiError } from '@/services/api'
import { gatewayApi } from '@/services/gateway'
import { modelManagementApi } from '@/services/modelManagement'
import { queryKeys } from '@/services/queryKeys'
import { useAppMutation } from '@/hooks/useAppMutation'
import { useApiQuery } from '@/hooks/useApiQuery'
import { useToast } from '@/providers/ToastProvider'
import type { CustomEndpoint } from '@/types/endpoints'
import type {
  EndpointRoutingConfig,
  GatewayConfig,
  ProviderConfig,
  RoutingPreset
} from '@/types/providers'
import {
  areRouteEntriesDirty,
  buildTabs,
  createEntryId,
  deriveRoutesFromConfig,
  getSavedRoutesFromConfig,
  resolveModelLabel,
  type AnthropicHeaderOption,
  type ConfirmAction,
  type ManagementTab,
  type ModelRouteEntry
} from './shared'

function buildPresetsMap(config: GatewayConfig, customEndpoints: CustomEndpoint[]): Record<string, RoutingPreset[]> {
  const presetsMap: Record<string, RoutingPreset[]> = {
    anthropic: config.routingPresets?.anthropic ?? [],
    openai: config.routingPresets?.openai ?? []
  }

  for (const endpoint of customEndpoints) {
    const updatedEndpoint = config.customEndpoints?.find((item) => item.id === endpoint.id)
    presetsMap[endpoint.id] = updatedEndpoint?.routingPresets ?? endpoint.routingPresets ?? []
  }

  return presetsMap
}

export function useModelManagementState() {
  const { t } = useTranslation()
  const { pushToast } = useToast()
  const queryClient = useQueryClient()

  const configQuery = useApiQuery<GatewayConfig, ApiError>(
    queryKeys.config.full(),
    gatewayApi.configRequest()
  )

  const customEndpointsQuery = useQuery({
    queryKey: queryKeys.customEndpoints.all(),
    queryFn: customEndpointsApi.list,
    refetchInterval: 10000
  })

  const customEndpoints = customEndpointsQuery.data?.endpoints ?? []
  const tabs = useMemo<ManagementTab[]>(() => buildTabs(t, customEndpoints), [customEndpoints, t])

  const [activeTab, setActiveTab] = useState<string>('providers')
  const [config, setConfig] = useState<GatewayConfig | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [drawerMode, setDrawerMode] = useState<'create' | 'edit'>('create')
  const [editingProvider, setEditingProvider] = useState<ProviderConfig | undefined>(undefined)
  const [editingEndpoint, setEditingEndpoint] = useState<CustomEndpoint | undefined>(undefined)
  const [testingProviderId, setTestingProviderId] = useState<string | null>(null)
  const [endpointDrawerOpen, setEndpointDrawerOpen] = useState(false)
  const [routesByEndpoint, setRoutesByEndpoint] = useState<Record<string, ModelRouteEntry[]>>({})
  const [routeError, setRouteError] = useState<Record<string, string | null>>({})
  const [savingRouteFor, setSavingRouteFor] = useState<string | null>(null)
  const [presetsByEndpoint, setPresetsByEndpoint] = useState<Record<string, RoutingPreset[]>>({})
  const [presetNameByEndpoint, setPresetNameByEndpoint] = useState<Record<string, string>>({})
  const [presetErrorByEndpoint, setPresetErrorByEndpoint] = useState<Record<string, string | null>>({})
  const [savingPresetFor, setSavingPresetFor] = useState<string | null>(null)
  const [applyingPreset, setApplyingPreset] = useState<{ endpoint: string; name: string } | null>(null)
  const [deletingPreset, setDeletingPreset] = useState<{ endpoint: string; name: string } | null>(null)
  const [testDialogOpen, setTestDialogOpen] = useState(false)
  const [testDialogProvider, setTestDialogProvider] = useState<ProviderConfig | null>(null)
  const [testDialogUsePreset, setTestDialogUsePreset] = useState(true)
  const [testDialogPreservedExtras, setTestDialogPreservedExtras] = useState<Record<string, string>>({})
  const [savingClaudeValidation, setSavingClaudeValidation] = useState(false)
  const [presetsExpanded, setPresetsExpanded] = useState<Record<string, boolean>>({})
  const [presetDiffDialog, setPresetDiffDialog] = useState<{ endpoint: string; preset: RoutingPreset } | null>(null)
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null)
  const [confirmingAction, setConfirmingAction] = useState(false)
  const [providerSearch, setProviderSearch] = useState('')
  const [providerTypeFilter, setProviderTypeFilter] = useState<string>('all')

  const systemTabs = useMemo(() => tabs.filter((tab) => tab.isSystem), [tabs])
  const customTabs = useMemo(() => tabs.filter((tab) => !tab.isSystem), [tabs])
  const activeTabInfo = useMemo(
    () => tabs.find((tab) => tab.key === activeTab) ?? tabs[0] ?? null,
    [activeTab, tabs]
  )

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

  useEffect(() => {
    if (!configQuery.data) return

    const incoming = configQuery.data
    setConfig(incoming)
    setRoutesByEndpoint((previous) => {
      const nextFromServer = deriveRoutesFromConfig(incoming, customEndpoints)
      if (!previous || Object.keys(previous).length === 0) {
        return nextFromServer
      }

      const merged: Record<string, ModelRouteEntry[]> = { ...nextFromServer }
      for (const [endpoint, previousEntries] of Object.entries(previous)) {
        if (!(endpoint in nextFromServer)) continue
        const savedRoutes = getSavedRoutesFromConfig(incoming, customEndpoints, endpoint)
        if (areRouteEntriesDirty(previousEntries, savedRoutes)) {
          merged[endpoint] = previousEntries
        }
      }
      return merged
    })
    setRouteError({})
    setPresetsByEndpoint(buildPresetsMap(incoming, customEndpoints))
  }, [configQuery.data, customEndpoints])

  useEffect(() => {
    if (!configQuery.isError || !configQuery.error) return

    pushToast({
      title: t('providers.toast.loadFailure', { message: configQuery.error.message }),
      variant: 'error'
    })
  }, [configQuery.error, configQuery.isError, pushToast, t])

  useEffect(() => {
    if (tabs.some((tab) => tab.key === activeTab)) return
    setActiveTab('providers')
  }, [activeTab, tabs])

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

  const providerModelOptions = useMemo(() => {
    const options: Array<{ value: string; label: string }> = []
    const seen = new Set<string>()

    for (const provider of providers) {
      const providerDisplay =
        provider.label && provider.label !== provider.id
          ? `${provider.label} (${provider.id})`
          : provider.id
      const models = provider.models ?? []

      if (models.length > 0) {
        for (const model of models) {
          const value = `${provider.id}:${model.id}`
          if (seen.has(value)) continue
          seen.add(value)
          options.push({
            value,
            label: `${providerDisplay} · ${model.label ?? model.id}`
          })
        }
      } else if (provider.defaultModel) {
        const value = `${provider.id}:${provider.defaultModel}`
        if (!seen.has(value)) {
          seen.add(value)
          options.push({
            value,
            label: `${providerDisplay} · ${provider.defaultModel}`
          })
        }
      }

      const passthroughValue = `${provider.id}:*`
      if (!seen.has(passthroughValue)) {
        seen.add(passthroughValue)
        options.push({
          value: passthroughValue,
          label: t('settings.routing.providerPassthroughOption', { provider: providerDisplay })
        })
      }
    }

    for (const entry of Object.values(routesByEndpoint).flat()) {
      const target = entry.target.trim()
      if (target && !seen.has(target)) {
        seen.add(target)
        options.push({ value: target, label: target })
      }
    }

    return options
  }, [providers, routesByEndpoint, t])

  const handleOpenCreateEndpoint = () => {
    setEditingEndpoint(undefined)
    setEndpointDrawerOpen(true)
  }

  const handleOpenEditEndpoint = (endpoint: CustomEndpoint) => {
    setEditingEndpoint(endpoint)
    setEndpointDrawerOpen(true)
  }

  const getSavedRoutes = (endpoint: string): Record<string, string> => {
    if (!config) return {}
    return getSavedRoutesFromConfig(config, customEndpoints, endpoint)
  }

  const isDirtyByEndpoint = useMemo(() => {
    const result: Record<string, boolean> = {}
    for (const tab of tabs) {
      if (tab.key === 'providers') continue
      const entries = routesByEndpoint[tab.key] || []
      result[tab.key] = areRouteEntriesDirty(entries, getSavedRoutes(tab.key))
    }
    return result
  }, [config, customEndpoints, routesByEndpoint, tabs])

  const syncPresets = (endpoint: string, presets: RoutingPreset[]) => {
    setPresetsByEndpoint((previous) => ({
      ...previous,
      [endpoint]: presets
    }))
    setConfig((previous) => {
      if (!previous) return previous

      if (endpoint === 'anthropic' || endpoint === 'openai') {
        return {
          ...previous,
          routingPresets: {
            ...previous.routingPresets,
            [endpoint]: presets
          }
        }
      }

      const nextEndpoints = [...(previous.customEndpoints ?? [])]
      const endpointIndex = nextEndpoints.findIndex((item) => item.id === endpoint)
      if (endpointIndex === -1) return previous

      nextEndpoints[endpointIndex] = {
        ...nextEndpoints[endpointIndex],
        routingPresets: presets
      }

      return {
        ...previous,
        customEndpoints: nextEndpoints
      }
    })
  }

  const ensureConfig = () => {
    if (config) return true

    pushToast({
      title: t('settings.toast.missingConfig'),
      variant: 'error'
    })
    void configQuery.refetch()
    return false
  }

  const handlePresetNameChange = (endpoint: string, value: string) => {
    setPresetNameByEndpoint((previous) => ({
      ...previous,
      [endpoint]: value
    }))
    if (!value.trim()) return

    setPresetErrorByEndpoint((previous) => ({
      ...previous,
      [endpoint]: null
    }))
  }

  const handleSavePreset = async (endpoint: string) => {
    if (!ensureConfig()) return

    const trimmed = (presetNameByEndpoint[endpoint] ?? '').trim()
    if (!trimmed) {
      setPresetErrorByEndpoint((previous) => ({
        ...previous,
        [endpoint]: t('modelManagement.validation.presetName')
      }))
      return
    }

    if ((presetsByEndpoint[endpoint] ?? []).some((preset) => preset.name.toLowerCase() === trimmed.toLowerCase())) {
      setPresetErrorByEndpoint((previous) => ({
        ...previous,
        [endpoint]: t('modelManagement.validation.presetDuplicate', { name: trimmed })
      }))
      return
    }

    setSavingPresetFor(endpoint)
    try {
      const response = await modelManagementApi.savePreset(endpoint, trimmed)
      const presets = response.presets ?? []
      syncPresets(endpoint, presets)
      setPresetNameByEndpoint((previous) => ({
        ...previous,
        [endpoint]: ''
      }))
      setPresetErrorByEndpoint((previous) => ({
        ...previous,
        [endpoint]: null
      }))
      pushToast({
        title: t('modelManagement.toast.presetSaved', { name: trimmed }),
        variant: 'success'
      })
    } catch (error) {
      pushToast({
        title: t('modelManagement.toast.presetSaveFailure', {
          message: error instanceof Error ? error.message : 'unknown'
        }),
        variant: 'error'
      })
    } finally {
      setSavingPresetFor(null)
      void configQuery.refetch()
    }
  }

  const handleApplyPreset = async (endpoint: string, preset: RoutingPreset) => {
    if (!ensureConfig()) return

    setApplyingPreset({ endpoint, name: preset.name })
    try {
      const response = await modelManagementApi.applyPreset(endpoint, preset.name)
      const updatedConfig = response.config
      if (updatedConfig) {
        setConfig(updatedConfig)
        setRoutesByEndpoint(deriveRoutesFromConfig(updatedConfig, customEndpoints))
        setPresetsByEndpoint(buildPresetsMap(updatedConfig, customEndpoints))
      } else {
        const presetRoutes = preset.modelRoutes ?? {}
        setRoutesByEndpoint((previous) => ({
          ...previous,
          [endpoint]: Object.entries(presetRoutes).map(([source, target]) => ({
            id: createEntryId(),
            source,
            target
          }))
        }))
        setConfig((previous) => {
          if (!previous) return previous

          const customEndpointIndex = (previous.customEndpoints ?? []).findIndex((item) => item.id === endpoint)
          if (customEndpointIndex !== -1) {
            const nextEndpoints = [...(previous.customEndpoints ?? [])]
            const currentEndpoint = nextEndpoints[customEndpointIndex]
            nextEndpoints[customEndpointIndex] = {
              ...currentEndpoint,
              routing: {
                defaults: currentEndpoint.routing?.defaults ?? previous.defaults,
                ...(currentEndpoint.routing ?? {}),
                modelRoutes: presetRoutes
              }
            }
            return {
              ...previous,
              customEndpoints: nextEndpoints
            }
          }

          if (endpoint === 'anthropic' || endpoint === 'openai') {
            return {
              ...previous,
              endpointRouting: {
                ...(previous.endpointRouting ?? {}),
                [endpoint]: {
                  defaults: previous.endpointRouting?.[endpoint]?.defaults ?? previous.defaults,
                  ...(previous.endpointRouting?.[endpoint] ?? {}),
                  modelRoutes: presetRoutes
                }
              },
              modelRoutes: endpoint === 'anthropic' ? presetRoutes : previous.modelRoutes ?? {}
            }
          }

          return previous
        })
      }
      if (endpoint !== 'anthropic' && endpoint !== 'openai') {
        await queryClient.invalidateQueries({ queryKey: queryKeys.customEndpoints.all() })
      }
      pushToast({
        title: t('modelManagement.toast.presetApplySuccess', { name: preset.name }),
        variant: 'success'
      })
    } catch (error) {
      pushToast({
        title: t('modelManagement.toast.presetApplyFailure', {
          message: error instanceof Error ? error.message : 'unknown'
        }),
        variant: 'error'
      })
    } finally {
      setApplyingPreset(null)
      void configQuery.refetch()
    }
  }

  const handleDeletePreset = async (endpoint: string, preset: RoutingPreset) => {
    if (!ensureConfig()) return

    setDeletingPreset({ endpoint, name: preset.name })
    try {
      const response = await modelManagementApi.deletePreset(endpoint, preset.name)
      syncPresets(endpoint, response.presets ?? [])
      pushToast({
        title: t('modelManagement.toast.presetDeleteSuccess', { name: preset.name }),
        variant: 'success'
      })
    } catch (error) {
      pushToast({
        title: t('modelManagement.toast.presetDeleteFailure', {
          message: error instanceof Error ? error.message : 'unknown'
        }),
        variant: 'error'
      })
    } finally {
      setDeletingPreset(null)
      void configQuery.refetch()
    }
  }

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
    setRoutesByEndpoint(deriveRoutesFromConfig(nextConfig, customEndpoints))
    void configQuery.refetch()

    pushToast({
      title:
        drawerMode === 'create'
          ? t('providers.toast.createSuccess', { name: payload.label || payload.id })
          : t('providers.toast.updateSuccess', { name: payload.label || payload.id }),
      variant: 'success'
    })
  }

  const handleDeleteEndpoint = async (endpointId: string) => {
    const endpoint = customEndpoints.find((item) => item.id === endpointId)
    if (!endpoint || endpoint.deletable === false) return

    try {
      await customEndpointsApi.delete(endpointId)
      await queryClient.invalidateQueries({ queryKey: queryKeys.customEndpoints.all() })
      pushToast({
        title: t('modelManagement.deleteEndpointSuccess'),
        variant: 'success'
      })
      if (activeTab === endpointId) {
        setActiveTab('providers')
      }
    } catch (error) {
      const apiError = toApiError(error)
      pushToast({
        title: t('modelManagement.deleteEndpointError', { error: apiError.message }),
        variant: 'error'
      })
    }
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

      pushToast({
        title: t('providers.toast.testFailure', {
          message: `${response.status} ${response.statusText}`
        }),
        variant: 'error'
      })
    } catch (error) {
      pushToast({
        title: t('providers.toast.testFailure', {
          message: error instanceof Error ? error.message : 'unknown'
        }),
        variant: 'error'
      })
    } finally {
      setTestingProviderId(null)
    }
  }

  const initiateTestConnection = (provider: ProviderConfig) => {
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
      headers: Object.keys(selectedHeaders).length > 0 ? selectedHeaders : undefined,
      query: testDialogUsePreset ? 'beta=true' : undefined
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
          validation: currentRouting.anthropic?.validation
        },
        openai: {
          defaults: currentRouting.openai?.defaults ?? config!.defaults,
          modelRoutes: sanitizedOpenAI,
          validation: currentRouting.openai?.validation
        }
      }
    }

    try {
      await gatewayApi.saveConfig(nextConfig)
      setConfig(nextConfig)
      setRoutesByEndpoint({
        anthropic: Object.entries(sanitizedAnthropic).map(([source, target]) => ({
          id: createEntryId(),
          source,
          target
        })),
        openai: Object.entries(sanitizedOpenAI).map(([source, target]) => ({
          id: createEntryId(),
          source,
          target
        })),
        ...Object.fromEntries(
          sanitizedCustomEndpoints.map((endpoint) => [
            endpoint.id,
            Object.entries(endpoint.routing?.modelRoutes ?? {}).map(([source, target]) => ({
              id: createEntryId(),
              source,
              target
            }))
          ])
        )
      })
      pushToast({
        title: t('providers.toast.deleteSuccess', { name: provider.label || provider.id }),
        variant: 'success'
      })
      void configQuery.refetch()
    } catch (error) {
      pushToast({
        title: t('providers.toast.deleteFailure', {
          message: error instanceof Error ? error.message : 'unknown'
        }),
        variant: 'error'
      })
    }
  }

  const handleConfirmDialog = async () => {
    if (!confirmAction) return

    setConfirmingAction(true)
    try {
      if (confirmAction.kind === 'provider') {
        await handleDeleteProvider(confirmAction.provider)
      } else if (confirmAction.kind === 'preset') {
        await handleDeletePreset(confirmAction.endpoint, confirmAction.preset)
      } else {
        await handleDeleteEndpoint(confirmAction.endpoint.id)
      }
      setConfirmAction(null)
    } finally {
      setConfirmingAction(false)
    }
  }

  const handleAddRoute = (endpoint: string) => {
    setRoutesByEndpoint((previous) => ({
      ...previous,
      [endpoint]: [...(previous[endpoint] || []), { id: createEntryId(), source: '', target: '' }]
    }))
    setRouteError((previous) => ({ ...previous, [endpoint]: null }))
  }

  const handleToggleClaudeValidation = async (endpoint: string, enabled: boolean) => {
    if (!ensureConfig()) return

    setSavingClaudeValidation(true)
    try {
      if (endpoint === 'anthropic' || endpoint === 'openai') {
        const systemEndpoint = endpoint as 'anthropic' | 'openai'
        const currentRouting = config!.endpointRouting ? { ...config!.endpointRouting } : {}
        const currentEndpointRouting = currentRouting[systemEndpoint] ?? {
          defaults: config!.defaults,
          modelRoutes: (systemEndpoint === 'anthropic' ? config!.modelRoutes : {}) ?? {}
        }

        const baseRouting: EndpointRoutingConfig = {
          defaults: currentEndpointRouting.defaults ?? config!.defaults,
          modelRoutes: currentEndpointRouting.modelRoutes ?? {}
        }

        const validation: EndpointRoutingConfig['validation'] = enabled
          ? {
              ...(currentEndpointRouting.validation ?? {}),
              mode: 'claude-code' as const,
              allowExperimentalBlocks:
                currentEndpointRouting.validation?.allowExperimentalBlocks ?? true
            }
          : undefined

        const nextConfig: GatewayConfig = {
          ...config!,
          endpointRouting: {
            ...currentRouting,
            [systemEndpoint]: validation
              ? { ...baseRouting, validation }
              : { ...baseRouting }
          }
        }

        await gatewayApi.saveConfig(nextConfig)
        setConfig(nextConfig)
      } else {
        const nextEndpoints = [...(config!.customEndpoints ?? [])]
        const endpointIndex = nextEndpoints.findIndex((item) => item.id === endpoint)
        if (endpointIndex === -1) {
          throw new Error(t('modelManagement.toast.endpointNotFound'))
        }

        const customEndpoint = nextEndpoints[endpointIndex]
        const currentRouting = customEndpoint.routing ?? {
          defaults: config!.defaults,
          modelRoutes: {}
        }
        const validation: EndpointRoutingConfig['validation'] = enabled
          ? {
              ...(currentRouting.validation ?? {}),
              mode: 'claude-code' as const,
              allowExperimentalBlocks: currentRouting.validation?.allowExperimentalBlocks ?? true
            }
          : undefined

        nextEndpoints[endpointIndex] = {
          ...customEndpoint,
          routing: validation
            ? { ...currentRouting, validation }
            : {
                defaults: currentRouting.defaults,
                modelRoutes: currentRouting.modelRoutes
              }
        }

        const nextConfig: GatewayConfig = {
          ...config!,
          customEndpoints: nextEndpoints
        }

        await gatewayApi.saveConfig(nextConfig)
        setConfig(nextConfig)
      }

      pushToast({
        title: enabled
          ? t('modelManagement.toast.claudeValidationEnabled')
          : t('modelManagement.toast.claudeValidationDisabled'),
        variant: 'success'
      })
      void configQuery.refetch()
    } catch (error) {
      const apiError = toApiError(error)
      pushToast({
        title: t('modelManagement.toast.claudeValidationFailure', { message: apiError.message }),
        variant: 'error'
      })
    } finally {
      setSavingClaudeValidation(false)
    }
  }

  const handleAddSuggestion = (endpoint: string, model: string) => {
    setRoutesByEndpoint((previous) => {
      const currentRoutes = previous[endpoint] || []
      if (currentRoutes.some((entry) => entry.source.trim() === model.trim())) {
        return previous
      }
      return {
        ...previous,
        [endpoint]: [...currentRoutes, { id: createEntryId(), source: model, target: '' }]
      }
    })
    setRouteError((previous) => ({ ...previous, [endpoint]: null }))
  }

  const handleRouteChange = (
    endpoint: string,
    id: string,
    field: 'source' | 'target',
    value: string
  ) => {
    setRoutesByEndpoint((previous) => ({
      ...previous,
      [endpoint]: (previous[endpoint] || []).map((entry) =>
        entry.id === id ? { ...entry, [field]: value } : entry
      )
    }))
    setRouteError((previous) => ({ ...previous, [endpoint]: null }))
  }

  const handleRemoveRoute = (endpoint: string, id: string) => {
    setRoutesByEndpoint((previous) => ({
      ...previous,
      [endpoint]: (previous[endpoint] || []).filter((entry) => entry.id !== id)
    }))
    setRouteError((previous) => ({ ...previous, [endpoint]: null }))
  }

  const handleResetRoutes = (endpoint: string) => {
    if (!config) return

    const customEndpoint = (config.customEndpoints ?? customEndpoints).find((item) => item.id === endpoint)
    if (customEndpoint) {
      setRoutesByEndpoint((previous) => ({
        ...previous,
        [endpoint]: Object.entries(customEndpoint.routing?.modelRoutes ?? {}).map(([source, target]) => ({
          id: createEntryId(),
          source,
          target
        }))
      }))
    } else {
      const routing = config.endpointRouting ?? {}
      const systemEndpoint = endpoint as 'anthropic' | 'openai'
      const fallback = systemEndpoint === 'anthropic' ? config.modelRoutes ?? {} : {}
      const routes = routing[systemEndpoint]?.modelRoutes ?? fallback
      setRoutesByEndpoint((previous) => ({
        ...previous,
        [endpoint]: Object.entries(routes).map(([source, target]) => ({
          id: createEntryId(),
          source,
          target
        }))
      }))
    }

    setRouteError((previous) => ({ ...previous, [endpoint]: null }))
  }

  const saveSystemRoutesMutation = useAppMutation<
    { endpoint: 'anthropic' | 'openai'; nextConfig: GatewayConfig },
    { endpoint: 'anthropic' | 'openai'; nextConfig: GatewayConfig }
  >({
    mutationFn: async (payload) => {
      await gatewayApi.saveConfig(payload.nextConfig)
      return payload
    }
  })

  const saveCustomRoutesMutation = useAppMutation<
    { endpoint: string; routing: EndpointRoutingConfig },
    { endpoint: string; routing: EndpointRoutingConfig }
  >({
    mutationFn: async (payload) => {
      await customEndpointsApi.update(payload.endpoint, { routing: payload.routing })
      return payload
    }
  })

  const handleSaveRoutes = async (endpoint: string) => {
    if (!ensureConfig()) return

    const currentEntries = routesByEndpoint[endpoint] || []
    const sanitizedRoutes: Record<string, string> = {}
    for (const entry of currentEntries) {
      const source = entry.source.trim()
      const target = entry.target.trim()
      if (!source && !target) {
        continue
      }
      if (!source || !target) {
        setRouteError((previous) => ({
          ...previous,
          [endpoint]: t('settings.validation.routePair')
        }))
        return
      }
      if (sanitizedRoutes[source]) {
        setRouteError((previous) => ({
          ...previous,
          [endpoint]: t('settings.validation.routeDuplicate', { model: source })
        }))
        return
      }
      sanitizedRoutes[source] = target
    }

    setRouteError((previous) => ({ ...previous, [endpoint]: null }))
    setSavingRouteFor(endpoint)

    try {
      const customEndpoint = customEndpoints.find((item) => item.id === endpoint)
      if (customEndpoint) {
        const routing: EndpointRoutingConfig = {
          ...(customEndpoint.routing ?? {}),
          modelRoutes: sanitizedRoutes,
          defaults: customEndpoint.routing?.defaults || config!.defaults
        }
        await saveCustomRoutesMutation.mutateAsync({ endpoint, routing })
        setConfig((previous) => {
          if (!previous) return previous
          const nextEndpoints = [...(previous.customEndpoints ?? [])]
          const endpointIndex = nextEndpoints.findIndex((item) => item.id === endpoint)
          if (endpointIndex === -1) return previous
          nextEndpoints[endpointIndex] = {
            ...nextEndpoints[endpointIndex],
            routing
          }
          return {
            ...previous,
            customEndpoints: nextEndpoints
          }
        })
        await queryClient.invalidateQueries({ queryKey: queryKeys.customEndpoints.all() })
      } else {
        const nextConfig: GatewayConfig = {
          ...config!,
          endpointRouting: {
            ...(config!.endpointRouting ?? {}),
            [endpoint]: {
              defaults: config!.endpointRouting?.[endpoint as 'anthropic' | 'openai']?.defaults ?? config!.defaults,
              modelRoutes: sanitizedRoutes,
              validation: config!.endpointRouting?.[endpoint as 'anthropic' | 'openai']?.validation
            }
          },
          modelRoutes: endpoint === 'anthropic' ? sanitizedRoutes : config!.modelRoutes ?? {}
        }
        await saveSystemRoutesMutation.mutateAsync({
          endpoint: endpoint as 'anthropic' | 'openai',
          nextConfig
        })
        setConfig(nextConfig)
      }

      setRoutesByEndpoint((previous) => ({
        ...previous,
        [endpoint]: Object.entries(sanitizedRoutes).map(([source, target]) => ({
          id: createEntryId(),
          source,
          target
        }))
      }))
      pushToast({
        title: t('modelManagement.toast.routesSaved'),
        variant: 'success'
      })
      void configQuery.refetch()
    } catch (error) {
      pushToast({
        title: t('modelManagement.toast.routesSaveFailure', {
          message: error instanceof Error ? error.message : 'unknown'
        }),
        variant: 'error'
      })
    } finally {
      setSavingRouteFor(null)
    }
  }

  const confirmDialogTitle =
    confirmAction?.kind === 'provider'
      ? t('providers.actions.delete')
      : confirmAction?.kind === 'preset'
        ? t('modelManagement.presets.delete')
        : confirmAction?.kind === 'endpoint'
          ? t('common.delete')
          : ''

  const confirmDialogDescription =
    confirmAction?.kind === 'provider'
      ? t('providers.confirm.delete', { name: confirmAction.provider.label || confirmAction.provider.id })
      : confirmAction?.kind === 'preset'
        ? t('modelManagement.confirm.deletePreset', { name: confirmAction.preset.name })
        : confirmAction?.kind === 'endpoint'
          ? t('modelManagement.deleteEndpointConfirm', { label: confirmAction.endpoint.label })
          : ''

  const confirmDialogName =
    confirmAction?.kind === 'provider'
      ? confirmAction.provider.label || confirmAction.provider.id
      : confirmAction?.kind === 'preset'
        ? confirmAction.preset.name
        : confirmAction?.kind === 'endpoint'
          ? confirmAction.endpoint.label
          : ''

  return {
    activeTab,
    activeTabInfo,
    anthropicTestHeaderOptions,
    applyingPreset,
    config,
    configQuery,
    confirmAction,
    confirmDialogDescription,
    confirmDialogName,
    confirmDialogTitle,
    confirmingAction,
    customEndpoints,
    customTabs,
    defaultLabels,
    deletingPreset,
    drawerMode,
    drawerOpen,
    editingEndpoint,
    editingProvider,
    endpointDrawerOpen,
    filteredProviders,
    handleAddRoute,
    handleAddSuggestion,
    handleApplyPreset,
    handleConfirmDialog,
    handleDeleteProvider,
    handleOpenCreate,
    handleOpenCreateEndpoint,
    handleOpenEditEndpoint,
    handleOpenEdit,
    handlePresetNameChange,
    handleProviderSubmit,
    handleRemoveRoute,
    handleResetRoutes,
    handleRouteChange,
    handleSavePreset,
    handleSaveRoutes,
    handleToggleClaudeValidation,
    initiateTestConnection,
    isDirtyByEndpoint,
    presetDiffDialog,
    presetErrorByEndpoint,
    presetNameByEndpoint,
    presetsByEndpoint,
    presetsExpanded,
    providerCount,
    providerModelOptions,
    providerSearch,
    providerTypeFilter,
    providers,
    pushToast,
    routeError,
    routesByEndpoint,
    savingClaudeValidation,
    savingPresetFor,
    savingRouteFor,
    setActiveTab,
    setConfirmAction,
    setDrawerMode,
    setDrawerOpen,
    setEditingEndpoint,
    setEditingProvider,
    setEndpointDrawerOpen,
    setPresetDiffDialog,
    setPresetsExpanded,
    setProviderSearch,
    setProviderTypeFilter,
    setTestDialogUsePreset,
    systemTabs,
    tabs,
    testDialogOpen,
    testDialogPreservedExtras,
    testDialogProvider,
    testDialogUsePreset,
    testingProviderId,
    closeTestDialog,
    confirmTestDialog
  }
}
