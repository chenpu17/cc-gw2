import { apiClient, unwrapResponse } from '@/services/api'
import type { GatewayConfig, RoutingPreset } from '@/types/providers'

export interface ProviderTestPayload {
  headers?: Record<string, string>
  query?: string
}

export interface ProviderTestResponse {
  ok: boolean
  status: number
  statusText: string
  durationMs?: number
  sample?: string | null
}

export interface RoutingPresetsResponse {
  success: boolean
  presets: RoutingPreset[]
}

export interface RoutingPresetApplyResponse {
  success: boolean
  config: GatewayConfig
}

export const modelManagementApi = {
  savePreset(endpoint: string, name: string): Promise<RoutingPresetsResponse> {
    return unwrapResponse(
      apiClient.post<RoutingPresetsResponse>(`/api/routing-presets/${endpoint}`, { name })
    )
  },

  applyPreset(endpoint: string, name: string): Promise<RoutingPresetApplyResponse> {
    return unwrapResponse(
      apiClient.post<RoutingPresetApplyResponse>(`/api/routing-presets/${endpoint}/apply`, { name })
    )
  },

  deletePreset(endpoint: string, name: string): Promise<RoutingPresetsResponse> {
    return unwrapResponse(
      apiClient.delete<RoutingPresetsResponse>(`/api/routing-presets/${endpoint}/${encodeURIComponent(name)}`)
    )
  },

  testProvider(providerId: string, payload?: ProviderTestPayload): Promise<ProviderTestResponse> {
    return unwrapResponse(
      apiClient.post<ProviderTestResponse>(`/api/providers/${providerId}/test`, payload)
    )
  }
}
