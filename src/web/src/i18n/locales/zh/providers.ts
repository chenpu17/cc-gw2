export default {
  title: '模型提供商',
  description: '管理集成的模型服务，查看默认模型及支持能力。',
  emptyState: '暂无 Provider，请点击“新增提供商”以开始配置。',
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
    passthrough: '透传模式'
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
      modelsVerify: '模型与验证'
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
      removeModel: '删除模型'
    },
    errors: {
      idRequired: '请填写 Provider ID',
      idDuplicate: '该 Provider ID 已存在',
      baseUrlInvalid: 'Base URL 格式无效',
      modelsRequired: '请至少配置一个模型',
      modelInvalid: '模型 ID 不可为空或重复',
      defaultInvalid: '默认模型必须在模型列表中'
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
