# Provider 2.0（v0.15）设计

Provider 2.0 解决 Provider 管理四类痛点：同一上游多协议端点共享 key（#5）、同一 provider 多个命名 key 手动切换（#6）、管理交互太繁琐（#7）、预设模板与余额显示（#8）。

## 1. 数据模型（零迁移）

`crates/cc-gw-core/src/config.rs`，全部 additive 可选字段 —— 旧 `config.json` 不含新字段时行为与 v0.14 逐字节一致：

```rust
pub struct ProviderEndpointConfig {
    pub id: String,           // provider 内唯一，UI 行 key
    pub label: Option<String>,
    pub protocol: String,     // "anthropic" | "openai" | "openai-responses"
    pub base_url: String,     // 端点必填 http(s)
}
pub struct ProviderKeyConfig {
    pub id: String,           // provider 内唯一
    pub label: Option<String>,
    pub value: String,
    pub active: Option<bool>, // 读取期最多一个生效（见归一化）
}
// ProviderConfig 新增：
pub endpoints: Vec<ProviderEndpointConfig>,   // 多协议端点（主端点之外的附加面）
pub keys: Vec<ProviderKeyConfig>,             // 命名密钥
pub balance_adapter: Option<String>,          // "deepseek"|"moonshot"|"siliconflow"|"openrouter"
```

校验（`validate_for_save` 扩展）：端点 id 非空且 provider 内唯一、protocol 枚举合法、base_url 非空 http(s)、key id 非空且唯一。**不强制「恰好一个 active key」**——生效选择在读取期归一化。

## 2. 归一化视图（请求作用域）

核心机制：`ProviderConfig::effective_for_protocol(request_protocol)`（config.rs）在路由解析后、转发前生成一个请求作用域的 clone，把端点/密钥选择**写回原有字段**，下游 `forward_request` / `build_headers` / 协议转换器继续读 `base_url` / `api_key` / `provider_type`，零改动：

```rust
// routing.rs expand_route_plan — 唯一应用点，直连与聚合成员展开共用
fn effective_target(target: RouteTarget, request_protocol: ProviderProtocol) -> RouteTarget {
    RouteTarget { provider: target.provider.effective_for_protocol(request_protocol), ..target }
}
```

- **端点选择**：`endpoints` 中存在 `protocol == 请求协议` 的端点 → 该端点的 `base_url` 覆盖主端点，`provider_type` 改写为端点协议（协议标记即类型标记，`infer_target_protocol` 自然得出原生协议，走原生转发不转换）；同时丢弃过期的 `anthropic-version` 头让端点协议权威。**无匹配端点 → 主端点照旧跨协议转换**。
- **密钥选择**：`keys` 非空时生效 key = 第一个 `active: true` 项；无任何标记取第一项；生效值覆盖 `api_key`。**空数组回落 `api_key` 字段**。
- **backend health key 维持 `providerId:modelId` 不变**：同 provider 多端点共享冷却（同一上游同一账号，语义正确），health.rs 与聚合成员语法不动。

代理循环、命中模拟器、聚合降级链读到的都是归一化后的候选，三处行为天然一致。

## 3. 模型探测（端点级）

`fetch_provider_models`（provider.rs）：主端点 + 各 endpoint 逐个探测后合并去重；单面失败容忍（不阻塞其他端面）。预设模板的 `noModelProbe` 标记由创建对话框消费（提示该服务无模型列表端点、需手动添加模型），不写入 config；面板探测入口不据此隐藏（后端对不可推导 URL 会返回干净的 UnsupportedEndpoint）。

## 4. 余额 adapter（手动刷新）

`cc-gw-core/src/balance.rs`，按 `balance_adapter` 分发，base_url 取主端点，认证用生效命名密钥：

| adapter | 上游端点 | display 归一化 |
|---|---|---|
| deepseek | `GET {base}/user/balance` | `balance_infos` 各币种合计，如 `110.00 CNY` |
| moonshot | `GET {base}/users/me/balance` | `available_balance`，如 `-0.76 CNY` |
| siliconflow | `GET {base}/user/info` | `data.balance`，如 `9.76 CNY` |
| openrouter | `GET {base}/key` | `data.usage / data.limit`（limit null = 无上限） |

归一化失败（结构不认识）→ `display: null`，原始 JSON 保留在 `raw`。快照为运行时态（`AppState.provider_balances`，重启即失，不落库不写 config）：

- `POST /api/providers/{id}/balance/refresh` — 同步拉取；失败 502 + `provider_balance_refresh_failed` warn 事件
- `GET /api/providers/balances` — 全部快照（未刷新过的 provider 不出现）

**无后台轮询**——详情页手动刷新（adapter 草稿与已存值不一致时禁用，避免刷错端点）。

## 5. 预设模板目录

`cc-gw-core/src/provider_presets.rs` 单源目录，`GET /api/provider-presets` 输出（camelCase，`type` 字段与 ProviderConfig web 契约一致）。应用在前端（填充创建对话框的 baseUrl/type/balanceAdapter），无服务端 apply 路由：

| id | 协议 | baseUrl | 余额 | 备注 |
|---|---|---|---|---|
| opencode-zen | anthropic | `https://opencode.ai/zen` | — | |
| volcano-coding | anthropic | `https://ark.cn-beijing.volces.com/api/coding` | — | 火山方舟 Coding Plan |
| zhipu | anthropic | `https://open.bigmodel.cn/api/anthropic` | — | 智谱 GLM |
| aliyun-bailian | anthropic | `https://dashscope.aliyuncs.com/apps/anthropic` | — | `noModelProbe: true`（无模型列表端点） |
| kimi | openai | `https://api.moonshot.cn/v1` | moonshot | |
| deepseek | openai | `https://api.deepseek.com/v1` | deepseek | |
| siliconflow | openai | `https://api.siliconflow.cn/v1` | siliconflow | |
| openrouter | openai | `https://openrouter.ai/api/v1` | openrouter | |

## 6. WebUI 主从布局

`src/web/src/pages/workbench/`：

- **左 rail**（`ProvidersMasterDetail`）：搜索 / 类型筛选 + provider 行（label、类型徽章、`id · N 个模型 · N 个密钥` 摘要）；选中态持久化 localStorage，失效自动清空。
- **创建对话框**（`CreateProviderDialog`）：模板下拉（8 预设 + 手动类型）+ id/label/baseUrl；创建后自动选中落入右侧面板继续编辑。
- **右详情面板**（`ProviderDetailPanel`）：分区**内联编辑**（基本信息 / 端点表格 / 密钥表格（active 单选、掩码显示）/ 模型 / 高级 / 余额 / 聚合模型特例），脏稿跟踪 + 单一保存按钮 + 放弃。聚合供应商无 baseUrl/密钥区，只有成员链。
- 旧卡片网格 + 多步向导抽屉已移除；`ProviderDrawerSteps` / `useProviderForm` 保留为 setup 向导与面板共用的表单原语。

## 7. 非目标（v2 方向）

key 自动轮换 / 按用量选 key、余额定时轮询与余额告警、端点级独立 RPM 限额、嵌套预设（预设引用预设）。
