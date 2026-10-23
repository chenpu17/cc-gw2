use std::collections::{BTreeMap, BTreeSet};

use serde::Serialize;

use crate::{
    config::GatewayConfig,
    provider::ProviderProtocol,
    routing::{GatewayEndpoint, endpoint_routing, resolve_by_identifier},
};

#[derive(Debug, Clone, Serialize)]
pub struct ModelEntry {
    pub id: String,
    pub object: &'static str,
    pub created: i64,
    pub owned_by: &'static str,
    pub permission: Vec<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<serde_json::Value>,
}

pub fn build_models_response(config: &GatewayConfig, endpoint_id: &str) -> Vec<ModelEntry> {
    let endpoint = match endpoint_id {
        "anthropic" => GatewayEndpoint::Anthropic,
        "openai" => GatewayEndpoint::OpenAi,
        id => GatewayEndpoint::Custom(id),
    };
    build_models_response_for_endpoint(config, endpoint, ProviderProtocol::OpenAiChatCompletions)
}

pub fn build_models_response_for_endpoint(
    config: &GatewayConfig,
    endpoint: GatewayEndpoint<'_>,
    protocol: ProviderProtocol,
) -> Vec<ModelEntry> {
    let now = chrono::Utc::now().timestamp();
    let mut models = BTreeMap::<String, BTreeSet<String>>::new();

    // The listing is strictly endpoint-scoped: only models declared by this
    // endpoint's own routing surface (model_routes sources, plus the targets
    // its defaults resolve to) are exposed. Provider inventories are NOT
    // merged in — a custom endpoint must not advertise models that belong
    // to the rest of the gateway.
    if let Some(routing) = endpoint_routing(config, endpoint, protocol) {
        // Shared routes plus the protocol-family map for this request surface.
        // A unified endpoint branches by protocol, so each surface advertises
        // only the sources that are routable over that protocol.
        for (source, target) in routing
            .model_routes
            .iter()
            .chain(routing.model_routes_by_protocol.for_protocol(protocol))
        {
            if !source.trim().is_empty() {
                models
                    .entry(source.trim().to_string())
                    .or_default()
                    .insert(target.clone());
            }
        }
        for default in [
            routing.defaults.completion.as_deref(),
            routing.defaults.reasoning.as_deref(),
            routing.defaults.background.as_deref(),
        ]
        .into_iter()
        .flatten()
        {
            // Resolve through the same lookup routing uses so the listing
            // reflects what the endpoint would actually forward to. Wildcard
            // targets (`provider:*`) have no concrete model without a
            // requested-model context and resolve to None here.
            if let Some(target) = resolve_by_identifier(default, &config.providers, None, None) {
                models
                    .entry(target.model_id.clone())
                    .or_default()
                    .insert(format!("{}:{}", target.provider_id, target.model_id));
            }
        }
    }

    models
        .into_iter()
        .map(|(id, routes)| ModelEntry {
            id,
            object: "model",
            created: now,
            owned_by: "gateway",
            permission: Vec::new(),
            metadata: Some(serde_json::json!({
                "routes": routes.into_iter().map(|target| serde_json::json!({ "target": target })).collect::<Vec<_>>()
            })),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{
        CustomEndpointConfig, EndpointPathConfig, EndpointRoutingConfig, ProviderConfig,
        ProviderModelConfig,
    };

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

    fn entry_ids(entries: &[ModelEntry]) -> Vec<&str> {
        entries.iter().map(|entry| entry.id.as_str()).collect()
    }

    #[test]
    fn models_listing_is_endpoint_scoped() {
        let mut config = GatewayConfig::default();
        config.providers = vec![provider("alpha", "glm-4.7"), provider("beta", "glm-5")];
        let openai = config.endpoint_routing.get_mut("openai").unwrap();
        openai
            .model_routes
            .insert("openai-only".to_string(), "alpha:glm-4.7".to_string());
        openai.defaults.completion = Some("beta:glm-5".to_string());

        let entries = build_models_response(&config, "openai");
        // Route sources plus defaults-resolved targets — never the raw
        // provider inventory ("glm-4.7" only appears via its route source).
        assert_eq!(entry_ids(&entries), vec!["glm-5", "openai-only"]);

        // The anthropic endpoint shares none of the openai routing.
        assert!(build_models_response(&config, "anthropic").is_empty());
    }

    #[test]
    fn wildcard_default_target_is_not_listed() {
        let mut config = GatewayConfig::default();
        config.providers = vec![provider("alpha", "glm-4.7")];
        let openai = config.endpoint_routing.get_mut("openai").unwrap();
        openai.defaults.completion = Some("alpha:*".to_string());
        openai
            .model_routes
            .insert("routed".to_string(), "alpha:glm-4.7".to_string());

        let entries = build_models_response(&config, "openai");
        assert_eq!(entry_ids(&entries), vec!["routed"]);
    }

    #[test]
    fn custom_endpoint_listing_excludes_unrelated_models() {
        let mut config = GatewayConfig::default();
        config.providers = vec![provider("alpha", "glm-4.7")];
        config
            .endpoint_routing
            .get_mut("openai")
            .unwrap()
            .model_routes
            .insert("openai-visible".to_string(), "alpha:glm-4.7".to_string());
        config.custom_endpoints.push(CustomEndpointConfig {
            id: "team".to_string(),
            label: "Team".to_string(),
            enabled: Some(true),
            paths: vec![EndpointPathConfig {
                path: "/team".to_string(),
                protocol: "openai-chat".to_string(),
            }],
            routing: Some(EndpointRoutingConfig {
                model_routes: [("team-visible".to_string(), "alpha:glm-4.7".to_string())]
                    .into_iter()
                    .collect(),
                ..EndpointRoutingConfig::default()
            }),
            ..CustomEndpointConfig::default()
        });
        config.custom_endpoints.push(CustomEndpointConfig {
            id: "bare".to_string(),
            label: "Bare".to_string(),
            enabled: Some(true),
            paths: vec![EndpointPathConfig {
                path: "/bare".to_string(),
                protocol: "openai-chat".to_string(),
            }],
            ..CustomEndpointConfig::default()
        });

        let entries = build_models_response(&config, "team");
        assert_eq!(entry_ids(&entries), vec!["team-visible"]);

        // No routing configured → nothing routable, so nothing advertised
        // (provider inventory must not leak in as a fallback).
        let entries = build_models_response(&config, "bare");
        assert!(entries.is_empty());
    }

    #[test]
    fn protocol_scoped_sources_are_listed_per_surface() {
        let mut config = GatewayConfig::default();
        config.providers = vec![provider("alpha", "a-model"), provider("beta", "b-model")];
        let mut routing = EndpointRoutingConfig {
            model_routes: [("shared-source".to_string(), "alpha:a-model".to_string())]
                .into_iter()
                .collect(),
            ..EndpointRoutingConfig::default()
        };
        routing
            .model_routes_by_protocol
            .anthropic
            .insert("claude-source".to_string(), "alpha:a-model".to_string());
        routing
            .model_routes_by_protocol
            .openai
            .insert("gpt-source".to_string(), "beta:b-model".to_string());
        config.custom_endpoints.push(CustomEndpointConfig {
            id: "unified".to_string(),
            label: "Unified".to_string(),
            enabled: Some(true),
            paths: vec![
                EndpointPathConfig {
                    path: "/unified".to_string(),
                    protocol: "anthropic".to_string(),
                },
                EndpointPathConfig {
                    path: "/unified".to_string(),
                    protocol: "openai-auto".to_string(),
                },
            ],
            routing: Some(routing),
            ..CustomEndpointConfig::default()
        });

        let anthropic = build_models_response_for_endpoint(
            &config,
            GatewayEndpoint::Custom("unified"),
            ProviderProtocol::AnthropicMessages,
        );
        assert_eq!(
            entry_ids(&anthropic),
            vec!["claude-source", "shared-source"]
        );

        // Both OpenAI wire formats share the openai family map.
        for protocol in [
            ProviderProtocol::OpenAiChatCompletions,
            ProviderProtocol::OpenAiResponses,
        ] {
            let openai = build_models_response_for_endpoint(
                &config,
                GatewayEndpoint::Custom("unified"),
                protocol,
            );
            assert_eq!(entry_ids(&openai), vec!["gpt-source", "shared-source"]);
        }
    }
}
