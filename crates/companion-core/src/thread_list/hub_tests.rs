use serde_json::{Value, json};

use super::*;
use crate::thread_patch::attach_thread_patch;

const NOW: i64 = 1_000;

fn row(id: &str) -> Value {
    json!({"id": id, "source": "vscode", "status": {"type": "idle"}, "preview": "", "updatedAt": 1, "recencyAt": 1, "turns": []})
}

fn seed_page(rows: &ThreadListRows, ids: &[String], head: u64) {
    let mut page = ids.iter().map(|id| row(id)).collect::<Vec<_>>();
    rows.observe_page(&mut page, head, false);
}

fn delta(id: &str, text: &str) -> Value {
    attach_thread_patch(json!({"method": "item/agentMessage/delta", "params": {
        "threadId": id, "turnId": "turn", "itemId": "a", "delta": text
    }}))
}

fn apply(rows: &ThreadListRows, payloads: &[Value], first_cursor: u64) -> Vec<String> {
    let previews = payloads
        .iter()
        .map(|payload| rows.observe_stream(payload))
        .collect::<Vec<_>>();
    rows.apply_journaled(
        payloads.iter().zip(previews).zip(first_cursor..).map(
            |((payload, streamed_preview), cursor)| JournaledRow {
                payload,
                cursor,
                streamed_preview,
                seed: None,
            },
        ),
        NOW,
    )
}

async fn frames(subscription: &Subscription) -> Vec<Value> {
    tokio::time::timeout(
        Duration::from_secs(3),
        subscription.next_frames(|_: &str| false),
    )
    .await
    .unwrap_or_default()
}

fn ids(frame: &Value) -> Vec<String> {
    frame["rows"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|row| row["id"].as_str().map(str::to_owned))
        .collect()
}

#[test]
fn hello_and_frames_require_a_boolean_visibility() {
    assert_eq!(
        hello_visibility(&json!({"type": "hello"})),
        Err(ListStreamRejection::Required)
    );
    assert_eq!(
        hello_visibility(&json!({"listStream": true})),
        Err(ListStreamRejection::Invalid)
    );
    assert_eq!(
        hello_visibility(&json!({"listStream": {"visible": "yes"}})),
        Err(ListStreamRejection::Invalid)
    );
    assert_eq!(
        hello_visibility(&json!({"listStream": {"visible": false}})),
        Ok(false)
    );
    assert_eq!(
        frame_visibility(&json!({"type": "listStream"})),
        Err(ListStreamRejection::Invalid)
    );
    assert_eq!(
        frame_visibility(&json!({"type": "listStream", "visible": true})),
        Ok(true)
    );
    assert_eq!(
        ListStreamRejection::Required.reason(),
        "list_stream_required"
    );
    assert_eq!(ListStreamRejection::Invalid.reason(), "invalid_list_stream");
}

#[tokio::test]
async fn ten_threads_changing_within_one_interval_share_one_frame() {
    let rows = ThreadListRows::default();
    let threads = (0..10).map(|index| format!("t{index}")).collect::<Vec<_>>();
    seed_page(&rows, &threads, 1);
    let subscription = rows.subscribe(true);
    // The leading edge after silence flushes the first change at once.
    apply(&rows, &[delta("t0", "first")], 2);
    assert_eq!(frames(&subscription).await.len(), 1);
    let payloads = threads
        .iter()
        .map(|id| delta(id, " more"))
        .collect::<Vec<_>>();
    apply(&rows, &payloads, 3);
    let batch = frames(&subscription).await;
    assert_eq!(batch.len(), 1, "one frame for ten changed rows");
    assert_eq!(ids(&batch[0]), threads);
    assert_eq!(batch[0]["type"], FRAME_TYPE);
    assert_eq!(batch[0]["removed"], json!([]));
}

#[tokio::test]
async fn one_hundred_fifty_dirty_rows_are_sent_as_two_ordered_frames() {
    let rows = ThreadListRows::default();
    let threads = (0..150)
        .map(|index| format!("t{index:03}"))
        .collect::<Vec<_>>();
    seed_page(&rows, &threads, 1);
    let subscription = rows.subscribe(true);
    let payloads = threads
        .iter()
        .map(|id| {
            attach_thread_patch(json!({"method": "thread/status/changed", "params": {
                "threadId": id, "status": {"type": "active", "activeFlags": []}
            }}))
        })
        .collect::<Vec<_>>();
    apply(&rows, &payloads, 2);
    let batch = frames(&subscription).await;
    assert_eq!(batch.len(), 2);
    assert_eq!(ids(&batch[0]).len(), MAX_ROWS_PER_FRAME);
    assert_eq!(ids(&batch[1]).len(), 50);
    let sent = batch.iter().flat_map(ids).collect::<Vec<_>>();
    assert_eq!(sent, threads, "order is preserved across frames");
}

#[tokio::test]
async fn an_invisible_subscriber_receives_nothing_until_visible() {
    let rows = ThreadListRows::default();
    let threads = vec!["t".to_owned()];
    seed_page(&rows, &threads, 1);
    let subscription = rows.subscribe(false);
    apply(
        &rows,
        &[attach_thread_patch(
            json!({"method": "turn/started", "params": {
                "threadId": "t", "turn": {"id": "turn", "items": []}
            }}),
        )],
        2,
    );
    let quiet = tokio::time::timeout(
        Duration::from_millis(100),
        subscription.next_frames(|_: &str| false),
    )
    .await;
    assert!(quiet.is_err(), "no frame while invisible");
    subscription.set_visible(true);
    apply(&rows, &[delta("t", "now")], 3);
    assert_eq!(frames(&subscription).await.len(), 1);
}

#[tokio::test]
async fn deletion_reaches_subscribers_as_a_tombstone() {
    let rows = ThreadListRows::default();
    seed_page(&rows, &["t".to_owned()], 1);
    let subscription = rows.subscribe(true);
    apply(
        &rows,
        &[attach_thread_patch(
            json!({"method": "thread/deleted", "params": {"threadId": "t"}}),
        )],
        5,
    );
    let batch = frames(&subscription).await;
    assert_eq!(batch[0]["rows"], json!([]));
    assert_eq!(batch[0]["removed"], json!([{"threadId": "t", "cursor": 5}]));
}

#[tokio::test]
async fn an_unknown_thread_is_read_once_and_pushed_with_its_buffered_events() {
    let rows = ThreadListRows::default();
    let subscription = rows.subscribe(true);
    let started = attach_thread_patch(json!({"method": "turn/started", "params": {
        "threadId": "far", "turn": {"id": "turn", "items": [], "startedAt": 90}
    }}));
    assert_eq!(apply(&rows, std::slice::from_ref(&started), 10), ["far"]);
    assert!(
        apply(&rows, &[delta("far", "streaming")], 11).is_empty(),
        "one read per thread"
    );
    let mut read = row("far");
    read["status"] = json!({"type": "notLoaded"});
    assert!(!rows.complete_materialization("far", 9, Ok(Some(read)), NOW));
    let batch = frames(&subscription).await;
    let pushed = &batch[0]["rows"][0];
    assert_eq!(pushed["id"], "far");
    assert_eq!(pushed["status"]["type"], "active");
    assert_eq!(pushed["recencyAt"], 90);
    assert_eq!(pushed["preview"], "streaming");
    assert_eq!(pushed[ROW_FIELD]["cursor"], 11);
}

#[tokio::test]
async fn a_failed_read_counts_and_is_not_retried_until_a_page_names_the_thread() {
    let rows = ThreadListRows::default();
    let started = attach_thread_patch(json!({"method": "turn/started", "params": {
        "threadId": "far", "turn": {"id": "turn", "items": []}
    }}));
    assert_eq!(apply(&rows, std::slice::from_ref(&started), 1), ["far"]);
    assert!(!rows.complete_materialization("far", 0, Err("offline".into()), NOW));
    assert_eq!(rows.materialization_failures(), 1);
    assert!(apply(&rows, std::slice::from_ref(&started), 2).is_empty());
    let mut page = vec![row("far")];
    rows.observe_page(&mut page, 2, false);
    assert!(
        apply(&rows, &[started], 3).is_empty(),
        "the page seeded the row"
    );
}

#[test]
fn a_dropped_subscription_unregisters() {
    let rows = ThreadListRows::default();
    let subscription = rows.subscribe(true);
    assert_eq!(rows.lock().subscribers.len(), 1);
    drop(subscription);
    assert!(rows.lock().subscribers.is_empty());
}

#[tokio::test]
async fn a_non_primary_provider_row_is_pushed_live() {
    let rows = ThreadListRows::default();
    let mut claude = row("claude");
    claude["source"] = json!("appServer");
    claude["codewideAgent"] = json!({"provider": "claude", "primary": false});
    rows.observe_page(&mut [claude], 1, false);
    let subscription = rows.subscribe(true);
    apply(
        &rows,
        &[attach_thread_patch(
            json!({"method": "turn/started", "params": {
                "threadId": "claude", "turn": {"id": "turn", "items": []}
            }}),
        )],
        2,
    );
    let batch = frames(&subscription).await;
    assert_eq!(ids(&batch[0]), ["claude"]);
    assert_eq!(batch[0]["rows"][0]["status"]["type"], "active");
}
