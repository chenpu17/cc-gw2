# System Design

## 1. 背景与目标

`cc-gw` 的目标不是做一套全新的网关，而是把原有 Node.js 后端替换为 Rust 实现，同时尽量保持以下外部行为不变：

- Web UI 不改，继续由后端直接托管
- CLI 使用方式不改，继续通过 `cc-gw` 入口管理守护进程
- 配置路径、配置格式、SQLite 数据库路径和核心表结构不改
- 旧用户的 `~/.cc-gw` 目录可以直接复用
- 对 Anthropic/OpenAI 客户端暴露的 HTTP 接口尽量保持兼容

核心收益：

- 更低的常驻内存占用
- 更稳定的并发请求处理
- 减少 Node.js 运行时作为服务端依赖
- 继续保留 npm 安装体验

## 2. 设计原则

- 兼容优先：先复刻旧行为，再讨论新能力
- 单进程部署：默认以一个本地守护进程承载 API、Web UI 和管理接口
- 本地优先：配置、日志、SQLite 数据都落在用户本机目录
- 打包友好：最终用户通过 npm 安装即可使用，不要求本机具备 Rust 工具链
- 渐进迁移：CLI 和 Web UI 可以保留 Node/前端现有资产，后端逐步被 Rust 替换

## 3. 总体架构

系统由三层组成：

### 3.1 控制层

- Web 管理台
- Web Auth 登录态
- 配置管理
- Provider 测试
- API Key 管理
- 日志、事件和统计查询

控制层主要服务于浏览器管理台，接口集中在 `/api/*` 与 `/auth/*`。

### 3.2 数据层

- 配置文件：`~/.cc-gw/config.json`
- SQLite 数据库：`~/.cc-gw/data/gateway.db`
- 本地日志目录：`~/.cc-gw/logs`
- PID 文件：`~/.cc-gw/cc-gw.pid`

数据层承担持久化、兼容迁移、请求日志、事件记录和管理台状态查询。

### 3.3 数据平面

- Anthropic 接口：`/v1/messages`、`/v1/messages/count_tokens`
- OpenAI 接口：`/openai/v1/models`、`/openai/v1/chat/completions`、`/openai/v1/responses`
- 自定义端点代理
- 流式 SSE 转换和透传

数据平面负责请求鉴权、路由解析、协议转换、转发上游 Provider，以及记录请求生命周期数据。

## 4. 模块划分

### 4.1 `crates/cc-gw-server`

职责：

- 进程入口
- HTTP 路由注册
- Web 静态资源托管
- 会话鉴权中间件
- 请求级编排
- HTTP/HTTPS 监听

这是系统的接入层，负责把浏览器请求和 API 请求接到 Rust 服务内部。

### 4.2 `crates/cc-gw-core`

职责：

- 配置读写和默认值填充
- SQLite 初始化与兼容迁移
- Provider 代理和请求转发
- Anthropic / OpenAI 协议转换
- API Key 加解密、鉴权和统计
- 日志、事件、统计聚合
- SSE 观察与跨协议流式变换

这是系统的核心业务层。`cc-gw-server` 尽量只做 API 入口和请求组织，核心逻辑放在这里。

### 4.3 `src/cli`

职责：

- 保持旧 CLI 风格
- 启动、停止、重启、查看状态
- 解析预编译后端二进制位置
- 在本地开发场景下回退到 `cargo run`

CLI 仍然保留在 Node.js 中，原因是：

- 能继续复用 npm 分发模式
- 用户命令入口保持不变
- 与平台原生二进制的装配关系更灵活

### 4.4 `src/web`

职责：

- 原管理台前端
- 调用 `/api/*` 与 `/auth/*`
- 展示配置、Key、日志、统计和系统状态

当前策略是不改前端架构，只修复与 Rust 后端兼容相关的问题。

## 5. 核心运行流

## 5.1 启动流程

1. CLI 执行 `cc-gw start`
2. CLI 按优先级查找 Rust 后端二进制
3. 后端加载或初始化 `~/.cc-gw/config.json`
4. 后端初始化或迁移 SQLite 数据库
5. 后端挂载 Web UI、管理接口和代理接口
6. 后端根据配置启动 HTTP 或 HTTPS 监听

CLI 查找二进制的顺序：

1. 平台 native npm 子包
2. `CC_GW_SERVER_BIN`
3. 工作区 `bin/<platform>-<arch>/cc-gw-server`
4. 工作区 `target/release` 或 `target/debug`
5. `cargo run -p cc-gw-server --`

## 5.2 Web 管理链路

1. 浏览器访问 `/ui`
2. 后端返回静态资源
3. 前端通过 `/auth/login` 建立会话
4. 前端调用 `/api/*` 完成配置、Key、日志、统计等操作
5. 后端把配置写入 JSON，把运行数据写入 SQLite

## 5.3 代理请求链路

1. 客户端调用 `Anthropic` 或 `OpenAI` 风格接口
2. 后端解析 API Key，并校验允许访问的 endpoint
3. 根据配置和模型路由解析目标 Provider
4. 如果协议不一致，先做请求体转换
5. 请求转发到上游 Provider
6. 若为流式响应，边转发边观察 SSE 事件
7. 完成后写入日志、统计、usage、耗时和必要 payload

## 6. 兼容性设计

## 6.1 配置兼容

保持兼容的内容：

- 根目录仍是 `~/.cc-gw`
- 配置文件仍是 `config.json`
- 旧字段尽量继续识别
- 默认值在缺失时自动补齐

目标是用户升级到 Rust 版本后无需重新初始化配置。

## 6.2 SQLite 兼容

保持兼容的内容：

- 数据库位置不变
- 旧表继续沿用
- 启动时执行补列和兼容迁移
- 旧时间戳字段格式允许继续读取

当前实现显式处理了历史数据中的类型差异，例如 `TEXT` 时间戳和老字段缺失场景。

## 6.3 密钥与鉴权兼容

保持兼容的内容：

- 旧 `encryption.key` 可继续使用
- 旧 `api_keys.key_ciphertext` 可继续解密
- 旧 Web Auth 的 `scrypt` 密码格式可继续验证

这样可以避免用户因为后端换语言而重建管理台账号或 API Key。

## 6.4 HTTP 接口兼容

兼容重点：

- `/ui`、`/ui/`、`/assets/*` 和 `/favicon.ico`
- `/api/*` 管理接口
- `/auth/*` 会话接口
- `/v1/*` Anthropic 风格接口
- `/openai/v1/*` OpenAI 风格接口
- 旧事件上报接口和日志导出/清理接口

兼容策略不是逐字节复刻，而是优先保证现有前端和 CLI 可正常工作，且旧客户端请求能被接受。

## 7. 数据与存储设计

SQLite 主要承担以下职责：

- API Key 元数据与密文
- 请求日志和请求/响应 payload
- 事件记录
- 每日统计和模型统计
- API Key 使用统计

设计考虑：

- 管理台查询远多于写入，因此以简单表结构和直接查询为主
- 单机场景下 SQLite 足够，减少部署复杂度
- 使用 `rusqlite bundled` 规避宿主机 SQLite 版本依赖

更细的本地目录和表结构说明见 [`database-schema.md`](./database-schema.md)。

## 8. 流式响应设计

流式链路是兼容性最敏感的部分，当前设计分成两层：

- `SseStreamObserver`
  - 观察上游 SSE，提取 usage、结束原因、耗时、payload 统计信息
- `CrossProtocolStreamTransformer`
  - 在 Anthropic / OpenAI 协议之间做增量事件转换

设计目标：

- 尽量保持前端和客户端对流式事件的消费方式不变
- 即便上游协议不同，也能对外暴露近似旧版本的事件流
- 在不阻塞转发的前提下补齐日志和统计信息

## 9. 安全边界

当前系统的安全模型偏向本地网关场景：

- Web 管理接口默认依赖本地会话认证
- API 调用依赖 `x-api-key`
- 敏感密钥以本地加密形式存储
- HTTP 默认监听本地地址

这不是一个面向公网多租户的强隔离架构。若未来面向远程部署，需要额外补：

- 更强的认证和授权模型
- 更严格的 CORS、CSRF、session 生命周期控制
- 更清晰的审计日志与失败告警

## 10. 打包与发布设计

目标是兼顾两件事：

- 用户继续通过 npm 安装 `cc-gw`
- 真正承担服务工作的后端是平台原生 Rust 二进制

发布结构：

- 根包：CLI + Web 静态资源
- 平台包：各平台 `cc-gw-server` 原生二进制

目标平台：

- macOS arm64
- Linux x64
- Linux arm64
- Windows ia32

关键策略：

- Linux 使用 `musl`
- Windows 使用静态 CRT
- 根包通过 `optionalDependencies` 装配平台包

## 11. 测试与验证

当前验证方式分三层：

### 11.1 Rust 单元与集成测试

- 配置迁移
- SQLite 兼容迁移
- API Key 兼容和时间戳解析
- Provider 测试
- Web Auth
- 协议转换

### 11.2 CLI 与打包验证

- `pnpm smoke:cli`
- `pnpm pack:dry-run`

### 11.3 Web UI E2E

- Playwright 页面导航
- 主题/语言切换
- 登录
- API Key 管理
- 日志联动

## 12. 当前边界与后续方向

当前系统已经具备替换旧 Node.js 后端的条件，但仍有几个明确边界：

- 兼容目标是旧系统的主要外部行为，不承诺完全逐实现一致
- GitHub Release 流水线已经落地，但仍需要真实发版验证
- 目前优先支持本地单机使用场景，不是云端多实例架构

如果后续继续演进，优先级建议如下：

1. 补真实发布和安装回归验证
2. 继续缩小与旧后端在边缘流式行为上的差异
3. 把监控和错误诊断能力做得更明确

## 13. 相关文档

- 存储设计：[`database-schema.md`](./database-schema.md)
- API 兼容矩阵：[`api-compatibility.md`](./api-compatibility.md)
- npm 打包：[`npm-packaging.md`](./npm-packaging.md)
- GitHub 发版：[`github-release-checklist.md`](./github-release-checklist.md)
