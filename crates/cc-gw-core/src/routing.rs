use std::collections::HashMap;

use anyhow::{Result, bail};

use crate::config::{EndpointRoutingConfig, GatewayConfig, ProviderConfig};

#[derive(Debug, Clone, Copy)]
pub enum GatewayEndpoint<'a> {
    Anthropic,
    OpenAi,
    Custom(&'a str),
}

#[derive(Debug, Clone)]
pub struct RouteTarget {
    pub provider: ProviderConfig,
    pub provider_id: String,
    pub model_id: String,
}

fn apply_model_alias(model: &str) -> Option<String> {
    let trimmed = model.trim();
    if trimmed.is_empty() {
        return None;
    }

    let lower = trimmed.to_lowercase();
    let alias = match lower.as_str() {
        "claude-sonnet-4-5" | "claude-sonnet-4-5-preview" | "claude-sonnet-latest" => {
            Some("claude-sonnet-4-5-20250929")
        }
        "claude-3-5-sonnet-latest" => Some("claude-3-5-sonnet-20241022"),
        "claude-haiku-4-5" | "claude-haiku-4-5-20250929" | "claude-haiku-latest" => {
            Some("claude-haiku-4-5-20251001")
        }
        "claude-3-5-haiku-latest" => Some("claude-3-5-haiku-20241022"),
        _ => None,
    };

    if let Some(alias) = alias {
        return Some(alias.to_string());
    }

    if lower.starts_with("gpt-5") && lower.contains("-codex") && lower != "gpt-5-codex" {
        return Some("gpt-5-codex".to_string());
    }

    None
}

fn escape_regex(pattern: &str) -> String {
    regex::escape(pattern)
}

fn wildcard_matches(pattern: &str, value: &str) -> bool {
    let regex = format!(
        "^{}$",
        pattern
            .split('*')
            .map(escape_regex)
            .collect::<Vec<_>>()
            .join(".*")
    );
    regex::Regex::new(&regex)
        .map(|compiled| compiled.is_match(value))
        .unwrap_or(false)
}

fn find_mapped_identifier(
    model_id: Option<&str>,
    routes: &HashMap<String, String>,
) -> Option<String> {
    let model_id = model_id?.trim();
    if model_id.is_empty() {
        return None;
    }

    if let Some(target) = routes.get(model_id) {
        return Some(target.clone());
    }

    let mut best_target: Option<String> = None;
    let mut best_specificity = 0usize;

    for (pattern, target) in routes {
        if !pattern.contains('*') {
            continue;
        }
        if !wildcard_matches(pattern, model_id) {
            continue;
        }
        let specificity = pattern.replace('*', "").len();
        if best_target.is_none() || specificity > best_specificity {
            best_target = Some(target.clone());
            best_specificity = specificity;
        }
    }

    best_target
}

fn provider_has_model(provider: &ProviderConfig, model_id: &str) -> bool {
    provider.default_model.as_deref() == Some(model_id)
        || provider.models.iter().any(|model| model.id == model_id)
}

fn resolve_provider_model(provider: &ProviderConfig, requested_model: &str) -> Option<String> {
    if provider_has_model(provider, requested_model) {
        return Some(requested_model.to_string());
    }

    if let Some(alias) = apply_model_alias(requested_model) {
        if provider_has_model(provider, &alias) {
            return Some(alias);
        }
    }

    None
}

fn resolve_by_identifier(
    identifier: &str,
    providers: &[ProviderConfig],
    requested_model: Option<&str>,
) -> Option<RouteTarget> {
    if let Some((provider_id, model_id)) = identifier.split_once(':') {
        let provider = providers
            .iter()
            .find(|provider| provider.id == provider_id)?;
        let resolved_model = if model_id == "*" {
            requested_model?.trim().to_string()
        } else {
            resolve_provider_model(provider, model_id)?
        };

        return Some(RouteTarget {
            provider: provider.clone(),
            provider_id: provider.id.clone(),
            model_id: resolved_model,
        });
    }

    for provider in providers {
        if let Some(resolved_model) = resolve_provider_model(provider, identifier) {
            return Some(RouteTarget {
                provider: provider.clone(),
                provider_id: provider.id.clone(),
                model_id: resolved_model,
            });
        }
    }

    None
}

fn endpoint_routing<'a>(
    config: &'a GatewayConfig,
    endpoint: GatewayEndpoint<'_>,
) -> Option<&'a EndpointRoutingConfig> {
    match endpoint {
        GatewayEndpoint::Anthropic => config.endpoint_routing.get("anthropic"),
        GatewayEndpoint::OpenAi => config.endpoint_routing.get("openai"),
        GatewayEndpoint::Custom(id) => config.endpoint_routing.get(id),
    }
}

fn estimate_token_budget(request_body: &serde_json::Value) -> usize {
    fn walk(value: &serde_json::Value) -> usize {
        match value {
            serde_json::Value::Null => 0,
            serde_json::Value::Bool(_) => 1,
            serde_json::Value::Number(_) => 2,
            serde_json::Value::String(text) => text.len() / 4 + 1,
            serde_json::Value::Array(values) => values.iter().map(walk).sum(),
            serde_json::Value::Object(map) => map.values().map(walk).sum(),
        }
    }

    walk(request_body)
}

pub fn resolve_route(
    config: &GatewayConfig,
    endpoint: GatewayEndpoint<'_>,
    request_body: &serde_json::Value,
    requested_model: Option<&str>,
    thinking: bool,
) -> Result<RouteTarget> {
    let providers = &config.providers;
    if providers.is_empty() {
        bail!("未配置任何模型提供商，请先在 Web UI 中添加 Provider。");
    }

    let endpoint_config = endpoint_routing(config, endpoint)
        .or_else(|| config.endpoint_routing.get("anthropic"))
        .ok_or_else(|| anyhow::anyhow!("未找到端点路由配置"))?;

    if let Some(mapped_identifier) =
        find_mapped_identifier(requested_model, &endpoint_config.model_routes).or_else(|| {
            apply_model_alias(requested_model.unwrap_or_default()).and_then(|alias| {
                find_mapped_identifier(Some(alias.as_str()), &endpoint_config.model_routes)
            })
        })
    {
        if let Some(target) = resolve_by_identifier(&mapped_identifier, providers, requested_model)
        {
            return Ok(target);
        }
    }

    if let Some(requested_model) = requested_model {
        if let Some(target) =
            resolve_by_identifier(requested_model, providers, Some(requested_model))
        {
            return Ok(target);
        }
    }

    if thinking {
        if let Some(reasoning) = endpoint_config.defaults.reasoning.as_deref() {
            if let Some(target) = resolve_by_identifier(reasoning, providers, requested_model) {
                return Ok(target);
            }
        }
    }

    let token_estimate = estimate_token_budget(request_body);
    if token_estimate > endpoint_config.defaults.long_context_threshold as usize {
        if let Some(background) = endpoint_config.defaults.background.as_deref() {
            if let Some(target) = resolve_by_identifier(background, providers, requested_model) {
                return Ok(target);
            }
        }
    }

    if let Some(completion) = endpoint_config.defaults.completion.as_deref() {
        if let Some(target) = resolve_by_identifier(completion, providers, requested_model) {
            return Ok(target);
        }
    }

    if config.enable_routing_fallback.unwrap_or(false) {
        let provider = providers
            .iter()
            .find(|provider| provider.default_model.is_some() || !provider.models.is_empty())
            .ok_or_else(|| {
                anyhow::anyhow!("未配置任何模型，请在 Web UI 中为至少一个 Provider 添加模型。")
            })?;

        let model_id = provider
            .default_model
            .clone()
            .or_else(|| provider.models.first().map(|model| model.id.clone()))
            .ok_or_else(|| anyhow::anyhow!("Provider {} 未配置任何模型", provider.id))?;

        return Ok(RouteTarget {
            provider: provider.clone(),
            provider_id: provider.id.clone(),
            model_id,
        });
    }

    bail!("未找到匹配模型，请在请求中指定模型或在配置中启用回退策略。")
}
