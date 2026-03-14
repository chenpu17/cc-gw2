use super::*;

pub(super) async fn auth_session(
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

pub(super) async fn auth_login(
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

pub(super) async fn auth_logout(State(state): State<AppState>, headers: HeaderMap) -> Response {
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

pub(super) async fn api_auth_web(State(state): State<AppState>) -> Json<serde_json::Value> {
    let config = config_snapshot(&state);
    let auth = config.web_auth.unwrap_or_default();
    Json(json!({
        "enabled": auth.enabled,
        "username": auth.username.unwrap_or_default(),
        "hasPassword": auth.password_hash.is_some() && auth.password_salt.is_some()
    }))
}

pub(super) async fn api_auth_web_update(
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
