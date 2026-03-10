use std::io::{Cursor, Write};
use std::net::SocketAddr;
use std::path::{Component, Path, PathBuf};
use std::sync::{
    Arc, RwLock,
    atomic::{AtomicU64, Ordering},
};

use anyhow::{Context, Result, anyhow};
use async_stream::stream;
use axum::{
    Json, Router,
    body::Body,
    body::Bytes,
    extract::{Path as AxumPath, Query, Request, State},
    http::{HeaderMap, HeaderValue, Method, StatusCode, Uri, header},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, patch, post},
};
use axum_server::tls_rustls::RustlsConfig;
use cc_gw_core::{
    api_keys::{
        ApiKeyError, AuthFailureCode, create_api_key, decrypt_log_api_key_value, delete_api_key,
        encrypt_secret, get_api_key_overview_metrics, get_api_key_usage_metrics, list_api_keys,
        mask_revealed_key, normalize_allowed_endpoints, record_api_key_usage, resolve_api_key,
        reveal_api_key, update_api_key_settings,
    },
    config::{
        CustomEndpointConfig, EndpointPathConfig, EndpointRoutingConfig, GatewayConfig,
        GatewayPaths, RoutingPreset, load_or_init_config, save_config,
    },
    convert::{
        anthropic_request_to_openai_chat, anthropic_response_to_openai_chat,
        anthropic_response_to_openai_response, openai_chat_request_to_anthropic,
        openai_chat_response_to_anthropic, openai_responses_request_to_anthropic,
        openai_responses_response_to_anthropic,
    },
    events::{RecordEventInput, list_events, record_event},
    models::build_models_response,
    observability::{
        LogQuery, RequestLogInput, RequestLogUpdate, UsageStats, cleanup_logs_before,
        clear_all_logs, compact_database, export_logs, finalize_request_log, get_daily_metrics,
        get_database_info, get_log_detail, get_metrics_overview, get_model_usage_metrics,
        increment_daily_metrics, insert_request_log, query_logs, upsert_request_payload,
    },
    provider::{ProviderProtocol, ProxyRequest, forward_request},
    routing::{GatewayEndpoint, resolve_route},
    storage::initialize_database,
    stream::{CrossProtocolStreamTransformer, SseStreamObserver},
    ui::resolve_web_dist,
};
use futures_util::TryStreamExt;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::HashMap;
use tokio::{fs, net::TcpListener, task::JoinSet};
use tracing::{info, warn};
use zip::write::SimpleFileOptions;

mod auth;

#[derive(Clone)]
struct AppState {
    config: Arc<RwLock<GatewayConfig>>,
    paths: Arc<GatewayPaths>,
    ui_root: Option<Arc<PathBuf>>,
    active_requests: Arc<AtomicU64>,
    http_client: reqwest::Client,
    sessions: auth::SessionStore,
}

#[derive(Serialize)]
struct StatusResponse {
    port: Option<u16>,
    host: Option<String>,
    providers: usize,
    #[serde(rename = "activeRequests")]
    active_requests: u64,
    #[serde(rename = "runtime")]
    runtime: &'static str,
    #[serde(rename = "backendVersion")]
    backend_version: &'static str,
    #[serde(rename = "platform")]
    platform: String,
    pid: u32,
}

#[derive(Serialize)]
struct ConfigInfoResponse {
    config: GatewayConfig,
    path: String,
}

#[derive(Debug, Deserialize)]
struct CreateApiKeyBody {
    name: Option<String>,
    description: Option<String>,
    #[serde(rename = "allowedEndpoints")]
    allowed_endpoints: Option<Vec<String>>,
}

#[derive(Debug, Deserialize)]
struct UpdateWebAuthBody {
    enabled: bool,
    username: Option<String>,
    password: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CustomEndpointBody {
    id: Option<String>,
    label: Option<String>,
    deletable: Option<bool>,
    paths: Option<Vec<EndpointPathConfig>>,
    path: Option<String>,
    protocol: Option<String>,
    enabled: Option<bool>,
    routing: Option<EndpointRoutingConfig>,
}

#[derive(Debug, Deserialize)]
struct PresetNameBody {
    name: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ProviderTestBody {
    headers: Option<HashMap<String, String>>,
    query: Option<String>,
}

#[derive(Clone)]
struct StreamingLogContext {
    db_path: PathBuf,
    log_id: i64,
    endpoint_id: String,
    api_key_id: i64,
    started_at: i64,
    store_response_payload: bool,
}

fn extract_provider_test_sample(provider_type: Option<&str>, payload: &Value) -> Option<String> {
    let sample = if matches!(provider_type, Some("anthropic")) {
        payload
            .get("content")
            .and_then(Value::as_array)
            .map(|blocks| {
                blocks
                    .iter()
                    .filter(|block| block.get("type").and_then(Value::as_str) == Some("text"))
                    .filter_map(|block| block.get("text").and_then(Value::as_str))
                    .collect::<Vec<_>>()
                    .join("\n")
            })
    } else {
        payload
            .get("choices")
            .and_then(Value::as_array)
            .and_then(|choices| choices.first())
            .and_then(|choice| {
                if let Some(content) = choice
                    .get("message")
                    .and_then(|message| message.get("content"))
                {
                    if let Some(text) = content.as_str() {
                        return Some(text.to_string());
                    }
                    if let Some(parts) = content.as_array() {
                        let joined = parts
                            .iter()
                            .filter_map(|part| {
                                if let Some(text) = part.as_str() {
                                    return Some(text.to_string());
                                }
                                part.get("text")
                                    .and_then(Value::as_str)
                                    .map(ToString::to_string)
                            })
                            .collect::<Vec<_>>()
                            .join("\n");
                        if !joined.trim().is_empty() {
                            return Some(joined);
                        }
                    }
                }
                choice
                    .get("text")
                    .and_then(Value::as_str)
                    .map(ToString::to_string)
            })
    };

    sample
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            std::env::var("RUST_LOG").unwrap_or_else(|_| "cc_gw_server=info,axum=info".to_string()),
        )
        .init();

    let port_override = std::env::var("PORT")
        .ok()
        .and_then(|value| value.parse::<u16>().ok());

    let (paths, config) = load_or_init_config(port_override)?;
    initialize_database(&paths.db_path)?;

    let ui_root = resolve_web_dist().map(Arc::new);
    if let Some(path) = ui_root.as_ref() {
        info!("serving web ui from {}", path.display());
    } else {
        warn!("web ui dist not found; /ui will return 404 until frontend is built");
    }

    let state = AppState {
        config: Arc::new(RwLock::new(config.clone())),
        paths: Arc::new(paths),
        ui_root,
        active_requests: Arc::new(AtomicU64::new(0)),
        http_client: reqwest::Client::builder()
            .build()
            .context("failed to build reqwest client")?,
        sessions: auth::SessionStore::default(),
    };

    let app = build_router(state.clone());
    let mut tasks = JoinSet::new();

    if let Some(http) = config.effective_http() {
        let addr = socket_addr(http.host.as_deref(), http.port)?;
        let app = app.clone();
        tasks.spawn(async move {
            info!("http listening on http://{}", addr);
            let listener = TcpListener::bind(addr).await?;
            axum::serve(listener, app.into_make_service()).await?;
            Result::<()>::Ok(())
        });
    }

    if let Some(https) = config.effective_https() {
        let addr = socket_addr(https.host.as_deref(), https.port)?;
        let app = app.clone();
        tasks.spawn(async move {
            info!("https listening on https://{}", addr);
            let tls = RustlsConfig::from_pem_file(&https.cert_path, &https.key_path).await?;
            axum_server::bind_rustls(addr, tls)
                .serve(app.into_make_service())
                .await
                .map_err(|error| anyhow!(error))?;
            Result::<()>::Ok(())
        });
    }

    if tasks.is_empty() {
        return Err(anyhow!("没有可用的监听端口配置"));
    }

    while let Some(result) = tasks.join_next().await {
        result??;
    }

    Ok(())
}

fn build_router(state: AppState) -> Router {
    Router::new()
        .route("/", get(root_redirect))
        .route("/health", get(health))
        .route("/auth/session", get(auth_session))
        .route("/auth/login", post(auth_login))
        .route("/auth/logout", post(auth_logout))
        .route("/api/status", get(api_status))
        .route("/api/config", get(api_config).put(api_config_update))
        .route("/api/config/info", get(api_config_info))
        .route("/api/auth/web", get(api_auth_web).post(api_auth_web_update))
        .route("/api/providers", get(api_providers))
        .route("/api/providers/{id}/test", post(api_provider_test))
        .route(
            "/api/custom-endpoints",
            get(api_custom_endpoints).post(api_custom_endpoints_create),
        )
        .route(
            "/api/custom-endpoints/{id}",
            axum::routing::put(api_custom_endpoints_update).delete(api_custom_endpoints_delete),
        )
        .route(
            "/api/routing-presets/{endpoint}",
            post(api_routing_presets_create),
        )
        .route(
            "/api/routing-presets/{endpoint}/apply",
            post(api_routing_presets_apply),
        )
        .route(
            "/api/routing-presets/{endpoint}/{name}",
            axum::routing::delete(api_routing_presets_delete),
        )
        .route("/api/events", get(api_events))
        .route("/api/keys", get(api_keys_list).post(api_keys_create))
        .route(
            "/api/keys/{id}",
            patch(api_keys_patch).delete(api_keys_delete),
        )
        .route("/api/keys/{id}/reveal", get(api_keys_reveal))
        .route("/api/logs", get(api_logs))
        .route("/api/logs/export", post(api_logs_export))
        .route("/api/logs/cleanup", post(api_logs_cleanup))
        .route("/api/logs/clear", post(api_logs_clear))
        .route("/api/logs/{id}", get(api_log_detail))
        .route("/api/db/info", get(api_db_info))
        .route("/api/db/compact", post(api_db_compact))
        .route("/api/stats/overview", get(api_stats_overview))
        .route("/api/stats/daily", get(api_stats_daily))
        .route("/api/stats/model", get(api_stats_model))
        .route(
            "/api/stats/api-keys/overview",
            get(api_stats_api_keys_overview),
        )
        .route("/api/stats/api-keys/usage", get(api_stats_api_keys_usage))
        .route(
            "/anthropic/api/event_logging/batch",
            post(anthropic_event_logging_batch),
        )
        .route("/v1/messages", post(anthropic_messages))
        .route("/anthropic/v1/messages", post(anthropic_messages))
        .route("/anthropic/v1/v1/messages", post(anthropic_messages))
        .route("/v1/messages/count_tokens", post(anthropic_count_tokens))
        .route(
            "/anthropic/v1/messages/count_tokens",
            post(anthropic_count_tokens),
        )
        .route(
            "/anthropic/v1/v1/messages/count_tokens",
            post(anthropic_count_tokens),
        )
        .route("/openai/v1/models", get(openai_models))
        .route("/openai/models", get(openai_models))
        .route("/openai/v1/chat/completions", post(openai_chat_completions))
        .route("/openai/chat/completions", post(openai_chat_completions))
        .route("/openai/v1/responses", post(openai_responses))
        .route("/openai/responses", post(openai_responses))
        .route("/ui", get(ui_redirect))
        .route("/ui/", get(ui_index))
        .route("/favicon.ico", get(favicon))
        .route("/ui/{*path}", get(ui_path))
        .route("/assets/{*path}", get(asset_path))
        .fallback(dynamic_fallback)
        .layer(middleware::from_fn_with_state(
            state.clone(),
            web_auth_middleware,
        ))
        .with_state(state)
}

fn socket_addr(host: Option<&str>, port: u16) -> Result<SocketAddr> {
    let host = host.unwrap_or("127.0.0.1");
    format!("{host}:{port}")
        .parse::<SocketAddr>()
        .with_context(|| format!("无效监听地址: {host}:{port}"))
}

fn config_snapshot(state: &AppState) -> GatewayConfig {
    state.config.read().expect("config lock poisoned").clone()
}

fn replace_config(state: &AppState, config: GatewayConfig) -> Result<()> {
    config.validate()?;
    save_config(&state.paths, &config)?;
    *state.config.write().expect("config lock poisoned") = config;
    Ok(())
}

fn normalize_path(path: &str) -> String {
    let trimmed = path.trim();
    if trimmed.starts_with('/') {
        trimmed.to_string()
    } else {
        format!("/{trimmed}")
    }
}

fn validate_endpoint_protocol(protocol: &str) -> bool {
    matches!(
        protocol,
        "anthropic" | "openai-chat" | "openai-responses" | "openai-auto"
    )
}

fn custom_endpoint_effective_paths(endpoint: &CustomEndpointConfig) -> Vec<EndpointPathConfig> {
    if !endpoint.paths.is_empty() {
        endpoint.paths.clone()
    } else if let (Some(path), Some(protocol)) = (&endpoint.path, &endpoint.protocol) {
        vec![EndpointPathConfig {
            path: path.clone(),
            protocol: protocol.clone(),
        }]
    } else {
        Vec::new()
    }
}

fn parse_preset_endpoint(config: &GatewayConfig, endpoint: &str) -> Option<String> {
    if endpoint == "anthropic" || endpoint == "openai" {
        return Some(endpoint.to_string());
    }
    config
        .custom_endpoints
        .iter()
        .find(|item| item.id == endpoint)
        .map(|item| item.id.clone())
}

#[derive(Clone)]
enum CustomRouteMatch {
    AnthropicMessages(String),
    AnthropicCountTokens(String),
    OpenAiModels(String),
    OpenAiChat(String),
    OpenAiResponses(String),
}

fn match_custom_route(config: &GatewayConfig, path: &str) -> Option<CustomRouteMatch> {
    for endpoint in &config.custom_endpoints {
        for item in custom_endpoint_effective_paths(endpoint) {
            let base = normalize_path(&item.path);
            match item.protocol.as_str() {
                "anthropic" => {
                    if path == format!("{base}/v1/messages")
                        || path == format!("{base}/v1/v1/messages")
                    {
                        return Some(CustomRouteMatch::AnthropicMessages(endpoint.id.clone()));
                    }
                    if path == format!("{base}/v1/messages/count_tokens")
                        || path == format!("{base}/v1/v1/messages/count_tokens")
                    {
                        return Some(CustomRouteMatch::AnthropicCountTokens(endpoint.id.clone()));
                    }
                }
                "openai-chat" => {
                    if path == format!("{base}/v1/models") {
                        return Some(CustomRouteMatch::OpenAiModels(endpoint.id.clone()));
                    }
                    if path == format!("{base}/v1/chat/completions") {
                        return Some(CustomRouteMatch::OpenAiChat(endpoint.id.clone()));
                    }
                }
                "openai-responses" => {
                    if path == format!("{base}/v1/models") {
                        return Some(CustomRouteMatch::OpenAiModels(endpoint.id.clone()));
                    }
                    if path == format!("{base}/v1/responses") {
                        return Some(CustomRouteMatch::OpenAiResponses(endpoint.id.clone()));
                    }
                }
                "openai-auto" => {
                    if path == format!("{base}/v1/models") {
                        return Some(CustomRouteMatch::OpenAiModels(endpoint.id.clone()));
                    }
                    if path == format!("{base}/v1/chat/completions") {
                        return Some(CustomRouteMatch::OpenAiChat(endpoint.id.clone()));
                    }
                    if path == format!("{base}/v1/responses") {
                        return Some(CustomRouteMatch::OpenAiResponses(endpoint.id.clone()));
                    }
                }
                _ => {}
            }
        }
    }
    None
}

async fn root_redirect() -> Response {
    legacy_redirect("/ui/")
}

async fn ui_redirect() -> Response {
    legacy_redirect("/ui/")
}

fn legacy_redirect(location: &str) -> Response {
    (
        StatusCode::FOUND,
        [(header::LOCATION, location)],
    )
        .into_response()
}

async fn health() -> Json<serde_json::Value> {
    Json(json!({ "status": "ok" }))
}

async fn anthropic_event_logging_batch() -> StatusCode {
    StatusCode::NO_CONTENT
}

async fn auth_session(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Json<serde_json::Value> {
    let config = config_snapshot(&state);
    let web_auth = config.web_auth.unwrap_or_default();
    if !web_auth.enabled {
        return Json(json!({
            "authEnabled": false,
            "authenticated": true
        }));
    }

    let session = state
        .sessions
        .read_session(header_value(&headers, header::COOKIE.as_str()).as_deref());
    if let Some(session) = session {
        Json(json!({
            "authEnabled": true,
            "authenticated": true,
            "username": session.username
        }))
    } else {
        Json(json!({
            "authEnabled": true,
            "authenticated": false
        }))
    }
}

async fn auth_login(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> Response {
    let config = config_snapshot(&state);
    let web_auth = config.web_auth.unwrap_or_default();
    if !web_auth.enabled {
        return Json(json!({
            "success": true,
            "authEnabled": false
        }))
        .into_response();
    }

    let username = auth::sanitize_username(body.get("username").and_then(Value::as_str));
    let password = body.get("password").and_then(Value::as_str);
    if username.is_none() || password.is_none() {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Missing username or password" })),
        )
            .into_response();
    }

    let username = username.unwrap_or_default();
    if web_auth.username.as_deref() != Some(username.as_str())
        || !auth::verify_password(
            password.unwrap_or_default(),
            web_auth.password_hash.as_deref(),
            web_auth.password_salt.as_deref(),
        )
    {
        let _ = record_event(
            &state.paths.db_path,
            &RecordEventInput {
                event_type: "web_auth_login_failure".to_string(),
                level: Some("warn".to_string()),
                source: Some("web-auth".to_string()),
                title: Some("Web login failed".to_string()),
                message: Some("Invalid credentials".to_string()),
                ip_address: header_value(&headers, "x-forwarded-for"),
                user_agent: header_value(&headers, header::USER_AGENT.as_str()),
                ..RecordEventInput::default()
            },
        );
        return (
            StatusCode::UNAUTHORIZED,
            Json(json!({ "error": "Invalid credentials" })),
        )
            .into_response();
    }

    let session = state.sessions.issue_session(&username);
    let _ = record_event(
        &state.paths.db_path,
        &RecordEventInput {
            event_type: "web_auth_login_success".to_string(),
            level: Some("info".to_string()),
            source: Some("web-auth".to_string()),
            title: Some("Web login succeeded".to_string()),
            message: Some(format!("Authenticated web user {username}")),
            ip_address: header_value(&headers, "x-forwarded-for"),
            user_agent: header_value(&headers, header::USER_AGENT.as_str()),
            ..RecordEventInput::default()
        },
    );
    match Response::builder()
        .status(StatusCode::OK)
        .header(
            header::SET_COOKIE,
            auth::build_session_cookie(&session.token),
        )
        .header(header::CACHE_CONTROL, "no-store")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from("{\"success\":true}"))
    {
        Ok(response) => response,
        Err(error) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": error.to_string() })),
        )
            .into_response(),
    }
}

async fn auth_logout(State(state): State<AppState>, headers: HeaderMap) -> Response {
    state.sessions.revoke_session(
        auth::get_session_token(header_value(&headers, header::COOKIE.as_str()).as_deref())
            .as_deref(),
    );
    match Response::builder()
        .status(StatusCode::OK)
        .header(header::SET_COOKIE, auth::clear_session_cookie())
        .header(header::CACHE_CONTROL, "no-store")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from("{\"success\":true}"))
    {
        Ok(response) => response,
        Err(error) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": error.to_string() })),
        )
            .into_response(),
    }
}

async fn api_status(State(state): State<AppState>) -> Json<StatusResponse> {
    let config = config_snapshot(&state);
    Json(StatusResponse {
        port: config.port,
        host: config.host.clone(),
        providers: config.providers.len(),
        active_requests: state.active_requests.load(Ordering::Relaxed),
        runtime: "rust",
        backend_version: env!("CARGO_PKG_VERSION"),
        platform: format!("{}-{}", std::env::consts::OS, std::env::consts::ARCH),
        pid: std::process::id(),
    })
}

async fn api_config(State(state): State<AppState>) -> Json<GatewayConfig> {
    Json(config_snapshot(&state).sanitize_for_web())
}

async fn api_config_info(State(state): State<AppState>) -> Json<ConfigInfoResponse> {
    let config = config_snapshot(&state).sanitize_for_web();
    Json(ConfigInfoResponse {
        config,
        path: state.paths.config_path.display().to_string(),
    })
}

async fn api_providers(
    State(state): State<AppState>,
) -> Json<Vec<cc_gw_core::config::ProviderConfig>> {
    Json(config_snapshot(&state).providers)
}

async fn api_provider_test(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
    Json(body): Json<Option<ProviderTestBody>>,
) -> Response {
    let config = config_snapshot(&state);
    let Some(provider) = config.providers.iter().find(|item| item.id == id).cloned() else {
        return (
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "Provider not found" })),
        )
            .into_response();
    };
    let target_model = provider
        .default_model
        .clone()
        .or_else(|| provider.models.first().map(|model| model.id.clone()));
    let Some(target_model) = target_model else {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({
                "ok": false,
                "status": 0,
                "statusText": "No model configured for provider"
            })),
        )
            .into_response();
    };

    let mut incoming_headers = HeaderMap::new();
    if let Some(headers) = body.as_ref().and_then(|payload| payload.headers.as_ref()) {
        for (key, value) in headers {
            let normalized_key = key.trim().to_ascii_lowercase();
            if normalized_key.is_empty() {
                continue;
            }
            if let (Ok(name), Ok(value)) = (
                axum::http::header::HeaderName::from_bytes(normalized_key.as_bytes()),
                HeaderValue::from_str(value),
            ) {
                incoming_headers.insert(name, value);
            }
        }
    }
    let request_query = body
        .as_ref()
        .and_then(|payload| payload.query.as_deref())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string);
    if let Some(query) = request_query.as_deref() {
        if query.contains("beta=true") {
            incoming_headers.insert(
                axum::http::header::HeaderName::from_static("anthropic-beta"),
                HeaderValue::from_static(
                    "claude-code-20250219,interleaved-thinking-2025-05-14,fine-grained-tool-streaming-2025-05-14",
                ),
            );
        }
    }

    let (protocol, request_body) = if matches!(provider.provider_type.as_deref(), Some("anthropic"))
    {
        (
            ProviderProtocol::AnthropicMessages,
            json!({
                "model": target_model,
                "stream": false,
                "max_tokens": 256,
                "temperature": 0,
                "messages": [{
                    "role": "user",
                    "content": [
                        { "type": "text", "text": "You are a connection diagnostic assistant." },
                        { "type": "text", "text": "你好，这是一次连接测试。请简短回应以确认服务可用。" }
                    ]
                }]
            }),
        )
    } else {
        (
            ProviderProtocol::OpenAiChatCompletions,
            json!({
                "model": target_model,
                "stream": false,
                "temperature": 0,
                "messages": [{
                    "role": "user",
                    "content": "你好，这是一次连接测试。请简短回应以确认服务可用。"
                }]
            }),
        )
    };

    let started_at = chrono::Utc::now().timestamp_millis();
    match forward_request(
        &state.http_client,
        &provider,
        protocol,
        ProxyRequest {
            model: target_model.clone(),
            body: request_body,
            stream: false,
            incoming_headers: incoming_headers.clone(),
            passthrough_headers: incoming_headers,
            query: request_query.clone(),
        },
    )
    .await
    {
        Ok(response) => {
            let duration_ms = chrono::Utc::now().timestamp_millis() - started_at;
            let status = response.status();
            let text = response.text().await.unwrap_or_default();
            if !status.is_success() {
                let status_text = if text.contains("only authorized for use with Claude Code") {
                    "测试请求被拒绝：该凭证仅授权在 Claude Code 内使用。请直接在 IDE 中发起一次对话确认真实连通性。"
                        .to_string()
                } else if text.trim().is_empty() {
                    "Upstream error".to_string()
                } else {
                    text.clone()
                };
                return Json(json!({
                    "ok": false,
                    "status": status.as_u16(),
                    "statusText": status_text,
                    "durationMs": duration_ms
                }))
                .into_response();
            }
            let parsed_json = serde_json::from_str::<Value>(&text).ok();
            let sample = if let Some(payload) = parsed_json.as_ref() {
                extract_provider_test_sample(provider.provider_type.as_deref(), payload)
            } else if !matches!(provider.provider_type.as_deref(), Some("anthropic")) {
                let fallback = text.trim();
                if fallback.is_empty() {
                    None
                } else {
                    Some(fallback.to_string())
                }
            } else {
                return Json(json!({
                    "ok": false,
                    "status": status.as_u16(),
                    "statusText": "Invalid JSON response",
                    "durationMs": duration_ms
                }))
                .into_response();
            };
            Json(json!({
                "ok": sample.is_some(),
                "status": status.as_u16(),
                "statusText": if sample.is_some() {
                    if parsed_json.is_none() { "OK (text response)" } else { "OK" }
                } else {
                    "Empty response"
                },
                "durationMs": duration_ms,
                "sample": sample
                    .map(|value| Value::String(value.chars().take(200).collect()))
                    .unwrap_or(Value::Null)
            }))
            .into_response()
        }
        Err(error) => (
            StatusCode::BAD_GATEWAY,
            Json(json!({
                "ok": false,
                "status": 0,
                "statusText": error.to_string(),
                "durationMs": chrono::Utc::now().timestamp_millis() - started_at
            })),
        )
            .into_response(),
    }
}

async fn api_config_update(State(state): State<AppState>, Json(body): Json<Value>) -> Response {
    let current = config_snapshot(&state);
    let mut next: GatewayConfig = match serde_json::from_value(body.clone()) {
        Ok(value) => value,
        Err(error) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": format!("Invalid config payload: {error}") })),
            )
                .into_response();
        }
    };

    if !body
        .as_object()
        .is_some_and(|object| object.contains_key("webAuth"))
    {
        next.web_auth = current.web_auth.clone();
    } else if next.web_auth.is_some() && current.web_auth.is_some() {
        let mut merged = current.web_auth.clone().unwrap_or_default();
        let incoming = next.web_auth.clone().unwrap_or_default();
        merged.enabled = incoming.enabled;
        merged.username = incoming.username.or(merged.username);
        if incoming.password_hash.is_some() {
            merged.password_hash = incoming.password_hash;
        }
        if incoming.password_salt.is_some() {
            merged.password_salt = incoming.password_salt;
        }
        next.web_auth = Some(merged);
    }

    match replace_config(&state, next) {
        Ok(()) => Json(json!({ "success": true })).into_response(),
        Err(error) => (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": error.to_string() })),
        )
            .into_response(),
    }
}

async fn api_auth_web(State(state): State<AppState>) -> Json<serde_json::Value> {
    let config = config_snapshot(&state);
    let auth = config.web_auth.unwrap_or_default();
    Json(json!({
        "enabled": auth.enabled,
        "username": auth.username.unwrap_or_default(),
        "hasPassword": auth.password_hash.is_some() && auth.password_salt.is_some()
    }))
}

async fn api_auth_web_update(
    State(state): State<AppState>,
    Json(body): Json<UpdateWebAuthBody>,
) -> Response {
    let mut config = config_snapshot(&state);
    let current = config.web_auth.clone().unwrap_or_default();
    let normalized_username = auth::sanitize_username(body.username.as_deref());
    let raw_password = body.password.as_deref().filter(|value| !value.is_empty());

    if body.enabled && normalized_username.is_none() {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Username is required when enabling authentication" })),
        )
            .into_response();
    }
    if raw_password.is_some_and(|value| value.len() < 6) {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Password must be at least 6 characters" })),
        )
            .into_response();
    }

    let mut next_auth = current.clone();
    next_auth.enabled = body.enabled;
    if normalized_username.is_some() {
        next_auth.username = normalized_username.clone();
    }

    let username_changed = normalized_username.as_deref() != current.username.as_deref();
    if let Some(password) = raw_password {
        let (password_hash, password_salt) = auth::create_password_record(password);
        next_auth.password_hash = Some(password_hash);
        next_auth.password_salt = Some(password_salt);
    } else if body.enabled
        && (current.password_hash.is_none() || current.password_salt.is_none() || username_changed)
    {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Password must be provided when enabling authentication" })),
        )
            .into_response();
    }

    config.web_auth = Some(next_auth.clone());
    match replace_config(&state, config) {
        Ok(()) => {
            if !body.enabled || raw_password.is_some() || username_changed {
                state.sessions.revoke_all();
            }
            Json(json!({
                "success": true,
                "auth": {
                    "enabled": next_auth.enabled,
                    "username": next_auth.username.unwrap_or_default(),
                    "hasPassword": next_auth.password_hash.is_some() && next_auth.password_salt.is_some()
                }
            }))
                .into_response()
        }
        Err(error) => (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": error.to_string() })),
        )
            .into_response(),
    }
}

async fn api_custom_endpoints(State(state): State<AppState>) -> Json<serde_json::Value> {
    let config = config_snapshot(&state);
    Json(json!({ "endpoints": config.custom_endpoints }))
}

async fn api_custom_endpoints_create(
    State(state): State<AppState>,
    Json(body): Json<CustomEndpointBody>,
) -> Response {
    let Some(id) = body
        .id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Invalid endpoint id" })),
        )
            .into_response();
    };
    let Some(label) = body
        .label
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Invalid endpoint label" })),
        )
            .into_response();
    };

    let mut paths = if let Some(paths) = body.paths {
        paths
    } else if let (Some(path), Some(protocol)) = (body.path.as_deref(), body.protocol.as_deref()) {
        vec![EndpointPathConfig {
            path: path.to_string(),
            protocol: protocol.to_string(),
        }]
    } else {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Must provide either \"paths\" array or \"path\" and \"protocol\"" })),
        )
            .into_response();
    };

    if paths.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "paths must be a non-empty array" })),
        )
            .into_response();
    }
    for path in &mut paths {
        if path.path.trim().is_empty() {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": "Invalid path in paths array" })),
            )
                .into_response();
        }
        if !validate_endpoint_protocol(&path.protocol) {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": format!("Invalid protocol \"{}\"", path.protocol) })),
            )
                .into_response();
        }
        path.path = normalize_path(&path.path);
    }

    let mut config = config_snapshot(&state);
    if config
        .custom_endpoints
        .iter()
        .any(|endpoint| endpoint.id == id)
    {
        return (
            StatusCode::CONFLICT,
            Json(json!({ "error": "Endpoint with this id already exists" })),
        )
            .into_response();
    }
    let existing_paths = config
        .custom_endpoints
        .iter()
        .flat_map(custom_endpoint_effective_paths)
        .map(|item| item.path)
        .collect::<Vec<_>>();
    for path in &paths {
        if existing_paths.iter().any(|existing| existing == &path.path) {
            return (
                StatusCode::CONFLICT,
                Json(json!({ "error": format!("Path \"{}\" already exists", path.path) })),
            )
                .into_response();
        }
    }

    let endpoint = CustomEndpointConfig {
        id: id.to_string(),
        label: label.to_string(),
        deletable: Some(body.deletable.unwrap_or(true)),
        enabled: Some(body.enabled.unwrap_or(true)),
        routing: body.routing,
        paths,
        ..CustomEndpointConfig::default()
    };
    config.custom_endpoints.push(endpoint.clone());
    match replace_config(&state, config) {
        Ok(()) => Json(json!({ "success": true, "endpoint": endpoint })).into_response(),
        Err(error) => (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": error.to_string() })),
        )
            .into_response(),
    }
}

async fn api_custom_endpoints_update(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
    Json(body): Json<CustomEndpointBody>,
) -> Response {
    let mut config = config_snapshot(&state);
    let Some(index) = config
        .custom_endpoints
        .iter()
        .position(|endpoint| endpoint.id == id)
    else {
        return (
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "Endpoint not found" })),
        )
            .into_response();
    };
    let existing = config.custom_endpoints[index].clone();
    let mut updated = existing.clone();

    if let Some(label) = body.label.as_deref() {
        let label = label.trim();
        if label.is_empty() {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": "Invalid endpoint label" })),
            )
                .into_response();
        }
        updated.label = label.to_string();
    }
    if let Some(deletable) = body.deletable {
        updated.deletable = Some(deletable);
    }
    if let Some(enabled) = body.enabled {
        updated.enabled = Some(enabled);
    }
    if let Some(routing) = body.routing {
        updated.routing = Some(routing);
    }

    if body.paths.is_some() || body.path.is_some() || body.protocol.is_some() {
        let mut paths = if let Some(paths) = body.paths {
            paths
        } else if let (Some(path), Some(protocol)) =
            (body.path.as_deref(), body.protocol.as_deref())
        {
            vec![EndpointPathConfig {
                path: path.to_string(),
                protocol: protocol.to_string(),
            }]
        } else {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": "Invalid path/protocol update" })),
            )
                .into_response();
        };
        if paths.is_empty() {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": "paths must be a non-empty array" })),
            )
                .into_response();
        }
        for path in &mut paths {
            if path.path.trim().is_empty() || !validate_endpoint_protocol(&path.protocol) {
                return (
                    StatusCode::BAD_REQUEST,
                    Json(json!({ "error": "Invalid path or protocol" })),
                )
                    .into_response();
            }
            path.path = normalize_path(&path.path);
        }
        let other_paths = config
            .custom_endpoints
            .iter()
            .enumerate()
            .filter(|(current_index, _)| *current_index != index)
            .flat_map(|(_, endpoint)| custom_endpoint_effective_paths(endpoint))
            .map(|item| item.path)
            .collect::<Vec<_>>();
        for path in &paths {
            if other_paths.iter().any(|existing| existing == &path.path) {
                return (
                    StatusCode::CONFLICT,
                    Json(json!({ "error": format!("Path \"{}\" already in use by another endpoint", path.path) })),
                )
                    .into_response();
            }
        }
        updated.paths = paths;
        updated.path = None;
        updated.protocol = None;
    }

    config.custom_endpoints[index] = updated.clone();
    match replace_config(&state, config) {
        Ok(()) => Json(json!({ "success": true, "endpoint": updated })).into_response(),
        Err(error) => (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": error.to_string() })),
        )
            .into_response(),
    }
}

async fn api_custom_endpoints_delete(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
) -> Response {
    let mut config = config_snapshot(&state);
    let Some(existing) = config
        .custom_endpoints
        .iter()
        .find(|endpoint| endpoint.id == id)
        .cloned()
    else {
        return (
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "Endpoint not found" })),
        )
            .into_response();
    };
    if existing.deletable == Some(false) {
        return (
            StatusCode::FORBIDDEN,
            Json(json!({ "error": "This endpoint cannot be deleted" })),
        )
            .into_response();
    }
    config.custom_endpoints.retain(|endpoint| endpoint.id != id);
    match replace_config(&state, config) {
        Ok(()) => Json(json!({ "success": true })).into_response(),
        Err(error) => (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": error.to_string() })),
        )
            .into_response(),
    }
}

async fn api_routing_presets_create(
    State(state): State<AppState>,
    AxumPath(endpoint): AxumPath<String>,
    Json(body): Json<PresetNameBody>,
) -> Response {
    let Some(name) = body
        .name
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Preset name is required" })),
        )
            .into_response();
    };
    let mut config = config_snapshot(&state);
    let Some(endpoint) = parse_preset_endpoint(&config, &endpoint) else {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Unsupported endpoint" })),
        )
            .into_response();
    };

    if endpoint == "anthropic" || endpoint == "openai" {
        let current_presets = config.routing_presets.entry(endpoint.clone()).or_default();
        if current_presets
            .iter()
            .any(|preset| preset.name.eq_ignore_ascii_case(name))
        {
            return (
                StatusCode::CONFLICT,
                Json(json!({ "error": "Preset name already exists" })),
            )
                .into_response();
        }
        let base_routes = config
            .endpoint_routing
            .get(&endpoint)
            .map(|routing| routing.model_routes.clone())
            .unwrap_or_else(|| {
                if endpoint == "anthropic" {
                    config.model_routes.clone()
                } else {
                    HashMap::new()
                }
            });
        current_presets.push(RoutingPreset {
            name: name.to_string(),
            model_routes: base_routes,
            created_at: chrono::Utc::now().timestamp_millis(),
        });
        current_presets
            .sort_by(|left, right| left.name.to_lowercase().cmp(&right.name.to_lowercase()));
        let presets = current_presets.clone();
        match replace_config(&state, config) {
            Ok(()) => Json(json!({ "success": true, "presets": presets })).into_response(),
            Err(error) => (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": error.to_string() })),
            )
                .into_response(),
        }
    } else {
        let Some(custom_endpoint) = config
            .custom_endpoints
            .iter_mut()
            .find(|item| item.id == endpoint)
        else {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": "Unsupported endpoint" })),
            )
                .into_response();
        };
        if custom_endpoint
            .routing_presets
            .iter()
            .any(|preset| preset.name.eq_ignore_ascii_case(name))
        {
            return (
                StatusCode::CONFLICT,
                Json(json!({ "error": "Preset name already exists" })),
            )
                .into_response();
        }
        let routes = custom_endpoint
            .routing
            .as_ref()
            .map(|routing| routing.model_routes.clone())
            .unwrap_or_default();
        custom_endpoint.routing_presets.push(RoutingPreset {
            name: name.to_string(),
            model_routes: routes,
            created_at: chrono::Utc::now().timestamp_millis(),
        });
        custom_endpoint
            .routing_presets
            .sort_by(|left, right| left.name.to_lowercase().cmp(&right.name.to_lowercase()));
        let presets = custom_endpoint.routing_presets.clone();
        match replace_config(&state, config) {
            Ok(()) => Json(json!({ "success": true, "presets": presets })).into_response(),
            Err(error) => (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": error.to_string() })),
            )
                .into_response(),
        }
    }
}

async fn api_routing_presets_apply(
    State(state): State<AppState>,
    AxumPath(endpoint): AxumPath<String>,
    Json(body): Json<PresetNameBody>,
) -> Response {
    let Some(name) = body
        .name
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Preset name is required" })),
        )
            .into_response();
    };
    let mut config = config_snapshot(&state);
    let Some(endpoint) = parse_preset_endpoint(&config, &endpoint) else {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Unsupported endpoint" })),
        )
            .into_response();
    };

    if endpoint == "anthropic" || endpoint == "openai" {
        let preset = config
            .routing_presets
            .get(&endpoint)
            .and_then(|presets| presets.iter().find(|preset| preset.name == name))
            .cloned();
        let Some(preset) = preset else {
            return (
                StatusCode::NOT_FOUND,
                Json(json!({ "error": "Preset not found" })),
            )
                .into_response();
        };
        let routing = config
            .endpoint_routing
            .entry(endpoint.clone())
            .or_insert_with(|| EndpointRoutingConfig {
                defaults: config.defaults.clone(),
                model_routes: HashMap::new(),
                validation: None,
            });
        routing.model_routes = preset.model_routes.clone();
        if endpoint == "anthropic" {
            config.model_routes = preset.model_routes;
        }
        match replace_config(&state, config.clone()) {
            Ok(()) => Json(json!({ "success": true, "config": config.sanitize_for_web() }))
                .into_response(),
            Err(error) => (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": error.to_string() })),
            )
                .into_response(),
        }
    } else {
        let preset = config
            .custom_endpoints
            .iter()
            .find(|item| item.id == endpoint)
            .and_then(|item| {
                item.routing_presets
                    .iter()
                    .find(|preset| preset.name.eq_ignore_ascii_case(name))
                    .cloned()
            });
        let Some(preset) = preset else {
            return (
                StatusCode::NOT_FOUND,
                Json(json!({ "error": "Preset not found" })),
            )
                .into_response();
        };
        let defaults = config.defaults.clone();
        let Some(custom_endpoint) = config
            .custom_endpoints
            .iter_mut()
            .find(|item| item.id == endpoint)
        else {
            return (
                StatusCode::NOT_FOUND,
                Json(json!({ "error": "Endpoint not found" })),
            )
                .into_response();
        };
        let mut routing = custom_endpoint
            .routing
            .clone()
            .unwrap_or(EndpointRoutingConfig {
                defaults,
                model_routes: HashMap::new(),
                validation: None,
            });
        routing.model_routes = preset.model_routes;
        custom_endpoint.routing = Some(routing.clone());
        let updated = config.sanitize_for_web();
        match replace_config(&state, config) {
            Ok(()) => Json(json!({ "success": true, "config": updated })).into_response(),
            Err(error) => (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": error.to_string() })),
            )
                .into_response(),
        }
    }
}

async fn api_routing_presets_delete(
    State(state): State<AppState>,
    AxumPath((endpoint, name)): AxumPath<(String, String)>,
) -> Response {
    let mut config = config_snapshot(&state);
    let Some(endpoint) = parse_preset_endpoint(&config, &endpoint) else {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Unsupported endpoint" })),
        )
            .into_response();
    };
    if endpoint == "anthropic" || endpoint == "openai" {
        let Some(presets) = config.routing_presets.get_mut(&endpoint) else {
            return (
                StatusCode::NOT_FOUND,
                Json(json!({ "error": "Preset not found" })),
            )
                .into_response();
        };
        let before = presets.len();
        presets.retain(|preset| preset.name != name);
        if presets.len() == before {
            return (
                StatusCode::NOT_FOUND,
                Json(json!({ "error": "Preset not found" })),
            )
                .into_response();
        }
        let next = presets.clone();
        match replace_config(&state, config) {
            Ok(()) => Json(json!({ "success": true, "presets": next })).into_response(),
            Err(error) => (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": error.to_string() })),
            )
                .into_response(),
        }
    } else {
        let Some(custom_endpoint) = config
            .custom_endpoints
            .iter_mut()
            .find(|item| item.id == endpoint)
        else {
            return (
                StatusCode::NOT_FOUND,
                Json(json!({ "error": "Endpoint not found" })),
            )
                .into_response();
        };
        let before = custom_endpoint.routing_presets.len();
        custom_endpoint
            .routing_presets
            .retain(|preset| preset.name != name);
        if custom_endpoint.routing_presets.len() == before {
            return (
                StatusCode::NOT_FOUND,
                Json(json!({ "error": "Preset not found" })),
            )
                .into_response();
        }
        let next = custom_endpoint.routing_presets.clone();
        match replace_config(&state, config) {
            Ok(()) => Json(json!({ "success": true, "presets": next })).into_response(),
            Err(error) => (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": error.to_string() })),
            )
                .into_response(),
        }
    }
}

async fn api_events(
    State(state): State<AppState>,
    Query(query): Query<HashMap<String, String>>,
) -> Response {
    let limit = query
        .get("limit")
        .and_then(|value| value.parse::<i64>().ok())
        .unwrap_or(50);
    let cursor = query
        .get("cursor")
        .and_then(|value| value.parse::<i64>().ok())
        .filter(|value| *value > 0);
    let level = query
        .get("level")
        .map(String::as_str)
        .filter(|value| !value.is_empty());
    let event_type = query
        .get("type")
        .map(String::as_str)
        .filter(|value| !value.is_empty());

    match list_events(&state.paths.db_path, limit, cursor, level, event_type) {
        Ok(result) => Json(json!(result)).into_response(),
        Err(error) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": error.to_string() })),
        )
            .into_response(),
    }
}

async fn api_keys_list(State(state): State<AppState>) -> Response {
    match list_api_keys(&state.paths.db_path) {
        Ok(result) => Json(json!(result)).into_response(),
        Err(error) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": error.to_string() })),
        )
            .into_response(),
    }
}

async fn api_keys_create(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<CreateApiKeyBody>,
) -> Response {
    let Some(name) = body.name.as_deref() else {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Name is required" })),
        )
            .into_response();
    };

    let allowed_endpoints = match normalize_allowed_endpoints(body.allowed_endpoints) {
        Ok(value) => value,
        Err(error) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": error.to_string() })),
            )
                .into_response();
        }
    };

    match create_api_key(
        &state.paths.db_path,
        &state.paths.home_dir,
        name,
        body.description.as_deref(),
        allowed_endpoints,
        header_value(&headers, "x-forwarded-for").as_deref(),
    ) {
        Ok(result) => Json(json!(result)).into_response(),
        Err(error) => (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": error.to_string() })),
        )
            .into_response(),
    }
}

async fn api_keys_patch(
    State(state): State<AppState>,
    headers: HeaderMap,
    AxumPath(id): AxumPath<i64>,
    Json(body): Json<Value>,
) -> Response {
    let object = match body.as_object() {
        Some(value) => value,
        None => {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": "Invalid request body" })),
            )
                .into_response();
        }
    };

    let enabled = if object.contains_key("enabled") {
        match object.get("enabled").and_then(Value::as_bool) {
            Some(value) => Some(value),
            None => {
                return (
                    StatusCode::BAD_REQUEST,
                    Json(json!({ "error": "enabled must be a boolean" })),
                )
                    .into_response();
            }
        }
    } else {
        None
    };

    let allowed_endpoints = if object.contains_key("allowedEndpoints") {
        match object.get("allowedEndpoints") {
            Some(Value::Null) => Some(None),
            Some(Value::Array(items)) => {
                let mut values = Vec::new();
                for item in items {
                    let Some(value) = item.as_str() else {
                        return (
                            StatusCode::BAD_REQUEST,
                            Json(json!({ "error": "allowedEndpoints must be an array of strings or null" })),
                        )
                            .into_response();
                    };
                    values.push(value.to_string());
                }
                Some(Some(values))
            }
            _ => {
                return (
                    StatusCode::BAD_REQUEST,
                    Json(
                        json!({ "error": "allowedEndpoints must be an array of strings or null" }),
                    ),
                )
                    .into_response();
            }
        }
    } else {
        None
    };

    match update_api_key_settings(
        &state.paths.db_path,
        id,
        enabled,
        allowed_endpoints,
        header_value(&headers, "x-forwarded-for").as_deref(),
    ) {
        Ok(()) => Json(json!({ "success": true })).into_response(),
        Err(error) => {
            let status = match error.to_string().as_str() {
                "API key not found" => StatusCode::NOT_FOUND,
                "Cannot set endpoint restrictions on wildcard key" => StatusCode::FORBIDDEN,
                _ => StatusCode::BAD_REQUEST,
            };
            (status, Json(json!({ "error": error.to_string() }))).into_response()
        }
    }
}

async fn api_keys_delete(
    State(state): State<AppState>,
    headers: HeaderMap,
    AxumPath(id): AxumPath<i64>,
) -> Response {
    match delete_api_key(
        &state.paths.db_path,
        id,
        header_value(&headers, "x-forwarded-for").as_deref(),
    ) {
        Ok(()) => Json(json!({ "success": true })).into_response(),
        Err(error) => {
            let status = match error.to_string().as_str() {
                "API key not found" => StatusCode::NOT_FOUND,
                "Cannot delete wildcard key" => StatusCode::FORBIDDEN,
                _ => StatusCode::BAD_REQUEST,
            };
            (status, Json(json!({ "error": error.to_string() }))).into_response()
        }
    }
}

async fn api_keys_reveal(State(state): State<AppState>, AxumPath(id): AxumPath<i64>) -> Response {
    match reveal_api_key(&state.paths.db_path, &state.paths.home_dir, id) {
        Ok(Some(key)) => Json(json!({ "key": key })).into_response(),
        Ok(None) => (
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "API key not found or cannot be revealed" })),
        )
            .into_response(),
        Err(error) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": error.to_string() })),
        )
            .into_response(),
    }
}

async fn api_logs(
    State(state): State<AppState>,
    Query(query): Query<HashMap<String, String>>,
) -> Response {
    let log_query = LogQuery {
        limit: query
            .get("limit")
            .and_then(|v| v.parse().ok())
            .unwrap_or(50),
        offset: query
            .get("offset")
            .and_then(|v| v.parse().ok())
            .unwrap_or(0),
        provider: query.get("provider").cloned().filter(|v| !v.is_empty()),
        model: query.get("model").cloned().filter(|v| !v.is_empty()),
        endpoint: query.get("endpoint").cloned().filter(|v| !v.is_empty()),
        status: query.get("status").cloned().filter(|v| !v.is_empty()),
        from: query.get("from").and_then(|v| v.parse().ok()),
        to: query.get("to").and_then(|v| v.parse().ok()),
        api_key_ids: parse_api_key_ids(
            query
                .get("apiKeys")
                .or_else(|| query.get("apiKeyIds"))
                .or_else(|| query.get("apiKey"))
                .map(String::as_str),
        ),
    };

    match query_logs(&state.paths.db_path, &log_query) {
        Ok(result) => Json(json!(result)).into_response(),
        Err(error) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": error.to_string() })),
        )
            .into_response(),
    }
}

async fn api_logs_export(State(state): State<AppState>, Json(body): Json<Value>) -> Response {
    let Some(raw) = body.as_object() else {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Invalid request body" })),
        )
            .into_response();
    };
    let limit = raw
        .get("limit")
        .and_then(Value::as_i64)
        .unwrap_or(1000)
        .clamp(1, 5000);
    let log_query = LogQuery {
        limit,
        offset: 0,
        provider: raw
            .get("provider")
            .and_then(Value::as_str)
            .map(ToString::to_string)
            .filter(|v| !v.is_empty()),
        model: raw
            .get("model")
            .and_then(Value::as_str)
            .map(ToString::to_string)
            .filter(|v| !v.is_empty()),
        endpoint: raw
            .get("endpoint")
            .and_then(Value::as_str)
            .map(ToString::to_string)
            .filter(|v| !v.is_empty()),
        status: raw
            .get("status")
            .and_then(Value::as_str)
            .map(ToString::to_string)
            .filter(|v| !v.is_empty()),
        from: raw.get("from").and_then(Value::as_i64),
        to: raw.get("to").and_then(Value::as_i64),
        api_key_ids: raw
            .get("apiKeys")
            .and_then(value_to_api_key_ids)
            .or_else(|| raw.get("apiKeyIds").and_then(value_to_api_key_ids))
            .or_else(|| raw.get("apiKey").and_then(value_to_api_key_ids)),
    };

    let result = match export_logs(&state.paths.db_path, &log_query) {
        Ok(result) => result,
        Err(error) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": format!("导出日志失败：{error}") })),
            )
                .into_response();
        }
    };

    let records = result
        .into_iter()
        .map(|item| {
            let mut value = serde_json::to_value(item).unwrap_or_else(|_| json!({}));
            if let Some(object) = value.as_object_mut() {
                let decrypted = object
                    .get("api_key_value")
                    .and_then(Value::as_str)
                    .and_then(|value| {
                        decrypt_log_api_key_value(&state.paths.home_dir, Some(value))
                    });
                object.insert(
                    "api_key_value_available".to_string(),
                    Value::Bool(decrypted.is_some()),
                );
                object.insert(
                    "api_key_value_masked".to_string(),
                    decrypted
                        .map(|value| Value::String(mask_revealed_key(&value)))
                        .unwrap_or(Value::Null),
                );
                object.insert("api_key_value".to_string(), Value::Null);
            }
            value
        })
        .collect::<Vec<_>>();
    let payload = json!({
        "exportedAt": chrono::Utc::now().to_rfc3339(),
        "count": records.len(),
        "limit": limit,
        "records": records
    });

    let cursor = Cursor::new(Vec::<u8>::new());
    let mut zip = zip::ZipWriter::new(cursor);
    if let Err(error) = zip.start_file("logs.json", SimpleFileOptions::default()) {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": format!("导出日志失败：{error}") })),
        )
            .into_response();
    }
    if let Err(error) = zip.write_all(payload.to_string().as_bytes()) {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": format!("导出日志失败：{error}") })),
        )
            .into_response();
    }
    let buffer = match zip.finish() {
        Ok(cursor) => cursor.into_inner(),
        Err(error) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": format!("导出日志失败：{error}") })),
            )
                .into_response();
        }
    };

    let filename = format!(
        "cc-gw-logs-{}.zip",
        chrono::Utc::now().to_rfc3339().replace([':', '.'], "-")
    );
    match Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "application/zip")
        .header(
            header::CONTENT_DISPOSITION,
            format!("attachment; filename=\"{filename}\""),
        )
        .body(Body::from(buffer))
    {
        Ok(response) => response,
        Err(error) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": format!("导出日志失败：{error}") })),
        )
            .into_response(),
    }
}

async fn api_logs_cleanup(State(state): State<AppState>) -> Response {
    let config = config_snapshot(&state);
    let retention_days = config.log_retention_days.unwrap_or(30).max(1) as i64;
    let cutoff = chrono::Utc::now().timestamp_millis() - retention_days * 24 * 60 * 60 * 1000;
    match cleanup_logs_before(&state.paths.db_path, cutoff) {
        Ok(deleted) => Json(json!({ "success": true, "deleted": deleted })).into_response(),
        Err(error) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": error.to_string() })),
        )
            .into_response(),
    }
}

async fn api_logs_clear(State(state): State<AppState>) -> Response {
    match clear_all_logs(&state.paths.db_path) {
        Ok((deleted, metrics_cleared)) => Json(json!({
            "success": true,
            "deleted": deleted,
            "metricsCleared": metrics_cleared
        }))
        .into_response(),
        Err(error) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": error.to_string() })),
        )
            .into_response(),
    }
}

async fn api_log_detail(State(state): State<AppState>, AxumPath(id): AxumPath<i64>) -> Response {
    match get_log_detail(&state.paths.db_path, id) {
        Ok(Some(result)) => {
            let mut value = serde_json::to_value(result).unwrap_or_else(|_| json!({}));
            if let Some(object) = value.as_object_mut() {
                let decrypted = object
                    .get("api_key_value")
                    .and_then(Value::as_str)
                    .and_then(|value| {
                        decrypt_log_api_key_value(&state.paths.home_dir, Some(value))
                    });
                object.insert(
                    "api_key_value_available".to_string(),
                    Value::Bool(decrypted.is_some()),
                );
                object.insert(
                    "api_key_value_masked".to_string(),
                    decrypted
                        .map(|value| Value::String(mask_revealed_key(&value)))
                        .unwrap_or(Value::Null),
                );
                object.insert("api_key_value".to_string(), Value::Null);
            }
            Json(value).into_response()
        }
        Ok(None) => (StatusCode::NOT_FOUND, Json(json!({ "error": "Not found" }))).into_response(),
        Err(error) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": error.to_string() })),
        )
            .into_response(),
    }
}

async fn api_stats_api_keys_overview(
    State(state): State<AppState>,
    Query(query): Query<HashMap<String, String>>,
) -> Response {
    let endpoint = query
        .get("endpoint")
        .map(String::as_str)
        .filter(|value| !value.is_empty());
    let days = query
        .get("days")
        .and_then(|value| value.parse::<i64>().ok())
        .unwrap_or(7)
        .clamp(1, 90);
    match get_api_key_overview_metrics(&state.paths.db_path, days, endpoint) {
        Ok(result) => Json(json!(result)).into_response(),
        Err(error) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": error.to_string() })),
        )
            .into_response(),
    }
}

async fn api_stats_api_keys_usage(
    State(state): State<AppState>,
    Query(query): Query<HashMap<String, String>>,
) -> Response {
    let endpoint = query
        .get("endpoint")
        .map(String::as_str)
        .filter(|value| !value.is_empty());
    let days = query
        .get("days")
        .and_then(|value| value.parse::<i64>().ok())
        .unwrap_or(7)
        .clamp(1, 90);
    let limit = query
        .get("limit")
        .and_then(|value| value.parse::<i64>().ok())
        .unwrap_or(10)
        .clamp(1, 50);
    match get_api_key_usage_metrics(&state.paths.db_path, days, limit, endpoint) {
        Ok(result) => Json(json!(result)).into_response(),
        Err(error) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": error.to_string() })),
        )
            .into_response(),
    }
}

async fn dynamic_fallback(
    State(state): State<AppState>,
    method: Method,
    uri: Uri,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let config = config_snapshot(&state);
    let Some(route_match) = match_custom_route(&config, uri.path()) else {
        return (StatusCode::NOT_FOUND, "not found").into_response();
    };

    match (method, route_match) {
        (Method::GET, CustomRouteMatch::OpenAiModels(endpoint_id)) => {
            if let Err(response) = authorize_request(&state, &headers, &endpoint_id) {
                return response;
            }
            Json(json!({
                "object": "list",
                "data": build_models_response(&config, "openai")
            }))
            .into_response()
        }
        (Method::POST, CustomRouteMatch::AnthropicCountTokens(endpoint_id)) => {
            if let Err(response) = authorize_request(&state, &headers, &endpoint_id) {
                return response;
            }
            let payload: Value = match serde_json::from_slice(&body) {
                Ok(value) => value,
                Err(error) => {
                    return (
                        StatusCode::BAD_REQUEST,
                        Json(json!({ "error": format!("invalid JSON body: {error}") })),
                    )
                        .into_response();
                }
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
            Json(json!({ "input_tokens": walk(&payload) })).into_response()
        }
        (Method::POST, CustomRouteMatch::AnthropicMessages(endpoint_id))
        | (Method::POST, CustomRouteMatch::OpenAiChat(endpoint_id))
        | (Method::POST, CustomRouteMatch::OpenAiResponses(endpoint_id)) => {
            let payload: Value = match serde_json::from_slice(&body) {
                Ok(value) => value,
                Err(error) => {
                    return (
                        StatusCode::BAD_REQUEST,
                        Json(json!({ "error": format!("invalid JSON body: {error}") })),
                    )
                        .into_response();
                }
            };
            let gateway_endpoint = GatewayEndpoint::Custom(endpoint_id.as_str());
            let protocol = if uri.path().ends_with("/v1/messages")
                || uri.path().ends_with("/v1/v1/messages")
            {
                ProviderProtocol::AnthropicMessages
            } else if uri.path().ends_with("/v1/chat/completions") {
                ProviderProtocol::OpenAiChatCompletions
            } else {
                ProviderProtocol::OpenAiResponses
            };
            proxy_standard_request(state, headers, payload, gateway_endpoint, protocol).await
        }
        _ => (StatusCode::METHOD_NOT_ALLOWED, "method not allowed").into_response(),
    }
}

async fn api_db_info(State(state): State<AppState>) -> Response {
    match get_database_info(&state.paths.db_path) {
        Ok(result) => Json(json!(result)).into_response(),
        Err(error) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": error.to_string() })),
        )
            .into_response(),
    }
}

async fn api_db_compact(State(state): State<AppState>) -> Response {
    match compact_database(&state.paths.db_path)
        .and_then(|_| get_database_info(&state.paths.db_path))
    {
        Ok(result) => {
            let mut value = serde_json::to_value(result).unwrap_or_else(|_| json!({}));
            if let Some(object) = value.as_object_mut() {
                object.insert("success".to_string(), Value::Bool(true));
            }
            Json(value).into_response()
        }
        Err(error) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": error.to_string() })),
        )
            .into_response(),
    }
}

async fn api_stats_overview(
    State(state): State<AppState>,
    Query(query): Query<HashMap<String, String>>,
) -> Response {
    let endpoint = query
        .get("endpoint")
        .map(|value| value.as_str())
        .filter(|v| !v.is_empty());
    match get_metrics_overview(&state.paths.db_path, endpoint) {
        Ok(result) => Json(json!(result)).into_response(),
        Err(error) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": error.to_string() })),
        )
            .into_response(),
    }
}

async fn api_stats_daily(
    State(state): State<AppState>,
    Query(query): Query<HashMap<String, String>>,
) -> Response {
    let endpoint = query
        .get("endpoint")
        .map(|value| value.as_str())
        .filter(|v| !v.is_empty());
    let days = query
        .get("days")
        .and_then(|value| value.parse::<i64>().ok())
        .unwrap_or(7)
        .clamp(1, 30);
    match get_daily_metrics(&state.paths.db_path, days, endpoint) {
        Ok(result) => Json(json!(result)).into_response(),
        Err(error) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": error.to_string() })),
        )
            .into_response(),
    }
}

async fn api_stats_model(
    State(state): State<AppState>,
    Query(query): Query<HashMap<String, String>>,
) -> Response {
    let endpoint = query
        .get("endpoint")
        .map(|value| value.as_str())
        .filter(|v| !v.is_empty());
    let days = query
        .get("days")
        .and_then(|value| value.parse::<i64>().ok())
        .unwrap_or(7)
        .clamp(1, 90);
    let limit = query
        .get("limit")
        .and_then(|value| value.parse::<i64>().ok())
        .unwrap_or(10)
        .clamp(1, 50);
    match get_model_usage_metrics(&state.paths.db_path, days, limit, endpoint) {
        Ok(result) => Json(json!(result)).into_response(),
        Err(error) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": error.to_string() })),
        )
            .into_response(),
    }
}

async fn openai_models(State(state): State<AppState>, headers: HeaderMap) -> Response {
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

async fn anthropic_count_tokens(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> Response {
    if let Err(response) = authorize_request(&state, &headers, "anthropic") {
        return response;
    }

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

    Json(json!({
        "input_tokens": walk(&body)
    }))
    .into_response()
}

async fn anthropic_messages(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> Response {
    proxy_standard_request(
        state,
        headers,
        body,
        GatewayEndpoint::Anthropic,
        ProviderProtocol::AnthropicMessages,
    )
    .await
}

async fn openai_chat_completions(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> Response {
    proxy_standard_request(
        state,
        headers,
        body,
        GatewayEndpoint::OpenAi,
        ProviderProtocol::OpenAiChatCompletions,
    )
    .await
}

async fn openai_responses(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> Response {
    proxy_standard_request(
        state,
        headers,
        body,
        GatewayEndpoint::OpenAi,
        ProviderProtocol::OpenAiResponses,
    )
    .await
}

async fn ui_index(State(state): State<AppState>) -> Response {
    serve_from_ui(&state, "index.html", true).await
}

async fn ui_path(State(state): State<AppState>, AxumPath(path): AxumPath<String>) -> Response {
    let path = if path.trim().is_empty() {
        "index.html"
    } else {
        path.as_str()
    };
    serve_from_ui(&state, path, true).await
}

async fn asset_path(State(state): State<AppState>, AxumPath(path): AxumPath<String>) -> Response {
    let asset_path = if path.trim().is_empty() {
        "assets".to_string()
    } else {
        format!("assets/{path}")
    };
    serve_from_ui(&state, &asset_path, false).await
}

async fn favicon(State(state): State<AppState>) -> Response {
    let response = serve_from_ui(&state, "favicon.ico", false).await;
    if response.status() == StatusCode::NOT_FOUND {
        return StatusCode::NO_CONTENT.into_response();
    }
    response
}

async fn serve_from_ui(state: &AppState, requested_path: &str, spa_fallback: bool) -> Response {
    let Some(root) = state.ui_root.as_ref() else {
        return (StatusCode::NOT_FOUND, "web ui dist not found").into_response();
    };

    let sanitized = match sanitize_relative_path(requested_path) {
        Some(path) => path,
        None => return (StatusCode::BAD_REQUEST, "invalid path").into_response(),
    };

    let target = root.join(&sanitized);
    if target.is_file() {
        return serve_file(&target).await;
    }

    if spa_fallback {
        let fallback = root.join("index.html");
        if fallback.is_file() {
            return serve_file(&fallback).await;
        }
    }

    (StatusCode::NOT_FOUND, "not found").into_response()
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

async fn proxy_standard_request(
    state: AppState,
    headers: HeaderMap,
    body: Value,
    endpoint: GatewayEndpoint<'_>,
    protocol: ProviderProtocol,
) -> Response {
    state.active_requests.fetch_add(1, Ordering::Relaxed);
    let started_at = chrono::Utc::now().timestamp_millis();
    let endpoint_id = endpoint_name(endpoint, protocol);
    let user_agent = header_value(&headers, header::USER_AGENT.as_str());
    let api_key_context = match authorize_request_with_context(&state, &headers, &endpoint_id) {
        Ok(context) => context,
        Err(response) => {
            state.active_requests.fetch_sub(1, Ordering::Relaxed);
            return response;
        }
    };
    let encrypted_api_key_value = if api_key_context.provided_key.is_empty() {
        None
    } else {
        encrypt_secret(&state.paths.home_dir, &api_key_context.provided_key).ok()
    };
    let config = config_snapshot(&state);

    let requested_model = extract_requested_model(&body);
    let target = match resolve_route(
        &config,
        endpoint,
        &body,
        requested_model,
        extract_thinking(&body),
    ) {
        Ok(target) => target,
        Err(error) => {
            state.active_requests.fetch_sub(1, Ordering::Relaxed);
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
            session_id: extract_session_id(&body),
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
    if let (Some(log_id), true) = (request_log_id, request_payload_storage_enabled(&config)) {
        let prompt = serde_json::to_string(&body).ok();
        let _ = upsert_request_payload(&state.paths.db_path, log_id, prompt.as_deref(), None);
    }
    let provider_is_anthropic =
        matches!(target.provider.provider_type.as_deref(), Some("anthropic"));
    let target_protocol = if provider_is_anthropic {
        ProviderProtocol::AnthropicMessages
    } else {
        match protocol {
            ProviderProtocol::AnthropicMessages => ProviderProtocol::OpenAiChatCompletions,
            ProviderProtocol::OpenAiChatCompletions => ProviderProtocol::OpenAiChatCompletions,
            ProviderProtocol::OpenAiResponses => ProviderProtocol::OpenAiResponses,
        }
    };

    let converted_request_body = match (protocol, target_protocol) {
        (ProviderProtocol::AnthropicMessages, ProviderProtocol::OpenAiChatCompletions) => {
            anthropic_request_to_openai_chat(&body)
        }
        (ProviderProtocol::OpenAiChatCompletions, ProviderProtocol::AnthropicMessages) => {
            openai_chat_request_to_anthropic(&body)
        }
        (ProviderProtocol::OpenAiResponses, ProviderProtocol::AnthropicMessages) => {
            openai_responses_request_to_anthropic(&body)
        }
        _ => body.clone(),
    };

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

    let proxy_result = forward_request(
        &state.http_client,
        &target.provider,
        target_protocol,
        ProxyRequest {
            model: target.model_id,
            body: converted_request_body,
            stream,
            incoming_headers: headers,
            passthrough_headers: HeaderMap::new(),
            query: None,
        },
    )
    .await;

    state.active_requests.fetch_sub(1, Ordering::Relaxed);

    match proxy_result {
        Ok(response) => {
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
                )
                .await
            } else if stream {
                into_streaming_proxy_response(response, target_protocol, streaming_log_context)
                    .await
            } else if cross_protocol {
                let status_code = response.status().as_u16() as i64;
                let latency_ms = chrono::Utc::now().timestamp_millis() - started_at;
                let (result, usage, response_payload) = into_converted_response(
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
                            None,
                            response_payload.as_deref(),
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
                            None,
                            response_payload.as_deref(),
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
) -> (Response, UsageStats, Option<String>) {
    let status = response.status();
    if !status.is_success() {
        return into_proxy_response(response, false).await;
    }

    let payload: Value = match response.json().await {
        Ok(payload) => payload,
        Err(error) => {
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
                None,
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
    (Json(converted).into_response(), usage, response_payload)
}

async fn into_streaming_converted_response(
    response: reqwest::Response,
    request_protocol: ProviderProtocol,
    target_protocol: ProviderProtocol,
    requested_model: &str,
    log_context: Option<StreamingLogContext>,
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
            status.as_u16() as i64,
            latency_ms,
            usage,
            None,
            response_payload,
        );
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
        let mut captured_response = String::new();
        loop {
            match upstream.try_next().await {
                Ok(Some(chunk)) => {
                    let text = String::from_utf8_lossy(&chunk).to_string();
                    let observation = observer.push(&text);
                    if first_token_at.is_none() && observation.saw_first_token {
                        first_token_at = Some(chrono::Utc::now().timestamp_millis());
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
            status_code,
            latency_ms,
            usage,
            ttft_ms,
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
            status.as_u16() as i64,
            latency_ms,
            usage,
            None,
            response_payload,
        );
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
            status_code,
            latency_ms,
            usage,
            ttft_ms,
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

fn header_value(headers: &HeaderMap, name: &str) -> Option<String> {
    headers
        .get(name)
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

fn extract_api_key_from_headers(headers: &HeaderMap) -> Option<String> {
    let authorization = header_value(headers, header::AUTHORIZATION.as_str()).map(|value| {
        if value.len() >= 7 && value[..7].eq_ignore_ascii_case("bearer ") {
            value[7..].to_string()
        } else {
            value
        }
    });
    authorization.or_else(|| header_value(headers, "x-api-key"))
}

fn auth_error_response(error: ApiKeyError) -> Response {
    let status = match error.code {
        AuthFailureCode::Forbidden => StatusCode::FORBIDDEN,
        AuthFailureCode::Missing | AuthFailureCode::Invalid | AuthFailureCode::Disabled => {
            StatusCode::UNAUTHORIZED
        }
    };
    let code = match error.code {
        AuthFailureCode::Forbidden => "endpoint_forbidden",
        AuthFailureCode::Missing | AuthFailureCode::Invalid | AuthFailureCode::Disabled => {
            "invalid_api_key"
        }
    };
    (
        status,
        Json(json!({
            "error": {
                "code": code,
                "message": error.message
            }
        })),
    )
        .into_response()
}

fn authorize_request(
    state: &AppState,
    headers: &HeaderMap,
    endpoint_id: &str,
) -> Result<(), Response> {
    authorize_request_with_context(state, headers, endpoint_id).map(|_| ())
}

fn authorize_request_with_context(
    state: &AppState,
    headers: &HeaderMap,
    endpoint_id: &str,
) -> Result<cc_gw_core::api_keys::ResolvedApiKey, Response> {
    resolve_api_key(
        &state.paths.db_path,
        extract_api_key_from_headers(headers).as_deref(),
        Some(endpoint_id),
        header_value(headers, "x-forwarded-for").as_deref(),
        header_value(headers, header::USER_AGENT.as_str()).as_deref(),
    )
    .map_err(auth_error_response)
}

fn parse_api_key_ids(value: Option<&str>) -> Option<Vec<i64>> {
    value.and_then(|value| {
        let ids = value
            .split(',')
            .filter_map(|item| item.trim().parse::<i64>().ok())
            .filter(|item| *item > 0)
            .collect::<Vec<_>>();
        if ids.is_empty() { None } else { Some(ids) }
    })
}

fn value_to_api_key_ids(value: &Value) -> Option<Vec<i64>> {
    match value {
        Value::Array(values) => {
            let ids = values
                .iter()
                .filter_map(|item| item.as_i64().or_else(|| item.as_str()?.parse::<i64>().ok()))
                .filter(|item| *item > 0)
                .collect::<Vec<_>>();
            if ids.is_empty() { None } else { Some(ids) }
        }
        Value::String(value) => parse_api_key_ids(Some(value.as_str())),
        Value::Number(value) => value.as_i64().map(|id| vec![id]).filter(|ids| ids[0] > 0),
        _ => None,
    }
}

fn request_payload_storage_enabled(config: &GatewayConfig) -> bool {
    config
        .store_request_payloads
        .or(config.store_payloads)
        .unwrap_or(true)
}

fn response_payload_storage_enabled(config: &GatewayConfig) -> bool {
    config
        .store_response_payloads
        .or(config.store_payloads)
        .unwrap_or(true)
}

fn extract_session_id(body: &Value) -> Option<String> {
    body.get("metadata")
        .and_then(|metadata| metadata.get("user_id"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
        .or_else(|| {
            body.get("user")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToString::to_string)
        })
}

async fn web_auth_middleware(
    State(state): State<AppState>,
    request: Request,
    next: Next,
) -> Response {
    let config = config_snapshot(&state);
    if !config
        .web_auth
        .as_ref()
        .map(|auth| auth.enabled)
        .unwrap_or(false)
    {
        return next.run(request).await;
    }

    let path = request.uri().path().to_string();
    let method = request.method().clone();
    let is_public = path == "/"
        || path == "/health"
        || path.starts_with("/auth/")
        || path == "/ui"
        || path.starts_with("/ui/")
        || path.starts_with("/assets/")
        || path == "/favicon.ico"
        || path == "/anthropic"
        || path.starts_with("/anthropic/")
        || path == "/openai"
        || path.starts_with("/openai/");
    if is_public || method == Method::OPTIONS || match_custom_route(&config, &path).is_some() {
        return next.run(request).await;
    }

    if path.starts_with("/api/") {
        let cookie_header = request
            .headers()
            .get(header::COOKIE)
            .and_then(|value| value.to_str().ok());
        if state.sessions.read_session(cookie_header).is_some() {
            return next.run(request).await;
        }
        return (
            StatusCode::UNAUTHORIZED,
            [(header::CACHE_CONTROL, "no-store")],
            Json(json!({ "error": "Authentication required" })),
        )
            .into_response();
    }

    next.run(request).await
}

fn extract_usage_stats(payload: &Value) -> UsageStats {
    let usage = payload.get("usage").unwrap_or(payload);
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
    status_code: i64,
    latency_ms: i64,
    usage: UsageStats,
    ttft_ms: Option<i64>,
    response_payload: Option<String>,
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
        let _ = upsert_request_payload(
            &context.db_path,
            context.log_id,
            None,
            response_payload.as_deref(),
        );
    }
}

fn sanitize_relative_path(input: &str) -> Option<PathBuf> {
    let raw = if input.is_empty() {
        "index.html"
    } else {
        input
    };
    let candidate = Path::new(raw);
    if candidate.is_absolute() {
        return None;
    }

    let mut clean = PathBuf::new();
    for component in candidate.components() {
        match component {
            Component::Normal(part) => clean.push(part),
            Component::CurDir => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => return None,
        }
    }
    Some(clean)
}

async fn serve_file(path: &Path) -> Response {
    match fs::read(path).await {
        Ok(contents) => {
            let mut headers = HeaderMap::new();
            if let Some(mime) = mime_guess::from_path(path).first() {
                if let Ok(value) = HeaderValue::from_str(mime.as_ref()) {
                    headers.insert(header::CONTENT_TYPE, value);
                }
            }
            (StatusCode::OK, headers, contents).into_response()
        }
        Err(_) => (StatusCode::NOT_FOUND, "not found").into_response(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::extract::Query;
    use std::fs as stdfs;
    use tokio::task::JoinHandle;

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

    async fn spawn_router(app: Router) -> (SocketAddr, JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind listener");
        let addr = listener.local_addr().expect("listener addr");
        let handle = tokio::spawn(async move {
            axum::serve(listener, app.into_make_service())
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
        let state = AppState {
            config: Arc::new(RwLock::new(config)),
            paths: Arc::new(paths.clone()),
            ui_root: None,
            active_requests: Arc::new(AtomicU64::new(0)),
            http_client: reqwest::Client::builder().build().expect("client"),
            sessions: auth::SessionStore::default(),
        };
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
}
