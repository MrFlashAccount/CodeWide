//! The threads this App Server connection is subscribed to.
//!
//! The App Server delivers a thread's turn and item notifications only to the
//! connections subscribed to it: `thread/start`, `thread/resume` and
//! `thread/fork` subscribe the calling connection (`thread/unsubscribe`
//! answers `notSubscribed` for any other). The companion reaches the shared
//! control socket over a fresh connection after every restart or reconnect,
//! while the App Server keeps its threads loaded, so `turn/start` on such a
//! thread succeeds without a `thread not found` rejection and without
//! subscribing: none of that turn's events would reach the companion.
//!
//! This tracker remembers, per connection generation, the threads this
//! connection subscribed to. A turn the companion starts or steers, and a
//! thread it asks to observe, is first resumed without history
//! (`excludeTurns`) unless it is already subscribed in the current
//! generation. A new generation forgets every subscription.

use std::{
    collections::HashSet,
    sync::{Mutex, MutexGuard},
};

use serde_json::Value;

/// Most remembered subscriptions; beyond it the set restarts (each forgotten
/// thread costs one more history-free resume).
const MAX_SUBSCRIPTIONS: usize = 4_096;

/// Methods whose successful result subscribes this connection to the
/// returned thread.
const SUBSCRIBING_METHODS: [&str; 3] = ["thread/start", "thread/resume", "thread/fork"];

#[derive(Default)]
struct State {
    generation: u64,
    threads: HashSet<String>,
}

/// Subscriptions of the current App Server connection generation.
#[derive(Default)]
pub(crate) struct ThreadSubscriptions {
    state: Mutex<State>,
}

impl ThreadSubscriptions {
    fn state(&self, generation: u64) -> MutexGuard<'_, State> {
        let mut state = match self.state.lock() {
            Ok(state) => state,
            Err(poisoned) => poisoned.into_inner(),
        };
        if state.generation != generation {
            state.generation = generation;
            state.threads.clear();
        }
        state
    }

    /// Whether this connection generation subscribed to the thread.
    pub(crate) fn contains(&self, generation: u64, thread_id: &str) -> bool {
        let state = self.state(generation);
        state.generation == generation && state.threads.contains(thread_id)
    }

    /// Records a subscription made in `generation` (read before the request
    /// was sent, so a reconnect in between never counts as subscribed).
    pub(crate) fn record(&self, generation: u64, thread_id: &str) {
        let mut state = self.state(generation);
        if state.threads.len() >= MAX_SUBSCRIPTIONS {
            state.threads.clear();
        }
        state.threads.insert(thread_id.to_owned());
    }

    /// Records the thread a successful subscribing request returned.
    pub(crate) fn observe_response(&self, generation: u64, method: &str, response: &Value) {
        if !SUBSCRIBING_METHODS.contains(&method) || response.get("error").is_some() {
            return;
        }
        if let Some(thread_id) = response
            .pointer("/result/thread/id")
            .and_then(Value::as_str)
        {
            self.record(generation, thread_id);
        }
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn a_new_connection_generation_forgets_every_subscription() {
        let subscriptions = ThreadSubscriptions::default();
        subscriptions.record(1, "t");
        assert!(subscriptions.contains(1, "t"));
        assert!(!subscriptions.contains(2, "t"));
        assert!(
            !subscriptions.contains(1, "t"),
            "the old generation is gone"
        );
    }

    #[test]
    fn only_successful_subscribing_results_are_recorded() {
        let subscriptions = ThreadSubscriptions::default();
        let ok = json!({"id": 1, "result": {"thread": {"id": "t"}}});
        subscriptions.observe_response(1, "thread/read", &ok);
        assert!(!subscriptions.contains(1, "t"));
        subscriptions.observe_response(
            1,
            "thread/resume",
            &json!({"id": 1, "error": {"code": -32600, "message": "no"}}),
        );
        assert!(!subscriptions.contains(1, "t"));
        subscriptions.observe_response(1, "thread/resume", &ok);
        assert!(subscriptions.contains(1, "t"));
    }
}
