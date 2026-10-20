export default {
  routingTitle: '路由',
  routingDescription: '配置各端点的路由规则、默认转发与命中模拟。',
  templates: '模板',
  endpointSwitcher: {
    label: '端点',
    ruleCount: '{{count}} 条'
  },
  endpointRail: {
    title: '端点',
    subtitle: '每个端点一套独立规则',
    ruleCount: '{{count}} 条'
  },
  flow: {
    title: '请求流向',
    clientStep: '客户端模型',
    endpointStep: '端点',
    matchStep: '路由规则匹配',
    targetStep: '转发目标',
    fallbackNote: '未命中规则时走默认转发'
  },
  endpointConfig: {
    title: '端点配置'
  },
  hitSim: {
    title: '命中模拟',
    subtitle: '输入客户端模型名，实时预览会命中哪条规则',
    endpointLabel: '端点',
    modelPlaceholder: '如 claude-sonnet-4-5-20250929',
    thinking: '思考',
    anyModel: '（任意模型名）',
    empty: '输入模型名后会在此显示命中的路由',
    errorPrefix: '无法解析路由',
    reasonModelRoute: '命中模型路由规则',
    reasonModelRouteAlias: '命中模型路由规则（经别名展开）',
    reasonDirectMatch: '直接匹配提供商',
    reasonThinkingDefault: '命中思考默认',
    reasonCompletionDefault: '命中补全默认',
    reasonLongContext: '命中长上下文默认',
    longContextDetail: '估算约 {{estimate}} tokens，超过阈值 {{threshold}}',
    reasonFallback: '未命中规则 · 全局兜底',
    fallbackHint: '没有规则匹配该模型，将走全局兜底转发。'
  },
  defaults: {
    title: '默认转发',
    cardSubtitle: '没有命中规则的请求都会走这里',
    completionLabel: '转发目标（provider:model）',
    moreLabel: '更多默认设置',
    reasoningLabel: '思考模型（reasoning）',
    backgroundLabel: '长上下文模型（background）',
    thresholdLabel: '长上下文阈值（tokens）',
    targetPlaceholder: '如 openai:gpt-4o',
    save: '保存默认设置',
    saveSuccess: '默认转发已保存。',
    saveFailure: '默认转发保存失败：{{message}}'
  },
  routing: {
    rulesTitle: '路由规则',
    rulesSubtitle: '从上往下匹配，支持 * 通配符；拖动左侧手柄调整优先级',
    dragHandle: '拖动排序',
    sourceLabel: '客户端请求的模型',
    targetLabel: '转发到（provider:model）',
    emptyTitle: '还没有路由规则',
    emptyDescription: '客户端按模型名发起请求，在这里配置它应该转发给哪个提供商的模型。例如把 claude-sonnet-4 映射到你刚添加的提供商；未列出的模型名走上方「默认转发」。',
    addFirst: '添加第一条规则'
  },
  list: {
    emptyHint: '先添加一个上游模型服务（如 Anthropic、OpenAI 或兼容端点），再去「路由」页把客户端模型映射过去。'
  },
  endpoints: {
    create: '新建端点'
  },
  testResult: {
    title: '最近一次测试',
    success: '连接成功',
    failure: '连接失败',
    status: '状态 {{status}}',
    duration: '耗时 {{duration}}',
    never: '尚未测试'
  },
  drawer: {
    verifyTitle: '连接验证',
    verifyHint: '对当前配置发起一次真实请求，确认认证与网络可用（未保存的草稿也可测试）。',
    verifySaveFirst: '保存提供商后才能进行连接测试。',
    verifyRun: '测试连接'
  }
}
