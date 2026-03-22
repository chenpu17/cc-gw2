use super::*;
use cc_gw_core::profiler::{
    clear_all_profiler_sessions, delete_profiler_session, get_profiler_session_detail,
    list_profiler_sessions,
};

#[derive(Debug, Deserialize, Default)]
pub(super) struct ProfilerSessionsQuery {
    limit: Option<i64>,
    offset: Option<i64>,
}

pub(super) async fn api_profiler_status(State(state): State<AppState>) -> Json<Value> {
    let active = state.profiling_active.load(Ordering::Relaxed) != 0;
    Json(json!({ "active": active }))
}

pub(super) async fn api_profiler_start(State(state): State<AppState>) -> Json<Value> {
    state.profiling_active.store(1, Ordering::Relaxed);
    Json(json!({ "active": true }))
}

pub(super) async fn api_profiler_stop(State(state): State<AppState>) -> Json<Value> {
    state.profiling_active.store(0, Ordering::Relaxed);
    Json(json!({ "active": false }))
}

pub(super) async fn api_profiler_sessions(
    State(state): State<AppState>,
    Query(query): Query<ProfilerSessionsQuery>,
) -> Response {
    let limit = query.limit.unwrap_or(50);
    let offset = query.offset.unwrap_or(0);
    match list_profiler_sessions(&state.paths.db_path, limit, offset) {
        Ok(result) => Json(result).into_response(),
        Err(error) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": error.to_string() })),
        )
            .into_response(),
    }
}

pub(super) async fn api_profiler_session_detail(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
) -> Response {
    match get_profiler_session_detail(&state.paths.db_path, &id) {
        Ok(Some(detail)) => Json(detail).into_response(),
        Ok(None) => (StatusCode::NOT_FOUND, Json(json!({ "error": "not found" }))).into_response(),
        Err(error) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": error.to_string() })),
        )
            .into_response(),
    }
}

pub(super) async fn api_profiler_session_delete(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
) -> Response {
    match delete_profiler_session(&state.paths.db_path, &id) {
        Ok(true) => StatusCode::NO_CONTENT.into_response(),
        Ok(false) => (StatusCode::NOT_FOUND, Json(json!({ "error": "not found" }))).into_response(),
        Err(error) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": error.to_string() })),
        )
            .into_response(),
    }
}

pub(super) async fn api_profiler_clear(State(state): State<AppState>) -> Response {
    match clear_all_profiler_sessions(&state.paths.db_path) {
        Ok(deleted) => Json(json!({ "deleted": deleted })).into_response(),
        Err(error) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": error.to_string() })),
        )
            .into_response(),
    }
}
