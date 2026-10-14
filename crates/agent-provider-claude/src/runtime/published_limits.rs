//! The subscription limits sessions and the probe observe, published to the
//! provider's `subscribe_rate_limits` watch.

use std::sync::{Arc, Mutex, PoisonError};

use agent_core::model::{ProviderRateLimitWindow, ProviderRateLimits};
use serde_json::Value;
use tokio::sync::watch;

use crate::{live::rate_limits::RateLimitReporter, session::ports::RateLimitSink};

type Clock = Box<dyn Fn() -> i64 + Send>;
type Publish = Box<dyn FnMut(&ProviderRateLimits) + Send>;

/// The rate-limit owner of the provider.
pub struct PublishedLimits {
    reporter: Mutex<RateLimitReporter<Clock, Publish>>,
}

impl PublishedLimits {
    /// Publishes every changed snapshot to `watch`.
    #[must_use]
    pub fn new(watch: Arc<watch::Sender<Option<ProviderRateLimits>>>) -> Self {
        let clock: Clock = Box::new(now_ms);
        let publish: Publish = Box::new(move |limits| {
            watch.send_if_modified(|current| {
                if current.as_ref() == Some(limits) {
                    return false;
                }
                *current = Some(limits.clone());
                true
            });
        });
        Self {
            reporter: Mutex::new(RateLimitReporter::new(clock, publish)),
        }
    }

    fn reporter(&self) -> std::sync::MutexGuard<'_, RateLimitReporter<Clock, Publish>> {
        self.reporter.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

impl RateLimitSink for PublishedLimits {
    fn reported(&self, window: ProviderRateLimitWindow) {
        self.reporter().reported(window);
    }

    fn claim_usage_read(&self) -> bool {
        self.reporter().claim_usage_read()
    }

    fn usage_read(&self, response: &Value) {
        self.reporter().usage_read(response);
    }
}

/// Milliseconds since the epoch; 0 before it.
#[must_use]
pub fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .ok()
        .and_then(|elapsed| i64::try_from(elapsed.as_millis()).ok())
        .unwrap_or(0)
}
