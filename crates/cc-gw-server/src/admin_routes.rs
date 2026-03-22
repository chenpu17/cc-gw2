use super::*;

fn count_active_entries(entries: &Mutex<HashMap<String, u64>>) -> u64 {
    entries.lock().map(|items| items.len() as u64).unwrap_or(0)
}

fn count_active_entries_for_endpoint(
    entries: &Mutex<HashMap<String, HashMap<String, u64>>>,
    endpoint: &str,
) -> u64 {
    entries
        .lock()
        .ok()
        .and_then(|items| items.get(endpoint).map(|bucket| bucket.len() as u64))
        .unwrap_or(0)
}

fn count_active_requests_for_endpoint(
    entries: &Mutex<HashMap<String, u64>>,
    endpoint: &str,
) -> u64 {
    entries
        .lock()
        .ok()
        .and_then(|items| items.get(endpoint).copied())
        .unwrap_or(0)
}

pub(super) async fn api_status(
    State(state): State<AppState>,
    Query(query): Query<StatusQuery>,
) -> Json<StatusResponse> {
    let config = config_snapshot(&state);
    let last_hour = chrono::Utc::now().timestamp_millis() - 60 * 60 * 1000;
    let endpoint = query
        .endpoint
        .as_deref()
        .filter(|value| !value.trim().is_empty());
    let recent_activity =
        get_recent_client_activity(&state.paths.db_path, last_hour, endpoint).unwrap_or_default();
    let active_requests = if let Some(endpoint) = endpoint {
        count_active_requests_for_endpoint(&state.active_requests_by_endpoint, endpoint)
    } else {
        state.active_requests.load(Ordering::Relaxed)
    };
    let active_client_addresses = if let Some(endpoint) = endpoint {
        count_active_entries_for_endpoint(&state.active_client_addresses_by_endpoint, endpoint)
    } else {
        count_active_entries(&state.active_client_addresses)
    };
    let active_client_sessions = if let Some(endpoint) = endpoint {
        count_active_entries_for_endpoint(&state.active_client_sessions_by_endpoint, endpoint)
    } else {
        count_active_entries(&state.active_client_sessions)
    };
    let cpu_usage_percent = state
        .runtime_metrics
        .lock()
        .ok()
        .and_then(|mut metrics| metrics.current_process_cpu_usage_percent());
    Json(StatusResponse {
        port: config.port,
        host: config.host.clone(),
        providers: config.providers.len(),
        active_requests,
        active_client_addresses,
        active_client_sessions,
        unique_client_addresses_last_hour: recent_activity.unique_source_ips.max(0) as u64,
        unique_client_sessions_last_hour: recent_activity.unique_session_ids.max(0) as u64,
        runtime: "rust",
        backend_version: env!("CARGO_PKG_VERSION"),
        platform: format!("{}-{}", std::env::consts::OS, std::env::consts::ARCH),
        cpu_usage_percent,
        pid: std::process::id(),
    })
}

pub(super) async fn api_config(State(state): State<AppState>) -> Json<GatewayConfig> {
    Json(config_snapshot(&state).sanitize_for_web())
}

pub(super) async fn api_config_info(State(state): State<AppState>) -> Json<ConfigInfoResponse> {
    let config = config_snapshot(&state).sanitize_for_web();
    Json(ConfigInfoResponse {
        config,
        path: state.paths.config_path.display().to_string(),
    })
}

pub(super) async fn api_providers(
    State(state): State<AppState>,
) -> Json<Vec<cc_gw_core::config::ProviderConfig>> {
    Json(config_snapshot(&state).providers)
}

pub(super) async fn api_provider_test(
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

pub(super) async fn api_config_update(
    State(state): State<AppState>,
    Json(body): Json<Value>,
) -> Response {
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

pub(super) async fn api_custom_endpoints(State(state): State<AppState>) -> Json<serde_json::Value> {
    let config = config_snapshot(&state);
    Json(json!({ "endpoints": config.custom_endpoints }))
}

pub(super) async fn api_custom_endpoints_create(
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

pub(super) async fn api_custom_endpoints_update(
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

pub(super) async fn api_custom_endpoints_delete(
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

pub(super) async fn api_routing_presets_create(
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
                    Default::default()
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

pub(super) async fn api_routing_presets_apply(
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
                model_routes: Default::default(),
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
                model_routes: Default::default(),
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

pub(super) async fn api_routing_presets_delete(
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

pub(super) async fn api_events(
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

pub(super) async fn api_keys_list(State(state): State<AppState>) -> Response {
    match list_api_keys(&state.paths.db_path) {
        Ok(result) => Json(json!(result)).into_response(),
        Err(error) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": error.to_string() })),
        )
            .into_response(),
    }
}

pub(super) async fn api_keys_create(
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

pub(super) async fn api_keys_patch(
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

pub(super) async fn api_keys_delete(
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

pub(super) async fn api_keys_reveal(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<i64>,
) -> Response {
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

pub(super) async fn api_logs(
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

pub(super) async fn api_logs_export(
    State(state): State<AppState>,
    Json(body): Json<Value>,
) -> Response {
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

pub(super) async fn api_logs_cleanup(State(state): State<AppState>) -> Response {
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

pub(super) async fn api_logs_clear(State(state): State<AppState>) -> Response {
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

pub(super) async fn api_log_detail(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<i64>,
) -> Response {
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

pub(super) async fn api_stats_api_keys_overview(
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

pub(super) async fn api_stats_api_keys_usage(
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

pub(super) async fn api_db_info(State(state): State<AppState>) -> Response {
    match get_database_info(&state.paths.db_path) {
        Ok(result) => Json(json!(result)).into_response(),
        Err(error) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": error.to_string() })),
        )
            .into_response(),
    }
}

pub(super) async fn api_db_compact(State(state): State<AppState>) -> Response {
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

pub(super) async fn api_stats_overview(
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

pub(super) async fn api_stats_daily(
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

pub(super) async fn api_stats_model(
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
