import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { toApiError } from '@/services/api'
import { apiKeysApi } from '@/services/apiKeys'
import { gatewayApi } from '@/services/gateway'
import { modelManagementApi } from '@/services/modelManagement'
import { useToast } from '@/providers/ToastProvider'
import { copyToClipboard } from '@/utils/clipboard'
import type { NewApiKeyResponse } from '@/types/apiKeys'
import type { GatewayConfig, ProviderConfig } from '@/types/providers'
import { useWorkbenchConfig } from '../workbench/useWorkbenchConfig'
import {
  getSavedRoutesFromConfig,
  type ProviderTestResult
} from '../workbench/shared'

export const SETUP_STEPS = ['provider', 'routing', 'apiKey', 'verify'] as const
export type SetupStepId = (typeof SETUP_STEPS)[number]

/**
 * Cold-start setup wizard state. Builds on the workbench config draft
 * (read-modify-PUT against GET/PUT /api/config) so provider and route
 * writes follow the exact same persistence flow as the workbench.
 */
export function useSetupState() {
  const base = useWorkbenchConfig()
  const { t, pushToast, config, setConfig, configQuery, customEndpoints, ensureConfig } = base
  const navigate = useNavigate()

  const [stepIndex, setStepIndex] = useState(0)
  const [setupProviderId, setSetupProviderId] = useState<string | null>(null)
  const [savingProvider, setSavingProvider] = useState(false)

  const [routeSource, setRouteSource] = useState('')
  const [routeTargetOverride, setRouteTargetOverride] = useState<string | null>(null)
  const [savingRoute, setSavingRoute] = useState(false)

  const [keyName, setKeyName] = useState('')
  const [keyEndpoints, setKeyEndpoints] = useState<string[]>(['anthropic'])
  const [keyMaxConcurrency, setKeyMaxConcurrency] = useState('')
  const [creatingKey, setCreatingKey] = useState(false)
  const [createdKey, setCreatedKey] = useState<NewApiKeyResponse | null>(null)

  const [testingProvider, setTestingProvider] = useState(false)
  const [testResult, setTestResult] = useState<ProviderTestResult | null>(null)

  const providers = useMemo(() => config?.providers ?? [], [config])
  const setupProvider = useMemo(
    () => providers.find((provider) => provider.id === setupProviderId) ?? providers[0] ?? null,
    [providers, setupProviderId]
  )

  const anthropicRoutes = useMemo(
    () => (config ? getSavedRoutesFromConfig(config, customEndpoints, 'anthropic') : {}),
    [config, customEndpoints]
  )
  const anthropicRouteCount = Object.keys(anthropicRoutes).length

  const suggestedRouteTarget = useMemo(() => {
    if (!setupProvider) return ''
    const model = setupProvider.defaultModel ?? setupProvider.models?.find((item) => item.id.trim().length > 0)?.id
    return model ? `${setupProvider.id}:${model}` : `${setupProvider.id}:*`
  }, [setupProvider])

  const routeTarget = routeTargetOverride ?? suggestedRouteTarget

  const saveProvider = async (payload: ProviderConfig): Promise<boolean> => {
    if (!config || !ensureConfig()) return false

    const nextConfig: GatewayConfig = {
      ...config,
      providers: [...providers, payload]
    }

    setSavingProvider(true)
    try {
      await gatewayApi.saveConfig(nextConfig)
      setConfig(nextConfig)
      void configQuery.refetch()
      setSetupProviderId(payload.id)
      pushToast({
        title: t('providers.toast.createSuccess', { name: payload.label || payload.id }),
        variant: 'success'
      })
      return true
    } catch (error) {
      pushToast({
        title: t('providers.drawer.toast.saveFailure', {
          message: error instanceof Error ? error.message : 'unknown'
        }),
        variant: 'error'
      })
      return false
    } finally {
      setSavingProvider(false)
    }
  }

  const saveDefaultRoute = async () => {
    if (!config || !ensureConfig()) return

    const source = routeSource.trim()
    const target = routeTarget.trim()
    if (!source || !target) return

    const nextRoutes = { ...anthropicRoutes, [source]: target }
    const nextConfig: GatewayConfig = {
      ...config,
      endpointRouting: {
        ...(config.endpointRouting ?? {}),
        anthropic: {
          defaults: config.endpointRouting?.anthropic?.defaults ?? config.defaults,
          modelRoutes: nextRoutes,
          compatibility: config.endpointRouting?.anthropic?.compatibility
        }
      },
      modelRoutes: nextRoutes
    }

    setSavingRoute(true)
    try {
      await gatewayApi.saveConfig(nextConfig)
      setConfig(nextConfig)
      void configQuery.refetch()
      pushToast({ title: t('modelManagement.toast.routesSaved'), variant: 'success' })
    } catch (error) {
      pushToast({
        title: t('modelManagement.toast.routesSaveFailure', {
          message: error instanceof Error ? error.message : 'unknown'
        }),
        variant: 'error'
      })
    } finally {
      setSavingRoute(false)
    }
  }

  const createApiKey = async () => {
    if (!keyName.trim()) {
      pushToast({ title: t('apiKeys.errors.nameRequired'), variant: 'error' })
      return
    }

    setCreatingKey(true)
    try {
      const response = await apiKeysApi.create({
        name: keyName.trim(),
        allowedEndpoints: keyEndpoints.length > 0 ? keyEndpoints : undefined,
        maxConcurrency: keyMaxConcurrency ? Number(keyMaxConcurrency) : null
      })
      setCreatedKey(response)
    } catch (error) {
      const apiError = toApiError(error)
      pushToast({
        title: t('setup.steps.apiKey.createFailed', { message: apiError.message }),
        variant: 'error'
      })
    } finally {
      setCreatingKey(false)
    }
  }

  const copyCreatedKey = async (value: string) => {
    try {
      await copyToClipboard(value)
      pushToast({ title: t('apiKeys.toast.keyCopied'), variant: 'success' })
    } catch (error) {
      pushToast({
        title: t('apiKeys.toast.copyFailure'),
        description: error instanceof Error ? error.message : t('common.unknownError'),
        variant: 'error'
      })
    }
  }

  const testSetupProvider = async () => {
    if (!setupProvider) return

    setTestingProvider(true)
    try {
      const response = await modelManagementApi.testProvider(setupProvider.id)
      if (response.ok) {
        setTestResult({
          ok: true,
          status: response.status,
          statusText: response.statusText,
          durationMs: response.durationMs,
          testedAt: Date.now()
        })
        return
      }
      setTestResult({
        ok: false,
        status: response.status,
        statusText: response.statusText,
        durationMs: response.durationMs,
        message: `${response.status} ${response.statusText}`,
        testedAt: Date.now()
      })
    } catch (error) {
      const apiError = toApiError(error)
      setTestResult({
        ok: false,
        status: apiError.status,
        message: apiError.status ? `${apiError.status} ${apiError.message}` : apiError.message,
        testedAt: Date.now()
      })
    } finally {
      setTestingProvider(false)
    }
  }

  const gatewayPort = config?.http?.port ?? config?.port ?? 4100
  const anthropicBaseUrl = `http://127.0.0.1:${gatewayPort}/anthropic`

  const activeStep = SETUP_STEPS[stepIndex]
  const canProceed: Record<SetupStepId, boolean> = {
    provider: providers.length > 0,
    routing: anthropicRouteCount > 0,
    apiKey: createdKey !== null,
    verify: true
  }

  const goNext = () => {
    setStepIndex((index) => Math.min(index + 1, SETUP_STEPS.length - 1))
  }
  const goBack = () => {
    setStepIndex((index) => Math.max(index - 1, 0))
  }
  const goToStep = (id: string) => {
    const index = SETUP_STEPS.indexOf(id as SetupStepId)
    if (index >= 0 && index <= stepIndex) {
      setStepIndex(index)
    }
  }
  const finish = () => {
    navigate('/')
  }

  return {
    ...base,
    stepIndex,
    activeStep,
    canProceed,
    goNext,
    goBack,
    goToStep,
    finish,
    providers,
    setupProvider,
    setupProviderId,
    setSetupProviderId,
    savingProvider,
    saveProvider,
    anthropicRoutes,
    anthropicRouteCount,
    routeSource,
    setRouteSource,
    routeTarget,
    setRouteTarget: setRouteTargetOverride,
    savingRoute,
    saveDefaultRoute,
    keyName,
    setKeyName,
    keyEndpoints,
    setKeyEndpoints,
    keyMaxConcurrency,
    setKeyMaxConcurrency,
    creatingKey,
    createdKey,
    createApiKey,
    copyCreatedKey,
    testingProvider,
    testResult,
    testSetupProvider,
    anthropicBaseUrl
  }
}

export type SetupState = ReturnType<typeof useSetupState>
