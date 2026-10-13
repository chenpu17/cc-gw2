import { apiClient, unwrapResponse } from '@/services/api'
import type {
  BalanceSnapshot,
  BalanceSnapshotsResponse,
  ProviderPresetsResponse
} from '@/types/providers'

export const presetsApi = {
  /** Built-in provider template catalog (Rust single source of truth). */
  list(): Promise<ProviderPresetsResponse> {
    return unwrapResponse(apiClient.get<ProviderPresetsResponse>('/api/provider-presets'))
  }
}

export const balanceApi = {
  /** Manual refresh; snapshots live in gateway runtime state only. */
  refresh(providerId: string): Promise<BalanceSnapshot> {
    return unwrapResponse(
      apiClient.post<BalanceSnapshot>(`/api/providers/${providerId}/balance/refresh`)
    )
  },

  /** Latest snapshot per provider (never-refreshed providers are absent). */
  all(): Promise<BalanceSnapshotsResponse> {
    return unwrapResponse(apiClient.get<BalanceSnapshotsResponse>('/api/providers/balances'))
  }
}
