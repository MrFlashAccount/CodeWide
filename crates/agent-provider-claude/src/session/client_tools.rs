//! The companion's client tool calls of one session.
//!
//! Claude calls a client tool through the in-process MCP server
//! (`mcp_message` `tools/call`); the call runs on its own task against the
//! companion's `ClientToolHost` and its result answers the MCP request. A
//! call's `callId` is the `tool_use` id of the oldest open item of that tool
//! the turn shows and no earlier call claimed (Claude writes the `tool_use`
//! before it calls the tool, so the item is already there), else a fresh
//! UUID. Every call still running when its turn ends is cancelled and
//! answered as cancelled.

use std::collections::{HashMap, HashSet};

use agent_core::model::ToolCallResult;
use tokio::task::AbortHandle;

/// The result a cancelled call answers Claude with.
pub const TOOL_CALL_CANCELLED: &str = "The tool call was cancelled.";
/// The result of a call outside a turn.
pub const NO_ACTIVE_TURN: &str = "No turn is active.";

/// A running call: its task and the MCP request it answers.
struct Running {
    task: AbortHandle,
    request_id: String,
    mcp_id: serde_json::Value,
}

/// The session's running client tool calls.
#[derive(Default)]
pub struct ClientToolCalls {
    running: HashMap<String, Running>,
    claimed: HashSet<String>,
}

/// A call [`ClientToolCalls::cancel_all`] stopped; answer Claude's request.
pub struct Cancelled {
    pub request_id: String,
    pub mcp_id: serde_json::Value,
}

impl ClientToolCalls {
    /// The `callId` of a call of `tool`: the first of `open` (the turn's
    /// open items of that tool, oldest first) no call claimed yet, else
    /// `fresh()`.
    pub fn claim(&mut self, open: Vec<String>, fresh: impl FnOnce() -> String) -> String {
        match open.into_iter().find(|id| !self.claimed.contains(id)) {
            Some(id) => {
                self.claimed.insert(id.clone());
                id
            }
            None => fresh(),
        }
    }

    /// Tracks the task running the call `call_id` for Claude's request
    /// `request_id`.
    pub fn started(
        &mut self,
        call_id: String,
        task: AbortHandle,
        request_id: String,
        mcp_id: serde_json::Value,
    ) {
        self.running.insert(
            call_id,
            Running {
                task,
                request_id,
                mcp_id,
            },
        );
    }

    /// The call `call_id` answered; `false` when it was cancelled first.
    pub fn finished(&mut self, call_id: &str) -> bool {
        self.running.remove(call_id).is_some()
    }

    /// Claude stopped waiting for `request_id`: stops its call, which needs
    /// no answer.
    pub fn abandoned(&mut self, request_id: &str) -> bool {
        let call = self
            .running
            .iter()
            .find(|(_, running)| running.request_id == request_id)
            .map(|(call_id, _)| call_id.clone());
        match call.and_then(|call_id| self.running.remove(&call_id)) {
            Some(running) => {
                running.task.abort();
                true
            }
            None => false,
        }
    }

    /// Stops every running call (the turn ended) and returns the requests
    /// to answer as cancelled.
    pub fn cancel_all(&mut self) -> Vec<Cancelled> {
        self.claimed.clear();
        self.running
            .drain()
            .map(|(_, running)| {
                running.task.abort();
                Cancelled {
                    request_id: running.request_id,
                    mcp_id: running.mcp_id,
                }
            })
            .collect()
    }
}

/// An unsuccessful result with `text`.
#[must_use]
pub fn failed(text: &str) -> ToolCallResult {
    ToolCallResult::failure(text.to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn claims_open_items_once_and_cancels_running_calls() {
        let mut calls = ClientToolCalls::default();
        let open = || vec!["toolu_1".to_owned(), "toolu_2".to_owned()];
        assert_eq!(calls.claim(open(), || "fresh".into()), "toolu_1");
        assert_eq!(calls.claim(open(), || "fresh".into()), "toolu_2");
        assert_eq!(calls.claim(open(), || "fresh".into()), "fresh");

        let task = tokio::spawn(std::future::pending::<()>());
        calls.started(
            "toolu_1".into(),
            task.abort_handle(),
            "r1".into(),
            serde_json::json!(7),
        );
        let cancelled = calls.cancel_all();
        assert_eq!(cancelled.len(), 1);
        assert_eq!(cancelled[0].request_id, "r1");
        assert!(task.await.is_err_and(|error| error.is_cancelled()));
        assert!(!calls.finished("toolu_1"));
        // A new turn may claim the same ids again.
        assert_eq!(calls.claim(open(), || "fresh".into()), "toolu_1");
    }

    #[tokio::test]
    async fn an_abandoned_request_stops_its_call() {
        let mut calls = ClientToolCalls::default();
        let task = tokio::spawn(std::future::pending::<()>());
        calls.started(
            "c".into(),
            task.abort_handle(),
            "r9".into(),
            serde_json::json!(1),
        );
        assert!(!calls.abandoned("other"));
        assert!(calls.abandoned("r9"));
        assert!(task.await.is_err_and(|error| error.is_cancelled()));
        assert!(calls.cancel_all().is_empty());
    }
}
