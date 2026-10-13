export interface ApiKeySummary {
  id: number
  name: string
  description: string | null
  maskedKey: string | null
  isWildcard: boolean
  enabled: boolean
  createdAt: string | null
  lastUsedAt: string | null
  requestCount: number
  totalInputTokens: number
  totalOutputTokens: number
  allowedEndpoints: string[] | null
  maxConcurrency: number | null
}

export interface NewApiKeyResponse {
  id: number
  key: string
  name: string
  description: string | null
  createdAt: string
}

export interface ApiKeyOverviewStats {
  totalKeys: number
  enabledKeys: number
  activeKeys: number
  rangeDays: number
}

export interface ApiKeyUsageMetric {
  apiKeyId: number | null
  apiKeyName: string | null
  requests: number
  inputTokens: number
  outputTokens: number
  /** Additive columns (v0.14) aligning the api-key tab with the other usage-distribution tabs. */
  cacheReadTokens?: number
  cacheCreationTokens?: number
  avgLatencyMs?: number
  lastUsedAt: string | null
  /** Sum of priced requests' cost (display currency); null = nothing priced (v0.16). */
  cost?: number | null
  unpricedRequests?: number
}
