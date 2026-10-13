export interface LogRecord {
  id: number
  timestamp: number
  session_id: string | null
  client_kind: string | null
  user_agent: string | null
  endpoint: string
  provider: string
  model: string
  client_model: string | null
  stream: boolean
  latency_ms: number | null
  status_code: number | null
  input_tokens: number | null
  output_tokens: number | null
  cached_tokens: number | null
  cache_read_tokens: number | null
  cache_creation_tokens: number | null
  ttft_ms: number | null
  tpot_ms: number | null
  error: string | null
  error_source: 'client' | 'gateway' | 'upstream' | string | null
  error_detail: string | null
  api_key_id: number | null
  api_key_name: string | null
  api_key_value_masked?: string | null
  api_key_value_available?: boolean
  /** Query-time cost in the display currency (billing, v0.16); null = unpriced. */
  cost?: number | null
  /** Per-component cost breakdown; null when unpriced. */
  cost_breakdown?: CostBreakdown | null
}

/** Cost components (camelCase, mirrors the stats contracts). */
export interface CostBreakdown {
  input: number
  output: number
  cacheRead: number
  cacheCreation: number
  total: number
}

export interface LogPayload {
  client_request: string | null
  upstream_request: string | null
  upstream_response: string | null
  client_response: string | null
}

export interface LogDetail extends LogRecord {
  payload: LogPayload | null
}

export interface LogListResponse {
  total: number
  items: LogRecord[]
  /** Display currency of `cost` fields (billing, v0.16). */
  cost_currency?: string
}
