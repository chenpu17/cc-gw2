export const queryKeys = {
  auth: {
    session: () => ['auth', 'session'] as const,
    web: () => ['auth', 'web'] as const
  },
  config: {
    full: () => ['config', 'full'] as const,
    info: () => ['config', 'info'] as const,
    exportTimeout: () => ['config', 'export-timeout'] as const
  },
  customEndpoints: {
    all: () => ['custom-endpoints'] as const
  },
  providers: {
    all: () => ['providers', 'all'] as const
  },
  stats: {
    overview: (endpoint = 'all') => ['stats', 'overview', endpoint] as const,
    daily: (days: number, endpoint = 'all') => ['stats', 'daily', days, endpoint] as const,
    model: (days: number, limit: number, endpoint = 'all') => ['stats', 'model', days, limit, endpoint] as const
  },
  status: {
    byEndpoint: (endpoint = 'all') => ['status', endpoint] as const,
    gateway: () => ['status', 'gateway'] as const
  },
  db: {
    info: () => ['db', 'info'] as const
  },
  logs: {
    list: (params: Record<string, unknown>) => ['logs', params] as const,
    recent: (endpoint = 'all') => ['logs', 'recent', endpoint] as const,
    detail: (id: number | string | null) => ['logs', 'detail', id] as const
  },
  events: {
    list: (params: { limit?: number; cursor?: number; level?: string; type?: string }) => ['events', params] as const
  },
  apiKeys: {
    all: () => ['api-keys'] as const,
    overview: (days: number) => ['api-keys', 'overview', days] as const,
    usage: (days: number) => ['api-keys', 'usage', days] as const
  },
  profiler: {
    status: () => ['profiler', 'status'] as const,
    sessions: (params: Record<string, unknown>) => ['profiler', 'sessions', params] as const,
    session: (id: string | null) => ['profiler', 'session', id] as const
  }
}
