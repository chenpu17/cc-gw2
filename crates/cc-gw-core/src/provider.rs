use anyhow::Result;
use reqwest::{
    Client,
    header::{HeaderMap, HeaderName, HeaderValue},
};
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

    for (key, value) in &provider.extra_headers {
        set_header(&mut headers, key, value);
    }

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

pub async fn forward_request(
    client: &Client,
    provider: &ProviderConfig,
    protocol: ProviderProtocol,
    request: ProxyRequest,
) -> Result<reqwest::Response> {
    let mut payload = request.body;
    if let Some(object) = payload.as_object_mut() {
        if object.get("model").and_then(Value::as_str) != Some(request.model.as_str()) {
            object.insert("model".to_string(), Value::String(request.model));
        }
        if request.stream || object.contains_key("stream") {
            object.insert("stream".to_string(), Value::Bool(request.stream));
        }
    }

    let headers = build_headers(
        provider,
        protocol,
        &request.incoming_headers,
        &request.passthrough_headers,
        request.stream,
    );
    let url = apply_query_string(
        resolve_endpoint(&provider.base_url, protocol),
        request.query.as_deref(),
    );

    let response = client
        .post(url)
        .headers(headers)
        .json(&payload)
        .send()
        .await?;

    Ok(response)
}

#[cfg(test)]
mod tests {
    use super::{
        ProviderConfig, ProviderProtocol, apply_query_string, build_headers,
        provider_prefers_anthropic_protocol, resolve_endpoint,
    };
    use reqwest::header::{HeaderMap, HeaderName, HeaderValue};

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
    }
}
