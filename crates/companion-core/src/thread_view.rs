use serde_json::{Value, json};

use crate::{
    history_service::{HistoryService, HistoryServiceError},
    upstream::{UpstreamError, UpstreamFence, UpstreamHandle},
};

pub const READ_MODEL_VERSION: u64 = 3;

// Match App Server's explicit instruction to inspect this unloaded child.
// A generic RPC error code is insufficient: unrelated failures must stay visible.
const UNLOADED_SUBAGENT_RESUME: &str = "cannot resume an unloaded multi-agent v2 sub-agent through its parent; resume the parent first, or use thread/read to inspect it";

/// Current App Server execution authority for one thread.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ThreadActivity {
    /// A turn is currently executing and a queued turn must wait.
    Active,
    /// No turn is executing, so a queued turn may be admitted.
    Idle,
    /// App Server cannot establish a safe lifecycle state.
    Unavailable,
}

#[derive(Clone)]
pub struct ThreadViewService {
    upstream: UpstreamHandle,
    history: HistoryService,
}

#[derive(Debug, thiserror::Error)]
pub enum ThreadViewError {
    #[error(transparent)]
    Upstream(#[from] UpstreamError),
    #[error(transparent)]
    History(#[from] HistoryServiceError),
    #[error("App Server request failed: {0}")]
    Rpc(String),
    #[error("thread sync request is invalid")]
    InvalidRequest,
    #[error("App Server returned an invalid thread status")]
    InvalidStatus,
    #[error("thread/sync returned an invalid active turn")]
    InvalidActiveTurn,
}

impl ThreadViewService {
    #[must_use]
    pub fn new(upstream: UpstreamHandle, history: HistoryService) -> Self {
        Self { upstream, history }
    }

    /// Reads the App Server-owned lifecycle used to admit a queued turn.
    ///
    /// # Errors
    ///
    /// Returns an error when App Server cannot provide a valid thread status.
    pub async fn activity(&self, thread_id: &str) -> Result<ThreadActivity, ThreadViewError> {
        let response = self
            .upstream
            .request(json!({
                "id": "thread-view-activity",
                "method": "thread/read",
                "params": {
                    "threadId": thread_id,
                    "includeTurns": false,
                },
            }))
            .await?;
        let result = rpc_result(&response)?;
        queue_activity(&result)
    }

    /// Synchronizes immutable indexed history and the mutable App Server head,
    /// then leaves the single Companion transport observing resumable threads.
    /// Unloaded multi-agent children remain inspectable without reviving a parent.
    ///
    /// # Errors
    ///
    /// Returns an error when parameters are invalid or either authoritative
    /// source cannot produce its bounded projection.
    pub async fn sync(&self, params: &Value) -> Result<Value, ThreadViewError> {
        let params = params.as_object().ok_or(ThreadViewError::InvalidRequest)?;
        let thread_id = params
            .get("threadId")
            .and_then(Value::as_str)
            .ok_or(ThreadViewError::InvalidRequest)?;
        let after_turn_id = params.get("afterTurnId").and_then(Value::as_str);
        let source_witness = params
            .get("sourceWitness")
            .filter(|value| !value.is_null())
            .map(|value| value.as_str().ok_or(ThreadViewError::InvalidRequest))
            .transpose()?;
        let limit = params
            .get("limit")
            .and_then(Value::as_u64)
            .and_then(|value| usize::try_from(value).ok())
            .unwrap_or(36);

        let (result, shell_fence) = self.read_thread_shell(thread_id).await?;
        let mut thread = result
            .get("thread")
            .cloned()
            .ok_or(ThreadViewError::InvalidStatus)?;
        let active = match thread.pointer("/status/type").and_then(Value::as_str) {
            Some("active") => true,
            Some("idle" | "notLoaded" | "systemError") => false,
            _ => return Err(ThreadViewError::InvalidStatus),
        };
        thread
            .as_object_mut()
            .ok_or(ThreadViewError::InvalidStatus)?
            .insert("turns".into(), Value::Array(Vec::new()));
        let (mut active_turn, fence) = if active {
            let (active_turn, active_fence) = self.read_active_turn(thread_id).await?;
            (active_turn, active_fence)
        } else {
            (Value::Null, shell_fence)
        };
        let active_turn_id = if active {
            Some(
                active_turn
                    .get("id")
                    .and_then(Value::as_str)
                    .ok_or(ThreadViewError::InvalidActiveTurn)?,
            )
        } else {
            None
        };
        let history = match self
            .history
            .sync_thread_history_with_source(
                thread_id,
                after_turn_id,
                limit,
                active_turn_id,
                source_witness,
            )
            .await
        {
            Ok(history) => history,
            Err(HistoryServiceError::Catalog(crate::catalog::CatalogError::NotFound(_)))
                if after_turn_id.is_none() =>
            {
                json!({
                    "kind": "reset",
                    "headTurnId": Value::Null,
                    "turns": [],
                    "hasMore": false,
                    "olderCursor": Value::Null,
                })
            }
            Err(error) => return Err(error.into()),
        };
        self.history
            .enrich_active_questions(thread_id, &mut active_turn)
            .await?;
        let through_cursor = fence.wait().await?;
        Ok(json!({
            "readModelVersion": READ_MODEL_VERSION,
            "throughCursor": through_cursor,
            "thread": thread,
            "history": history,
            "activeTurn": active_turn,
        }))
    }

    async fn read_thread_shell(
        &self,
        thread_id: &str,
    ) -> Result<(Value, UpstreamFence), ThreadViewError> {
        let (response, fence) = self
            .upstream
            .request_fenced(json!({
                "id": "thread-view-observe",
                "method": "thread/resume",
                "params": {
                    "threadId": thread_id,
                    "excludeTurns": true,
                },
            }))
            .await?;
        match rpc_result(&response) {
            Err(ThreadViewError::Rpc(message)) if message == UNLOADED_SUBAGENT_RESUME => {
                // Inspection must not restart the parent execution tree. Keep history
                // bounded through HistoryService, rather than includeTurns=true.
                let (stored, stored_fence) = self
                    .upstream
                    .request_fenced(json!({
                        "id": "thread-view-inspect",
                        "method": "thread/read",
                        "params": {"threadId": thread_id, "includeTurns": false},
                    }))
                    .await?;
                Ok((rpc_result(&stored)?, stored_fence))
            }
            result => Ok((result?, fence)),
        }
    }

    /// Reads the complete semantic mutable head. Large content is externalized
    /// by the downstream projector; item shells must remain present so the
    /// client can apply only the durable event tail after this snapshot.
    async fn read_active_turn(
        &self,
        thread_id: &str,
    ) -> Result<(Value, UpstreamFence), ThreadViewError> {
        let (response, fence) = self
            .upstream
            .request_fenced(json!({
                "id": "thread-view-sync-active",
                "method": "thread/turns/list",
                "params": {
                    "threadId": thread_id,
                    "cursor": null,
                    "limit": 1,
                    "sortDirection": "desc",
                    "itemsView": "full",
                },
            }))
            .await?;
        let page = rpc_result(&response)?;
        let turn = page
            .get("data")
            .and_then(Value::as_array)
            .and_then(|turns| turns.first())
            .cloned()
            .ok_or(ThreadViewError::InvalidActiveTurn)?;
        Ok((turn, fence))
    }
}

/// A failed turn is not a permanent input lock. Only an explicit capability
/// makes systemError dispatchable; active turns must still preserve queue order.
fn queue_activity(result: &Value) -> Result<ThreadActivity, ThreadViewError> {
    match result
        .pointer("/thread/status/type")
        .and_then(Value::as_str)
    {
        Some("active") => Ok(ThreadActivity::Active),
        Some("idle" | "notLoaded") => Ok(ThreadActivity::Idle),
        Some("systemError") => {
            if result
                .pointer("/thread/canAcceptDirectInput")
                .and_then(Value::as_bool)
                == Some(true)
            {
                Ok(ThreadActivity::Idle)
            } else {
                Ok(ThreadActivity::Unavailable)
            }
        }
        _ => Err(ThreadViewError::InvalidStatus),
    }
}

fn rpc_result(response: &Value) -> Result<Value, ThreadViewError> {
    if let Some(error) = response.get("error") {
        let message = error
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or("unknown App Server error");
        return Err(ThreadViewError::Rpc(message.to_owned()));
    }
    response
        .get("result")
        .cloned()
        .ok_or(ThreadViewError::InvalidRequest)
}

#[cfg(test)]
mod queue_activity_tests {
    use super::*;

    #[test]
    fn failed_turn_allows_next_queued_prompt_only_with_explicit_authority()
    -> Result<(), ThreadViewError> {
        assert_eq!(
            queue_activity(&json!({"thread": {
                "status": {"type": "systemError"}, "canAcceptDirectInput": true
            }}))?,
            ThreadActivity::Idle
        );
        for capability in [json!(false), Value::Null, json!("true")] {
            assert_eq!(
                queue_activity(&json!({"thread": {
                    "status": {"type": "systemError"}, "canAcceptDirectInput": capability
                }}))?,
                ThreadActivity::Unavailable
            );
        }
        assert_eq!(
            queue_activity(&json!({"thread": {
                "status": {"type": "systemError"}
            }}))?,
            ThreadActivity::Unavailable
        );
        Ok(())
    }

    #[test]
    fn direct_input_capability_does_not_steer_a_queued_prompt_into_an_active_turn()
    -> Result<(), ThreadViewError> {
        assert_eq!(
            queue_activity(&json!({"thread": {
                "status": {"type": "active"}, "canAcceptDirectInput": true
            }}))?,
            ThreadActivity::Active
        );
        for status in ["idle", "notLoaded"] {
            assert_eq!(
                queue_activity(&json!({"thread": {
                    "status": {"type": status}
                }}))?,
                ThreadActivity::Idle
            );
        }
        assert!(matches!(
            queue_activity(&json!({"thread": {}})),
            Err(ThreadViewError::InvalidStatus)
        ));
        Ok(())
    }
}
