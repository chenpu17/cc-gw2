use super::*;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

struct RequestActivityGuard {
    active_requests: Arc<AtomicU64>,
    active_client_addresses: Arc<Mutex<HashMap<String, u64>>>,
    active_client_sessions: Arc<Mutex<HashMap<String, u64>>>,
    active_requests_by_endpoint: Arc<Mutex<HashMap<String, u64>>>,
    active_client_addresses_by_endpoint: Arc<Mutex<HashMap<String, HashMap<String, u64>>>>,
    active_client_sessions_by_endpoint: Arc<Mutex<HashMap<String, HashMap<String, u64>>>>,
    endpoint_id: String,
    source_ip: Option<String>,
    session_id: Option<String>,
}

impl RequestActivityGuard {
    fn new(
        state: &AppState,
        endpoint_id: String,
        source_ip: Option<String>,
        session_id: Option<String>,
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
            endpoint_id,
            source_ip,
            session_id,
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
    let body = match read_json_request(&state, request.into_body()).await {
        Ok(value) => value,
        Err(response) => return response,
    };

    fn walk(value: &Value) -> usize {
        match value {
            Value::Null => 0,
            Value::Bool(_) => 1,
            Value::Number(_) => 2,
            Value::String(text) => text.len() / 4 + 1,
            Value::Array(values) => values.iter().map(walk).sum(),
            Value::Object(map) => map.values().map(walk).sum(),
        }
    }

    Json(json!({ "input_tokens": walk(&body) })).into_response()
}

pub(super) async fn anthropic_messages(
    State(state): State<AppState>,
    ConnectInfo(connect_info): ConnectInfo<SocketAddr>,
    request: Request,
) -> Response {
    let headers = request.headers().clone();
    let api_key_context = match authorize_request_with_context(&state, &headers, "anthropic") {
        Ok(context) => context,
        Err(response) => return response,
    };
    let body = match read_json_request(&state, request.into_body()).await {
        Ok(value) => value,
        Err(response) => return response,
    };
    let source_ip = extract_client_ip(&headers, Some(connect_info));
    proxy_standard_request(
        state,
        api_key_context,
        headers,
        source_ip,
        body,
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
    let headers = request.headers().clone();
    let api_key_context = match authorize_request_with_context(&state, &headers, "openai") {
        Ok(context) => context,
        Err(response) => return response,
    };
    let body = match read_json_request(&state, request.into_body()).await {
        Ok(value) => value,
        Err(response) => return response,
    };
    let source_ip = extract_client_ip(&headers, Some(connect_info));
    proxy_standard_request(
        state,
        api_key_context,
        headers,
        source_ip,
        body,
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
    let headers = request.headers().clone();
    let api_key_context = match authorize_request_with_context(&state, &headers, "openai") {
        Ok(context) => context,
        Err(response) => return response,
    };
    let body = match read_json_request(&state, request.into_body()).await {
        Ok(value) => value,
        Err(response) => return response,
    };
    let source_ip = extract_client_ip(&headers, Some(connect_info));
    proxy_standard_request(
        state,
        api_key_context,
        headers,
        source_ip,
        body,
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

fn downgrade_openai_chat_body_for_custom_provider(body: &mut Value) {
    remove_top_level_key(body, "tools");
    remove_top_level_key(body, "tool_choice");
    remove_top_level_key(body, "metadata");
    summarize_tool_messages_for_custom_provider(body);
}

fn build_request_body_for_target(
    original_body: &Value,
    request_protocol: ProviderProtocol,
    target_protocol: ProviderProtocol,
    provider_type: &str,
) -> Value {
    let mut converted = match (request_protocol, target_protocol) {
        (ProviderProtocol::AnthropicMessages, ProviderProtocol::OpenAiChatCompletions) => {
            anthropic_request_to_openai_chat(original_body)
        }
        (ProviderProtocol::OpenAiChatCompletions, ProviderProtocol::AnthropicMessages) => {
            openai_chat_request_to_anthropic(original_body)
        }
        (ProviderProtocol::OpenAiResponses, ProviderProtocol::AnthropicMessages) => {
            openai_responses_request_to_anthropic(original_body)
        }
        _ => original_body.clone(),
    };

    if !provider_supports_metadata(provider_type) {
        remove_top_level_key(&mut converted, "metadata");
    }

    if request_protocol == ProviderProtocol::AnthropicMessages
        && target_protocol == ProviderProtocol::OpenAiChatCompletions
        && !provider_supports_tools(provider_type)
    {
        downgrade_openai_chat_body_for_custom_provider(&mut converted);
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

pub(super) async fn proxy_standard_request(
    state: AppState,
    api_key_context: cc_gw_core::api_keys::ResolvedApiKey,
    headers: HeaderMap,
    source_ip: Option<String>,
    body: Value,
    endpoint: GatewayEndpoint<'_>,
    protocol: ProviderProtocol,
) -> Response {
    let started_at = chrono::Utc::now().timestamp_millis();
    let endpoint_id = endpoint_name(endpoint, protocol);
    let user_agent = header_value(&headers, header::USER_AGENT.as_str());
    let session_id = extract_session_id(&body);
    let activity_guard = RequestActivityGuard::new(
        &state,
        endpoint_id.clone(),
        source_ip.clone(),
        session_id.clone(),
    );
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
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({
                    "error": {
                        "message": error.to_string()
                    }
                })),
            )
                .into_response();
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
    let provider_is_anthropic = provider_type == "anthropic";
    let target_protocol = if provider_is_anthropic {
        ProviderProtocol::AnthropicMessages
    } else {
        match protocol {
            ProviderProtocol::AnthropicMessages => ProviderProtocol::OpenAiChatCompletions,
            ProviderProtocol::OpenAiChatCompletions => ProviderProtocol::OpenAiChatCompletions,
            ProviderProtocol::OpenAiResponses => ProviderProtocol::OpenAiResponses,
        }
    };

    let converted_request_body =
        build_request_body_for_target(&body, protocol, target_protocol, provider_type);
    let upstream_request_payload = if request_payload_storage && converted_request_body != body {
        serde_json::to_string(&converted_request_body).ok()
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

    let target_model_id = target.model_id.clone();
    let proxy_result = forward_request(
        &state.http_client,
        &target.provider,
        target_protocol,
        ProxyRequest {
            model: target_model_id.clone(),
            body: converted_request_body.clone(),
            stream,
            incoming_headers: headers.clone(),
            passthrough_headers: HeaderMap::new(),
            query: None,
        },
    )
    .await;

    match proxy_result {
        Ok(mut response) => {
            if protocol == ProviderProtocol::AnthropicMessages
                && target_protocol == ProviderProtocol::OpenAiChatCompletions
                && response.status().as_u16() >= 400
            {
                if let Some(retry_body) =
                    retry_body_without_metadata_or_tool_choice(&converted_request_body)
                {
                    if let Ok(retry_response) = forward_request(
                        &state.http_client,
                        &target.provider,
                        target_protocol,
                        ProxyRequest {
                            model: target_model_id.clone(),
                            body: retry_body,
                            stream,
                            incoming_headers: headers.clone(),
                            passthrough_headers: HeaderMap::new(),
                            query: None,
                        },
                    )
                    .await
                    {
                        if retry_response.status().as_u16() < 400 {
                            response = retry_response;
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
            if cross_protocol && stream {
                into_streaming_converted_response(
                    response,
                    protocol,
                    target_protocol,
                    requested_model.unwrap_or(""),
                    streaming_log_context,
                    Some(activity_guard),
                )
                .await
            } else if stream {
                into_streaming_proxy_response(
                    response,
                    target_protocol,
                    streaming_log_context,
                    Some(activity_guard),
                )
                .await
            } else if cross_protocol {
                let status_code = response.status().as_u16() as i64;
                let latency_ms = chrono::Utc::now().timestamp_millis() - started_at;
                let (result, usage, upstream_response_payload, client_response_payload) = into_converted_response(
                    response,
                    protocol,
                    target_protocol,
                    requested_model.unwrap_or(""),
                )
                .await;
                if let Some(log_id) = request_log_id {
                    let update = RequestLogUpdate {
                        latency_ms: Some(latency_ms),
                        status_code: Some(status_code),
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
                    if response_payload_storage_enabled(&config) {
                        let _ = upsert_request_payload(
                            &state.paths.db_path,
                            log_id,
                            &LogPayloadUpdate {
                                upstream_response: upstream_response_payload
                                    .as_deref()
                                    .filter(|payload| Some(*payload) != client_response_payload.as_deref()),
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
                    into_proxy_response(response, !stream).await;
                if let Some(log_id) = request_log_id {
                    let update = RequestLogUpdate {
                        latency_ms: Some(latency_ms),
                        status_code: Some(status_code),
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
                    if response_payload_storage_enabled(&config) {
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
            let latency_ms = chrono::Utc::now().timestamp_millis() - started_at;
            if let Some(log_id) = request_log_id {
                let update = RequestLogUpdate {
                    latency_ms: Some(latency_ms),
                    status_code: Some(502),
                    error: Some(error.to_string()),
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
            let _ = record_event(
                &state.paths.db_path,
                &RecordEventInput {
                    event_type: "provider_proxy_failure".to_string(),
                    level: Some("error".to_string()),
                    source: Some("proxy".to_string()),
                    title: Some("Provider request failed".to_string()),
                    message: Some(error.to_string()),
                    endpoint: Some(endpoint_id),
                    api_key_id: Some(api_key_context.id),
                    api_key_name: Some(api_key_context.name),
                    api_key_value: encrypted_api_key_value,
                    user_agent,
                    details: Some(json!({ "provider": target.provider_id })),
                    ..RecordEventInput::default()
                },
            );
            (
                StatusCode::BAD_GATEWAY,
                Json(json!({
                    "error": {
                        "message": error.to_string(),
                        "provider": target.provider_id
                    }
                })),
            )
                .into_response()
        }
    }
}

async fn into_converted_response(
    response: reqwest::Response,
    request_protocol: ProviderProtocol,
    target_protocol: ProviderProtocol,
    requested_model: &str,
) -> (Response, UsageStats, Option<String>, Option<String>) {
    let status = response.status();
    if !status.is_success() {
        let (result, usage, response_payload) = into_proxy_response(response, true).await;
        return (result, usage, None, response_payload);
    }

    let body_bytes = match response.bytes().await {
        Ok(bytes) => bytes,
        Err(error) => {
            let client_payload = serde_json::to_string(&json!({
                "error": {
                    "message": format!("failed to read upstream response: {error}")
                }
            }))
            .ok();
            return (
                (
                    StatusCode::BAD_GATEWAY,
                    Json(json!({
                        "error": {
                            "message": format!("failed to read upstream response: {error}")
                        }
                    })),
                )
                    .into_response(),
                UsageStats::default(),
                None,
                client_payload,
            );
        }
    };
    let upstream_payload = Some(String::from_utf8_lossy(&body_bytes).to_string());

    let payload: Value = match serde_json::from_slice(&body_bytes) {
        Ok(payload) => payload,
        Err(error) => {
            let client_payload = serde_json::to_string(&json!({
                "error": {
                    "message": format!("failed to decode upstream JSON: {error}")
                }
            }))
            .ok();
            return (
                (
                    StatusCode::BAD_GATEWAY,
                    Json(json!({
                        "error": {
                            "message": format!("failed to decode upstream JSON: {error}")
                        }
                    })),
                )
                    .into_response(),
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
    let converted = match (request_protocol, target_protocol) {
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
        _ => payload,
    };

    let response_payload = serde_json::to_string(&converted).ok();
    (Json(converted).into_response(), usage, upstream_payload, response_payload)
}

async fn into_streaming_converted_response(
    response: reqwest::Response,
    request_protocol: ProviderProtocol,
    target_protocol: ProviderProtocol,
    requested_model: &str,
    log_context: Option<StreamingLogContext>,
    activity_guard: Option<RequestActivityGuard>,
) -> Response {
    let status = response.status();
    if !status.is_success() {
        let latency_ms = log_context
            .as_ref()
            .map(|context| chrono::Utc::now().timestamp_millis() - context.started_at)
            .unwrap_or_default();
        let (result, usage, response_payload) = into_proxy_response(response, true).await;
        finalize_stream_logging(
            log_context,
            target_protocol,
            status.as_u16() as i64,
            latency_ms,
            usage,
            None,
            None,
            None,
            response_payload,
        );
        drop(activity_guard);
        return result;
    }

    let model = if requested_model.is_empty() {
        "unknown-model".to_string()
    } else {
        requested_model.to_string()
    };

    let mut upstream = response.bytes_stream();
    let mut transformer =
        CrossProtocolStreamTransformer::new(request_protocol, target_protocol, model);
    let mut observer = SseStreamObserver::new(target_protocol);
    let mut first_token_at = None::<i64>;
    let status_code = status.as_u16() as i64;
    let capture_response = log_context
        .as_ref()
        .is_some_and(|context| context.store_response_payload);

    let stream = stream! {
        let _activity_guard = activity_guard;
        let mut captured_upstream_response = String::new();
        let mut captured_response = String::new();
        loop {
            match upstream.try_next().await {
                Ok(Some(chunk)) => {
                    let text = String::from_utf8_lossy(&chunk).to_string();
                    let observation = observer.push(&text);
                    if first_token_at.is_none() && observation.saw_first_token {
                        first_token_at = Some(chrono::Utc::now().timestamp_millis());
                    }
                    if capture_response {
                        captured_upstream_response.push_str(&text);
                    }
                    for transformed in transformer.push(&text) {
                        if capture_response {
                            captured_response.push_str(&transformed);
                        }
                        yield Ok::<Bytes, std::io::Error>(Bytes::from(transformed));
                    }
                }
                Ok(None) => break,
                Err(_) => break,
            }
        }

        let observation = observer.finish();
        if first_token_at.is_none() && observation.saw_first_token {
            first_token_at = Some(chrono::Utc::now().timestamp_millis());
        }
        for transformed in transformer.finish() {
            if capture_response {
                captured_response.push_str(&transformed);
            }
            yield Ok::<Bytes, std::io::Error>(Bytes::from(transformed));
        }

        let usage = observer.usage_stats();
        let latency_ms = log_context
            .as_ref()
            .map(|context| chrono::Utc::now().timestamp_millis() - context.started_at)
            .unwrap_or_default();
        let ttft_ms = first_token_at.zip(log_context.as_ref()).map(|(first_token_at, context)| {
            first_token_at - context.started_at
        });
        finalize_stream_logging(
            log_context,
            request_protocol,
            status_code,
            latency_ms,
            usage,
            ttft_ms,
            if capture_response { Some(target_protocol) } else { None },
            if capture_response { Some(captured_upstream_response) } else { None },
            if capture_response { Some(captured_response) } else { None },
        );
    };

    match Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, "text/event-stream")
        .header(header::CACHE_CONTROL, "no-cache")
        .body(Body::from_stream(stream))
    {
        Ok(response) => response,
        Err(_) => (StatusCode::BAD_GATEWAY, "invalid transformed stream").into_response(),
    }
}

async fn into_proxy_response(
    response: reqwest::Response,
    inspect_body: bool,
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
        let usage = serde_json::from_slice::<Value>(&body_bytes)
            .ok()
            .map(|value| extract_usage_stats(&value))
            .unwrap_or_default();
        let mut builder = Response::builder().status(status);
        for (name, value) in headers.iter() {
            if name == header::CONTENT_LENGTH
                || name == header::CONNECTION
                || name.as_str().eq_ignore_ascii_case("transfer-encoding")
            {
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
    let stream = response
        .bytes_stream()
        .map_err(|error| std::io::Error::other(error.to_string()));
    let body = Body::from_stream(stream);

    let mut builder = Response::builder().status(status);
    for (name, value) in headers.iter() {
        if name == header::CONTENT_LENGTH
            || name == header::CONNECTION
            || name.as_str().eq_ignore_ascii_case("transfer-encoding")
        {
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

async fn into_streaming_proxy_response(
    response: reqwest::Response,
    protocol: ProviderProtocol,
    log_context: Option<StreamingLogContext>,
    activity_guard: Option<RequestActivityGuard>,
) -> Response {
    let status = response.status();
    if !status.is_success() {
        let latency_ms = log_context
            .as_ref()
            .map(|context| chrono::Utc::now().timestamp_millis() - context.started_at)
            .unwrap_or_default();
        let (result, usage, response_payload) = into_proxy_response(response, true).await;
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
    let mut first_token_at = None::<i64>;

    let stream = stream! {
        let _activity_guard = activity_guard;
        let mut captured_response = String::new();
        loop {
            match upstream.try_next().await {
                Ok(Some(chunk)) => {
                    let text = String::from_utf8_lossy(&chunk).to_string();
                    let observation = observer.push(&text);
                    if first_token_at.is_none() && observation.saw_first_token {
                        first_token_at = Some(chrono::Utc::now().timestamp_millis());
                    }
                    if capture_response {
                        captured_response.push_str(&text);
                    }
                    yield Ok::<Bytes, std::io::Error>(chunk);
                }
                Ok(None) => break,
                Err(_) => break,
            }
        }

        let observation = observer.finish();
        if first_token_at.is_none() && observation.saw_first_token {
            first_token_at = Some(chrono::Utc::now().timestamp_millis());
        }
        let usage = observer.usage_stats();
        let latency_ms = log_context
            .as_ref()
            .map(|context| chrono::Utc::now().timestamp_millis() - context.started_at)
            .unwrap_or_default();
        let ttft_ms = first_token_at.zip(log_context.as_ref()).map(|(first_token_at, context)| {
            first_token_at - context.started_at
        });
        finalize_stream_logging(
            log_context,
            protocol,
            status_code,
            latency_ms,
            usage,
            ttft_ms,
            None,
            None,
            if capture_response { Some(captured_response) } else { None },
        );
    };

    let mut builder = Response::builder().status(status);
    for (name, value) in headers.iter() {
        if name == header::CONTENT_LENGTH
            || name == header::CONNECTION
            || name.as_str().eq_ignore_ascii_case("transfer-encoding")
        {
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

fn extract_usage_stats(payload: &Value) -> UsageStats {
    let usage = payload
        .get("usage")
        .or_else(|| payload.get("response").and_then(|value| value.get("usage")))
        .or_else(|| payload.get("message").and_then(|value| value.get("usage")))
        .unwrap_or(payload);
    let input_tokens = usage
        .get("input_tokens")
        .or_else(|| usage.get("prompt_tokens"))
        .and_then(Value::as_i64)
        .unwrap_or(0);
    let output_tokens = usage
        .get("output_tokens")
        .or_else(|| usage.get("completion_tokens"))
        .and_then(Value::as_i64)
        .unwrap_or(0);
    let cache_read_tokens = usage
        .get("cache_read_input_tokens")
        .or_else(|| usage.get("cache_read_tokens"))
        .or_else(|| usage.get("cached_tokens"))
        .or_else(|| {
            usage
                .get("prompt_tokens_details")
                .and_then(|details| details.get("cached_tokens"))
        })
        .or_else(|| {
            usage
                .get("input_tokens_details")
                .and_then(|details| details.get("cached_tokens"))
        })
        .and_then(Value::as_i64)
        .unwrap_or(0);
    let cache_creation_tokens = usage
        .get("cache_creation_input_tokens")
        .or_else(|| usage.get("cache_creation_tokens"))
        .and_then(Value::as_i64)
        .unwrap_or(0);
    let cached_tokens = cache_read_tokens + cache_creation_tokens;
    UsageStats {
        input_tokens,
        output_tokens,
        cached_tokens,
        cache_read_tokens,
        cache_creation_tokens,
    }
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
        ..RequestLogUpdate::default()
    };
    let _ = finalize_request_log(&context.db_path, context.log_id, &update);
    let _ = increment_daily_metrics(&context.db_path, &context.endpoint_id, latency_ms, &usage);
    let _ = record_api_key_usage(&context.db_path, context.api_key_id, &usage);
    if context.store_response_payload {
        let client_response_payload = client_response_payload
            .map(|payload| {
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
    use super::extract_usage_stats;
    use serde_json::json;

    #[test]
    fn extract_usage_stats_sums_cache_read_and_creation_tokens() {
        let usage = extract_usage_stats(&json!({
            "usage": {
                "input_tokens": 11,
                "output_tokens": 7,
                "cache_read_input_tokens": 3,
                "cache_creation_input_tokens": 2
            }
        }));

        assert_eq!(usage.input_tokens, 11);
        assert_eq!(usage.output_tokens, 7);
        assert_eq!(usage.cache_read_tokens, 3);
        assert_eq!(usage.cache_creation_tokens, 2);
        assert_eq!(usage.cached_tokens, 5);
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
}
