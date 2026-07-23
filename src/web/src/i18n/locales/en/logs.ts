export default {
  title: 'Request Logs',
  description: 'Inspect recent traffic with provider/model/status filters and date range.',
  filtersTitle: 'Filters',
  filtersDescription: 'Combine conditions to zero in on the requests you care about.',
  summary: {
    total: 'Total records: {{value}}'
  },
  filters: {
    provider: 'Provider',
    providerAll: 'All providers',
    endpoint: 'Endpoint',
    endpointAll: 'All endpoints',
    endpointAnthropic: 'anthropic',
    endpointOpenAI: 'openai',
    apiKey: 'API Key',
    apiKeyHint: 'Select one or more keys; leave empty to include all.',
    modelId: 'Model ID',
    modelPlaceholder: 'e.g. deepseek-chat',
    status: 'Status',
    statusAll: 'All',
    statusSuccess: 'Success',
    statusError: 'Error',
    startDate: 'Start date',
    endDate: 'End date',
    apiKeyAll: 'All keys',
    apiKeySelected: '{{count}} selected'
  },
  actions: {
    columns: 'Columns',
    visibleCount: '{{count}} columns visible',
    manualRefresh: 'Manual refresh',
    refreshing: 'Refreshing...',
    export: 'Export ZIP',
    exporting: 'Exporting...',
    detail: 'Detail'
  },
  quickViews: {
    all: 'All traffic',
    errors: 'Errors only',
    today: 'Today',
    anthropic: 'Anthropic',
    openai: 'OpenAI'
  },
  table: {
    loading: 'Loading logs...',
    empty: 'No records match the current filters.',
    density: {
      comfortable: 'Comfortable',
      compact: 'Compact'
    },
    requestedModelFallback: 'Not specified',
    apiKeyUnknown: 'Unknown key',
    columns: {
      time: 'Time',
      endpoint: 'Endpoint',
      provider: 'Provider',
      requestedModel: 'Requested model',
      routedModel: 'Routed model',
      apiKey: 'API Key',
      tokens: 'Tokens',
      duration: 'Latency',
      tokenIn: 'In',
      tokenOut: 'Out',
      tokenCache: 'Cache',
      latencyTtft: 'TTFT',
      latencyTpot: 'TPOT',
      status: 'Status',
      error: 'Error',
      actions: 'Actions'
    },
    pagination: {
      perPage: 'per page',
      unit: 'items',
      previous: 'Previous',
      next: 'Next',
      pageLabel: 'Page {{page}} / {{total}}'
    }
  },
  empty: {
    title: 'Logs have not accumulated yet',
    subtitle: 'Send a real request and this page will start showing routes, latency, and statuses.',
    filteredTitle: 'No logs match the current filters',
    filteredSubtitle: 'Reset the filters or widen the time range, endpoint, or status selection.',
    actions: {
      reset: 'Reset filters',
      apiKeys: 'Open API Keys'
    }
  },
  endpointAnthropic: 'anthropic',
  endpointOpenAI: 'openai',
  stream: {
    streaming: 'Streaming',
    single: 'Non-streaming'
  },
  toast: {
    listError: {
      title: 'Failed to fetch logs',
      desc: 'Error: {{message}}'
    },
    providerError: {
      title: 'Failed to fetch providers',
      desc: 'Error: {{message}}'
    },
    exportSuccess: {
      title: 'Export ready',
      desc: 'The ZIP archive is downloading now and contains `logs.json`.'
    },
    exportError: {
      title: 'Export failed',
      desc: 'Error: {{message}}'
    }
  },
  detail: {
    title: 'Log Detail',
    id: 'ID #{{id}}',
    infoSection: 'Overview',
    info: {
      time: 'Time',
      sessionId: 'Session ID',
      endpoint: 'Endpoint',
      provider: 'Provider',
      requestedModel: 'Requested model',
      noRequestedModel: 'Not specified',
      model: 'Routed model',
      stream: 'Stream',
      latency: 'Latency',
      status: 'Status',
      inputTokens: 'Input Tokens',
      cacheReadTokens: 'Cache Read',
      cacheCreationTokens: 'Cache Creation',
      outputTokens: 'Output Tokens',
      ttft: 'TTFT (first token latency)',
      tpot: 'TPOT (avg ms/token)',
      error: 'Error',
      errorSource: 'Error source'
    },
    errorSource: {
      none: 'None',
      client: 'Client disconnected',
      gateway: 'Gateway error',
      upstream: 'Backend provider error',
      unknown: 'Unknown'
    },
    summary: {
      route: '{{from}} → {{to}}',
      latency: 'Latency: {{value}}',
      ttft: 'TTFT: {{value}}',
      tpot: 'TPOT: {{value}}',
      stream: 'Stream: {{value}}'
    },
    payload: {
      title: 'Payloads',
      helperWithUpstream: 'Client and upstream payloads are shown separately.',
      helperClientOnly: 'No upstream rewrite was recorded, so only client-side payloads are shown.',
      clientRequest: 'Client request',
      upstreamRequest: 'Upstream request',
      upstreamResponse: 'Upstream response',
      clientResponse: 'Client response',
      emptyRequest: 'No request content',
      emptyResponse: 'No response content',
      truncated: 'Showing the first {{shown}} of {{total}} characters. Copy still includes the full payload.'
    },
    apiKey: {
      title: 'API key',
      name: 'Key name',
      identifier: 'Key ID',
      masked: 'Masked form',
      maskedUnavailable: 'No mask available',
      raw: 'Raw key',
      rawUnavailable: 'Raw key not stored',
      rawMasked: 'Raw key (masked)',
      rawMaskedHint: 'For security, only the prefix and suffix are shown. Regenerate the key upstream if you need the full value.',
      missing: 'Not recorded',
      lastUsed: 'Last used'
    },
    copy: {
      requestSuccess: 'Request body copied to clipboard.',
      responseSuccess: 'Response body copied to clipboard.',
      keySuccess: 'API key copied to clipboard.',
      empty: 'Cannot copy empty {{label}}.',
      failure: 'Copy failed',
      failureFallback: 'Unable to copy content. Please try again later.'
    },
    loadError: 'Unable to load log detail.'
  }
}
