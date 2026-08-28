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

    /// Attaches Companion's App Server connection to live notifications for a
    /// thread without using resume as a history-loading boundary.
    ///
    /// # Errors
    ///
    /// Returns an error when the request is malformed or App Server rejects
    /// the observer attachment.
    pub async fn observe(&self, params: &Value) -> Result<Value, ThreadViewError> {
        let thread_id = params
            .get("threadId")
            .and_then(Value::as_str)
            .ok_or(ThreadViewError::InvalidResume)?;
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
        rpc_result(&response)?;
        Ok(json!({ "threadId": thread_id, "observing": true }))
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
        if let Some(status) = result
            .pointer("/thread/status/type")
            .and_then(Value::as_str)
        {
            requested_page.insert(
                "expectedThreadActive".into(),
                Value::Bool(status == "active"),
            );
        }
        let page = self.read_page(Value::Object(requested_page)).await?;
        materialize_resume_result(&mut result, &page)?;
        Ok(result)
    }

    /// Reads one authoritative bounded window without resuming the thread.
    ///
    /// Opening a cached conversation only needs to reconcile its mutable head.
    /// `thread/resume` also performs live-session work and can remain pending
    /// while an active turn is running, so using it for this read-only repair
    /// makes an already visible chat look stale for seconds. Both reads stay
    /// bounded; an active mutable head remains App Server-owned because its
    /// rollout can legitimately trail the live process.
    ///
    /// # Errors
    ///
    /// Returns an error when the request is malformed, the App Server cannot
    /// read the thread shell or its authoritative bounded page.
    pub async fn read_window(&self, params: &Value) -> Result<Value, ThreadViewError> {
        let params = params.as_object().ok_or(ThreadViewError::InvalidResume)?;
        let thread_id = params
            .get("threadId")
            .and_then(Value::as_str)
            .ok_or(ThreadViewError::InvalidResume)?;
        let page_params = params
            .get("initialTurnsPage")
            .and_then(Value::as_object)
            .ok_or(ThreadViewError::InvalidResume)?;

        let response = self
            .upstream
            .request(json!({
                "id": "thread-view-read",
                "method": "thread/read",
                "params": {
                    "threadId": thread_id,
                    "includeTurns": false,
                },
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
        if let Some(status) = result
            .pointer("/thread/status/type")
            .and_then(Value::as_str)
        {
            requested_page.insert(
                "expectedThreadActive".into(),
                Value::Bool(status == "active"),
            );
        }
        // Read the bounded summary page from the rollout index. The App Server
        // remains only the metadata/lifecycle oracle and the mutable-head
        // fallback; opening history must never deserialize the full session or
        // activate it as a side effect.
        let mut page = self.read_page(Value::Object(requested_page)).await?;
        if thread_or_page_has_mutable_head(&result, &page) {
            let full_head_response = self
                .upstream
                .request(json!({
                    "id": "thread-view-read-full-head",
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
            let full_head = rpc_result(&full_head_response)?;
            replace_page_head_with_full_turn(&mut page, &full_head)?;
        }
        materialize_read_result(&mut result, &page)?;
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
                "params": upstream_turns_page_params(params),
            }))
            .await?;
        rpc_result(&response)
    }
}

fn upstream_turns_page_params(mut params: Value) -> Value {
    if let Some(params) = params.as_object_mut() {
        // Internal consistency witnesses are understood by the companion's
        // rollout reader, not by the public App Server protocol.
        params.remove("expectedRecencyAt");
        params.remove("expectedThreadActive");
    }
    params
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

fn thread_or_page_has_mutable_head(thread_result: &Value, page: &Value) -> bool {
    thread_result
        .pointer("/thread/status/type")
        .and_then(Value::as_str)
        == Some("active")
        || page.pointer("/data/0/status").and_then(Value::as_str) == Some("inProgress")
}

fn replace_page_head_with_full_turn(
    summary_page: &mut Value,
    full_page: &Value,
) -> Result<(), ThreadViewError> {
    let full_turns = full_page
        .get("data")
        .and_then(Value::as_array)
        .ok_or(ThreadViewError::InvalidPage)?;
    let Some(full_turn) = full_turns.first().cloned() else {
        return Ok(());
    };
    let full_turn_id = full_turn
        .get("id")
        .and_then(Value::as_str)
        .ok_or(ThreadViewError::InvalidPage)?;
    let summary_turns = summary_page
        .get_mut("data")
        .and_then(Value::as_array_mut)
        .ok_or(ThreadViewError::InvalidPage)?;
    let retained_len = summary_turns.len();
    if let Some(index) = summary_turns
        .iter()
        .position(|turn| turn.get("id").and_then(Value::as_str) == Some(full_turn_id))
    {
        summary_turns[index] = full_turn;
    } else {
        summary_turns.insert(0, full_turn);
        if retained_len > 0 {
            summary_turns.truncate(retained_len);
        }
    }
    Ok(())
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

fn materialize_read_result(result: &mut Value, page: &Value) -> Result<(), ThreadViewError> {
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

    let thread = result_object
        .get_mut("thread")
        .and_then(Value::as_object_mut)
        .ok_or(ThreadViewError::InvalidResume)?;
    thread.insert("turns".into(), Value::Array(ordered_turns));

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
    use super::{
        READ_MODEL_VERSION, materialize_read_result, materialize_resume_result,
        replace_page_head_with_full_turn, upstream_resume_params, upstream_turns_page_params,
    };
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
    fn strips_companion_consistency_witnesses_from_upstream_page_request() {
        let params = upstream_turns_page_params(json!({
            "threadId": "thread",
            "cursor": null,
            "limit": 12,
            "expectedRecencyAt": 10,
            "expectedThreadActive": false
        }));

        assert_eq!(params["threadId"], "thread");
        assert_eq!(params["limit"], 12);
        assert!(params.get("expectedRecencyAt").is_none());
        assert!(params.get("expectedThreadActive").is_none());
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

    #[test]
    fn bounded_read_embeds_turns_without_overwriting_cached_execution_settings()
    -> Result<(), Box<dyn std::error::Error>> {
        let mut result = json!({
            "thread": {"id": "thread", "turns": []}
        });
        materialize_read_result(
            &mut result,
            &json!({
                "data": [{"id": "new"}, {"id": "old"}],
                "nextCursor": "older",
                "backwardsCursor": null
            }),
        )?;

        assert_eq!(result["thread"]["turns"][0]["id"], "old");
        assert_eq!(result["thread"]["turns"][1]["id"], "new");
        assert!(result["thread"].get("codewide").is_none());
        assert_eq!(result["codewideReadModelVersion"], READ_MODEL_VERSION);
        Ok(())
    }

    #[test]
    fn full_mutable_head_replaces_summary_without_changing_the_page_boundary()
    -> Result<(), Box<dyn std::error::Error>> {
        let mut page = json!({
            "data": [
                {"id": "new", "itemsView": "summary", "items": []},
                {"id": "old", "itemsView": "summary", "items": []}
            ],
            "nextCursor": "older"
        });
        replace_page_head_with_full_turn(
            &mut page,
            &json!({
                "data": [{
                    "id": "new",
                    "itemsView": "full",
                    "items": [{"type": "commandExecution", "id": "command"}]
                }]
            }),
        )?;

        assert_eq!(page["data"][0]["itemsView"], "full");
        assert_eq!(page["data"][0]["items"][0]["id"], "command");
        assert_eq!(page["data"][1]["id"], "old");
        assert_eq!(page["nextCursor"], "older");
        Ok(())
    }
}
