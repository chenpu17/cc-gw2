//! Pluggable balance/quota adapters: fetch the remaining balance of an
//! upstream provider account from the provider's own dashboard API. 0.15 is
//! manual-refresh only — the server exposes a refresh endpoint and keeps the
//! latest snapshot in runtime state (nothing persisted, nothing scheduled).
//!
//! Adapter ids double as `ProviderConfig::balance_adapter` values and are
//! validated by `GatewayConfig::validate_for_save`.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::time::Duration;

use crate::config::{ProviderConfig, effective_provider_key};

pub const BALANCE_ADAPTERS: [&str; 4] = ["deepseek", "moonshot", "siliconflow", "openrouter"];

/// Latest balance reading for one provider. `raw` keeps a defensive copy of
/// the upstream response for the console detail view; `display` is the
/// normalized one-line amount (None when the shape wasn't recognized).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BalanceSnapshot {
    pub adapter: String,
    pub provider_id: String,
    pub fetched_at: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display: Option<String>,
    pub raw: Value,
}

/// Fetch the provider's balance using its configured adapter. The effective
/// named key (multi-key aware) authenticates; the primary base URL hosts the
/// dashboard route.
pub async fn fetch_balance(
    client: &reqwest::Client,
    provider: &ProviderConfig,
) -> Result<BalanceSnapshot, String> {
    let adapter = provider
        .balance_adapter
        .as_deref()
        .ok_or_else(|| format!("Provider {} 未配置余额适配器，无法查询余额", provider.id))?;
    if !BALANCE_ADAPTERS.contains(&adapter) {
        return Err(format!("未知余额适配器: {adapter}"));
    }
    // Key selection mirrors request routing: the active named key wins over
    // the legacy `api_key`. The dashboard route always lives on the primary
    // surface — a protocol-matched mirror endpoint would not host it.
    let api_key = effective_provider_key(&provider.keys)
        .map(|key| key.value.clone())
        .or_else(|| provider.api_key.clone())
        .ok_or_else(|| format!("Provider {} 未配置 API Key，无法查询余额", provider.id))?;

    let normalizer: fn(&Value) -> Option<String> = match adapter {
        "deepseek" => normalize_deepseek,
        "moonshot" => normalize_moonshot,
        "siliconflow" => normalize_siliconflow,
        "openrouter" => normalize_openrouter,
        other => return Err(format!("未知余额适配器: {other}")),
    };
    let url = balance_url(adapter, &provider.base_url)?;

    let response = client
        .get(url)
        .header("authorization", format!("Bearer {api_key}"))
        .timeout(Duration::from_secs(10))
        .send()
        .await
        .map_err(|error| format!("余额查询请求失败: {error}"))?;
    // Read the body as text first: error intermediaries answer 502/504 with
    // HTML, and a blind `.json()` would swallow the status code.
    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(|error| format!("余额响应读取失败: {error}"))?;
    if !status.is_success() {
        let body: String = text.chars().take(300).collect();
        return Err(format!("余额查询失败 (HTTP {}): {body}", status.as_u16()));
    }
    let raw: Value =
        serde_json::from_str(&text).map_err(|error| format!("余额响应解析失败: {error}"))?;

    Ok(BalanceSnapshot {
        adapter: adapter.to_string(),
        provider_id: provider.id.clone(),
        fetched_at: chrono::Utc::now().timestamp_millis(),
        display: normalizer(&raw),
        raw,
    })
}

/// Dashboard URL for `adapter` off the provider's primary `base`. Chat
/// routing (`resolve_endpoint`) appends `/v1` when a base carries no version
/// segment; balance paths mirror that so hand-typed bases like
/// `https://api.moonshot.cn` still land on `/v1/users/me/balance`. DeepSeek
/// is the exception: its dashboard route sits on the bare host.
pub fn balance_url(adapter: &str, base: &str) -> std::result::Result<String, String> {
    let base = base.trim_end_matches('/');
    Ok(match adapter {
        "deepseek" => {
            let host_base = base.strip_suffix("/v1").unwrap_or(base);
            format!("{host_base}/user/balance")
        }
        "moonshot" => format!("{}/users/me/balance", versioned_base(base)),
        "siliconflow" => format!("{}/user/info", versioned_base(base)),
        "openrouter" => format!("{}/key", versioned_base(base)),
        other => return Err(format!("未知余额适配器: {other}")),
    })
}

fn versioned_base(base: &str) -> String {
    if base.ends_with("/v1") {
        base.to_string()
    } else {
        format!("{base}/v1")
    }
}

/// DeepSeek `/user/balance` → sum of `balance_infos[].total_balance` per
/// currency, e.g. "110.00 CNY".
pub fn normalize_deepseek(raw: &Value) -> Option<String> {
    let infos = raw.get("balance_infos")?.as_array()?;
    let mut parts = Vec::new();
    for info in infos {
        let amount = info.get("total_balance")?.as_str()?;
        let currency = info.get("currency").and_then(Value::as_str).unwrap_or("");
        if currency.is_empty() {
            parts.push(amount.to_string());
        } else {
            parts.push(format!("{amount} {currency}"));
        }
    }
    if parts.is_empty() {
        return None;
    }
    Some(parts.join(" / "))
}

/// Moonshot `/v1/users/me/balance` → `data.available_balance`，e.g. "49.59 CNY"。
/// 官方结构：`code=0` + `data.{available_balance, voucher_balance, cash_balance}`
/// （数字类型，platform.moonshot.cn/docs/api/balance）；`code != 0` 或结构
/// 不符 → None。
pub fn normalize_moonshot(raw: &Value) -> Option<String> {
    let code = raw.get("code").and_then(Value::as_i64);
    if code.is_some_and(|code| code != 0) {
        return None;
    }
    let amount = raw.get("data")?.get("available_balance")?.as_f64()?;
    Some(format!("{amount:.2} CNY"))
}

/// SiliconFlow `/v1/user/info` → `data.balance`, e.g. "9.76 CNY".
pub fn normalize_siliconflow(raw: &Value) -> Option<String> {
    let amount = raw.get("data")?.get("balance")?.as_str()?;
    Some(format!("{amount} CNY"))
}

/// OpenRouter `/api/v1/key` → `data.usage / data.limit` (limit null =
/// unlimited), e.g. "3.20 / 50.00 USD".
pub fn normalize_openrouter(raw: &Value) -> Option<String> {
    let data = raw.get("data")?;
    let usage = data.get("usage").and_then(Value::as_f64)?;
    let limit = match data.get("limit") {
        None | Some(Value::Null) => None,
        Some(value) => Some(value.as_f64()?),
    };
    Some(match limit {
        Some(limit) => format!("{usage:.2} / {limit:.2} USD"),
        None => format!("{usage:.2} USD (无额度上限)"),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_each_adapter_shape() {
        let deepseek = serde_json::json!({
            "is_available": true,
            "balance_infos": [
                {"total_balance": "110.00", "currency": "CNY"}
            ]
        });
        assert_eq!(normalize_deepseek(&deepseek).as_deref(), Some("110.00 CNY"));

        // Moonshot 官方结构：code=0 + data.available_balance 数字
        // （platform.moonshot.cn/docs/api/balance 示例）
        let moonshot = serde_json::json!({
            "code": 0,
            "data": {
                "available_balance": 49.58894,
                "voucher_balance": 46.58893,
                "cash_balance": 3.00001
            }
        });
        assert_eq!(normalize_moonshot(&moonshot).as_deref(), Some("49.59 CNY"));

        let siliconflow = serde_json::json!({
            "code": 20000,
            "status": true,
            "data": {"id": "sf-user", "balance": "9.76"}
        });
        assert_eq!(
            normalize_siliconflow(&siliconflow).as_deref(),
            Some("9.76 CNY")
        );

        let openrouter_limited = serde_json::json!({
            "data": {"usage": 3.204, "limit": 50.0}
        });
        assert_eq!(
            normalize_openrouter(&openrouter_limited).as_deref(),
            Some("3.20 / 50.00 USD")
        );

        let openrouter_unlimited = serde_json::json!({
            "data": {"usage": 1.5, "limit": null}
        });
        assert_eq!(
            normalize_openrouter(&openrouter_unlimited).as_deref(),
            Some("1.50 USD (无额度上限)")
        );
    }

    #[test]
    fn normalizers_return_none_on_unrecognized_shapes() {
        assert_eq!(normalize_deepseek(&serde_json::json!({})), None);
        assert_eq!(normalize_moonshot(&serde_json::json!({})), None);
        assert_eq!(normalize_moonshot(&serde_json::json!({"code": 0})), None);
        // 业务失败：code != 0 视为不可用，即使带数据
        assert_eq!(
            normalize_moonshot(&serde_json::json!({
                "code": 1001,
                "data": {"available_balance": 49.58894}
            })),
            None
        );
        assert_eq!(normalize_siliconflow(&serde_json::json!({})), None);
        assert_eq!(normalize_openrouter(&serde_json::json!({})), None);
    }

    #[test]
    fn moonshot_official_shape_covers_zero_and_negative() {
        let zero = serde_json::json!({
            "code": 0,
            "data": {"available_balance": 0.0, "voucher_balance": 0.0, "cash_balance": 0.0}
        });
        assert_eq!(normalize_moonshot(&zero).as_deref(), Some("0.00 CNY"));
        let negative = serde_json::json!({
            "code": 0,
            "data": {"available_balance": -0.76}
        });
        assert_eq!(normalize_moonshot(&negative).as_deref(), Some("-0.76 CNY"));
    }

    #[test]
    fn derives_balance_urls_across_base_shapes() {
        // Preset bases ship /v1; hand-typed bases may omit it — versioned
        // adapters append it, DeepSeek strips it back to the bare host.
        assert_eq!(
            balance_url("deepseek", "https://api.deepseek.com/v1").as_deref(),
            Ok("https://api.deepseek.com/user/balance")
        );
        assert_eq!(
            balance_url("deepseek", "https://api.deepseek.com").as_deref(),
            Ok("https://api.deepseek.com/user/balance")
        );
        assert_eq!(
            balance_url("moonshot", "https://api.moonshot.cn/v1/").as_deref(),
            Ok("https://api.moonshot.cn/v1/users/me/balance")
        );
        assert_eq!(
            balance_url("moonshot", "https://api.moonshot.cn").as_deref(),
            Ok("https://api.moonshot.cn/v1/users/me/balance")
        );
        assert_eq!(
            balance_url("siliconflow", "https://api.siliconflow.cn").as_deref(),
            Ok("https://api.siliconflow.cn/v1/user/info")
        );
        assert_eq!(
            balance_url("openrouter", "https://openrouter.ai/api/v1").as_deref(),
            Ok("https://openrouter.ai/api/v1/key")
        );
        assert!(balance_url("unknown", "https://example.com").is_err());
    }
}
