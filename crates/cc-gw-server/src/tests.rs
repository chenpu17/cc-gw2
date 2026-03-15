use super::*;
use axum::extract::Query;
use std::fs as stdfs;
use tokio::task::JoinHandle;
use tokio::time::{sleep, Duration};

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

fn build_test_state(config: GatewayConfig, paths: GatewayPaths, ui_root: Option<PathBuf>) -> AppState {
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
        http_client: reqwest::Client::builder().build().expect("client"),
        sessions: auth::SessionStore::default(),
    }
}

async fn spawn_router(app: Router) -> (SocketAddr, JoinHandle<()>) {
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind listener");
    let addr = listener.local_addr().expect("listener addr");
    let handle = tokio::spawn(async move {
        axum::serve(listener, app.into_make_service_with_connect_info::<SocketAddr>())
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
        .post(format!("http://{gateway_addr}/disabled-team/v1/chat/completions"))
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
        live_status
            .get("activeRequests")
            .and_then(Value::as_u64),
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
        settled_status
            .get("activeRequests")
            .and_then(Value::as_u64),
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
        ui_root.join("index.html"),
        "<!doctype html><html><body>ok</body></html>",
    )
    .expect("write index");
    stdfs::write(assets_dir.join("app-123.js"), "console.log('ok');").expect("write asset");

    let state = build_test_state(GatewayConfig::default(), paths.clone(), Some(ui_root));
    let (gateway_addr, gateway_handle) = spawn_router(build_router(state)).await;
    let client = reqwest::Client::new();

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

    gateway_handle.abort();
    let _ = stdfs::remove_dir_all(paths.home_dir);
}
