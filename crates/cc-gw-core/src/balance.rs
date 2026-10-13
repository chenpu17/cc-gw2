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

use crate::config::ProviderConfig;
use crate::provider::ProviderProtocol;

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
    let adapter = provider.balance_adapter.as_deref().ok_or_else(|| {
        format!("Provider {} 未配置余额适配器，无法查询余额", provider.id)
    })?;
    if !BALANCE_ADAPTERS.contains(&adapter) {
        return Err(format!("未知余额适配器: {adapter}"));
    }
    // Key selection mirrors request routing: the active named key wins over
    // the legacy `api_key`.
    let view = provider.effective_for_protocol(ProviderProtocol::OpenAiChatCompletions);
    let api_key = view
        .api_key
        .clone()
        .ok_or_else(|| format!("Provider {} 未配置 API Key，无法查询余额", provider.id))?;
    let base = view.base_url.trim_end_matches('/');

    let (path, normalizer): (&str, fn(&Value) -> Option<String>) = match adapter {
        "deepseek" => ("/user/balance", normalize_deepseek),
        "moonshot" => ("/users/me/balance", normalize_moonshot),
        "siliconflow" => ("/user/info", normalize_siliconflow),
        "openrouter" => ("/key", normalize_openrouter),
        other => return Err(format!("未知余额适配器: {other}")),
    };

    let response = client
        .get(format!("{base}{path}"))
        .header("authorization", format!("Bearer {api_key}"))
        .timeout(Duration::from_secs(10))
        .send()
        .await
        .map_err(|error| format!("余额查询请求失败: {error}"))?;
    let status = response.status();
    let raw: Value = response
        .json()
        .await
        .map_err(|error| format!("余额响应解析失败: {error}"))?;
    if !status.is_success() {
        let body = raw.to_string();
        let body: String = body.chars().take(300).collect();
        return Err(format!(
            "余额查询失败 (HTTP {}): {body}",
            status.as_u16()
        ));
    }

    Ok(BalanceSnapshot {
        adapter: adapter.to_string(),
        provider_id: provider.id.clone(),
        fetched_at: chrono::Utc::now().timestamp_millis(),
        display: normalizer(&raw),
        raw,
    })
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

/// Moonshot `/v1/users/me/balance` → `available_balance`, e.g. "-0.76 CNY".
pub fn normalize_moonshot(raw: &Value) -> Option<String> {
    let amount = raw.get("available_balance")?.as_str()?;
    let currency = raw
        .get("balance_infos")
        .and_then(Value::as_array)
        .and_then(|infos| infos.first())
        .and_then(|info| info.get("currency"))
        .and_then(Value::as_str)
        .unwrap_or("CNY");
    Some(format!("{amount} {currency}"))
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
        assert_eq!(
            normalize_deepseek(&deepseek).as_deref(),
            Some("110.00 CNY")
        );

        let moonshot = serde_json::json!({
            "available_balance": "-0.76",
            "balance_infos": [{"total_balance": "0.00", "currency": "CNY"}]
        });
        assert_eq!(
            normalize_moonshot(&moonshot).as_deref(),
            Some("-0.76 CNY")
        );

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
        assert_eq!(normalize_siliconflow(&serde_json::json!({})), None);
        assert_eq!(normalize_openrouter(&serde_json::json!({})), None);
    }
}
