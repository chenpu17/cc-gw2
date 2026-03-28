use std::path::Path;

use anyhow::{Context, Result};
use rusqlite::Connection;

use crate::api_keys::wildcard_hash;

fn table_columns(conn: &Connection, table: &str) -> Result<Vec<(String, i32)>> {
    let mut stmt = conn.prepare(&format!("PRAGMA table_info({table})"))?;
    let rows = stmt.query_map([], |row| {
        Ok((row.get::<_, String>(1)?, row.get::<_, i32>(5)?))
    })?;

    let mut columns = Vec::new();
    for row in rows {
        columns.push(row?);
    }
    Ok(columns)
}

fn column_exists(conn: &Connection, table: &str, column: &str) -> Result<bool> {
    Ok(table_columns(conn, table)?
        .iter()
        .any(|(name, _)| name == column))
}

fn maybe_add_column(conn: &Connection, table: &str, column: &str, definition: &str) -> Result<()> {
    if !column_exists(conn, table, column)? {
        conn.execute(
            &format!("ALTER TABLE {table} ADD COLUMN {column} {definition}"),
            [],
        )?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn initialize_database_migrates_legacy_schema() {
        let root = std::env::temp_dir().join(format!(
            "cc-gw2-storage-tests-{}",
            chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default()
        ));
        std::fs::create_dir_all(&root).expect("create temp root");
        let db_path = root.join("gateway.db");

        let conn = Connection::open(&db_path).expect("open legacy db");
        conn.execute_batch(
            "
            CREATE TABLE request_logs (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              timestamp INTEGER NOT NULL,
              provider TEXT NOT NULL,
              model TEXT NOT NULL,
              latency_ms INTEGER,
              status_code INTEGER,
              input_tokens INTEGER,
              output_tokens INTEGER,
              error TEXT
            );

            CREATE TABLE request_payloads (
              request_id INTEGER PRIMARY KEY
            );

            CREATE TABLE daily_metrics (
              date TEXT PRIMARY KEY,
              request_count INTEGER DEFAULT 0,
              total_input_tokens INTEGER DEFAULT 0,
              total_output_tokens INTEGER DEFAULT 0,
              total_latency_ms INTEGER DEFAULT 0
            );

            INSERT INTO daily_metrics(date, request_count, total_input_tokens, total_output_tokens, total_latency_ms)
            VALUES ('2026-03-10', 2, 10, 5, 123);
            ",
        )
        .expect("seed legacy schema");
        drop(conn);

        initialize_database(&db_path).expect("migrate database");

        let conn = Connection::open(&db_path).expect("open migrated db");
        let request_log_columns =
            table_columns(&conn, "request_logs").expect("request log columns");
        let request_payload_columns =
            table_columns(&conn, "request_payloads").expect("request payload columns");
        for column in [
            "session_id",
            "source_ip",
            "client_model",
            "cached_tokens",
            "cache_read_tokens",
            "cache_creation_tokens",
            "ttft_ms",
            "tpot_ms",
            "stream",
            "endpoint",
            "api_key_id",
            "api_key_name",
            "api_key_value",
        ] {
            assert!(
                request_log_columns.iter().any(|(name, _)| name == column),
                "missing migrated column {column}"
            );
        }
        for column in [
            "prompt",
            "response",
            "client_request",
            "upstream_request",
            "upstream_response",
            "client_response",
        ] {
            assert!(
                request_payload_columns
                    .iter()
                    .any(|(name, _)| name == column),
                "missing migrated payload column {column}"
            );
        }

        let daily_metrics_columns =
            table_columns(&conn, "daily_metrics").expect("daily metrics columns");
        assert!(
            daily_metrics_columns
                .iter()
                .any(|(name, _)| name == "endpoint")
        );
        assert_eq!(
            daily_metrics_columns
                .iter()
                .filter(|(_, pk)| *pk > 0)
                .count(),
            2
        );

        let migrated_row: (String, i64, i64, i64, i64) = conn
            .query_row(
                "SELECT endpoint, request_count, total_input_tokens, total_output_tokens, total_latency_ms
                 FROM daily_metrics WHERE date = '2026-03-10'",
                [],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                    ))
                },
            )
            .expect("read migrated row");
        assert_eq!(migrated_row, ("anthropic".to_string(), 2, 10, 5, 123));

        let _ = std::fs::remove_dir_all(root);
    }
}

fn migrate_daily_metrics_table(conn: &Connection) -> Result<()> {
    let columns = table_columns(conn, "daily_metrics")?;
    if columns.is_empty() {
        return Ok(());
    }

    let has_endpoint_column = columns.iter().any(|(name, _)| name == "endpoint");
    let primary_key_columns = columns.iter().filter(|(_, pk)| *pk > 0).count();
    let has_composite_primary_key = primary_key_columns > 1;

    if !has_endpoint_column || !has_composite_primary_key {
        let cached_tokens_selector = if columns
            .iter()
            .any(|(name, _)| name == "total_cached_tokens")
        {
            "COALESCE(total_cached_tokens, 0)"
        } else {
            "0"
        };
        let cache_read_selector = if columns
            .iter()
            .any(|(name, _)| name == "total_cache_read_tokens")
        {
            "COALESCE(total_cache_read_tokens, 0)"
        } else {
            "0"
        };
        let cache_creation_selector = if columns
            .iter()
            .any(|(name, _)| name == "total_cache_creation_tokens")
        {
            "COALESCE(total_cache_creation_tokens, 0)"
        } else {
            "0"
        };
        let endpoint_selector = if has_endpoint_column {
            "COALESCE(endpoint, 'anthropic')"
        } else {
            "'anthropic'"
        };

        let sql = format!(
            "
            ALTER TABLE daily_metrics RENAME TO daily_metrics_old;
            CREATE TABLE daily_metrics (
              date TEXT NOT NULL,
              endpoint TEXT NOT NULL DEFAULT 'anthropic',
              request_count INTEGER DEFAULT 0,
              total_input_tokens INTEGER DEFAULT 0,
              total_output_tokens INTEGER DEFAULT 0,
              total_cached_tokens INTEGER DEFAULT 0,
              total_cache_read_tokens INTEGER DEFAULT 0,
              total_cache_creation_tokens INTEGER DEFAULT 0,
              total_latency_ms INTEGER DEFAULT 0,
              PRIMARY KEY (date, endpoint)
            );
            INSERT INTO daily_metrics (
              date,
              endpoint,
              request_count,
              total_input_tokens,
              total_output_tokens,
              total_cached_tokens,
              total_cache_read_tokens,
              total_cache_creation_tokens,
              total_latency_ms
            )
            SELECT
              date,
              {endpoint_selector},
              request_count,
              total_input_tokens,
              total_output_tokens,
              {cached_tokens_selector},
              {cache_read_selector},
              {cache_creation_selector},
              total_latency_ms
            FROM daily_metrics_old;
            DROP TABLE daily_metrics_old;
            "
        );
        conn.execute_batch(&sql)?;
    } else {
        conn.execute(
            "UPDATE daily_metrics SET endpoint = 'anthropic' WHERE endpoint IS NULL OR endpoint = ''",
            [],
        )?;
    }

    conn.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_daily_metrics_date_endpoint ON daily_metrics(date, endpoint)",
        [],
    )?;
    Ok(())
}

pub fn initialize_database(path: &Path) -> Result<()> {
    let conn =
        Connection::open(path).with_context(|| format!("打开数据库失败: {}", path.display()))?;

    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "foreign_keys", "ON")?;

    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS request_logs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          timestamp INTEGER NOT NULL,
          session_id TEXT,
          source_ip TEXT,
          endpoint TEXT NOT NULL DEFAULT 'anthropic',
          provider TEXT NOT NULL,
          model TEXT NOT NULL,
          client_model TEXT,
          stream INTEGER,
          latency_ms INTEGER,
          status_code INTEGER,
          input_tokens INTEGER,
          output_tokens INTEGER,
          cached_tokens INTEGER,
          ttft_ms INTEGER,
          tpot_ms REAL,
          error TEXT,
          api_key_id INTEGER,
          api_key_name TEXT,
          api_key_value TEXT
        );

        CREATE TABLE IF NOT EXISTS request_payloads (
          request_id INTEGER PRIMARY KEY,
          prompt BLOB,
          response BLOB,
          client_request BLOB,
          upstream_request BLOB,
          upstream_response BLOB,
          client_response BLOB,
          FOREIGN KEY(request_id) REFERENCES request_logs(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS daily_metrics (
          date TEXT NOT NULL,
          endpoint TEXT NOT NULL DEFAULT 'anthropic',
          request_count INTEGER DEFAULT 0,
          total_input_tokens INTEGER DEFAULT 0,
          total_output_tokens INTEGER DEFAULT 0,
          total_cached_tokens INTEGER DEFAULT 0,
          total_cache_read_tokens INTEGER DEFAULT 0,
          total_cache_creation_tokens INTEGER DEFAULT 0,
          total_latency_ms INTEGER DEFAULT 0,
          PRIMARY KEY (date, endpoint)
        );

        CREATE TABLE IF NOT EXISTS api_keys (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          description TEXT,
          key_hash TEXT NOT NULL UNIQUE,
          key_ciphertext TEXT,
          key_prefix TEXT,
          key_suffix TEXT,
          is_wildcard INTEGER DEFAULT 0,
          enabled INTEGER DEFAULT 1,
          created_at INTEGER NOT NULL,
          updated_at INTEGER,
          last_used_at INTEGER,
          request_count INTEGER DEFAULT 0,
          total_input_tokens INTEGER DEFAULT 0,
          total_output_tokens INTEGER DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS api_key_audit_logs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          api_key_id INTEGER,
          api_key_name TEXT,
          operation TEXT NOT NULL,
          operator TEXT,
          details TEXT,
          ip_address TEXT,
          created_at TEXT NOT NULL,
          FOREIGN KEY(api_key_id) REFERENCES api_keys(id) ON DELETE SET NULL
        );

        CREATE TABLE IF NOT EXISTS gateway_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          created_at INTEGER NOT NULL,
          type TEXT NOT NULL,
          level TEXT NOT NULL DEFAULT 'info',
          source TEXT,
          title TEXT,
          message TEXT,
          endpoint TEXT,
          ip_address TEXT,
          api_key_id INTEGER,
          api_key_name TEXT,
          api_key_value TEXT,
          user_agent TEXT,
          mode TEXT,
          details TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_gateway_events_created_at ON gateway_events(created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_gateway_events_type ON gateway_events(type);
        CREATE INDEX IF NOT EXISTS idx_gateway_events_level ON gateway_events(level);
        ",
    )?;

    maybe_add_column(&conn, "request_logs", "client_model", "TEXT")?;
    maybe_add_column(&conn, "request_logs", "session_id", "TEXT")?;
    maybe_add_column(&conn, "request_logs", "source_ip", "TEXT")?;
    maybe_add_column(&conn, "request_logs", "cached_tokens", "INTEGER")?;
    maybe_add_column(
        &conn,
        "request_logs",
        "cache_read_tokens",
        "INTEGER DEFAULT 0",
    )?;
    maybe_add_column(
        &conn,
        "request_logs",
        "cache_creation_tokens",
        "INTEGER DEFAULT 0",
    )?;
    maybe_add_column(&conn, "request_logs", "ttft_ms", "INTEGER")?;
    maybe_add_column(&conn, "request_logs", "tpot_ms", "REAL")?;
    maybe_add_column(&conn, "request_logs", "stream", "INTEGER")?;
    maybe_add_column(
        &conn,
        "request_logs",
        "endpoint",
        "TEXT DEFAULT 'anthropic'",
    )?;
    maybe_add_column(&conn, "request_logs", "api_key_id", "INTEGER")?;
    maybe_add_column(&conn, "request_logs", "api_key_name", "TEXT")?;
    maybe_add_column(&conn, "request_logs", "api_key_value", "TEXT")?;
    maybe_add_column(&conn, "request_payloads", "prompt", "BLOB")?;
    maybe_add_column(&conn, "request_payloads", "response", "BLOB")?;
    maybe_add_column(&conn, "request_payloads", "client_request", "BLOB")?;
    maybe_add_column(&conn, "request_payloads", "upstream_request", "BLOB")?;
    maybe_add_column(&conn, "request_payloads", "upstream_response", "BLOB")?;
    maybe_add_column(&conn, "request_payloads", "client_response", "BLOB")?;
    maybe_add_column(&conn, "api_keys", "description", "TEXT")?;
    maybe_add_column(&conn, "api_keys", "key_ciphertext", "TEXT")?;
    maybe_add_column(&conn, "api_keys", "key_prefix", "TEXT")?;
    maybe_add_column(&conn, "api_keys", "key_suffix", "TEXT")?;
    maybe_add_column(&conn, "api_keys", "updated_at", "INTEGER")?;
    maybe_add_column(&conn, "api_keys", "last_used_at", "INTEGER")?;
    maybe_add_column(&conn, "api_keys", "request_count", "INTEGER DEFAULT 0")?;
    maybe_add_column(&conn, "api_keys", "total_input_tokens", "INTEGER DEFAULT 0")?;
    maybe_add_column(
        &conn,
        "api_keys",
        "total_output_tokens",
        "INTEGER DEFAULT 0",
    )?;
    maybe_add_column(&conn, "api_keys", "allowed_endpoints", "TEXT DEFAULT NULL")?;
    maybe_add_column(&conn, "api_keys", "max_concurrency", "INTEGER DEFAULT NULL")?;

    crate::profiler::initialize_profiler_tables(&conn)?;
    migrate_daily_metrics_table(&conn)?;
    maybe_add_column(
        &conn,
        "daily_metrics",
        "total_cached_tokens",
        "INTEGER DEFAULT 0",
    )?;
    maybe_add_column(
        &conn,
        "daily_metrics",
        "total_cache_read_tokens",
        "INTEGER DEFAULT 0",
    )?;
    maybe_add_column(
        &conn,
        "daily_metrics",
        "total_cache_creation_tokens",
        "INTEGER DEFAULT 0",
    )?;

    conn.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash) WHERE key_hash IS NOT NULL",
        [],
    )?;
    conn.execute(
        "UPDATE api_keys
         SET key_hash = ?1,
             updated_at = COALESCE(updated_at, created_at),
             key_prefix = COALESCE(key_prefix, 'WILD'),
             key_suffix = COALESCE(key_suffix, 'KEY')
         WHERE is_wildcard = 1 AND (key_hash IS NULL OR key_hash = '')",
        [wildcard_hash()],
    )?;
    let wildcard_exists: i64 = conn.query_row(
        "SELECT COUNT(*) FROM api_keys WHERE is_wildcard = 1",
        [],
        |row| row.get(0),
    )?;
    if wildcard_exists == 0 {
        let now = chrono::Utc::now().timestamp_millis();
        conn.execute(
            "INSERT INTO api_keys (
                name, description, key_hash, key_prefix, key_suffix, is_wildcard,
                enabled, created_at, updated_at
             ) VALUES ('Wildcard', 'Default fallback key', ?1, 'WILD', 'KEY', 1, 1, ?2, ?2)",
            rusqlite::params![wildcard_hash(), now],
        )?;
    }
    Ok(())
}
