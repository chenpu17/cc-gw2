use super::*;
use axum::extract::{Json as AxumJson, Query};
use futures_util::StreamExt;
use std::fs as stdfs;
use std::sync::{Arc, Mutex};
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
        profiling_active: Arc::new(AtomicU64::new(0)),
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
            }],
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
async fn anthropic_messages_validation_accepts_string_or_block_content_in_claude_code_mode() {
    let attempts = Arc::new(Mutex::new(0usize));
    let attempts_for_route = Arc::clone(&attempts);
    let upstream = Router::new().route(
        "/v1/messages",
        post(move || {
            let attempts = Arc::clone(&attempts_for_route);
            async move {
                *attempts.lock().expect("lock attempts") += 1;
                Json(json!({
                    "id": "msg_ok",
                    "type": "message",
                    "role": "assistant",
                    "model": "claude-test",
                    "content": [{
                        "type": "text",
                        "text": "ok"
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
        id: "mock-anthropic".to_string(),
        label: "Mock Anthropic".to_string(),
        base_url: format!("http://{upstream_addr}"),
        provider_type: Some("anthropic".to_string()),
        default_model: Some("claude-test".to_string()),
        models: vec![cc_gw_core::config::ProviderModelConfig {
            id: "claude-test".to_string(),
            label: Some("Claude Test".to_string()),
        }],
        ..cc_gw_core::config::ProviderConfig::default()
    }];
    config.defaults.completion = Some("claude-test".to_string());
    if let Some(anthropic_routing) = config.endpoint_routing.get_mut("anthropic") {
        anthropic_routing.defaults.completion = Some("claude-test".to_string());
        anthropic_routing.validation = Some(cc_gw_core::config::EndpointValidationConfig {
            mode: "claude-code".to_string(),
            allow_experimental_blocks: Some(true),
        });
    }

    let (home_dir, gateway_addr, gateway_handle) =
        spawn_test_gateway(config, "anthropic-validation").await;
    let client = reqwest::Client::new();

    let string_content = client
        .post(format!("http://{gateway_addr}/v1/messages"))
        .json(&json!({
            "model": "claude-test",
            "max_tokens": 64,
            "messages": [{
                "role": "user",
                "content": "hello"
            }]
        }))
        .send()
        .await
        .expect("send string-content claude-code request");
    assert_eq!(string_content.status(), StatusCode::OK);

    let valid = client
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
        .expect("send valid claude-code request");
    assert_eq!(valid.status(), StatusCode::OK);

    assert_eq!(*attempts.lock().expect("lock attempts"), 2);

    gateway_handle.abort();
    upstream_handle.abort();
    let _ = stdfs::remove_dir_all(home_dir);
}

#[tokio::test]
async fn anthropic_messages_validation_rejects_unknown_block_types_in_claude_code_mode() {
    let attempts = Arc::new(Mutex::new(0usize));
    let attempts_for_route = Arc::clone(&attempts);
    let upstream = Router::new().route(
        "/v1/messages",
        post(move || {
            let attempts = Arc::clone(&attempts_for_route);
            async move {
                *attempts.lock().expect("lock attempts") += 1;
                Json(json!({
                    "id": "msg_ok",
                    "type": "message",
                    "role": "assistant",
                    "model": "claude-test",
                    "content": [{
                        "type": "text",
                        "text": "ok"
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
        id: "mock-anthropic".to_string(),
        label: "Mock Anthropic".to_string(),
        base_url: format!("http://{upstream_addr}"),
        provider_type: Some("anthropic".to_string()),
        default_model: Some("claude-test".to_string()),
        models: vec![cc_gw_core::config::ProviderModelConfig {
            id: "claude-test".to_string(),
            label: Some("Claude Test".to_string()),
        }],
        ..cc_gw_core::config::ProviderConfig::default()
    }];
    config.defaults.completion = Some("claude-test".to_string());
    if let Some(anthropic_routing) = config.endpoint_routing.get_mut("anthropic") {
        anthropic_routing.defaults.completion = Some("claude-test".to_string());
        anthropic_routing.validation = Some(cc_gw_core::config::EndpointValidationConfig {
            mode: "claude-code".to_string(),
            allow_experimental_blocks: Some(true),
        });
    }

    let (home_dir, gateway_addr, gateway_handle) =
        spawn_test_gateway(config, "anthropic-validation-unknown-block").await;
    let client = reqwest::Client::new();

    let invalid = client
        .post(format!("http://{gateway_addr}/v1/messages"))
        .json(&json!({
            "model": "claude-test",
            "max_tokens": 64,
            "messages": [{
                "role": "user",
                "content": [{
                    "type": "server_tool_use",
                    "name": "search"
                }]
            }]
        }))
        .send()
        .await
        .expect("send invalid claude-code block request");
    assert_eq!(
        invalid.status(),
        StatusCode::from_u16(430).expect("430 status")
    );
    let invalid_body: Value = invalid.json().await.expect("decode invalid response");
    assert_eq!(
        invalid_body
            .get("error")
            .and_then(|error| error.get("code"))
            .and_then(Value::as_str),
        Some("invalid_claude_code_request")
    );
    assert_eq!(*attempts.lock().expect("lock attempts"), 0);

    gateway_handle.abort();
    upstream_handle.abort();
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
    assert_eq!(
        response.get("channel").and_then(Value::as_str),
        Some("latest")
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
            "enabled": true
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
        }],
        ..cc_gw_core::config::ProviderConfig::default()
    }];
    config.defaults.completion = Some("retry-openai:gpt-test".to_string());
    if let Some(anthropic) = config.endpoint_routing.get_mut("anthropic") {
        anthropic.defaults.completion = Some("retry-openai:gpt-test".to_string());
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
async fn openai_responses_retry_drops_metadata_and_tool_choice() {
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

    let response: Value = client
        .post(format!("http://{gateway_addr}/openai/v1/responses"))
        .json(&json!({
            "model": "gpt-test",
            "metadata": { "user_id": "user-1" },
            "tool_choice": "auto",
            "input": "hello"
        }))
        .send()
        .await
        .expect("send responses request")
        .json()
        .await
        .expect("decode responses response");

    assert_eq!(
        response.get("output_text").and_then(Value::as_str),
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
        }],
        ..cc_gw_core::config::ProviderConfig::default()
    }];
    config.defaults.completion = Some("custom-openai:custom-model".to_string());
    if let Some(anthropic) = config.endpoint_routing.get_mut("anthropic") {
        anthropic.defaults.completion = Some("custom-openai:custom-model".to_string());
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
async fn openai_responses_to_custom_provider_strips_tooling_and_metadata() {
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
    assert!(forwarded.get("metadata").is_none());
    assert!(forwarded.get("tools").is_none());
    assert!(forwarded.get("tool_choice").is_none());
    assert!(
        forwarded
            .get("input")
            .and_then(Value::as_array)
            .is_some_and(|items| items.iter().all(|item| {
                item.get("type").and_then(Value::as_str) == Some("message")
                    && item
                        .get("content")
                        .and_then(Value::as_array)
                        .is_some_and(|content| {
                            content.iter().all(|part| {
                                matches!(
                                    part.get("type").and_then(Value::as_str),
                                    Some("input_text" | "output_text" | "text")
                                )
                            })
                        })
            }))
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
    let (home_dir, gateway_addr, gateway_handle) = spawn_test_gateway(config, "root-seo-files").await;
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

// ---------------------------------------------------------------------------
// Profiler API tests
// ---------------------------------------------------------------------------

#[tokio::test]
async fn profiler_status_start_stop() {
    let (home_dir, addr, handle) =
        spawn_test_gateway(GatewayConfig::default(), "profiler-status").await;
    let client = reqwest::Client::new();

    // Initial status: not active
    let status: Value = client
        .get(format!("http://{addr}/api/profiler/status"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(status["active"], false);

    // Start recording
    let status: Value = client
        .post(format!("http://{addr}/api/profiler/start"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(status["active"], true);

    // Status now active
    let status: Value = client
        .get(format!("http://{addr}/api/profiler/status"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(status["active"], true);

    // Stop recording
    let status: Value = client
        .post(format!("http://{addr}/api/profiler/stop"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(status["active"], false);

    handle.abort();
    let _ = stdfs::remove_dir_all(home_dir);
}

#[tokio::test]
async fn profiler_sessions_list_and_clear() {
    let (home_dir, addr, handle) =
        spawn_test_gateway(GatewayConfig::default(), "profiler-sessions").await;
    let client = reqwest::Client::new();

    // Empty list
    let list: Value = client
        .get(format!("http://{addr}/api/profiler/sessions"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(list["total"], 0);
    assert!(list["items"].as_array().unwrap().is_empty());

    // Unknown session returns 404
    let res = client
        .get(format!("http://{addr}/api/profiler/sessions/unknown-id"))
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), 404);

    // Delete unknown session returns 404
    let res = client
        .delete(format!("http://{addr}/api/profiler/sessions/unknown-id"))
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), 404);

    // Clear returns count 0
    let cleared: Value = client
        .post(format!("http://{addr}/api/profiler/sessions/clear"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(cleared["deleted"], 0);

    handle.abort();
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
