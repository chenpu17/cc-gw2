use std::collections::HashMap;
use std::env;
use std::fs;
use std::path::PathBuf;

use anyhow::{Context, Result, bail};
use indexmap::IndexMap;
use serde::{Deserialize, Serialize};

pub const DEFAULT_HOST: &str = "127.0.0.1";
pub const DEFAULT_PORT: u16 = 4100;
pub const DEFAULT_HTTPS_PORT: u16 = 4443;

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
    pub models: Vec<ProviderModelConfig>,
    pub extra_headers: HashMap<String, String>,
    #[serde(rename = "type")]
    pub provider_type: Option<String>,
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
pub struct EndpointValidationConfig {
    pub mode: String,
    pub allow_experimental_blocks: Option<bool>,
}

impl Default for EndpointValidationConfig {
    fn default() -> Self {
        Self {
            mode: "off".to_string(),
            allow_experimental_blocks: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct EndpointRoutingConfig {
    pub defaults: DefaultsConfig,
    pub model_routes: ModelRouteMap,
    pub validation: Option<EndpointValidationConfig>,
}

impl Default for EndpointRoutingConfig {
    fn default() -> Self {
        Self {
            defaults: DefaultsConfig::default(),
            model_routes: Default::default(),
            validation: None,
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
    pub model_routes: ModelRouteMap,
    pub endpoint_routing: HashMap<String, EndpointRoutingConfig>,
    pub custom_endpoints: Vec<CustomEndpointConfig>,
    pub routing_presets: HashMap<String, Vec<RoutingPreset>>,
    pub store_request_payloads: Option<bool>,
    pub store_response_payloads: Option<bool>,
    pub store_payloads: Option<bool>,
    pub log_level: Option<String>,
    pub request_logging: Option<bool>,
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
                validation: None,
            },
        );
        endpoint_routing.insert(
            "openai".to_string(),
            EndpointRoutingConfig {
                defaults: defaults.clone(),
                model_routes: Default::default(),
                validation: None,
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
            model_routes: Default::default(),
            endpoint_routing,
            custom_endpoints: Vec::new(),
            routing_presets: HashMap::new(),
            store_request_payloads: Some(true),
            store_response_payloads: Some(true),
            store_payloads: None,
            log_level: Some("info".to_string()),
            request_logging: Some(true),
            response_logging: Some(true),
            body_limit: Some(10 * 1024 * 1024),
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

pub fn resolve_paths() -> Result<GatewayPaths> {
    let home_dir = if let Ok(override_path) = env::var("CC_GW_HOME") {
        PathBuf::from(override_path)
    } else if let Ok(home) = env::var("HOME") {
        PathBuf::from(home).join(".cc-gw")
    } else {
        bail!("无法确定 HOME 目录，请设置 HOME 或 CC_GW_HOME");
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
}
