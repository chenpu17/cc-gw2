export default {
  description: '快速了解请求规模与实时运行状态。',
  labels: {
    providers: 'Provider 数量',
    activeClientAddresses: '活跃来源地址',
    activeClientSessions: '活跃会话',
    uniqueClientAddressesLastHour: '1小时活跃客户端 IP',
    uniqueClientSessionsLastHour: '1小时会话',
    todayRequests: '今日请求',
    activeRequests: '活跃转发连接',
    throughput: '实时吞吐',
    requestsPerMinute: 'RPM',
    outputTokensPerMinute: 'TPM',
    cpu: 'CPU 占用率',
    bandwidth: '网络带宽',
    networkIngress: '入口带宽',
    networkEgress: '出口带宽',
    database: '数据库',
    memory: '内存占用'
  },
  filters: {
    endpoint: '端点筛选',
    endpointAll: '全部端点',
    endpointAnthropic: 'anthropic',
    endpointOpenAI: 'openai'
  },
  status: {
    listeningLabel: '监听地址',
    listening: '监听：{{host}}:{{port}}',
    providers: 'Provider 数量：{{value}}',
    todayRequests: '今日请求：{{value}}',
    active: '活动请求：{{value}}',
    dbSize: '数据库：{{value}}',
    memory: '内存占用：{{value}}'
  },
  actions: {
    compact: '释放数据库空间',
    compacting: '整理中...'
  },
  toast: {
    overviewError: '统计数据获取失败',
    dailyError: '趋势数据获取失败',
    modelError: '模型统计获取失败',
    statusError: '状态信息获取失败',
    dbError: '数据库信息获取失败',
    recentError: '最近请求获取失败',
    compactSuccess: {
      title: '数据库整理完成',
      desc: '空闲页已整理，建议稍后刷新确认容量。'
    },
    compactError: {
      title: '数据库整理失败',
      desc: '错误信息：{{message}}'
    }
  },
  cards: {
    todayRequests: '今日请求数',
    todayInput: '今日输入 Tokens',
    todayCacheRead: '今日缓存读取',
    todayCacheCreation: '今日缓存写入',
    todayOutput: '今日输出 Tokens',
    todayCached: '今日缓存 Tokens',
    todayErrorRate: '今日错误率',
    cacheHitHint: '命中率 {{value}}%',
    errorCountHint: '{{value}} 次错误',
    yesterdayHint: '昨日同期 {{value}}',
    avgLatency: '平均响应耗时',
    systemResources: '系统资源'
  },
  charts: {
    trendTitle: '请求趋势',
    trendDesc: '最近 14 天请求量与平均延迟走势',
    latencyLabel: '平均延迟 (ms)',
    requestsTitle: '请求趋势',
    requestsDesc: '最近 14 天请求与 Token 走势',
    modelTitle: '模型调用分布',
    modelDesc: '近 7 天不同模型的调用次数与 Token 走势',
    barRequests: '请求数',
    lineInput: '输入 Tokens',
    lineOutput: '输出 Tokens',
    lineCached: '缓存 Tokens',
    lineCacheRead: '缓存读取',
    lineCacheCreation: '缓存写入',
    axisTokens: 'Tokens',
    ttftLabel: 'TTFT(ms)',
    tpotLabel: 'TPOT(ms/Token)',
    ttftTitle: 'TTFT 模型对比',
    ttftDesc: '比较不同模型的首 Token 耗时 (TTFT)',
    ttftEmpty: '暂无 TTFT 数据。',
    tpotTitle: 'TPOT 模型对比',
    tpotDesc: '比较不同模型的平均 Token 耗时 (TPOT)',
    tpotEmpty: '暂无 TPOT 数据。',
    ttftAxis: 'TTFT (ms)',
    tpotAxis: 'TPOT (ms/Token)',
    empty: '暂无数据'
  },
  insights: {
    totalRequests: '趋势期总请求',
    totalRequestsHint: '最近 14 天累计请求量',
    busiestDay: '最忙的一天',
    busiestDayHint: '{{value}} 次请求',
    topModel: '最高频模型',
    topModelHint: '{{value}} 次调用',
    fastestTtft: '最快 TTFT 模型',
    fastestTtftHint: '{{value}} ms 首 Token'
  },
  recent: {
    title: '最新请求',
    subtitle: '仅展示最近 {{count}} 条记录',
    loading: '加载中...',
    empty: '暂无请求记录',
    routePlaceholder: '未指定',
    columns: {
      time: '时间',
      endpoint: '端点',
      provider: 'Provider',
      route: '路由',
      latency: '耗时(ms)',
      status: '状态'
    }
  },
  attention: {
    title: '需要关注',
    subtitle: '实时推送的警告与错误事件',
    live: '实时',
    reconnecting: '重连中…',
    failed: '连接失败 — 刷新以重试',
    allClear: '最近无异常事件',
    viewAll: '查看全部事件'
  },
  sections: {
    performance: '性能详情'
  },
  setupProgress: {
    label: '初始化 {{done}}/{{total}}',
    cta: '继续设置 →'
  },
  guide: {
    title: '先走通这三步',
    subtitle: '把 Provider、路由和 API Key 配好后发起一条请求，仪表盘就会开始有数据。',
    startWizard: '开始引导设置',
    step1Title: '先配置 Provider',
    step1Desc: '先在模型供应商里接入至少 1 个上游模型服务。',
    step1DescDone: '当前已检测到 {{count}} 个 Provider，可直接继续下一步。',
    step1Cta: '去模型与路由',
    step2Title: '确认默认路由入口',
    step2Desc: '把一个端点或默认路由配置清楚，后续客户端就能稳定接入。',
    step2DescDone: '当前已有 {{count}} 个自定义端点，可继续检查默认映射是否合理。',
    step2Cta: '去模型与路由',
    step3Title: '发起第一条真实请求',
    step3Desc: '创建 API Key，然后从常用客户端打进来一条请求，让日志、路由和延迟开始有数据。',
    step3Cta: '去 API 密钥'
  },
  modelTable: {
    title: '模型性能摘要',
    description: '统计每个后端模型的请求数、平均耗时、TTFT 与 TPOT。',
    empty: '暂无模型统计数据。',
    columns: {
      model: 'Provider/模型',
      requests: '请求数',
      latency: '平均耗时',
      ttft: 'TTFT',
      tpot: 'TPOT'
    }
  }
}
