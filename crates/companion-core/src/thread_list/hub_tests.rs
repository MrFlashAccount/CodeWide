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
    assert_eq!(
        rows.complete_materialization("far", 9, Ok(RowRead::Row(read)), NOW),
        AfterRead::Done
    );
    let batch = frames(&subscription).await;
    let pushed = &batch[0]["rows"][0];
    assert_eq!(pushed["id"], "far");
    assert_eq!(pushed["status"]["type"], "active");
    assert_eq!(pushed["recencyAt"], 90);
    assert_eq!(pushed["preview"], "streaming");
    assert_eq!(pushed[ROW_FIELD]["cursor"], 11);
}

fn turn_started(id: &str) -> Value {
    attach_thread_patch(json!({"method": "turn/started", "params": {
        "threadId": id, "turn": {"id": "turn", "items": []}
    }}))
}

fn turn_completed(id: &str) -> Value {
    attach_thread_patch(json!({"method": "turn/completed", "params": {
        "threadId": id, "turn": {"id": "turn", "items": [], "status": "completed"}
    }}))
}

#[tokio::test]
async fn a_failed_read_does_not_park_the_thread_and_its_next_turn_end_lists_it() {
    let rows = ThreadListRows::default();
    let subscription = rows.subscribe(true);
    assert_eq!(apply(&rows, &[delta("far", "partial")], 1), ["far"]);
    assert_eq!(
        rows.complete_materialization("far", 0, Err("offline".into()), NOW),
        AfterRead::RetryAfter {
            attempt: 1,
            delay: FIRST_RETRY_DELAY
        }
    );
    assert_eq!(rows.materialization_failures(), 1);
    assert_eq!(
        rows.ignored_count(),
        0,
        "a failure is not a confirmed absence"
    );
    // The next update reads the row again without waiting for the timer.
    assert_eq!(apply(&rows, &[delta("far", " answer")], 2), ["far"]);
    assert!(
        !rows.retry_materialization("far", 1),
        "the timed retry yields to the read in flight"
    );
    assert!(apply(&rows, &[turn_completed("far")], 3).is_empty());
    let mut read = row("far");
    read["status"] = json!({"type": "active", "activeFlags": []});
    read["preview"] = json!("stored");
    assert_eq!(
        rows.complete_materialization("far", 1, Ok(RowRead::Row(read)), NOW),
        AfterRead::Done
    );
    let batch = frames(&subscription).await;
    let pushed = &batch[0]["rows"][0];
    assert_eq!(pushed["id"], "far");
    assert_eq!(pushed["status"]["type"], "idle", "the turn end applied");
    assert_eq!(pushed["preview"], "partial answer");
    assert_eq!(pushed[ROW_FIELD]["cursor"], 3);
    assert!(
        !rows.retry_materialization("far", 1),
        "a listed thread needs no retry"
    );
}

#[test]
fn failed_reads_back_off_and_stop_timed_retries_at_the_bound() {
    let rows = ThreadListRows::default();
    let mut delays = Vec::new();
    assert_eq!(apply(&rows, &[delta("far", "x")], 1), ["far"]);
    let mut next = rows.complete_materialization("far", 0, Err("offline".into()), NOW);
    while let AfterRead::RetryAfter { attempt, delay } = next {
        delays.push(delay);
        assert!(rows.retry_materialization("far", attempt));
        assert!(
            !rows.retry_materialization("far", attempt),
            "one read in flight"
        );
        next = rows.complete_materialization("far", 0, Err("offline".into()), NOW);
    }
    assert_eq!(next, AfterRead::Done);
    assert_eq!(delays.len(), MAX_READ_RETRIES as usize);
    assert!(delays.windows(2).all(|pair| pair[0] <= pair[1]));
    assert_eq!(delays.last().copied(), Some(MAX_RETRY_DELAY));
    // Out of timed retries, the thread still reads on its next update.
    assert_eq!(apply(&rows, &[delta("far", "y")], 2), ["far"]);
}

#[test]
fn an_empty_read_ignores_the_thread_until_its_next_lifecycle_event() {
    let rows = ThreadListRows::default();
    assert_eq!(apply(&rows, &[turn_started("hidden")], 1), ["hidden"]);
    assert_eq!(
        rows.complete_materialization(
            "hidden",
            0,
            Ok(RowRead::Absent(AbsentReason::CatalogHidden)),
            NOW
        ),
        AfterRead::Done
    );
    assert_eq!(rows.ignored_count(), 1);
    assert!(
        apply(&rows, &[delta("hidden", "more")], 2).is_empty(),
        "streaming of an ignored thread reads nothing"
    );
    assert_eq!(
        apply(&rows, &[turn_completed("hidden")], 3),
        ["hidden"],
        "a turn end checks the thread again"
    );
}

#[tokio::test]
async fn an_empty_read_followed_by_a_turn_start_materializes_the_row() {
    let rows = ThreadListRows::default();
    let subscription = rows.subscribe(true);
    assert_eq!(apply(&rows, &[delta("far", "x")], 1), ["far"]);
    assert_eq!(
        rows.complete_materialization("far", 0, Ok(RowRead::Absent(AbsentReason::Missing)), NOW),
        AfterRead::Done
    );
    assert_eq!(apply(&rows, &[turn_started("far")], 2), ["far"]);
    assert_eq!(
        rows.complete_materialization("far", 1, Ok(RowRead::Row(row("far"))), NOW),
        AfterRead::Done
    );
    assert_eq!(rows.ignored_count(), 0);
    let batch = frames(&subscription).await;
    assert_eq!(ids(&batch[0]), ["far"]);
    assert_eq!(batch[0]["rows"][0]["status"]["type"], "active");
}

#[tokio::test]
async fn a_page_naming_a_failed_thread_seeds_it() {
    let rows = ThreadListRows::default();
    assert_eq!(apply(&rows, &[turn_started("far")], 1), ["far"]);
    assert!(matches!(
        rows.complete_materialization("far", 0, Err("offline".into()), NOW),
        AfterRead::RetryAfter { attempt: 1, .. }
    ));
    let mut page = vec![row("far")];
    rows.observe_page(&mut page, 2, false);
    assert!(
        apply(&rows, &[turn_started("far")], 3).is_empty(),
        "the page seeded the row"
    );
    assert!(!rows.retry_materialization("far", 1));
}

/// A row port that fails a fixed number of times, then answers a row.
struct FlakyReader {
    failures: std::sync::atomic::AtomicU32,
    reads: std::sync::atomic::AtomicU32,
}

#[async_trait::async_trait]
impl materialize::RowReader for FlakyReader {
    async fn journal_head(&self) -> Result<u64, String> {
        Ok(0)
    }

    async fn read_row(&self, thread_id: &str) -> Result<RowRead, String> {
        self.reads.fetch_add(1, Ordering::SeqCst);
        if self
            .failures
            .fetch_update(Ordering::SeqCst, Ordering::SeqCst, |left| {
                left.checked_sub(1)
            })
            .is_ok()
        {
            return Err("thread/read failed with code -32600".into());
        }
        let mut read = row(thread_id);
        read["status"] = json!({"type": "active", "activeFlags": []});
        Ok(RowRead::Row(read))
    }
}

#[tokio::test]
async fn the_materializer_retries_a_failed_read_after_its_backoff() {
    let rows = ThreadListRows::default();
    let subscription = rows.subscribe(true);
    let reader = Arc::new(FlakyReader {
        failures: std::sync::atomic::AtomicU32::new(1),
        reads: std::sync::atomic::AtomicU32::new(0),
    });
    let materializer = materialize::Materializer::new(rows.clone(), reader.clone());
    materializer.spawn(apply(&rows, &[turn_started("far")], 1));
    let batch = frames(&subscription).await;
    assert_eq!(ids(&batch[0]), ["far"]);
    assert_eq!(batch[0]["rows"][0]["status"]["type"], "active");
    assert_eq!(reader.reads.load(Ordering::SeqCst), 2);
    assert_eq!(rows.materialization_failures(), 1);
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
