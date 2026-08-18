use serde_json::{Map, Value, json};

use crate::{
    history_service::{HistoryService, HistoryServiceError},
    upstream::{UpstreamError, UpstreamHandle},
};

pub const READ_MODEL_VERSION: u64 = 1;

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
    #[error("thread/resume returned an invalid response")]
    InvalidResume,
    #[error("thread/turns/list returned an invalid response")]
    InvalidPage,
}

impl ThreadViewService {
    #[must_use]
    pub fn new(upstream: UpstreamHandle, history: HistoryService) -> Self {
        Self { upstream, history }
    }

    /// Materializes the initial thread window behind the existing
    /// `thread/resume` interface. The phone receives one authoritative thread
    /// value and never has to merge a stale shell with a separately fetched
    /// history page.
    ///
    /// # Errors
    ///
    /// Returns an error when the request is malformed, the upstream App Server
    /// rejects the resume, or neither indexed history nor the bounded upstream
    /// page can materialize the requested window.
    pub async fn resume(&self, params: &Value) -> Result<Value, ThreadViewError> {
        let params = params.as_object().ok_or(ThreadViewError::InvalidResume)?;
        let thread_id = params
            .get("threadId")
            .and_then(Value::as_str)
            .ok_or(ThreadViewError::InvalidResume)?;
        let page_params = params
            .get("initialTurnsPage")
            .and_then(Value::as_object)
            .ok_or(ThreadViewError::InvalidResume)?;

        let upstream_params = upstream_resume_params(params);
        let response = self
            .upstream
            .request(json!({
                "id": "thread-view-resume",
                "method": "thread/resume",
                "params": upstream_params,
            }))
            .await?;
        let mut result = rpc_result(&response)?;
        let expected_recency_at = result.pointer("/thread/recencyAt").and_then(Value::as_i64);
        let mut requested_page = page_params.clone();
        requested_page.insert("threadId".into(), Value::String(thread_id.to_owned()));
        requested_page.insert("cursor".into(), Value::Null);
        if let Some(recency_at) = expected_recency_at {
            requested_page.insert("expectedRecencyAt".into(), Value::from(recency_at));
        }
        let page = self.read_page(Value::Object(requested_page)).await?;
        materialize_resume_result(&mut result, &page)?;
        Ok(result)
    }

    async fn read_page(&self, params: Value) -> Result<Value, ThreadViewError> {
        if let Some(page) = self
            .history
            .try_turns_page("thread/turns/list", &params)
            .await
        {
            match page {
                Ok(page) => return Ok(page),
                // A just-created or externally-owned thread may not have a
                // discoverable rollout yet. The App Server summary endpoint is
                // the bounded compatibility oracle; never fall back to a full
                // thread/read materialization.
                Err(error) => {
                    tracing::debug!(%error, "indexed thread page unavailable; using App Server summary page");
                }
            }
        }
        let response = self
            .upstream
            .request(json!({
                "id": "thread-view-page",
                "method": "thread/turns/list",
                "params": params,
            }))
            .await?;
        rpc_result(&response)
    }
}

fn upstream_resume_params(params: &Map<String, Value>) -> Map<String, Value> {
    let mut upstream_params = params.clone();
    upstream_params.remove("initialTurnsPage");
    // The companion owns history materialization for this request. Older
    // Android builds did not always send `excludeTurns`, and forwarding that
    // request verbatim makes App Server deserialize and return the complete
    // rollout before we replace it with a bounded page. Large threads can
    // exceed 30 MiB and stall an otherwise healthy sync connection. Keep
    // resume for its live-session side effect, but never ask the upstream to
    // duplicate history that is discarded below.
    upstream_params.insert("excludeTurns".into(), Value::Bool(true));
    upstream_params
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
        .ok_or(ThreadViewError::InvalidResume)
}

fn materialize_resume_result(result: &mut Value, page: &Value) -> Result<(), ThreadViewError> {
    let result_object = result
        .as_object_mut()
        .ok_or(ThreadViewError::InvalidResume)?;
    let page_object = page.as_object().ok_or(ThreadViewError::InvalidPage)?;
    let turns = page_object
        .get("data")
        .and_then(Value::as_array)
        .ok_or(ThreadViewError::InvalidPage)?;
    let mut ordered_turns = turns.clone();
    ordered_turns.reverse();

    let execution_settings = execution_settings(result_object);
    let thread = result_object
        .get_mut("thread")
        .and_then(Value::as_object_mut)
        .ok_or(ThreadViewError::InvalidResume)?;
    thread.insert("turns".into(), Value::Array(ordered_turns));
    merge_thread_metadata(thread, execution_settings);

    result_object.insert("initialTurnsPage".into(), page.clone());
    result_object.insert(
        "turnsBackwardsCursor".into(),
        page_object
            .get("backwardsCursor")
            .cloned()
            .unwrap_or(Value::Null),
    );
    result_object.insert(
        "codewideReadModelVersion".into(),
        Value::from(READ_MODEL_VERSION),
    );
    Ok(())
}

fn execution_settings(result: &Map<String, Value>) -> Value {
    json!({
        "model": result.get("model").cloned().unwrap_or(Value::Null),
        "effort": result.get("reasoningEffort").cloned().unwrap_or(Value::Null),
        "permissions": result
            .get("activePermissionProfile")
            .and_then(Value::as_object)
            .and_then(|profile| profile.get("id"))
            .cloned()
            .unwrap_or(Value::Null),
        "approvalPolicy": approval_policy_name(result.get("approvalPolicy")),
        "sandboxPolicy": result
            .get("sandbox")
            .and_then(Value::as_object)
            .and_then(|sandbox| sandbox.get("type"))
            .cloned()
            .unwrap_or(Value::Null),
    })
}

fn approval_policy_name(value: Option<&Value>) -> Value {
    match value {
        Some(Value::String(value)) => Value::String(value.clone()),
        Some(Value::Object(value)) if value.contains_key("granular") => {
            Value::String("granular".into())
        }
        _ => Value::Null,
    }
}

fn merge_thread_metadata(thread: &mut Map<String, Value>, execution_settings: Value) {
    let metadata = thread.entry("codewide").or_insert_with(|| json!({}));
    if !metadata.is_object() {
        *metadata = json!({});
    }
    if let Some(metadata) = metadata.as_object_mut() {
        metadata.insert("executionSettings".into(), execution_settings);
        metadata.insert("readModelVersion".into(), Value::from(READ_MODEL_VERSION));
    }
}

#[cfg(test)]
mod tests {
    use super::{READ_MODEL_VERSION, materialize_resume_result, upstream_resume_params};
    use serde_json::json;

    #[test]
    fn bounded_resume_always_excludes_upstream_turns() {
        let params = serde_json::Map::from_iter([
            ("threadId".into(), json!("thread")),
            ("excludeTurns".into(), json!(false)),
            (
                "initialTurnsPage".into(),
                json!({"limit": 12, "itemsView": "summary"}),
            ),
        ]);
        let upstream = upstream_resume_params(&params);

        assert_eq!(upstream.get("threadId"), Some(&json!("thread")));
        assert_eq!(upstream.get("excludeTurns"), Some(&json!(true)));
        assert!(!upstream.contains_key("initialTurnsPage"));
    }

    #[test]
    fn embeds_ordered_turns_and_execution_settings() -> Result<(), Box<dyn std::error::Error>> {
        let mut result = json!({
            "thread": {"id": "thread", "turns": []},
            "model": "gpt-test",
            "reasoningEffort": "high",
            "activePermissionProfile": {"id": "full"},
            "approvalPolicy": {"granular": {}},
            "sandbox": {"type": "dangerFullAccess"}
        });
        materialize_resume_result(
            &mut result,
            &json!({
                "data": [{"id": "new"}, {"id": "old"}],
                "nextCursor": "older",
                "backwardsCursor": null
            }),
        )?;

        assert_eq!(result["thread"]["turns"][0]["id"], "old");
        assert_eq!(result["thread"]["turns"][1]["id"], "new");
        assert_eq!(
            result["thread"]["codewide"]["executionSettings"]["model"],
            "gpt-test"
        );
        assert_eq!(result["codewideReadModelVersion"], READ_MODEL_VERSION);
        Ok(())
    }
}
