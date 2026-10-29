//! The Companion-side store of thread-list rows and the reducer of journaled
//! payloads onto them.
//!
//! A row is the `thread/list` row after every Companion decoration, with
//! `turns: []`, plus [`ListRowMeta`] (`codewideList` on the wire). The store
//! is the only owner of the server fields a device shows: journaled events
//! change them here and a page read replaces them by the rule of
//! [`RowStore::observe_page`]. The rules the device used to apply in
//! `retainLiveCatalogState` live here and hold for both: a listed `notLoaded`
//! never replaces a live `active` status, and `recencyAt` never decreases.
//!
//! `cursor` is the journal cursor of the last change applied to the row. A
//! page row read after the journal head `H` gets cursor `H` exactly; a row
//! changed after `H` keeps its own fields and cursor, so provider content
//! never carries a cursor above the head it was read after.
//!
//! The store holds at most [`MAX_TRACKED_ROWS`] rows; the row with the oldest
//! change is evicted first and becomes unknown again (no tombstone). Deleted
//! threads leave a bounded tombstone so a subscriber flush can still name
//! them. Pure state: no clock, storage or provider access.

use std::collections::{BTreeSet, HashMap, VecDeque};

use serde_json::{Map, Value, json};

use super::{
    MAX_TRACKED_ROWS, ROW_FIELD, ROW_SOURCE_KINDS,
    flush::{FlushClass, is_user_request, method_class},
};
use crate::{thread_activity::LIVE_ACTIVITY_FIELD, thread_patch::THREAD_PATCH_FIELD};

/// Most tombstones kept for subscriber flushes.
const MAX_TOMBSTONES: usize = 1_024;

/// Server-owned row metadata, `codewideList` on the wire.
#[derive(Clone, Debug, PartialEq)]
pub struct ListRowMeta {
    /// Journal cursor of the last change applied to the row.
    pub cursor: u64,
    pub archived: bool,
    /// The `contract/v1.json threadProjectionPatch.liveActivity` value, or
    /// `None` while the agent shows no activity.
    pub live_activity: Option<Value>,
}

impl ListRowMeta {
    fn to_wire(&self) -> Value {
        json!({
            "cursor": self.cursor,
            "archived": self.archived,
            "liveActivity": self.live_activity.clone().unwrap_or(Value::Null),
        })
    }
}

/// A removed row: the thread was deleted or left the catalog at `cursor`.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RowTombstone {
    pub thread_id: String,
    pub cursor: u64,
}

impl RowTombstone {
    pub(super) fn to_wire(&self) -> Value {
        json!({"threadId": self.thread_id, "cursor": self.cursor})
    }
}

/// How a `thread/started` notification seeds its row; decided by the sync
/// layer, which owns the decorations and the catalog filter.
#[derive(Clone, Debug)]
pub enum Seed {
    /// The decorated row of the started thread.
    Row(Value),
    /// The catalog filter hides the thread.
    Excluded,
}

/// A status change a payload asks for.
#[derive(Clone, Debug, PartialEq)]
enum StatusChange {
    /// `thread/status/changed`: the status itself.
    Set(Value),
    /// `turn/started`, or a rollout progress with an active turn.
    Active,
    /// `turn/completed`.
    Idle,
    /// A rollout terminal boundary: an active row becomes idle.
    Retire,
}

/// A field a payload sets or clears.
#[derive(Clone, Debug, PartialEq)]
enum FieldChange {
    Set(Value),
    Clear,
}

impl FieldChange {
    fn of(value: &Value) -> Self {
        if value.is_null() {
            Self::Clear
        } else {
            Self::Set(value.clone())
        }
    }

    fn into_option(self) -> Option<Value> {
        match self {
            Self::Set(value) => Some(value),
            Self::Clear => None,
        }
    }
}

/// The server fields one payload changes.
#[derive(Clone, Debug, Default, PartialEq)]
struct RowUpdate {
    status: Option<StatusChange>,
    name: Option<FieldChange>,
    archived: Option<bool>,
    /// `(pinned, pinCursor)`.
    pin: Option<(bool, u64)>,
    preview: Option<String>,
    /// Activity bumps `updatedAt` to the observation time.
    activity: bool,
    recency_at: Option<i64>,
    live_activity: Option<FieldChange>,
}

impl RowUpdate {
    /// Whether the thread is doing something: only then is the row of an
    /// unknown thread read. A pin, name or archive change of an unknown
    /// thread waits for its row like any other field.
    fn is_activity(&self) -> bool {
        self.status.is_some()
            || self.activity
            || self.preview.is_some()
            || self.live_activity.is_some()
    }
}

#[derive(Clone, Debug, PartialEq)]
enum EventKind {
    Started(Value),
    Excluded,
    Deleted,
    /// A user request: the row flushes urgently without changing.
    Request,
    Update(RowUpdate),
}

/// One journaled payload reduced to what a list row needs. Small and owned,
/// so a thread waiting for its first row can buffer it.
#[derive(Clone, Debug, PartialEq)]
pub(super) struct RowEvent {
    pub(super) thread_id: String,
    pub(super) cursor: u64,
    class: FlushClass,
    kind: EventKind,
}

impl RowEvent {
    /// Whether the catalog hides the thread from now on.
    pub(super) fn is_exclusion(&self) -> bool {
        self.kind == EventKind::Excluded
    }

    /// Whether the event starts or ends a turn or changes the thread status.
    pub(super) fn is_lifecycle(&self) -> bool {
        matches!(&self.kind, EventKind::Update(update) if update.status.is_some())
    }

    /// Reduces a journaled payload (patch attached) at `cursor`. `streamed`
    /// is the accumulated answer preview observed before projection; `seed`
    /// the decorated row of a `thread/started`. `None` when the payload
    /// changes no row.
    pub(super) fn parse(
        payload: &Value,
        cursor: u64,
        streamed: Option<String>,
        seed: Option<Seed>,
    ) -> Option<Self> {
        let method = payload.get("method")?.as_str()?;
        let params = payload.get("params")?.as_object()?;
        let thread_id = params
            .get("threadId")
            .and_then(Value::as_str)
            .or_else(|| params.get("thread")?.get("id")?.as_str())?
            .to_owned();
        let kind = match method {
            "thread/started" => match seed {
                Some(Seed::Excluded) => EventKind::Excluded,
                Some(Seed::Row(row)) => EventKind::Started(row),
                None => EventKind::Started(params.get("thread")?.clone()),
            },
            "thread/deleted" => EventKind::Deleted,
            _ if is_user_request(method) => EventKind::Request,
            _ => {
                let update = row_update(payload, params, streamed);
                if update == RowUpdate::default() {
                    return None;
                }
                EventKind::Update(update)
            }
        };
        Some(Self {
            thread_id,
            cursor,
            class: method_class(method),
            kind,
        })
    }
}

fn row_update(payload: &Value, params: &Map<String, Value>, streamed: Option<String>) -> RowUpdate {
    let mut update = RowUpdate::default();
    let operation = payload
        .get(THREAD_PATCH_FIELD)
        .and_then(|patch| patch.get("operation"))
        .and_then(Value::as_object);
    if let Some(operation) = operation {
        let turn_active = operation.get("turnActive").and_then(Value::as_bool);
        match operation.get("kind").and_then(Value::as_str) {
            Some("threadStatus") => {
                update.status = params
                    .get("status")
                    .filter(|status| status.is_object())
                    .cloned()
                    .map(StatusChange::Set);
            }
            Some("turnStarted") => update.status = Some(StatusChange::Active),
            Some("turnCompleted") => update.status = Some(StatusChange::Idle),
            Some("threadProgress") if turn_active == Some(true) => {
                update.status = Some(StatusChange::Active);
            }
            Some("threadInvalidated") if turn_active == Some(false) => {
                update.status = Some(StatusChange::Retire);
            }
            Some("threadName") => {
                update.name = Some(
                    params
                        .get("threadName")
                        .filter(|name| name.is_string())
                        .map_or(FieldChange::Clear, FieldChange::of),
                );
            }
            Some("threadArchived") => {
                update.archived = operation.get("archived").and_then(Value::as_bool);
            }
            Some("threadPinned") => {
                update.pin = params
                    .get("pinned")
                    .and_then(Value::as_bool)
                    .zip(params.get("pinCursor").and_then(Value::as_u64));
            }
            _ => {}
        }
        if let Some(summary) = operation
            .get("summary")
            .filter(|summary| summary.get("activity").and_then(Value::as_bool) == Some(true))
        {
            update.activity = true;
            update.preview = summary
                .get("previewText")
                .and_then(Value::as_str)
                .filter(|text| !text.trim().is_empty())
                .map(str::to_owned);
            update.recency_at = summary
                .get("recencyAt")
                .and_then(Value::as_i64)
                .filter(|value| *value >= 0);
        }
        if let Some(activity) = operation.get(LIVE_ACTIVITY_FIELD) {
            update.live_activity = Some(FieldChange::of(activity));
        }
    }
    if let Some(text) = streamed {
        update.activity = true;
        update.preview = Some(text);
    }
    update
}

/// What applying one event did to the store.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) enum Applied {
    /// No row changed and nothing needs flushing.
    Unchanged,
    /// The row (or its tombstone) is dirty with this class.
    Dirty(FlushClass),
    /// The thread has no row; the event waits for its first row.
    Unknown,
}

struct StoredRow {
    /// The decorated row object without `codewideList`.
    value: Value,
    meta: ListRowMeta,
}

#[derive(Default)]
pub(super) struct RowStore {
    rows: HashMap<String, StoredRow>,
    /// `(cursor, threadId)` of every row: the eviction order.
    by_cursor: BTreeSet<(u64, String)>,
    tombstones: HashMap<String, u64>,
    tombstone_order: VecDeque<String>,
}

impl RowStore {
    pub(super) fn contains(&self, thread_id: &str) -> bool {
        self.rows.contains_key(thread_id)
    }

    /// Whether subscribers receive the row: a CLI or VS Code thread, a child
    /// of another thread, or a non-primary provider's row. Unknown rows are
    /// not streamed.
    pub(super) fn streamable(&self, thread_id: &str) -> bool {
        self.rows
            .get(thread_id)
            .is_some_and(|row| streamable_value(&row.value))
    }

    /// The wire row (`codewideList` attached), if the thread has one.
    pub(super) fn wire_row(&self, thread_id: &str) -> Option<Value> {
        let row = self.rows.get(thread_id)?;
        let mut value = row.value.clone();
        if let Some(object) = value.as_object_mut() {
            object.insert(ROW_FIELD.into(), row.meta.to_wire());
        }
        Some(value)
    }

    /// The tombstone of a removed thread still remembered.
    pub(super) fn tombstone(&self, thread_id: &str) -> Option<RowTombstone> {
        self.tombstones.get(thread_id).map(|&cursor| RowTombstone {
            thread_id: thread_id.to_owned(),
            cursor,
        })
    }

    #[cfg(test)]
    pub(super) fn meta(&self, thread_id: &str) -> Option<&ListRowMeta> {
        self.rows.get(thread_id).map(|row| &row.meta)
    }

    #[cfg(test)]
    pub(super) fn len(&self) -> usize {
        self.rows.len()
    }

    /// Applies one event at `now_secs` (the observation time for
    /// `updatedAt`).
    pub(super) fn apply(&mut self, event: &RowEvent, now_secs: i64) -> Applied {
        match &event.kind {
            EventKind::Started(thread) => {
                let archived = self
                    .rows
                    .get(&event.thread_id)
                    .is_some_and(|row| row.meta.archived);
                let live_activity = self
                    .rows
                    .get(&event.thread_id)
                    .and_then(|row| row.meta.live_activity.clone());
                self.insert(
                    &event.thread_id,
                    row_value(thread.clone()),
                    ListRowMeta {
                        cursor: event.cursor,
                        archived,
                        live_activity,
                    },
                );
                Applied::Dirty(FlushClass::Urgent)
            }
            EventKind::Excluded | EventKind::Deleted => {
                self.remove(&event.thread_id, event.cursor);
                Applied::Dirty(FlushClass::Urgent)
            }
            EventKind::Request => {
                if self.rows.contains_key(&event.thread_id) {
                    Applied::Dirty(FlushClass::Urgent)
                } else {
                    Applied::Unchanged
                }
            }
            EventKind::Update(update) => {
                let Some(row) = self.rows.get_mut(&event.thread_id) else {
                    return if update.is_activity() {
                        Applied::Unknown
                    } else {
                        Applied::Unchanged
                    };
                };
                let changed = apply_update(row, update, now_secs);
                if changed.is_some() {
                    let previous = row.meta.cursor;
                    row.meta.cursor = previous.max(event.cursor);
                    let cursor = row.meta.cursor;
                    self.reindex(&event.thread_id, previous, cursor);
                }
                match changed.map_or(event.class, |class| class.max(event.class)) {
                    FlushClass::Urgent => Applied::Dirty(FlushClass::Urgent),
                    FlushClass::Coalesced if changed.is_some() => {
                        Applied::Dirty(FlushClass::Coalesced)
                    }
                    FlushClass::Coalesced => Applied::Unchanged,
                }
            }
        }
    }

    /// Applies one page read after journal head `head` and rewrites its rows
    /// for the response: a row changed after `head` answers with the store's
    /// fields and cursor; any other row answers with the provider's content
    /// (live status and recency retained) at cursor `head` and replaces the
    /// stored row. A row deleted after `head` stays deleted here.
    pub(super) fn observe_page(&mut self, rows: &mut [Value], head: u64, archived: bool) {
        for row in rows.iter_mut() {
            let Some(thread_id) = row.get("id").and_then(Value::as_str).map(str::to_owned) else {
                continue;
            };
            if let Some(stored) = self.rows.get(&thread_id)
                && stored.meta.cursor > head
            {
                if let Some(wire) = self.wire_row(&thread_id) {
                    *row = wire;
                }
                continue;
            }
            if self
                .tombstones
                .get(&thread_id)
                .is_some_and(|&cursor| cursor > head)
            {
                attach_meta(
                    row,
                    &ListRowMeta {
                        cursor: head,
                        archived,
                        live_activity: None,
                    },
                );
                continue;
            }
            let mut value = row_value(row.clone());
            let live_activity = self.rows.get(&thread_id).and_then(|stored| {
                retain_live_state(&mut value, &stored.value);
                stored.meta.live_activity.clone()
            });
            let meta = ListRowMeta {
                cursor: head,
                archived,
                live_activity,
            };
            *row = value.clone();
            attach_meta(row, &meta);
            self.insert(&thread_id, value, meta);
        }
    }

    /// Inserts or replaces a row; at the bound the row with the oldest change
    /// is evicted first (never the row being inserted).
    pub(super) fn insert(&mut self, thread_id: &str, value: Value, meta: ListRowMeta) {
        if let Some(previous) = self.rows.remove(thread_id) {
            self.by_cursor
                .remove(&(previous.meta.cursor, thread_id.to_owned()));
        }
        self.forget_tombstone(thread_id);
        while self.rows.len() >= MAX_TRACKED_ROWS {
            let Some((_, oldest)) = self.by_cursor.pop_first() else {
                break;
            };
            self.rows.remove(&oldest);
        }
        self.by_cursor.insert((meta.cursor, thread_id.to_owned()));
        self.rows
            .insert(thread_id.to_owned(), StoredRow { value, meta });
    }

    /// Applies buffered events to a row read for an unknown thread. The
    /// buffer is the ordered suffix of the thread's events since the first
    /// one, so replaying it leaves every event-driven field as its last
    /// event set it. Returns the strongest flush class.
    pub(super) fn seed(
        &mut self,
        thread_id: &str,
        value: Value,
        head: u64,
        buffered: &[RowEvent],
        now_secs: i64,
    ) -> FlushClass {
        // A page that stored the row after this read began is fresher.
        let stored = self.rows.get(thread_id);
        if stored.is_none_or(|stored| stored.meta.cursor <= head) {
            let mut value = row_value(value);
            let mut meta = ListRowMeta {
                cursor: head,
                archived: false,
                live_activity: None,
            };
            if let Some(stored) = stored {
                retain_live_state(&mut value, &stored.value);
                meta.archived = stored.meta.archived;
                meta.live_activity.clone_from(&stored.meta.live_activity);
            }
            self.insert(thread_id, value, meta);
        }
        let mut class = FlushClass::Urgent;
        for event in buffered {
            if let Applied::Dirty(applied) = self.apply(event, now_secs) {
                class = class.max(applied);
            }
        }
        class
    }

    fn remove(&mut self, thread_id: &str, cursor: u64) {
        if let Some(previous) = self.rows.remove(thread_id) {
            self.by_cursor
                .remove(&(previous.meta.cursor, thread_id.to_owned()));
        }
        self.forget_tombstone(thread_id);
        if self.tombstone_order.len() >= MAX_TOMBSTONES
            && let Some(oldest) = self.tombstone_order.pop_front()
        {
            self.tombstones.remove(&oldest);
        }
        self.tombstones.insert(thread_id.to_owned(), cursor);
        self.tombstone_order.push_back(thread_id.to_owned());
    }

    fn forget_tombstone(&mut self, thread_id: &str) {
        if self.tombstones.remove(thread_id).is_some() {
            self.tombstone_order.retain(|id| id != thread_id);
        }
    }

    fn reindex(&mut self, thread_id: &str, previous: u64, cursor: u64) {
        if previous != cursor {
            self.by_cursor.remove(&(previous, thread_id.to_owned()));
            self.by_cursor.insert((cursor, thread_id.to_owned()));
        }
    }
}

/// The stored form of a row: `turns: []` and no `codewideList`.
fn row_value(mut value: Value) -> Value {
    if let Some(object) = value.as_object_mut() {
        object.insert("turns".into(), Value::Array(Vec::new()));
        object.remove(ROW_FIELD);
    }
    value
}

fn attach_meta(row: &mut Value, meta: &ListRowMeta) {
    if let Some(object) = row.as_object_mut() {
        object.insert(ROW_FIELD.into(), meta.to_wire());
    }
}

/// The merged `thread/list` rule: a CLI or VS Code thread, a child of
/// another thread, or any row of a non-primary provider (listed whatever its
/// `source`, which is `appServer` for neutral providers).
fn streamable_value(row: &Value) -> bool {
    row.get("parentThreadId")
        .is_some_and(|parent| !parent.is_null())
        || row
            .get("source")
            .and_then(Value::as_str)
            .is_some_and(|source| ROW_SOURCE_KINDS.contains(&source))
        || row
            .pointer("/codewideAgent/primary")
            .and_then(Value::as_bool)
            == Some(false)
}

fn status_type(row: &Value) -> Option<&str> {
    row.get("status")?.get("type")?.as_str()
}

/// The device's former `retainLiveCatalogState`: a provider `notLoaded`
/// keeps a live `active` status, and `recencyAt` never moves backwards.
fn retain_live_state(page: &mut Value, previous: &Value) {
    if status_type(page) == Some("notLoaded")
        && status_type(previous) == Some("active")
        && let Some(status) = previous.get("status")
    {
        page["status"] = status.clone();
    }
    let previous_recency = previous.get("recencyAt").and_then(Value::as_i64);
    let page_recency = page.get("recencyAt").and_then(Value::as_i64);
    if let Some(previous_recency) = previous_recency
        && page_recency.is_none_or(|recency| recency < previous_recency)
    {
        page["recencyAt"] = Value::from(previous_recency);
    }
}

/// Applies the update and returns the class of what changed, if anything.
fn apply_update(row: &mut StoredRow, update: &RowUpdate, now_secs: i64) -> Option<FlushClass> {
    let mut urgent = false;
    let mut coalesced = false;
    if let Some(status) = &update.status {
        let next = match status {
            StatusChange::Set(status) => Some(status.clone()),
            StatusChange::Active => (status_type(&row.value) != Some("active"))
                .then(|| json!({"type": "active", "activeFlags": []})),
            StatusChange::Idle => Some(json!({"type": "idle"})),
            StatusChange::Retire => {
                (status_type(&row.value) == Some("active")).then(|| json!({"type": "idle"}))
            }
        };
        urgent |= replace_field(&mut row.value, "status", next);
    }
    if let Some(name) = &update.name {
        let name = name.clone().into_option().unwrap_or(Value::Null);
        urgent |= replace_field(&mut row.value, "name", Some(name));
    }
    if let Some(archived) = update.archived
        && row.meta.archived != archived
    {
        row.meta.archived = archived;
        urgent = true;
    }
    if let Some((pinned, cursor)) = update.pin {
        urgent |= apply_pin(&mut row.value, pinned, cursor);
    }
    if let Some(preview) = &update.preview {
        coalesced |= replace_field(
            &mut row.value,
            "preview",
            Some(Value::String(preview.clone())),
        );
    }
    if update.activity {
        let updated_at = row.value.get("updatedAt").and_then(Value::as_i64);
        if updated_at.is_none_or(|updated_at| updated_at < now_secs) {
            coalesced |= replace_field(&mut row.value, "updatedAt", Some(Value::from(now_secs)));
        }
    }
    if let Some(recency_at) = update.recency_at {
        let current = row.value.get("recencyAt").and_then(Value::as_i64);
        if current.is_none_or(|current| current < recency_at) {
            coalesced |= replace_field(&mut row.value, "recencyAt", Some(Value::from(recency_at)));
        }
    }
    if let Some(activity) = &update.live_activity {
        let activity = activity.clone().into_option();
        if row.meta.live_activity != activity {
            row.meta.live_activity = activity;
            coalesced = true;
        }
    }
    if urgent {
        Some(FlushClass::Urgent)
    } else if coalesced {
        Some(FlushClass::Coalesced)
    } else {
        None
    }
}

/// Sets `field` to `next` when it differs; returns whether it changed.
fn replace_field(row: &mut Value, field: &str, next: Option<Value>) -> bool {
    let Some(next) = next else {
        return false;
    };
    let Some(object) = row.as_object_mut() else {
        return false;
    };
    if object.get(field) == Some(&next) {
        return false;
    }
    object.insert(field.into(), next);
    true
}

/// Applies a pin change ordered by its pin cursor, in the shape of
/// `thread_pins::annotate`.
fn apply_pin(row: &mut Value, pinned: bool, cursor: u64) -> bool {
    let current = row
        .pointer("/codewide/threadPin")
        .and_then(|pin| Some((pin.get("pinned")?.as_bool()?, pin.get("cursor")?.as_u64()?)));
    if current.is_some_and(|(current_pinned, current_cursor)| {
        current_cursor > cursor || (current_cursor == cursor && current_pinned == pinned)
    }) {
        return false;
    }
    let Some(object) = row.as_object_mut() else {
        return false;
    };
    let Some(metadata) = object
        .entry("codewide")
        .or_insert_with(|| json!({}))
        .as_object_mut()
    else {
        return false;
    };
    metadata.insert(
        "threadPin".into(),
        json!({"version": 1, "pinned": pinned, "cursor": cursor}),
    );
    true
}

#[cfg(test)]
#[path = "rows_tests.rs"]
mod tests;
