//! Client-wire lineage of spawned agents. A thread created by
//! `codewide_spawn_agent` is an ordinary provider thread; only its link
//! record (`children`) knows the caller. Every `Thread` the companion sends
//! (RPC results, `thread/list` rows, `thread/started`) is projected here as
//! a subagent of that caller, in the shape the client already reads for
//! provider-native subagents: `parentThreadId`, `source.subagent.thread_spawn`
//! and `agentNickname`. The client then keeps it out of the chat list and
//! lists it under its parent.
//!
//! The link stays the only source: the companion thread index is rewritten
//! by each provider's own indexer and cannot hold the caller.

use serde_json::{Value, json};

use super::children::{ChildLink, ChildLinks, LinkError};
use crate::store::IndexStore;

/// The `Thread.source` of a spawned agent.
#[must_use]
pub fn subagent_source(link: &ChildLink) -> Value {
    json!({"subagent": {"thread_spawn": {
        "parent_thread_id": link.parent_thread_id,
        "depth": 1,
        "agent_path": null,
        "agent_nickname": link.name,
        "agent_role": null,
    }}})
}

/// Projects the lineage of one `Thread` when it is a spawned agent. A thread
/// that already names its parent (a provider-native subagent) is unchanged.
///
/// # Errors
/// Returns the link store failure.
pub fn annotate_thread(store: &IndexStore, thread: &mut Value) -> Result<(), LinkError> {
    if thread
        .get("parentThreadId")
        .is_some_and(|parent| !parent.is_null())
    {
        return Ok(());
    }
    let Some(id) = thread.get("id").and_then(Value::as_str) else {
        return Ok(());
    };
    let Some(link) = ChildLinks::link_of_blocking(store, id)? else {
        return Ok(());
    };
    if let Some(object) = thread.as_object_mut() {
        object.insert("parentThreadId".into(), json!(link.parent_thread_id));
        object.insert("source".into(), subagent_source(&link));
        if object.get("agentNickname").is_none_or(Value::is_null) {
            object.insert("agentNickname".into(), json!(link.name));
        }
    }
    Ok(())
}

/// Projects `result.thread` and the `thread/list` rows of an RPC result.
///
/// # Errors
/// Returns the link store failure.
pub fn annotate_result(
    store: &IndexStore,
    method: &str,
    result: &mut Value,
) -> Result<(), LinkError> {
    if let Some(thread) = result.get_mut("thread") {
        annotate_thread(store, thread)?;
    }
    if matches!(method, "thread/list" | "companion/supervisor/threadList")
        && let Some(rows) = result.get_mut("data").and_then(Value::as_array_mut)
    {
        for row in rows {
            annotate_thread(store, row)?;
        }
    }
    Ok(())
}

/// Projects the thread of a `thread/started` notification.
///
/// # Errors
/// Returns the link store failure.
pub fn annotate_notification(store: &IndexStore, payload: &mut Value) -> Result<(), LinkError> {
    if payload.get("method").and_then(Value::as_str) != Some("thread/started") {
        return Ok(());
    }
    match payload.pointer_mut("/params/thread") {
        Some(thread) => annotate_thread(store, thread),
        None => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent::model::ProviderId;

    fn store_with_link() -> Result<(tempfile::TempDir, IndexStore), Box<dyn std::error::Error>> {
        let directory = tempfile::tempdir()?;
        let store = IndexStore::open(directory.path().join("state.redb"))?;
        let link = ChildLink::new(
            "parent".into(),
            "child".into(),
            ProviderId::from_static("codex"),
            "m".into(),
            Some("Reviewer".into()),
            "/w".into(),
        );
        store.put_agent_subagent_link("parent", "child", &serde_json::to_vec(&link)?)?;
        Ok((directory, store))
    }

    #[test]
    fn spawned_thread_is_projected_under_its_caller() -> Result<(), Box<dyn std::error::Error>> {
        let (_directory, store) = store_with_link()?;
        let mut payload = json!({"method": "thread/started", "params": {"thread": {
            "id": "child", "parentThreadId": null, "source": "appServer", "agentNickname": null,
        }}});
        annotate_notification(&store, &mut payload)?;
        let thread = &payload["params"]["thread"];
        assert_eq!(thread["parentThreadId"], "parent");
        assert_eq!(
            thread["source"]["subagent"]["thread_spawn"]["parent_thread_id"],
            "parent"
        );
        assert_eq!(thread["agentNickname"], "Reviewer");
        Ok(())
    }

    #[test]
    fn list_rows_keep_unlinked_and_native_lineage() -> Result<(), Box<dyn std::error::Error>> {
        let (_directory, store) = store_with_link()?;
        let mut result = json!({"data": [
            {"id": "child", "parentThreadId": null},
            {"id": "other", "parentThreadId": null, "source": "vscode"},
            {"id": "native", "parentThreadId": "codex-parent", "source": "native"},
        ]});
        annotate_result(&store, "thread/list", &mut result)?;
        assert_eq!(result["data"][0]["parentThreadId"], "parent");
        assert_eq!(
            result["data"][1],
            json!({"id": "other", "parentThreadId": null, "source": "vscode"})
        );
        assert_eq!(result["data"][2]["parentThreadId"], "codex-parent");
        assert_eq!(result["data"][2]["source"], "native");
        Ok(())
    }
}
