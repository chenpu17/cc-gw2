export default {
  title: '设置',
  description: '调整网关端口、日志策略及其他运行参数。',
  toast: {
    loadFailure: '配置加载失败：{{message}}',
    saveSuccess: '系统配置已更新。',
    saveFailure: '保存失败：{{message}}',
    protocolRestartRequired: '配置已保存！请执行 cc-gw restart --daemon 重启服务使协议配置生效',
    copySuccess: '配置文件路径已复制到剪贴板。',
    copyFailure: '复制失败：{{message}}',
    cleanupSuccess: '已删除 {{count}} 条历史日志。',
    cleanupNone: '没有需要删除的日志。',
    cleanupFailure: '清理失败：{{message}}',
    clearAllSuccess: '日志已清空（请求 {{logs}} 条，统计 {{metrics}} 条）。',
    clearAllFailure: '清空失败：{{message}}',
    missingConfig: '未能加载配置，请刷新或稍后再试。',
    authLoadFailure: '安全配置加载失败：{{message}}'
  },
  sections: {
    basics: '基础配置',
    routing: '模型路由',
    configFile: '配置文件',
    cleanup: '日志清理',
    security: '访问安全',
    protocol: '协议配置',
    jump: '跳转到'
  },
  overview: {
    title: '当前运行概览',
    description: '先确认当前监听方式、访问保护和配置文件位置，再进入具体调优。',
    unsavedCount: '待保存 {{count}} 项',
    cards: {
      protocols: '协议入口',
      security: '控制台访问',
      configFile: '配置文件'
    },
    values: {
      authEnabled: '已启用登录保护',
      authDisabled: '未启用登录保护',
      httpOnly: '仅 HTTP',
      httpsOnly: '仅 HTTPS',
      httpAndHttps: 'HTTP + HTTPS'
    }
  },
  fields: {
    port: '监听端口',
    host: '监听地址（可选）',
    hostPlaceholder: '默认 127.0.0.1',
    retention: '日志保留天数',
    logExportTimeout: '日志导出超时 (秒)',
    logExportTimeoutHint: '默认 60 秒；导出量较大时可调高，范围 5-600 秒。',
    bodyLimit: '请求体大小上限 (MB)',
    bodyLimitHint: '默认 10 MB；如 Claude Code 的 /compact 遇到 413，可适当调大。',
    defaults: '默认模型配置',
    storeRequestPayloads: '保存请求内容',
    storeRequestPayloadsHint: '开启后会在日志数据库中保留客户端请求；如发生协议转换，也会额外保存发往上游的请求体。',
    storeResponsePayloads: '保存响应内容',
    storeResponsePayloadsHint: '开启后会保留客户端响应；如发生协议转换，也会保存上游原始响应。流式响应会整理为完整消息而不是 chunk 片段。',
    logLevel: '日志级别',
    logLevelOption: {
      fatal: '致命 (fatal)',
      error: '错误 (error)',
      warn: '警告 (warn)',
      info: '信息 (info)',
      debug: '调试 (debug)',
      trace: '跟踪 (trace)'
    },
    enableRoutingFallback: '启用模型回退策略',
    enableRoutingFallbackHint: '无匹配模型时自动落到首个可用模型。默认关闭，建议仅在明确需要时开启。'
  },
  auth: {
    description: '开启 Web UI 登录后，所有管理接口仅对已登录用户开放，模型代理端点仍保持兼容。',
    enable: '启用 Web UI 登录保护',
    enableHint: '推荐在多人共用或生产环境中开启，访问 /ui 与 /api/* 将需要先登录。',
    username: '登录用户名',
    usernamePlaceholder: '设置用于登录的用户名',
    password: '登录密码',
    passwordPlaceholder: '至少 6 位字符',
    confirmPassword: '确认密码',
    confirmPasswordPlaceholder: '再次输入登录密码',
    status: '当前状态',
    statusEnabled: '已启用登录保护',
    statusDisabled: '未启用登录保护',
    passwordHintRequired: '首次启用或修改用户名时必须设置新密码（不少于 6 位）。',
    passwordHintOptional: '如需更新密码可填写新值，留空则沿用旧密码。',
    actions: {
      save: '保存安全设置'
    },
    toast: {
      success: '安全设置已更新。',
      failure: '保存失败：{{message}}'
    },
    validation: {
      username: '请填写用户名',
      minLength: '密码至少需要 6 位字符',
      passwordRequired: '请设置登录密码',
      confirmMismatch: '两次输入的密码不一致'
    }
  },
  protocol: {
    description: '配置 HTTP 和 HTTPS 服务端口，默认同时启用两个协议',
    restartWarning: '⚠️ 修改协议配置后需要重启服务才能生效',
    restartHint: '保存配置后，请执行以下命令重启服务：',
    restartTip: '💡 提示：端口、协议启用状态、证书路径需要重启；Provider 和路由配置支持热加载无需重启',
    http: {
      enable: '启用 HTTP',
      hint: '标准 HTTP 协议，适用于本地开发和内网环境',
      port: 'HTTP 端口',
      host: 'HTTP 主机地址'
    },
    https: {
      enable: '启用 HTTPS',
      hint: 'HTTPS 加密协议',
      port: 'HTTPS 端口',
      host: 'HTTPS 主机地址',
      keyPath: '证书私钥路径',
      certPath: '证书文件路径',
      caPath: 'CA 证书路径 (可选)',
      warning: '⚠️ 关于 HTTPS 证书',
      invalidCert: '自签名证书无效：',
      invalidCertDetail: 'Claude Code 和大多数 AI 工具无法信任自签名证书，会导致连接失败。',
      recommended: '推荐方案：',
      recommendedDetail: '本地开发环境建议使用 HTTP 协议（127.0.0.1 本地访问非常安全）。',
      tip: '💡 如需 HTTPS，请使用受信任 CA（如 Let\'s Encrypt）签发的正式证书，或配置反向代理（如 Nginx/Caddy）处理 HTTPS。'
    }
  },
  validation: {
    port: '请输入 1-65535 之间的端口号',
    retention: '日志保留天数需为 1-365 之间的数字',
    logExportTimeout: '日志导出超时需在 5-600 秒之间',
    bodyLimit: '请求体大小需在 1-2048 MB 之间',
    protocolRequired: '至少需要启用 HTTP 或 HTTPS 协议',
    httpPort: 'HTTP 端口必须在 1-65535 之间',
    httpsPort: 'HTTPS 端口必须在 1-65535 之间',
    httpsCertificate: 'HTTPS 已启用但缺少证书路径，请手动配置受信任的证书',
    routePair: '请填写完整的来源模型与目标模型配置。',
    routeDuplicate: '模型 {{model}} 已存在映射，请勿重复配置。'
  },
  defaults: {
    completion: '对话：{{model}}',
    reasoning: '推理：{{model}}',
    background: '后台：{{model}}',
    none: '未设置默认模型'
  },
  routing: {
    title: '模型路由映射',
    description: '为 Claude Code 发起的模型请求指定实际 Provider 与模型 ID（如将 claude 系列映射至 Kimi）。如需禁用映射，可留空或移除。',
    titleByEndpoint: '{{endpoint}} 路由配置',
    descriptionByEndpoint: {
      anthropic: '当 Claude Code 通过 /anthropic 端点请求特定模型时，将根据此映射选择目标 Provider 与模型。',
      openai: '当 Codex 通过 /openai 端点请求特定模型时，将根据此映射选择目标 Provider 与模型。'
    },
    add: '新增映射',
    sourcePlaceholder: '如 claude-sonnet-4-5-20250929',
    targetPlaceholder: '如 kimi:kimi-k2-0905-preview',
    customTargetOption: '自定义目标…',
    providerPassthroughOption: '{{provider}} · 透传原始模型 (*)',
    remove: '移除',
    suggested: '常用 Anthropic 模型'
  },
  file: {
    description: '当前配置存储在本地文件，可通过编辑该文件进行离线修改。',
    unknown: '未知路径'
  },
  cleanup: {
    description: '立即清理早于当前保留天数的日志记录。',
    softLabel: '轻度操作',
    softTitle: '清理过期日志',
    softDescription: '仅删除超过保留天数的历史日志，适合日常维护。',
    confirmTitle: '清理历史日志',
    confirmDescription: '该操作会删除超过保留天数的历史日志，但不会影响当前较新的记录。',
    hardLabel: '高风险操作',
    hardTitle: '彻底清空日志',
    clearAllTitle: '彻底清空日志',
    clearAll: '彻底清空',
    clearingAll: '清空中...',
    confirmCleanup: '该操作会删除超过保留天数的历史日志，但不会影响当前较新的记录。',
    confirmClearAll: '此操作会删除全部请求日志和日统计数据，且无法恢复。',
    clearAllWarning: '该操作会删除所有日志记录及日统计数据，请谨慎操作。'
  }
}
