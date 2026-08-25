use super::*;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

const ERROR_SOURCE_CLIENT: &str = "client";
const ERROR_SOURCE_GATEWAY: &str = "gateway";
const ERROR_SOURCE_UPSTREAM: &str = "upstream";

/// Whole-request timeout (connect through response body fully read) applied to
/// upstream requests whose body the gateway waits for in full. Streaming
/// passthrough requests must not use it — it would kill legitimate long streams.
const UPSTREAM_NON_STREAM_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(600);

/// Default for the per-chunk idle timeout on streaming forwards: an upstream
/// that stops sending bytes mid-stream for this long is treated as hung and
/// the stream is terminated (override via `upstreamStreamIdleTimeoutSeconds`).
const DEFAULT_UPSTREAM_STREAM_IDLE_TIMEOUT_SECONDS: u64 = 300;

fn upstream_stream_idle_timeout(state: &AppState) -> std::time::Duration {
    let configured = state
        .config
        .read()
        .expect("config lock poisoned")
        .upstream_stream_idle_timeout_seconds;
    std::time::Duration::from_secs(
        configured.unwrap_or(DEFAULT_UPSTREAM_STREAM_IDLE_TIMEOUT_SECONDS),
    )
}

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

/// Records the `provider_rate_limit_rejected` gateway event when a request is
/// turned away because the provider's RPM cap is full and its queue wait would
/// exceed the configured max wait.
#[allow(clippy::too_many_arguments)]
fn record_provider_rate_limit_rejected(
    state: &AppState,
    api_key_context: &cc_gw_core::api_keys::ResolvedApiKey,
    provider_id: &str,
    rpm_limit: u32,
    retry_after_seconds: u64,
    endpoint_id: &str,
    source_ip: Option<String>,
    user_agent: Option<String>,
) {
    record_and_broadcast_event(
        state,
        RecordEventInput {
            event_type: "provider_rate_limit_rejected".to_string(),
            level: Some("warn".to_string()),
            source: Some("proxy".to_string()),
            title: Some("Provider RPM limit exceeded".to_string()),
            message: Some(format!(
                "Request rejected: provider {provider_id} exceeded RPM limit of {rpm_limit}; retry after {retry_after_seconds}s"
            )),
            api_key_id: Some(api_key_context.id),
            api_key_name: Some(api_key_context.name.clone()),
            endpoint: Some(endpoint_id.to_string()),
            ip_address: source_ip,
            user_agent,
            details: Some(json!({
                "provider": provider_id,
                "rpmLimit": rpm_limit,
                "retryAfterSeconds": retry_after_seconds
            })),
            ..RecordEventInput::default()
        },
    );
}

/// 429 response for RPM-capped providers, with `Retry-After` so clients back
/// off instead of immediately retrying into the same cap.
fn provider_rate_limited_response(
    state: &AppState,
    endpoint_id: &str,
    retry_after_seconds: u64,
) -> Response {
    let mut response = json_response_with_network(
        state,
        endpoint_id,
        StatusCode::TOO_MANY_REQUESTS,
        &json!({
            "error": {
                "code": "provider_rate_limit_exceeded",
                "message": format!(
                    "Provider RPM limit exceeded; retry after {retry_after_seconds}s"
                )
            }
        }),
    );
    if let Ok(value) = HeaderValue::from_str(&retry_after_seconds.to_string()) {
        response.headers_mut().insert(header::RETRY_AFTER, value);
    }
    response
}

fn now_millis() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

fn backend_key(provider_id: &str, model_id: &str) -> String {
    format!("{provider_id}:{model_id}")
}

/// Aggregated routes only wait a short RPM grace on non-final candidates so a
/// busy preferred backend fails over quickly instead of queueing the request
/// for its full configured max-wait; the final candidate keeps the full
/// hold-and-wait contract.
const FAILOVER_CANDIDATE_RPM_MAX_WAIT: std::time::Duration = std::time::Duration::from_secs(2);

const FAILOVER_SELECTED: &str = "selected";
const FAILOVER_FAILED_STATUS: &str = "failed:status";
const FAILOVER_FAILED_TRANSPORT: &str = "failed:transport";
const FAILOVER_RATE_LIMITED: &str = "rate-limited";
const FAILOVER_SKIPPED_COOLDOWN: &str = "skipped:cooldown";

/// One candidate attempt in a failover chain, serialized into the
/// `provider_failover` event's `details.attempts` array.
struct FailoverAttempt {
    provider_id: String,
    model_id: String,
    outcome: &'static str,
    status: Option<u16>,
    error: Option<String>,
    latency_ms: i64,
    detail: Option<Value>,
}

impl FailoverAttempt {
    fn to_json(&self) -> Value {
        let mut object = json!({
            "provider": self.provider_id,
            "model": self.model_id,
            "outcome": self.outcome,
            "latencyMs": self.latency_ms,
        });
        if let Some(status) = self.status {
            object["status"] = json!(status);
        }
        if let Some(error) = &self.error {
            object["error"] = json!(error);
        }
        if let Some(detail) = &self.detail {
            object["detail"] = detail.clone();
        }
        object
    }
}

struct RateRejection {
    provider_id: String,
    rpm_limit: u32,
    retry_after_seconds: u64,
}

struct TransportFailure {
    error: anyhow::Error,
    provider_id: String,
    model_id: String,
}

/// The candidate the request settled on, carrying everything the dispatch
/// paths need — recomputed per candidate so a failover switch swaps provider
/// protocol/conversion context along with the target.
struct SelectedCandidate {
    provider_id: String,
    model_id: String,
    target_protocol: ProviderProtocol,
    cross_protocol: bool,
    upstream_stream: bool,
    backend_key: String,
    policy: FailoverPolicy,
}

/// Emit the `provider_failover` gateway event documenting a degraded chain:
/// either a successful switch to a later candidate (`final_candidate` set) or
/// every candidate being unavailable. Only sent for multi-candidate routes,
/// so direct single-provider traffic never produces these events.
#[allow(clippy::too_many_arguments)]
fn emit_provider_failover_event(
    state: &AppState,
    api_key_context: &cc_gw_core::api_keys::ResolvedApiKey,
    endpoint_id: &str,
    source_ip: Option<&str>,
    user_agent: Option<&str>,
    requested_model: Option<&str>,
    attempts: &[FailoverAttempt],
    final_candidate: Option<&SelectedCandidate>,
) {
    let model = requested_model.unwrap_or_default();
    let attempts_json: Vec<Value> = attempts.iter().map(FailoverAttempt::to_json).collect();
    let message = match final_candidate {
        Some(candidate) => format!(
            "模型 {model} 的首选后端不可用，已自动切换到 Provider {}（共 {} 次尝试）",
            candidate.provider_id,
            attempts.len()
        ),
        None => format!(
            "模型 {model} 的全部聚合后端当前不可用（共 {} 次尝试）",
            attempts.len()
        ),
    };
    record_and_broadcast_event(
        state,
        RecordEventInput {
            event_type: "provider_failover".to_string(),
            level: Some("warn".to_string()),
            source: Some("proxy".to_string()),
            title: Some("Provider failover".to_string()),
            message: Some(message),
            endpoint: Some(endpoint_id.to_string()),
            ip_address: source_ip.map(ToString::to_string),
            api_key_id: Some(api_key_context.id),
            api_key_name: Some(api_key_context.name.clone()),
            user_agent: user_agent.map(ToString::to_string),
            details: Some(json!({
                "model": model,
                "provider": final_candidate.map(|candidate| candidate.provider_id.clone()),
                "finalModel": final_candidate.map(|candidate| candidate.model_id.clone()),
                "attempts": attempts_json,
            })),
            ..RecordEventInput::default()
        },
    );
}

/// Target upstream protocol for a provider, extracted from the proxy flow so
/// the failover loop can recompute it per candidate.
fn infer_target_protocol(
    provider: &cc_gw_core::config::ProviderConfig,
    protocol: ProviderProtocol,
) -> ProviderProtocol {
    if provider_prefers_anthropic_protocol(provider) {
        ProviderProtocol::AnthropicMessages
    } else {
        match protocol {
            ProviderProtocol::AnthropicMessages => {
                if provider_prefers_openai_responses_protocol(provider) {
                    ProviderProtocol::OpenAiResponses
                } else {
                    ProviderProtocol::OpenAiChatCompletions
                }
            }
            ProviderProtocol::OpenAiChatCompletions => ProviderProtocol::OpenAiChatCompletions,
            ProviderProtocol::OpenAiResponses => ProviderProtocol::OpenAiResponses,
        }
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
    let plan = match resolve_route_plan(
        &config,
        endpoint,
        protocol,
        &body,
        requested_model,
        extract_thinking(&body),
    ) {
        Ok(plan) => plan,
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

    // Request-wide values that do not depend on the resolved candidate.
    let stream = body.get("stream").and_then(Value::as_bool).unwrap_or(false);
    let endpoint_compatibility_enabled =
        openai_compatibility_enabled_for_endpoint(&config, endpoint, protocol);
    let sanitize_classifier_response = is_claude_code_auto_mode_classifier_request(protocol, &body);
    let emit_anthropic_reasoning =
        protocol != ProviderProtocol::AnthropicMessages || thinking_explicitly_enabled(&body);
    let allow_anthropic_reasoning_fallback = !sanitize_classifier_response;
    let upstream_timeout = (!stream).then_some(UPSTREAM_NON_STREAM_TIMEOUT);
    let upstream_query = query.clone();

    // Serial failover across the route's candidate chain. Non-aggregated
    // routes always carry exactly one candidate and hit the `is_last` path
    // everywhere, so their behavior matches the previous single-target flow:
    // trigger statuses pass through untouched, RPM rejections answer 429
    // immediately, and only the health-registry bookkeeping is new (and
    // invisible to the direct request itself).
    let total_candidates = plan.candidates.len();
    let failover_policy = plan.failover;
    let direct_policy = FailoverPolicy::default();

    let mut attempts: Vec<FailoverAttempt> = Vec::new();
    let mut last_rate_rejection: Option<RateRejection> = None;
    let mut shortest_cooldown_ms: Option<i64> = None;
    let mut terminal_transport: Option<TransportFailure> = None;
    let mut terminal_response: Option<(SelectedCandidate, reqwest::Response)> = None;
    let mut selected: Option<(SelectedCandidate, reqwest::Response)> = None;

    // Created lazily before the first forwarded attempt so requests turned
    // away before any forward (RPM / all-cooling) keep having no log row,
    // matching the pre-failover RPM rejection behavior.
    let mut request_log_id: Option<i64> = None;
    let mut request_log_finalizer: Option<RequestLogFinalizer> = None;

    for (index, target) in plan.candidates.iter().enumerate() {
        let is_last = index + 1 == total_candidates;
        let policy = failover_policy.as_ref().unwrap_or(&direct_policy);
        let backend_key = backend_key(&target.provider_id, &target.model_id);

        // Cooling backends are skipped on aggregated routes only; direct
        // routes never skip, though their failures still feed the registry.
        if failover_policy.is_some()
            && let Some(remaining_ms) = state
                .backend_health
                .cooldown_remaining(&backend_key, now_millis())
        {
            shortest_cooldown_ms = Some(shortest_cooldown_ms.unwrap_or(i64::MAX).min(remaining_ms));
            attempts.push(FailoverAttempt {
                provider_id: target.provider_id.clone(),
                model_id: target.model_id.clone(),
                outcome: FAILOVER_SKIPPED_COOLDOWN,
                status: None,
                error: None,
                latency_ms: 0,
                detail: Some(json!({ "cooldownRemainingMs": remaining_ms })),
            });
            continue;
        }

        // Hold-and-wait RPM admission: queue the request when the provider's
        // per-minute cap is reached instead of letting the upstream answer 429
        // (which clients tend to retry immediately, feeding a 429 storm).
        // Non-final candidates only wait a short grace so a busy preferred
        // backend fails over quickly instead of queueing for its full
        // max-wait; the final candidate keeps the full hold-and-wait contract.
        // A rejection is a local admission decision, not a backend failure,
        // so it never feeds the health registry.
        let rpm_limit = target.provider.rpm_limit.unwrap_or(0);
        let configured_wait = std::time::Duration::from_secs(
            target
                .provider
                .rpm_max_wait_seconds
                .unwrap_or(DEFAULT_RPM_MAX_WAIT_SECONDS),
        );
        let rpm_max_wait = if is_last {
            configured_wait
        } else {
            configured_wait.min(FAILOVER_CANDIDATE_RPM_MAX_WAIT)
        };
        if rpm_limit > 0
            && let AcquireOutcome::Rejected { retry_after } = state
                .provider_rate_limiter
                .acquire(&target.provider_id, rpm_limit, rpm_max_wait)
                .await
        {
            let retry_after_seconds =
                (retry_after.as_secs() + u64::from(retry_after.subsec_millis() > 0)).max(1);
            attempts.push(FailoverAttempt {
                provider_id: target.provider_id.clone(),
                model_id: target.model_id.clone(),
                outcome: FAILOVER_RATE_LIMITED,
                status: None,
                error: None,
                latency_ms: 0,
                detail: Some(json!({
                    "rpmLimit": rpm_limit,
                    "retryAfterSeconds": retry_after_seconds
                })),
            });
            last_rate_rejection = Some(RateRejection {
                provider_id: target.provider_id.clone(),
                rpm_limit,
                retry_after_seconds,
            });
            continue;
        }

        // The first candidate that actually forwards creates the request log
        // row (carrying that first attempted backend), so every later fail
        // path has a row to finalize. The actually-serving backend is
        // rewritten at finalize time via `RequestLogUpdate`.
        if request_log_id.is_none() {
            request_log_id = insert_request_log(
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
            request_log_finalizer = request_log_id.map(|log_id| {
                RequestLogFinalizer::new(state.paths.db_path.clone(), log_id, started_at)
            });
            if let (Some(log_id), true) = (request_log_id, request_payload_storage) {
                let _ = upsert_request_payload(
                    &state.paths.db_path,
                    log_id,
                    &LogPayloadUpdate {
                        client_request: client_request_payload.as_deref(),
                        ..LogPayloadUpdate::default()
                    },
                );
            }
        }

        // Per-candidate derivation: protocol inference, request conversion
        // and compat-mode learning are all keyed to the provider.
        let provider_type = provider_type_name(&target.provider);
        let target_protocol = infer_target_protocol(&target.provider, protocol);
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
        let upstream_stream =
            stream || target_uses_non_stream_via_stream(&target.provider, &target.model_id);
        let initial_upstream_body = prepare_proxy_payload(
            initial_request_body.clone(),
            &target.model_id,
            upstream_stream,
        );
        let upstream_request_payload = if request_payload_storage && initial_upstream_body != body {
            serde_json::to_string(&initial_upstream_body).ok()
        } else {
            None
        };
        if let (Some(log_id), true) = (request_log_id, request_payload_storage) {
            let _ = upsert_request_payload(
                &state.paths.db_path,
                log_id,
                &LogPayloadUpdate {
                    upstream_request: upstream_request_payload.as_deref(),
                    ..LogPayloadUpdate::default()
                },
            );
        }

        let attempt_started_at = now_millis();
        let mut response = match forward_request(
            &state.http_client,
            &target.provider,
            target_protocol,
            ProxyRequest {
                model: target.model_id.clone(),
                body: initial_request_body.clone(),
                stream: upstream_stream,
                incoming_headers: headers.clone(),
                passthrough_headers: HeaderMap::new(),
                query: upstream_query.clone(),
            },
            upstream_timeout,
        )
        .await
        {
            Ok(response) => response,
            Err(error) => {
                state
                    .backend_health
                    .record_failure(&backend_key, policy, now_millis());
                attempts.push(FailoverAttempt {
                    provider_id: target.provider_id.clone(),
                    model_id: target.model_id.clone(),
                    outcome: FAILOVER_FAILED_TRANSPORT,
                    status: None,
                    error: Some(sanitize_upstream_error(&error)),
                    latency_ms: now_millis() - attempt_started_at,
                    detail: None,
                });
                terminal_transport = Some(TransportFailure {
                    error,
                    provider_id: target.provider_id.clone(),
                    model_id: target.model_id.clone(),
                });
                continue;
            }
        };

        // OpenAI compatibility retry stays inside the candidate: it repairs
        // body compatibility against the same provider while the outer loop
        // switches providers. Each compat retry is a fresh upstream request
        // and must respect the provider's RPM cap; on rejection stop
        // retrying and keep the already-captured >=400 response so the outer
        // failover check still sees it.
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
                if rpm_limit > 0
                    && matches!(
                        state
                            .provider_rate_limiter
                            .acquire(&target.provider_id, rpm_limit, rpm_max_wait)
                            .await,
                        AcquireOutcome::Rejected { .. }
                    )
                {
                    tracing::warn!(
                        provider = %target.provider_id,
                        "OpenAI compatibility retry skipped: provider RPM limit reached"
                    );
                    break;
                }
                if let Ok(retry_response) = forward_request(
                    &state.http_client,
                    &target.provider,
                    target_protocol,
                    ProxyRequest {
                        model: target.model_id.clone(),
                        body: retry_body.clone(),
                        stream: upstream_stream,
                        incoming_headers: headers.clone(),
                        passthrough_headers: HeaderMap::new(),
                        query: upstream_query.clone(),
                    },
                    upstream_timeout,
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
                                mode: Some(openai_compatibility_mode_name(retry_mode).to_string()),
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
                            &target.model_id,
                            upstream_stream,
                        );
                        let retry_payload =
                            if request_payload_storage && retry_upstream_body != body {
                                serde_json::to_string(&retry_upstream_body).ok()
                            } else {
                                None
                            };
                        if let (Some(log_id), true) = (request_log_id, request_payload_storage) {
                            let _ = upsert_request_payload(
                                &state.paths.db_path,
                                log_id,
                                &LogPayloadUpdate {
                                    upstream_request: retry_payload.as_deref(),
                                    ..LogPayloadUpdate::default()
                                },
                            );
                        }
                        break;
                    }
                }
            }
        }

        let candidate = SelectedCandidate {
            provider_id: target.provider_id.clone(),
            model_id: target.model_id.clone(),
            target_protocol,
            cross_protocol,
            upstream_stream,
            backend_key,
            policy: *policy,
        };
        let status = response.status().as_u16();
        let attempt_latency = now_millis() - attempt_started_at;
        if policy.triggers.contains(status) {
            // The trigger-status check runs before any into_* consumer touches
            // the response — the last moment a candidate switch is possible
            // without having written a byte to the client. The final
            // candidate passes its upstream error through unchanged instead
            // (exactly the pre-failover single-target behavior).
            state
                .backend_health
                .record_failure(&candidate.backend_key, policy, now_millis());
            attempts.push(FailoverAttempt {
                provider_id: target.provider_id.clone(),
                model_id: target.model_id.clone(),
                outcome: FAILOVER_FAILED_STATUS,
                status: Some(status),
                error: None,
                latency_ms: attempt_latency,
                detail: None,
            });
            if is_last {
                selected = Some((candidate, response));
                break;
            }
            terminal_response = Some((candidate, response));
            continue;
        }

        state
            .backend_health
            .record_success(&candidate.backend_key, now_millis());
        attempts.push(FailoverAttempt {
            provider_id: target.provider_id.clone(),
            model_id: target.model_id.clone(),
            outcome: FAILOVER_SELECTED,
            status: Some(status),
            error: None,
            latency_ms: attempt_latency,
            detail: None,
        });
        selected = Some((candidate, response));
        break;
    }

    let (candidate, response) = match selected {
        Some(pair) => pair,
        None if attempts.iter().all(|attempt| {
            matches!(
                attempt.outcome,
                FAILOVER_RATE_LIMITED | FAILOVER_SKIPPED_COOLDOWN
            )
        }) =>
        {
            // Every candidate was turned away before any forward: keep the
            // existing RPM-rejection contract when a rate limit is the cause,
            // or answer an all-cooling 429 so clients back off until the
            // shortest cooldown expires.
            if let Some(rejection) = last_rate_rejection {
                record_provider_rate_limit_rejected(
                    &state,
                    &api_key_context,
                    &rejection.provider_id,
                    rejection.rpm_limit,
                    rejection.retry_after_seconds,
                    &endpoint_id,
                    source_ip.clone(),
                    user_agent.clone(),
                );
                return provider_rate_limited_response(
                    &state,
                    &endpoint_id,
                    rejection.retry_after_seconds,
                );
            }
            let retry_after_seconds = shortest_cooldown_ms
                .map(|millis| ((millis + 999) / 1000).max(1) as u64)
                .unwrap_or(1);
            emit_provider_failover_event(
                &state,
                &api_key_context,
                &endpoint_id,
                source_ip.as_deref(),
                user_agent.as_deref(),
                requested_model,
                &attempts,
                None,
            );
            let mut response = json_response_with_network(
                &state,
                &endpoint_id,
                StatusCode::TOO_MANY_REQUESTS,
                &json!({
                    "error": {
                        "code": "aggregate_backends_unavailable",
                        "message": "All aggregate backends are cooling down after repeated failures; retry later"
                    }
                }),
            );
            if let Ok(value) = HeaderValue::from_str(&retry_after_seconds.to_string()) {
                response.headers_mut().insert(header::RETRY_AFTER, value);
            }
            return response;
        }
        None => {
            // At least one real upstream attempt failed. A transport failure
            // keeps the classic 502 + provider_proxy_failure contract; a
            // captured trigger-status response is passed through unchanged.
            if let Some(failure) = terminal_transport {
                tracing::warn!(
                    error = %failure.error,
                    provider = %failure.provider_id,
                    "upstream request failed"
                );
                let latency_ms = now_millis() - started_at;
                if let Some(finalizer) = request_log_finalizer.as_mut() {
                    finalizer.fail(&RequestLogUpdate {
                        latency_ms: Some(latency_ms),
                        status_code: Some(502),
                        error: Some(failure.error.to_string()),
                        error_source: Some(ERROR_SOURCE_UPSTREAM.to_string()),
                        provider: Some(failure.provider_id.clone()),
                        model: Some(failure.model_id.clone()),
                        ..RequestLogUpdate::default()
                    });
                    let _ = increment_daily_metrics(
                        &state.paths.db_path,
                        &endpoint_id,
                        latency_ms,
                        &UsageStats::default(),
                    );
                }
                if total_candidates > 1 {
                    emit_provider_failover_event(
                        &state,
                        &api_key_context,
                        &endpoint_id,
                        source_ip.as_deref(),
                        user_agent.as_deref(),
                        requested_model,
                        &attempts,
                        None,
                    );
                }
                record_and_broadcast_event(
                    &state,
                    RecordEventInput {
                        event_type: "provider_proxy_failure".to_string(),
                        level: Some("error".to_string()),
                        source: Some("proxy".to_string()),
                        title: Some("Provider request failed".to_string()),
                        message: Some(failure.error.to_string()),
                        endpoint: Some(endpoint_id.clone()),
                        api_key_id: Some(api_key_context.id),
                        api_key_name: Some(api_key_context.name),
                        api_key_value: encrypted_api_key_value,
                        user_agent,
                        details: Some(json!({ "provider": failure.provider_id })),
                        ..RecordEventInput::default()
                    },
                );
                return json_response_with_network(
                    &state,
                    &endpoint_id,
                    StatusCode::BAD_GATEWAY,
                    &json!({
                        "error": {
                            "message": sanitize_upstream_error(&failure.error),
                            "provider": failure.provider_id
                        }
                    }),
                );
            }
            match terminal_response {
                Some(pair) => pair,
                None => unreachable!("failover loop ended without a selection or terminal failure"),
            }
        }
    };

    if total_candidates > 1
        && attempts
            .iter()
            .any(|attempt| attempt.outcome != FAILOVER_SELECTED)
    {
        emit_provider_failover_event(
            &state,
            &api_key_context,
            &endpoint_id,
            source_ip.as_deref(),
            user_agent.as_deref(),
            requested_model,
            &attempts,
            Some(&candidate),
        );
    }

    {
        let target_protocol = candidate.target_protocol;
        let cross_protocol = candidate.cross_protocol;
        let upstream_stream = candidate.upstream_stream;
        let streaming_log_context = request_log_id.map(|log_id| StreamingLogContext {
            db_path: state.paths.db_path.clone(),
            log_id,
            endpoint_id: endpoint_id.clone(),
            api_key_id: api_key_context.id,
            started_at,
            store_response_payload: response_payload_storage_enabled(&config),
            backend_provider: Some(candidate.provider_id.clone()),
            backend_model: Some(candidate.model_id.clone()),
        });
        if stream {
            // Log ownership moves to the streaming finalizer inside the
            // response stream; disarm the synchronous guard.
            if let Some(finalizer) = request_log_finalizer.take() {
                finalizer.disarm();
            }
        }
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
                &candidate.provider_id,
                requested_model.unwrap_or(""),
                sanitize_classifier_response,
                emit_anthropic_reasoning,
                allow_anthropic_reasoning_fallback,
                network_recorder.clone(),
            )
            .await;
            let latency_ms = chrono::Utc::now().timestamp_millis() - started_at;
            let status_code = response_status.as_u16() as i64;
            // A 200 handshake whose stream turned out to carry an error
            // event still means the backend is unhealthy — record it so
            // the next request skips this backend (in-request failover is
            // not attempted here; the error is passed through as today).
            if candidate.policy.triggers.contains(response_status.as_u16()) {
                state.backend_health.record_failure(
                    &candidate.backend_key,
                    &candidate.policy,
                    now_millis(),
                );
            }
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
                    provider: Some(candidate.provider_id.clone()),
                    model: Some(candidate.model_id.clone()),
                    ..RequestLogUpdate::default()
                };
                if let Some(finalizer) = request_log_finalizer.as_mut() {
                    finalizer.finish(&update);
                }
                let _ =
                    increment_daily_metrics(&state.paths.db_path, &endpoint_id, latency_ms, &usage);
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
                &candidate.provider_id,
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
                    &candidate.provider_id,
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
                    provider: Some(candidate.provider_id.clone()),
                    model: Some(candidate.model_id.clone()),
                    ..RequestLogUpdate::default()
                };
                if let Some(finalizer) = request_log_finalizer.as_mut() {
                    finalizer.finish(&update);
                }
                let _ =
                    increment_daily_metrics(&state.paths.db_path, &endpoint_id, latency_ms, &usage);
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
                    provider: Some(candidate.provider_id.clone()),
                    model: Some(candidate.model_id.clone()),
                    ..RequestLogUpdate::default()
                };
                if let Some(finalizer) = request_log_finalizer.as_mut() {
                    finalizer.finish(&update);
                }
                let _ =
                    increment_daily_metrics(&state.paths.db_path, &endpoint_id, latency_ms, &usage);
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
        let mut utf8 = Utf8StreamDecoder::new();
        let mut error_forwarded = false;
        let idle_timeout = upstream_stream_idle_timeout(&network_recorder.state);
        loop {
            let next_chunk = match tokio::time::timeout(idle_timeout, upstream.try_next()).await {
                Ok(outcome) => outcome,
                Err(_elapsed) => {
                    let message = format!(
                        "upstream stream idle timeout after {}s",
                        idle_timeout.as_secs()
                    );
                    if observer.is_complete() {
                        finalizer.record_usage(observer.usage_stats());
                        finalizer.finish();
                        tracing::warn!(error = %message, "ignoring idle timeout after terminal SSE event");
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
            };
            match next_chunk {
                Ok(Some(chunk)) => {
                    let text = utf8.push(&chunk);
                    if text.is_empty() {
                        // A multi-byte character is split across chunks; wait
                        // for its remaining bytes before decoding anything.
                        continue;
                    }
                    let observation = observer.push(&text);
                    finalizer.record_usage(observer.usage_stats());
                    if observation.saw_first_token {
                        let seen_at = chrono::Utc::now().timestamp_millis();
                        finalizer.record_first_token_at(seen_at);
                    }
                    finalizer.push_upstream_response(&text);
                    // The transformer has no shape for upstream error events,
                    // so convert one into the client's protocol by hand —
                    // once — or the client would only see the stream end.
                    if observation.saw_error_event && !error_forwarded {
                        error_forwarded = true;
                        if let Some(event) = observer.error_event() {
                            if let Some((message, error_type, code)) =
                                extract_upstream_error_fields(event)
                            {
                                let frame = sse_error_frame(
                                    request_protocol,
                                    &upstream_error_payload(
                                        request_protocol,
                                        &message,
                                        &error_type,
                                        code.as_deref(),
                                    ),
                                );
                                network_recorder.record_egress(frame.len());
                                finalizer.push_client_response(&frame);
                                yield Ok::<Bytes, std::io::Error>(Bytes::from(frame));
                            }
                        }
                    }
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

        let leftover = utf8.flush();
        if !leftover.is_empty() {
            let observation = observer.push(&leftover);
            if observation.saw_first_token {
                let seen_at = chrono::Utc::now().timestamp_millis();
                finalizer.record_first_token_at(seen_at);
            }
            finalizer.push_upstream_response(&leftover);
            for transformed in transformer.push(&leftover) {
                network_recorder.record_egress(transformed.len());
                finalizer.push_client_response(&transformed);
                yield Ok::<Bytes, std::io::Error>(Bytes::from(transformed));
            }
        }

        let observation = observer.finish();
        if observation.saw_first_token {
            let seen_at = chrono::Utc::now().timestamp_millis();
            finalizer.record_first_token_at(seen_at);
        }

        // An upstream SSE error event ends the stream as a failed request —
        // no synthesized happy ending, the log records what actually happened.
        if let Some(event) = observer.error_event() {
            let (message, _error_type, code) = extract_upstream_error_fields(event)
                .unwrap_or_else(|| {
                    (
                        "upstream stream error event".to_string(),
                        "api_error".to_string(),
                        None,
                    )
                });
            let status = upstream_error_status(code.as_deref(), &message);
            finalizer.record_usage(observer.usage_stats());
            finalizer.fail(
                status.as_u16() as i64,
                format!("upstream stream error event: {message}"),
                ERROR_SOURCE_UPSTREAM.to_string(),
            );
            return;
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

/// Frame an error payload as an SSE event in the CLIENT's protocol. Live
/// streaming clients must receive a terminal error event instead of a
/// silently truncated stream — the cross-protocol transformer drops upstream
/// error chunks (they carry no choices/delta structure to convert).
fn sse_error_frame(protocol: ProviderProtocol, payload: &Value) -> String {
    match protocol {
        ProviderProtocol::AnthropicMessages => format!("event: error\ndata: {payload}\n\n"),
        ProviderProtocol::OpenAiChatCompletions | ProviderProtocol::OpenAiResponses => {
            format!("data: {payload}\n\n")
        }
    }
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
        let mut utf8 = Utf8StreamDecoder::new();
        let idle_timeout = upstream_stream_idle_timeout(&network_recorder.state);
        loop {
            let next_chunk = match tokio::time::timeout(idle_timeout, upstream.try_next()).await {
                Ok(outcome) => outcome,
                Err(_elapsed) => {
                    let message = format!(
                        "upstream stream idle timeout after {}s",
                        idle_timeout.as_secs()
                    );
                    if observer.is_complete() {
                        finalizer.record_usage(observer.usage_stats());
                        finalizer.finish();
                        tracing::warn!(error = %message, "ignoring idle timeout after terminal SSE event");
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
            };
            match next_chunk {
                Ok(Some(chunk)) => {
                    // The client receives the raw bytes untouched; the decoder
                    // only feeds the observer/finalizer a correct string view
                    // of a stream whose characters may split across chunks.
                    let text = utf8.push(&chunk);
                    if !text.is_empty() {
                        let observation = observer.push(&text);
                        finalizer.record_usage(observer.usage_stats());
                        if observation.saw_first_token {
                            let seen_at = chrono::Utc::now().timestamp_millis();
                            finalizer.record_first_token_at(seen_at);
                        }
                        finalizer.push_client_response(&text);
                    }
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

        let leftover = utf8.flush();
        if !leftover.is_empty() {
            let observation = observer.push(&leftover);
            if observation.saw_first_token {
                let seen_at = chrono::Utc::now().timestamp_millis();
                finalizer.record_first_token_at(seen_at);
            }
            finalizer.push_client_response(&leftover);
        }

        let observation = observer.finish();
        if observation.saw_first_token {
            let seen_at = chrono::Utc::now().timestamp_millis();
            finalizer.record_first_token_at(seen_at);
        }

        // Passthrough clients already received the raw upstream error bytes;
        // here only the log must tell the truth about how the stream ended.
        if let Some(event) = observer.error_event() {
            let (message, _error_type, code) = extract_upstream_error_fields(event)
                .unwrap_or_else(|| {
                    (
                        "upstream stream error event".to_string(),
                        "api_error".to_string(),
                        None,
                    )
                });
            let status = upstream_error_status(code.as_deref(), &message);
            finalizer.record_usage(observer.usage_stats());
            finalizer.fail(
                status.as_u16() as i64,
                format!("upstream stream error event: {message}"),
                ERROR_SOURCE_UPSTREAM.to_string(),
            );
            return;
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

/// RAII counterpart of `StreamingResponseFinalizer` for requests that are
/// finalized synchronously inside the handler (non-streaming and
/// materialized-stream paths). If the handler future is dropped before an
/// explicit finish/fail (client disconnect, cancellation), the request log is
/// closed as interrupted instead of being left "in progress" forever.
struct RequestLogFinalizer {
    db_path: std::path::PathBuf,
    log_id: i64,
    started_at: i64,
    completed: bool,
}

impl RequestLogFinalizer {
    fn new(db_path: std::path::PathBuf, log_id: i64, started_at: i64) -> Self {
        Self {
            db_path,
            log_id,
            started_at,
            completed: false,
        }
    }

    fn finish(&mut self, update: &RequestLogUpdate) {
        self.complete_with(update);
    }

    fn fail(&mut self, update: &RequestLogUpdate) {
        self.complete_with(update);
    }

    /// Disarm without writing: ownership of the request log moved to a
    /// `StreamingResponseFinalizer` for streaming passthrough responses.
    fn disarm(mut self) {
        self.completed = true;
    }

    fn complete_with(&mut self, update: &RequestLogUpdate) {
        self.completed = true;
        let _ = finalize_request_log(&self.db_path, self.log_id, update);
    }
}

impl Drop for RequestLogFinalizer {
    fn drop(&mut self) {
        if self.completed {
            return;
        }
        let update = RequestLogUpdate {
            latency_ms: Some(chrono::Utc::now().timestamp_millis() - self.started_at),
            status_code: Some(499),
            error: Some("request cancelled before completion".to_string()),
            error_source: Some(ERROR_SOURCE_CLIENT.to_string()),
            ..RequestLogUpdate::default()
        };
        let _ = finalize_request_log(&self.db_path, self.log_id, &update);
    }
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
        provider: context.backend_provider.clone(),
        model: context.backend_model.clone(),
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
            provider_rate_limiter: Arc::new(ProviderRateLimiter::new()),
            backend_health: Arc::new(BackendHealthRegistry::new()),
            http_client: reqwest::Client::builder().build().expect("client"),
            version_check_registry_base_url: "https://registry.npmjs.org".to_string(),
            version_check_package_name: "@chenpu17/cc-gw".to_string(),
            sessions: auth::SessionStore::default(),
            event_bus: tokio::sync::broadcast::channel(256).0,
        }
    }

    #[test]
    fn dropped_request_log_finalizer_marks_log_interrupted() {
        let root = std::env::temp_dir().join(format!(
            "cc-gw2-request-log-finalizer-tests-{}",
            chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default()
        ));
        std::fs::create_dir_all(&root).expect("create temp root");
        let db_path = root.join("gateway.db");
        initialize_database(&db_path).expect("init database");

        let started_at = chrono::Utc::now().timestamp_millis();
        let log_id = insert_request_log(
            &db_path,
            &RequestLogInput {
                timestamp: started_at,
                session_id: None,
                source_ip: None,
                endpoint: "openai".to_string(),
                provider: "mock".to_string(),
                model: "mock-model".to_string(),
                client_model: None,
                stream: false,
                api_key_id: None,
                api_key_name: None,
                api_key_value: None,
            },
        )
        .expect("insert request log");

        drop(RequestLogFinalizer::new(
            db_path.clone(),
            log_id,
            started_at,
        ));

        let logs = query_logs(&db_path, &LogQuery::default()).expect("query logs");
        let record = logs
            .items
            .iter()
            .find(|item| item.id == log_id)
            .expect("log exists");
        assert_eq!(record.status_code, Some(499));
        assert_eq!(
            record.error.as_deref(),
            Some("request cancelled before completion")
        );
        assert_eq!(record.error_source.as_deref(), Some(ERROR_SOURCE_CLIENT));
        assert!(record.latency_ms.is_some());

        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn finished_request_log_finalizer_does_not_overwrite_on_drop() {
        let root = std::env::temp_dir().join(format!(
            "cc-gw2-request-log-finalizer-finish-tests-{}",
            chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default()
        ));
        std::fs::create_dir_all(&root).expect("create temp root");
        let db_path = root.join("gateway.db");
        initialize_database(&db_path).expect("init database");

        let started_at = chrono::Utc::now().timestamp_millis();
        let log_id = insert_request_log(
            &db_path,
            &RequestLogInput {
                timestamp: started_at,
                session_id: None,
                source_ip: None,
                endpoint: "openai".to_string(),
                provider: "mock".to_string(),
                model: "mock-model".to_string(),
                client_model: None,
                stream: false,
                api_key_id: None,
                api_key_name: None,
                api_key_value: None,
            },
        )
        .expect("insert request log");

        let mut finalizer = RequestLogFinalizer::new(db_path.clone(), log_id, started_at);
        finalizer.finish(&RequestLogUpdate {
            latency_ms: Some(120),
            status_code: Some(200),
            ..RequestLogUpdate::default()
        });
        drop(finalizer);

        let logs = query_logs(&db_path, &LogQuery::default()).expect("query logs");
        let record = logs
            .items
            .iter()
            .find(|item| item.id == log_id)
            .expect("log exists");
        assert_eq!(record.status_code, Some(200));
        assert_eq!(record.error, None);
        assert_eq!(record.error_source, None);

        let _ = std::fs::remove_dir_all(root);
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
