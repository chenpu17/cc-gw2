use std::fs;
use std::io::{Read, Write};
use std::path::Path;

use anyhow::{Context, Result};
use brotli::{CompressorWriter, Decompressor};
use rusqlite::{Connection, OptionalExtension, params};
use serde::Serialize;
use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, RefreshKind, System};

#[derive(Debug, Clone)]
pub struct RequestLogInput {
    pub timestamp: i64,
    pub session_id: Option<String>,
    pub source_ip: Option<String>,
    pub endpoint: String,
    pub provider: String,
    pub model: String,
    pub client_model: Option<String>,
    pub stream: bool,
    pub api_key_id: Option<i64>,
    pub api_key_name: Option<String>,
    pub api_key_value: Option<String>,
}

#[derive(Debug, Clone, Default)]
pub struct RequestLogUpdate {
    pub latency_ms: Option<i64>,
    pub status_code: Option<i64>,
    pub input_tokens: Option<i64>,
    pub output_tokens: Option<i64>,
    pub cached_tokens: Option<i64>,
    pub cache_read_tokens: Option<i64>,
    pub cache_creation_tokens: Option<i64>,
    pub ttft_ms: Option<i64>,
    pub tpot_ms: Option<f64>,
    pub error: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct LogRecord {
    pub id: i64,
    pub timestamp: i64,
    pub session_id: Option<String>,
    pub endpoint: String,
    pub provider: String,
    pub model: String,
    pub client_model: Option<String>,
    pub stream: bool,
    pub latency_ms: Option<i64>,
    pub status_code: Option<i64>,
    pub input_tokens: Option<i64>,
    pub output_tokens: Option<i64>,
    pub cached_tokens: Option<i64>,
    pub cache_read_tokens: Option<i64>,
    pub cache_creation_tokens: Option<i64>,
    pub ttft_ms: Option<i64>,
    pub tpot_ms: Option<f64>,
    pub error: Option<String>,
    pub api_key_id: Option<i64>,
    pub api_key_name: Option<String>,
    pub api_key_value: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct LogListResult {
    pub total: i64,
    pub items: Vec<LogRecord>,
}

#[derive(Debug, Serialize)]
pub struct LogPayload {
    pub prompt: Option<String>,
    pub response: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct LogDetail {
    #[serde(flatten)]
    pub record: LogRecord,
    pub payload: Option<LogPayload>,
}

#[derive(Debug, Serialize)]
pub struct ExportLogRecord {
    #[serde(flatten)]
    pub record: LogRecord,
    pub payload: Option<LogPayload>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MetricsOverviewSection {
    pub requests: i64,
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub cached_tokens: i64,
    pub cache_read_tokens: i64,
    pub cache_creation_tokens: i64,
    pub avg_latency_ms: i64,
}

#[derive(Debug, Serialize)]
pub struct MetricsOverview {
    pub totals: MetricsOverviewSection,
    pub today: MetricsOverviewSection,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DailyMetric {
    pub date: String,
    pub request_count: i64,
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub cached_tokens: i64,
    pub cache_read_tokens: i64,
    pub cache_creation_tokens: i64,
    pub avg_latency_ms: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelUsageMetric {
    pub model: String,
    pub provider: String,
    pub requests: i64,
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub avg_latency_ms: i64,
    pub avg_ttft_ms: Option<f64>,
    pub avg_tpot_ms: Option<f64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseInfo {
    pub page_count: i64,
    pub page_size: i64,
    pub freelist_pages: i64,
    pub size_bytes: i64,
    pub file_size_bytes: i64,
    pub wal_size_bytes: i64,
    pub total_bytes: i64,
    pub memory_rss_bytes: Option<i64>,
}

#[derive(Debug, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ClientActivityMetrics {
    pub unique_source_ips: i64,
    pub unique_session_ids: i64,
}

#[derive(Debug, Default)]
pub struct LogQuery {
    pub limit: i64,
    pub offset: i64,
    pub provider: Option<String>,
    pub model: Option<String>,
    pub endpoint: Option<String>,
    pub status: Option<String>,
    pub from: Option<i64>,
    pub to: Option<i64>,
    pub api_key_ids: Option<Vec<i64>>,
}

#[derive(Debug, Clone, Default)]
pub struct UsageStats {
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub cached_tokens: i64,
    pub cache_read_tokens: i64,
    pub cache_creation_tokens: i64,
}

fn compress_payload(value: &str) -> Result<Vec<u8>> {
    let mut output = Vec::new();
    {
        let mut writer = CompressorWriter::new(&mut output, 4096, 1, 22);
        writer.write_all(value.as_bytes())?;
        writer.flush()?;
    }
    Ok(output)
}

fn decompress_payload(value: Option<Vec<u8>>) -> Option<String> {
    let value = value?;
    if value.is_empty() {
        return Some(String::new());
    }

    let mut decompressed = Vec::new();
    let mut reader = Decompressor::new(value.as_slice(), 4096);
    if reader.read_to_end(&mut decompressed).is_ok() {
        return String::from_utf8(decompressed).ok();
    }

    String::from_utf8(value).ok()
}

fn open_db(db_path: &Path) -> Result<Connection> {
    Connection::open(db_path).with_context(|| format!("failed to open db {}", db_path.display()))
}

fn current_process_memory_rss_bytes() -> Option<i64> {
    let pid = Pid::from_u32(std::process::id());
    let refresh =
        RefreshKind::nothing().with_processes(ProcessRefreshKind::nothing().with_memory());
    let mut system = System::new_with_specifics(refresh);
    system.refresh_processes(ProcessesToUpdate::Some(&[pid]), true);
    system.process(pid).map(|process| process.memory() as i64)
}

fn today_key() -> String {
    chrono::Utc::now().format("%Y-%m-%d").to_string()
}

pub fn insert_request_log(db_path: &Path, input: &RequestLogInput) -> Result<i64> {
    let conn = open_db(db_path)?;
    conn.execute(
        "INSERT INTO request_logs (
          timestamp, session_id, source_ip, endpoint, provider, model, client_model, stream,
          api_key_id, api_key_name, api_key_value
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
        params![
            input.timestamp,
            input.session_id,
            input.source_ip,
            input.endpoint,
            input.provider,
            input.model,
            input.client_model,
            if input.stream { 1 } else { 0 },
            input.api_key_id,
            input.api_key_name,
            input.api_key_value
        ],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn finalize_request_log(db_path: &Path, id: i64, update: &RequestLogUpdate) -> Result<()> {
    let conn = open_db(db_path)?;
    conn.execute(
        "UPDATE request_logs
         SET latency_ms = ?2,
             status_code = ?3,
             input_tokens = ?4,
             output_tokens = ?5,
             cached_tokens = ?6,
             cache_read_tokens = ?7,
             cache_creation_tokens = ?8,
             ttft_ms = ?9,
             tpot_ms = ?10,
             error = ?11
         WHERE id = ?1",
        params![
            id,
            update.latency_ms,
            update.status_code,
            update.input_tokens,
            update.output_tokens,
            update.cached_tokens,
            update.cache_read_tokens,
            update.cache_creation_tokens,
            update.ttft_ms,
            update.tpot_ms,
            update.error
        ],
    )?;
    Ok(())
}

pub fn upsert_request_payload(
    db_path: &Path,
    request_id: i64,
    prompt: Option<&str>,
    response: Option<&str>,
) -> Result<()> {
    if prompt.is_none() && response.is_none() {
        return Ok(());
    }
    let conn = open_db(db_path)?;
    let prompt_blob = prompt.map(compress_payload).transpose()?;
    let response_blob = response.map(compress_payload).transpose()?;
    conn.execute(
        "INSERT INTO request_payloads (request_id, prompt, response)
         VALUES (?1, ?2, ?3)
         ON CONFLICT(request_id) DO UPDATE SET
           prompt = COALESCE(excluded.prompt, request_payloads.prompt),
           response = COALESCE(excluded.response, request_payloads.response)",
        params![request_id, prompt_blob, response_blob],
    )?;
    Ok(())
}

pub fn increment_daily_metrics(
    db_path: &Path,
    endpoint: &str,
    latency_ms: i64,
    usage: &UsageStats,
) -> Result<()> {
    let conn = open_db(db_path)?;
    let date = today_key();
    conn.execute(
        "INSERT INTO daily_metrics (
           date, endpoint, request_count, total_input_tokens, total_output_tokens,
           total_cached_tokens, total_cache_read_tokens, total_cache_creation_tokens, total_latency_ms
         ) VALUES (?1, ?2, 1, ?3, ?4, ?5, ?6, ?7, ?8)
         ON CONFLICT(date, endpoint) DO UPDATE SET
           request_count = daily_metrics.request_count + 1,
           total_input_tokens = daily_metrics.total_input_tokens + excluded.total_input_tokens,
           total_output_tokens = daily_metrics.total_output_tokens + excluded.total_output_tokens,
           total_cached_tokens = daily_metrics.total_cached_tokens + excluded.total_cached_tokens,
           total_cache_read_tokens = daily_metrics.total_cache_read_tokens + excluded.total_cache_read_tokens,
           total_cache_creation_tokens = daily_metrics.total_cache_creation_tokens + excluded.total_cache_creation_tokens,
           total_latency_ms = daily_metrics.total_latency_ms + excluded.total_latency_ms",
        params![
            date,
            endpoint,
            usage.input_tokens,
            usage.output_tokens,
            usage.cached_tokens,
            usage.cache_read_tokens,
            usage.cache_creation_tokens,
            latency_ms
        ],
    )?;
    Ok(())
}

fn build_log_filters(query: &LogQuery) -> (String, Vec<String>) {
    let mut conditions: Vec<String> = Vec::new();
    let mut params = Vec::new();

    if let Some(provider) = &query.provider {
        conditions.push("provider = ?".to_string());
        params.push(provider.clone());
    }
    if let Some(endpoint) = &query.endpoint {
        conditions.push("endpoint = ?".to_string());
        params.push(endpoint.clone());
    }
    if let Some(model) = &query.model {
        conditions.push("model = ?".to_string());
        params.push(model.clone());
    }
    if let Some(status) = &query.status {
        if status == "success" {
            conditions.push("error IS NULL".to_string());
        } else if status == "error" {
            conditions.push("error IS NOT NULL".to_string());
        }
    }
    if let Some(from) = query.from {
        conditions.push("timestamp >= ?".to_string());
        params.push(from.to_string());
    }
    if let Some(to) = query.to {
        conditions.push("timestamp <= ?".to_string());
        params.push(to.to_string());
    }
    if let Some(api_key_ids) = query
        .api_key_ids
        .as_ref()
        .filter(|values| !values.is_empty())
    {
        let placeholders = std::iter::repeat_n("?", api_key_ids.len())
            .collect::<Vec<_>>()
            .join(", ");
        conditions.push(format!("api_key_id IN ({placeholders})"));
        for api_key_id in api_key_ids {
            params.push(api_key_id.to_string());
        }
    }

    let where_clause = if conditions.is_empty() {
        String::new()
    } else {
        format!("WHERE {}", conditions.join(" AND "))
    };

    (where_clause, params)
}

fn bind_strings<'a>(
    mut stmt: rusqlite::Statement<'a>,
    string_params: &[String],
    limit: Option<i64>,
    offset: Option<i64>,
) -> Result<Vec<LogRecord>> {
    let mut values: Vec<rusqlite::types::Value> = string_params
        .iter()
        .cloned()
        .map(rusqlite::types::Value::from)
        .collect();
    if let Some(limit) = limit {
        values.push(rusqlite::types::Value::from(limit));
    }
    if let Some(offset) = offset {
        values.push(rusqlite::types::Value::from(offset));
    }

    let rows = stmt.query_map(rusqlite::params_from_iter(values.iter()), |row| {
        Ok(LogRecord {
            id: row.get(0)?,
            timestamp: row.get(1)?,
            session_id: row.get(2)?,
            endpoint: row.get(3)?,
            provider: row.get(4)?,
            model: row.get(5)?,
            client_model: row.get(6)?,
            stream: row.get::<_, i64>(7)? != 0,
            latency_ms: row.get(8)?,
            status_code: row.get(9)?,
            input_tokens: row.get(10)?,
            output_tokens: row.get(11)?,
            cached_tokens: row.get(12)?,
            cache_read_tokens: row.get(13)?,
            cache_creation_tokens: row.get(14)?,
            ttft_ms: row.get(15)?,
            tpot_ms: row.get(16)?,
            error: row.get(17)?,
            api_key_id: row.get(18)?,
            api_key_name: row.get(19)?,
            api_key_value: row.get(20)?,
        })
    })?;

    let mut items = Vec::new();
    for row in rows {
        items.push(row?);
    }
    Ok(items)
}

pub fn query_logs(db_path: &Path, query: &LogQuery) -> Result<LogListResult> {
    let conn = open_db(db_path)?;
    let limit = query.limit.clamp(1, 200);
    let offset = query.offset.max(0);
    let (where_clause, params) = build_log_filters(query);

    let count_sql = format!("SELECT COUNT(*) FROM request_logs {where_clause}");
    let total: i64 = conn.query_row(
        &count_sql,
        rusqlite::params_from_iter(params.iter()),
        |row| row.get(0),
    )?;

    let sql = format!(
        "SELECT id, timestamp, session_id, endpoint, provider, model, client_model,
                stream, latency_ms, status_code, input_tokens, output_tokens,
                cached_tokens, cache_read_tokens, cache_creation_tokens, ttft_ms, tpot_ms,
                error, api_key_id, api_key_name, api_key_value
         FROM request_logs
         {where_clause}
         ORDER BY timestamp DESC
         LIMIT ? OFFSET ?"
    );
    let stmt = conn.prepare(&sql)?;
    let items = bind_strings(stmt, &params, Some(limit), Some(offset))?;

    Ok(LogListResult { total, items })
}

pub fn get_log_detail(db_path: &Path, id: i64) -> Result<Option<LogDetail>> {
    let conn = open_db(db_path)?;
    let mut stmt = conn.prepare(
        "SELECT id, timestamp, session_id, endpoint, provider, model, client_model,
                stream, latency_ms, status_code, input_tokens, output_tokens,
                cached_tokens, cache_read_tokens, cache_creation_tokens, ttft_ms, tpot_ms,
                error, api_key_id, api_key_name, api_key_value
         FROM request_logs WHERE id = ?1",
    )?;
    let result: Option<LogRecord> = stmt
        .query_row(params![id], |row| {
            Ok(LogRecord {
                id: row.get(0)?,
                timestamp: row.get(1)?,
                session_id: row.get(2)?,
                endpoint: row.get(3)?,
                provider: row.get(4)?,
                model: row.get(5)?,
                client_model: row.get(6)?,
                stream: row.get::<_, i64>(7)? != 0,
                latency_ms: row.get(8)?,
                status_code: row.get(9)?,
                input_tokens: row.get(10)?,
                output_tokens: row.get(11)?,
                cached_tokens: row.get(12)?,
                cache_read_tokens: row.get(13)?,
                cache_creation_tokens: row.get(14)?,
                ttft_ms: row.get(15)?,
                tpot_ms: row.get(16)?,
                error: row.get(17)?,
                api_key_id: row.get(18)?,
                api_key_name: row.get(19)?,
                api_key_value: row.get(20)?,
            })
        })
        .optional()?;
    let Some(record) = result else {
        return Ok(None);
    };
    let payload = conn
        .query_row(
            "SELECT prompt, response FROM request_payloads WHERE request_id = ?1",
            params![id],
            |row| {
                Ok(LogPayload {
                    prompt: decompress_payload(row.get::<_, Option<Vec<u8>>>(0)?),
                    response: decompress_payload(row.get::<_, Option<Vec<u8>>>(1)?),
                })
            },
        )
        .optional()?;
    Ok(Some(LogDetail { record, payload }))
}

pub fn export_logs(db_path: &Path, query: &LogQuery) -> Result<Vec<ExportLogRecord>> {
    let conn = open_db(db_path)?;
    let limit = query.limit.clamp(1, 5000);
    let (where_clause, params) = build_log_filters(query);
    let sql = format!(
        "SELECT l.id, l.timestamp, l.session_id, l.endpoint, l.provider, l.model, l.client_model,
                l.stream, l.latency_ms, l.status_code, l.input_tokens, l.output_tokens,
                l.cached_tokens, l.cache_read_tokens, l.cache_creation_tokens, l.ttft_ms, l.tpot_ms,
                l.error, l.api_key_id, l.api_key_name, l.api_key_value,
                p.prompt, p.response
         FROM request_logs l
         LEFT JOIN request_payloads p ON p.request_id = l.id
         {where_clause}
         ORDER BY l.timestamp DESC
         LIMIT ?"
    );
    let mut stmt = conn.prepare(&sql)?;
    let mut values: Vec<rusqlite::types::Value> = params
        .iter()
        .cloned()
        .map(rusqlite::types::Value::from)
        .collect();
    values.push(limit.into());
    let rows = stmt.query_map(rusqlite::params_from_iter(values.iter()), |row| {
        Ok(ExportLogRecord {
            record: LogRecord {
                id: row.get(0)?,
                timestamp: row.get(1)?,
                session_id: row.get(2)?,
                endpoint: row.get(3)?,
                provider: row.get(4)?,
                model: row.get(5)?,
                client_model: row.get(6)?,
                stream: row.get::<_, i64>(7)? != 0,
                latency_ms: row.get(8)?,
                status_code: row.get(9)?,
                input_tokens: row.get(10)?,
                output_tokens: row.get(11)?,
                cached_tokens: row.get(12)?,
                cache_read_tokens: row.get(13)?,
                cache_creation_tokens: row.get(14)?,
                ttft_ms: row.get(15)?,
                tpot_ms: row.get(16)?,
                error: row.get(17)?,
                api_key_id: row.get(18)?,
                api_key_name: row.get(19)?,
                api_key_value: row.get(20)?,
            },
            payload: {
                let prompt = decompress_payload(row.get::<_, Option<Vec<u8>>>(21)?);
                let response = decompress_payload(row.get::<_, Option<Vec<u8>>>(22)?);
                if prompt.is_none() && response.is_none() {
                    None
                } else {
                    Some(LogPayload { prompt, response })
                }
            },
        })
    })?;
    let mut items = Vec::new();
    for row in rows {
        items.push(row?);
    }
    Ok(items)
}

fn metrics_section(
    conn: &Connection,
    sql: &str,
    params_slice: &[&dyn rusqlite::ToSql],
) -> Result<MetricsOverviewSection> {
    let row = conn.query_row(sql, params_slice, |row| {
        Ok((
            row.get::<_, i64>(0)?,
            row.get::<_, i64>(1)?,
            row.get::<_, i64>(2)?,
            row.get::<_, i64>(3)?,
            row.get::<_, i64>(4)?,
            row.get::<_, i64>(5)?,
            row.get::<_, i64>(6)?,
        ))
    })?;
    let avg_latency_ms = if row.0 > 0 { row.6 / row.0 } else { 0 };
    Ok(MetricsOverviewSection {
        requests: row.0,
        input_tokens: row.1,
        output_tokens: row.2,
        cached_tokens: row.3,
        cache_read_tokens: row.4,
        cache_creation_tokens: row.5,
        avg_latency_ms,
    })
}

pub fn get_metrics_overview(db_path: &Path, endpoint: Option<&str>) -> Result<MetricsOverview> {
    let conn = open_db(db_path)?;
    let totals_sql = format!(
        "SELECT
           COALESCE(SUM(request_count), 0),
           COALESCE(SUM(total_input_tokens), 0),
           COALESCE(SUM(total_output_tokens), 0),
           COALESCE(SUM(total_cached_tokens), 0),
           COALESCE(SUM(total_cache_read_tokens), 0),
           COALESCE(SUM(total_cache_creation_tokens), 0),
           COALESCE(SUM(total_latency_ms), 0)
         FROM daily_metrics {}",
        if endpoint.is_some() {
            "WHERE endpoint = ?1"
        } else {
            ""
        }
    );
    let totals = if let Some(endpoint) = endpoint {
        metrics_section(&conn, &totals_sql, &[&endpoint])?
    } else {
        metrics_section(&conn, &totals_sql, &[])?
    };

    let today = today_key();
    let today_sql = format!(
        "SELECT
           COALESCE(request_count, 0),
           COALESCE(total_input_tokens, 0),
           COALESCE(total_output_tokens, 0),
           COALESCE(total_cached_tokens, 0),
           COALESCE(total_cache_read_tokens, 0),
           COALESCE(total_cache_creation_tokens, 0),
           COALESCE(total_latency_ms, 0)
         FROM daily_metrics
         WHERE date = ?1 {}",
        if endpoint.is_some() {
            "AND endpoint = ?2"
        } else {
            ""
        }
    );
    let today_section = if let Some(endpoint) = endpoint {
        conn.query_row(&today_sql, params![today, endpoint], |row| {
            let requests: i64 = row.get(0)?;
            let total_latency: i64 = row.get(6)?;
            Ok(MetricsOverviewSection {
                requests,
                input_tokens: row.get(1)?,
                output_tokens: row.get(2)?,
                cached_tokens: row.get(3)?,
                cache_read_tokens: row.get(4)?,
                cache_creation_tokens: row.get(5)?,
                avg_latency_ms: if requests > 0 {
                    total_latency / requests
                } else {
                    0
                },
            })
        })
        .optional()?
        .unwrap_or(MetricsOverviewSection {
            requests: 0,
            input_tokens: 0,
            output_tokens: 0,
            cached_tokens: 0,
            cache_read_tokens: 0,
            cache_creation_tokens: 0,
            avg_latency_ms: 0,
        })
    } else {
        conn.query_row(&today_sql, params![today], |row| {
            let requests: i64 = row.get(0)?;
            let total_latency: i64 = row.get(6)?;
            Ok(MetricsOverviewSection {
                requests,
                input_tokens: row.get(1)?,
                output_tokens: row.get(2)?,
                cached_tokens: row.get(3)?,
                cache_read_tokens: row.get(4)?,
                cache_creation_tokens: row.get(5)?,
                avg_latency_ms: if requests > 0 {
                    total_latency / requests
                } else {
                    0
                },
            })
        })
        .optional()?
        .unwrap_or(MetricsOverviewSection {
            requests: 0,
            input_tokens: 0,
            output_tokens: 0,
            cached_tokens: 0,
            cache_read_tokens: 0,
            cache_creation_tokens: 0,
            avg_latency_ms: 0,
        })
    };

    Ok(MetricsOverview {
        totals,
        today: today_section,
    })
}

pub fn get_daily_metrics(
    db_path: &Path,
    days: i64,
    endpoint: Option<&str>,
) -> Result<Vec<DailyMetric>> {
    let conn = open_db(db_path)?;
    let sql = if endpoint.is_some() {
        "SELECT date, request_count, total_input_tokens, total_output_tokens,
                total_cached_tokens, total_cache_read_tokens, total_cache_creation_tokens, total_latency_ms
         FROM daily_metrics
         WHERE endpoint = ?1
         ORDER BY date DESC
         LIMIT ?2"
    } else {
        "SELECT date,
                SUM(request_count),
                SUM(total_input_tokens),
                SUM(total_output_tokens),
                SUM(total_cached_tokens),
                SUM(total_cache_read_tokens),
                SUM(total_cache_creation_tokens),
                SUM(total_latency_ms)
         FROM daily_metrics
         GROUP BY date
         ORDER BY date DESC
         LIMIT ?1"
    };
    let mut stmt = conn.prepare(sql)?;
    let mut rows = if let Some(endpoint) = endpoint {
        stmt.query(params![endpoint, days])?
    } else {
        stmt.query(params![days])?
    };
    let mut items = Vec::new();
    while let Some(row) = rows.next()? {
        let request_count: i64 = row.get(1)?;
        let total_latency: i64 = row.get(7)?;
        items.push(DailyMetric {
            date: row.get(0)?,
            request_count,
            input_tokens: row.get(2)?,
            output_tokens: row.get(3)?,
            cached_tokens: row.get(4)?,
            cache_read_tokens: row.get(5)?,
            cache_creation_tokens: row.get(6)?,
            avg_latency_ms: if request_count > 0 {
                total_latency / request_count
            } else {
                0
            },
        });
    }
    items.reverse();
    Ok(items)
}

pub fn get_model_usage_metrics(
    db_path: &Path,
    days: i64,
    limit: i64,
    endpoint: Option<&str>,
) -> Result<Vec<ModelUsageMetric>> {
    let conn = open_db(db_path)?;
    let since = chrono::Utc::now().timestamp_millis() - days * 24 * 60 * 60 * 1000;
    let sql = if endpoint.is_some() {
        "SELECT model, provider, COUNT(*), COALESCE(SUM(input_tokens), 0), COALESCE(SUM(output_tokens), 0),
                COALESCE(SUM(latency_ms), 0), AVG(ttft_ms), AVG(tpot_ms)
         FROM request_logs
         WHERE timestamp >= ?1 AND endpoint = ?2
         GROUP BY provider, model
         ORDER BY COUNT(*) DESC
         LIMIT ?3"
    } else {
        "SELECT model, provider, COUNT(*), COALESCE(SUM(input_tokens), 0), COALESCE(SUM(output_tokens), 0),
                COALESCE(SUM(latency_ms), 0), AVG(ttft_ms), AVG(tpot_ms)
         FROM request_logs
         WHERE timestamp >= ?1
         GROUP BY provider, model
         ORDER BY COUNT(*) DESC
         LIMIT ?2"
    };
    let mut stmt = conn.prepare(sql)?;
    let mut rows = if let Some(endpoint) = endpoint {
        stmt.query(params![since, endpoint, limit])?
    } else {
        stmt.query(params![since, limit])?
    };
    let mut items = Vec::new();
    while let Some(row) = rows.next()? {
        let requests: i64 = row.get(2)?;
        let total_latency: i64 = row.get(5)?;
        items.push(ModelUsageMetric {
            model: row.get(0)?,
            provider: row.get(1)?,
            requests,
            input_tokens: row.get(3)?,
            output_tokens: row.get(4)?,
            avg_latency_ms: if requests > 0 {
                total_latency / requests
            } else {
                0
            },
            avg_ttft_ms: row.get(6)?,
            avg_tpot_ms: row.get(7)?,
        });
    }
    Ok(items)
}

pub fn get_database_info(db_path: &Path) -> Result<DatabaseInfo> {
    let conn = open_db(db_path)?;
    let (page_count, page_size, freelist_pages): (i64, i64, i64) = conn.query_row(
        "SELECT
           (SELECT page_count FROM pragma_page_count),
           (SELECT page_size FROM pragma_page_size),
           (SELECT freelist_count FROM pragma_freelist_count)",
        [],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
    )?;
    let main_bytes = fs::metadata(db_path)
        .map(|meta| meta.len() as i64)
        .unwrap_or(0);
    let wal_bytes = fs::metadata(format!("{}-wal", db_path.display()))
        .map(|meta| meta.len() as i64)
        .unwrap_or(0);
    Ok(DatabaseInfo {
        page_count,
        page_size,
        freelist_pages,
        size_bytes: page_count * page_size,
        file_size_bytes: main_bytes,
        wal_size_bytes: wal_bytes,
        total_bytes: main_bytes + wal_bytes,
        memory_rss_bytes: current_process_memory_rss_bytes(),
    })
}

pub fn get_recent_client_activity(
    db_path: &Path,
    since: i64,
    endpoint: Option<&str>,
) -> Result<ClientActivityMetrics> {
    let conn = open_db(db_path)?;
    let (unique_source_ips, unique_session_ids): (i64, i64) = if let Some(endpoint) = endpoint {
        conn.query_row(
            "SELECT
               COUNT(DISTINCT NULLIF(TRIM(source_ip), '')),
               COUNT(DISTINCT NULLIF(TRIM(session_id), ''))
             FROM request_logs
             WHERE timestamp >= ?1 AND endpoint = ?2",
            params![since, endpoint],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )?
    } else {
        conn.query_row(
            "SELECT
               COUNT(DISTINCT NULLIF(TRIM(source_ip), '')),
               COUNT(DISTINCT NULLIF(TRIM(session_id), ''))
             FROM request_logs
             WHERE timestamp >= ?1",
            params![since],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )?
    };
    Ok(ClientActivityMetrics {
        unique_source_ips,
        unique_session_ids,
    })
}

pub fn compact_database(db_path: &Path) -> Result<()> {
    let conn = open_db(db_path)?;
    conn.execute_batch("VACUUM;")?;
    Ok(())
}

pub fn cleanup_logs_before(db_path: &Path, timestamp: i64) -> Result<i64> {
    let conn = open_db(db_path)?;
    let deleted = conn.execute(
        "DELETE FROM request_logs WHERE timestamp < ?1",
        params![timestamp],
    )?;
    Ok(deleted as i64)
}

pub fn clear_all_logs(db_path: &Path) -> Result<(i64, i64)> {
    let conn = open_db(db_path)?;
    let deleted_logs = conn.execute("DELETE FROM request_logs", [])?;
    let deleted_metrics = conn.execute("DELETE FROM daily_metrics", [])?;
    Ok((deleted_logs as i64, deleted_metrics as i64))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::initialize_database;

    #[test]
    fn recent_client_activity_counts_distinct_ips_and_sessions() {
        let root = std::env::temp_dir().join(format!(
            "cc-gw2-observability-tests-{}",
            chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default()
        ));
        std::fs::create_dir_all(&root).expect("create temp root");
        let db_path = root.join("gateway.db");
        initialize_database(&db_path).expect("init database");

        let now = chrono::Utc::now().timestamp_millis();
        for (session_id, source_ip, timestamp) in [
            (Some("session-a".to_string()), Some("10.0.0.1".to_string()), now),
            (Some("session-a".to_string()), Some("10.0.0.1".to_string()), now - 1000),
            (Some("session-b".to_string()), Some("10.0.0.2".to_string()), now - 2000),
            (None, Some("10.0.0.3".to_string()), now - 3000),
            (Some("stale-session".to_string()), Some("10.0.0.9".to_string()), now - 2 * 60 * 60 * 1000),
        ] {
            insert_request_log(
                &db_path,
                &RequestLogInput {
                    timestamp,
                    session_id,
                    source_ip,
                    endpoint: "anthropic".to_string(),
                    provider: "mock".to_string(),
                    model: "mock-model".to_string(),
                    client_model: None,
                    stream: false,
                    api_key_id: None,
                    api_key_name: None,
                    api_key_value: None,
                },
            )
            .expect("insert request log");
        }

        let metrics = get_recent_client_activity(&db_path, now - 60 * 60 * 1000, None)
            .expect("query client activity");
        assert_eq!(metrics.unique_source_ips, 3);
        assert_eq!(metrics.unique_session_ids, 2);

        let _ = std::fs::remove_dir_all(root);
    }
}
