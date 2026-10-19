//! Context compactions running in a thread's active turn.
//!
//! The App Server announces a compaction live (`item/started` of a
//! `contextCompaction` item) but leaves it out of its active-turn snapshot
//! until it completes: its turn history upserts only some item kinds when they
//! start, and a compaction enters the turn on completion. A `thread/turns/list`
//! read while a compaction runs, such as the active turn of a client's thread
//! sync, therefore returns its turn without it, and the snapshot erases the
//! compaction the client already shows. The adapter remembers each running
//! compaction from the event stream and adds it, still running, to the turn
//! pages it serves until the compaction or its turn ends.

use std::{
    collections::HashMap,
    sync::{Mutex, PoisonError},
};

use serde_json::{Value, json};

const COMPACTION_ITEM: &str = "contextCompaction";

/// The compaction running in one thread's active turn.
#[derive(Clone, Debug, Eq, PartialEq)]
struct RunningCompaction {
    turn_id: String,
    item_id: String,
}

/// Every thread's running compaction, keyed by thread id.
#[derive(Default)]
pub(crate) struct ActiveCompactions {
    running: Mutex<HashMap<String, RunningCompaction>>,
}

impl ActiveCompactions {
    /// Follows one App Server notification: a compaction starts, completes,
    /// or its turn ends.
    pub(crate) fn observe(&self, notification: &Value) {
        let method = notification.get("method").and_then(Value::as_str);
        let params = notification.get("params");
        let Some(thread_id) = params
            .and_then(|params| params.get("threadId"))
            .and_then(Value::as_str)
        else {
            return;
        };
        match method {
            Some("item/started") => {
                if let Some(running) = params.and_then(started_compaction) {
                    self.lock().insert(thread_id.to_owned(), running);
                }
            }
            Some("item/completed") => {
                if let Some(ended) = params.and_then(started_compaction) {
                    self.forget(thread_id, |running| running == &ended);
                }
            }
            Some("turn/completed") => {
                if let Some(turn_id) = params
                    .and_then(|params| params.pointer("/turn/id"))
                    .and_then(Value::as_str)
                {
                    self.forget(thread_id, |running| running.turn_id == turn_id);
                }
            }
            _ => {}
        }
    }

    /// Adds a running compaction to the turn of a `thread/turns/list`
    /// response that runs it but does not list it.
    pub(crate) fn complete_turns_page(&self, page: &TurnsPage, response: &mut Value) {
        let Some(running) = self.lock().get(&page.thread_id).cloned() else {
            return;
        };
        let Some(turns) = response
            .pointer_mut("/result/data")
            .and_then(Value::as_array_mut)
        else {
            return;
        };
        let Some(turn) = turns.iter_mut().find(|turn| {
            turn.get("id").and_then(Value::as_str) == Some(running.turn_id.as_str())
                && turn.get("status").and_then(Value::as_str) == Some("inProgress")
        }) else {
            return;
        };
        let Some(items) = turn.get_mut("items").and_then(Value::as_array_mut) else {
            return;
        };
        let listed = items
            .iter()
            .any(|item| item.get("id").and_then(Value::as_str) == Some(running.item_id.as_str()));
        if !listed {
            // Nothing else happens in the turn while a compaction runs, so it
            // follows the turn's other items.
            items.push(json!({
                "type": COMPACTION_ITEM,
                "id": running.item_id,
                "codewideLifecyclePhase": "started",
            }));
        }
    }

    fn forget(&self, thread_id: &str, ended: impl FnOnce(&RunningCompaction) -> bool) {
        let mut running = self.lock();
        if running.get(thread_id).is_some_and(ended) {
            running.remove(thread_id);
        }
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, HashMap<String, RunningCompaction>> {
        self.running.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

/// The thread of a `thread/turns/list` request, read before it is sent.
pub(crate) struct TurnsPage {
    thread_id: String,
}

impl TurnsPage {
    /// The thread whose turns `request` lists; `None` for any other request.
    pub(crate) fn of(request: &Value) -> Option<Self> {
        if request.get("method").and_then(Value::as_str) != Some("thread/turns/list") {
            return None;
        }
        let thread_id = request.pointer("/params/threadId")?.as_str()?.to_owned();
        Some(Self { thread_id })
    }
}

/// The compaction item of an `item/started` or `item/completed` notification.
fn started_compaction(params: &Value) -> Option<RunningCompaction> {
    let item = params.get("item")?;
    if item.get("type").and_then(Value::as_str) != Some(COMPACTION_ITEM) {
        return None;
    }
    Some(RunningCompaction {
        turn_id: params.get("turnId")?.as_str()?.to_owned(),
        item_id: item.get("id")?.as_str()?.to_owned(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const THREAD: &str = "01a1543e-cd37-7671-9c90-8ca0efa1cd20";
    const TURN: &str = "01a15449-5221-70e1-a41b-0c56291a278b";

    fn compaction(method: &str) -> Value {
        json!({"method": method, "params": {
            "threadId": THREAD, "turnId": TURN,
            "item": {"type": "contextCompaction", "id": "compaction"}
        }})
    }

    fn turns_page(items: &Value) -> (Value, Value) {
        (
            json!({"id": "sync", "method": "thread/turns/list", "params": {
                "threadId": THREAD, "limit": 1, "itemsView": "full"
            }}),
            json!({"id": "sync", "result": {"data": [
                {"id": TURN, "status": "inProgress", "items": items}
            ], "nextCursor": null}}),
        )
    }

    fn complete(compactions: &ActiveCompactions, request: &Value, response: &mut Value) {
        if let Some(page) = TurnsPage::of(request) {
            compactions.complete_turns_page(&page, response);
        }
    }

    fn item_types(response: &Value) -> Vec<(String, Option<String>)> {
        response["result"]["data"][0]["items"]
            .as_array()
            .into_iter()
            .flatten()
            .map(|item| {
                (
                    item["type"].as_str().unwrap_or_default().to_owned(),
                    item["codewideLifecyclePhase"]
                        .as_str()
                        .map(ToOwned::to_owned),
                )
            })
            .collect()
    }

    #[test]
    fn a_running_compaction_joins_the_active_turn_the_app_server_lists_without_it() {
        let compactions = ActiveCompactions::default();
        compactions.observe(&compaction("item/started"));

        let (request, mut response) = turns_page(&json!([]));
        complete(&compactions, &request, &mut response);
        assert_eq!(
            item_types(&response),
            [("contextCompaction".to_owned(), Some("started".to_owned()))]
        );

        // Once it completes the App Server lists it itself.
        compactions.observe(&compaction("item/completed"));
        let (request, mut response) = turns_page(&json!([]));
        complete(&compactions, &request, &mut response);
        assert!(item_types(&response).is_empty());
    }

    #[test]
    fn a_listed_or_ended_compaction_is_left_alone() {
        let compactions = ActiveCompactions::default();
        compactions.observe(&compaction("item/started"));
        let (request, mut response) =
            turns_page(&json!([{"type": "contextCompaction", "id": "compaction"}]));
        complete(&compactions, &request, &mut response);
        assert_eq!(
            item_types(&response),
            [("contextCompaction".to_owned(), None)]
        );

        compactions.observe(&json!({"method": "turn/completed", "params": {
            "threadId": THREAD, "turn": {"id": TURN, "status": "completed", "items": []}
        }}));
        let (request, mut response) = turns_page(&json!([]));
        complete(&compactions, &request, &mut response);
        assert!(item_types(&response).is_empty());
    }

    #[test]
    fn other_items_threads_and_methods_are_not_compactions() {
        let compactions = ActiveCompactions::default();
        compactions.observe(&json!({"method": "item/started", "params": {
            "threadId": THREAD, "turnId": TURN, "item": {"type": "reasoning", "id": "r"}
        }}));
        compactions.observe(&json!({"method": "item/started", "params": {
            "threadId": "other", "turnId": TURN,
            "item": {"type": "contextCompaction", "id": "elsewhere"}
        }}));
        let (request, mut response) = turns_page(&json!([]));
        complete(&compactions, &request, &mut response);
        assert!(item_types(&response).is_empty());

        compactions.observe(&compaction("item/started"));
        assert!(
            TurnsPage::of(&json!({"method": "thread/read", "params": {"threadId": THREAD}}))
                .is_none()
        );
    }
}
