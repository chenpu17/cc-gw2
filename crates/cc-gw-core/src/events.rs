use std::path::Path;

use anyhow::{Context, Result};
use rusqlite::{Connection, OptionalExtension, params};
use serde::Serialize;
use serde_json::Value;

#[derive(Debug, Clone, Default)]
pub struct RecordEventInput {
    pub timestamp: Option<i64>,
    pub event_type: String,
    pub level: Option<String>,
    pub source: Option<String>,
    pub title: Option<String>,
    pub message: Option<String>,
    pub endpoint: Option<String>,
    pub ip_address: Option<String>,
    pub api_key_id: Option<i64>,
    pub api_key_name: Option<String>,
    pub api_key_value: Option<String>,
    pub user_agent: Option<String>,
    pub mode: Option<String>,
    pub details: Option<Value>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GatewayEvent {
    pub id: i64,
    pub created_at: i64,
    #[serde(rename = "type")]
    pub event_type: String,
    pub level: String,
    pub source: Option<String>,
    pub title: Option<String>,
    pub message: Option<String>,
    pub endpoint: Option<String>,
    pub ip_address: Option<String>,
    pub api_key_id: Option<i64>,
    pub api_key_name: Option<String>,
    pub api_key_value: Option<String>,
    pub user_agent: Option<String>,
    pub mode: Option<String>,
    pub details: Option<Value>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EventsPage {
    pub events: Vec<GatewayEvent>,
    pub next_cursor: Option<i64>,
}

/// Aggregate event counts bucketed by level, for the events-page stat cards.
/// Unknown levels fall back to the `info` bucket so the cards stay meaningful
/// even if a new level is introduced without updating this query.
#[derive(Debug, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct EventStats {
    pub total: i64,
    pub error: i64,
    pub warn: i64,
    pub info: i64,
}

fn open_db(db_path: &Path) -> Result<Connection> {
    let conn = Connection::open(db_path)
        .with_context(|| format!("failed to open db {}", db_path.display()))?;
    // Raise rusqlite's default 5s busy_timeout so concurrent proxy writes aren't
    // SQLITE_BUSY'd (and then silently dropped) while an admin VACUUM / log
    // cleanup holds the write lock for tens of seconds.
    conn.busy_timeout(std::time::Duration::from_secs(30))
        .with_context(|| format!("failed to set busy_timeout for db {}", db_path.display()))?;
    Ok(conn)
}

pub fn record_event(db_path: &Path, input: &RecordEventInput) -> Result<i64> {
    let conn = open_db(db_path)?;
    let created_at = input
        .timestamp
        .unwrap_or_else(|| chrono::Utc::now().timestamp_millis());
    let details = input
        .details
        .as_ref()
        .map(serde_json::to_string)
        .transpose()?;
    conn.execute(
        "INSERT INTO gateway_events (
            created_at, type, level, source, title, message, endpoint, ip_address,
            api_key_id, api_key_name, api_key_value, user_agent, mode, details
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
        params![
            created_at,
            input.event_type,
            input.level.as_deref().unwrap_or("info"),
            input.source,
            input.title,
            input.message,
            input.endpoint,
            input.ip_address,
            input.api_key_id,
            input.api_key_name,
            input.api_key_value,
            input.user_agent,
            input.mode,
            details
        ],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn list_events(
    db_path: &Path,
    limit: i64,
    before_id: Option<i64>,
    level: Option<&str>,
    event_type: Option<&str>,
    endpoint: Option<&str>,
) -> Result<EventsPage> {
    let conn = open_db(db_path)?;
    let page_limit = limit.clamp(1, 200);
    let mut clauses = Vec::new();
    let mut values: Vec<rusqlite::types::Value> = Vec::new();

    if let Some(before_id) = before_id.filter(|value| *value > 0) {
        clauses.push("id < ?");
        values.push(before_id.into());
    }
    if let Some(level) = level.filter(|value| !value.trim().is_empty()) {
        clauses.push("level = ?");
        values.push(level.to_string().into());
    }
    if let Some(event_type) = event_type.filter(|value| !value.trim().is_empty()) {
        clauses.push("type = ?");
        values.push(event_type.to_string().into());
    }
    if let Some(endpoint) = endpoint.filter(|value| !value.trim().is_empty()) {
        clauses.push("endpoint = ?");
        values.push(endpoint.to_string().into());
    }

    let where_clause = if clauses.is_empty() {
        String::new()
    } else {
        format!("WHERE {}", clauses.join(" AND "))
    };
    values.push((page_limit + 1).into());

    let sql = format!(
        "SELECT id, created_at, type, level, source, title, message, endpoint, ip_address,
                api_key_id, api_key_name, api_key_value, user_agent, mode, details
         FROM gateway_events
         {where_clause}
         ORDER BY id DESC
         LIMIT ?"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(rusqlite::params_from_iter(values.iter()), |row| {
        let raw_details: Option<String> = row.get(14)?;
        let details = raw_details.as_deref().map(|value| {
            serde_json::from_str::<Value>(value)
                .unwrap_or_else(|_| Value::String(value.to_string()))
        });
        Ok(GatewayEvent {
            id: row.get(0)?,
            created_at: row.get(1)?,
            event_type: row.get(2)?,
            level: row.get(3)?,
            source: row.get(4)?,
            title: row.get(5)?,
            message: row.get(6)?,
            endpoint: row.get(7)?,
            ip_address: row.get(8)?,
            api_key_id: row.get(9)?,
            api_key_name: row.get(10)?,
            api_key_value: row.get(11)?,
            user_agent: row.get(12)?,
            mode: row.get(13)?,
            details,
        })
    })?;

    let mut items = Vec::new();
    for row in rows {
        items.push(row?);
    }

    let next_cursor = if items.len() as i64 > page_limit {
        let next = items.get(page_limit as usize).map(|item| item.id);
        items.truncate(page_limit as usize);
        next
    } else {
        None
    };

    Ok(EventsPage {
        events: items,
        next_cursor,
    })
}

pub fn latest_event_id(db_path: &Path) -> Result<Option<i64>> {
    let conn = open_db(db_path)?;
    conn.query_row(
        "SELECT id FROM gateway_events ORDER BY id DESC LIMIT 1",
        [],
        |row| row.get(0),
    )
    .optional()
    .map_err(Into::into)
}

/// Count events grouped by level. `since` (epoch millis) optionally bounds the
/// window; `None` covers all recorded events.
pub fn get_event_stats(db_path: &Path, since: Option<i64>) -> Result<EventStats> {
    let conn = open_db(db_path)?;
    let mut values: Vec<rusqlite::types::Value> = Vec::new();
    let sql = match since.filter(|value| *value > 0) {
        Some(since) => {
            values.push(since.into());
            "SELECT level, COUNT(*) FROM gateway_events WHERE created_at >= ? GROUP BY level"
        }
        None => "SELECT level, COUNT(*) FROM gateway_events GROUP BY level",
    };
    let mut stmt = conn.prepare(sql)?;
    let rows = stmt.query_map(rusqlite::params_from_iter(values.iter()), |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
    })?;
    let mut stats = EventStats::default();
    for row in rows {
        let (level, count): (String, i64) = row?;
        stats.total += count;
        let bucket = match level.to_ascii_lowercase().as_str() {
            "error" => &mut stats.error,
            "warn" | "warning" => &mut stats.warn,
            _ => &mut stats.info,
        };
        *bucket += count;
    }
    Ok(stats)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::initialize_database;

    #[test]
    fn event_stats_buckets_by_level_and_respects_time_window() {
        let root = std::env::temp_dir().join(format!(
            "cc-gw2-events-stats-tests-{}",
            chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default()
        ));
        std::fs::create_dir_all(&root).expect("create temp root");
        let db_path = root.join("gateway.db");
        initialize_database(&db_path).expect("init database");

        let now = chrono::Utc::now().timestamp_millis();
        for (event_type, level, timestamp) in [
            ("provider_proxy_failure", Some("error"), now),
            ("stream_filtered_warn", Some("warn"), now),
            ("stream_filtered_warn", Some("warn"), now),
            ("openai_compatibility_mode_learned", Some("info"), now),
            (
                "provider_proxy_failure",
                Some("error"),
                now - 7 * 24 * 60 * 60 * 1000,
            ),
        ] {
            record_event(
                &db_path,
                &RecordEventInput {
                    timestamp: Some(timestamp),
                    event_type: event_type.to_string(),
                    level: level.map(|value| value.to_string()),
                    source: None,
                    title: None,
                    message: None,
                    endpoint: None,
                    ip_address: None,
                    api_key_id: None,
                    api_key_name: None,
                    api_key_value: None,
                    user_agent: None,
                    mode: None,
                    details: None,
                },
            )
            .expect("record event");
        }

        let all = get_event_stats(&db_path, None).expect("all-time stats");
        assert_eq!(all.total, 5);
        assert_eq!(all.error, 2);
        assert_eq!(all.warn, 2);
        assert_eq!(all.info, 1);

        // Windowed: the 7-day-old error event falls outside a 24h cutoff.
        let recent =
            get_event_stats(&db_path, Some(now - 24 * 60 * 60 * 1000)).expect("windowed stats");
        assert_eq!(recent.total, 4);
        assert_eq!(recent.error, 1);

        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn event_stats_empty_db_returns_zeros() {
        let root = std::env::temp_dir().join(format!(
            "cc-gw2-events-stats-empty-tests-{}",
            chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default()
        ));
        std::fs::create_dir_all(&root).expect("create temp root");
        let db_path = root.join("gateway.db");
        initialize_database(&db_path).expect("init database");

        // No events recorded → all buckets zero, never an error/None.
        let stats = get_event_stats(&db_path, None).expect("empty stats");
        assert_eq!(stats.total, 0);
        assert_eq!(stats.error, 0);
        assert_eq!(stats.warn, 0);
        assert_eq!(stats.info, 0);

        // A windowed query on an empty DB also returns zeros.
        let windowed = get_event_stats(&db_path, Some(0)).expect("empty windowed stats");
        assert_eq!(windowed.total, 0);

        let _ = std::fs::remove_dir_all(root);
    }
}
