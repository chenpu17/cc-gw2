export default {
  title: 'API 密钥管理',
  description: '创建和管理用于访问网关的 API 密钥',
  helper: '建议为不同客户端、环境或自动化任务使用独立密钥，便于回溯、限权和停用。',
  createNew: '创建新密钥',
  createAction: '创建',
  createDescription: '创建一个新的 API 密钥用于身份验证，可选填写密钥描述。',
  descriptionLabel: '密钥描述（可选）',
  keyDescriptionPlaceholder: '例如：仅供内部测试环境使用',
  keyNamePlaceholder: '输入密钥名称',
  keyCreated: 'API 密钥已创建',
  saveKeyWarning: '请妥善保管此密钥。您也可以随时通过密钥列表查看完整密钥。',
  wildcard: '通配符',
  wildcardHint: '启用该密钥后，任何自定义密钥与空密钥都可以通过认证；如需限制访问，可随时禁用该密钥。',
  status: {
    enabled: '已启用',
    disabled: '已禁用'
  },
  actions: {
    enable: '启用',
    disable: '禁用',
    delete: '删除',
    reveal: '显示完整密钥',
    hide: '隐藏密钥'
  },
  created: '创建时间',
  lastUsed: '最后使用',
  requestCount: '请求次数',
  totalTokens: '总令牌数',
  deleteDialogTitle: '删除 API 密钥',
  confirmDelete: '确定要删除此 API 密钥吗？此操作无法撤销。',
  errors: {
    nameRequired: '密钥名称不能为空'
  },
  analytics: {
    title: '密钥使用分析',
    description: '展示最近 {{days}} 天的密钥调用情况',
    range: {
      today: '今日',
      week: '近 7 天',
      month: '近 30 天'
    },
    cards: {
      total: '总密钥数',
      enabled: '启用密钥',
      active: '活跃密钥（{{days}} 天）'
    },
    charts: {
      requests: '按密钥的请求次数（Top 10）',
      tokens: '按密钥的 Token 消耗（Top 10）'
    },
    tokens: {
      input: '输入 Token',
      output: '输出 Token'
    },
    requestsSeries: '请求次数',
    empty: '所选时间范围内暂无统计数据。',
    emptyHint: '先创建并使用至少一个密钥，图表会在有真实流量后开始显示。',
    actions: {
      logs: '去请求日志'
    },
    unknownKey: '未知密钥'
  },
  quickStart: {
    title: '推荐使用方式',
    description: '先按客户端拆分密钥，再逐步收紧权限，可以显著降低排查成本。',
    create: {
      title: '按客户端分组',
      description: '例如为 Claude Code、Codex、CI 或测试环境分别创建独立密钥。'
    },
    restrict: {
      title: '按端点限制访问',
      description: '需要时只开放 Anthropic、OpenAI 或自定义接入点，避免误用。'
    },
    wildcard: {
      title: '谨慎使用通配密钥',
      description: '通配密钥适合临时兼容；生产环境更推荐关闭它并使用命名密钥。'
    }
  },
  list: {
    title: '密钥列表',
    emptyTitle: '先创建第一把 API 密钥',
    empty: '尚未创建 API 密钥，点击右上角按钮开始创建。',
    emptyFilteredTitle: '没有符合当前筛选条件的密钥',
    emptyFiltered: '当前筛选条件下没有匹配的 API 密钥。'
  },
  filters: {
    searchPlaceholder: '按名称、描述或端点搜索',
    all: '全部',
    enabled: '已启用',
    disabled: '已禁用'
  },
  summary: {
    totalCount: '密钥 {{count}}',
    wildcard: '通配符密钥：{{count}}',
    restricted: '受限密钥：{{count}}',
    unrestricted: '不限制端点：{{count}}'
  },
  views: {
    cards: '卡片视图',
    compact: '紧凑列表'
  },
  tabs: {
    inventory: '密钥',
    analytics: '用量'
  },
  table: {
    name: '密钥',
    access: '访问范围',
    actions: '操作',
    accessWildcard: '通配访问',
    accessOpen: '不限制端点'
  },
  toast: {
    keyCreated: 'API 密钥创建成功',
    keyUpdated: 'API 密钥已更新',
    keyDeleted: 'API 密钥已删除',
    keyCopied: '密钥已复制到剪贴板',
    createFailure: '创建失败：{{message}}',
    updateFailure: '更新失败：{{message}}',
    deleteFailure: '删除失败：{{message}}',
    revealFailure: '获取密钥失败',
    copyFailure: '复制失败'
  },
  allowedEndpoints: '允许的端点',
  allEndpoints: '全部端点（不限制）',
  editEndpoints: '编辑端点权限',
  endpointRestricted: '已限制端点',
  selectEndpoints: '选择此密钥可以访问的端点，不选择则允许访问全部端点。',
  maxConcurrency: '最大并发数',
  maxConcurrencyPlaceholder: '留空表示不限制',
  maxConcurrencyHelper: '设置此密钥同时请求的最大数量。留空或设为 0 表示不限制。'
}
