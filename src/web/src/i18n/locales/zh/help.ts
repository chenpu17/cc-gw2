export default {
  title: '使用指南',
  intro: '完整的 cc-gw 配置和使用指南，帮助您从零开始搭建 AI 模型网关。',
  note: '所有配置变更都会实时生效。建议通过 Web UI 进行配置管理，CLI 主要用于服务启动和重启。',
  helper: '推荐顺序：先启动服务，再配置模型供应商和模型，验证连接，然后配置路由，按需创建 API 密钥，最后接入 Claude Code 或 Codex。',
  meta: {
    breadcrumb: '网关 / 使用指南',
    guides: '{{count}} 个指南',
    faqCount: '{{count}} 个问题',
    recommendedFlow: '推荐流程',
    claudeWorkflow: 'IDE / 桌面工作流',
    codexWorkflow: '终端工作流',
    tocTitle: '本页索引'
  },
  clientConfig: {
    title: '客户端配置指南',
    subtitle: '选择您的客户端工具，按照步骤进行配置'
  },
  advancedGuide: {
    title: '高级使用指南',
    subtitle: '日常使用技巧与最佳实践'
  },
  sections: {
    consoleTour: {
      title: '🧭 控制台导航',
      items: [
        '**仪表盘 / Dashboard**：实时查看请求量、Token 消耗、缓存命中率与响应耗时（TTFT / TPOT）。可按端点 (`/anthropic`、`/openai` 或自定义) 过滤。',
        '**请求日志 / Logs**：分页浏览每一次请求的元数据；详情抽屉按客户端 ↔ 上游分别展示 payload，便于排查协议改写问题。需要在"设置"开启"保存请求/响应内容"才能看到完整 payload。',
        '**模型供应商 / Models**：管理 Provider（上游接入信息：Base URL、认证、模型清单）。这是上游资源池，不直接对外暴露。',
        '**路由管理 / Routing**：把客户端请求的模型名映射到具体 `providerId:modelId`。每个端点（`/anthropic`、`/openai`、自定义）都有独立的路由空间，互不影响。',
        '**API 密钥 / API Keys**：为不同客户端、环境、自动化任务发放专属密钥，便于审计、限权和吊销。默认存在通配符密钥，启用即代表"任意密钥都允许"。',
        '**事件 / Events**：网关层面的系统事件流（启动、配置变更、安全告警等），供审计和故障回溯使用。',
        '**设置 / Settings**：调整端口、日志保留、payload 存储、清理策略、Web UI 登录保护等运行参数。'
      ]
    },
    configuration: {
      title: '🚀 基础配置流程',
      items: [
        '📦 **安装并启动服务**：运行 `npm install -g @chenpu17/cc-gw && cc-gw start --daemon --port 4100`，然后访问 http://127.0.0.1:4100/ui',
        '🔧 **配置模型供应商与模型**：在"模型供应商"页面添加至少一个 Provider，配置 Base URL、认证方式 / API Key，并在该 Provider 下添加至少一个模型或设置默认模型。Provider 只是上游资源池，真正对外接入还需要路由配置。',
        '✅ **测试供应商连接**：模型列表或默认模型配置完成后，使用"测试"按钮验证 Base URL、API Key 与模型是否可用。如果提示没有配置模型，请先在该 Provider 下新增模型。',
        '🔀 **配置模型路由**：进入"路由管理"，选择 `/anthropic`、`/openai` 或自定义接入点，把客户端请求的模型名映射到目标模型 `providerId:modelId`；如果希望透传客户端传入的模型名，可选择 `providerId:*`，保存后只影响当前端点。',
        '🔑 **生成网关 API Key（可选）**：在"API 密钥"页面创建 API Key，用于审计、区分客户端和后续吊销访问。默认情况下，所有请求都可以通过网关访问。'
      ]
    },
    claudeCodeConfig: {
      title: '⚡ Claude Code 配置',
      items: [
        '🎯 **设置环境变量**（推荐方式）：\n```bash\nexport ANTHROPIC_BASE_URL=http://127.0.0.1:4100/anthropic\nexport ANTHROPIC_API_KEY=sk-ant-oat01-8HEmUDacamV1...\n```\n写入 `~/.bashrc` 或 `~/.zshrc` 后执行 `source ~/.bashrc` / `source ~/.zshrc` 让变量生效。Claude Code 启动时会自动读取这两个变量并指向 cc-gw。',
        '💡 **API Key 怎么填**：如果在 cc-gw 里启用了 API Key 限制，使用你在"API 密钥"页面创建的密钥；如未启用（保留默认通配符密钥），可以填任意非空字符串，仅用于占位。',
        '✅ **快速验证**：\n```bash\nclaude "你好，请简短回应"\n```\n输出正常即代表配置成功，可在"请求日志"页看到对应记录；如果想观察完整的 Agent ↔ LLM ↔ Tools 交互时序，进入"性能分析"开启录制后再发起请求。'
      ]
    },
    codexConfig: {
      title: '🛠️ Codex CLI 配置',
      items: [
        '📝 **编辑配置文件**：\n在 `~/.codex/config.toml` 进行配置：\n```toml\nmodel = "gpt-5-codex"\nmodel_provider = "cc_gw"\nmodel_reasoning_effort = "high"\ndisable_response_storage = true\n\n[model_providers.cc_gw]\nname = "cc_gw"\nbase_url = "http://127.0.0.1:4100/openai/v1"\nwire_api = "responses"\nenv_key = "cc_gw_key"\n```',
        '🔑 **设置环境变量**：\n```bash\nexport cc_gw_key=sk-ant.....\n```\n写入 `~/.bashrc` 或 `~/.zshrc` 后执行 `source` 让变量生效。`env_key` 名称必须与 config.toml 中保持一致。',
        '✅ **验证配置**：\n```bash\ncodex status  # 检查连接状态\ncodex ask "你好，请介绍一下自己"  # 测试对话\ncodex chat  # 进入交互模式\n```\n输出正常即代表配置成功。'
      ]
    },
    usage: {
      title: '📊 日常使用指南',
      items: [
        '📈 **仪表盘监控**：实时查看请求量、Token 使用量、缓存命中率和响应时间（TTFT/TPOT）等关键指标，可按端点过滤。',
        '📋 **日志分析**：使用"请求日志"页面筛选和分析请求记录；详情抽屉会按客户端/上游链路分开展示 payload，便于定位协议改写问题。',
        '🔬 **会话级时序分析**：在"性能分析"页面点击"开始录制"，再让客户端发起请求，每个会话会被解析为 Agent–LLM–Tools 的时序图，可以直观看到工具调用顺序、TTFT 与单轮耗时。',
        '🔄 **模型路由管理**：在"路由管理"页面按端点维护模型映射规则。内置 `/anthropic` 和 `/openai` 是两个独立路由工作区，自定义接入点也拥有独立路由配置。',
        '🎛️ **系统配置**：在"设置"页面中调整日志保留策略、数据存储设置和运行参数。',
        '🔐 **安全配置**：启用 Web UI 登录保护，设置用户名密码，确保管理接口安全。'
      ]
    },
    tips: {
      title: '💡 高级技巧与最佳实践',
      items: [
        '📦 **环境变量管理**：推荐使用 direnv 管理环境变量，创建 .envrc 文件自动加载配置。',
        '🔌 **自定义接入点**：创建额外的 API 端点以支持不同的协议和独立路由配置。在"路由管理"页面可以创建和管理自定义接入点。\n\n**主要特性**：\n• 只需配置基础路径（如 `/my-endpoint`），系统会根据协议自动注册完整 API 路径\n• 支持 Anthropic 和 OpenAI 协议（Chat Completions / Responses API）\n• 每个端点可配置独立的模型路由规则\n• 一个端点可注册多个路径，支持多种协议\n\n**示例配置**：\n```json\n{\n  "id": "claude-api",\n  "label": "Claude 专用接入点",\n  "path": "/claude",\n  "protocol": "anthropic"\n}\n```\n配置后，客户端通过 `http://127.0.0.1:4100/claude/v1/messages` 访问（路径自动扩展）。',
        '🗃️ **数据备份**：定期备份 `~/.cc-gw/` 目录（包含 config.json、SQLite 数据库与日志）。',
        '🧹 **日志清理**：根据需要调整日志保留天数，或在"设置"页使用清理工具手动压缩数据库。',
        '🔍 **问题排查**：开启"保存请求内容 / 保存响应内容"后，可在日志详情里复制客户端与上游 payload，用于调试兼容性问题。',
        '⚡ **性能优化**：如无需排障，可关闭 payload 存储以减少磁盘占用与敏感数据落盘风险。',
        '🎯 **模型切换**：优先使用路由预设保存常用映射方案（例如"Claude 走 Anthropic"、"GPT 走 OpenAI 兼容供应商"），需要切换时在对应端点一键应用预设。',
        '📊 **监控告警**：结合 Dashboard 与"事件"页面，及时发现异常请求和系统级事件。'
      ]
    }
  },
  faq: {
    title: '❓ 常见问题解答',
    items: [
      {
        q: '如何解决 Claude Code 连接失败问题？',
        a: '1) 检查 cc-gw 服务状态：`cc-gw status`\n2) 验证环境变量：`echo $ANTHROPIC_BASE_URL`\n3) 确认 API Key 正确性\n4) 在"请求日志"中查看详细错误信息'
      },
      {
        q: '如何使用自定义接入点？',
        a: '在"路由管理"页面创建自定义接入点，配置基础路径（如 `/my-endpoint`）和协议类型。系统会自动根据协议注册完整的 API 路径。例如，配置 `/claude` + `anthropic` 协议后，客户端通过 `http://127.0.0.1:4100/claude/v1/messages` 访问。\n\n如果遇到 404 错误，检查：\n1) 端点是否已启用\n2) 客户端使用的是完整路径（包括协议子路径）\n3) 查看服务器日志确认路由是否注册成功'
      },
      {
        q: '模型供应商已经配置了，为什么测试提示没有模型？',
        a: '供应商配置只保存 Base URL 和认证信息，测试请求还需要明确模型。请在该 Provider 下新增至少一个模型，或设置默认模型后再测试。'
      },
      {
        q: '什么时候必须配置模型路由？',
        a: '当客户端请求的模型名与上游模型名不一致、需要按 `/anthropic` 与 `/openai` 分流、或不同客户端要走不同供应商时，需要在"路由管理"中配置映射。目标模型格式为 `providerId:modelId`，`providerId:*` 表示使用客户端原始模型名透传到该供应商。'
      },
      {
        q: '为什么没有缓存命中数据？',
        a: '需要上游 Provider 返回 `cached_tokens` 或 `input_tokens_details.cached_tokens` 字段。确认 Provider 支持缓存功能并已正确配置。'
      },
      {
        q: '如何配置多个客户端使用不同模型？',
        a: '推荐为不同客户端创建专用自定义接入点，并在每个端点维护独立路由规则；也可以让客户端使用不同的 Base URL 指向 `/anthropic`、`/openai` 或自定义端点。API Key 主要用于审计、区分来源和吊销访问，不单独承载路由规则。'
      },
      {
        q: '如何启用 Web UI 登录保护？',
        a: '进入"设置 → 安全"，开启登录保护并设置用户名和密码，保存后退出当前会话；下次访问 `/ui` 会要求登录。如未启用，控制台对所有访问者开放，建议在多人或公网部署场景下务必开启。'
      },
      {
        q: 'Codex CLI 如何连接到 cc-gw？',
        a: '配置 `~/.codex/config.toml` 文件，设置 `model_provider` 为 "cc_gw"，`base_url` 为 cc-gw 的 OpenAI 兼容端点，并设置相应的环境变量。具体见上文 Codex CLI 配置部分。'
      },
      {
        q: '如何备份和迁移配置？',
        a: '备份整个 `~/.cc-gw/` 目录，包含 config.json、数据库和日志文件。在新环境中恢复目录并重启服务即可。'
      },
      {
        q: 'Web UI 显示 404 错误怎么办？',
        a: '确认已执行 `pnpm --filter @cc-gw/web build`，或使用 npm 全局安装版本。检查服务启动日志中的静态资源路径。'
      }
    ]
  }
}
