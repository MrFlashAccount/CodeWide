use std::collections::HashSet;

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

/// Companion-owned pin state; the replay cursor orders snapshots against live changes.
#[derive(Clone, Copy, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ThreadPin {
    pub pinned: bool,
    pub cursor: u64,
}

pub(crate) struct ThreadPinRequest {
    pub thread_id: String,
    pub pinned: bool,
}

impl ThreadPinRequest {
    pub fn parse(params: &Value) -> Option<Self> {
        let thread_id = params.get("threadId")?.as_str()?;
        if thread_id.is_empty() || thread_id.trim() != thread_id {
            return None;
        }
        Some(Self {
            thread_id: thread_id.to_owned(),
            pinned: params.get("pinned")?.as_bool()?,
        })
    }

    pub fn notification(&self, cursor: u64) -> Value {
        crate::thread_patch::attach_thread_patch(json!({
            "method": "companion/thread/pin/updated",
            "params": {"threadId": self.thread_id, "pinned": self.pinned, "pinCursor": cursor}
        }))
    }
}

/// Legacy imports may establish a pin only when the server has no prior decision.
pub(crate) struct ThreadPinImportRequest {
    pub thread_ids: Vec<String>,
}

impl ThreadPinImportRequest {
    pub fn parse(params: &Value) -> Option<Self> {
        let ids = params.get("threadIds")?.as_array()?;
        let mut seen = HashSet::new();
        let mut thread_ids = Vec::new();
        for value in ids {
            let id = value.as_str()?;
            if id.is_empty() || id.trim() != id {
                return None;
            }
            if seen.insert(id) {
                thread_ids.push(id.to_owned());
            }
        }
        Some(Self { thread_ids })
    }
}

/// Attaches durable Companion pin metadata to thread shells and catalog
/// pages of every provider; pins are companion state, not agent storage.
///
/// # Errors
/// Returns the store error when a pin cannot be read.
pub(crate) fn annotate_result(
    store: &crate::store::IndexStore,
    method: &str,
    result: &mut Value,
) -> Result<(), crate::store::StoreError> {
    if let Some(thread) = result.get_mut("thread")
        && let Some(id) = thread.get("id").and_then(Value::as_str)
    {
        let pin = store.thread_pin(id)?;
        annotate(thread, pin);
    }
    if matches!(method, "thread/list" | "companion/supervisor/threadList")
        && let Some(threads) = result.get_mut("data").and_then(Value::as_array_mut)
    {
        for thread in threads {
            if let Some(id) = thread.get("id").and_then(Value::as_str) {
                let pin = store.thread_pin(id)?;
                annotate(thread, pin);
            }
        }
    }
    Ok(())
}

pub(crate) fn annotate(thread: &mut Value, pin: ThreadPin) {
    if let Some(thread) = thread.as_object_mut()
        && let Some(metadata) = thread
            .entry("codewide")
            .or_insert_with(|| json!({}))
            .as_object_mut()
    {
        metadata.insert(
            "threadPin".into(),
            json!({"version": 1, "pinned": pin.pinned, "cursor": pin.cursor}),
        );
    }
}

pub(crate) fn deleted_thread_id(payload: &Value) -> Option<&str> {
    if payload.get("method")?.as_str()? != "thread/deleted" {
        return None;
    }
    payload.get("params")?.get("threadId")?.as_str()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn legacy_import_validates_every_identity_and_deduplicates()
    -> Result<(), Box<dyn std::error::Error>> {
        let request = ThreadPinImportRequest::parse(&json!({"threadIds":["chat","chat","other"]}))
            .ok_or("valid import was rejected")?;
        assert_eq!(request.thread_ids, ["chat", "other"]);
        for input in [
            json!({}),
            json!({"threadIds":"chat"}),
            json!({"threadIds":["chat",4]}),
            json!({"threadIds":[""]}),
            json!({"threadIds":[" chat"]}),
        ] {
            assert!(ThreadPinImportRequest::parse(&input).is_none());
        }
        Ok(())
    }

    #[test]
    fn pin_requests_require_explicit_boolean_and_exact_identity() {
        assert!(ThreadPinRequest::parse(&json!({"threadId":"thread","pinned":false})).is_some());
        for request in [
            json!({"threadId":"","pinned":true}),
            json!({"threadId":" thread ","pinned":true}),
            json!({"threadId":"thread","pinned":"true"}),
            json!({"threadId":"thread"}),
        ] {
            assert!(ThreadPinRequest::parse(&request).is_none());
        }
    }
}
