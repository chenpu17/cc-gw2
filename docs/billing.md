# 统一货币计费（v0.16）设计

v0.16 补上 token → 货币的整条链路：内置价格表 + 用户覆盖 + 查询期实时计价，成本以统一货币铺满仪表盘、日志与维度统计。核心代码 `crates/cc-gw-core/src/billing.rs`。

## 1. 计费公式（两方言统一）

价格条目为五元组（每 1M tokens，**原币**计）：`input / output / cache_read / cache_creation`，`0.0` 合法（免费档）。

```
billable_input = max(0, input − cache_read − cache_creation)
分项成本      = tokens / 1e6 × 对应单价 → 按汇率换算为展示货币 → 四舍五入 6 位小数
total         = 四分项之和，再取 6 位小数
```

- Anthropic 方言归一化后 `input_tokens` 已含 cache 读/写（`stream.rs` `normalize_usage`），OpenAI 方言 `prompt_tokens` 同样含 cached tokens，因此同一公式对两边都成立。
- cache 之和超过 input 的异常数据把 billable 钳到 0，不会出现负输入。
- `input` 未知（NULL）或模型无价 → 整条返回 `None`（未计价），**绝不以 0 冒充**；UI 显示 `—`。

## 2. 价格解析三级与模型名匹配

`PricingEngine::resolve(model_id, provider_id)` 按序：

1. `providerId:modelId` 范围覆盖（同一模型名在不同 provider 不同价的场景）
2. `modelId` 全局覆盖
3. 内置价格表模糊匹配

覆盖只做**键的精确匹配**（键即所写，不做任何变体推导）；覆盖币种非法（手改 config）时跳过该条继续下探。

内置表匹配先生成精确候选（按序先命中先赢）：

1. lowercase
2. 剥区域前缀 `us.` / `eu.` / `global.`
3. 剥厂商段（逐段剥 `/` 前缀，覆盖 OpenRouter `anthropic/claude-…`）
4. 剥尾 `:xxx` 修饰（`claude-3-7-sonnet:beta`）
5. 剥尾日期 `-YYYYMMDD` 或 `-YYYY-MM-DD`（`kimi-k2-0905` 为 4 位数字不受影响）
6. 数字间 `.` → `-` 变体（`claude-sonnet-4.5` → `claude-sonnet-4-5`）

全部候选失败后做**边界前缀最长匹配**：候选以键为前缀且下一字符 ∈ {`.`, `:`, `@`}（如 `gpt-4o:2024-11-20` 命中 `gpt-4o`）。边界**不含 `-`**：`gpt-4o` 不许匹配 `gpt-4o-mini`、`glm-4.5` 不许匹配 `glm-4.5-air` —— 变体模型必须显式建条目或由用户覆盖。Bedrock 风格 `anthropic.claude-*` 不满足前缀方向，保持未计价，交给设置页显式覆盖 —— 宁可 null 不可错配。

## 3. 汇率与展示货币

- `displayCurrency`：`CNY`（默认）| `USD`，大小写不敏感。
- `rates`：源币大写码 → 1 单位源币折多少展示货币。内置默认 `1 USD = 7.20 CNY`；展示 USD 时默认 `CNY → USD = 1/7.2`。未知币种按 1.0 兜底。
- 设置页简化为单一「1 USD = ___ CNY」输入（CNY 展示写 `USD` 键，USD 展示写 `CNY` 键倒数），底层仍是通用 rates map。
- 价格条目永远保留原币；换算只发生在计价出口，因此改汇率即全量重算。

## 4. 查询期估算语义（不落库）

**成本不持久化**：每次 API 查询用当前 config 构建 `PricingEngine`，对日志行 / 聚合子行实时计价。改价、改汇率后历史随之重算 —— 这是特性：历史成本始终按当前认知估算。

聚合口径（overview / daily / model / providers / endpoints / clients / api-keys usage）：SQL 额外按 `model, provider` 二级分组，逐子行 compute 后折叠 —— 已计价子行累加 total，未计价子行累加 `unpricedRequests`；**整行全未计价时 `cost: null`**。部分计价时 cost 只含已计价部分，UI 以 `*` / 未计价计数标注。

内置表是编写时的官方标价快照（不含折扣档、企业协议价），**估算用途非账单**；需要精确口径时在设置页为模型加覆盖（可附 `label` 备注）。

## 5. 历史行与 `cached_tokens` 口径

v0.14 之前的历史行只有 `cached_tokens`（无 cache_read/cache_creation 拆分）。这些行**不并入 cache_read** —— 按普通输入计价（略高于真实成本），不做数据迁移。升级后新写入的行均为四项拆分口径。

## 6. 配置结构

`config.json` 新增 `billing` 块（additive，缺失即默认 CNY + 内置表），随 `PUT /api/config` 热加载：

```json
{
  "billing": {
    "displayCurrency": "CNY",
    "rates": { "USD": 7.2 },
    "modelPrices": {
      "my-internal-model": { "currency": "CNY", "input": 4, "output": 16, "cacheRead": 1, "cacheCreation": 4, "label": "企业协议价" },
      "my-provider:their-model": { "currency": "USD", "input": 1, "output": 5, "cacheRead": 0.1, "cacheCreation": 1.25 }
    }
  }
}
```

校验（`validate_for_save`）：`displayCurrency` 枚举合法；`rates` 键非空、值 ∈ (0, 10000] 且非 NaN；覆盖键非空、`currency` 合法、四价 ∈ [0, 1e6]（每 1M tokens）。

## 7. API 出口

- **新** `GET /api/billing/prices` → `{ displayCurrency, entries: [{ key, source: "builtin" | "override", scopedProvider?, currency, input, output, cacheRead, cacheCreation, label? }] }`（内置段 + 覆盖段各按 key 排序）
- 成本字段（全部 additive）：`/api/stats/overview` 三段各 + `cost` / `unpricedRequests`、顶层 + `costCurrency`；`/api/stats/daily|model|providers|endpoints|clients`、`/api/stats/api-keys/usage` 每行 + 同名字段；`/api/logs`（列表/详情/导出）顶层 + `cost_currency`（snake_case 随日志惯例）、每条 + `cost` / `cost_breakdown`（camelCase 分项）；`/api/dashboard/summary` 随各段携带，`recentRequests` 每条 + `cost`。

## 8. 内置价格快照（每 1M tokens，原币）

> 编写时的官方标价快照，估算用途非账单；以 `GET /api/billing/prices` 输出为准。
> OpenAI 家族按 developers.openai.com/api/docs/pricing 于 2026-10-13 核对修正（gpt-5.2 与 gpt-5.1/5 单价不同档）。

| 家族 | 模型 | 币种 | 输入 | 输出 | 缓存读 | 缓存写 |
|---|---|---|---|---|---|---|
| Anthropic | claude-opus-4-5 | USD | 5.0 | 25.0 | 0.5 | 6.25 |
| | claude-opus-4-1 | USD | 15.0 | 75.0 | 1.5 | 18.75 |
| | claude-sonnet-4-5 / 4-1 / claude-3-7-sonnet | USD | 3.0 | 15.0 | 0.3 | 3.75 |
| | claude-haiku-4-5 | USD | 1.0 | 5.0 | 0.1 | 1.25 |
| | claude-3-5-haiku | USD | 0.8 | 4.0 | 0.08 | 1.0 |
| OpenAI | gpt-5.2 | USD | 1.75 | 14.0 | 0.175 | — |
| | gpt-5.1 / gpt-5 | USD | 1.25 | 10.0 | 0.125 | — |
| | gpt-5-mini / gpt-5-nano | USD | 0.25 / 0.05 | 2.0 / 0.4 | 0.025 / 0.005 | — |
| | gpt-4.1 / gpt-4.1-mini | USD | 2.0 / 0.4 | 8.0 / 1.6 | 0.5 / 0.1 | — |
| | gpt-4o / gpt-4o-mini | USD | 2.5 / 0.15 | 10.0 / 0.6 | 1.25 / 0.075 | — |
| | o3 / o4-mini | USD | 2.0 / 1.1 | 8.0 / 4.4 | 0.5 / 0.275 | — |
| Gemini | gemini-3-pro | USD | 2.0 | 12.0 | 0.5 | — |
| | gemini-2.5-pro | USD | 1.25 | 10.0 | 0.31 | — |
| | gemini-2.5-flash / 2.0-flash | USD | 0.3 / 0.1 | 2.5 / 0.4 | 0.075 / 0.025 | — |
| | gemini-2.5-flash-lite | USD | 0.1 | 0.4 | 0.025 | — |
| DeepSeek | deepseek-chat / v3.1 / v3 | CNY | 2.0 | 8.0 | 0.5 | 2.0 |
| | deepseek-reasoner / r1 | CNY | 4.0 | 16.0 | 1.0 | 4.0 |
| Kimi | kimi-k2-thinking / k2-0905-preview / kimi-latest | CNY | 4.0 | 16.0 | 1.0 | 4.0 |
| | kimi-k2-turbo-preview | CNY | 8.0 | 32.0 | 2.0 | 8.0 |
| | moonshot-v1-8k / 32k / 128k | CNY | 12 / 24 / 60 | 12 / 24 / 60 | 8.0 | 12 / 24 / 60 |
| 智谱 GLM | glm-4.6 / 4.5 | CNY | 2.0 | 8.0 | 0.5 | 2.0 |
| | glm-4.5-air | CNY | 0.8 | 2.0 | 0.2 | 0.8 |
| | glm-4.5-flash | CNY | 0.0 | 0.0 | 0.0 | 0.0 |
| 通义 Qwen | qwen-max | CNY | 2.4 | 9.6 | 0.48 | 2.4 |
| | qwen-plus / qwen3-coder-plus | CNY | 0.8 / 1.5 | 2.0 / 6.0 | 0.16 / 0.3 | 0.8 / 1.5 |
| | qwen-turbo | CNY | 0.3 | 0.6 | 0.06 | 0.3 |

家族口径备注：Anthropic cache 写 = 1.25× input、读 = 0.1× input；OpenAI 无单独 cache 写计价；Gemini cache 存储费不计；DeepSeek cache 写按 input 价；Qwen cache 命中价按官方口径 0.2× input 估算。

## 9. 测试

- 单元：`billing.rs` 内嵌（候选生成/边界负例/三级解析/公式含钳零与免费模型/汇率默认与兜底/attach_log_costs 列表与详情/旧行 cached_tokens 口径/内置表无重复键且数值合法）
- 集成：`cc-gw-server` tests（override 整数价 → overview/logs/维度数值断言；未配置 → 全 null）
- E2E：`tests/playwright/billing.spec.ts`（未计价 `—` 口径、覆盖价格手算数值、改汇率重算与移除还原、设置分区 UI 编辑保存）
