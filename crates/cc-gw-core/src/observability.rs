use std::collections::HashMap;
use std::fs;
use std::io::{Read, Write};
use std::path::Path;
use std::time::Instant;

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
    pub error_source: Option<String>,
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
    pub error_source: Option<String>,
    pub api_key_id: Option<i64>,
    pub api_key_name: Option<String>,
    pub api_key_value: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct LogListResult {
    pub total: i64,
    pub items: Vec<LogRecord>,
}

/// Strip the encrypted `api_key_value` from a serialized log record, replacing
/// it with a decrypted `api_key_value_masked` preview + `api_key_value_available`
/// flag. Applied everywhere log records leave the server so the AES ciphertext
/// is never shipped to clients (only a masked preview when it can be decrypted).
pub fn mask_log_record_api_key(value: &mut serde_json::Value, home_dir: &std::path::Path) {
    let Some(object) = value.as_object_mut() else {
        return;
    };
    let decrypted = object
        .get("api_key_value")
        .and_then(serde_json::Value::as_str)
        .and_then(|value| crate::api_keys::decrypt_log_api_key_value(home_dir, Some(value)));
    object.insert(
        "api_key_value_available".to_string(),
        serde_json::Value::Bool(decrypted.is_some()),
    );
    object.insert(
        "api_key_value_masked".to_string(),
        decrypted
            .map(|value| serde_json::Value::String(crate::api_keys::mask_revealed_key(&value)))
            .unwrap_or(serde_json::Value::Null),
    );
    object.insert("api_key_value".to_string(), serde_json::Value::Null);
}

#[derive(Debug, Serialize)]
pub struct LogPayload {
    pub client_request: Option<String>,
    pub upstream_request: Option<String>,
    pub upstream_response: Option<String>,
    pub client_response: Option<String>,
}

#[derive(Debug, Clone, Default)]
pub struct LogPayloadUpdate<'a> {
    pub client_request: Option<&'a str>,
    pub upstream_request: Option<&'a str>,
    pub upstream_response: Option<&'a str>,
    pub client_response: Option<&'a str>,
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
    pub error_count: i64,
}

#[derive(Debug, Serialize)]
pub struct MetricsOverview {
    pub totals: MetricsOverviewSection,
    pub today: MetricsOverviewSection,
    /// Previous local day; drives the today-card delta pills (vs yesterday).
    pub yesterday: MetricsOverviewSection,
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

pub struct RuntimeMetricsSampler {
    pid: Pid,
    system: System,
    cpu_count: f32,
    bandwidth_samples: HashMap<String, RuntimeBandwidthSample>,
}

struct RuntimeBandwidthSample {
    captured_at: Instant,
    ingress_bytes: u64,
    egress_bytes: u64,
}

#[derive(Debug, Serialize, Clone, Copy, Default)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeBandwidthMetrics {
    pub ingress_bytes_per_second: f64,
    pub egress_bytes_per_second: f64,
}

impl RuntimeMetricsSampler {
    pub fn new() -> Self {
        let pid = Pid::from_u32(std::process::id());
        let refresh =
            RefreshKind::nothing().with_processes(ProcessRefreshKind::nothing().with_cpu());
        let system = System::new_with_specifics(refresh);
        let cpu_count = std::thread::available_parallelism()
            .map(|count| count.get() as f32)
            .unwrap_or(1.0);

        Self {
            pid,
            system,
            cpu_count,
            bandwidth_samples: HashMap::new(),
        }
    }

    pub fn current_process_cpu_usage_percent(&mut self) -> Option<f64> {
        self.system.refresh_processes_specifics(
            ProcessesToUpdate::Some(&[self.pid]),
            false,
            ProcessRefreshKind::nothing().with_cpu(),
        );

        self.system.process(self.pid).map(|process| {
            let normalized = process.cpu_usage() / self.cpu_count.max(1.0);
            normalized.clamp(0.0, 100.0) as f64
        })
    }

    pub fn current_bandwidth_metrics(
        &mut self,
        key: &str,
        ingress_bytes: u64,
        egress_bytes: u64,
    ) -> RuntimeBandwidthMetrics {
        let now = Instant::now();
        let previous = self.bandwidth_samples.insert(
            key.to_string(),
            RuntimeBandwidthSample {
                captured_at: now,
                ingress_bytes,
                egress_bytes,
            },
        );

        let Some(previous) = previous else {
            return RuntimeBandwidthMetrics::default();
        };

        let elapsed = now
            .saturating_duration_since(previous.captured_at)
            .as_secs_f64();
        if elapsed <= f64::EPSILON {
            return RuntimeBandwidthMetrics::default();
        }

        RuntimeBandwidthMetrics {
            ingress_bytes_per_second: ingress_bytes.saturating_sub(previous.ingress_bytes) as f64
                / elapsed,
            egress_bytes_per_second: egress_bytes.saturating_sub(previous.egress_bytes) as f64
                / elapsed,
        }
    }
}

#[derive(Debug, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ClientActivityMetrics {
    pub unique_source_ips: i64,
    pub unique_session_ids: i64,
}

#[derive(Debug, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RecentThroughputMetrics {
    pub requests_per_minute: i64,
    pub output_tokens_per_minute: i64,
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
    let conn = Connection::open(db_path)
        .with_context(|| format!("failed to open db {}", db_path.display()))?;
    // Raise rusqlite's default 5s busy_timeout so concurrent proxy writes aren't
    // SQLITE_BUSY'd (and then silently dropped) while an admin VACUUM / log
    // cleanup holds the write lock for tens of seconds.
    conn.busy_timeout(std::time::Duration::from_secs(30))
        .with_context(|| format!("failed to set busy_timeout for db {}", db_path.display()))?;
    Ok(conn)
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

fn local_datetime_millis(value: chrono::NaiveDateTime) -> i64 {
    match value.and_local_timezone(chrono::Local) {
        chrono::LocalResult::Single(value) => value.timestamp_millis(),
        chrono::LocalResult::Ambiguous(earliest, _) => earliest.timestamp_millis(),
        chrono::LocalResult::None => value.and_utc().timestamp_millis(),
    }
}

fn local_day_bounds_millis(date: chrono::NaiveDate) -> (i64, i64) {
    let start = date
        .and_hms_opt(0, 0, 0)
        .expect("midnight is a valid local time");
    let next_start = date
        .succ_opt()
        .expect("local date has a next day")
        .and_hms_opt(0, 0, 0)
        .expect("midnight is a valid local time");
    (
        local_datetime_millis(start),
        local_datetime_millis(next_start),
    )
}

fn local_today_bounds_millis() -> (i64, i64) {
    local_day_bounds_millis(chrono::Local::now().date_naive())
}

fn local_daily_range_start_millis(days: i64) -> i64 {
    let days = days.max(1) as u64;
    let today = chrono::Local::now().date_naive();
    let start_date = today
        .checked_sub_days(chrono::Days::new(days.saturating_sub(1)))
        .unwrap_or(today);
    local_day_bounds_millis(start_date).0
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
             error = ?11,
             error_source = ?12
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
            update.error,
            update.error_source
        ],
    )?;
    Ok(())
}

/// Finalize request logs left "in progress" by a previous process that exited
/// before it could finalize them. Returns the number of rows updated.
pub fn finalize_stale_request_logs(db_path: &Path) -> Result<u64> {
    let conn = open_db(db_path)?;
    let updated = conn.execute(
        "UPDATE request_logs
         SET status_code = 499,
             error = 'gateway restarted before request completed',
             error_source = 'gateway'
         WHERE status_code IS NULL",
        [],
    )?;
    Ok(updated as u64)
}

pub fn upsert_request_payload(
    db_path: &Path,
    request_id: i64,
    payload: &LogPayloadUpdate<'_>,
) -> Result<()> {
    if payload.client_request.is_none()
        && payload.upstream_request.is_none()
        && payload.upstream_response.is_none()
        && payload.client_response.is_none()
    {
        return Ok(());
    }
    let conn = open_db(db_path)?;
    let client_request_blob = payload.client_request.map(compress_payload).transpose()?;
    let upstream_request_blob = payload.upstream_request.map(compress_payload).transpose()?;
    let upstream_response_blob = payload
        .upstream_response
        .map(compress_payload)
        .transpose()?;
    let client_response_blob = payload.client_response.map(compress_payload).transpose()?;
    conn.execute(
        "INSERT INTO request_payloads (
           request_id, client_request, upstream_request, upstream_response, client_response
         )
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(request_id) DO UPDATE SET
           client_request = COALESCE(excluded.client_request, request_payloads.client_request),
           upstream_request = COALESCE(excluded.upstream_request, request_payloads.upstream_request),
           upstream_response = COALESCE(excluded.upstream_response, request_payloads.upstream_response),
           client_response = COALESCE(excluded.client_response, request_payloads.client_response)",
        params![
            request_id,
            client_request_blob,
            upstream_request_blob,
            upstream_response_blob,
            client_response_blob
        ],
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
            conditions.push("status_code IS NOT NULL".to_string());
            conditions.push("status_code < 400".to_string());
            conditions.push("error IS NULL".to_string());
        } else if status == "error" {
            conditions.push("(error IS NOT NULL OR status_code >= 400)".to_string());
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
            error_source: row.get(18)?,
            api_key_id: row.get(19)?,
            api_key_name: row.get(20)?,
            api_key_value: row.get(21)?,
        })
    })?;

    let mut items = Vec::new();
    for row in rows {
        items.push(row?);
    }
    Ok(items)
}

fn build_log_payload(
    legacy_prompt: Option<Vec<u8>>,
    legacy_response: Option<Vec<u8>>,
    client_request: Option<Vec<u8>>,
    upstream_request: Option<Vec<u8>>,
    upstream_response: Option<Vec<u8>>,
    client_response: Option<Vec<u8>>,
) -> Option<LogPayload> {
    let client_request =
        decompress_payload(client_request).or_else(|| decompress_payload(legacy_prompt));
    let client_response =
        decompress_payload(client_response).or_else(|| decompress_payload(legacy_response));
    let upstream_request = decompress_payload(upstream_request);
    let upstream_response = decompress_payload(upstream_response);

    if client_request.is_none()
        && upstream_request.is_none()
        && upstream_response.is_none()
        && client_response.is_none()
    {
        None
    } else {
        Some(LogPayload {
            client_request,
            upstream_request,
            upstream_response,
            client_response,
        })
    }
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
                error, error_source, api_key_id, api_key_name, api_key_value
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
                error, error_source, api_key_id, api_key_name, api_key_value
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
                error_source: row.get(18)?,
                api_key_id: row.get(19)?,
                api_key_name: row.get(20)?,
                api_key_value: row.get(21)?,
            })
        })
        .optional()?;
    let Some(record) = result else {
        return Ok(None);
    };
    let payload = conn
        .query_row(
            "SELECT prompt, response, client_request, upstream_request, upstream_response, client_response
             FROM request_payloads WHERE request_id = ?1",
            params![id],
            |row| {
                Ok(build_log_payload(
                    row.get::<_, Option<Vec<u8>>>(0)?,
                    row.get::<_, Option<Vec<u8>>>(1)?,
                    row.get::<_, Option<Vec<u8>>>(2)?,
                    row.get::<_, Option<Vec<u8>>>(3)?,
                    row.get::<_, Option<Vec<u8>>>(4)?,
                    row.get::<_, Option<Vec<u8>>>(5)?,
                ))
            },
        )
        .optional()?;
    Ok(Some(LogDetail {
        record,
        payload: payload.flatten(),
    }))
}

pub fn export_logs(db_path: &Path, query: &LogQuery) -> Result<Vec<ExportLogRecord>> {
    let conn = open_db(db_path)?;
    let limit = query.limit.clamp(1, 5000);
    let (where_clause, params) = build_log_filters(query);
    let sql = format!(
        "SELECT l.id, l.timestamp, l.session_id, l.endpoint, l.provider, l.model, l.client_model,
                l.stream, l.latency_ms, l.status_code, l.input_tokens, l.output_tokens,
                l.cached_tokens, l.cache_read_tokens, l.cache_creation_tokens, l.ttft_ms, l.tpot_ms,
                l.error, l.error_source, l.api_key_id, l.api_key_name, l.api_key_value,
                p.prompt, p.response, p.client_request, p.upstream_request, p.upstream_response, p.client_response
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
                error_source: row.get(18)?,
                api_key_id: row.get(19)?,
                api_key_name: row.get(20)?,
                api_key_value: row.get(21)?,
            },
            payload: build_log_payload(
                row.get::<_, Option<Vec<u8>>>(22)?,
                row.get::<_, Option<Vec<u8>>>(23)?,
                row.get::<_, Option<Vec<u8>>>(24)?,
                row.get::<_, Option<Vec<u8>>>(25)?,
                row.get::<_, Option<Vec<u8>>>(26)?,
                row.get::<_, Option<Vec<u8>>>(27)?,
            ),
        })
    })?;
    let mut items = Vec::new();
    for row in rows {
        items.push(row?);
    }
    Ok(items)
}

fn request_log_metrics_section(
    conn: &Connection,
    range: Option<(i64, i64)>,
    endpoint: Option<&str>,
) -> Result<MetricsOverviewSection> {
    let select = "SELECT
       COUNT(*),
       COALESCE(SUM(COALESCE(input_tokens, 0)), 0),
       COALESCE(SUM(COALESCE(output_tokens, 0)), 0),
       COALESCE(SUM(COALESCE(cached_tokens, 0)), 0),
       COALESCE(SUM(COALESCE(cache_read_tokens, 0)), 0),
       COALESCE(SUM(COALESCE(cache_creation_tokens, 0)), 0),
       COALESCE(SUM(COALESCE(latency_ms, 0)), 0),
       COUNT(latency_ms),
       COALESCE(SUM(CASE WHEN (error IS NOT NULL OR status_code >= 400) THEN 1 ELSE 0 END), 0)
     FROM request_logs";
    let map_row = |row: &rusqlite::Row<'_>| {
        Ok((
            row.get::<_, i64>(0)?,
            row.get::<_, i64>(1)?,
            row.get::<_, i64>(2)?,
            row.get::<_, i64>(3)?,
            row.get::<_, i64>(4)?,
            row.get::<_, i64>(5)?,
            row.get::<_, i64>(6)?,
            row.get::<_, i64>(7)?,
            row.get::<_, i64>(8)?,
        ))
    };
    let row = match (range, endpoint) {
        (Some((since, until)), Some(endpoint)) => conn.query_row(
            &format!("{select} WHERE timestamp >= ?1 AND timestamp < ?2 AND endpoint = ?3"),
            params![since, until, endpoint],
            map_row,
        )?,
        (Some((since, until)), None) => conn.query_row(
            &format!("{select} WHERE timestamp >= ?1 AND timestamp < ?2"),
            params![since, until],
            map_row,
        )?,
        (None, Some(endpoint)) => conn.query_row(
            &format!("{select} WHERE endpoint = ?1"),
            params![endpoint],
            map_row,
        )?,
        (None, None) => conn.query_row(select, [], map_row)?,
    };
    Ok(MetricsOverviewSection {
        requests: row.0,
        input_tokens: row.1,
        output_tokens: row.2,
        cached_tokens: row.3,
        cache_read_tokens: row.4,
        cache_creation_tokens: row.5,
        avg_latency_ms: if row.7 > 0 { row.6 / row.7 } else { 0 },
        error_count: row.8,
    })
}

pub fn get_metrics_overview(db_path: &Path, endpoint: Option<&str>) -> Result<MetricsOverview> {
    let conn = open_db(db_path)?;
    let totals = request_log_metrics_section(&conn, None, endpoint)?;
    let (today_start, tomorrow_start) = local_today_bounds_millis();
    let today_section =
        request_log_metrics_section(&conn, Some((today_start, tomorrow_start)), endpoint)?;
    // Yesterday = the prior local calendar day, computed DST-aware. A naive
    // `today_start - 86_400_000` drifts by ~1h around DST transitions (days can
    // be 23 or 25h); `local_day_bounds_millis` resolves midnight in local time,
    // so `(yesterday_start, today_start)` is exactly the prior day.
    let today = chrono::Local::now().date_naive();
    let yesterday = today.pred_opt().unwrap_or(today);
    let (yesterday_start, _) = local_day_bounds_millis(yesterday);
    let yesterday_section =
        request_log_metrics_section(&conn, Some((yesterday_start, today_start)), endpoint)?;

    Ok(MetricsOverview {
        totals,
        today: today_section,
        yesterday: yesterday_section,
    })
}

pub fn get_daily_metrics(
    db_path: &Path,
    days: i64,
    endpoint: Option<&str>,
) -> Result<Vec<DailyMetric>> {
    let conn = open_db(db_path)?;
    let since = local_daily_range_start_millis(days);
    let sql = if endpoint.is_some() {
        "SELECT
           strftime('%Y-%m-%d', timestamp / 1000, 'unixepoch', 'localtime') AS date,
           COUNT(*),
           COALESCE(SUM(COALESCE(input_tokens, 0)), 0),
           COALESCE(SUM(COALESCE(output_tokens, 0)), 0),
           COALESCE(SUM(COALESCE(cached_tokens, 0)), 0),
           COALESCE(SUM(COALESCE(cache_read_tokens, 0)), 0),
           COALESCE(SUM(COALESCE(cache_creation_tokens, 0)), 0),
           COALESCE(SUM(COALESCE(latency_ms, 0)), 0),
           COUNT(latency_ms)
         FROM request_logs
         WHERE timestamp >= ?1 AND endpoint = ?2
         GROUP BY date
         ORDER BY date DESC
         LIMIT ?3"
    } else {
        "SELECT
           strftime('%Y-%m-%d', timestamp / 1000, 'unixepoch', 'localtime') AS date,
           COUNT(*),
           COALESCE(SUM(COALESCE(input_tokens, 0)), 0),
           COALESCE(SUM(COALESCE(output_tokens, 0)), 0),
           COALESCE(SUM(COALESCE(cached_tokens, 0)), 0),
           COALESCE(SUM(COALESCE(cache_read_tokens, 0)), 0),
           COALESCE(SUM(COALESCE(cache_creation_tokens, 0)), 0),
           COALESCE(SUM(COALESCE(latency_ms, 0)), 0),
           COUNT(latency_ms)
         FROM request_logs
         WHERE timestamp >= ?1
         GROUP BY date
         ORDER BY date DESC
         LIMIT ?2"
    };
    let mut stmt = conn.prepare(sql)?;
    let mut rows = if let Some(endpoint) = endpoint {
        stmt.query(params![since, endpoint, days])?
    } else {
        stmt.query(params![since, days])?
    };
    let mut items = Vec::new();
    while let Some(row) = rows.next()? {
        let request_count: i64 = row.get(1)?;
        let total_latency: i64 = row.get(7)?;
        let latency_count: i64 = row.get(8)?;
        items.push(DailyMetric {
            date: row.get(0)?,
            request_count,
            input_tokens: row.get(2)?,
            output_tokens: row.get(3)?,
            cached_tokens: row.get(4)?,
            cache_read_tokens: row.get(5)?,
            cache_creation_tokens: row.get(6)?,
            avg_latency_ms: if latency_count > 0 {
                total_latency / latency_count
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

pub fn get_recent_throughput_metrics(
    db_path: &Path,
    since: i64,
    endpoint: Option<&str>,
) -> Result<RecentThroughputMetrics> {
    let conn = open_db(db_path)?;
    let (requests_per_minute, output_tokens_per_minute): (i64, i64) =
        if let Some(endpoint) = endpoint {
            conn.query_row(
                "SELECT
                   COUNT(*),
                   COALESCE(SUM(COALESCE(output_tokens, 0)), 0)
                 FROM request_logs
                 WHERE timestamp >= ?1 AND endpoint = ?2",
                params![since, endpoint],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )?
        } else {
            conn.query_row(
                "SELECT
                   COUNT(*),
                   COALESCE(SUM(COALESCE(output_tokens, 0)), 0)
                 FROM request_logs
                 WHERE timestamp >= ?1",
                params![since],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )?
        };

    Ok(RecentThroughputMetrics {
        requests_per_minute,
        output_tokens_per_minute,
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
            (
                Some("session-a".to_string()),
                Some("10.0.0.1".to_string()),
                now,
            ),
            (
                Some("session-a".to_string()),
                Some("10.0.0.1".to_string()),
                now - 1000,
            ),
            (
                Some("session-b".to_string()),
                Some("10.0.0.2".to_string()),
                now - 2000,
            ),
            (None, Some("10.0.0.3".to_string()), now - 3000),
            (
                Some("stale-session".to_string()),
                Some("10.0.0.9".to_string()),
                now - 2 * 60 * 60 * 1000,
            ),
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

    #[test]
    fn metrics_overview_today_uses_local_request_logs() {
        let root = std::env::temp_dir().join(format!(
            "cc-gw2-observability-metrics-tests-{}",
            chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default()
        ));
        std::fs::create_dir_all(&root).expect("create temp root");
        let db_path = root.join("gateway.db");
        initialize_database(&db_path).expect("init database");

        // Seed a stale aggregate that should not affect the live "today" section.
        increment_daily_metrics(
            &db_path,
            "anthropic",
            999,
            &UsageStats {
                input_tokens: 999,
                output_tokens: 999,
                ..UsageStats::default()
            },
        )
        .expect("increment stale metrics");

        let now = chrono::Utc::now().timestamp_millis();
        let anthropic_id = insert_request_log(
            &db_path,
            &RequestLogInput {
                timestamp: now,
                session_id: None,
                source_ip: None,
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
        .expect("insert anthropic request log");
        finalize_request_log(
            &db_path,
            anthropic_id,
            &RequestLogUpdate {
                latency_ms: Some(120),
                status_code: Some(200),
                input_tokens: Some(10),
                output_tokens: Some(5),
                cached_tokens: Some(3),
                cache_read_tokens: Some(3),
                cache_creation_tokens: Some(1),
                ..RequestLogUpdate::default()
            },
        )
        .expect("finalize anthropic request log");

        let openai_id = insert_request_log(
            &db_path,
            &RequestLogInput {
                timestamp: now,
                session_id: None,
                source_ip: None,
                endpoint: "openai".to_string(),
                provider: "mock".to_string(),
                model: "mock-model".to_string(),
                client_model: None,
                stream: false,
                api_key_id: None,
                api_key_name: None,
                api_key_value: None,
            },
        )
        .expect("insert openai request log");
        finalize_request_log(
            &db_path,
            openai_id,
            &RequestLogUpdate {
                latency_ms: Some(80),
                status_code: Some(200),
                input_tokens: Some(6),
                output_tokens: Some(4),
                cached_tokens: Some(4),
                cache_read_tokens: Some(4),
                cache_creation_tokens: Some(2),
                ..RequestLogUpdate::default()
            },
        )
        .expect("finalize openai request log");

        insert_request_log(
            &db_path,
            &RequestLogInput {
                timestamp: now,
                session_id: None,
                source_ip: None,
                endpoint: "openai".to_string(),
                provider: "mock".to_string(),
                model: "pending-model".to_string(),
                client_model: None,
                stream: true,
                api_key_id: None,
                api_key_name: None,
                api_key_value: None,
            },
        )
        .expect("insert pending openai request log");

        let overview = get_metrics_overview(&db_path, None).expect("query overview");
        assert_eq!(overview.totals.requests, 3);
        assert_eq!(overview.totals.input_tokens, 16);
        assert_eq!(overview.totals.output_tokens, 9);
        assert_eq!(overview.totals.avg_latency_ms, 100);
        assert_eq!(overview.today.requests, 3);
        assert_eq!(overview.today.input_tokens, 16);
        assert_eq!(overview.today.output_tokens, 9);
        assert_eq!(overview.today.cached_tokens, 7);
        assert_eq!(overview.today.cache_read_tokens, 7);
        assert_eq!(overview.today.cache_creation_tokens, 3);
        assert_eq!(overview.today.avg_latency_ms, 100);

        let openai = get_metrics_overview(&db_path, Some("openai")).expect("query openai overview");
        assert_eq!(openai.totals.requests, 2);
        assert_eq!(openai.today.requests, 2);
        assert_eq!(openai.today.input_tokens, 6);
        assert_eq!(openai.today.output_tokens, 4);
        assert_eq!(openai.today.avg_latency_ms, 80);

        let today_date = chrono::Local::now().format("%Y-%m-%d").to_string();
        let daily = get_daily_metrics(&db_path, 14, None).expect("query daily metrics");
        assert_eq!(daily.len(), 1);
        assert_eq!(daily[0].date, today_date);
        assert_eq!(daily[0].request_count, 3);
        assert_eq!(daily[0].input_tokens, 16);
        assert_eq!(daily[0].output_tokens, 9);
        assert_eq!(daily[0].avg_latency_ms, 100);

        let openai_daily =
            get_daily_metrics(&db_path, 14, Some("openai")).expect("query openai daily metrics");
        assert_eq!(openai_daily.len(), 1);
        assert_eq!(openai_daily[0].request_count, 2);
        assert_eq!(openai_daily[0].input_tokens, 6);
        assert_eq!(openai_daily[0].output_tokens, 4);
        assert_eq!(openai_daily[0].avg_latency_ms, 80);

        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn metrics_overview_yesterday_section_respects_local_day_boundary() {
        let root = std::env::temp_dir().join(format!(
            "cc-gw2-observability-yesterday-tests-{}",
            chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default()
        ));
        std::fs::create_dir_all(&root).expect("create temp root");
        let db_path = root.join("gateway.db");
        initialize_database(&db_path).expect("init database");

        // Use the DST-aware day bounds (the same helper the production query uses)
        // instead of a naive 24h subtraction, then plant rows at every boundary.
        let today = chrono::Local::now().date_naive();
        let yesterday = today.pred_opt().unwrap_or(today);
        let (yesterday_start, today_start) = local_day_bounds_millis(yesterday);
        let (_, tomorrow_start) = local_day_bounds_millis(today);

        // (timestamp, endpoint): each boundary verifies a different inclusion rule.
        for (timestamp, endpoint) in [
            (yesterday_start - 1, "anthropic"), // day before yesterday → excluded from yesterday & today
            (yesterday_start, "anthropic"),     // start of yesterday → counts in yesterday
            (today_start - 1, "openai"),        // last ms of yesterday → counts in yesterday
            (today_start, "openai"),            // start of today → counts in today
            (tomorrow_start - 1, "openai"),     // last ms of today → counts in today
        ] {
            let request_id = insert_request_log(
                &db_path,
                &RequestLogInput {
                    timestamp,
                    session_id: None,
                    source_ip: None,
                    endpoint: endpoint.to_string(),
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
            finalize_request_log(
                &db_path,
                request_id,
                &RequestLogUpdate {
                    latency_ms: Some(100),
                    status_code: Some(200),
                    input_tokens: Some(10),
                    output_tokens: Some(5),
                    ..RequestLogUpdate::default()
                },
            )
            .expect("finalize request log");
        }

        let overview = get_metrics_overview(&db_path, None).expect("query overview");
        // yesterday window = [yesterday_start, today_start) → 2 rows.
        assert_eq!(overview.yesterday.requests, 2);
        assert_eq!(overview.yesterday.input_tokens, 20);
        assert_eq!(overview.yesterday.avg_latency_ms, 100);
        // today window = [today_start, tomorrow_start) → 2 rows.
        assert_eq!(overview.today.requests, 2);
        // totals = all 5 rows.
        assert_eq!(overview.totals.requests, 5);

        // Endpoint filter keeps yesterday scoped to that endpoint.
        let anthropic = get_metrics_overview(&db_path, Some("anthropic")).expect("query anthropic");
        // anthropic yesterday rows: only the one at yesterday_start
        // (the yesterday_start-1 row is anthropic but falls before yesterday).
        assert_eq!(anthropic.yesterday.requests, 1);
        assert_eq!(anthropic.today.requests, 0);
        assert_eq!(anthropic.totals.requests, 2);

        let openai = get_metrics_overview(&db_path, Some("openai")).expect("query openai");
        // openai yesterday: today_start-1 only; openai today: today_start + tomorrow_start-1.
        assert_eq!(openai.yesterday.requests, 1);
        assert_eq!(openai.today.requests, 2);
        assert_eq!(openai.totals.requests, 3);

        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn metrics_overview_error_count_counts_failures_and_skips_pending() {
        let root = std::env::temp_dir().join(format!(
            "cc-gw2-observability-error-count-tests-{}",
            chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default()
        ));
        std::fs::create_dir_all(&root).expect("create temp root");
        let db_path = root.join("gateway.db");
        initialize_database(&db_path).expect("init database");

        let now = chrono::Utc::now().timestamp_millis();

        // success — status 200, no error → not counted as an error
        let ok_id = insert_request_log(
            &db_path,
            &RequestLogInput {
                timestamp: now,
                session_id: None,
                source_ip: None,
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
        .expect("insert success request log");
        finalize_request_log(
            &db_path,
            ok_id,
            &RequestLogUpdate {
                latency_ms: Some(50),
                status_code: Some(200),
                input_tokens: Some(10),
                output_tokens: Some(5),
                ..RequestLogUpdate::default()
            },
        )
        .expect("finalize success request log");

        // failure — status >= 400 and error set → counted as an error
        let err_id = insert_request_log(
            &db_path,
            &RequestLogInput {
                timestamp: now,
                session_id: None,
                source_ip: None,
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
        .expect("insert failure request log");
        finalize_request_log(
            &db_path,
            err_id,
            &RequestLogUpdate {
                latency_ms: Some(20),
                status_code: Some(500),
                error: Some("upstream error".to_string()),
                ..RequestLogUpdate::default()
            },
        )
        .expect("finalize failure request log");

        // pending — no status, no error → not counted as an error (still in request count)
        insert_request_log(
            &db_path,
            &RequestLogInput {
                timestamp: now,
                session_id: None,
                source_ip: None,
                endpoint: "anthropic".to_string(),
                provider: "mock".to_string(),
                model: "pending-model".to_string(),
                client_model: None,
                stream: true,
                api_key_id: None,
                api_key_name: None,
                api_key_value: None,
            },
        )
        .expect("insert pending request log");

        let overview = get_metrics_overview(&db_path, None).expect("query overview");
        // 3 rows total (success + failure + pending); pending stays in the request count
        assert_eq!(overview.totals.requests, 3);
        assert_eq!(overview.today.requests, 3);
        // only the finalized failure counts; success and pending do not
        assert_eq!(overview.totals.error_count, 1);
        assert_eq!(overview.today.error_count, 1);

        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn metrics_overview_today_respects_local_day_boundary() {
        let root = std::env::temp_dir().join(format!(
            "cc-gw2-observability-local-day-tests-{}",
            chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default()
        ));
        std::fs::create_dir_all(&root).expect("create temp root");
        let db_path = root.join("gateway.db");
        initialize_database(&db_path).expect("init database");

        let (today_start, tomorrow_start) = local_today_bounds_millis();
        for (timestamp, model) in [
            (today_start - 1, "previous-local-day"),
            (today_start, "today-start"),
            (tomorrow_start - 1, "today-end"),
            (tomorrow_start, "next-local-day"),
        ] {
            let request_id = insert_request_log(
                &db_path,
                &RequestLogInput {
                    timestamp,
                    session_id: None,
                    source_ip: None,
                    endpoint: "anthropic".to_string(),
                    provider: "mock".to_string(),
                    model: model.to_string(),
                    client_model: None,
                    stream: false,
                    api_key_id: None,
                    api_key_name: None,
                    api_key_value: None,
                },
            )
            .expect("insert request log");
            finalize_request_log(
                &db_path,
                request_id,
                &RequestLogUpdate {
                    latency_ms: Some(10),
                    status_code: Some(200),
                    output_tokens: Some(1),
                    ..RequestLogUpdate::default()
                },
            )
            .expect("finalize request log");
        }

        let overview = get_metrics_overview(&db_path, None).expect("query overview");
        assert_eq!(overview.today.requests, 2);
        assert_eq!(overview.today.output_tokens, 2);
        assert_eq!(overview.today.avg_latency_ms, 10);

        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn recent_throughput_metrics_counts_recent_requests_and_output_tokens() {
        let root = std::env::temp_dir().join(format!(
            "cc-gw2-observability-throughput-tests-{}",
            chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default()
        ));
        std::fs::create_dir_all(&root).expect("create temp root");
        let db_path = root.join("gateway.db");
        initialize_database(&db_path).expect("init database");

        let now = chrono::Utc::now().timestamp_millis();
        for (timestamp, endpoint, output_tokens) in [
            (now, "openai", Some(12)),
            (now - 5_000, "openai", Some(8)),
            (now - 15_000, "anthropic", Some(3)),
            (now - 120_000, "openai", Some(100)),
            (now - 30_000, "openai", None),
        ] {
            let request_id = insert_request_log(
                &db_path,
                &RequestLogInput {
                    timestamp,
                    session_id: None,
                    source_ip: None,
                    endpoint: endpoint.to_string(),
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

            if let Some(output_tokens) = output_tokens {
                finalize_request_log(
                    &db_path,
                    request_id,
                    &RequestLogUpdate {
                        status_code: Some(200),
                        output_tokens: Some(output_tokens),
                        ..RequestLogUpdate::default()
                    },
                )
                .expect("finalize request log");
            }
        }

        let all_metrics = get_recent_throughput_metrics(&db_path, now - 60_000, None)
            .expect("query all throughput metrics");
        assert_eq!(all_metrics.requests_per_minute, 4);
        assert_eq!(all_metrics.output_tokens_per_minute, 23);

        let openai_metrics = get_recent_throughput_metrics(&db_path, now - 60_000, Some("openai"))
            .expect("query openai throughput metrics");
        assert_eq!(openai_metrics.requests_per_minute, 3);
        assert_eq!(openai_metrics.output_tokens_per_minute, 20);

        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn log_status_filters_exclude_unfinished_records() {
        let root = std::env::temp_dir().join(format!(
            "cc-gw2-observability-status-filter-tests-{}",
            chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default()
        ));
        std::fs::create_dir_all(&root).expect("create temp root");
        let db_path = root.join("gateway.db");
        initialize_database(&db_path).expect("init database");

        let now = chrono::Utc::now().timestamp_millis();
        let pending_id = insert_request_log(
            &db_path,
            &RequestLogInput {
                timestamp: now,
                session_id: None,
                source_ip: None,
                endpoint: "openai".to_string(),
                provider: "mock".to_string(),
                model: "pending-model".to_string(),
                client_model: None,
                stream: true,
                api_key_id: None,
                api_key_name: None,
                api_key_value: None,
            },
        )
        .expect("insert pending request log");

        let success_id = insert_request_log(
            &db_path,
            &RequestLogInput {
                timestamp: now - 1,
                session_id: None,
                source_ip: None,
                endpoint: "openai".to_string(),
                provider: "mock".to_string(),
                model: "success-model".to_string(),
                client_model: None,
                stream: false,
                api_key_id: None,
                api_key_name: None,
                api_key_value: None,
            },
        )
        .expect("insert success request log");
        finalize_request_log(
            &db_path,
            success_id,
            &RequestLogUpdate {
                status_code: Some(200),
                ..RequestLogUpdate::default()
            },
        )
        .expect("finalize success request log");

        let failure_id = insert_request_log(
            &db_path,
            &RequestLogInput {
                timestamp: now - 2,
                session_id: None,
                source_ip: None,
                endpoint: "openai".to_string(),
                provider: "mock".to_string(),
                model: "failure-model".to_string(),
                client_model: None,
                stream: false,
                api_key_id: None,
                api_key_name: None,
                api_key_value: None,
            },
        )
        .expect("insert failure request log");
        finalize_request_log(
            &db_path,
            failure_id,
            &RequestLogUpdate {
                status_code: Some(499),
                error: Some("stream terminated before completion".to_string()),
                ..RequestLogUpdate::default()
            },
        )
        .expect("finalize failure request log");

        let success_logs = query_logs(
            &db_path,
            &LogQuery {
                status: Some("success".to_string()),
                limit: 20,
                ..LogQuery::default()
            },
        )
        .expect("query success logs");
        assert_eq!(success_logs.total, 1);
        assert_eq!(success_logs.items[0].id, success_id);
        assert_ne!(success_logs.items[0].id, pending_id);

        let error_logs = query_logs(
            &db_path,
            &LogQuery {
                status: Some("error".to_string()),
                limit: 20,
                ..LogQuery::default()
            },
        )
        .expect("query error logs");
        assert_eq!(error_logs.total, 1);
        assert_eq!(error_logs.items[0].id, failure_id);
        assert_ne!(error_logs.items[0].id, pending_id);

        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn log_detail_falls_back_to_legacy_prompt_and_response_payloads() {
        let root = std::env::temp_dir().join(format!(
            "cc-gw2-observability-legacy-payload-tests-{}",
            chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default()
        ));
        std::fs::create_dir_all(&root).expect("create temp root");
        let db_path = root.join("gateway.db");
        initialize_database(&db_path).expect("init database");

        let request_id = insert_request_log(
            &db_path,
            &RequestLogInput {
                timestamp: chrono::Utc::now().timestamp_millis(),
                session_id: Some("legacy-session".to_string()),
                source_ip: Some("127.0.0.1".to_string()),
                endpoint: "openai".to_string(),
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

        let conn = open_db(&db_path).expect("open db");
        conn.execute(
            "INSERT INTO request_payloads (request_id, prompt, response) VALUES (?1, ?2, ?3)",
            params![
                request_id,
                compress_payload("{\"legacy\":\"request\"}").expect("compress legacy request"),
                compress_payload("{\"legacy\":\"response\"}").expect("compress legacy response")
            ],
        )
        .expect("insert legacy payload row");

        let detail = get_log_detail(&db_path, request_id)
            .expect("get log detail")
            .expect("detail exists");
        let payload = detail.payload.expect("payload exists");
        assert_eq!(
            payload.client_request.as_deref(),
            Some("{\"legacy\":\"request\"}")
        );
        assert_eq!(
            payload.client_response.as_deref(),
            Some("{\"legacy\":\"response\"}")
        );
        assert_eq!(payload.upstream_request, None);
        assert_eq!(payload.upstream_response, None);

        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn finalize_stale_request_logs_closes_only_pending_records() {
        let root = std::env::temp_dir().join(format!(
            "cc-gw2-observability-stale-sweep-tests-{}",
            chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default()
        ));
        std::fs::create_dir_all(&root).expect("create temp root");
        let db_path = root.join("gateway.db");
        initialize_database(&db_path).expect("init database");

        let now = chrono::Utc::now().timestamp_millis();
        let pending_id = insert_request_log(
            &db_path,
            &RequestLogInput {
                timestamp: now,
                session_id: None,
                source_ip: None,
                endpoint: "openai".to_string(),
                provider: "mock".to_string(),
                model: "pending-model".to_string(),
                client_model: None,
                stream: false,
                api_key_id: None,
                api_key_name: None,
                api_key_value: None,
            },
        )
        .expect("insert pending request log");

        let finished_id = insert_request_log(
            &db_path,
            &RequestLogInput {
                timestamp: now - 1,
                session_id: None,
                source_ip: None,
                endpoint: "openai".to_string(),
                provider: "mock".to_string(),
                model: "finished-model".to_string(),
                client_model: None,
                stream: false,
                api_key_id: None,
                api_key_name: None,
                api_key_value: None,
            },
        )
        .expect("insert finished request log");
        finalize_request_log(
            &db_path,
            finished_id,
            &RequestLogUpdate {
                latency_ms: Some(42),
                status_code: Some(200),
                ..RequestLogUpdate::default()
            },
        )
        .expect("finalize finished request log");

        let updated = finalize_stale_request_logs(&db_path).expect("sweep stale request logs");
        assert_eq!(updated, 1);

        let conn = open_db(&db_path).expect("open db");
        let (pending_status, pending_error, pending_error_source, pending_latency): (
            i64,
            String,
            String,
            Option<i64>,
        ) = conn
            .query_row(
                "SELECT status_code, error, error_source, latency_ms FROM request_logs WHERE id = ?1",
                params![pending_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .expect("query pending log");
        assert_eq!(pending_status, 499);
        assert_eq!(pending_error, "gateway restarted before request completed");
        assert_eq!(pending_error_source, "gateway");
        assert_eq!(pending_latency, None);

        let (finished_status, finished_error_source): (i64, Option<String>) = conn
            .query_row(
                "SELECT status_code, error_source FROM request_logs WHERE id = ?1",
                params![finished_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("query finished log");
        assert_eq!(finished_status, 200);
        assert_eq!(finished_error_source, None);

        let _ = std::fs::remove_dir_all(root);
    }
}
