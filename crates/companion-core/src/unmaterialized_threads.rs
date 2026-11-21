//! How App Server reports a `codex.native` thread that has no durable
//! history yet.
//!
//! Codex writes a thread's rollout only with its first user message. Until
//! then the thread exists only in the App Server runtime that started it:
//!
//! - `thread/resume` rejects it with `no rollout found for thread id <id>`,
//!   even while that runtime still holds it loaded;
//! - `thread/read` without turns serves the loaded thread from its live
//!   session, and answers `thread not loaded: <id>` once the runtime no
//!   longer holds it (an App Server restart, or the idle unload of a thread
//!   without subscribers). With no rollout either, nothing can read, resume
//!   or continue that thread again: it is gone.
//!
//! Only these exact messages are classified. Every other failure is an
//! unreadable state that callers must surface, never treat as gone.

use serde_json::{Value, json};

/// What App Server's metadata read says about a thread without a rollout.
#[derive(Debug, PartialEq)]
pub(crate) enum UnmaterializedThread {
    /// The runtime still holds the thread; the value is the `thread/read`
    /// result.
    Loaded(Value),
    /// Neither a rollout nor a runtime holds the thread.
    Gone,
}

/// Whether `message` is App Server's rejection of a rollout-backed request
/// for a thread whose rollout is not written yet.
pub(crate) fn is_rollout_not_found(message: &str, thread_id: &str) -> bool {
    message
        .strip_prefix("no rollout found for thread id ")
        .is_some_and(|id| id == thread_id)
}

/// The metadata read that App Server serves for a loaded thread before its
/// first user message.
pub(crate) fn read_request(request_id: &str, thread_id: &str) -> Value {
    json!({
        "id": request_id,
        "method": "thread/read",
        "params": {"threadId": thread_id, "includeTurns": false},
    })
}

/// Classifies the JSON-RPC response to [`read_request`] for a thread that
/// has no rollout.
///
/// # Errors
///
/// Returns App Server's error message for any other failure, or a protocol
/// reason when the response has neither `result` nor `error`.
pub(crate) fn classify_read(
    response: &Value,
    thread_id: &str,
) -> Result<UnmaterializedThread, String> {
    if let Some(error) = response.get("error") {
        let message = error
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or("unknown App Server error");
        return if is_thread_not_loaded(message, thread_id) {
            Ok(UnmaterializedThread::Gone)
        } else {
            Err(message.to_owned())
        };
    }
    response
        .get("result")
        .cloned()
        .map(UnmaterializedThread::Loaded)
        .ok_or_else(|| "thread/read returned neither a result nor an error".to_owned())
}

fn is_thread_not_loaded(message: &str, thread_id: &str) -> bool {
    message
        .strip_prefix("thread not loaded: ")
        .is_some_and(|id| id == thread_id)
}

#[cfg(test)]
mod tests {
    use super::*;

    const THREAD: &str = "01a173ba-409a-7351-8b9f-1ad25b729110";
    const OTHER: &str = "019fe7af-e2fa-70f3-88e8-99d59e10bd63";

    fn error(message: &str) -> Value {
        json!({"id": "read", "error": {"code": -32600, "message": message}})
    }

    #[test]
    fn only_the_exact_thread_rollout_rejection_is_recognized() {
        assert!(is_rollout_not_found(
            &format!("no rollout found for thread id {THREAD}"),
            THREAD
        ));
        assert!(!is_rollout_not_found(
            &format!("no rollout found for thread id {OTHER}"),
            THREAD
        ));
        assert!(!is_rollout_not_found("access denied", THREAD));
    }

    #[test]
    fn a_loaded_thread_without_a_rollout_is_served_by_its_runtime() {
        let thread = json!({"thread": {"id": THREAD, "status": {"type": "idle"}, "turns": []}});
        let response = json!({"id": "read", "result": thread});
        assert_eq!(
            classify_read(&response, THREAD),
            Ok(UnmaterializedThread::Loaded(thread))
        );
    }

    #[test]
    fn a_thread_neither_stored_nor_loaded_is_gone() {
        assert_eq!(
            classify_read(&error(&format!("thread not loaded: {THREAD}")), THREAD),
            Ok(UnmaterializedThread::Gone)
        );
    }

    #[test]
    fn any_other_failure_stays_unreadable() {
        for message in [
            format!("thread not loaded: {OTHER}"),
            format!("no rollout found for thread id {THREAD}"),
            "failed to read thread: database is locked".to_owned(),
        ] {
            assert_eq!(
                classify_read(&error(&message), THREAD),
                Err(message.clone()),
                "{message}"
            );
        }
        assert!(classify_read(&json!({"id": "read"}), THREAD).is_err());
    }
}
