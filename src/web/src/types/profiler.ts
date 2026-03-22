export interface ProfilerSession {
  id: string
  sessionId: string
  startedAt: number
  endedAt: number | null
  turnCount: number
  totalInputTokens: number
  totalOutputTokens: number
  totalCacheReadTokens: number
  totalCacheCreationTokens: number
  totalLatencyMs: number | null
}

export interface ProfilerRecord {
  id: number
  profilerSessionId: string
  logId: number
  sessionId: string
  turnIndex: number
  timestamp: number
  model: string
  clientModel: string | null
  stream: boolean
  latencyMs: number | null
  ttftMs: number | null
  tpotMs: number | null
  statusCode: number | null
  inputTokens: number | null
  outputTokens: number | null
  cacheReadTokens: number | null
  cacheCreationTokens: number | null
  error: string | null
  clientRequest: string | null
  clientResponse: string | null
}

export interface ProfilerSessionDetail extends ProfilerSession {
  records: ProfilerRecord[]
}

export interface ProfilerSessionListResponse {
  total: number
  items: ProfilerSession[]
}

export interface ProfilerStatus {
  active: boolean
}
