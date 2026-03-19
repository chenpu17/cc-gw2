import { apiClient, requestJson, unwrapResponse } from '@/services/api'
import type { WebAuthStatusResponse } from '@/types/providers'

export interface CleanupResponse {
  success: boolean
  deleted: number
}

export interface ClearResponse {
  success: boolean
  deleted: number
  metricsCleared: number
}

export interface SaveWebAuthPayload {
  enabled: boolean
  username?: string
  password?: string
}

export const settingsApi = {
  authStatusRequest() {
    return {
      url: '/api/auth/web',
      method: 'GET' as const
    }
  },

  saveWebAuth: async (payload: SaveWebAuthPayload): Promise<{ auth?: WebAuthStatusResponse }> => {
    return unwrapResponse(apiClient.post<{ auth?: WebAuthStatusResponse }>('/api/auth/web', payload))
  },

  cleanupLogs: async (): Promise<CleanupResponse> => {
    return requestJson<CleanupResponse>({
      url: '/api/logs/cleanup',
      method: 'POST'
    })
  },

  clearLogs: async (): Promise<ClearResponse> => {
    return requestJson<ClearResponse>({
      url: '/api/logs/clear',
      method: 'POST'
    })
  }
}
