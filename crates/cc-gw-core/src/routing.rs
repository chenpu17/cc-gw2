use anyhow::{Result, bail};
use std::collections::HashSet;

use crate::{
    config::{
        CustomEndpointConfig, EndpointRoutingConfig, GatewayConfig, ModelRouteMap, ProviderConfig,
    },
    health::FailoverPolicy,
    provider::ProviderProtocol,
};

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

/// A resolved route with its full failover candidate chain.
///
/// Non-aggregate paths always carry exactly one candidate and `failover:
/// None`. Aggregated models expand to their member backends in priority
/// order; `failover` carries the model's parsed policy so the proxy loop can
/// record failures and skip cooling backends.
#[derive(Debug, Clone)]
pub struct RoutePlan {
    pub candidates: Vec<RouteTarget>,
    pub failover: Option<FailoverPolicy>,
}

impl RoutePlan {
    pub fn primary(&self) -> &RouteTarget {
        &self.candidates[0]
    }
}

/// Why [`resolve_route`] settled on a target. Surfaced by the routing
/// "hit simulation" admin endpoint so operators can see which rule fired.
/// Serialized as `{"kind": "<camelCase variant>", "<camelCase fields>"}` for the
/// web console.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum RouteMatchReason {
    /// Matched an explicit `model_routes` entry (exact or wildcard), possibly
    /// after expanding a model alias (e.g. `claude-sonnet-latest`).
    ModelRoute { via_alias: bool },
    /// Requested model resolved directly against a configured provider.
    DirectMatch,
    /// Endpoint reasoning (thinking) default.
    ThinkingDefault,
    /// Long-context background default — the request exceeded the threshold.
    LongContextDefault {
        token_estimate: usize,
        threshold: u64,
    },
    /// Endpoint completion default.
    CompletionDefault,
    /// Global routing fallback (`enable_routing_fallback`).
    Fallback,
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

fn find_mapped_identifier(model_id: Option<&str>, routes: &ModelRouteMap) -> Option<String> {
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
        let provider_id = provider_id.trim();
        let provider = providers
            .iter()
            .find(|provider| provider.id == provider_id)?;
        let model_id = model_id.trim();
        let resolved_model = if model_id == "*" {
            let requested_model = requested_model?.trim();
            if requested_model.is_empty() {
                return None;
            }
            requested_model.to_string()
        } else if let Some(resolved_model) = resolve_provider_model(provider, model_id) {
            resolved_model
        } else {
            if model_id.is_empty() {
                return None;
            }
            model_id.to_string()
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

pub fn find_custom_endpoint<'a>(
    config: &'a GatewayConfig,
    id: &str,
) -> Option<&'a CustomEndpointConfig> {
    config
        .custom_endpoints
        .iter()
        .find(|endpoint| endpoint.id == id)
}

pub fn endpoint_routing<'a>(
    config: &'a GatewayConfig,
    endpoint: GatewayEndpoint<'_>,
    protocol: ProviderProtocol,
) -> Option<&'a EndpointRoutingConfig> {
    let _ = protocol;
    match endpoint {
        GatewayEndpoint::Anthropic => config.endpoint_routing.get("anthropic"),
        GatewayEndpoint::OpenAi => config.endpoint_routing.get("openai"),
        // Custom endpoints must carry their own routing (on the endpoint itself
        // or keyed by id in `endpoint_routing`). They deliberately do NOT
        // inherit the global anthropic/openai routing table — an unconfigured
        // endpoint must reject requests rather than silently route them
        // through the default endpoint's rules.
        GatewayEndpoint::Custom(id) => find_custom_endpoint(config, id)
            .and_then(|endpoint| endpoint.routing.as_ref())
            .or_else(|| config.endpoint_routing.get(id)),
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
            serde_json::Value::Object(map) => {
                // base64 image/document payloads massively inflate the estimate
                // and can silently reroute model-less requests to the long-context
                // default. Skip the `source` blob of such blocks (it carries the
                // base64 data, not prompt text).
                let block_type = map.get("type").and_then(serde_json::Value::as_str);
                if matches!(block_type, Some("image") | Some("document")) {
                    map.iter()
                        .filter(|(k, _)| *k != "source")
                        .map(|(_, v)| walk(v))
                        .sum()
                } else {
                    map.values().map(walk).sum()
                }
            }
        }
    }

    walk(request_body)
}

pub fn resolve_route(
    config: &GatewayConfig,
    endpoint: GatewayEndpoint<'_>,
    protocol: ProviderProtocol,
    request_body: &serde_json::Value,
    requested_model: Option<&str>,
    thinking: bool,
) -> Result<RouteTarget> {
    Ok(resolve_route_plan(
        config,
        endpoint,
        protocol,
        request_body,
        requested_model,
        thinking,
    )?
    .primary()
    .clone())
}

/// Same resolution as [`resolve_route`] but also reports which rule fired —
/// used by the routing "hit simulation" admin endpoint.
pub fn resolve_route_with_reason(
    config: &GatewayConfig,
    endpoint: GatewayEndpoint<'_>,
    protocol: ProviderProtocol,
    request_body: &serde_json::Value,
    requested_model: Option<&str>,
    thinking: bool,
) -> Result<(RouteTarget, RouteMatchReason)> {
    let (plan, reason) = resolve_route_plan_with_reason(
        config,
        endpoint,
        protocol,
        request_body,
        requested_model,
        thinking,
    )?;
    Ok((plan.primary().clone(), reason))
}

/// Resolve a route into its full failover candidate chain: aggregated models
/// expand to their ordered member backends, everything else yields a
/// single-candidate plan.
pub fn resolve_route_plan(
    config: &GatewayConfig,
    endpoint: GatewayEndpoint<'_>,
    protocol: ProviderProtocol,
    request_body: &serde_json::Value,
    requested_model: Option<&str>,
    thinking: bool,
) -> Result<RoutePlan> {
    Ok(resolve_route_inner(
        config,
        endpoint,
        protocol,
        request_body,
        requested_model,
        thinking,
    )?
    .0)
}

/// Same resolution as [`resolve_route_plan`] but also reports which rule
/// fired — powers the routing simulator's candidate-chain display.
pub fn resolve_route_plan_with_reason(
    config: &GatewayConfig,
    endpoint: GatewayEndpoint<'_>,
    protocol: ProviderProtocol,
    request_body: &serde_json::Value,
    requested_model: Option<&str>,
    thinking: bool,
) -> Result<(RoutePlan, RouteMatchReason)> {
    resolve_route_inner(
        config,
        endpoint,
        protocol,
        request_body,
        requested_model,
        thinking,
    )
}

/// Expand a resolved target into a [`RoutePlan`]: aggregated models expand to
/// their member backends in priority order (unresolvable members skipped,
/// duplicates dropped), everything else stays a single candidate.
fn expand_route_plan(target: RouteTarget, providers: &[ProviderConfig]) -> Result<RoutePlan> {
    if !target.provider.is_aggregate() {
        return Ok(RoutePlan {
            candidates: vec![target],
            failover: None,
        });
    }

    let model = target
        .provider
        .models
        .iter()
        .find(|model| model.id == target.model_id);

    let mut seen = HashSet::new();
    let mut candidates = Vec::new();
    if let Some(model) = model {
        for member in model.members.as_deref().unwrap_or(&[]) {
            // `providerId:*` resolves to the aggregate model's own id, so a
            // member can reference "the same-named model on that provider".
            let Some(member_target) =
                resolve_by_identifier(&member.target, providers, Some(&target.model_id))
            else {
                continue;
            };
            // Nested aggregates are rejected at save time; skip as a runtime
            // guard for hand-edited configs.
            if member_target.provider.is_aggregate() {
                continue;
            }
            if seen.insert((
                member_target.provider_id.clone(),
                member_target.model_id.clone(),
            )) {
                candidates.push(member_target);
            }
        }
    }

    if candidates.is_empty() {
        bail!(
            "聚合模型 {} 的后端成员均不可用，请检查聚合 Provider 的成员配置",
            target.model_id
        );
    }

    let failover = model.map(|model| FailoverPolicy::from_config(model.failover.as_ref()));
    Ok(RoutePlan {
        candidates,
        failover,
    })
}

fn resolve_route_inner(
    config: &GatewayConfig,
    endpoint: GatewayEndpoint<'_>,
    protocol: ProviderProtocol,
    request_body: &serde_json::Value,
    requested_model: Option<&str>,
    thinking: bool,
) -> Result<(RoutePlan, RouteMatchReason)> {
    let providers = &config.providers;
    if providers.is_empty() {
        bail!("未配置任何模型提供商，请先在 Web UI 中添加 Provider。");
    }

    let endpoint_config =
        endpoint_routing(config, endpoint, protocol).ok_or_else(|| match endpoint {
            GatewayEndpoint::Custom(id) => anyhow::anyhow!(
                "自定义端点 {id} 未配置路由规则，请在 Web UI 中为该端点设置模型路由或默认规则。"
            ),
            _ => anyhow::anyhow!("未找到端点路由配置"),
        })?;

    // 1) explicit model_routes match (exact or wildcard), optionally via alias
    let (mapped_identifier, via_alias) =
        match find_mapped_identifier(requested_model, &endpoint_config.model_routes) {
            Some(id) => (Some(id), false),
            None => match requested_model.and_then(|model| {
                apply_model_alias(model).and_then(|alias| {
                    find_mapped_identifier(Some(alias.as_str()), &endpoint_config.model_routes)
                })
            }) {
                Some(id) => (Some(id), true),
                None => (None, false),
            },
        };
    if let Some(mapped_identifier) = mapped_identifier {
        if let Some(target) = resolve_by_identifier(&mapped_identifier, providers, requested_model)
        {
            return Ok((
                expand_route_plan(target, providers)?,
                RouteMatchReason::ModelRoute { via_alias },
            ));
        }
    }

    // 2) requested model resolves directly against a provider
    if let Some(requested_model) = requested_model {
        if let Some(target) =
            resolve_by_identifier(requested_model, providers, Some(requested_model))
        {
            return Ok((
                expand_route_plan(target, providers)?,
                RouteMatchReason::DirectMatch,
            ));
        }
    }

    // 3) reasoning (thinking) default
    if thinking {
        if let Some(reasoning) = endpoint_config.defaults.reasoning.as_deref() {
            if let Some(target) = resolve_by_identifier(reasoning, providers, requested_model) {
                return Ok((
                    expand_route_plan(target, providers)?,
                    RouteMatchReason::ThinkingDefault,
                ));
            }
        }
    }

    // 4) long-context background default
    let token_estimate = estimate_token_budget(request_body);
    let threshold = endpoint_config.defaults.long_context_threshold;
    if token_estimate > threshold as usize {
        if let Some(background) = endpoint_config.defaults.background.as_deref() {
            if let Some(target) = resolve_by_identifier(background, providers, requested_model) {
                return Ok((
                    expand_route_plan(target, providers)?,
                    RouteMatchReason::LongContextDefault {
                        token_estimate,
                        threshold,
                    },
                ));
            }
        }
    }

    // 5) completion default
    if let Some(completion) = endpoint_config.defaults.completion.as_deref() {
        if let Some(target) = resolve_by_identifier(completion, providers, requested_model) {
            return Ok((
                expand_route_plan(target, providers)?,
                RouteMatchReason::CompletionDefault,
            ));
        }
    }

    // 6) global routing fallback
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

        let target = RouteTarget {
            provider: provider.clone(),
            provider_id: provider.id.clone(),
            model_id,
        };
        return Ok((
            expand_route_plan(target, providers)?,
            RouteMatchReason::Fallback,
        ));
    }

    bail!("未找到匹配模型，请在请求中指定模型或在配置中启用回退策略。")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{
        AggregateMemberConfig, CustomEndpointConfig, DefaultsConfig, EndpointPathConfig,
        ProviderModelConfig,
    };
    use serde_json::json;

    fn provider(id: &str, model: &str) -> ProviderConfig {
        ProviderConfig {
            id: id.to_string(),
            label: id.to_string(),
            base_url: format!("https://{id}.example.com"),
            default_model: Some(model.to_string()),
            models: vec![ProviderModelConfig {
                id: model.to_string(),
                label: None,
                ..Default::default()
            }],
            provider_type: Some("openai".to_string()),
            ..ProviderConfig::default()
        }
    }

    #[test]
    fn custom_endpoint_uses_its_own_routing_before_global_defaults() {
        let mut config = GatewayConfig::default();
        config.providers = vec![provider("alpha", "glm-4.7"), provider("beta", "glm-5")];
        config
            .endpoint_routing
            .get_mut("openai")
            .unwrap()
            .defaults
            .completion = Some("alpha:glm-4.7".to_string());
        config.custom_endpoints.push(CustomEndpointConfig {
            id: "team".to_string(),
            label: "Team".to_string(),
            enabled: Some(true),
            paths: vec![EndpointPathConfig {
                path: "/team".to_string(),
                protocol: "openai-chat".to_string(),
            }],
            routing: Some(EndpointRoutingConfig {
                defaults: DefaultsConfig {
                    completion: Some("beta:glm-5".to_string()),
                    ..DefaultsConfig::default()
                },
                model_routes: Default::default(),
                compatibility: None,
            }),
            ..CustomEndpointConfig::default()
        });

        let route = resolve_route(
            &config,
            GatewayEndpoint::Custom("team"),
            ProviderProtocol::OpenAiChatCompletions,
            &json!({ "messages": [] }),
            None,
            false,
        )
        .expect("resolve custom route");

        assert_eq!(route.provider_id, "beta");
        assert_eq!(route.model_id, "glm-5");
    }

    #[test]
    fn custom_endpoint_without_routing_is_rejected() {
        // Custom endpoints must NOT fall back to the global protocol defaults:
        // an unconfigured endpoint rejects the request instead of silently
        // routing it through the default endpoint's rules.
        let mut config = GatewayConfig::default();
        config.providers = vec![
            provider("anthropic-default", "claude-x"),
            provider("openai-default", "glm-5"),
        ];
        config
            .endpoint_routing
            .get_mut("anthropic")
            .unwrap()
            .defaults
            .completion = Some("anthropic-default:claude-x".to_string());
        config
            .endpoint_routing
            .get_mut("openai")
            .unwrap()
            .defaults
            .completion = Some("openai-default:glm-5".to_string());
        config.custom_endpoints.push(CustomEndpointConfig {
            id: "one".to_string(),
            label: "One".to_string(),
            enabled: Some(true),
            paths: vec![EndpointPathConfig {
                path: "/one".to_string(),
                protocol: "openai-chat".to_string(),
            }],
            ..CustomEndpointConfig::default()
        });

        let error = resolve_route(
            &config,
            GatewayEndpoint::Custom("one"),
            ProviderProtocol::OpenAiChatCompletions,
            &json!({ "messages": [] }),
            None,
            false,
        )
        .expect_err("unconfigured custom endpoint must be rejected");

        assert!(
            error.to_string().contains("自定义端点 one 未配置路由规则"),
            "unexpected error: {error}"
        );
    }

    #[test]
    fn wildcard_routes_keep_configured_order_when_specificity_ties() {
        let mut config = GatewayConfig::default();
        config.providers = vec![provider("alpha", "gpt-4o"), provider("beta", "gpt-4o")];
        let anthropic = config.endpoint_routing.get_mut("anthropic").unwrap();
        anthropic
            .model_routes
            .insert("gpt-4*".to_string(), "alpha:gpt-4o".to_string());
        anthropic
            .model_routes
            .insert("gpt-*o".to_string(), "beta:gpt-4o".to_string());

        let route = resolve_route(
            &config,
            GatewayEndpoint::Anthropic,
            ProviderProtocol::AnthropicMessages,
            &json!({ "messages": [] }),
            Some("gpt-4o"),
            false,
        )
        .expect("resolve wildcard route");

        assert_eq!(route.provider_id, "alpha");
        assert_eq!(route.model_id, "gpt-4o");
    }

    #[test]
    fn provider_qualified_route_can_target_unregistered_model() {
        let mut config = GatewayConfig::default();
        config.providers = vec![ProviderConfig {
            id: "mock-openai".to_string(),
            label: "Mock OpenAI".to_string(),
            base_url: "https://mock-openai.example.com".to_string(),
            provider_type: Some("openai".to_string()),
            ..ProviderConfig::default()
        }];
        config
            .endpoint_routing
            .get_mut("openai")
            .unwrap()
            .model_routes
            .insert(
                "client-model-a".to_string(),
                "mock-openai:upstream-model-b".to_string(),
            );

        let route = resolve_route(
            &config,
            GatewayEndpoint::OpenAi,
            ProviderProtocol::OpenAiChatCompletions,
            &json!({ "messages": [] }),
            Some("client-model-a"),
            false,
        )
        .expect("resolve explicit route target");

        assert_eq!(route.provider_id, "mock-openai");
        assert_eq!(route.model_id, "upstream-model-b");
    }

    #[test]
    fn provider_qualified_route_trims_provider_and_model_target_before_resolution() {
        let mut config = GatewayConfig::default();
        config.providers = vec![provider("mock-openai", "upstream-model-b")];
        config
            .endpoint_routing
            .get_mut("openai")
            .unwrap()
            .model_routes
            .insert(
                "client-model-a".to_string(),
                " mock-openai : * ".to_string(),
            );

        let route = resolve_route(
            &config,
            GatewayEndpoint::OpenAi,
            ProviderProtocol::OpenAiChatCompletions,
            &json!({ "messages": [] }),
            Some("client-model-a"),
            false,
        )
        .expect("resolve wildcard route target");

        assert_eq!(route.provider_id, "mock-openai");
        assert_eq!(route.model_id, "client-model-a");
    }

    #[test]
    fn route_reason_reports_model_route_match() {
        let mut config = GatewayConfig::default();
        config.providers = vec![provider("alpha", "gpt-4o"), provider("beta", "glm-5")];
        let anthropic = config.endpoint_routing.get_mut("anthropic").unwrap();
        anthropic
            .model_routes
            .insert("gpt-4o".to_string(), "alpha:gpt-4o".to_string());

        let (target, reason) = resolve_route_with_reason(
            &config,
            GatewayEndpoint::Anthropic,
            ProviderProtocol::AnthropicMessages,
            &json!({ "messages": [] }),
            Some("gpt-4o"),
            false,
        )
        .expect("resolve model-route match");

        assert_eq!(target.provider_id, "alpha");
        assert_eq!(target.model_id, "gpt-4o");
        assert!(matches!(
            reason,
            RouteMatchReason::ModelRoute { via_alias: false }
        ));
    }

    #[test]
    fn route_reason_reports_model_route_via_alias() {
        // claude-sonnet-latest aliases to a concrete version; mapping that
        // concrete id should report ModelRoute with via_alias = true and must
        // win over a direct provider match (step 1 precedes step 2).
        let mut config = GatewayConfig::default();
        config.providers = vec![provider("anthropic", "claude-sonnet-4-5-20250929")];
        let anthropic = config.endpoint_routing.get_mut("anthropic").unwrap();
        anthropic.model_routes.insert(
            "claude-sonnet-4-5-20250929".to_string(),
            "anthropic:claude-sonnet-4-5-20250929".to_string(),
        );

        let (target, reason) = resolve_route_with_reason(
            &config,
            GatewayEndpoint::Anthropic,
            ProviderProtocol::AnthropicMessages,
            &json!({ "messages": [] }),
            Some("claude-sonnet-latest"),
            false,
        )
        .expect("resolve aliased model-route");

        assert_eq!(target.provider_id, "anthropic");
        assert!(matches!(
            reason,
            RouteMatchReason::ModelRoute { via_alias: true }
        ));
    }

    #[test]
    fn route_reason_reports_direct_match() {
        let mut config = GatewayConfig::default();
        config.providers = vec![provider("alpha", "gpt-4o")];

        let (target, reason) = resolve_route_with_reason(
            &config,
            GatewayEndpoint::Anthropic,
            ProviderProtocol::AnthropicMessages,
            &json!({ "messages": [] }),
            Some("gpt-4o"),
            false,
        )
        .expect("resolve direct match");

        assert_eq!(target.provider_id, "alpha");
        assert!(matches!(reason, RouteMatchReason::DirectMatch));
    }

    #[test]
    fn route_reason_reports_thinking_default() {
        let mut config = GatewayConfig::default();
        config.providers = vec![provider("alpha", "gpt-4o")];
        config
            .endpoint_routing
            .get_mut("anthropic")
            .unwrap()
            .defaults
            .reasoning = Some("alpha:gpt-4o".to_string());

        let (target, reason) = resolve_route_with_reason(
            &config,
            GatewayEndpoint::Anthropic,
            ProviderProtocol::AnthropicMessages,
            &json!({ "messages": [] }),
            None,
            true,
        )
        .expect("resolve thinking default");

        assert_eq!(target.provider_id, "alpha");
        assert!(matches!(reason, RouteMatchReason::ThinkingDefault));
    }

    #[test]
    fn route_reason_reports_long_context_default() {
        let mut config = GatewayConfig::default();
        config.providers = vec![provider("alpha", "gpt-4o")];
        let anthropic = config.endpoint_routing.get_mut("anthropic").unwrap();
        anthropic.defaults.background = Some("alpha:gpt-4o".to_string());
        anthropic.defaults.long_context_threshold = 10;

        // A body large enough that estimate_token_budget clears the low threshold.
        let big_body = json!({ "messages": [{ "role": "user", "content": "x".repeat(200) }] });

        let (target, reason) = resolve_route_with_reason(
            &config,
            GatewayEndpoint::Anthropic,
            ProviderProtocol::AnthropicMessages,
            &big_body,
            None,
            false,
        )
        .expect("resolve long-context default");

        assert_eq!(target.provider_id, "alpha");
        match reason {
            RouteMatchReason::LongContextDefault {
                token_estimate,
                threshold,
            } => {
                assert!(
                    token_estimate > 10,
                    "token estimate should exceed threshold"
                );
                assert_eq!(threshold, 10);
            }
            other => panic!("expected LongContextDefault, got {other:?}"),
        }
    }

    #[test]
    fn route_reason_reports_completion_default() {
        let mut config = GatewayConfig::default();
        config.providers = vec![provider("alpha", "gpt-4o")];
        config
            .endpoint_routing
            .get_mut("openai")
            .unwrap()
            .defaults
            .completion = Some("alpha:gpt-4o".to_string());

        let (target, reason) = resolve_route_with_reason(
            &config,
            GatewayEndpoint::OpenAi,
            ProviderProtocol::OpenAiChatCompletions,
            &json!({ "messages": [] }),
            None,
            false,
        )
        .expect("resolve completion default");

        assert_eq!(target.provider_id, "alpha");
        assert!(matches!(reason, RouteMatchReason::CompletionDefault));
    }

    #[test]
    fn route_reason_reports_global_fallback() {
        let mut config = GatewayConfig::default();
        config.providers = vec![provider("alpha", "gpt-4o")];
        config.enable_routing_fallback = Some(true);

        let (target, reason) = resolve_route_with_reason(
            &config,
            GatewayEndpoint::Anthropic,
            ProviderProtocol::AnthropicMessages,
            &json!({ "messages": [] }),
            Some("does-not-exist"),
            false,
        )
        .expect("resolve fallback");

        assert_eq!(target.provider_id, "alpha");
        assert!(matches!(reason, RouteMatchReason::Fallback));
    }

    #[test]
    fn reason_serializes_camel_case_on_the_wire() {
        // The web console reads variant names AND struct-variant fields as
        // camelCase (see POST /api/routing/simulate + types/routing.ts). Both
        // rename rules must hold, or the UI silently reads `undefined`.
        let model_route = serde_json::to_string(&RouteMatchReason::ModelRoute { via_alias: true })
            .expect("serialize model route");
        assert_eq!(model_route, r#"{"kind":"modelRoute","viaAlias":true}"#);

        let long_context = serde_json::to_string(&RouteMatchReason::LongContextDefault {
            token_estimate: 12_000,
            threshold: 10_000,
        })
        .expect("serialize long context");
        assert_eq!(
            long_context,
            r#"{"kind":"longContextDefault","tokenEstimate":12000,"threshold":10000}"#
        );

        assert_eq!(
            serde_json::to_string(&RouteMatchReason::Fallback).unwrap(),
            r#"{"kind":"fallback"}"#
        );
    }

    fn aggregate_provider(id: &str, model: &str, targets: &[&str]) -> ProviderConfig {
        ProviderConfig {
            id: id.to_string(),
            label: id.to_string(),
            provider_type: Some(crate::config::AGGREGATE_PROVIDER_TYPE.to_string()),
            models: vec![ProviderModelConfig {
                id: model.to_string(),
                label: None,
                members: Some(
                    targets
                        .iter()
                        .map(|target| AggregateMemberConfig {
                            target: target.to_string(),
                        })
                        .collect(),
                ),
                ..ProviderModelConfig::default()
            }],
            ..ProviderConfig::default()
        }
    }

    #[test]
    fn aggregate_model_expands_to_ordered_candidates() {
        let mut config = GatewayConfig::default();
        config.providers = vec![
            aggregate_provider("team", "glm-5.1", &["p2:gpt-4o", "p1:glm-4.7"]),
            provider("p1", "glm-4.7"),
            provider("p2", "gpt-4o"),
        ];

        let plan = resolve_route_plan(
            &config,
            GatewayEndpoint::OpenAi,
            ProviderProtocol::OpenAiChatCompletions,
            &json!({ "messages": [] }),
            Some("glm-5.1"),
            false,
        )
        .expect("expand aggregate model");

        assert_eq!(plan.candidates.len(), 2);
        assert_eq!(plan.candidates[0].provider_id, "p2");
        assert_eq!(plan.candidates[0].model_id, "gpt-4o");
        assert_eq!(plan.candidates[1].provider_id, "p1");
        assert_eq!(plan.candidates[1].model_id, "glm-4.7");
        assert_eq!(plan.failover, Some(FailoverPolicy::default()));

        // The legacy single-target API keeps returning the first candidate.
        let target = resolve_route(
            &config,
            GatewayEndpoint::OpenAi,
            ProviderProtocol::OpenAiChatCompletions,
            &json!({ "messages": [] }),
            Some("glm-5.1"),
            false,
        )
        .expect("resolve aggregate primary");
        assert_eq!(target.provider_id, "p2");
    }

    #[test]
    fn aggregate_wildcard_member_uses_aggregate_model_id() {
        let mut config = GatewayConfig::default();
        config.providers = vec![
            aggregate_provider("team", "glm-5.1", &["p1:*"]),
            provider("p1", "glm-4.7"),
        ];

        let plan = resolve_route_plan(
            &config,
            GatewayEndpoint::OpenAi,
            ProviderProtocol::OpenAiChatCompletions,
            &json!({ "messages": [] }),
            Some("glm-5.1"),
            false,
        )
        .expect("expand wildcard member");

        assert_eq!(plan.candidates.len(), 1);
        assert_eq!(plan.candidates[0].provider_id, "p1");
        assert_eq!(plan.candidates[0].model_id, "glm-5.1");
    }

    #[test]
    fn aggregate_dangling_and_duplicate_members_are_handled() {
        let mut config = GatewayConfig::default();
        config.providers = vec![
            aggregate_provider("team", "glm-5.1", &["p1:glm-4.7", "gone:m", "p1:glm-4.7"]),
            provider("p1", "glm-4.7"),
        ];

        // Unresolvable members are skipped; duplicates keep first occurrence.
        let plan = resolve_route_plan(
            &config,
            GatewayEndpoint::OpenAi,
            ProviderProtocol::OpenAiChatCompletions,
            &json!({ "messages": [] }),
            Some("glm-5.1"),
            false,
        )
        .expect("expand with dangling member");
        assert_eq!(plan.candidates.len(), 1);
        assert_eq!(plan.candidates[0].provider_id, "p1");

        // Every member dangling -> explicit error instead of silent misroute.
        config.providers = vec![
            aggregate_provider("team", "glm-5.1", &["gone-a:m", "gone-b:m"]),
            provider("p1", "glm-4.7"),
        ];
        let error = resolve_route_plan(
            &config,
            GatewayEndpoint::OpenAi,
            ProviderProtocol::OpenAiChatCompletions,
            &json!({ "messages": [] }),
            Some("glm-5.1"),
            false,
        )
        .expect_err("all members dangling");
        assert!(
            error
                .to_string()
                .contains("聚合模型 glm-5.1 的后端成员均不可用"),
            "unexpected error: {error}"
        );
    }

    #[test]
    fn non_aggregate_routes_stay_single_candidate() {
        let mut config = GatewayConfig::default();
        config.providers = vec![provider("p1", "glm-4.7")];

        let plan = resolve_route_plan(
            &config,
            GatewayEndpoint::OpenAi,
            ProviderProtocol::OpenAiChatCompletions,
            &json!({ "messages": [] }),
            Some("glm-4.7"),
            false,
        )
        .expect("resolve non-aggregate");

        assert_eq!(plan.candidates.len(), 1);
        assert_eq!(plan.failover, None);
    }
}
