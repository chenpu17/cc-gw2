# Database And Local Storage

## 1. 本地目录布局

`cc-gw` 默认使用用户目录下的 `~/.cc-gw` 作为运行根目录。

关键文件：

- `config.json`
  - 网关主配置
- `data/gateway.db`
  - SQLite 数据库
- `logs/cc-gw.log`
  - CLI/守护进程日志
- `cc-gw.pid`
  - 守护进程 PID 文件
- `encryption.key`
  - 本地密钥加密所需材料

设计目标：

- 保持与旧版本目录结构兼容
- 让用户升级后可以直接复用历史数据
- 不依赖额外数据库服务

## 2. SQLite 初始化策略

数据库初始化由 [`storage.rs`](/Users/chenpu/workspace/claude-code/cc-gw2/crates/cc-gw-core/src/storage.rs) 负责。

启动时会执行以下动作：

1. 打开 `gateway.db`
2. 设置 `journal_mode = WAL`
3. 开启 `foreign_keys = ON`
4. 创建缺失表
5. 对旧表执行补列
6. 对 `daily_metrics` 执行结构迁移
7. 补默认 wildcard API Key

这意味着旧数据库不会被整体重建，而是尽量原地迁移。

## 3. 主要数据表

## 3.1 `request_logs`

用途：

- 记录每次代理请求的主记录
- 支持日志页、统计页和 API Key 使用分析

核心字段：

- `id`
- `timestamp`
- `session_id`
- `endpoint`
- `provider`
- `model`
- `client_model`
- `stream`
- `latency_ms`
- `status_code`
- `input_tokens`
- `output_tokens`
- `cached_tokens`
- `cache_read_tokens`
- `cache_creation_tokens`
- `ttft_ms`
- `tpot_ms`
- `error`
- `api_key_id`
- `api_key_name`
- `api_key_value`

说明：

- `endpoint` 用来区分 anthropic、openai 或自定义端点
- `client_model` 保留客户端传入模型名，`model` 表示最终路由后的模型名
- `ttft_ms` 和 `tpot_ms` 主要用于流式请求观测

## 3.2 `request_payloads`

用途：

- 存储请求和响应 payload

核心字段：

- `request_id`
- `prompt`
- `response`

说明：

- 与 `request_logs` 一对一关联
- `prompt`、`response` 以压缩后的 `BLOB` 存储
- `request_logs` 删除时，payload 会级联删除

## 3.3 `daily_metrics`

用途：

- 提供仪表盘和统计页的日级聚合数据

核心字段：

- `date`
- `endpoint`
- `request_count`
- `total_input_tokens`
- `total_output_tokens`
- `total_cached_tokens`
- `total_cache_read_tokens`
- `total_cache_creation_tokens`
- `total_latency_ms`

说明：

- 主键为 `(date, endpoint)`
- 旧版本如果只有单列主键，会在启动时迁移成复合主键
- 默认把缺失 `endpoint` 的历史数据补成 `anthropic`

## 3.4 `api_keys`

用途：

- 管理客户端调用网关所使用的 API Key
- 记录 API Key 级别的使用情况

核心字段：

- `id`
- `name`
- `description`
- `key_hash`
- `key_ciphertext`
- `key_prefix`
- `key_suffix`
- `is_wildcard`
- `enabled`
- `created_at`
- `updated_at`
- `last_used_at`
- `request_count`
- `total_input_tokens`
- `total_output_tokens`
- `allowed_endpoints`

说明：

- 明文密钥不直接入库
- `key_hash` 用于匹配
- `key_ciphertext` 用于 reveal
- `allowed_endpoints` 用于限制某个 Key 可访问的 endpoint
- 系统会确保存在一个 wildcard key 作为兜底条目

## 3.5 `api_key_audit_logs`

用途：

- 记录 API Key 的管理操作历史

核心字段：

- `api_key_id`
- `api_key_name`
- `operation`
- `operator`
- `details`
- `ip_address`
- `created_at`

说明：

- 用于补充管理审计信息
- 即使原始 Key 被删除，部分操作记录仍可保留

## 3.6 `gateway_events`

用途：

- 记录系统事件、鉴权事件、错误事件和运行期提示

核心字段：

- `id`
- `created_at`
- `type`
- `level`
- `source`
- `title`
- `message`
- `endpoint`
- `ip_address`
- `api_key_id`
- `api_key_name`
- `api_key_value`
- `user_agent`
- `mode`
- `details`

说明：

- 主要服务于 Web 管理台事件页
- 已建立按时间、类型、级别的索引

## 4. 兼容迁移策略

当前兼容迁移不是用独立 migration 序列号表，而是使用“启动即补齐”策略：

- 缺列则 `ALTER TABLE ADD COLUMN`
- 旧 `daily_metrics` 结构不满足条件时重建迁移
- 旧 `api_keys` 里的历史时间戳类型允许按多种格式读取
- `request_logs.session_id` 等历史缺失列会自动补上

这种方式的优点：

- 简化了单机工具的维护成本
- 对旧用户升级更直接

代价：

- schema 演化逻辑集中在启动路径，后续改表时必须谨慎维护兼容代码

## 5. 数据写入路径

主要写入来源：

- 配置接口写 `config.json`
- 请求代理写 `request_logs`
- 需要保存 payload 时写 `request_payloads`
- 请求完成后更新 `daily_metrics`
- API Key 调用时更新 `api_keys` 的使用统计和 `last_used_at`
- 管理操作和异常写 `gateway_events` / `api_key_audit_logs`

## 6. 当前边界

本地存储设计适合单机守护进程场景，不适合直接扩展到多实例共享数据库场景。原因包括：

- SQLite 写入并发模型有限
- 本地文件路径是默认前提
- PID、日志、配置都假设单机单用户使用

如果未来需要服务化部署，需要重新设计：

- 外部数据库
- 迁移版本管理
- 多实例日志与事件聚合
- 更明确的租户隔离
