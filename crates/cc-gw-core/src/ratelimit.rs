use std::collections::{HashMap, VecDeque};
use std::sync::Mutex;
use std::time::Duration;

use tokio::time::Instant;

/// Sliding window width for per-provider RPM accounting.
pub const RPM_WINDOW: Duration = Duration::from_secs(60);

/// Default hold time when `rpm_max_wait_seconds` is not configured.
pub const DEFAULT_RPM_MAX_WAIT_SECONDS: u64 = 30;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AcquireOutcome {
    /// Slot granted; `waited` is how long the request was held in queue.
    Admitted { waited: Duration },
    /// Wait would exceed the configured max wait; reject with 429 + Retry-After.
    Rejected { retry_after: Duration },
}

/// Per-provider RPM admission control with a hold-and-wait queue.
///
/// Each provider keeps an ascending deque of dispatch timestamps (past
/// admissions plus future reservations). Under one lock a caller computes its
/// dispatch instant — `now` while the window has capacity, otherwise the
/// moment the `limit`-th oldest entry expires — and reserves it before
/// sleeping. This is single-pass, strictly FIFO (later arrivals always get an
/// equal-or-later slot), and wakes exactly one waiter per freed slot.
///
/// Invariant: for sorted entries, `e[i] == e[i-limit] + 60s` for `i >= limit`,
/// so any 60s window contains at most `limit` dispatches — the upstream never
/// sees RPM above the configured cap. A request dropped while waiting (client
/// disconnect) removes its reservation via `Reservation::drop`.
pub struct ProviderRateLimiter {
    windows: Mutex<HashMap<String, VecDeque<Instant>>>,
}

/// Removes the reserved slot when the waiting future is dropped mid-sleep.
struct Reservation<'a> {
    limiter: &'a ProviderRateLimiter,
    provider_id: String,
    slot: Instant,
    armed: bool,
}

impl Drop for Reservation<'_> {
    fn drop(&mut self) {
        if !self.armed {
            return;
        }
        // Poisoned lock: fail open, mirroring RequestActivityGuard.
        let Ok(mut windows) = self.limiter.windows.lock() else {
            return;
        };
        if let Some(deque) = windows.get_mut(&self.provider_id) {
            if let Some(index) = deque.iter().position(|time| *time == self.slot) {
                deque.remove(index);
            }
            if deque.is_empty() {
                windows.remove(&self.provider_id);
            }
        }
    }
}

impl Default for ProviderRateLimiter {
    fn default() -> Self {
        Self::new()
    }
}

impl ProviderRateLimiter {
    pub fn new() -> Self {
        Self {
            windows: Mutex::new(HashMap::new()),
        }
    }

    /// Acquires a dispatch slot for `provider_id`. Callers gate on
    /// `rpm_limit > 0` themselves; values below 1 are treated as 1 here.
    pub async fn acquire(
        &self,
        provider_id: &str,
        rpm_limit: u32,
        max_wait: Duration,
    ) -> AcquireOutcome {
        let arrival = Instant::now();
        let limit = rpm_limit.max(1) as usize;
        let dispatch_at = {
            // Poisoned lock: fail open, mirroring RequestActivityGuard.
            let Ok(mut windows) = self.windows.lock() else {
                return AcquireOutcome::Admitted {
                    waited: Duration::ZERO,
                };
            };
            let deque = windows.entry(provider_id.to_string()).or_default();
            while let Some(front) = deque.front() {
                if *front <= arrival && arrival.duration_since(*front) >= RPM_WINDOW {
                    deque.pop_front();
                } else {
                    break;
                }
            }
            let dispatch_at = if deque.len() < limit {
                arrival
            } else {
                deque[deque.len() - limit] + RPM_WINDOW
            };
            if dispatch_at > arrival + max_wait {
                return AcquireOutcome::Rejected {
                    retry_after: dispatch_at.saturating_duration_since(arrival),
                };
            }
            deque.push_back(dispatch_at);
            dispatch_at
        };
        let mut reservation = Reservation {
            limiter: self,
            provider_id: provider_id.to_string(),
            slot: dispatch_at,
            armed: true,
        };
        tokio::time::sleep_until(dispatch_at).await;
        // Admission is real now; keep the timestamp so the window stays bounded.
        reservation.armed = false;
        AcquireOutcome::Admitted {
            waited: dispatch_at.saturating_duration_since(arrival),
        }
    }

    /// Number of dispatch timestamps currently tracked for `provider_id`
    /// (past admissions plus outstanding reservations). Test/observability aid.
    pub fn window_len(&self, provider_id: &str) -> usize {
        self.windows
            .lock()
            .map(|windows| {
                windows
                    .get(provider_id)
                    .map(VecDeque::len)
                    .unwrap_or_default()
            })
            .unwrap_or_default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::time::advance;

    #[tokio::test(start_paused = true)]
    async fn admits_up_to_limit_without_waiting() {
        let limiter = ProviderRateLimiter::new();
        for _ in 0..3 {
            let outcome = limiter.acquire("p1", 3, Duration::from_secs(30)).await;
            assert_eq!(
                outcome,
                AcquireOutcome::Admitted {
                    waited: Duration::ZERO
                }
            );
        }
        assert_eq!(limiter.window_len("p1"), 3);
    }

    #[tokio::test(start_paused = true)]
    async fn nth_request_waits_until_window_slot_expires() {
        let limiter = ProviderRateLimiter::new();
        limiter.acquire("p1", 1, Duration::from_secs(120)).await;

        let waiter =
            tokio::spawn(async move { limiter.acquire("p1", 1, Duration::from_secs(120)).await });
        tokio::task::yield_now().await;
        advance(RPM_WINDOW).await;

        let outcome = waiter.await.unwrap();
        assert_eq!(outcome, AcquireOutcome::Admitted { waited: RPM_WINDOW });
    }

    #[tokio::test(start_paused = true)]
    async fn rejects_immediately_when_max_wait_would_be_exceeded() {
        let limiter = ProviderRateLimiter::new();
        limiter.acquire("p1", 1, Duration::from_secs(30)).await;

        let outcome = limiter.acquire("p1", 1, Duration::ZERO).await;
        assert_eq!(
            outcome,
            AcquireOutcome::Rejected {
                retry_after: RPM_WINDOW
            }
        );
        // Rejection must not leave a phantom reservation behind.
        assert_eq!(limiter.window_len("p1"), 1);
    }

    #[tokio::test(start_paused = true)]
    async fn windows_are_independent_per_provider() {
        let limiter = ProviderRateLimiter::new();
        limiter.acquire("p1", 1, Duration::ZERO).await;

        let outcome = limiter.acquire("p2", 1, Duration::from_secs(30)).await;
        assert_eq!(
            outcome,
            AcquireOutcome::Admitted {
                waited: Duration::ZERO
            }
        );
        assert_eq!(limiter.window_len("p1"), 1);
        assert_eq!(limiter.window_len("p2"), 1);
    }

    #[tokio::test(start_paused = true)]
    async fn expired_entries_are_pruned_on_next_acquire() {
        let limiter = ProviderRateLimiter::new();
        limiter.acquire("p1", 2, Duration::from_secs(30)).await;
        limiter.acquire("p1", 2, Duration::from_secs(30)).await;

        advance(RPM_WINDOW + Duration::from_secs(1)).await;
        let outcome = limiter.acquire("p1", 2, Duration::from_secs(30)).await;
        assert_eq!(
            outcome,
            AcquireOutcome::Admitted {
                waited: Duration::ZERO
            }
        );
        // Two expired entries pruned, one fresh admission recorded.
        assert_eq!(limiter.window_len("p1"), 1);
    }

    #[tokio::test(start_paused = true)]
    async fn dropped_waiter_releases_its_reservation() {
        let limiter = std::sync::Arc::new(ProviderRateLimiter::new());
        limiter.acquire("p1", 1, Duration::from_secs(30)).await;

        let waiter_limiter = std::sync::Arc::clone(&limiter);
        let waiter = tokio::spawn(async move {
            waiter_limiter
                .acquire("p1", 1, Duration::from_secs(120))
                .await
        });
        tokio::task::yield_now().await;
        // Admission + outstanding reservation.
        assert_eq!(limiter.window_len("p1"), 2);

        waiter.abort();
        let _ = waiter.await;
        tokio::task::yield_now().await;
        assert_eq!(limiter.window_len("p1"), 1);

        // Next arrival may now take the freed slot one window earlier.
        advance(RPM_WINDOW).await;
        let outcome = limiter.acquire("p1", 1, Duration::from_secs(120)).await;
        assert_eq!(
            outcome,
            AcquireOutcome::Admitted {
                waited: Duration::ZERO
            }
        );
    }

    #[tokio::test(start_paused = true)]
    async fn lowered_limit_schedules_behind_existing_reservations() {
        let limiter = std::sync::Arc::new(ProviderRateLimiter::new());
        limiter.acquire("p1", 2, Duration::from_secs(30)).await;
        limiter.acquire("p1", 2, Duration::from_secs(30)).await;

        // Reserves the t0+60 slot under limit=2.
        let waiter = {
            let limiter = std::sync::Arc::clone(&limiter);
            tokio::spawn(async move { limiter.acquire("p1", 2, Duration::from_secs(300)).await })
        };
        tokio::task::yield_now().await;
        assert_eq!(limiter.window_len("p1"), 3);

        advance(Duration::from_secs(1)).await;

        // Limit lowered to 1 mid-flight: the next dispatch must land after
        // the outstanding reservation, never before it.
        let late = {
            let limiter = std::sync::Arc::clone(&limiter);
            tokio::spawn(async move { limiter.acquire("p1", 1, Duration::from_secs(600)).await })
        };
        tokio::task::yield_now().await;

        advance(Duration::from_secs(59)).await;
        assert_eq!(
            waiter.await.unwrap(),
            AcquireOutcome::Admitted { waited: RPM_WINDOW }
        );

        advance(Duration::from_secs(60)).await;
        assert_eq!(
            late.await.unwrap(),
            AcquireOutcome::Admitted {
                waited: Duration::from_secs(119)
            }
        );
    }
}
