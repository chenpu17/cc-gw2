import axios, { AxiosHeaders } from 'axios'
import type { AxiosRequestConfig, AxiosResponse } from 'axios'
import type {
  CustomEndpointsResponse,
  CreateEndpointRequest,
  UpdateEndpointRequest,
  EndpointResponse
} from '@/types/endpoints'
import type { EventsResponse } from '@/types/events'

export const apiClient = axios.create({
  baseURL: '/',
  timeout: 15000,
  withCredentials: true
})

apiClient.interceptors.request.use((config) => {
  const method = (config.method ?? 'get').toLowerCase()
  if (method === 'get' || method === 'head') {
    const headers = AxiosHeaders.from(config.headers)
    headers.set('Cache-Control', 'no-cache')
    headers.set('Pragma', 'no-cache')
    config.headers = headers
  }
  return config
})

apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.error('API request failed', error)
    }
    return Promise.reject(error)
  }
)

export interface ApiError {
  message: string
  code?: string
  status?: number
}

export function toApiError(error: unknown): ApiError {
  if (axios.isAxiosError(error)) {
    const status = error.response?.status
    const message =
      (error.response?.data as { error?: string })?.error ||
      error.message ||
      '请求失败，请稍后再试'
    return {
      message,
      status,
      code: String(status ?? 'unknown')
    }
  }
  return {
    message: error instanceof Error ? error.message : '请求失败，请稍后再试'
  }
}

export async function requestJson<TData>(request: AxiosRequestConfig): Promise<TData> {
  const response = await apiClient.request<TData>(request)
  return response.data
}

export async function unwrapResponse<TData>(request: Promise<AxiosResponse<TData>>): Promise<TData> {
  const response = await request
  return response.data
}

// Custom Endpoints API
export const customEndpointsApi = {
  list: async (): Promise<CustomEndpointsResponse> => {
    return unwrapResponse(apiClient.get<CustomEndpointsResponse>('/api/custom-endpoints'))
  },

  create: async (data: CreateEndpointRequest): Promise<EndpointResponse> => {
    return unwrapResponse(apiClient.post<EndpointResponse>('/api/custom-endpoints', data))
  },

  update: async (id: string, data: UpdateEndpointRequest): Promise<EndpointResponse> => {
    return unwrapResponse(apiClient.put<EndpointResponse>(`/api/custom-endpoints/${id}`, data))
  },

  delete: async (id: string): Promise<{ success: boolean }> => {
    return unwrapResponse(apiClient.delete<{ success: boolean }>(`/api/custom-endpoints/${id}`))
  }
}

export const eventsApi = {
  list: async (params?: { limit?: number; cursor?: number; level?: string; type?: string }): Promise<EventsResponse> => {
    return requestJson<EventsResponse>({
      url: '/api/events',
      method: 'GET',
      params: {
        limit: params?.limit,
        cursor: params?.cursor,
        level: params?.level,
        type: params?.type
      }
    })
  }
}
