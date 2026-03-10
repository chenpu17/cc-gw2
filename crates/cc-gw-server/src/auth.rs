use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use base64::{Engine as _, engine::general_purpose::STANDARD};
use rand::RngCore;
use scrypt::{Params as ScryptParams, scrypt};
use sha2::{Digest, Sha256};

const SESSION_TTL_MS: i64 = 1000 * 60 * 60 * 12;
pub const SESSION_COOKIE_NAME: &str = "ccgw_session";

#[derive(Debug, Clone)]
pub struct SessionRecord {
    pub token: String,
    pub username: String,
    pub expires_at: i64,
}

#[derive(Clone, Default)]
pub struct SessionStore {
    sessions: Arc<Mutex<HashMap<String, SessionRecord>>>,
}

impl SessionStore {
    pub fn issue_session(&self, username: &str) -> SessionRecord {
        self.purge_expired();
        let mut token_bytes = [0u8; 32];
        rand::rng().fill_bytes(&mut token_bytes);
        let token = STANDARD
            .encode(token_bytes)
            .replace('+', "-")
            .replace('/', "_")
            .replace('=', "");
        let record = SessionRecord {
            token: token.clone(),
            username: username.to_string(),
            expires_at: chrono::Utc::now().timestamp_millis() + SESSION_TTL_MS,
        };
        self.sessions
            .lock()
            .expect("session lock poisoned")
            .insert(token.clone(), record.clone());
        record
    }

    pub fn read_session(&self, cookie_header: Option<&str>) -> Option<SessionRecord> {
        let token = get_session_token(cookie_header)?;
        self.purge_expired();
        let mut sessions = self.sessions.lock().expect("session lock poisoned");
        let session = sessions.get_mut(&token)?;
        if session.expires_at <= chrono::Utc::now().timestamp_millis() {
            sessions.remove(&token);
            return None;
        }
        session.expires_at = chrono::Utc::now().timestamp_millis() + SESSION_TTL_MS;
        Some(session.clone())
    }

    pub fn revoke_session(&self, token: Option<&str>) {
        if let Some(token) = token {
            self.sessions
                .lock()
                .expect("session lock poisoned")
                .remove(token);
        }
    }

    pub fn revoke_all(&self) {
        self.sessions.lock().expect("session lock poisoned").clear();
    }

    fn purge_expired(&self) {
        let now = chrono::Utc::now().timestamp_millis();
        self.sessions
            .lock()
            .expect("session lock poisoned")
            .retain(|_, session| session.expires_at > now);
    }
}

pub fn sanitize_username(username: Option<&str>) -> Option<String> {
    username
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

fn parse_cookie(header: &str) -> HashMap<String, String> {
    let mut result = HashMap::new();
    for part in header.split(';') {
        let entry = part.trim();
        if entry.is_empty() {
            continue;
        }
        let mut kv = entry.splitn(2, '=');
        let Some(key) = kv.next() else {
            continue;
        };
        let value = kv.next().unwrap_or_default();
        result.insert(key.to_string(), value.to_string());
    }
    result
}

pub fn get_session_token(cookie_header: Option<&str>) -> Option<String> {
    let cookie_header = cookie_header?;
    parse_cookie(cookie_header).remove(SESSION_COOKIE_NAME)
}

pub fn build_session_cookie(token: &str) -> String {
    let expires = chrono::DateTime::<chrono::Utc>::from_timestamp_millis(
        chrono::Utc::now().timestamp_millis() + SESSION_TTL_MS,
    )
    .unwrap_or_else(chrono::Utc::now);
    format!(
        "{SESSION_COOKIE_NAME}={token}; Path=/; HttpOnly; SameSite=Strict; Max-Age={}; Expires={}",
        SESSION_TTL_MS / 1000,
        expires.to_rfc2822()
    )
}

pub fn clear_session_cookie() -> String {
    format!(
        "{SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT"
    )
}

pub fn create_password_record(password: &str) -> (String, String) {
    let mut salt = [0u8; 16];
    rand::rng().fill_bytes(&mut salt);
    let salt_text = salt
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    let mut output = [0u8; 64];
    let params = ScryptParams::new(14, 8, 1, 64).expect("valid scrypt params");
    scrypt(
        password.as_bytes(),
        salt_text.as_bytes(),
        &params,
        &mut output,
    )
    .expect("valid scrypt inputs");
    (STANDARD.encode(output), salt_text)
}

fn verify_scrypt_password(password: &str, password_hash: &str, password_salt: &str) -> bool {
    let Ok(expected) = STANDARD.decode(password_hash) else {
        return false;
    };
    let mut actual = vec![0u8; expected.len()];
    let Ok(params) = ScryptParams::new(14, 8, 1, expected.len()) else {
        return false;
    };
    if scrypt(
        password.as_bytes(),
        password_salt.as_bytes(),
        &params,
        &mut actual,
    )
    .is_err()
    {
        return false;
    }
    constant_time_eq(&expected, &actual)
}

fn verify_legacy_sha_password(password: &str, password_hash: &str, password_salt: &str) -> bool {
    if password_hash.len() != 64 || !password_hash.chars().all(|ch| ch.is_ascii_hexdigit()) {
        return false;
    }
    let mut hasher = Sha256::new();
    hasher.update(password_salt.as_bytes());
    hasher.update(password.as_bytes());
    format!("{:x}", hasher.finalize()).eq_ignore_ascii_case(password_hash)
}

fn constant_time_eq(left: &[u8], right: &[u8]) -> bool {
    if left.len() != right.len() {
        return false;
    }
    let mut diff = 0u8;
    for (l, r) in left.iter().zip(right.iter()) {
        diff |= l ^ r;
    }
    diff == 0
}

pub fn verify_password(
    password: &str,
    password_hash: Option<&str>,
    password_salt: Option<&str>,
) -> bool {
    let Some(password_hash) = password_hash else {
        return false;
    };
    let Some(password_salt) = password_salt else {
        return false;
    };
    verify_scrypt_password(password, password_hash, password_salt)
        || verify_legacy_sha_password(password, password_hash, password_salt)
}
