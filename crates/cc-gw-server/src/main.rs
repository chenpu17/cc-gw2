use std::io::{Cursor, Write};
use std::net::SocketAddr;
use std::path::{Component, Path, PathBuf};
use std::sync::{
    Arc, Mutex, RwLock,
    atomic::{AtomicU64, Ordering},
};

use anyhow::{Context, Result, anyhow};
use async_stream::stream;
use axum::{
    Json, Router,
    body::Body,
    body::Bytes,
    extract::{ConnectInfo, Path as AxumPath, Query, Request, State},
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
        get_recent_client_activity, increment_daily_metrics, insert_request_log, query_logs,
        upsert_request_payload,
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

mod admin_routes;
mod auth;
mod auth_routes;
mod proxy_routes;
mod ui_routes;
mod web_middleware;

#[derive(Clone)]
struct AppState {
    config: Arc<RwLock<GatewayConfig>>,
    paths: Arc<GatewayPaths>,
    ui_root: Option<Arc<PathBuf>>,
    active_requests: Arc<AtomicU64>,
    active_client_addresses: Arc<Mutex<HashMap<String, u64>>>,
    active_client_sessions: Arc<Mutex<HashMap<String, u64>>>,
    active_requests_by_endpoint: Arc<Mutex<HashMap<String, u64>>>,
    active_client_addresses_by_endpoint: Arc<Mutex<HashMap<String, HashMap<String, u64>>>>,
    active_client_sessions_by_endpoint: Arc<Mutex<HashMap<String, HashMap<String, u64>>>>,
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
    #[serde(rename = "activeClientAddresses")]
    active_client_addresses: u64,
    #[serde(rename = "activeClientSessions")]
    active_client_sessions: u64,
    #[serde(rename = "uniqueClientAddressesLastHour")]
    unique_client_addresses_last_hour: u64,
    #[serde(rename = "uniqueClientSessionsLastHour")]
    unique_client_sessions_last_hour: u64,
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

#[derive(Debug, Deserialize, Default)]
struct StatusQuery {
    endpoint: Option<String>,
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
        active_client_addresses: Arc::new(Mutex::new(HashMap::new())),
        active_client_sessions: Arc::new(Mutex::new(HashMap::new())),
        active_requests_by_endpoint: Arc::new(Mutex::new(HashMap::new())),
        active_client_addresses_by_endpoint: Arc::new(Mutex::new(HashMap::new())),
        active_client_sessions_by_endpoint: Arc::new(Mutex::new(HashMap::new())),
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
            axum::serve(listener, app.into_make_service_with_connect_info::<SocketAddr>())
                .await?;
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
                .serve(app.into_make_service_with_connect_info::<SocketAddr>())
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
        .route("/", get(ui_routes::root_redirect))
        .route("/health", get(ui_routes::health))
        .route("/auth/session", get(auth_routes::auth_session))
        .route("/auth/login", post(auth_routes::auth_login))
        .route("/auth/logout", post(auth_routes::auth_logout))
        .route("/api/status", get(admin_routes::api_status))
        .route(
            "/api/config",
            get(admin_routes::api_config).put(admin_routes::api_config_update),
        )
        .route("/api/config/info", get(admin_routes::api_config_info))
        .route(
            "/api/auth/web",
            get(auth_routes::api_auth_web).post(auth_routes::api_auth_web_update),
        )
        .route("/api/providers", get(admin_routes::api_providers))
        .route(
            "/api/providers/{id}/test",
            post(admin_routes::api_provider_test),
        )
        .route(
            "/api/custom-endpoints",
            get(admin_routes::api_custom_endpoints).post(admin_routes::api_custom_endpoints_create),
        )
        .route(
            "/api/custom-endpoints/{id}",
            axum::routing::put(admin_routes::api_custom_endpoints_update)
                .delete(admin_routes::api_custom_endpoints_delete),
        )
        .route(
            "/api/routing-presets/{endpoint}",
            post(admin_routes::api_routing_presets_create),
        )
        .route(
            "/api/routing-presets/{endpoint}/apply",
            post(admin_routes::api_routing_presets_apply),
        )
        .route(
            "/api/routing-presets/{endpoint}/{name}",
            axum::routing::delete(admin_routes::api_routing_presets_delete),
        )
        .route("/api/events", get(admin_routes::api_events))
        .route(
            "/api/keys",
            get(admin_routes::api_keys_list).post(admin_routes::api_keys_create),
        )
        .route(
            "/api/keys/{id}",
            patch(admin_routes::api_keys_patch).delete(admin_routes::api_keys_delete),
        )
        .route("/api/keys/{id}/reveal", get(admin_routes::api_keys_reveal))
        .route("/api/logs", get(admin_routes::api_logs))
        .route("/api/logs/export", post(admin_routes::api_logs_export))
        .route("/api/logs/cleanup", post(admin_routes::api_logs_cleanup))
        .route("/api/logs/clear", post(admin_routes::api_logs_clear))
        .route("/api/logs/{id}", get(admin_routes::api_log_detail))
        .route("/api/db/info", get(admin_routes::api_db_info))
        .route("/api/db/compact", post(admin_routes::api_db_compact))
        .route("/api/stats/overview", get(admin_routes::api_stats_overview))
        .route("/api/stats/daily", get(admin_routes::api_stats_daily))
        .route("/api/stats/model", get(admin_routes::api_stats_model))
        .route(
            "/api/stats/api-keys/overview",
            get(admin_routes::api_stats_api_keys_overview),
        )
        .route(
            "/api/stats/api-keys/usage",
            get(admin_routes::api_stats_api_keys_usage),
        )
        .route(
            "/anthropic/api/event_logging/batch",
            post(ui_routes::anthropic_event_logging_batch),
        )
        .route("/v1/messages", post(proxy_routes::anthropic_messages))
        .route(
            "/anthropic/v1/messages",
            post(proxy_routes::anthropic_messages),
        )
        .route(
            "/anthropic/v1/v1/messages",
            post(proxy_routes::anthropic_messages),
        )
        .route(
            "/v1/messages/count_tokens",
            post(proxy_routes::anthropic_count_tokens),
        )
        .route(
            "/anthropic/v1/messages/count_tokens",
            post(proxy_routes::anthropic_count_tokens),
        )
        .route(
            "/anthropic/v1/v1/messages/count_tokens",
            post(proxy_routes::anthropic_count_tokens),
        )
        .route("/openai/v1/models", get(proxy_routes::openai_models))
        .route("/openai/models", get(proxy_routes::openai_models))
        .route(
            "/openai/v1/chat/completions",
            post(proxy_routes::openai_chat_completions),
        )
        .route(
            "/openai/chat/completions",
            post(proxy_routes::openai_chat_completions),
        )
        .route("/openai/v1/responses", post(proxy_routes::openai_responses))
        .route("/openai/responses", post(proxy_routes::openai_responses))
        .route("/ui", get(ui_routes::ui_redirect))
        .route("/ui/", get(ui_routes::ui_index))
        .route("/favicon.ico", get(ui_routes::favicon))
        .route("/ui/{*path}", get(ui_routes::ui_path))
        .route("/assets/{*path}", get(ui_routes::asset_path))
        .fallback(dynamic_fallback)
        .layer(middleware::from_fn_with_state(
            state.clone(),
            web_middleware::web_auth_middleware,
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
        if endpoint.enabled == Some(false) {
            continue;
        }
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

async fn dynamic_fallback(
    State(state): State<AppState>,
    ConnectInfo(connect_info): ConnectInfo<SocketAddr>,
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
            let source_ip = extract_client_ip(&headers, Some(connect_info));
            proxy_routes::proxy_standard_request(
                state,
                headers,
                source_ip,
                payload,
                gateway_endpoint,
                protocol,
            )
            .await
        }
        _ => (StatusCode::METHOD_NOT_ALLOWED, "method not allowed").into_response(),
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

fn normalize_forwarded_ip(value: &str) -> Option<String> {
    value
        .split(',')
        .next()
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .map(ToString::to_string)
}

fn extract_client_ip(
    headers: &HeaderMap,
    connect_info: Option<SocketAddr>,
) -> Option<String> {
    header_value(headers, "x-forwarded-for")
        .as_deref()
        .and_then(normalize_forwarded_ip)
        .or_else(|| header_value(headers, "x-real-ip"))
        .or_else(|| connect_info.map(|info| info.ip().to_string()))
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

#[cfg(test)]
mod tests;
