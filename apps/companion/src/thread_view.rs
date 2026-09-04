use serde_json::{Value, json};

use crate::{
    history_service::{HistoryService, HistoryServiceError},
    upstream::{UpstreamError, UpstreamHandle},
};

pub const READ_MODEL_VERSION: u64 = 2;

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
        match result
            .pointer("/thread/status/type")
            .and_then(Value::as_str)
        {
            Some("active") => Ok(ThreadActivity::Active),
            Some("idle" | "notLoaded") => Ok(ThreadActivity::Idle),
            Some("systemError") => Ok(ThreadActivity::Unavailable),
            _ => Err(ThreadViewError::InvalidStatus),
        }
    }

    /// Synchronizes immutable indexed history and the mutable App Server head,
    /// then leaves the single Companion transport observing the thread.
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
        let limit = params
            .get("limit")
            .and_then(Value::as_u64)
            .and_then(|value| usize::try_from(value).ok())
            .unwrap_or(36);

        let result = self.attach_observer(thread_id).await?;
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
        let active_turn = if active {
            self.read_active_turn(thread_id).await?
        } else {
            Value::Null
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
            .sync_thread_history(thread_id, after_turn_id, limit, active_turn_id)
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
        Ok(json!({
            "readModelVersion": READ_MODEL_VERSION,
            "thread": thread,
            "history": history,
            "activeTurn": active_turn,
        }))
    }

    async fn attach_observer(&self, thread_id: &str) -> Result<Value, ThreadViewError> {
        let response = self
            .upstream
            .request(json!({
                "id": "thread-view-observe",
                "method": "thread/resume",
                "params": {
                    "threadId": thread_id,
                    "excludeTurns": true,
                },
            }))
            .await?;
        rpc_result(&response)
    }

    async fn read_active_turn(&self, thread_id: &str) -> Result<Value, ThreadViewError> {
        let response = self
            .upstream
            .request(json!({
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
        page.get("data")
            .and_then(Value::as_array)
            .and_then(|turns| turns.first())
            .cloned()
            .ok_or(ThreadViewError::InvalidActiveTurn)
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
