use serde_json::{Value, json};

use super::*;
use crate::thread_patch::attach_thread_patch;

const NOW: i64 = 1_000;

fn thread(id: &str, status: &str) -> Value {
    json!({
        "id": id,
        "name": "Original",
        "preview": "provider preview",
        "source": "cli",
        "status": {"type": status},
        "recencyAt": 10,
        "updatedAt": 10,
        "turns": [{"id": "dropped"}]
    })
}

fn event(payload: &Value, cursor: u64) -> RowEvent {
    RowEvent::parse(&attach_thread_patch(payload.clone()), cursor, None, None)
        .unwrap_or_else(|| panic!("{payload} changes no row"))
}

fn seeded(store: &mut RowStore, id: &str, cursor: u64) {
    store.insert(
        id,
        row_value(thread(id, "idle")),
        ListRowMeta {
            cursor,
            archived: false,
            live_activity: None,
        },
    );
}

fn turn_started(id: &str, started_at: i64) -> Value {
    json!({"method": "turn/started", "params": {
        "threadId": id, "turn": {"id": "turn", "items": [], "startedAt": started_at}
    }})
}

fn wire(store: &RowStore, id: &str) -> Value {
    store.wire_row(id).unwrap_or(Value::Null)
}

#[test]
fn lifecycle_events_change_the_status_urgently_and_advance_the_cursor() {
    let mut store = RowStore::default();
    seeded(&mut store, "t", 1);
    assert_eq!(
        store.apply(&event(&turn_started("t", 50), 5), NOW),
        Applied::Dirty(FlushClass::Urgent)
    );
    let row = wire(&store, "t");
    assert_eq!(row["status"], json!({"type": "active", "activeFlags": []}));
    assert_eq!(row["recencyAt"], 50);
    assert_eq!(row["turns"], json!([]), "a row never carries turns");
    assert_eq!(
        row[ROW_FIELD],
        json!({"cursor": 5, "archived": false, "liveActivity": null})
    );

    let completed = json!({"method": "turn/completed", "params": {"threadId": "t", "turn": {
        "id": "turn", "items": [{"type": "agentMessage", "id": "a", "phase": "final_answer", "text": "Done"}]
    }}});
    assert_eq!(
        store.apply(&event(&completed, 6), NOW),
        Applied::Dirty(FlushClass::Urgent)
    );
    let row = wire(&store, "t");
    assert_eq!(row["status"], json!({"type": "idle"}));
    assert_eq!(row["preview"], "Done");
    assert_eq!(row["updatedAt"], NOW);
    assert_eq!(row[ROW_FIELD]["cursor"], 6);
}

#[test]
fn activity_is_coalesced_and_a_no_op_does_not_flush() {
    let mut store = RowStore::default();
    seeded(&mut store, "t", 1);
    let streamed = RowEvent::parse(
        &attach_thread_patch(json!({"method": "item/agentMessage/delta", "params": {
            "threadId": "t", "turnId": "turn", "itemId": "a", "delta": "Hel"
        }})),
        2,
        Some("Hel".into()),
        None,
    )
    .unwrap_or_else(|| panic!("a streamed preview changes the row"));
    assert_eq!(
        store.apply(&streamed, NOW),
        Applied::Dirty(FlushClass::Coalesced)
    );
    assert_eq!(wire(&store, "t")["preview"], "Hel");
    assert_eq!(
        store.apply(&streamed, NOW),
        Applied::Unchanged,
        "the same preview at the same second changes nothing"
    );
    let mut activity = attach_thread_patch(json!({"method": "item/reasoning/summaryTextDelta",
        "params": {"threadId": "t", "turnId": "turn", "itemId": "r", "delta": "x"}}));
    activity[THREAD_PATCH_FIELD]["operation"][LIVE_ACTIVITY_FIELD] =
        json!({"kind": "reasoning", "title": "Plan"});
    let live = RowEvent::parse(&activity, 3, None, None)
        .unwrap_or_else(|| panic!("a live activity changes the row"));
    assert_eq!(
        store.apply(&live, NOW),
        Applied::Dirty(FlushClass::Coalesced)
    );
    assert_eq!(
        wire(&store, "t")[ROW_FIELD]["liveActivity"],
        json!({"kind": "reasoning", "title": "Plan"})
    );
    activity[THREAD_PATCH_FIELD]["operation"][LIVE_ACTIVITY_FIELD] = Value::Null;
    let cleared = RowEvent::parse(&activity, 4, None, None)
        .unwrap_or_else(|| panic!("a cleared activity changes the row"));
    assert_eq!(
        store.apply(&cleared, NOW),
        Applied::Dirty(FlushClass::Coalesced)
    );
    assert_eq!(wire(&store, "t")[ROW_FIELD]["liveActivity"], Value::Null);
}

#[test]
fn name_archive_and_pin_changes_are_urgent_and_pins_are_ordered() {
    let mut store = RowStore::default();
    seeded(&mut store, "t", 1);
    let named =
        json!({"method": "thread/name/updated", "params": {"threadId": "t", "threadName": "New"}});
    assert_eq!(
        store.apply(&event(&named, 2), NOW),
        Applied::Dirty(FlushClass::Urgent)
    );
    assert_eq!(wire(&store, "t")["name"], "New");

    let archived = json!({"method": "thread/archived", "params": {"threadId": "t"}});
    assert_eq!(
        store.apply(&event(&archived, 3), NOW),
        Applied::Dirty(FlushClass::Urgent)
    );
    assert_eq!(wire(&store, "t")[ROW_FIELD]["archived"], true);

    let pin = |pinned: bool, cursor: u64| {
        json!({"method": "companion/thread/pin/updated", "params": {
            "threadId": "t", "pinned": pinned, "pinCursor": cursor
        }})
    };
    assert_eq!(
        store.apply(&event(&pin(true, 9), 9), NOW),
        Applied::Dirty(FlushClass::Urgent)
    );
    store.apply(&event(&pin(false, 4), 10), NOW);
    assert_eq!(
        wire(&store, "t")["codewide"]["threadPin"],
        json!({"version": 1, "pinned": true, "cursor": 9}),
        "an older pin decision does not win"
    );
}

#[test]
fn a_user_request_flushes_urgently_without_changing_the_row() {
    let mut store = RowStore::default();
    seeded(&mut store, "t", 1);
    let request = json!({"id": 7, "method": "item/commandExecution/requestApproval",
        "params": {"threadId": "t", "turnId": "turn", "itemId": "c"}});
    assert_eq!(
        store.apply(&event(&request, 4), NOW),
        Applied::Dirty(FlushClass::Urgent)
    );
    assert_eq!(store.meta("t").map(|meta| meta.cursor), Some(1));
}

#[test]
fn deletion_and_catalog_exclusion_leave_tombstones() {
    let mut store = RowStore::default();
    seeded(&mut store, "t", 1);
    let deleted = json!({"method": "thread/deleted", "params": {"threadId": "t"}});
    assert_eq!(
        store.apply(&event(&deleted, 7), NOW),
        Applied::Dirty(FlushClass::Urgent)
    );
    assert!(!store.contains("t"));
    assert_eq!(
        store.tombstone("t"),
        Some(RowTombstone {
            thread_id: "t".into(),
            cursor: 7
        })
    );
    let started =
        json!({"method": "thread/started", "params": {"thread": thread("hidden", "idle")}});
    let excluded = RowEvent::parse(&started, 8, None, Some(Seed::Excluded))
        .unwrap_or_else(|| panic!("an excluded start is a removal"));
    assert_eq!(
        store.apply(&excluded, NOW),
        Applied::Dirty(FlushClass::Urgent)
    );
    assert!(store.tombstone("hidden").is_some());
}

#[test]
fn only_activity_of_an_unknown_thread_asks_for_its_row() {
    let mut store = RowStore::default();
    assert_eq!(
        store.apply(&event(&turn_started("t", 5), 3), NOW),
        Applied::Unknown
    );
    let pin = json!({"method": "companion/thread/pin/updated", "params": {
        "threadId": "t", "pinned": true, "pinCursor": 4
    }});
    assert_eq!(store.apply(&event(&pin, 4), NOW), Applied::Unchanged);
    let named =
        json!({"method": "thread/name/updated", "params": {"threadId": "t", "threadName": "N"}});
    assert_eq!(store.apply(&event(&named, 5), NOW), Applied::Unchanged);
}

#[test]
fn a_page_row_never_carries_provider_content_above_the_pre_read_head() {
    let mut store = RowStore::default();
    seeded(&mut store, "t", 1);
    let head = 100;
    // The hub changes the row at H+3 while the provider reads the page.
    store.apply(&event(&turn_started("t", 60), head + 3), NOW);
    let hub_row = wire(&store, "t");
    let mut page = vec![thread("t", "idle")];
    page[0]["name"] = json!("Provider name");
    store.observe_page(&mut page, head, false);
    assert_eq!(
        page[0], hub_row,
        "the hub's fields and cursor answer the page"
    );
    assert_eq!(page[0][ROW_FIELD]["cursor"], head + 3);
    assert_eq!(wire(&store, "t"), hub_row, "the hub row is not overwritten");
}

#[test]
fn a_page_row_at_or_below_the_head_replaces_the_hub_row_keeping_live_state() {
    let mut store = RowStore::default();
    seeded(&mut store, "t", 1);
    store.apply(&event(&turn_started("t", 60), 40), NOW);
    let head = 100;
    let mut page = vec![thread("t", "notLoaded"), thread("fresh", "idle")];
    page[0]["name"] = json!("Provider name");
    store.observe_page(&mut page, head, true);
    assert_eq!(page[0]["name"], "Provider name");
    assert_eq!(
        page[0]["status"],
        json!({"type": "active", "activeFlags": []}),
        "notLoaded does not replace a live active status"
    );
    assert_eq!(page[0]["recencyAt"], 60, "recency never decreases");
    assert_eq!(page[0]["turns"], json!([]));
    assert_eq!(
        page[0][ROW_FIELD],
        json!({"cursor": head, "archived": true, "liveActivity": null})
    );
    assert_eq!(wire(&store, "t"), page[0]);
    assert_eq!(page[1][ROW_FIELD]["cursor"], head);
    assert!(store.contains("fresh"));
}

#[test]
fn a_row_deleted_after_the_head_is_not_resurrected_by_a_page() {
    let mut store = RowStore::default();
    seeded(&mut store, "t", 1);
    store.apply(
        &event(
            &json!({"method": "thread/deleted", "params": {"threadId": "t"}}),
            105,
        ),
        NOW,
    );
    let mut page = vec![thread("t", "idle")];
    store.observe_page(&mut page, 100, false);
    assert!(!store.contains("t"));
    assert_eq!(
        page[0][ROW_FIELD]["cursor"], 100,
        "the device drops it by its tombstone"
    );
}

#[test]
fn a_read_row_replays_the_buffered_events() {
    let mut store = RowStore::default();
    let buffered = [event(&turn_started("t", 70), 8)];
    let class = store.seed("t", thread("t", "notLoaded"), 7, &buffered, NOW);
    assert_eq!(class, FlushClass::Urgent);
    let row = wire(&store, "t");
    assert_eq!(
        row["status"],
        json!({"type": "active", "activeFlags": []}),
        "an external writer's thread reads notLoaded; its turn makes it active"
    );
    assert_eq!(row["recencyAt"], 70);
    assert_eq!(row[ROW_FIELD]["cursor"], 8);
}

#[test]
fn the_store_evicts_the_oldest_change_over_the_bound() {
    let mut store = RowStore::default();
    for index in 0..MAX_TRACKED_ROWS {
        seeded(&mut store, &format!("t{index}"), 10 + index as u64);
    }
    assert_eq!(store.len(), MAX_TRACKED_ROWS);
    seeded(&mut store, "newest", 1);
    assert_eq!(store.len(), MAX_TRACKED_ROWS);
    assert!(
        store.contains("newest"),
        "the inserted row is never its own victim"
    );
    assert!(!store.contains("t0"), "the oldest change is evicted");
    assert!(store.tombstone("t0").is_none(), "eviction is no deletion");
}

#[test]
fn children_and_cli_or_vscode_rows_stream() {
    let mut store = RowStore::default();
    seeded(&mut store, "cli", 1);
    let mut exec = thread("exec", "idle");
    exec["source"] = json!("exec");
    let mut child = exec.clone();
    child["id"] = json!("child");
    child["parentThreadId"] = json!("cli");
    for (id, value) in [("exec", exec), ("child", child)] {
        store.insert(
            id,
            value,
            ListRowMeta {
                cursor: 1,
                archived: false,
                live_activity: None,
            },
        );
    }
    let mut claude = thread("claude", "idle");
    claude["source"] = json!("appServer");
    claude["codewideAgent"] = json!({"provider": "claude", "primary": false});
    let mut native_app_server = claude.clone();
    native_app_server["id"] = json!("native");
    native_app_server["codewideAgent"]["primary"] = json!(true);
    for (id, value) in [("claude", claude), ("native", native_app_server)] {
        store.insert(
            id,
            value,
            ListRowMeta {
                cursor: 1,
                archived: false,
                live_activity: None,
            },
        );
    }
    assert!(
        store.streamable("claude"),
        "a non-primary provider's row streams"
    );
    assert!(
        !store.streamable("native"),
        "a primary appServer row does not"
    );
    assert!(store.streamable("cli"));
    assert!(store.streamable("child"));
    assert!(!store.streamable("exec"));
    assert!(!store.streamable("unknown"));
}
