use super::*;

pub(super) async fn root_redirect() -> Response {
    legacy_redirect("/ui/")
}

pub(super) async fn ui_redirect() -> Response {
    legacy_redirect("/ui/")
}

pub(super) fn legacy_redirect(location: &str) -> Response {
    (StatusCode::FOUND, [(header::LOCATION, location)]).into_response()
}

pub(super) async fn health() -> Json<serde_json::Value> {
    Json(json!({ "status": "ok" }))
}

pub(super) async fn anthropic_event_logging_batch() -> StatusCode {
    StatusCode::NO_CONTENT
}

pub(super) async fn ui_index(State(state): State<AppState>) -> Response {
    serve_from_ui(&state, "index.html", true).await
}

pub(super) async fn ui_path(
    State(state): State<AppState>,
    AxumPath(path): AxumPath<String>,
) -> Response {
    let path = if path.trim().is_empty() {
        "index.html"
    } else {
        path.as_str()
    };
    serve_from_ui(&state, path, true).await
}

pub(super) async fn asset_path(
    State(state): State<AppState>,
    AxumPath(path): AxumPath<String>,
) -> Response {
    let asset_path = if path.trim().is_empty() {
        "assets".to_string()
    } else {
        format!("assets/{path}")
    };
    serve_from_ui(&state, &asset_path, false).await
}

pub(super) async fn favicon(State(state): State<AppState>) -> Response {
    let response = serve_from_ui(&state, "favicon.ico", false).await;
    if response.status() == StatusCode::NOT_FOUND {
        return StatusCode::NO_CONTENT.into_response();
    }
    response
}

pub(super) async fn serve_from_ui(
    state: &AppState,
    requested_path: &str,
    spa_fallback: bool,
) -> Response {
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

pub(super) fn sanitize_relative_path(input: &str) -> Option<PathBuf> {
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

pub(super) async fn serve_file(path: &Path) -> Response {
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
