import type { AxiosRequestConfig } from 'axios'
import { apiClient, requestJson, unwrapResponse } from '@/services/api'
import type { ConfigInfoResponse, GatewayConfig } from '@/types/providers'

export interface ProviderSummary {
  id: string
  label?: string
}

export const gatewayApi = {
  configRequest(): AxiosRequestConfig {
    return { url: '/api/config', method: 'GET' }
  },

  configInfoRequest(): AxiosRequestConfig {
    return { url: '/api/config/info', method: 'GET' }
  },

  providersRequest(): AxiosRequestConfig {
    return { url: '/api/providers', method: 'GET' }
  },

  configInfo: async (): Promise<ConfigInfoResponse> => {
    return requestJson<ConfigInfoResponse>(gatewayApi.configInfoRequest())
  },

  providers: async (): Promise<ProviderSummary[]> => {
    return requestJson<ProviderSummary[]>(gatewayApi.providersRequest())
  },

  saveConfig: async (config: GatewayConfig): Promise<void> => {
    await unwrapResponse(apiClient.put<void>('/api/config', config))
  }
}
