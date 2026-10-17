//! Per-socket delivery interest for the `/v1/sync` replay stream.
//!
//! The durable journal stays unfiltered and at-least-once for every socket.
//! Filtering happens at send time: a journal entry whose attached
//! `codewideThreadPatch` has one of the eight high-frequency *thread topic*
//! kinds (see [`THREAD_TOPIC_KINDS`], mirrored in `contract/v1.json`
//! `syncInterest.threadTopicKinds`) is delivered only to sockets interested
//! in that thread. Everything else is a *catalog topic* and is always
//! delivered, including any patch that carries a `liveActivity` change.
//!
//! Interest-based delivery is the only mode: `hello.interest` is mandatory and
//! every `event` frame carries `afterCursor`, the socket position before the
//! frame. A skipped entry does not move the position; when a page ends with
//! skipped entries, one `advance` frame moves the position to the page head so
//! the device can keep a contiguous cursor chain. The window math
//! (`delivered_cursor`, replay limits) is untouched: each page delivery ends at
//! the page head.
//!
//! This module owns parsing and limits of `hello.interest` and `interest`
//! frames, the delivery predicate, the position chain and the wire shape of
//! `event` / `advance`. It imports no thread view or provider code.

use std::{
    collections::HashSet,
    sync::{Arc, Mutex, MutexGuard},
};

use serde_json::{Map, Value, json};
use tracing::{debug, warn};

use crate::{thread_activity::LIVE_ACTIVITY_FIELD, thread_patch::THREAD_PATCH_FIELD};

/// `codewideThreadPatch.operation.kind` values delivered only by interest.
/// One list shared with `contract/v1.json`; extending it is a contract change.
pub const THREAD_TOPIC_KINDS: [&str; 8] = [
    "itemTextDelta",
    "reasoningDelta",
    "reasoningPart",
    "turnPlan",
    "turnDiff",
    "fileChanges",
    "mcpProgress",
    "tokenUsage",
];
/// Largest interest set one socket may hold.
pub const MAX_INTEREST_THREADS: usize = 64;
/// Longest thread id accepted in an interest list, in characters.
pub const MAX_INTEREST_THREAD_ID_CHARS: usize = 256;
/// Hello key and client frame type carrying interest.
pub const INTEREST_FIELD: &str = "interest";
/// Frame closing the skipped tail of a replay page.
pub const ADVANCE_FRAME_TYPE: &str = "advance";
/// WebSocket close code for every interest rejection (as for the neighbouring
/// control frames).
pub const INTEREST_CLOSE_CODE: u16 = 1008;

/// Why a hello or `interest` frame closes the socket.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum InterestRejection {
    /// `hello` has no `interest` key.
    InterestRequired,
    /// `interest`/`add`/`remove` is not an array of at most
    /// [`MAX_INTEREST_THREADS`] non-empty strings within
    /// [`MAX_INTEREST_THREAD_ID_CHARS`], counting duplicates.
    InvalidInterest,
    /// The resulting set would hold more than [`MAX_INTEREST_THREADS`].
    InterestLimitExceeded,
}

impl InterestRejection {
    /// The close frame reason.
    #[must_use]
    pub const fn reason(self) -> &'static str {
        match self {
            Self::InterestRequired => "interest_required",
            Self::InvalidInterest => "invalid_interest",
            Self::InterestLimitExceeded => "interest_limit_exceeded",
        }
    }
}

/// Sizes of an accepted `interest` frame, for diagnostics (no thread ids).
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct InterestChange {
    pub added: usize,
    pub removed: usize,
    pub threads: usize,
}

/// The set of thread ids one socket is interested in. Created once from
/// `hello.interest`; changed only by `interest` frames.
#[derive(Debug, Default)]
pub struct SocketInterest {
    threads: HashSet<String>,
}

impl SocketInterest {
    /// Parses the mandatory `interest` key of a client hello.
    ///
    /// # Errors
    ///
    /// Returns the rejection to close the socket with.
    pub fn from_hello(hello: &Value) -> Result<Self, InterestRejection> {
        let interest = hello
            .get(INTEREST_FIELD)
            .ok_or(InterestRejection::InterestRequired)?;
        let mut threads = HashSet::new();
        for thread_id in thread_ids(interest)? {
            threads.insert(thread_id.to_owned());
        }
        if threads.len() > MAX_INTEREST_THREADS {
            return Err(InterestRejection::InterestLimitExceeded);
        }
        Ok(Self { threads })
    }

    /// Applies an `interest` frame: the set becomes `(threads ∪ add) \ remove`.
    /// Both lists are optional and the frame is idempotent.
    ///
    /// # Errors
    ///
    /// Returns the rejection to close the socket with; the set is unchanged.
    pub fn apply(&mut self, frame: &Value) -> Result<InterestChange, InterestRejection> {
        let added = match frame.get("add") {
            Some(add) => thread_ids(add)?.collect::<Vec<_>>(),
            None => Vec::new(),
        };
        let removed = match frame.get("remove") {
            Some(remove) => thread_ids(remove)?.collect::<Vec<_>>(),
            None => Vec::new(),
        };
        let mut next = self.threads.clone();
        for thread_id in &added {
            next.insert((*thread_id).to_owned());
        }
        for thread_id in &removed {
            next.remove(*thread_id);
        }
        if next.len() > MAX_INTEREST_THREADS {
            return Err(InterestRejection::InterestLimitExceeded);
        }
        self.threads = next;
        Ok(InterestChange {
            added: added.len(),
            removed: removed.len(),
            threads: self.threads.len(),
        })
    }

    /// Number of interested threads.
    #[must_use]
    pub fn len(&self) -> usize {
        self.threads.len()
    }

    /// Whether no thread is interested.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.threads.is_empty()
    }

    /// Whether this socket receives the journaled payload now.
    #[must_use]
    pub fn delivers(&self, payload: &Value) -> bool {
        delivers_to(&self.threads, payload)
    }
}

/// One socket's interest, written inline by the session loop and read by the
/// live replay task after each page read.
pub(crate) type SharedInterest = Arc<Mutex<SocketInterest>>;

/// Locks a socket's interest. A poisoned lock still holds a valid set: every
/// mutation replaces it whole after validation.
pub(crate) fn lock_interest(interest: &SharedInterest) -> MutexGuard<'_, SocketInterest> {
    match interest.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    }
}

/// Parses `hello.interest` into the socket's shared interest. A rejection is
/// logged with its reason and the requested size only; the caller closes the
/// socket with [`INTEREST_CLOSE_CODE`].
///
/// # Errors
///
/// Returns the rejection to close the socket with.
pub(crate) fn accept_hello_interest(hello: &Value) -> Result<SharedInterest, InterestRejection> {
    SocketInterest::from_hello(hello)
        .map(|interest| Arc::new(Mutex::new(interest)))
        .inspect_err(|rejection| {
            let requested = list_len(hello.get(INTEREST_FIELD));
            warn!(
                reason = rejection.reason(),
                requested, "sync client hello rejected"
            );
        })
}

/// Applies one `interest` frame to the socket's shared interest and logs the
/// outcome with sizes only, never thread ids. The caller closes the socket
/// with [`INTEREST_CLOSE_CODE`] on rejection.
///
/// # Errors
///
/// Returns the rejection to close the socket with; the set is unchanged.
pub(crate) fn apply_interest_frame(
    interest: &SharedInterest,
    frame: &Value,
) -> Result<(), InterestRejection> {
    let mut interest = lock_interest(interest);
    match interest.apply(frame) {
        Ok(change) => {
            debug!(
                added = change.added,
                removed = change.removed,
                threads = change.threads,
                "sync client interest updated"
            );
            Ok(())
        }
        Err(rejection) => {
            warn!(
                reason = rejection.reason(),
                add = list_len(frame.get("add")),
                remove = list_len(frame.get("remove")),
                threads = interest.len(),
                "sync client interest frame rejected"
            );
            Err(rejection)
        }
    }
}

/// Length of an interest list for diagnostics; ids themselves are not logged.
fn list_len(list: Option<&Value>) -> usize {
    list.and_then(Value::as_array).map_or(0, Vec::len)
}

/// Validates one interest list and yields its ids. The element bound applies
/// before deduplication, so the work per frame is bounded at the boundary.
fn thread_ids(list: &Value) -> Result<impl Iterator<Item = &str>, InterestRejection> {
    let items = list.as_array().ok_or(InterestRejection::InvalidInterest)?;
    if items.len() > MAX_INTEREST_THREADS {
        return Err(InterestRejection::InvalidInterest);
    }
    let mut ids = Vec::with_capacity(items.len());
    for item in items {
        let id = item.as_str().ok_or(InterestRejection::InvalidInterest)?;
        if id.is_empty() || id.chars().count() > MAX_INTEREST_THREAD_ID_CHARS {
            return Err(InterestRejection::InvalidInterest);
        }
        ids.push(id);
    }
    Ok(ids.into_iter())
}

/// The delivery predicate: catalog topics always, thread topics only for
/// interested threads, and any `liveActivity`-bearing patch always.
fn delivers_to(threads: &HashSet<String>, payload: &Value) -> bool {
    let Some(patch) = payload.get(THREAD_PATCH_FIELD) else {
        return true;
    };
    let Some(operation) = patch.get("operation") else {
        return true;
    };
    let is_thread_topic = operation
        .get("kind")
        .and_then(Value::as_str)
        .is_some_and(|kind| THREAD_TOPIC_KINDS.contains(&kind));
    if !is_thread_topic || operation.get(LIVE_ACTIVITY_FIELD).is_some() {
        return true;
    }
    patch
        .get("threadId")
        .and_then(Value::as_str)
        .is_none_or(|thread_id| threads.contains(thread_id))
}

/// The last cursor the socket is considered to have accepted. Defined once a
/// socket has a cursor to replay after: `hello.cursor` when it is not null,
/// otherwise only after `snapshotApplied`.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct SocketPosition(u64);

/// An `advance` to send: the position moves from `after_cursor` to `cursor`.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct Advance {
    pub cursor: u64,
    pub after_cursor: u64,
}

impl SocketPosition {
    #[must_use]
    pub const fn new(cursor: u64) -> Self {
        Self(cursor)
    }

    #[must_use]
    pub const fn cursor(self) -> u64 {
        self.0
    }

    /// Returns the `afterCursor` of an event at `cursor` and moves to it.
    pub fn next_event(&mut self, cursor: u64) -> u64 {
        let after = self.0;
        self.0 = cursor;
        after
    }

    /// Closes the skipped tail up to `head` when the position is behind it.
    pub fn advance_to(&mut self, head: u64) -> Option<Advance> {
        if head <= self.0 {
            return None;
        }
        let after_cursor = self.0;
        self.0 = head;
        Some(Advance {
            cursor: head,
            after_cursor,
        })
    }
}

/// One replay page's delivery through an interest snapshot. Create it after
/// the page has been read: an `interest add` applied later has a
/// `companion/thread/sync` fence at or past this page's head, so the entries
/// it would have delivered are covered by the sync answer.
pub struct ReplayDelivery {
    threads: HashSet<String>,
    position: SocketPosition,
}

impl ReplayDelivery {
    #[must_use]
    pub fn new(interest: &SocketInterest, position: u64) -> Self {
        Self {
            threads: interest.threads.clone(),
            position: SocketPosition::new(position),
        }
    }

    /// Whether the journaled payload is delivered by this page.
    #[must_use]
    pub fn delivers(&self, payload: &Value) -> bool {
        delivers_to(&self.threads, payload)
    }

    /// The `event` frame for a delivered entry; moves the position to it.
    pub fn event_frame(&mut self, cursor: u64, payload: Value) -> Value {
        let after_cursor = self.position.next_event(cursor);
        Value::Object(Map::from_iter([
            ("type".into(), Value::from("event")),
            ("cursor".into(), Value::from(cursor)),
            ("afterCursor".into(), Value::from(after_cursor)),
            ("payload".into(), payload),
        ]))
    }

    /// The `advance` frame closing the page's skipped tail, if any.
    pub fn advance_frame(&mut self, head_cursor: u64) -> Option<Value> {
        let advance = self.position.advance_to(head_cursor)?;
        Some(json!({
            "type": ADVANCE_FRAME_TYPE,
            "cursor": advance.cursor,
            "afterCursor": advance.after_cursor,
        }))
    }

    /// The position after everything emitted so far.
    #[must_use]
    pub const fn position(&self) -> u64 {
        self.position.cursor()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn patched(thread_id: &str, kind: &str) -> Value {
        json!({
            "method": "any",
            "params": {"threadId": thread_id},
            THREAD_PATCH_FIELD: {
                "version": 1,
                "threadId": thread_id,
                "operation": {"kind": kind}
            }
        })
    }

    type TestResult = Result<(), InterestRejection>;

    fn interest(ids: &[&str]) -> Result<SocketInterest, InterestRejection> {
        SocketInterest::from_hello(&json!({"interest": ids}))
    }

    #[test]
    fn hello_requires_a_valid_bounded_interest_list() -> TestResult {
        assert_eq!(
            SocketInterest::from_hello(&json!({"type": "hello"})).err(),
            Some(InterestRejection::InterestRequired)
        );
        assert_eq!(
            SocketInterest::from_hello(&json!({"interest": null})).err(),
            Some(InterestRejection::InvalidInterest)
        );
        assert_eq!(
            SocketInterest::from_hello(&json!({"interest": [""]})).err(),
            Some(InterestRejection::InvalidInterest)
        );
        assert_eq!(
            SocketInterest::from_hello(&json!({"interest": [1]})).err(),
            Some(InterestRejection::InvalidInterest)
        );
        assert_eq!(
            SocketInterest::from_hello(
                &json!({"interest": ["x".repeat(MAX_INTEREST_THREAD_ID_CHARS + 1)]})
            )
            .err(),
            Some(InterestRejection::InvalidInterest)
        );
        let too_many = (0..=MAX_INTEREST_THREADS)
            .map(|index| format!("thread-{index}"))
            .collect::<Vec<_>>();
        assert_eq!(
            SocketInterest::from_hello(&json!({"interest": too_many})).err(),
            Some(InterestRejection::InvalidInterest)
        );
        let duplicates = vec!["same"; MAX_INTEREST_THREADS + 1];
        assert_eq!(
            SocketInterest::from_hello(&json!({"interest": duplicates})).err(),
            Some(InterestRejection::InvalidInterest),
            "the element bound counts duplicates"
        );
        assert!(interest(&[])?.is_empty());
        assert_eq!(interest(&["a", "a", "b"])?.len(), 2);
        Ok(())
    }

    #[test]
    fn interest_frames_add_and_remove_idempotently_within_the_limit() -> TestResult {
        let mut socket = interest(&["a"])?;
        assert_eq!(
            socket.apply(&json!({"type": "interest", "add": ["b", "b"]})),
            Ok(InterestChange {
                added: 2,
                removed: 0,
                threads: 2
            })
        );
        assert_eq!(
            socket.apply(&json!({"type": "interest", "remove": ["a", "missing"]})),
            Ok(InterestChange {
                added: 0,
                removed: 2,
                threads: 1
            })
        );
        assert_eq!(
            socket.apply(&json!({"type": "interest"})),
            Ok(InterestChange {
                added: 0,
                removed: 0,
                threads: 1
            })
        );
        assert_eq!(
            socket
                .apply(&json!({"type": "interest", "add": ["c"], "remove": ["c"]}))
                .map(|change| change.threads),
            Ok(1),
            "remove is applied after add"
        );
        assert_eq!(
            socket.apply(&json!({"type": "interest", "add": "b"})).err(),
            Some(InterestRejection::InvalidInterest)
        );
        assert_eq!(
            socket
                .apply(&json!({"remove": vec!["b"; MAX_INTEREST_THREADS + 1]}))
                .err(),
            Some(InterestRejection::InvalidInterest),
            "every list of a frame is bounded, duplicates included"
        );
        let fill = (0..MAX_INTEREST_THREADS)
            .map(|index| format!("fill-{index}"))
            .collect::<Vec<_>>();
        assert_eq!(
            socket.apply(&json!({"add": fill})).err(),
            Some(InterestRejection::InterestLimitExceeded),
            "frames within the element bound may not grow the set past it"
        );
        assert_eq!(socket.len(), 1, "a rejected frame leaves the set unchanged");
        Ok(())
    }

    #[test]
    fn thread_topics_reach_interested_sockets_only() -> TestResult {
        let subscribed = interest(&["mine"])?;
        let empty = interest(&[])?;
        for kind in THREAD_TOPIC_KINDS {
            assert!(subscribed.delivers(&patched("mine", kind)), "{kind}");
            assert!(!subscribed.delivers(&patched("other", kind)), "{kind}");
            assert!(!empty.delivers(&patched("mine", kind)), "{kind}");
        }
        Ok(())
    }

    #[test]
    fn catalog_topics_and_live_activity_always_deliver() -> TestResult {
        let empty = interest(&[])?;
        for kind in [
            "itemUpsert",
            "turnStarted",
            "turnCompleted",
            "threadStatus",
            "threadStarted",
            "threadName",
            "threadDeleted",
            "threadArchived",
            "threadSettings",
            "threadPinned",
            "modelRerouted",
            "threadPreview",
        ] {
            assert!(empty.delivers(&patched("other", kind)), "{kind}");
        }
        let mut with_activity = patched("other", "reasoningDelta");
        with_activity[THREAD_PATCH_FIELD]["operation"][LIVE_ACTIVITY_FIELD] =
            json!({"kind": "reasoning", "title": "Plan"});
        assert!(empty.delivers(&with_activity));
        let mut cleared = patched("other", "turnPlan");
        cleared[THREAD_PATCH_FIELD]["operation"][LIVE_ACTIVITY_FIELD] = Value::Null;
        assert!(
            empty.delivers(&cleared),
            "a cleared activity is a change too"
        );
        assert!(empty.delivers(&json!({"method": "account/updated", "params": {}})));
        assert!(empty.delivers(&json!({"method": "companion/history/changed"})));
        Ok(())
    }

    #[test]
    fn delivery_chains_after_cursor_and_closes_skipped_tails_with_advance() -> TestResult {
        let mut delivery = ReplayDelivery::new(&interest(&["mine"])?, 10);
        let event = delivery.event_frame(11, json!({"method": "turn/started"}));
        assert_eq!(event["type"], "event");
        assert_eq!(event["cursor"], 11);
        assert_eq!(event["afterCursor"], 10);
        assert!(!delivery.delivers(&patched("other", "itemTextDelta")));
        // Entry 12 skipped: the position stays at 11.
        let event = delivery.event_frame(13, json!({"method": "turn/completed"}));
        assert_eq!(event["afterCursor"], 11);
        assert_eq!(event["cursor"], 13);
        assert!(
            delivery.advance_frame(13).is_none(),
            "no advance when the page ends on a delivered entry"
        );
        // Entries 14 and 15 skipped at the tail of the page.
        assert_eq!(
            delivery.advance_frame(15),
            Some(json!({"type": "advance", "cursor": 15, "afterCursor": 13}))
        );
        assert_eq!(delivery.position(), 15);
        Ok(())
    }

    #[test]
    fn interest_snapshot_is_independent_of_later_changes() -> TestResult {
        let mut socket = interest(&[])?;
        let delivery = ReplayDelivery::new(&socket, 0);
        socket.apply(&json!({"add": ["mine"]}))?;
        assert!(!delivery.delivers(&patched("mine", "itemTextDelta")));
        assert!(socket.delivers(&patched("mine", "itemTextDelta")));
        Ok(())
    }
}

/// The journaled thread preview travels as a catalog topic, so a socket with
/// no interest still sees the answer streaming in an unsubscribed thread.
#[cfg(test)]
mod journal_tests {
    use std::sync::Arc;

    use serde_json::{Value, json};

    use super::{InterestRejection, SocketInterest};
    use crate::{
        store::IndexStore,
        sync::{IngestInput, ingest_events, tests::ingest_context},
        thread_patch::THREAD_PATCH_FIELD,
    };

    #[tokio::test]
    async fn a_streamed_answer_journals_a_catalog_preview_after_its_delta()
    -> Result<(), Box<dyn std::error::Error>> {
        let directory = tempfile::tempdir()?;
        let store = Arc::new(IndexStore::open(directory.path().join("preview.redb"))?);
        let (ingest, receiver) = tokio::sync::mpsc::channel(8);
        let (signals, _) = tokio::sync::broadcast::channel(8);
        let (fence, resolved) = tokio::sync::oneshot::channel();
        let context = ingest_context(&store, signals);
        let task = tokio::spawn(ingest_events(receiver, context));
        let delta = |text: &str| {
            json!({"method": "item/agentMessage/delta", "params": {
                "threadId": "thread", "turnId": "turn", "itemId": "answer", "delta": text
            }})
        };
        // Both deltas arrive in one batch and coalesce into one journal entry.
        ingest.send(IngestInput::Payload(delta("Hel"))).await?;
        ingest.send(IngestInput::Payload(delta("lo"))).await?;
        ingest.send(IngestInput::Fence(fence)).await?;
        assert_eq!(
            resolved.await??,
            2,
            "one delta entry plus one preview entry"
        );

        let journal = store
            .replay_after(Some(0))?
            .entries
            .into_iter()
            .map(|(_, bytes)| serde_json::from_slice::<Value>(&bytes))
            .collect::<Result<Vec<_>, _>>()?;
        assert_eq!(journal[0]["method"], "item/agentMessage/delta");
        assert_eq!(journal[0]["params"]["delta"], "Hello");
        assert_eq!(
            journal[0][THREAD_PATCH_FIELD]["operation"]["kind"],
            "itemTextDelta"
        );
        assert_eq!(
            journal[1]["method"],
            crate::thread_preview::THREAD_PREVIEW_METHOD
        );
        assert_eq!(journal[1][THREAD_PATCH_FIELD]["threadId"], "thread");
        assert_eq!(
            journal[1][THREAD_PATCH_FIELD]["operation"]["kind"],
            crate::thread_preview::THREAD_PREVIEW_KIND
        );
        assert_eq!(
            journal[1][THREAD_PATCH_FIELD]["operation"]["summary"]["previewText"],
            "Hello"
        );
        let interest = SocketInterest::from_hello(&json!({"interest": []}))
            .map_err(InterestRejection::reason)?;
        assert!(!interest.delivers(&journal[0]));
        assert!(interest.delivers(&journal[1]));
        drop(ingest);
        task.await?;
        Ok(())
    }
}
