export default {
  title: '自定义端点',
  description: '管理自定义 API 端点，支持多种协议类型。',
  createButton: '新增端点',
  createTitle: '创建端点',
  editTitle: '编辑端点',
  emptyTitle: '暂无自定义端点',
  emptyDescription: '点击"新增端点"按钮创建您的第一个自定义端点。',
  loadError: '加载端点列表失败',
  id: 'ID',
  path: '路径',
  disabled: '已禁用',
  hasRouting: '已配置路由',
  protocols: {
    anthropic: 'Anthropic 协议',
    'openai-chat': 'OpenAI Chat',
    'openai-responses': 'OpenAI Responses'
  },
  protocolHints: {
    anthropic: 'Anthropic Messages API 协议（/v1/messages）',
    'openai-chat': 'OpenAI Chat Completions API 协议（/v1/chat/completions）',
    'openai-responses': 'OpenAI Responses API 协议（/v1/responses）'
  },
  form: {
    id: '端点 ID',
    idPlaceholder: '如 custom-api',
    idHint: 'ID 创建后不可修改，用于内部标识。',
    label: '显示名称',
    labelPlaceholder: '如 我的自定义 API',
    path: '访问路径',
    pathPlaceholder: '如 /custom/api',
    pathHint: '路径需以 / 开头，修改后立即生效。',
    protocol: '协议类型',
    enabled: '启用此端点'
  },
  routing: {
    title: '路由配置（可选）',
    modelRoutes: '模型路由规则',
    addRoute: '添加规则',
    noRoutes: '暂无路由规则',
    sourceModelPlaceholder: '源模型（如 claude-3-5-sonnet-20241022）',
    targetPlaceholder: '目标（如 anthropic:claude-3-5-sonnet-20241022）',
    modelRoutesHint: '格式：源模型 → provider:model，支持通配符（如 gpt-* → openai:*）',
    defaults: '默认模型配置',
    defaultCompletion: '常规对话默认模型',
    defaultReasoning: '推理任务默认模型',
    defaultBackground: '后台任务默认模型',
    longContextThreshold: '长上下文阈值（tokens）',
    defaultPlaceholder: '如 anthropic:claude-3-5-sonnet-20241022'
  },
  createSuccess: '端点创建成功',
  createError: '创建失败：{{error}}',
  updateSuccess: '端点更新成功',
  updateError: '更新失败：{{error}}',
  deleteSuccess: '端点删除成功',
  deleteError: '删除失败：{{error}}',
  deleteConfirm: '确定要删除端点 "{{label}}" 吗？此操作无法撤销。',
  validationError: '请填写所有必填字段'
}
