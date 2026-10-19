//! One coalesced stream of thread-list rows per sync socket.
//!
//! [`ThreadListRows`] is the Companion's only owner of the server fields of a
//! thread-list row. The ingest batch reduces every journaled payload onto the
//! rows after the journal commit (`apply_journaled`); `thread/list` pages pass
//! through [`ThreadListRows::observe_page`] so a page row and a pushed row are
//! the same object. Each visible socket holds a [`Subscription`] that collects
//! the changed rows and sends them as `threadListRows` frames: no journal, no
//! `afterCursor`, no ack. Order holds while a socket lives; after a reconnect
//! the device re-reads its pages.
//!
//! A payload for a thread without a row waits while the row is read once
//! through [`materialize::RowReader`] (implemented by the sync layer).
//!
//! The module owns no provider, thread view or interest code: interest
//! membership is passed in by the session at each flush. Wire names and
//! limits mirror `contract/v1.json threadListStream`.

pub mod flush;
pub mod materialize;
mod preview;
mod rows;
pub mod subscriber;

use std::{
    collections::{HashMap, HashSet},
    sync::{
        Arc, Mutex, MutexGuard,
        atomic::{AtomicU64, Ordering},
    },
    time::{Duration, Instant},
};

use serde_json::Value;
use tokio::sync::Notify;

pub use self::rows::{ListRowMeta, RowTombstone, Seed};
use self::{
    flush::FlushClass,
    preview::PreviewTracker,
    rows::{Applied, RowEvent, RowStore},
    subscriber::{FlushPoll, Subscriber},
};

/// Companion → client frame type of a row batch.
pub const FRAME_TYPE: &str = "threadListRows";
/// Client → Companion frame type switching the stream.
pub const CONTROL_FRAME_TYPE: &str = "listStream";
/// Mandatory hello key: `{"visible": boolean}`.
pub const HELLO_FIELD: &str = "listStream";
/// Row key carrying [`ListRowMeta`].
pub const ROW_FIELD: &str = "codewideList";
/// Spacing of coalesced flushes.
pub const COALESCE_INTERVAL: Duration = Duration::from_millis(1_500);
/// Spacing of flushes caused by the socket's interest threads.
pub const INTEREST_FLUSH_INTERVAL: Duration = Duration::from_millis(250);
/// Most rows plus tombstones in one frame.
pub const MAX_ROWS_PER_FRAME: usize = 100;
/// Longest streamed answer preview, in characters.
pub const MAX_PREVIEW_CHARS: usize = 2_000;
/// Most rows the Companion keeps.
pub const MAX_TRACKED_ROWS: usize = 4_096;
/// `Thread.source` values whose rows are streamed. Children and every row of
/// a non-primary provider (`codewideAgent.primary == false`) stream too,
/// mirroring the merged `thread/list` membership.
pub const ROW_SOURCE_KINDS: [&str; 2] = ["cli", "vscode"];
/// WebSocket close code of every list-stream rejection.
pub const LIST_STREAM_CLOSE_CODE: u16 = 1008;

/// Most threads waiting for their first row at once.
const MAX_MATERIALIZING: usize = 64;
/// Most events buffered for one thread waiting for its first row.
const MAX_BUFFERED_EVENTS: usize = 64;

/// Why a hello or `listStream` frame closes the socket.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ListStreamRejection {
    /// `hello` has no `listStream` key.
    Required,
    /// `listStream` is not `{"visible": boolean}` / `visible` not boolean.
    Invalid,
}

impl ListStreamRejection {
    /// The close frame reason.
    #[must_use]
    pub const fn reason(self) -> &'static str {
        match self {
            Self::Required => "list_stream_required",
            Self::Invalid => "invalid_list_stream",
        }
    }
}

/// Parses the mandatory `hello.listStream` into the initial visibility.
///
/// # Errors
///
/// Returns the rejection to close the socket with.
pub fn hello_visibility(hello: &Value) -> Result<bool, ListStreamRejection> {
    hello
        .get(HELLO_FIELD)
        .ok_or(ListStreamRejection::Required)?
        .get("visible")
        .and_then(Value::as_bool)
        .ok_or(ListStreamRejection::Invalid)
}

/// Parses a `listStream` control frame.
///
/// # Errors
///
/// Returns the rejection to close the socket with.
pub fn frame_visibility(frame: &Value) -> Result<bool, ListStreamRejection> {
    frame
        .get("visible")
        .and_then(Value::as_bool)
        .ok_or(ListStreamRejection::Invalid)
}

/// One committed journal entry offered to the rows.
pub struct JournaledRow<'a> {
    pub payload: &'a Value,
    pub cursor: u64,
    /// The thread's accumulated answer preview, observed before projection.
    pub streamed_preview: Option<String>,
    /// The decorated row of a `thread/started`.
    pub seed: Option<Seed>,
}

struct SubscriberEntry {
    state: Subscriber,
    notify: Arc<Notify>,
}

#[derive(Default)]
struct Hub {
    store: RowStore,
    preview: PreviewTracker,
    subscribers: HashMap<u64, SubscriberEntry>,
    next_subscriber: u64,
    /// Threads whose first row is being read, with the events since.
    materializing: HashMap<String, Materializing>,
    /// Threads not to read again until a page or `thread/started` names them:
    /// hidden by the catalog, missing, or a failed read.
    ignored: HashSet<String>,
}

#[derive(Default)]
struct Materializing {
    events: Vec<RowEvent>,
    /// The buffer overflowed: the row is read once more afterwards.
    overflowed: bool,
}

/// The shared row hub. Cloning shares the same rows.
#[derive(Clone, Default)]
pub struct ThreadListRows {
    hub: Arc<Mutex<Hub>>,
    materialization_failures: Arc<AtomicU64>,
}

impl ThreadListRows {
    fn lock(&self) -> MutexGuard<'_, Hub> {
        // A poisoned hub still holds valid rows: every mutation leaves the
        // store consistent before it can panic.
        match self.hub.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        }
    }

    /// Observes a raw payload before content projection and returns the
    /// thread's streamed answer preview when it changed.
    #[must_use]
    pub fn observe_stream(&self, payload: &Value) -> Option<String> {
        self.lock().preview.observe(payload)
    }

    /// Reduces one committed ingest batch onto the rows at `now_secs`, marks
    /// the changed rows dirty for every visible subscriber and wakes them
    /// once. Returns the threads whose first row must be read now.
    pub fn apply_journaled<'a>(
        &self,
        entries: impl IntoIterator<Item = JournaledRow<'a>>,
        now_secs: i64,
    ) -> Vec<String> {
        let mut hub = self.lock();
        let mut reads = Vec::new();
        let mut dirty = Vec::new();
        for entry in entries {
            let Some(event) = RowEvent::parse(
                entry.payload,
                entry.cursor,
                entry.streamed_preview,
                entry.seed,
            ) else {
                continue;
            };
            hub.apply_event(event, now_secs, &mut reads, &mut dirty);
        }
        hub.mark_dirty(&dirty);
        reads
    }

    /// Rewrites the rows of one `thread/list` page read after journal head
    /// `head`, attaching `codewideList` to each (see `rows.rs`).
    pub fn observe_page(&self, rows: &mut [Value], head: u64, archived: bool) {
        let mut hub = self.lock();
        for row in rows.iter() {
            if let Some(thread_id) = row.get("id").and_then(Value::as_str) {
                hub.ignored.remove(thread_id);
            }
        }
        hub.store.observe_page(rows, head, archived);
    }

    /// Completes the read of a thread's first row taken after journal head
    /// `head`: `Ok(None)` when the thread is hidden or gone. Returns whether
    /// the row must be read once more (its buffer overflowed).
    #[must_use]
    pub fn complete_materialization(
        &self,
        thread_id: &str,
        head: u64,
        read: Result<Option<Value>, String>,
        now_secs: i64,
    ) -> bool {
        let mut hub = self.lock();
        let Some(pending) = hub.materializing.remove(thread_id) else {
            return false;
        };
        match read {
            Ok(Some(row)) => {
                let class = hub
                    .store
                    .seed(thread_id, row, head, &pending.events, now_secs);
                if hub.store.streamable(thread_id) {
                    hub.mark_dirty(&[(thread_id.to_owned(), class)]);
                }
                if pending.overflowed {
                    hub.materializing
                        .insert(thread_id.to_owned(), Materializing::default());
                }
                pending.overflowed
            }
            Ok(None) => {
                hub.ignore(thread_id);
                false
            }
            Err(_) => {
                hub.ignore(thread_id);
                self.materialization_failures
                    .fetch_add(1, Ordering::Relaxed);
                false
            }
        }
    }

    /// Reads of unknown threads' rows that failed since start.
    #[must_use]
    pub fn materialization_failures(&self) -> u64 {
        self.materialization_failures.load(Ordering::Relaxed)
    }

    /// Registers a socket's subscription.
    #[must_use]
    pub fn subscribe(&self, visible: bool) -> Subscription {
        let notify = Arc::new(Notify::new());
        let mut hub = self.lock();
        let id = hub.next_subscriber;
        hub.next_subscriber += 1;
        hub.subscribers.insert(
            id,
            SubscriberEntry {
                state: Subscriber::new(visible),
                notify: notify.clone(),
            },
        );
        Subscription {
            id,
            rows: self.clone(),
            notify,
        }
    }

    fn poll(&self, id: u64, now: Instant, in_interest: &dyn Fn(&str) -> bool) -> PollOutcome {
        let mut hub = self.lock();
        let Some(entry) = hub.subscribers.get_mut(&id) else {
            return PollOutcome::Idle;
        };
        match entry.state.poll(now, in_interest) {
            FlushPoll::Idle => PollOutcome::Idle,
            FlushPoll::WaitUntil(deadline) => PollOutcome::WaitUntil(deadline),
            FlushPoll::Flush(thread_ids) => PollOutcome::Frames(hub.frames(&thread_ids)),
        }
    }
}

enum PollOutcome {
    Idle,
    WaitUntil(Instant),
    Frames(Vec<Value>),
}

impl Hub {
    fn apply_event(
        &mut self,
        event: RowEvent,
        now_secs: i64,
        reads: &mut Vec<String>,
        dirty: &mut Vec<(String, FlushClass)>,
    ) {
        if let Some(pending) = self.materializing.get_mut(&event.thread_id) {
            if pending.events.len() < MAX_BUFFERED_EVENTS {
                pending.events.push(event);
            } else {
                pending.overflowed = true;
            }
            return;
        }
        match self.store.apply(&event, now_secs) {
            Applied::Unchanged => {}
            Applied::Dirty(class) => {
                // A hidden thread's later events need no read.
                if event.is_exclusion() {
                    self.ignore(&event.thread_id);
                } else {
                    self.ignored.remove(&event.thread_id);
                }
                let thread_id = event.thread_id;
                // A tombstone always streams; a row only when listed.
                if !self.store.contains(&thread_id) || self.store.streamable(&thread_id) {
                    dirty.push((thread_id, class));
                }
            }
            Applied::Unknown => {
                if self.ignored.contains(&event.thread_id)
                    || self.materializing.len() >= MAX_MATERIALIZING
                {
                    return;
                }
                let thread_id = event.thread_id.clone();
                self.materializing.insert(
                    thread_id.clone(),
                    Materializing {
                        events: vec![event],
                        overflowed: false,
                    },
                );
                reads.push(thread_id);
            }
        }
    }

    fn ignore(&mut self, thread_id: &str) {
        if self.ignored.len() >= MAX_TRACKED_ROWS {
            self.ignored.clear();
        }
        self.ignored.insert(thread_id.to_owned());
    }

    fn mark_dirty(&mut self, dirty: &[(String, FlushClass)]) {
        if dirty.is_empty() {
            return;
        }
        for entry in self.subscribers.values_mut() {
            let mut woke = false;
            for (thread_id, class) in dirty {
                woke |= entry.state.mark(thread_id, *class);
            }
            if woke {
                entry.notify.notify_one();
            }
        }
    }

    /// The frames for one flush: rows and tombstones in marking order, at
    /// most [`MAX_ROWS_PER_FRAME`] entries each. A thread with neither (an
    /// evicted row) is skipped.
    fn frames(&self, thread_ids: &[String]) -> Vec<Value> {
        let mut frames = Vec::new();
        let mut rows = Vec::new();
        let mut removed = Vec::new();
        for thread_id in thread_ids {
            if let Some(row) = self.store.wire_row(thread_id) {
                rows.push(row);
            } else if let Some(tombstone) = self.store.tombstone(thread_id) {
                removed.push(tombstone.to_wire());
            } else {
                continue;
            }
            if rows.len() + removed.len() == MAX_ROWS_PER_FRAME {
                frames.push(frame(
                    std::mem::take(&mut rows),
                    std::mem::take(&mut removed),
                ));
            }
        }
        if !rows.is_empty() || !removed.is_empty() {
            frames.push(frame(rows, removed));
        }
        frames
    }
}

fn frame(rows: Vec<Value>, removed: Vec<Value>) -> Value {
    Value::Object(serde_json::Map::from_iter([
        ("type".into(), Value::from(FRAME_TYPE)),
        ("rows".into(), Value::Array(rows)),
        ("removed".into(), Value::Array(removed)),
    ]))
}

/// One socket's registration; dropping it unregisters the socket.
pub struct Subscription {
    id: u64,
    rows: ThreadListRows,
    notify: Arc<Notify>,
}

impl Subscription {
    /// Applies a `listStream` frame inline.
    pub fn set_visible(&self, visible: bool) {
        let mut hub = self.rows.lock();
        if let Some(entry) = hub.subscribers.get_mut(&self.id) {
            entry.state.set_visible(visible);
        }
    }

    /// Waits until a flush is due and returns its frames (never empty).
    /// Cancel-safe: dirty rows stay in the hub until the frames are taken,
    /// and the frames are returned in the same poll that takes them.
    pub async fn next_frames(&self, in_interest: impl Fn(&str) -> bool) -> Vec<Value> {
        loop {
            match self.rows.poll(self.id, Instant::now(), &in_interest) {
                PollOutcome::Frames(frames) if !frames.is_empty() => return frames,
                PollOutcome::Frames(_) => {}
                PollOutcome::Idle => self.notify.notified().await,
                PollOutcome::WaitUntil(deadline) => {
                    tokio::select! {
                        () = tokio::time::sleep_until(deadline.into()) => {}
                        () = self.notify.notified() => {}
                    }
                }
            }
        }
    }
}

impl Drop for Subscription {
    fn drop(&mut self) {
        self.rows.lock().subscribers.remove(&self.id);
    }
}

#[cfg(test)]
#[path = "hub_tests.rs"]
mod tests;
