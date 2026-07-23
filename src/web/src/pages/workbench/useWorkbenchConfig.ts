import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { customEndpointsApi, type ApiError } from '@/services/api'
import { gatewayApi } from '@/services/gateway'
import { queryKeys } from '@/services/queryKeys'
import { useApiQuery } from '@/hooks/useApiQuery'
import { useToast } from '@/providers/ToastProvider'
import type { GatewayConfig } from '@/types/providers'
import { buildTabs, type ManagementTab } from './shared'

/**
 * Shared config read/write foundation for the providers workbench.
 * Owns the gateway config query, the custom endpoint query and the local
 * config draft; provider and routing state hooks build on top of it.
 */
export function useWorkbenchConfig() {
  const { t } = useTranslation()
  const { pushToast } = useToast()

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

  const [config, setConfig] = useState<GatewayConfig | null>(null)

  useEffect(() => {
    if (configQuery.data) {
      setConfig(configQuery.data)
    }
  }, [configQuery.data])

  useEffect(() => {
    if (!configQuery.isError || !configQuery.error) return

    pushToast({
      title: t('providers.toast.loadFailure', { message: configQuery.error.message }),
      variant: 'error'
    })
  }, [configQuery.error, configQuery.isError, pushToast, t])

  const ensureConfig = () => {
    if (config) return true

    pushToast({
      title: t('settings.toast.missingConfig'),
      variant: 'error'
    })
    void configQuery.refetch()
    return false
  }

  return {
    t,
    pushToast,
    config,
    setConfig,
    configQuery,
    customEndpoints,
    customEndpointsQuery,
    tabs,
    ensureConfig
  }
}

export type WorkbenchConfigState = ReturnType<typeof useWorkbenchConfig>
