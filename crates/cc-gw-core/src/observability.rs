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

use crate::billing::{CostFold, PricingEngine, UsageTotals};

#[derive(Debug, Clone)]
pub struct RequestLogInput {
    pub timestamp: i64,
    pub session_id: Option<String>,
    pub source_ip: Option<String>,
    /// Identified agent client kind (claude-code / codex / opencode / ...),
    /// or the protocol fallback when no known client signature matched.
    pub client_kind: Option<String>,
    /// Raw User-Agent, truncated by the caller; kept for future
    /// re-classification of unknown clients.
    pub user_agent: Option<String>,
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
    /// Extended error context as JSON: failure stage, the full (unsanitized)
    /// error chain, truncated upstream body, and the aggregate failover
    /// attempt chain. Null on success or when nothing extra was captured.
    pub error_detail: Option<String>,
    /// Rewrite the row's provider/model to the backend that actually served
    /// the request. Set when aggregated-model failover picked a later
    /// candidate than the one the row was inserted with; `client_model`
    /// already preserves the requested (aggregate) model name.
    pub provider: Option<String>,
    pub model: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct LogRecord {
    pub id: i64,
    pub timestamp: i64,
    pub session_id: Option<String>,
    pub client_kind: Option<String>,
    pub user_agent: Option<String>,
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
    pub error_detail: Option<String>,
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
    /// 范围内已计价请求的成本和（展示货币）；无任何已计价请求时为 null。
    pub cost: Option<f64>,
    /// 范围内未计价（无价模型 / input 未知）的请求数。
    pub unpriced_requests: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MetricsOverview {
    pub totals: MetricsOverviewSection,
    pub today: MetricsOverviewSection,
    /// Previous local day; drives the today-card delta pills (vs yesterday).
    pub yesterday: MetricsOverviewSection,
    /// 成本展示货币（"CNY"/"USD"），成本字段均以此币种计。
    pub cost_currency: String,
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
    /// 当日已计价请求的成本和（展示货币）；全未计价为 null。
    pub cost: Option<f64>,
    pub unpriced_requests: i64,
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
    /// 该 (model, provider) 行的成本（展示货币）；未计价为 null。
    pub cost: Option<f64>,
    /// 未计价请求数（该行 compute 无价时等于 requests，否则 0）。
    pub unpriced_requests: i64,
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

/// Raw request/token sums over an arbitrary window — the caller derives
/// per-minute rates by dividing by the window length, so a 10-minute TPM is
/// not conflated with the 1-minute `RecentThroughputMetrics` semantics.
#[derive(Debug, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RecentTokenThroughputTotals {
    pub requests: i64,
    pub input_tokens: i64,
    pub output_tokens: i64,
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
    pub client_kind: Option<String>,
    /// Exact session id — isolates one client conversation across turns.
    pub session: Option<String>,
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
          timestamp, session_id, source_ip, client_kind, user_agent,
          endpoint, provider, model, client_model, stream,
          api_key_id, api_key_name, api_key_value
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
        params![
            input.timestamp,
            input.session_id,
            input.source_ip,
            input.client_kind,
            input.user_agent,
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
             error_source = ?12,
             provider = COALESCE(?13, provider),
             model = COALESCE(?14, model),
             error_detail = ?15
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
            update.error_source,
            update.provider,
            update.model,
            update.error_detail
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
    if let Some(client_kind) = &query.client_kind {
        conditions.push("client_kind = ?".to_string());
        params.push(client_kind.clone());
    }
    if let Some(model) = &query.model {
        // The table shows the model the client *requested* (client_model),
        // while `model` holds the routed target. Filtering by what the user
        // sees should match either side instead of silently returning zero.
        conditions.push("(model = ? OR client_model = ?)".to_string());
        params.push(model.clone());
        params.push(model.clone());
    }
    if let Some(session) = &query.session {
        conditions.push("session_id = ?".to_string());
        params.push(session.clone());
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
            error_detail: row.get(19)?,
            api_key_id: row.get(20)?,
            api_key_name: row.get(21)?,
            api_key_value: row.get(22)?,
            client_kind: row.get(23)?,
            user_agent: row.get(24)?,
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
                error, error_source, error_detail, api_key_id, api_key_name, api_key_value,
                client_kind, user_agent
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
                error, error_source, error_detail, api_key_id, api_key_name, api_key_value,
                client_kind, user_agent
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
                error_detail: row.get(19)?,
                api_key_id: row.get(20)?,
                api_key_name: row.get(21)?,
                api_key_value: row.get(22)?,
                client_kind: row.get(23)?,
                user_agent: row.get(24)?,
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
                l.error, l.error_source, l.error_detail, l.api_key_id, l.api_key_name, l.api_key_value,
                l.client_kind, l.user_agent,
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
                error_detail: row.get(19)?,
                api_key_id: row.get(20)?,
                api_key_name: row.get(21)?,
                api_key_value: row.get(22)?,
                client_kind: row.get(23)?,
                user_agent: row.get(24)?,
            },
            payload: build_log_payload(
                row.get::<_, Option<Vec<u8>>>(25)?,
                row.get::<_, Option<Vec<u8>>>(26)?,
                row.get::<_, Option<Vec<u8>>>(27)?,
                row.get::<_, Option<Vec<u8>>>(28)?,
                row.get::<_, Option<Vec<u8>>>(29)?,
                row.get::<_, Option<Vec<u8>>>(30)?,
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
    pricing: &PricingEngine,
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
    let (cost, unpriced_requests) =
        request_log_metrics_section_cost(conn, range, endpoint, pricing)?;
    Ok(MetricsOverviewSection {
        requests: row.0,
        input_tokens: row.1,
        output_tokens: row.2,
        cached_tokens: row.3,
        cache_read_tokens: row.4,
        cache_creation_tokens: row.5,
        avg_latency_ms: if row.7 > 0 { row.6 / row.7 } else { 0 },
        error_count: row.8,
        cost,
        unpriced_requests,
    })
}

/// 范围内按 (model, provider) 分组的成本子行查询 —— SUM 不做 COALESCE，
/// 让「整组 input 未知」自然落成未计价，而不是把未知当 0 冒充免费。
fn request_log_metrics_section_cost(
    conn: &Connection,
    range: Option<(i64, i64)>,
    endpoint: Option<&str>,
    pricing: &PricingEngine,
) -> Result<(Option<f64>, i64)> {
    // GROUP BY 不可省：空范围下无分组的聚合会吐出一行裸 NULL model，
    // 而分组查询空集返回零行 → cost None / unpriced 0，语义正确。
    // unknown_usage 列独立统计 input_tokens IS NULL 的请求数：SUM 忽略
    // NULL，混合用量组的 input 非空会掩盖同组无 usage 的请求。
    let select = format!(
        "SELECT model, provider, COUNT(*),
       SUM(input_tokens), SUM(output_tokens), SUM(cache_read_tokens), SUM(cache_creation_tokens),
       SUM(CASE WHEN input_tokens IS NULL THEN 1 ELSE 0 END),
       {}
     FROM request_logs",
        crate::billing::BILLABLE_INPUT_SUM_SQL
    );
    let group_by = " GROUP BY model, provider";
    let (sql, param_values): (String, Vec<Box<dyn rusqlite::ToSql>>) = match (range, endpoint) {
        (Some((since, until)), Some(endpoint)) => (
            format!(
                "{select} WHERE timestamp >= ?1 AND timestamp < ?2 AND endpoint = ?3{group_by}"
            ),
            vec![
                Box::new(since),
                Box::new(until),
                Box::new(endpoint.to_string()),
            ],
        ),
        (Some((since, until)), None) => (
            format!("{select} WHERE timestamp >= ?1 AND timestamp < ?2{group_by}"),
            vec![Box::new(since), Box::new(until)],
        ),
        (None, Some(endpoint)) => (
            format!("{select} WHERE endpoint = ?1{group_by}"),
            vec![Box::new(endpoint.to_string())],
        ),
        (None, None) => (format!("{select}{group_by}"), Vec::new()),
    };
    let mut stmt = conn.prepare(sql.as_str())?;
    let mut rows = stmt.query(rusqlite::params_from_iter(
        param_values.iter().map(|value| value.as_ref()),
    ))?;
    let mut fold = CostFold::default();
    while let Some(row) = rows.next()? {
        let model: String = row.get(0)?;
        let provider: String = row.get(1)?;
        let requests: i64 = row.get(2)?;
        let usage = UsageTotals {
            input: row.get(3)?,
            output: row.get(4)?,
            cache_read: row.get(5)?,
            cache_creation: row.get(6)?,
            // 逐行钳零后的可计费输入之和（异常 cache>input 不抵扣他行）
            billable_input: row.get(8)?,
        };
        let unknown_usage: i64 = row.get(7)?;
        fold.add(
            pricing.compute(&model, Some(&provider), &usage),
            requests,
            unknown_usage,
        );
    }
    Ok(fold.finish())
}

pub fn get_metrics_overview(
    db_path: &Path,
    endpoint: Option<&str>,
    pricing: &PricingEngine,
) -> Result<MetricsOverview> {
    let conn = open_db(db_path)?;
    let totals = request_log_metrics_section(&conn, None, endpoint, pricing)?;
    let (today_start, tomorrow_start) = local_today_bounds_millis();
    let today_section = request_log_metrics_section(
        &conn,
        Some((today_start, tomorrow_start)),
        endpoint,
        pricing,
    )?;
    // Yesterday = the prior local calendar day, computed DST-aware. A naive
    // `today_start - 86_400_000` drifts by ~1h around DST transitions (days can
    // be 23 or 25h); `local_day_bounds_millis` resolves midnight in local time,
    // so `(yesterday_start, today_start)` is exactly the prior day.
    let today = chrono::Local::now().date_naive();
    let yesterday = today.pred_opt().unwrap_or(today);
    let (yesterday_start, _) = local_day_bounds_millis(yesterday);
    let yesterday_section = request_log_metrics_section(
        &conn,
        Some((yesterday_start, today_start)),
        endpoint,
        pricing,
    )?;

    Ok(MetricsOverview {
        totals,
        today: today_section,
        yesterday: yesterday_section,
        cost_currency: pricing.display_currency().code().to_string(),
    })
}

pub fn get_daily_metrics(
    db_path: &Path,
    days: i64,
    endpoint: Option<&str>,
    pricing: &PricingEngine,
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
    let cost_by_date = daily_cost_by_date(&conn, since, endpoint, pricing)?;
    while let Some(row) = rows.next()? {
        let request_count: i64 = row.get(1)?;
        let total_latency: i64 = row.get(7)?;
        let latency_count: i64 = row.get(8)?;
        let date: String = row.get(0)?;
        let (cost, unpriced_requests) = cost_by_date.get(&date).copied().unwrap_or((None, 0));
        items.push(DailyMetric {
            date,
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
            cost,
            unpriced_requests,
        });
    }
    items.reverse();
    Ok(items)
}

/// 日维度成本子行：GROUP BY (date, model, provider)（无 LIMIT —— LIMIT 会截
/// 断模型的子行污染当日成本），在 Rust 折叠成 date → (cost, unpriced)。
fn daily_cost_by_date(
    conn: &Connection,
    since: i64,
    endpoint: Option<&str>,
    pricing: &PricingEngine,
) -> Result<HashMap<String, (Option<f64>, i64)>> {
    let select = format!(
        "SELECT strftime('%Y-%m-%d', timestamp / 1000, 'unixepoch', 'localtime') AS date,
           model, provider, COUNT(*),
           SUM(input_tokens), SUM(output_tokens), SUM(cache_read_tokens), SUM(cache_creation_tokens),
           SUM(CASE WHEN input_tokens IS NULL THEN 1 ELSE 0 END),
           {}
     FROM request_logs",
        crate::billing::BILLABLE_INPUT_SUM_SQL
    );
    let (sql, params_vec): (String, Vec<Box<dyn rusqlite::ToSql>>) = match endpoint {
        Some(endpoint) => (
            format!(
                "{select} WHERE timestamp >= ?1 AND endpoint = ?2 GROUP BY date, model, provider"
            ),
            vec![Box::new(since), Box::new(endpoint.to_string())],
        ),
        None => (
            format!("{select} WHERE timestamp >= ?1 GROUP BY date, model, provider"),
            vec![Box::new(since)],
        ),
    };
    let mut stmt = conn.prepare(sql.as_str())?;
    let mut rows = stmt.query(rusqlite::params_from_iter(
        params_vec.iter().map(|value| value.as_ref()),
    ))?;
    let mut folds: HashMap<String, CostFold> = HashMap::new();
    while let Some(row) = rows.next()? {
        let date: String = row.get(0)?;
        let model: String = row.get(1)?;
        let provider: String = row.get(2)?;
        let requests: i64 = row.get(3)?;
        let usage = UsageTotals {
            input: row.get(4)?,
            output: row.get(5)?,
            cache_read: row.get(6)?,
            cache_creation: row.get(7)?,
            // 逐行钳零后的可计费输入之和（异常 cache>input 不抵扣他行）
            billable_input: row.get(9)?,
        };
        let unknown_usage: i64 = row.get(8)?;
        folds.entry(date).or_default().add(
            pricing.compute(&model, Some(&provider), &usage),
            requests,
            unknown_usage,
        );
    }
    Ok(folds
        .into_iter()
        .map(|(date, fold)| (date, fold.finish()))
        .collect())
}

pub fn get_model_usage_metrics(
    db_path: &Path,
    days: i64,
    limit: i64,
    endpoint: Option<&str>,
    pricing: &PricingEngine,
) -> Result<Vec<ModelUsageMetric>> {
    let conn = open_db(db_path)?;
    let since = chrono::Utc::now().timestamp_millis() - days * 24 * 60 * 60 * 1000;
    // SUM 保持可空：整组 input 未知 → 该行未计价（而不是 0 tokens 冒充免费）。
    // cache 两列只为成本计算新增，展示口径不变；billable 列逐行钳零后求和。
    let columns = format!(
        "SELECT model, provider, COUNT(*), SUM(input_tokens), SUM(output_tokens),
                SUM(cache_read_tokens), SUM(cache_creation_tokens),
                COALESCE(SUM(latency_ms), 0), AVG(ttft_ms), AVG(tpot_ms),
                SUM(CASE WHEN input_tokens IS NULL THEN 1 ELSE 0 END), {}
     FROM request_logs",
        crate::billing::BILLABLE_INPUT_SUM_SQL
    );
    let sql = if endpoint.is_some() {
        format!(
            "{columns}
         WHERE timestamp >= ?1 AND endpoint = ?2
         GROUP BY provider, model
         ORDER BY COUNT(*) DESC
         LIMIT ?3"
        )
    } else {
        format!(
            "{columns}
         WHERE timestamp >= ?1
         GROUP BY provider, model
         ORDER BY COUNT(*) DESC
         LIMIT ?2"
        )
    };
    let mut stmt = conn.prepare(sql.as_str())?;
    let mut rows = if let Some(endpoint) = endpoint {
        stmt.query(params![since, endpoint, limit])?
    } else {
        stmt.query(params![since, limit])?
    };
    let mut items = Vec::new();
    while let Some(row) = rows.next()? {
        let requests: i64 = row.get(2)?;
        let total_latency: i64 = row.get(7)?;
        let usage = UsageTotals {
            input: row.get(3)?,
            output: row.get(4)?,
            cache_read: row.get(5)?,
            cache_creation: row.get(6)?,
            // 逐行钳零后的可计费输入之和（异常 cache>input 不抵扣他行）
            billable_input: row.get(11)?,
        };
        let model: String = row.get(0)?;
        let provider: String = row.get(1)?;
        let unknown_usage: i64 = row.get(10)?;
        let breakdown = pricing.compute(&model, Some(&provider), &usage);
        let (cost, unpriced_requests) = match breakdown {
            // 已计价行仍可能有缺 usage 的请求（SQL SUM 忽略 NULL）
            Some(breakdown) => (Some(breakdown.total), unknown_usage),
            None => (None, requests),
        };
        items.push(ModelUsageMetric {
            model,
            provider,
            requests,
            input_tokens: usage.input.unwrap_or(0),
            output_tokens: usage.output.unwrap_or(0),
            avg_latency_ms: if requests > 0 {
                total_latency / requests
            } else {
                0
            },
            avg_ttft_ms: row.get(8)?,
            avg_tpot_ms: row.get(9)?,
            cost,
            unpriced_requests,
        });
    }
    Ok(items)
}

/// Aggregation axis for [`get_dimension_usage_metrics`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UsageDimension {
    Provider,
    Endpoint,
    ClientKind,
}

impl UsageDimension {
    fn group_expression(&self) -> &'static str {
        match self {
            UsageDimension::Provider => "provider",
            UsageDimension::Endpoint => "endpoint",
            // Rows recorded before the column existed group under "unknown".
            UsageDimension::ClientKind => "COALESCE(NULLIF(TRIM(client_kind), ''), 'unknown')",
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DimensionUsageMetric {
    pub key: String,
    pub requests: i64,
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub cache_read_tokens: i64,
    pub cache_creation_tokens: i64,
    pub avg_latency_ms: i64,
    /// 该维度行已计价部分成本和（展示货币）；全未计价为 null。
    pub cost: Option<f64>,
    pub unpriced_requests: i64,
}

/// Usage grouped by provider / endpoint / client kind over the last `days`
/// days — the data behind the dashboard's usage-distribution tabs. Same shape
/// as the model metrics table so the frontend renders one component per tab.
pub fn get_dimension_usage_metrics(
    db_path: &Path,
    dimension: UsageDimension,
    days: i64,
    limit: i64,
    endpoint: Option<&str>,
    pricing: &PricingEngine,
) -> Result<Vec<DimensionUsageMetric>> {
    let conn = open_db(db_path)?;
    let since = chrono::Utc::now().timestamp_millis() - days.clamp(1, 90) * 24 * 60 * 60 * 1000;
    let group = dimension.group_expression();
    let cost_by_key = dimension_cost_by_key(&conn, group, since, endpoint, pricing)?;
    let sql = if endpoint.is_some() {
        format!(
            "SELECT {group}, COUNT(*), COALESCE(SUM(input_tokens), 0), COALESCE(SUM(output_tokens), 0),
                    COALESCE(SUM(cache_read_tokens), 0), COALESCE(SUM(cache_creation_tokens), 0),
                    COALESCE(SUM(latency_ms), 0)
             FROM request_logs
             WHERE timestamp >= ?1 AND endpoint = ?2
             GROUP BY {group}
             ORDER BY COUNT(*) DESC
             LIMIT ?3"
        )
    } else {
        format!(
            "SELECT {group}, COUNT(*), COALESCE(SUM(input_tokens), 0), COALESCE(SUM(output_tokens), 0),
                    COALESCE(SUM(cache_read_tokens), 0), COALESCE(SUM(cache_creation_tokens), 0),
                    COALESCE(SUM(latency_ms), 0)
             FROM request_logs
             WHERE timestamp >= ?1
             GROUP BY {group}
             ORDER BY COUNT(*) DESC
             LIMIT ?2"
        )
    };
    let mut stmt = conn.prepare(sql.as_str())?;
    let mut rows = if let Some(endpoint) = endpoint {
        stmt.query(params![since, endpoint, limit.clamp(1, 50)])?
    } else {
        stmt.query(params![since, limit.clamp(1, 50)])?
    };
    let mut items = Vec::new();
    while let Some(row) = rows.next()? {
        let requests: i64 = row.get(1)?;
        let total_latency: i64 = row.get(6)?;
        let key: String = row.get(0)?;
        let (cost, unpriced_requests) = cost_by_key.get(&key).copied().unwrap_or((None, 0));
        items.push(DimensionUsageMetric {
            key,
            requests,
            input_tokens: row.get(2)?,
            output_tokens: row.get(3)?,
            cache_read_tokens: row.get(4)?,
            cache_creation_tokens: row.get(5)?,
            avg_latency_ms: if requests > 0 {
                total_latency / requests
            } else {
                0
            },
            cost,
            unpriced_requests,
        });
    }
    Ok(items)
}

/// 维度行成本子行：GROUP BY ({group}, model, provider) 无 LIMIT（维度行聚合
/// 多模型，SQL LIMIT 截断的是展示行，但子行截断会污染成本），Rust 折叠成
/// group-key → (cost, unpricedRequests)。
fn dimension_cost_by_key(
    conn: &Connection,
    group: &str,
    since: i64,
    endpoint: Option<&str>,
    pricing: &PricingEngine,
) -> Result<HashMap<String, (Option<f64>, i64)>> {
    let select = format!(
        "SELECT {group}, model, provider, COUNT(*),
                SUM(input_tokens), SUM(output_tokens), SUM(cache_read_tokens), SUM(cache_creation_tokens),
                SUM(CASE WHEN input_tokens IS NULL THEN 1 ELSE 0 END),
                {}
         FROM request_logs",
        crate::billing::BILLABLE_INPUT_SUM_SQL
    );
    let (sql, params_vec): (String, Vec<Box<dyn rusqlite::ToSql>>) = match endpoint {
        Some(endpoint) => (
            format!(
                "{select} WHERE timestamp >= ?1 AND endpoint = ?2 GROUP BY {group}, model, provider"
            ),
            vec![Box::new(since), Box::new(endpoint.to_string())],
        ),
        None => (
            format!("{select} WHERE timestamp >= ?1 GROUP BY {group}, model, provider"),
            vec![Box::new(since)],
        ),
    };
    let mut stmt = conn.prepare(sql.as_str())?;
    let mut rows = stmt.query(rusqlite::params_from_iter(
        params_vec.iter().map(|value| value.as_ref()),
    ))?;
    let mut folds: HashMap<String, CostFold> = HashMap::new();
    while let Some(row) = rows.next()? {
        let key: String = row.get(0)?;
        let model: String = row.get(1)?;
        let provider: String = row.get(2)?;
        let requests: i64 = row.get(3)?;
        let usage = UsageTotals {
            input: row.get(4)?,
            output: row.get(5)?,
            cache_read: row.get(6)?,
            cache_creation: row.get(7)?,
            // 逐行钳零后的可计费输入之和（异常 cache>input 不抵扣他行）
            billable_input: row.get(9)?,
        };
        let unknown_usage: i64 = row.get(8)?;
        folds.entry(key).or_default().add(
            pricing.compute(&model, Some(&provider), &usage),
            requests,
            unknown_usage,
        );
    }
    Ok(folds
        .into_iter()
        .map(|(key, fold)| (key, fold.finish()))
        .collect())
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

/// Raw sums over the window starting at `since` — input and output tokens
/// separately. Rows whose upstream never reported usage contribute nothing
/// (COALESCE NULL → 0), matching the aggregate counters' semantics.
pub fn get_recent_token_throughput_totals(
    db_path: &Path,
    since: i64,
    endpoint: Option<&str>,
) -> Result<RecentTokenThroughputTotals> {
    let conn = open_db(db_path)?;
    let (requests, input_tokens, output_tokens): (i64, i64, i64) = if let Some(endpoint) = endpoint
    {
        conn.query_row(
            "SELECT
               COUNT(*),
               COALESCE(SUM(COALESCE(input_tokens, 0)), 0),
               COALESCE(SUM(COALESCE(output_tokens, 0)), 0)
             FROM request_logs
             WHERE timestamp >= ?1 AND endpoint = ?2",
            params![since, endpoint],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )?
    } else {
        conn.query_row(
            "SELECT
               COUNT(*),
               COALESCE(SUM(COALESCE(input_tokens, 0)), 0),
               COALESCE(SUM(COALESCE(output_tokens, 0)), 0)
             FROM request_logs
             WHERE timestamp >= ?1",
            params![since],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )?
    };
    Ok(RecentTokenThroughputTotals {
        requests,
        input_tokens,
        output_tokens,
    })
}

/// Per-client-kind usage over the window starting at `since` — the data
/// behind the dashboard's agent-client card. Rows recorded before the
/// `client_kind` column existed group under `"unknown"`.
#[derive(Debug, Default, Clone, PartialEq)]
pub struct ClientKindUsageMetric {
    pub client_kind: String,
    pub requests: i64,
    pub sessions: i64,
    pub input_tokens: i64,
    pub output_tokens: i64,
}

pub fn get_recent_client_kind_metrics(
    db_path: &Path,
    since: i64,
    endpoint: Option<&str>,
) -> Result<Vec<ClientKindUsageMetric>> {
    let conn = open_db(db_path)?;
    let mut statement = if endpoint.is_some() {
        conn.prepare(
            "SELECT
               COALESCE(NULLIF(TRIM(client_kind), ''), 'unknown') AS kind,
               COUNT(*) AS requests,
               COUNT(DISTINCT NULLIF(TRIM(session_id), '')) AS sessions,
               COALESCE(SUM(COALESCE(input_tokens, 0)), 0),
               COALESCE(SUM(COALESCE(output_tokens, 0)), 0)
             FROM request_logs
             WHERE timestamp >= ?1 AND endpoint = ?2
             GROUP BY kind
             ORDER BY requests DESC",
        )?
    } else {
        conn.prepare(
            "SELECT
               COALESCE(NULLIF(TRIM(client_kind), ''), 'unknown') AS kind,
               COUNT(*) AS requests,
               COUNT(DISTINCT NULLIF(TRIM(session_id), '')) AS sessions,
               COALESCE(SUM(COALESCE(input_tokens, 0)), 0),
               COALESCE(SUM(COALESCE(output_tokens, 0)), 0)
             FROM request_logs
             WHERE timestamp >= ?1
             GROUP BY kind
             ORDER BY requests DESC",
        )?
    };
    let map_row = |row: &rusqlite::Row<'_>| -> rusqlite::Result<ClientKindUsageMetric> {
        Ok(ClientKindUsageMetric {
            client_kind: row.get(0)?,
            requests: row.get(1)?,
            sessions: row.get(2)?,
            input_tokens: row.get(3)?,
            output_tokens: row.get(4)?,
        })
    };
    let metrics = if let Some(endpoint) = endpoint {
        statement
            .query_map(params![since, endpoint], map_row)?
            .collect::<std::result::Result<Vec<_>, _>>()?
    } else {
        statement
            .query_map(params![since], map_row)?
            .collect::<std::result::Result<Vec<_>, _>>()?
    };
    Ok(metrics)
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

    fn test_pricing() -> crate::billing::PricingEngine {
        crate::billing::PricingEngine::from_config(&crate::config::BillingConfig::default())
    }

    #[test]
    fn usage_metrics_cost_null_when_nothing_priced() {
        let root = std::env::temp_dir().join(format!(
            "cc-gw2-observability-cost-unpriced-{}",
            chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default()
        ));
        std::fs::create_dir_all(&root).expect("create temp root");
        let db_path = root.join("gateway.db");
        initialize_database(&db_path).expect("init database");
        let now = chrono::Utc::now().timestamp_millis();
        let insert = |model: &str| {
            insert_request_log(
                &db_path,
                &RequestLogInput {
                    timestamp: now,
                    session_id: None,
                    source_ip: None,
                    client_kind: None,
                    user_agent: None,
                    endpoint: "openai".to_string(),
                    provider: "mock".to_string(),
                    model: model.to_string(),
                    client_model: None,
                    stream: false,
                    api_key_id: None,
                    api_key_name: None,
                    api_key_value: None,
                },
            )
            .expect("insert request log")
        };
        // 一条已 finalize 但模型无价（stub-model 不在内置表），一条 pending
        // （input 未知）—— 两种未计价来源都计入 unpricedRequests。
        let done = insert("stub-model");
        finalize_request_log(
            &db_path,
            done,
            &RequestLogUpdate {
                latency_ms: Some(10),
                status_code: Some(200),
                input_tokens: Some(100),
                output_tokens: Some(10),
                ..RequestLogUpdate::default()
            },
        )
        .expect("finalize request log");
        let _pending = insert("stub-model");

        let pricing = test_pricing();
        let overview = get_metrics_overview(&db_path, None, &pricing).expect("query overview");
        assert_eq!(overview.cost_currency, "CNY");
        assert_eq!(overview.today.cost, None);
        assert_eq!(overview.today.unpriced_requests, 2);
        assert_eq!(overview.totals.cost, None);
        assert_eq!(overview.totals.unpriced_requests, 2);

        let providers =
            get_dimension_usage_metrics(&db_path, UsageDimension::Provider, 7, 10, None, &pricing)
                .expect("query provider metrics");
        assert_eq!(providers.len(), 1);
        assert_eq!(providers[0].key, "mock");
        assert_eq!(providers[0].cost, None);
        assert_eq!(providers[0].unpriced_requests, 2);

        let models =
            get_model_usage_metrics(&db_path, 7, 10, None, &pricing).expect("query model metrics");
        assert_eq!(models.len(), 1);
        assert_eq!(models[0].model, "stub-model");
        assert_eq!(models[0].cost, None);
        assert_eq!(models[0].unpriced_requests, 2);

        let keys = crate::api_keys::get_api_key_usage_metrics(&db_path, 7, 10, None, &pricing)
            .expect("query api key metrics");
        assert_eq!(keys.len(), 1);
        assert_eq!(keys[0].cost, None);
        assert_eq!(keys[0].unpriced_requests, 2);

        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn usage_metrics_cost_folds_override_prices_across_models() {
        let root = std::env::temp_dir().join(format!(
            "cc-gw2-observability-cost-fold-{}",
            chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default()
        ));
        std::fs::create_dir_all(&root).expect("create temp root");
        let db_path = root.join("gateway.db");
        initialize_database(&db_path).expect("init database");
        let now = chrono::Utc::now().timestamp_millis();
        let insert = |model: &str| {
            insert_request_log(
                &db_path,
                &RequestLogInput {
                    timestamp: now,
                    session_id: None,
                    source_ip: None,
                    client_kind: None,
                    user_agent: None,
                    endpoint: "openai".to_string(),
                    provider: "mock".to_string(),
                    model: model.to_string(),
                    client_model: None,
                    stream: false,
                    api_key_id: Some(7),
                    api_key_name: Some("team-a".to_string()),
                    api_key_value: None,
                },
            )
            .expect("insert request log")
        };
        let finalize = |log_id: i64, input: i64, output: i64, cache_read: i64| {
            finalize_request_log(
                &db_path,
                log_id,
                &RequestLogUpdate {
                    latency_ms: Some(10),
                    status_code: Some(200),
                    input_tokens: Some(input),
                    output_tokens: Some(output),
                    cache_read_tokens: Some(cache_read),
                    cache_creation_tokens: Some(0),
                    ..RequestLogUpdate::default()
                },
            )
            .expect("finalize request log")
        };
        // A: stub-model（全局覆盖 ¥1/¥2/读¥0.5/写¥0）→ 0.8 + 1.0 + 0.1 = 1.9
        finalize(insert("stub-model"), 1_000_000, 500_000, 200_000);
        // B: other-model（范围覆盖 mock:other-model ¥4/¥8）→ 4.0
        finalize(insert("other-model"), 1_000_000, 0, 0);
        // C: mystery-model 无价 → unpriced 1
        finalize(insert("mystery-model"), 100_000, 0, 0);

        let mut billing = crate::config::BillingConfig::default();
        billing.model_prices.insert(
            "stub-model".to_string(),
            crate::config::ModelPriceOverride {
                currency: "CNY".to_string(),
                input: 1.0,
                output: 2.0,
                cache_read: 0.5,
                cache_creation: 0.0,
                label: None,
            },
        );
        billing.model_prices.insert(
            "mock:other-model".to_string(),
            crate::config::ModelPriceOverride {
                currency: "CNY".to_string(),
                input: 4.0,
                output: 8.0,
                cache_read: 1.0,
                cache_creation: 4.0,
                label: None,
            },
        );
        let pricing = crate::billing::PricingEngine::from_config(&billing);

        let overview = get_metrics_overview(&db_path, None, &pricing).expect("query overview");
        assert_eq!(overview.today.cost, Some(5.9));
        assert_eq!(overview.today.unpriced_requests, 1);
        assert_eq!(overview.totals.cost, Some(5.9));

        let daily = get_daily_metrics(&db_path, 14, None, &pricing).expect("query daily");
        assert_eq!(daily.len(), 1);
        assert_eq!(daily[0].cost, Some(5.9));
        assert_eq!(daily[0].unpriced_requests, 1);

        let providers =
            get_dimension_usage_metrics(&db_path, UsageDimension::Provider, 7, 10, None, &pricing)
                .expect("query provider metrics");
        assert_eq!(providers.len(), 1);
        assert_eq!(providers[0].key, "mock");
        assert_eq!(providers[0].cost, Some(5.9));
        assert_eq!(providers[0].unpriced_requests, 1);

        let models =
            get_model_usage_metrics(&db_path, 7, 10, None, &pricing).expect("query model metrics");
        let stub = models.iter().find(|m| m.model == "stub-model").unwrap();
        assert_eq!(stub.cost, Some(1.9));
        assert_eq!(stub.unpriced_requests, 0);
        let other = models.iter().find(|m| m.model == "other-model").unwrap();
        assert_eq!(other.cost, Some(4.0));
        let mystery = models.iter().find(|m| m.model == "mystery-model").unwrap();
        assert_eq!(mystery.cost, None);
        assert_eq!(mystery.unpriced_requests, 1);

        let keys = crate::api_keys::get_api_key_usage_metrics(&db_path, 7, 10, None, &pricing)
            .expect("query api key metrics");
        assert_eq!(keys.len(), 1);
        assert_eq!(keys[0].api_key_name.as_deref(), Some("team-a"));
        assert_eq!(keys[0].cost, Some(5.9));
        assert_eq!(keys[0].unpriced_requests, 1);

        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn usage_metrics_cost_mixed_null_usage_counts_unpriced() {
        let root = std::env::temp_dir().join(format!(
            "cc-gw2-observability-cost-mixed-null-{}",
            chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default()
        ));
        std::fs::create_dir_all(&root).expect("create temp root");
        let db_path = root.join("gateway.db");
        initialize_database(&db_path).expect("init database");
        let now = chrono::Utc::now().timestamp_millis();
        let insert = || {
            insert_request_log(
                &db_path,
                &RequestLogInput {
                    timestamp: now,
                    session_id: None,
                    source_ip: None,
                    client_kind: None,
                    user_agent: None,
                    endpoint: "openai".to_string(),
                    provider: "mock".to_string(),
                    model: "stub-model".to_string(),
                    client_model: None,
                    stream: false,
                    api_key_id: Some(1),
                    api_key_name: Some("team-a".to_string()),
                    api_key_value: None,
                },
            )
            .expect("insert request log")
        };
        let finalize = |log_id: i64, input: Option<i64>, output: Option<i64>| {
            finalize_request_log(
                &db_path,
                log_id,
                &RequestLogUpdate {
                    latency_ms: Some(10),
                    status_code: Some(200),
                    input_tokens: input,
                    output_tokens: output,
                    cache_read_tokens: Some(0),
                    cache_creation_tokens: Some(0),
                    ..RequestLogUpdate::default()
                },
            )
            .expect("finalize request log")
        };
        // 同一 (provider, model) 组内混合：一条有 usage（¥1/1M input → 1.0），
        // 一条成功但上游未报 usage（input NULL）。SQL SUM 忽略 NULL 曾把整组
        // 当成已计价，unpricedRequests 漏报为 0。
        finalize(insert(), Some(1_000_000), Some(0));
        finalize(insert(), None, None);

        let mut billing = crate::config::BillingConfig::default();
        billing.model_prices.insert(
            "stub-model".to_string(),
            crate::config::ModelPriceOverride {
                currency: "CNY".to_string(),
                input: 1.0,
                output: 1.0,
                cache_read: 0.0,
                cache_creation: 0.0,
                label: None,
            },
        );
        let pricing = crate::billing::PricingEngine::from_config(&billing);

        let overview = get_metrics_overview(&db_path, None, &pricing).expect("query overview");
        assert_eq!(overview.today.requests, 2);
        assert_eq!(overview.today.cost, Some(1.0));
        assert_eq!(overview.today.unpriced_requests, 1);
        assert_eq!(overview.totals.cost, Some(1.0));
        assert_eq!(overview.totals.unpriced_requests, 1);

        let daily = get_daily_metrics(&db_path, 14, None, &pricing).expect("query daily");
        assert_eq!(daily.len(), 1);
        assert_eq!(daily[0].request_count, 2);
        assert_eq!(daily[0].cost, Some(1.0));
        assert_eq!(daily[0].unpriced_requests, 1);

        let providers =
            get_dimension_usage_metrics(&db_path, UsageDimension::Provider, 7, 10, None, &pricing)
                .expect("query provider metrics");
        assert_eq!(providers.len(), 1);
        assert_eq!(providers[0].requests, 2);
        assert_eq!(providers[0].cost, Some(1.0));
        assert_eq!(providers[0].unpriced_requests, 1);

        let models =
            get_model_usage_metrics(&db_path, 7, 10, None, &pricing).expect("query model metrics");
        assert_eq!(models.len(), 1);
        assert_eq!(models[0].requests, 2);
        assert_eq!(models[0].cost, Some(1.0));
        assert_eq!(models[0].unpriced_requests, 1);

        let keys = crate::api_keys::get_api_key_usage_metrics(&db_path, 7, 10, None, &pricing)
            .expect("query api key metrics");
        assert_eq!(keys.len(), 1);
        assert_eq!(keys[0].requests, 2);
        assert_eq!(keys[0].cost, Some(1.0));
        assert_eq!(keys[0].unpriced_requests, 1);

        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn usage_metrics_cost_anomalous_cache_clamps_per_request() {
        let root = std::env::temp_dir().join(format!(
            "cc-gw2-observability-cost-anomaly-{}",
            chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default()
        ));
        std::fs::create_dir_all(&root).expect("create temp root");
        let db_path = root.join("gateway.db");
        initialize_database(&db_path).expect("init database");
        let now = chrono::Utc::now().timestamp_millis();
        let finalize =
            |log_id: i64, input: Option<i64>, output: Option<i64>, cache_read: Option<i64>| {
                finalize_request_log(
                    &db_path,
                    log_id,
                    &RequestLogUpdate {
                        latency_ms: Some(10),
                        status_code: Some(200),
                        input_tokens: input,
                        output_tokens: output,
                        cache_read_tokens: cache_read,
                        cache_creation_tokens: Some(0),
                        ..RequestLogUpdate::default()
                    },
                )
                .expect("finalize request log")
            };
        let insert = || {
            insert_request_log(
                &db_path,
                &RequestLogInput {
                    timestamp: now,
                    session_id: None,
                    source_ip: None,
                    client_kind: None,
                    user_agent: None,
                    endpoint: "openai".to_string(),
                    provider: "mock".to_string(),
                    model: "stub-model".to_string(),
                    client_model: None,
                    stream: false,
                    api_key_id: Some(1),
                    api_key_name: Some("team-a".to_string()),
                    api_key_value: None,
                },
            )
            .expect("insert request log")
        };
        // 覆盖价：输入 ¥1M/M（=¥1/token）、缓存读 ¥0.1M/M（=¥0.1/token）。
        // 异常行 cache_read(20) > input(10)：逐条口径 input 钳零 + 缓存照计
        // → ¥2；正常行 → ¥100。聚合必须等于逐条之和 ¥102 —— 聚合后钳零
        // （max(0, 110−20)=90 → ¥92）会让异常行的多余缓存抵扣正常行输入费。
        finalize(insert(), Some(10), Some(0), Some(20));
        finalize(insert(), Some(100), Some(0), Some(0));

        let mut billing = crate::config::BillingConfig::default();
        billing.model_prices.insert(
            "stub-model".to_string(),
            crate::config::ModelPriceOverride {
                currency: "CNY".to_string(),
                input: 1_000_000.0,
                output: 0.0,
                cache_read: 100_000.0,
                cache_creation: 0.0,
                label: None,
            },
        );
        let pricing = crate::billing::PricingEngine::from_config(&billing);

        let overview = get_metrics_overview(&db_path, None, &pricing).expect("query overview");
        assert_eq!(overview.today.cost, Some(102.0));
        assert_eq!(overview.totals.cost, Some(102.0));

        let daily = get_daily_metrics(&db_path, 14, None, &pricing).expect("query daily");
        assert_eq!(daily[0].cost, Some(102.0));

        let providers =
            get_dimension_usage_metrics(&db_path, UsageDimension::Provider, 7, 10, None, &pricing)
                .expect("query provider metrics");
        assert_eq!(providers[0].cost, Some(102.0));

        let models =
            get_model_usage_metrics(&db_path, 7, 10, None, &pricing).expect("query model metrics");
        assert_eq!(models[0].cost, Some(102.0));

        let keys = crate::api_keys::get_api_key_usage_metrics(&db_path, 7, 10, None, &pricing)
            .expect("query api key metrics");
        assert_eq!(keys[0].cost, Some(102.0));

        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn error_detail_round_trips_through_finalize_and_queries() {
        let root = std::env::temp_dir().join(format!(
            "cc-gw2-observability-tests-{}",
            chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default()
        ));
        std::fs::create_dir_all(&root).expect("create temp root");
        let db_path = root.join("gateway.db");
        initialize_database(&db_path).expect("init database");

        let log_id = insert_request_log(
            &db_path,
            &RequestLogInput {
                timestamp: chrono::Utc::now().timestamp_millis(),
                session_id: None,
                source_ip: None,
                client_kind: Some("codex".to_string()),
                user_agent: Some("codex_cli_rs/0.42.0".to_string()),
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

        let detail = r#"{"stage":"upstream","upstreamStatus":500,"upstreamBody":"boom"}"#;
        finalize_request_log(
            &db_path,
            log_id,
            &RequestLogUpdate {
                latency_ms: Some(42),
                status_code: Some(502),
                error: Some("upstream request failed".to_string()),
                error_source: Some("upstream".to_string()),
                error_detail: Some(detail.to_string()),
                ..RequestLogUpdate::default()
            },
        )
        .expect("finalize request log");

        let list = query_logs(
            &db_path,
            &LogQuery {
                limit: 10,
                offset: 0,
                provider: None,
                model: None,
                endpoint: None,
                status: None,
                from: None,
                to: None,
                api_key_ids: None,
                client_kind: None,
                session: None,
            },
        )
        .expect("query logs");
        let row = list.items.first().expect("log row");
        assert_eq!(row.error_detail.as_deref(), Some(detail));
        assert_eq!(row.client_kind.as_deref(), Some("codex"));
        assert_eq!(row.user_agent.as_deref(), Some("codex_cli_rs/0.42.0"));

        // clientKind filter matches the stored kind.
        let filtered = query_logs(
            &db_path,
            &LogQuery {
                limit: 10,
                offset: 0,
                provider: None,
                model: None,
                endpoint: None,
                status: None,
                from: None,
                to: None,
                api_key_ids: None,
                client_kind: Some("claude-code".to_string()),
                session: None,
            },
        )
        .expect("query filtered logs");
        assert_eq!(filtered.total, 0);
        let filtered_codex = query_logs(
            &db_path,
            &LogQuery {
                limit: 10,
                offset: 0,
                provider: None,
                model: None,
                endpoint: None,
                status: None,
                from: None,
                to: None,
                api_key_ids: None,
                client_kind: Some("codex".to_string()),
                session: None,
            },
        )
        .expect("query codex logs");
        assert_eq!(filtered_codex.total, 1);

        let detail_record = get_log_detail(&db_path, log_id)
            .expect("log detail")
            .expect("row exists");
        assert_eq!(detail_record.record.error_detail.as_deref(), Some(detail));

        let exported = export_logs(
            &db_path,
            &LogQuery {
                limit: 10,
                offset: 0,
                provider: None,
                model: None,
                endpoint: None,
                status: None,
                from: None,
                to: None,
                api_key_ids: None,
                client_kind: None,
                session: None,
            },
        )
        .expect("export logs");
        assert_eq!(
            exported.first().expect("exported row").record.error_detail,
            Some(detail.to_string())
        );

        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn token_throughput_totals_sum_window_and_split_endpoint() {
        let root = std::env::temp_dir().join(format!(
            "cc-gw2-observability-tests-{}",
            chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default()
        ));
        std::fs::create_dir_all(&root).expect("create temp root");
        let db_path = root.join("gateway.db");
        initialize_database(&db_path).expect("init database");

        let now = chrono::Utc::now().timestamp_millis();
        let mut seed = |offset: i64, endpoint: &str, input: Option<i64>, output: Option<i64>| {
            let log_id = insert_request_log(
                &db_path,
                &RequestLogInput {
                    timestamp: now + offset,
                    session_id: None,
                    source_ip: None,
                    client_kind: None,
                    user_agent: None,
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
                log_id,
                &RequestLogUpdate {
                    latency_ms: Some(10),
                    status_code: Some(200),
                    input_tokens: input,
                    output_tokens: output,
                    ..RequestLogUpdate::default()
                },
            )
            .expect("finalize request log");
        };
        seed(0, "anthropic", Some(100), Some(40));
        seed(-1000, "anthropic", Some(50), Some(10));
        seed(-2000, "openai", Some(7), Some(3));
        // NULL tokens (upstream never reported usage) contribute nothing.
        seed(-3000, "anthropic", None, None);
        // Outside the window entirely.
        seed(-20 * 60 * 1000, "anthropic", Some(999), Some(999));

        let totals = get_recent_token_throughput_totals(&db_path, now - 10 * 60 * 1000, None)
            .expect("query totals");
        assert_eq!(totals.requests, 4);
        assert_eq!(totals.input_tokens, 157);
        assert_eq!(totals.output_tokens, 53);

        let anthropic =
            get_recent_token_throughput_totals(&db_path, now - 10 * 60 * 1000, Some("anthropic"))
                .expect("query anthropic totals");
        assert_eq!(anthropic.requests, 3);
        assert_eq!(anthropic.input_tokens, 150);
        assert_eq!(anthropic.output_tokens, 50);

        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn recent_client_kind_metrics_groups_and_counts_sessions() {
        let root = std::env::temp_dir().join(format!(
            "cc-gw2-observability-tests-{}",
            chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default()
        ));
        std::fs::create_dir_all(&root).expect("create temp root");
        let db_path = root.join("gateway.db");
        initialize_database(&db_path).expect("init database");

        let now = chrono::Utc::now().timestamp_millis();
        let mut seed = |offset: i64,
                        client_kind: Option<&str>,
                        session_id: Option<&str>,
                        endpoint: &str,
                        input: Option<i64>| {
            let log_id = insert_request_log(
                &db_path,
                &RequestLogInput {
                    timestamp: now + offset,
                    session_id: session_id.map(ToString::to_string),
                    source_ip: None,
                    client_kind: client_kind.map(ToString::to_string),
                    user_agent: None,
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
                log_id,
                &RequestLogUpdate {
                    latency_ms: Some(10),
                    status_code: Some(200),
                    input_tokens: input,
                    output_tokens: None,
                    ..RequestLogUpdate::default()
                },
            )
            .expect("finalize request log");
        };
        seed(0, Some("codex"), Some("s1"), "anthropic", Some(10));
        seed(-1000, Some("codex"), Some("s2"), "anthropic", Some(20));
        seed(-1500, Some("codex"), Some("s1"), "anthropic", Some(1));
        // Blank kind groups under "unknown" together with pre-column NULL rows.
        seed(-2000, Some(""), Some("s3"), "openai", Some(5));
        seed(-3000, None, None, "openai", None);
        // Outside the 1h window.
        seed(
            -2 * 60 * 60 * 1000,
            Some("codex"),
            Some("s1"),
            "anthropic",
            Some(999),
        );

        let metrics = get_recent_client_kind_metrics(&db_path, now - 60 * 60 * 1000, None)
            .expect("query client kind metrics");
        assert_eq!(metrics.len(), 2);
        assert_eq!(metrics[0].client_kind, "codex");
        assert_eq!(metrics[0].requests, 3);
        assert_eq!(metrics[0].sessions, 2);
        assert_eq!(metrics[0].input_tokens, 31);
        assert_eq!(metrics[1].client_kind, "unknown");
        assert_eq!(metrics[1].requests, 2);
        assert_eq!(metrics[1].sessions, 1);

        let anthropic_only =
            get_recent_client_kind_metrics(&db_path, now - 60 * 60 * 1000, Some("anthropic"))
                .expect("query anthropic client kind metrics");
        assert_eq!(anthropic_only.len(), 1);
        assert_eq!(anthropic_only[0].client_kind, "codex");
        assert_eq!(anthropic_only[0].requests, 3);

        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn dimension_usage_metrics_group_each_axis() {
        let root = std::env::temp_dir().join(format!(
            "cc-gw2-observability-tests-{}",
            chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default()
        ));
        std::fs::create_dir_all(&root).expect("create temp root");
        let db_path = root.join("gateway.db");
        initialize_database(&db_path).expect("init database");

        let now = chrono::Utc::now().timestamp_millis();
        let mut seed = |provider: &str,
                        endpoint: &str,
                        client_kind: Option<&str>,
                        input: i64,
                        cache_read: i64,
                        latency: i64| {
            let log_id = insert_request_log(
                &db_path,
                &RequestLogInput {
                    timestamp: now,
                    session_id: None,
                    source_ip: None,
                    client_kind: client_kind.map(ToString::to_string),
                    user_agent: None,
                    endpoint: endpoint.to_string(),
                    provider: provider.to_string(),
                    model: "m".to_string(),
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
                log_id,
                &RequestLogUpdate {
                    latency_ms: Some(latency),
                    status_code: Some(200),
                    input_tokens: Some(input),
                    output_tokens: None,
                    cache_read_tokens: Some(cache_read),
                    ..RequestLogUpdate::default()
                },
            )
            .expect("finalize request log");
        };
        seed("alpha", "anthropic", Some("codex"), 100, 30, 100);
        seed("alpha", "anthropic", Some("codex"), 50, 10, 300);
        seed("beta", "openai", None, 7, 0, 60);

        let providers = get_dimension_usage_metrics(
            &db_path,
            UsageDimension::Provider,
            7,
            10,
            None,
            &test_pricing(),
        )
        .expect("provider metrics");
        assert_eq!(providers.len(), 2);
        assert_eq!(providers[0].key, "alpha");
        assert_eq!(providers[0].requests, 2);
        assert_eq!(providers[0].input_tokens, 150);
        assert_eq!(providers[0].cache_read_tokens, 40);
        assert_eq!(providers[0].avg_latency_ms, 200);
        assert_eq!(providers[1].key, "beta");

        let endpoints = get_dimension_usage_metrics(
            &db_path,
            UsageDimension::Endpoint,
            7,
            10,
            None,
            &test_pricing(),
        )
        .expect("endpoint metrics");
        assert_eq!(endpoints.len(), 2);
        assert_eq!(endpoints[0].key, "anthropic");

        // NULL client_kind groups under "unknown"; endpoint filter narrows.
        let clients = get_dimension_usage_metrics(
            &db_path,
            UsageDimension::ClientKind,
            7,
            10,
            None,
            &test_pricing(),
        )
        .expect("client metrics");
        assert_eq!(clients.len(), 2);
        assert_eq!(clients[0].key, "codex");
        assert_eq!(clients[0].requests, 2);
        assert_eq!(clients[1].key, "unknown");

        let anthropic_clients = get_dimension_usage_metrics(
            &db_path,
            UsageDimension::ClientKind,
            7,
            10,
            Some("anthropic"),
            &test_pricing(),
        )
        .expect("client metrics for endpoint");
        assert_eq!(anthropic_clients.len(), 1);
        assert_eq!(anthropic_clients[0].key, "codex");

        let _ = std::fs::remove_dir_all(root);
    }

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
                    client_kind: None,
                    user_agent: None,
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
                client_kind: None,
                user_agent: None,
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
                client_kind: None,
                user_agent: None,
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
                client_kind: None,
                user_agent: None,
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

        let overview =
            get_metrics_overview(&db_path, None, &test_pricing()).expect("query overview");
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

        let openai = get_metrics_overview(&db_path, Some("openai"), &test_pricing())
            .expect("query openai overview");
        assert_eq!(openai.totals.requests, 2);
        assert_eq!(openai.today.requests, 2);
        assert_eq!(openai.today.input_tokens, 6);
        assert_eq!(openai.today.output_tokens, 4);
        assert_eq!(openai.today.avg_latency_ms, 80);

        let today_date = chrono::Local::now().format("%Y-%m-%d").to_string();
        let daily =
            get_daily_metrics(&db_path, 14, None, &test_pricing()).expect("query daily metrics");
        assert_eq!(daily.len(), 1);
        assert_eq!(daily[0].date, today_date);
        assert_eq!(daily[0].request_count, 3);
        assert_eq!(daily[0].input_tokens, 16);
        assert_eq!(daily[0].output_tokens, 9);
        assert_eq!(daily[0].avg_latency_ms, 100);

        let openai_daily = get_daily_metrics(&db_path, 14, Some("openai"), &test_pricing())
            .expect("query openai daily metrics");
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
                    client_kind: None,
                    user_agent: None,
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

        let overview =
            get_metrics_overview(&db_path, None, &test_pricing()).expect("query overview");
        // yesterday window = [yesterday_start, today_start) → 2 rows.
        assert_eq!(overview.yesterday.requests, 2);
        assert_eq!(overview.yesterday.input_tokens, 20);
        assert_eq!(overview.yesterday.avg_latency_ms, 100);
        // today window = [today_start, tomorrow_start) → 2 rows.
        assert_eq!(overview.today.requests, 2);
        // totals = all 5 rows.
        assert_eq!(overview.totals.requests, 5);

        // Endpoint filter keeps yesterday scoped to that endpoint.
        let anthropic = get_metrics_overview(&db_path, Some("anthropic"), &test_pricing())
            .expect("query anthropic");
        // anthropic yesterday rows: only the one at yesterday_start
        // (the yesterday_start-1 row is anthropic but falls before yesterday).
        assert_eq!(anthropic.yesterday.requests, 1);
        assert_eq!(anthropic.today.requests, 0);
        assert_eq!(anthropic.totals.requests, 2);

        let openai =
            get_metrics_overview(&db_path, Some("openai"), &test_pricing()).expect("query openai");
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
                client_kind: None,
                user_agent: None,
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
                client_kind: None,
                user_agent: None,
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
                client_kind: None,
                user_agent: None,
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

        let overview =
            get_metrics_overview(&db_path, None, &test_pricing()).expect("query overview");
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
                    client_kind: None,
                    user_agent: None,
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

        let overview =
            get_metrics_overview(&db_path, None, &test_pricing()).expect("query overview");
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
                    client_kind: None,
                    user_agent: None,
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
                client_kind: None,
                user_agent: None,
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
                client_kind: None,
                user_agent: None,
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
                client_kind: None,
                user_agent: None,
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
    fn log_filters_match_requested_model_and_session() {
        let root = std::env::temp_dir().join(format!(
            "cc-gw2-observability-model-session-filter-tests-{}",
            chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default()
        ));
        std::fs::create_dir_all(&root).expect("create temp root");
        let db_path = root.join("gateway.db");
        initialize_database(&db_path).expect("init database");

        let now = chrono::Utc::now().timestamp_millis();
        let requested_id = insert_request_log(
            &db_path,
            &RequestLogInput {
                timestamp: now,
                session_id: Some("sess-alpha".to_string()),
                source_ip: None,
                client_kind: Some("claude-code".to_string()),
                user_agent: None,
                endpoint: "anthropic".to_string(),
                provider: "mock".to_string(),
                model: "upstream-routed".to_string(),
                client_model: Some("claude-sonnet-4".to_string()),
                stream: false,
                api_key_id: None,
                api_key_name: None,
                api_key_value: None,
            },
        )
        .expect("insert requested-model log");

        let other_id = insert_request_log(
            &db_path,
            &RequestLogInput {
                timestamp: now - 1,
                session_id: Some("sess-beta".to_string()),
                source_ip: None,
                client_kind: Some("codex".to_string()),
                user_agent: None,
                endpoint: "openai".to_string(),
                provider: "mock".to_string(),
                model: "other-routed".to_string(),
                client_model: Some("gpt-4o".to_string()),
                stream: false,
                api_key_id: None,
                api_key_name: None,
                api_key_value: None,
            },
        )
        .expect("insert other log");

        // Filtering by the model the client asked for (what the table shows)
        // must find the row even though it was routed elsewhere.
        let by_client_model = query_logs(
            &db_path,
            &LogQuery {
                model: Some("claude-sonnet-4".to_string()),
                limit: 20,
                ..LogQuery::default()
            },
        )
        .expect("query by client model");
        assert_eq!(by_client_model.total, 1);
        assert_eq!(by_client_model.items[0].id, requested_id);

        // The routed model stays searchable too.
        let by_routed_model = query_logs(
            &db_path,
            &LogQuery {
                model: Some("other-routed".to_string()),
                limit: 20,
                ..LogQuery::default()
            },
        )
        .expect("query by routed model");
        assert_eq!(by_routed_model.total, 1);
        assert_eq!(by_routed_model.items[0].id, other_id);

        let by_session = query_logs(
            &db_path,
            &LogQuery {
                session: Some("sess-alpha".to_string()),
                limit: 20,
                ..LogQuery::default()
            },
        )
        .expect("query by session");
        assert_eq!(by_session.total, 1);
        assert_eq!(by_session.items[0].id, requested_id);

        let missing_session = query_logs(
            &db_path,
            &LogQuery {
                session: Some("sess-missing".to_string()),
                limit: 20,
                ..LogQuery::default()
            },
        )
        .expect("query by missing session");
        assert_eq!(missing_session.total, 0);

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
                client_kind: None,
                user_agent: None,
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
                client_kind: None,
                user_agent: None,
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
                client_kind: None,
                user_agent: None,
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

#[cfg(test)]
mod cost_probe {
    use super::*;
    use crate::storage::initialize_database;

    #[test]
    fn probe_cost_query_types() {
        let root = std::env::temp_dir().join("cc-gw2-cost-probe");
        std::fs::create_dir_all(&root).expect("create root");
        let db_path = root.join("gateway.db");
        let _ = std::fs::remove_file(&db_path);
        initialize_database(&db_path).expect("init");
        let id = insert_request_log(
            &db_path,
            &RequestLogInput {
                timestamp: 1,
                session_id: None,
                source_ip: None,
                client_kind: None,
                user_agent: None,
                endpoint: "openai".to_string(),
                provider: "mock".to_string(),
                model: "stub-model".to_string(),
                client_model: None,
                stream: false,
                api_key_id: None,
                api_key_name: None,
                api_key_value: None,
            },
        )
        .expect("insert");
        let _ = id;
        let conn = open_db(&db_path).unwrap();
        let sql = "SELECT model, provider, COUNT(*),
           SUM(input_tokens), SUM(output_tokens), SUM(cache_read_tokens), SUM(cache_creation_tokens)
         FROM request_logs GROUP BY model, provider";
        let mut stmt = conn.prepare(sql).unwrap();
        let col_names: Vec<String> = stmt.column_names().iter().map(|s| s.to_string()).collect();
        eprintln!("columns: {col_names:?}");
        let mut rows = stmt.query([]).unwrap();
        while let Some(row) = rows.next().unwrap() {
            for i in 0..7 {
                eprintln!("col {i} ({}) = {:?}", col_names[i], row.get_ref(i).unwrap());
            }
        }
        let _ = std::fs::remove_dir_all(&root);
    }
}
