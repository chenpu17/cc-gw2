export default {
  title: '引导设置',
  description: '四步完成冷启动配置：接入提供商、配置路由、创建 API Key，再验证连通性。',
  steps: {
    provider: {
      navLabel: '添加提供商',
      title: '添加模型提供商',
      description: '接入一个上游模型服务，后续路由与客户端请求都会指向它。',
      existingTitle: '已有 {{count}} 个提供商',
      existingHint: '可以直接选用现有提供商进入下一步，也可以再添加一个。',
      chooseLabel: '本向导使用的提供商',
      addAnother: '再添加一个提供商',
      backToList: '返回现有提供商列表',
      saveAndContinue: '保存并继续'
    },
    routing: {
      navLabel: '配置路由',
      title: '配置默认路由',
      description: '为 Anthropic 端点添加一条路由，把客户端常见模型名指向新提供商的模型。',
      existingTitle: '当前 Anthropic 端点路由',
      existingHint: '已存在路由规则，确认无误后可直接进入下一步。',
      emptyHint: '还没有路由规则，保存下方默认路由后即可继续。',
      sourceLabel: '来源模型（客户端请求名）',
      sourceHint: '以后客户端换用新模型名，就到 模型与路由 → 路由 里加一条对应规则。',
      targetLabel: '目标（provider:model）',
      save: '保存路由',
      saving: '保存中...'
    },
    apiKey: {
      navLabel: '创建 API Key',
      title: '创建 API Key',
      description: '客户端使用这个 Key 访问网关，默认仅放行 Anthropic 端点。',
      create: '创建 Key',
      creating: '创建中...',
      createFailed: '创建 API Key 失败：{{message}}'
    },
    verify: {
      navLabel: '验证与完成',
      title: '验证与完成',
      description: '测试提供商连通性，然后用 baseUrl 和 Key 从客户端发出第一条请求。',
      noProvider: '未找到可用的提供商，请返回第一步。',
      testingProvider: '正在测试提供商「{{name}}」',
      envTitle: '从客户端发起第一条请求',
      envHint: '在客户端环境中设置以下变量（以 Claude Code 为例），然后发起一条请求：'
    }
  },
  actions: {
    finish: '完成'
  }
}
