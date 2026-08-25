# 聚合模型（Aggregated Model）设计

聚合模型解决"上游 LLM 供应商当日配额用完需要手动切流量"的运维痛点：把多个真实后端（可跨供应商、跨模型名）组织成一个虚拟模型名，网关按优先级自动降级与恢复。

## 1. 概念模型

```
聚合供应商 (type: "aggregate", 无 baseUrl / apiKey)
└── 聚合模型 (如 glm-5.1)          ← 对客户端暴露的虚拟模型名
    ├── 成员 1  providerA:a       ← 首选（数组序 = 优先级）
    ├── 成员 2  providerA:b
    └── 成员 3  providerB:c       ← 兜底
    └── 降级策略 failover           ← 阈值 / 冷却 / 窗口 / 触发码
```

- **虚拟供应商**：聚合模型组织成 `providers[]` 里的一项，`provider_type: "aggregate"`。模型路由、direct match、fallback 链、`/v1/models`、Web 目标选择器全部把它当普通供应商对待。
- **成员目标语法**：`"providerId:modelId"`；`"providerId:*"` 表示该供应商上的同名模型（`*` 解析为聚合模型自身 id）。成员不允许指向聚合供应商（v1 不支持嵌套聚合）。
- **策略可扩展**：member 是对象结构（后续可加 `weight`），策略集中在 `failover` 配置，为将来的权重轮询 / 成本优先预留接入点。

## 2. 配置形态

`crates/cc-gw-core/src/config.rs`：

```rust
pub const AGGREGATE_PROVIDER_TYPE: &str = "aggregate";

pub struct AggregateMemberConfig { pub target: String }  // 数组序 = 优先级
pub struct FailoverPolicyConfig {
    pub consecutive_failures: Option<u32>,       // 默认 3
    pub cooldown_seconds: Option<u64>,           // 默认 900（配额场景可调 86400）
    pub failure_window_seconds: Option<u64>,     // 默认 600
    pub trigger_status_codes: Option<Vec<String>>, // 默认 ["401","402","403","408","429","5xx"]
}
// ProviderModelConfig += members / failover
```

校验（`validate_aggregate_providers`，挂 `validate_for_save`，与悬空路由容忍语义一致）：非聚合 provider 带 members 拒绝、空 members 拒绝、target 格式 / 悬空 / 嵌套拒绝、failover 数值范围（阈值 ≥1、冷却 1-86400、窗口 ≥1、状态码 `1xx`-`5xx` 或 100-599）。重复成员保序去重不报错。

## 3. 关键产品语义

1. **请求内即时透明降级**：当前请求的候选失败立刻试下一个（客户端无感知）；失败状态透传被丢弃、归还连接池。
2. **状态累积**：连续失败达阈值 → 后端进入冷却，后续请求直接跳过（`skipped:cooldown`）。
3. **冷却到期自动恢复**：到期后端重新参与，但**冷却到期不重置失败计数** —— 恢复期一次失败立即再冷却（适合配额耗尽场景）。
4. **失败窗口**（默认 600s）过期自动清零，避免零星旧失败累加误伤。
5. **成功即清零**：任一成功请求移除健康条目。
6. **RPM 排队被拒 ≠ 后端故障**：不记失败，只换候选；非最后候选的 RPM 等待钳制在 `min(配置, 2s)`，防止 N 候选 × 30s 尾延迟。
7. **全候选失败**：透传最后候选的原始错误（transport 失败走原有 502 分支）；全部为 RPM 拒 / 冷却跳过时保留现有 429 + Retry-After 契约。
8. **直连路径零变化**：单候选（所有非聚合路由）`is_last` 恒真，触发码透传、RPM / 兼容重试 / 日志行为与旧版逐字节一致；直连失败也以默认策略记健康失败（只影响未来聚合跳过决策）。

## 4. 实现落点

| 层 | 文件 | 内容 |
|---|---|---|
| 配置 | `cc-gw-core/src/config.rs` | 类型 + 校验 |
| 健康 | `cc-gw-core/src/health.rs` | `BackendHealthRegistry`（`providerId:modelId` 全局键，std Mutex fail-open，无持久化——重启清零可接受）；`FailoverPolicy::from_config` 带防御默认 |
| 路由 | `cc-gw-core/src/routing.rs` | `RoutePlan { candidates, failover }`；`expand_route_plan` 在 `resolve_route_inner` 六步链全部返回点展开成员（失效成员跳过、去重保序、全失效 bail）；旧 `resolve_route` 保留为薄委托 |
| 代理 | `cc-gw-server/src/proxy_routes.rs` | `proxy_standard_request` 候选循环：冷却跳过 → RPM（非末位钳 2s）→ 按候选重算协议转换 / 兼容模式 / 上游流式 → 转发 → 触发码判定 → `record_success`；日志惰性落库（首个转发前）+ `COALESCE` 覆盖实际后端；`provider_failover` 事件（仅多候选）带 attempts 链 |
| 观测 | `admin_routes.rs` | `GET /api/providers/backends/health`；simulate 响应追加 `candidates`（只增不改）；聚合 provider 拒绝连通性测试 / 模型探测 |
| 前端 | `src/web/src/pages/workbench/` | 抽屉聚合类型卡（隐藏 baseUrl/认证区）→ `AggregateModelsStep`（dnd-kit 成员链 + 高级降级策略）；ProviderCard 聚合形态（成员摘要 + 健康徽章，10s 轮询）；命中模拟候选链 |

## 5. 请求内降级的终态矩阵

| 情况 | 客户端结果 | 健康记录 | 事件 |
|---|---|---|---|
| 某候选触发码失败，后面有候选 | 试下一候选 | `record_failure` | 最终成功也发 `provider_failover` |
| 最后候选触发码失败 | 透传该候选原始错误响应 | `record_failure` | 多候选时发 |
| transport 失败（最后候选） | 原 502 分支 + `provider_proxy_failure` | `record_failure` | 多候选时另发 `provider_failover` |
| 全部候选 rate-limited | 429 + Retry-After（现有契约） | 无 | 无 |
| 全部候选冷却跳过 | 429 `aggregate_backends_unavailable` + Retry-After（最短冷却） | 无 | 发 |
| materialized（non_stream_via_stream）握手 200 但 SSE error | v1 不回环 failover，只记失败 | `record_failure` | 无 |
| 直播流握手 200 但 SSE error 事件 | 转换路径向客户端补发协议正确的 error 事件；日志按失败记录 | 不记（因果弱） | 无 |
| 流式中途（yield 后）transport 失败 / 长时间静默 | 502（空闲超时终止挂起的流） | 不记（因果弱） | 无 |

## 6. 非目标（v2 方向，接口已预留）

嵌套聚合（校验拒绝）、权重轮询 / 成本优先策略、流式中途失败转移、多 key 轮换、健康状态持久化。
