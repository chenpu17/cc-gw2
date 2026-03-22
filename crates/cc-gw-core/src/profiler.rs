use std::path::Path;

use anyhow::{Context, Result};
use brotli::CompressorWriter;
use rusqlite::{Connection, OptionalExtension, params};
use serde::Serialize;
use std::io::Write;

pub fn compress_profiler_payload(value: &str) -> Result<Vec<u8>> {
    let mut output = Vec::new();
    {
        let mut writer = CompressorWriter::new(&mut output, 4096, 1, 22);
        writer.write_all(value.as_bytes())?;
        writer.flush()?;
    }
    Ok(output)
}

fn open_db(db_path: &Path) -> Result<Connection> {
    let conn = Connection::open(db_path)
        .with_context(|| format!("failed to open db {}", db_path.display()))?;
    conn.pragma_update(None, "foreign_keys", "ON")?;
    Ok(conn)
}

// ---------------------------------------------------------------------------
// Data types
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ProfilerSession {
    pub id: String,
    pub session_id: String,
    pub started_at: i64,
    pub ended_at: Option<i64>,
    pub turn_count: i64,
    pub total_input_tokens: i64,
    pub total_output_tokens: i64,
    pub total_cache_read_tokens: i64,
    pub total_cache_creation_tokens: i64,
    pub total_latency_ms: Option<i64>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ProfilerRecord {
    pub id: i64,
    pub profiler_session_id: String,
    pub log_id: i64,
    pub session_id: String,
    pub turn_index: i64,
    pub timestamp: i64,
    pub model: String,
    pub client_model: Option<String>,
    pub stream: bool,
    pub latency_ms: Option<i64>,
    pub ttft_ms: Option<i64>,
    pub tpot_ms: Option<f64>,
    pub status_code: Option<i64>,
    pub input_tokens: Option<i64>,
    pub output_tokens: Option<i64>,
    pub cache_read_tokens: Option<i64>,
    pub cache_creation_tokens: Option<i64>,
    pub error: Option<String>,
    pub client_request: Option<String>,
    pub client_response: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfilerSessionDetail {
    #[serde(flatten)]
    pub session: ProfilerSession,
    pub records: Vec<ProfilerRecord>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfilerSessionListResponse {
    pub total: i64,
    pub items: Vec<ProfilerSession>,
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

pub fn initialize_profiler_tables(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS profiler_sessions (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          started_at INTEGER NOT NULL,
          ended_at INTEGER,
          turn_count INTEGER NOT NULL DEFAULT 0,
          total_input_tokens INTEGER NOT NULL DEFAULT 0,
          total_output_tokens INTEGER NOT NULL DEFAULT 0,
          total_cache_read_tokens INTEGER NOT NULL DEFAULT 0,
          total_cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
          total_latency_ms INTEGER
        );

        CREATE TABLE IF NOT EXISTS profiler_records (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          profiler_session_id TEXT NOT NULL,
          log_id INTEGER NOT NULL,
          session_id TEXT NOT NULL,
          turn_index INTEGER NOT NULL DEFAULT 0,
          timestamp INTEGER NOT NULL,
          model TEXT NOT NULL,
          client_model TEXT,
          stream INTEGER NOT NULL DEFAULT 0,
          latency_ms INTEGER,
          ttft_ms INTEGER,
          tpot_ms REAL,
          status_code INTEGER,
          input_tokens INTEGER,
          output_tokens INTEGER,
          cache_read_tokens INTEGER,
          cache_creation_tokens INTEGER,
          error TEXT,
          client_request BLOB,
          client_response BLOB,
          FOREIGN KEY(profiler_session_id) REFERENCES profiler_sessions(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_profiler_records_session
          ON profiler_records(profiler_session_id, turn_index);
        CREATE INDEX IF NOT EXISTS idx_profiler_sessions_started_at
          ON profiler_sessions(started_at DESC);
        ",
    )?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Write operations
// ---------------------------------------------------------------------------

pub struct InsertProfilerRecordInput<'a> {
    pub profiler_session_id: &'a str,
    pub log_id: i64,
    pub session_id: &'a str,
    pub turn_index: i64,
    pub timestamp: i64,
    pub model: &'a str,
    pub client_model: Option<&'a str>,
    pub stream: bool,
    pub latency_ms: Option<i64>,
    pub ttft_ms: Option<i64>,
    pub tpot_ms: Option<f64>,
    pub status_code: Option<i64>,
    pub input_tokens: Option<i64>,
    pub output_tokens: Option<i64>,
    pub cache_read_tokens: Option<i64>,
    pub cache_creation_tokens: Option<i64>,
    pub error: Option<&'a str>,
    pub client_request: Option<&'a [u8]>,
    pub client_response: Option<&'a [u8]>,
}

pub struct AppendProfilerTurnInput<'a> {
    pub profiler_session_id: &'a str,
    pub log_id: i64,
    pub session_id: &'a str,
    pub timestamp: i64,
    pub model: &'a str,
    pub client_model: Option<&'a str>,
    pub stream: bool,
    pub latency_ms: Option<i64>,
    pub ttft_ms: Option<i64>,
    pub tpot_ms: Option<f64>,
    pub status_code: Option<i64>,
    pub input_tokens: Option<i64>,
    pub output_tokens: Option<i64>,
    pub cache_read_tokens: Option<i64>,
    pub cache_creation_tokens: Option<i64>,
    pub error: Option<&'a str>,
    pub client_request: Option<&'a [u8]>,
    pub client_response: Option<&'a [u8]>,
}

fn session_end_timestamp(timestamp: i64, latency_ms: Option<i64>) -> Option<i64> {
    latency_ms.map(|latency| timestamp.saturating_add(latency.max(0)))
}

fn next_turn_index(conn: &Connection, profiler_session_id: &str) -> Result<i64> {
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM profiler_records WHERE profiler_session_id = ?1",
        params![profiler_session_id],
        |row| row.get(0),
    )?;
    Ok(count)
}

fn upsert_profiler_session_on(
    conn: &Connection,
    session_id: &str,
    profiler_session_id: &str,
    timestamp: i64,
    input_tokens: i64,
    output_tokens: i64,
    cache_read_tokens: i64,
    cache_creation_tokens: i64,
    latency_ms: Option<i64>,
) -> Result<()> {
    let ended_at = session_end_timestamp(timestamp, latency_ms);
    conn.execute(
        "INSERT INTO profiler_sessions (
           id, session_id, started_at, ended_at, turn_count,
           total_input_tokens, total_output_tokens,
           total_cache_read_tokens, total_cache_creation_tokens,
           total_latency_ms
         ) VALUES (?1, ?2, ?3, ?4, 1, ?5, ?6, ?7, ?8, ?9)
         ON CONFLICT(id) DO UPDATE SET
           ended_at = COALESCE(excluded.ended_at, profiler_sessions.ended_at),
           turn_count = profiler_sessions.turn_count + 1,
           total_input_tokens = profiler_sessions.total_input_tokens + excluded.total_input_tokens,
           total_output_tokens = profiler_sessions.total_output_tokens + excluded.total_output_tokens,
           total_cache_read_tokens = profiler_sessions.total_cache_read_tokens + excluded.total_cache_read_tokens,
           total_cache_creation_tokens = profiler_sessions.total_cache_creation_tokens + excluded.total_cache_creation_tokens,
           total_latency_ms = COALESCE(profiler_sessions.total_latency_ms, 0) + COALESCE(excluded.total_latency_ms, 0)",
        params![
            profiler_session_id,
            session_id,
            timestamp,
            ended_at,
            input_tokens,
            output_tokens,
            cache_read_tokens,
            cache_creation_tokens,
            latency_ms,
        ],
    )?;
    Ok(())
}

fn insert_profiler_record_on(
    conn: &Connection,
    input: &InsertProfilerRecordInput<'_>,
) -> Result<i64> {
    conn.execute(
        "INSERT INTO profiler_records (
           profiler_session_id, log_id, session_id, turn_index, timestamp,
           model, client_model, stream, latency_ms, ttft_ms, tpot_ms,
           status_code, input_tokens, output_tokens, cache_read_tokens,
           cache_creation_tokens, error, client_request, client_response
         ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19)",
        params![
            input.profiler_session_id,
            input.log_id,
            input.session_id,
            input.turn_index,
            input.timestamp,
            input.model,
            input.client_model,
            if input.stream { 1i64 } else { 0i64 },
            input.latency_ms,
            input.ttft_ms,
            input.tpot_ms,
            input.status_code,
            input.input_tokens,
            input.output_tokens,
            input.cache_read_tokens,
            input.cache_creation_tokens,
            input.error,
            input.client_request,
            input.client_response,
        ],
    )?;
    Ok(conn.last_insert_rowid())
}

/// Upsert a profiler session (create if new, update counters if existing).
pub fn upsert_profiler_session(
    db_path: &Path,
    session_id: &str,
    profiler_session_id: &str,
    timestamp: i64,
    input_tokens: i64,
    output_tokens: i64,
    cache_read_tokens: i64,
    cache_creation_tokens: i64,
    latency_ms: Option<i64>,
) -> Result<()> {
    let conn = open_db(db_path)?;
    upsert_profiler_session_on(
        &conn,
        session_id,
        profiler_session_id,
        timestamp,
        input_tokens,
        output_tokens,
        cache_read_tokens,
        cache_creation_tokens,
        latency_ms,
    )
}

pub fn insert_profiler_record(
    db_path: &Path,
    input: &InsertProfilerRecordInput<'_>,
) -> Result<i64> {
    let conn = open_db(db_path)?;
    insert_profiler_record_on(&conn, input)
}

pub fn append_profiler_turn(db_path: &Path, input: &AppendProfilerTurnInput<'_>) -> Result<i64> {
    let mut conn = open_db(db_path)?;
    let tx = conn.transaction()?;
    let turn_index = next_turn_index(&tx, input.profiler_session_id)?;
    upsert_profiler_session_on(
        &tx,
        input.session_id,
        input.profiler_session_id,
        input.timestamp,
        input.input_tokens.unwrap_or(0),
        input.output_tokens.unwrap_or(0),
        input.cache_read_tokens.unwrap_or(0),
        input.cache_creation_tokens.unwrap_or(0),
        input.latency_ms,
    )?;
    tx.execute(
        "INSERT INTO profiler_records (
           profiler_session_id, log_id, session_id, turn_index, timestamp,
           model, client_model, stream, latency_ms, ttft_ms, tpot_ms,
           status_code, input_tokens, output_tokens, cache_read_tokens,
           cache_creation_tokens, error, client_request, client_response
         ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19)",
        params![
            input.profiler_session_id,
            input.log_id,
            input.session_id,
            turn_index,
            input.timestamp,
            input.model,
            input.client_model,
            if input.stream { 1i64 } else { 0i64 },
            input.latency_ms,
            input.ttft_ms,
            input.tpot_ms,
            input.status_code,
            input.input_tokens,
            input.output_tokens,
            input.cache_read_tokens,
            input.cache_creation_tokens,
            input.error,
            input.client_request,
            input.client_response,
        ],
    )?;
    let record_id = tx.last_insert_rowid();
    tx.commit()?;
    Ok(record_id)
}

pub fn delete_profiler_session(db_path: &Path, id: &str) -> Result<bool> {
    let conn = open_db(db_path)?;
    let deleted = conn.execute("DELETE FROM profiler_sessions WHERE id = ?1", params![id])?;
    Ok(deleted > 0)
}

pub fn clear_all_profiler_sessions(db_path: &Path) -> Result<i64> {
    let conn = open_db(db_path)?;
    let deleted = conn.execute("DELETE FROM profiler_sessions", [])?;
    Ok(deleted as i64)
}

// ---------------------------------------------------------------------------
// Read operations
// ---------------------------------------------------------------------------

fn row_to_session(row: &rusqlite::Row<'_>) -> rusqlite::Result<ProfilerSession> {
    Ok(ProfilerSession {
        id: row.get(0)?,
        session_id: row.get(1)?,
        started_at: row.get(2)?,
        ended_at: row.get(3)?,
        turn_count: row.get(4)?,
        total_input_tokens: row.get(5)?,
        total_output_tokens: row.get(6)?,
        total_cache_read_tokens: row.get(7)?,
        total_cache_creation_tokens: row.get(8)?,
        total_latency_ms: row.get(9)?,
    })
}

fn decompress_payload_bytes(value: Option<Vec<u8>>) -> Option<String> {
    use std::io::Read;
    let value = value?;
    if value.is_empty() {
        return Some(String::new());
    }
    let mut decompressed = Vec::new();
    let mut reader = brotli::Decompressor::new(value.as_slice(), 4096);
    if reader.read_to_end(&mut decompressed).is_ok() {
        if let Ok(text) = String::from_utf8(decompressed) {
            return Some(text);
        }
    }
    String::from_utf8(value).ok()
}

fn row_to_record(row: &rusqlite::Row<'_>) -> rusqlite::Result<ProfilerRecord> {
    Ok(ProfilerRecord {
        id: row.get(0)?,
        profiler_session_id: row.get(1)?,
        log_id: row.get(2)?,
        session_id: row.get(3)?,
        turn_index: row.get(4)?,
        timestamp: row.get(5)?,
        model: row.get(6)?,
        client_model: row.get(7)?,
        stream: row.get::<_, i64>(8)? != 0,
        latency_ms: row.get(9)?,
        ttft_ms: row.get(10)?,
        tpot_ms: row.get(11)?,
        status_code: row.get(12)?,
        input_tokens: row.get(13)?,
        output_tokens: row.get(14)?,
        cache_read_tokens: row.get(15)?,
        cache_creation_tokens: row.get(16)?,
        error: row.get(17)?,
        client_request: decompress_payload_bytes(row.get(18)?),
        client_response: decompress_payload_bytes(row.get(19)?),
    })
}

pub fn list_profiler_sessions(
    db_path: &Path,
    limit: i64,
    offset: i64,
) -> Result<ProfilerSessionListResponse> {
    let conn = open_db(db_path)?;
    let total: i64 = conn.query_row("SELECT COUNT(*) FROM profiler_sessions", [], |row| {
        row.get(0)
    })?;
    let mut stmt = conn.prepare(
        "SELECT id, session_id, started_at, ended_at,
                turn_count, total_input_tokens, total_output_tokens,
                total_cache_read_tokens, total_cache_creation_tokens, total_latency_ms
         FROM profiler_sessions
         ORDER BY started_at DESC
         LIMIT ?1 OFFSET ?2",
    )?;
    let rows = stmt.query_map(params![limit.clamp(1, 200), offset.max(0)], row_to_session)?;
    let mut items = Vec::new();
    for row in rows {
        items.push(row?);
    }
    Ok(ProfilerSessionListResponse { total, items })
}

pub fn get_profiler_session_detail(
    db_path: &Path,
    id: &str,
) -> Result<Option<ProfilerSessionDetail>> {
    let conn = open_db(db_path)?;
    let session = conn
        .query_row(
            "SELECT id, session_id, started_at, ended_at,
                    turn_count, total_input_tokens, total_output_tokens,
                    total_cache_read_tokens, total_cache_creation_tokens, total_latency_ms
             FROM profiler_sessions WHERE id = ?1",
            params![id],
            row_to_session,
        )
        .optional()?;
    let Some(session) = session else {
        return Ok(None);
    };
    let mut stmt = conn.prepare(
        "SELECT id, profiler_session_id, log_id, session_id, turn_index, timestamp,
                model, client_model, stream, latency_ms, ttft_ms, tpot_ms,
                status_code, input_tokens, output_tokens, cache_read_tokens,
                cache_creation_tokens, error, client_request, client_response
         FROM profiler_records
         WHERE profiler_session_id = ?1
         ORDER BY turn_index ASC",
    )?;
    let rows = stmt.query_map(params![id], row_to_record)?;
    let mut records = Vec::new();
    for row in rows {
        records.push(row?);
    }
    Ok(Some(ProfilerSessionDetail { session, records }))
}

pub fn get_session_turn_count(db_path: &Path, profiler_session_id: &str) -> Result<i64> {
    let conn = open_db(db_path)?;
    next_turn_index(&conn, profiler_session_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_db_path(label: &str) -> std::path::PathBuf {
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time before unix epoch")
            .as_nanos();
        std::env::temp_dir().join(format!("cc-gw-profiler-{label}-{timestamp}.db"))
    }

    fn init_profiler_db(path: &Path) {
        let conn = open_db(path).expect("open profiler db");
        initialize_profiler_tables(&conn).expect("init profiler tables");
    }

    #[test]
    fn append_profiler_turn_persists_first_turn_and_updates_session_end() {
        let db_path = temp_db_path("append-first-turn");
        init_profiler_db(&db_path);

        append_profiler_turn(
            &db_path,
            &AppendProfilerTurnInput {
                profiler_session_id: "session-a",
                log_id: 1,
                session_id: "session-a",
                timestamp: 1_000,
                model: "stub-model",
                client_model: Some("stub-model"),
                stream: false,
                latency_ms: Some(25),
                ttft_ms: Some(10),
                tpot_ms: Some(7.5),
                status_code: Some(200),
                input_tokens: Some(12),
                output_tokens: Some(4),
                cache_read_tokens: Some(0),
                cache_creation_tokens: Some(0),
                error: None,
                client_request: Some(br#"{"message":"hello"}"#),
                client_response: Some(br#"{"message":"world"}"#),
            },
        )
        .expect("append first turn");

        append_profiler_turn(
            &db_path,
            &AppendProfilerTurnInput {
                profiler_session_id: "session-a",
                log_id: 2,
                session_id: "session-a",
                timestamp: 2_000,
                model: "stub-model",
                client_model: Some("stub-model"),
                stream: false,
                latency_ms: Some(30),
                ttft_ms: Some(12),
                tpot_ms: Some(9.0),
                status_code: Some(200),
                input_tokens: Some(8),
                output_tokens: Some(3),
                cache_read_tokens: Some(1),
                cache_creation_tokens: Some(0),
                error: None,
                client_request: Some(br#"{"message":"follow up"}"#),
                client_response: Some(br#"{"message":"done"}"#),
            },
        )
        .expect("append second turn");

        let detail = get_profiler_session_detail(&db_path, "session-a")
            .expect("read session detail")
            .expect("session detail exists");
        assert_eq!(detail.session.turn_count, 2);
        assert_eq!(detail.records.len(), 2);
        assert_eq!(detail.records[0].turn_index, 0);
        assert_eq!(detail.records[1].turn_index, 1);
        assert_eq!(
            detail.records[0].client_request.as_deref(),
            Some(r#"{"message":"hello"}"#)
        );
        assert_eq!(
            detail.records[1].client_request.as_deref(),
            Some(r#"{"message":"follow up"}"#)
        );
        assert_eq!(detail.session.ended_at, Some(2_030));
        assert_eq!(detail.session.total_latency_ms, Some(55));

        let _ = std::fs::remove_file(db_path);
    }

    #[test]
    fn clear_profiler_sessions_removes_records_before_reusing_session_id() {
        let db_path = temp_db_path("clear-reuse");
        init_profiler_db(&db_path);

        append_profiler_turn(
            &db_path,
            &AppendProfilerTurnInput {
                profiler_session_id: "session-reuse",
                log_id: 1,
                session_id: "session-reuse",
                timestamp: 1_000,
                model: "stub-model",
                client_model: None,
                stream: false,
                latency_ms: Some(10),
                ttft_ms: None,
                tpot_ms: None,
                status_code: Some(200),
                input_tokens: Some(4),
                output_tokens: Some(2),
                cache_read_tokens: Some(0),
                cache_creation_tokens: Some(0),
                error: None,
                client_request: Some(br#"{"message":"old"}"#),
                client_response: Some(br#"{"message":"old-response"}"#),
            },
        )
        .expect("append original turn");

        assert_eq!(
            clear_all_profiler_sessions(&db_path).expect("clear profiler sessions"),
            1
        );

        append_profiler_turn(
            &db_path,
            &AppendProfilerTurnInput {
                profiler_session_id: "session-reuse",
                log_id: 2,
                session_id: "session-reuse",
                timestamp: 2_000,
                model: "stub-model",
                client_model: None,
                stream: false,
                latency_ms: Some(12),
                ttft_ms: None,
                tpot_ms: None,
                status_code: Some(200),
                input_tokens: Some(5),
                output_tokens: Some(3),
                cache_read_tokens: Some(0),
                cache_creation_tokens: Some(0),
                error: None,
                client_request: Some(br#"{"message":"new"}"#),
                client_response: Some(br#"{"message":"new-response"}"#),
            },
        )
        .expect("append reused turn");

        let detail = get_profiler_session_detail(&db_path, "session-reuse")
            .expect("read reused session detail")
            .expect("reused session exists");
        assert_eq!(detail.session.turn_count, 1);
        assert_eq!(detail.records.len(), 1);
        assert_eq!(detail.records[0].turn_index, 0);
        assert_eq!(
            detail.records[0].client_request.as_deref(),
            Some(r#"{"message":"new"}"#)
        );

        let _ = std::fs::remove_file(db_path);
    }
}
