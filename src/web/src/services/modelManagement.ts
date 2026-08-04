import { apiClient, unwrapResponse } from '@/services/api'
import type { GatewayConfig, ProviderConfig, RoutingPreset } from '@/types/providers'

export interface ProviderTestPayload {
  headers?: Record<string, string>
  query?: string
  /** Unsaved provider draft (create-mode console form); wins over the saved lookup */
  provider?: ProviderConfig
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

export interface ProbedModel {
  id: string
  label?: string
}

export interface ProbeModelsResponse {
  ok: boolean
  status: number
  statusText?: string
  models?: ProbedModel[]
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
      apiClient.post<ProviderTestResponse>(`/api/providers/${providerId}/test`, payload ?? {})
    )
  },

  probeModels(providerId: string, draft?: ProviderConfig): Promise<ProbeModelsResponse> {
    return unwrapResponse(
      apiClient.post<ProbeModelsResponse>(
        `/api/providers/${providerId}/models/probe`,
        draft ? { provider: draft } : {}
      )
    )
  }
}
