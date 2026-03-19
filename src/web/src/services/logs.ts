import type { AxiosRequestConfig } from 'axios'
import { apiClient } from '@/services/api'

export type LogsQueryParams = Record<string, unknown>

export const logsApi = {
  listRequest(params: LogsQueryParams): AxiosRequestConfig {
    return {
      url: '/api/logs',
      method: 'GET',
      params
    }
  },

  detailRequest(logId: number | null): AxiosRequestConfig {
    return {
      url: logId === null ? '' : `/api/logs/${logId}`,
      method: 'GET'
    }
  },

  async exportArchive(payload: Record<string, unknown>, timeoutMs: number): Promise<Blob> {
    const response = await apiClient.post('/api/logs/export', payload, {
      responseType: 'blob',
      timeout: timeoutMs
    })

    return new Blob([response.data], { type: 'application/zip' })
  }
}
