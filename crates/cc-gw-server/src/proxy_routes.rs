use super::*;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

const ERROR_SOURCE_CLIENT: &str = "client";
const ERROR_SOURCE_GATEWAY: &str = "gateway";
const ERROR_SOURCE_UPSTREAM: &str = "upstream";

fn upstream_error_source_for_status(status_code: i64) -> Option<String> {
    (status_code >= 400).then(|| ERROR_SOURCE_UPSTREAM.to_string())
}

/// The upstream `Err` arm receives an `anyhow::Error` whose `Display` chain
/// embeds the full upstream URL. Surface only a generic category so the gateway
/// doesn't leak routing topology (upstream host / path) to callers that only
/// hold a gateway key. The full error stays in tracing.
fn sanitize_upstream_error(error: &anyhow::Error) -> String {
    let reqwest_error = error
        .chain()
        .find_map(|cause| cause.downcast_ref::<reqwest::Error>());
    match reqwest_error {
        Some(e) if e.is_timeout() => "upstream timed out".to_string(),
        Some(e) if e.is_connect() => "upstream connection failed".to_string(),
        _ => "upstream request failed".to_string(),
    }
}

#[derive(Clone)]
struct NetworkByteRecorder {
    state: AppState,
    endpoint_id: String,
}

impl NetworkByteRecorder {
    fn new(state: &AppState, endpoint_id: &str) -> Self {
        Self {
            state: state.clone(),
            endpoint_id: endpoint_id.to_string(),
        }
    }

    fn record_egress(&self, bytes: usize) {
        record_network_egress(&self.state, &self.endpoint_id, bytes);
    }
}

#[derive(Debug)]
struct RequestActivityGuard {
    active_requests: Arc<AtomicU64>,
    active_client_addresses: Arc<Mutex<HashMap<String, u64>>>,
    active_client_sessions: Arc<Mutex<HashMap<String, u64>>>,
    active_requests_by_endpoint: Arc<Mutex<HashMap<String, u64>>>,
    active_client_addresses_by_endpoint: Arc<Mutex<HashMap<String, HashMap<String, u64>>>>,
    active_client_sessions_by_endpoint: Arc<Mutex<HashMap<String, HashMap<String, u64>>>>,
    active_requests_by_api_key: Arc<Mutex<HashMap<i64, u64>>>,
    endpoint_id: String,
    source_ip: Option<String>,
    session_id: Option<String>,
    api_key_id: Option<i64>,
}

impl RequestActivityGuard {
    fn new(
        state: &AppState,
        endpoint_id: String,
        source_ip: Option<String>,
        session_id: Option<String>,
        api_key_id: Option<i64>,
    ) -> Self {
        state.active_requests.fetch_add(1, Ordering::Relaxed);
        increment_endpoint_counter(&state.active_requests_by_endpoint, &endpoint_id);
        if let Some(source_ip) = source_ip.as_deref() {
            increment_active_entry(&state.active_client_addresses, source_ip);
            increment_active_entry_for_endpoint(
                &state.active_client_addresses_by_endpoint,
                &endpoint_id,
                source_ip,
            );
        }
        if let Some(session_id) = session_id.as_deref() {
            increment_active_entry(&state.active_client_sessions, session_id);
            increment_active_entry_for_endpoint(
                &state.active_client_sessions_by_endpoint,
                &endpoint_id,
                session_id,
            );
        }
        if let Some(api_key_id) = api_key_id {
            increment_api_key_counter(&state.active_requests_by_api_key, api_key_id);
        }
        Self {
            active_requests: Arc::clone(&state.active_requests),
            active_client_addresses: Arc::clone(&state.active_client_addresses),
            active_client_sessions: Arc::clone(&state.active_client_sessions),
            active_requests_by_endpoint: Arc::clone(&state.active_requests_by_endpoint),
            active_client_addresses_by_endpoint: Arc::clone(
                &state.active_client_addresses_by_endpoint,
            ),
            active_client_sessions_by_endpoint: Arc::clone(
                &state.active_client_sessions_by_endpoint,
            ),
            active_requests_by_api_key: Arc::clone(&state.active_requests_by_api_key),
            endpoint_id,
            source_ip,
            session_id,
            api_key_id,
        }
    }

    /// Atomically check the per-key concurrency limit and reserve a slot.
    /// Returns `Ok(guard)` on success, `Err(current_count)` if the limit would be exceeded.
    fn try_new_with_concurrency_check(
        state: &AppState,
        endpoint_id: String,
        source_ip: Option<String>,
        session_id: Option<String>,
        api_key_id: Option<i64>,
        max_concurrency: Option<i64>,
    ) -> Result<Self, u64> {
        // Atomically check and increment the API key counter in one lock scope
        if let (Some(api_key_id), Some(max)) = (api_key_id, max_concurrency) {
            if max > 0 {
                if let Ok(mut entries) = state.active_requests_by_api_key.lock() {
                    let current = *entries.get(&api_key_id).unwrap_or(&0);
                    if current >= max as u64 {
                        return Err(current);
                    }
                    // Reserve the slot immediately while still holding the lock
                    entries
                        .entry(api_key_id)
                        .and_modify(|c| *c += 1)
                        .or_insert(1);
                } else {
                    // Lock poisoned — fail open
                    return Ok(Self::new(
                        state,
                        endpoint_id,
                        source_ip,
                        session_id,
                        Some(api_key_id),
                    ));
                }
                // Counter already incremented; build the guard without re-incrementing
                return Ok(Self::build_without_api_key_increment(
                    state,
                    endpoint_id,
                    source_ip,
                    session_id,
                    Some(api_key_id),
                ));
            }
        }
        // No concurrency limit or no API key — use the normal path
        Ok(Self::new(
            state,
            endpoint_id,
            source_ip,
            session_id,
            api_key_id,
        ))
    }

    /// Build a guard assuming the API key counter was already incremented by the caller.
    fn build_without_api_key_increment(
        state: &AppState,
        endpoint_id: String,
        source_ip: Option<String>,
        session_id: Option<String>,
        api_key_id: Option<i64>,
    ) -> Self {
        state.active_requests.fetch_add(1, Ordering::Relaxed);
        increment_endpoint_counter(&state.active_requests_by_endpoint, &endpoint_id);
        if let Some(source_ip) = source_ip.as_deref() {
            increment_active_entry(&state.active_client_addresses, source_ip);
            increment_active_entry_for_endpoint(
                &state.active_client_addresses_by_endpoint,
                &endpoint_id,
                source_ip,
            );
        }
        if let Some(session_id) = session_id.as_deref() {
            increment_active_entry(&state.active_client_sessions, session_id);
            increment_active_entry_for_endpoint(
                &state.active_client_sessions_by_endpoint,
                &endpoint_id,
                session_id,
            );
        }
        // NOTE: api_key_id counter is NOT incremented here — already done by caller
        Self {
            active_requests: Arc::clone(&state.active_requests),
            active_client_addresses: Arc::clone(&state.active_client_addresses),
            active_client_sessions: Arc::clone(&state.active_client_sessions),
            active_requests_by_endpoint: Arc::clone(&state.active_requests_by_endpoint),
            active_client_addresses_by_endpoint: Arc::clone(
                &state.active_client_addresses_by_endpoint,
            ),
            active_client_sessions_by_endpoint: Arc::clone(
                &state.active_client_sessions_by_endpoint,
            ),
            active_requests_by_api_key: Arc::clone(&state.active_requests_by_api_key),
            endpoint_id,
            source_ip,
            session_id,
            api_key_id,
        }
    }
}

impl Drop for RequestActivityGuard {
    fn drop(&mut self) {
        self.active_requests.fetch_sub(1, Ordering::Relaxed);
        decrement_endpoint_counter(&self.active_requests_by_endpoint, &self.endpoint_id);
        if let Some(source_ip) = self.source_ip.as_deref() {
            decrement_active_entry(&self.active_client_addresses, source_ip);
            decrement_active_entry_for_endpoint(
                &self.active_client_addresses_by_endpoint,
                &self.endpoint_id,
                source_ip,
            );
        }
        if let Some(session_id) = self.session_id.as_deref() {
            decrement_active_entry(&self.active_client_sessions, session_id);
            decrement_active_entry_for_endpoint(
                &self.active_client_sessions_by_endpoint,
                &self.endpoint_id,
                session_id,
            );
        }
        if let Some(api_key_id) = self.api_key_id {
            decrement_api_key_counter(&self.active_requests_by_api_key, api_key_id);
        }
    }
}

fn increment_endpoint_counter(entries: &Mutex<HashMap<String, u64>>, endpoint: &str) {
    if let Ok(mut entries) = entries.lock() {
        let counter = entries.entry(endpoint.to_string()).or_insert(0);
        *counter += 1;
    }
}

fn decrement_endpoint_counter(entries: &Mutex<HashMap<String, u64>>, endpoint: &str) {
    if let Ok(mut entries) = entries.lock() {
        if let Some(counter) = entries.get_mut(endpoint) {
            if *counter > 1 {
                *counter -= 1;
            } else {
                entries.remove(endpoint);
            }
        }
    }
}

fn increment_active_entry(entries: &Mutex<HashMap<String, u64>>, key: &str) {
    if let Ok(mut entries) = entries.lock() {
        let counter = entries.entry(key.to_string()).or_insert(0);
        *counter += 1;
    }
}

fn decrement_active_entry(entries: &Mutex<HashMap<String, u64>>, key: &str) {
    if let Ok(mut entries) = entries.lock() {
        if let Some(counter) = entries.get_mut(key) {
            if *counter > 1 {
                *counter -= 1;
            } else {
                entries.remove(key);
            }
        }
    }
}

fn increment_active_entry_for_endpoint(
    entries: &Mutex<HashMap<String, HashMap<String, u64>>>,
    endpoint: &str,
    key: &str,
) {
    if let Ok(mut entries) = entries.lock() {
        let bucket = entries.entry(endpoint.to_string()).or_default();
        let counter = bucket.entry(key.to_string()).or_insert(0);
        *counter += 1;
    }
}

fn decrement_active_entry_for_endpoint(
    entries: &Mutex<HashMap<String, HashMap<String, u64>>>,
    endpoint: &str,
    key: &str,
) {
    if let Ok(mut entries) = entries.lock() {
        if let Some(bucket) = entries.get_mut(endpoint) {
            if let Some(counter) = bucket.get_mut(key) {
                if *counter > 1 {
                    *counter -= 1;
                } else {
                    bucket.remove(key);
                }
            }
            if bucket.is_empty() {
                entries.remove(endpoint);
            }
        }
    }
}

fn increment_api_key_counter(entries: &Mutex<HashMap<i64, u64>>, api_key_id: i64) {
    if let Ok(mut entries) = entries.lock() {
        let counter = entries.entry(api_key_id).or_insert(0);
        *counter += 1;
    }
}

fn decrement_api_key_counter(entries: &Mutex<HashMap<i64, u64>>, api_key_id: i64) {
    if let Ok(mut entries) = entries.lock() {
        if let Some(counter) = entries.get_mut(&api_key_id) {
            if *counter > 1 {
                *counter -= 1;
            } else {
                entries.remove(&api_key_id);
            }
        }
    }
}

pub(super) async fn openai_models(State(state): State<AppState>, headers: HeaderMap) -> Response {
    if let Err(response) = authorize_request(&state, &headers, "openai") {
        return response;
    }
    let config = config_snapshot(&state);
    Json(json!({
        "object": "list",
        "data": build_models_response(&config, "openai")
    }))
    .into_response()
}

pub(super) async fn anthropic_count_tokens(
    State(state): State<AppState>,
    request: Request,
) -> Response {
    let headers = request.headers().clone();
    if let Err(response) = authorize_request(&state, &headers, "anthropic") {
        return response;
    }
    let (body, body_len) = match read_json_request_with_size(&state, request.into_body()).await {
        Ok(result) => result,
        Err(response) => return response,
    };
    record_network_ingress(&state, "anthropic", body_len);

    fn estimate_count_tokens(value: &Value) -> usize {
        fn text_tokens(text: &str) -> usize {
            text.len().div_ceil(3).max(1)
        }

        match value {
            Value::Null => 0,
            Value::Bool(_) => 1,
            Value::Number(_) => 2,
            Value::String(text) => text_tokens(text),
            Value::Array(values) => {
                values.iter().map(estimate_count_tokens).sum::<usize>() + values.len() + 2
            }
            Value::Object(map) => {
                map.iter()
                    .map(|(key, value)| text_tokens(key) + estimate_count_tokens(value) + 2)
                    .sum::<usize>()
                    + 2
            }
        }
    }

    json_response_with_network(
        &state,
        "anthropic",
        StatusCode::OK,
        &json!({ "input_tokens": estimate_count_tokens(&body) }),
    )
}

pub(super) async fn anthropic_messages(
    State(state): State<AppState>,
    ConnectInfo(connect_info): ConnectInfo<SocketAddr>,
    request: Request,
) -> Response {
    let query = request.uri().query().map(ToString::to_string);
    let headers = request.headers().clone();
    let api_key_context = match authorize_request_with_context(&state, &headers, "anthropic") {
        Ok(context) => context,
        Err(response) => return response,
    };
    let (body, body_len) = match read_json_request_with_size(&state, request.into_body()).await {
        Ok(result) => result,
        Err(response) => return response,
    };
    record_network_ingress(&state, "anthropic", body_len);
    let source_ip = extract_client_ip(&headers, Some(connect_info));
    proxy_standard_request(
        state,
        api_key_context,
        headers,
        source_ip,
        body,
        query,
        GatewayEndpoint::Anthropic,
        ProviderProtocol::AnthropicMessages,
    )
    .await
}

pub(super) async fn openai_chat_completions(
    State(state): State<AppState>,
    ConnectInfo(connect_info): ConnectInfo<SocketAddr>,
    request: Request,
) -> Response {
    let query = request.uri().query().map(ToString::to_string);
    let headers = request.headers().clone();
    let api_key_context = match authorize_request_with_context(&state, &headers, "openai") {
        Ok(context) => context,
        Err(response) => return response,
    };
    let (body, body_len) = match read_json_request_with_size(&state, request.into_body()).await {
        Ok(result) => result,
        Err(response) => return response,
    };
    record_network_ingress(&state, "openai", body_len);
    let source_ip = extract_client_ip(&headers, Some(connect_info));
    proxy_standard_request(
        state,
        api_key_context,
        headers,
        source_ip,
        body,
        query,
        GatewayEndpoint::OpenAi,
        ProviderProtocol::OpenAiChatCompletions,
    )
    .await
}

pub(super) async fn openai_responses(
    State(state): State<AppState>,
    ConnectInfo(connect_info): ConnectInfo<SocketAddr>,
    request: Request,
) -> Response {
    let query = request.uri().query().map(ToString::to_string);
    let headers = request.headers().clone();
    let api_key_context = match authorize_request_with_context(&state, &headers, "openai") {
        Ok(context) => context,
        Err(response) => return response,
    };
    let (body, body_len) = match read_json_request_with_size(&state, request.into_body()).await {
        Ok(result) => result,
        Err(response) => return response,
    };
    record_network_ingress(&state, "openai", body_len);
    let source_ip = extract_client_ip(&headers, Some(connect_info));
    proxy_standard_request(
        state,
        api_key_context,
        headers,
        source_ip,
        body,
        query,
        GatewayEndpoint::OpenAi,
        ProviderProtocol::OpenAiResponses,
    )
    .await
}

fn extract_requested_model(body: &Value) -> Option<&str> {
    body.get("model").and_then(Value::as_str)
}

fn extract_thinking(body: &Value) -> bool {
    match body.get("thinking") {
        Some(Value::Bool(value)) => *value,
        Some(Value::Object(map)) => !map.is_empty(),
        Some(Value::String(text)) => !text.trim().is_empty(),
        _ => false,
    }
}

fn thinking_explicitly_enabled(body: &Value) -> bool {
    match body.get("thinking") {
        Some(Value::Bool(value)) => *value,
        Some(Value::Object(map)) => map
            .get("type")
            .and_then(Value::as_str)
            .is_some_and(|value| value == "enabled"),
        Some(Value::String(text)) => text.trim().eq_ignore_ascii_case("enabled"),
        _ => false,
    }
}

fn provider_type_name(provider: &cc_gw_core::config::ProviderConfig) -> &str {
    provider.provider_type.as_deref().unwrap_or("openai")
}

fn provider_supports_tools(provider_type: &str) -> bool {
    provider_type != "custom"
}

fn provider_supports_metadata(provider_type: &str) -> bool {
    provider_type != "custom"
}

fn remove_top_level_key(body: &mut Value, key: &str) {
    if let Some(object) = body.as_object_mut() {
        object.remove(key);
    }
}

fn append_text_with_spacing(target: &mut String, text: &str) {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return;
    }
    if !target.is_empty() {
        target.push_str("\n\n");
    }
    target.push_str(trimmed);
}

fn stringify_value(value: &Value) -> String {
    match value {
        Value::Null => String::new(),
        Value::String(text) => text.clone(),
        _ => serde_json::to_string(value).unwrap_or_default(),
    }
}

fn summarize_tool_messages_for_custom_provider(body: &mut Value) {
    let Some(messages) = body.get("messages").and_then(Value::as_array).cloned() else {
        return;
    };

    let mut next_messages = Vec::with_capacity(messages.len());
    for message in messages {
        let Some(object) = message.as_object() else {
            next_messages.push(message);
            continue;
        };
        let role = object.get("role").and_then(Value::as_str).unwrap_or("");
        let mut next = object.clone();

        match role {
            "tool" => {
                let mut content = String::new();
                if let Some(name) = object.get("name").and_then(Value::as_str) {
                    append_text_with_spacing(&mut content, name);
                }
                if let Some(tool_output) = object.get("content") {
                    append_text_with_spacing(&mut content, &stringify_value(tool_output));
                }
                next_messages.push(json!({
                    "role": "user",
                    "content": content
                }));
            }
            "assistant" => {
                let mut content = object
                    .get("content")
                    .map(stringify_value)
                    .unwrap_or_default();
                for tool_call in object
                    .get("tool_calls")
                    .and_then(Value::as_array)
                    .into_iter()
                    .flatten()
                {
                    let name = tool_call
                        .get("function")
                        .and_then(|value| value.get("name"))
                        .and_then(Value::as_str)
                        .unwrap_or("tool");
                    let args = tool_call
                        .get("function")
                        .and_then(|value| value.get("arguments"))
                        .and_then(Value::as_str)
                        .unwrap_or("{}");
                    let summary = format!("Requested tool {name}\n{args}");
                    append_text_with_spacing(&mut content, &summary);
                }
                next.remove("tool_calls");
                next.remove("reasoning_content");
                next.insert("content".to_string(), Value::String(content));
                next_messages.push(Value::Object(next));
            }
            _ => next_messages.push(Value::Object(next)),
        }
    }

    if let Some(object) = body.as_object_mut() {
        object.insert("messages".to_string(), Value::Array(next_messages));
    }
}

fn downgrade_openai_chat_body_for_compatibility(body: &mut Value) {
    downgrade_openai_chat_body_for_tool_history_compatibility(body);
    remove_top_level_key(body, "tools");
}

fn downgrade_openai_chat_body_for_tool_history_compatibility(body: &mut Value) {
    remove_top_level_key(body, "tool_choice");
    remove_top_level_key(body, "metadata");
    remove_top_level_key(body, "parallel_tool_calls");
    if let Some(object) = body.as_object_mut() {
        if object.get("max_tokens").is_none() {
            if let Some(value) = object.get("max_completion_tokens").cloned() {
                object.insert("max_tokens".to_string(), value);
            }
        }
        object.remove("max_completion_tokens");
    }
    summarize_tool_messages_for_custom_provider(body);
}

fn downgrade_openai_chat_body_for_custom_provider(body: &mut Value) {
    downgrade_openai_chat_body_for_compatibility(body);
}

fn summarize_response_input_items_for_custom_provider(body: &mut Value) {
    let Some(items) = body.get("input").and_then(Value::as_array).cloned() else {
        return;
    };

    let mut next_items = Vec::with_capacity(items.len());
    for item in items {
        let Some(object) = item.as_object() else {
            next_items.push(item);
            continue;
        };

        match object.get("type").and_then(Value::as_str) {
            Some("function_call_output") => {
                let mut content = String::new();
                if let Some(call_id) = object.get("call_id").and_then(Value::as_str) {
                    append_text_with_spacing(&mut content, call_id);
                }
                if let Some(output) = object.get("output") {
                    append_text_with_spacing(&mut content, &stringify_value(output));
                }
                next_items.push(json!({
                    "type": "message",
                    "role": "user",
                    "content": [{
                        "type": "input_text",
                        "text": content
                    }]
                }));
            }
            Some("function_call") => {
                let name = object.get("name").and_then(Value::as_str).unwrap_or("tool");
                let arguments = object
                    .get("arguments")
                    .map(stringify_value)
                    .unwrap_or_else(|| "{}".to_string());
                next_items.push(json!({
                    "type": "message",
                    "role": "assistant",
                    "content": [{
                        "type": "output_text",
                        "text": format!("Requested tool {name}\n{arguments}")
                    }]
                }));
            }
            Some("message") => {
                let role = object.get("role").and_then(Value::as_str).unwrap_or("user");
                let mut content = String::new();
                for part in object
                    .get("content")
                    .and_then(Value::as_array)
                    .into_iter()
                    .flatten()
                {
                    match part.get("type").and_then(Value::as_str) {
                        Some("input_text") | Some("output_text") | Some("text") => {
                            let text = part.get("text").and_then(Value::as_str).unwrap_or_default();
                            append_text_with_spacing(&mut content, text);
                        }
                        Some("function_call") | Some("tool_use") => {
                            let name = part.get("name").and_then(Value::as_str).unwrap_or("tool");
                            let arguments = part
                                .get("arguments")
                                .or_else(|| part.get("input"))
                                .map(stringify_value)
                                .unwrap_or_else(|| "{}".to_string());
                            append_text_with_spacing(
                                &mut content,
                                &format!("Requested tool {name}\n{arguments}"),
                            );
                        }
                        Some("function_call_output") => {
                            let output =
                                part.get("output").map(stringify_value).unwrap_or_default();
                            append_text_with_spacing(&mut content, &output);
                        }
                        _ => {}
                    }
                }
                next_items.push(json!({
                    "type": "message",
                    "role": role,
                    "content": [{
                        "type": if role == "assistant" { "output_text" } else { "input_text" },
                        "text": content
                    }]
                }));
            }
            _ => next_items.push(Value::Object(object.clone())),
        }
    }

    if let Some(object) = body.as_object_mut() {
        object.insert("input".to_string(), Value::Array(next_items));
    }
}

fn downgrade_openai_responses_body_for_custom_provider(body: &mut Value) {
    remove_top_level_key(body, "tools");
    remove_top_level_key(body, "tool_choice");
    remove_top_level_key(body, "metadata");
    remove_top_level_key(body, "parallel_tool_calls");
    summarize_response_input_items_for_custom_provider(body);
}

fn downgrade_openai_responses_body_for_tool_history_compatibility(body: &mut Value) {
    remove_top_level_key(body, "tool_choice");
    remove_top_level_key(body, "metadata");
    remove_top_level_key(body, "parallel_tool_calls");
    summarize_response_input_items_for_custom_provider(body);
}

fn build_request_body_for_target(
    original_body: &Value,
    request_protocol: ProviderProtocol,
    target_protocol: ProviderProtocol,
    provider_type: &str,
    compatibility_enabled: bool,
    stream_usage: bool,
) -> Value {
    let mut converted = match (request_protocol, target_protocol) {
        (ProviderProtocol::AnthropicMessages, ProviderProtocol::OpenAiChatCompletions) => {
            anthropic_request_to_openai_chat(original_body)
        }
        (ProviderProtocol::AnthropicMessages, ProviderProtocol::OpenAiResponses) => {
            anthropic_request_to_openai_response(original_body)
        }
        (ProviderProtocol::OpenAiChatCompletions, ProviderProtocol::AnthropicMessages) => {
            openai_chat_request_to_anthropic(original_body)
        }
        (ProviderProtocol::OpenAiResponses, ProviderProtocol::AnthropicMessages) => {
            openai_responses_request_to_anthropic(original_body)
        }
        _ => original_body.clone(),
    };

    let same_protocol = request_protocol == target_protocol;

    if compatibility_enabled && !same_protocol && !provider_supports_metadata(provider_type) {
        remove_top_level_key(&mut converted, "metadata");
    }

    if compatibility_enabled && !same_protocol && !provider_supports_tools(provider_type) {
        match target_protocol {
            ProviderProtocol::OpenAiChatCompletions => {
                downgrade_openai_chat_body_for_custom_provider(&mut converted);
            }
            ProviderProtocol::OpenAiResponses => {
                downgrade_openai_responses_body_for_custom_provider(&mut converted);
            }
            ProviderProtocol::AnthropicMessages => {}
        }
    }

    // `stream_options.include_usage` makes an OpenAI upstream emit a terminal
    // usage chunk so streamed tokens can be accounted for. It's an OpenAI-specific
    // extension though — some OpenAI-compatible upstreams (Aliyun MaaS, internal
    // proxies) reject or truncate the stream on seeing it, returning an empty
    // response. Default off (restores pre-0.9.0 behavior); providers whose
    // upstream supports it opt in via `streamUsage`.
    if stream_usage
        && request_protocol == ProviderProtocol::AnthropicMessages
        && matches!(target_protocol, ProviderProtocol::OpenAiChatCompletions)
        && converted.get("stream").and_then(Value::as_bool) == Some(true)
    {
        if let Some(obj) = converted.as_object_mut() {
            obj.insert(
                "stream_options".to_string(),
                serde_json::json!({ "include_usage": true }),
            );
        }
    }

    converted
}

fn retry_body_without_metadata_or_tool_choice(body: &Value) -> Option<Value> {
    let mut retry = body.clone();
    let before = serde_json::to_string(&retry).ok()?;
    remove_top_level_key(&mut retry, "metadata");
    remove_top_level_key(&mut retry, "tool_choice");
    let after = serde_json::to_string(&retry).ok()?;
    if before == after { None } else { Some(retry) }
}

fn openai_compatibility_cache_key(
    provider_id: &str,
    target_protocol: ProviderProtocol,
    model_id: &str,
    declares_tools: bool,
    uses_reasoning_tokens: bool,
) -> String {
    let protocol = provider_protocol_name(target_protocol);
    let tools = if declares_tools { "tools" } else { "no-tools" };
    let reasoning = if uses_reasoning_tokens {
        "reasoning"
    } else {
        "no-reasoning"
    };
    format!("{provider_id}:{protocol}:{model_id}:{tools}:{reasoning}")
}

fn provider_protocol_name(protocol: ProviderProtocol) -> &'static str {
    match protocol {
        ProviderProtocol::OpenAiChatCompletions => "openai-chat",
        ProviderProtocol::OpenAiResponses => "openai-responses",
        ProviderProtocol::AnthropicMessages => "anthropic",
    }
}

fn cached_openai_compatibility_mode(
    state: &AppState,
    provider_id: &str,
    target_protocol: ProviderProtocol,
    model_id: &str,
    declares_tools: bool,
    uses_reasoning_tokens: bool,
) -> OpenAiCompatibilityMode {
    let key = openai_compatibility_cache_key(
        provider_id,
        target_protocol,
        model_id,
        declares_tools,
        uses_reasoning_tokens,
    );
    state
        .openai_compatibility_modes
        .lock()
        .ok()
        .and_then(|entries| entries.get(&key).copied())
        .unwrap_or(OpenAiCompatibilityMode::Standard)
}

fn remember_openai_compatibility_mode(
    state: &AppState,
    provider_id: &str,
    target_protocol: ProviderProtocol,
    model_id: &str,
    declares_tools: bool,
    uses_reasoning_tokens: bool,
    mode: OpenAiCompatibilityMode,
) {
    if mode == OpenAiCompatibilityMode::Standard {
        return;
    }
    let key = openai_compatibility_cache_key(
        provider_id,
        target_protocol,
        model_id,
        declares_tools,
        uses_reasoning_tokens,
    );
    if let Ok(mut entries) = state.openai_compatibility_modes.lock() {
        entries.insert(key, mode);
    }
}

fn openai_compatibility_mode_rank(mode: OpenAiCompatibilityMode) -> usize {
    match mode {
        OpenAiCompatibilityMode::Standard => 0,
        OpenAiCompatibilityMode::StripMetadataAndToolChoice => 1,
        OpenAiCompatibilityMode::ToolHistoryCompatibility => 2,
        OpenAiCompatibilityMode::Compatibility => 3,
    }
}

fn openai_compatibility_mode_name(mode: OpenAiCompatibilityMode) -> &'static str {
    match mode {
        OpenAiCompatibilityMode::Standard => "standard",
        OpenAiCompatibilityMode::StripMetadataAndToolChoice => "strip-metadata-tool-choice",
        OpenAiCompatibilityMode::ToolHistoryCompatibility => "tool-history-compatibility",
        OpenAiCompatibilityMode::Compatibility => "compatibility",
    }
}

fn openai_request_declares_tools(body: &Value, target_protocol: ProviderProtocol) -> bool {
    match target_protocol {
        ProviderProtocol::OpenAiChatCompletions | ProviderProtocol::OpenAiResponses => body
            .get("tools")
            .and_then(Value::as_array)
            .is_some_and(|tools| !tools.is_empty()),
        ProviderProtocol::AnthropicMessages => false,
    }
}

fn openai_request_uses_reasoning_tokens(body: &Value, target_protocol: ProviderProtocol) -> bool {
    match target_protocol {
        ProviderProtocol::OpenAiChatCompletions => body.get("max_completion_tokens").is_some(),
        ProviderProtocol::OpenAiResponses => {
            body.get("reasoning").is_some()
                || body
                    .get("input")
                    .and_then(Value::as_array)
                    .is_some_and(|items| {
                        items.iter().any(|item| {
                            item.get("type").and_then(Value::as_str) == Some("reasoning")
                                || item
                                    .get("summary")
                                    .and_then(Value::as_array)
                                    .is_some_and(|summary| !summary.is_empty())
                                || item.get("content").and_then(Value::as_array).is_some_and(
                                    |content| {
                                        content.iter().any(|part| {
                                            part.get("type").and_then(Value::as_str)
                                                == Some("reasoning_text")
                                        })
                                    },
                                )
                                || item.get("reasoning_content").is_some()
                                || item.get("content").and_then(Value::as_array).is_some_and(
                                    |content| {
                                        content.iter().any(|part| {
                                            part.get("type").and_then(Value::as_str)
                                                == Some("reasoning")
                                        })
                                    },
                                )
                        })
                    })
        }
        ProviderProtocol::AnthropicMessages => false,
    }
}

fn apply_openai_compatibility_mode(
    body: &Value,
    target_protocol: ProviderProtocol,
    mode: OpenAiCompatibilityMode,
) -> Value {
    match mode {
        OpenAiCompatibilityMode::Standard => body.clone(),
        OpenAiCompatibilityMode::StripMetadataAndToolChoice => {
            retry_body_without_metadata_or_tool_choice(body).unwrap_or_else(|| body.clone())
        }
        OpenAiCompatibilityMode::ToolHistoryCompatibility => {
            let mut retry = body.clone();
            match target_protocol {
                ProviderProtocol::OpenAiChatCompletions => {
                    downgrade_openai_chat_body_for_tool_history_compatibility(&mut retry);
                }
                ProviderProtocol::OpenAiResponses => {
                    downgrade_openai_responses_body_for_tool_history_compatibility(&mut retry);
                }
                ProviderProtocol::AnthropicMessages => {}
            }
            retry
        }
        OpenAiCompatibilityMode::Compatibility => {
            let mut retry = body.clone();
            match target_protocol {
                ProviderProtocol::OpenAiChatCompletions => {
                    downgrade_openai_chat_body_for_compatibility(&mut retry);
                }
                ProviderProtocol::OpenAiResponses => {
                    downgrade_openai_responses_body_for_custom_provider(&mut retry);
                }
                ProviderProtocol::AnthropicMessages => {}
            }
            retry
        }
    }
}

fn retry_bodies_for_openai_compatibility(
    body: &Value,
    target_protocol: ProviderProtocol,
    current_mode: OpenAiCompatibilityMode,
    current_body: &Value,
) -> Vec<(OpenAiCompatibilityMode, Value)> {
    let mut retries = Vec::new();
    let mut seen = std::collections::HashSet::new();
    let declares_tools = openai_request_declares_tools(body, target_protocol);
    if let Ok(serialized) = serde_json::to_string(current_body) {
        seen.insert(serialized);
    }

    let mut modes = vec![OpenAiCompatibilityMode::StripMetadataAndToolChoice];
    if declares_tools {
        modes.push(OpenAiCompatibilityMode::ToolHistoryCompatibility);
    }
    if !declares_tools {
        modes.push(OpenAiCompatibilityMode::Compatibility);
    }

    for mode in modes {
        if openai_compatibility_mode_rank(mode) <= openai_compatibility_mode_rank(current_mode) {
            continue;
        }
        let retry = apply_openai_compatibility_mode(body, target_protocol, mode);
        if let Ok(serialized) = serde_json::to_string(&retry) {
            if seen.insert(serialized) {
                retries.push((mode, retry));
            }
        }
    }

    retries
}

fn routing_config_for_endpoint<'a>(
    config: &'a GatewayConfig,
    endpoint: GatewayEndpoint<'_>,
    protocol: ProviderProtocol,
) -> Option<&'a cc_gw_core::config::EndpointRoutingConfig> {
    let _ = protocol;
    match endpoint {
        GatewayEndpoint::Anthropic => config.endpoint_routing.get("anthropic"),
        GatewayEndpoint::OpenAi => config.endpoint_routing.get("openai"),
        // Keep in sync with cc_gw_core::routing::endpoint_routing: custom
        // endpoints never inherit the global protocol routing table.
        GatewayEndpoint::Custom(id) => config
            .custom_endpoints
            .iter()
            .find(|item| item.id == id)
            .and_then(|item| item.routing.as_ref())
            .or_else(|| config.endpoint_routing.get(id)),
    }
}

fn openai_compatibility_enabled_for_endpoint(
    config: &GatewayConfig,
    endpoint: GatewayEndpoint<'_>,
    protocol: ProviderProtocol,
) -> bool {
    routing_config_for_endpoint(config, endpoint, protocol)
        .and_then(|routing| routing.compatibility.as_ref())
        .is_some_and(|compatibility| compatibility.enabled)
}

fn target_uses_non_stream_via_stream(provider: &ProviderConfig, model_id: &str) -> bool {
    provider
        .models
        .iter()
        .find(|model| model.id == model_id)
        .and_then(|model| model.non_stream_via_stream)
        .or(provider.non_stream_via_stream)
        .unwrap_or(false)
}

fn is_claude_code_auto_mode_classifier_request(protocol: ProviderProtocol, body: &Value) -> bool {
    if protocol != ProviderProtocol::AnthropicMessages {
        return false;
    }
    let max_tokens = body.get("max_tokens").and_then(Value::as_u64);
    if max_tokens != Some(64) {
        return false;
    }
    if body
        .get("tools")
        .and_then(Value::as_array)
        .is_some_and(|tools| !tools.is_empty())
    {
        return false;
    }
    if body
        .get("thinking")
        .and_then(|thinking| thinking.get("type"))
        .and_then(Value::as_str)
        != Some("disabled")
    {
        return false;
    }
    let stops_at_block = body
        .get("stop_sequences")
        .and_then(Value::as_array)
        .is_some_and(|items| items.iter().any(|item| item.as_str() == Some("</block>")));
    if !stops_at_block {
        return false;
    }
    match body.get("system") {
        Some(Value::String(text)) => {
            text.contains("security monitor for autonomous AI coding agents")
        }
        Some(Value::Array(items)) => items
            .iter()
            .filter_map(|item| item.get("text").and_then(Value::as_str))
            .any(|text| text.contains("security monitor for autonomous AI coding agents")),
        _ => false,
    }
}

fn strip_anthropic_thinking_blocks(response: &mut Value, allow_text_fallback: bool) {
    let Some(content) = response.get_mut("content").and_then(Value::as_array_mut) else {
        return;
    };
    let mut fallback_text = Vec::new();
    if allow_text_fallback {
        for block in content.iter() {
            match block.get("type").and_then(Value::as_str) {
                Some("thinking") => {
                    if let Some(text) = block.get("thinking").and_then(Value::as_str) {
                        if !text.trim().is_empty() {
                            fallback_text.push(text.to_string());
                        }
                    }
                }
                _ => {}
            }
        }
    }
    content.retain(|block| {
        !matches!(
            block.get("type").and_then(Value::as_str),
            Some("thinking" | "redacted_thinking")
        )
    });
    if content.is_empty() && allow_text_fallback && !fallback_text.is_empty() {
        content.push(json!({
            "type": "text",
            "text": fallback_text.join("\n")
        }));
    }
}

pub(super) async fn proxy_standard_request(
    state: AppState,
    api_key_context: cc_gw_core::api_keys::ResolvedApiKey,
    headers: HeaderMap,
    source_ip: Option<String>,
    body: Value,
    query: Option<String>,
    endpoint: GatewayEndpoint<'_>,
    protocol: ProviderProtocol,
) -> Response {
    let started_at = chrono::Utc::now().timestamp_millis();
    let endpoint_id = endpoint_name(endpoint, protocol);
    let network_recorder = NetworkByteRecorder::new(&state, &endpoint_id);
    let user_agent = header_value(&headers, header::USER_AGENT.as_str());
    let _client_kind = infer_client_kind(&headers, user_agent.as_deref(), protocol);
    let session_id = extract_request_session_id(&body, &headers);

    // Atomically check per-key concurrency limit and create the activity guard
    let activity_guard = match RequestActivityGuard::try_new_with_concurrency_check(
        &state,
        endpoint_id.clone(),
        source_ip.clone(),
        session_id.clone(),
        Some(api_key_context.id),
        api_key_context.max_concurrency,
    ) {
        Ok(guard) => guard,
        Err(current) => {
            let max = api_key_context.max_concurrency.unwrap();
            record_and_broadcast_event(
                &state,
                RecordEventInput {
                    event_type: "api_key_concurrency_rejected".to_string(),
                    level: Some("warn".to_string()),
                    source: Some("auth".to_string()),
                    title: Some("API key concurrency limit exceeded".to_string()),
                    message: Some(format!(
                        "Request rejected: API key {} exceeded max concurrency of {}",
                        api_key_context.name, max
                    )),
                    api_key_id: Some(api_key_context.id),
                    api_key_name: Some(api_key_context.name.clone()),
                    endpoint: Some(endpoint_id.clone()),
                    ip_address: source_ip.clone(),
                    user_agent: user_agent.clone(),
                    details: Some(json!({
                        "maxConcurrency": max,
                        "currentCount": current
                    })),
                    ..RecordEventInput::default()
                },
            );
            return (
                StatusCode::TOO_MANY_REQUESTS,
                Json(json!({
                    "error": {
                        "code": "concurrency_limit_exceeded",
                        "message": format!(
                            "API key has reached its maximum concurrency limit of {}",
                            max
                        )
                    }
                })),
            )
                .into_response();
        }
    };
    let encrypted_api_key_value = if api_key_context.provided_key.is_empty() {
        None
    } else {
        encrypt_secret(&state.paths.home_dir, &api_key_context.provided_key).ok()
    };
    let config = config_snapshot(&state);
    let request_payload_storage = request_payload_storage_enabled(&config);
    let client_request_payload = if request_payload_storage {
        serde_json::to_string(&body).ok()
    } else {
        None
    };

    let requested_model = extract_requested_model(&body);
    let target = match resolve_route(
        &config,
        endpoint,
        protocol,
        &body,
        requested_model,
        extract_thinking(&body),
    ) {
        Ok(target) => target,
        Err(error) => {
            return json_response_with_network(
                &state,
                &endpoint_id,
                StatusCode::BAD_REQUEST,
                &json!({
                    "error": {
                        "message": error.to_string()
                    }
                }),
            );
        }
    };

    let stream = body.get("stream").and_then(Value::as_bool).unwrap_or(false);
    let request_log_id = insert_request_log(
        &state.paths.db_path,
        &RequestLogInput {
            timestamp: started_at,
            session_id: session_id.clone(),
            source_ip: source_ip.clone(),
            endpoint: endpoint_id.clone(),
            provider: target.provider_id.clone(),
            model: target.model_id.clone(),
            client_model: requested_model.map(ToString::to_string),
            stream,
            api_key_id: Some(api_key_context.id),
            api_key_name: Some(api_key_context.name.clone()),
            api_key_value: encrypted_api_key_value.clone(),
        },
    )
    .ok();
    let provider_type = provider_type_name(&target.provider);
    let target_protocol = if provider_prefers_anthropic_protocol(&target.provider) {
        ProviderProtocol::AnthropicMessages
    } else {
        match protocol {
            ProviderProtocol::AnthropicMessages => {
                if provider_prefers_openai_responses_protocol(&target.provider) {
                    ProviderProtocol::OpenAiResponses
                } else {
                    ProviderProtocol::OpenAiChatCompletions
                }
            }
            ProviderProtocol::OpenAiChatCompletions => ProviderProtocol::OpenAiChatCompletions,
            ProviderProtocol::OpenAiResponses => ProviderProtocol::OpenAiResponses,
        }
    };

    let endpoint_compatibility_enabled =
        openai_compatibility_enabled_for_endpoint(&config, endpoint, protocol);
    let converted_request_body = build_request_body_for_target(
        &body,
        protocol,
        target_protocol,
        provider_type,
        endpoint_compatibility_enabled,
        target.provider.stream_usage.unwrap_or(false),
    );
    let cross_protocol = !matches!(
        (protocol, target_protocol),
        (
            ProviderProtocol::AnthropicMessages,
            ProviderProtocol::AnthropicMessages
        ) | (
            ProviderProtocol::OpenAiChatCompletions,
            ProviderProtocol::OpenAiChatCompletions
        ) | (
            ProviderProtocol::OpenAiResponses,
            ProviderProtocol::OpenAiResponses
        )
    );
    let request_declares_tools =
        openai_request_declares_tools(&converted_request_body, target_protocol);
    let request_uses_reasoning_tokens =
        openai_request_uses_reasoning_tokens(&converted_request_body, target_protocol);
    let openai_compatibility_enabled = endpoint_compatibility_enabled && cross_protocol;
    let openai_compatibility_mode = if openai_compatibility_enabled
        && matches!(
            target_protocol,
            ProviderProtocol::OpenAiChatCompletions | ProviderProtocol::OpenAiResponses
        ) {
        let cached = cached_openai_compatibility_mode(
            &state,
            &target.provider_id,
            target_protocol,
            &target.model_id,
            request_declares_tools,
            request_uses_reasoning_tokens,
        );
        if request_declares_tools && cached == OpenAiCompatibilityMode::Compatibility {
            OpenAiCompatibilityMode::ToolHistoryCompatibility
        } else {
            cached
        }
    } else {
        OpenAiCompatibilityMode::Standard
    };
    let initial_request_body = apply_openai_compatibility_mode(
        &converted_request_body,
        target_protocol,
        openai_compatibility_mode,
    );
    let target_model_id = target.model_id.clone();
    let sanitize_classifier_response = is_claude_code_auto_mode_classifier_request(protocol, &body);
    let emit_anthropic_reasoning =
        protocol != ProviderProtocol::AnthropicMessages || thinking_explicitly_enabled(&body);
    let allow_anthropic_reasoning_fallback = !sanitize_classifier_response;
    let upstream_stream =
        stream || target_uses_non_stream_via_stream(&target.provider, &target_model_id);
    let initial_upstream_body = prepare_proxy_payload(
        initial_request_body.clone(),
        &target_model_id,
        upstream_stream,
    );
    let mut upstream_request_payload = if request_payload_storage && initial_upstream_body != body {
        serde_json::to_string(&initial_upstream_body).ok()
    } else {
        None
    };
    if let (Some(log_id), true) = (request_log_id, request_payload_storage) {
        let _ = upsert_request_payload(
            &state.paths.db_path,
            log_id,
            &LogPayloadUpdate {
                client_request: client_request_payload.as_deref(),
                upstream_request: upstream_request_payload.as_deref(),
                ..LogPayloadUpdate::default()
            },
        );
    }

    let upstream_query = query.clone();
    let proxy_result = forward_request(
        &state.http_client,
        &target.provider,
        target_protocol,
        ProxyRequest {
            model: target_model_id.clone(),
            body: initial_request_body.clone(),
            stream: upstream_stream,
            incoming_headers: headers.clone(),
            passthrough_headers: HeaderMap::new(),
            query: upstream_query.clone(),
        },
    )
    .await;

    match proxy_result {
        Ok(mut response) => {
            if openai_compatibility_enabled
                && matches!(
                    target_protocol,
                    ProviderProtocol::OpenAiChatCompletions | ProviderProtocol::OpenAiResponses
                )
                && response.status().as_u16() >= 400
            {
                for (retry_mode, retry_body) in retry_bodies_for_openai_compatibility(
                    &converted_request_body,
                    target_protocol,
                    openai_compatibility_mode,
                    &initial_request_body,
                ) {
                    if let Ok(retry_response) = forward_request(
                        &state.http_client,
                        &target.provider,
                        target_protocol,
                        ProxyRequest {
                            model: target_model_id.clone(),
                            body: retry_body.clone(),
                            stream: upstream_stream,
                            incoming_headers: headers.clone(),
                            passthrough_headers: HeaderMap::new(),
                            query: upstream_query.clone(),
                        },
                    )
                    .await
                    {
                        if retry_response.status().as_u16() < 400 {
                            response = retry_response;
                            remember_openai_compatibility_mode(
                                &state,
                                &target.provider_id,
                                target_protocol,
                                &target.model_id,
                                request_declares_tools,
                                request_uses_reasoning_tokens,
                                retry_mode,
                            );
                            record_and_broadcast_event(
                                &state,
                                RecordEventInput {
                                    event_type: "openai_compatibility_mode_learned".to_string(),
                                    level: Some("info".to_string()),
                                    source: Some("proxy".to_string()),
                                    title: Some("OpenAI compatibility mode learned".to_string()),
                                    message: Some(format!(
                                        "Provider {} accepted {} requests after retrying in {} mode",
                                        target.provider_id,
                                        provider_protocol_name(target_protocol),
                                        openai_compatibility_mode_name(retry_mode)
                                    )),
                                    endpoint: Some(endpoint_id.clone()),
                                    ip_address: source_ip.clone(),
                                    api_key_id: Some(api_key_context.id),
                                    api_key_name: Some(api_key_context.name.clone()),
                                    api_key_value: encrypted_api_key_value.clone(),
                                    user_agent: user_agent.clone(),
                                    mode: Some(
                                        openai_compatibility_mode_name(retry_mode).to_string(),
                                    ),
                                    details: Some(json!({
                                        "provider": target.provider_id,
                                        "model": target.model_id,
                                        "requestProtocol": provider_protocol_name(protocol),
                                        "targetProtocol": provider_protocol_name(target_protocol)
                                    })),
                                    ..RecordEventInput::default()
                                },
                            );
                            let retry_upstream_body = prepare_proxy_payload(
                                retry_body.clone(),
                                &target_model_id,
                                upstream_stream,
                            );
                            upstream_request_payload =
                                if request_payload_storage && retry_upstream_body != body {
                                    serde_json::to_string(&retry_upstream_body).ok()
                                } else {
                                    None
                                };
                            if let (Some(log_id), true) = (request_log_id, request_payload_storage)
                            {
                                let _ = upsert_request_payload(
                                    &state.paths.db_path,
                                    log_id,
                                    &LogPayloadUpdate {
                                        upstream_request: upstream_request_payload.as_deref(),
                                        ..LogPayloadUpdate::default()
                                    },
                                );
                            }
                            break;
                        }
                    }
                }
            }
            let streaming_log_context = request_log_id.map(|log_id| StreamingLogContext {
                db_path: state.paths.db_path.clone(),
                log_id,
                endpoint_id: endpoint_id.clone(),
                api_key_id: api_key_context.id,
                started_at,
                store_response_payload: response_payload_storage_enabled(&config),
            });
            if upstream_stream && !stream {
                let (
                    result,
                    usage,
                    upstream_response_payload,
                    client_response_payload,
                    response_status,
                ) = into_materialized_stream_response(
                    response,
                    protocol,
                    target_protocol,
                    &target.provider_id,
                    requested_model.unwrap_or(""),
                    sanitize_classifier_response,
                    emit_anthropic_reasoning,
                    allow_anthropic_reasoning_fallback,
                    network_recorder.clone(),
                )
                .await;
                let latency_ms = chrono::Utc::now().timestamp_millis() - started_at;
                let status_code = response_status.as_u16() as i64;
                if let Some(log_id) = request_log_id {
                    let update = RequestLogUpdate {
                        latency_ms: Some(latency_ms),
                        status_code: Some(status_code),
                        error_source: upstream_error_source_for_status(status_code),
                        input_tokens: Some(usage.input_tokens),
                        output_tokens: Some(usage.output_tokens),
                        cached_tokens: Some(usage.cached_tokens),
                        cache_read_tokens: Some(usage.cache_read_tokens),
                        cache_creation_tokens: Some(usage.cache_creation_tokens),
                        ..RequestLogUpdate::default()
                    };
                    let _ = finalize_request_log(&state.paths.db_path, log_id, &update);
                    let _ = increment_daily_metrics(
                        &state.paths.db_path,
                        &endpoint_id,
                        latency_ms,
                        &usage,
                    );
                    let _ = record_api_key_usage(&state.paths.db_path, api_key_context.id, &usage);
                    let store_response_payload = response_payload_storage_enabled(&config);
                    if store_response_payload {
                        let _ = upsert_request_payload(
                            &state.paths.db_path,
                            log_id,
                            &LogPayloadUpdate {
                                upstream_response: upstream_response_payload.as_deref().filter(
                                    |payload| Some(*payload) != client_response_payload.as_deref(),
                                ),
                                client_response: client_response_payload.as_deref(),
                                ..LogPayloadUpdate::default()
                            },
                        );
                    }
                }
                result
            } else if cross_protocol && stream {
                into_streaming_converted_response(
                    response,
                    protocol,
                    target_protocol,
                    &target.provider_id,
                    requested_model.unwrap_or(""),
                    emit_anthropic_reasoning,
                    allow_anthropic_reasoning_fallback,
                    network_recorder.clone(),
                    streaming_log_context,
                    Some(activity_guard),
                )
                .await
            } else if stream {
                into_streaming_proxy_response(
                    response,
                    target_protocol,
                    network_recorder.clone(),
                    streaming_log_context,
                    Some(activity_guard),
                )
                .await
            } else if cross_protocol {
                let status_code = response.status().as_u16() as i64;
                let latency_ms = chrono::Utc::now().timestamp_millis() - started_at;
                let (result, usage, upstream_response_payload, client_response_payload) =
                    into_converted_response(
                        response,
                        protocol,
                        target_protocol,
                        &target.provider_id,
                        requested_model.unwrap_or(""),
                        emit_anthropic_reasoning,
                        allow_anthropic_reasoning_fallback,
                        network_recorder.clone(),
                    )
                    .await;
                if let Some(log_id) = request_log_id {
                    let update = RequestLogUpdate {
                        latency_ms: Some(latency_ms),
                        status_code: Some(status_code),
                        error_source: upstream_error_source_for_status(status_code),
                        input_tokens: Some(usage.input_tokens),
                        output_tokens: Some(usage.output_tokens),
                        cached_tokens: Some(usage.cached_tokens),
                        cache_read_tokens: Some(usage.cache_read_tokens),
                        cache_creation_tokens: Some(usage.cache_creation_tokens),
                        ..RequestLogUpdate::default()
                    };
                    let _ = finalize_request_log(&state.paths.db_path, log_id, &update);
                    let _ = increment_daily_metrics(
                        &state.paths.db_path,
                        &endpoint_id,
                        latency_ms,
                        &usage,
                    );
                    let _ = record_api_key_usage(&state.paths.db_path, api_key_context.id, &usage);
                    let store_response_payload = response_payload_storage_enabled(&config);
                    if store_response_payload {
                        let _ = upsert_request_payload(
                            &state.paths.db_path,
                            log_id,
                            &LogPayloadUpdate {
                                upstream_response: upstream_response_payload.as_deref().filter(
                                    |payload| Some(*payload) != client_response_payload.as_deref(),
                                ),
                                client_response: client_response_payload.as_deref(),
                                ..LogPayloadUpdate::default()
                            },
                        );
                    }
                }
                result
            } else {
                let status_code = response.status().as_u16() as i64;
                let latency_ms = chrono::Utc::now().timestamp_millis() - started_at;
                let (result, usage, response_payload) =
                    into_proxy_response(response, !stream, network_recorder.clone()).await;
                if let Some(log_id) = request_log_id {
                    let update = RequestLogUpdate {
                        latency_ms: Some(latency_ms),
                        status_code: Some(status_code),
                        error_source: upstream_error_source_for_status(status_code),
                        input_tokens: Some(usage.input_tokens),
                        output_tokens: Some(usage.output_tokens),
                        cached_tokens: Some(usage.cached_tokens),
                        cache_read_tokens: Some(usage.cache_read_tokens),
                        cache_creation_tokens: Some(usage.cache_creation_tokens),
                        ..RequestLogUpdate::default()
                    };
                    let _ = finalize_request_log(&state.paths.db_path, log_id, &update);
                    let _ = increment_daily_metrics(
                        &state.paths.db_path,
                        &endpoint_id,
                        latency_ms,
                        &usage,
                    );
                    let _ = record_api_key_usage(&state.paths.db_path, api_key_context.id, &usage);
                    let store_response_payload = response_payload_storage_enabled(&config);
                    if store_response_payload {
                        let _ = upsert_request_payload(
                            &state.paths.db_path,
                            log_id,
                            &LogPayloadUpdate {
                                client_response: response_payload.as_deref(),
                                ..LogPayloadUpdate::default()
                            },
                        );
                    }
                }
                result
            }
        }
        Err(error) => {
            tracing::warn!(error = %error, provider = %target.provider_id, "upstream request failed");
            let latency_ms = chrono::Utc::now().timestamp_millis() - started_at;
            if let Some(log_id) = request_log_id {
                let update = RequestLogUpdate {
                    latency_ms: Some(latency_ms),
                    status_code: Some(502),
                    error: Some(error.to_string()),
                    error_source: Some(ERROR_SOURCE_UPSTREAM.to_string()),
                    ..RequestLogUpdate::default()
                };
                let _ = finalize_request_log(&state.paths.db_path, log_id, &update);
                let _ = increment_daily_metrics(
                    &state.paths.db_path,
                    &endpoint_id,
                    latency_ms,
                    &UsageStats::default(),
                );
            }
            record_and_broadcast_event(
                &state,
                RecordEventInput {
                    event_type: "provider_proxy_failure".to_string(),
                    level: Some("error".to_string()),
                    source: Some("proxy".to_string()),
                    title: Some("Provider request failed".to_string()),
                    message: Some(error.to_string()),
                    endpoint: Some(endpoint_id.clone()),
                    api_key_id: Some(api_key_context.id),
                    api_key_name: Some(api_key_context.name),
                    api_key_value: encrypted_api_key_value,
                    user_agent,
                    details: Some(json!({ "provider": target.provider_id })),
                    ..RecordEventInput::default()
                },
            );
            json_response_with_network(
                &state,
                &endpoint_id,
                StatusCode::BAD_GATEWAY,
                &json!({
                    "error": {
                        "message": sanitize_upstream_error(&error),
                        "provider": target.provider_id
                    }
                }),
            )
        }
    }
}

async fn into_converted_response(
    response: reqwest::Response,
    request_protocol: ProviderProtocol,
    target_protocol: ProviderProtocol,
    provider_id: &str,
    requested_model: &str,
    emit_anthropic_reasoning: bool,
    allow_anthropic_reasoning_fallback: bool,
    network_recorder: NetworkByteRecorder,
) -> (Response, UsageStats, Option<String>, Option<String>) {
    let status = response.status();
    let headers = response.headers().clone();
    let body_bytes = match response.bytes().await {
        Ok(bytes) => bytes,
        Err(error) => {
            let payload = protocol_error_payload(
                request_protocol,
                &format!("failed to read upstream response: {error}"),
            );
            let (result, client_payload) = build_json_response(
                StatusCode::BAD_GATEWAY,
                &headers,
                &payload,
                &network_recorder,
            );
            return (result, UsageStats::default(), None, client_payload);
        }
    };
    let upstream_payload = Some(String::from_utf8_lossy(&body_bytes).to_string());

    let payload: Value = match serde_json::from_slice(&body_bytes) {
        Ok(payload) => payload,
        Err(error) => {
            if let Some((payload, fallback_status)) = extract_sse_upstream_error_payload(
                target_protocol,
                upstream_payload.as_deref().unwrap_or_default(),
            ) {
                let converted = convert_error_payload(&payload, request_protocol, target_protocol);
                let (result, client_payload) =
                    build_json_response(fallback_status, &headers, &converted, &network_recorder);
                return (
                    result,
                    UsageStats::default(),
                    upstream_payload,
                    client_payload,
                );
            }
            if !status.is_success() {
                let payload = non_json_upstream_error_payload(
                    request_protocol,
                    status,
                    &headers,
                    &body_bytes,
                );
                record_non_json_upstream_error_fallback(
                    &network_recorder,
                    provider_id,
                    request_protocol,
                    target_protocol,
                    status,
                    &headers,
                    &error,
                    &payload,
                );
                let (result, client_payload) =
                    build_json_response(status, &headers, &payload, &network_recorder);
                return (
                    result,
                    UsageStats::default(),
                    upstream_payload,
                    client_payload,
                );
            }
            let payload = protocol_error_payload(
                request_protocol,
                &format!("failed to decode upstream JSON: {error}"),
            );
            let (result, client_payload) = build_json_response(
                StatusCode::BAD_GATEWAY,
                &headers,
                &payload,
                &network_recorder,
            );
            return (
                result,
                UsageStats::default(),
                upstream_payload,
                client_payload,
            );
        }
    };

    let model = if requested_model.is_empty() {
        payload
            .get("model")
            .and_then(Value::as_str)
            .unwrap_or("unknown-model")
    } else {
        requested_model
    };

    let usage = extract_usage_stats(&payload);
    let mut converted = if status.is_success() {
        match (request_protocol, target_protocol) {
            (ProviderProtocol::AnthropicMessages, ProviderProtocol::OpenAiChatCompletions) => {
                openai_chat_response_to_anthropic(&payload, model)
            }
            (ProviderProtocol::AnthropicMessages, ProviderProtocol::OpenAiResponses) => {
                openai_responses_response_to_anthropic(&payload, model)
            }
            (ProviderProtocol::OpenAiChatCompletions, ProviderProtocol::AnthropicMessages) => {
                anthropic_response_to_openai_chat(&payload, model)
            }
            (ProviderProtocol::OpenAiResponses, ProviderProtocol::AnthropicMessages) => {
                anthropic_response_to_openai_response(&payload, model)
            }
            _ => payload.clone(),
        }
    } else {
        convert_error_payload(&payload, request_protocol, target_protocol)
    };
    if status.is_success()
        && request_protocol == ProviderProtocol::AnthropicMessages
        && !emit_anthropic_reasoning
    {
        strip_anthropic_thinking_blocks(&mut converted, allow_anthropic_reasoning_fallback);
    }

    let (result, response_payload) =
        build_json_response(status, &headers, &converted, &network_recorder);
    (result, usage, upstream_payload, response_payload)
}

async fn into_materialized_stream_response(
    response: reqwest::Response,
    request_protocol: ProviderProtocol,
    target_protocol: ProviderProtocol,
    provider_id: &str,
    requested_model: &str,
    sanitize_classifier_response: bool,
    emit_anthropic_reasoning: bool,
    allow_anthropic_reasoning_fallback: bool,
    network_recorder: NetworkByteRecorder,
) -> (
    Response,
    UsageStats,
    Option<String>,
    Option<String>,
    StatusCode,
) {
    let status = response.status();
    let headers = response.headers().clone();
    if !status.is_success() {
        if request_protocol == target_protocol {
            let (result, usage, response_payload) =
                into_proxy_response(response, true, network_recorder).await;
            return (result, usage, None, response_payload, status);
        }
        let (result, usage, upstream_payload, response_payload) = into_converted_response(
            response,
            request_protocol,
            target_protocol,
            provider_id,
            requested_model,
            emit_anthropic_reasoning,
            allow_anthropic_reasoning_fallback,
            network_recorder,
        )
        .await;
        return (result, usage, upstream_payload, response_payload, status);
    }

    let mut stream = response.bytes_stream();
    let mut raw_stream_bytes = Vec::new();

    loop {
        match stream.try_next().await {
            Ok(Some(chunk)) => {
                raw_stream_bytes.extend_from_slice(&chunk);
            }
            Ok(None) => break,
            Err(error) => {
                let raw_stream = String::from_utf8_lossy(&raw_stream_bytes).to_string();
                let payload = protocol_error_payload(
                    request_protocol,
                    &format!("failed to read upstream stream: {error}"),
                );
                let (result, client_payload) = build_json_response(
                    StatusCode::BAD_GATEWAY,
                    &headers,
                    &payload,
                    &network_recorder,
                );
                return (
                    result,
                    UsageStats::default(),
                    Some(raw_stream),
                    client_payload,
                    StatusCode::BAD_GATEWAY,
                );
            }
        }
    }

    let raw_stream = String::from_utf8_lossy(&raw_stream_bytes).to_string();
    if let Some((payload, error_status)) =
        extract_sse_upstream_error_payload(target_protocol, &raw_stream)
    {
        let converted = convert_error_payload(&payload, request_protocol, target_protocol);
        let (result, client_payload) =
            build_json_response(error_status, &headers, &converted, &network_recorder);
        return (
            result,
            UsageStats::default(),
            Some(raw_stream),
            client_payload,
            error_status,
        );
    }

    let Some(materialized) = materialize_stream_response(target_protocol, &raw_stream) else {
        let payload = protocol_error_payload(
            request_protocol,
            "failed to materialize upstream streaming response",
        );
        let (result, client_payload) = build_json_response(
            StatusCode::BAD_GATEWAY,
            &headers,
            &payload,
            &network_recorder,
        );
        return (
            result,
            UsageStats::default(),
            Some(raw_stream),
            client_payload,
            StatusCode::BAD_GATEWAY,
        );
    };

    let payload: Value = match serde_json::from_str(&materialized) {
        Ok(payload) => payload,
        Err(error) => {
            let payload = protocol_error_payload(
                request_protocol,
                &format!("failed to decode materialized upstream response: {error}"),
            );
            let (result, client_payload) = build_json_response(
                StatusCode::BAD_GATEWAY,
                &headers,
                &payload,
                &network_recorder,
            );
            return (
                result,
                UsageStats::default(),
                Some(raw_stream),
                client_payload,
                StatusCode::BAD_GATEWAY,
            );
        }
    };

    let usage = extract_usage_stats(&payload);
    let mut converted = if status.is_success() {
        match (request_protocol, target_protocol) {
            (ProviderProtocol::AnthropicMessages, ProviderProtocol::OpenAiChatCompletions) => {
                openai_chat_response_to_anthropic(&payload, requested_model)
            }
            (ProviderProtocol::AnthropicMessages, ProviderProtocol::OpenAiResponses) => {
                openai_responses_response_to_anthropic(&payload, requested_model)
            }
            (ProviderProtocol::OpenAiChatCompletions, ProviderProtocol::AnthropicMessages) => {
                anthropic_response_to_openai_chat(&payload, requested_model)
            }
            (ProviderProtocol::OpenAiResponses, ProviderProtocol::AnthropicMessages) => {
                anthropic_response_to_openai_response(&payload, requested_model)
            }
            _ => payload,
        }
    } else {
        convert_error_payload(&payload, request_protocol, target_protocol)
    };
    if request_protocol == ProviderProtocol::AnthropicMessages
        && (sanitize_classifier_response || !emit_anthropic_reasoning)
    {
        strip_anthropic_thinking_blocks(&mut converted, allow_anthropic_reasoning_fallback);
    }

    let (result, response_payload) =
        build_json_response(status, &headers, &converted, &network_recorder);
    (result, usage, Some(materialized), response_payload, status)
}

async fn into_streaming_converted_response(
    response: reqwest::Response,
    request_protocol: ProviderProtocol,
    target_protocol: ProviderProtocol,
    provider_id: &str,
    requested_model: &str,
    emit_anthropic_reasoning: bool,
    allow_anthropic_reasoning_fallback: bool,
    network_recorder: NetworkByteRecorder,
    log_context: Option<StreamingLogContext>,
    activity_guard: Option<RequestActivityGuard>,
) -> Response {
    let status = response.status();
    if !status.is_success() {
        let latency_ms = log_context
            .as_ref()
            .map(|context| chrono::Utc::now().timestamp_millis() - context.started_at)
            .unwrap_or_default();
        let (result, usage, upstream_response_payload, client_response_payload) =
            into_converted_response(
                response,
                request_protocol,
                target_protocol,
                provider_id,
                requested_model,
                emit_anthropic_reasoning,
                allow_anthropic_reasoning_fallback,
                network_recorder,
            )
            .await;
        finalize_stream_logging(
            log_context,
            request_protocol,
            status.as_u16() as i64,
            latency_ms,
            usage,
            None,
            Some(target_protocol),
            upstream_response_payload,
            client_response_payload,
            None,
            upstream_error_source_for_status(status.as_u16() as i64),
        );
        drop(activity_guard);
        return result;
    }

    let model = if requested_model.is_empty() {
        "unknown-model".to_string()
    } else {
        requested_model.to_string()
    };

    let headers = response.headers().clone();
    let mut upstream = response.bytes_stream();
    let mut transformer =
        match CrossProtocolStreamTransformer::new(request_protocol, target_protocol, model)
            .map(|transformer| transformer.with_anthropic_reasoning(emit_anthropic_reasoning))
            .map(|transformer| {
                transformer.with_anthropic_reasoning_fallback(allow_anthropic_reasoning_fallback)
            }) {
            Ok(transformer) => transformer,
            Err(error) => {
                let latency_ms = log_context
                    .as_ref()
                    .map(|context| chrono::Utc::now().timestamp_millis() - context.started_at)
                    .unwrap_or_default();
                let payload = protocol_error_payload(
                    request_protocol,
                    &format!("failed to initialize streaming transformer: {error}"),
                );
                let (result, client_response_payload) = build_json_response(
                    StatusCode::BAD_GATEWAY,
                    &headers,
                    &payload,
                    &network_recorder,
                );
                finalize_stream_logging(
                    log_context,
                    request_protocol,
                    StatusCode::BAD_GATEWAY.as_u16() as i64,
                    latency_ms,
                    UsageStats::default(),
                    None,
                    Some(target_protocol),
                    None,
                    client_response_payload,
                    Some(error.to_string()),
                    Some(ERROR_SOURCE_GATEWAY.to_string()),
                );
                drop(activity_guard);
                return result;
            }
        };
    let mut observer = SseStreamObserver::new(target_protocol);
    let status_code = status.as_u16() as i64;
    let capture_response = log_context
        .as_ref()
        .is_some_and(|context| context.store_response_payload);
    let mut finalizer = StreamingResponseFinalizer::new(
        log_context,
        request_protocol,
        status_code,
        capture_response,
        capture_response,
        capture_response.then_some(target_protocol),
        upstream_error_source_for_status(status_code),
    );

    let stream = stream! {
        let _activity_guard = activity_guard;
        loop {
            match upstream.try_next().await {
                Ok(Some(chunk)) => {
                    let text = String::from_utf8_lossy(&chunk).to_string();
                    let observation = observer.push(&text);
                    finalizer.record_usage(observer.usage_stats());
                    if observation.saw_first_token {
                        let seen_at = chrono::Utc::now().timestamp_millis();
                        finalizer.record_first_token_at(seen_at);
                    }
                    finalizer.push_upstream_response(&text);
                    for transformed in transformer.push(&text) {
                        network_recorder.record_egress(transformed.len());
                        finalizer.push_client_response(&transformed);
                        yield Ok::<Bytes, std::io::Error>(Bytes::from(transformed));
                    }
                }
                Ok(None) => break,
                Err(error) => {
                    let message = format!("upstream stream read failed: {error}");
                    if observer.is_complete() {
                        finalizer.record_usage(observer.usage_stats());
                        finalizer.finish();
                        tracing::warn!(error = %message, "ignoring upstream stream read error after terminal SSE event");
                        return;
                    }
                    finalizer.fail(
                        StatusCode::BAD_GATEWAY.as_u16() as i64,
                        message.clone(),
                        ERROR_SOURCE_UPSTREAM.to_string(),
                    );
                    yield Err::<Bytes, std::io::Error>(std::io::Error::other(message));
                    return;
                }
            }
        }

        let observation = observer.finish();
        if observation.saw_first_token {
            let seen_at = chrono::Utc::now().timestamp_millis();
            finalizer.record_first_token_at(seen_at);
        }
        for transformed in transformer.finish() {
            network_recorder.record_egress(transformed.len());
            finalizer.push_client_response(&transformed);
            yield Ok::<Bytes, std::io::Error>(Bytes::from(transformed));
        }

        finalizer.record_usage(observer.usage_stats());
        finalizer.finish();
    };

    let mut builder = Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, "text/event-stream")
        .header(header::CACHE_CONTROL, "no-cache");
    for (name, value) in headers.iter() {
        if should_forward_upstream_observability_header(name) {
            builder = builder.header(name, value);
        }
    }

    match builder.body(Body::from_stream(stream)) {
        Ok(response) => response,
        Err(_) => (StatusCode::BAD_GATEWAY, "invalid transformed stream").into_response(),
    }
}

async fn into_proxy_response(
    response: reqwest::Response,
    inspect_body: bool,
    network_recorder: NetworkByteRecorder,
) -> (Response, UsageStats, Option<String>) {
    let status = response.status();
    let headers = response.headers().clone();
    if inspect_body {
        let body_bytes = match response.bytes().await {
            Ok(bytes) => bytes,
            Err(_) => {
                return (
                    (StatusCode::BAD_GATEWAY, "failed to read upstream response").into_response(),
                    UsageStats::default(),
                    None,
                );
            }
        };
        let response_payload = Some(String::from_utf8_lossy(&body_bytes).to_string());
        network_recorder.record_egress(body_bytes.len());
        let usage = serde_json::from_slice::<Value>(&body_bytes)
            .ok()
            .map(|value| extract_usage_stats(&value))
            .unwrap_or_default();
        let mut builder = Response::builder().status(status);
        for (name, value) in headers.iter() {
            if !should_forward_upstream_response_header(name) {
                continue;
            }
            builder = builder.header(name, value);
        }
        return (
            match builder.body(Body::from(body_bytes)) {
                Ok(response) => response,
                Err(_) => (StatusCode::BAD_GATEWAY, "invalid upstream response").into_response(),
            },
            usage,
            response_payload,
        );
    }
    let network_recorder_stream = network_recorder.clone();
    let stream = response
        .bytes_stream()
        .map_ok(move |chunk| {
            network_recorder_stream.record_egress(chunk.len());
            chunk
        })
        .map_err(|error| std::io::Error::other(error.to_string()));
    let body = Body::from_stream(stream);

    let mut builder = Response::builder().status(status);
    for (name, value) in headers.iter() {
        if !should_forward_upstream_response_header(name) {
            continue;
        }
        builder = builder.header(name, value);
    }

    (
        match builder.body(body) {
            Ok(response) => response,
            Err(_) => (StatusCode::BAD_GATEWAY, "invalid upstream response").into_response(),
        },
        UsageStats::default(),
        None,
    )
}

fn protocol_error_payload(protocol: ProviderProtocol, message: &str) -> Value {
    match protocol {
        ProviderProtocol::AnthropicMessages => json!({
            "type": "error",
            "error": {
                "type": "api_error",
                "message": message
            }
        }),
        ProviderProtocol::OpenAiChatCompletions | ProviderProtocol::OpenAiResponses => json!({
            "error": {
                "message": message,
                "type": "api_error",
                "code": Value::Null,
                "param": Value::Null
            }
        }),
    }
}

fn extract_sse_upstream_error_payload(
    protocol: ProviderProtocol,
    sse_stream: &str,
) -> Option<(Value, StatusCode)> {
    for event in sse_json_data_events(sse_stream) {
        let Some((message, error_type, code)) = extract_upstream_error_fields(&event) else {
            continue;
        };
        let status = upstream_error_status(code.as_deref(), &message);
        let payload = upstream_error_payload(protocol, &message, &error_type, code.as_deref());
        return Some((payload, status));
    }
    None
}

fn sse_json_data_events(sse_stream: &str) -> Vec<Value> {
    let normalized = sse_stream.replace("\r\n", "\n");
    let mut events = Vec::new();
    for block in normalized.split("\n\n") {
        if block.trim().is_empty() {
            continue;
        }

        let data = block
            .lines()
            .filter_map(|line| line.strip_prefix("data:").map(str::trim))
            .collect::<Vec<_>>()
            .join("\n");
        if data.is_empty() || data == "[DONE]" {
            continue;
        }
        if let Ok(event) = serde_json::from_str::<Value>(&data) {
            events.push(event);
        }
    }
    events
}

fn extract_upstream_error_fields(event: &Value) -> Option<(String, String, Option<String>)> {
    let nested = event.get("error");
    let message = nested
        .and_then(|error| error.get("message"))
        .and_then(Value::as_str)
        .or_else(|| {
            nested
                .and_then(|error| error.get("error_msg"))
                .and_then(Value::as_str)
        })
        .or_else(|| event.get("message").and_then(Value::as_str))
        .or_else(|| event.get("error_msg").and_then(Value::as_str))
        .or_else(|| nested.and_then(Value::as_str))?
        .trim()
        .to_string();
    if message.is_empty() {
        return None;
    }

    let error_type = nested
        .and_then(|error| error.get("type"))
        .and_then(Value::as_str)
        .or_else(|| event.get("type").and_then(Value::as_str))
        .unwrap_or("api_error")
        .to_string();
    let code = nested
        .and_then(|error| error.get("code").or_else(|| error.get("error_code")))
        .or_else(|| event.get("code").or_else(|| event.get("error_code")))
        .and_then(|value| {
            value
                .as_str()
                .map(ToString::to_string)
                .or_else(|| value.as_i64().map(|number| number.to_string()))
        });

    Some((message, error_type, code))
}

fn upstream_error_status(code: Option<&str>, message: &str) -> StatusCode {
    let code = code.unwrap_or_default();
    if code == "429"
        || code.ends_with(".429")
        || message.to_ascii_lowercase().contains("rate limit")
    {
        StatusCode::TOO_MANY_REQUESTS
    } else {
        StatusCode::BAD_GATEWAY
    }
}

fn upstream_error_payload(
    protocol: ProviderProtocol,
    message: &str,
    error_type: &str,
    code: Option<&str>,
) -> Value {
    match protocol {
        ProviderProtocol::AnthropicMessages => json!({
            "type": "error",
            "error": {
                "type": error_type,
                "message": message
            }
        }),
        ProviderProtocol::OpenAiChatCompletions | ProviderProtocol::OpenAiResponses => json!({
            "error": {
                "message": message,
                "type": error_type,
                "code": code.map(|value| Value::String(value.to_string())).unwrap_or(Value::Null),
                "param": Value::Null
            }
        }),
    }
}

fn compact_upstream_text(value: &str) -> String {
    value
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(500)
        .collect()
}

fn protocol_error_message(payload: &Value) -> Option<&str> {
    payload
        .get("error")
        .and_then(|error| error.get("message"))
        .and_then(Value::as_str)
}

fn non_json_upstream_error_payload(
    protocol: ProviderProtocol,
    status: StatusCode,
    headers: &HeaderMap,
    body: &[u8],
) -> Value {
    let content_type = headers
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("unknown");
    let body_text = String::from_utf8_lossy(body);
    let summary = compact_upstream_text(&body_text);
    let message = if summary.is_empty() {
        format!(
            "upstream returned non-JSON error (status {}, content-type {content_type}): empty body",
            status.as_u16()
        )
    } else {
        format!(
            "upstream returned non-JSON error (status {}, content-type {content_type}): {summary}",
            status.as_u16()
        )
    };
    protocol_error_payload(protocol, &message)
}

fn record_non_json_upstream_error_fallback(
    network_recorder: &NetworkByteRecorder,
    provider_id: &str,
    request_protocol: ProviderProtocol,
    target_protocol: ProviderProtocol,
    status: StatusCode,
    headers: &HeaderMap,
    decode_error: &serde_json::Error,
    payload: &Value,
) {
    let content_type = headers
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("unknown");
    record_and_broadcast_event(
        &network_recorder.state,
        RecordEventInput {
            event_type: "non_json_upstream_error_fallback".to_string(),
            level: Some("warn".to_string()),
            source: Some("proxy".to_string()),
            title: Some("Non-JSON upstream error fallback".to_string()),
            message: protocol_error_message(payload).map(ToString::to_string),
            endpoint: Some(network_recorder.endpoint_id.clone()),
            details: Some(json!({
                "provider": provider_id,
                "status": status.as_u16(),
                "contentType": content_type,
                "decodeError": decode_error.to_string(),
                "requestProtocol": provider_protocol_name(request_protocol),
                "targetProtocol": provider_protocol_name(target_protocol)
            })),
            ..RecordEventInput::default()
        },
    );
}

fn convert_error_payload(
    payload: &Value,
    request_protocol: ProviderProtocol,
    target_protocol: ProviderProtocol,
) -> Value {
    match (request_protocol, target_protocol) {
        (ProviderProtocol::AnthropicMessages, ProviderProtocol::OpenAiChatCompletions)
        | (ProviderProtocol::AnthropicMessages, ProviderProtocol::OpenAiResponses) => {
            openai_error_to_anthropic(payload)
        }
        (ProviderProtocol::OpenAiChatCompletions, ProviderProtocol::AnthropicMessages)
        | (ProviderProtocol::OpenAiResponses, ProviderProtocol::AnthropicMessages) => {
            anthropic_error_to_openai(payload)
        }
        _ => payload.clone(),
    }
}

fn build_json_response(
    status: StatusCode,
    headers: &HeaderMap,
    payload: &Value,
    network_recorder: &NetworkByteRecorder,
) -> (Response, Option<String>) {
    let response_payload = serde_json::to_string(payload).ok();
    if let Some(serialized) = response_payload.as_deref() {
        network_recorder.record_egress(serialized.len());
    }

    let mut builder = Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, "application/json");
    for (name, value) in headers.iter() {
        if should_forward_upstream_observability_header(name) {
            builder = builder.header(name, value);
        }
    }

    let response = match builder.body(Body::from(response_payload.clone().unwrap_or_default())) {
        Ok(response) => response,
        Err(_) => (StatusCode::BAD_GATEWAY, "invalid converted response").into_response(),
    };

    (response, response_payload)
}

async fn into_streaming_proxy_response(
    response: reqwest::Response,
    protocol: ProviderProtocol,
    network_recorder: NetworkByteRecorder,
    log_context: Option<StreamingLogContext>,
    activity_guard: Option<RequestActivityGuard>,
) -> Response {
    let status = response.status();
    if !status.is_success() {
        let latency_ms = log_context
            .as_ref()
            .map(|context| chrono::Utc::now().timestamp_millis() - context.started_at)
            .unwrap_or_default();
        let (result, usage, response_payload) =
            into_proxy_response(response, true, network_recorder).await;
        finalize_stream_logging(
            log_context,
            protocol,
            status.as_u16() as i64,
            latency_ms,
            usage,
            None,
            None,
            None,
            response_payload,
            None,
            upstream_error_source_for_status(status.as_u16() as i64),
        );
        drop(activity_guard);
        return result;
    }

    let headers = response.headers().clone();
    let status_code = status.as_u16() as i64;
    let capture_response = log_context
        .as_ref()
        .is_some_and(|context| context.store_response_payload);
    let mut upstream = response.bytes_stream();
    let mut observer = SseStreamObserver::new(protocol);
    let mut finalizer = StreamingResponseFinalizer::new(
        log_context,
        protocol,
        status_code,
        false,
        capture_response,
        None,
        upstream_error_source_for_status(status_code),
    );

    let stream = stream! {
        let _activity_guard = activity_guard;
        loop {
            match upstream.try_next().await {
                Ok(Some(chunk)) => {
                    let text = String::from_utf8_lossy(&chunk).to_string();
                    let observation = observer.push(&text);
                    finalizer.record_usage(observer.usage_stats());
                    if observation.saw_first_token {
                        let seen_at = chrono::Utc::now().timestamp_millis();
                        finalizer.record_first_token_at(seen_at);
                    }
                    finalizer.push_client_response(&text);
                    network_recorder.record_egress(chunk.len());
                    yield Ok::<Bytes, std::io::Error>(chunk);
                }
                Ok(None) => break,
                Err(error) => {
                    let message = format!("upstream stream read failed: {error}");
                    if observer.is_complete() {
                        finalizer.record_usage(observer.usage_stats());
                        finalizer.finish();
                        tracing::warn!(error = %message, "ignoring upstream stream read error after terminal SSE event");
                        return;
                    }
                    finalizer.fail(
                        StatusCode::BAD_GATEWAY.as_u16() as i64,
                        message.clone(),
                        ERROR_SOURCE_UPSTREAM.to_string(),
                    );
                    yield Err::<Bytes, std::io::Error>(std::io::Error::other(message));
                    return;
                }
            }
        }

        let observation = observer.finish();
        if observation.saw_first_token {
            let seen_at = chrono::Utc::now().timestamp_millis();
            finalizer.record_first_token_at(seen_at);
        }
        finalizer.record_usage(observer.usage_stats());
        finalizer.finish();
    };

    let mut builder = Response::builder().status(status);
    for (name, value) in headers.iter() {
        if !should_forward_upstream_response_header(name) {
            continue;
        }
        builder = builder.header(name, value);
    }

    match builder.body(Body::from_stream(stream)) {
        Ok(response) => response,
        Err(_) => (StatusCode::BAD_GATEWAY, "invalid upstream response").into_response(),
    }
}

fn endpoint_name(endpoint: GatewayEndpoint<'_>, _protocol: ProviderProtocol) -> String {
    match endpoint {
        GatewayEndpoint::Anthropic => "anthropic".to_string(),
        GatewayEndpoint::OpenAi => "openai".to_string(),
        GatewayEndpoint::Custom(id) => id.to_string(),
    }
}

fn should_forward_upstream_response_header(name: &header::HeaderName) -> bool {
    name != header::CONTENT_LENGTH
        && name != header::CONNECTION
        && name != header::SET_COOKIE
        && !name.as_str().eq_ignore_ascii_case("transfer-encoding")
}

fn should_forward_upstream_observability_header(name: &header::HeaderName) -> bool {
    matches!(
        name.as_str(),
        "x-request-id" | "request-id" | "openai-processing-ms" | "retry-after"
    ) || name.as_str().starts_with("anthropic-ratelimit-")
        || name.as_str().starts_with("x-ratelimit-")
}

fn extract_usage_stats(payload: &Value) -> UsageStats {
    usage_stats_from_payload(payload)
}

fn compute_tpot_ms(total_latency_ms: i64, output_tokens: i64, ttft_ms: Option<i64>) -> Option<f64> {
    if output_tokens <= 0 {
        return None;
    }
    let ttft_ms = ttft_ms?;
    let effective_latency_ms = (total_latency_ms - ttft_ms).max(0) as f64;
    let raw = effective_latency_ms / output_tokens as f64;
    Some((raw * 100.0).round() / 100.0)
}

struct StreamingResponseFinalizer {
    log_context: Option<StreamingLogContext>,
    client_response_protocol: ProviderProtocol,
    status_code: i64,
    usage: UsageStats,
    ttft_ms: Option<i64>,
    upstream_response_protocol: Option<ProviderProtocol>,
    upstream_response_payload: Option<String>,
    client_response_payload: Option<String>,
    error_source: Option<String>,
    completed: bool,
}

impl StreamingResponseFinalizer {
    fn new(
        log_context: Option<StreamingLogContext>,
        client_response_protocol: ProviderProtocol,
        status_code: i64,
        capture_upstream_response: bool,
        capture_client_response: bool,
        upstream_response_protocol: Option<ProviderProtocol>,
        error_source: Option<String>,
    ) -> Self {
        Self {
            log_context,
            client_response_protocol,
            status_code,
            usage: UsageStats::default(),
            ttft_ms: None,
            upstream_response_protocol: if capture_upstream_response {
                upstream_response_protocol
            } else {
                None
            },
            upstream_response_payload: capture_upstream_response.then(String::new),
            client_response_payload: capture_client_response.then(String::new),
            error_source,
            completed: false,
        }
    }

    fn record_usage(&mut self, usage: UsageStats) {
        self.usage = usage;
    }

    fn record_first_token_at(&mut self, first_token_at: i64) {
        if self.ttft_ms.is_some() {
            return;
        }
        if let Some(context) = self.log_context.as_ref() {
            self.ttft_ms = Some(first_token_at - context.started_at);
        }
    }

    fn push_upstream_response(&mut self, chunk: &str) {
        if let Some(payload) = self.upstream_response_payload.as_mut() {
            payload.push_str(chunk);
        }
    }

    fn push_client_response(&mut self, chunk: &str) {
        if let Some(payload) = self.client_response_payload.as_mut() {
            payload.push_str(chunk);
        }
    }

    fn finish(mut self) {
        let latency_ms = self
            .log_context
            .as_ref()
            .map(|context| chrono::Utc::now().timestamp_millis() - context.started_at)
            .unwrap_or_default();
        self.completed = true;
        finalize_stream_logging(
            self.log_context.take(),
            self.client_response_protocol,
            self.status_code,
            latency_ms,
            self.usage.clone(),
            self.ttft_ms,
            self.upstream_response_protocol,
            self.upstream_response_payload.take(),
            self.client_response_payload.take(),
            None,
            self.error_source.take(),
        );
    }

    fn fail(mut self, status_code: i64, error: String, error_source: String) {
        let latency_ms = self
            .log_context
            .as_ref()
            .map(|context| chrono::Utc::now().timestamp_millis() - context.started_at)
            .unwrap_or_default();
        self.completed = true;
        finalize_stream_logging(
            self.log_context.take(),
            self.client_response_protocol,
            status_code,
            latency_ms,
            self.usage.clone(),
            self.ttft_ms,
            self.upstream_response_protocol,
            self.upstream_response_payload.take(),
            self.client_response_payload.take(),
            Some(error),
            Some(error_source),
        );
    }
}

impl Drop for StreamingResponseFinalizer {
    fn drop(&mut self) {
        if self.completed {
            return;
        }

        let latency_ms = self
            .log_context
            .as_ref()
            .map(|context| chrono::Utc::now().timestamp_millis() - context.started_at)
            .unwrap_or_default();
        finalize_stream_logging(
            self.log_context.take(),
            self.client_response_protocol,
            499,
            latency_ms,
            self.usage.clone(),
            self.ttft_ms,
            self.upstream_response_protocol,
            self.upstream_response_payload.take(),
            self.client_response_payload.take(),
            Some("stream terminated before completion".to_string()),
            Some(ERROR_SOURCE_CLIENT.to_string()),
        );
    }
}

fn finalize_stream_logging(
    log_context: Option<StreamingLogContext>,
    client_response_protocol: ProviderProtocol,
    status_code: i64,
    latency_ms: i64,
    usage: UsageStats,
    ttft_ms: Option<i64>,
    upstream_response_protocol: Option<ProviderProtocol>,
    upstream_response_payload: Option<String>,
    client_response_payload: Option<String>,
    error: Option<String>,
    error_source: Option<String>,
) {
    let Some(context) = log_context else {
        return;
    };

    let update = RequestLogUpdate {
        latency_ms: Some(latency_ms),
        status_code: Some(status_code),
        input_tokens: Some(usage.input_tokens),
        output_tokens: Some(usage.output_tokens),
        cached_tokens: Some(usage.cached_tokens),
        cache_read_tokens: Some(usage.cache_read_tokens),
        cache_creation_tokens: Some(usage.cache_creation_tokens),
        ttft_ms,
        tpot_ms: compute_tpot_ms(latency_ms, usage.output_tokens, ttft_ms),
        error: error.clone(),
        error_source,
        ..RequestLogUpdate::default()
    };
    let _ = finalize_request_log(&context.db_path, context.log_id, &update);
    let _ = increment_daily_metrics(&context.db_path, &context.endpoint_id, latency_ms, &usage);
    let _ = record_api_key_usage(&context.db_path, context.api_key_id, &usage);

    if context.store_response_payload {
        let client_response_payload = client_response_payload.map(|payload| {
            materialize_stream_response(client_response_protocol, &payload).unwrap_or(payload)
        });
        let upstream_response_payload = upstream_response_payload
            .zip(upstream_response_protocol)
            .map(|(payload, protocol)| {
                materialize_stream_response(protocol, &payload).unwrap_or(payload)
            })
            .filter(|payload| Some(payload.as_str()) != client_response_payload.as_deref());
        let _ = upsert_request_payload(
            &context.db_path,
            context.log_id,
            &LogPayloadUpdate {
                upstream_response: upstream_response_payload.as_deref(),
                client_response: client_response_payload.as_deref(),
                ..LogPayloadUpdate::default()
            },
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn make_test_state() -> AppState {
        AppState {
            config: Arc::new(RwLock::new(GatewayConfig::default())),
            paths: Arc::new(GatewayPaths {
                home_dir: std::path::PathBuf::from("/tmp"),
                db_path: std::path::PathBuf::from("/tmp/test.db"),
                config_path: std::path::PathBuf::from("/tmp/config.json"),
                data_dir: std::path::PathBuf::from("/tmp/data"),
                log_dir: std::path::PathBuf::from("/tmp/logs"),
            }),
            ui_root: None,
            openai_compatibility_modes: Arc::new(Mutex::new(HashMap::new())),
            active_requests: Arc::new(AtomicU64::new(0)),
            active_client_addresses: Arc::new(Mutex::new(HashMap::new())),
            active_client_sessions: Arc::new(Mutex::new(HashMap::new())),
            active_requests_by_endpoint: Arc::new(Mutex::new(HashMap::new())),
            active_client_addresses_by_endpoint: Arc::new(Mutex::new(HashMap::new())),
            active_client_sessions_by_endpoint: Arc::new(Mutex::new(HashMap::new())),
            active_requests_by_api_key: Arc::new(Mutex::new(HashMap::new())),
            network_ingress_bytes: Arc::new(AtomicU64::new(0)),
            network_egress_bytes: Arc::new(AtomicU64::new(0)),
            network_ingress_bytes_by_endpoint: Arc::new(Mutex::new(HashMap::new())),
            network_egress_bytes_by_endpoint: Arc::new(Mutex::new(HashMap::new())),
            runtime_metrics: Arc::new(Mutex::new(RuntimeMetricsSampler::new())),
            http_client: reqwest::Client::builder().build().expect("client"),
            version_check_registry_base_url: "https://registry.npmjs.org".to_string(),
            version_check_package_name: "@chenpu17/cc-gw".to_string(),
            sessions: auth::SessionStore::default(),
            event_bus: tokio::sync::broadcast::channel(256).0,
        }
    }

    #[test]
    fn concurrency_allows_when_under_limit() {
        let state = make_test_state();
        let result = RequestActivityGuard::try_new_with_concurrency_check(
            &state,
            "test-endpoint".to_string(),
            None,
            None,
            Some(42),
            Some(3),
        );
        assert!(result.is_ok(), "should succeed when under limit");
    }

    #[test]
    fn concurrency_rejects_when_at_limit() {
        let state = make_test_state();
        {
            let mut entries = state.active_requests_by_api_key.lock().unwrap();
            entries.insert(42, 3);
        }
        let result = RequestActivityGuard::try_new_with_concurrency_check(
            &state,
            "test-endpoint".to_string(),
            None,
            None,
            Some(42),
            Some(3),
        );
        assert!(result.is_err(), "should reject when at limit");
        assert_eq!(result.unwrap_err(), 3);
    }

    #[test]
    fn concurrency_allows_when_no_limit() {
        let state = make_test_state();
        let result = RequestActivityGuard::try_new_with_concurrency_check(
            &state,
            "test-endpoint".to_string(),
            None,
            None,
            Some(42),
            None,
        );
        assert!(result.is_ok());
    }

    #[test]
    fn concurrency_allows_when_limit_is_zero() {
        let state = make_test_state();
        let result = RequestActivityGuard::try_new_with_concurrency_check(
            &state,
            "test-endpoint".to_string(),
            None,
            None,
            Some(42),
            Some(0),
        );
        assert!(result.is_ok());
    }

    #[test]
    fn concurrency_releases_slot_on_drop() {
        let state = make_test_state();
        {
            let guard = RequestActivityGuard::try_new_with_concurrency_check(
                &state,
                "test-endpoint".to_string(),
                None,
                None,
                Some(42),
                Some(1),
            );
            assert!(guard.is_ok());

            let second = RequestActivityGuard::try_new_with_concurrency_check(
                &state,
                "test-endpoint".to_string(),
                None,
                None,
                Some(42),
                Some(1),
            );
            assert!(second.is_err(), "should reject while slot is held");
        }
        // guard dropped — slot released

        let third = RequestActivityGuard::try_new_with_concurrency_check(
            &state,
            "test-endpoint".to_string(),
            None,
            None,
            Some(42),
            Some(1),
        );
        assert!(third.is_ok(), "should succeed after slot released");
    }

    #[test]
    fn concurrency_check_increments_atomically() {
        let state = make_test_state();
        {
            let mut entries = state.active_requests_by_api_key.lock().unwrap();
            entries.insert(42, 0);
        }
        let _guard = RequestActivityGuard::try_new_with_concurrency_check(
            &state,
            "test-endpoint".to_string(),
            None,
            None,
            Some(42),
            Some(1),
        );
        {
            let entries = state.active_requests_by_api_key.lock().unwrap();
            assert_eq!(
                *entries.get(&42).unwrap(),
                1,
                "counter should be 1 after acquiring slot"
            );
        }
    }

    #[test]
    fn extract_usage_stats_keeps_cached_tokens_as_cache_read_only() {
        let usage = extract_usage_stats(&json!({
            "usage": {
                "input_tokens": 11,
                "output_tokens": 7,
                "cache_read_input_tokens": 3,
                "cache_creation_input_tokens": 2
            }
        }));

        assert_eq!(usage.input_tokens, 16);
        assert_eq!(usage.output_tokens, 7);
        assert_eq!(usage.cache_read_tokens, 3);
        assert_eq!(usage.cache_creation_tokens, 2);
        assert_eq!(usage.cached_tokens, 3);
    }

    #[test]
    fn extract_usage_stats_normalizes_anthropic_input_tokens_with_cache_breakdown() {
        let usage = extract_usage_stats(&json!({
            "usage": {
                "input_tokens": 5,
                "output_tokens": 7,
                "cache_read_input_tokens": 3,
                "cache_creation_input_tokens": 2
            }
        }));

        assert_eq!(usage.input_tokens, 10);
        assert_eq!(usage.output_tokens, 7);
        assert_eq!(usage.cache_read_tokens, 3);
        assert_eq!(usage.cache_creation_tokens, 2);
        assert_eq!(usage.cached_tokens, 3);
    }

    #[test]
    fn extract_usage_stats_reads_nested_response_usage() {
        let usage = extract_usage_stats(&json!({
            "response": {
                "usage": {
                    "input_tokens": 9,
                    "output_tokens": 4,
                    "input_tokens_details": {
                        "cached_tokens": 6
                    }
                }
            }
        }));

        assert_eq!(usage.input_tokens, 9);
        assert_eq!(usage.output_tokens, 4);
        assert_eq!(usage.cache_read_tokens, 6);
        assert_eq!(usage.cache_creation_tokens, 0);
        assert_eq!(usage.cached_tokens, 6);
    }

    #[test]
    fn stream_options_include_usage_omitted_by_default() {
        // Regression guard: a streamed Anthropic→OpenAI request must NOT carry
        // stream_options.include_usage unless the provider opted in. Some
        // OpenAI-compatible upstreams (Aliyun MaaS et al.) reject/truncate the
        // stream on seeing it, yielding an empty response.
        let body = json!({
            "model": "claude-sonnet-5",
            "max_tokens": 16,
            "stream": true,
            "messages": [{"role": "user", "content": "hi"}]
        });
        let converted = build_request_body_for_target(
            &body,
            ProviderProtocol::AnthropicMessages,
            ProviderProtocol::OpenAiChatCompletions,
            "openai",
            false,
            false,
        );
        assert!(
            converted.get("stream_options").is_none(),
            "stream_options must be absent when stream_usage is disabled (default)"
        );
    }

    #[test]
    fn stream_options_include_usage_injected_when_opted_in() {
        let body = json!({
            "model": "claude-sonnet-5",
            "max_tokens": 16,
            "stream": true,
            "messages": [{"role": "user", "content": "hi"}]
        });
        let converted = build_request_body_for_target(
            &body,
            ProviderProtocol::AnthropicMessages,
            ProviderProtocol::OpenAiChatCompletions,
            "openai",
            false,
            true,
        );
        assert_eq!(
            converted.get("stream_options"),
            Some(&json!({ "include_usage": true })),
            "stream_options.include_usage must be injected when opted in"
        );
    }

    #[test]
    fn stream_options_not_injected_for_non_streaming_or_same_protocol() {
        // Non-streaming request: opt-in must not add stream_options.
        let non_stream = json!({
            "model": "claude-sonnet-5",
            "max_tokens": 16,
            "stream": false,
            "messages": [{"role": "user", "content": "hi"}]
        });
        let converted = build_request_body_for_target(
            &non_stream,
            ProviderProtocol::AnthropicMessages,
            ProviderProtocol::OpenAiChatCompletions,
            "openai",
            false,
            true,
        );
        assert!(
            converted.get("stream_options").is_none(),
            "stream_options must be absent for non-streaming requests"
        );

        // Same-protocol passthrough: opt-in must not add stream_options.
        let converted_same = build_request_body_for_target(
            &non_stream,
            ProviderProtocol::AnthropicMessages,
            ProviderProtocol::AnthropicMessages,
            "anthropic",
            false,
            true,
        );
        assert!(
            converted_same.get("stream_options").is_none(),
            "stream_options must be absent on same-protocol passthrough"
        );
    }
}
