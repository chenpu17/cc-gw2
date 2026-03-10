use std::collections::{BTreeMap, BTreeSet};

use serde::Serialize;

use crate::config::GatewayConfig;

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
    let now = chrono::Utc::now().timestamp();
    let mut models = BTreeMap::<String, BTreeSet<String>>::new();

    if let Some(routing) = config.endpoint_routing.get(endpoint_id) {
        for (source, target) in &routing.model_routes {
            if !source.trim().is_empty() {
                models
                    .entry(source.trim().to_string())
                    .or_default()
                    .insert(target.clone());
            }
        }
    }

    for provider in &config.providers {
        if let Some(default_model) = provider.default_model.as_deref() {
            models
                .entry(default_model.to_string())
                .or_default()
                .insert(format!("{}:{}", provider.id, default_model));
        }
        for model in &provider.models {
            models
                .entry(model.id.clone())
                .or_default()
                .insert(format!("{}:{}", provider.id, model.id));
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
