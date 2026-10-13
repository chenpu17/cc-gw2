//! Built-in provider preset templates — one-click provider creation in the
//! console's create dialog. This catalog is the single source of truth for
//! the web console and API consumers; applying a preset is client-side (it
//! fills the draft provider), there is no server-side apply route.
//!
//! Coding-plan endpoints verified 2026-10: the Anthropic-compatible surfaces
//! listed here speak `/v1/messages` only. Aliyun Bailian additionally has no
//! model-list route at all, so its preset carries `noModelProbe` and the
//! console skips the probe step.

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderPreset {
    pub id: &'static str,
    pub label: &'static str,
    pub description: &'static str,
    /// Provider type marker — doubles as the protocol hint for routing
    /// ("anthropic" prefers native Anthropic messages, "openai" chat).
    /// Serialized as `type` to match the ProviderConfig web contract.
    #[serde(rename = "type")]
    pub provider_type: &'static str,
    pub base_url: &'static str,
    /// Balance adapter id; None = the preset's balance is not queryable.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub balance_adapter: Option<&'static str>,
    /// True when the upstream has no model-list endpoint (probe would 404).
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub no_model_probe: bool,
    /// Suggested starter models; empty = discover via probe or fill manually.
    pub default_models: &'static [&'static str],
}

pub fn provider_presets() -> Vec<ProviderPreset> {
    PRESETS.to_vec()
}

static PRESETS: &[ProviderPreset] = &[
    ProviderPreset {
        id: "opencode-zen",
        label: "OpenCode Zen",
        description: "Anthropic 兼容端点，面向编码代理的精选模型（常含免费档）",
        provider_type: "anthropic",
        base_url: "https://opencode.ai/api/anthropic",
        balance_adapter: None,
        no_model_probe: false,
        default_models: &[],
    },
    ProviderPreset {
        id: "volcano-coding",
        label: "火山方舟 Coding Plan",
        description: "字节火山方舟 Coding 套餐，Anthropic 兼容端点",
        provider_type: "anthropic",
        base_url: "https://ark.cn-beijing.volces.com/api/coding",
        balance_adapter: None,
        no_model_probe: false,
        default_models: &[],
    },
    ProviderPreset {
        id: "zhipu",
        label: "智谱 GLM",
        description: "智谱开放平台 Anthropic 兼容端点",
        provider_type: "anthropic",
        base_url: "https://open.bigmodel.cn/api/anthropic",
        balance_adapter: None,
        no_model_probe: false,
        default_models: &[],
    },
    ProviderPreset {
        id: "aliyun-bailian",
        label: "阿里云百炼",
        description: "阿里云百炼 Anthropic 兼容端点；无模型列表接口，需手动填模型",
        provider_type: "anthropic",
        base_url: "https://dashscope.aliyuncs.com/apps/anthropic",
        balance_adapter: None,
        no_model_probe: true,
        default_models: &[],
    },
    ProviderPreset {
        id: "kimi",
        label: "Kimi (Moonshot)",
        description: "月之暗面开放平台，OpenAI 兼容端点，支持余额查询",
        provider_type: "openai",
        base_url: "https://api.moonshot.cn/v1",
        balance_adapter: Some("moonshot"),
        no_model_probe: false,
        default_models: &[],
    },
    ProviderPreset {
        id: "deepseek",
        label: "DeepSeek",
        description: "DeepSeek 开放平台，OpenAI 兼容端点，支持余额查询",
        provider_type: "openai",
        base_url: "https://api.deepseek.com/v1",
        balance_adapter: Some("deepseek"),
        no_model_probe: false,
        default_models: &[],
    },
    ProviderPreset {
        id: "siliconflow",
        label: "硅基流动",
        description: "SiliconFlow 聚合平台，OpenAI 兼容端点，支持余额查询",
        provider_type: "openai",
        base_url: "https://api.siliconflow.cn/v1",
        balance_adapter: Some("siliconflow"),
        no_model_probe: false,
        default_models: &[],
    },
    ProviderPreset {
        id: "openrouter",
        label: "OpenRouter",
        description: "OpenRouter 聚合平台，OpenAI 兼容端点，支持额度查询",
        provider_type: "openai",
        base_url: "https://openrouter.ai/api/v1",
        balance_adapter: Some("openrouter"),
        no_model_probe: false,
        default_models: &[],
    },
];

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preset_catalog_is_well_formed() {
        let presets = provider_presets();
        assert_eq!(presets.len(), 8, "catalog size pinned");
        for preset in &presets {
            assert!(!preset.id.is_empty() && !preset.label.is_empty());
            assert!(preset.base_url.starts_with("https://"));
            assert!(
                preset.provider_type == "anthropic" || preset.provider_type == "openai",
                "{} has unexpected type {}",
                preset.id,
                preset.provider_type
            );
            if let Some(adapter) = preset.balance_adapter {
                assert!(crate::balance::BALANCE_ADAPTERS.contains(&adapter));
            }
        }
        // Only Aliyun Bailian is known to lack a model-list endpoint.
        let no_probe: Vec<&str> = presets
            .iter()
            .filter(|preset| preset.no_model_probe)
            .map(|preset| preset.id)
            .collect();
        assert_eq!(no_probe, vec!["aliyun-bailian"]);
    }
}
