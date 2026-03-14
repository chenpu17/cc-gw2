use super::*;

pub(super) async fn web_auth_middleware(
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
