//! Facts the companion reads back from projected client-wire payloads.
//!
//! Every provider's events reach the sync hub as client-wire (Codex
//! v0.155.1-shaped) payloads, either native or projected by `events.rs`, so
//! these readers are the single place that knows where a turn's lifecycle
//! and a thread's effective permission profile live on that wire.

use serde_json::Value;

/// The terminal state of a turn as the client wire reports it.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum TurnEnd {
    Completed,
    Interrupted,
    Failed,
}

/// One turn-lifecycle fact of a thread.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum TurnFact<'a> {
    Started {
        thread_id: &'a str,
        turn_id: &'a str,
    },
    /// A completed agent message; `final_answer` marks the final phase.
    AgentMessage {
        thread_id: &'a str,
        turn_id: &'a str,
        text: &'a str,
        final_answer: bool,
    },
    Ended {
        thread_id: &'a str,
        turn_id: &'a str,
        end: TurnEnd,
        error: Option<&'a str>,
    },
}

/// Reads the turn-lifecycle fact of one client-wire notification.
#[must_use]
pub fn turn_fact(payload: &Value) -> Option<TurnFact<'_>> {
    let params = payload.get("params")?;
    let thread_id = params.get("threadId").and_then(Value::as_str)?;
    match payload.get("method").and_then(Value::as_str)? {
        "turn/started" => Some(TurnFact::Started {
            thread_id,
            turn_id: params.pointer("/turn/id").and_then(Value::as_str)?,
        }),
        "turn/completed" => {
            let turn = params.get("turn")?;
            let end = match turn.get("status").and_then(Value::as_str)? {
                "completed" => TurnEnd::Completed,
                "interrupted" => TurnEnd::Interrupted,
                "failed" => TurnEnd::Failed,
                _ => return None,
            };
            Some(TurnFact::Ended {
                thread_id,
                turn_id: turn.get("id").and_then(Value::as_str)?,
                end,
                error: turn.pointer("/error/message").and_then(Value::as_str),
            })
        }
        "item/completed" => {
            let item = params.get("item")?;
            if item.get("type").and_then(Value::as_str) != Some("agentMessage") {
                return None;
            }
            Some(TurnFact::AgentMessage {
                thread_id,
                turn_id: params.get("turnId").and_then(Value::as_str)?,
                text: item.get("text").and_then(Value::as_str)?,
                final_answer: item.get("phase").and_then(Value::as_str) == Some("final_answer"),
            })
        }
        _ => None,
    }
}

/// The effective permission profile id a notification reports for a thread
/// (`thread/settings/updated`).
#[must_use]
pub fn settings_profile(payload: &Value) -> Option<(&str, &str)> {
    if payload.get("method").and_then(Value::as_str) != Some("thread/settings/updated") {
        return None;
    }
    let params = payload.get("params")?;
    Some((
        params.get("threadId").and_then(Value::as_str)?,
        params
            .pointer("/threadSettings/activePermissionProfile/id")
            .and_then(Value::as_str)?,
    ))
}

/// The effective permission profile id an RPC result reports for the thread
/// it returns (`thread/start`, `thread/resume`, `thread/fork`).
#[must_use]
pub fn result_profile<'a>(method: &str, result: &'a Value) -> Option<(&'a str, &'a str)> {
    if !matches!(method, "thread/start" | "thread/resume" | "thread/fork") {
        return None;
    }
    Some((
        result.pointer("/thread/id").and_then(Value::as_str)?,
        result
            .pointer("/activePermissionProfile/id")
            .and_then(Value::as_str)?,
    ))
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn reads_turn_lifecycle_from_native_and_projected_shapes() {
        assert_eq!(
            turn_fact(
                &json!({"method": "turn/started", "params": {"threadId": "t", "turn": {"id": "u"}}})
            ),
            Some(TurnFact::Started {
                thread_id: "t",
                turn_id: "u"
            })
        );
        assert_eq!(
            turn_fact(
                &json!({"method": "item/completed", "params": {"threadId": "t", "turnId": "u",
                "item": {"type": "agentMessage", "id": "i", "text": "done", "phase": "final_answer"}}})
            ),
            Some(TurnFact::AgentMessage {
                thread_id: "t",
                turn_id: "u",
                text: "done",
                final_answer: true
            })
        );
        assert_eq!(
            turn_fact(
                &json!({"method": "turn/completed", "params": {"threadId": "t",
                "turn": {"id": "u", "status": "failed", "error": {"message": "boom"}}}})
            ),
            Some(TurnFact::Ended {
                thread_id: "t",
                turn_id: "u",
                end: TurnEnd::Failed,
                error: Some("boom")
            })
        );
        assert_eq!(
            turn_fact(
                &json!({"method": "item/completed", "params": {"threadId": "t", "turnId": "u",
                "item": {"type": "commandExecution"}}})
            ),
            None
        );
    }

    #[test]
    fn reads_effective_permission_profiles() {
        assert_eq!(
            settings_profile(
                &json!({"method": "thread/settings/updated", "params": {"threadId": "t",
                "threadSettings": {"activePermissionProfile": {"id": ":workspace", "extends": null}}}})
            ),
            Some(("t", ":workspace"))
        );
        assert_eq!(
            result_profile(
                "thread/resume",
                &json!({"thread": {"id": "t"},
                "activePermissionProfile": {"id": ":read-only", "extends": null}})
            ),
            Some(("t", ":read-only"))
        );
        assert_eq!(
            result_profile("thread/read", &json!({"thread": {"id": "t"}})),
            None
        );
    }
}
