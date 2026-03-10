use std::fs;
use std::path::{Path, PathBuf};

use aes_gcm::{
    Aes256Gcm, Nonce,
    aead::{AeadInPlace, KeyInit},
};
use anyhow::{Context, Result, anyhow, bail};
use base64::{Engine as _, engine::general_purpose::STANDARD};
use rand::RngCore;
use rusqlite::{
    Connection, OptionalExtension, Row, params,
    types::ValueRef,
};
use serde::Serialize;
use sha2::{Digest, Sha256};

use crate::events::{RecordEventInput, record_event};
use crate::observability::UsageStats;

const KEY_PREFIX: &str = "sk-ccgw-";
const WILDCARD_HASH: &str = "*";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiKeyListItem {
    pub id: i64,
    pub name: String,
    pub description: Option<String>,
    pub masked_key: Option<String>,
    pub is_wildcard: bool,
    pub enabled: bool,
    pub created_at: Option<String>,
    pub last_used_at: Option<String>,
    pub request_count: i64,
    pub total_input_tokens: i64,
    pub total_output_tokens: i64,
    pub allowed_endpoints: Option<Vec<String>>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateApiKeyResult {
    pub id: i64,
    pub key: String,
    pub name: String,
    pub description: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone)]
pub struct ResolvedApiKey {
    pub id: i64,
    pub name: String,
    pub is_wildcard: bool,
    pub provided_key: String,
}

#[derive(Debug, Clone, Copy)]
pub enum AuthFailureCode {
    Missing,
    Invalid,
    Disabled,
    Forbidden,
}

#[derive(Debug)]
pub struct ApiKeyError {
    pub message: String,
    pub code: AuthFailureCode,
}

impl std::fmt::Display for ApiKeyError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for ApiKeyError {}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiKeyOverviewMetrics {
    pub total_keys: i64,
    pub enabled_keys: i64,
    pub active_keys: i64,
    pub range_days: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiKeyUsageMetric {
    pub api_key_id: Option<i64>,
    pub api_key_name: Option<String>,
    pub requests: i64,
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub last_used_at: Option<String>,
}

fn open_db(db_path: &Path) -> Result<Connection> {
    Connection::open(db_path).with_context(|| format!("failed to open db {}", db_path.display()))
}

fn to_iso_or_null(value: Option<i64>) -> Option<String> {
    let ts = value?;
    if ts <= 0 {
        return None;
    }
    chrono::DateTime::<chrono::Utc>::from_timestamp_millis(ts).map(|dt| dt.to_rfc3339())
}

fn normalize_timestamp_text(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return None;
    }

    if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(trimmed) {
        return Some(dt.with_timezone(&chrono::Utc).to_rfc3339());
    }

    if let Ok(number) = trimmed.parse::<i64>() {
        return to_iso_or_null(Some(number));
    }

    if let Ok(number) = trimmed.parse::<f64>() {
        return to_iso_or_null(Some(number as i64));
    }

    Some(trimmed.to_string())
}

fn row_timestamp_to_iso(row: &Row<'_>, index: usize) -> rusqlite::Result<Option<String>> {
    match row.get_ref(index)? {
        ValueRef::Null => Ok(None),
        ValueRef::Integer(value) => Ok(to_iso_or_null(Some(value))),
        ValueRef::Real(value) => Ok(to_iso_or_null(Some(value as i64))),
        ValueRef::Text(value) => Ok(normalize_timestamp_text(&String::from_utf8_lossy(value))),
        ValueRef::Blob(_) => Ok(None),
    }
}

fn hash_key(value: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(value.as_bytes());
    format!("{:x}", hasher.finalize())
}

fn mask_key(prefix: Option<&str>, suffix: Option<&str>) -> String {
    match (prefix, suffix) {
        (None, None) => "********".to_string(),
        _ => format!("{}****{}", prefix.unwrap_or(""), suffix.unwrap_or("")),
    }
}

pub fn mask_revealed_key(value: &str) -> String {
    let prefix: String = value.chars().take(6).collect();
    let suffix: String = value
        .chars()
        .rev()
        .take(4)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect();
    format!("{prefix}****{suffix}")
}

fn parse_allowed_endpoints(raw: Option<&str>) -> Option<Vec<String>> {
    let raw = raw?;
    let parsed = serde_json::from_str::<Vec<String>>(raw).ok()?;
    let values = parsed
        .into_iter()
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty())
        .fold(Vec::<String>::new(), |mut acc, item| {
            if !acc.contains(&item) {
                acc.push(item);
            }
            acc
        });
    if values.is_empty() {
        None
    } else {
        Some(values)
    }
}

pub fn normalize_allowed_endpoints(value: Option<Vec<String>>) -> Result<Option<Vec<String>>> {
    let Some(value) = value else {
        return Ok(None);
    };
    let mut normalized = Vec::new();
    for raw in value {
        let endpoint = raw.trim();
        if endpoint.is_empty() {
            bail!("allowedEndpoints must not contain empty endpoint IDs");
        }
        if !normalized.iter().any(|item| item == endpoint) {
            normalized.push(endpoint.to_string());
        }
    }
    Ok(if normalized.is_empty() {
        None
    } else {
        Some(normalized)
    })
}

fn encryption_key_path(home_dir: &Path) -> PathBuf {
    home_dir.join("encryption.key")
}

fn decode_key_content(content: &str) -> Option<[u8; 32]> {
    let trimmed = content.trim();
    if trimmed.is_empty() {
        return None;
    }

    if let Ok(decoded) = STANDARD.decode(trimmed) {
        if decoded.len() == 32 {
            let mut key = [0u8; 32];
            key.copy_from_slice(&decoded);
            return Some(key);
        }
    }

    if trimmed.len() == 64 && trimmed.chars().all(|ch| ch.is_ascii_hexdigit()) {
        let mut key = [0u8; 32];
        for (index, slot) in key.iter_mut().enumerate() {
            let start = index * 2;
            let end = start + 2;
            *slot = u8::from_str_radix(&trimmed[start..end], 16).ok()?;
        }
        return Some(key);
    }

    if trimmed.len() == 32 {
        let bytes = trimmed.as_bytes();
        let mut key = [0u8; 32];
        key.copy_from_slice(bytes);
        return Some(key);
    }

    None
}

fn load_or_init_encryption_key(home_dir: &Path) -> Result<[u8; 32]> {
    let path = encryption_key_path(home_dir);
    fs::create_dir_all(home_dir)
        .with_context(|| format!("failed to create {}", home_dir.display()))?;

    if let Ok(content) = fs::read_to_string(&path) {
        if let Some(key) = decode_key_content(&content) {
            return Ok(key);
        }
    }

    let mut key = [0u8; 32];
    rand::rng().fill_bytes(&mut key);
    fs::write(&path, STANDARD.encode(key))
        .with_context(|| format!("failed to write {}", path.display()))?;
    Ok(key)
}

pub fn encrypt_secret(home_dir: &Path, value: &str) -> Result<String> {
    let key = load_or_init_encryption_key(home_dir)?;
    let cipher = Aes256Gcm::new_from_slice(&key)
        .map_err(|_| anyhow!("failed to initialize encryption cipher"))?;
    let mut iv = [0u8; 12];
    rand::rng().fill_bytes(&mut iv);
    let mut buffer = value.as_bytes().to_vec();
    let tag = cipher
        .encrypt_in_place_detached(Nonce::from_slice(&iv), b"", &mut buffer)
        .map_err(|_| anyhow!("failed to encrypt secret"))?;
    Ok(STANDARD.encode([iv.to_vec(), tag.to_vec(), buffer].concat()))
}

pub fn decrypt_secret(home_dir: &Path, payload: &str) -> Option<String> {
    let buffer = STANDARD.decode(payload).ok()?;
    if buffer.len() <= 28 {
        return None;
    }
    let key = load_or_init_encryption_key(home_dir).ok()?;
    let cipher = Aes256Gcm::new_from_slice(&key).ok()?;
    let (iv, tail) = buffer.split_at(12);
    let (tag, ciphertext) = tail.split_at(16);
    let mut data = ciphertext.to_vec();
    let tag = aes_gcm::Tag::from_slice(tag);
    cipher
        .decrypt_in_place_detached(Nonce::from_slice(iv), b"", &mut data, tag)
        .ok()?;
    String::from_utf8(data).ok()
}

fn generate_key() -> String {
    let mut raw = [0u8; 24];
    rand::rng().fill_bytes(&mut raw);
    format!(
        "{KEY_PREFIX}{}",
        STANDARD
            .encode(raw)
            .replace('+', "-")
            .replace('/', "_")
            .replace('=', "")
    )
}

fn record_audit_log(
    conn: &Connection,
    api_key_id: Option<i64>,
    api_key_name: Option<&str>,
    operation: &str,
    details: Option<&str>,
    ip_address: Option<&str>,
) -> Result<()> {
    conn.execute(
        "INSERT INTO api_key_audit_logs (
            api_key_id, api_key_name, operation, operator, details, ip_address, created_at
         ) VALUES (?1, ?2, ?3, NULL, ?4, ?5, ?6)",
        params![
            api_key_id,
            api_key_name,
            operation,
            details,
            ip_address,
            chrono::Utc::now().to_rfc3339()
        ],
    )?;
    Ok(())
}

fn record_management_event(
    db_path: &Path,
    event_type: &str,
    title: &str,
    message: &str,
    api_key_id: Option<i64>,
    api_key_name: Option<&str>,
    ip_address: Option<&str>,
) {
    let _ = record_event(
        db_path,
        &RecordEventInput {
            event_type: event_type.to_string(),
            level: Some("info".to_string()),
            source: Some("api-keys".to_string()),
            title: Some(title.to_string()),
            message: Some(message.to_string()),
            ip_address: ip_address.map(ToString::to_string),
            api_key_id,
            api_key_name: api_key_name.map(ToString::to_string),
            ..RecordEventInput::default()
        },
    );
}

pub fn list_api_keys(db_path: &Path) -> Result<Vec<ApiKeyListItem>> {
    let conn = open_db(db_path)?;
    let mut stmt = conn.prepare(
        "SELECT id, name, description, key_prefix, key_suffix, is_wildcard, enabled,
                created_at, last_used_at, request_count, total_input_tokens, total_output_tokens,
                allowed_endpoints
         FROM api_keys
         ORDER BY is_wildcard DESC, created_at DESC",
    )?;
    let rows = stmt.query_map([], |row| {
        let allowed_endpoints: Option<String> = row.get(12)?;
        Ok(ApiKeyListItem {
            id: row.get(0)?,
            name: row.get(1)?,
            description: row.get(2)?,
            masked_key: if row.get::<_, i64>(5)? != 0 {
                None
            } else {
                Some(mask_key(
                    row.get::<_, Option<String>>(3)?.as_deref(),
                    row.get::<_, Option<String>>(4)?.as_deref(),
                ))
            },
            is_wildcard: row.get::<_, i64>(5)? != 0,
            enabled: row.get::<_, i64>(6)? != 0,
            created_at: row_timestamp_to_iso(row, 7)?,
            last_used_at: row_timestamp_to_iso(row, 8)?,
            request_count: row.get::<_, Option<i64>>(9)?.unwrap_or(0),
            total_input_tokens: row.get::<_, Option<i64>>(10)?.unwrap_or(0),
            total_output_tokens: row.get::<_, Option<i64>>(11)?.unwrap_or(0),
            allowed_endpoints: parse_allowed_endpoints(allowed_endpoints.as_deref()),
        })
    })?;

    let mut items = Vec::new();
    for row in rows {
        items.push(row?);
    }
    Ok(items)
}

pub fn create_api_key(
    db_path: &Path,
    home_dir: &Path,
    name: &str,
    description: Option<&str>,
    allowed_endpoints: Option<Vec<String>>,
    ip_address: Option<&str>,
) -> Result<CreateApiKeyResult> {
    let trimmed_name = name.trim();
    if trimmed_name.is_empty() {
        bail!("Name is required");
    }
    if trimmed_name.len() > 100 {
        bail!("Name too long (max 100 characters)");
    }

    let description = description.map(str::trim).filter(|value| !value.is_empty());
    if description.is_some_and(|value| value.len() > 500) {
        bail!("Description too long (max 500 characters)");
    }

    let normalized_endpoints = normalize_allowed_endpoints(allowed_endpoints)?;
    let serialized_endpoints = normalized_endpoints
        .as_ref()
        .map(serde_json::to_string)
        .transpose()?;

    let key = generate_key();
    let key_hash = hash_key(&key);
    let created_at = chrono::Utc::now().timestamp_millis();
    let encrypted = encrypt_secret(home_dir, &key)?;
    let prefix: String = key.chars().take(6).collect();
    let suffix: String = key
        .chars()
        .rev()
        .take(4)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect();

    let conn = open_db(db_path)?;
    conn.execute(
        "INSERT INTO api_keys (
            name, description, key_hash, key_ciphertext, key_prefix, key_suffix, is_wildcard,
            enabled, created_at, updated_at, allowed_endpoints
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0, 1, ?7, ?7, ?8)",
        params![
            trimmed_name,
            description,
            key_hash,
            encrypted,
            prefix,
            suffix,
            created_at,
            serialized_endpoints
        ],
    )?;
    let id = conn.last_insert_rowid();
    record_audit_log(
        &conn,
        Some(id),
        Some(trimmed_name),
        "create",
        None,
        ip_address,
    )?;
    record_management_event(
        db_path,
        "api_key_created",
        "API key created",
        &format!("Created API key {trimmed_name}"),
        Some(id),
        Some(trimmed_name),
        ip_address,
    );

    Ok(CreateApiKeyResult {
        id,
        key,
        name: trimmed_name.to_string(),
        description: description.map(ToString::to_string),
        created_at: chrono::DateTime::<chrono::Utc>::from_timestamp_millis(created_at)
            .unwrap_or_else(chrono::Utc::now)
            .to_rfc3339(),
    })
}

pub fn update_api_key_settings(
    db_path: &Path,
    id: i64,
    enabled: Option<bool>,
    allowed_endpoints: Option<Option<Vec<String>>>,
    ip_address: Option<&str>,
) -> Result<()> {
    let conn = open_db(db_path)?;
    let existing = conn
        .query_row(
            "SELECT id, name, is_wildcard FROM api_keys WHERE id = ?1",
            params![id],
            |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, i64>(2)? != 0,
                ))
            },
        )
        .optional()?
        .ok_or_else(|| anyhow!("API key not found"))?;

    let mut clauses = Vec::new();
    let mut values: Vec<rusqlite::types::Value> = Vec::new();

    if let Some(enabled) = enabled {
        clauses.push("enabled = ?");
        values.push((if enabled { 1 } else { 0 }).into());
    }

    if let Some(allowed_endpoints) = allowed_endpoints {
        if existing.2 {
            bail!("Cannot set endpoint restrictions on wildcard key");
        }
        let normalized = normalize_allowed_endpoints(allowed_endpoints)?;
        clauses.push("allowed_endpoints = ?");
        values.push(
            normalized
                .as_ref()
                .map(serde_json::to_string)
                .transpose()?
                .into(),
        );
        let details = serde_json::json!({ "allowedEndpoints": normalized }).to_string();
        record_audit_log(
            &conn,
            Some(existing.0),
            Some(existing.1.as_str()),
            "update_endpoints",
            Some(&details),
            ip_address,
        )?;
        record_management_event(
            db_path,
            "api_key_endpoints_updated",
            "API key endpoints updated",
            &format!("Updated allowed endpoints for {}", existing.1),
            Some(existing.0),
            Some(existing.1.as_str()),
            ip_address,
        );
    }

    if clauses.is_empty() {
        bail!("At least one of enabled or allowedEndpoints is required");
    }

    if enabled.is_some() {
        record_audit_log(
            &conn,
            Some(existing.0),
            Some(existing.1.as_str()),
            if enabled == Some(true) {
                "enable"
            } else {
                "disable"
            },
            None,
            ip_address,
        )?;
        record_management_event(
            db_path,
            if enabled == Some(true) {
                "api_key_enabled"
            } else {
                "api_key_disabled"
            },
            if enabled == Some(true) {
                "API key enabled"
            } else {
                "API key disabled"
            },
            &format!(
                "{} API key {}",
                if enabled == Some(true) {
                    "Enabled"
                } else {
                    "Disabled"
                },
                existing.1
            ),
            Some(existing.0),
            Some(existing.1.as_str()),
            ip_address,
        );
    }

    clauses.push("updated_at = ?");
    values.push(chrono::Utc::now().timestamp_millis().into());
    values.push(id.into());
    let sql = format!("UPDATE api_keys SET {} WHERE id = ?", clauses.join(", "));
    conn.execute(&sql, rusqlite::params_from_iter(values.iter()))?;
    Ok(())
}

pub fn delete_api_key(db_path: &Path, id: i64, ip_address: Option<&str>) -> Result<()> {
    let conn = open_db(db_path)?;
    let existing = conn
        .query_row(
            "SELECT id, name, is_wildcard FROM api_keys WHERE id = ?1",
            params![id],
            |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, i64>(2)? != 0,
                ))
            },
        )
        .optional()?
        .ok_or_else(|| anyhow!("API key not found"))?;

    if existing.2 {
        bail!("Cannot delete wildcard key");
    }

    conn.execute("DELETE FROM api_keys WHERE id = ?1", params![id])?;
    record_audit_log(
        &conn,
        Some(existing.0),
        Some(existing.1.as_str()),
        "delete",
        None,
        ip_address,
    )?;
    record_management_event(
        db_path,
        "api_key_deleted",
        "API key deleted",
        &format!("Deleted API key {}", existing.1),
        Some(existing.0),
        Some(existing.1.as_str()),
        ip_address,
    );
    Ok(())
}

pub fn reveal_api_key(db_path: &Path, home_dir: &Path, id: i64) -> Result<Option<String>> {
    let conn = open_db(db_path)?;
    let row = conn
        .query_row(
            "SELECT key_ciphertext, is_wildcard FROM api_keys WHERE id = ?1",
            params![id],
            |row| Ok((row.get::<_, Option<String>>(0)?, row.get::<_, i64>(1)? != 0)),
        )
        .optional()?;

    let Some((ciphertext, is_wildcard)) = row else {
        return Ok(None);
    };
    if is_wildcard {
        return Ok(None);
    }
    Ok(ciphertext
        .as_deref()
        .and_then(|value| decrypt_secret(home_dir, value)))
}

pub fn resolve_api_key(
    db_path: &Path,
    provided_raw: Option<&str>,
    endpoint_id: Option<&str>,
    ip_address: Option<&str>,
    user_agent: Option<&str>,
) -> std::result::Result<ResolvedApiKey, ApiKeyError> {
    let conn = open_db(db_path).map_err(|error| ApiKeyError {
        message: error.to_string(),
        code: AuthFailureCode::Invalid,
    })?;
    let wildcard = conn
        .query_row(
            "SELECT id, name, enabled FROM api_keys WHERE is_wildcard = 1 LIMIT 1",
            [],
            |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, i64>(2)? != 0,
                ))
            },
        )
        .optional()
        .map_err(|error| ApiKeyError {
            message: error.to_string(),
            code: AuthFailureCode::Invalid,
        })?;

    let provided = provided_raw.unwrap_or_default().trim().to_string();
    if provided.is_empty() {
        if let Some((id, name, true)) = wildcard {
            return Ok(ResolvedApiKey {
                id,
                name,
                is_wildcard: true,
                provided_key: String::new(),
            });
        }
        let _ = record_event(
            db_path,
            &RecordEventInput {
                event_type: "api_key_auth_failure".to_string(),
                level: Some("warn".to_string()),
                source: Some("auth".to_string()),
                title: Some("API key missing".to_string()),
                message: Some("Request rejected because no API key was provided".to_string()),
                endpoint: endpoint_id.map(ToString::to_string),
                ip_address: ip_address.map(ToString::to_string),
                user_agent: user_agent.map(ToString::to_string),
                details: Some(serde_json::json!({ "reason": "missing" })),
                ..RecordEventInput::default()
            },
        );
        return Err(ApiKeyError {
            message: "API key is required".to_string(),
            code: AuthFailureCode::Missing,
        });
    }

    let key_hash = hash_key(&provided);
    let existing = conn
        .query_row(
            "SELECT id, name, enabled, is_wildcard, allowed_endpoints
             FROM api_keys
             WHERE key_hash = ?1",
            params![key_hash],
            |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, i64>(2)? != 0,
                    row.get::<_, i64>(3)? != 0,
                    row.get::<_, Option<String>>(4)?,
                ))
            },
        )
        .optional()
        .map_err(|error| ApiKeyError {
            message: error.to_string(),
            code: AuthFailureCode::Invalid,
        })?;

    if let Some((id, name, enabled, is_wildcard, allowed_endpoints)) = existing {
        if !enabled {
            let _ = record_event(
                db_path,
                &RecordEventInput {
                    event_type: "api_key_auth_failure".to_string(),
                    level: Some("warn".to_string()),
                    source: Some("auth".to_string()),
                    title: Some("API key disabled".to_string()),
                    message: Some(format!("Rejected disabled API key {name}")),
                    endpoint: endpoint_id.map(ToString::to_string),
                    ip_address: ip_address.map(ToString::to_string),
                    api_key_id: Some(id),
                    api_key_name: Some(name.clone()),
                    user_agent: user_agent.map(ToString::to_string),
                    details: Some(serde_json::json!({ "reason": "disabled" })),
                    ..RecordEventInput::default()
                },
            );
            return Err(ApiKeyError {
                message: "API key is disabled".to_string(),
                code: AuthFailureCode::Disabled,
            });
        }

        if let (Some(endpoint_id), false, Some(allowed_endpoints)) =
            (endpoint_id, is_wildcard, allowed_endpoints.as_deref())
        {
            let Some(allowed) = parse_allowed_endpoints(Some(allowed_endpoints)) else {
                return Err(ApiKeyError {
                    message: "API key endpoint policy is invalid".to_string(),
                    code: AuthFailureCode::Forbidden,
                });
            };

            if !allowed.is_empty() && !allowed.iter().any(|item| item == endpoint_id) {
                let _ = record_event(
                    db_path,
                    &RecordEventInput {
                        event_type: "api_key_auth_failure".to_string(),
                        level: Some("warn".to_string()),
                        source: Some("auth".to_string()),
                        title: Some("API key endpoint forbidden".to_string()),
                        message: Some(format!(
                            "API key {name} is not allowed to access {endpoint_id}"
                        )),
                        endpoint: Some(endpoint_id.to_string()),
                        ip_address: ip_address.map(ToString::to_string),
                        api_key_id: Some(id),
                        api_key_name: Some(name.clone()),
                        user_agent: user_agent.map(ToString::to_string),
                        details: Some(serde_json::json!({ "reason": "forbidden" })),
                        ..RecordEventInput::default()
                    },
                );
                return Err(ApiKeyError {
                    message: "API key is not authorized for this endpoint".to_string(),
                    code: AuthFailureCode::Forbidden,
                });
            }
        }

        return Ok(ResolvedApiKey {
            id,
            name,
            is_wildcard,
            provided_key: provided,
        });
    }

    if let Some((id, name, true)) = wildcard {
        return Ok(ResolvedApiKey {
            id,
            name,
            is_wildcard: true,
            provided_key: provided,
        });
    }

    let _ = record_event(
        db_path,
        &RecordEventInput {
            event_type: "api_key_auth_failure".to_string(),
            level: Some("warn".to_string()),
            source: Some("auth".to_string()),
            title: Some("Invalid API key".to_string()),
            message: Some("Request rejected because the API key hash did not match".to_string()),
            endpoint: endpoint_id.map(ToString::to_string),
            ip_address: ip_address.map(ToString::to_string),
            user_agent: user_agent.map(ToString::to_string),
            details: Some(
                serde_json::json!({ "reason": "invalid", "hashPrefix": &key_hash[..16] }),
            ),
            ..RecordEventInput::default()
        },
    );
    Err(ApiKeyError {
        message: "Invalid API key provided".to_string(),
        code: AuthFailureCode::Invalid,
    })
}

pub fn record_api_key_usage(db_path: &Path, id: i64, usage: &UsageStats) -> Result<()> {
    let conn = open_db(db_path)?;
    let now = chrono::Utc::now().timestamp_millis();
    conn.execute(
        "UPDATE api_keys
         SET last_used_at = ?1,
             request_count = COALESCE(request_count, 0) + 1,
             total_input_tokens = COALESCE(total_input_tokens, 0) + ?2,
             total_output_tokens = COALESCE(total_output_tokens, 0) + ?3,
             updated_at = ?1
         WHERE id = ?4",
        params![now, usage.input_tokens, usage.output_tokens, id],
    )?;
    Ok(())
}

pub fn get_api_key_overview_metrics(
    db_path: &Path,
    range_days: i64,
    endpoint: Option<&str>,
) -> Result<ApiKeyOverviewMetrics> {
    let conn = open_db(db_path)?;
    let (total_keys, enabled_keys): (i64, i64) = conn.query_row(
        "SELECT COUNT(*), COALESCE(SUM(CASE WHEN enabled = 1 THEN 1 ELSE 0 END), 0) FROM api_keys",
        [],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )?;
    let since =
        chrono::Utc::now().timestamp_millis() - range_days.clamp(1, 90) * 24 * 60 * 60 * 1000;
    let active_keys = if let Some(endpoint) = endpoint {
        conn.query_row(
            "SELECT COUNT(DISTINCT api_key_id)
             FROM request_logs
             WHERE api_key_id IS NOT NULL AND timestamp >= ?1 AND endpoint = ?2",
            params![since, endpoint],
            |row| row.get(0),
        )?
    } else {
        conn.query_row(
            "SELECT COUNT(DISTINCT api_key_id)
             FROM request_logs
             WHERE api_key_id IS NOT NULL AND timestamp >= ?1",
            params![since],
            |row| row.get(0),
        )?
    };

    Ok(ApiKeyOverviewMetrics {
        total_keys,
        enabled_keys,
        active_keys,
        range_days: range_days.clamp(1, 90),
    })
}

pub fn get_api_key_usage_metrics(
    db_path: &Path,
    days: i64,
    limit: i64,
    endpoint: Option<&str>,
) -> Result<Vec<ApiKeyUsageMetric>> {
    let conn = open_db(db_path)?;
    let since = chrono::Utc::now().timestamp_millis() - days.clamp(1, 90) * 24 * 60 * 60 * 1000;
    let sql = if endpoint.is_some() {
        "SELECT api_key_id, api_key_name, COUNT(*), COALESCE(SUM(input_tokens), 0),
                COALESCE(SUM(output_tokens), 0), MAX(timestamp)
         FROM request_logs
         WHERE timestamp >= ?1 AND endpoint = ?2
         GROUP BY api_key_id, api_key_name
         ORDER BY COUNT(*) DESC
         LIMIT ?3"
    } else {
        "SELECT api_key_id, api_key_name, COUNT(*), COALESCE(SUM(input_tokens), 0),
                COALESCE(SUM(output_tokens), 0), MAX(timestamp)
         FROM request_logs
         WHERE timestamp >= ?1
         GROUP BY api_key_id, api_key_name
         ORDER BY COUNT(*) DESC
         LIMIT ?2"
    };
    let mut stmt = conn.prepare(sql)?;
    let mut rows = if let Some(endpoint) = endpoint {
        stmt.query(params![since, endpoint, limit.clamp(1, 50)])?
    } else {
        stmt.query(params![since, limit.clamp(1, 50)])?
    };
    let mut items = Vec::new();
    while let Some(row) = rows.next()? {
        items.push(ApiKeyUsageMetric {
            api_key_id: row.get(0)?,
            api_key_name: row.get(1)?,
            requests: row.get(2)?,
            input_tokens: row.get(3)?,
            output_tokens: row.get(4)?,
            last_used_at: row_timestamp_to_iso(row, 5)?,
        });
    }
    Ok(items)
}

pub fn decrypt_log_api_key_value(home_dir: &Path, value: Option<&str>) -> Option<String> {
    value.and_then(|value| decrypt_secret(home_dir, value))
}

pub fn wildcard_hash() -> &'static str {
    WILDCARD_HASH
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use super::*;

    fn temp_db_path(label: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!(
            "cc-gw2-api-keys-tests-{label}-{}",
            chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default()
        ));
        std::fs::create_dir_all(&root).expect("create temp root");
        root.join("gateway.db")
    }

    #[test]
    fn list_api_keys_accepts_legacy_text_timestamps() {
        let db_path = temp_db_path("legacy-text-ts");
        let conn = Connection::open(&db_path).expect("open db");
        conn.execute_batch(
            "
            CREATE TABLE api_keys (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              name TEXT NOT NULL,
              description TEXT,
              key_prefix TEXT,
              key_suffix TEXT,
              is_wildcard INTEGER DEFAULT 0,
              enabled INTEGER DEFAULT 1,
              created_at TEXT NOT NULL,
              last_used_at TEXT,
              request_count INTEGER DEFAULT 0,
              total_input_tokens INTEGER DEFAULT 0,
              total_output_tokens INTEGER DEFAULT 0,
              allowed_endpoints TEXT DEFAULT NULL
            );

            INSERT INTO api_keys (
              name, description, key_prefix, key_suffix, is_wildcard, enabled, created_at, last_used_at,
              request_count, total_input_tokens, total_output_tokens, allowed_endpoints
            ) VALUES (
              'legacy-key',
              'from old schema',
              'sk-ccg',
              '1234',
              0,
              1,
              '2025-10-05T13:57:16.084Z',
              '1759732218901.0',
              7,
              11,
              13,
              '[\"anthropic\",\"openai\"]'
            );
            ",
        )
        .expect("seed db");
        drop(conn);

        let items = list_api_keys(&db_path).expect("list keys");
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].name, "legacy-key");
        assert_eq!(items[0].created_at.as_deref(), Some("2025-10-05T13:57:16.084+00:00"));
        assert_eq!(items[0].last_used_at.as_deref(), Some("2025-10-06T06:30:18.901+00:00"));
        assert_eq!(
            items[0].allowed_endpoints.as_ref(),
            Some(&vec!["anthropic".to_string(), "openai".to_string()])
        );

        let _ = std::fs::remove_file(&db_path);
        let _ = std::fs::remove_dir_all(db_path.parent().expect("temp root"));
    }
}
