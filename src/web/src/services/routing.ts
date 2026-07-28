import type { AxiosRequestConfig } from 'axios'
import type { RoutingSimulateRequest } from '@/types/routing'

/**
 * Routing hit-simulation API. Read-only: resolves the target the gateway WOULD
 * pick without sending any upstream request. Exposes request-config factories
 * (for `useApiQuery`) to match the `gatewayApi` convention.
 */
export const routingApi = {
  simulateRequest(request: RoutingSimulateRequest): AxiosRequestConfig {
    return { url: '/api/routing/simulate', method: 'POST', data: request }
  }
}
