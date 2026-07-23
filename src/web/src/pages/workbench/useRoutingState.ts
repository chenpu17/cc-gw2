import { useEffect, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { toApiError, customEndpointsApi } from '@/services/api'
import { gatewayApi } from '@/services/gateway'
import { modelManagementApi } from '@/services/modelManagement'
import { queryKeys } from '@/services/queryKeys'
import { useAppMutation } from '@/hooks/useAppMutation'
import type {
  DefaultsConfig,
  EndpointRoutingConfig,
  GatewayConfig,
  RoutingPreset
} from '@/types/providers'
import type { WorkbenchConfigState } from './useWorkbenchConfig'
import {
  areRouteEntriesDirty,
  buildPresetsMap,
  createEntryId,
  deriveDefaultsFromConfig,
  deriveRoutesFromConfig,
  getSavedDefaultsFromConfig,
  getSavedRoutesFromConfig,
  type ModelRouteEntry
} from './shared'

/**
 * Routing state for the providers workbench: per-endpoint route entries,
 * presets, the OpenAI compatibility policy and the active endpoint.
 * All writes keep the read-modify-PUT flow against GET/PUT /api/config.
 */
export function useRoutingState(base: WorkbenchConfigState) {
  const { t, pushToast, config, setConfig, configQuery, customEndpoints, tabs, ensureConfig } = base
  const queryClient = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()
  const endpointParam = searchParams.get('endpoint')

  const [activeEndpointKey, setActiveEndpointKey] = useState<string>(() => endpointParam || 'anthropic')

  // Deep links (e.g. from the provider detail panel) drive the active endpoint
  // through the `endpoint` search param.
  useEffect(() => {
    if (endpointParam && endpointParam !== activeEndpointKey) {
      setActiveEndpointKey(endpointParam)
    }
  }, [endpointParam, activeEndpointKey])

  const setActiveEndpoint = (key: string) => {
    setActiveEndpointKey(key)
    setSearchParams((previous) => {
      const next = new URLSearchParams(previous)
      if (key === 'anthropic') {
        next.delete('endpoint')
      } else {
        next.set('endpoint', key)
      }
      return next
    }, { replace: true })
  }
  const activeEndpoint = activeEndpointKey
  const [routesByEndpoint, setRoutesByEndpoint] = useState<Record<string, ModelRouteEntry[]>>({})
  const [routeError, setRouteError] = useState<Record<string, string | null>>({})
  const [savingRouteFor, setSavingRouteFor] = useState<string | null>(null)
  const [presetsByEndpoint, setPresetsByEndpoint] = useState<Record<string, RoutingPreset[]>>({})
  const [presetNameByEndpoint, setPresetNameByEndpoint] = useState<Record<string, string>>({})
  const [presetErrorByEndpoint, setPresetErrorByEndpoint] = useState<Record<string, string | null>>({})
  const [savingPresetFor, setSavingPresetFor] = useState<string | null>(null)
  const [applyingPreset, setApplyingPreset] = useState<{ endpoint: string; name: string } | null>(null)
  const [deletingPreset, setDeletingPreset] = useState<{ endpoint: string; name: string } | null>(null)
  const [savingCompatibilityPolicy, setSavingCompatibilityPolicy] = useState(false)
  const [presetsExpanded, setPresetsExpanded] = useState<Record<string, boolean>>({})
  const [presetDiffDialog, setPresetDiffDialog] = useState<{ endpoint: string; preset: RoutingPreset } | null>(null)
  const [defaultsByEndpoint, setDefaultsByEndpoint] = useState<Record<string, DefaultsConfig>>({})
  const [savingDefaultsFor, setSavingDefaultsFor] = useState<string | null>(null)

  const endpointTabs = useMemo(() => tabs.filter((tab) => tab.key !== 'providers'), [tabs])

  useEffect(() => {
    if (!configQuery.data) return

    const incoming = configQuery.data
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
    setDefaultsByEndpoint((previous) => {
      const nextFromServer = deriveDefaultsFromConfig(incoming, customEndpoints)
      if (!previous || Object.keys(previous).length === 0) {
        return nextFromServer
      }

      const merged: Record<string, DefaultsConfig> = { ...nextFromServer }
      for (const [endpoint, previousDefaults] of Object.entries(previous)) {
        if (!(endpoint in nextFromServer)) continue
        const savedDefaults = getSavedDefaultsFromConfig(incoming, customEndpoints, endpoint)
        if (JSON.stringify(previousDefaults) !== JSON.stringify(savedDefaults)) {
          merged[endpoint] = previousDefaults
        }
      }
      return merged
    })
    setRouteError({})
    setPresetsByEndpoint(buildPresetsMap(incoming, customEndpoints))
  }, [configQuery.data, customEndpoints])

  useEffect(() => {
    if (endpointTabs.some((tab) => tab.key === activeEndpoint)) return
    setActiveEndpoint('anthropic')
  }, [activeEndpoint, endpointTabs])

  const providers = config?.providers ?? []

  const providerModelOptions = useMemo(() => {
    const options: Array<{
      value: string
      label: string
      providerId?: string
      providerLabel?: string
      modelId?: string
      modelLabel?: string
      kind?: 'model' | 'passthrough' | 'custom'
      isDefault?: boolean
    }> = []
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
            label: `${providerDisplay} · ${model.label ?? model.id}`,
            providerId: provider.id,
            providerLabel: providerDisplay,
            modelId: model.id,
            modelLabel: model.label ?? model.id,
            kind: 'model',
            isDefault: provider.defaultModel === model.id
          })
        }
      } else if (provider.defaultModel) {
        const value = `${provider.id}:${provider.defaultModel}`
        if (!seen.has(value)) {
          seen.add(value)
          options.push({
            value,
            label: `${providerDisplay} · ${provider.defaultModel}`,
            providerId: provider.id,
            providerLabel: providerDisplay,
            modelId: provider.defaultModel,
            modelLabel: provider.defaultModel,
            kind: 'model',
            isDefault: true
          })
        }
      }

      const passthroughValue = `${provider.id}:*`
      if (!seen.has(passthroughValue)) {
        seen.add(passthroughValue)
        options.push({
          value: passthroughValue,
          label: t('settings.routing.providerPassthroughOption', { provider: providerDisplay }),
          providerId: provider.id,
          providerLabel: providerDisplay,
          modelId: '*',
          modelLabel: '*',
          kind: 'passthrough'
        })
      }
    }

    for (const entry of Object.values(routesByEndpoint).flat()) {
      const target = entry.target.trim()
      if (target && !seen.has(target)) {
        seen.add(target)
        options.push({
          value: target,
          label: target,
          modelId: target,
          modelLabel: target,
          kind: 'custom'
        })
      }
    }

    return options
  }, [providers, routesByEndpoint, t])

  const getSavedRoutes = (endpoint: string): Record<string, string> => {
    if (!config) return {}
    return getSavedRoutesFromConfig(config, customEndpoints, endpoint)
  }

  const isDirtyByEndpoint = useMemo(() => {
    const result: Record<string, boolean> = {}
    for (const tab of endpointTabs) {
      const entries = routesByEndpoint[tab.key] || []
      result[tab.key] = areRouteEntriesDirty(entries, getSavedRoutes(tab.key))
    }
    return result
  }, [config, customEndpoints, routesByEndpoint, endpointTabs])

  const isDefaultsDirtyByEndpoint = useMemo(() => {
    const result: Record<string, boolean> = {}
    if (!config) return result
    for (const tab of endpointTabs) {
      const draft = defaultsByEndpoint[tab.key]
      if (!draft) {
        result[tab.key] = false
        continue
      }
      const saved = getSavedDefaultsFromConfig(config, customEndpoints, tab.key)
      result[tab.key] = JSON.stringify(draft) !== JSON.stringify(saved)
    }
    return result
  }, [config, customEndpoints, defaultsByEndpoint, endpointTabs])

  const handleDefaultsChange = (endpoint: string, field: keyof DefaultsConfig, value: string | number | null) => {
    setDefaultsByEndpoint((previous) => ({
      ...previous,
      [endpoint]: {
        ...(previous[endpoint] ?? { completion: null, reasoning: null, background: null, longContextThreshold: 60000 }),
        [field]: value
      }
    }))
  }

  const handleSaveDefaults = async (endpoint: string) => {
    if (!ensureConfig()) return

    const draft = defaultsByEndpoint[endpoint]
    if (!draft) return

    const sanitized: DefaultsConfig = {
      completion: draft.completion?.trim() ? draft.completion.trim() : null,
      reasoning: draft.reasoning?.trim() ? draft.reasoning.trim() : null,
      background: draft.background?.trim() ? draft.background.trim() : null,
      longContextThreshold:
        Number.isFinite(draft.longContextThreshold) && draft.longContextThreshold > 0
          ? Math.floor(draft.longContextThreshold)
          : config!.defaults.longContextThreshold
    }

    setSavingDefaultsFor(endpoint)
    try {
      const customEndpoint = customEndpoints.find((item) => item.id === endpoint)
      if (customEndpoint) {
        const routing: EndpointRoutingConfig = {
          ...(customEndpoint.routing ?? {}),
          defaults: sanitized,
          modelRoutes: customEndpoint.routing?.modelRoutes ?? {}
        }
        await customEndpointsApi.update(endpoint, { routing })
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
        const systemEndpoint = endpoint as 'anthropic' | 'openai'
        const nextConfig: GatewayConfig = {
          ...config!,
          endpointRouting: {
            ...(config!.endpointRouting ?? {}),
            [systemEndpoint]: {
              defaults: sanitized,
              modelRoutes:
                config!.endpointRouting?.[systemEndpoint]?.modelRoutes ??
                (systemEndpoint === 'anthropic' ? config!.modelRoutes ?? {} : {}),
              compatibility: config!.endpointRouting?.[systemEndpoint]?.compatibility
            }
          }
        }
        await gatewayApi.saveConfig(nextConfig)
        setConfig(nextConfig)
      }

      setDefaultsByEndpoint((previous) => ({
        ...previous,
        [endpoint]: sanitized
      }))
      pushToast({
        title: t('workbench.defaults.saveSuccess'),
        variant: 'success'
      })
      void configQuery.refetch()
    } catch (error) {
      pushToast({
        title: t('workbench.defaults.saveFailure', {
          message: error instanceof Error ? error.message : 'unknown'
        }),
        variant: 'error'
      })
    } finally {
      setSavingDefaultsFor(null)
    }
  }

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
      if (activeEndpoint === endpointId) {
        setActiveEndpoint('anthropic')
      }
    } catch (error) {
      const apiError = toApiError(error)
      pushToast({
        title: t('modelManagement.deleteEndpointError', { error: apiError.message }),
        variant: 'error'
      })
    }
  }

  const handleAddRoute = (endpoint: string) => {
    setRoutesByEndpoint((previous) => ({
      ...previous,
      [endpoint]: [...(previous[endpoint] || []), { id: createEntryId(), source: '', target: '' }]
    }))
    setRouteError((previous) => ({ ...previous, [endpoint]: null }))
  }

  const handleCompatibilityEnabledChange = async (endpoint: string, enabled: boolean) => {
    if (!ensureConfig()) return

    setSavingCompatibilityPolicy(true)
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

        const nextConfig: GatewayConfig = {
          ...config!,
          endpointRouting: {
            ...currentRouting,
            [systemEndpoint]: enabled
              ? { ...baseRouting, compatibility: { enabled: true } }
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

        nextEndpoints[endpointIndex] = {
          ...customEndpoint,
          routing: enabled
            ? { ...currentRouting, compatibility: { enabled: true } }
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
        title: t('modelManagement.toast.compatibilitySaved', {
          state: enabled
            ? t('common.enabled')
            : t('common.disabled')
        }),
        variant: 'success'
      })
      void configQuery.refetch()
    } catch (error) {
      const apiError = toApiError(error)
      pushToast({
        title: t('modelManagement.toast.compatibilitySaveFailure', { message: apiError.message }),
        variant: 'error'
      })
    } finally {
      setSavingCompatibilityPolicy(false)
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
              compatibility: config!.endpointRouting?.[endpoint as 'anthropic' | 'openai']?.compatibility
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

  return {
    activeEndpoint,
    setActiveEndpoint,
    endpointTabs,
    routesByEndpoint,
    setRoutesByEndpoint,
    routeError,
    savingRouteFor,
    presetsByEndpoint,
    presetNameByEndpoint,
    presetErrorByEndpoint,
    savingPresetFor,
    applyingPreset,
    deletingPreset,
    savingCompatibilityPolicy,
    presetsExpanded,
    setPresetsExpanded,
    presetDiffDialog,
    setPresetDiffDialog,
    providerModelOptions,
    isDirtyByEndpoint,
    defaultsByEndpoint,
    isDefaultsDirtyByEndpoint,
    savingDefaultsFor,
    handleDefaultsChange,
    handleSaveDefaults,
    handlePresetNameChange,
    handleSavePreset,
    handleApplyPreset,
    handleDeletePreset,
    handleDeleteEndpoint,
    handleAddRoute,
    handleAddSuggestion,
    handleRouteChange,
    handleRemoveRoute,
    handleResetRoutes,
    handleSaveRoutes,
    handleCompatibilityEnabledChange
  }
}

export type RoutingState = ReturnType<typeof useRoutingState>
