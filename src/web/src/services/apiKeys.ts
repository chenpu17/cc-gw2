import { apiClient, requestJson, unwrapResponse } from '@/services/api'
import type {
  ApiKeyOverviewStats,
  ApiKeySummary,
  ApiKeyUsageMetric,
  NewApiKeyResponse
} from '@/types/apiKeys'

export interface ApiKeyMutationPayload {
  enabled?: boolean
  allowedEndpoints?: string[] | null
}

export interface CreateApiKeyPayload {
  name: string
  description?: string
  allowedEndpoints?: string[]
}

export interface RevealApiKeyResponse {
  key: string
}

export const apiKeysApi = {
  listRequest() {
    return {
      url: '/api/keys',
      method: 'GET' as const
    }
  },

  overviewRequest(days: number) {
    return {
      url: '/api/stats/api-keys/overview',
      method: 'GET' as const,
      params: { days }
    }
  },

  usageRequest(days: number, limit = 10) {
    return {
      url: '/api/stats/api-keys/usage',
      method: 'GET' as const,
      params: { days, limit }
    }
  },

  customEndpointOptionsRequest() {
    return {
      url: '/api/custom-endpoints',
      method: 'GET' as const
    }
  },

  create: async (payload: CreateApiKeyPayload): Promise<NewApiKeyResponse> => {
    return unwrapResponse(apiClient.post<NewApiKeyResponse>('/api/keys', payload))
  },

  update: async (id: number, payload: ApiKeyMutationPayload): Promise<void> => {
    await unwrapResponse(apiClient.patch<void>(`/api/keys/${id}`, payload))
  },

  delete: async (id: number): Promise<void> => {
    await unwrapResponse(apiClient.delete<void>(`/api/keys/${id}`))
  },

  reveal: async (id: number): Promise<RevealApiKeyResponse> => {
    return requestJson<RevealApiKeyResponse>({
      url: `/api/keys/${id}/reveal`,
      method: 'GET'
    })
  }
}
