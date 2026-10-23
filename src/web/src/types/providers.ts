/**
 * One backend of an aggregated model. `target` is `"providerId:modelId"`
 * (or `"providerId:*"` = the member model reusing the aggregate model's own
 * id). Array order is the failover priority: index 0 is tried first.
 */
export interface AggregateMemberConfig {
  target: string
}

/** Failover tuning for one aggregated model; absent fields use gateway defaults. */
export interface FailoverPolicyConfig {
  consecutiveFailures?: number
  cooldownSeconds?: number
  failureWindowSeconds?: number
  /** e.g. ["429", "5xx"]; transport errors always trigger. */
  triggerStatusCodes?: string[]
}

export interface ProviderModelConfig {
  id: string
  label?: string
  nonStreamViaStream?: boolean
  /** Present only on models of an `aggregate` provider. */
  members?: AggregateMemberConfig[]
  failover?: FailoverPolicyConfig
}

/** Protocol an endpoint speaks natively; also the route-time protocol marker. */
export type ProviderEndpointProtocol = 'anthropic' | 'openai' | 'openai-responses'

/**
 * One protocol surface of a provider. When the request protocol matches an
 * endpoint, routing rewrites baseUrl/type to it so the request is forwarded
 * natively (no cross-protocol conversion).
 */
export interface ProviderEndpointConfig {
  id: string
  label?: string
  protocol: ProviderEndpointProtocol
  baseUrl: string
}

/**
 * One named API key of a provider. The effective key is the first entry with
 * `active: true` (else the first entry); when `keys` is empty the provider's
 * legacy `apiKey` applies.
 */
export interface ProviderKeyConfig {
  id: string
  label?: string
  value: string
  active?: boolean
}

/** Balance dashboard adapters; absent = balance not queryable. */
export type BalanceAdapterId = 'deepseek' | 'moonshot' | 'siliconflow' | 'openrouter'

export interface ProviderConfig {
  id: string
  label: string
  /** Absent on `aggregate` providers (they have no upstream of their own). */
  baseUrl?: string
  apiKey?: string
  authMode?: 'apiKey' | 'authToken' | 'xAuthToken'
  defaultModel?: string
  nonStreamViaStream?: boolean
  useAbsoluteUrl?: boolean
  streamUsage?: boolean
  /** Per-minute upstream request cap; undefined/0 = unlimited. Held in queue when reached. */
  rpmLimit?: number
  /** Max seconds a request may be held once the RPM cap is hit; undefined = 30s default. */
  rpmMaxWaitSeconds?: number
  models?: ProviderModelConfig[]
  extraHeaders?: Record<string, string>
  type?: 'openai' | 'deepseek' | 'kimi' | 'anthropic' | 'huawei' | 'custom' | 'aggregate'
  /** Additional protocol surfaces sharing the provider's key set. */
  endpoints?: ProviderEndpointConfig[]
  /** Named keys; the active one overrides `apiKey` at request time. */
  keys?: ProviderKeyConfig[]
  balanceAdapter?: BalanceAdapterId
}

/** One entry of the built-in preset catalog (`GET /api/provider-presets`). */
export interface ProviderPreset {
  id: string
  label: string
  description: string
  type: 'anthropic' | 'openai'
  baseUrl: string
  /** Extra protocol surfaces the vendor also serves; land in the created
   * provider's `endpoints[]` so it speaks both protocols natively. */
  endpoints: Array<{ id: string; protocol: ProviderEndpointProtocol; baseUrl: string }>
  balanceAdapter?: BalanceAdapterId
  /** True = the upstream has no model-list endpoint; skip the probe step. */
  noModelProbe?: boolean
  defaultModels: string[]
}

export interface ProviderPresetsResponse {
  presets: ProviderPreset[]
}

/** Runtime balance snapshot from a manual refresh (not persisted across restarts). */
export interface BalanceSnapshot {
  adapter: BalanceAdapterId
  providerId: string
  fetchedAt: number
  /** Normalized display string, e.g. "110.00 CNY"; absent when parsing failed. */
  display?: string
  /** Raw upstream JSON for the disclosure detail view. */
  raw: unknown
}

export interface BalanceSnapshotsResponse {
  balances: BalanceSnapshot[]
}

/** Backend health entry from `GET /api/providers/backends/health`; keyed by `providerId:modelId`. */
export interface BackendHealthEntry {
  key: string
  provider: string
  model: string
  consecutiveFailures: number
  lastFailureAt: number | null
  lastSuccessAt: number | null
  cooldownUntil: number | null
  state: 'cooling' | 'degraded' | 'healthy'
  cooldownRemainingSeconds: number | null
}

export interface BackendsHealthResponse {
  backends: BackendHealthEntry[]
}

export interface DefaultsConfig {
  completion: string | null
  reasoning: string | null
  background: string | null
  longContextThreshold: number
}

export interface EndpointCompatibilityConfig {
  enabled: boolean
}

export type GatewayEndpoint = 'anthropic' | 'openai'

export interface HttpConfig {
  enabled: boolean
  port: number
  host?: string
}

export interface HttpsConfig {
  enabled: boolean
  port: number
  host?: string
  keyPath: string
  certPath: string
  caPath?: string
}

export interface ProtocolModelRoutes {
  anthropic?: Record<string, string>
  openai?: Record<string, string>
}

export interface EndpointRoutingConfig {
  defaults: DefaultsConfig
  modelRoutes: Record<string, string>
  /** Protocol-family routes (unified endpoints); override `modelRoutes`. */
  modelRoutesByProtocol?: ProtocolModelRoutes
  compatibility?: EndpointCompatibilityConfig
}

export interface RoutingPreset {
  name: string
  modelRoutes: Record<string, string>
  modelRoutesByProtocol?: ProtocolModelRoutes
  createdAt: number
}

// Import CustomEndpoint from endpoints (to avoid circular dependency, we'll define it here if needed)
export interface CustomEndpointConfig {
  id: string
  label: string
  paths?: Array<{ path: string; protocol: string }>
  path?: string
  protocol?: string
  enabled?: boolean
  routing?: EndpointRoutingConfig
  routingPresets?: RoutingPreset[]
}

export interface GatewayConfig {
  // 新格式: HTTP/HTTPS 独立配置
  http?: HttpConfig
  https?: HttpsConfig
  // 旧格式: 向后兼容
  port?: number
  host?: string

  providers: ProviderConfig[]
  defaults: DefaultsConfig
  enableRoutingFallback?: boolean
  logRetentionDays?: number
  logExportTimeoutSeconds?: number
  modelRoutes?: Record<string, string>
  endpointRouting?: Partial<Record<GatewayEndpoint, EndpointRoutingConfig>>
  customEndpoints?: CustomEndpointConfig[]
  routingPresets?: Partial<Record<GatewayEndpoint, RoutingPreset[]>>
  storeRequestPayloads?: boolean
  storeResponsePayloads?: boolean
  storePayloads?: boolean
  logLevel?: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace'
  bodyLimit?: number
  webAuth?: WebAuthConfig
  /** Billing settings (v0.16) — query-time pricing, hot-reloaded. */
  billing?: BillingConfig
}

/** Billing config mirror (v0.16): prices/rates are estimation-only and
 * re-price history retroactively at query time. */
export interface BillingConfig {
  /** "CNY" (default) | "USD" — display currency for all cost fields. */
  displayCurrency?: string
  /** Source currency (uppercase) → 1 unit in display currency; builtin
   * default 1 USD = 7.20 CNY, overridable. */
  rates?: Record<string, number>
  /** Price overrides keyed by `model-id` (global) or `providerId:modelId`. */
  modelPrices?: Record<string, ModelPriceOverride>
}

/** Per-model price override (per 1M tokens, native currency; 0 = free). */
export interface ModelPriceOverride {
  /** "USD" | "CNY" (case-insensitive on the server). */
  currency: string
  input: number
  output: number
  cacheRead: number
  cacheCreation: number
  /** Optional display note (e.g. enterprise agreement price). */
  label?: string
}

export interface ConfigInfoResponse {
  config: GatewayConfig
  path: string
}

export interface WebAuthConfig {
  enabled: boolean
  username?: string
}

export interface WebAuthStatusResponse {
  enabled: boolean
  username: string
  hasPassword: boolean
}

export interface CertificateStatusResponse {
  exists: boolean
  configured: boolean
  keyPath?: string
  certPath?: string
}

export interface CertificateGenerationResponse {
  success: boolean
  keyPath?: string
  certPath?: string
  error?: string
}
