# API Compatibility Matrix

本文档描述当前 Rust 后端对旧网关外部接口的兼容范围。目标不是逐行复刻旧实现，而是保证原 Web UI、CLI 和主要客户端请求可继续工作。

## 1. 公共与静态资源接口

| 路径 | 方法 | 状态 | 说明 |
| --- | --- | --- | --- |
| `/` | `GET` | 已兼容 | 重定向到 `/ui/` |
| `/ui` | `GET` | 已兼容 | 重定向到 `/ui/` |
| `/ui/` | `GET` | 已兼容 | 返回 Web UI 入口 |
| `/ui/{*path}` | `GET` | 已兼容 | Web UI 路由回退 |
| `/assets/{*path}` | `GET` | 已兼容 | 返回前端静态资源 |
| `/favicon.ico` | `GET` | 已兼容 | 若资源不存在返回 `204`，避免前端控制台噪音 |
| `/health` | `GET` | 已兼容 | 健康检查 |

## 2. Web Auth 与会话接口

| 路径 | 方法 | 状态 | 说明 |
| --- | --- | --- | --- |
| `/auth/session` | `GET` | 已兼容 | 读取当前登录态 |
| `/auth/login` | `POST` | 已兼容 | Web 管理台登录 |
| `/auth/logout` | `POST` | 已兼容 | Web 管理台退出登录 |
| `/api/auth/web` | `GET` | 已兼容 | 读取 Web Auth 配置 |
| `/api/auth/web` | `POST` | 已兼容 | 更新 Web Auth 配置 |

说明：

- `/api/*` 默认需要会话鉴权
- 公共路径、`OPTIONS` 和自定义 endpoint 代理请求不走这套鉴权

## 3. 管理台控制面接口

| 路径 | 方法 | 状态 | 说明 |
| --- | --- | --- | --- |
| `/api/status` | `GET` | 已兼容 | 返回端口、主机、runtime、PID、活跃请求数等 |
| `/api/config` | `GET` | 已兼容 | 读取主配置 |
| `/api/config` | `PUT` | 已兼容 | 更新主配置 |
| `/api/config/info` | `GET` | 已兼容 | 返回配置和配置文件路径 |
| `/api/providers` | `GET` | 已兼容 | 列出 Provider |
| `/api/providers/{id}/test` | `POST` | 已兼容 | 测试 Provider 连通性 |
| `/api/custom-endpoints` | `GET` | 已兼容 | 获取自定义端点列表 |
| `/api/custom-endpoints` | `POST` | 已兼容 | 创建自定义端点 |
| `/api/custom-endpoints/{id}` | `PUT` | 已兼容 | 更新自定义端点 |
| `/api/custom-endpoints/{id}` | `DELETE` | 已兼容 | 删除自定义端点 |
| `/api/routing-presets/{endpoint}` | `POST` | 已兼容 | 保存路由预设 |
| `/api/routing-presets/{endpoint}/apply` | `POST` | 已兼容 | 应用路由预设 |
| `/api/routing-presets/{endpoint}/{name}` | `DELETE` | 已兼容 | 删除路由预设 |
| `/api/events` | `GET` | 已兼容 | 查询事件列表 |
| `/api/logs` | `GET` | 已兼容 | 查询请求日志 |
| `/api/logs/{id}` | `GET` | 已兼容 | 查询单条日志详情 |
| `/api/logs/export` | `POST` | 已兼容 | 导出日志 |
| `/api/logs/cleanup` | `POST` | 已兼容 | 清理旧日志 |
| `/api/logs/clear` | `POST` | 已兼容 | 清空日志与部分统计 |
| `/api/db/info` | `GET` | 已兼容 | 返回数据库体积、记录数、RSS 内存等 |
| `/api/db/compact` | `POST` | 已兼容 | 执行数据库压缩 |
| `/api/stats/overview` | `GET` | 已兼容 | 总体统计 |
| `/api/stats/daily` | `GET` | 已兼容 | 每日统计 |
| `/api/stats/model` | `GET` | 已兼容 | 模型维度统计 |
| `/api/stats/api-keys/overview` | `GET` | 已兼容 | API Key 总览统计 |
| `/api/stats/api-keys/usage` | `GET` | 已兼容 | API Key 使用排名 |

## 4. API Key 管理接口

| 路径 | 方法 | 状态 | 说明 |
| --- | --- | --- | --- |
| `/api/keys` | `GET` | 已兼容 | 列表查询 |
| `/api/keys` | `POST` | 已兼容 | 创建 API Key |
| `/api/keys/{id}` | `PATCH` | 已兼容 | 更新启用状态、描述、端点权限等 |
| `/api/keys/{id}` | `DELETE` | 已兼容 | 删除 API Key |
| `/api/keys/{id}/reveal` | `GET` | 已兼容 | 返回解密后的 Key 展示值 |

兼容细节：

- 兼容旧 `key_ciphertext`
- 兼容旧时间戳字段使用 `TEXT` 存储的历史数据
- 保留 wildcard key 语义

## 5. 事件上报接口

| 路径 | 方法 | 状态 | 说明 |
| --- | --- | --- | --- |
| `/anthropic/api/event_logging/batch` | `POST` | 已兼容 | 兼容旧事件批量上报路径 |

## 6. Anthropic 风格数据平面接口

| 路径 | 方法 | 状态 | 说明 |
| --- | --- | --- | --- |
| `/v1/messages` | `POST` | 已兼容 | Anthropic 主消息接口 |
| `/anthropic/v1/messages` | `POST` | 已兼容 | 旧别名路径 |
| `/anthropic/v1/v1/messages` | `POST` | 已兼容 | 历史兼容别名 |
| `/v1/messages/count_tokens` | `POST` | 已兼容 | Token 计数 |
| `/anthropic/v1/messages/count_tokens` | `POST` | 已兼容 | 旧别名路径 |
| `/anthropic/v1/v1/messages/count_tokens` | `POST` | 已兼容 | 历史兼容别名 |

能力范围：

- Anthropic 请求可直接转发到 Anthropic Provider
- 也可根据路由转成 OpenAI Chat / OpenAI Responses 请求
- 支持非流式和流式返回

## 7. OpenAI 风格数据平面接口

| 路径 | 方法 | 状态 | 说明 |
| --- | --- | --- | --- |
| `/openai/v1/models` | `GET` | 已兼容 | 模型列表 |
| `/openai/models` | `GET` | 已兼容 | 旧别名路径 |
| `/openai/v1/chat/completions` | `POST` | 已兼容 | Chat Completions |
| `/openai/chat/completions` | `POST` | 已兼容 | 旧别名路径 |
| `/openai/v1/responses` | `POST` | 已兼容 | Responses API |
| `/openai/responses` | `POST` | 已兼容 | 旧别名路径 |

能力范围：

- OpenAI Chat 请求可转为 Anthropic 请求
- OpenAI Responses 请求可转为 Anthropic 请求
- 支持流式输出兼容转换

## 8. 自定义端点兼容

Rust 后端支持配置自定义端点，并按路径动态代理。

兼容点：

- 可按 endpoint 前缀挂载
- 能匹配 Anthropic / OpenAI 风格子路径
- 自定义 endpoint 请求会进入日志、API Key 权限和统计体系

## 9. 兼容性边界

当前兼容目标主要覆盖：

- 原 Web UI 正常运行
- CLI 正常启动和管理进程
- 旧本地数据库和配置可直接复用
- 主流 Anthropic/OpenAI 客户端请求可以继续通过

不承诺的范围：

- 与旧 Node.js 后端逐字节完全一致的错误消息
- 所有边缘流式事件顺序与字段完全一致
- 面向公网部署场景下的强安全兼容

## 10. 验证方式

当前兼容性主要通过下面几类验证：

- Rust 单元与集成测试
- `pnpm smoke:cli`
- Playwright Web UI E2E
- 真实旧数据库样本回归验证
