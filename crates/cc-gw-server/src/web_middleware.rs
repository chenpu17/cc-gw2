use super::*;

fn apply_no_store_headers(headers: &mut HeaderMap) {
    headers.insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("no-store, no-cache, must-revalidate, max-age=0"),
    );
    headers.insert(header::PRAGMA, HeaderValue::from_static("no-cache"));
    headers.insert(header::EXPIRES, HeaderValue::from_static("0"));
}

pub(super) async fn web_auth_middleware(
    State(state): State<AppState>,
    request: Request,
    next: Next,
) -> Response {
    let path = request.uri().path().to_string();
    let method = request.method().clone();
    let config = config_snapshot(&state);
    if !config
        .web_auth
        .as_ref()
        .map(|auth| auth.enabled)
        .unwrap_or(false)
    {
        let mut response = next.run(request).await;
        if path == "/health" || path.starts_with("/auth/") || path.starts_with("/api/") {
            apply_no_store_headers(response.headers_mut());
        }
        return response;
    }

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
            [
                (
                    header::CACHE_CONTROL,
                    "no-store, no-cache, must-revalidate, max-age=0",
                ),
                (header::PRAGMA, "no-cache"),
                (header::EXPIRES, "0"),
            ],
            Json(json!({ "error": "Authentication required" })),
        )
            .into_response();
    }

    let mut response = next.run(request).await;
    if path == "/health" || path.starts_with("/auth/") || path.starts_with("/api/") {
        apply_no_store_headers(response.headers_mut());
    }
    response
}
