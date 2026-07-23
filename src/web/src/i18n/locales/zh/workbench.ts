export default {
  title: '模型与路由工作台',
  description: '统一管理模型 Provider、端点路由规则与自定义端点。',
  viewSwitch: {
    label: '工作台视图',
    providers: '供应商',
    providersDesc: '管理上游模型服务',
    routing: '路由',
    routingDesc: '决定请求转发到哪个服务'
  },
  routingGuide: {
    flow: '客户端请求模型（如 claude-sonnet-4） → 匹配路由规则 → 转发到 Provider 的模型',
    hint: '客户端按模型名发请求，先匹配下方规则，未命中则走默认转发。'
  },
  defaults: {
    title: '默认转发',
    description: '没有命中下方规则的请求都会转发到这里。只有一个 Provider 时，通常只需要设置这一项就能跑通。',
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
  specific: {
    title: '指定模型走特定服务（可选）',
    description: '只有当客户端请求这些模型名时才命中，优先级高于默认转发。'
  },
  advanced: {
    title: '高级',
    wildcardHint: '规则支持 * 通配符，匹配度更高的优先。'
  },
  routing: {
    rulesTitle: '路由规则',
    sourceLabel: '客户端请求的模型',
    targetLabel: '转发到（Provider:模型）',
    emptyTitle: '还没有路由规则',
    emptyDescription: '客户端按模型名发起请求，在这里配置它应该转发给哪个 Provider 的模型。例如把 claude-sonnet-4 映射到你刚添加的 Provider；未列出的模型名走上方「默认转发」。',
    addFirst: '添加第一条规则'
  },
  detail: {
    routesTitle: '参与的路由规则',
    routesEmptyHint: '还没有路由规则引用它——客户端的请求还到不了这个 Provider。',
    addRuleCta: '去路由视图添加规则',
    viewRoute: '在路由视图中查看该规则'
  },
  list: {
    emptyHint: '先添加一个上游模型服务（如 Anthropic、OpenAI 或兼容端点），再去路由视图把客户端模型映射过去。'
  },
  endpoints: {
    create: '新建端点',
    editRoute: '路由',
    defaultUnset: '未设置',
    table: {
      name: '名称',
      protocol: '协议',
      paths: '路径',
      rules: '规则数',
      defaultTarget: '默认转发',
      status: '状态',
      actions: '操作'
    }
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
    verifyHint: '对已保存的 Provider 发起一次真实请求，确认认证与网络可用。',
    verifySaveFirst: '保存 Provider 后才能进行连接测试。',
    verifyRun: '测试连接'
  }
}
