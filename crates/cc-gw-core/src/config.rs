use std::collections::{HashMap, HashSet};
use std::env;
use std::ffi::OsString;
use std::fs;
use std::path::PathBuf;

use anyhow::{Context, Result, bail};
use indexmap::IndexMap;
use serde::{Deserialize, Serialize};

pub const DEFAULT_HOST: &str = "127.0.0.1";
pub const DEFAULT_PORT: u16 = 4100;
pub const DEFAULT_HTTPS_PORT: u16 = 4443;
pub const DEFAULT_BODY_LIMIT: u64 = 10 * 1024 * 1024;

#[derive(Debug, Clone)]
pub struct GatewayPaths {
    pub home_dir: PathBuf,
    pub config_path: PathBuf,
    pub data_dir: PathBuf,
    pub db_path: PathBuf,
    pub log_dir: PathBuf,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct ProviderModelConfig {
    pub id: String,
    pub label: Option<String>,
    pub non_stream_via_stream: Option<bool>,
    /// Ordered backends backing this model. Only meaningful (and only valid)
    /// on models of `aggregate` providers — array order = failover priority.
    pub members: Option<Vec<AggregateMemberConfig>>,
    /// Failover policy override for aggregated models.
    pub failover: Option<FailoverPolicyConfig>,
}

/// Provider type marker for virtual providers that never forward requests
/// themselves: each of their models is an aggregated model mapping a public
/// model id to an ordered list of real upstream backends.
pub const AGGREGATE_PROVIDER_TYPE: &str = "aggregate";

/// One real backend of an aggregated model. `target` uses the same identifier
/// syntax as route targets: `providerId:modelId` or `providerId:*` (the
/// aggregate model's own id on that provider). Array order = priority.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(default, rename_all = "camelCase")]
pub struct AggregateMemberConfig {
    pub target: String,
}

/// Failover policy for an aggregated model. All fields optional — defaults
/// live in `cc_gw_core::health::FailoverPolicy` (3 / 900s / 600s / common
/// auth+rate-limit+5xx codes; transport errors always count).
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(default, rename_all = "camelCase")]
pub struct FailoverPolicyConfig {
    pub consecutive_failures: Option<u32>,
    pub cooldown_seconds: Option<u64>,
    pub failure_window_seconds: Option<u64>,
    /// Upstream status codes counting as backend failures, e.g. "401"/"5xx".
    pub trigger_status_codes: Option<Vec<String>>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct RoutingPreset {
    pub name: String,
    pub model_routes: ModelRouteMap,
    pub created_at: i64,
}

pub type ModelRouteMap = IndexMap<String, String>;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct EndpointPathConfig {
    pub path: String,
    pub protocol: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct CustomEndpointConfig {
    pub id: String,
    pub label: String,
    pub deletable: Option<bool>,
    pub paths: Vec<EndpointPathConfig>,
    pub path: Option<String>,
    pub protocol: Option<String>,
    pub enabled: Option<bool>,
    pub routing: Option<EndpointRoutingConfig>,
    pub routing_presets: Vec<RoutingPreset>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct ProviderConfig {
    pub id: String,
    pub label: String,
    pub base_url: String,
    pub api_key: Option<String>,
    pub auth_mode: Option<String>,
    pub default_model: Option<String>,
    pub non_stream_via_stream: Option<bool>,
    pub use_absolute_url: Option<bool>,
    /// When true, inject `stream_options.include_usage` on Anthropic→OpenAI
    /// streaming requests so the upstream returns a terminal usage chunk.
    /// Opt-in: some OpenAI-compatible upstreams reject/truncate the stream
    /// when they see it, yielding an empty response.
    pub stream_usage: Option<bool>,
    /// Per-minute upstream request cap for this provider; None or 0 = unlimited.
    /// When reached, further requests are held in queue (see `ratelimit`) until
    /// a window slot frees, instead of letting the upstream return 429.
    pub rpm_limit: Option<u32>,
    /// Max seconds a request may be held once the RPM cap is reached;
    /// None = 30s default. Beyond it the request is rejected with 429 + Retry-After.
    pub rpm_max_wait_seconds: Option<u64>,
    pub models: Vec<ProviderModelConfig>,
    pub extra_headers: HashMap<String, String>,
    #[serde(rename = "type")]
    pub provider_type: Option<String>,
}

impl ProviderConfig {
    /// Aggregate providers are virtual: they carry aggregated models that
    /// expand to real backends during routing and never forward requests.
    pub fn is_aggregate(&self) -> bool {
        self.provider_type.as_deref() == Some(AGGREGATE_PROVIDER_TYPE)
    }
}

impl Default for ProviderConfig {
    fn default() -> Self {
        Self {
            id: String::new(),
            label: String::new(),
            base_url: String::new(),
            api_key: None,
            auth_mode: None,
            default_model: None,
            non_stream_via_stream: None,
            use_absolute_url: None,
            stream_usage: None,
            rpm_limit: None,
            rpm_max_wait_seconds: None,
            models: Vec::new(),
            extra_headers: HashMap::new(),
            provider_type: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct DefaultsConfig {
    pub completion: Option<String>,
    pub reasoning: Option<String>,
    pub background: Option<String>,
    pub long_context_threshold: u64,
}

impl Default for DefaultsConfig {
    fn default() -> Self {
        Self {
            completion: None,
            reasoning: None,
            background: None,
            long_context_threshold: 60_000,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct EndpointCompatibilityConfig {
    pub enabled: bool,
}

impl Default for EndpointCompatibilityConfig {
    fn default() -> Self {
        Self { enabled: false }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct EndpointRoutingConfig {
    pub defaults: DefaultsConfig,
    pub model_routes: ModelRouteMap,
    pub compatibility: Option<EndpointCompatibilityConfig>,
}

impl Default for EndpointRoutingConfig {
    fn default() -> Self {
        Self {
            defaults: DefaultsConfig::default(),
            model_routes: Default::default(),
            compatibility: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct HttpConfig {
    pub enabled: bool,
    pub port: u16,
    pub host: Option<String>,
}

impl Default for HttpConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            port: DEFAULT_PORT,
            host: Some(DEFAULT_HOST.to_string()),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct HttpsConfig {
    pub enabled: bool,
    pub port: u16,
    pub host: Option<String>,
    pub key_path: String,
    pub cert_path: String,
    pub ca_path: Option<String>,
}

impl Default for HttpsConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            port: DEFAULT_HTTPS_PORT,
            host: Some(DEFAULT_HOST.to_string()),
            key_path: String::new(),
            cert_path: String::new(),
            ca_path: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct WebAuthConfig {
    pub enabled: bool,
    pub username: Option<String>,
    pub password_hash: Option<String>,
    pub password_salt: Option<String>,
}

impl Default for WebAuthConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            username: None,
            password_hash: None,
            password_salt: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct GatewayConfig {
    pub http: Option<HttpConfig>,
    pub https: Option<HttpsConfig>,
    pub port: Option<u16>,
    pub host: Option<String>,
    pub providers: Vec<ProviderConfig>,
    pub defaults: DefaultsConfig,
    pub enable_routing_fallback: Option<bool>,
    pub log_retention_days: Option<u32>,
    pub log_export_timeout_seconds: Option<u32>,
    /// 流式转发逐 chunk 空闲超时（秒）：上游在流中途长时间不发送任何
    /// 字节时主动终止，避免挂起的流永久占用请求槽位。默认 300。
    pub upstream_stream_idle_timeout_seconds: Option<u64>,
    pub model_routes: ModelRouteMap,
    pub endpoint_routing: HashMap<String, EndpointRoutingConfig>,
    pub custom_endpoints: Vec<CustomEndpointConfig>,
    pub routing_presets: HashMap<String, Vec<RoutingPreset>>,
    pub store_request_payloads: Option<bool>,
    pub store_response_payloads: Option<bool>,
    pub store_payloads: Option<bool>,
    pub log_level: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub request_logging: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub response_logging: Option<bool>,
    pub body_limit: Option<u64>,
    pub web_auth: Option<WebAuthConfig>,
}

impl Default for GatewayConfig {
    fn default() -> Self {
        let defaults = DefaultsConfig::default();
        let mut endpoint_routing = HashMap::new();
        endpoint_routing.insert(
            "anthropic".to_string(),
            EndpointRoutingConfig {
                defaults: defaults.clone(),
                model_routes: Default::default(),
                compatibility: None,
            },
        );
        endpoint_routing.insert(
            "openai".to_string(),
            EndpointRoutingConfig {
                defaults: defaults.clone(),
                model_routes: Default::default(),
                compatibility: None,
            },
        );

        Self {
            http: Some(HttpConfig::default()),
            https: Some(HttpsConfig::default()),
            port: Some(DEFAULT_PORT),
            host: Some(DEFAULT_HOST.to_string()),
            providers: Vec::new(),
            defaults,
            enable_routing_fallback: Some(false),
            log_retention_days: Some(30),
            log_export_timeout_seconds: None,
            upstream_stream_idle_timeout_seconds: None,
            model_routes: Default::default(),
            endpoint_routing,
            custom_endpoints: Vec::new(),
            routing_presets: HashMap::new(),
            store_request_payloads: Some(true),
            store_response_payloads: Some(true),
            store_payloads: None,
            log_level: Some("info".to_string()),
            request_logging: None,
            response_logging: None,
            body_limit: Some(DEFAULT_BODY_LIMIT),
            web_auth: Some(WebAuthConfig::default()),
        }
    }
}

impl GatewayConfig {
    pub fn sanitize_for_web(&self) -> Self {
        let mut cloned = self.clone();
        if let Some(web_auth) = cloned.web_auth.as_mut() {
            web_auth.password_hash = None;
            web_auth.password_salt = None;
        }
        cloned
    }

    pub fn validate(&self) -> Result<()> {
        let http_enabled = self.http.as_ref().map(|cfg| cfg.enabled).unwrap_or(false);
        let https_enabled = self.https.as_ref().map(|cfg| cfg.enabled).unwrap_or(false);
        if !http_enabled && !https_enabled {
            bail!("至少需要启用 HTTP 或 HTTPS 协议");
        }

        self.validate_provider_ids()?;
        self.validate_provider_rate_limits()?;
        Ok(())
    }

    fn validate_provider_rate_limits(&self) -> Result<()> {
        const MAX_RPM_LIMIT: u32 = 1_000_000;
        const MAX_RPM_WAIT_SECONDS: u64 = 86_400;
        for provider in &self.providers {
            if let Some(rpm_limit) = provider.rpm_limit {
                if rpm_limit > MAX_RPM_LIMIT {
                    bail!(
                        "Provider {} 的 RPM 限额不能超过 {MAX_RPM_LIMIT}: {rpm_limit}",
                        provider.id
                    );
                }
            }
            if let Some(wait_seconds) = provider.rpm_max_wait_seconds {
                if wait_seconds > MAX_RPM_WAIT_SECONDS {
                    bail!(
                        "Provider {} 的 RPM 最长等待秒数不能超过 {MAX_RPM_WAIT_SECONDS}: {wait_seconds}",
                        provider.id
                    );
                }
            }
        }
        Ok(())
    }

    pub fn validate_for_save(&self) -> Result<()> {
        self.validate()?;
        self.validate_route_provider_references()?;
        self.validate_aggregate_providers()?;
        if let Some(seconds) = self.upstream_stream_idle_timeout_seconds {
            if !(1..=86_400).contains(&seconds) {
                bail!("上游流式空闲超时秒数必须在 1-86400 之间: {seconds}");
            }
        }
        Ok(())
    }

    fn validate_provider_ids(&self) -> Result<HashSet<String>> {
        let mut provider_ids = HashSet::new();
        for provider in &self.providers {
            let provider_id = provider.id.trim();
            if provider_id.is_empty() {
                bail!("Provider ID 不能为空");
            }
            if !provider_ids.insert(provider_id.to_string()) {
                bail!("Provider ID 重复: {provider_id}");
            }
        }
        Ok(provider_ids)
    }

    fn validate_route_provider_references(&self) -> Result<()> {
        let provider_ids = self.validate_provider_ids()?;
        let validate_route_target = |scope: &str, target: &str| -> Result<()> {
            let Some((provider_id, _)) = target.split_once(':') else {
                return Ok(());
            };
            let provider_id = provider_id.trim();
            if provider_id.is_empty() {
                bail!("{scope} 的路由目标 provider 不能为空: {target}");
            }
            if !provider_ids.contains(provider_id) {
                bail!("{scope} 的路由目标引用了不存在的 Provider: {provider_id}");
            }
            Ok(())
        };
        let validate_defaults = |scope: &str, defaults: &DefaultsConfig| -> Result<()> {
            if let Some(target) = defaults.completion.as_deref() {
                validate_route_target(&format!("{scope}.completion"), target)?;
            }
            if let Some(target) = defaults.reasoning.as_deref() {
                validate_route_target(&format!("{scope}.reasoning"), target)?;
            }
            if let Some(target) = defaults.background.as_deref() {
                validate_route_target(&format!("{scope}.background"), target)?;
            }
            Ok(())
        };
        let validate_routes = |scope: &str, routes: &ModelRouteMap| -> Result<()> {
            for (source, target) in routes {
                validate_route_target(&format!("{scope}.{source}"), target)?;
            }
            Ok(())
        };
        validate_defaults("defaults", &self.defaults)?;
        validate_routes("modelRoutes", &self.model_routes)?;
        for (endpoint, routing) in &self.endpoint_routing {
            validate_defaults(
                &format!("endpointRouting.{endpoint}.defaults"),
                &routing.defaults,
            )?;
            validate_routes(
                &format!("endpointRouting.{endpoint}.modelRoutes"),
                &routing.model_routes,
            )?;
        }
        for endpoint in &self.custom_endpoints {
            if let Some(routing) = endpoint.routing.as_ref() {
                validate_defaults(
                    &format!("customEndpoints.{}.routing.defaults", endpoint.id),
                    &routing.defaults,
                )?;
                validate_routes(
                    &format!("customEndpoints.{}.routing.modelRoutes", endpoint.id),
                    &routing.model_routes,
                )?;
            }
        }
        Ok(())
    }

    /// Validate aggregated models: members only on aggregate providers, every
    /// member resolvable and non-nested, failover numbers in range. Only run
    /// on save — startup keeps tolerating dangling references (consistent
    /// with route targets), `expand_route_plan` skips dead members at runtime.
    fn validate_aggregate_providers(&self) -> Result<()> {
        let providers_by_id: HashMap<&str, &ProviderConfig> = self
            .providers
            .iter()
            .map(|provider| (provider.id.as_str(), provider))
            .collect();

        for provider in &self.providers {
            for model in &provider.models {
                let scope = format!("Provider {} 的模型 {}", provider.id, model.id);
                let members = model.members.as_deref().unwrap_or(&[]);

                if !provider.is_aggregate() {
                    if !members.is_empty() {
                        bail!(
                            "{scope} 配置了 members，但 members 仅支持聚合类型（type=aggregate）的 Provider"
                        );
                    }
                    if model.failover.is_some() {
                        bail!(
                            "{scope} 配置了 failover，但 failover 仅支持聚合类型（type=aggregate）的 Provider"
                        );
                    }
                    continue;
                }

                if members.is_empty() {
                    bail!("聚合 {scope} 未配置后端成员（members）");
                }

                for member in members {
                    let Some((member_provider_id, member_model_id)) = member.target.split_once(':')
                    else {
                        bail!(
                            "{scope} 的成员 target 必须形如 providerId:modelId: {}",
                            member.target
                        );
                    };
                    if member_provider_id.trim().is_empty() || member_model_id.trim().is_empty() {
                        bail!(
                            "{scope} 的成员 target 必须形如 providerId:modelId: {}",
                            member.target
                        );
                    }
                    let Some(member_provider) = providers_by_id.get(member_provider_id.trim())
                    else {
                        bail!(
                            "{scope} 的成员 target 引用了不存在的 Provider: {}",
                            member_provider_id.trim()
                        );
                    };
                    if member_provider.is_aggregate() {
                        bail!(
                            "{scope} 的成员 target 不能指向另一个聚合 Provider: {}（不支持嵌套聚合）",
                            member_provider_id.trim()
                        );
                    }
                }

                if let Some(failover) = model.failover.as_ref() {
                    if let Some(value) = failover.consecutive_failures {
                        if value < 1 {
                            bail!("{scope} 的连续失败阈值必须 ≥ 1: {value}");
                        }
                    }
                    if let Some(seconds) = failover.cooldown_seconds {
                        if !(1..=86_400).contains(&seconds) {
                            bail!("{scope} 的冷却秒数必须在 1-86400 之间: {seconds}");
                        }
                    }
                    if let Some(seconds) = failover.failure_window_seconds {
                        if seconds < 1 {
                            bail!("{scope} 的失败判定窗口秒数必须 ≥ 1: {seconds}");
                        }
                    }
                    if let Some(codes) = failover.trigger_status_codes.as_deref() {
                        for code in codes {
                            if !is_valid_status_code_token(code) {
                                bail!("{scope} 的触发状态码必须形如 \"429\" 或 \"5xx\": {code}");
                            }
                        }
                    }
                }
            }
        }
        Ok(())
    }

    pub fn effective_http(&self) -> Option<HttpConfig> {
        self.http.clone().filter(|cfg| cfg.enabled)
    }

    pub fn effective_https(&self) -> Option<HttpsConfig> {
        self.https
            .clone()
            .filter(|cfg| cfg.enabled && !cfg.key_path.is_empty() && !cfg.cert_path.is_empty())
    }
}

/// "Nxx" class token ("5xx") or a three-digit status code ("429") within
/// 100-599.
fn is_valid_status_code_token(token: &str) -> bool {
    let bytes = token.as_bytes();
    if bytes.len() != 3 {
        return false;
    }
    let class = bytes[0].wrapping_sub(b'0');
    if bytes[1] == b'x' && bytes[2] == b'x' {
        return (1..=5).contains(&class);
    }
    (1..=5).contains(&class) && bytes[1].is_ascii_digit() && bytes[2].is_ascii_digit()
}

fn env_path<F>(get_var: &mut F, key: &str) -> Option<PathBuf>
where
    F: FnMut(&str) -> Option<OsString>,
{
    get_var(key)
        .filter(|value| !value.as_os_str().is_empty())
        .map(PathBuf::from)
}

fn resolve_paths_with_env<F>(mut get_var: F) -> Result<GatewayPaths>
where
    F: FnMut(&str) -> Option<OsString>,
{
    let home_dir = if let Some(override_path) = env_path(&mut get_var, "CC_GW_HOME") {
        override_path
    } else if let Some(home) = env_path(&mut get_var, "HOME") {
        home.join(".cc-gw")
    } else if let Some(user_profile) = env_path(&mut get_var, "USERPROFILE") {
        user_profile.join(".cc-gw")
    } else if let (Some(home_drive), Some(home_path)) = (
        env_path(&mut get_var, "HOMEDRIVE"),
        env_path(&mut get_var, "HOMEPATH"),
    ) {
        home_drive.join(home_path).join(".cc-gw")
    } else {
        bail!("无法确定 HOME 目录，请设置 HOME、USERPROFILE 或 CC_GW_HOME");
    };

    let config_path = home_dir.join("config.json");
    let data_dir = home_dir.join("data");
    let db_path = data_dir.join("gateway.db");
    let log_dir = home_dir.join("logs");

    Ok(GatewayPaths {
        home_dir,
        config_path,
        data_dir,
        db_path,
        log_dir,
    })
}

pub fn resolve_paths() -> Result<GatewayPaths> {
    resolve_paths_with_env(|key| env::var_os(key))
}

fn apply_protocol_migration(config: &mut GatewayConfig) {
    if config.http.is_none() && config.https.is_none() {
        config.http = Some(HttpConfig {
            enabled: true,
            port: config.port.unwrap_or(DEFAULT_PORT),
            host: Some(
                config
                    .host
                    .clone()
                    .unwrap_or_else(|| DEFAULT_HOST.to_string()),
            ),
        });
        config.https = Some(HttpsConfig::default());
    }

    if config.port.is_none() {
        config.port = Some(
            config
                .http
                .as_ref()
                .map(|http| http.port)
                .unwrap_or(DEFAULT_PORT),
        );
    }

    if config.host.is_none() {
        config.host = Some(
            config
                .http
                .as_ref()
                .and_then(|http| http.host.clone())
                .unwrap_or_else(|| DEFAULT_HOST.to_string()),
        );
    }
}

pub fn load_or_init_config(port_override: Option<u16>) -> Result<(GatewayPaths, GatewayConfig)> {
    let paths = resolve_paths()?;
    fs::create_dir_all(&paths.home_dir)
        .with_context(|| format!("创建目录失败: {}", paths.home_dir.display()))?;
    fs::create_dir_all(&paths.data_dir)
        .with_context(|| format!("创建目录失败: {}", paths.data_dir.display()))?;
    fs::create_dir_all(&paths.log_dir)
        .with_context(|| format!("创建目录失败: {}", paths.log_dir.display()))?;

    if !paths.config_path.exists() {
        let config = GatewayConfig::default();
        let data = serde_json::to_string_pretty(&config)?;
        fs::write(&paths.config_path, data)
            .with_context(|| format!("写入默认配置失败: {}", paths.config_path.display()))?;
    }

    let raw = fs::read_to_string(&paths.config_path)
        .with_context(|| format!("读取配置失败: {}", paths.config_path.display()))?;
    let mut config: GatewayConfig = serde_json::from_str(&raw)
        .with_context(|| format!("解析配置失败: {}", paths.config_path.display()))?;
    apply_protocol_migration(&mut config);

    if let Some(port) = port_override {
        if let Some(http) = config.http.as_mut() {
            http.port = port;
        }
        config.port = Some(port);
    }

    config.validate()?;
    Ok((paths, config))
}

pub fn save_config(paths: &GatewayPaths, config: &GatewayConfig) -> Result<()> {
    let data = serde_json::to_string_pretty(config)?;
    let temp_path = paths.config_path.with_extension("json.tmp");
    fs::write(&temp_path, data)
        .with_context(|| format!("写入配置失败: {}", temp_path.display()))?;
    fs::rename(&temp_path, &paths.config_path).with_context(|| {
        format!(
            "替换配置失败: {} -> {}",
            temp_path.display(),
            paths.config_path.display()
        )
    })?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn resolve_paths_from_pairs(pairs: &[(&str, &str)]) -> Result<GatewayPaths> {
        let vars = pairs
            .iter()
            .map(|(key, value)| ((*key).to_string(), OsString::from(value)))
            .collect::<HashMap<_, _>>();
        resolve_paths_with_env(|key| vars.get(key).cloned())
    }

    fn test_paths(label: &str) -> GatewayPaths {
        let home_dir = std::env::temp_dir().join(format!(
            "cc-gw2-config-tests-{label}-{}",
            chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default()
        ));
        fs::create_dir_all(home_dir.join("data")).expect("create data dir");
        fs::create_dir_all(home_dir.join("logs")).expect("create log dir");
        GatewayPaths {
            config_path: home_dir.join("config.json"),
            data_dir: home_dir.join("data"),
            db_path: home_dir.join("data/gateway.db"),
            log_dir: home_dir.join("logs"),
            home_dir,
        }
    }

    #[test]
    fn apply_protocol_migration_preserves_legacy_port_and_host() {
        let mut config = GatewayConfig {
            http: None,
            https: None,
            port: Some(4999),
            host: Some("0.0.0.0".to_string()),
            ..GatewayConfig::default()
        };

        apply_protocol_migration(&mut config);

        assert_eq!(config.http.as_ref().map(|http| http.port), Some(4999));
        assert_eq!(
            config.http.as_ref().and_then(|http| http.host.as_deref()),
            Some("0.0.0.0")
        );
        assert_eq!(config.port, Some(4999));
        assert_eq!(config.host.as_deref(), Some("0.0.0.0"));
    }

    #[test]
    fn resolve_paths_prefers_explicit_cc_gw_home() {
        let paths = resolve_paths_from_pairs(&[
            ("CC_GW_HOME", "C:\\cc-gw-data"),
            ("HOME", "C:\\Users\\user"),
            ("USERPROFILE", "C:\\Users\\other"),
        ])
        .expect("resolve paths");

        assert_eq!(paths.home_dir, PathBuf::from("C:\\cc-gw-data"));
        assert_eq!(
            paths.config_path,
            PathBuf::from("C:\\cc-gw-data").join("config.json")
        );
    }

    #[test]
    fn resolve_paths_uses_userprofile_when_home_is_missing() {
        let paths = resolve_paths_from_pairs(&[("USERPROFILE", "C:\\Users\\w00836447")])
            .expect("resolve paths");

        assert_eq!(
            paths.home_dir,
            PathBuf::from("C:\\Users\\w00836447").join(".cc-gw")
        );
        assert_eq!(paths.data_dir, paths.home_dir.join("data"));
    }

    #[test]
    fn resolve_paths_uses_homedrive_and_homepath_when_profile_is_missing() {
        let paths =
            resolve_paths_from_pairs(&[("HOMEDRIVE", "C:"), ("HOMEPATH", "\\Users\\w00836447")])
                .expect("resolve paths");

        assert_eq!(
            paths.home_dir,
            PathBuf::from("C:")
                .join("\\Users\\w00836447")
                .join(".cc-gw")
        );
    }

    #[test]
    fn save_config_atomically_replaces_previous_longer_contents() {
        let paths = test_paths("atomic-save");
        fs::write(
            &paths.config_path,
            r#"{"logLevel":"very-very-long-legacy-value-that-should-disappear-completely"}"#,
        )
        .expect("write initial config");

        let config = GatewayConfig {
            log_level: Some("info".to_string()),
            ..GatewayConfig::default()
        };
        save_config(&paths, &config).expect("save config");

        let raw = fs::read_to_string(&paths.config_path).expect("read saved config");
        let parsed: GatewayConfig = serde_json::from_str(&raw).expect("parse saved config");
        assert_eq!(parsed.log_level.as_deref(), Some("info"));
        assert!(!raw.contains("very-very-long-legacy-value"));

        let _ = fs::remove_dir_all(paths.home_dir);
    }

    #[test]
    fn save_config_omits_legacy_request_and_response_logging_flags() {
        let paths = test_paths("omit-legacy-logging-flags");
        let config = GatewayConfig::default();

        save_config(&paths, &config).expect("save config");

        let raw = fs::read_to_string(&paths.config_path).expect("read saved config");
        assert!(!raw.contains("requestLogging"));
        assert!(!raw.contains("responseLogging"));

        let _ = fs::remove_dir_all(paths.home_dir);
    }

    #[test]
    fn validate_rejects_duplicate_provider_ids() {
        let config = GatewayConfig {
            providers: vec![
                ProviderConfig {
                    id: "mock".to_string(),
                    base_url: "https://mock.example.com".to_string(),
                    ..ProviderConfig::default()
                },
                ProviderConfig {
                    id: "mock".to_string(),
                    base_url: "https://mock-2.example.com".to_string(),
                    ..ProviderConfig::default()
                },
            ],
            ..GatewayConfig::default()
        };

        let error = config.validate().expect_err("duplicate provider id");
        assert!(error.to_string().contains("Provider ID 重复"));
    }

    #[test]
    fn validate_allows_stale_route_targets_on_startup() {
        let mut config = GatewayConfig {
            providers: vec![ProviderConfig {
                id: "mock-openai".to_string(),
                base_url: "https://mock.example.com".to_string(),
                ..ProviderConfig::default()
            }],
            ..GatewayConfig::default()
        };
        config
            .endpoint_routing
            .get_mut("openai")
            .unwrap()
            .model_routes
            .insert(
                "client-model".to_string(),
                "missing:upstream-model".to_string(),
            );

        config
            .validate()
            .expect("startup validation tolerates stale route");
    }

    #[test]
    fn validate_for_save_rejects_out_of_range_stream_idle_timeout() {
        let mut config = GatewayConfig::default();
        config.upstream_stream_idle_timeout_seconds = Some(0);
        let error = config.validate_for_save().expect_err("zero idle timeout");
        assert!(
            error.to_string().contains("空闲超时秒数必须在 1-86400"),
            "unexpected error: {error}"
        );

        config.upstream_stream_idle_timeout_seconds = Some(86_401);
        let error = config
            .validate_for_save()
            .expect_err("idle timeout above ceiling");
        assert!(
            error.to_string().contains("空闲超时秒数必须在 1-86400"),
            "unexpected error: {error}"
        );

        config.upstream_stream_idle_timeout_seconds = Some(1);
        config
            .validate_for_save()
            .expect("in-range idle timeout is accepted");
    }

    #[test]
    fn validate_for_save_rejects_route_targets_with_missing_provider_prefix() {
        let mut config = GatewayConfig {
            providers: vec![ProviderConfig {
                id: "mock-openai".to_string(),
                base_url: "https://mock.example.com".to_string(),
                ..ProviderConfig::default()
            }],
            ..GatewayConfig::default()
        };
        config
            .endpoint_routing
            .get_mut("openai")
            .unwrap()
            .model_routes
            .insert(
                "client-model".to_string(),
                "missing:upstream-model".to_string(),
            );

        let error = config.validate_for_save().expect_err("missing provider");
        assert!(error.to_string().contains("不存在的 Provider"));
    }

    #[test]
    fn validate_allows_provider_qualified_unregistered_model_targets() {
        let mut config = GatewayConfig {
            providers: vec![ProviderConfig {
                id: "mock-openai".to_string(),
                base_url: "https://mock.example.com".to_string(),
                ..ProviderConfig::default()
            }],
            ..GatewayConfig::default()
        };
        config
            .endpoint_routing
            .get_mut("openai")
            .unwrap()
            .model_routes
            .insert(
                "client-model".to_string(),
                "mock-openai:upstream-unregistered-model".to_string(),
            );

        config.validate_for_save().expect("valid route target");
    }

    fn upstream_provider(id: &str, model: &str) -> ProviderConfig {
        ProviderConfig {
            id: id.to_string(),
            label: id.to_string(),
            base_url: format!("https://{id}.example.com"),
            default_model: Some(model.to_string()),
            models: vec![ProviderModelConfig {
                id: model.to_string(),
                label: None,
                ..ProviderModelConfig::default()
            }],
            provider_type: Some("openai".to_string()),
            ..ProviderConfig::default()
        }
    }

    fn aggregate_provider(id: &str, targets: &[&str]) -> ProviderConfig {
        ProviderConfig {
            id: id.to_string(),
            label: id.to_string(),
            provider_type: Some(AGGREGATE_PROVIDER_TYPE.to_string()),
            models: vec![ProviderModelConfig {
                id: "glm-5.1".to_string(),
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
    fn validate_for_save_accepts_well_formed_aggregate_provider() {
        let config = GatewayConfig {
            providers: vec![
                aggregate_provider("team", &["p1:glm-4.7", "p2:gpt-4o", "p1:*"]),
                upstream_provider("p1", "glm-4.7"),
                upstream_provider("p2", "gpt-4o"),
            ],
            ..GatewayConfig::default()
        };

        config
            .validate_for_save()
            .expect("valid aggregate provider");
    }

    #[test]
    fn validate_for_save_rejects_members_on_non_aggregate_providers() {
        let config = GatewayConfig {
            providers: vec![
                aggregate_provider("p1", &["p2:m"]),
                upstream_provider("p2", "m"),
            ],
            ..GatewayConfig::default()
        };
        let mut config = config;
        config.providers[0].provider_type = Some("openai".to_string());

        let error = config.validate_for_save().expect_err("members on upstream");
        assert!(
            error.to_string().contains("仅支持聚合类型"),
            "unexpected error: {error}"
        );
    }

    #[test]
    fn validate_for_save_rejects_aggregate_model_without_members() {
        let config = GatewayConfig {
            providers: vec![
                {
                    let mut provider = aggregate_provider("team", &["p1:m"]);
                    provider.models[0].members = None;
                    provider
                },
                upstream_provider("p1", "m"),
            ],
            ..GatewayConfig::default()
        };

        let error = config.validate_for_save().expect_err("missing members");
        assert!(
            error.to_string().contains("未配置后端成员"),
            "unexpected error: {error}"
        );
    }

    #[test]
    fn validate_for_save_rejects_dangling_and_nested_members() {
        let dangling = GatewayConfig {
            providers: vec![aggregate_provider("team", &["gone:m"])],
            ..GatewayConfig::default()
        };
        let error = dangling.validate_for_save().expect_err("dangling member");
        assert!(
            error.to_string().contains("不存在的 Provider: gone"),
            "unexpected error: {error}"
        );

        let nested = GatewayConfig {
            providers: vec![
                aggregate_provider("team", &["other:glm-5.1"]),
                aggregate_provider("other", &["team:glm-5.1"]),
            ],
            ..GatewayConfig::default()
        };
        let error = nested.validate_for_save().expect_err("nested aggregate");
        assert!(
            error.to_string().contains("不支持嵌套聚合"),
            "unexpected error: {error}"
        );

        let malformed = GatewayConfig {
            providers: vec![
                aggregate_provider("team", &["p1"]),
                upstream_provider("p1", "m"),
            ],
            ..GatewayConfig::default()
        };
        let error = malformed.validate_for_save().expect_err("malformed target");
        assert!(
            error.to_string().contains("必须形如 providerId:modelId"),
            "unexpected error: {error}"
        );
    }

    #[test]
    fn validate_for_save_rejects_out_of_range_failover_values() {
        let mut config = GatewayConfig {
            providers: vec![
                aggregate_provider("team", &["p1:m"]),
                upstream_provider("p1", "m"),
            ],
            ..GatewayConfig::default()
        };
        config.providers[0].models[0].failover = Some(FailoverPolicyConfig {
            consecutive_failures: Some(0),
            cooldown_seconds: Some(1),
            failure_window_seconds: Some(1),
            trigger_status_codes: None,
        });
        let error = config.validate_for_save().expect_err("zero threshold");
        assert!(
            error.to_string().contains("连续失败阈值必须 ≥ 1"),
            "unexpected error: {error}"
        );

        config.providers[0].models[0].failover = Some(FailoverPolicyConfig {
            consecutive_failures: Some(1),
            cooldown_seconds: Some(100_000),
            failure_window_seconds: Some(1),
            trigger_status_codes: None,
        });
        let error = config
            .validate_for_save()
            .expect_err("cooldown out of range");
        assert!(
            error.to_string().contains("冷却秒数必须在 1-86400"),
            "unexpected error: {error}"
        );

        config.providers[0].models[0].failover = Some(FailoverPolicyConfig {
            consecutive_failures: Some(1),
            cooldown_seconds: Some(60),
            failure_window_seconds: Some(1),
            trigger_status_codes: Some(vec!["999".to_string()]),
        });
        let error = config.validate_for_save().expect_err("bad trigger code");
        assert!(
            error.to_string().contains("触发状态码必须形如"),
            "unexpected error: {error}"
        );
    }

    #[test]
    fn validate_startup_tolerates_broken_aggregate_members() {
        // Consistent with route targets: startup validation stays tolerant of
        // dangling references (e.g. config edited by hand); only saves are
        // strict, and expand_route_plan skips dead members at runtime.
        let config = GatewayConfig {
            providers: vec![aggregate_provider("team", &["gone:m"])],
            ..GatewayConfig::default()
        };

        config
            .validate()
            .expect("startup tolerates dangling member");
    }
}
