//! 统一货币计费 — token → 货币成本换算。
//!
//! 设计要点：
//! - **查询期实时计价，不落库**：价格变化后历史成本随之重算（特性而非缺陷），
//!   因此本模块只依赖 config 与内存中的 usage 数字，不触碰 storage。
//! - **价格来源三级**：`providerId:modelId` 范围覆盖 → 全局模型覆盖 → 内置表。
//!   覆盖只做精确匹配（键即所写）；内置表带模糊候选匹配（见
//!   [`price_lookup_candidates`]），无价时返回 None（UI 显示 `—`，绝不以 0 冒充）。
//! - **计费公式两方言统一**：`billable_input = max(0, input − cache_read − cache_creation)`。
//!   Anthropic 方言归一化后 input 已含 cache 读/写（stream.rs `normalize_usage`），
//!   OpenAI 方言 prompt_tokens 同样含 cached tokens，因此同一公式对两边都成立。
//! - **价格快照，估算用途非账单**：内置表为编写时的官方标价（不含折扣档），
//!   可在 config 中按模型覆盖。历史旧行只有 `cached_tokens` 的，cache 读按
//!   普通输入计价（略高），不做迁移，见 docs/billing.md。

use std::collections::HashMap;

use serde::Serialize;

use crate::config::BillingConfig;

/// 内置默认汇率（1 USD = 7.20 CNY），config `billing.rates` 可覆盖。
pub const DEFAULT_USD_CNY_RATE: f64 = 7.20;

/// SQL 片段：逐行钳零后的可计费输入之和（标量 `MAX(a, b)` 逐行求值，
/// 再 SUM）。钳零必须在行内做 —— 见 [`UsageTotals::billable_input`]：
/// 聚合后钳零会让异常 `cache_read > input` 行抵扣同组正常行的输入费用。
pub const BILLABLE_INPUT_SUM_SQL: &str = "SUM(MAX(input_tokens - COALESCE(cache_read_tokens, 0) - COALESCE(cache_creation_tokens, 0), 0))";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Currency {
    Usd,
    Cny,
}

impl Currency {
    /// 大小写不敏感解析（"USD"/"usd"/" cny " 均可）。
    pub fn parse(value: &str) -> Option<Self> {
        match value.trim().to_ascii_uppercase().as_str() {
            "USD" => Some(Currency::Usd),
            "CNY" => Some(Currency::Cny),
            _ => None,
        }
    }

    pub fn code(self) -> &'static str {
        match self {
            Currency::Usd => "USD",
            Currency::Cny => "CNY",
        }
    }
}

/// 模型单价（每 1M tokens，原币计）。0.0 合法（免费档）。
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ModelPrice {
    pub currency: Currency,
    pub input: f64,
    pub output: f64,
    pub cache_read: f64,
    pub cache_creation: f64,
}

struct BuiltinPriceEntry {
    model: &'static str,
    price: ModelPrice,
}

const fn usd(input: f64, output: f64, cache_read: f64, cache_creation: f64) -> ModelPrice {
    ModelPrice {
        currency: Currency::Usd,
        input,
        output,
        cache_read,
        cache_creation,
    }
}

const fn cny(input: f64, output: f64, cache_read: f64, cache_creation: f64) -> ModelPrice {
    ModelPrice {
        currency: Currency::Cny,
        input,
        output,
        cache_read,
        cache_creation,
    }
}

const fn entry(model: &'static str, price: ModelPrice) -> BuiltinPriceEntry {
    BuiltinPriceEntry { model, price }
}

/// 内置价格表快照（每 1M tokens，原币）。条目键为规范模型名（小写、
/// 版本点用 `-`）；同家族的别名/变体模型显式建条目而不靠前缀兜底。
static BUILTIN_PRICES: &[BuiltinPriceEntry] = &[
    // Anthropic — USD；cache 写 = 1.25× input，cache 读 = 0.1× input
    entry("claude-opus-4-5", usd(5.0, 25.0, 0.5, 6.25)),
    entry("claude-opus-4-1", usd(15.0, 75.0, 1.5, 18.75)),
    entry("claude-sonnet-4-5", usd(3.0, 15.0, 0.3, 3.75)),
    entry("claude-sonnet-4-1", usd(3.0, 15.0, 0.3, 3.75)),
    entry("claude-3-7-sonnet", usd(3.0, 15.0, 0.3, 3.75)),
    entry("claude-haiku-4-5", usd(1.0, 5.0, 0.1, 1.25)),
    entry("claude-3-5-haiku", usd(0.8, 4.0, 0.08, 1.0)),
    // OpenAI — USD；无单独 cache 写计价
    // 快照核对：developers.openai.com/api/docs/pricing，2026-10-13；
    // gpt-5.2 为 $1.75/$14（gpt-5.1/5 才是 $1.25/$10），曾误沿用后者。
    entry("gpt-5.2", usd(1.75, 14.0, 0.175, 0.0)),
    entry("gpt-5.1", usd(1.25, 10.0, 0.125, 0.0)),
    entry("gpt-5", usd(1.25, 10.0, 0.125, 0.0)),
    entry("gpt-5-mini", usd(0.25, 2.0, 0.025, 0.0)),
    entry("gpt-5-nano", usd(0.05, 0.4, 0.005, 0.0)),
    entry("gpt-4.1", usd(2.0, 8.0, 0.5, 0.0)),
    entry("gpt-4.1-mini", usd(0.4, 1.6, 0.1, 0.0)),
    entry("gpt-4o", usd(2.5, 10.0, 1.25, 0.0)),
    entry("gpt-4o-mini", usd(0.15, 0.6, 0.075, 0.0)),
    entry("o3", usd(2.0, 8.0, 0.5, 0.0)),
    entry("o4-mini", usd(1.1, 4.4, 0.275, 0.0)),
    // Gemini — USD；cache 存储费不计
    // 快照核对：ai.google.dev/gemini-api/docs/pricing，2026-10-14；
    // cache 读 = 输入价的 1/4，2.5-pro 为 $1.25/4 = $0.3125（官方页展示
    // 舍入为 $0.31，本表取精确值，与同族 0.075/0.025 的 1/4 口径一致）。
    entry("gemini-3-pro", usd(2.0, 12.0, 0.5, 0.0)),
    entry("gemini-2.5-pro", usd(1.25, 10.0, 0.3125, 0.0)),
    entry("gemini-2.5-flash", usd(0.3, 2.5, 0.075, 0.0)),
    entry("gemini-2.5-flash-lite", usd(0.1, 0.4, 0.025, 0.0)),
    entry("gemini-2.0-flash", usd(0.1, 0.4, 0.025, 0.0)),
    // DeepSeek — CNY；cache 写按 input 价
    entry("deepseek-chat", cny(2.0, 8.0, 0.5, 2.0)),
    entry("deepseek-reasoner", cny(4.0, 16.0, 1.0, 4.0)),
    entry("deepseek-v3.1", cny(2.0, 8.0, 0.5, 2.0)),
    entry("deepseek-v3", cny(2.0, 8.0, 0.5, 2.0)),
    entry("deepseek-r1", cny(4.0, 16.0, 1.0, 4.0)),
    // Kimi / Moonshot — CNY
    entry("kimi-k2-thinking", cny(4.0, 16.0, 1.0, 4.0)),
    entry("kimi-k2-0905-preview", cny(4.0, 16.0, 1.0, 4.0)),
    entry("kimi-k2-turbo-preview", cny(8.0, 32.0, 2.0, 8.0)),
    entry("kimi-latest", cny(4.0, 16.0, 1.0, 4.0)),
    entry("moonshot-v1-8k", cny(12.0, 12.0, 8.0, 12.0)),
    entry("moonshot-v1-32k", cny(24.0, 24.0, 8.0, 24.0)),
    entry("moonshot-v1-128k", cny(60.0, 60.0, 8.0, 60.0)),
    // 智谱 GLM — CNY
    entry("glm-4.6", cny(2.0, 8.0, 0.5, 2.0)),
    entry("glm-4.5", cny(2.0, 8.0, 0.5, 2.0)),
    entry("glm-4.5-air", cny(0.8, 2.0, 0.2, 0.8)),
    entry("glm-4.5-flash", cny(0.0, 0.0, 0.0, 0.0)),
    // 阿里通义 — CNY（cache 命中价按官方口径 0.2× input 估算）
    entry("qwen-max", cny(2.4, 9.6, 0.48, 2.4)),
    entry("qwen-plus", cny(0.8, 2.0, 0.16, 0.8)),
    entry("qwen-turbo", cny(0.3, 0.6, 0.06, 0.3)),
    entry("qwen3-coder-plus", cny(1.5, 6.0, 0.3, 1.5)),
];

/// 生成内置表的精确匹配候选（按序，先命中先赢）：
/// 1. lowercase → 2. 剥区域前缀 `us.`/`eu.`/`global.` → 3. 剥厂商段（首 `/` 前，
/// 覆盖 OpenRouter `anthropic/claude-…`）→ 4. 剥尾 `:xxx` 修饰 → 5. 剥尾日期
/// `-\d{8}` 或 `-\d{4}-\d{2}-\d{2}`（`kimi-k2-0905` 为 4 位不受影响）→
/// 6. 数字间 `.`→`-` 变体（`claude-sonnet-4.5`→`claude-sonnet-4-5`）。
/// 全部候选精确查表失败后才由 [`builtin_price`] 做边界前缀匹配。
pub fn price_lookup_candidates(model_id: &str) -> Vec<String> {
    let mut candidates: Vec<String> = Vec::new();
    let push = |value: String, out: &mut Vec<String>| {
        if !value.is_empty() && !out.contains(&value) {
            out.push(value);
        }
    };

    let lowered = model_id.trim().to_ascii_lowercase();
    push(lowered.clone(), &mut candidates);

    // 2. 区域前缀
    let after_region = lowered
        .strip_prefix("us.")
        .or_else(|| lowered.strip_prefix("eu."))
        .or_else(|| lowered.strip_prefix("global."))
        .unwrap_or(lowered.as_str());
    push(after_region.to_string(), &mut candidates);

    // 3. 厂商段（逐段剥 `/` 前缀，覆盖 OpenRouter `anthropic/claude-…`）
    let mut after_vendor = after_region;
    while let Some((_, rest)) = after_vendor.split_once('/') {
        after_vendor = rest;
        push(after_vendor.to_string(), &mut candidates);
    }

    // 4. 尾部 `:xxx` 修饰（保留前缀非空）
    let after_suffix = after_vendor
        .split_once(':')
        .map(|(base, _)| base)
        .filter(|base| !base.is_empty())
        .unwrap_or(after_vendor);
    push(after_suffix.to_string(), &mut candidates);

    // 5. 尾部日期（-\d{8} 或 -\d{4}-\d{2}-\d{2}）
    let after_date = strip_date_suffix(after_suffix);
    push(after_date.to_string(), &mut candidates);

    // 6. 数字间 `.`→`-` 变体
    if after_date.contains('.') {
        let variant = replace_digit_dots(after_date);
        push(variant, &mut candidates);
    }

    candidates
}

/// 剥尾部日期（`-YYYYMMDD` 或 `-YYYY-MM-DD`）。
///
/// 模型名可能是任意 UTF-8（中文、emoji），因此**只在字节层判定**、不按
/// 字节数裸切 `str`：日期模式里连字符与数字都是 ASCII，而 `bytes[n]` 为
/// ASCII 时 `n` 必然落在字符边界上，切片天然安全（见 Unicode 模型名回归）。
fn strip_date_suffix(model: &str) -> &str {
    let bytes = model.as_bytes();
    let len = bytes.len();
    let digits =
        |mut range: std::ops::Range<usize>| range.all(|index| bytes[index].is_ascii_digit());

    // 形如 `-20241120`：连字符 + 8 位数字结尾
    if len >= 9 && bytes[len - 9] == b'-' && digits(len - 8..len) {
        return &model[..len - 9];
    }
    // 形如 `-2025-03-25`：连字符 + ISO 日期结尾
    if len >= 11
        && bytes[len - 11] == b'-'
        && digits(len - 10..len - 6)
        && bytes[len - 6] == b'-'
        && digits(len - 5..len - 3)
        && bytes[len - 3] == b'-'
        && digits(len - 2..len)
    {
        return &model[..len - 11];
    }
    model
}

/// 将两侧均为数字的 `.` 替换为 `-`（`4.5`→`4-5`）；其余 `.` 原样保留。
fn replace_digit_dots(model: &str) -> String {
    let bytes = model.as_bytes();
    let mut out = String::with_capacity(model.len());
    for (index, ch) in model.char_indices() {
        if ch == '.'
            && index > 0
            && index + 1 < bytes.len()
            && bytes[index - 1].is_ascii_digit()
            && bytes[index + 1].is_ascii_digit()
        {
            out.push('-');
        } else {
            out.push(ch);
        }
    }
    out
}

/// 内置表查价：候选按序精确匹配，全失败后做边界前缀最长匹配
/// （`候选 == 键` 或 `候选以键为前缀且下一字符 ∈ {':', '@'}`）。
/// 边界**不含 `-` 与 `.`**：`gpt-4o` 不许匹配 `gpt-4o-mini`；点号曾是
/// 边界会让 `gpt-5.2-pro` / `gpt-5.4` 越过 `gpt-5.2`（`-` 挡住）继续吃到
/// 更短的 `gpt-5`（`.` 放行），未知版本/变体必须显式建条目，否则未计价。
pub fn builtin_price(model_id: &str) -> Option<ModelPrice> {
    let candidates = price_lookup_candidates(model_id);
    for candidate in &candidates {
        if let Some(found) = BUILTIN_PRICES
            .iter()
            .find(|e| e.model == candidate.as_str())
        {
            return Some(found.price);
        }
    }
    // 边界前缀最长匹配（在规范候选上做；跳过原始串，原始串已在精确轮查过）
    let mut best: Option<(&BuiltinPriceEntry, usize)> = None;
    for candidate in &candidates {
        for found in BUILTIN_PRICES {
            let key = found.model;
            if candidate.len() > key.len() && candidate.starts_with(key) {
                let boundary = candidate.as_bytes()[key.len()];
                if boundary == b':' || boundary == b'@' {
                    let better = best.map(|(_, len)| key.len() > len).unwrap_or(true);
                    if better {
                        best = Some((found, key.len()));
                    }
                }
            }
        }
    }
    best.map(|(found, _)| found.price)
}

/// 单条请求 / 聚合行的 token 用量。None 表示该维度未知（未知 input 无法计价）。
///
/// `billable_input` 是**逐行钳零后**的可计费输入（单条 `max(0, input −
/// cache_read − cache_creation)`；聚合行为各行钳零后之和，由 SQL
/// `SUM(MAX(…, 0))` 逐行求值）。钳零必须在行内做：上游异常用量
/// （`cache_read > input`）若在聚合后钳零，多出的缓存量会抵扣同组其他
/// 正常请求的输入费用。
#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub struct UsageTotals {
    pub input: Option<i64>,
    pub output: Option<i64>,
    pub cache_read: Option<i64>,
    pub cache_creation: Option<i64>,
    /// 已逐行钳零的可计费输入；None（input 未知）→ 整体未计价。
    pub billable_input: Option<i64>,
}

impl UsageTotals {
    /// 从序列化后的日志记录 JSON（`LogRecord` 字段名）提取用量。
    /// 历史旧行的 `cached_tokens` 不并入 cache_read —— 旧行按普通输入计价
    /// （略高），不迁移；见模块文档。
    pub fn from_log_record(record: &serde_json::Value) -> Self {
        let get =
            |field: &str| -> Option<i64> { record.get(field).and_then(serde_json::Value::as_i64) };
        let input = get("input_tokens");
        let cache_read = get("cache_read_tokens");
        let cache_creation = get("cache_creation_tokens");
        let billable_input = input
            .map(|input| (input - cache_read.unwrap_or(0) - cache_creation.unwrap_or(0)).max(0));
        Self {
            input,
            output: get("output_tokens"),
            cache_read,
            cache_creation,
            billable_input,
        }
    }

    /// 逐条口径的用量（`billable_input` 在行内钳零）。
    pub fn from_raw(
        input: Option<i64>,
        output: Option<i64>,
        cache_read: Option<i64>,
        cache_creation: Option<i64>,
    ) -> Self {
        let billable_input = input
            .map(|input| (input - cache_read.unwrap_or(0) - cache_creation.unwrap_or(0)).max(0));
        Self {
            input,
            output,
            cache_read,
            cache_creation,
            billable_input,
        }
    }
}

/// 成本分项（展示货币计）。各分项四舍五入到 6 位小数，total 为分项之和再取 6 位。
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CostBreakdown {
    pub input: f64,
    pub output: f64,
    pub cache_read: f64,
    pub cache_creation: f64,
    pub total: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum PriceSource {
    Builtin,
    Override,
}

/// 命中的模型价格（含来源），供设置页 / prices 端点展示。
#[derive(Debug, Clone, PartialEq)]
pub struct PricedModel {
    pub source: PriceSource,
    pub price: ModelPrice,
    pub label: Option<String>,
}

fn round6(value: f64) -> f64 {
    (value * 1_000_000.0).round() / 1_000_000.0
}

/// 聚合行成本折叠器：维度/日/密钥等行由多个 (模型, provider) 子行组成，
/// 逐子行 [`PricingEngine::compute`] 后累计 —— 已计价子行加 total，未计价
/// 子行累计请求数。整行全未计价时 `cost` 保持 None（不冒充 0）。
#[derive(Debug, Default)]
pub struct CostFold {
    cost: f64,
    priced: bool,
    unpriced_requests: i64,
}

impl CostFold {
    /// 累计一个 (模型, provider) 子行。
    ///
    /// `unknown_usage` 是该子行里 usage 缺失（`input_tokens IS NULL`）的请求数，
    /// 由 SQL 侧 `SUM(CASE WHEN input_tokens IS NULL THEN 1 ELSE 0 END)` 单独
    /// 统计 —— `SUM` 会忽略 NULL，混合用量组的 input 非空会把同组无 usage 的
    /// 请求一并折算成已计价，导致 unpricedRequests 漏报。
    pub fn add(&mut self, breakdown: Option<CostBreakdown>, requests: i64, unknown_usage: i64) {
        match breakdown {
            Some(breakdown) => {
                self.cost += breakdown.total;
                self.priced = true;
                self.unpriced_requests += unknown_usage;
            }
            // 整个子行不可计价（无价，或 SUM(input) 为 NULL 即全部缺 usage）：
            // 子行内每条请求都未计价。
            None => self.unpriced_requests += requests,
        }
    }

    /// 返回 `(cost, unpricedRequests)`：cost 为已计价部分之和（6 位小数），
    /// 无任何已计价子行时为 None。
    pub fn finish(self) -> (Option<f64>, i64) {
        (
            self.priced.then(|| round6(self.cost)),
            self.unpriced_requests,
        )
    }
}

/// 查询期定价引擎：从 `BillingConfig` 构建，热加载后随 config 一起重建。
#[derive(Debug, Clone)]
pub struct PricingEngine {
    display_currency: Currency,
    /// 源币大写码 → 1 单位源币折多少展示货币（缺省 1.0）。
    rates: HashMap<String, f64>,
    /// 覆盖表原样保存：键为 `model-id`（全局）或 `providerId:modelId`（范围）。
    overrides: HashMap<String, crate::config::ModelPriceOverride>,
}

fn default_rates(display: Currency) -> HashMap<String, f64> {
    let mut rates = HashMap::new();
    match display {
        Currency::Cny => {
            rates.insert("USD".to_string(), DEFAULT_USD_CNY_RATE);
            rates.insert("CNY".to_string(), 1.0);
        }
        Currency::Usd => {
            rates.insert("USD".to_string(), 1.0);
            rates.insert("CNY".to_string(), 1.0 / DEFAULT_USD_CNY_RATE);
        }
    }
    rates
}

impl PricingEngine {
    pub fn from_config(config: &BillingConfig) -> Self {
        let display_currency = config
            .display_currency
            .as_deref()
            .and_then(Currency::parse)
            .unwrap_or(Currency::Cny);
        let mut rates = default_rates(display_currency);
        for (code, rate) in &config.rates {
            rates.insert(code.trim().to_ascii_uppercase(), *rate);
        }
        Self {
            display_currency,
            rates,
            overrides: config.model_prices.clone(),
        }
    }

    pub fn display_currency(&self) -> Currency {
        self.display_currency
    }

    /// 源币金额换算为展示货币（未取整；取整发生在分项层）。
    pub fn convert(&self, amount: f64, from: Currency) -> f64 {
        let rate = self.rates.get(from.code()).copied().unwrap_or(1.0);
        amount * rate
    }

    /// 三级解析：范围覆盖 → 全局覆盖 → 内置表。覆盖只做键的精确匹配，
    /// 不做模糊；覆盖币种非法（手改 config）时跳过该条继续下探。
    pub fn resolve(&self, model_id: &str, provider_id: Option<&str>) -> Option<PricedModel> {
        let lookup = |key: &str| -> Option<PricedModel> {
            let over = self.overrides.get(key)?;
            let currency = Currency::parse(&over.currency)?;
            Some(PricedModel {
                source: PriceSource::Override,
                price: ModelPrice {
                    currency,
                    input: over.input,
                    output: over.output,
                    cache_read: over.cache_read,
                    cache_creation: over.cache_creation,
                },
                label: over.label.clone(),
            })
        };
        if let Some(provider) = provider_id.filter(|p| !p.trim().is_empty()) {
            let scoped = format!("{}:{}", provider.trim(), model_id);
            if let Some(priced) = lookup(&scoped) {
                return Some(priced);
            }
        }
        if let Some(priced) = lookup(model_id) {
            return Some(priced);
        }
        builtin_price(model_id).map(|price| PricedModel {
            source: PriceSource::Builtin,
            price,
            label: None,
        })
    }

    /// 单条用量计价。无价模型或 input 未知 → None（未计价，非 0）。
    pub fn compute(
        &self,
        model_id: &str,
        provider_id: Option<&str>,
        usage: &UsageTotals,
    ) -> Option<CostBreakdown> {
        let priced = self.resolve(model_id, provider_id)?;
        // input 未知则整体无法计价（output 单独存在也无从估算输入侧）。
        // billable_input 已在构造处逐行钳零（单条行内 max，聚合逐行
        // SUM(MAX(…, 0))），异常 cache>input 不抵扣其他行。
        let billable_input = usage.billable_input?;
        let output = usage.output.unwrap_or(0);
        let cache_read = usage.cache_read.unwrap_or(0);
        let cache_creation = usage.cache_creation.unwrap_or(0);

        let price = priced.price;
        let per_million = |tokens: i64| tokens as f64 / 1_000_000.0;
        let cost = |unit_price: f64, tokens: i64| -> f64 {
            round6(self.convert(unit_price * per_million(tokens), price.currency))
        };

        let input_cost = cost(price.input, billable_input);
        let output_cost = cost(price.output, output);
        let cache_read_cost = cost(price.cache_read, cache_read);
        let cache_creation_cost = cost(price.cache_creation, cache_creation);
        Some(CostBreakdown {
            input: input_cost,
            output: output_cost,
            cache_read: cache_read_cost,
            cache_creation: cache_creation_cost,
            total: round6(input_cost + output_cost + cache_read_cost + cache_creation_cost),
        })
    }

    /// 内置表 + 用户覆盖合并视图（`GET /api/billing/prices`）。
    pub fn merged_table(&self) -> Vec<MergedPriceRow> {
        let mut rows: Vec<MergedPriceRow> = BUILTIN_PRICES
            .iter()
            .map(|e| MergedPriceRow {
                key: e.model.to_string(),
                source: PriceSource::Builtin,
                scoped_provider: None,
                currency: e.price.currency,
                input: e.price.input,
                output: e.price.output,
                cache_read: e.price.cache_read,
                cache_creation: e.price.cache_creation,
                label: None,
            })
            .collect();
        let mut overrides: Vec<MergedPriceRow> = self
            .overrides
            .iter()
            .filter_map(|(key, over)| {
                let currency = Currency::parse(&over.currency)?;
                Some(MergedPriceRow {
                    key: key.clone(),
                    source: PriceSource::Override,
                    scoped_provider: key
                        .split_once(':')
                        .map(|(provider, _)| provider.to_string()),
                    currency,
                    input: over.input,
                    output: over.output,
                    cache_read: over.cache_read,
                    cache_creation: over.cache_creation,
                    label: over.label.clone(),
                })
            })
            .collect();
        rows.sort_by(|a, b| a.key.cmp(&b.key));
        overrides.sort_by(|a, b| a.key.cmp(&b.key));
        rows.extend(overrides);
        rows
    }
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MergedPriceRow {
    pub key: String,
    pub source: PriceSource,
    pub scoped_provider: Option<String>,
    pub currency: Currency,
    pub input: f64,
    pub output: f64,
    pub cache_read: f64,
    pub cache_creation: f64,
    pub label: Option<String>,
}

impl Serialize for Currency {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(self.code())
    }
}

/// 为序列化后的日志 JSON 注入成本字段（`mask_log_record_api_key` 先例 ——
/// core 存储层保持与 config 无关，出口处后处理）：
/// - 列表形 `{"items": [...]}` → 顶层补 `cost_currency`，每条补 `cost` /
///   `cost_breakdown`；
/// - 单条记录（detail/export 扁平对象）→ 直接补同名字段；
/// - 顶层数组（export）→ 逐条补字段。
/// 未计价（无价模型 / input 未知）写入 `cost: null`，与聚合口径一致。
pub fn attach_log_costs(value: &mut serde_json::Value, pricing: &PricingEngine) {
    let currency = serde_json::Value::String(pricing.display_currency().code().to_string());
    if let Some(items) = value.get_mut("items").and_then(|v| v.as_array_mut()) {
        for record in items {
            attach_record_cost(record, pricing);
        }
        if let Some(object) = value.as_object_mut() {
            object.insert("cost_currency".to_string(), currency);
        }
        return;
    }
    if let Some(records) = value.as_array_mut() {
        for record in records {
            attach_record_cost(record, pricing);
        }
        return;
    }
    attach_record_cost(value, pricing);
    if let Some(object) = value.as_object_mut() {
        object.insert("cost_currency".to_string(), currency);
    }
}

fn attach_record_cost(record: &mut serde_json::Value, pricing: &PricingEngine) {
    let (model, provider) = {
        let Some(object) = record.as_object() else {
            return;
        };
        let model = object
            .get("model")
            .and_then(serde_json::Value::as_str)
            .filter(|m| !m.is_empty())
            .map(str::to_string);
        let model = match model {
            Some(model) => model,
            None => return,
        };
        let provider = object
            .get("provider")
            .and_then(serde_json::Value::as_str)
            .map(str::to_string);
        (model, provider)
    };
    let usage = UsageTotals::from_log_record(record);
    let breakdown = pricing.compute(&model, provider.as_deref(), &usage);
    let breakdown_value = breakdown
        .and_then(|b| serde_json::to_value(b).ok())
        .unwrap_or(serde_json::Value::Null);
    // cost 只放 total 数字；分项在 cost_breakdown
    let cost_value = breakdown
        .map(|b| serde_json::Value::from(b.total))
        .unwrap_or(serde_json::Value::Null);
    if let Some(object) = record.as_object_mut() {
        object.insert("cost".to_string(), cost_value);
        object.insert("cost_breakdown".to_string(), breakdown_value);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn engine(display: Option<&str>, rates: &[(&str, f64)]) -> PricingEngine {
        let mut config = BillingConfig::default();
        config.display_currency = display.map(str::to_string);
        config.rates = rates
            .iter()
            .map(|(code, rate)| (code.to_string(), *rate))
            .collect();
        PricingEngine::from_config(&config)
    }

    fn usage(input: i64, output: i64, cache_read: i64, cache_creation: i64) -> UsageTotals {
        UsageTotals::from_raw(
            Some(input),
            Some(output),
            Some(cache_read),
            Some(cache_creation),
        )
    }

    #[test]
    fn candidates_exact_lowercase() {
        assert_eq!(
            price_lookup_candidates("Claude-Opus-4-5"),
            vec!["claude-opus-4-5"]
        );
    }

    #[test]
    fn candidates_strip_region_prefix_and_vendor_segment() {
        assert_eq!(
            price_lookup_candidates("us.claude-sonnet-4-5")
                .last()
                .unwrap(),
            "claude-sonnet-4-5"
        );
        assert_eq!(
            price_lookup_candidates("openrouter/anthropic/claude-haiku-4-5"),
            vec![
                "openrouter/anthropic/claude-haiku-4-5",
                "anthropic/claude-haiku-4-5",
                "claude-haiku-4-5"
            ]
        );
    }

    #[test]
    fn candidates_strip_modifier_suffix_and_dates() {
        assert!(
            price_lookup_candidates("claude-3-7-sonnet:beta")
                .contains(&"claude-3-7-sonnet".to_string())
        );
        assert!(price_lookup_candidates("o3-2025-04-16").contains(&"o3".to_string()));
        assert!(price_lookup_candidates("gpt-4o-20241120").contains(&"gpt-4o".to_string()));
        // 4 位数字不是日期，不得误剥（kimi-k2-0905-preview 不得变成 kimi-k2）
        let candidates = price_lookup_candidates("kimi-k2-0905-preview");
        assert!(candidates.contains(&"kimi-k2-0905-preview".to_string()));
        assert!(!candidates.iter().any(|c| c == "kimi-k2"));
        assert!(
            !candidates
                .iter()
                .any(|c| c == "kimi-k2-0905-preview-preview")
        );
    }

    #[test]
    fn candidates_digit_dot_variant() {
        assert!(
            price_lookup_candidates("claude-sonnet-4.5").contains(&"claude-sonnet-4-5".to_string())
        );
        // 非数字两侧的点不动（版本点之外的句点）
        assert!(
            price_lookup_candidates("model.v2")
                .iter()
                .all(|c| !c.contains('-'))
        );
    }

    #[test]
    fn unicode_model_names_never_panic() {
        // 多字节模型名曾按字节数裸切 str 触发 char boundary panic，
        // 使含该模型记录的 /api/logs、/api/stats/* 全部断连。
        for model in [
            "中文模型",
            "中文模型-模型",
            "🤖智能体",
            "模型名—测试",
            "café-noir",
            "юрий-модель",
        ] {
            let candidates = price_lookup_candidates(model);
            assert!(!candidates.is_empty());
            assert!(builtin_price(model).is_none());
        }
        // 带合法日期后缀的 Unicode 名仍要正常剥后缀（切点在 ASCII 字节上）
        assert!(price_lookup_candidates("中文模型-20241120").contains(&"中文模型".to_string()));
        assert!(price_lookup_candidates("🤖-2025-03-25").contains(&"🤖".to_string()));
        // 非 ASCII「日期样」尾巴不是日期，原样保留
        let candidates = price_lookup_candidates("中文模型-二〇二四");
        assert!(candidates[0].starts_with("中文模型-"));
    }

    #[test]
    fn compute_on_unicode_model_is_unpriced_not_panic() {
        let engine = engine(None, &[]);
        let breakdown = engine.compute("中文模型", Some("stub"), &usage(100, 20, 0, 0));
        assert!(breakdown.is_none());
        // 日志成本注入路径同样不得崩溃，且保持 null（不以 0 冒充）
        let mut record = serde_json::json!({
            "model": "中文模型",
            "provider": "stub",
            "input_tokens": 100,
            "output_tokens": 20,
        });
        attach_log_costs(&mut record, &engine);
        assert!(record.get("cost").unwrap().is_null());
        assert!(record.get("cost_breakdown").unwrap().is_null());
    }

    #[test]
    fn builtin_exact_hits() {
        let price = builtin_price("claude-opus-4-5").unwrap();
        assert_eq!(price.currency, Currency::Usd);
        assert_eq!(price.input, 5.0);
        let deepseek = builtin_price("deepseek-chat").unwrap();
        assert_eq!(deepseek.currency, Currency::Cny);
        assert_eq!(deepseek.output, 8.0);
    }

    #[test]
    fn builtin_boundary_prefix_matches_with_explicit_boundary() {
        assert_eq!(
            builtin_price("claude-opus-4-5@20260101").unwrap().input,
            5.0
        );
        assert_eq!(builtin_price("gpt-4o:2024-11-20").unwrap().input, 2.5);
    }

    #[test]
    fn builtin_bedrock_style_ids_stay_unpriced() {
        // 键必须是候选的前缀；`anthropic.claude-*`（Bedrock 风格）不满足，
        // 保持未计价，交给用户在设置页显式覆盖 —— 宁可 null 不可错配。
        assert!(builtin_price("anthropic.claude-haiku-4-5").is_none());
        assert!(builtin_price("us.anthropic.claude-opus-4-5-v1:0").is_none());
    }

    #[test]
    fn builtin_dash_is_not_a_boundary() {
        // gpt-4o 不许吃掉 gpt-4o-xxx；glm-4.5 不许吃掉 glm-4.5-air
        assert!(builtin_price("gpt-4o-preview").is_none());
        assert!(builtin_price("gpt-4o-turbo").is_none());
        assert_ne!(
            builtin_price("glm-4.5-air").unwrap().input,
            builtin_price("glm-4.5").unwrap().input
        );
        assert_eq!(builtin_price("glm-4.5-air").unwrap().input, 0.8);
    }

    #[test]
    fn builtin_unknown_versions_and_variants_stay_unpriced() {
        // 点号曾是边界：gpt-5.2-pro 被 `gpt-5.2` 的 `-` 挡住后继续吃到
        // `gpt-5`（`.` 放行），以 $10 冒充官方 $168；gpt-5.4 同理套 gpt-5。
        // 未知版本/变体无显式条目时必须保持未计价。
        assert!(builtin_price("gpt-5.2-pro").is_none());
        assert!(builtin_price("gpt-5.4").is_none());
        assert!(builtin_price("gpt-5.3").is_none());
        assert!(builtin_price("gpt-4.1-nano").is_none());
        assert!(builtin_price("claude-sonnet-4-6").is_none());
        // 显式条目与日期别名不受影响：剥日期走候选轮，非边界轮
        let price = builtin_price("gpt-5.2-20241120").unwrap();
        assert_eq!(price.output, 14.0);
        assert_eq!(builtin_price("gpt-5.2:beta").unwrap().output, 14.0);
    }

    #[test]
    fn builtin_unknown_model_is_unpriced() {
        assert!(builtin_price("totally-unknown-model").is_none());
        assert!(builtin_price("").is_none());
    }

    #[test]
    fn builtin_gpt_5_2_is_priced_above_gpt_5_1() {
        // gpt-5.2 与 gpt-5.1/5 不同档（官方 $1.75/$14），曾误沿用 1.25/10
        let price = builtin_price("gpt-5.2").unwrap();
        assert_eq!(price.input, 1.75);
        assert_eq!(price.output, 14.0);
        assert_eq!(price.cache_read, 0.175);
        assert_ne!(price.input, builtin_price("gpt-5.1").unwrap().input);
    }

    #[test]
    fn resolve_prefers_scoped_then_global_then_builtin() {
        let mut config = BillingConfig::default();
        config.model_prices.insert(
            "stub-model".to_string(),
            crate::config::ModelPriceOverride {
                currency: "USD".to_string(),
                input: 1.0,
                output: 2.0,
                cache_read: 0.0,
                cache_creation: 0.0,
                label: Some("global".to_string()),
            },
        );
        config.model_prices.insert(
            "acme:stub-model".to_string(),
            crate::config::ModelPriceOverride {
                currency: "USD".to_string(),
                input: 10.0,
                output: 20.0,
                cache_read: 0.0,
                cache_creation: 0.0,
                label: Some("scoped".to_string()),
            },
        );
        let engine = PricingEngine::from_config(&config);

        let scoped = engine.resolve("stub-model", Some("acme")).unwrap();
        assert_eq!(scoped.source, PriceSource::Override);
        assert_eq!(scoped.price.input, 10.0);
        // 其他 provider 走全局覆盖
        let global = engine.resolve("stub-model", Some("other")).unwrap();
        assert_eq!(global.price.input, 1.0);
        // 覆盖键是精确匹配，不做模糊 —— 未覆盖的模型照走内置表
        let builtin_fallback = engine.resolve("gpt-4o", None).unwrap();
        assert_eq!(builtin_fallback.source, PriceSource::Builtin);
        assert_eq!(builtin_fallback.price.input, 2.5);
    }

    #[test]
    fn resolve_unknown_model_returns_none() {
        let engine = engine(None, &[]);
        assert!(engine.resolve("stub-model", None).is_none());
        assert!(engine.resolve("stub-model", Some("acme")).is_none());
    }

    #[test]
    fn compute_openai_style_usd_to_cny() {
        // gpt-4o：$2.5/$1M in、$10/$1M out、cached $1.25；汇率 7.0
        let engine = engine(Some("CNY"), &[("USD", 7.0)]);
        let breakdown = engine
            .compute("gpt-4o", None, &usage(1_000_000, 500_000, 0, 0))
            .unwrap();
        assert!((breakdown.input - 17.5).abs() < 1e-9); // 2.5 × 7
        assert!((breakdown.output - 35.0).abs() < 1e-9); // 10 × 0.5 × 7
        assert!((breakdown.total - 52.5).abs() < 1e-9);
    }

    #[test]
    fn compute_anthropic_style_subtracts_cache() {
        // 归一化后的 anthropic input = raw + cache_read + cache_creation
        let engine = engine(None, &[]); // CNY，USD→7.2
        let breakdown = engine
            .compute(
                "claude-opus-4-5",
                None,
                &usage(1_200_000, 100_000, 200_000, 0),
            )
            .unwrap();
        // billable = 1M × $5 = $5 → 36；out 100k × $25 = $2.5 → 18；cache 读 200k × $0.5 = $0.1 → 0.72
        assert!((breakdown.input - 36.0).abs() < 1e-9);
        assert!((breakdown.output - 18.0).abs() < 1e-9);
        assert!((breakdown.cache_read - 0.72).abs() < 1e-9);
        assert!((breakdown.cache_creation - 0.0).abs() < 1e-9);
        assert!((breakdown.total - 54.72).abs() < 1e-9);
    }

    #[test]
    fn compute_cache_never_inflates_billable_below_zero() {
        let engine = engine(None, &[]);
        // 异常数据：cache 之和超过 input，billable 钳到 0
        let breakdown = engine
            .compute("deepseek-chat", None, &usage(100_000, 0, 80_000, 80_000))
            .unwrap();
        assert_eq!(breakdown.input, 0.0);
        assert!((breakdown.cache_read - 0.04).abs() < 1e-9); // 80k × ¥0.5/M
        assert!((breakdown.cache_creation - 0.16).abs() < 1e-9); // 80k × ¥2/M
    }

    #[test]
    fn compute_free_model_costs_zero() {
        let engine = engine(None, &[]);
        let breakdown = engine
            .compute(
                "glm-4.5-flash",
                None,
                &usage(1_000_000, 1_000_000, 100_000, 0),
            )
            .unwrap();
        assert_eq!(breakdown.total, 0.0);
    }

    #[test]
    fn compute_returns_none_for_unknown_input_or_model() {
        let engine = engine(None, &[]);
        assert!(
            engine
                .compute(
                    "gpt-4o",
                    None,
                    &UsageTotals {
                        input: None,
                        output: Some(100),
                        cache_read: None,
                        cache_creation: None,
                        billable_input: None,
                    }
                )
                .is_none()
        );
        assert!(
            engine
                .compute("mystery-model", None, &usage(1, 1, 0, 0))
                .is_none()
        );
    }

    #[test]
    fn display_currency_defaults_to_cny_and_parses_case_insensitive() {
        assert_eq!(engine(None, &[]).display_currency(), Currency::Cny);
        assert_eq!(engine(Some("usd"), &[]).display_currency(), Currency::Usd);
        assert_eq!(engine(Some(" CNY "), &[]).display_currency(), Currency::Cny);
    }

    #[test]
    fn default_rates_depend_on_display_currency() {
        // CNY 展示：1 USD = 7.2 CNY
        assert!((engine(None, &[]).convert(1.0, Currency::Usd) - 7.2).abs() < 1e-9);
        // USD 展示：默认 1/7.2，用户覆盖可用 CNY 键
        let usd_display = engine(Some("USD"), &[("CNY", 0.125)]);
        assert!((usd_display.convert(8.0, Currency::Cny) - 1.0).abs() < 1e-9);
        assert!((usd_display.convert(1.0, Currency::Usd) - 1.0).abs() < 1e-9);
        // 未知币种按 1.0 兜底
        assert!((engine(None, &[("USD", 7.0)]).convert(1.0, Currency::Cny) - 1.0).abs() < 1e-9);
    }

    #[test]
    fn attach_log_costs_list_and_detail() {
        let engine = engine(Some("CNY"), &[("USD", 7.0)]);
        let mut list = serde_json::json!({
            "total": 2,
            "items": [
                { "id": 1, "provider": "acme", "model": "gpt-4o", "input_tokens": 1_000_000, "output_tokens": 0, "cache_read_tokens": null, "cache_creation_tokens": null },
                { "id": 2, "provider": "acme", "model": "mystery", "input_tokens": 5, "output_tokens": 5, "cache_read_tokens": null, "cache_creation_tokens": null }
            ]
        });
        attach_log_costs(&mut list, &engine);
        assert_eq!(list["cost_currency"], "CNY");
        assert!((list["items"][0]["cost"].as_f64().unwrap() - 17.5).abs() < 1e-9);
        assert!(
            (list["items"][0]["cost_breakdown"]["input"]
                .as_f64()
                .unwrap()
                - 17.5)
                .abs()
                < 1e-9
        );
        assert!(list["items"][1]["cost"].is_null());
        assert!(list["items"][1]["cost_breakdown"].is_null());

        let mut detail = serde_json::json!({
            "id": 1, "provider": "acme", "model": "gpt-4o", "input_tokens": 1_000_000, "output_tokens": 0
        });
        attach_log_costs(&mut detail, &engine);
        assert!((detail["cost"].as_f64().unwrap() - 17.5).abs() < 1e-9);
        assert_eq!(detail["cost_currency"], "CNY");
    }

    #[test]
    fn attach_log_costs_legacy_rows_price_cache_as_plain_input() {
        // 旧行只有 cached_tokens：不享 cache 折扣，按普通输入计价（略高）
        let engine = engine(None, &[]);
        let mut legacy = serde_json::json!({
            "id": 1, "provider": "acme", "model": "deepseek-chat",
            "input_tokens": 1_000_000, "output_tokens": 0, "cached_tokens": 400_000,
            "cache_read_tokens": null, "cache_creation_tokens": null
        });
        attach_log_costs(&mut legacy, &engine);
        let breakdown = &legacy["cost_breakdown"];
        assert!((breakdown["total"].as_f64().unwrap() - 2.0).abs() < 1e-9); // 全量 ¥2/M
        assert_eq!(breakdown["cacheRead"].as_f64().unwrap(), 0.0);
    }

    #[test]
    fn merged_table_lists_builtin_and_overrides() {
        let mut config = BillingConfig::default();
        config.model_prices.insert(
            "acme:stub-model".to_string(),
            crate::config::ModelPriceOverride {
                currency: "CNY".to_string(),
                input: 1.0,
                output: 1.0,
                cache_read: 0.0,
                cache_creation: 0.0,
                label: None,
            },
        );
        let engine = PricingEngine::from_config(&config);
        let table = engine.merged_table();
        let builtin_count = table
            .iter()
            .filter(|r| r.source == PriceSource::Builtin)
            .count();
        assert_eq!(builtin_count, BUILTIN_PRICES.len());
        let scoped = table.iter().find(|r| r.key == "acme:stub-model").unwrap();
        assert_eq!(scoped.source, PriceSource::Override);
        assert_eq!(scoped.scoped_provider.as_deref(), Some("acme"));
        assert_eq!(scoped.currency, Currency::Cny);
        // 排序稳定：内置段按键有序
        let builtin_keys: Vec<&str> = table
            .iter()
            .take(builtin_count)
            .map(|r| r.key.as_str())
            .collect();
        let mut sorted = builtin_keys.clone();
        sorted.sort();
        assert_eq!(builtin_keys, sorted);
    }

    #[test]
    fn builtin_table_has_no_duplicate_keys() {
        let mut seen = std::collections::HashSet::new();
        for entry in BUILTIN_PRICES {
            assert!(
                seen.insert(entry.model),
                "duplicate builtin key {}",
                entry.model
            );
            assert!(
                entry.price.input.is_finite()
                    && entry.price.output.is_finite()
                    && entry.price.cache_read.is_finite()
                    && entry.price.cache_creation.is_finite()
                    && entry.price.input >= 0.0
                    && entry.price.output >= 0.0
                    && entry.price.cache_read >= 0.0
                    && entry.price.cache_creation >= 0.0,
                "invalid builtin price for {}",
                entry.model
            );
        }
    }
}
