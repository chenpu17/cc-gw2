import { apiClient, requestJson, unwrapResponse } from './api'
import type { ProfilerSessionListResponse, ProfilerSessionDetail, ProfilerStatus } from '@/types/profiler'

export const profilerApi = {
  getStatus: (): Promise<ProfilerStatus> =>
    requestJson({ url: '/api/profiler/status', method: 'GET' }),

  start: (): Promise<ProfilerStatus> =>
    unwrapResponse(apiClient.post<ProfilerStatus>('/api/profiler/start')),

  stop: (): Promise<ProfilerStatus> =>
    unwrapResponse(apiClient.post<ProfilerStatus>('/api/profiler/stop')),

  listSessions: (params?: { limit?: number; offset?: number }): Promise<ProfilerSessionListResponse> =>
    requestJson({
      url: '/api/profiler/sessions',
      method: 'GET',
      params
    }),

  getSession: (id: string): Promise<ProfilerSessionDetail> =>
    requestJson({ url: `/api/profiler/sessions/${id}`, method: 'GET' }),

  deleteSession: (id: string): Promise<void> =>
    unwrapResponse(apiClient.delete(`/api/profiler/sessions/${id}`)),

  clearAll: (): Promise<{ deleted: number }> =>
    unwrapResponse(apiClient.post<{ deleted: number }>('/api/profiler/sessions/clear'))
}
