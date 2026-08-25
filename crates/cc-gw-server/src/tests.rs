use super::*;
use axum::extract::{Json as AxumJson, Query};
use axum::http::{HeaderName, HeaderValue};
use futures_util::StreamExt;
use std::fs as stdfs;
use std::sync::{Arc, Mutex};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::task::JoinHandle;
use tokio::time::{Duration, sleep};

#[test]
fn extract_session_id_prefers_session_fields_over_user_fields() {
    let payload = json!({
        "metadata": {
            "user_id": "user-fallback",
            "session_id": "session-from-metadata",
            "conversation_id": "conversation-fallback"
        },
        "session_id": "session-from-body",
        "user": "user-from-body"
    });

    assert_eq!(
        extract_session_id(&payload),
        Some("session-from-metadata".to_string())
    );

    let payload_without_user_id = json!({
        "metadata": {
            "session_id": "session-from-metadata",
            "conversation_id": "conversation-fallback"
        },
        "session_id": "session-from-body",
        "user": "user-from-body"
    });

    assert_eq!(
        extract_session_id(&payload_without_user_id),
        Some("session-from-metadata".to_string())
    );

    let payload_with_body_session = json!({
        "session_id": "session-from-body",
        "user": "user-from-body"
    });

    assert_eq!(
        extract_session_id(&payload_with_body_session),
        Some("session-from-body".to_string())
    );

    let payload_with_only_user = json!({
        "metadata": {
            "user_id": "user-fallback"
        },
        "user": "user-from-body"
    });

    assert_eq!(
        extract_session_id(&payload_with_only_user),
        Some("user-fallback".to_string())
    );
}

#[test]
fn normalize_path_trims_trailing_slashes_except_root() {
    assert_eq!(normalize_path("test/"), "/test");
    assert_eq!(normalize_path("/test/"), "/test");
    assert_eq!(normalize_path("/"), "/");
}

#[test]
fn extract_request_session_id_uses_stable_headers_before_user_fallbacks() {
    let payload_with_user_only = json!({
        "metadata": {
            "user_id": "user-fallback"
        }
    });
    let mut headers = HeaderMap::new();
    headers.insert(
        HeaderName::from_static("x-opencode-session-id"),
        HeaderValue::from_static("opencode-session"),
    );
    headers.insert(
        HeaderName::from_static("x-request-id"),
        HeaderValue::from_static("single-request-id"),
    );

    assert_eq!(
        extract_request_session_id(&payload_with_user_only, &headers),
        Some("opencode-session".to_string())
    );

    let payload_with_body_session = json!({
        "metadata": {
            "session_id": "body-session"
        },
        "user": "user-fallback"
    });

    assert_eq!(
        extract_request_session_id(&payload_with_body_session, &headers),
        Some("body-session".to_string())
    );
}

#[test]
fn extract_request_session_id_supports_provider_conversation_fields() {
    let headers = HeaderMap::new();

    let openai_responses_payload = json!({
        "conversation": "conv_openai_123",
        "input": "hello",
        "prompt_cache_key": "cache-bucket"
    });
    assert_eq!(
        extract_request_session_id(&openai_responses_payload, &headers),
        Some("conv_openai_123".to_string())
    );

    let openai_responses_object_payload = json!({
        "conversation": {
            "id": "conv_openai_object_123"
        },
        "input": "hello"
    });
    assert_eq!(
        extract_request_session_id(&openai_responses_object_payload, &headers),
        Some("conv_openai_object_123".to_string())
    );

    let anthropic_container_payload = json!({
        "container": "container_anthropic_123",
        "messages": [{ "role": "user", "content": "hello" }]
    });
    assert_eq!(
        extract_request_session_id(&anthropic_container_payload, &headers),
        Some("container_anthropic_123".to_string())
    );

    let cache_only_payload = json!({
        "prompt_cache_key": "cache-bucket",
        "messages": [{ "role": "user", "content": "hello" }]
    });
    assert_eq!(
        extract_request_session_id(&cache_only_payload, &headers),
        None
    );
}

#[test]
fn extract_header_session_id_supports_cc_gw_standard_header() {
    let payload = json!({});
    let mut headers = HeaderMap::new();
    headers.insert(
        HeaderName::from_static("x-cc-gw-session-id"),
        HeaderValue::from_static("gateway-session"),
    );

    assert_eq!(
        extract_request_session_id(&payload, &headers),
        Some("gateway-session".to_string())
    );
}

#[test]
fn infer_client_kind_prefers_known_cli_markers() {
    let mut claude_headers = HeaderMap::new();
    claude_headers.insert(
        HeaderName::from_static("x-app"),
        HeaderValue::from_static("claude-code"),
    );
    assert_eq!(
        infer_client_kind(
            &claude_headers,
            Some("claude-cli/1.0.0"),
            ProviderProtocol::AnthropicMessages
        ),
        "claude-code"
    );

    let mut codex_headers = HeaderMap::new();
    codex_headers.insert(
        HeaderName::from_static("x-codex-session-id"),
        HeaderValue::from_static("codex-session"),
    );
    assert_eq!(
        infer_client_kind(
            &codex_headers,
            Some("OpenAI Codex CLI"),
            ProviderProtocol::OpenAiResponses
        ),
        "codex"
    );

    let mut opencode_headers = HeaderMap::new();
    opencode_headers.insert(
        HeaderName::from_static("x-opencode-session-id"),
        HeaderValue::from_static("opencode-session"),
    );
    assert_eq!(
        infer_client_kind(
            &opencode_headers,
            Some("opencode/0.1.0"),
            ProviderProtocol::OpenAiChatCompletions
        ),
        "opencode"
    );
}

fn test_paths(label: &str) -> GatewayPaths {
    let root = std::env::temp_dir().join(format!(
        "cc-gw2-tests-{label}-{}",
        chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default()
    ));
    let data_dir = root.join("data");
    let log_dir = root.join("logs");
    stdfs::create_dir_all(&data_dir).expect("create data dir");
    stdfs::create_dir_all(&log_dir).expect("create log dir");
    GatewayPaths {
        home_dir: root.clone(),
        config_path: root.join("config.json"),
        data_dir: data_dir.clone(),
        db_path: data_dir.join("gateway.db"),
        log_dir,
    }
}

fn build_test_state(
    config: GatewayConfig,
    paths: GatewayPaths,
    ui_root: Option<PathBuf>,
) -> AppState {
    AppState {
        config: Arc::new(RwLock::new(config)),
        paths: Arc::new(paths),
        ui_root: ui_root.map(Arc::new),
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

async fn spawn_router(app: Router) -> (SocketAddr, JoinHandle<()>) {
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind listener");
    let addr = listener.local_addr().expect("listener addr");
    let handle = tokio::spawn(async move {
        axum::serve(
            listener,
            app.into_make_service_with_connect_info::<SocketAddr>(),
        )
        .await
        .expect("serve router");
    });
    (addr, handle)
}

async fn spawn_bad_chunked_anthropic_upstream_after_terminal() -> (SocketAddr, JoinHandle<()>) {
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind bad chunked listener");
    let addr = listener.local_addr().expect("bad chunked listener addr");
    let handle = tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.expect("accept bad chunked request");
        let mut request_buf = [0_u8; 4096];
        let _ = socket.read(&mut request_buf).await;
        let stream_payload = concat!(
            "event: message_start\n",
            "data: {\"type\":\"message_start\",\"message\":{\"id\":\"msg_stream\",\"type\":\"message\",\"role\":\"assistant\",\"model\":\"claude-test\",\"content\":[],\"stop_reason\":null,\"stop_sequence\":null,\"usage\":{\"input_tokens\":0,\"output_tokens\":0}}}\n\n",
            "event: content_block_start\n",
            "data: {\"type\":\"content_block_start\",\"index\":0,\"content_block\":{\"type\":\"text\",\"text\":\"\"}}\n\n",
            "event: content_block_delta\n",
            "data: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"hello\"}}\n\n",
            "event: message_delta\n",
            "data: {\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"end_turn\"},\"usage\":{\"input_tokens\":11,\"output_tokens\":2,\"cache_read_input_tokens\":1}}\n\n",
            "event: message_stop\n",
            "data: {\"type\":\"message_stop\"}\n\n"
        );
        let response_head = concat!(
            "HTTP/1.1 200 OK\r\n",
            "content-type: text/event-stream\r\n",
            "transfer-encoding: chunked\r\n",
            "connection: close\r\n",
            "\r\n"
        );
        let response = format!(
            "{response_head}{:x}\r\n{stream_payload}\r\nnot-a-chunk-size\r\n",
            stream_payload.len()
        );
        socket
            .write_all(response.as_bytes())
            .await
            .expect("write bad chunked response");
        let _ = socket.shutdown().await;
    });
    (addr, handle)
}

async fn mock_openai_test(
    headers: HeaderMap,
    Query(query): Query<HashMap<String, String>>,
) -> Response {
    match query.get("mode").map(String::as_str) {
        Some("text") => (StatusCode::OK, "plain text ok").into_response(),
        Some("cred") => (
            StatusCode::FORBIDDEN,
            "this key is only authorized for use with Claude Code",
        )
            .into_response(),
        _ => Json(json!({
            "choices": [{
                "message": {
                    "content": format!(
                        "query={}; ua={}",
                        query.iter().map(|(k, v)| format!("{k}={v}")).collect::<Vec<_>>().join("&"),
                        header_value(&headers, "x-test-header").unwrap_or_default()
                    )
                }
            }]
        }))
        .into_response(),
    }
}

async fn mock_openai_responses_test() -> Response {
    Json(json!({
        "id": "resp_test",
        "object": "response",
        "status": "completed",
        "output_text": "responses diagnostic ok",
        "output": [{
            "type": "message",
            "role": "assistant",
            "content": [{ "type": "output_text", "text": "responses diagnostic ok" }]
        }]
    }))
    .into_response()
}

async fn mock_anthropic_test(Query(query): Query<HashMap<String, String>>) -> Response {
    match query.get("mode").map(String::as_str) {
        Some("badjson") => (StatusCode::OK, "not-json").into_response(),
        _ => Json(json!({
            "content": [{
                "type": "text",
                "text": format!(
                    "anthropic query={}",
                    query.iter().map(|(k, v)| format!("{k}={v}")).collect::<Vec<_>>().join("&")
                )
            }]
        }))
        .into_response(),
    }
}

async fn mock_anthropic_stream() -> Response {
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "text/event-stream")
        .body(Body::from(
            "event: message_start\n\
             data: {\"type\":\"message_start\",\"message\":{\"id\":\"msg_stream\",\"type\":\"message\",\"role\":\"assistant\",\"model\":\"claude-test\",\"content\":[],\"stop_reason\":null,\"stop_sequence\":null,\"usage\":{\"input_tokens\":0,\"output_tokens\":0}}}\n\n\
             event: content_block_start\n\
             data: {\"type\":\"content_block_start\",\"index\":0,\"content_block\":{\"type\":\"text\",\"text\":\"\"}}\n\n\
             event: content_block_delta\n\
             data: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"hello\"}}\n\n\
             event: message_delta\n\
             data: {\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"end_turn\"},\"usage\":{\"input_tokens\":11,\"output_tokens\":2,\"cache_read_input_tokens\":1}}\n\n\
             event: message_stop\n\
             data: {\"type\":\"message_stop\"}\n\n",
        ))
        .expect("build anthropic stream response")
}

async fn mock_anthropic_slow_stream() -> Response {
    let stream = stream! {
        yield Ok::<Bytes, std::convert::Infallible>(Bytes::from(
            "event: message_start\n\
             data: {\"type\":\"message_start\",\"message\":{\"id\":\"msg_stream\",\"type\":\"message\",\"role\":\"assistant\",\"model\":\"claude-test\",\"content\":[],\"stop_reason\":null,\"stop_sequence\":null,\"usage\":{\"input_tokens\":0,\"output_tokens\":0}}}\n\n\
             event: content_block_start\n\
             data: {\"type\":\"content_block_start\",\"index\":0,\"content_block\":{\"type\":\"text\",\"text\":\"\"}}\n\n",
        ));
        sleep(Duration::from_millis(200)).await;
        yield Ok::<Bytes, std::convert::Infallible>(Bytes::from(
            "event: content_block_delta\n\
             data: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"hello\"}}\n\n",
        ));
        sleep(Duration::from_millis(400)).await;
        yield Ok::<Bytes, std::convert::Infallible>(Bytes::from(
            "event: message_delta\n\
             data: {\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"end_turn\"},\"usage\":{\"input_tokens\":11,\"output_tokens\":2,\"cache_read_input_tokens\":1}}\n\n\
             event: message_stop\n\
             data: {\"type\":\"message_stop\"}\n\n",
        ));
    };

    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "text/event-stream")
        .body(Body::from_stream(stream))
        .expect("build slow anthropic stream response")
}

async fn mock_anthropic_failing_stream() -> Response {
    let stream = stream! {
        yield Ok::<Bytes, std::io::Error>(Bytes::from(
            "event: message_start\n\
             data: {\"type\":\"message_start\",\"message\":{\"id\":\"msg_stream\",\"type\":\"message\",\"role\":\"assistant\",\"model\":\"claude-test\",\"content\":[],\"stop_reason\":null,\"stop_sequence\":null,\"usage\":{\"input_tokens\":0,\"output_tokens\":0}}}\n\n\
             event: content_block_start\n\
             data: {\"type\":\"content_block_start\",\"index\":0,\"content_block\":{\"type\":\"text\",\"text\":\"\"}}\n\n\
             event: content_block_delta\n\
             data: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"hello\"}}\n\n",
        ));
        yield Err::<Bytes, std::io::Error>(std::io::Error::other("mock upstream stream failure"));
    };

    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "text/event-stream")
        .body(Body::from_stream(stream))
        .expect("build failing anthropic stream response")
}

fn record_payload(recorder: &Arc<Mutex<Vec<Value>>>, payload: &Value) {
    recorder
        .lock()
        .expect("lock recorder")
        .push(payload.clone());
}

fn exact_json_body(total_size: usize) -> String {
    let prefix = "{\"model\":\"x\",\"input\":\"";
    let suffix = "\"}";
    assert!(total_size > prefix.len() + suffix.len());
    format!(
        "{prefix}{}{suffix}",
        "a".repeat(total_size - prefix.len() - suffix.len())
    )
}

async fn spawn_test_gateway(
    config: GatewayConfig,
    label: &str,
) -> (PathBuf, SocketAddr, JoinHandle<()>) {
    let paths = test_paths(label);
    initialize_database(&paths.db_path).expect("init db");
    let state = build_test_state(config, paths.clone(), None);
    let (addr, handle) = spawn_router(build_router(state)).await;
    (paths.home_dir, addr, handle)
}

#[tokio::test]
async fn provider_test_matches_key_node_behaviors() {
    let upstream = Router::new()
        .route("/v1/chat/completions", post(mock_openai_test))
        .route("/v1/responses", post(mock_openai_responses_test))
        .route("/v1/messages", post(mock_anthropic_test));
    let (upstream_addr, upstream_handle) = spawn_router(upstream).await;

    let mut config = GatewayConfig::default();
    config.providers = vec![
        cc_gw_core::config::ProviderConfig {
            id: "mock-openai".to_string(),
            label: "Mock OpenAI".to_string(),
            base_url: format!("http://{upstream_addr}"),
            provider_type: Some("openai".to_string()),
            default_model: Some("gpt-test".to_string()),
            models: vec![cc_gw_core::config::ProviderModelConfig {
                id: "gpt-test".to_string(),
                label: Some("GPT Test".to_string()),
                ..Default::default()
            }],
            ..cc_gw_core::config::ProviderConfig::default()
        },
        cc_gw_core::config::ProviderConfig {
            id: "mock-anthropic".to_string(),
            label: "Mock Anthropic".to_string(),
            base_url: format!("http://{upstream_addr}"),
            provider_type: Some("anthropic".to_string()),
            default_model: Some("claude-test".to_string()),
            models: vec![cc_gw_core::config::ProviderModelConfig {
                id: "claude-test".to_string(),
                label: Some("Claude Test".to_string()),
                ..Default::default()
            }],
            ..cc_gw_core::config::ProviderConfig::default()
        },
        cc_gw_core::config::ProviderConfig {
            id: "mock-openai-responses".to_string(),
            label: "Mock OpenAI Responses".to_string(),
            base_url: format!("http://{upstream_addr}"),
            provider_type: Some("openai-responses".to_string()),
            default_model: Some("gpt-responses-test".to_string()),
            models: vec![cc_gw_core::config::ProviderModelConfig {
                id: "gpt-responses-test".to_string(),
                label: Some("GPT Responses Test".to_string()),
                ..Default::default()
            }],
            ..cc_gw_core::config::ProviderConfig::default()
        },
        cc_gw_core::config::ProviderConfig {
            id: "mock-no-model".to_string(),
            label: "Mock No Model".to_string(),
            base_url: format!("http://{upstream_addr}"),
            provider_type: Some("openai".to_string()),
            ..cc_gw_core::config::ProviderConfig::default()
        },
    ];

    let (home_dir, gateway_addr, gateway_handle) =
        spawn_test_gateway(config, "provider-test").await;
    let client = reqwest::Client::new();

    let success: Value = client
        .post(format!(
            "http://{gateway_addr}/api/providers/mock-openai/test"
        ))
        .json(&json!({
            "headers": { "X-Test-Header": "abc" },
            "query": "mode=json&via=test"
        }))
        .send()
        .await
        .expect("send success request")
        .json()
        .await
        .expect("decode success response");
    assert_eq!(success.get("ok").and_then(Value::as_bool), Some(true));
    assert_eq!(
        success.get("statusText").and_then(Value::as_str),
        Some("OK")
    );
    let success_sample = success
        .get("sample")
        .and_then(Value::as_str)
        .expect("success sample");
    assert!(success_sample.contains("mode=json"));
    assert!(success_sample.contains("via=test"));
    assert!(success_sample.ends_with("ua=abc"));

    let empty_body_success: Value = client
        .post(format!(
            "http://{gateway_addr}/api/providers/mock-openai/test"
        ))
        .send()
        .await
        .expect("send empty body request")
        .json()
        .await
        .expect("decode empty body response");
    assert_eq!(
        empty_body_success.get("ok").and_then(Value::as_bool),
        Some(true)
    );

    let no_model_response = client
        .post(format!(
            "http://{gateway_addr}/api/providers/mock-no-model/test"
        ))
        .json(&json!({}))
        .send()
        .await
        .expect("send no model request");
    assert_eq!(no_model_response.status(), StatusCode::OK);
    let no_model: Value = no_model_response
        .json()
        .await
        .expect("decode no model response");
    assert_eq!(no_model.get("ok").and_then(Value::as_bool), Some(false));
    assert_eq!(
        no_model.get("statusText").and_then(Value::as_str),
        Some("No model configured for provider")
    );

    let text_fallback: Value = client
        .post(format!(
            "http://{gateway_addr}/api/providers/mock-openai/test"
        ))
        .json(&json!({ "query": "mode=text" }))
        .send()
        .await
        .expect("send text fallback request")
        .json()
        .await
        .expect("decode text fallback response");
    assert_eq!(text_fallback.get("ok").and_then(Value::as_bool), Some(true));
    assert_eq!(
        text_fallback.get("statusText").and_then(Value::as_str),
        Some("OK (text response)")
    );
    assert_eq!(
        text_fallback.get("sample").and_then(Value::as_str),
        Some("plain text ok")
    );

    let responses_success: Value = client
        .post(format!(
            "http://{gateway_addr}/api/providers/mock-openai-responses/test"
        ))
        .json(&json!({}))
        .send()
        .await
        .expect("send responses success request")
        .json()
        .await
        .expect("decode responses success response");
    assert_eq!(
        responses_success.get("ok").and_then(Value::as_bool),
        Some(true)
    );
    assert_eq!(
        responses_success.get("sample").and_then(Value::as_str),
        Some("responses diagnostic ok")
    );

    let restricted: Value = client
        .post(format!(
            "http://{gateway_addr}/api/providers/mock-openai/test"
        ))
        .json(&json!({ "query": "mode=cred" }))
        .send()
        .await
        .expect("send restricted request")
        .json()
        .await
        .expect("decode restricted response");
    assert_eq!(restricted.get("ok").and_then(Value::as_bool), Some(false));
    assert_eq!(restricted.get("status").and_then(Value::as_u64), Some(403));
    assert!(
        restricted
            .get("statusText")
            .and_then(Value::as_str)
            .is_some_and(|text| text.contains("Claude Code"))
    );

    let invalid_json: Value = client
        .post(format!(
            "http://{gateway_addr}/api/providers/mock-anthropic/test"
        ))
        .json(&json!({ "query": "mode=badjson" }))
        .send()
        .await
        .expect("send anthropic invalid json request")
        .json()
        .await
        .expect("decode anthropic invalid json response");
    assert_eq!(invalid_json.get("ok").and_then(Value::as_bool), Some(false));
    assert_eq!(
        invalid_json.get("statusText").and_then(Value::as_str),
        Some("Invalid JSON response")
    );

    gateway_handle.abort();
    upstream_handle.abort();
    let _ = stdfs::remove_dir_all(home_dir);
}

async fn mock_openai_models() -> Response {
    Json(json!({
        "object": "list",
        "data": [
            { "id": "gpt-b", "object": "model", "display_name": "GPT B" },
            { "id": "gpt-a", "object": "model" }
        ]
    }))
    .into_response()
}

async fn mock_draft_chat() -> Response {
    Json(json!({
        "id": "chatcmpl_draft",
        "object": "chat.completion",
        "choices": [{
            "index": 0,
            "message": { "role": "assistant", "content": "draft test ok" },
            "finish_reason": "stop"
        }],
        "usage": { "prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2 }
    }))
    .into_response()
}

#[tokio::test]
async fn provider_models_probe_returns_normalized_list() {
    let upstream = Router::new()
        .route("/v1/models", get(mock_openai_models))
        .route("/absolute/v1/models", get(mock_openai_models))
        .route("/v1/chat/completions", post(mock_draft_chat));
    let (upstream_addr, upstream_handle) = spawn_router(upstream).await;

    let mut config = GatewayConfig::default();
    config.providers = vec![
        cc_gw_core::config::ProviderConfig {
            id: "probe-openai".to_string(),
            label: "Probe OpenAI".to_string(),
            base_url: format!("http://{upstream_addr}"),
            provider_type: Some("openai".to_string()),
            ..cc_gw_core::config::ProviderConfig::default()
        },
        cc_gw_core::config::ProviderConfig {
            id: "probe-absolute".to_string(),
            label: "Probe Absolute".to_string(),
            base_url: format!("http://{upstream_addr}/absolute/v1/chat/completions"),
            use_absolute_url: Some(true),
            provider_type: Some("openai".to_string()),
            ..cc_gw_core::config::ProviderConfig::default()
        },
        cc_gw_core::config::ProviderConfig {
            id: "probe-unsupported".to_string(),
            label: "Probe Unsupported".to_string(),
            base_url: format!("http://{upstream_addr}/custom/endpoint"),
            use_absolute_url: Some(true),
            provider_type: Some("openai".to_string()),
            ..cc_gw_core::config::ProviderConfig::default()
        },
        cc_gw_core::config::ProviderConfig {
            id: "probe-missing".to_string(),
            label: "Probe Missing".to_string(),
            // No /v1/models on this upstream path → 404 from the mock router.
            base_url: format!("http://{upstream_addr}/nowhere"),
            provider_type: Some("openai".to_string()),
            ..cc_gw_core::config::ProviderConfig::default()
        },
    ];

    let (home_dir, gateway_addr, gateway_handle) =
        spawn_test_gateway(config, "provider-models-probe").await;
    let client = reqwest::Client::new();

    let success: Value = client
        .post(format!(
            "http://{gateway_addr}/api/providers/probe-openai/models/probe"
        ))
        .send()
        .await
        .expect("send probe request")
        .json()
        .await
        .expect("decode probe response");
    assert_eq!(success.get("ok").and_then(Value::as_bool), Some(true));
    assert_eq!(
        success
            .get("models")
            .and_then(Value::as_array)
            .map(Vec::len),
        Some(2)
    );
    // Sorted by id; label picked up from display_name.
    assert_eq!(
        success.pointer("/models/0/id").and_then(Value::as_str),
        Some("gpt-a")
    );
    assert_eq!(
        success.pointer("/models/1/id").and_then(Value::as_str),
        Some("gpt-b")
    );
    assert_eq!(
        success.pointer("/models/1/label").and_then(Value::as_str),
        Some("GPT B")
    );

    let absolute: Value = client
        .post(format!(
            "http://{gateway_addr}/api/providers/probe-absolute/models/probe"
        ))
        .send()
        .await
        .expect("send absolute probe request")
        .json()
        .await
        .expect("decode absolute probe response");
    assert_eq!(absolute.get("ok").and_then(Value::as_bool), Some(true));

    let unsupported: Value = client
        .post(format!(
            "http://{gateway_addr}/api/providers/probe-unsupported/models/probe"
        ))
        .send()
        .await
        .expect("send unsupported probe request")
        .json()
        .await
        .expect("decode unsupported probe response");
    assert_eq!(unsupported.get("ok").and_then(Value::as_bool), Some(false));
    assert_eq!(unsupported.get("status").and_then(Value::as_u64), Some(0));

    let missing: Value = client
        .post(format!(
            "http://{gateway_addr}/api/providers/probe-missing/models/probe"
        ))
        .send()
        .await
        .expect("send missing probe request")
        .json()
        .await
        .expect("decode missing probe response");
    assert_eq!(missing.get("ok").and_then(Value::as_bool), Some(false));
    assert_eq!(missing.get("status").and_then(Value::as_u64), Some(404));

    // Draft provider in the request body wins over the (missing) path id —
    // this is how the create-mode console probes unsaved configs.
    let draft = json!({
        "id": "unsaved-draft",
        "label": "Unsaved Draft",
        "type": "openai",
        "baseUrl": format!("http://{upstream_addr}"),
        "apiKey": "draft-key",
        "defaultModel": "gpt-a"
    });
    let draft_probe: Value = client
        .post(format!(
            "http://{gateway_addr}/api/providers/unsaved-draft/models/probe"
        ))
        .json(&json!({ "provider": draft }))
        .send()
        .await
        .expect("send draft probe request")
        .json()
        .await
        .expect("decode draft probe response");
    assert_eq!(draft_probe.get("ok").and_then(Value::as_bool), Some(true));
    assert_eq!(
        draft_probe
            .get("models")
            .and_then(Value::as_array)
            .map(Vec::len),
        Some(2)
    );

    let draft_test: Value = client
        .post(format!(
            "http://{gateway_addr}/api/providers/unsaved-draft/test"
        ))
        .json(&json!({ "provider": draft }))
        .send()
        .await
        .expect("send draft test request")
        .json()
        .await
        .expect("decode draft test response");
    assert_eq!(draft_test.get("ok").and_then(Value::as_bool), Some(true));
    assert_eq!(
        draft_test.get("sample").and_then(Value::as_str),
        Some("draft test ok")
    );

    // Without a draft, an unknown id still 404s.
    let unknown = client
        .post(format!(
            "http://{gateway_addr}/api/providers/unsaved-draft/models/probe"
        ))
        .send()
        .await
        .expect("send unknown probe request");
    assert_eq!(unknown.status(), StatusCode::NOT_FOUND);

    gateway_handle.abort();
    upstream_handle.abort();
    let _ = stdfs::remove_dir_all(home_dir);
}

#[tokio::test]
async fn direct_proxy_responses_do_not_forward_upstream_set_cookie() {
    let upstream = Router::new().route(
        "/v1/chat/completions",
        post(|| async {
            Response::builder()
                .status(StatusCode::OK)
                .header(header::SET_COOKIE, "provider_session=abc; Path=/; HttpOnly")
                .header("x-request-id", "req_123")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    json!({
                        "choices": [{
                            "message": { "content": "ok" }
                        }],
                        "usage": {
                            "prompt_tokens": 1,
                            "completion_tokens": 1
                        }
                    })
                    .to_string(),
                ))
                .expect("build upstream response")
        }),
    );
    let (upstream_addr, upstream_handle) = spawn_router(upstream).await;

    let mut config = GatewayConfig::default();
    config.providers = vec![cc_gw_core::config::ProviderConfig {
        id: "mock-openai".to_string(),
        label: "Mock OpenAI".to_string(),
        base_url: format!("http://{upstream_addr}"),
        provider_type: Some("openai".to_string()),
        default_model: Some("gpt-test".to_string()),
        models: vec![cc_gw_core::config::ProviderModelConfig {
            id: "gpt-test".to_string(),
            label: Some("GPT Test".to_string()),
            ..Default::default()
        }],
        ..cc_gw_core::config::ProviderConfig::default()
    }];
    config.defaults.completion = Some("gpt-test".to_string());
    if let Some(openai_routing) = config.endpoint_routing.get_mut("openai") {
        openai_routing.defaults.completion = Some("gpt-test".to_string());
    }

    let (home_dir, gateway_addr, gateway_handle) =
        spawn_test_gateway(config, "proxy-response-header-filter").await;
    let client = reqwest::Client::new();

    let response = client
        .post(format!("http://{gateway_addr}/openai/v1/chat/completions"))
        .json(&json!({
            "model": "gpt-test",
            "messages": [{ "role": "user", "content": "hello" }]
        }))
        .send()
        .await
        .expect("send openai request");
    assert_eq!(response.status(), StatusCode::OK);
    assert!(response.headers().get(header::SET_COOKIE).is_none());
    assert_eq!(
        response
            .headers()
            .get("x-request-id")
            .and_then(|value| value.to_str().ok()),
        Some("req_123")
    );

    gateway_handle.abort();
    upstream_handle.abort();
    let _ = stdfs::remove_dir_all(home_dir);
}

#[tokio::test]
async fn non_stream_response_logging_does_not_store_compressed_payload_gibberish() {
    let upstream = Router::new().route(
        "/v1/chat/completions",
        post(|headers: HeaderMap| async move {
            if headers.get(header::ACCEPT_ENCODING).is_some() {
                return Response::builder()
                    .status(StatusCode::OK)
                    .header(header::CONTENT_TYPE, "application/json")
                    .header(header::CONTENT_ENCODING, "gzip")
                    .body(Body::from(vec![0x1f, 0x8b, 0x08, 0x00, 0x00, 0x00]))
                    .expect("build compressed response");
            }

            Json(json!({
                "id": "chatcmpl_plain",
                "object": "chat.completion",
                "model": "gpt-test",
                "choices": [{
                    "index": 0,
                    "message": { "role": "assistant", "content": "plain response" },
                    "finish_reason": "stop"
                }],
                "usage": {
                    "prompt_tokens": 1,
                    "completion_tokens": 2,
                    "total_tokens": 3
                }
            }))
            .into_response()
        }),
    );
    let (upstream_addr, upstream_handle) = spawn_router(upstream).await;

    let mut config = GatewayConfig::default();
    config.store_response_payloads = Some(true);
    config.providers = vec![cc_gw_core::config::ProviderConfig {
        id: "mock-openai".to_string(),
        label: "Mock OpenAI".to_string(),
        base_url: format!("http://{upstream_addr}"),
        provider_type: Some("openai".to_string()),
        default_model: Some("gpt-test".to_string()),
        models: vec![cc_gw_core::config::ProviderModelConfig {
            id: "gpt-test".to_string(),
            label: Some("GPT Test".to_string()),
            ..Default::default()
        }],
        ..cc_gw_core::config::ProviderConfig::default()
    }];
    if let Some(openai_routing) = config.endpoint_routing.get_mut("openai") {
        openai_routing.defaults.completion = Some("mock-openai:gpt-test".to_string());
    }

    let (home_dir, gateway_addr, gateway_handle) =
        spawn_test_gateway(config, "non-stream-response-logging-encoding").await;
    let client = reqwest::Client::builder()
        .no_gzip()
        .no_brotli()
        .no_zstd()
        .no_deflate()
        .build()
        .expect("client");

    let response: Value = client
        .post(format!("http://{gateway_addr}/openai/v1/chat/completions"))
        .header(header::ACCEPT_ENCODING, "gzip")
        .json(&json!({
            "model": "gpt-test",
            "messages": [{ "role": "user", "content": "hello" }]
        }))
        .send()
        .await
        .expect("send non-stream request")
        .json()
        .await
        .expect("decode response");
    assert_eq!(
        response["choices"][0]["message"]["content"].as_str(),
        Some("plain response")
    );

    let logs: Value = client
        .get(format!("http://{gateway_addr}/api/logs?limit=1"))
        .send()
        .await
        .expect("request logs")
        .json()
        .await
        .expect("decode logs response");
    let log_id = logs["items"]
        .as_array()
        .and_then(|items| items.first())
        .and_then(|item| item["id"].as_i64())
        .expect("log id");
    let detail: Value = client
        .get(format!("http://{gateway_addr}/api/logs/{log_id}"))
        .send()
        .await
        .expect("request log detail")
        .json()
        .await
        .expect("decode log detail");
    let response_payload = detail["payload"]["client_response"]
        .as_str()
        .expect("client response payload");
    let response_payload_json: Value =
        serde_json::from_str(response_payload).expect("response payload is plain json");
    assert_eq!(
        response_payload_json["choices"][0]["message"]["content"].as_str(),
        Some("plain response")
    );

    gateway_handle.abort();
    upstream_handle.abort();
    let _ = stdfs::remove_dir_all(home_dir);
}

#[tokio::test]
async fn openai_root_routes_match_openai_prefixed_routes() {
    let upstream = Router::new()
        .route("/v1/chat/completions", post(mock_openai_test))
        .route(
            "/v1/responses",
            post(|| async {
                Response::builder()
                    .status(StatusCode::OK)
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(
                        json!({
                            "id": "resp_test",
                            "object": "response",
                            "output": [{
                                "type": "message",
                                "content": [{ "type": "output_text", "text": "ok" }]
                            }],
                            "usage": {
                                "input_tokens": 1,
                                "output_tokens": 1
                            }
                        })
                        .to_string(),
                    ))
                    .expect("build responses response")
            }),
        );
    let (upstream_addr, upstream_handle) = spawn_router(upstream).await;

    let mut config = GatewayConfig::default();
    config.providers = vec![cc_gw_core::config::ProviderConfig {
        id: "mock-openai".to_string(),
        label: "Mock OpenAI".to_string(),
        base_url: format!("http://{upstream_addr}"),
        provider_type: Some("openai".to_string()),
        default_model: Some("gpt-test".to_string()),
        models: vec![cc_gw_core::config::ProviderModelConfig {
            id: "gpt-test".to_string(),
            label: Some("GPT Test".to_string()),
            ..Default::default()
        }],
        ..cc_gw_core::config::ProviderConfig::default()
    }];
    config.defaults.completion = Some("gpt-test".to_string());
    if let Some(openai_routing) = config.endpoint_routing.get_mut("openai") {
        openai_routing.defaults.completion = Some("gpt-test".to_string());
    }

    let (home_dir, gateway_addr, gateway_handle) =
        spawn_test_gateway(config, "openai-root-routes").await;
    let client = reqwest::Client::new();

    let models = client
        .get(format!("http://{gateway_addr}/v1/models"))
        .send()
        .await
        .expect("send models request");
    assert_eq!(models.status(), StatusCode::OK);

    let chat = client
        .post(format!("http://{gateway_addr}/v1/chat/completions"))
        .json(&json!({
            "model": "gpt-test",
            "messages": [{ "role": "user", "content": "hello" }]
        }))
        .send()
        .await
        .expect("send root chat request");
    assert_eq!(chat.status(), StatusCode::OK);

    let responses = client
        .post(format!("http://{gateway_addr}/v1/responses"))
        .json(&json!({
            "model": "gpt-test",
            "input": "hello"
        }))
        .send()
        .await
        .expect("send root responses request");
    assert_eq!(responses.status(), StatusCode::OK);

    gateway_handle.abort();
    upstream_handle.abort();
    let _ = stdfs::remove_dir_all(home_dir);
}

#[tokio::test]
async fn anthropic_messages_forward_query_and_identity_headers_to_anthropic_provider() {
    let captures = Arc::new(Mutex::new(Vec::<Value>::new()));
    let captures_for_route = Arc::clone(&captures);
    let upstream = Router::new().route(
        "/v1/messages",
        post(
            move |headers: HeaderMap, Query(query): Query<HashMap<String, String>>, AxumJson(payload): AxumJson<Value>| {
                let captures = Arc::clone(&captures_for_route);
                async move {
                    captures.lock().expect("lock captures").push(json!({
                        "query": query,
                        "accept": headers.get("accept").and_then(|value| value.to_str().ok()),
                        "anthropic_beta": headers.get("anthropic-beta").and_then(|value| value.to_str().ok()),
                        "anthropic_version": headers.get("anthropic-version").and_then(|value| value.to_str().ok()),
                        "authorization": headers.get("authorization").and_then(|value| value.to_str().ok()),
                        "cookie": headers.get("cookie").and_then(|value| value.to_str().ok()),
                        "x_api_key": headers.get("x-api-key").and_then(|value| value.to_str().ok()),
                        "x_app": headers.get("x-app").and_then(|value| value.to_str().ok()),
                        "payload": payload,
                    }));
                    Json(json!({
                        "id": "msg_query",
                        "type": "message",
                        "role": "assistant",
                        "model": "claude-test",
                        "content": [{
                            "type": "text",
                            "text": "query-ok"
                        }],
                        "stop_reason": "end_turn",
                        "stop_sequence": Value::Null,
                        "usage": {
                            "input_tokens": 5,
                            "output_tokens": 2
                        }
                    }))
                }
            },
        ),
    );
    let (upstream_addr, upstream_handle) = spawn_router(upstream).await;

    let mut config = GatewayConfig::default();
    config.providers = vec![cc_gw_core::config::ProviderConfig {
        id: "mock-anthropic".to_string(),
        label: "Mock Anthropic".to_string(),
        api_key: Some("provider-secret".to_string()),
        base_url: format!("http://{upstream_addr}"),
        provider_type: Some("anthropic".to_string()),
        default_model: Some("claude-test".to_string()),
        models: vec![cc_gw_core::config::ProviderModelConfig {
            id: "claude-test".to_string(),
            label: Some("Claude Test".to_string()),
            ..Default::default()
        }],
        ..cc_gw_core::config::ProviderConfig::default()
    }];
    config.defaults.completion = Some("claude-test".to_string());
    if let Some(anthropic_routing) = config.endpoint_routing.get_mut("anthropic") {
        anthropic_routing.defaults.completion = Some("claude-test".to_string());
    }

    let (home_dir, gateway_addr, gateway_handle) =
        spawn_test_gateway(config, "anthropic-query-forward").await;
    let client = reqwest::Client::new();

    let response: Value = client
        .post(format!(
            "http://{gateway_addr}/v1/messages?trace=1&source=cli"
        ))
        .header("accept", "application/json")
        .header("authorization", "Bearer caller-key")
        .header("anthropic-beta", "fine-grained-tool-streaming-2025-05-14")
        .header("cookie", "session=abc")
        .header("x-app", "claude-code")
        .json(&json!({
            "model": "claude-test",
            "max_tokens": 64,
            "metadata": {
                "session_id": "session-1",
                "trace_id": "trace-1"
            },
            "system": [{
                "type": "text",
                "text": "system prompt"
            }],
            "tools": [{
                "name": "echo",
                "description": "Echo input",
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "value": { "type": "string" }
                    }
                }
            }],
            "tool_choice": {
                "type": "tool",
                "name": "echo"
            },
            "temperature": 0.2,
            "messages": [{
                "role": "user",
                "content": [{ "type": "text", "text": "hello" }]
            }]
        }))
        .send()
        .await
        .expect("send anthropic request with query")
        .json()
        .await
        .expect("decode anthropic response");

    assert_eq!(
        response
            .get("content")
            .and_then(Value::as_array)
            .and_then(|items| items.first())
            .and_then(|item| item.get("text"))
            .and_then(Value::as_str),
        Some("query-ok")
    );

    let recorded = captures.lock().expect("lock captures");
    assert_eq!(recorded.len(), 1);
    assert_eq!(recorded[0]["query"]["trace"].as_str(), Some("1"));
    assert_eq!(recorded[0]["query"]["source"].as_str(), Some("cli"));
    assert_eq!(
        recorded[0]["anthropic_beta"].as_str(),
        Some("fine-grained-tool-streaming-2025-05-14")
    );
    assert_eq!(recorded[0]["accept"].as_str(), Some("application/json"));
    assert_eq!(
        recorded[0]["anthropic_version"].as_str(),
        Some("2023-06-01")
    );
    assert_eq!(
        recorded[0]["authorization"].as_str(),
        Some("Bearer provider-secret")
    );
    assert_eq!(recorded[0]["cookie"], Value::Null);
    assert_eq!(recorded[0]["x_api_key"], Value::Null);
    assert_eq!(recorded[0]["x_app"].as_str(), Some("claude-code"));
    assert_eq!(
        recorded[0]["payload"]["metadata"]["session_id"].as_str(),
        Some("session-1")
    );
    assert_eq!(
        recorded[0]["payload"]["metadata"]["trace_id"].as_str(),
        Some("trace-1")
    );
    assert_eq!(
        recorded[0]["payload"]["system"][0]["text"].as_str(),
        Some("system prompt")
    );
    assert_eq!(
        recorded[0]["payload"]["tools"][0]["name"].as_str(),
        Some("echo")
    );
    assert_eq!(
        recorded[0]["payload"]["tool_choice"]["name"].as_str(),
        Some("echo")
    );
    assert_eq!(recorded[0]["payload"]["temperature"].as_f64(), Some(0.2));
    assert_eq!(
        recorded[0]["payload"]["messages"][0]["content"][0]["text"].as_str(),
        Some("hello")
    );

    gateway_handle.abort();
    upstream_handle.abort();
    let _ = stdfs::remove_dir_all(home_dir);
}

#[tokio::test]
async fn openai_chat_non_stream_routes_model_and_records_rewritten_upstream_payload() {
    let captures = Arc::new(Mutex::new(Vec::<Value>::new()));
    let captures_for_route = Arc::clone(&captures);
    let upstream = Router::new().route(
        "/v1/chat/completions",
        post(move |AxumJson(payload): AxumJson<Value>| {
            let captures = Arc::clone(&captures_for_route);
            async move {
                record_payload(&captures, &payload);
                Json(json!({
                    "id": "chatcmpl_route",
                    "object": "chat.completion",
                    "model": payload.get("model").cloned().unwrap_or(Value::Null),
                    "choices": [{
                        "index": 0,
                        "message": {
                            "role": "assistant",
                            "content": "routed"
                        },
                        "finish_reason": "stop"
                    }],
                    "usage": {
                        "prompt_tokens": 3,
                        "completion_tokens": 1,
                        "total_tokens": 4
                    }
                }))
            }
        }),
    );
    let (upstream_addr, upstream_handle) = spawn_router(upstream).await;

    let mut config = GatewayConfig::default();
    config.store_request_payloads = Some(true);
    config.providers = vec![cc_gw_core::config::ProviderConfig {
        id: "mock-openai".to_string(),
        label: "Mock OpenAI".to_string(),
        base_url: format!("http://{upstream_addr}"),
        provider_type: Some("openai".to_string()),
        ..cc_gw_core::config::ProviderConfig::default()
    }];
    if let Some(openai_routing) = config.endpoint_routing.get_mut("openai") {
        openai_routing.model_routes.insert(
            "client-model-a".to_string(),
            "mock-openai:upstream-model-b".to_string(),
        );
    }

    let (home_dir, gateway_addr, gateway_handle) =
        spawn_test_gateway(config, "openai-route-model-rewrite").await;
    let client = reqwest::Client::new();

    let response: Value = client
        .post(format!("http://{gateway_addr}/openai/v1/chat/completions"))
        .json(&json!({
            "model": "client-model-a",
            "stream": false,
            "messages": [{ "role": "user", "content": "hello" }]
        }))
        .send()
        .await
        .expect("send non-stream openai request")
        .json()
        .await
        .expect("decode openai response");

    assert_eq!(response["model"].as_str(), Some("upstream-model-b"));

    let captured = captures.lock().expect("lock captures");
    assert_eq!(captured.len(), 1);
    assert_eq!(captured[0]["model"].as_str(), Some("upstream-model-b"));
    assert_eq!(captured[0]["stream"].as_bool(), Some(false));
    drop(captured);

    let logs: Value = client
        .get(format!("http://{gateway_addr}/api/logs?limit=1"))
        .send()
        .await
        .expect("request logs")
        .json()
        .await
        .expect("decode logs response");
    let item = logs["items"]
        .as_array()
        .and_then(|items| items.first())
        .expect("log item");
    assert_eq!(item["model"].as_str(), Some("upstream-model-b"));
    assert_eq!(item["client_model"].as_str(), Some("client-model-a"));
    assert_eq!(item["stream"].as_bool(), Some(false));

    let log_id = item["id"].as_i64().expect("log id");
    let detail: Value = client
        .get(format!("http://{gateway_addr}/api/logs/{log_id}"))
        .send()
        .await
        .expect("request log detail")
        .json()
        .await
        .expect("decode log detail");
    let payload = detail.get("payload").expect("payload object");
    let client_request_json: Value = serde_json::from_str(
        payload["client_request"]
            .as_str()
            .expect("client request payload"),
    )
    .expect("decode client request");
    let upstream_request_json: Value = serde_json::from_str(
        payload["upstream_request"]
            .as_str()
            .expect("upstream request payload"),
    )
    .expect("decode upstream request");

    assert_eq!(
        client_request_json["model"].as_str(),
        Some("client-model-a")
    );
    assert_eq!(
        upstream_request_json["model"].as_str(),
        Some("upstream-model-b")
    );
    assert_eq!(upstream_request_json["stream"].as_bool(), Some(false));

    gateway_handle.abort();
    upstream_handle.abort();
    let _ = stdfs::remove_dir_all(home_dir);
}

#[tokio::test]
async fn openai_chat_routes_model_for_stream_and_non_stream_requests() {
    let captures = Arc::new(Mutex::new(Vec::<Value>::new()));
    let captures_for_route = Arc::clone(&captures);
    let upstream = Router::new().route(
        "/v1/chat/completions",
        post(move |AxumJson(payload): AxumJson<Value>| {
            let captures = Arc::clone(&captures_for_route);
            async move {
                record_payload(&captures, &payload);
                if payload
                    .get("stream")
                    .and_then(Value::as_bool)
                    .unwrap_or(false)
                {
                    Response::builder()
                        .status(StatusCode::OK)
                        .header(header::CONTENT_TYPE, "text/event-stream")
                        .body(Body::from(
                            "data: {\"id\":\"chatcmpl_route\",\"object\":\"chat.completion.chunk\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"ok\"},\"finish_reason\":null}]}\n\n\
data: {\"id\":\"chatcmpl_route\",\"object\":\"chat.completion.chunk\",\"choices\":[{\"index\":0,\"delta\":{},\"finish_reason\":\"stop\"}]}\n\n\
data: [DONE]\n\n",
                        ))
                        .expect("build stream response")
                } else {
                    Json(json!({
                        "id": "chatcmpl_route",
                        "object": "chat.completion",
                        "model": payload.get("model").cloned().unwrap_or(Value::Null),
                        "choices": [{
                            "index": 0,
                            "message": { "role": "assistant", "content": "ok" },
                            "finish_reason": "stop"
                        }]
                    }))
                    .into_response()
                }
            }
        }),
    );
    let (upstream_addr, upstream_handle) = spawn_router(upstream).await;

    let mut config = GatewayConfig::default();
    config.providers = vec![cc_gw_core::config::ProviderConfig {
        id: "mock-openai".to_string(),
        label: "Mock OpenAI".to_string(),
        base_url: format!("http://{upstream_addr}"),
        provider_type: Some("openai".to_string()),
        default_model: Some("glm-5.1".to_string()),
        models: vec![cc_gw_core::config::ProviderModelConfig {
            id: "glm-5.1".to_string(),
            label: Some("GLM 5.1".to_string()),
            ..Default::default()
        }],
        ..cc_gw_core::config::ProviderConfig::default()
    }];
    if let Some(openai_routing) = config.endpoint_routing.get_mut("openai") {
        openai_routing.model_routes.insert(
            "glm-5.1".to_string(),
            "mock-openai:maas-glm-5.1".to_string(),
        );
    }

    let (home_dir, gateway_addr, gateway_handle) =
        spawn_test_gateway(config, "openai-chat-route-stream-non-stream").await;
    let client = reqwest::Client::new();

    let stream_response = client
        .post(format!("http://{gateway_addr}/openai/v1/chat/completions"))
        .json(&json!({
            "model": "glm-5.1",
            "stream": true,
            "messages": [{ "role": "user", "content": "hello" }]
        }))
        .send()
        .await
        .expect("send stream chat request");
    assert_eq!(stream_response.status(), StatusCode::OK);
    let _ = stream_response
        .text()
        .await
        .expect("read stream chat response");

    let non_stream_response: Value = client
        .post(format!("http://{gateway_addr}/openai/v1/chat/completions"))
        .json(&json!({
            "model": "glm-5.1",
            "messages": [{ "role": "user", "content": "hello" }]
        }))
        .send()
        .await
        .expect("send non-stream chat request")
        .json()
        .await
        .expect("decode non-stream chat response");
    assert_eq!(non_stream_response["model"].as_str(), Some("maas-glm-5.1"));

    let captured = captures.lock().expect("lock captures");
    assert_eq!(captured.len(), 2);
    assert_eq!(captured[0]["model"].as_str(), Some("maas-glm-5.1"));
    assert_eq!(captured[0]["stream"].as_bool(), Some(true));
    assert_eq!(captured[1]["model"].as_str(), Some("maas-glm-5.1"));
    assert!(captured[1].get("stream").is_none());
    drop(captured);

    gateway_handle.abort();
    upstream_handle.abort();
    let _ = stdfs::remove_dir_all(home_dir);
}

#[tokio::test]
async fn openai_chat_non_stream_via_stream_materializes_response_when_model_enabled() {
    let captures = Arc::new(Mutex::new(Vec::<Value>::new()));
    let captures_for_route = Arc::clone(&captures);
    let upstream = Router::new().route(
        "/v1/chat/completions",
        post(move |AxumJson(payload): AxumJson<Value>| {
            let captures = Arc::clone(&captures_for_route);
            async move {
                record_payload(&captures, &payload);
                assert_eq!(payload["stream"].as_bool(), Some(true));
                Response::builder()
                    .status(StatusCode::OK)
                    .header(header::CONTENT_TYPE, "text/event-stream")
                    .body(Body::from(
                        "data: {\"id\":\"chatcmpl_via_stream\",\"object\":\"chat.completion.chunk\",\"created\":1700000000,\"model\":\"gpt-stream-only\",\"choices\":[{\"index\":0,\"delta\":{\"role\":\"assistant\",\"content\":\"hel\"},\"finish_reason\":null}]}\n\n\
data: {\"id\":\"chatcmpl_via_stream\",\"object\":\"chat.completion.chunk\",\"created\":1700000000,\"model\":\"gpt-stream-only\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"lo\"},\"finish_reason\":null}],\"usage\":{\"prompt_tokens\":3,\"completion_tokens\":2,\"total_tokens\":5}}\n\n\
data: {\"id\":\"chatcmpl_via_stream\",\"object\":\"chat.completion.chunk\",\"created\":1700000000,\"model\":\"gpt-stream-only\",\"choices\":[{\"index\":0,\"delta\":{},\"finish_reason\":\"stop\"}],\"usage\":{\"prompt_tokens\":3,\"completion_tokens\":2,\"total_tokens\":5}}\n\n\
data: [DONE]\n\n",
                    ))
                    .expect("build stream response")
            }
        }),
    );
    let (upstream_addr, upstream_handle) = spawn_router(upstream).await;

    let mut config = GatewayConfig::default();
    config.store_request_payloads = Some(true);
    config.store_response_payloads = Some(true);
    config.providers = vec![cc_gw_core::config::ProviderConfig {
        id: "mock-openai".to_string(),
        label: "Mock OpenAI".to_string(),
        base_url: format!("http://{upstream_addr}"),
        provider_type: Some("openai".to_string()),
        default_model: Some("gpt-stream-only".to_string()),
        models: vec![cc_gw_core::config::ProviderModelConfig {
            id: "gpt-stream-only".to_string(),
            label: Some("GPT Stream Only".to_string()),
            non_stream_via_stream: Some(true),
            ..Default::default()
        }],
        ..cc_gw_core::config::ProviderConfig::default()
    }];
    if let Some(openai_routing) = config.endpoint_routing.get_mut("openai") {
        openai_routing.defaults.completion = Some("mock-openai:gpt-stream-only".to_string());
    }

    let (home_dir, gateway_addr, gateway_handle) =
        spawn_test_gateway(config, "openai-chat-non-stream-via-stream").await;
    let client = reqwest::Client::new();

    let response = client
        .post(format!("http://{gateway_addr}/openai/v1/chat/completions"))
        .json(&json!({
            "model": "gpt-stream-only",
            "stream": false,
            "messages": [{ "role": "user", "content": "hello" }]
        }))
        .send()
        .await
        .expect("send non-stream request");
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        response
            .headers()
            .get(header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .map(|value| value.starts_with("application/json")),
        Some(true)
    );
    let response_json: Value = response.json().await.expect("decode materialized response");
    assert_eq!(
        response_json["choices"][0]["message"]["content"].as_str(),
        Some("hello")
    );
    assert_eq!(
        response_json["choices"][0]["finish_reason"].as_str(),
        Some("stop")
    );
    assert_eq!(response_json["usage"]["total_tokens"].as_u64(), Some(5));

    let captured = captures.lock().expect("lock captures");
    assert_eq!(captured.len(), 1);
    assert_eq!(captured[0]["model"].as_str(), Some("gpt-stream-only"));
    assert_eq!(captured[0]["stream"].as_bool(), Some(true));
    drop(captured);

    let logs: Value = client
        .get(format!("http://{gateway_addr}/api/logs?limit=1"))
        .send()
        .await
        .expect("request logs")
        .json()
        .await
        .expect("decode logs response");
    let item = logs["items"]
        .as_array()
        .and_then(|items| items.first())
        .expect("log item");
    assert_eq!(item["stream"].as_bool(), Some(false));
    assert_eq!(item["input_tokens"].as_i64(), Some(3));
    assert_eq!(item["output_tokens"].as_i64(), Some(2));

    let log_id = item["id"].as_i64().expect("log id");
    let detail: Value = client
        .get(format!("http://{gateway_addr}/api/logs/{log_id}"))
        .send()
        .await
        .expect("request log detail")
        .json()
        .await
        .expect("decode log detail");
    let payload = detail.get("payload").expect("payload object");
    let upstream_request_json: Value = serde_json::from_str(
        payload["upstream_request"]
            .as_str()
            .expect("upstream request payload"),
    )
    .expect("decode upstream request");
    assert_eq!(upstream_request_json["stream"].as_bool(), Some(true));

    let client_response_json: Value = serde_json::from_str(
        payload["client_response"]
            .as_str()
            .expect("client response payload"),
    )
    .expect("decode client response");
    assert_eq!(
        client_response_json["choices"][0]["message"]["content"].as_str(),
        Some("hello")
    );

    gateway_handle.abort();
    upstream_handle.abort();
    let _ = stdfs::remove_dir_all(home_dir);
}

#[tokio::test]
async fn openai_chat_non_stream_via_stream_surfaces_sse_error_event() {
    let upstream = Router::new().route(
        "/v1/chat/completions",
        post(|AxumJson(payload): AxumJson<Value>| async move {
            assert_eq!(payload["stream"].as_bool(), Some(true));
            Response::builder()
                .status(StatusCode::OK)
                .header(header::CONTENT_TYPE, "text/event-stream")
                .body(Body::from(
                    "data:{\"text\":\"[DONE]\",\"error\":{\"error_msg\":\"Inference request route failed, try again later or request other model\",\"error_code\":\"InferHub.002002001.429\"},\"error_code\":\"InferHub.002002001.429\",\"error_msg\":\"Inference request route failed, try again later or request other model\"}\n\n",
                ))
                .expect("build sse error response")
        }),
    );
    let (upstream_addr, upstream_handle) = spawn_router(upstream).await;

    let mut config = GatewayConfig::default();
    config.store_request_payloads = Some(true);
    config.store_response_payloads = Some(true);
    config.providers = vec![cc_gw_core::config::ProviderConfig {
        id: "mock-openai".to_string(),
        label: "Mock OpenAI".to_string(),
        base_url: format!("http://{upstream_addr}"),
        provider_type: Some("openai".to_string()),
        default_model: Some("gpt-stream-only".to_string()),
        models: vec![cc_gw_core::config::ProviderModelConfig {
            id: "gpt-stream-only".to_string(),
            label: Some("GPT Stream Only".to_string()),
            non_stream_via_stream: Some(true),
            ..Default::default()
        }],
        ..cc_gw_core::config::ProviderConfig::default()
    }];
    if let Some(openai_routing) = config.endpoint_routing.get_mut("openai") {
        openai_routing.defaults.completion = Some("mock-openai:gpt-stream-only".to_string());
    }

    let (home_dir, gateway_addr, gateway_handle) =
        spawn_test_gateway(config, "openai-chat-non-stream-via-stream-sse-error").await;
    let client = reqwest::Client::new();

    let response = client
        .post(format!("http://{gateway_addr}/openai/v1/chat/completions"))
        .json(&json!({
            "model": "gpt-stream-only",
            "stream": false,
            "messages": [{ "role": "user", "content": "hello" }]
        }))
        .send()
        .await
        .expect("send non-stream request");
    assert_eq!(response.status(), StatusCode::TOO_MANY_REQUESTS);
    let body: Value = response.json().await.expect("decode error response");
    assert_eq!(
        body["error"]["message"].as_str(),
        Some("Inference request route failed, try again later or request other model")
    );
    assert_eq!(
        body["error"]["code"].as_str(),
        Some("InferHub.002002001.429")
    );
    assert!(
        !serde_json::to_string(&body)
            .expect("serialize body")
            .contains("failed to decode upstream JSON")
    );

    let logs: Value = client
        .get(format!("http://{gateway_addr}/api/logs?limit=1"))
        .send()
        .await
        .expect("request logs")
        .json()
        .await
        .expect("decode logs response");
    let item = logs["items"]
        .as_array()
        .and_then(|items| items.first())
        .expect("log item");
    assert_eq!(item["status_code"].as_i64(), Some(429));

    let log_id = item["id"].as_i64().expect("log id");
    let detail: Value = client
        .get(format!("http://{gateway_addr}/api/logs/{log_id}"))
        .send()
        .await
        .expect("request log detail")
        .json()
        .await
        .expect("decode log detail");
    let payload = detail.get("payload").expect("payload object");
    assert!(
        payload["upstream_response"]
            .as_str()
            .is_some_and(|value| value.contains("data:{\"text\":\"[DONE]\""))
    );
    let client_response_json: Value = serde_json::from_str(
        payload["client_response"]
            .as_str()
            .expect("client response payload"),
    )
    .expect("decode client response payload");
    assert_eq!(
        client_response_json["error"]["message"].as_str(),
        Some("Inference request route failed, try again later or request other model")
    );

    gateway_handle.abort();
    upstream_handle.abort();
    let _ = stdfs::remove_dir_all(home_dir);
}

#[tokio::test]
async fn openai_chat_non_stream_via_stream_preserves_utf8_split_across_chunks() {
    let upstream = Router::new().route(
        "/v1/chat/completions",
        post(|AxumJson(payload): AxumJson<Value>| async move {
            assert_eq!(payload["stream"].as_bool(), Some(true));

            let first = "data: {\"id\":\"chatcmpl_utf8\",\"object\":\"chat.completion.chunk\",\"created\":1700000000,\"model\":\"gpt-stream-only\",\"choices\":[{\"index\":0,\"delta\":{\"role\":\"assistant\",\"content\":\""
                .as_bytes();
            let text = "你好".as_bytes();
            let second = "\"},\"finish_reason\":null}],\"usage\":{\"prompt_tokens\":3,\"completion_tokens\":2,\"total_tokens\":5}}\n\n\
data: {\"id\":\"chatcmpl_utf8\",\"object\":\"chat.completion.chunk\",\"created\":1700000000,\"model\":\"gpt-stream-only\",\"choices\":[{\"index\":0,\"delta\":{},\"finish_reason\":\"stop\"}],\"usage\":{\"prompt_tokens\":3,\"completion_tokens\":2,\"total_tokens\":5}}\n\n\
data: [DONE]\n\n"
                .as_bytes();

            let stream = stream! {
                let mut chunk = Vec::new();
                chunk.extend_from_slice(first);
                chunk.extend_from_slice(&text[..1]);
                yield Ok::<Bytes, std::convert::Infallible>(Bytes::from(chunk));

                let mut chunk = Vec::new();
                chunk.extend_from_slice(&text[1..]);
                chunk.extend_from_slice(second);
                yield Ok::<Bytes, std::convert::Infallible>(Bytes::from(chunk));
            };

            Response::builder()
                .status(StatusCode::OK)
                .header(header::CONTENT_TYPE, "text/event-stream")
                .body(Body::from_stream(stream))
                .expect("build split utf8 stream response")
        }),
    );
    let (upstream_addr, upstream_handle) = spawn_router(upstream).await;

    let mut config = GatewayConfig::default();
    config.providers = vec![cc_gw_core::config::ProviderConfig {
        id: "mock-openai".to_string(),
        label: "Mock OpenAI".to_string(),
        base_url: format!("http://{upstream_addr}"),
        provider_type: Some("openai".to_string()),
        default_model: Some("gpt-stream-only".to_string()),
        models: vec![cc_gw_core::config::ProviderModelConfig {
            id: "gpt-stream-only".to_string(),
            label: Some("GPT Stream Only".to_string()),
            non_stream_via_stream: Some(true),
            ..Default::default()
        }],
        ..cc_gw_core::config::ProviderConfig::default()
    }];
    if let Some(openai_routing) = config.endpoint_routing.get_mut("openai") {
        openai_routing.defaults.completion = Some("mock-openai:gpt-stream-only".to_string());
    }

    let (home_dir, gateway_addr, gateway_handle) =
        spawn_test_gateway(config, "openai-chat-non-stream-via-stream-utf8").await;
    let client = reqwest::Client::new();

    let response_json: Value = client
        .post(format!("http://{gateway_addr}/openai/v1/chat/completions"))
        .json(&json!({
            "model": "gpt-stream-only",
            "stream": false,
            "messages": [{ "role": "user", "content": "hello" }]
        }))
        .send()
        .await
        .expect("send split utf8 non-stream request")
        .json()
        .await
        .expect("decode split utf8 response");
    assert_eq!(
        response_json["choices"][0]["message"]["content"].as_str(),
        Some("你好")
    );

    gateway_handle.abort();
    upstream_handle.abort();
    let _ = stdfs::remove_dir_all(home_dir);
}

#[tokio::test]
async fn openai_chat_non_stream_via_stream_latency_includes_full_upstream_stream() {
    let upstream = Router::new().route(
        "/v1/chat/completions",
        post(|AxumJson(payload): AxumJson<Value>| async move {
            assert_eq!(payload["stream"].as_bool(), Some(true));
            let stream = stream! {
                yield Ok::<Bytes, std::convert::Infallible>(Bytes::from(
                    "data: {\"id\":\"chatcmpl_latency\",\"object\":\"chat.completion.chunk\",\"created\":1700000000,\"model\":\"gpt-stream-only\",\"choices\":[{\"index\":0,\"delta\":{\"role\":\"assistant\",\"content\":\"slow\"},\"finish_reason\":null}]}\n\n",
                ));
                sleep(Duration::from_millis(120)).await;
                yield Ok::<Bytes, std::convert::Infallible>(Bytes::from(
                    "data: {\"id\":\"chatcmpl_latency\",\"object\":\"chat.completion.chunk\",\"created\":1700000000,\"model\":\"gpt-stream-only\",\"choices\":[{\"index\":0,\"delta\":{},\"finish_reason\":\"stop\"}],\"usage\":{\"prompt_tokens\":3,\"completion_tokens\":2,\"total_tokens\":5}}\n\n\
data: [DONE]\n\n",
                ));
            };

            Response::builder()
                .status(StatusCode::OK)
                .header(header::CONTENT_TYPE, "text/event-stream")
                .body(Body::from_stream(stream))
                .expect("build slow stream response")
        }),
    );
    let (upstream_addr, upstream_handle) = spawn_router(upstream).await;

    let mut config = GatewayConfig::default();
    config.providers = vec![cc_gw_core::config::ProviderConfig {
        id: "mock-openai".to_string(),
        label: "Mock OpenAI".to_string(),
        base_url: format!("http://{upstream_addr}"),
        provider_type: Some("openai".to_string()),
        default_model: Some("gpt-stream-only".to_string()),
        models: vec![cc_gw_core::config::ProviderModelConfig {
            id: "gpt-stream-only".to_string(),
            label: Some("GPT Stream Only".to_string()),
            non_stream_via_stream: Some(true),
            ..Default::default()
        }],
        ..cc_gw_core::config::ProviderConfig::default()
    }];
    if let Some(openai_routing) = config.endpoint_routing.get_mut("openai") {
        openai_routing.defaults.completion = Some("mock-openai:gpt-stream-only".to_string());
    }

    let (home_dir, gateway_addr, gateway_handle) =
        spawn_test_gateway(config, "openai-chat-non-stream-via-stream-latency").await;
    let client = reqwest::Client::new();

    let response = client
        .post(format!("http://{gateway_addr}/openai/v1/chat/completions"))
        .json(&json!({
            "model": "gpt-stream-only",
            "stream": false,
            "messages": [{ "role": "user", "content": "hello" }]
        }))
        .send()
        .await
        .expect("send slow non-stream request");
    assert_eq!(response.status(), StatusCode::OK);
    let _: Value = response.json().await.expect("decode slow response");

    let logs: Value = client
        .get(format!("http://{gateway_addr}/api/logs?limit=1"))
        .send()
        .await
        .expect("request logs")
        .json()
        .await
        .expect("decode logs response");
    let item = logs["items"]
        .as_array()
        .and_then(|items| items.first())
        .expect("log item");
    assert!(
        item["latency_ms"].as_i64().unwrap_or_default() >= 100,
        "latency_ms should include delayed upstream stream, got {:?}",
        item["latency_ms"]
    );

    gateway_handle.abort();
    upstream_handle.abort();
    let _ = stdfs::remove_dir_all(home_dir);
}

#[tokio::test]
async fn anthropic_to_openai_non_stream_via_stream_materializes_and_converts_response() {
    let captures = Arc::new(Mutex::new(Vec::<Value>::new()));
    let captures_for_route = Arc::clone(&captures);
    let upstream = Router::new().route(
        "/v1/chat/completions",
        post(move |AxumJson(payload): AxumJson<Value>| {
            let captures = Arc::clone(&captures_for_route);
            async move {
                record_payload(&captures, &payload);
                assert_eq!(payload["stream"].as_bool(), Some(true));
                Response::builder()
                    .status(StatusCode::OK)
                    .header(header::CONTENT_TYPE, "text/event-stream")
                    .body(Body::from(
                        "data: {\"id\":\"chatcmpl_cross_via_stream\",\"object\":\"chat.completion.chunk\",\"created\":1700000000,\"model\":\"gpt-stream-only\",\"choices\":[{\"index\":0,\"delta\":{\"role\":\"assistant\",\"content\":\"cross\"},\"finish_reason\":null}]}\n\n\
data: {\"id\":\"chatcmpl_cross_via_stream\",\"object\":\"chat.completion.chunk\",\"created\":1700000000,\"model\":\"gpt-stream-only\",\"choices\":[{\"index\":0,\"delta\":{},\"finish_reason\":\"stop\"}],\"usage\":{\"prompt_tokens\":4,\"completion_tokens\":2,\"total_tokens\":6}}\n\n\
data: [DONE]\n\n",
                    ))
                    .expect("build stream response")
            }
        }),
    );
    let (upstream_addr, upstream_handle) = spawn_router(upstream).await;

    let mut config = GatewayConfig::default();
    config.providers = vec![cc_gw_core::config::ProviderConfig {
        id: "mock-openai".to_string(),
        label: "Mock OpenAI".to_string(),
        base_url: format!("http://{upstream_addr}"),
        provider_type: Some("openai".to_string()),
        default_model: Some("gpt-stream-only".to_string()),
        models: vec![cc_gw_core::config::ProviderModelConfig {
            id: "gpt-stream-only".to_string(),
            label: Some("GPT Stream Only".to_string()),
            non_stream_via_stream: Some(true),
            ..Default::default()
        }],
        ..cc_gw_core::config::ProviderConfig::default()
    }];
    if let Some(anthropic_routing) = config.endpoint_routing.get_mut("anthropic") {
        anthropic_routing.model_routes.insert(
            "claude-client".to_string(),
            "mock-openai:gpt-stream-only".to_string(),
        );
    }

    let (home_dir, gateway_addr, gateway_handle) =
        spawn_test_gateway(config, "anthropic-openai-non-stream-via-stream").await;
    let client = reqwest::Client::new();

    let response: Value = client
        .post(format!("http://{gateway_addr}/v1/messages"))
        .json(&json!({
            "model": "claude-client",
            "max_tokens": 64,
            "stream": false,
            "messages": [{ "role": "user", "content": "hello" }]
        }))
        .send()
        .await
        .expect("send anthropic non-stream request")
        .json()
        .await
        .expect("decode anthropic materialized response");

    assert_eq!(response["type"].as_str(), Some("message"));
    assert_eq!(response["model"].as_str(), Some("claude-client"));
    assert_eq!(response["content"][0]["text"].as_str(), Some("cross"));
    assert_eq!(response["usage"]["input_tokens"].as_u64(), Some(4));
    assert_eq!(response["usage"]["output_tokens"].as_u64(), Some(2));

    let captured = captures.lock().expect("lock captures");
    assert_eq!(captured.len(), 1);
    assert_eq!(captured[0]["model"].as_str(), Some("gpt-stream-only"));
    assert_eq!(captured[0]["stream"].as_bool(), Some(true));
    drop(captured);

    gateway_handle.abort();
    upstream_handle.abort();
    let _ = stdfs::remove_dir_all(home_dir);
}

#[tokio::test]
async fn anthropic_to_openai_non_stream_via_stream_surfaces_sse_error_event() {
    let upstream = Router::new().route(
        "/v1/chat/completions",
        post(|AxumJson(payload): AxumJson<Value>| async move {
            assert_eq!(payload["stream"].as_bool(), Some(true));
            Response::builder()
                .status(StatusCode::OK)
                .header(header::CONTENT_TYPE, "text/event-stream")
                .body(Body::from(
                    "data:{\"text\":\"[DONE]\",\"error\":{\"error_msg\":\"Inference request route failed, try again later or request other model\",\"error_code\":\"InferHub.002002001.429\"},\"error_code\":\"InferHub.002002001.429\",\"error_msg\":\"Inference request route failed, try again later or request other model\"}\n\n",
                ))
                .expect("build sse error response")
        }),
    );
    let (upstream_addr, upstream_handle) = spawn_router(upstream).await;

    let mut config = GatewayConfig::default();
    config.providers = vec![cc_gw_core::config::ProviderConfig {
        id: "mock-openai".to_string(),
        label: "Mock OpenAI".to_string(),
        base_url: format!("http://{upstream_addr}"),
        provider_type: Some("openai".to_string()),
        default_model: Some("glm-stream-only".to_string()),
        models: vec![cc_gw_core::config::ProviderModelConfig {
            id: "glm-stream-only".to_string(),
            label: Some("GLM Stream Only".to_string()),
            non_stream_via_stream: Some(true),
            ..Default::default()
        }],
        ..cc_gw_core::config::ProviderConfig::default()
    }];
    if let Some(anthropic_routing) = config.endpoint_routing.get_mut("anthropic") {
        anthropic_routing.model_routes.insert(
            "claude-sonnet-4-6".to_string(),
            "mock-openai:glm-stream-only".to_string(),
        );
    }

    let (home_dir, gateway_addr, gateway_handle) =
        spawn_test_gateway(config, "anthropic-openai-non-stream-via-stream-sse-error").await;
    let client = reqwest::Client::new();

    let response = client
        .post(format!("http://{gateway_addr}/v1/messages"))
        .json(&json!({
            "model": "claude-sonnet-4-6",
            "max_tokens": 64,
            "stream": false,
            "messages": [{ "role": "user", "content": "Bash touch ../auto-mode-test.txt" }]
        }))
        .send()
        .await
        .expect("send anthropic non-stream request");
    assert_eq!(response.status(), StatusCode::TOO_MANY_REQUESTS);
    let body: Value = response.json().await.expect("decode anthropic error");
    assert_eq!(body["type"].as_str(), Some("error"));
    assert_eq!(body["error"]["type"].as_str(), Some("api_error"));
    assert_eq!(
        body["error"]["message"].as_str(),
        Some("Inference request route failed, try again later or request other model")
    );
    assert!(
        !serde_json::to_string(&body)
            .expect("serialize body")
            .contains("failed to decode upstream JSON")
    );

    gateway_handle.abort();
    upstream_handle.abort();
    let _ = stdfs::remove_dir_all(home_dir);
}

#[tokio::test]
async fn claude_code_auto_mode_classifier_non_stream_via_stream_strips_thinking_blocks() {
    let captures = Arc::new(Mutex::new(Vec::<Value>::new()));
    let captures_for_route = Arc::clone(&captures);
    let upstream = Router::new().route(
        "/v1/chat/completions",
        post(move |AxumJson(payload): AxumJson<Value>| {
            let captures = Arc::clone(&captures_for_route);
            async move {
                record_payload(&captures, &payload);
                assert_eq!(payload["stream"].as_bool(), Some(true));
                Response::builder()
                    .status(StatusCode::OK)
                    .header(header::CONTENT_TYPE, "text/event-stream")
                    .body(Body::from(
                        "data: {\"id\":\"chatcmpl_classifier\",\"object\":\"chat.completion.chunk\",\"created\":1700000000,\"model\":\"glm-stream-only\",\"choices\":[{\"index\":0,\"delta\":{\"role\":\"assistant\",\"reasoning_content\":\"hidden reasoning \"},\"finish_reason\":null}]}\n\n\
data: {\"id\":\"chatcmpl_classifier\",\"object\":\"chat.completion.chunk\",\"created\":1700000000,\"model\":\"glm-stream-only\",\"choices\":[{\"index\":0,\"delta\":{\"reasoning_content\":\"must not leak\"},\"finish_reason\":null}]}\n\n\
data: {\"id\":\"chatcmpl_classifier\",\"object\":\"chat.completion.chunk\",\"created\":1700000000,\"model\":\"glm-stream-only\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"<block>no\"},\"finish_reason\":null}],\"usage\":{\"prompt_tokens\":10,\"completion_tokens\":1,\"total_tokens\":11}}\n\n\
data: {\"id\":\"chatcmpl_classifier\",\"object\":\"chat.completion.chunk\",\"created\":1700000000,\"model\":\"glm-stream-only\",\"choices\":[{\"index\":0,\"delta\":{},\"finish_reason\":\"stop\"}],\"usage\":{\"prompt_tokens\":10,\"completion_tokens\":1,\"total_tokens\":11}}\n\n\
data: [DONE]\n\n",
                    ))
                    .expect("build stream response")
            }
        }),
    );
    let (upstream_addr, upstream_handle) = spawn_router(upstream).await;

    let mut config = GatewayConfig::default();
    config.store_request_payloads = Some(true);
    config.store_response_payloads = Some(true);
    config.providers = vec![cc_gw_core::config::ProviderConfig {
        id: "mock-openai".to_string(),
        label: "Mock OpenAI".to_string(),
        base_url: format!("http://{upstream_addr}"),
        provider_type: Some("openai".to_string()),
        default_model: Some("glm-stream-only".to_string()),
        models: vec![cc_gw_core::config::ProviderModelConfig {
            id: "glm-stream-only".to_string(),
            label: Some("GLM Stream Only".to_string()),
            non_stream_via_stream: Some(true),
            ..Default::default()
        }],
        ..cc_gw_core::config::ProviderConfig::default()
    }];
    if let Some(anthropic_routing) = config.endpoint_routing.get_mut("anthropic") {
        anthropic_routing.model_routes.insert(
            "claude-sonnet-4-6".to_string(),
            "mock-openai:glm-stream-only".to_string(),
        );
    }

    let (home_dir, gateway_addr, gateway_handle) =
        spawn_test_gateway(config, "claude-code-classifier-non-stream-via-stream").await;
    let client = reqwest::Client::new();

    let response: Value = client
        .post(format!("http://{gateway_addr}/v1/messages"))
        .json(&json!({
            "model": "claude-sonnet-4-6",
            "max_tokens": 64,
            "stream": false,
            "thinking": { "type": "disabled" },
            "stop_sequences": ["</block>"],
            "system": [{
                "type": "text",
                "text": "You are a security monitor for autonomous AI coding agents."
            }],
            "messages": [{ "role": "user", "content": "Bash touch ../auto-mode-test.txt" }]
        }))
        .send()
        .await
        .expect("send classifier request")
        .json()
        .await
        .expect("decode classifier response");

    assert_eq!(response["type"].as_str(), Some("message"));
    assert_eq!(response["model"].as_str(), Some("claude-sonnet-4-6"));
    let content = response["content"].as_array().expect("content blocks");
    assert_eq!(content.len(), 1);
    assert_eq!(content[0]["type"].as_str(), Some("text"));
    assert_eq!(content[0]["text"].as_str(), Some("<block>no"));
    assert!(
        !serde_json::to_string(&response)
            .expect("serialize response")
            .contains("hidden reasoning")
    );

    let captured = captures.lock().expect("lock captures");
    assert_eq!(captured.len(), 1);
    assert_eq!(captured[0]["model"].as_str(), Some("glm-stream-only"));
    assert_eq!(captured[0]["stream"].as_bool(), Some(true));
    assert_eq!(
        captured[0]["max_completion_tokens"].as_u64(),
        Some(64),
        "thinking disabled requests still use the existing Anthropic-to-OpenAI token mapping"
    );
    drop(captured);

    let logs: Value = client
        .get(format!("http://{gateway_addr}/api/logs?limit=1"))
        .send()
        .await
        .expect("request logs")
        .json()
        .await
        .expect("decode logs response");
    let item = logs["items"]
        .as_array()
        .and_then(|items| items.first())
        .expect("log item");
    assert_eq!(item["stream"].as_bool(), Some(false));

    let log_id = item["id"].as_i64().expect("log id");
    let detail: Value = client
        .get(format!("http://{gateway_addr}/api/logs/{log_id}"))
        .send()
        .await
        .expect("request log detail")
        .json()
        .await
        .expect("decode log detail");
    let payload = detail.get("payload").expect("payload object");
    let upstream_request_json: Value = serde_json::from_str(
        payload["upstream_request"]
            .as_str()
            .expect("upstream request payload"),
    )
    .expect("decode upstream request");
    assert_eq!(upstream_request_json["stream"].as_bool(), Some(true));

    let client_response_json: Value = serde_json::from_str(
        payload["client_response"]
            .as_str()
            .expect("client response payload"),
    )
    .expect("decode client response");
    assert_eq!(client_response_json["content"].as_array().unwrap().len(), 1);
    assert_eq!(
        client_response_json["content"][0]["text"].as_str(),
        Some("<block>no")
    );

    gateway_handle.abort();
    upstream_handle.abort();
    let _ = stdfs::remove_dir_all(home_dir);
}

#[tokio::test]
async fn claude_code_auto_mode_classifier_does_not_fallback_to_reasoning_text() {
    let upstream = Router::new().route(
        "/v1/chat/completions",
        post(|AxumJson(payload): AxumJson<Value>| async move {
            assert_eq!(payload["stream"].as_bool(), Some(true));
            Response::builder()
                .status(StatusCode::OK)
                .header(header::CONTENT_TYPE, "text/event-stream")
                .body(Body::from(
                    "data: {\"id\":\"chatcmpl_classifier\",\"object\":\"chat.completion.chunk\",\"created\":1700000000,\"model\":\"glm-stream-only\",\"choices\":[{\"index\":0,\"delta\":{\"role\":\"assistant\",\"reasoning_content\":\"classifier scratchpad\"},\"finish_reason\":null}]}\n\n\
data: {\"id\":\"chatcmpl_classifier\",\"object\":\"chat.completion.chunk\",\"created\":1700000000,\"model\":\"glm-stream-only\",\"choices\":[{\"index\":0,\"delta\":{},\"finish_reason\":\"stop\"}]}\n\n\
data: [DONE]\n\n",
                ))
                .expect("build stream response")
        }),
    );
    let (upstream_addr, upstream_handle) = spawn_router(upstream).await;

    let mut config = GatewayConfig::default();
    config.providers = vec![cc_gw_core::config::ProviderConfig {
        id: "mock-openai".to_string(),
        label: "Mock OpenAI".to_string(),
        base_url: format!("http://{upstream_addr}"),
        provider_type: Some("openai".to_string()),
        default_model: Some("glm-stream-only".to_string()),
        models: vec![cc_gw_core::config::ProviderModelConfig {
            id: "glm-stream-only".to_string(),
            label: Some("GLM Stream Only".to_string()),
            non_stream_via_stream: Some(true),
            ..Default::default()
        }],
        ..cc_gw_core::config::ProviderConfig::default()
    }];
    if let Some(anthropic_routing) = config.endpoint_routing.get_mut("anthropic") {
        anthropic_routing.model_routes.insert(
            "claude-sonnet-4-6".to_string(),
            "mock-openai:glm-stream-only".to_string(),
        );
    }

    let (home_dir, gateway_addr, gateway_handle) =
        spawn_test_gateway(config, "claude-code-classifier-no-reasoning-fallback").await;
    let client = reqwest::Client::new();

    let response: Value = client
        .post(format!("http://{gateway_addr}/v1/messages"))
        .json(&json!({
            "model": "claude-sonnet-4-6",
            "max_tokens": 64,
            "stream": false,
            "thinking": { "type": "disabled" },
            "stop_sequences": ["</block>"],
            "system": [{
                "type": "text",
                "text": "You are a security monitor for autonomous AI coding agents."
            }],
            "messages": [{ "role": "user", "content": "Bash touch ../auto-mode-test.txt" }]
        }))
        .send()
        .await
        .expect("send classifier request")
        .json()
        .await
        .expect("decode classifier response");

    assert_eq!(response["type"].as_str(), Some("message"));
    assert_eq!(response["content"].as_array().map(Vec::len), Some(0));
    assert!(
        !serde_json::to_string(&response)
            .expect("serialize response")
            .contains("classifier scratchpad")
    );

    gateway_handle.abort();
    upstream_handle.abort();
    let _ = stdfs::remove_dir_all(home_dir);
}

#[tokio::test]
async fn anthropic_openai_chat_without_thinking_strips_reasoning_content() {
    let upstream = Router::new().route(
        "/v1/chat/completions",
        post(|AxumJson(payload): AxumJson<Value>| async move {
            assert_eq!(payload["model"].as_str(), Some("glm-test"));
            Response::builder()
                .status(StatusCode::OK)
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    json!({
                        "id": "chatcmpl_reasoning",
                        "object": "chat.completion",
                        "created": 1700000000,
                        "model": "glm-test",
                        "choices": [{
                            "index": 0,
                            "finish_reason": null,
                            "message": {
                                "role": "assistant",
                                "reasoning_content": "hidden reasoning",
                                "content": "正在生成 HTML 页面。"
                            }
                        }],
                        "usage": {
                            "prompt_tokens": 12,
                            "completion_tokens": 3,
                            "total_tokens": 15
                        }
                    })
                    .to_string(),
                ))
                .expect("build upstream response")
        }),
    );
    let (upstream_addr, upstream_handle) = spawn_router(upstream).await;

    let mut config = GatewayConfig::default();
    config.providers = vec![cc_gw_core::config::ProviderConfig {
        id: "mock-openai".to_string(),
        label: "Mock OpenAI".to_string(),
        base_url: format!("http://{upstream_addr}"),
        provider_type: Some("openai".to_string()),
        default_model: Some("glm-test".to_string()),
        models: vec![cc_gw_core::config::ProviderModelConfig {
            id: "glm-test".to_string(),
            label: Some("GLM Test".to_string()),
            ..Default::default()
        }],
        ..cc_gw_core::config::ProviderConfig::default()
    }];
    if let Some(anthropic_routing) = config.endpoint_routing.get_mut("anthropic") {
        anthropic_routing.model_routes.insert(
            "claude-sonnet-4-6".to_string(),
            "mock-openai:glm-test".to_string(),
        );
    }

    let (home_dir, gateway_addr, gateway_handle) =
        spawn_test_gateway(config, "anthropic-openai-chat-strip-reasoning").await;
    let client = reqwest::Client::new();

    let response: Value = client
        .post(format!("http://{gateway_addr}/v1/messages"))
        .json(&json!({
            "model": "claude-sonnet-4-6",
            "max_tokens": 128,
            "messages": [{ "role": "user", "content": "create the html" }]
        }))
        .send()
        .await
        .expect("send anthropic request")
        .json()
        .await
        .expect("decode response");

    let content = response["content"].as_array().expect("content blocks");
    assert_eq!(content.len(), 1);
    assert_eq!(content[0]["type"].as_str(), Some("text"));
    assert_eq!(content[0]["text"].as_str(), Some("正在生成 HTML 页面。"));
    assert_eq!(response["stop_reason"].as_str(), Some("end_turn"));
    assert!(
        !serde_json::to_string(&response)
            .expect("serialize response")
            .contains("hidden reasoning")
    );

    gateway_handle.abort();
    upstream_handle.abort();
    let _ = stdfs::remove_dir_all(home_dir);
}

#[tokio::test]
async fn anthropic_openai_chat_without_thinking_falls_back_when_only_reasoning_content_remains() {
    let upstream = Router::new().route(
        "/v1/chat/completions",
        post(|| async {
            Response::builder()
                .status(StatusCode::OK)
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    json!({
                        "id": "chatcmpl_reasoning_only",
                        "object": "chat.completion",
                        "created": 1700000000,
                        "model": "glm-test",
                        "choices": [{
                            "index": 0,
                            "finish_reason": null,
                            "message": {
                                "role": "assistant",
                                "reasoning_content": "I should create the HTML file now."
                            }
                        }],
                        "usage": {
                            "prompt_tokens": 0,
                            "completion_tokens": 0,
                            "total_tokens": 0
                        }
                    })
                    .to_string(),
                ))
                .expect("build upstream response")
        }),
    );
    let (upstream_addr, upstream_handle) = spawn_router(upstream).await;

    let mut config = GatewayConfig::default();
    config.providers = vec![cc_gw_core::config::ProviderConfig {
        id: "mock-openai".to_string(),
        label: "Mock OpenAI".to_string(),
        base_url: format!("http://{upstream_addr}"),
        provider_type: Some("openai".to_string()),
        default_model: Some("glm-test".to_string()),
        models: vec![cc_gw_core::config::ProviderModelConfig {
            id: "glm-test".to_string(),
            label: Some("GLM Test".to_string()),
            ..Default::default()
        }],
        ..cc_gw_core::config::ProviderConfig::default()
    }];
    if let Some(anthropic_routing) = config.endpoint_routing.get_mut("anthropic") {
        anthropic_routing.model_routes.insert(
            "claude-sonnet-4-6".to_string(),
            "mock-openai:glm-test".to_string(),
        );
    }

    let (home_dir, gateway_addr, gateway_handle) =
        spawn_test_gateway(config, "anthropic-openai-chat-reasoning-only-fallback").await;
    let client = reqwest::Client::new();

    let response: Value = client
        .post(format!("http://{gateway_addr}/v1/messages"))
        .json(&json!({
            "model": "claude-sonnet-4-6",
            "max_tokens": 128,
            "messages": [{ "role": "user", "content": "create the html" }]
        }))
        .send()
        .await
        .expect("send anthropic request")
        .json()
        .await
        .expect("decode response");

    let content = response["content"].as_array().expect("content blocks");
    assert_eq!(content.len(), 1);
    assert_eq!(content[0]["type"].as_str(), Some("text"));
    assert_eq!(
        content[0]["text"].as_str(),
        Some("I should create the HTML file now.")
    );
    assert_eq!(response["stop_reason"].as_str(), Some("end_turn"));

    gateway_handle.abort();
    upstream_handle.abort();
    let _ = stdfs::remove_dir_all(home_dir);
}

#[tokio::test]
async fn anthropic_openai_chat_non_stream_via_stream_without_thinking_strips_reasoning_content() {
    let upstream = Router::new().route(
        "/v1/chat/completions",
        post(|AxumJson(payload): AxumJson<Value>| async move {
            assert_eq!(payload["stream"].as_bool(), Some(true));
            Response::builder()
                .status(StatusCode::OK)
                .header(header::CONTENT_TYPE, "text/event-stream")
                .body(Body::from(
                    "data: {\"id\":\"chatcmpl_reasoning\",\"object\":\"chat.completion.chunk\",\"created\":1700000000,\"model\":\"glm-stream-only\",\"choices\":[{\"index\":0,\"delta\":{\"role\":\"assistant\",\"reasoning_content\":\"hidden stream reasoning\"},\"finish_reason\":null}]}\n\n\
data: {\"id\":\"chatcmpl_reasoning\",\"object\":\"chat.completion.chunk\",\"created\":1700000000,\"model\":\"glm-stream-only\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"正在生成 HTML 页面。\"},\"finish_reason\":null}],\"usage\":{\"prompt_tokens\":12,\"completion_tokens\":3,\"total_tokens\":15}}\n\n\
data: {\"id\":\"chatcmpl_reasoning\",\"object\":\"chat.completion.chunk\",\"created\":1700000000,\"model\":\"glm-stream-only\",\"choices\":[{\"index\":0,\"delta\":{},\"finish_reason\":\"stop\"}]}\n\n\
data: [DONE]\n\n",
                ))
                .expect("build upstream stream")
        }),
    );
    let (upstream_addr, upstream_handle) = spawn_router(upstream).await;

    let mut config = GatewayConfig::default();
    config.providers = vec![cc_gw_core::config::ProviderConfig {
        id: "mock-openai".to_string(),
        label: "Mock OpenAI".to_string(),
        base_url: format!("http://{upstream_addr}"),
        provider_type: Some("openai".to_string()),
        default_model: Some("glm-stream-only".to_string()),
        models: vec![cc_gw_core::config::ProviderModelConfig {
            id: "glm-stream-only".to_string(),
            label: Some("GLM Stream Only".to_string()),
            non_stream_via_stream: Some(true),
            ..Default::default()
        }],
        ..cc_gw_core::config::ProviderConfig::default()
    }];
    if let Some(anthropic_routing) = config.endpoint_routing.get_mut("anthropic") {
        anthropic_routing.model_routes.insert(
            "claude-sonnet-4-6".to_string(),
            "mock-openai:glm-stream-only".to_string(),
        );
    }

    let (home_dir, gateway_addr, gateway_handle) =
        spawn_test_gateway(config, "anthropic-openai-chat-materialized-strip-reasoning").await;
    let client = reqwest::Client::new();

    let response: Value = client
        .post(format!("http://{gateway_addr}/v1/messages"))
        .json(&json!({
            "model": "claude-sonnet-4-6",
            "max_tokens": 128,
            "stream": false,
            "messages": [{ "role": "user", "content": "create the html" }]
        }))
        .send()
        .await
        .expect("send anthropic request")
        .json()
        .await
        .expect("decode response");

    let content = response["content"].as_array().expect("content blocks");
    assert_eq!(content.len(), 1);
    assert_eq!(content[0]["type"].as_str(), Some("text"));
    assert_eq!(content[0]["text"].as_str(), Some("正在生成 HTML 页面。"));
    assert!(
        !serde_json::to_string(&response)
            .expect("serialize response")
            .contains("hidden stream reasoning")
    );

    gateway_handle.abort();
    upstream_handle.abort();
    let _ = stdfs::remove_dir_all(home_dir);
}

#[tokio::test]
async fn anthropic_openai_chat_non_stream_via_stream_without_thinking_falls_back_when_only_reasoning_content_remains()
 {
    let upstream = Router::new().route(
        "/v1/chat/completions",
        post(|AxumJson(payload): AxumJson<Value>| async move {
            assert_eq!(payload["stream"].as_bool(), Some(true));
            Response::builder()
                .status(StatusCode::OK)
                .header(header::CONTENT_TYPE, "text/event-stream")
                .body(Body::from(
                    "data: {\"id\":\"chatcmpl_reasoning_only\",\"object\":\"chat.completion.chunk\",\"created\":1700000000,\"model\":\"glm-stream-only\",\"choices\":[{\"index\":0,\"delta\":{\"role\":\"assistant\",\"reasoning_content\":\"I should create the HTML file now.\"},\"finish_reason\":null}]}\n\n\
data: {\"id\":\"chatcmpl_reasoning_only\",\"object\":\"chat.completion.chunk\",\"created\":1700000000,\"model\":\"glm-stream-only\",\"choices\":[{\"index\":0,\"delta\":{},\"finish_reason\":\"stop\"}],\"usage\":{\"prompt_tokens\":0,\"completion_tokens\":0,\"total_tokens\":0}}\n\n\
data: [DONE]\n\n",
                ))
                .expect("build upstream stream")
        }),
    );
    let (upstream_addr, upstream_handle) = spawn_router(upstream).await;

    let mut config = GatewayConfig::default();
    config.providers = vec![cc_gw_core::config::ProviderConfig {
        id: "mock-openai".to_string(),
        label: "Mock OpenAI".to_string(),
        base_url: format!("http://{upstream_addr}"),
        provider_type: Some("openai".to_string()),
        default_model: Some("glm-stream-only".to_string()),
        models: vec![cc_gw_core::config::ProviderModelConfig {
            id: "glm-stream-only".to_string(),
            label: Some("GLM Stream Only".to_string()),
            non_stream_via_stream: Some(true),
            ..Default::default()
        }],
        ..cc_gw_core::config::ProviderConfig::default()
    }];
    if let Some(anthropic_routing) = config.endpoint_routing.get_mut("anthropic") {
        anthropic_routing.model_routes.insert(
            "claude-sonnet-4-6".to_string(),
            "mock-openai:glm-stream-only".to_string(),
        );
    }

    let (home_dir, gateway_addr, gateway_handle) = spawn_test_gateway(
        config,
        "anthropic-openai-chat-materialized-reasoning-only-fallback",
    )
    .await;
    let client = reqwest::Client::new();

    let response: Value = client
        .post(format!("http://{gateway_addr}/v1/messages"))
        .json(&json!({
            "model": "claude-sonnet-4-6",
            "max_tokens": 128,
            "stream": false,
            "messages": [{ "role": "user", "content": "create the html" }]
        }))
        .send()
        .await
        .expect("send anthropic request")
        .json()
        .await
        .expect("decode response");

    let content = response["content"].as_array().expect("content blocks");
    assert_eq!(content.len(), 1);
    assert_eq!(content[0]["type"].as_str(), Some("text"));
    assert_eq!(
        content[0]["text"].as_str(),
        Some("I should create the HTML file now.")
    );

    gateway_handle.abort();
    upstream_handle.abort();
    let _ = stdfs::remove_dir_all(home_dir);
}

#[tokio::test]
async fn anthropic_openai_chat_with_thinking_preserves_reasoning_content() {
    let upstream = Router::new().route(
        "/v1/chat/completions",
        post(|| async {
            Response::builder()
                .status(StatusCode::OK)
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    json!({
                        "id": "chatcmpl_reasoning",
                        "object": "chat.completion",
                        "created": 1700000000,
                        "model": "glm-test",
                        "choices": [{
                            "index": 0,
                            "finish_reason": "stop",
                            "message": {
                                "role": "assistant",
                                "reasoning_content": "visible reasoning",
                                "content": "done"
                            }
                        }],
                        "usage": {
                            "prompt_tokens": 12,
                            "completion_tokens": 3,
                            "total_tokens": 15
                        }
                    })
                    .to_string(),
                ))
                .expect("build upstream response")
        }),
    );
    let (upstream_addr, upstream_handle) = spawn_router(upstream).await;

    let mut config = GatewayConfig::default();
    config.providers = vec![cc_gw_core::config::ProviderConfig {
        id: "mock-openai".to_string(),
        label: "Mock OpenAI".to_string(),
        base_url: format!("http://{upstream_addr}"),
        provider_type: Some("openai".to_string()),
        default_model: Some("glm-test".to_string()),
        models: vec![cc_gw_core::config::ProviderModelConfig {
            id: "glm-test".to_string(),
            label: Some("GLM Test".to_string()),
            ..Default::default()
        }],
        ..cc_gw_core::config::ProviderConfig::default()
    }];
    if let Some(anthropic_routing) = config.endpoint_routing.get_mut("anthropic") {
        anthropic_routing.model_routes.insert(
            "claude-sonnet-4-6".to_string(),
            "mock-openai:glm-test".to_string(),
        );
    }

    let (home_dir, gateway_addr, gateway_handle) =
        spawn_test_gateway(config, "anthropic-openai-chat-preserve-reasoning").await;
    let client = reqwest::Client::new();

    let response: Value = client
        .post(format!("http://{gateway_addr}/v1/messages"))
        .json(&json!({
            "model": "claude-sonnet-4-6",
            "max_tokens": 128,
            "thinking": { "type": "enabled", "budget_tokens": 1024 },
            "messages": [{ "role": "user", "content": "create the html" }]
        }))
        .send()
        .await
        .expect("send anthropic request")
        .json()
        .await
        .expect("decode response");

    let content = response["content"].as_array().expect("content blocks");
    assert!(
        content
            .iter()
            .any(|block| block["type"].as_str() == Some("thinking")
                && block["thinking"].as_str() == Some("visible reasoning"))
    );
    assert!(
        content
            .iter()
            .any(|block| block["type"].as_str() == Some("text")
                && block["text"].as_str() == Some("done"))
    );

    gateway_handle.abort();
    upstream_handle.abort();
    let _ = stdfs::remove_dir_all(home_dir);
}

#[tokio::test]
async fn openai_responses_non_stream_routes_unregistered_target_model() {
    let captures = Arc::new(Mutex::new(Vec::<Value>::new()));
    let captures_for_route = Arc::clone(&captures);
    let upstream = Router::new().route(
        "/v1/responses",
        post(move |AxumJson(payload): AxumJson<Value>| {
            let captures = Arc::clone(&captures_for_route);
            async move {
                record_payload(&captures, &payload);
                Json(json!({
                    "id": "resp_route",
                    "object": "response",
                    "status": "completed",
                    "model": payload.get("model").cloned().unwrap_or(Value::Null),
                    "output_text": "routed",
                    "output": [{
                        "type": "message",
                        "role": "assistant",
                        "content": [{ "type": "output_text", "text": "routed" }]
                    }],
                    "usage": {
                        "input_tokens": 3,
                        "output_tokens": 1,
                        "total_tokens": 4
                    }
                }))
            }
        }),
    );
    let (upstream_addr, upstream_handle) = spawn_router(upstream).await;

    let mut config = GatewayConfig::default();
    config.providers = vec![cc_gw_core::config::ProviderConfig {
        id: "mock-openai-responses".to_string(),
        label: "Mock OpenAI Responses".to_string(),
        base_url: format!("http://{upstream_addr}"),
        provider_type: Some("openai-responses".to_string()),
        ..cc_gw_core::config::ProviderConfig::default()
    }];
    if let Some(openai_routing) = config.endpoint_routing.get_mut("openai") {
        openai_routing.model_routes.insert(
            "client-model-a".to_string(),
            "mock-openai-responses:upstream-model-b".to_string(),
        );
    }

    let (home_dir, gateway_addr, gateway_handle) =
        spawn_test_gateway(config, "openai-responses-route-model-rewrite").await;
    let client = reqwest::Client::new();

    let response: Value = client
        .post(format!("http://{gateway_addr}/openai/v1/responses"))
        .json(&json!({
            "model": "client-model-a",
            "stream": false,
            "input": "hello"
        }))
        .send()
        .await
        .expect("send non-stream responses request")
        .json()
        .await
        .expect("decode responses response");

    assert_eq!(response["model"].as_str(), Some("upstream-model-b"));

    let captured = captures.lock().expect("lock captures");
    assert_eq!(captured.len(), 1);
    assert_eq!(captured[0]["model"].as_str(), Some("upstream-model-b"));
    assert_eq!(captured[0]["stream"].as_bool(), Some(false));
    drop(captured);

    gateway_handle.abort();
    upstream_handle.abort();
    let _ = stdfs::remove_dir_all(home_dir);
}

#[tokio::test]
async fn anthropic_endpoint_accepts_bearer_auth_for_gateway_api_keys() {
    let upstream = Router::new().route("/v1/messages", post(mock_anthropic_test));
    let (upstream_addr, upstream_handle) = spawn_router(upstream).await;

    let mut config = GatewayConfig::default();
    config.providers = vec![cc_gw_core::config::ProviderConfig {
        id: "mock-anthropic".to_string(),
        label: "Mock Anthropic".to_string(),
        base_url: format!("http://{upstream_addr}"),
        provider_type: Some("anthropic".to_string()),
        default_model: Some("claude-test".to_string()),
        models: vec![cc_gw_core::config::ProviderModelConfig {
            id: "claude-test".to_string(),
            label: Some("Claude Test".to_string()),
            ..Default::default()
        }],
        ..cc_gw_core::config::ProviderConfig::default()
    }];
    config.defaults.completion = Some("claude-test".to_string());
    if let Some(anthropic) = config.endpoint_routing.get_mut("anthropic") {
        anthropic.defaults.completion = Some("claude-test".to_string());
    }

    let (home_dir, gateway_addr, gateway_handle) =
        spawn_test_gateway(config, "anthropic-bearer-auth").await;
    let client = reqwest::Client::new();

    let created_key: Value = client
        .post(format!("http://{gateway_addr}/api/keys"))
        .json(&json!({ "name": "anthropic-bearer" }))
        .send()
        .await
        .expect("create api key")
        .json()
        .await
        .expect("decode created api key");
    let api_key = created_key
        .get("key")
        .and_then(Value::as_str)
        .expect("created key");

    let response = client
        .post(format!("http://{gateway_addr}/v1/messages"))
        .header("authorization", format!("Bearer {api_key}"))
        .json(&json!({
            "model": "claude-test",
            "max_tokens": 64,
            "messages": [{
                "role": "user",
                "content": [{ "type": "text", "text": "hello" }]
            }]
        }))
        .send()
        .await
        .expect("send bearer-auth anthropic request");
    assert_eq!(response.status(), StatusCode::OK);

    gateway_handle.abort();
    upstream_handle.abort();
    let _ = stdfs::remove_dir_all(home_dir);
}

#[tokio::test]
async fn anthropic_count_tokens_accounts_for_schema_keys_and_structure() {
    let config = GatewayConfig::default();
    let (home_dir, gateway_addr, gateway_handle) =
        spawn_test_gateway(config, "anthropic-count-tokens-schema-keys").await;
    let client = reqwest::Client::new();

    let base_request = json!({
        "model": "claude-client",
        "messages": [{ "role": "user", "content": "hello" }]
    });
    let tool_request = json!({
        "model": "claude-client",
        "messages": [{ "role": "user", "content": "hello" }],
        "tools": [{
            "name": "Write",
            "description": "Write text to a file.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "file_path": {
                        "type": "string",
                        "description": "The path where the file should be written."
                    },
                    "content": {
                        "type": "string",
                        "description": "The full file content."
                    }
                },
                "required": ["file_path", "content"]
            }
        }]
    });

    let base_response: Value = client
        .post(format!("http://{gateway_addr}/v1/messages/count_tokens"))
        .json(&base_request)
        .send()
        .await
        .expect("send base count_tokens request")
        .json()
        .await
        .expect("decode base count_tokens response");
    let tool_response: Value = client
        .post(format!("http://{gateway_addr}/v1/messages/count_tokens"))
        .json(&tool_request)
        .send()
        .await
        .expect("send tool count_tokens request")
        .json()
        .await
        .expect("decode tool count_tokens response");

    let base_tokens = base_response["input_tokens"]
        .as_u64()
        .expect("base token estimate");
    let tool_tokens = tool_response["input_tokens"]
        .as_u64()
        .expect("tool token estimate");
    assert!(
        tool_tokens > base_tokens + 50,
        "tool schema keys and structure should materially increase token estimate: base={base_tokens}, tool={tool_tokens}"
    );

    gateway_handle.abort();
    let _ = stdfs::remove_dir_all(home_dir);
}

#[tokio::test]
async fn api_version_check_reports_update_state_from_registry() {
    let current_version = env!("CARGO_PKG_VERSION");
    let latest_version = "999.0.0";
    let registry = Router::new().fallback(get(move || async move {
        Json(json!({
            "dist-tags": {
                "latest": latest_version
            },
            "time": {
                latest_version: "2026-03-30T03:45:32.000Z"
            }
        }))
    }));
    let (registry_addr, registry_handle) = spawn_router(registry).await;

    let paths = test_paths("version-check");
    initialize_database(&paths.db_path).expect("init db");
    let mut state = build_test_state(GatewayConfig::default(), paths.clone(), None);
    state.version_check_registry_base_url = format!("http://{registry_addr}");

    let (gateway_addr, gateway_handle) = spawn_router(build_router(state)).await;
    let client = reqwest::Client::new();

    let response: Value = client
        .get(format!("http://{gateway_addr}/api/version/check"))
        .send()
        .await
        .expect("request version check")
        .json()
        .await
        .expect("decode version check");

    assert_eq!(
        response.get("currentVersion").and_then(Value::as_str),
        Some(current_version)
    );
    assert_eq!(
        response.get("latestVersion").and_then(Value::as_str),
        Some(latest_version)
    );
    // Channel reflects the running build's prerelease identifier (e.g. a
    // 0.9.0-beta.0 build reports "beta"); assert the derived value rather than
    // a hardcoded "latest" so the test holds across release/ prerelease builds.
    let expected_channel = admin_routes::update_channel_for_version(current_version);
    assert_eq!(
        response.get("channel").and_then(Value::as_str),
        Some(expected_channel.as_str())
    );
    assert_eq!(
        response.get("updateAvailable").and_then(Value::as_bool),
        Some(true)
    );
    assert_eq!(
        response.get("publishedAt").and_then(Value::as_str),
        Some("2026-03-30T03:45:32.000Z")
    );

    gateway_handle.abort();
    registry_handle.abort();
    let _ = stdfs::remove_dir_all(paths.home_dir);
}

#[tokio::test]
async fn openai_responses_stream_from_anthropic_provider_emits_richer_events() {
    let upstream = Router::new().route("/v1/messages", post(mock_anthropic_stream));
    let (upstream_addr, upstream_handle) = spawn_router(upstream).await;

    let mut config = GatewayConfig::default();
    config.providers = vec![cc_gw_core::config::ProviderConfig {
        id: "mock-anthropic".to_string(),
        label: "Mock Anthropic".to_string(),
        base_url: format!("http://{upstream_addr}"),
        provider_type: Some("anthropic".to_string()),
        default_model: Some("claude-test".to_string()),
        models: vec![cc_gw_core::config::ProviderModelConfig {
            id: "claude-test".to_string(),
            label: Some("Claude Test".to_string()),
            ..Default::default()
        }],
        ..cc_gw_core::config::ProviderConfig::default()
    }];
    config.defaults.completion = Some("claude-test".to_string());
    if let Some(openai_routing) = config.endpoint_routing.get_mut("openai") {
        openai_routing.defaults.completion = Some("claude-test".to_string());
    }

    let (home_dir, gateway_addr, gateway_handle) =
        spawn_test_gateway(config, "responses-stream").await;
    let client = reqwest::Client::new();

    let body = client
        .post(format!("http://{gateway_addr}/openai/v1/responses"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(
            json!({
                "model": "claude-test",
                "stream": true,
                "input": "hello"
            })
            .to_string(),
        )
        .send()
        .await
        .expect("send streaming responses request")
        .text()
        .await
        .expect("read streaming responses response");

    assert!(body.contains("\"type\":\"response.created\""));
    assert!(body.contains("\"type\":\"response.output_item.added\""));
    assert!(body.contains("\"type\":\"response.output_item.content_part.delta\""));
    assert!(body.contains("\"type\":\"response.output_text.delta\""));
    assert!(body.contains("\"type\":\"response.completed\""));
    assert!(body.contains("\"output_text\":\"hello\""));
    assert!(body.contains("data: [DONE]"));

    gateway_handle.abort();
    upstream_handle.abort();
    let _ = stdfs::remove_dir_all(home_dir);
}

#[tokio::test]
async fn cross_protocol_non_stream_responses_preserve_observability_headers() {
    let upstream = Router::new().route(
        "/v1/messages",
        post(|| async {
            Response::builder()
                .status(StatusCode::OK)
                .header("x-request-id", "anth_req_123")
                .header("anthropic-ratelimit-remaining", "42")
                .header("retry-after", "3")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    json!({
                        "id": "msg_headers",
                        "type": "message",
                        "role": "assistant",
                        "model": "claude-test",
                        "content": [{
                            "type": "text",
                            "text": "headers-ok"
                        }],
                        "stop_reason": "end_turn",
                        "stop_sequence": Value::Null,
                        "usage": {
                            "input_tokens": 5,
                            "output_tokens": 2
                        }
                    })
                    .to_string(),
                ))
                .expect("build anthropic response")
        }),
    );
    let (upstream_addr, upstream_handle) = spawn_router(upstream).await;

    let mut config = GatewayConfig::default();
    config.providers = vec![cc_gw_core::config::ProviderConfig {
        id: "mock-anthropic".to_string(),
        label: "Mock Anthropic".to_string(),
        base_url: format!("http://{upstream_addr}"),
        provider_type: Some("anthropic".to_string()),
        default_model: Some("claude-test".to_string()),
        models: vec![cc_gw_core::config::ProviderModelConfig {
            id: "claude-test".to_string(),
            label: Some("Claude Test".to_string()),
            ..Default::default()
        }],
        ..cc_gw_core::config::ProviderConfig::default()
    }];
    config.defaults.completion = Some("claude-test".to_string());
    if let Some(openai_routing) = config.endpoint_routing.get_mut("openai") {
        openai_routing.defaults.completion = Some("claude-test".to_string());
    }

    let (home_dir, gateway_addr, gateway_handle) =
        spawn_test_gateway(config, "responses-header-forward").await;
    let client = reqwest::Client::new();

    let response = client
        .post(format!("http://{gateway_addr}/openai/v1/responses"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(
            json!({
                "model": "claude-test",
                "input": "hello"
            })
            .to_string(),
        )
        .send()
        .await
        .expect("send non-stream responses request");

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        response
            .headers()
            .get("x-request-id")
            .and_then(|value| value.to_str().ok()),
        Some("anth_req_123")
    );
    assert_eq!(
        response
            .headers()
            .get("anthropic-ratelimit-remaining")
            .and_then(|value| value.to_str().ok()),
        Some("42")
    );
    assert_eq!(
        response
            .headers()
            .get("retry-after")
            .and_then(|value| value.to_str().ok()),
        Some("3")
    );

    gateway_handle.abort();
    upstream_handle.abort();
    let _ = stdfs::remove_dir_all(home_dir);
}

#[tokio::test]
async fn cross_protocol_stream_responses_preserve_observability_headers() {
    let upstream = Router::new().route(
        "/v1/messages",
        post(|| async {
            Response::builder()
                .status(StatusCode::OK)
                .header("request-id", "anth_req_stream")
                .header("anthropic-ratelimit-remaining", "41")
                .header(header::CONTENT_TYPE, "text/event-stream")
                .body(Body::from(
                    "event: message_start\n\
                     data: {\"type\":\"message_start\",\"message\":{\"id\":\"msg_stream\",\"type\":\"message\",\"role\":\"assistant\",\"model\":\"claude-test\",\"content\":[],\"stop_reason\":null,\"stop_sequence\":null,\"usage\":{\"input_tokens\":0,\"output_tokens\":0}}}\n\n\
                     event: content_block_start\n\
                     data: {\"type\":\"content_block_start\",\"index\":0,\"content_block\":{\"type\":\"text\",\"text\":\"\"}}\n\n\
                     event: content_block_delta\n\
                     data: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"hello\"}}\n\n\
                     event: message_delta\n\
                     data: {\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"end_turn\"},\"usage\":{\"input_tokens\":11,\"output_tokens\":2}}\n\n\
                     event: message_stop\n\
                     data: {\"type\":\"message_stop\"}\n\n",
                ))
                .expect("build anthropic stream response")
        }),
    );
    let (upstream_addr, upstream_handle) = spawn_router(upstream).await;

    let mut config = GatewayConfig::default();
    config.providers = vec![cc_gw_core::config::ProviderConfig {
        id: "mock-anthropic".to_string(),
        label: "Mock Anthropic".to_string(),
        base_url: format!("http://{upstream_addr}"),
        provider_type: Some("anthropic".to_string()),
        default_model: Some("claude-test".to_string()),
        models: vec![cc_gw_core::config::ProviderModelConfig {
            id: "claude-test".to_string(),
            label: Some("Claude Test".to_string()),
            ..Default::default()
        }],
        ..cc_gw_core::config::ProviderConfig::default()
    }];
    config.defaults.completion = Some("claude-test".to_string());
    if let Some(openai_routing) = config.endpoint_routing.get_mut("openai") {
        openai_routing.defaults.completion = Some("claude-test".to_string());
    }

    let (home_dir, gateway_addr, gateway_handle) =
        spawn_test_gateway(config, "responses-stream-header-forward").await;
    let client = reqwest::Client::new();

    let response = client
        .post(format!("http://{gateway_addr}/openai/v1/responses"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(
            json!({
                "model": "claude-test",
                "stream": true,
                "input": "hello"
            })
            .to_string(),
        )
        .send()
        .await
        .expect("send streaming responses request");

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        response
            .headers()
            .get("request-id")
            .and_then(|value| value.to_str().ok()),
        Some("anth_req_stream")
    );
    assert_eq!(
        response
            .headers()
            .get("anthropic-ratelimit-remaining")
            .and_then(|value| value.to_str().ok()),
        Some("41")
    );

    let body = response
        .text()
        .await
        .expect("read streaming responses response");
    assert!(body.contains("\"type\":\"response.completed\""));

    gateway_handle.abort();
    upstream_handle.abort();
    let _ = stdfs::remove_dir_all(home_dir);
}

#[tokio::test]
async fn streaming_logs_store_materialized_response_instead_of_raw_sse_chunks() {
    let upstream = Router::new().route("/v1/messages", post(mock_anthropic_stream));
    let (upstream_addr, upstream_handle) = spawn_router(upstream).await;

    let mut config = GatewayConfig::default();
    config.providers = vec![cc_gw_core::config::ProviderConfig {
        id: "mock-anthropic".to_string(),
        label: "Mock Anthropic".to_string(),
        base_url: format!("http://{upstream_addr}"),
        provider_type: Some("anthropic".to_string()),
        default_model: Some("claude-test".to_string()),
        models: vec![cc_gw_core::config::ProviderModelConfig {
            id: "claude-test".to_string(),
            label: Some("Claude Test".to_string()),
            ..Default::default()
        }],
        ..cc_gw_core::config::ProviderConfig::default()
    }];
    config.defaults.completion = Some("claude-test".to_string());
    if let Some(openai_routing) = config.endpoint_routing.get_mut("openai") {
        openai_routing.defaults.completion = Some("claude-test".to_string());
    }

    let (home_dir, gateway_addr, gateway_handle) =
        spawn_test_gateway(config, "responses-stream-logs").await;
    let client = reqwest::Client::new();

    let _body = client
        .post(format!("http://{gateway_addr}/openai/v1/responses"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(
            json!({
                "model": "claude-test",
                "stream": true,
                "input": "hello"
            })
            .to_string(),
        )
        .send()
        .await
        .expect("send streaming responses request")
        .text()
        .await
        .expect("read streaming responses response");

    let logs: Value = client
        .get(format!("http://{gateway_addr}/api/logs?limit=1"))
        .send()
        .await
        .expect("request logs")
        .json()
        .await
        .expect("decode logs response");
    let log_id = logs
        .get("items")
        .and_then(Value::as_array)
        .and_then(|items| items.first())
        .and_then(|item| item.get("id"))
        .and_then(Value::as_i64)
        .expect("stream log id");

    let detail: Value = client
        .get(format!("http://{gateway_addr}/api/logs/{log_id}"))
        .send()
        .await
        .expect("request log detail")
        .json()
        .await
        .expect("decode log detail");
    let response_payload = detail
        .get("payload")
        .and_then(|payload| payload.get("client_response"))
        .and_then(Value::as_str)
        .expect("response payload");
    assert!(!response_payload.contains("data:"));
    assert!(!response_payload.contains("response.output_text.delta"));

    let response_payload_json: Value =
        serde_json::from_str(response_payload).expect("materialized response payload");
    assert_eq!(
        response_payload_json.get("object").and_then(Value::as_str),
        Some("response")
    );
    assert_eq!(
        response_payload_json
            .get("output_text")
            .and_then(Value::as_str),
        Some("hello")
    );

    gateway_handle.abort();
    upstream_handle.abort();
    let _ = stdfs::remove_dir_all(home_dir);
}

#[tokio::test]
async fn cross_protocol_logs_capture_four_payload_blocks_on_one_record() {
    let upstream = Router::new().route("/v1/messages", post(mock_anthropic_test));
    let (upstream_addr, upstream_handle) = spawn_router(upstream).await;

    let mut config = GatewayConfig::default();
    config.providers = vec![cc_gw_core::config::ProviderConfig {
        id: "mock-anthropic".to_string(),
        label: "Mock Anthropic".to_string(),
        base_url: format!("http://{upstream_addr}"),
        provider_type: Some("anthropic".to_string()),
        default_model: Some("claude-test".to_string()),
        models: vec![cc_gw_core::config::ProviderModelConfig {
            id: "claude-test".to_string(),
            label: Some("Claude Test".to_string()),
            ..Default::default()
        }],
        ..cc_gw_core::config::ProviderConfig::default()
    }];
    config.defaults.completion = Some("claude-test".to_string());
    if let Some(openai_routing) = config.endpoint_routing.get_mut("openai") {
        openai_routing.defaults.completion = Some("claude-test".to_string());
    }

    let (home_dir, gateway_addr, gateway_handle) =
        spawn_test_gateway(config, "cross-protocol-payloads").await;
    let client = reqwest::Client::new();

    let response: Value = client
        .post(format!("http://{gateway_addr}/openai/v1/responses"))
        .header(header::CONTENT_TYPE, "application/json")
        .json(&json!({
            "model": "claude-test",
            "input": "hello"
        }))
        .send()
        .await
        .expect("send non-stream responses request")
        .json()
        .await
        .expect("decode non-stream responses response");
    assert_eq!(
        response.get("object").and_then(Value::as_str),
        Some("response")
    );

    let logs: Value = client
        .get(format!("http://{gateway_addr}/api/logs?limit=1"))
        .send()
        .await
        .expect("request logs")
        .json()
        .await
        .expect("decode logs response");
    let log_id = logs
        .get("items")
        .and_then(Value::as_array)
        .and_then(|items| items.first())
        .and_then(|item| item.get("id"))
        .and_then(Value::as_i64)
        .expect("cross protocol log id");

    let detail: Value = client
        .get(format!("http://{gateway_addr}/api/logs/{log_id}"))
        .send()
        .await
        .expect("request log detail")
        .json()
        .await
        .expect("decode log detail");
    let payload = detail.get("payload").expect("payload object");

    let client_request = payload
        .get("client_request")
        .and_then(Value::as_str)
        .expect("client request payload");
    let upstream_request = payload
        .get("upstream_request")
        .and_then(Value::as_str)
        .expect("upstream request payload");
    let upstream_response = payload
        .get("upstream_response")
        .and_then(Value::as_str)
        .expect("upstream response payload");
    let client_response = payload
        .get("client_response")
        .and_then(Value::as_str)
        .expect("client response payload");

    assert_ne!(client_request, upstream_request);
    assert_ne!(upstream_response, client_response);

    let client_request_json: Value =
        serde_json::from_str(client_request).expect("decode client request");
    let upstream_request_json: Value =
        serde_json::from_str(upstream_request).expect("decode upstream request");
    let upstream_response_json: Value =
        serde_json::from_str(upstream_response).expect("decode upstream response");
    let client_response_json: Value =
        serde_json::from_str(client_response).expect("decode client response");

    assert_eq!(
        client_request_json.get("input").and_then(Value::as_str),
        Some("hello")
    );
    assert!(upstream_request_json.get("messages").is_some());
    assert_eq!(
        upstream_response_json
            .get("content")
            .and_then(Value::as_array)
            .and_then(|items| items.first())
            .and_then(|item| item.get("text"))
            .and_then(Value::as_str),
        Some("anthropic query=")
    );
    assert_eq!(
        client_response_json.get("object").and_then(Value::as_str),
        Some("response")
    );
    assert_eq!(
        client_response_json
            .get("output_text")
            .and_then(Value::as_str),
        Some("anthropic query=")
    );

    gateway_handle.abort();
    upstream_handle.abort();
    let _ = stdfs::remove_dir_all(home_dir);
}

#[tokio::test]
async fn logs_export_archive_includes_four_payload_fields() {
    let upstream = Router::new().route("/v1/messages", post(mock_anthropic_test));
    let (upstream_addr, upstream_handle) = spawn_router(upstream).await;

    let mut config = GatewayConfig::default();
    config.providers = vec![cc_gw_core::config::ProviderConfig {
        id: "mock-anthropic".to_string(),
        label: "Mock Anthropic".to_string(),
        base_url: format!("http://{upstream_addr}"),
        provider_type: Some("anthropic".to_string()),
        default_model: Some("claude-test".to_string()),
        models: vec![cc_gw_core::config::ProviderModelConfig {
            id: "claude-test".to_string(),
            label: Some("Claude Test".to_string()),
            ..Default::default()
        }],
        ..cc_gw_core::config::ProviderConfig::default()
    }];
    config.defaults.completion = Some("claude-test".to_string());
    if let Some(openai_routing) = config.endpoint_routing.get_mut("openai") {
        openai_routing.defaults.completion = Some("claude-test".to_string());
    }

    let (home_dir, gateway_addr, gateway_handle) =
        spawn_test_gateway(config, "logs-export-payloads").await;
    let client = reqwest::Client::new();

    let _: Value = client
        .post(format!("http://{gateway_addr}/openai/v1/responses"))
        .header(header::CONTENT_TYPE, "application/json")
        .json(&json!({
            "model": "claude-test",
            "input": "hello"
        }))
        .send()
        .await
        .expect("send request")
        .json()
        .await
        .expect("decode response");

    let archive_bytes = client
        .post(format!("http://{gateway_addr}/api/logs/export"))
        .header(header::CONTENT_TYPE, "application/json")
        .json(&json!({
            "limit": 10
        }))
        .send()
        .await
        .expect("export logs")
        .bytes()
        .await
        .expect("read archive bytes");

    let cursor = std::io::Cursor::new(archive_bytes.to_vec());
    let mut archive = zip::ZipArchive::new(cursor).expect("open zip archive");
    let mut logs_file = archive.by_name("logs.json").expect("find logs.json");
    let mut logs_json = String::new();
    std::io::Read::read_to_string(&mut logs_file, &mut logs_json).expect("read logs.json");

    let exported: Value = serde_json::from_str(&logs_json).expect("decode logs.json");
    let records = exported
        .get("records")
        .and_then(Value::as_array)
        .expect("records array");
    let payload = records
        .first()
        .and_then(|record| record.get("payload"))
        .expect("payload object");

    assert!(payload.get("client_request").is_some());
    assert!(payload.get("upstream_request").is_some());
    assert!(payload.get("upstream_response").is_some());
    assert!(payload.get("client_response").is_some());
    assert_eq!(
        records
            .first()
            .and_then(|record| record.get("api_key_value"))
            .unwrap_or(&Value::Null),
        &Value::Null
    );

    gateway_handle.abort();
    upstream_handle.abort();
    let _ = stdfs::remove_dir_all(home_dir);
}

#[tokio::test]
async fn standard_proxy_routes_accept_payloads_larger_than_two_mib() {
    let config = GatewayConfig::default();
    let (home_dir, gateway_addr, gateway_handle) =
        spawn_test_gateway(config, "standard-body-limit").await;
    let client = reqwest::Client::new();
    let payload = exact_json_body(2 * 1024 * 1024 + 1);

    for path in [
        "/openai/v1/responses",
        "/openai/v1/chat/completions",
        "/v1/messages",
    ] {
        let response = client
            .post(format!("http://{gateway_addr}{path}"))
            .header(header::CONTENT_TYPE, "application/json")
            .body(payload.clone())
            .send()
            .await
            .expect("send large standard request");
        assert_eq!(response.status(), StatusCode::BAD_REQUEST, "{path}");
        let text = response.text().await.expect("read standard response");
        assert!(
            text.contains("未配置任何模型提供商"),
            "unexpected response for {path}: {text}"
        );
    }

    gateway_handle.abort();
    let _ = stdfs::remove_dir_all(home_dir);
}

#[tokio::test]
async fn custom_proxy_routes_accept_payloads_larger_than_two_mib() {
    let mut config = GatewayConfig::default();
    config.custom_endpoints = vec![cc_gw_core::config::CustomEndpointConfig {
        id: "team".to_string(),
        label: "Team".to_string(),
        path: Some("/team".to_string()),
        protocol: Some("openai-responses".to_string()),
        enabled: Some(true),
        ..cc_gw_core::config::CustomEndpointConfig::default()
    }];
    let (home_dir, gateway_addr, gateway_handle) =
        spawn_test_gateway(config, "custom-body-limit").await;
    let client = reqwest::Client::new();

    let response = client
        .post(format!("http://{gateway_addr}/team/v1/responses"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(exact_json_body(2 * 1024 * 1024 + 1))
        .send()
        .await
        .expect("send large custom request");
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    let text = response.text().await.expect("read custom response");
    assert!(text.contains("未配置任何模型提供商"));

    gateway_handle.abort();
    let _ = stdfs::remove_dir_all(home_dir);
}

#[tokio::test]
async fn custom_models_route_uses_custom_endpoint_routing() {
    let mut config = GatewayConfig::default();
    if let Some(openai) = config.endpoint_routing.get_mut("openai") {
        openai.model_routes.insert(
            "openai-visible".to_string(),
            "mock-openai:openai-upstream".to_string(),
        );
    }
    config.endpoint_routing.insert(
        "test".to_string(),
        cc_gw_core::config::EndpointRoutingConfig {
            model_routes: [(
                "test-visible".to_string(),
                "mock-openai:test-upstream".to_string(),
            )]
            .into_iter()
            .collect(),
            ..cc_gw_core::config::EndpointRoutingConfig::default()
        },
    );
    config.custom_endpoints = vec![cc_gw_core::config::CustomEndpointConfig {
        id: "test".to_string(),
        label: "Test".to_string(),
        path: Some("/test/".to_string()),
        protocol: Some("openai-chat".to_string()),
        enabled: Some(true),
        ..cc_gw_core::config::CustomEndpointConfig::default()
    }];
    config.providers = vec![cc_gw_core::config::ProviderConfig {
        id: "mock-openai".to_string(),
        label: "Mock OpenAI".to_string(),
        provider_type: Some("openai".to_string()),
        default_model: Some("provider-model".to_string()),
        models: vec![cc_gw_core::config::ProviderModelConfig {
            id: "provider-model".to_string(),
            label: Some("Provider Model".to_string()),
            ..Default::default()
        }],
        ..cc_gw_core::config::ProviderConfig::default()
    }];

    let (home_dir, gateway_addr, gateway_handle) =
        spawn_test_gateway(config, "custom-models-route").await;
    let client = reqwest::Client::new();

    let response: Value = client
        .get(format!("http://{gateway_addr}/test/v1/models"))
        .send()
        .await
        .expect("request custom models route")
        .json()
        .await
        .expect("decode custom models response");
    let model_ids: Vec<&str> = response
        .get("data")
        .and_then(Value::as_array)
        .expect("models data")
        .iter()
        .filter_map(|model| model.get("id").and_then(Value::as_str))
        .collect();

    assert!(model_ids.contains(&"test-visible"));
    assert!(model_ids.contains(&"provider-model"));
    assert!(!model_ids.contains(&"openai-visible"));

    gateway_handle.abort();
    let _ = stdfs::remove_dir_all(home_dir);
}

#[tokio::test]
async fn configured_body_limit_rejects_requests_over_boundary() {
    let mut config = GatewayConfig::default();
    config.body_limit = Some(1024 * 1024);
    let (home_dir, gateway_addr, gateway_handle) =
        spawn_test_gateway(config, "configured-body-limit").await;
    let client = reqwest::Client::new();

    let within_limit = client
        .post(format!("http://{gateway_addr}/openai/v1/responses"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(exact_json_body(1024 * 1024))
        .send()
        .await
        .expect("send boundary request");
    assert_eq!(within_limit.status(), StatusCode::BAD_REQUEST);

    let over_limit = client
        .post(format!("http://{gateway_addr}/openai/v1/responses"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(exact_json_body(1024 * 1024 + 1))
        .send()
        .await
        .expect("send oversized request");
    assert_eq!(over_limit.status(), StatusCode::PAYLOAD_TOO_LARGE);
    assert_eq!(
        over_limit.text().await.expect("read oversized response"),
        "Failed to buffer the request body: length limit exceeded"
    );

    gateway_handle.abort();
    let _ = stdfs::remove_dir_all(home_dir);
}

#[tokio::test]
async fn web_auth_requires_session_for_api_routes() {
    let (password_hash, password_salt) = auth::create_password_record("secret123");
    let mut config = GatewayConfig::default();
    config.web_auth = Some(cc_gw_core::config::WebAuthConfig {
        enabled: true,
        username: Some("admin".to_string()),
        password_hash: Some(password_hash),
        password_salt: Some(password_salt),
    });

    let (home_dir, gateway_addr, gateway_handle) = spawn_test_gateway(config, "web-auth").await;
    let client = reqwest::Client::new();

    let unauthorized = client
        .get(format!("http://{gateway_addr}/api/status"))
        .send()
        .await
        .expect("request unauthorized api status");
    assert_eq!(unauthorized.status(), StatusCode::UNAUTHORIZED);

    let public_health = client
        .get(format!("http://{gateway_addr}/health"))
        .send()
        .await
        .expect("request public health");
    assert_eq!(public_health.status(), StatusCode::OK);

    let login = client
        .post(format!("http://{gateway_addr}/auth/login"))
        .json(&json!({ "username": "admin", "password": "secret123" }))
        .send()
        .await
        .expect("login request");
    assert_eq!(login.status(), StatusCode::OK);
    let session_cookie = login
        .headers()
        .get(header::SET_COOKIE)
        .and_then(|value| value.to_str().ok())
        .expect("session cookie")
        .to_string();
    let cookie_header = session_cookie
        .split(';')
        .next()
        .expect("cookie pair")
        .to_string();

    let authenticated = client
        .get(format!("http://{gateway_addr}/api/status"))
        .header(header::COOKIE, &cookie_header)
        .send()
        .await
        .expect("authenticated api status");
    assert_eq!(authenticated.status(), StatusCode::OK);

    let session: Value = client
        .get(format!("http://{gateway_addr}/auth/session"))
        .header(header::COOKIE, &cookie_header)
        .send()
        .await
        .expect("auth session request")
        .json()
        .await
        .expect("decode auth session");
    assert_eq!(
        session.get("authenticated").and_then(Value::as_bool),
        Some(true)
    );
    assert_eq!(
        session.get("username").and_then(Value::as_str),
        Some("admin")
    );

    let logout = client
        .post(format!("http://{gateway_addr}/auth/logout"))
        .header(header::COOKIE, &cookie_header)
        .send()
        .await
        .expect("logout request");
    assert_eq!(logout.status(), StatusCode::OK);

    let after_logout = client
        .get(format!("http://{gateway_addr}/api/status"))
        .header(header::COOKIE, &cookie_header)
        .send()
        .await
        .expect("api status after logout");
    assert_eq!(after_logout.status(), StatusCode::UNAUTHORIZED);

    gateway_handle.abort();
    let _ = stdfs::remove_dir_all(home_dir);
}

#[tokio::test]
async fn legacy_public_routes_remain_available() {
    let config = GatewayConfig::default();
    let (home_dir, gateway_addr, gateway_handle) =
        spawn_test_gateway(config, "legacy-public-routes").await;
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .expect("client");

    let root = client
        .get(format!("http://{gateway_addr}/"))
        .send()
        .await
        .expect("request root");
    assert_eq!(root.status(), StatusCode::FOUND);
    assert_eq!(
        root.headers()
            .get(header::LOCATION)
            .and_then(|value| value.to_str().ok()),
        Some("/ui/")
    );

    let event_batch = client
        .post(format!(
            "http://{gateway_addr}/anthropic/api/event_logging/batch"
        ))
        .json(&json!({ "events": [] }))
        .send()
        .await
        .expect("request event logging batch");
    assert_eq!(event_batch.status(), StatusCode::NO_CONTENT);

    let favicon = client
        .get(format!("http://{gateway_addr}/favicon.ico"))
        .send()
        .await
        .expect("request favicon");
    assert_eq!(favicon.status(), StatusCode::NO_CONTENT);

    gateway_handle.abort();
    let _ = stdfs::remove_dir_all(home_dir);
}

#[tokio::test]
async fn custom_endpoint_and_api_key_restrictions_work_end_to_end() {
    let upstream = Router::new().route(
        "/v1/chat/completions",
        post(|| async {
            Json(json!({
                "choices": [{
                    "message": { "content": "team-ok" }
                }],
                "usage": {
                    "prompt_tokens": 5,
                    "completion_tokens": 2
                }
            }))
        }),
    );
    let (upstream_addr, upstream_handle) = spawn_router(upstream).await;

    let mut config = GatewayConfig::default();
    config.defaults.completion = Some("gpt-test".to_string());
    if let Some(anthropic) = config.endpoint_routing.get_mut("anthropic") {
        anthropic.defaults.completion = Some("gpt-test".to_string());
    }
    if let Some(openai) = config.endpoint_routing.get_mut("openai") {
        openai.defaults.completion = Some("gpt-test".to_string());
    }
    config.providers = vec![cc_gw_core::config::ProviderConfig {
        id: "mock-openai".to_string(),
        label: "Mock OpenAI".to_string(),
        base_url: format!("http://{upstream_addr}"),
        provider_type: Some("openai".to_string()),
        default_model: Some("gpt-test".to_string()),
        models: vec![cc_gw_core::config::ProviderModelConfig {
            id: "gpt-test".to_string(),
            label: Some("GPT Test".to_string()),
            ..Default::default()
        }],
        ..cc_gw_core::config::ProviderConfig::default()
    }];

    let (home_dir, gateway_addr, gateway_handle) =
        spawn_test_gateway(config, "custom-endpoint-api-key").await;
    let client = reqwest::Client::new();

    let create_endpoint = client
        .post(format!("http://{gateway_addr}/api/custom-endpoints"))
        .json(&json!({
            "id": "team",
            "label": "Team",
            "path": "/team",
            "protocol": "openai-chat",
            "enabled": true,
            // Custom endpoints no longer inherit the global routing table, so
            // this endpoint needs its own explicit routing config.
            "routing": {
                "defaults": { "completion": "gpt-test" },
                "modelRoutes": {}
            }
        }))
        .send()
        .await
        .expect("create custom endpoint");
    assert_eq!(create_endpoint.status(), StatusCode::OK);

    let create_key: Value = client
        .post(format!("http://{gateway_addr}/api/keys"))
        .json(&json!({
            "name": "team-only",
            "allowedEndpoints": ["team"]
        }))
        .send()
        .await
        .expect("create api key")
        .json()
        .await
        .expect("decode api key create");
    let team_key = create_key
        .get("key")
        .and_then(Value::as_str)
        .expect("created api key")
        .to_string();
    let team_key_id = create_key
        .get("id")
        .and_then(Value::as_i64)
        .expect("created api key id");

    let custom_ok: Value = client
        .post(format!("http://{gateway_addr}/team/v1/chat/completions"))
        .header("x-api-key", &team_key)
        .json(&json!({
            "model": "gpt-test",
            "messages": [{ "role": "user", "content": "hello" }]
        }))
        .send()
        .await
        .expect("request custom endpoint")
        .json()
        .await
        .expect("decode custom endpoint response");
    assert_eq!(
        custom_ok
            .get("choices")
            .and_then(Value::as_array)
            .and_then(|choices| choices.first())
            .and_then(|choice| choice.get("message"))
            .and_then(|message| message.get("content"))
            .and_then(Value::as_str),
        Some("team-ok")
    );

    let forbidden = client
        .post(format!("http://{gateway_addr}/openai/v1/chat/completions"))
        .header("x-api-key", &team_key)
        .json(&json!({
            "model": "gpt-test",
            "messages": [{ "role": "user", "content": "hello" }]
        }))
        .send()
        .await
        .expect("request forbidden openai endpoint");
    assert_eq!(forbidden.status(), StatusCode::FORBIDDEN);
    let forbidden_body: Value = forbidden.json().await.expect("decode forbidden response");
    assert_eq!(
        forbidden_body
            .get("error")
            .and_then(|error| error.get("code"))
            .and_then(Value::as_str),
        Some("endpoint_forbidden")
    );

    let logs: Value = client
        .get(format!(
            "http://{gateway_addr}/api/logs?apiKey={team_key_id}"
        ))
        .send()
        .await
        .expect("request api logs")
        .json()
        .await
        .expect("decode logs response");
    assert_eq!(logs.get("total").and_then(Value::as_i64), Some(1));

    gateway_handle.abort();
    upstream_handle.abort();
    let _ = stdfs::remove_dir_all(home_dir);
}

#[tokio::test]
async fn disabled_custom_endpoint_is_not_exposed() {
    let upstream = Router::new().route(
        "/v1/chat/completions",
        post(|| async {
            Json(json!({
                "choices": [{
                    "message": { "content": "should-not-reach" }
                }]
            }))
        }),
    );
    let (upstream_addr, upstream_handle) = spawn_router(upstream).await;

    let mut config = GatewayConfig::default();
    if let Some(openai) = config.endpoint_routing.get_mut("openai") {
        openai.defaults.completion = Some("gpt-test".to_string());
    }
    config.providers = vec![cc_gw_core::config::ProviderConfig {
        id: "mock-openai".to_string(),
        label: "Mock OpenAI".to_string(),
        base_url: format!("http://{upstream_addr}"),
        provider_type: Some("openai".to_string()),
        default_model: Some("gpt-test".to_string()),
        models: vec![cc_gw_core::config::ProviderModelConfig {
            id: "gpt-test".to_string(),
            label: Some("GPT Test".to_string()),
            ..Default::default()
        }],
        ..cc_gw_core::config::ProviderConfig::default()
    }];

    let (home_dir, gateway_addr, gateway_handle) =
        spawn_test_gateway(config, "disabled-custom-endpoint").await;
    let client = reqwest::Client::new();

    let create_endpoint = client
        .post(format!("http://{gateway_addr}/api/custom-endpoints"))
        .json(&json!({
            "id": "disabled-team",
            "label": "Disabled Team",
            "path": "/disabled-team",
            "protocol": "openai-chat",
            "enabled": false
        }))
        .send()
        .await
        .expect("create disabled endpoint");
    assert_eq!(create_endpoint.status(), StatusCode::OK);

    let response = client
        .post(format!(
            "http://{gateway_addr}/disabled-team/v1/chat/completions"
        ))
        .json(&json!({
            "model": "gpt-test",
            "messages": [{ "role": "user", "content": "hello" }]
        }))
        .send()
        .await
        .expect("request disabled endpoint");
    assert_eq!(response.status(), StatusCode::NOT_FOUND);

    gateway_handle.abort();
    upstream_handle.abort();
    let _ = stdfs::remove_dir_all(home_dir);
}

#[tokio::test]
async fn api_key_admin_reveal_and_stats_work_end_to_end() {
    let upstream = Router::new().route(
        "/v1/chat/completions",
        post(|| async {
            Json(json!({
                "choices": [{
                    "message": { "content": "ok" }
                }],
                "usage": {
                    "prompt_tokens": 7,
                    "completion_tokens": 3
                }
            }))
        }),
    );
    let (upstream_addr, upstream_handle) = spawn_router(upstream).await;

    let mut config = GatewayConfig::default();
    config.defaults.completion = Some("gpt-test".to_string());
    if let Some(openai) = config.endpoint_routing.get_mut("openai") {
        openai.defaults.completion = Some("gpt-test".to_string());
    }
    config.providers = vec![cc_gw_core::config::ProviderConfig {
        id: "mock-openai".to_string(),
        label: "Mock OpenAI".to_string(),
        base_url: format!("http://{upstream_addr}"),
        provider_type: Some("openai".to_string()),
        default_model: Some("gpt-test".to_string()),
        models: vec![cc_gw_core::config::ProviderModelConfig {
            id: "gpt-test".to_string(),
            label: Some("GPT Test".to_string()),
            ..Default::default()
        }],
        ..cc_gw_core::config::ProviderConfig::default()
    }];

    let (home_dir, gateway_addr, gateway_handle) =
        spawn_test_gateway(config, "api-key-admin").await;
    let client = reqwest::Client::new();

    let create: Value = client
        .post(format!("http://{gateway_addr}/api/keys"))
        .json(&json!({
            "name": "ops-key",
            "description": "ops access"
        }))
        .send()
        .await
        .expect("create api key")
        .json()
        .await
        .expect("decode create api key");
    let key_id = create.get("id").and_then(Value::as_i64).expect("key id");
    let key_value = create
        .get("key")
        .and_then(Value::as_str)
        .expect("key value")
        .to_string();

    let reveal: Value = client
        .get(format!("http://{gateway_addr}/api/keys/{key_id}/reveal"))
        .send()
        .await
        .expect("reveal api key")
        .json()
        .await
        .expect("decode reveal api key");
    assert_eq!(
        reveal.get("key").and_then(Value::as_str),
        Some(key_value.as_str())
    );

    let proxy_response = client
        .post(format!("http://{gateway_addr}/openai/v1/chat/completions"))
        .header("x-api-key", &key_value)
        .json(&json!({
            "model": "gpt-test",
            "messages": [{ "role": "user", "content": "hello" }]
        }))
        .send()
        .await
        .expect("proxy request with api key");
    assert_eq!(proxy_response.status(), StatusCode::OK);

    let overview: Value = client
        .get(format!(
            "http://{gateway_addr}/api/stats/api-keys/overview?days=7"
        ))
        .send()
        .await
        .expect("api key overview")
        .json()
        .await
        .expect("decode api key overview");
    assert_eq!(overview.get("activeKeys").and_then(Value::as_i64), Some(1));

    let usage: Value = client
        .get(format!(
            "http://{gateway_addr}/api/stats/api-keys/usage?days=7&limit=10"
        ))
        .send()
        .await
        .expect("api key usage")
        .json()
        .await
        .expect("decode api key usage");
    let first_usage = usage
        .as_array()
        .and_then(|items| items.first())
        .expect("usage row");
    assert_eq!(
        first_usage.get("apiKeyId").and_then(Value::as_i64),
        Some(key_id)
    );
    assert_eq!(first_usage.get("requests").and_then(Value::as_i64), Some(1));
    assert_eq!(
        first_usage.get("inputTokens").and_then(Value::as_i64),
        Some(7)
    );
    assert_eq!(
        first_usage.get("outputTokens").and_then(Value::as_i64),
        Some(3)
    );

    let patch = client
        .patch(format!("http://{gateway_addr}/api/keys/{key_id}"))
        .json(&json!({ "enabled": false }))
        .send()
        .await
        .expect("disable api key");
    assert_eq!(patch.status(), StatusCode::OK);

    let disabled_response = client
        .post(format!("http://{gateway_addr}/openai/v1/chat/completions"))
        .header("x-api-key", &key_value)
        .json(&json!({
            "model": "gpt-test",
            "messages": [{ "role": "user", "content": "hello" }]
        }))
        .send()
        .await
        .expect("request with disabled api key");
    assert_eq!(disabled_response.status(), StatusCode::UNAUTHORIZED);

    gateway_handle.abort();
    upstream_handle.abort();
    let _ = stdfs::remove_dir_all(home_dir);
}

#[tokio::test]
async fn api_status_reports_live_and_recent_client_activity() {
    let upstream = Router::new().route(
        "/v1/chat/completions",
        post(|| async {
            sleep(Duration::from_millis(600)).await;
            Json(json!({
                "choices": [{
                    "message": { "content": "ok" }
                }],
                "usage": {
                    "prompt_tokens": 4,
                    "completion_tokens": 2
                }
            }))
        }),
    );
    let (upstream_addr, upstream_handle) = spawn_router(upstream).await;

    let mut config = GatewayConfig::default();
    config.defaults.completion = Some("gpt-test".to_string());
    if let Some(openai) = config.endpoint_routing.get_mut("openai") {
        openai.defaults.completion = Some("gpt-test".to_string());
    }
    config.providers = vec![cc_gw_core::config::ProviderConfig {
        id: "mock-openai".to_string(),
        label: "Mock OpenAI".to_string(),
        base_url: format!("http://{upstream_addr}"),
        provider_type: Some("openai".to_string()),
        default_model: Some("gpt-test".to_string()),
        models: vec![cc_gw_core::config::ProviderModelConfig {
            id: "gpt-test".to_string(),
            label: Some("GPT Test".to_string()),
            ..Default::default()
        }],
        ..cc_gw_core::config::ProviderConfig::default()
    }];

    let (home_dir, gateway_addr, gateway_handle) =
        spawn_test_gateway(config, "api-status-activity").await;
    let client = reqwest::Client::new();

    let create_key: Value = client
        .post(format!("http://{gateway_addr}/api/keys"))
        .json(&json!({ "name": "status-test" }))
        .send()
        .await
        .expect("create api key")
        .json()
        .await
        .expect("decode api key create");
    let api_key = create_key
        .get("key")
        .and_then(Value::as_str)
        .expect("created api key")
        .to_string();

    let request_client = client.clone();
    let request_url = format!("http://{gateway_addr}/openai/v1/chat/completions");
    let in_flight = tokio::spawn(async move {
        request_client
            .post(request_url)
            .header("x-api-key", api_key)
            .header("x-forwarded-for", "203.0.113.10")
            .json(&json!({
                "model": "gpt-test",
                "user": "session-live",
                "messages": [{ "role": "user", "content": "hello" }]
            }))
            .send()
            .await
            .expect("send in-flight request")
    });

    sleep(Duration::from_millis(150)).await;

    let live_status: Value = client
        .get(format!("http://{gateway_addr}/api/status?endpoint=openai"))
        .send()
        .await
        .expect("request live status")
        .json()
        .await
        .expect("decode live status");
    assert_eq!(
        live_status.get("activeRequests").and_then(Value::as_u64),
        Some(1)
    );
    assert_eq!(
        live_status
            .get("activeClientAddresses")
            .and_then(Value::as_u64),
        Some(1)
    );
    assert_eq!(
        live_status
            .get("activeClientSessions")
            .and_then(Value::as_u64),
        Some(1)
    );
    assert_eq!(
        live_status.get("requestsPerMinute").and_then(Value::as_u64),
        Some(1)
    );
    assert_eq!(
        live_status
            .get("outputTokensPerMinute")
            .and_then(Value::as_u64),
        Some(0)
    );
    assert!(
        live_status
            .get("cpuUsagePercent")
            .and_then(Value::as_f64)
            .is_some()
    );
    assert!(
        live_status
            .get("networkIngressBytesPerSecond")
            .and_then(Value::as_f64)
            .is_some()
    );
    assert!(
        live_status
            .get("networkEgressBytesPerSecond")
            .and_then(Value::as_f64)
            .is_some()
    );

    let response = in_flight.await.expect("join in-flight request");
    assert_eq!(response.status(), StatusCode::OK);

    for (source_ip, session_id) in [
        ("203.0.113.11", "session-live"),
        ("203.0.113.12", "session-b"),
    ] {
        let follow_up = client
            .post(format!("http://{gateway_addr}/openai/v1/chat/completions"))
            .header(
                "x-api-key",
                create_key
                    .get("key")
                    .and_then(Value::as_str)
                    .expect("created api key"),
            )
            .header("x-forwarded-for", source_ip)
            .json(&json!({
                "model": "gpt-test",
                "user": session_id,
                "messages": [{ "role": "user", "content": "follow up" }]
            }))
            .send()
            .await
            .expect("send follow up request");
        assert_eq!(follow_up.status(), StatusCode::OK);
    }

    let settled_status: Value = client
        .get(format!("http://{gateway_addr}/api/status?endpoint=openai"))
        .send()
        .await
        .expect("request settled status")
        .json()
        .await
        .expect("decode settled status");
    assert_eq!(
        settled_status.get("activeRequests").and_then(Value::as_u64),
        Some(0)
    );
    assert_eq!(
        settled_status
            .get("activeClientAddresses")
            .and_then(Value::as_u64),
        Some(0)
    );
    assert_eq!(
        settled_status
            .get("activeClientSessions")
            .and_then(Value::as_u64),
        Some(0)
    );
    assert_eq!(
        settled_status
            .get("requestsPerMinute")
            .and_then(Value::as_u64),
        Some(3)
    );
    assert_eq!(
        settled_status
            .get("outputTokensPerMinute")
            .and_then(Value::as_u64),
        Some(6)
    );
    assert_eq!(
        settled_status
            .get("uniqueClientAddressesLastHour")
            .and_then(Value::as_u64),
        Some(3)
    );
    assert_eq!(
        settled_status
            .get("uniqueClientSessionsLastHour")
            .and_then(Value::as_u64),
        Some(2)
    );
    assert!(
        settled_status
            .get("cpuUsagePercent")
            .and_then(Value::as_f64)
            .is_some()
    );
    assert!(
        settled_status
            .get("networkIngressBytesPerSecond")
            .and_then(Value::as_f64)
            .is_some_and(|value| value > 0.0)
    );
    assert!(
        settled_status
            .get("networkEgressBytesPerSecond")
            .and_then(Value::as_f64)
            .is_some_and(|value| value > 0.0)
    );

    gateway_handle.abort();
    upstream_handle.abort();
    let _ = stdfs::remove_dir_all(home_dir);
}

#[tokio::test]
async fn dropped_streams_finalize_logs_as_interrupted() {
    let upstream = Router::new().route("/v1/messages", post(mock_anthropic_slow_stream));
    let (upstream_addr, upstream_handle) = spawn_router(upstream).await;

    let mut config = GatewayConfig::default();
    config.providers = vec![cc_gw_core::config::ProviderConfig {
        id: "mock-anthropic".to_string(),
        label: "Mock Anthropic".to_string(),
        base_url: format!("http://{upstream_addr}"),
        provider_type: Some("anthropic".to_string()),
        default_model: Some("claude-test".to_string()),
        models: vec![cc_gw_core::config::ProviderModelConfig {
            id: "claude-test".to_string(),
            label: Some("Claude Test".to_string()),
            ..Default::default()
        }],
        ..cc_gw_core::config::ProviderConfig::default()
    }];
    config.defaults.completion = Some("claude-test".to_string());
    if let Some(openai_routing) = config.endpoint_routing.get_mut("openai") {
        openai_routing.defaults.completion = Some("claude-test".to_string());
    }

    let (home_dir, gateway_addr, gateway_handle) =
        spawn_test_gateway(config, "stream-drop-finalize").await;
    let client = reqwest::Client::new();

    let response = client
        .post(format!("http://{gateway_addr}/openai/v1/responses"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(
            json!({
                "model": "claude-test",
                "stream": true,
                "input": "hello"
            })
            .to_string(),
        )
        .send()
        .await
        .expect("send streaming request");

    let mut stream = response.bytes_stream();
    let first_chunk = stream
        .next()
        .await
        .expect("first chunk available")
        .expect("first chunk bytes");
    assert!(!first_chunk.is_empty());
    drop(stream);

    sleep(Duration::from_millis(250)).await;

    let status: Value = client
        .get(format!("http://{gateway_addr}/api/status?endpoint=openai"))
        .send()
        .await
        .expect("request status after dropped stream")
        .json()
        .await
        .expect("decode status after dropped stream");
    assert_eq!(
        status.get("activeRequests").and_then(Value::as_u64),
        Some(0)
    );

    let logs: Value = client
        .get(format!("http://{gateway_addr}/api/logs?limit=1"))
        .send()
        .await
        .expect("request logs after dropped stream")
        .json()
        .await
        .expect("decode logs after dropped stream");
    let item = logs
        .get("items")
        .and_then(Value::as_array)
        .and_then(|items| items.first())
        .expect("stream log item");
    assert_eq!(item.get("status_code").and_then(Value::as_i64), Some(499));
    assert_eq!(
        item.get("error").and_then(Value::as_str),
        Some("stream terminated before completion")
    );
    assert_eq!(
        item.get("error_source").and_then(Value::as_str),
        Some("client")
    );
    assert!(item.get("latency_ms").and_then(Value::as_i64).is_some());

    let success_logs: Value = client
        .get(format!(
            "http://{gateway_addr}/api/logs?status=success&limit=10"
        ))
        .send()
        .await
        .expect("request success logs")
        .json()
        .await
        .expect("decode success logs");
    assert_eq!(success_logs.get("total").and_then(Value::as_u64), Some(0));

    let error_logs: Value = client
        .get(format!(
            "http://{gateway_addr}/api/logs?status=error&limit=10"
        ))
        .send()
        .await
        .expect("request error logs")
        .json()
        .await
        .expect("decode error logs");
    assert_eq!(error_logs.get("total").and_then(Value::as_u64), Some(1));

    gateway_handle.abort();
    upstream_handle.abort();
    let _ = stdfs::remove_dir_all(home_dir);
}

#[tokio::test]
async fn upstream_stream_failures_are_logged_as_upstream_errors() {
    let upstream = Router::new().route("/v1/messages", post(mock_anthropic_failing_stream));
    let (upstream_addr, upstream_handle) = spawn_router(upstream).await;

    let mut config = GatewayConfig::default();
    config.providers = vec![cc_gw_core::config::ProviderConfig {
        id: "mock-anthropic".to_string(),
        label: "Mock Anthropic".to_string(),
        base_url: format!("http://{upstream_addr}"),
        provider_type: Some("anthropic".to_string()),
        default_model: Some("claude-test".to_string()),
        models: vec![cc_gw_core::config::ProviderModelConfig {
            id: "claude-test".to_string(),
            label: Some("Claude Test".to_string()),
            ..Default::default()
        }],
        ..cc_gw_core::config::ProviderConfig::default()
    }];
    config.defaults.completion = Some("claude-test".to_string());
    if let Some(openai_routing) = config.endpoint_routing.get_mut("openai") {
        openai_routing.defaults.completion = Some("claude-test".to_string());
    }

    let (home_dir, gateway_addr, gateway_handle) =
        spawn_test_gateway(config, "upstream-stream-failure").await;
    let client = reqwest::Client::new();

    let response = client
        .post(format!("http://{gateway_addr}/openai/v1/responses"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(
            json!({
                "model": "claude-test",
                "stream": true,
                "input": "hello"
            })
            .to_string(),
        )
        .send()
        .await
        .expect("send streaming request");

    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        if chunk.is_err() {
            break;
        }
    }

    sleep(Duration::from_millis(250)).await;

    let logs: Value = client
        .get(format!("http://{gateway_addr}/api/logs?limit=1"))
        .send()
        .await
        .expect("request logs after upstream stream failure")
        .json()
        .await
        .expect("decode logs after upstream stream failure");
    let item = logs
        .get("items")
        .and_then(Value::as_array)
        .and_then(|items| items.first())
        .expect("stream log item");
    assert_eq!(item.get("status_code").and_then(Value::as_i64), Some(502));
    assert_eq!(
        item.get("error_source").and_then(Value::as_str),
        Some("upstream")
    );
    assert!(
        item.get("error")
            .and_then(Value::as_str)
            .is_some_and(|error| error.contains("error sending request")
                || error.contains("upstream stream read failed"))
    );

    gateway_handle.abort();
    upstream_handle.abort();
    let _ = stdfs::remove_dir_all(home_dir);
}

#[tokio::test]
async fn upstream_failures_do_not_leak_url_to_client() {
    // Point the provider at a port that is allocated-then-released so the
    // upstream connect fails fast with a reqwest error whose Display embeds the
    // URL. The client (holding only a gateway key) must see a generic category,
    // never the upstream host/port.
    let closed_addr = {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("bind closed port");
        listener.local_addr().expect("local addr")
    };

    let mut config = GatewayConfig::default();
    config.providers = vec![cc_gw_core::config::ProviderConfig {
        id: "unreachable".to_string(),
        label: "Unreachable".to_string(),
        base_url: format!("http://{closed_addr}"),
        provider_type: Some("anthropic".to_string()),
        default_model: Some("claude-test".to_string()),
        models: vec![cc_gw_core::config::ProviderModelConfig {
            id: "claude-test".to_string(),
            label: Some("Claude Test".to_string()),
            ..Default::default()
        }],
        ..cc_gw_core::config::ProviderConfig::default()
    }];
    config.defaults.completion = Some("claude-test".to_string());
    if let Some(openai_routing) = config.endpoint_routing.get_mut("openai") {
        openai_routing.defaults.completion = Some("claude-test".to_string());
    }

    let (home_dir, gateway_addr, gateway_handle) =
        spawn_test_gateway(config, "upstream-url-leak").await;
    let client = reqwest::Client::new();

    let response = client
        .post(format!("http://{gateway_addr}/openai/v1/responses"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(
            json!({
                "model": "claude-test",
                "input": "hello"
            })
            .to_string(),
        )
        .send()
        .await
        .expect("send request to unreachable upstream");

    assert_eq!(response.status().as_u16(), 502);
    let body: Value = response.json().await.expect("decode error body");
    let message = body
        .get("error")
        .and_then(|error| error.get("message"))
        .and_then(Value::as_str)
        .expect("error.message present");
    assert!(
        !message.contains(&closed_addr.to_string()),
        "client error leaked upstream address: {message}"
    );
    assert!(
        message.contains("upstream"),
        "expected a generic upstream category, got: {message}"
    );

    gateway_handle.abort();
    let _ = stdfs::remove_dir_all(home_dir);
}

#[tokio::test]
async fn trailing_upstream_stream_errors_after_terminal_event_are_logged_as_success() {
    let (upstream_addr, upstream_handle) =
        spawn_bad_chunked_anthropic_upstream_after_terminal().await;

    let mut config = GatewayConfig::default();
    config.providers = vec![cc_gw_core::config::ProviderConfig {
        id: "mock-anthropic".to_string(),
        label: "Mock Anthropic".to_string(),
        base_url: format!("http://{upstream_addr}"),
        provider_type: Some("anthropic".to_string()),
        default_model: Some("claude-test".to_string()),
        models: vec![cc_gw_core::config::ProviderModelConfig {
            id: "claude-test".to_string(),
            label: Some("Claude Test".to_string()),
            ..Default::default()
        }],
        ..cc_gw_core::config::ProviderConfig::default()
    }];
    config.defaults.completion = Some("claude-test".to_string());
    if let Some(openai_routing) = config.endpoint_routing.get_mut("openai") {
        openai_routing.defaults.completion = Some("claude-test".to_string());
    }

    let (home_dir, gateway_addr, gateway_handle) =
        spawn_test_gateway(config, "trailing-upstream-stream-failure").await;
    let client = reqwest::Client::new();

    let response = client
        .post(format!("http://{gateway_addr}/openai/v1/responses"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(
            json!({
                "model": "claude-test",
                "stream": true,
                "input": "hello"
            })
            .to_string(),
        )
        .send()
        .await
        .expect("send streaming request");

    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        if chunk.is_err() {
            break;
        }
    }

    sleep(Duration::from_millis(250)).await;

    let logs: Value = client
        .get(format!("http://{gateway_addr}/api/logs?limit=1"))
        .send()
        .await
        .expect("request logs after trailing upstream stream failure")
        .json()
        .await
        .expect("decode logs after trailing upstream stream failure");
    let item = logs
        .get("items")
        .and_then(Value::as_array)
        .and_then(|items| items.first())
        .expect("stream log item");
    assert_eq!(item.get("status_code").and_then(Value::as_i64), Some(200));
    assert_eq!(item.get("error").and_then(Value::as_str), None);
    assert_eq!(item.get("error_source").and_then(Value::as_str), None);

    let success_logs: Value = client
        .get(format!(
            "http://{gateway_addr}/api/logs?status=success&limit=10"
        ))
        .send()
        .await
        .expect("request success logs")
        .json()
        .await
        .expect("decode success logs");
    assert_eq!(success_logs.get("total").and_then(Value::as_u64), Some(1));

    gateway_handle.abort();
    upstream_handle.abort();
    let _ = stdfs::remove_dir_all(home_dir);
}

#[tokio::test]
async fn anthropic_to_openai_retry_drops_metadata_and_tool_choice() {
    let attempts = Arc::new(Mutex::new(Vec::<Value>::new()));
    let attempts_for_route = Arc::clone(&attempts);
    let upstream = Router::new().route(
        "/v1/chat/completions",
        post(move |AxumJson(payload): AxumJson<Value>| {
            let attempts = Arc::clone(&attempts_for_route);
            async move {
                record_payload(&attempts, &payload);
                if payload.get("metadata").is_some() || payload.get("tool_choice").is_some() {
                    (
                        StatusCode::BAD_REQUEST,
                        Json(json!({ "error": "unsupported metadata/tool_choice" })),
                    )
                        .into_response()
                } else {
                    Json(json!({
                        "choices": [{
                            "message": { "content": "retry-ok" }
                        }],
                        "usage": {
                            "prompt_tokens": 4,
                            "completion_tokens": 2
                        }
                    }))
                    .into_response()
                }
            }
        }),
    );
    let (upstream_addr, upstream_handle) = spawn_router(upstream).await;

    let mut config = GatewayConfig::default();
    config.providers = vec![cc_gw_core::config::ProviderConfig {
        id: "retry-openai".to_string(),
        label: "Retry OpenAI".to_string(),
        base_url: format!("http://{upstream_addr}"),
        provider_type: Some("openai".to_string()),
        default_model: Some("gpt-test".to_string()),
        models: vec![cc_gw_core::config::ProviderModelConfig {
            id: "gpt-test".to_string(),
            label: Some("GPT Test".to_string()),
            ..Default::default()
        }],
        ..cc_gw_core::config::ProviderConfig::default()
    }];
    config.defaults.completion = Some("retry-openai:gpt-test".to_string());
    if let Some(anthropic) = config.endpoint_routing.get_mut("anthropic") {
        anthropic.defaults.completion = Some("retry-openai:gpt-test".to_string());
        anthropic.compatibility =
            Some(cc_gw_core::config::EndpointCompatibilityConfig { enabled: true });
    }

    let (home_dir, gateway_addr, gateway_handle) =
        spawn_test_gateway(config, "anthropic-retry").await;
    let client = reqwest::Client::new();

    let response: Value = client
        .post(format!("http://{gateway_addr}/v1/messages"))
        .json(&json!({
            "model": "claude-test",
            "max_tokens": 128,
            "metadata": { "user_id": "user-1" },
            "tool_choice": { "type": "tool", "name": "lookup" },
            "messages": [{
                "role": "user",
                "content": [{ "type": "text", "text": "hello" }]
            }]
        }))
        .send()
        .await
        .expect("send anthropic request")
        .json()
        .await
        .expect("decode anthropic response");

    assert_eq!(
        response
            .get("content")
            .and_then(Value::as_array)
            .and_then(|items| items.first())
            .and_then(|item| item.get("text"))
            .and_then(Value::as_str),
        Some("retry-ok")
    );

    let recorded = attempts.lock().expect("lock attempts");
    assert_eq!(recorded.len(), 2);
    assert!(recorded[0].get("metadata").is_some());
    assert!(recorded[0].get("tool_choice").is_some());
    assert!(recorded[1].get("metadata").is_none());
    assert!(recorded[1].get("tool_choice").is_none());

    gateway_handle.abort();
    upstream_handle.abort();
    let _ = stdfs::remove_dir_all(home_dir);
}

#[tokio::test]
async fn anthropic_to_openai_does_not_retry_when_compatibility_disabled() {
    let attempts = Arc::new(Mutex::new(Vec::<Value>::new()));
    let attempts_for_route = Arc::clone(&attempts);
    let upstream = Router::new().route(
        "/v1/chat/completions",
        post(move |AxumJson(payload): AxumJson<Value>| {
            let attempts = Arc::clone(&attempts_for_route);
            async move {
                record_payload(&attempts, &payload);
                (
                    StatusCode::BAD_REQUEST,
                    Json(json!({ "error": "unsupported metadata/tool_choice" })),
                )
                    .into_response()
            }
        }),
    );
    let (upstream_addr, upstream_handle) = spawn_router(upstream).await;

    let mut config = GatewayConfig::default();
    config.providers = vec![cc_gw_core::config::ProviderConfig {
        id: "strict-openai".to_string(),
        label: "Strict OpenAI".to_string(),
        base_url: format!("http://{upstream_addr}"),
        provider_type: Some("openai".to_string()),
        default_model: Some("gpt-test".to_string()),
        models: vec![cc_gw_core::config::ProviderModelConfig {
            id: "gpt-test".to_string(),
            label: Some("GPT Test".to_string()),
            ..Default::default()
        }],
        ..cc_gw_core::config::ProviderConfig::default()
    }];
    config.defaults.completion = Some("strict-openai:gpt-test".to_string());
    if let Some(anthropic) = config.endpoint_routing.get_mut("anthropic") {
        anthropic.defaults.completion = Some("strict-openai:gpt-test".to_string());
    }

    let (home_dir, gateway_addr, gateway_handle) =
        spawn_test_gateway(config, "anthropic-openai-compat-disabled").await;
    let client = reqwest::Client::new();

    let response = client
        .post(format!("http://{gateway_addr}/v1/messages"))
        .json(&json!({
            "model": "claude-test",
            "max_tokens": 128,
            "metadata": { "user_id": "user-1" },
            "tool_choice": { "type": "tool", "name": "lookup" },
            "messages": [{
                "role": "user",
                "content": [{ "type": "text", "text": "hello" }]
            }]
        }))
        .send()
        .await
        .expect("send anthropic request");
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);

    let recorded = attempts.lock().expect("lock attempts");
    assert_eq!(recorded.len(), 1);
    assert!(recorded[0].get("metadata").is_some());
    assert!(recorded[0].get("tool_choice").is_some());

    gateway_handle.abort();
    upstream_handle.abort();
    let _ = stdfs::remove_dir_all(home_dir);
}

#[tokio::test]
async fn anthropic_to_openai_retry_summarizes_tool_roundtrip_and_normalizes_tokens() {
    let attempts = Arc::new(Mutex::new(Vec::<Value>::new()));
    let attempts_for_route = Arc::clone(&attempts);
    let upstream = Router::new().route(
        "/v1/chat/completions",
        post(move |AxumJson(payload): AxumJson<Value>| {
            let attempts = Arc::clone(&attempts_for_route);
            async move {
                record_payload(&attempts, &payload);
                let has_unsupported_tooling = payload
                    .get("messages")
                    .and_then(Value::as_array)
                    .is_some_and(|messages| {
                        messages.iter().any(|message| {
                            message.get("role").and_then(Value::as_str) == Some("tool")
                                || message.get("tool_calls").is_some()
                        })
                    });
                let has_unsupported_tokens = payload.get("max_completion_tokens").is_some();
                if has_unsupported_tooling || has_unsupported_tokens {
                    (
                        StatusCode::BAD_REQUEST,
                        Json(json!({
                            "error": {
                                "message": "未正常接收到prompt参数。",
                                "type": "invalid_request_error"
                            }
                        })),
                    )
                        .into_response()
                } else {
                    Json(json!({
                        "choices": [{
                            "message": {
                                "content": "我继续看核心 crate。",
                                "tool_calls": [{
                                    "id": "call_read_lib",
                                    "type": "function",
                                    "function": {
                                        "name": "Read",
                                        "arguments": "{\"file_path\":\"/Users/chenpu/workspace/claude-code/cc-gw2/crates/cc-gw-core/src/lib.rs\"}"
                                    }
                                }]
                            },
                            "finish_reason": "tool_calls"
                        }],
                        "usage": {
                            "prompt_tokens": 4,
                            "completion_tokens": 2
                        }
                    }))
                    .into_response()
                }
            }
        }),
    );
    let (upstream_addr, upstream_handle) = spawn_router(upstream).await;

    let mut config = GatewayConfig::default();
    config.providers = vec![cc_gw_core::config::ProviderConfig {
        id: "compat-openai".to_string(),
        label: "Compat OpenAI".to_string(),
        base_url: format!("http://{upstream_addr}"),
        provider_type: Some("openai".to_string()),
        default_model: Some("gpt-test".to_string()),
        models: vec![cc_gw_core::config::ProviderModelConfig {
            id: "gpt-test".to_string(),
            label: Some("GPT Test".to_string()),
            ..Default::default()
        }],
        ..cc_gw_core::config::ProviderConfig::default()
    }];
    config.defaults.completion = Some("compat-openai:gpt-test".to_string());
    if let Some(anthropic) = config.endpoint_routing.get_mut("anthropic") {
        anthropic.defaults.completion = Some("compat-openai:gpt-test".to_string());
        anthropic.compatibility =
            Some(cc_gw_core::config::EndpointCompatibilityConfig { enabled: true });
    }

    let (home_dir, gateway_addr, gateway_handle) =
        spawn_test_gateway(config, "anthropic-openai-tool-roundtrip-compat").await;
    let client = reqwest::Client::new();
    let request_body = json!({
        "model": "claude-test",
        "max_tokens": 128,
        "thinking": true,
        "metadata": { "user_id": "user-1" },
        "tools": [{
            "name": "lookup",
            "description": "Lookup data",
            "input_schema": { "type": "object", "properties": {} }
        }],
        "messages": [
            {
                "role": "assistant",
                "content": [{
                    "type": "tool_use",
                    "id": "toolu_1",
                    "name": "lookup",
                    "input": { "q": "weather" }
                }]
            },
            {
                "role": "user",
                "content": [{
                    "type": "tool_result",
                    "tool_use_id": "toolu_1",
                    "content": [{ "type": "text", "text": "sunny" }]
                }]
            }
        ]
    });

    let response: Value = client
        .post(format!("http://{gateway_addr}/v1/messages"))
        .json(&request_body)
        .send()
        .await
        .expect("send anthropic request")
        .json()
        .await
        .expect("decode anthropic response");

    assert!(
        response
            .get("content")
            .and_then(Value::as_array)
            .is_some_and(|items| items.iter().any(|item| {
                item.get("type").and_then(Value::as_str) == Some("tool_use")
                    && item.get("name").and_then(Value::as_str) == Some("Read")
                    && item.get("id").and_then(Value::as_str) == Some("call_read_lib")
            }))
    );

    let recorded = attempts.lock().expect("lock attempts");
    assert_eq!(recorded.len(), 3);
    assert!(recorded[0].get("tools").is_some());
    assert!(recorded[0].get("max_completion_tokens").is_some());
    assert!(
        recorded[0]
            .get("messages")
            .and_then(Value::as_array)
            .is_some_and(|messages| {
                messages.iter().any(|message| {
                    message.get("role").and_then(Value::as_str) == Some("tool")
                        || message.get("tool_calls").is_some()
                })
            })
    );
    assert!(recorded[1].get("metadata").is_none());
    assert!(recorded[1].get("tools").is_some());
    assert!(recorded[1].get("max_completion_tokens").is_some());
    assert!(recorded[2].get("tools").is_some());
    assert!(recorded[2].get("max_completion_tokens").is_none());
    assert_eq!(recorded[2].get("max_tokens"), Some(&json!(128)));
    assert!(
        recorded[2]
            .get("messages")
            .and_then(Value::as_array)
            .is_some_and(|messages| {
                messages.iter().all(|message| {
                    message.get("role").and_then(Value::as_str) != Some("tool")
                        && message.get("tool_calls").is_none()
                })
            })
    );
    drop(recorded);

    let cached_response: Value = client
        .post(format!("http://{gateway_addr}/v1/messages"))
        .json(&request_body)
        .send()
        .await
        .expect("send cached anthropic request")
        .json()
        .await
        .expect("decode cached anthropic response");
    assert!(
        cached_response
            .get("content")
            .and_then(Value::as_array)
            .is_some_and(|items| items.iter().any(|item| {
                item.get("type").and_then(Value::as_str) == Some("tool_use")
                    && item.get("name").and_then(Value::as_str) == Some("Read")
                    && item.get("id").and_then(Value::as_str) == Some("call_read_lib")
            }))
    );
    let recorded = attempts.lock().expect("lock attempts");
    assert_eq!(recorded.len(), 4);
    assert!(recorded[3].get("tools").is_some());
    assert!(recorded[3].get("max_completion_tokens").is_none());
    assert_eq!(recorded[3].get("max_tokens"), Some(&json!(128)));
    assert!(
        recorded[3]
            .get("messages")
            .and_then(Value::as_array)
            .is_some_and(|messages| {
                messages.iter().all(|message| {
                    message.get("role").and_then(Value::as_str) != Some("tool")
                        && message.get("tool_calls").is_none()
                })
            })
    );
    drop(recorded);

    let no_tools_response: Value = client
        .post(format!("http://{gateway_addr}/v1/messages"))
        .json(&json!({
            "model": "claude-test",
            "max_tokens": 128,
            "thinking": true,
            "metadata": { "user_id": "user-1" },
            "messages": [{
                "role": "user",
                "content": [{ "type": "text", "text": "hello" }]
            }]
        }))
        .send()
        .await
        .expect("send no-tools anthropic request")
        .json()
        .await
        .expect("decode no-tools anthropic response");
    assert!(
        no_tools_response
            .get("content")
            .and_then(Value::as_array)
            .is_some_and(|items| items.iter().any(|item| {
                item.get("type").and_then(Value::as_str) == Some("tool_use")
                    && item.get("id").and_then(Value::as_str) == Some("call_read_lib")
            }))
    );
    let recorded = attempts.lock().expect("lock attempts");
    assert_eq!(recorded.len(), 7);
    assert!(recorded[4].get("tools").is_none());
    assert!(recorded[4].get("max_completion_tokens").is_some());
    assert!(recorded[5].get("tools").is_none());
    assert!(recorded[5].get("max_completion_tokens").is_some());
    assert!(recorded[6].get("tools").is_none());
    assert!(recorded[6].get("max_completion_tokens").is_none());
    assert_eq!(recorded[6].get("max_tokens"), Some(&json!(128)));
    drop(recorded);

    let db_path = home_dir.join("data").join("gateway.db");
    let events = list_events(
        &db_path,
        10,
        None,
        None,
        Some("openai_compatibility_mode_learned"),
        None,
    )
    .expect("list compatibility mode events");
    assert_eq!(events.events.len(), 2);
    assert_eq!(events.events[0].mode.as_deref(), Some("compatibility"));
    assert_eq!(
        events.events[1].mode.as_deref(),
        Some("tool-history-compatibility")
    );
    assert_eq!(
        events.events[0]
            .details
            .as_ref()
            .and_then(|details| details.get("provider"))
            .and_then(Value::as_str),
        Some("compat-openai")
    );
    assert_eq!(
        events.events[0]
            .details
            .as_ref()
            .and_then(|details| details.get("targetProtocol"))
            .and_then(Value::as_str),
        Some("openai-chat")
    );

    gateway_handle.abort();
    upstream_handle.abort();
    let _ = stdfs::remove_dir_all(home_dir);
}

#[tokio::test]
async fn openai_responses_same_protocol_does_not_retry_or_strip_metadata() {
    let attempts = Arc::new(Mutex::new(Vec::<Value>::new()));
    let attempts_for_route = Arc::clone(&attempts);
    let upstream = Router::new().route(
        "/v1/responses",
        post(move |AxumJson(payload): AxumJson<Value>| {
            let attempts = Arc::clone(&attempts_for_route);
            async move {
                record_payload(&attempts, &payload);
                if payload.get("metadata").is_some() || payload.get("tool_choice").is_some() {
                    (
                        StatusCode::BAD_REQUEST,
                        Json(json!({ "error": "unsupported metadata/tool_choice" })),
                    )
                        .into_response()
                } else {
                    Json(json!({
                        "object": "response",
                        "output": [{
                            "id": "out_1",
                            "type": "output_message",
                            "role": "assistant",
                            "content": [{
                                "type": "output_text",
                                "text": "retry-ok"
                            }]
                        }],
                        "output_text": "retry-ok",
                        "usage": {
                            "input_tokens": 4,
                            "output_tokens": 2
                        }
                    }))
                    .into_response()
                }
            }
        }),
    );
    let (upstream_addr, upstream_handle) = spawn_router(upstream).await;

    let mut config = GatewayConfig::default();
    config.providers = vec![cc_gw_core::config::ProviderConfig {
        id: "retry-openai-responses".to_string(),
        label: "Retry OpenAI Responses".to_string(),
        base_url: format!("http://{upstream_addr}"),
        provider_type: Some("openai".to_string()),
        default_model: Some("gpt-test".to_string()),
        models: vec![cc_gw_core::config::ProviderModelConfig {
            id: "gpt-test".to_string(),
            label: Some("GPT Test".to_string()),
            ..Default::default()
        }],
        ..cc_gw_core::config::ProviderConfig::default()
    }];
    config.defaults.completion = Some("retry-openai-responses:gpt-test".to_string());
    if let Some(openai) = config.endpoint_routing.get_mut("openai") {
        openai.defaults.completion = Some("retry-openai-responses:gpt-test".to_string());
    }

    let (home_dir, gateway_addr, gateway_handle) =
        spawn_test_gateway(config, "responses-retry").await;
    let client = reqwest::Client::new();

    let response = client
        .post(format!("http://{gateway_addr}/openai/v1/responses"))
        .json(&json!({
            "model": "gpt-test",
            "metadata": { "user_id": "user-1" },
            "tool_choice": "auto",
            "input": "hello"
        }))
        .send()
        .await
        .expect("send responses request");
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);

    let recorded = attempts.lock().expect("lock attempts");
    assert_eq!(recorded.len(), 1);
    assert!(recorded[0].get("metadata").is_some());
    assert!(recorded[0].get("tool_choice").is_some());

    gateway_handle.abort();
    upstream_handle.abort();
    let _ = stdfs::remove_dir_all(home_dir);
}

#[tokio::test]
async fn openai_responses_from_anthropic_provider_emits_function_call_items() {
    let upstream = Router::new().route(
        "/v1/messages",
        post(|| async {
            Json(json!({
                "id": "msg_tool",
                "type": "message",
                "role": "assistant",
                "model": "claude-test",
                "content": [{
                    "type": "tool_use",
                    "id": "tool_1",
                    "name": "weather",
                    "input": { "city": "Paris" }
                }],
                "stop_reason": "tool_use",
                "stop_sequence": Value::Null,
                "usage": {
                    "input_tokens": 9,
                    "output_tokens": 2
                }
            }))
        }),
    );
    let (upstream_addr, upstream_handle) = spawn_router(upstream).await;

    let mut config = GatewayConfig::default();
    config.providers = vec![cc_gw_core::config::ProviderConfig {
        id: "mock-anthropic".to_string(),
        label: "Mock Anthropic".to_string(),
        base_url: format!("http://{upstream_addr}"),
        provider_type: Some("anthropic".to_string()),
        default_model: Some("claude-test".to_string()),
        models: vec![cc_gw_core::config::ProviderModelConfig {
            id: "claude-test".to_string(),
            label: Some("Claude Test".to_string()),
            ..Default::default()
        }],
        ..cc_gw_core::config::ProviderConfig::default()
    }];
    config.defaults.completion = Some("claude-test".to_string());
    if let Some(openai_routing) = config.endpoint_routing.get_mut("openai") {
        openai_routing.defaults.completion = Some("claude-test".to_string());
    }

    let (home_dir, gateway_addr, gateway_handle) =
        spawn_test_gateway(config, "responses-function-call-shape").await;
    let client = reqwest::Client::new();

    let response: Value = client
        .post(format!("http://{gateway_addr}/openai/v1/responses"))
        .header(header::CONTENT_TYPE, "application/json")
        .json(&json!({
            "model": "claude-test",
            "input": "hello"
        }))
        .send()
        .await
        .expect("send non-stream responses request")
        .json()
        .await
        .expect("decode non-stream responses response");

    assert_eq!(
        response["output"][0]["content"][0]["type"].as_str(),
        Some("function_call")
    );
    assert_eq!(
        response["output"][0]["content"][0]["call_id"].as_str(),
        Some("tool_1")
    );
    assert_eq!(
        response["output"][0]["content"][0]["arguments"].as_str(),
        Some("{\"city\":\"Paris\"}")
    );
    assert_eq!(response["status"].as_str(), Some("requires_action"));

    gateway_handle.abort();
    upstream_handle.abort();
    let _ = stdfs::remove_dir_all(home_dir);
}

#[tokio::test]
async fn anthropic_messages_can_target_anthropic_compatible_custom_provider() {
    let captures = Arc::new(Mutex::new(Vec::<Value>::new()));
    let captures_for_route = Arc::clone(&captures);
    let upstream = Router::new().route(
        "/anthropic/v1/messages",
        post(move |headers: HeaderMap, AxumJson(payload): AxumJson<Value>| {
            let captures = Arc::clone(&captures_for_route);
            async move {
                captures.lock().expect("lock captures").push(json!({
                    "anthropic_version": headers.get("anthropic-version").and_then(|value| value.to_str().ok()),
                    "authorization": headers.get("authorization").and_then(|value| value.to_str().ok()),
                    "payload": payload,
                }));
                Json(json!({
                    "id": "msg_custom",
                    "type": "message",
                    "role": "assistant",
                    "model": "claude-compatible",
                    "content": [{
                        "type": "text",
                        "text": "anthropic-compatible-ok"
                    }],
                    "stop_reason": "end_turn",
                    "stop_sequence": Value::Null,
                    "usage": {
                        "input_tokens": 4,
                        "output_tokens": 2
                    }
                }))
            }
        }),
    );
    let (upstream_addr, upstream_handle) = spawn_router(upstream).await;

    let mut config = GatewayConfig::default();
    config.providers = vec![cc_gw_core::config::ProviderConfig {
        id: "custom-anthropic".to_string(),
        label: "Custom Anthropic Compatible".to_string(),
        api_key: Some("provider-secret".to_string()),
        base_url: format!("http://{upstream_addr}/anthropic"),
        provider_type: Some("custom".to_string()),
        extra_headers: [("anthropic-version".to_string(), "2023-06-01".to_string())]
            .into_iter()
            .collect(),
        default_model: Some("claude-compatible".to_string()),
        models: vec![cc_gw_core::config::ProviderModelConfig {
            id: "claude-compatible".to_string(),
            label: Some("Claude Compatible".to_string()),
            ..Default::default()
        }],
        ..cc_gw_core::config::ProviderConfig::default()
    }];
    config.defaults.completion = Some("custom-anthropic:claude-compatible".to_string());
    if let Some(anthropic_routing) = config.endpoint_routing.get_mut("anthropic") {
        anthropic_routing.defaults.completion =
            Some("custom-anthropic:claude-compatible".to_string());
    }

    let (home_dir, gateway_addr, gateway_handle) =
        spawn_test_gateway(config, "anthropic-compatible-custom-provider").await;
    let client = reqwest::Client::new();

    let response: Value = client
        .post(format!("http://{gateway_addr}/v1/messages"))
        .json(&json!({
            "model": "claude-compatible",
            "max_tokens": 32,
            "messages": [{
                "role": "user",
                "content": [{ "type": "text", "text": "hello" }]
            }]
        }))
        .send()
        .await
        .expect("send anthropic request")
        .json()
        .await
        .expect("decode anthropic response");

    assert_eq!(
        response["content"][0]["text"].as_str(),
        Some("anthropic-compatible-ok")
    );

    let captures = captures.lock().expect("lock captures");
    assert_eq!(captures.len(), 1);
    assert_eq!(
        captures[0]["anthropic_version"].as_str(),
        Some("2023-06-01")
    );
    assert_eq!(
        captures[0]["authorization"].as_str(),
        Some("Bearer provider-secret")
    );
    assert_eq!(
        captures[0]["payload"]["messages"][0]["content"][0]["text"].as_str(),
        Some("hello")
    );

    gateway_handle.abort();
    upstream_handle.abort();
    let _ = stdfs::remove_dir_all(home_dir);
}

#[tokio::test]
async fn anthropic_to_openai_maps_required_tool_choice_and_stop_sequences() {
    let attempts = Arc::new(Mutex::new(Vec::<Value>::new()));
    let attempts_for_route = Arc::clone(&attempts);
    let upstream = Router::new().route(
        "/v1/chat/completions",
        post(move |AxumJson(payload): AxumJson<Value>| {
            let attempts = Arc::clone(&attempts_for_route);
            async move {
                record_payload(&attempts, &payload);
                Json(json!({
                    "choices": [{
                        "message": { "content": "ok" },
                        "finish_reason": "stop"
                    }],
                    "usage": {
                        "prompt_tokens": 4,
                        "completion_tokens": 2
                    }
                }))
            }
        }),
    );
    let (upstream_addr, upstream_handle) = spawn_router(upstream).await;

    let mut config = GatewayConfig::default();
    config.providers = vec![cc_gw_core::config::ProviderConfig {
        id: "mapped-openai".to_string(),
        label: "Mapped OpenAI".to_string(),
        base_url: format!("http://{upstream_addr}"),
        provider_type: Some("openai".to_string()),
        default_model: Some("gpt-test".to_string()),
        models: vec![cc_gw_core::config::ProviderModelConfig {
            id: "gpt-test".to_string(),
            label: Some("GPT Test".to_string()),
            ..Default::default()
        }],
        ..cc_gw_core::config::ProviderConfig::default()
    }];
    config.defaults.completion = Some("mapped-openai:gpt-test".to_string());
    if let Some(anthropic) = config.endpoint_routing.get_mut("anthropic") {
        anthropic.defaults.completion = Some("mapped-openai:gpt-test".to_string());
    }

    let (home_dir, gateway_addr, gateway_handle) =
        spawn_test_gateway(config, "anthropic-openai-stop-mapping").await;
    let client = reqwest::Client::new();

    let response = client
        .post(format!("http://{gateway_addr}/v1/messages"))
        .json(&json!({
            "model": "claude-test",
            "max_tokens": 128,
            "tool_choice": { "type": "any" },
            "stop_sequences": ["END"],
            "messages": [{
                "role": "user",
                "content": [{ "type": "text", "text": "hello" }]
            }]
        }))
        .send()
        .await
        .expect("send anthropic request");
    assert_eq!(response.status(), StatusCode::OK);

    let recorded = attempts.lock().expect("lock attempts");
    assert_eq!(recorded.len(), 1);
    assert_eq!(recorded[0].get("tool_choice"), Some(&json!("required")));
    assert_eq!(recorded[0].get("stop"), Some(&json!(["END"])));
    assert!(recorded[0].get("stop_sequences").is_none());

    gateway_handle.abort();
    upstream_handle.abort();
    let _ = stdfs::remove_dir_all(home_dir);
}

#[tokio::test]
async fn anthropic_to_openai_routes_thinking_requests_to_explicit_responses_provider() {
    let attempts = Arc::new(Mutex::new(Vec::<Value>::new()));
    let attempts_for_route = Arc::clone(&attempts);
    let upstream = Router::new().route(
        "/v1/responses",
        post(move |AxumJson(payload): AxumJson<Value>| {
            let attempts = Arc::clone(&attempts_for_route);
            async move {
                record_payload(&attempts, &payload);
                Json(json!({
                    "id": "resp_123",
                    "object": "response",
                    "model": "gpt-test",
                    "status": "completed",
                    "output": [{
                        "id": "out_1",
                        "type": "output_message",
                        "role": "assistant",
                        "content": [{
                            "type": "output_text",
                            "text": "ok"
                        }]
                    }],
                    "usage": {
                        "input_tokens": 4,
                        "output_tokens": 2
                    }
                }))
            }
        }),
    );
    let (upstream_addr, upstream_handle) = spawn_router(upstream).await;

    let mut config = GatewayConfig::default();
    config.providers = vec![cc_gw_core::config::ProviderConfig {
        id: "responses-openai".to_string(),
        label: "Responses OpenAI".to_string(),
        base_url: format!("http://{upstream_addr}"),
        provider_type: Some("openai-responses".to_string()),
        default_model: Some("gpt-test".to_string()),
        models: vec![cc_gw_core::config::ProviderModelConfig {
            id: "gpt-test".to_string(),
            label: Some("GPT Test".to_string()),
            ..Default::default()
        }],
        ..cc_gw_core::config::ProviderConfig::default()
    }];
    config.defaults.completion = Some("responses-openai:gpt-test".to_string());
    if let Some(anthropic) = config.endpoint_routing.get_mut("anthropic") {
        anthropic.defaults.completion = Some("responses-openai:gpt-test".to_string());
    }

    let (home_dir, gateway_addr, gateway_handle) =
        spawn_test_gateway(config, "anthropic-openai-responses-thinking-route").await;
    let client = reqwest::Client::new();

    let response = client
        .post(format!("http://{gateway_addr}/v1/messages"))
        .json(&json!({
            "model": "claude-test",
            "max_tokens": 128,
            "thinking": { "type": "enabled", "budget_tokens": 2048 },
            "messages": [{
                "role": "assistant",
                "content": [{ "type": "thinking", "thinking": "considering options" }]
            }, {
                "role": "user",
                "content": [{ "type": "text", "text": "hello" }]
            }]
        }))
        .send()
        .await
        .expect("send anthropic request");
    assert_eq!(response.status(), StatusCode::OK);

    let recorded = attempts.lock().expect("lock attempts");
    assert_eq!(recorded.len(), 1);
    assert_eq!(
        recorded[0].get("reasoning"),
        Some(&json!({ "effort": "medium", "summary": "auto" }))
    );
    assert_eq!(recorded[0]["input"][0]["type"].as_str(), Some("reasoning"));
    assert_eq!(
        recorded[0]["input"][0]["summary"][0]["text"].as_str(),
        Some("considering options")
    );
    assert_eq!(recorded[0]["input"][1]["role"].as_str(), Some("user"));

    gateway_handle.abort();
    upstream_handle.abort();
    let _ = stdfs::remove_dir_all(home_dir);
}

#[tokio::test]
async fn anthropic_to_openai_non_stream_error_is_converted_to_anthropic_shape() {
    let upstream = Router::new().route(
        "/v1/chat/completions",
        post(|| async {
            (
                StatusCode::BAD_REQUEST,
                Json(json!({
                    "error": {
                        "message": "bad openai request",
                        "type": "invalid_request_error",
                        "code": "bad_request"
                    }
                })),
            )
        }),
    );
    let (upstream_addr, upstream_handle) = spawn_router(upstream).await;

    let mut config = GatewayConfig::default();
    config.providers = vec![cc_gw_core::config::ProviderConfig {
        id: "mapped-openai".to_string(),
        label: "Mapped OpenAI".to_string(),
        base_url: format!("http://{upstream_addr}"),
        provider_type: Some("openai".to_string()),
        default_model: Some("gpt-test".to_string()),
        models: vec![cc_gw_core::config::ProviderModelConfig {
            id: "gpt-test".to_string(),
            label: Some("GPT Test".to_string()),
            ..Default::default()
        }],
        ..cc_gw_core::config::ProviderConfig::default()
    }];
    config.defaults.completion = Some("mapped-openai:gpt-test".to_string());
    if let Some(anthropic) = config.endpoint_routing.get_mut("anthropic") {
        anthropic.defaults.completion = Some("mapped-openai:gpt-test".to_string());
    }

    let (home_dir, gateway_addr, gateway_handle) =
        spawn_test_gateway(config, "anthropic-openai-error-conversion").await;
    let client = reqwest::Client::new();

    let response = client
        .post(format!("http://{gateway_addr}/v1/messages"))
        .json(&json!({
            "model": "claude-test",
            "max_tokens": 64,
            "messages": [{
                "role": "user",
                "content": [{ "type": "text", "text": "hello" }]
            }]
        }))
        .send()
        .await
        .expect("send anthropic request");
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);

    let body: Value = response.json().await.expect("decode anthropic error");
    assert_eq!(body.get("type").and_then(Value::as_str), Some("error"));
    assert_eq!(
        body.get("error")
            .and_then(|error| error.get("type"))
            .and_then(Value::as_str),
        Some("invalid_request_error")
    );
    assert_eq!(
        body.get("error")
            .and_then(|error| error.get("message"))
            .and_then(Value::as_str),
        Some("bad openai request")
    );

    gateway_handle.abort();
    upstream_handle.abort();
    let _ = stdfs::remove_dir_all(home_dir);
}

#[tokio::test]
async fn anthropic_to_openai_non_json_error_uses_anthropic_error_fallback() {
    let upstream = Router::new().route(
        "/v1/chat/completions",
        post(|| async {
            (
                StatusCode::BAD_GATEWAY,
                [(header::CONTENT_TYPE, "text/html; charset=utf-8")],
                "<html><body>Internal gateway error</body></html>",
            )
        }),
    );
    let (upstream_addr, upstream_handle) = spawn_router(upstream).await;

    let mut config = GatewayConfig::default();
    config.providers = vec![cc_gw_core::config::ProviderConfig {
        id: "mapped-openai".to_string(),
        label: "Mapped OpenAI".to_string(),
        base_url: format!("http://{upstream_addr}"),
        provider_type: Some("openai".to_string()),
        default_model: Some("gpt-test".to_string()),
        models: vec![cc_gw_core::config::ProviderModelConfig {
            id: "gpt-test".to_string(),
            label: Some("GPT Test".to_string()),
            ..Default::default()
        }],
        ..cc_gw_core::config::ProviderConfig::default()
    }];
    config.defaults.completion = Some("mapped-openai:gpt-test".to_string());
    if let Some(anthropic) = config.endpoint_routing.get_mut("anthropic") {
        anthropic.defaults.completion = Some("mapped-openai:gpt-test".to_string());
    }

    let (home_dir, gateway_addr, gateway_handle) =
        spawn_test_gateway(config, "anthropic-openai-non-json-error-fallback").await;
    let client = reqwest::Client::new();

    let response = client
        .post(format!("http://{gateway_addr}/v1/messages"))
        .json(&json!({
            "model": "claude-test",
            "max_tokens": 64,
            "messages": [{
                "role": "user",
                "content": [{ "type": "text", "text": "hello" }]
            }]
        }))
        .send()
        .await
        .expect("send anthropic request");
    assert_eq!(response.status(), StatusCode::BAD_GATEWAY);

    let body: Value = response
        .json()
        .await
        .expect("decode anthropic fallback error");
    assert_eq!(body.get("type").and_then(Value::as_str), Some("error"));
    assert_eq!(
        body.get("error")
            .and_then(|error| error.get("type"))
            .and_then(Value::as_str),
        Some("api_error")
    );
    let message = body
        .get("error")
        .and_then(|error| error.get("message"))
        .and_then(Value::as_str)
        .unwrap_or_default();
    assert!(message.contains("upstream returned non-JSON error"));
    assert!(message.contains("Internal gateway error"));
    assert!(!message.contains("failed to decode upstream JSON"));

    let db_path = home_dir.join("data").join("gateway.db");
    let events = list_events(
        &db_path,
        10,
        None,
        None,
        Some("non_json_upstream_error_fallback"),
        None,
    )
    .expect("list non-json fallback events");
    assert_eq!(events.events.len(), 1);
    assert!(
        events.events[0]
            .message
            .as_deref()
            .is_some_and(|message| message.contains("upstream returned non-JSON error"))
    );
    assert_eq!(
        events.events[0]
            .details
            .as_ref()
            .and_then(|details| details.get("provider"))
            .and_then(Value::as_str),
        Some("mapped-openai")
    );
    assert_eq!(
        events.events[0]
            .details
            .as_ref()
            .and_then(|details| details.get("status"))
            .and_then(Value::as_u64),
        Some(502)
    );

    gateway_handle.abort();
    upstream_handle.abort();
    let _ = stdfs::remove_dir_all(home_dir);
}

#[tokio::test]
async fn anthropic_to_openai_stream_handshake_error_is_converted_to_anthropic_shape() {
    let upstream = Router::new().route(
        "/v1/chat/completions",
        post(|| async {
            (
                StatusCode::BAD_REQUEST,
                Json(json!({
                    "error": {
                        "message": "bad openai stream request",
                        "type": "invalid_request_error"
                    }
                })),
            )
        }),
    );
    let (upstream_addr, upstream_handle) = spawn_router(upstream).await;

    let mut config = GatewayConfig::default();
    config.providers = vec![cc_gw_core::config::ProviderConfig {
        id: "mapped-openai".to_string(),
        label: "Mapped OpenAI".to_string(),
        base_url: format!("http://{upstream_addr}"),
        provider_type: Some("openai".to_string()),
        default_model: Some("gpt-test".to_string()),
        models: vec![cc_gw_core::config::ProviderModelConfig {
            id: "gpt-test".to_string(),
            label: Some("GPT Test".to_string()),
            ..Default::default()
        }],
        ..cc_gw_core::config::ProviderConfig::default()
    }];
    config.defaults.completion = Some("mapped-openai:gpt-test".to_string());
    if let Some(anthropic) = config.endpoint_routing.get_mut("anthropic") {
        anthropic.defaults.completion = Some("mapped-openai:gpt-test".to_string());
    }

    let (home_dir, gateway_addr, gateway_handle) =
        spawn_test_gateway(config, "anthropic-openai-stream-error-conversion").await;
    let client = reqwest::Client::new();

    let response = client
        .post(format!("http://{gateway_addr}/v1/messages"))
        .json(&json!({
            "model": "claude-test",
            "max_tokens": 64,
            "stream": true,
            "messages": [{
                "role": "user",
                "content": [{ "type": "text", "text": "hello" }]
            }]
        }))
        .send()
        .await
        .expect("send anthropic streaming request");
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);

    let body: Value = response
        .json()
        .await
        .expect("decode anthropic stream error");
    assert_eq!(body.get("type").and_then(Value::as_str), Some("error"));
    assert_eq!(
        body.get("error")
            .and_then(|error| error.get("message"))
            .and_then(Value::as_str),
        Some("bad openai stream request")
    );

    gateway_handle.abort();
    upstream_handle.abort();
    let _ = stdfs::remove_dir_all(home_dir);
}

#[tokio::test]
async fn openai_to_anthropic_error_is_converted_to_openai_shape() {
    let upstream = Router::new().route(
        "/v1/messages",
        post(|| async {
            (
                StatusCode::BAD_REQUEST,
                Json(json!({
                    "type": "error",
                    "error": {
                        "type": "invalid_request_error",
                        "message": "bad anthropic request"
                    }
                })),
            )
        }),
    );
    let (upstream_addr, upstream_handle) = spawn_router(upstream).await;

    let mut config = GatewayConfig::default();
    config.providers = vec![cc_gw_core::config::ProviderConfig {
        id: "mock-anthropic".to_string(),
        label: "Mock Anthropic".to_string(),
        base_url: format!("http://{upstream_addr}"),
        provider_type: Some("anthropic".to_string()),
        default_model: Some("claude-test".to_string()),
        models: vec![cc_gw_core::config::ProviderModelConfig {
            id: "claude-test".to_string(),
            label: Some("Claude Test".to_string()),
            ..Default::default()
        }],
        ..cc_gw_core::config::ProviderConfig::default()
    }];
    config.defaults.completion = Some("claude-test".to_string());
    if let Some(openai_routing) = config.endpoint_routing.get_mut("openai") {
        openai_routing.defaults.completion = Some("claude-test".to_string());
    }

    let (home_dir, gateway_addr, gateway_handle) =
        spawn_test_gateway(config, "openai-anthropic-error-conversion").await;
    let client = reqwest::Client::new();

    let response = client
        .post(format!("http://{gateway_addr}/openai/v1/chat/completions"))
        .json(&json!({
            "model": "claude-test",
            "messages": [{ "role": "user", "content": "hello" }]
        }))
        .send()
        .await
        .expect("send openai request");
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);

    let body: Value = response.json().await.expect("decode openai error");
    assert_eq!(
        body.get("error")
            .and_then(|error| error.get("type"))
            .and_then(Value::as_str),
        Some("invalid_request_error")
    );
    assert_eq!(
        body.get("error")
            .and_then(|error| error.get("message"))
            .and_then(Value::as_str),
        Some("bad anthropic request")
    );

    gateway_handle.abort();
    upstream_handle.abort();
    let _ = stdfs::remove_dir_all(home_dir);
}

#[tokio::test]
async fn anthropic_to_custom_provider_strips_tooling_and_metadata() {
    let attempts = Arc::new(Mutex::new(Vec::<Value>::new()));
    let attempts_for_route = Arc::clone(&attempts);
    let upstream = Router::new().route(
        "/v1/chat/completions",
        post(move |AxumJson(payload): AxumJson<Value>| {
            let attempts = Arc::clone(&attempts_for_route);
            async move {
                record_payload(&attempts, &payload);
                Json(json!({
                    "choices": [{
                        "message": { "content": "custom-ok" }
                    }],
                    "usage": {
                        "prompt_tokens": 8,
                        "completion_tokens": 3
                    }
                }))
            }
        }),
    );
    let (upstream_addr, upstream_handle) = spawn_router(upstream).await;

    let mut config = GatewayConfig::default();
    config.providers = vec![cc_gw_core::config::ProviderConfig {
        id: "custom-openai".to_string(),
        label: "Custom OpenAI".to_string(),
        base_url: format!("http://{upstream_addr}"),
        provider_type: Some("custom".to_string()),
        default_model: Some("custom-model".to_string()),
        models: vec![cc_gw_core::config::ProviderModelConfig {
            id: "custom-model".to_string(),
            label: Some("Custom Model".to_string()),
            ..Default::default()
        }],
        ..cc_gw_core::config::ProviderConfig::default()
    }];
    config.defaults.completion = Some("custom-openai:custom-model".to_string());
    if let Some(anthropic) = config.endpoint_routing.get_mut("anthropic") {
        anthropic.defaults.completion = Some("custom-openai:custom-model".to_string());
        anthropic.compatibility =
            Some(cc_gw_core::config::EndpointCompatibilityConfig { enabled: true });
    }

    let (home_dir, gateway_addr, gateway_handle) =
        spawn_test_gateway(config, "anthropic-custom-provider").await;
    let client = reqwest::Client::new();

    let response = client
        .post(format!("http://{gateway_addr}/v1/messages"))
        .json(&json!({
            "model": "claude-test",
            "max_tokens": 128,
            "metadata": { "user_id": "user-2" },
            "tools": [{
                "name": "lookup",
                "description": "Lookup data",
                "input_schema": { "type": "object", "properties": {} }
            }],
            "tool_choice": { "type": "tool", "name": "lookup" },
            "messages": [
                {
                    "role": "assistant",
                    "content": [{
                        "type": "tool_use",
                        "id": "toolu_1",
                        "name": "lookup",
                        "input": { "q": "weather" }
                    }]
                },
                {
                    "role": "user",
                    "content": [{
                        "type": "tool_result",
                        "tool_use_id": "toolu_1",
                        "content": [{ "type": "text", "text": "sunny" }]
                    }]
                }
            ]
        }))
        .send()
        .await
        .expect("send anthropic request");
    assert_eq!(response.status(), StatusCode::OK);

    let recorded = attempts.lock().expect("lock attempts");
    assert_eq!(recorded.len(), 1);
    let forwarded = &recorded[0];
    assert!(forwarded.get("metadata").is_none());
    assert!(forwarded.get("tools").is_none());
    assert!(forwarded.get("tool_choice").is_none());
    assert!(
        forwarded
            .get("messages")
            .and_then(Value::as_array)
            .is_some_and(|messages| {
                messages.iter().all(|message| {
                    message.get("role").and_then(Value::as_str) != Some("tool")
                        && message.get("tool_calls").is_none()
                })
            })
    );

    gateway_handle.abort();
    upstream_handle.abort();
    let _ = stdfs::remove_dir_all(home_dir);
}

#[tokio::test]
async fn openai_responses_to_custom_provider_preserves_same_protocol_tooling() {
    let attempts = Arc::new(Mutex::new(Vec::<Value>::new()));
    let attempts_for_route = Arc::clone(&attempts);
    let upstream = Router::new().route(
        "/v1/responses",
        post(move |AxumJson(payload): AxumJson<Value>| {
            let attempts = Arc::clone(&attempts_for_route);
            async move {
                record_payload(&attempts, &payload);
                Json(json!({
                    "object": "response",
                    "output": [{
                        "id": "out_1",
                        "type": "output_message",
                        "role": "assistant",
                        "content": [{
                            "type": "output_text",
                            "text": "custom-ok"
                        }]
                    }],
                    "output_text": "custom-ok",
                    "usage": {
                        "input_tokens": 4,
                        "output_tokens": 2
                    }
                }))
            }
        }),
    );
    let (upstream_addr, upstream_handle) = spawn_router(upstream).await;

    let mut config = GatewayConfig::default();
    config.providers = vec![cc_gw_core::config::ProviderConfig {
        id: "custom-responses".to_string(),
        label: "Custom Responses".to_string(),
        base_url: format!("http://{upstream_addr}"),
        provider_type: Some("custom".to_string()),
        default_model: Some("custom-model".to_string()),
        models: vec![cc_gw_core::config::ProviderModelConfig {
            id: "custom-model".to_string(),
            label: Some("Custom Model".to_string()),
            ..Default::default()
        }],
        ..cc_gw_core::config::ProviderConfig::default()
    }];
    config.defaults.completion = Some("custom-responses:custom-model".to_string());

    let (home_dir, gateway_addr, gateway_handle) =
        spawn_test_gateway(config, "responses-custom-provider").await;
    let client = reqwest::Client::new();

    let response = client
        .post(format!("http://{gateway_addr}/openai/v1/responses"))
        .json(&json!({
            "model": "custom-model",
            "metadata": { "user_id": "user-2" },
            "tools": [{
                "type": "function",
                "function": {
                    "name": "lookup",
                    "parameters": { "type": "object", "properties": {} }
                }
            }],
            "tool_choice": "auto",
            "input": [
                {
                    "type": "function_call",
                    "call_id": "call_1",
                    "name": "lookup",
                    "arguments": "{\"q\":\"weather\"}"
                },
                {
                    "type": "function_call_output",
                    "call_id": "call_1",
                    "output": "sunny"
                }
            ]
        }))
        .send()
        .await
        .expect("send responses request");
    assert_eq!(response.status(), StatusCode::OK);

    let recorded = attempts.lock().expect("lock attempts");
    assert_eq!(recorded.len(), 1);
    let forwarded = &recorded[0];
    assert_eq!(
        forwarded.get("metadata"),
        Some(&json!({ "user_id": "user-2" }))
    );
    assert!(
        forwarded
            .get("tools")
            .and_then(Value::as_array)
            .is_some_and(|tools| !tools.is_empty())
    );
    assert_eq!(forwarded.get("tool_choice"), Some(&json!("auto")));
    assert!(
        forwarded
            .get("input")
            .and_then(Value::as_array)
            .is_some_and(|items| {
                items
                    .iter()
                    .any(|item| item.get("type").and_then(Value::as_str) == Some("function_call"))
                    && items.iter().any(|item| {
                        item.get("type").and_then(Value::as_str) == Some("function_call_output")
                    })
            })
    );

    gateway_handle.abort();
    upstream_handle.abort();
    let _ = stdfs::remove_dir_all(home_dir);
}

#[tokio::test]
async fn api_status_responses_disable_http_caching() {
    let config = GatewayConfig::default();
    let (home_dir, gateway_addr, gateway_handle) =
        spawn_test_gateway(config, "api-status-cache-headers").await;
    let client = reqwest::Client::new();

    let response = client
        .get(format!("http://{gateway_addr}/api/status"))
        .send()
        .await
        .expect("request api status");

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        response
            .headers()
            .get(header::CACHE_CONTROL)
            .and_then(|value| value.to_str().ok()),
        Some("no-store, no-cache, must-revalidate, max-age=0")
    );
    assert_eq!(
        response
            .headers()
            .get(header::PRAGMA)
            .and_then(|value| value.to_str().ok()),
        Some("no-cache")
    );
    assert_eq!(
        response
            .headers()
            .get(header::EXPIRES)
            .and_then(|value| value.to_str().ok()),
        Some("0")
    );

    gateway_handle.abort();
    let _ = stdfs::remove_dir_all(home_dir);
}

#[tokio::test]
async fn ui_html_is_not_cached_but_hashed_assets_are_cacheable() {
    let paths = test_paths("ui-cache-headers");
    initialize_database(&paths.db_path).expect("init db");

    let ui_root = paths.home_dir.join("ui-dist");
    let assets_dir = ui_root.join("assets");
    stdfs::create_dir_all(&assets_dir).expect("create assets dir");
    stdfs::write(
        ui_root.join("landing.html"),
        "<!doctype html><html><body>landing</body></html>",
    )
    .expect("write landing");
    stdfs::write(
        ui_root.join("index.html"),
        "<!doctype html><html><body>ok</body></html>",
    )
    .expect("write index");
    stdfs::write(
        ui_root.join("cc-gw-social-card.svg"),
        "<svg xmlns=\"http://www.w3.org/2000/svg\"><text>cc-gw</text></svg>",
    )
    .expect("write social card");
    stdfs::write(
        ui_root.join("site.webmanifest"),
        "{\"name\":\"cc-gw\",\"start_url\":\"/\"}",
    )
    .expect("write manifest");
    stdfs::write(assets_dir.join("app-123.js"), "console.log('ok');").expect("write asset");

    let state = build_test_state(GatewayConfig::default(), paths.clone(), Some(ui_root));
    let (gateway_addr, gateway_handle) = spawn_router(build_router(state)).await;
    let client = reqwest::Client::new();

    let landing = client
        .get(format!("http://{gateway_addr}/"))
        .send()
        .await
        .expect("request root landing");
    assert_eq!(landing.status(), StatusCode::OK);
    assert_eq!(
        landing
            .headers()
            .get(header::CACHE_CONTROL)
            .and_then(|value| value.to_str().ok()),
        Some("no-store, no-cache, must-revalidate, max-age=0")
    );
    let landing_body = landing.text().await.expect("read root landing body");
    assert!(landing_body.contains("landing"));

    let html = client
        .get(format!("http://{gateway_addr}/ui/"))
        .send()
        .await
        .expect("request ui index");
    assert_eq!(html.status(), StatusCode::OK);
    assert_eq!(
        html.headers()
            .get(header::CACHE_CONTROL)
            .and_then(|value| value.to_str().ok()),
        Some("no-store, no-cache, must-revalidate, max-age=0")
    );

    let asset = client
        .get(format!("http://{gateway_addr}/assets/app-123.js"))
        .send()
        .await
        .expect("request asset");
    assert_eq!(asset.status(), StatusCode::OK);
    assert_eq!(
        asset
            .headers()
            .get(header::CACHE_CONTROL)
            .and_then(|value| value.to_str().ok()),
        Some("public, max-age=31536000, immutable")
    );

    let social = client
        .get(format!("http://{gateway_addr}/cc-gw-social-card.svg"))
        .send()
        .await
        .expect("request root social asset");
    assert_eq!(social.status(), StatusCode::OK);
    assert_eq!(
        social
            .headers()
            .get(header::CACHE_CONTROL)
            .and_then(|value| value.to_str().ok()),
        Some("public, max-age=31536000, immutable")
    );

    let manifest = client
        .get(format!("http://{gateway_addr}/site.webmanifest"))
        .send()
        .await
        .expect("request manifest asset");
    assert_eq!(manifest.status(), StatusCode::OK);
    assert_eq!(
        manifest
            .headers()
            .get(header::CACHE_CONTROL)
            .and_then(|value| value.to_str().ok()),
        Some("public, max-age=31536000, immutable")
    );

    gateway_handle.abort();
    let _ = stdfs::remove_dir_all(paths.home_dir);
}

#[tokio::test]
async fn root_falls_back_to_ui_redirect_when_landing_html_is_missing() {
    let paths = test_paths("root-entry-fallback");
    initialize_database(&paths.db_path).expect("init db");

    let ui_root = paths.home_dir.join("ui-dist");
    stdfs::create_dir_all(&ui_root).expect("create ui dir");
    stdfs::write(
        ui_root.join("index.html"),
        "<!doctype html><html><body>console</body></html>",
    )
    .expect("write index");

    let state = build_test_state(GatewayConfig::default(), paths.clone(), Some(ui_root));
    let (gateway_addr, gateway_handle) = spawn_router(build_router(state)).await;
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .expect("client");

    let root = client
        .get(format!("http://{gateway_addr}/"))
        .send()
        .await
        .expect("request root");
    assert_eq!(root.status(), StatusCode::FOUND);
    assert_eq!(
        root.headers()
            .get(header::LOCATION)
            .and_then(|value| value.to_str().ok()),
        Some("/ui/")
    );

    gateway_handle.abort();
    let _ = stdfs::remove_dir_all(paths.home_dir);
}

#[tokio::test]
async fn root_seo_files_are_served() {
    let config = GatewayConfig::default();
    let (home_dir, gateway_addr, gateway_handle) =
        spawn_test_gateway(config, "root-seo-files").await;
    let client = reqwest::Client::new();

    let robots = client
        .get(format!("http://{gateway_addr}/robots.txt"))
        .send()
        .await
        .expect("request robots");
    assert_eq!(robots.status(), StatusCode::OK);
    let robots_body = robots.text().await.expect("read robots body");
    assert!(robots_body.contains("Sitemap: /sitemap.xml"));

    let sitemap = client
        .get(format!("http://{gateway_addr}/sitemap.xml"))
        .send()
        .await
        .expect("request sitemap");
    assert_eq!(sitemap.status(), StatusCode::OK);
    let sitemap_body = sitemap.text().await.expect("read sitemap body");
    assert!(sitemap_body.contains(&format!("http://{gateway_addr}/")));
    assert!(sitemap_body.contains(&format!("http://{gateway_addr}/ui/")));

    gateway_handle.abort();
    let _ = stdfs::remove_dir_all(home_dir);
}

#[tokio::test]
async fn api_key_concurrency_limit_returns_429_and_records_event() {
    // Upstream sleeps so the first request stays in-flight while the second arrives
    let upstream = Router::new().route(
        "/v1/chat/completions",
        post(|| async {
            sleep(Duration::from_millis(800)).await;
            Json(json!({
                "choices": [{
                    "message": { "content": "ok" }
                }],
                "usage": {
                    "prompt_tokens": 4,
                    "completion_tokens": 2
                }
            }))
        }),
    );
    let (upstream_addr, upstream_handle) = spawn_router(upstream).await;

    let mut config = GatewayConfig::default();
    config.defaults.completion = Some("gpt-test".to_string());
    if let Some(openai) = config.endpoint_routing.get_mut("openai") {
        openai.defaults.completion = Some("gpt-test".to_string());
    }
    config.providers = vec![cc_gw_core::config::ProviderConfig {
        id: "mock-openai".to_string(),
        label: "Mock OpenAI".to_string(),
        base_url: format!("http://{upstream_addr}"),
        provider_type: Some("openai".to_string()),
        default_model: Some("gpt-test".to_string()),
        models: vec![cc_gw_core::config::ProviderModelConfig {
            id: "gpt-test".to_string(),
            label: Some("GPT Test".to_string()),
            ..Default::default()
        }],
        ..cc_gw_core::config::ProviderConfig::default()
    }];

    let (home_dir, gateway_addr, gateway_handle) =
        spawn_test_gateway(config, "concurrency-429").await;
    let client = reqwest::Client::new();

    // Create a key with maxConcurrency=1
    let create: Value = client
        .post(format!("http://{gateway_addr}/api/keys"))
        .json(&json!({
            "name": "concurrency-test",
            "maxConcurrency": 1
        }))
        .send()
        .await
        .expect("create api key")
        .json()
        .await
        .expect("decode api key create");
    let api_key = create
        .get("key")
        .and_then(Value::as_str)
        .expect("created api key")
        .to_string();

    // Launch first request (will sleep at upstream, keeping the concurrency slot occupied)
    let first_client = client.clone();
    let first_url = format!("http://{gateway_addr}/openai/v1/chat/completions");
    let first_key = api_key.clone();
    let in_flight = tokio::spawn(async move {
        first_client
            .post(first_url)
            .header("x-api-key", &first_key)
            .json(&json!({
                "model": "gpt-test",
                "messages": [{ "role": "user", "content": "first" }]
            }))
            .send()
            .await
            .expect("send first request")
    });

    // Wait for the first request to be registered in the concurrency tracker
    sleep(Duration::from_millis(200)).await;

    // Second request should get 429
    let rejected = client
        .post(format!("http://{gateway_addr}/openai/v1/chat/completions"))
        .header("x-api-key", &api_key)
        .json(&json!({
            "model": "gpt-test",
            "messages": [{ "role": "user", "content": "second" }]
        }))
        .send()
        .await
        .expect("send second request");
    assert_eq!(rejected.status(), StatusCode::TOO_MANY_REQUESTS);

    let rejected_body: Value = rejected.json().await.expect("decode rejected response");
    assert_eq!(
        rejected_body
            .get("error")
            .and_then(|e| e.get("code"))
            .and_then(Value::as_str),
        Some("concurrency_limit_exceeded")
    );
    assert!(
        rejected_body
            .get("error")
            .and_then(|e| e.get("message"))
            .and_then(Value::as_str)
            .is_some_and(|msg| msg.contains("maximum concurrency limit of 1"))
    );

    // Wait for the first request to complete
    let first_response = in_flight.await.expect("join first request");
    assert_eq!(first_response.status(), StatusCode::OK);

    // Verify the concurrency rejection event was recorded
    let events: Value = client
        .get(format!("http://{gateway_addr}/api/events?limit=10"))
        .send()
        .await
        .expect("request events")
        .json()
        .await
        .expect("decode events");
    let event_items = events
        .get("events")
        .and_then(Value::as_array)
        .expect("events array");
    let rejection_event = event_items
        .iter()
        .find(|e| e.get("type").and_then(Value::as_str) == Some("api_key_concurrency_rejected"))
        .expect("find concurrency rejection event");
    assert_eq!(
        rejection_event.get("level").and_then(Value::as_str),
        Some("warn")
    );
    assert_eq!(
        rejection_event.get("source").and_then(Value::as_str),
        Some("auth")
    );

    // After the first request completes, a third request should succeed
    let third = client
        .post(format!("http://{gateway_addr}/openai/v1/chat/completions"))
        .header("x-api-key", &api_key)
        .json(&json!({
            "model": "gpt-test",
            "messages": [{ "role": "user", "content": "third" }]
        }))
        .send()
        .await
        .expect("send third request");
    assert_eq!(third.status(), StatusCode::OK);

    gateway_handle.abort();
    upstream_handle.abort();
    let _ = stdfs::remove_dir_all(home_dir);
}

#[tokio::test]
async fn provider_rpm_limit_returns_429_with_retry_after_and_records_event() {
    let upstream = Router::new().route(
        "/v1/chat/completions",
        post(|| async {
            Json(json!({
                "choices": [{
                    "message": { "content": "ok" }
                }],
                "usage": {
                    "prompt_tokens": 4,
                    "completion_tokens": 2
                }
            }))
        }),
    );
    let (upstream_addr, upstream_handle) = spawn_router(upstream).await;

    let mut config = GatewayConfig::default();
    config.defaults.completion = Some("gpt-test".to_string());
    if let Some(openai) = config.endpoint_routing.get_mut("openai") {
        openai.defaults.completion = Some("gpt-test".to_string());
    }
    config.providers = vec![cc_gw_core::config::ProviderConfig {
        id: "mock-openai".to_string(),
        label: "Mock OpenAI".to_string(),
        base_url: format!("http://{upstream_addr}"),
        provider_type: Some("openai".to_string()),
        default_model: Some("gpt-test".to_string()),
        // Cap of 1 RPM with no queue wait: the second request must be
        // rejected synchronously instead of being held or forwarded.
        rpm_limit: Some(1),
        rpm_max_wait_seconds: Some(0),
        models: vec![cc_gw_core::config::ProviderModelConfig {
            id: "gpt-test".to_string(),
            label: Some("GPT Test".to_string()),
            ..Default::default()
        }],
        ..cc_gw_core::config::ProviderConfig::default()
    }];

    let (home_dir, gateway_addr, gateway_handle) = spawn_test_gateway(config, "rpm-429").await;
    let client = reqwest::Client::new();

    let create: Value = client
        .post(format!("http://{gateway_addr}/api/keys"))
        .json(&json!({ "name": "rpm-test" }))
        .send()
        .await
        .expect("create api key")
        .json()
        .await
        .expect("decode api key create");
    let api_key = create
        .get("key")
        .and_then(Value::as_str)
        .expect("created api key")
        .to_string();

    let request_body = json!({
        "model": "gpt-test",
        "messages": [{ "role": "user", "content": "hello" }]
    });

    // First request consumes the only RPM slot for the window.
    let first = client
        .post(format!("http://{gateway_addr}/openai/v1/chat/completions"))
        .header("x-api-key", &api_key)
        .json(&request_body)
        .send()
        .await
        .expect("send first request");
    assert_eq!(first.status(), StatusCode::OK);

    // Second request within the same window is rejected with 429 + Retry-After.
    let rejected = client
        .post(format!("http://{gateway_addr}/openai/v1/chat/completions"))
        .header("x-api-key", &api_key)
        .json(&request_body)
        .send()
        .await
        .expect("send second request");
    assert_eq!(rejected.status(), StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(
        rejected
            .headers()
            .get(header::RETRY_AFTER)
            .and_then(|value| value.to_str().ok()),
        Some("60")
    );

    let rejected_body: Value = rejected.json().await.expect("decode rejected response");
    assert_eq!(
        rejected_body
            .get("error")
            .and_then(|error| error.get("code"))
            .and_then(Value::as_str),
        Some("provider_rate_limit_exceeded")
    );
    assert!(
        rejected_body
            .get("error")
            .and_then(|error| error.get("message"))
            .and_then(Value::as_str)
            .is_some_and(|message| message.contains("RPM limit"))
    );

    // The rejection is visible in the event log with the RPM context.
    let events: Value = client
        .get(format!("http://{gateway_addr}/api/events?limit=10"))
        .send()
        .await
        .expect("request events")
        .json()
        .await
        .expect("decode events");
    let rejection_event = events
        .get("events")
        .and_then(Value::as_array)
        .expect("events array")
        .iter()
        .find(|event| {
            event.get("type").and_then(Value::as_str) == Some("provider_rate_limit_rejected")
        })
        .expect("find provider rate limit rejection event");
    assert_eq!(
        rejection_event.get("level").and_then(Value::as_str),
        Some("warn")
    );
    assert_eq!(
        rejection_event.get("source").and_then(Value::as_str),
        Some("proxy")
    );
    assert_eq!(
        rejection_event
            .get("details")
            .and_then(|details| details.get("rpmLimit"))
            .and_then(Value::as_i64),
        Some(1)
    );

    gateway_handle.abort();
    upstream_handle.abort();
    let _ = stdfs::remove_dir_all(home_dir);
}

#[tokio::test]
async fn provider_without_rpm_limit_is_not_throttled() {
    let upstream = Router::new().route(
        "/v1/chat/completions",
        post(|| async {
            Json(json!({
                "choices": [{
                    "message": { "content": "ok" }
                }],
                "usage": {
                    "prompt_tokens": 4,
                    "completion_tokens": 2
                }
            }))
        }),
    );
    let (upstream_addr, upstream_handle) = spawn_router(upstream).await;

    let mut config = GatewayConfig::default();
    config.defaults.completion = Some("gpt-test".to_string());
    if let Some(openai) = config.endpoint_routing.get_mut("openai") {
        openai.defaults.completion = Some("gpt-test".to_string());
    }
    config.providers = vec![cc_gw_core::config::ProviderConfig {
        id: "mock-openai".to_string(),
        label: "Mock OpenAI".to_string(),
        base_url: format!("http://{upstream_addr}"),
        provider_type: Some("openai".to_string()),
        default_model: Some("gpt-test".to_string()),
        models: vec![cc_gw_core::config::ProviderModelConfig {
            id: "gpt-test".to_string(),
            label: Some("GPT Test".to_string()),
            ..Default::default()
        }],
        ..cc_gw_core::config::ProviderConfig::default()
    }];

    let (home_dir, gateway_addr, gateway_handle) =
        spawn_test_gateway(config, "rpm-unlimited").await;
    let client = reqwest::Client::new();

    let create: Value = client
        .post(format!("http://{gateway_addr}/api/keys"))
        .json(&json!({ "name": "rpm-unlimited-test" }))
        .send()
        .await
        .expect("create api key")
        .json()
        .await
        .expect("decode api key create");
    let api_key = create
        .get("key")
        .and_then(Value::as_str)
        .expect("created api key")
        .to_string();

    for _ in 0..3 {
        let response = client
            .post(format!("http://{gateway_addr}/openai/v1/chat/completions"))
            .header("x-api-key", &api_key)
            .json(&json!({
                "model": "gpt-test",
                "messages": [{ "role": "user", "content": "hello" }]
            }))
            .send()
            .await
            .expect("send request");
        assert_eq!(response.status(), StatusCode::OK);
    }

    gateway_handle.abort();
    upstream_handle.abort();
    let _ = stdfs::remove_dir_all(home_dir);
}

#[tokio::test]
async fn dashboard_summary_returns_all_sections() {
    let paths = test_paths("dashboard-summary");
    initialize_database(&paths.db_path).expect("init db");

    // Seed one error event and one warn event so recentErrors has content.
    record_event(
        &paths.db_path,
        &RecordEventInput {
            event_type: "provider_proxy_failure".to_string(),
            level: Some("error".to_string()),
            source: Some("proxy".to_string()),
            title: Some("Provider request failed".to_string()),
            message: Some("boom".to_string()),
            ..RecordEventInput::default()
        },
    )
    .expect("record error event");
    record_event(
        &paths.db_path,
        &RecordEventInput {
            event_type: "web_auth_login_failure".to_string(),
            level: Some("warn".to_string()),
            source: Some("web-auth".to_string()),
            title: Some("Web login failed".to_string()),
            ..RecordEventInput::default()
        },
    )
    .expect("record warn event");

    let state = build_test_state(GatewayConfig::default(), paths.clone(), None);
    let (addr, gateway_handle) = spawn_router(build_router(state)).await;
    let client = reqwest::Client::new();

    for url in [
        format!("http://{addr}/api/dashboard/summary"),
        format!("http://{addr}/api/dashboard/summary?endpoint=anthropic"),
    ] {
        let response = client.get(&url).send().await.expect("request summary");
        assert_eq!(response.status(), StatusCode::OK, "url: {url}");
        let body: Value = response.json().await.expect("decode summary");

        for key in [
            "status",
            "overview",
            "daily",
            "modelStats",
            "recentRequests",
            "recentErrors",
            "dbInfo",
        ] {
            assert!(body.get(key).is_some(), "missing `{key}` in {url}");
        }
        assert!(
            body.pointer("/status/uniqueClientAddressesLastHour")
                .is_some(),
            "status should reuse the /api/status shape"
        );
        assert!(
            body.pointer("/overview/totals").is_some(),
            "overview should reuse the /api/stats/overview shape"
        );
        assert!(body.get("daily").is_some_and(Value::is_array));
        assert!(body.get("modelStats").is_some_and(Value::is_array));
        assert!(
            body.pointer("/recentRequests/items").is_some(),
            "recentRequests should reuse the /api/logs shape"
        );
        assert!(body.get("recentErrors").is_some_and(Value::is_array));
        assert!(
            body.pointer("/dbInfo/path").is_some() || body.pointer("/dbInfo/sizeBytes").is_some(),
            "dbInfo should reuse the /api/db/info shape"
        );
    }

    // The unfiltered summary surfaces both seeded events in recentErrors.
    let body: Value = client
        .get(format!("http://{addr}/api/dashboard/summary"))
        .send()
        .await
        .expect("request summary")
        .json()
        .await
        .expect("decode summary");
    let recent_errors = body
        .get("recentErrors")
        .and_then(Value::as_array)
        .expect("recentErrors array");
    let levels: Vec<&str> = recent_errors
        .iter()
        .filter_map(|event| event.get("level").and_then(Value::as_str))
        .collect();
    assert!(levels.contains(&"error"));
    assert!(levels.contains(&"warn"));
    assert!(
        recent_errors
            .iter()
            .all(|event| event.get("type").and_then(Value::as_str).is_some()),
        "recentErrors items should reuse the /api/events item shape"
    );

    gateway_handle.abort();
    let _ = stdfs::remove_dir_all(paths.home_dir);
}

#[tokio::test]
async fn events_stats_aggregates_by_level_and_respects_days_window() {
    let paths = test_paths("events-stats");
    initialize_database(&paths.db_path).expect("init db");

    let now = chrono::Utc::now().timestamp_millis();
    // Seed: 2 recent errors, 1 warn, 1 info, plus 1 error a week old.
    for (event_type, level, timestamp) in [
        ("provider_proxy_failure", Some("error"), now),
        ("provider_proxy_failure", Some("error"), now),
        ("web_auth_login_failure", Some("warn"), now),
        ("openai_compatibility_mode_learned", Some("info"), now),
        (
            "provider_proxy_failure",
            Some("error"),
            now - 7 * 24 * 60 * 60 * 1000,
        ),
    ] {
        record_event(
            &paths.db_path,
            &RecordEventInput {
                timestamp: Some(timestamp),
                event_type: event_type.to_string(),
                level: level.map(|value| value.to_string()),
                ..RecordEventInput::default()
            },
        )
        .expect("record event");
    }

    let state = build_test_state(GatewayConfig::default(), paths.clone(), None);
    let (addr, gateway_handle) = spawn_router(build_router(state)).await;
    let client = reqwest::Client::new();

    // No days param → all-time aggregation.
    let body: Value = client
        .get(format!("http://{addr}/api/events/stats"))
        .send()
        .await
        .expect("request stats")
        .json()
        .await
        .expect("decode stats");
    assert_eq!(body.get("total").and_then(Value::as_i64), Some(5));
    assert_eq!(body.get("error").and_then(Value::as_i64), Some(3));
    assert_eq!(body.get("warn").and_then(Value::as_i64), Some(1));
    assert_eq!(body.get("info").and_then(Value::as_i64), Some(1));

    // ?days=1 → the week-old error falls outside the window.
    let windowed: Value = client
        .get(format!("http://{addr}/api/events/stats?days=1"))
        .send()
        .await
        .expect("request windowed stats")
        .json()
        .await
        .expect("decode windowed stats");
    assert_eq!(windowed.get("total").and_then(Value::as_i64), Some(4));
    assert_eq!(windowed.get("error").and_then(Value::as_i64), Some(2));
    assert_eq!(windowed.get("warn").and_then(Value::as_i64), Some(1));
    assert_eq!(windowed.get("info").and_then(Value::as_i64), Some(1));

    gateway_handle.abort();
    let _ = stdfs::remove_dir_all(paths.home_dir);
}

#[tokio::test]
async fn events_stream_serves_sse_and_pushes_recorded_events() {
    let paths = test_paths("events-stream");
    initialize_database(&paths.db_path).expect("init db");
    let state = build_test_state(GatewayConfig::default(), paths.clone(), None);
    let event_state = state.clone();
    let (addr, gateway_handle) = spawn_router(build_router(state)).await;
    let client = reqwest::Client::new();

    let mut response = client
        .get(format!("http://{addr}/api/events/stream?level=error"))
        .send()
        .await
        .expect("open event stream");
    assert_eq!(response.status(), StatusCode::OK);
    let content_type = response
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .expect("content-type header")
        .to_string();
    assert!(
        content_type.starts_with("text/event-stream"),
        "unexpected content-type: {content_type}"
    );

    // Give the server a moment to register the broadcast subscriber.
    sleep(Duration::from_millis(100)).await;

    // A warn event must be filtered out server-side; an error event must arrive.
    record_and_broadcast_event(
        &event_state,
        RecordEventInput {
            event_type: "stream_filtered_warn".to_string(),
            level: Some("warn".to_string()),
            ..RecordEventInput::default()
        },
    );
    record_and_broadcast_event(
        &event_state,
        RecordEventInput {
            event_type: "stream_expected_error".to_string(),
            level: Some("error".to_string()),
            title: Some("Stream test".to_string()),
            ..RecordEventInput::default()
        },
    );

    let mut received = String::new();
    let deadline = std::time::Instant::now() + Duration::from_secs(5);
    while !received.contains("stream_expected_error") {
        assert!(
            std::time::Instant::now() < deadline,
            "timed out waiting for SSE event, received: {received}"
        );
        let chunk = tokio::time::timeout(Duration::from_secs(5), response.chunk())
            .await
            .expect("stream chunk timeout")
            .expect("stream chunk error")
            .expect("stream closed before event arrived");
        received.push_str(&String::from_utf8_lossy(&chunk));
    }

    assert!(received.contains("data: {"));
    assert!(received.contains("stream_expected_error"));
    assert!(
        !received.contains("stream_filtered_warn"),
        "level=error filter should drop warn events, received: {received}"
    );

    drop(response);
    gateway_handle.abort();
    let _ = stdfs::remove_dir_all(paths.home_dir);
}

/// Cross-protocol streaming (Anthropic client ← OpenAI chat upstream) with the
/// standard `stream_options.include_usage` chunk ordering: finish_reason in
/// chunk N, real usage in a separate trailing chunk N+1 (`choices: []`), then
/// [DONE]. Regression guard for the deferred-termination fix: the terminal
/// message_delta must carry the trailing usage, not the 0/0 snapshot known at
/// chunk N, and the event tail must stay well-formed (single terminal pair).
#[tokio::test]
async fn anthropic_to_openai_stream_carries_trailing_usage_chunk() {
    let upstream = Router::new().route(
        "/v1/chat/completions",
        post(|| async {
            Response::builder()
                .status(StatusCode::OK)
                .header(header::CONTENT_TYPE, "text/event-stream")
                .body(Body::from(
                    "data: {\"id\":\"chatcmpl_std\",\"object\":\"chat.completion.chunk\",\"created\":1,\"model\":\"gpt-test\",\"choices\":[{\"index\":0,\"delta\":{\"role\":\"assistant\",\"content\":\"hi\"},\"finish_reason\":null}]}\n\n\
data: {\"id\":\"chatcmpl_std\",\"object\":\"chat.completion.chunk\",\"created\":1,\"model\":\"gpt-test\",\"choices\":[{\"index\":0,\"delta\":{},\"finish_reason\":\"length\"}]}\n\n\
data: {\"id\":\"chatcmpl_std\",\"object\":\"chat.completion.chunk\",\"created\":1,\"model\":\"gpt-test\",\"choices\":[],\"usage\":{\"prompt_tokens\":13,\"completion_tokens\":5,\"total_tokens\":18}}\n\n\
data: [DONE]\n\n",
                ))
                .expect("build stream response")
        }),
    );
    let (upstream_addr, upstream_handle) = spawn_router(upstream).await;

    let mut config = GatewayConfig::default();
    config.providers = vec![cc_gw_core::config::ProviderConfig {
        id: "mock-openai".to_string(),
        label: "Mock OpenAI".to_string(),
        base_url: format!("http://{upstream_addr}"),
        provider_type: Some("openai".to_string()),
        default_model: Some("gpt-test".to_string()),
        models: vec![cc_gw_core::config::ProviderModelConfig {
            id: "gpt-test".to_string(),
            label: Some("GPT Test".to_string()),
            ..Default::default()
        }],
        ..cc_gw_core::config::ProviderConfig::default()
    }];
    if let Some(anthropic_routing) = config.endpoint_routing.get_mut("anthropic") {
        anthropic_routing.model_routes.insert(
            "claude-client".to_string(),
            "mock-openai:gpt-test".to_string(),
        );
    }

    let (home_dir, gateway_addr, gateway_handle) =
        spawn_test_gateway(config, "anthropic-openai-trailing-usage").await;
    let client = reqwest::Client::new();

    let response = client
        .post(format!("http://{gateway_addr}/v1/messages"))
        .json(&json!({
            "model": "claude-client",
            "max_tokens": 64,
            "stream": true,
            "messages": [{ "role": "user", "content": "hello" }]
        }))
        .send()
        .await
        .expect("send streaming request");
    assert_eq!(response.status(), StatusCode::OK);

    let body = response.text().await.expect("read stream body");
    assert!(
        body.contains("\"usage\":{\"input_tokens\":13,\"output_tokens\":5}"),
        "trailing usage chunk must reach the client message_delta, got: {body}"
    );
    assert!(
        body.contains("\"stop_reason\":\"max_tokens\""),
        "finish_reason=length must map to max_tokens, got: {body}"
    );
    assert_eq!(
        body.matches("\"type\":\"message_delta\"").count(),
        1,
        "exactly one message_delta expected, got: {body}"
    );
    assert_eq!(
        body.matches("\"type\":\"message_stop\"").count(),
        1,
        "exactly one message_stop expected, got: {body}"
    );

    // The gateway's own telemetry must record the same real counts.
    sleep(Duration::from_millis(250)).await;
    let logs: Value = client
        .get(format!("http://{gateway_addr}/api/logs?limit=1"))
        .send()
        .await
        .expect("request logs")
        .json()
        .await
        .expect("decode logs");
    let item = logs
        .get("items")
        .and_then(Value::as_array)
        .and_then(|items| items.first())
        .expect("stream log item");
    assert_eq!(item.get("status_code").and_then(Value::as_i64), Some(200));
    assert_eq!(item.get("input_tokens").and_then(Value::as_i64), Some(13));
    assert_eq!(item.get("output_tokens").and_then(Value::as_i64), Some(5));

    gateway_handle.abort();
    upstream_handle.abort();
    let _ = stdfs::remove_dir_all(home_dir);
}

/// The LIVE cross-protocol conversion loop must reassemble multi-byte UTF-8
/// characters split across raw byte chunks — per-chunk lossy decoding turns
/// the split halves into U+FFFD replacement characters for the client.
#[tokio::test]
async fn anthropic_to_openai_live_stream_preserves_utf8_split_across_chunks() {
    let prefix = "data: {\"id\":\"chatcmpl_utf8\",\"object\":\"chat.completion.chunk\",\"created\":1700000000,\"model\":\"gpt-test\",\"choices\":[{\"index\":0,\"delta\":{\"role\":\"assistant\",\"content\":\"";
    let text = "你好".as_bytes();
    let suffix = "\"},\"finish_reason\":null}]}\n\n\
data: {\"id\":\"chatcmpl_utf8\",\"object\":\"chat.completion.chunk\",\"created\":1700000000,\"model\":\"gpt-test\",\"choices\":[{\"index\":0,\"delta\":{},\"finish_reason\":\"stop\"}]}\n\n\
data: [DONE]\n\n";

    let upstream = Router::new().route(
        "/v1/chat/completions",
        post(move || async move {
            // Split 你好 mid-character (byte 1 of 3) across two body chunks.
            let mut first = Vec::new();
            first.extend_from_slice(prefix.as_bytes());
            first.extend_from_slice(&text[..1]);
            let mut second = Vec::new();
            second.extend_from_slice(&text[1..]);
            second.extend_from_slice(suffix.as_bytes());

            let stream = stream! {
                yield Ok::<Bytes, std::convert::Infallible>(Bytes::from(first));
                yield Ok::<Bytes, std::convert::Infallible>(Bytes::from(second));
            };
            Response::builder()
                .status(StatusCode::OK)
                .header(header::CONTENT_TYPE, "text/event-stream")
                .body(Body::from_stream(stream))
                .expect("build split utf8 stream response")
        }),
    );
    let (upstream_addr, upstream_handle) = spawn_router(upstream).await;

    let mut config = GatewayConfig::default();
    config.providers = vec![cc_gw_core::config::ProviderConfig {
        id: "mock-openai".to_string(),
        label: "Mock OpenAI".to_string(),
        base_url: format!("http://{upstream_addr}"),
        provider_type: Some("openai".to_string()),
        default_model: Some("gpt-test".to_string()),
        models: vec![cc_gw_core::config::ProviderModelConfig {
            id: "gpt-test".to_string(),
            label: Some("GPT Test".to_string()),
            ..Default::default()
        }],
        ..cc_gw_core::config::ProviderConfig::default()
    }];
    if let Some(anthropic_routing) = config.endpoint_routing.get_mut("anthropic") {
        anthropic_routing.model_routes.insert(
            "claude-client".to_string(),
            "mock-openai:gpt-test".to_string(),
        );
    }

    let (home_dir, gateway_addr, gateway_handle) =
        spawn_test_gateway(config, "anthropic-openai-live-utf8").await;
    let client = reqwest::Client::new();

    let response = client
        .post(format!("http://{gateway_addr}/v1/messages"))
        .json(&json!({
            "model": "claude-client",
            "max_tokens": 64,
            "stream": true,
            "messages": [{ "role": "user", "content": "hello" }]
        }))
        .send()
        .await
        .expect("send streaming request");
    assert_eq!(response.status(), StatusCode::OK);

    let body = response.text().await.expect("read stream body");
    assert!(
        body.contains("你好"),
        "multi-byte characters split across upstream chunks must reach the client intact, got: {body}"
    );
    assert!(
        !body.contains('\u{FFFD}'),
        "no U+FFFD replacement characters may leak from chunk-boundary decoding, got: {body}"
    );

    gateway_handle.abort();
    upstream_handle.abort();
    let _ = stdfs::remove_dir_all(home_dir);
}

/// Guard the deferred-termination edge the fix widens: an upstream that dies
/// right after the finish_reason chunk — before the trailing usage chunk and
/// [DONE] — must still yield a well-formed Anthropic stream (terminal
/// message_delta + message_stop synthesized at EOF), not a truncated one.
#[tokio::test]
async fn anthropic_to_openai_stream_upstream_dies_after_finish_reason() {
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind raw upstream listener");
    let upstream_addr = listener.local_addr().expect("listener addr");
    let upstream_handle = tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.expect("accept request");
        let mut request_buf = [0_u8; 4096];
        let _ = socket.read(&mut request_buf).await;
        let stream_payload = concat!(
            "data: {\"id\":\"chatcmpl_cut\",\"object\":\"chat.completion.chunk\",\"created\":1,\"model\":\"gpt-test\",\"choices\":[{\"index\":0,\"delta\":{\"role\":\"assistant\",\"content\":\"partial\"},\"finish_reason\":null}]}\n\n",
            "data: {\"id\":\"chatcmpl_cut\",\"object\":\"chat.completion.chunk\",\"created\":1,\"model\":\"gpt-test\",\"choices\":[{\"index\":0,\"delta\":{},\"finish_reason\":\"stop\"}]}\n\n"
        );
        let response_head = concat!(
            "HTTP/1.1 200 OK\r\n",
            "content-type: text/event-stream\r\n",
            "transfer-encoding: chunked\r\n",
            "connection: close\r\n",
            "\r\n"
        );
        let response = format!(
            "{response_head}{:x}\r\n{stream_payload}\r\n0\r\n\r\n",
            stream_payload.len()
        );
        socket
            .write_all(response.as_bytes())
            .await
            .expect("write cut stream response");
        let _ = socket.shutdown().await;
    });

    let mut config = GatewayConfig::default();
    config.providers = vec![cc_gw_core::config::ProviderConfig {
        id: "mock-openai".to_string(),
        label: "Mock OpenAI".to_string(),
        base_url: format!("http://{upstream_addr}"),
        provider_type: Some("openai".to_string()),
        default_model: Some("gpt-test".to_string()),
        models: vec![cc_gw_core::config::ProviderModelConfig {
            id: "gpt-test".to_string(),
            label: Some("GPT Test".to_string()),
            ..Default::default()
        }],
        ..cc_gw_core::config::ProviderConfig::default()
    }];
    if let Some(anthropic_routing) = config.endpoint_routing.get_mut("anthropic") {
        anthropic_routing.model_routes.insert(
            "claude-client".to_string(),
            "mock-openai:gpt-test".to_string(),
        );
    }

    let (home_dir, gateway_addr, gateway_handle) =
        spawn_test_gateway(config, "anthropic-openai-cut-after-finish").await;
    let client = reqwest::Client::new();

    let response = client
        .post(format!("http://{gateway_addr}/v1/messages"))
        .json(&json!({
            "model": "claude-client",
            "max_tokens": 64,
            "stream": true,
            "messages": [{ "role": "user", "content": "hello" }]
        }))
        .send()
        .await
        .expect("send streaming request");
    assert_eq!(response.status(), StatusCode::OK);

    let body = response.text().await.expect("read stream body");
    assert!(
        body.contains("\"type\":\"message_delta\""),
        "EOF after finish_reason must still synthesize message_delta, got: {body}"
    );
    assert!(
        body.contains("\"type\":\"message_stop\""),
        "EOF after finish_reason must still synthesize message_stop, got: {body}"
    );
    assert!(
        body.contains("\"stop_reason\":\"end_turn\""),
        "finish_reason=stop must map to end_turn, got: {body}"
    );
    assert_eq!(
        body.matches("\"type\":\"message_stop\"").count(),
        1,
        "exactly one message_stop expected, got: {body}"
    );

    gateway_handle.abort();
    upstream_handle.abort();
    let _ = stdfs::remove_dir_all(home_dir);
}

// ---------------------------------------------------------------------------
// Aggregated-model failover
// ---------------------------------------------------------------------------

fn aggregate_provider_config(
    id: &str,
    model: &str,
    targets: &[&str],
    failover: Option<cc_gw_core::config::FailoverPolicyConfig>,
) -> cc_gw_core::config::ProviderConfig {
    cc_gw_core::config::ProviderConfig {
        id: id.to_string(),
        label: id.to_string(),
        provider_type: Some("aggregate".to_string()),
        models: vec![cc_gw_core::config::ProviderModelConfig {
            id: model.to_string(),
            label: None,
            members: Some(
                targets
                    .iter()
                    .map(|target| cc_gw_core::config::AggregateMemberConfig {
                        target: target.to_string(),
                    })
                    .collect(),
            ),
            failover,
            ..Default::default()
        }],
        ..Default::default()
    }
}

fn anthropic_backend_config(
    id: &str,
    model: &str,
    base_url: String,
) -> cc_gw_core::config::ProviderConfig {
    cc_gw_core::config::ProviderConfig {
        id: id.to_string(),
        label: id.to_string(),
        base_url,
        provider_type: Some("anthropic".to_string()),
        default_model: Some(model.to_string()),
        models: vec![cc_gw_core::config::ProviderModelConfig {
            id: model.to_string(),
            label: None,
            ..Default::default()
        }],
        ..Default::default()
    }
}

/// Upstream stub for failover tests: every request is recorded with the model
/// name it carried; `claude-primary` answers 500 (the "dead" backend),
/// `claude-backup` answers a normal Anthropic message.
async fn spawn_failover_upstream() -> (SocketAddr, JoinHandle<()>, Arc<Mutex<Vec<String>>>) {
    let hits = Arc::new(Mutex::new(Vec::<String>::new()));
    let hits_for_route = Arc::clone(&hits);
    let upstream = Router::new().route(
        "/v1/messages",
        post(move |AxumJson(payload): AxumJson<Value>| {
            let hits = Arc::clone(&hits_for_route);
            async move {
                let model = payload
                    .get("model")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string();
                hits.lock().expect("lock hits").push(model.clone());
                if model == "claude-primary" {
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        Json(json!({ "type": "error", "error": { "type": "api_error", "message": "primary is dead" } })),
                    )
                        .into_response()
                } else {
                    Json(json!({
                        "id": "msg_backup",
                        "type": "message",
                        "role": "assistant",
                        "model": model,
                        "content": [{ "type": "text", "text": "backup-ok" }],
                        "stop_reason": "end_turn",
                        "usage": { "input_tokens": 5, "output_tokens": 3 }
                    }))
                    .into_response()
                }
            }
        }),
    );
    let (addr, handle) = spawn_router(upstream).await;
    (addr, handle, hits)
}

fn failover_gateway_config(
    upstream_addr: SocketAddr,
    failover: Option<cc_gw_core::config::FailoverPolicyConfig>,
) -> GatewayConfig {
    let mut config = GatewayConfig::default();
    let base_url = format!("http://{upstream_addr}");
    config.providers = vec![
        aggregate_provider_config(
            "team",
            "team-claude",
            &["primary:claude-primary", "backup:claude-backup"],
            failover,
        ),
        anthropic_backend_config("primary", "claude-primary", base_url.clone()),
        anthropic_backend_config("backup", "claude-backup", base_url),
    ];
    config
}

async fn create_gateway_api_key(client: &reqwest::Client, gateway_addr: SocketAddr) -> String {
    let create: Value = client
        .post(format!("http://{gateway_addr}/api/keys"))
        .json(&json!({ "name": "failover-test" }))
        .send()
        .await
        .expect("create api key")
        .json()
        .await
        .expect("decode api key create");
    create
        .get("key")
        .and_then(Value::as_str)
        .expect("created api key")
        .to_string()
}

async fn fetch_events(client: &reqwest::Client, gateway_addr: SocketAddr) -> Vec<Value> {
    let events: Value = client
        .get(format!("http://{gateway_addr}/api/events?limit=50"))
        .send()
        .await
        .expect("request events")
        .json()
        .await
        .expect("decode events");
    events
        .get("events")
        .and_then(Value::as_array)
        .expect("events array")
        .clone()
}

#[tokio::test]
async fn aggregate_failover_switches_to_next_backend_and_records_event() {
    let (upstream_addr, upstream_handle, _hits) = spawn_failover_upstream().await;
    let config = failover_gateway_config(upstream_addr, None);
    let (home_dir, gateway_addr, gateway_handle) =
        spawn_test_gateway(config, "agg-failover-basic").await;
    let client = reqwest::Client::new();
    let api_key = create_gateway_api_key(&client, gateway_addr).await;

    let response: Value = client
        .post(format!("http://{gateway_addr}/v1/messages"))
        .header("x-api-key", &api_key)
        .json(&json!({
            "model": "team-claude",
            "max_tokens": 64,
            "messages": [{ "role": "user", "content": [{ "type": "text", "text": "hello" }] }]
        }))
        .send()
        .await
        .expect("send aggregated request")
        .json()
        .await
        .expect("decode aggregated response");
    assert_eq!(
        response
            .get("content")
            .and_then(Value::as_array)
            .and_then(|items| items.first())
            .and_then(|item| item.get("text"))
            .and_then(Value::as_str),
        Some("backup-ok")
    );

    // The log row reports the backend that actually served the request, while
    // client_model preserves the requested aggregate name.
    let logs: Value = client
        .get(format!("http://{gateway_addr}/api/logs?limit=10"))
        .send()
        .await
        .expect("request logs")
        .json()
        .await
        .expect("decode logs");
    let row = logs
        .get("items")
        .and_then(Value::as_array)
        .expect("log items")
        .iter()
        .find(|item| item.get("client_model").and_then(Value::as_str) == Some("team-claude"))
        .expect("find aggregated request log row");
    assert_eq!(row.get("provider").and_then(Value::as_str), Some("backup"));
    assert_eq!(
        row.get("model").and_then(Value::as_str),
        Some("claude-backup")
    );

    // The failover chain is visible in the event log.
    let failover_event = fetch_events(&client, gateway_addr)
        .await
        .into_iter()
        .find(|event| event.get("type").and_then(Value::as_str) == Some("provider_failover"))
        .expect("find provider_failover event");
    let attempts = failover_event
        .get("details")
        .and_then(|details| details.get("attempts"))
        .and_then(Value::as_array)
        .expect("attempts array");
    assert_eq!(attempts.len(), 2);
    assert_eq!(
        attempts[0].get("provider").and_then(Value::as_str),
        Some("primary")
    );
    assert_eq!(
        attempts[0].get("outcome").and_then(Value::as_str),
        Some("failed:status")
    );
    assert_eq!(attempts[0].get("status").and_then(Value::as_i64), Some(500));
    assert_eq!(
        attempts[1].get("provider").and_then(Value::as_str),
        Some("backup")
    );
    assert_eq!(
        attempts[1].get("outcome").and_then(Value::as_str),
        Some("selected")
    );

    gateway_handle.abort();
    upstream_handle.abort();
    let _ = stdfs::remove_dir_all(home_dir);
}

#[tokio::test]
async fn aggregate_failover_skips_backend_after_consecutive_failures() {
    let (upstream_addr, upstream_handle, hits) = spawn_failover_upstream().await;
    let config = failover_gateway_config(
        upstream_addr,
        Some(cc_gw_core::config::FailoverPolicyConfig {
            consecutive_failures: Some(2),
            cooldown_seconds: Some(60),
            failure_window_seconds: Some(600),
            trigger_status_codes: None,
        }),
    );
    let (home_dir, gateway_addr, gateway_handle) =
        spawn_test_gateway(config, "agg-failover-skip").await;
    let client = reqwest::Client::new();
    let api_key = create_gateway_api_key(&client, gateway_addr).await;

    let request_body = json!({
        "model": "team-claude",
        "max_tokens": 64,
        "messages": [{ "role": "user", "content": [{ "type": "text", "text": "hello" }] }]
    });
    for _ in 0..2 {
        let response = client
            .post(format!("http://{gateway_addr}/v1/messages"))
            .header("x-api-key", &api_key)
            .json(&request_body)
            .send()
            .await
            .expect("send aggregated request");
        assert_eq!(response.status(), StatusCode::OK);
    }
    assert_eq!(
        hits.lock()
            .expect("lock hits")
            .iter()
            .filter(|m| *m == "claude-primary")
            .count(),
        2,
        "primary hit once per request before tripping"
    );

    // Two consecutive failures tripped the primary: state shows cooling and
    // the third request skips it entirely.
    let health: Value = client
        .get(format!(
            "http://{gateway_addr}/api/providers/backends/health"
        ))
        .send()
        .await
        .expect("request backends health")
        .json()
        .await
        .expect("decode backends health");
    let primary = health
        .get("backends")
        .and_then(Value::as_array)
        .expect("backends array")
        .iter()
        .find(|backend| {
            backend.get("key").and_then(Value::as_str) == Some("primary:claude-primary")
        })
        .expect("find primary health entry");
    assert_eq!(
        primary.get("state").and_then(Value::as_str),
        Some("cooling")
    );
    assert!(
        primary
            .get("cooldownRemainingSeconds")
            .and_then(Value::as_i64)
            .is_some_and(|seconds| seconds > 0 && seconds <= 60)
    );

    let response = client
        .post(format!("http://{gateway_addr}/v1/messages"))
        .header("x-api-key", &api_key)
        .json(&request_body)
        .send()
        .await
        .expect("send third aggregated request");
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        hits.lock()
            .expect("lock hits")
            .iter()
            .filter(|m| *m == "claude-primary")
            .count(),
        2,
        "cooling primary must not receive a third attempt"
    );

    gateway_handle.abort();
    upstream_handle.abort();
    let _ = stdfs::remove_dir_all(home_dir);
}

#[tokio::test]
async fn aggregate_failover_retrips_on_single_recovery_failure() {
    let (upstream_addr, upstream_handle, hits) = spawn_failover_upstream().await;
    let config = failover_gateway_config(
        upstream_addr,
        Some(cc_gw_core::config::FailoverPolicyConfig {
            consecutive_failures: Some(1),
            cooldown_seconds: Some(1),
            failure_window_seconds: Some(600),
            trigger_status_codes: None,
        }),
    );
    let (home_dir, gateway_addr, gateway_handle) =
        spawn_test_gateway(config, "agg-failover-recover").await;
    let client = reqwest::Client::new();
    let api_key = create_gateway_api_key(&client, gateway_addr).await;

    let request_body = json!({
        "model": "team-claude",
        "max_tokens": 64,
        "messages": [{ "role": "user", "content": [{ "type": "text", "text": "hello" }] }]
    });
    let send = || async {
        let response = client
            .post(format!("http://{gateway_addr}/v1/messages"))
            .header("x-api-key", &api_key)
            .json(&request_body)
            .send()
            .await
            .expect("send aggregated request");
        assert_eq!(response.status(), StatusCode::OK);
    };

    // First request fails on the primary and trips it (threshold 1).
    send().await;
    // Cooldown (1s) expires -> the primary is probed again, fails once more,
    // and re-trips immediately because the counter survived the cooldown.
    tokio::time::sleep(std::time::Duration::from_millis(1100)).await;
    send().await;

    assert_eq!(
        hits.lock()
            .expect("lock hits")
            .iter()
            .filter(|m| *m == "claude-primary")
            .count(),
        2,
        "primary probed once per cooldown cycle"
    );
    let health: Value = client
        .get(format!(
            "http://{gateway_addr}/api/providers/backends/health"
        ))
        .send()
        .await
        .expect("request backends health")
        .json()
        .await
        .expect("decode backends health");
    let primary_state = health
        .get("backends")
        .and_then(Value::as_array)
        .expect("backends array")
        .iter()
        .find(|backend| {
            backend.get("key").and_then(Value::as_str) == Some("primary:claude-primary")
        })
        .expect("find primary health entry")
        .get("state")
        .and_then(Value::as_str)
        .expect("state")
        .to_string();
    assert_eq!(primary_state, "cooling");

    gateway_handle.abort();
    upstream_handle.abort();
    let _ = stdfs::remove_dir_all(home_dir);
}

#[tokio::test]
async fn aggregate_failover_stream_handshake_failure_falls_through() {
    let hits = Arc::new(Mutex::new(Vec::<String>::new()));
    let hits_for_route = Arc::clone(&hits);
    let upstream = Router::new().route(
        "/v1/messages",
        post(move |AxumJson(payload): AxumJson<Value>| {
            let hits = Arc::clone(&hits_for_route);
            async move {
                let model = payload
                    .get("model")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string();
                hits.lock().expect("lock hits").push(model.clone());
                if model == "claude-primary" {
                    // Handshake failure before any SSE byte is written.
                    (
                        StatusCode::SERVICE_UNAVAILABLE,
                        Json(json!({ "type": "error", "error": { "message": "overloaded" } })),
                    )
                        .into_response()
                } else {
                    Response::builder()
                        .status(StatusCode::OK)
                        .header(header::CONTENT_TYPE, "text/event-stream")
                        .body(Body::from(concat!(
                            "event: message_start\n",
                            "data: {\"type\":\"message_start\",\"message\":{\"id\":\"msg_stream\",\"type\":\"message\",\"role\":\"assistant\",\"model\":\"claude-backup\",\"content\":[],\"stop_reason\":null,\"stop_sequence\":null,\"usage\":{\"input_tokens\":1,\"output_tokens\":0}}}\n\n",
                            "event: content_block_delta\n",
                            "data: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"stream-failover-ok\"}}\n\n",
                            "event: message_delta\n",
                            "data: {\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"end_turn\"},\"usage\":{\"input_tokens\":1,\"output_tokens\":3}}\n\n",
                            "event: message_stop\n",
                            "data: {\"type\":\"message_stop\"}\n\n"
                        )))
                        .expect("build SSE response")
                }
            }
        }),
    );
    let (upstream_addr, upstream_handle) = spawn_router(upstream).await;

    let config = failover_gateway_config(upstream_addr, None);
    let (home_dir, gateway_addr, gateway_handle) =
        spawn_test_gateway(config, "agg-failover-stream").await;
    let client = reqwest::Client::new();
    let api_key = create_gateway_api_key(&client, gateway_addr).await;

    let response = client
        .post(format!("http://{gateway_addr}/v1/messages"))
        .header("x-api-key", &api_key)
        .json(&json!({
            "model": "team-claude",
            "max_tokens": 64,
            "stream": true,
            "messages": [{ "role": "user", "content": [{ "type": "text", "text": "hello" }] }]
        }))
        .send()
        .await
        .expect("send streaming aggregated request");
    assert_eq!(response.status(), StatusCode::OK);
    let body = response.text().await.expect("read stream body");
    assert!(
        body.contains("stream-failover-ok"),
        "stream should be served by the backup backend, got: {body}"
    );

    gateway_handle.abort();
    upstream_handle.abort();
    let _ = stdfs::remove_dir_all(home_dir);
}

#[tokio::test]
async fn aggregate_single_backend_failure_passes_error_through() {
    let (upstream_addr, upstream_handle, hits) = spawn_failover_upstream().await;
    let mut config = failover_gateway_config(upstream_addr, None);
    // Single-member aggregate: the last (and only) candidate's error is
    // passed through to the client unchanged — same as a direct route.
    config.providers[0] =
        aggregate_provider_config("team", "team-claude", &["primary:claude-primary"], None);
    let (home_dir, gateway_addr, gateway_handle) =
        spawn_test_gateway(config, "agg-failover-last").await;
    let client = reqwest::Client::new();
    let api_key = create_gateway_api_key(&client, gateway_addr).await;

    let response = client
        .post(format!("http://{gateway_addr}/v1/messages"))
        .header("x-api-key", &api_key)
        .json(&json!({
            "model": "team-claude",
            "max_tokens": 64,
            "messages": [{ "role": "user", "content": [{ "type": "text", "text": "hello" }] }]
        }))
        .send()
        .await
        .expect("send aggregated request");
    assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);
    let body: Value = response.json().await.expect("decode error body");
    assert_eq!(
        body.pointer("/error/message").and_then(Value::as_str),
        Some("primary is dead")
    );
    assert_eq!(hits.lock().expect("lock hits").len(), 1);

    // Single-candidate routes never emit provider_failover events.
    let has_failover_event = fetch_events(&client, gateway_addr)
        .await
        .iter()
        .any(|event| event.get("type").and_then(Value::as_str) == Some("provider_failover"));
    assert!(
        !has_failover_event,
        "single-candidate routes must not emit provider_failover"
    );

    gateway_handle.abort();
    upstream_handle.abort();
    let _ = stdfs::remove_dir_all(home_dir);
}

#[tokio::test]
async fn aggregate_failover_all_backends_cooling_returns_429_unavailable() {
    let (upstream_addr, upstream_handle, hits) = spawn_failover_upstream().await;
    // Both members hit the always-failing model (each under its own provider
    // id, so they carry distinct backend health keys). Threshold 1 means the
    // first request cools both candidates down.
    let mut config = failover_gateway_config(
        upstream_addr,
        Some(cc_gw_core::config::FailoverPolicyConfig {
            consecutive_failures: Some(1),
            cooldown_seconds: Some(60),
            failure_window_seconds: Some(600),
            trigger_status_codes: None,
        }),
    );
    config.providers[0] = aggregate_provider_config(
        "team",
        "team-claude",
        &["primary:claude-primary", "backup:claude-primary"],
        Some(cc_gw_core::config::FailoverPolicyConfig {
            consecutive_failures: Some(1),
            cooldown_seconds: Some(60),
            failure_window_seconds: Some(600),
            trigger_status_codes: None,
        }),
    );
    config.providers[2] =
        anthropic_backend_config("backup", "claude-primary", format!("http://{upstream_addr}"));
    let (home_dir, gateway_addr, gateway_handle) =
        spawn_test_gateway(config, "agg-failover-all-cooling").await;
    let client = reqwest::Client::new();
    let api_key = create_gateway_api_key(&client, gateway_addr).await;

    let request_body = json!({
        "model": "team-claude",
        "max_tokens": 64,
        "messages": [{ "role": "user", "content": [{ "type": "text", "text": "hello" }] }]
    });

    // First request: both candidates fail the trigger check; the last one's
    // raw error is passed through, and both backends enter cooldown.
    let response = client
        .post(format!("http://{gateway_addr}/v1/messages"))
        .header("x-api-key", &api_key)
        .json(&request_body)
        .send()
        .await
        .expect("send first aggregated request");
    assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);
    assert_eq!(hits.lock().expect("lock hits").len(), 2);

    // Second request: every candidate is skipped by cooldown, so the gateway
    // answers the aggregate_backends_unavailable 429 (with Retry-After set to
    // the shortest remaining cooldown) without forwarding anything upstream.
    let response = client
        .post(format!("http://{gateway_addr}/v1/messages"))
        .header("x-api-key", &api_key)
        .json(&request_body)
        .send()
        .await
        .expect("send second aggregated request");
    assert_eq!(response.status(), StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(
        response
            .headers()
            .get("retry-after")
            .and_then(|value| value.to_str().ok()),
        Some("60")
    );
    let body: Value = response.json().await.expect("decode 429 body");
    assert_eq!(
        body.pointer("/error/code").and_then(Value::as_str),
        Some("aggregate_backends_unavailable")
    );
    assert_eq!(hits.lock().expect("lock hits").len(), 2);

    // The all-cooling attempt chain is recorded in the failover event.
    let cooling_event = fetch_events(&client, gateway_addr)
        .await
        .into_iter()
        .filter(|event| event.get("type").and_then(Value::as_str) == Some("provider_failover"))
        .find(|event| {
            event
                .get("details")
                .and_then(|details| details.get("attempts"))
                .and_then(Value::as_array)
                .map(|attempts| {
                    attempts
                        .iter()
                        .any(|attempt| attempt.get("outcome").and_then(Value::as_str)
                            == Some("skipped:cooldown"))
                })
                .unwrap_or(false)
        })
        .expect("find all-cooling provider_failover event");
    let attempts = cooling_event
        .get("details")
        .and_then(|details| details.get("attempts"))
        .and_then(Value::as_array)
        .expect("attempts array");
    assert_eq!(attempts.len(), 2);
    for attempt in attempts {
        assert_eq!(
            attempt.get("outcome").and_then(Value::as_str),
            Some("skipped:cooldown")
        );
        assert!(
            attempt.get("status").is_none(),
            "cooldown-skipped attempts must not carry an upstream status"
        );
    }

    gateway_handle.abort();
    upstream_handle.abort();
    let _ = stdfs::remove_dir_all(home_dir);
}

#[tokio::test]
async fn aggregate_failover_rpm_rejection_moves_to_next_candidate_without_health_hit() {
    let (upstream_addr, upstream_handle, _hits) = spawn_failover_upstream().await;
    // Both members are healthy upstream models; the preferred candidate's
    // provider carries a 1-RPM cap with no queue wait, so admission (not the
    // backend) is what fails.
    let mut config = failover_gateway_config(upstream_addr, None);
    config.providers[0] = aggregate_provider_config(
        "team",
        "team-claude",
        &["primary:claude-backup", "backup:claude-backup"],
        None,
    );
    config.providers[1].rpm_limit = Some(1);
    config.providers[1].rpm_max_wait_seconds = Some(0);
    // A direct route to the capped provider to burn its only RPM slot.
    if let Some(anthropic_routing) = config.endpoint_routing.get_mut("anthropic") {
        anthropic_routing
            .model_routes
            .insert("warm-up".to_string(), "primary:claude-backup".to_string());
    }
    let (home_dir, gateway_addr, gateway_handle) =
        spawn_test_gateway(config, "agg-failover-rpm").await;
    let client = reqwest::Client::new();
    let api_key = create_gateway_api_key(&client, gateway_addr).await;

    let request_body = json!({
        "model": "team-claude",
        "max_tokens": 64,
        "messages": [{ "role": "user", "content": [{ "type": "text", "text": "hello" }] }]
    });

    // Warm-up request consumes the preferred provider's only RPM slot.
    let warm_up = client
        .post(format!("http://{gateway_addr}/v1/messages"))
        .header("x-api-key", &api_key)
        .json(&json!({
            "model": "warm-up",
            "max_tokens": 64,
            "messages": [{ "role": "user", "content": [{ "type": "text", "text": "hello" }] }]
        }))
        .send()
        .await
        .expect("send warm-up request");
    assert_eq!(warm_up.status(), StatusCode::OK);

    // Aggregate request: the preferred candidate is rejected by local RPM
    // admission (immediately, thanks to the clamped max-wait), so the chain
    // moves on and the backup serves the client transparently.
    let response: Value = client
        .post(format!("http://{gateway_addr}/v1/messages"))
        .header("x-api-key", &api_key)
        .json(&request_body)
        .send()
        .await
        .expect("send aggregated request")
        .json()
        .await
        .expect("decode aggregated response");
    assert_eq!(
        response
            .get("content")
            .and_then(Value::as_array)
            .and_then(|items| items.first())
            .and_then(|item| item.get("text"))
            .and_then(Value::as_str),
        Some("backup-ok")
    );

    // The RPM rejection is an admission decision, not a backend failure: the
    // preferred backend must not appear in the health registry as failed.
    let health: Value = client
        .get(format!("http://{gateway_addr}/api/providers/backends/health"))
        .send()
        .await
        .expect("request backend health")
        .json()
        .await
        .expect("decode backend health");
    let has_preferred_entry = health
        .get("backends")
        .and_then(Value::as_array)
        .map(|backends| {
            backends.iter().any(|backend| {
                backend.get("key").and_then(Value::as_str) == Some("primary:claude-backup")
            })
        })
        .unwrap_or(false);
    assert!(
        !has_preferred_entry,
        "RPM rejection must not feed the backend health registry: {health}"
    );

    // The attempt chain records the rate-limited hop followed by the backup.
    let failover_event = fetch_events(&client, gateway_addr)
        .await
        .into_iter()
        .find(|event| {
            event.get("type").and_then(Value::as_str) == Some("provider_failover")
                && event
                    .get("details")
                    .and_then(|details| details.get("attempts"))
                    .and_then(Value::as_array)
                    .map(|attempts| {
                        attempts
                            .iter()
                            .any(|attempt| attempt.get("outcome").and_then(Value::as_str)
                                == Some("rate-limited"))
                    })
                    .unwrap_or(false)
        })
        .expect("find rate-limited provider_failover event");
    let attempts = failover_event
        .get("details")
        .and_then(|details| details.get("attempts"))
        .and_then(Value::as_array)
        .expect("attempts array");
    assert_eq!(attempts.len(), 2);
    assert_eq!(
        attempts[0].get("provider").and_then(Value::as_str),
        Some("primary")
    );
    assert_eq!(
        attempts[0].get("outcome").and_then(Value::as_str),
        Some("rate-limited")
    );
    assert!(
        attempts[0].get("status").is_none(),
        "rate-limited attempts must not carry an upstream status"
    );
    assert_eq!(
        attempts[1].get("provider").and_then(Value::as_str),
        Some("backup")
    );
    assert_eq!(
        attempts[1].get("outcome").and_then(Value::as_str),
        Some("selected")
    );

    gateway_handle.abort();
    upstream_handle.abort();
    let _ = stdfs::remove_dir_all(home_dir);
}
