export default {
  description: 'Monitor request volume and runtime health at a glance.',
  labels: {
    providers: 'Providers',
    activeClientAddresses: 'Active client addresses',
    activeClientSessions: 'Active sessions',
    uniqueClientAddressesLastHour: '1h active client IPs',
    uniqueClientSessionsLastHour: '1h sessions',
    todayRequests: 'Today requests',
    activeRequests: 'Active forwarded connections',
    throughput: 'Throughput',
    requestsPerMinute: 'RPM',
    outputTokensPerMinute: 'TPM',
    cpu: 'CPU usage',
    bandwidth: 'Bandwidth',
    networkIngress: 'Ingress bandwidth',
    networkEgress: 'Egress bandwidth',
    database: 'Database',
    memory: 'Memory'
  },
  filters: {
    endpoint: 'Endpoint',
    endpointAll: 'All endpoints',
    endpointAnthropic: 'anthropic',
    endpointOpenAI: 'openai'
  },
  status: {
    listeningLabel: 'Listening',
    listening: 'Listening: {{host}}:{{port}}',
    providers: 'Providers: {{value}}',
    todayRequests: 'Requests today: {{value}}',
    active: 'Active requests: {{value}}',
    dbSize: 'Database: {{value}}',
    memory: 'Memory usage: {{value}}'
  },
  actions: {
    compact: 'Compact database',
    compacting: 'Compacting...'
  },
  toast: {
    overviewError: 'Failed to load overview metrics',
    dailyError: 'Failed to load trend metrics',
    modelError: 'Failed to load model statistics',
    statusError: 'Failed to load gateway status',
    dbError: 'Failed to load database info',
    recentError: 'Failed to load recent requests',
    compactSuccess: {
      title: 'Database compact completed',
      desc: 'Free pages were compacted. Refresh later to confirm size.'
    },
    compactError: {
      title: 'Database compact failed',
      desc: 'Error: {{message}}'
    }
  },
  cards: {
    todayRequests: 'Requests Today',
    todayInput: 'Input Tokens Today',
    todayCacheRead: 'Cache Read Today',
    todayCacheCreation: 'Cache Creation Today',
    todayOutput: 'Output Tokens Today',
    todayCached: 'Cached Tokens Today',
    todayErrorRate: 'Error Rate Today',
    cacheHitHint: 'Hit rate {{value}}%',
    errorCountHint: '{{value}} errors',
    avgLatency: 'Average Latency',
    systemResources: 'System Resources'
  },
  charts: {
    trendTitle: 'Request trend',
    trendDesc: 'Requests and average latency over the last 14 days',
    latencyLabel: 'Avg latency (ms)',
    requestsTitle: 'Request Trends',
    requestsDesc: 'Requests and token usage over the last 14 days',
    modelTitle: 'Model Distribution',
    modelDesc: 'Requests and tokens by model in the past 7 days',
    barRequests: 'Requests',
    lineInput: 'Input tokens',
    lineOutput: 'Output tokens',
    lineCached: 'Cached tokens',
    lineCacheRead: 'Cache Read',
    lineCacheCreation: 'Cache Creation',
    axisTokens: 'Tokens',
    ttftLabel: 'TTFT (ms)',
    tpotLabel: 'TPOT (ms/token)',
    ttftTitle: 'TTFT Comparison',
    ttftDesc: 'Compare first-token latency (TTFT) across models',
    ttftEmpty: 'No TTFT data available.',
    tpotTitle: 'TPOT Comparison',
    tpotDesc: 'Compare per-token latency (TPOT) across models',
    tpotEmpty: 'No TPOT data available.',
    ttftAxis: 'TTFT (ms)',
    tpotAxis: 'TPOT (ms/token)',
    empty: 'No data'
  },
  insights: {
    totalRequests: 'Requests in range',
    totalRequestsHint: 'Total requests across the last 14 days',
    busiestDay: 'Busiest day',
    busiestDayHint: '{{value}} requests',
    topModel: 'Top model',
    topModelHint: '{{value}} calls',
    fastestTtft: 'Fastest TTFT model'
  },
  recent: {
    title: 'Recent Requests',
    subtitle: 'Showing the latest {{count}} records',
    loading: 'Loading...',
    empty: 'No recent requests',
    routePlaceholder: 'Not specified',
    columns: {
      time: 'Time',
      endpoint: 'Endpoint',
      provider: 'Provider',
      route: 'Route',
      latency: 'Latency (ms)',
      status: 'Status'
    }
  },
  attention: {
    title: 'Needs attention',
    subtitle: 'Warning and error events pushed in real time',
    live: 'Live',
    reconnecting: 'Reconnecting…',
    failed: 'Connection failed — reload to retry',
    allClear: 'No recent anomalies',
    viewAll: 'View all events'
  },
  sections: {
    performance: 'Performance details'
  },
  setupProgress: {
    label: 'Setup {{done}}/{{total}}',
    cta: 'Continue setup →'
  },
  guide: {
    title: 'Get started in three steps',
    subtitle: 'Connect a provider, confirm routing, create an API key, then send your first request — the dashboard will come alive.',
    startWizard: 'Start guided setup',
    step1Title: 'Connect a provider',
    step1Desc: 'Add at least one upstream model service under Model Providers.',
    step1DescDone: '{{count}} provider(s) detected — continue to the next step.',
    step1Cta: 'Open Providers & Routing',
    step2Title: 'Confirm default routing',
    step2Desc: 'Make sure an endpoint or default route is configured so clients can connect reliably.',
    step2DescDone: '{{count}} custom endpoint(s) exist — review the default mappings.',
    step2Cta: 'Open Providers & Routing',
    step3Title: 'Send your first request',
    step3Desc: 'Create an API key and send a request from your usual client to start seeing logs, routing, and latency data.',
    step3Cta: 'Open API Keys'
  },
  modelTable: {
    title: 'Model Performance Snapshot',
    description: 'Requests, average latency, TTFT, and TPOT by downstream model.',
    empty: 'No model statistics available.',
    columns: {
      model: 'Provider/Model',
      requests: 'Requests',
      latency: 'Avg Latency',
      ttft: 'TTFT',
      tpot: 'TPOT'
    }
  }
}
