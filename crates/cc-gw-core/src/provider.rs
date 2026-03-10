use anyhow::{Result, bail};
use reqwest::{
    Client,
    header::{HeaderMap, HeaderName, HeaderValue},
};
use serde_json::Value;

use crate::config::ProviderConfig;

const ANTHROPIC_VERSION: &str = "2023-06-01";

#[derive(Debug, Clone, Copy)]
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

fn normalize_url(base_url: &str, default_path: &str) -> String {
    let base = base_url.trim_end_matches('/');
    if base.ends_with(default_path) {
        return base.to_string();
    }

    if base.ends_with("/v1") && default_path.starts_with("v1/") {
        return format!("{base}/{}", &default_path[3..]);
    }

    format!("{base}/{default_path}")
}

fn resolve_endpoint(base_url: &str, protocol: ProviderProtocol) -> String {
    match protocol {
        ProviderProtocol::AnthropicMessages => {
            if base_url.trim_end_matches('/').ends_with("/messages") {
                base_url.trim_end_matches('/').to_string()
            } else if base_url.trim_end_matches('/').ends_with("/anthropic") {
                format!("{}/v1/messages", base_url.trim_end_matches('/'))
            } else if base_url.trim_end_matches('/').ends_with("/anthropic/v1") {
                format!("{}/messages", base_url.trim_end_matches('/'))
            } else {
                normalize_url(base_url, "v1/messages")
            }
        }
        ProviderProtocol::OpenAiChatCompletions => normalize_url(base_url, "v1/chat/completions"),
        ProviderProtocol::OpenAiResponses => normalize_url(base_url, "v1/responses"),
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
        headers.insert(name.clone(), value.clone());
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
        match (protocol, provider.auth_mode.as_deref()) {
            (ProviderProtocol::AnthropicMessages, Some("authToken")) => {
                set_header(&mut headers, "authorization", &format!("Bearer {api_key}"));
            }
            (_, Some("xAuthToken")) => {
                set_header(&mut headers, "x-auth-token", api_key);
            }
            (ProviderProtocol::AnthropicMessages, _) => {
                set_header(&mut headers, "x-api-key", api_key);
            }
            (_, _) => {
                set_header(&mut headers, "authorization", &format!("Bearer {api_key}"));
            }
        }
    }

    headers
}

fn protocol_allowed(provider: &ProviderConfig, protocol: ProviderProtocol) -> bool {
    match protocol {
        ProviderProtocol::AnthropicMessages => {
            matches!(provider.provider_type.as_deref(), Some("anthropic"))
        }
        ProviderProtocol::OpenAiChatCompletions | ProviderProtocol::OpenAiResponses => {
            !matches!(provider.provider_type.as_deref(), Some("anthropic"))
        }
    }
}

pub async fn forward_request(
    client: &Client,
    provider: &ProviderConfig,
    protocol: ProviderProtocol,
    request: ProxyRequest,
) -> Result<reqwest::Response> {
    if !protocol_allowed(provider, protocol) {
        bail!("当前 provider 暂不支持该协议，后续需通过跨协议转换适配");
    }

    let mut payload = request.body;
    if let Some(object) = payload.as_object_mut() {
        object.insert("model".to_string(), Value::String(request.model));
        object.insert("stream".to_string(), Value::Bool(request.stream));
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
    use super::apply_query_string;

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
}
