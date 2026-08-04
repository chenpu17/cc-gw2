use anyhow::Result;
use reqwest::{
    Client, StatusCode,
    header::{HeaderMap, HeaderName, HeaderValue},
};
use serde::Serialize;
use serde_json::Value;

use crate::config::ProviderConfig;

const ANTHROPIC_VERSION: &str = "2023-06-01";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum AuthStyle {
    AuthorizationBearer,
    XApiKey,
    XAuthToken,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProviderProtocol {
    AnthropicMessages,
    OpenAiChatCompletions,
    OpenAiResponses,
}

#[derive(Debug)]
pub struct ProxyRequest {
    pub model: String,
    pub body: Value,
    pub stream: bool,
    pub incoming_headers: HeaderMap,
    pub passthrough_headers: HeaderMap,
    pub query: Option<String>,
}

fn ends_with_version_segment(path: &str) -> bool {
    path.rsplit('/')
        .next()
        .and_then(|segment| segment.strip_prefix('v'))
        .is_some_and(|suffix| !suffix.is_empty() && suffix.chars().all(|ch| ch.is_ascii_digit()))
}

fn normalize_url(base_url: &str, default_path: &str) -> String {
    let base = base_url.trim_end_matches('/');
    if base.ends_with(default_path) {
        return base.to_string();
    }

    if let Some(path_without_v1) = default_path.strip_prefix("v1/") {
        if base.ends_with(path_without_v1) {
            return base.to_string();
        }

        if ends_with_version_segment(base) {
            return format!("{base}/{path_without_v1}");
        }
    }

    format!("{base}/{default_path}")
}

fn resolve_endpoint(base_url: &str, protocol: ProviderProtocol) -> String {
    let base = base_url.trim_end_matches('/');
    match protocol {
        ProviderProtocol::AnthropicMessages => {
            if base.ends_with("/messages") {
                base.to_string()
            } else if ends_with_version_segment(base) {
                format!("{base}/messages")
            } else if base.ends_with("/anthropic") {
                format!("{base}/v1/messages")
            } else if base.ends_with("/anthropic/v1") {
                format!("{base}/messages")
            } else {
                normalize_url(base, "v1/messages")
            }
        }
        ProviderProtocol::OpenAiChatCompletions => normalize_url(base, "v1/chat/completions"),
        ProviderProtocol::OpenAiResponses => normalize_url(base, "v1/responses"),
    }
}

/// Resolves the upstream URL for a provider. When `use_absolute_url` is set,
/// the configured `base_url` is used verbatim (trailing slashes trimmed) so
/// gateway operators can target fully-qualified endpoints that don't follow
/// the protocol's default path layout. The protocol (request body conversion)
/// is unaffected — only the URL path is decoupled. Otherwise the path suffix
/// is derived from the protocol via `resolve_endpoint`.
fn resolve_upstream_url(provider: &ProviderConfig, protocol: ProviderProtocol) -> String {
    if provider.use_absolute_url.unwrap_or(false) {
        provider.base_url.trim_end_matches('/').to_string()
    } else {
        resolve_endpoint(&provider.base_url, protocol)
    }
}

fn apply_query_string(url: String, query: Option<&str>) -> String {
    let Some(query) = query.map(str::trim).filter(|value| !value.is_empty()) else {
        return url;
    };
    let trimmed = query.trim_start_matches('?');
    if trimmed.is_empty() {
        return url;
    }
    if url.contains('?') {
        format!("{url}&{trimmed}")
    } else {
        format!("{url}?{trimmed}")
    }
}

fn set_header(headers: &mut HeaderMap, key: &str, value: &str) {
    if let (Ok(name), Ok(value)) = (
        HeaderName::from_bytes(key.as_bytes()),
        HeaderValue::from_str(value),
    ) {
        headers.insert(name, value);
    }
}

fn copy_if_present(source: &HeaderMap, target: &mut HeaderMap, key: &str) {
    if let Ok(name) = HeaderName::from_bytes(key.as_bytes()) {
        if let Some(value) = source.get(&name) {
            target.insert(name, value.clone());
        }
    }
}

fn should_forward_client_header(name: &HeaderName) -> bool {
    !matches!(
        name.as_str(),
        "host"
            | "connection"
            | "authorization"
            | "x-api-key"
            | "accept-encoding"
            | "cookie"
            | "content-length"
            | "content-encoding"
            | "transfer-encoding"
            | "keep-alive"
            | "upgrade"
            | "proxy-connection"
            | "proxy-authenticate"
            | "proxy-authorization"
            | "te"
            | "trailer"
            | "upgrade-insecure-requests"
    )
}

fn should_forward_passthrough_header(name: &HeaderName) -> bool {
    !matches!(
        name.as_str(),
        "host"
            | "connection"
            | "accept-encoding"
            | "cookie"
            | "content-length"
            | "content-encoding"
            | "transfer-encoding"
            | "keep-alive"
            | "upgrade"
            | "proxy-connection"
            | "proxy-authenticate"
            | "proxy-authorization"
            | "te"
            | "trailer"
            | "upgrade-insecure-requests"
    )
}

fn resolve_auth_style(provider: &ProviderConfig, protocol: ProviderProtocol) -> AuthStyle {
    match provider.auth_mode.as_deref() {
        Some("authToken") => AuthStyle::AuthorizationBearer,
        Some("xAuthToken") => AuthStyle::XAuthToken,
        Some("apiKey") => match protocol {
            ProviderProtocol::AnthropicMessages => AuthStyle::XApiKey,
            ProviderProtocol::OpenAiChatCompletions | ProviderProtocol::OpenAiResponses => {
                AuthStyle::AuthorizationBearer
            }
        },
        Some(_) | None => match protocol {
            ProviderProtocol::AnthropicMessages => AuthStyle::AuthorizationBearer,
            ProviderProtocol::OpenAiChatCompletions | ProviderProtocol::OpenAiResponses => {
                AuthStyle::AuthorizationBearer
            }
        },
    }
}

fn build_headers(
    provider: &ProviderConfig,
    protocol: ProviderProtocol,
    incoming_headers: &HeaderMap,
    passthrough_headers: &HeaderMap,
    stream: bool,
) -> HeaderMap {
    let mut headers = HeaderMap::new();
    set_header(&mut headers, "content-type", "application/json");

    for (name, value) in passthrough_headers {
        if should_forward_passthrough_header(name) {
            headers.insert(name.clone(), value.clone());
        }
    }

    for (name, value) in incoming_headers {
        if should_forward_client_header(name) {
            headers.insert(name.clone(), value.clone());
        }
    }

    // Provider-configured headers are applied after the client headers so they
    // override any same-named header forwarded from the request — gateway
    // operators can force values like `app-id` regardless of what the caller
    // sends. Authentication headers are applied last and still win.
    for (key, value) in &provider.extra_headers {
        set_header(&mut headers, key, value);
    }

    match protocol {
        ProviderProtocol::AnthropicMessages => {
            copy_if_present(incoming_headers, &mut headers, "anthropic-beta");
            copy_if_present(
                incoming_headers,
                &mut headers,
                "anthropic-dangerous-direct-browser-access",
            );
            copy_if_present(incoming_headers, &mut headers, "anthropic-version");
            if !headers.contains_key("anthropic-version") {
                set_header(&mut headers, "anthropic-version", ANTHROPIC_VERSION);
            }
        }
        ProviderProtocol::OpenAiChatCompletions | ProviderProtocol::OpenAiResponses => {
            if stream {
                set_header(&mut headers, "accept", "text/event-stream");
            }
            copy_if_present(incoming_headers, &mut headers, "openai-beta");
        }
    }

    if let Some(api_key) = provider.api_key.as_deref() {
        match resolve_auth_style(provider, protocol) {
            AuthStyle::AuthorizationBearer => {
                set_header(&mut headers, "authorization", &format!("Bearer {api_key}"));
            }
            AuthStyle::XAuthToken => {
                set_header(&mut headers, "x-auth-token", api_key);
            }
            AuthStyle::XApiKey => {
                set_header(&mut headers, "x-api-key", api_key);
            }
        }
    }

    headers
}

pub fn provider_prefers_anthropic_protocol(provider: &ProviderConfig) -> bool {
    if matches!(provider.provider_type.as_deref(), Some("anthropic")) {
        return true;
    }

    if provider
        .extra_headers
        .keys()
        .any(|key| key.eq_ignore_ascii_case("anthropic-version"))
    {
        return true;
    }
    false
}

pub fn provider_prefers_openai_responses_protocol(provider: &ProviderConfig) -> bool {
    if matches!(provider.provider_type.as_deref(), Some("openai-responses")) {
        return true;
    }

    provider
        .base_url
        .trim_end_matches('/')
        .ends_with("/responses")
}

/// A model discovered by probing the provider's model-list endpoint.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProbedModel {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
}

#[derive(Debug)]
pub enum ProviderModelsError {
    /// The provider's base URL cannot be mapped to a model-list endpoint
    /// (e.g. an absolute URL that doesn't end in a known chat path).
    UnsupportedEndpoint,
    Upstream { status: StatusCode, body: String },
    Transport(reqwest::Error),
    InvalidResponse,
}

impl std::fmt::Display for ProviderModelsError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::UnsupportedEndpoint => {
                write!(f, "provider address cannot be mapped to a models endpoint")
            }
            Self::Upstream { status, body } => write!(f, "upstream returned {status}: {body}"),
            Self::Transport(error) => write!(f, "request failed: {error}"),
            Self::InvalidResponse => write!(f, "unrecognized models response shape"),
        }
    }
}

impl std::error::Error for ProviderModelsError {}

/// Known trailing chat-endpoint segments that can be swapped for `models`.
const CHAT_PATH_SUFFIXES: [&str; 3] = ["chat/completions", "responses", "messages"];

/// Resolves the provider's model-list URL. For regular providers this derives
/// from the protocol's chat endpoint (e.g. `.../v1/chat/completions` →
/// `.../v1/models`). For `use_absolute_url` providers the fully-qualified chat
/// URL is only convertible when it ends in a known chat path segment;
/// otherwise the provider cannot be probed and `None` is returned.
fn resolve_models_url(provider: &ProviderConfig) -> Option<String> {
    let base = provider.base_url.trim_end_matches('/');
    if base.is_empty() {
        return None;
    }
    let chat_url = if provider.use_absolute_url.unwrap_or(false) {
        base.to_string()
    } else {
        let protocol = if provider_prefers_anthropic_protocol(provider) {
            ProviderProtocol::AnthropicMessages
        } else if provider_prefers_openai_responses_protocol(provider) {
            ProviderProtocol::OpenAiResponses
        } else {
            ProviderProtocol::OpenAiChatCompletions
        };
        resolve_endpoint(base, protocol)
    };
    for suffix in CHAT_PATH_SUFFIXES {
        if let Some(stripped) = chat_url.strip_suffix(suffix) {
            let stripped = stripped.trim_end_matches('/');
            if !stripped.is_empty() {
                return Some(format!("{stripped}/models"));
            }
        }
    }
    None
}

fn parse_models_payload(payload: &Value) -> Option<Vec<ProbedModel>> {
    let mut models: Vec<ProbedModel> = Vec::new();
    // OpenAI / Anthropic shape: { "data": [{ "id", "display_name"? }] }
    if let Some(data) = payload.get("data").and_then(Value::as_array) {
        for entry in data {
            if let Some(id) = entry.get("id").and_then(Value::as_str) {
                let label = entry
                    .get("display_name")
                    .or_else(|| entry.get("displayName"))
                    .and_then(Value::as_str)
                    .map(str::to_string);
                models.push(ProbedModel {
                    id: id.to_string(),
                    label,
                });
            }
        }
    // Gemini shape: { "models": [{ "name", "displayName"? }] }
    } else if let Some(list) = payload.get("models").and_then(Value::as_array) {
        for entry in list {
            let id = entry
                .get("name")
                .or_else(|| entry.get("id"))
                .and_then(Value::as_str);
            if let Some(id) = id {
                let label = entry
                    .get("displayName")
                    .and_then(Value::as_str)
                    .map(str::to_string);
                models.push(ProbedModel {
                    id: id.to_string(),
                    label,
                });
            }
        }
    }
    if models.is_empty() {
        return None;
    }
    models.sort_by(|a, b| a.id.cmp(&b.id));
    models.dedup_by(|a, b| a.id == b.id);
    Some(models)
}

/// Probes the provider's model-list endpoint (`GET .../models`) using the same
/// header/auth machinery as proxied chat requests, so operator-configured
/// `auth_mode` and `extra_headers` apply identically.
pub async fn fetch_provider_models(
    client: &Client,
    provider: &ProviderConfig,
) -> std::result::Result<Vec<ProbedModel>, ProviderModelsError> {
    let url = resolve_models_url(provider).ok_or(ProviderModelsError::UnsupportedEndpoint)?;
    let protocol = if provider_prefers_anthropic_protocol(provider) {
        ProviderProtocol::AnthropicMessages
    } else {
        ProviderProtocol::OpenAiChatCompletions
    };
    let headers = build_headers(
        provider,
        protocol,
        &HeaderMap::new(),
        &HeaderMap::new(),
        false,
    );
    let response = client
        .get(url)
        .headers(headers)
        .timeout(std::time::Duration::from_secs(15))
        .send()
        .await
        .map_err(ProviderModelsError::Transport)?;
    let status = response.status();
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        let body: String = body.chars().take(500).collect();
        return Err(ProviderModelsError::Upstream { status, body });
    }
    let payload: Value = response
        .json()
        .await
        .map_err(ProviderModelsError::Transport)?;
    parse_models_payload(&payload).ok_or(ProviderModelsError::InvalidResponse)
}

pub fn prepare_proxy_payload(body: Value, model: &str, stream: bool) -> Value {
    let mut payload = body;
    if let Some(object) = payload.as_object_mut() {
        if object.get("model").and_then(Value::as_str) != Some(model) {
            object.insert("model".to_string(), Value::String(model.to_string()));
        }
        if stream || object.contains_key("stream") {
            object.insert("stream".to_string(), Value::Bool(stream));
        }
    }
    payload
}

pub async fn forward_request(
    client: &Client,
    provider: &ProviderConfig,
    protocol: ProviderProtocol,
    request: ProxyRequest,
    timeout: Option<std::time::Duration>,
) -> Result<reqwest::Response> {
    let payload = prepare_proxy_payload(request.body, &request.model, request.stream);

    let headers = build_headers(
        provider,
        protocol,
        &request.incoming_headers,
        &request.passthrough_headers,
        request.stream,
    );
    let url = apply_query_string(
        resolve_upstream_url(provider, protocol),
        request.query.as_deref(),
    );

    // A per-request timeout covers the entire request, including reading the
    // response body, so callers must only set it when they wait for the full
    // body (non-streaming requests and non-stream-via-stream materialization);
    // streaming passthrough would kill legitimate long-lived streams.
    let mut builder = client.post(url).headers(headers).json(&payload);
    if let Some(timeout) = timeout {
        builder = builder.timeout(timeout);
    }
    let response = builder.send().await?;

    Ok(response)
}

#[cfg(test)]
mod tests {
    use super::{
        ProviderConfig, ProviderProtocol, apply_query_string, build_headers, parse_models_payload,
        provider_prefers_anthropic_protocol, provider_prefers_openai_responses_protocol,
        resolve_endpoint, resolve_models_url, resolve_upstream_url,
    };
    use reqwest::header::{HeaderMap, HeaderName, HeaderValue};
    use serde_json::json;

    #[test]
    fn apply_query_string_appends_to_plain_url() {
        assert_eq!(
            apply_query_string(
                "http://localhost/v1/chat/completions".to_string(),
                Some("a=1&b=2")
            ),
            "http://localhost/v1/chat/completions?a=1&b=2"
        );
    }

    #[test]
    fn apply_query_string_appends_to_existing_query() {
        assert_eq!(
            apply_query_string(
                "http://localhost/v1/chat/completions?x=1".to_string(),
                Some("a=1")
            ),
            "http://localhost/v1/chat/completions?x=1&a=1"
        );
    }

    #[test]
    fn apply_query_string_ignores_empty_values() {
        assert_eq!(
            apply_query_string(
                "http://localhost/v1/chat/completions".to_string(),
                Some("   ")
            ),
            "http://localhost/v1/chat/completions"
        );
        assert_eq!(
            apply_query_string(
                "http://localhost/v1/chat/completions".to_string(),
                Some("?")
            ),
            "http://localhost/v1/chat/completions"
        );
    }

    #[test]
    fn anthropic_headers_preserve_claude_client_identity_headers() {
        let provider = ProviderConfig {
            id: "anthropic".to_string(),
            provider_type: Some("anthropic".to_string()),
            api_key: Some("provider-secret".to_string()),
            base_url: "https://example.com".to_string(),
            ..ProviderConfig::default()
        };
        let mut incoming = HeaderMap::new();
        incoming.insert(
            HeaderName::from_static("user-agent"),
            HeaderValue::from_static("claude-cli/1.0.0"),
        );
        incoming.insert(
            HeaderName::from_static("x-app"),
            HeaderValue::from_static("claude-code"),
        );
        incoming.insert(
            HeaderName::from_static("anthropic-beta"),
            HeaderValue::from_static("fine-grained-tool-streaming-2025-05-14"),
        );
        incoming.insert(
            HeaderName::from_static("authorization"),
            HeaderValue::from_static("Bearer caller-key"),
        );
        incoming.insert(
            HeaderName::from_static("accept-encoding"),
            HeaderValue::from_static("gzip, br"),
        );
        incoming.insert(
            HeaderName::from_static("cookie"),
            HeaderValue::from_static("session=abc"),
        );
        incoming.insert(
            HeaderName::from_static("content-encoding"),
            HeaderValue::from_static("gzip"),
        );

        let headers = build_headers(
            &provider,
            ProviderProtocol::AnthropicMessages,
            &incoming,
            &HeaderMap::new(),
            true,
        );

        assert_eq!(
            headers
                .get("user-agent")
                .and_then(|value| value.to_str().ok()),
            Some("claude-cli/1.0.0")
        );
        assert_eq!(
            headers.get("x-app").and_then(|value| value.to_str().ok()),
            Some("claude-code")
        );
        assert_eq!(
            headers
                .get("anthropic-beta")
                .and_then(|value| value.to_str().ok()),
            Some("fine-grained-tool-streaming-2025-05-14")
        );
        assert_eq!(
            headers
                .get("authorization")
                .and_then(|value| value.to_str().ok()),
            Some("Bearer provider-secret")
        );
        assert!(headers.get("x-api-key").is_none());
        assert!(headers.get("accept-encoding").is_none());
        assert!(headers.get("cookie").is_none());
        assert!(headers.get("content-encoding").is_none());
        assert_eq!(
            headers
                .get("content-type")
                .and_then(|value| value.to_str().ok()),
            Some("application/json")
        );
    }

    #[test]
    fn extra_headers_override_client_headers_but_not_auth() {
        let mut provider = ProviderConfig {
            id: "custom".to_string(),
            provider_type: Some("openai".to_string()),
            api_key: Some("provider-secret".to_string()),
            base_url: "https://example.com".to_string(),
            ..ProviderConfig::default()
        };
        provider
            .extra_headers
            .insert("app-id".to_string(), "gateway-app".to_string());
        provider
            .extra_headers
            .insert("authorization".to_string(), "Bearer should-be-ignored".to_string());

        let mut incoming = HeaderMap::new();
        incoming.insert(
            HeaderName::from_static("app-id"),
            HeaderValue::from_static("client-app"),
        );

        let headers = build_headers(
            &provider,
            ProviderProtocol::OpenAiChatCompletions,
            &incoming,
            &HeaderMap::new(),
            false,
        );

        // Provider-configured header overrides the same-named client header.
        assert_eq!(
            headers.get("app-id").and_then(|value| value.to_str().ok()),
            Some("gateway-app")
        );
        // Authentication still derives from the provider api_key, never extra_headers.
        assert_eq!(
            headers
                .get("authorization")
                .and_then(|value| value.to_str().ok()),
            Some("Bearer provider-secret")
        );
    }

    #[test]
    fn openai_headers_preserve_client_identity_headers_without_leaking_gateway_auth() {
        let provider = ProviderConfig {
            id: "openai".to_string(),
            provider_type: Some("openai".to_string()),
            api_key: Some("provider-secret".to_string()),
            base_url: "https://example.com".to_string(),
            ..ProviderConfig::default()
        };
        let mut incoming = HeaderMap::new();
        incoming.insert(
            HeaderName::from_static("user-agent"),
            HeaderValue::from_static("claude-cli/1.0.0"),
        );
        incoming.insert(
            HeaderName::from_static("x-app"),
            HeaderValue::from_static("claude-code"),
        );
        incoming.insert(
            HeaderName::from_static("authorization"),
            HeaderValue::from_static("Bearer caller-key"),
        );
        incoming.insert(
            HeaderName::from_static("x-api-key"),
            HeaderValue::from_static("gateway-key"),
        );

        let headers = build_headers(
            &provider,
            ProviderProtocol::OpenAiChatCompletions,
            &incoming,
            &HeaderMap::new(),
            true,
        );

        assert_eq!(
            headers
                .get("user-agent")
                .and_then(|value| value.to_str().ok()),
            Some("claude-cli/1.0.0")
        );
        assert_eq!(
            headers.get("x-app").and_then(|value| value.to_str().ok()),
            Some("claude-code")
        );
        assert_eq!(
            headers
                .get("authorization")
                .and_then(|value| value.to_str().ok()),
            Some("Bearer provider-secret")
        );
        assert!(headers.get("x-api-key").is_none());
        assert_eq!(
            headers.get("accept").and_then(|value| value.to_str().ok()),
            Some("text/event-stream")
        );
        assert_eq!(
            headers
                .get("content-type")
                .and_then(|value| value.to_str().ok()),
            Some("application/json")
        );
    }

    #[test]
    fn openai_endpoint_uses_existing_version_prefix_without_adding_v1() {
        assert_eq!(
            resolve_endpoint(
                "http://localhost/v4",
                ProviderProtocol::OpenAiChatCompletions
            ),
            "http://localhost/v4/chat/completions"
        );
    }

    #[test]
    fn openai_endpoint_preserves_full_chat_completions_path() {
        assert_eq!(
            resolve_endpoint(
                "http://localhost/v4/chat/completions",
                ProviderProtocol::OpenAiChatCompletions
            ),
            "http://localhost/v4/chat/completions"
        );
    }

    #[test]
    fn anthropic_endpoint_uses_existing_version_prefix_without_adding_v1() {
        assert_eq!(
            resolve_endpoint("http://localhost/v4", ProviderProtocol::AnthropicMessages),
            "http://localhost/v4/messages"
        );
    }

    #[test]
    fn absolute_url_uses_base_verbatim_without_protocol_suffix() {
        let provider = ProviderConfig {
            base_url: "https://internal.example.com/custom/v1/messages".to_string(),
            use_absolute_url: Some(true),
            ..ProviderConfig::default()
        };
        // OpenAI would normally append /v1/chat/completions; with use_absolute_url
        // the fully-qualified base is used as-is (path decoupled from protocol).
        assert_eq!(
            resolve_upstream_url(&provider, ProviderProtocol::OpenAiChatCompletions),
            "https://internal.example.com/custom/v1/messages"
        );
    }

    #[test]
    fn absolute_url_trims_trailing_slash_but_keeps_path() {
        let provider = ProviderConfig {
            base_url: "https://internal.example.com/proxy/endpoint/".to_string(),
            use_absolute_url: Some(true),
            ..ProviderConfig::default()
        };
        assert_eq!(
            resolve_upstream_url(&provider, ProviderProtocol::AnthropicMessages),
            "https://internal.example.com/proxy/endpoint"
        );
    }

    #[test]
    fn absolute_url_absent_falls_back_to_protocol_suffix() {
        // Default (None): old configs without the field keep prior behavior.
        let provider = ProviderConfig {
            base_url: "https://api.example.com".to_string(),
            ..ProviderConfig::default()
        };
        assert_eq!(
            resolve_upstream_url(&provider, ProviderProtocol::OpenAiChatCompletions),
            "https://api.example.com/v1/chat/completions"
        );
    }

    #[test]
    fn provider_prefers_anthropic_protocol_for_explicit_anthropic_signals() {
        let mut provider = ProviderConfig {
            base_url: "https://example.com/proxy".to_string(),
            extra_headers: [("Anthropic-Version".to_string(), "2023-06-01".to_string())]
                .into_iter()
                .collect(),
            ..ProviderConfig::default()
        };
        assert!(provider_prefers_anthropic_protocol(&provider));

        provider = ProviderConfig {
            provider_type: Some("anthropic".to_string()),
            base_url: "https://example.com".to_string(),
            ..ProviderConfig::default()
        };
        assert!(provider_prefers_anthropic_protocol(&provider));
    }

    #[test]
    fn provider_prefers_openai_protocol_without_anthropic_hints() {
        let provider = ProviderConfig {
            provider_type: Some("openai".to_string()),
            base_url: "https://example.com/v1".to_string(),
            ..ProviderConfig::default()
        };

        assert!(!provider_prefers_anthropic_protocol(&provider));
        assert!(!provider_prefers_openai_responses_protocol(&provider));
    }

    #[test]
    fn provider_prefers_openai_responses_protocol_for_explicit_signals() {
        let provider = ProviderConfig {
            provider_type: Some("openai-responses".to_string()),
            base_url: "https://example.com/v1".to_string(),
            ..ProviderConfig::default()
        };
        assert!(provider_prefers_openai_responses_protocol(&provider));

        let provider = ProviderConfig {
            base_url: "https://example.com/v1/responses".to_string(),
            ..ProviderConfig::default()
        };
        assert!(provider_prefers_openai_responses_protocol(&provider));
    }

    #[test]
    fn models_url_derives_from_openai_chat_endpoint() {
        let provider = ProviderConfig {
            base_url: "https://api.example.com".to_string(),
            ..ProviderConfig::default()
        };
        assert_eq!(
            resolve_models_url(&provider),
            Some("https://api.example.com/v1/models".to_string())
        );

        let provider = ProviderConfig {
            base_url: "https://api.example.com/v1/".to_string(),
            ..ProviderConfig::default()
        };
        assert_eq!(
            resolve_models_url(&provider),
            Some("https://api.example.com/v1/models".to_string())
        );
    }

    #[test]
    fn models_url_preserves_non_v1_version_segments() {
        let provider = ProviderConfig {
            base_url: "https://api.example.com/v4".to_string(),
            ..ProviderConfig::default()
        };
        assert_eq!(
            resolve_models_url(&provider),
            Some("https://api.example.com/v4/models".to_string())
        );
    }

    #[test]
    fn models_url_derives_from_anthropic_and_responses_endpoints() {
        let provider = ProviderConfig {
            provider_type: Some("anthropic".to_string()),
            base_url: "https://api.example.com".to_string(),
            ..ProviderConfig::default()
        };
        assert_eq!(
            resolve_models_url(&provider),
            Some("https://api.example.com/v1/models".to_string())
        );

        let provider = ProviderConfig {
            provider_type: Some("openai-responses".to_string()),
            base_url: "https://api.example.com/v1".to_string(),
            ..ProviderConfig::default()
        };
        assert_eq!(
            resolve_models_url(&provider),
            Some("https://api.example.com/v1/models".to_string())
        );
    }

    #[test]
    fn models_url_rewrites_absolute_chat_urls() {
        let provider = ProviderConfig {
            base_url: "https://internal.example.com/custom/v1/chat/completions".to_string(),
            use_absolute_url: Some(true),
            ..ProviderConfig::default()
        };
        assert_eq!(
            resolve_models_url(&provider),
            Some("https://internal.example.com/custom/v1/models".to_string())
        );

        let provider = ProviderConfig {
            base_url: "https://internal.example.com/proxy/v1/messages".to_string(),
            use_absolute_url: Some(true),
            ..ProviderConfig::default()
        };
        assert_eq!(
            resolve_models_url(&provider),
            Some("https://internal.example.com/proxy/v1/models".to_string())
        );
    }

    #[test]
    fn models_url_rejects_absolute_urls_without_known_suffix() {
        let provider = ProviderConfig {
            base_url: "https://internal.example.com/proxy/endpoint".to_string(),
            use_absolute_url: Some(true),
            ..ProviderConfig::default()
        };
        assert_eq!(resolve_models_url(&provider), None);
    }

    #[test]
    fn parse_models_payload_reads_openai_and_anthropic_shapes() {
        let payload = json!({
            "object": "list",
            "data": [
                { "id": "gpt-b", "display_name": "GPT B" },
                { "id": "gpt-a" },
                { "id": "gpt-a" },
                { "object": "model" }
            ]
        });
        let models = parse_models_payload(&payload).expect("should parse");
        assert_eq!(
            models,
            vec![
                super::ProbedModel {
                    id: "gpt-a".to_string(),
                    label: None
                },
                super::ProbedModel {
                    id: "gpt-b".to_string(),
                    label: Some("GPT B".to_string())
                },
            ]
        );
    }

    #[test]
    fn parse_models_payload_reads_gemini_shape() {
        let payload = json!({
            "models": [
                { "name": "models/gemini-pro", "displayName": "Gemini Pro" }
            ]
        });
        let models = parse_models_payload(&payload).expect("should parse");
        assert_eq!(
            models,
            vec![super::ProbedModel {
                id: "models/gemini-pro".to_string(),
                label: Some("Gemini Pro".to_string())
            }]
        );
    }

    #[test]
    fn parse_models_payload_rejects_empty_or_unknown_shapes() {
        assert_eq!(parse_models_payload(&json!({ "data": [] })), None);
        assert_eq!(parse_models_payload(&json!({ "error": "nope" })), None);
    }
}
