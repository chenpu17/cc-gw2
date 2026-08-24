//! Runtime backend health tracking for aggregated-model failover.
//!
//! `BackendHealthRegistry` counts consecutive upstream failures per backend
//! (`providerId:modelId`, shared across every aggregated model that references
//! the backend — an exhausted quota is intrinsic to the backend). A backend
//! that accumulates `consecutive_failures` failures inside the policy window
//! enters cooldown and is skipped by the proxy's failover loop until
//! `cooldown_until` passes. The registry lives in process memory only — a
//! restart resets every backend to healthy and re-probes once.
//!
//! Locking follows the `ratelimit` module's pattern: a `std::sync::Mutex`
//! around a small map with nanosecond critical sections and no awaits; a
//! poisoned lock fails open (every backend treated as available).

use std::collections::HashMap;
use std::sync::Mutex;

use serde::Serialize;

use crate::config::FailoverPolicyConfig;

pub const DEFAULT_CONSECUTIVE_FAILURES: u32 = 3;
pub const DEFAULT_COOLDOWN_SECONDS: u64 = 900;
pub const DEFAULT_FAILURE_WINDOW_SECONDS: u64 = 600;

/// A parsed [`FailoverPolicyConfig`] with defaults applied.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FailoverPolicy {
    pub consecutive_failures: u32,
    pub cooldown_ms: i64,
    pub failure_window_ms: i64,
    pub triggers: StatusTriggerSet,
}

impl Default for FailoverPolicy {
    fn default() -> Self {
        Self {
            consecutive_failures: DEFAULT_CONSECUTIVE_FAILURES,
            cooldown_ms: DEFAULT_COOLDOWN_SECONDS as i64 * 1000,
            failure_window_ms: DEFAULT_FAILURE_WINDOW_SECONDS as i64 * 1000,
            triggers: StatusTriggerSet::default(),
        }
    }
}

impl FailoverPolicy {
    /// Defensive parse for configs that bypass `validate_for_save`: invalid
    /// values fall back to the corresponding default instead of failing the
    /// request path.
    pub fn from_config(config: Option<&FailoverPolicyConfig>) -> Self {
        let Some(config) = config else {
            return Self::default();
        };
        let mut policy = Self::default();
        if let Some(value) = config.consecutive_failures
            && value >= 1
        {
            policy.consecutive_failures = value;
        }
        if let Some(seconds) = config.cooldown_seconds
            && (1..=86_400).contains(&seconds)
        {
            policy.cooldown_ms = seconds as i64 * 1000;
        }
        if let Some(seconds) = config.failure_window_seconds
            && seconds >= 1
        {
            policy.failure_window_ms = seconds as i64 * 1000;
        }
        if let Some(codes) = config.trigger_status_codes.as_deref()
            && let Some(triggers) = StatusTriggerSet::from_codes(codes)
        {
            policy.triggers = triggers;
        }
        policy
    }
}

/// The upstream status codes that count as backend failures.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct StatusTriggerSet {
    /// Bit N set = every Nx status matches (e.g. "5xx" sets bit 5).
    classes: u8,
    /// Explicit status codes, indexed by code (100..600).
    codes: [bool; 600],
}

impl Default for StatusTriggerSet {
    fn default() -> Self {
        // Auth/permission/payment/rate-limit/timeout codes plus all 5xx.
        // 400/404 stay out: a client-side error says nothing about backend
        // health, and switching backends would not change the outcome.
        Self::from_codes(&[
            "401".to_string(),
            "402".to_string(),
            "403".to_string(),
            "408".to_string(),
            "429".to_string(),
            "5xx".to_string(),
        ])
        .expect("default trigger codes are valid")
    }
}

impl StatusTriggerSet {
    /// `None` when any token is malformed ("99", "6xx", "4290", "").
    pub fn from_codes(codes: &[String]) -> Option<Self> {
        let mut set = Self {
            classes: 0,
            codes: [false; 600],
        };
        for code in codes {
            let token = code.trim();
            let bytes = token.as_bytes();
            if bytes.len() != 3 {
                return None;
            }
            if bytes[1] == b'x' && bytes[2] == b'x' {
                let class = bytes[0].checked_sub(b'0')?;
                if !(1..=5).contains(&class) {
                    return None;
                }
                set.classes |= 1 << class;
                continue;
            }
            let status: u16 = token.parse().ok()?;
            if !(100..600).contains(&status) {
                return None;
            }
            set.codes[status as usize] = true;
        }
        Some(set)
    }

    pub fn contains(&self, status: u16) -> bool {
        if !(100..600).contains(&status) {
            return false;
        }
        let class = (status / 100) as u8;
        self.codes[status as usize] || (self.classes & (1 << class)) != 0
    }
}

/// Read-only view of one backend's health, served by the admin snapshot
/// endpoint. Backends absent from the snapshot have never failed.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendHealthSnapshot {
    pub key: String,
    pub provider: String,
    pub model: String,
    pub consecutive_failures: u32,
    pub last_failure_at: Option<i64>,
    pub last_success_at: Option<i64>,
    pub cooldown_until: Option<i64>,
}

impl BackendHealthSnapshot {
    /// `cooling` while inside cooldown, `degraded` once failures accumulate
    /// below the threshold, `healthy` otherwise.
    pub fn state(&self, now_ms: i64) -> &'static str {
        if self.cooldown_until.is_some_and(|until| now_ms < until) {
            "cooling"
        } else if self.consecutive_failures > 0 {
            "degraded"
        } else {
            "healthy"
        }
    }

    pub fn cooldown_remaining_seconds(&self, now_ms: i64) -> Option<i64> {
        self.cooldown_until
            .map(|until| ((until - now_ms) / 1000).max(0))
    }
}

#[derive(Debug, Clone, Copy, Default)]
struct BackendHealthState {
    consecutive_failures: u32,
    /// Epoch ms; 0 = never failed.
    last_failure_at: i64,
    /// Epoch ms; 0 = not cooling.
    cooldown_until: i64,
    /// Epoch ms; 0 = never succeeded (since the last failure).
    last_success_at: i64,
}

#[derive(Default)]
pub struct BackendHealthRegistry {
    entries: Mutex<HashMap<String, BackendHealthState>>,
}

impl BackendHealthRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    /// `false` while the backend is in cooldown. Fails open on lock poison.
    pub fn is_available(&self, key: &str, now_ms: i64) -> bool {
        let Ok(entries) = self.entries.lock() else {
            return true;
        };
        match entries.get(key) {
            Some(state) => now_ms >= state.cooldown_until,
            None => true,
        }
    }

    /// Remaining cooldown in ms while the backend is cooling down; `None`
    /// when available. Powers the failover loop's skip bookkeeping and the
    /// all-cooling 429's `Retry-After`. Fails open (`None`).
    pub fn cooldown_remaining(&self, key: &str, now_ms: i64) -> Option<i64> {
        let Ok(entries) = self.entries.lock() else {
            return None;
        };
        let until = entries.get(key)?.cooldown_until;
        (now_ms < until).then(|| until - now_ms)
    }

    pub fn record_failure(&self, key: &str, policy: &FailoverPolicy, now_ms: i64) {
        let Ok(mut entries) = self.entries.lock() else {
            return;
        };
        let state = entries.entry(key.to_string()).or_default();
        // Failures older than the window stop counting as consecutive, so
        // scattered failures hours apart never trip the backend.
        if state.last_failure_at > 0
            && now_ms.saturating_sub(state.last_failure_at) > policy.failure_window_ms
        {
            state.consecutive_failures = 0;
        }
        state.consecutive_failures = state.consecutive_failures.saturating_add(1);
        state.last_failure_at = now_ms;
        // Cooldown expiry deliberately keeps the counter: one failure during
        // recovery (counter still >= threshold) re-trips immediately, which
        // matches quota-exhausted backends that stay dead all day.
        if state.consecutive_failures >= policy.consecutive_failures {
            state.cooldown_until = now_ms.saturating_add(policy.cooldown_ms);
        }
    }

    /// Clears the failure counter and cooldown; keeps `last_success_at` for
    /// observability. Backends that never failed are not tracked.
    pub fn record_success(&self, key: &str, now_ms: i64) {
        let Ok(mut entries) = self.entries.lock() else {
            return;
        };
        if let Some(state) = entries.get_mut(key) {
            state.consecutive_failures = 0;
            state.cooldown_until = 0;
            state.last_success_at = now_ms;
        }
    }

    pub fn snapshot(&self) -> Vec<BackendHealthSnapshot> {
        let Ok(entries) = self.entries.lock() else {
            return Vec::new();
        };
        let mut snapshots: Vec<BackendHealthSnapshot> = entries
            .iter()
            .map(|(key, state)| {
                let (provider, model) = key.split_once(':').unwrap_or((key.as_str(), ""));
                BackendHealthSnapshot {
                    key: key.clone(),
                    provider: provider.to_string(),
                    model: model.to_string(),
                    consecutive_failures: state.consecutive_failures,
                    last_failure_at: (state.last_failure_at > 0).then_some(state.last_failure_at),
                    last_success_at: (state.last_success_at > 0).then_some(state.last_success_at),
                    cooldown_until: (state.cooldown_until > 0).then_some(state.cooldown_until),
                }
            })
            .collect();
        snapshots.sort_by(|a, b| a.key.cmp(&b.key));
        snapshots
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn policy(consecutive_failures: u32, cooldown_ms: i64, window_ms: i64) -> FailoverPolicy {
        FailoverPolicy {
            consecutive_failures,
            cooldown_ms,
            failure_window_ms: window_ms,
            ..FailoverPolicy::default()
        }
    }

    #[test]
    fn default_triggers_cover_auth_rate_limit_and_5xx() {
        let triggers = StatusTriggerSet::default();
        for status in [200u16, 400, 404, 422] {
            assert!(!triggers.contains(status), "{status} must not trigger");
        }
        for status in [401u16, 402, 403, 408, 429, 500, 502, 503, 599] {
            assert!(triggers.contains(status), "{status} must trigger");
        }
    }

    #[test]
    fn status_trigger_set_rejects_malformed_codes() {
        for bad in ["99", "6xx", "0xx", "4290", "", "41x", "abc"] {
            assert!(
                StatusTriggerSet::from_codes(&[bad.to_string()]).is_none(),
                "{bad} must be rejected"
            );
        }
        assert!(StatusTriggerSet::from_codes(&["429".to_string(), "5xx".to_string()]).is_some());
    }

    #[test]
    fn failures_below_threshold_keep_backend_available() {
        let registry = BackendHealthRegistry::new();
        let policy = policy(3, 60_000, 600_000);
        registry.record_failure("p1:m1", &policy, 1_000);
        registry.record_failure("p1:m1", &policy, 2_000);
        assert!(registry.is_available("p1:m1", 3_000));

        registry.record_failure("p1:m1", &policy, 3_000);
        assert!(!registry.is_available("p1:m1", 3_500));
    }

    #[test]
    fn cooldown_expiry_retrips_on_single_recovery_failure() {
        let registry = BackendHealthRegistry::new();
        let policy = policy(2, 1_000, 600_000);
        registry.record_failure("p1:m1", &policy, 1_000);
        registry.record_failure("p1:m1", &policy, 2_000);
        assert!(!registry.is_available("p1:m1", 2_500));

        // Cooldown expired -> available again, but the counter persists.
        assert!(registry.is_available("p1:m1", 3_500));

        // A single failure during recovery re-trips the cooldown.
        registry.record_failure("p1:m1", &policy, 3_600);
        assert!(!registry.is_available("p1:m1", 3_700));
        assert!(registry.is_available("p1:m1", 5_000));
    }

    #[test]
    fn stale_failures_outside_window_reset_the_counter() {
        let registry = BackendHealthRegistry::new();
        let policy = policy(3, 60_000, 1_000);
        registry.record_failure("p1:m1", &policy, 1_000);
        registry.record_failure("p1:m1", &policy, 1_500);

        // Two failures, then a long gap: the next failure starts a fresh
        // count instead of tripping at 3.
        registry.record_failure("p1:m1", &policy, 10_000);
        assert!(registry.is_available("p1:m1", 10_500));
    }

    #[test]
    fn success_clears_failures_and_cooldown() {
        let registry = BackendHealthRegistry::new();
        let policy = policy(1, 60_000, 600_000);
        registry.record_failure("p1:m1", &policy, 1_000);
        assert!(!registry.is_available("p1:m1", 1_500));

        registry.record_success("p1:m1", 1_800);
        assert!(registry.is_available("p1:m1", 2_000));

        let snapshot = registry.snapshot();
        assert_eq!(snapshot.len(), 1);
        assert_eq!(snapshot[0].consecutive_failures, 0);
        assert_eq!(snapshot[0].state(2_000), "healthy");
    }

    #[test]
    fn snapshot_reports_state_and_cooldown_remaining() {
        let registry = BackendHealthRegistry::new();
        let policy = policy(1, 60_000, 600_000);
        registry.record_failure("p1:m1", &policy, 100_000);

        let snapshot = registry.snapshot();
        assert_eq!(snapshot.len(), 1);
        let backend = &snapshot[0];
        assert_eq!(backend.provider, "p1");
        assert_eq!(backend.model, "m1");
        assert_eq!(backend.state(150_000), "cooling");
        assert_eq!(backend.cooldown_remaining_seconds(150_000), Some(10));
        assert_eq!(backend.state(200_000), "degraded");
        assert_eq!(backend.cooldown_remaining_seconds(200_000), Some(0));
    }

    #[test]
    fn failover_policy_from_config_applies_defaults_for_invalid_values() {
        let policy = FailoverPolicy::from_config(None);
        assert_eq!(policy.consecutive_failures, 3);
        assert_eq!(policy.cooldown_ms, 900_000);
        assert_eq!(policy.failure_window_ms, 600_000);

        let config = FailoverPolicyConfig {
            consecutive_failures: Some(0),
            cooldown_seconds: Some(99_999_999),
            failure_window_seconds: Some(0),
            trigger_status_codes: Some(vec!["garbage".to_string()]),
        };
        let policy = FailoverPolicy::from_config(Some(&config));
        assert_eq!(policy.consecutive_failures, 3);
        assert_eq!(policy.cooldown_ms, 900_000);
        assert_eq!(policy.failure_window_ms, 600_000);
        assert_eq!(policy.triggers, StatusTriggerSet::default());
    }
}
