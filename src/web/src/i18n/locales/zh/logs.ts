export default {
  title: '请求日志',
  description: '查看近期请求，支持筛选提供商、模型、成功状态及时间范围。',
  filtersTitle: '筛选条件',
  filtersDescription: '组合多种条件精准定位请求记录。',
  summary: {
    total: '记录总数：{{value}}'
  },
  filters: {
    provider: '提供商',
    providerAll: '全部提供商',
    endpoint: '请求端点',
    endpointAll: '全部端点',
    endpointAnthropic: 'anthropic',
    endpointOpenAI: 'openai',
    apiKey: 'API 密钥',
    apiKeyHint: '可多选，不选择时将展示全部密钥。',
    modelId: '模型 ID',
    modelPlaceholder: '如 deepseek-chat',
    clientKind: '客户端',
    clientKindAll: '全部客户端',
    session: '会话 ID',
    sessionPlaceholder: '粘贴完整会话 ID，精确匹配',
    status: '状态',
    statusAll: '全部',
    statusSuccess: '成功',
    statusError: '失败',
    startDate: '起始日期',
    endDate: '结束日期',
    apiKeyAll: '全部密钥',
    apiKeySelected: '{{count}} 个已选'
  },
  actions: {
    columns: '列设置',
    manualRefresh: '手动刷新',
    autoRefresh: '自动刷新',
    refreshing: '刷新中...',
    export: '导出 ZIP 日志',
    exporting: '导出中...',
    detail: '详情'
  },
  quickViews: {
    all: '全部流量',
    errors: '仅看失败',
    today: '今天',
    anthropic: 'Anthropic',
    openai: 'OpenAI'
  },
  table: {
    loading: '正在加载日志...',
    empty: '未找到符合条件的日志记录。',
    density: {
      comfortable: '标准',
      compact: '紧凑'
    },
    requestedModelFallback: '未指定',
    apiKeyUnknown: '未知密钥',
    tokensNoUsage: '上游未返回 usage',
    costUnpricedHint: '未计价：该模型未匹配到价格',
    visibleColumns: '已显示 {{count}} 列',
    autoHiddenColumns: '窄屏已隐藏 {{count}} 列',
    autoHiddenHint: '窗口较窄，已自动隐藏：{{columns}}',
    autoHiddenNote: '窗口过窄时，部分次要列会自动隐藏。',
    narrowHiddenPill: '窄屏隐藏',
    columns: {
      time: '时间',
      endpoint: '端点',
      provider: '提供商',
      client: '客户端',
      requestedModel: '请求模型',
      routedModel: '路由模型',
      apiKey: '密钥',
      tokens: 'Tokens',
      cost: '成本',
      duration: '耗时',
      tokenIn: '输入',
      tokenOut: '输出',
      tokenInShort: '入',
      tokenOutShort: '出',
      tokenCache: '缓存',
      tokenCacheRead: '缓存读',
      tokenCacheWrite: '缓存写',
      tokenCacheReadShort: '读',
      tokenCacheWriteShort: '写',
      latencyTtft: 'TTFT',
      latencyTpot: 'TPOT',
      status: '状态',
      error: '错误信息',
      actions: '操作'
    },
    pagination: {
      perPage: '每页',
      unit: '条',
      previous: '上一页',
      next: '下一页',
      pageLabel: '第 {{page}} / {{total}} 页'
    }
  },
  empty: {
    title: '日志还没有开始积累',
    subtitle: '发起一条真实请求后，这里会开始显示路由结果、耗时和状态。',
    filteredTitle: '当前筛选条件下没有匹配记录',
    filteredSubtitle: '可以重置筛选条件，或放宽时间范围、端点和状态。',
    actions: {
      reset: '重置筛选',
      apiKeys: '去 API 密钥'
    }
  },
  endpointAnthropic: 'anthropic',
  endpointOpenAI: 'openai',
  toast: {
    listError: {
      title: '日志获取失败',
      desc: '错误信息：{{message}}'
    },
    providerError: {
      title: '提供商列表获取失败',
      desc: '错误信息：{{message}}'
    },
    exportSuccess: {
      title: '导出完成',
      desc: 'ZIP 压缩包已开始下载，包内包含 `logs.json`。'
    },
    exportError: {
      title: '导出失败',
      desc: '错误信息：{{message}}'
    }
  },
  stream: {
    streaming: '流式',
    single: '单次'
  },
  detail: {
    title: '日志详情',
    id: 'ID #{{id}}',
    infoSection: '基本信息',
    info: {
      time: '时间',
      sessionId: 'Session ID',
      endpoint: '端点',
      provider: '提供商',
      client: '客户端',
      userAgent: 'User-Agent',
      requestedModel: '请求模型',
      noRequestedModel: '未指定',
      model: '路由模型',
      latency: '耗时',
      status: '状态',
      inputTokens: '输入 Tokens',
      cacheReadTokens: '缓存读取',
      cacheCreationTokens: '缓存写入',
      outputTokens: '输出 Tokens',
      ttft: 'TTFT (首 Token 耗时)',
      tpot: 'TPOT (平均 ms/Token)',
      error: '错误信息',
      errorSource: '错误来源',
      cost: '成本'
    },
    errorSource: {
      none: '无',
      client: '客户端中断',
      gateway: '网关错误',
      upstream: '后端服务错误',
      unknown: '未分类'
    },
    errorDetail: {
      title: '详细信息',
      attemptsCount: '{{count}} 次故障转移尝试',
      upstreamBody: '上游响应体（截断）',
      attemptBackend: '后端',
      attemptOutcome: '结果',
      attemptStatus: '状态码',
      attemptLatency: '耗时',
      stages: {
        transport: '传输失败',
        upstream: '上游错误',
        gateway: '网关错误'
      }
    },
    summary: {
      route: '{{from}} → {{to}}'
    },
    payload: {
      title: 'Payloads',
      helperWithUpstream: '客户端与上游链路内容已分开展示。',
      helperClientOnly: '当前请求未发生额外链路改写，仅展示客户端侧内容。',
      clientRequest: '客户端请求体',
      upstreamRequest: '上游请求体',
      upstreamResponse: '上游响应体',
      clientResponse: '客户端响应体',
      emptyRequest: '暂无请求内容',
      emptyResponse: '暂无响应内容',
      truncated: '仅显示前 {{shown}} / {{total}} 个字符。复制按钮仍会复制完整内容。'
    },
    apiKey: {
      title: '密钥信息',
      name: '密钥名称',
      identifier: '密钥 ID',
      masked: '掩码展示',
      maskedUnavailable: '暂无掩码信息',
      raw: '原始密钥',
      rawUnavailable: '未记录原始密钥',
      rawMasked: '原始密钥（已脱敏）',
      rawMaskedHint: '出于安全考虑，仅展示部分前后缀。如需完整值，请在上游服务中重新生成。',
      missing: '未记录',
      lastUsed: '最后使用'
    },
    copy: {
      requestSuccess: '请求体已复制到剪贴板。',
      responseSuccess: '响应体已复制到剪贴板。',
      keySuccess: 'API 密钥已复制到剪贴板。',
      empty: '{{label}}为空，无法复制。',
      failure: '复制失败',
      failureFallback: '无法复制内容，请稍后再试。'
    },
    trace: {
      title: '请求链路',
      arrived: '客户端请求到达',
      ttft: '上游首 Token (TTFT)',
      complete: '请求完成',
      pending: '请求处理中…',
      streamOn: 'stream',
      streamOff: 'single',
      tpot: 'TPOT',
      degraded: '未记录逐步耗时，按总耗时与 TTFT 推算。'
    },
    inline: {
      copyRequest: '复制请求体',
      copySession: '复制 Session ID',
      viewRule: '查看命中规则',
      sessionCopied: 'Session ID 已复制到剪贴板。',
      expand: '展开行内预览',
      collapse: '收起行内预览'
    },
    loadError: '无法加载日志详情。',
    tokensNoUsageHint: '上游未返回 usage，token 数未知（非 0）。',
    cost: {
      title: '成本',
      input: '成本·输入',
      output: '成本·输出',
      cacheRead: '成本·缓存读',
      cacheCreation: '成本·缓存写',
      unpricedHint: '该请求的模型未匹配到价格（显示 —）。可在 设置 → 计费 中添加价格覆盖。'
    }
  }
}
