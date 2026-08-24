export default {
  title: '模型提供商',
  description: '管理集成的模型服务，查看默认模型及支持能力。',
  emptyState: '暂无 Provider，请点击“新增提供商”以开始配置。',
  emptyStateSub: '点击上方按钮添加您的第一个提供商。',
  emptyFiltered: '当前筛选条件下没有匹配的 Provider。',
  count: '已配置：{{count}} 个 Provider',
  groupCount: '{{count}} 个提供商',
  filters: {
    searchPlaceholder: '按名称、ID 或 Base URL 搜索',
    typeAll: '全部类型'
  },
  list: {
    sortLabel: '排序方式',
    sortUsage: '按用量',
    sortName: '按名称',
    requests7d: '近 7 天 {{count}} 次请求',
    testOk: '最近一次测试成功',
    testFailed: '最近一次测试失败',
    untested: '未测试'
  },
  table: {
    status: '状态',
    name: '名称',
    type: '类型',
    baseUrl: 'Base URL',
    models: '模型数',
    defaultModel: '默认模型',
    requests7d: '近 7 天请求',
    viewDetail: '查看详情'
  },
  status: {
    ready: '已就绪',
    needsDefault: '待设默认模型'
  },
  toast: {
    createSuccess: '已添加 Provider：{{name}}',
    updateSuccess: '已更新 Provider：{{name}}',
    testSuccess: 'Provider 连通性检查通过。',
    testSuccessDesc: '状态：{{status}} · 耗时：{{duration}}',
    testFailure: 'Provider 连通性检查失败：{{message}}',
    loadFailure: '获取配置失败：{{message}}',
    deleteSuccess: '已删除 Provider：{{name}}',
    deleteFailure: '删除 Provider 失败：{{message}}'
  },
  actions: {
    add: '新增提供商',
    refresh: '刷新',
    refreshing: '刷新中...',
    edit: '编辑',
    delete: '删除',
    test: '测试连接'
  },
  quickAddHuawei: {
    button: '一键添加华为云模型',
    title: '一键添加华为云模型',
    description: '输入 API Key 即可快速添加华为云 DeepSeek V3.1、KIMI-K2 与 Qwen3-235B-A22B 模型。',
    apiKeyLabel: 'API Key',
    apiKeyPlaceholder: '请输入华为云 API Key',
    note: '完成后可在提供商列表中查看并进一步调整配置。',
    submit: '添加',
    providerLabel: '华为云',
    validation: {
      apiKey: '请填写 API Key'
    },
    toast: {
      success: '已添加华为云模型',
      added: '已添加 {{name}}',
      failure: '添加失败，请稍后重试'
    }
  },
  testDialog: {
    title: '连接测试选项',
    subtitle: '针对 {{name}} 的测试请求',
    description: '部分 Claude 兼容服务需要额外 Header 才能通过诊断。请选择需要附加的 Header，不勾选则保持最简请求。',
    headerValue: 'Header 值：{{value}}',
    presetLabel: '模拟 Claude Code 请求（推荐）',
    presetDescription: '附加 Claude CLI 常用的 Header（anthropic-beta、x-app、user-agent 等）以提升兼容性。',
    presetPreviewSummary: '查看将附加的 Header 列表',
    preservedInfo: '以下 Header 将自动附加（来自当前配置）：',
    cancel: '取消',
    primary: '开始测试',
    options: {
      beta: {
        label: '`anthropic-beta` 头',
        description: '启用 Claude Code 的实验特性（如工具流式）；fox code_cc 等服务通常要求此头。'
      },
      browser: {
        label: '`anthropic-dangerous-direct-browser-access` 头',
        description: '标记请求来自受信客户端，Claude Code 默认会携带此头。'
      },
      xApp: {
        label: '`x-app` 头',
        description: '标识请求来源，Claude CLI 默认发送为 cli。'
      },
      userAgent: {
        label: '`user-agent` 头',
        description: '模拟 Claude CLI 的 User-Agent 值。'
      },
      accept: {
        label: '`accept` 头',
        description: '声明客户端接受 JSON 响应格式。'
      },
      acceptLanguage: {
        label: '`accept-language` 头',
        description: '兼容要求语言信息的服务。'
      },
      secFetchMode: {
        label: '`sec-fetch-mode` 头',
        description: '与浏览器/CLI 保持一致的访问信息。'
      },
      acceptEncoding: {
        label: '`accept-encoding` 头',
        description: '允许 gzip/deflate 压缩响应内容。'
      },
      stainlessHelper: {
        label: '`x-stainless-helper-method` 头',
        description: '表明请求使用 Claude CLI 的 stream helper。'
      },
      stainlessRetry: {
        label: '`x-stainless-retry-count` 头',
        description: 'Claude CLI 当前的重试计数。'
      },
      stainlessTimeout: {
        label: '`x-stainless-timeout` 头',
        description: 'Claude CLI 设定的超时时间（秒）。'
      },
      stainlessLang: {
        label: '`x-stainless-lang` 头',
        description: 'Claude CLI 所使用的语言标识。'
      },
      stainlessPackage: {
        label: '`x-stainless-package-version` 头',
        description: 'Claude CLI 的包版本号。'
      },
      stainlessOs: {
        label: '`x-stainless-os` 头',
        description: '调用方所在的操作系统。'
      },
      stainlessArch: {
        label: '`x-stainless-arch` 头',
        description: '调用方 CPU 架构信息。'
      },
      stainlessRuntime: {
        label: '`x-stainless-runtime` 头',
        description: '运行时环境标识，例如 node。'
      },
      stainlessRuntimeVersion: {
        label: '`x-stainless-runtime-version` 头',
        description: '运行时环境的版本号。'
      }
    }
  },
  noModelDialog: {
    title: '未配置模型',
    subtitle: 'Provider「{{name}}」还没有可用于测试的模型',
    description: '连接测试需要先知道要请求哪个模型。请先为该 Provider 添加至少一个模型，或设置默认模型后再测试。',
    hint: '如果你只是想使用透传模式，也需要在实际请求或路由映射里指定模型；诊断测试不能自动猜测上游模型 ID。',
    primary: '去配置模型'
  },
  card: {
    baseUrl: 'Base URL',
    defaultModelLabel: '默认模型',
    defaultModel: '默认模型：{{model}}',
    noDefault: '未设置默认模型',
    modelsTitle: '支持模型',
    noModels: '尚未配置模型。',
    authMode: '认证方式',
    providerDefault: 'Provider 默认',
    modelCount: '{{count}} 个模型',
    passthrough: '透传模式',
    statModels: '模型',
    statRequests24h: '24h 请求',
    statAvgLatency: '平均延迟',
    routeCount: '被 {{count}} 条路由规则引用',
    health: { ok: '正常', fail: '异常', untested: '未测' }
  },
  aggregate: {
    typeLabel: '聚合',
    card: {
      statAggregateModels: '聚合模型',
      statMembers: '成员后端',
      allHealthy: '成员后端均正常',
      coolingBadge: '已降级 · {{minutes}} 分钟后重试',
      degradedBadge: '连续失败 {{count}} 次',
      noMembers: '尚未配置聚合模型'
    },
    drawer: {
      typeHint: '虚拟供应商 · 多后端自动降级',
      explainerTitle: '聚合供应商说明',
      explainerBody: '聚合供应商没有自己的上游地址与密钥。它旗下的每个「聚合模型」是一个虚拟模型名，映射到一组真实后端（可跨供应商、跨模型名）。请求按成员顺序尝试：高优先级后端连续失败后自动切换到低优先级，冷却期满自动恢复。',
      stepTitle: '聚合模型',
      modelsDescription: '每个聚合模型是对客户端暴露的虚拟模型名，由一组有序的真实后端成员组成。',
      modelIdLabel: '聚合模型 ID',
      modelIdPlaceholder: '如 glm-5.1',
      modelIdHint: '客户端请求中填写的模型名；路由规则可直接映射到 聚合供应商:模型ID。',
      membersTitle: '后端成员（按优先级）',
      memberTarget: '成员后端',
      memberPlaceholder: '选择 providerId:modelId',
      memberEmptyHint: '尚未添加成员。请从下方选择至少一个真实后端模型。',
      memberHint: '拖动手柄调整优先级（自上而下依次尝试）；支持手填 providerId:* 表示该供应商的同名模型。',
      addMember: '添加成员',
      primaryBadge: '首选',
      failoverTitle: '降级策略（高级）',
      consecutiveFailures: '连续失败阈值',
      consecutiveFailuresHint: '默认 3',
      cooldownSeconds: '冷却时间（秒）',
      cooldownSecondsHint: '默认 900',
      failureWindowSeconds: '失败统计窗口（秒）',
      failureWindowSecondsHint: '默认 600',
      triggerStatusCodes: '触发降级的状态码',
      triggerStatusCodesHint: '默认 429, 5xx；网络错误始终触发',
      defaultsHint: '留空表示使用默认值。配额耗尽场景建议把冷却时间调大（最长 86400 秒 = 24 小时）。',
      noModelsTitle: '尚未配置聚合模型',
      noModelsHint: '添加一个聚合模型（如 glm-5.1），再为它选择成员后端。',
      summaryMembers: '成员后端数',
      checkMembers: '每个聚合模型至少配置一个成员后端。',
      checkPriority: '成员顺序即降级优先级，首选排在最上。',
      checkFailover: '按需调整连续失败阈值与冷却时间。'
    },
    errors: {
      memberRequired: '每个聚合模型至少需要一个成员后端',
      memberInvalid: '成员格式必须为 providerId:modelId',
      memberDangling: '成员指向的供应商不存在：{{provider}}',
      memberNested: '成员不能指向聚合供应商：{{provider}}',
      memberDuplicate: '成员后端重复：{{target}}',
      failoverInvalid: '降级策略数值超出范围（阈值 ≥1，冷却 1-86400 秒，窗口 ≥1 秒）',
      triggerCodesInvalid: '触发状态码格式无效（支持 1xx-5xx 类别或 100-599 具体码，逗号分隔）'
    },
    simulator: {
      candidatesTitle: '降级候选链（按优先级）',
      primaryBadge: '首选'
    }
  },
  drawer: {
    createTitle: '新增 Provider',
    editTitle: '编辑 Provider',
    quickStart: '快速配置',
    description: '配置基础信息与模型列表。',
    formSummary: '当前草稿',
    modelsDescription: '维护支持的模型列表。',
    defaultHint: '当前默认模型：{{model}}',
    summary: {
      type: 'Provider 类型',
      auth: '认证方式',
      models: '模型数量',
      untitled: '未命名 Provider'
    },
    sections: {
      type: '选择 Provider 类型',
      basic: '填写基础信息',
      auth: '设置认证',
      checklist: '提交前检查'
    },
    steps: {
      basics: '基础与认证',
      modelsVerify: '模型与验证',
      aggregateModels: '聚合模型'
    },
    hints: {
      type: '先选择 Provider 模板，可自动填入推荐 Base URL。',
      basic: 'ID 用于路由映射；显示名称用于界面展示。',
      auth: '根据上游接口要求选择 Header 认证方式。',
      customProvider: '自定义兼容服务',
      checkUrl: '确认 Base URL 指向上游 API 根路径。',
      checkAuth: '确认密钥与认证 Header 类型匹配。',
      checkModels: '如需路由提示和默认模型，请补充模型列表。',
      advancedTitle: '高级模式说明',
      advancedBody: '开启后可单独维护显示名称与模型别名；如果只是快速接入，保留默认同步即可。'
    },
    fields: {
      id: 'Provider ID',
      idPlaceholder: '如 openai',
      label: '显示名称',
      labelPlaceholder: '如 官方主账号',
      baseUrl: 'Base URL',
      baseUrlPlaceholder: 'https://api.example.com/v1',
      type: 'Provider 类型',
      apiKey: 'API Key（可选）',
      apiKeyPlaceholder: '可留空以从环境变量读取',
      authMode: '认证方式',
      authModeHint: '选择 API 认证方式，填写对应的密钥值。',
      authModeApiKey: 'X-API-Key',
      authModeProviderDefault: 'Provider 默认',
      authModeAuthToken: 'Authorization: Bearer',
      authModeXAuthToken: 'X-Auth-Token',
      nonStreamViaStream: '非流式请求转上游流式',
      nonStreamViaStreamHint: '仅在客户端请求非流式时生效。网关向上游发送流式请求，读取完整 SSE 后一次性返回 JSON。',
      useAbsoluteUrl: '使用绝对路径',
      useAbsoluteUrlHint: '勾选后,Base URL 将原样作为上游请求地址(需填完整端点,如 https://x/internal/v1/messages),网关不再自动追加 /v1/messages、/v1/chat/completions 等后缀。协议(请求体格式)仍由 Provider 类型决定,互不影响。',
      streamUsage: '流式请求携带 usage 统计（默认关闭）',
      streamUsageHint: '⚠️ 兼容性风险：开启后网关会向上游附加 stream_options.include_usage 参数。部分 OpenAI 兼容模型服务不认识该参数，可能导致报错或流式返回为空。默认关闭；若开启后请求异常，请关闭此开关。多数上游本身就会返回 usage，无需开启。',
      models: '模型配置',
      showAdvanced: '显示高级选项',
      hideAdvanced: '隐藏高级选项',
      advancedOptions: '高级选项',
      addModel: '新增模型',
      modelId: '模型 ID',
      modelIdPlaceholder: '如 claude-sonnet-4-5-20250929',
      modelLabel: '显示名称（可选）',
      modelLabelPlaceholder: '如 GPT-4 旗舰',
      modelNonStreamViaStream: '非流式转流式',
      modelNonStreamViaStreamInherit: '使用 Provider 默认',
      modelNonStreamViaStreamEnabled: '启用',
      modelNonStreamViaStreamDisabled: '禁用',
      setDefault: '设为默认模型',
      removeModel: '删除模型',
      rpmLimitSection: 'RPM 限流（排队等待）',
      rpmLimitHint: '达到每分钟请求上限后,新请求会在网关排队等待空位再放行,避免上游 429 与客户端重试风暴;等待超过最长等待时间将返回 429 并附带 Retry-After。两项留空均表示不启用限流。',
      rpmLimit: '每分钟请求上限（RPM）',
      rpmLimitPlaceholder: '如 60',
      rpmMaxWaitSeconds: '最长等待（秒）',
      rpmMaxWaitPlaceholder: '默认 30',
      extraHeaders: '自定义请求头',
      extraHeadersHint: '附加到发往该 Provider 的上游请求,并覆盖客户端发送的同名头。认证类请求头(Authorization、x-api-key 等)由网关根据 API Key 统一设置,无法在此覆盖。',
      addHeader: '新增请求头',
      headerName: '名称',
      headerValue: '取值',
      headerNamePlaceholder: '如 X-App-Id',
      headerValuePlaceholder: '如 my-app',
      removeHeader: '删除'
    },
    probe: {
      button: '探测模型',
      needsBaseUrl: '请先填写 Base URL',
      title: '探测可用模型',
      subtitle: '从「{{name}}」的上游接口获取模型列表，勾选后导入。',
      loading: '正在向上游探测模型列表…',
      failedTitle: '探测失败',
      failedHint: '该供应商可能不支持模型列表接口，请手动添加模型。',
      failedFallback: '上游未返回可用的模型列表',
      searchPlaceholder: '搜索模型 ID 或名称',
      totalCount: '共 {{count}} 个模型',
      selectAll: '全选',
      clearSelection: '清空',
      selectedCount: '已选 {{count}} 个',
      emptyResult: '没有匹配的模型',
      imported: '已导入',
      importAction: '导入 {{count}} 个模型',
      importSuccess: '已导入 {{count}} 个模型'
    },
    errors: {
      idRequired: '请填写 Provider ID',
      idDuplicate: '该 Provider ID 已存在',
      baseUrlInvalid: 'Base URL 格式无效',
      modelsRequired: '请至少配置一个模型',
      modelInvalid: '模型 ID 不可为空或重复',
      defaultInvalid: '默认模型必须在模型列表中',
      headerNameInvalid: '请求头名称只能包含字母、数字及 - _ . * + 等字符(不可含空格或冒号)',
      headerNameDuplicate: '请求头名称不可重复',
      rpmLimitInvalid: 'RPM 上限须为 1 到 1000000 之间的整数',
      rpmMaxWaitInvalid: '最长等待须为 1 到 3600 之间的整数秒数'
    },
    toast: {
      saveFailure: '保存失败：{{message}}'
    },
    noModelsTitle: '透传模式已启用',
    noModelsHint: '当前未配置模型列表。该 Provider 将以"透传"模式使用，可在模型路由中映射，或在请求中直接指定模型。',
    routeExample: '路由映射示例：'
  },
  confirm: {
    delete: '确认删除 Provider「{{name}}」？',
    deleteImpact: '将同时清理 {{count}} 条引用该 Provider 的路由规则。'
  }
}
