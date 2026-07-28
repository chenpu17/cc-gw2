use super::*;
use axum::response::sse::{Event, KeepAlive, Sse};
use std::convert::Infallible;
use std::time::Duration;

/// Aggregate everything the Dashboard first screen needs in a single request,
/// reusing the same internal queries behind `/api/status`, `/api/stats/*`,
/// `/api/logs`, `/api/events`, and `/api/db/info`.
pub(super) async fn api_dashboard_summary(
    State(state): State<AppState>,
    Query(query): Query<HashMap<String, String>>,
) -> Response {
    let endpoint = query
        .get("endpoint")
        .map(String::as_str)
        .filter(|value| !value.is_empty());
    let db_path = &state.paths.db_path;
    let home_dir = &state.paths.home_dir;

    let status = admin_routes::build_status_response(&state, endpoint);

    let result = (|| -> Result<Value> {
        let overview = get_metrics_overview(db_path, endpoint)?;
        let daily = get_daily_metrics(db_path, 14, endpoint)?;
        let model_stats = get_model_usage_metrics(db_path, 7, 6, endpoint)?;
        let recent_requests = {
            let result = query_logs(
                db_path,
                &LogQuery {
                    limit: 5,
                    offset: 0,
                    provider: None,
                    model: None,
                    endpoint: endpoint.map(ToString::to_string),
                    status: None,
                    from: None,
                    to: None,
                    api_key_ids: None,
                },
            )?;
            // Mask the encrypted api_key_value (decrypt → masked preview) so the
            // ciphertext is never shipped to the dashboard; matches /api/logs.
            let mut value = serde_json::to_value(result).unwrap_or_else(|_| json!({}));
            if let Some(items) = value.get_mut("items").and_then(Value::as_array_mut) {
                for item in items {
                    mask_log_record_api_key(item, home_dir);
                }
            }
            value
        };
        // `/api/events` only accepts a single level filter, so merge the
        // error and warn pages and keep the 10 most recent entries. Honor the
        // endpoint filter so the attention feed matches the scoped dashboard.
        let mut recent_errors = list_events(db_path, 10, None, Some("error"), None, endpoint)?.events;
        recent_errors.extend(list_events(db_path, 10, None, Some("warn"), None, endpoint)?.events);
        recent_errors.sort_by(|a, b| b.id.cmp(&a.id));
        recent_errors.truncate(10);
        let db_info = get_database_info(db_path)?;

        Ok(json!({
            "status": status,
            "overview": overview,
            "daily": daily,
            "modelStats": model_stats,
            "recentRequests": recent_requests,
            "recentErrors": recent_errors,
            "dbInfo": db_info,
        }))
    })();

    match result {
        Ok(payload) => Json(payload).into_response(),
        Err(error) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": error.to_string() })),
        )
            .into_response(),
    }
}

fn csv_filter(query: &HashMap<String, String>, key: &str) -> Vec<String> {
    query
        .get(key)
        .map(|value| {
            value
                .split(',')
                .map(str::trim)
                .filter(|item| !item.is_empty())
                .map(ToString::to_string)
                .collect()
        })
        .unwrap_or_default()
}

/// Server-Sent Events stream of gateway events recorded after the client
/// connected. Supports `?level=error,warn&type=xxx` server-side filters.
pub(super) async fn api_events_stream(
    State(state): State<AppState>,
    Query(query): Query<HashMap<String, String>>,
) -> Sse<impl futures_util::Stream<Item = Result<Event, Infallible>>> {
    let levels = csv_filter(&query, "level");
    let types = csv_filter(&query, "type");
    let mut receiver = state.event_bus.subscribe();

    let stream = stream! {
        loop {
            match receiver.recv().await {
                Ok(event) => {
                    if !levels.is_empty() && !levels.iter().any(|level| *level == event.level) {
                        continue;
                    }
                    if !types.is_empty() && !types.iter().any(|kind| *kind == event.event_type) {
                        continue;
                    }
                    let data = serde_json::to_string(&event)
                        .unwrap_or_else(|_| "{}".to_string());
                    yield Ok(Event::default().data(data));
                }
                Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
            }
        }
    };

    Sse::new(stream).keep_alive(
        KeepAlive::new()
            .interval(Duration::from_secs(15))
            .text("keep-alive"),
    )
}
