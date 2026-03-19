import { apiClient, requestJson, unwrapResponse } from '@/services/api'
import type { AuthLoginResponse, AuthLogoutResponse, AuthSessionResponse } from '@/types/auth'

export const authApi = {
  session: async (): Promise<AuthSessionResponse> => {
    return requestJson<AuthSessionResponse>({
      url: '/auth/session',
      method: 'GET'
    })
  },

  login: async (username: string, password: string): Promise<AuthLoginResponse> => {
    return unwrapResponse(
      apiClient.post<AuthLoginResponse>('/auth/login', { username, password })
    )
  },

  logout: async (): Promise<AuthLogoutResponse> => {
    return unwrapResponse(apiClient.post<AuthLogoutResponse>('/auth/logout'))
  }
}
