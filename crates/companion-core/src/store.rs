use std::{
    collections::{HashMap, HashSet},
    path::Path,
    sync::Arc,
    time::{SystemTime, UNIX_EPOCH},
};

use redb::{
    Database, ReadableDatabase, ReadableTable, ReadableTableMetadata, Table, TableDefinition,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;

const REPLAY: TableDefinition<u64, &[u8]> = TableDefinition::new("sync_replay");
const OUTBOX: TableDefinition<&str, &[u8]> = TableDefinition::new("command_outbox");
const ACTIVITY_METRICS: TableDefinition<&str, &[u8]> = TableDefinition::new("activity_metrics");
const THREAD_USAGE: TableDefinition<&str, &[u8]> = TableDefinition::new("thread_usage");
const THREAD_METADATA: TableDefinition<&str, &[u8]> = TableDefinition::new("thread_metadata");
const THREAD_PINS: TableDefinition<&str, &[u8]> = TableDefinition::new("thread_pins");
const THREADS_BY_PARENT: TableDefinition<&[u8], u8> = TableDefinition::new("threads_by_parent");

mod agent_tables;
pub use agent_tables::BindingWrite;
pub use companion_host::{
    index::StoreError,
    thread_index::{IndexedThreadMetadata, ThreadPinSnapshot},
};
use companion_host::{
    index::{DerivedIndexSchema, META},
    thread_index::HostThreadIndex,
};
const SCHEMA_VERSION: u32 = 7;
const MAX_OUTBOX_COMMAND_BYTES: usize = 1024 * 1024;
const MAX_OUTBOX_OWNER_BYTES: usize = 256 * 1024 * 1024;
const MAX_RETAINED_DELIVERED_COMMANDS: usize = 128;

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum OutboxState {
    Queued,
    Uncertain,
    Failed,
    Delivered,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum OutboxPresentation {
    Delivery,
    #[default]
    Queue,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
enum OutboxQueueInputBlock {
    Text { text: String },
    Attachment { attachment_id: String, name: String },
    Skill { name: String, path: String },
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OutboxCommand {
    pub command_id: String,
    pub remote_thread_id: String,
    pub method: String,
    pub params: Value,
    pub state: OutboxState,
    #[serde(default)]
    pub presentation: OutboxPresentation,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub workspace_request_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    // Preserve historical ownership and presentation metadata when rewriting persisted rows.
    owner_context: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    queue_input: Option<Vec<OutboxQueueInputBlock>>,
    pub order: u64,
    pub created_at: u64,
    pub updated_at: u64,
    pub last_error: Option<String>,
    #[serde(default)]
    pub attempts: u32,
    #[serde(default)]
    pub next_attempt_at: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    claim: Option<OutboxClaim>,
}

impl OutboxCommand {
    /// Reports whether a completed steer claim needs reconciliation against
    /// full App Server history rather than the initial-message summary.
    #[must_use]
    pub fn has_resolved_steer_claim(&self) -> bool {
        self.claim
            .as_ref()
            .is_some_and(|claim| claim.kind == OutboxClaimKind::Steer && claim.resolved)
    }
}

#[derive(Clone, Copy)]
struct OutboxPutMetadata<'a> {
    created_at: Option<u64>,
    presentation: OutboxPresentation,
    workspace_request_id: Option<&'a str>,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
enum OutboxClaimKind {
    Dispatch,
    Steer,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct OutboxClaim {
    token: u64,
    kind: OutboxClaimKind,
    operation_id: Option<String>,
    resolved: bool,
}

#[derive(Clone, Debug, PartialEq)]
pub enum OutboxClaimOutcome {
    Acquired { command: OutboxCommand, token: u64 },
    Duplicate(OutboxCommand),
    Unavailable(Option<OutboxCommand>),
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum OutboxClaimResolution<'a> {
    Delivered,
    NotSent {
        retry_after_ms: u64,
    },
    /// The provider refused a start because the thread has an active turn:
    /// keep the command queued as "deliver after idle" without an attempt.
    Busy,
    Rejected {
        error: &'a str,
    },
    Indeterminate {
        error: &'a str,
        retry_after_ms: u64,
    },
}

#[derive(Clone, Debug, PartialEq)]
pub enum OutboxClaimResolutionOutcome {
    Applied(OutboxCommand),
    AlreadyResolved(OutboxCommand),
    Stale(Option<OutboxCommand>),
}

pub struct IndexStore {
    database: Arc<Database>,
}

#[derive(Debug, Eq, PartialEq)]
pub struct ReplayPage {
    pub head_cursor: u64,
    pub oldest_cursor: Option<u64>,
    pub retained_entries: u64,
    pub retained_bytes: u64,
    pub snapshot_required: bool,
    pub entries: Vec<(u64, Vec<u8>)>,
}

impl IndexStore {
    /// Opens an existing index or creates an empty index atomically.
    ///
    /// # Errors
    ///
    /// Returns an error if the database is unavailable, corrupt, or uses an
    /// unsupported schema version.
    pub fn open(path: impl AsRef<Path>) -> Result<Self, StoreError> {
        Self::open_with(path, &[])
    }

    /// Opens the index and migrates the derived tables of `derived` schemas
    /// in the same atomic transaction as the companion schema.
    ///
    /// # Errors
    ///
    /// Returns an error if the database is unavailable, corrupt, or uses an
    /// unsupported schema version.
    pub fn open_with(
        path: impl AsRef<Path>,
        derived: &[&dyn DerivedIndexSchema],
    ) -> Result<Self, StoreError> {
        let database = companion_host::database::open(path, "index")?;
        let write = database.begin_write()?;
        let rebuild_derived = {
            let mut meta = write.open_table(META)?;
            let stored = meta.get("schema_version")?.map(|value| value.value());
            match stored {
                Some(version) if version == u64::from(SCHEMA_VERSION) => false,
                None | Some(6) => {
                    meta.insert("schema_version", u64::from(SCHEMA_VERSION))?;
                    false
                }
                Some(2..=5) => {
                    meta.insert("schema_version", u64::from(SCHEMA_VERSION))?;
                    true
                }
                Some(version) => {
                    return Err(StoreError::Database(redb::Error::Corrupted(format!(
                        "unsupported schema version {version}"
                    ))));
                }
            }
        };
        // Derived tables are disposable and rebuilt by their owner. Metadata,
        // outbox and replay stay in this same atomic migration unchanged.
        for schema in derived {
            schema.migrate(&write, rebuild_derived)?;
        }
        {
            write.open_table(REPLAY)?;
            write.open_table(OUTBOX)?;
            write.open_table(THREAD_USAGE)?;
            write.open_table(ACTIVITY_METRICS)?;
            write.open_table(THREAD_METADATA)?;
            write.open_table(THREAD_PINS)?;
            write.open_table(THREADS_BY_PARENT)?;
            agent_tables::create(&write)?;
        }
        write.commit()?;
        Ok(Self { database })
    }

    /// The shared database handle on which provider adapters keep the
    /// derived tables they registered through [`Self::open_with`].
    #[must_use]
    pub fn database(&self) -> Arc<Database> {
        self.database.clone()
    }

    /// Atomically updates one thread's canonical metadata and parent index.
    ///
    /// # Errors
    ///
    /// Returns an error when serialization or the redb transaction fails.
    pub fn put_thread_metadata(&self, metadata: &IndexedThreadMetadata) -> Result<(), StoreError> {
        self.put_thread_metadata_batch(std::slice::from_ref(metadata))
    }

    /// Atomically updates a batch of canonical thread metadata rows.
    ///
    /// # Errors
    ///
    /// Returns an error when serialization or the redb transaction fails.
    pub fn put_thread_metadata_batch(
        &self,
        values: &[IndexedThreadMetadata],
    ) -> Result<(), StoreError> {
        let encoded = values
            .iter()
            .map(serde_json::to_vec)
            .collect::<Result<Vec<_>, _>>()?;
        let write = self.database.begin_write()?;
        {
            let mut metadata_table = write.open_table(THREAD_METADATA)?;
            let mut parents = write.open_table(THREADS_BY_PARENT)?;
            for (metadata, encoded) in values.iter().zip(encoded) {
                let previous = metadata_table
                    .get(metadata.id.as_str())?
                    .map(|value| serde_json::from_slice::<IndexedThreadMetadata>(value.value()))
                    .transpose()?;
                metadata_table.insert(metadata.id.as_str(), encoded.as_slice())?;
                if let Some(previous_parent) = previous.and_then(|value| value.parent_thread_id) {
                    parents.remove(parent_thread_key(&previous_parent, &metadata.id).as_slice())?;
                }
                if let Some(parent) = metadata.parent_thread_id.as_deref() {
                    parents.insert(parent_thread_key(parent, &metadata.id).as_slice(), 1)?;
                }
            }
        }
        write.commit()?;
        Ok(())
    }

    /// Reads one indexed thread metadata row.
    ///
    /// # Errors
    ///
    /// Returns an error when the index cannot be read or contains invalid JSON.
    pub fn thread_metadata(
        &self,
        thread_id: &str,
    ) -> Result<Option<IndexedThreadMetadata>, StoreError> {
        let read = self.database.begin_read()?;
        let table = read.open_table(THREAD_METADATA)?;
        table
            .get(thread_id)?
            .map(|value| serde_json::from_slice(value.value()))
            .transpose()
            .map_err(StoreError::from)
    }

    /// Returns all indexed descendants of one root in parent-before-child order.
    ///
    /// # Errors
    ///
    /// Returns an error when the index cannot be read or contains invalid JSON.
    pub fn thread_descendants(
        &self,
        root_thread_id: &str,
    ) -> Result<Vec<IndexedThreadMetadata>, StoreError> {
        let read = self.database.begin_read()?;
        let parents = read.open_table(THREADS_BY_PARENT)?;
        let metadata = read.open_table(THREAD_METADATA)?;
        let mut pending = vec![root_thread_id.to_owned()];
        let mut seen = HashSet::new();
        let mut descendants = Vec::new();
        while let Some(parent) = pending.pop() {
            let prefix = parent_thread_prefix(&parent);
            let mut end = prefix.clone();
            end.push(u8::MAX);
            let mut children = parents
                .range(prefix.as_slice()..=end.as_slice())?
                .filter_map(|entry| {
                    let (key, _value) = entry.ok()?;
                    let key = key.value();
                    let child = std::str::from_utf8(&key[prefix.len()..]).ok()?;
                    seen.insert(child.to_owned()).then_some(child.to_owned())
                })
                .collect::<Vec<_>>();
            children.sort();
            for child in children.into_iter().rev() {
                if let Some(value) = metadata.get(child.as_str())? {
                    descendants.push(serde_json::from_slice(value.value())?);
                    pending.push(child);
                }
            }
        }
        Ok(descendants)
    }

    #[must_use]
    pub const fn schema_version(&self) -> u32 {
        SCHEMA_VERSION
    }

    /// Reads one companion-owned activity metrics state.
    ///
    /// # Errors
    ///
    /// Returns an error when the table cannot be read or the stored JSON is invalid.
    pub fn activity_metrics<T: for<'de> Deserialize<'de>>(
        &self,
        thread_id: &str,
    ) -> Result<Option<T>, StoreError> {
        let read = self.database.begin_read()?;
        let table = read.open_table(ACTIVITY_METRICS)?;
        table
            .get(thread_id)?
            .map(|value| serde_json::from_slice(value.value()))
            .transpose()
            .map_err(StoreError::from)
    }

    /// Atomically replaces one companion-owned activity metrics state.
    ///
    /// # Errors
    ///
    /// Returns an error when serialization or the redb transaction fails.
    pub fn put_activity_metrics<T: Serialize>(
        &self,
        thread_id: &str,
        value: &T,
    ) -> Result<(), StoreError> {
        let encoded = serde_json::to_vec(value)?;
        let write = self.database.begin_write()?;
        {
            let mut table = write.open_table(ACTIVITY_METRICS)?;
            table.insert(thread_id, encoded.as_slice())?;
        }
        write.commit()?;
        Ok(())
    }

    /// Reads one companion-owned thread usage state.
    ///
    /// # Errors
    ///
    /// Returns an error when the table cannot be read or the stored JSON is invalid.
    pub fn thread_usage<T: for<'de> Deserialize<'de>>(
        &self,
        thread_id: &str,
    ) -> Result<Option<T>, StoreError> {
        let read = self.database.begin_read()?;
        let table = read.open_table(THREAD_USAGE)?;
        table
            .get(thread_id)?
            .map(|value| serde_json::from_slice(value.value()))
            .transpose()
            .map_err(StoreError::from)
    }

    /// Atomically replaces one companion-owned thread usage state.
    ///
    /// # Errors
    ///
    /// Returns an error when serialization or the redb transaction fails.
    pub fn put_thread_usage<T: Serialize>(
        &self,
        thread_id: &str,
        value: &T,
    ) -> Result<(), StoreError> {
        let encoded = serde_json::to_vec(value)?;
        let write = self.database.begin_write()?;
        {
            let mut table = write.open_table(THREAD_USAGE)?;
            table.insert(thread_id, encoded.as_slice())?;
        }
        write.commit()?;
        Ok(())
    }

    /// Atomically appends payloads to the bounded durable sync replay tail.
    ///
    /// # Errors
    ///
    /// Returns an error when the transaction cannot be committed.
    pub fn append_replay_batch(
        &self,
        payloads: &[Vec<u8>],
        max_entries: usize,
        max_bytes: u64,
    ) -> Result<Vec<u64>, StoreError> {
        if payloads.is_empty() {
            return Ok(Vec::new());
        }
        let write = self.database.begin_write()?;
        let cursors = append_replay_transaction(&write, payloads, max_entries, max_bytes)?;
        // Pin deletion shares the upstream deletion's durable publication boundary.
        {
            let mut pins = write.open_table(THREAD_PINS)?;
            for (bytes, cursor) in payloads.iter().zip(&cursors) {
                if let Ok(payload) = serde_json::from_slice::<Value>(bytes)
                    && let Some(id) = crate::thread_pins::deleted_thread_id(&payload)
                {
                    // A tombstone prevents a late legacy import from reviving a deleted pin.
                    let encoded = serde_json::to_vec(&crate::thread_pins::ThreadPin {
                        pinned: false,
                        cursor: *cursor,
                    })?;
                    pins.insert(id, encoded.as_slice())?;
                }
            }
        }
        write.commit()?;
        Ok(cursors)
    }

    /// Reads one durable pin independently of the derived provider indexes.
    pub(crate) fn thread_pin(
        &self,
        thread_id: &str,
    ) -> Result<crate::thread_pins::ThreadPin, StoreError> {
        let read = self.database.begin_read()?;
        let pins = read.open_table(THREAD_PINS)?;
        pins.get(thread_id)?
            .map_or(Ok(crate::thread_pins::ThreadPin::default()), |row| {
                Ok(serde_json::from_slice(row.value())?)
            })
    }

    /// Captures all pinned ids and their ordering fence in one read transaction.
    pub(crate) fn thread_pin_snapshot(&self) -> Result<ThreadPinSnapshot, StoreError> {
        let read = self.database.begin_read()?;
        let cursor = read
            .open_table(META)?
            .get("replay_head")?
            .map_or(0, |row| row.value());
        let pins = read.open_table(THREAD_PINS)?;
        let mut thread_ids = Vec::new();
        for entry in pins.iter()? {
            let (id, row) = entry?;
            let pin: crate::thread_pins::ThreadPin = serde_json::from_slice(row.value())?;
            if pin.pinned {
                thread_ids.push(id.value().to_owned());
            }
        }
        Ok(ThreadPinSnapshot { cursor, thread_ids })
    }

    /// Commits a pin and its replay event atomically; pruning replay never deletes pin state.
    pub(crate) fn commit_thread_pin(
        &self,
        request: &crate::thread_pins::ThreadPinRequest,
        max_entries: usize,
        max_bytes: u64,
    ) -> Result<u64, StoreError> {
        let write = self.database.begin_write()?;
        let cursor = write
            .open_table(META)?
            .get("replay_head")?
            .map_or(1, |row| row.value().saturating_add(1));
        let payloads = [serde_json::to_vec(&request.notification(cursor))?];
        append_replay_transaction(&write, &payloads, max_entries, max_bytes)?;
        {
            let mut pins = write.open_table(THREAD_PINS)?;
            let pin = crate::thread_pins::ThreadPin {
                pinned: request.pinned,
                cursor,
            };
            let encoded = serde_json::to_vec(&pin)?;
            pins.insert(request.thread_id.as_str(), encoded.as_slice())?;
        }
        write.commit()?;
        Ok(cursor)
    }

    /// Imports unknown legacy pins atomically, preserving explicit unpins and deletion tombstones.
    pub(crate) fn import_thread_pins(
        &self,
        request: &crate::thread_pins::ThreadPinImportRequest,
        max_entries: usize,
        max_bytes: u64,
    ) -> Result<u64, StoreError> {
        let write = self.database.begin_write()?;
        let mut cursor = write
            .open_table(META)?
            .get("replay_head")?
            .map_or(0, |row| row.value());
        let mut payloads = Vec::new();
        {
            let mut pins = write.open_table(THREAD_PINS)?;
            for id in &request.thread_ids {
                if pins.get(id.as_str())?.is_some() {
                    continue;
                }
                cursor = cursor.saturating_add(1);
                let pin = crate::thread_pins::ThreadPin {
                    pinned: true,
                    cursor,
                };
                let encoded = serde_json::to_vec(&pin)?;
                pins.insert(id.as_str(), encoded.as_slice())?;
                let mutation = crate::thread_pins::ThreadPinRequest {
                    thread_id: id.clone(),
                    pinned: true,
                };
                payloads.push(serde_json::to_vec(&mutation.notification(cursor))?);
            }
        }
        append_replay_transaction(&write, &payloads, max_entries, max_bytes)?;
        write.commit()?;
        Ok(cursor)
    }

    /// Reads the retained replay suffix after a client cursor.
    ///
    /// # Errors
    ///
    /// Returns an error when the replay table cannot be read.
    pub fn replay_after(&self, cursor: Option<u64>) -> Result<ReplayPage, StoreError> {
        let read = self.database.begin_read()?;
        let meta = read.open_table(META)?;
        let replay = read.open_table(REPLAY)?;
        let head_cursor = meta.get("replay_head")?.map_or(0, |value| value.value());
        let retained_bytes = meta.get("replay_bytes")?.map_or(0, |value| value.value());
        let oldest = replay.first()?.map(|(key, _value)| key.value());
        let retained_entries = replay.len()?;
        let snapshot_required = match cursor {
            None => true,
            Some(cursor) => {
                cursor > head_cursor
                    || oldest.is_some_and(|oldest| cursor < oldest.saturating_sub(1))
            }
        };
        let mut entries = Vec::new();
        if !snapshot_required {
            let start = cursor.unwrap_or(0).saturating_add(1);
            for entry in replay.range(start..)? {
                let (key, value) = entry?;
                entries.push((key.value(), value.value().to_vec()));
            }
        }
        Ok(ReplayPage {
            head_cursor,
            oldest_cursor: oldest,
            retained_entries,
            retained_bytes,
            snapshot_required,
            entries,
        })
    }

    /// Returns the durable head cursor without materializing replay entries.
    ///
    /// # Errors
    ///
    /// Returns an error when the metadata table cannot be read.
    pub fn replay_head(&self) -> Result<u64, StoreError> {
        let read = self.database.begin_read()?;
        let meta = read.open_table(META)?;
        Ok(meta.get("replay_head")?.map_or(0, |value| value.value()))
    }

    /// Inserts an idempotent `turn/start` command into the durable outbox.
    /// Reusing an id with the same payload returns the existing command;
    /// reusing it with a different payload is rejected.
    ///
    /// # Errors
    ///
    /// Returns an error for invalid commands, corruption, or a failed transaction.
    pub fn outbox_put_turn_start(
        &self,
        command_id: &str,
        remote_thread_id: &str,
        params: Value,
        created_at: Option<u64>,
    ) -> Result<OutboxCommand, StoreError> {
        self.outbox_put_turn_start_with_presentation(
            command_id,
            remote_thread_id,
            params,
            created_at,
            OutboxPresentation::Queue,
        )
    }

    /// Inserts a durable turn command while keeping transport delivery and an
    /// explicit user queue as separate UI presentations.
    ///
    /// # Errors
    ///
    /// Returns an error when identifiers or parameters are invalid, the
    /// command is too large, persistence fails, or an existing command does
    /// not match the requested operation.
    pub fn outbox_put_turn_start_with_presentation(
        &self,
        command_id: &str,
        remote_thread_id: &str,
        params: Value,
        created_at: Option<u64>,
        presentation: OutboxPresentation,
    ) -> Result<OutboxCommand, StoreError> {
        self.outbox_put_turn_start_inner(
            command_id,
            remote_thread_id,
            params,
            OutboxPutMetadata {
                created_at,
                presentation,
                workspace_request_id: None,
            },
        )
    }

    /// Inserts a durable turn command gated by an optional workspace operation.
    ///
    /// # Errors
    ///
    /// Returns an error under the same conditions as
    /// [`Self::outbox_put_turn_start_with_presentation`].
    pub fn outbox_put_turn_start_with_workspace(
        &self,
        command_id: &str,
        remote_thread_id: &str,
        params: Value,
        created_at: Option<u64>,
        presentation: OutboxPresentation,
        workspace_request_id: Option<&str>,
    ) -> Result<OutboxCommand, StoreError> {
        self.outbox_put_turn_start_inner(
            command_id,
            remote_thread_id,
            params,
            OutboxPutMetadata {
                created_at,
                presentation,
                workspace_request_id,
            },
        )
    }

    fn outbox_put_turn_start_inner(
        &self,
        command_id: &str,
        remote_thread_id: &str,
        params: Value,
        metadata: OutboxPutMetadata<'_>,
    ) -> Result<OutboxCommand, StoreError> {
        let OutboxPutMetadata {
            created_at,
            presentation,
            workspace_request_id,
        } = metadata;
        validate_outbox_id(command_id, "command id")?;
        validate_outbox_id(remote_thread_id, "remote thread id")?;
        if let Some(request_id) = workspace_request_id {
            validate_outbox_id(request_id, "workspace request id")?;
        }
        validate_turn_start_params(command_id, remote_thread_id, &params)?;
        let params_bytes = serde_json::to_vec(&params)?.len();
        if params_bytes > MAX_OUTBOX_COMMAND_BYTES {
            return Err(StoreError::CorruptedIndex(
                "outbox command exceeds 1 MiB".into(),
            ));
        }
        let write = self.database.begin_write()?;
        let command = {
            let mut table = write.open_table(OUTBOX)?;
            if let Some(encoded) = table.get(command_id)?.map(|value| value.value().to_vec()) {
                let existing: OutboxCommand = serde_json::from_slice(&encoded)?;
                if existing.remote_thread_id != remote_thread_id
                    || existing.method != "turn/start"
                    || existing.params != params
                    || existing.presentation != presentation
                    || existing.workspace_request_id.as_deref() != workspace_request_id
                    || existing.owner_context.is_some()
                    || existing.queue_input.is_some()
                {
                    return Err(StoreError::CorruptedIndex(
                        "outbox command id already has a different payload".into(),
                    ));
                }
                return Ok(existing);
            }
            let (_, max_order) = prune_delivered_outbox_receipts(&mut table)?;
            let now = unix_time_ms();
            let command = OutboxCommand {
                command_id: command_id.to_owned(),
                remote_thread_id: remote_thread_id.to_owned(),
                method: "turn/start".into(),
                params,
                state: OutboxState::Queued,
                presentation,
                workspace_request_id: workspace_request_id.map(str::to_owned),
                owner_context: None,
                queue_input: None,
                order: max_order.saturating_add(1),
                created_at: created_at.unwrap_or(now),
                updated_at: now,
                last_error: None,
                attempts: 0,
                next_attempt_at: 0,
                claim: None,
            };
            let encoded = serde_json::to_vec(&command)?;
            ensure_outbox_owner_quota(outbox_owner_bytes(&table, None)?, encoded.len())?;
            table.insert(command_id, encoded.as_slice())?;
            command
        };
        write.commit()?;
        Ok(command)
    }

    /// Removes old delivered receipts while preserving queued, uncertain, and
    /// failed commands. Returns the number of reclaimed rows.
    ///
    /// # Errors
    ///
    /// Returns an error if the outbox cannot be read or updated.
    pub fn outbox_prune_delivered_receipts(&self) -> Result<usize, StoreError> {
        let write = self.database.begin_write()?;
        let removed = {
            let mut table = write.open_table(OUTBOX)?;
            prune_delivered_outbox_receipts(&mut table)?.0
        };
        write.commit()?;
        Ok(removed)
    }

    /// Lists durable outbox commands in dispatch order.
    ///
    /// # Errors
    ///
    /// Returns an error if the table cannot be read or contains invalid JSON.
    pub fn outbox_list(
        &self,
        remote_thread_id: Option<&str>,
    ) -> Result<Vec<OutboxCommand>, StoreError> {
        let read = self.database.begin_read()?;
        let table = read.open_table(OUTBOX)?;
        let mut commands = Vec::new();
        for entry in table.iter()? {
            let (_key, value) = entry?;
            let command: OutboxCommand = serde_json::from_slice(value.value())?;
            if remote_thread_id.is_none_or(|thread_id| command.remote_thread_id == thread_id) {
                commands.push(command);
            }
        }
        commands.sort_by_key(|command| (command.order, command.created_at));
        Ok(commands)
    }

    /// Reads one durable outbox row by stable command identity.
    ///
    /// # Errors
    ///
    /// Returns an error if the durable outbox is unavailable or corrupt.
    pub fn outbox_get(&self, command_id: &str) -> Result<Option<OutboxCommand>, StoreError> {
        validate_outbox_id(command_id, "command id")?;
        let read = self.database.begin_read()?;
        let table = read.open_table(OUTBOX)?;
        table
            .get(command_id)?
            .map(|encoded| serde_json::from_slice(encoded.value()).map_err(StoreError::from))
            .transpose()
    }

    /// Returns the first dispatchable command for every thread.
    ///
    /// # Errors
    ///
    /// Returns an error if the outbox cannot be read.
    pub fn outbox_ready_heads(&self) -> Result<Vec<OutboxCommand>, StoreError> {
        let now = unix_time_ms();
        let mut heads = HashMap::<String, OutboxCommand>::new();
        for command in self.outbox_list(None)? {
            if matches!(command.state, OutboxState::Failed | OutboxState::Delivered) {
                continue;
            }
            heads
                .entry(command.remote_thread_id.clone())
                .or_insert(command);
        }
        Ok(heads
            .into_values()
            .filter(|command| {
                command.next_attempt_at <= now && !outbox_has_in_flight_claim(command)
            })
            .collect())
    }

    /// Atomically claims one queued command for ordinary `turn/start` delivery.
    /// Only the caller receiving [`OutboxClaimOutcome::Acquired`] may send it.
    ///
    /// # Errors
    ///
    /// Returns an error when the row is corrupt or persistence fails.
    pub fn outbox_claim_dispatch(
        &self,
        command_id: &str,
    ) -> Result<OutboxClaimOutcome, StoreError> {
        self.outbox_claim(command_id, OutboxClaimKind::Dispatch, None)
    }

    /// Atomically removes one queued command from dispatcher ownership and
    /// claims its input for one explicit steer operation.
    ///
    /// Repeating the same operation id returns `Duplicate` without granting a
    /// second send, including after restart or an explicit queue retry.
    ///
    /// # Errors
    ///
    /// Returns an error for an invalid operation id, corrupt row, or failed transaction.
    pub fn outbox_claim_steer(
        &self,
        command_id: &str,
        operation_id: &str,
    ) -> Result<OutboxClaimOutcome, StoreError> {
        validate_outbox_id(operation_id, "steer operation id")?;
        self.outbox_claim(command_id, OutboxClaimKind::Steer, Some(operation_id))
    }

    /// Resolves a previously acquired dispatch or steer claim.
    ///
    /// Definite acceptance becomes `Delivered`, definite rejection becomes
    /// `Failed`, and transport ambiguity remains `Uncertain`. A stale token or
    /// repeated resolution is a typed no-op.
    ///
    /// # Errors
    ///
    /// Returns an error when the row is corrupt or persistence fails.
    pub fn outbox_resolve_claim(
        &self,
        command_id: &str,
        token: u64,
        resolution: OutboxClaimResolution<'_>,
    ) -> Result<OutboxClaimResolutionOutcome, StoreError> {
        validate_outbox_id(command_id, "command id")?;
        let write = self.database.begin_write()?;
        let outcome = {
            let mut table = write.open_table(OUTBOX)?;
            let Some(encoded) = table.get(command_id)?.map(|value| value.value().to_vec()) else {
                return Ok(OutboxClaimResolutionOutcome::Stale(None));
            };
            let mut command: OutboxCommand = serde_json::from_slice(&encoded)?;
            let Some(claim) = command.claim.as_mut() else {
                return Ok(OutboxClaimResolutionOutcome::Stale(Some(command)));
            };
            if claim.token != token {
                return Ok(OutboxClaimResolutionOutcome::Stale(Some(command)));
            }
            if claim.resolved || command.state != OutboxState::Uncertain {
                return Ok(OutboxClaimResolutionOutcome::AlreadyResolved(command));
            }
            let now = unix_time_ms();
            match resolution {
                OutboxClaimResolution::Delivered => {
                    command.state = OutboxState::Delivered;
                    command.last_error = None;
                    command.next_attempt_at = 0;
                }
                OutboxClaimResolution::NotSent { retry_after_ms } => {
                    command.state = OutboxState::Queued;
                    command.last_error = None;
                    command.next_attempt_at = now.saturating_add(retry_after_ms);
                }
                OutboxClaimResolution::Busy => {
                    command.state = OutboxState::Queued;
                    command.presentation = OutboxPresentation::Queue;
                    command.last_error = None;
                    command.next_attempt_at = now;
                }
                OutboxClaimResolution::Rejected { error } => {
                    command.state = OutboxState::Failed;
                    command.last_error = Some(bounded_outbox_error(error));
                    command.next_attempt_at = 0;
                }
                OutboxClaimResolution::Indeterminate {
                    error,
                    retry_after_ms,
                } => {
                    command.attempts = command.attempts.saturating_add(1);
                    command.last_error = Some(bounded_outbox_error(error));
                    command.next_attempt_at = now.saturating_add(retry_after_ms);
                }
            }
            command.updated_at = now;
            if let Some(claim) = command.claim.as_mut() {
                claim.resolved = true;
            }
            let encoded = serde_json::to_vec(&command)?;
            table.insert(command_id, encoded.as_slice())?;
            OutboxClaimResolutionOutcome::Applied(command)
        };
        write.commit()?;
        Ok(outcome)
    }

    /// Marks a command failed only while it is still owned by the queue.
    /// A concurrent dispatcher or steer claim wins without being overwritten.
    ///
    /// # Errors
    ///
    /// Returns an error when the row is corrupt or persistence fails.
    pub fn outbox_fail_queued(
        &self,
        command_id: &str,
        error: &str,
    ) -> Result<Option<OutboxCommand>, StoreError> {
        validate_outbox_id(command_id, "command id")?;
        let write = self.database.begin_write()?;
        let failed = {
            let mut table = write.open_table(OUTBOX)?;
            let Some(encoded) = table.get(command_id)?.map(|value| value.value().to_vec()) else {
                return Ok(None);
            };
            let mut command: OutboxCommand = serde_json::from_slice(&encoded)?;
            if command.state != OutboxState::Queued {
                return Ok(None);
            }
            command.state = OutboxState::Failed;
            command.updated_at = unix_time_ms();
            command.last_error = Some(bounded_outbox_error(error));
            command.next_attempt_at = 0;
            let encoded = serde_json::to_vec(&command)?;
            table.insert(command_id, encoded.as_slice())?;
            Some(command)
        };
        write.commit()?;
        Ok(failed)
    }

    fn outbox_claim(
        &self,
        command_id: &str,
        kind: OutboxClaimKind,
        operation_id: Option<&str>,
    ) -> Result<OutboxClaimOutcome, StoreError> {
        validate_outbox_id(command_id, "command id")?;
        let write = self.database.begin_write()?;
        let outcome = {
            let mut table = write.open_table(OUTBOX)?;
            let Some(encoded) = table.get(command_id)?.map(|value| value.value().to_vec()) else {
                return Ok(OutboxClaimOutcome::Unavailable(None));
            };
            let mut command: OutboxCommand = serde_json::from_slice(&encoded)?;
            let repeated_steer = kind == OutboxClaimKind::Steer
                && command.claim.as_ref().is_some_and(|claim| {
                    claim.kind == OutboxClaimKind::Steer
                        && claim.operation_id.as_deref() == operation_id
                });
            if repeated_steer {
                OutboxClaimOutcome::Duplicate(command)
            } else if command.state != OutboxState::Queued {
                OutboxClaimOutcome::Unavailable(Some(command))
            } else {
                let token = command
                    .claim
                    .as_ref()
                    .map_or(Some(1), |claim| claim.token.checked_add(1))
                    .ok_or_else(|| {
                        StoreError::CorruptedIndex("outbox claim token exhausted".into())
                    })?;
                command.state = OutboxState::Uncertain;
                command.updated_at = unix_time_ms();
                command.next_attempt_at = 0;
                command.last_error = None;
                command.claim = Some(OutboxClaim {
                    token,
                    kind,
                    operation_id: operation_id.map(str::to_owned),
                    resolved: false,
                });
                let encoded = serde_json::to_vec(&command)?;
                table.insert(command_id, encoded.as_slice())?;
                OutboxClaimOutcome::Acquired { command, token }
            }
        };
        write.commit()?;
        Ok(outcome)
    }

    /// Changes a queue-owned command delivery state atomically. A terminal
    /// command or a command with an in-flight claim wins over a stale updater.
    ///
    /// # Errors
    ///
    /// Returns an error if the command is missing or persistence fails.
    pub fn outbox_set_state(
        &self,
        command_id: &str,
        state: OutboxState,
        last_error: Option<&str>,
    ) -> Result<OutboxCommand, StoreError> {
        let write = self.database.begin_write()?;
        let command = {
            let mut table = write.open_table(OUTBOX)?;
            let encoded = table
                .get(command_id)?
                .map(|value| value.value().to_vec())
                .ok_or_else(|| StoreError::CorruptedIndex("outbox command not found".into()))?;
            let mut command: OutboxCommand = serde_json::from_slice(&encoded)?;
            if outbox_rejects_stale_queue_update(&command) {
                return Ok(command);
            }
            command.state = state;
            command.updated_at = unix_time_ms();
            command.last_error = last_error.map(bounded_outbox_error);
            command.next_attempt_at = 0;
            if state != OutboxState::Uncertain
                && let Some(claim) = command.claim.as_mut()
            {
                claim.resolved = true;
            }
            let encoded = serde_json::to_vec(&command)?;
            table.insert(command_id, encoded.as_slice())?;
            command
        };
        write.commit()?;
        Ok(command)
    }

    /// Defers a transiently failed queue-owned command without releasing the
    /// per-thread FIFO head. A terminal command or a command with an in-flight
    /// claim wins over a stale updater. The attempt counter and deadline are
    /// durable across restarts.
    ///
    /// # Errors
    ///
    /// Returns an error if the command is missing or persistence fails.
    pub fn outbox_defer(
        &self,
        command_id: &str,
        state: OutboxState,
        last_error: &str,
        delay_ms: u64,
    ) -> Result<OutboxCommand, StoreError> {
        let write = self.database.begin_write()?;
        let command = {
            let mut table = write.open_table(OUTBOX)?;
            let encoded = table
                .get(command_id)?
                .map(|value| value.value().to_vec())
                .ok_or_else(|| StoreError::CorruptedIndex("outbox command not found".into()))?;
            let mut command: OutboxCommand = serde_json::from_slice(&encoded)?;
            if outbox_rejects_stale_queue_update(&command) {
                return Ok(command);
            }
            let now = unix_time_ms();
            command.state = state;
            command.attempts = command.attempts.saturating_add(1);
            command.updated_at = now;
            command.next_attempt_at = now.saturating_add(delay_ms);
            command.last_error = Some(bounded_outbox_error(last_error));
            if state != OutboxState::Uncertain
                && let Some(claim) = command.claim.as_mut()
            {
                claim.resolved = true;
            }
            let encoded = serde_json::to_vec(&command)?;
            table.insert(command_id, encoded.as_slice())?;
            command
        };
        write.commit()?;
        Ok(command)
    }

    /// Delays a queue-owned command for a known non-failure condition without
    /// consuming a retry attempt. A terminal command or a command with an
    /// in-flight claim wins over a stale updater. The returned flag reports a
    /// client-visible state change.
    ///
    /// # Errors
    ///
    /// Returns an error if the command is missing or persistence fails.
    pub fn outbox_wait(
        &self,
        command_id: &str,
        state: OutboxState,
        last_error: Option<&str>,
        delay_ms: u64,
    ) -> Result<(OutboxCommand, bool), StoreError> {
        let write = self.database.begin_write()?;
        let (command, changed) = {
            let mut table = write.open_table(OUTBOX)?;
            let encoded = table
                .get(command_id)?
                .map(|value| value.value().to_vec())
                .ok_or_else(|| StoreError::CorruptedIndex("outbox command not found".into()))?;
            let mut command: OutboxCommand = serde_json::from_slice(&encoded)?;
            if outbox_rejects_stale_queue_update(&command) {
                return Ok((command, false));
            }
            let changed = command.state != state || command.last_error.as_deref() != last_error;
            let now = unix_time_ms();
            command.state = state;
            command.updated_at = now;
            command.next_attempt_at = now.saturating_add(delay_ms);
            command.last_error = last_error.map(bounded_outbox_error);
            if state != OutboxState::Uncertain
                && let Some(claim) = command.claim.as_mut()
            {
                claim.resolved = true;
            }
            let encoded = serde_json::to_vec(&command)?;
            table.insert(command_id, encoded.as_slice())?;
            (command, changed)
        };
        write.commit()?;
        Ok((command, changed))
    }

    /// Reopens commands terminally failed by legacy account-switch handling.
    /// Returns affected thread ids so connected clients can be refreshed.
    ///
    /// # Errors
    ///
    /// Returns an error if the outbox cannot be read or updated.
    pub fn outbox_recover_legacy_account_pool_failures(&self) -> Result<Vec<String>, StoreError> {
        let write = self.database.begin_write()?;
        let threads = {
            let mut table = write.open_table(OUTBOX)?;
            let mut recovered = HashSet::new();
            let mut updates = Vec::new();
            for entry in table.iter()? {
                let (key, value) = entry?;
                let mut command: OutboxCommand = serde_json::from_slice(value.value())?;
                let recoverable = command.last_error.as_deref().is_some_and(|error| {
                    error.contains("account switch deferred while another turn is active")
                        || error.contains("Codex App Server restart failed")
                });
                if command.state != OutboxState::Failed || !recoverable {
                    continue;
                }
                command.state = OutboxState::Queued;
                command.attempts = 0;
                command.updated_at = unix_time_ms();
                command.next_attempt_at = 0;
                command.last_error = None;
                recovered.insert(command.remote_thread_id.clone());
                updates.push((key.value().to_owned(), serde_json::to_vec(&command)?));
            }
            for (command_id, encoded) in updates {
                table.insert(command_id.as_str(), encoded.as_slice())?;
            }
            recovered.into_iter().collect::<Vec<_>>()
        };
        write.commit()?;
        Ok(threads)
    }

    /// Reopens a terminally failed command with the same stable identity.
    /// Delivered receipts remain terminal and cannot be replayed.
    ///
    /// # Errors
    ///
    /// Returns an error if the command is missing, is not failed, or persistence fails.
    pub fn outbox_retry_failed(&self, command_id: &str) -> Result<OutboxCommand, StoreError> {
        self.outbox_retry_failed_inner(command_id)
    }

    fn outbox_retry_failed_inner(&self, command_id: &str) -> Result<OutboxCommand, StoreError> {
        let write = self.database.begin_write()?;
        let command = {
            let mut table = write.open_table(OUTBOX)?;
            let encoded = table
                .get(command_id)?
                .map(|value| value.value().to_vec())
                .ok_or_else(|| StoreError::CorruptedIndex("outbox command not found".into()))?;
            let mut command: OutboxCommand = serde_json::from_slice(&encoded)?;
            if command.state != OutboxState::Failed {
                return Err(StoreError::CorruptedIndex(
                    "only a failed outbox command can be retried".into(),
                ));
            }
            let now = unix_time_ms();
            command.state = OutboxState::Queued;
            command.attempts = 0;
            command.updated_at = now;
            command.next_attempt_at = 0;
            command.last_error = None;
            let encoded = serde_json::to_vec(&command)?;
            table.insert(command_id, encoded.as_slice())?;
            command
        };
        write.commit()?;
        Ok(command)
    }

    /// Replaces the editable text and remote-file inputs of a command that has
    /// not started dispatching yet. Non-editable inputs such as skills remain
    /// attached to the queued turn.
    ///
    /// # Errors
    ///
    /// Returns an error if the command is not queued, the replacement input is
    /// invalid, or the edited payload exceeds the durable queue limits.
    pub fn outbox_edit_prompt(
        &self,
        command_id: &str,
        replacement_input: &Value,
    ) -> Result<OutboxCommand, StoreError> {
        self.outbox_edit_prompt_inner(command_id, replacement_input)
    }

    fn outbox_edit_prompt_inner(
        &self,
        command_id: &str,
        replacement_input: &Value,
    ) -> Result<OutboxCommand, StoreError> {
        let replacement = replacement_input
            .as_array()
            .ok_or_else(|| StoreError::CorruptedIndex("queued input must be an array".into()))?;
        let text_count = replacement
            .iter()
            .filter(|item| item.get("type").and_then(Value::as_str) == Some("text"))
            .count();
        let valid_parts = replacement.iter().all(|item| {
            matches!(
                item.get("type").and_then(Value::as_str),
                Some("text" | "remoteFile")
            )
        });
        let text_valid = replacement.iter().all(|item| {
            item.get("type").and_then(Value::as_str) != Some("text")
                || item
                    .get("text")
                    .and_then(Value::as_str)
                    .is_some_and(|text| text.chars().count() <= 1_000_000)
        });
        if replacement.is_empty() || text_count > 1 || !valid_parts || !text_valid {
            return Err(StoreError::CorruptedIndex(
                "queued input must contain editable text or remote files".into(),
            ));
        }
        let write = self.database.begin_write()?;
        let command = {
            let mut table = write.open_table(OUTBOX)?;
            let current_encoded = table
                .get(command_id)?
                .map(|value| value.value().to_vec())
                .ok_or_else(|| StoreError::CorruptedIndex("outbox command not found".into()))?;
            let current_encoded_len = current_encoded.len();
            let mut command: OutboxCommand = serde_json::from_slice(&current_encoded)?;
            ensure_outbox_editable(&command)?;
            let input = command
                .params
                .get_mut("input")
                .and_then(Value::as_array_mut)
                .ok_or_else(|| StoreError::CorruptedIndex("queued command has no input".into()))?;
            let preserved = input
                .iter()
                .filter(|item| {
                    !matches!(
                        item.get("type").and_then(Value::as_str),
                        Some("text" | "remoteFile")
                    )
                })
                .cloned()
                .collect::<Vec<_>>();
            input.clone_from(replacement);
            input.extend(preserved);
            validate_turn_start_params(
                &command.command_id,
                &command.remote_thread_id,
                &command.params,
            )?;
            if serde_json::to_vec(&command.params)?.len() > MAX_OUTBOX_COMMAND_BYTES {
                return Err(StoreError::CorruptedIndex(
                    "outbox command exceeds 1 MiB".into(),
                ));
            }
            command.updated_at = unix_time_ms();

            let encoded = serde_json::to_vec(&command)?;
            let owner_bytes = outbox_owner_bytes(&table, command.owner_context.as_deref())?;
            ensure_outbox_owner_replacement_quota(owner_bytes, current_encoded_len, encoded.len())?;
            table.insert(command_id, encoded.as_slice())?;
            command
        };
        write.commit()?;
        Ok(command)
    }

    /// Reorders one queued command relative to another command owned by the
    /// same principal in the same thread. A `None` target places it last.
    ///
    /// # Errors
    ///
    /// Returns an error when either command is missing, not queued, or belongs
    /// to another thread.
    pub fn outbox_place(
        &self,
        command_id: &str,
        before_command_id: Option<&str>,
    ) -> Result<bool, StoreError> {
        self.outbox_place_inner(command_id, before_command_id)
            .map(|(changed, _command)| changed)
    }

    fn outbox_place_inner(
        &self,
        command_id: &str,
        before_command_id: Option<&str>,
    ) -> Result<(bool, OutboxCommand), StoreError> {
        let write = self.database.begin_write()?;
        let (changed_commands, selected) = {
            let mut table = write.open_table(OUTBOX)?;
            let mut same_thread = Vec::new();
            let mut selected = None;
            for entry in table.iter()? {
                let (_key, value) = entry?;
                let command: OutboxCommand = serde_json::from_slice(value.value())?;
                if command.command_id == command_id {
                    ensure_outbox_editable(&command)?;
                    selected = Some(command.clone());
                }
                if command.state == OutboxState::Queued {
                    same_thread.push(command);
                }
            }
            let selected = selected
                .ok_or_else(|| StoreError::CorruptedIndex("outbox command not found".into()))?;
            same_thread.retain(|candidate| {
                candidate.remote_thread_id == selected.remote_thread_id
                    && candidate.owner_context == selected.owner_context
            });
            same_thread.sort_by_key(|candidate| (candidate.order, candidate.created_at));
            let order_slots = same_thread
                .iter()
                .map(|candidate| candidate.order)
                .collect::<Vec<_>>();
            same_thread.retain(|candidate| candidate.command_id != command_id);
            let insert_at = match before_command_id {
                None => same_thread.len(),
                Some(target) => same_thread
                    .iter()
                    .position(|candidate| candidate.command_id == target)
                    .ok_or_else(|| {
                        StoreError::CorruptedIndex("queued placement target does not exist".into())
                    })?,
            };
            same_thread.insert(insert_at, selected);
            let now = unix_time_ms();
            let mut changed_commands = Vec::new();
            let mut selected = None;
            for (mut command, order) in same_thread.into_iter().zip(order_slots) {
                if command.order != order {
                    command.order = order;
                    command.updated_at = now;
                    let encoded = serde_json::to_vec(&command)?;
                    table.insert(command.command_id.as_str(), encoded.as_slice())?;
                    changed_commands.push(command.clone());
                }
                if command.command_id == command_id {
                    selected = Some(command);
                }
            }
            let selected = selected.ok_or_else(|| {
                StoreError::CorruptedIndex("outbox command disappeared during placement".into())
            })?;
            (changed_commands, selected)
        };
        write.commit()?;
        Ok((!changed_commands.is_empty(), selected))
    }

    /// Removes a queued or failed command. Commands being reconciled or
    /// already delivered remain as idempotency receipts.
    ///
    /// # Errors
    ///
    /// Returns an error if persistence fails or the row is corrupt.
    pub fn outbox_cancel(&self, command_id: &str) -> Result<bool, StoreError> {
        self.outbox_cancel_inner(command_id)
    }

    fn outbox_cancel_inner(&self, command_id: &str) -> Result<bool, StoreError> {
        let write = self.database.begin_write()?;
        let cancelled = {
            let mut table = write.open_table(OUTBOX)?;
            let Some(encoded) = table.get(command_id)?.map(|value| value.value().to_vec()) else {
                return Ok(false);
            };
            let command: OutboxCommand = serde_json::from_slice(&encoded)?;
            if !matches!(command.state, OutboxState::Queued | OutboxState::Failed) {
                return Ok(false);
            }
            table.remove(command_id)?;
            Some(command)
        };
        write.commit()?;
        Ok(cancelled.is_some())
    }
}

impl HostThreadIndex for IndexStore {
    fn put_thread_metadata(&self, metadata: &IndexedThreadMetadata) -> Result<(), StoreError> {
        Self::put_thread_metadata(self, metadata)
    }

    fn put_thread_metadata_batch(
        &self,
        metadata: &[IndexedThreadMetadata],
    ) -> Result<(), StoreError> {
        Self::put_thread_metadata_batch(self, metadata)
    }

    fn thread_descendants(
        &self,
        root_thread_id: &str,
    ) -> Result<Vec<IndexedThreadMetadata>, StoreError> {
        Self::thread_descendants(self, root_thread_id)
    }

    fn thread_pin_snapshot(&self) -> Result<ThreadPinSnapshot, StoreError> {
        Self::thread_pin_snapshot(self)
    }
}

fn validate_outbox_id(value: &str, label: &str) -> Result<(), StoreError> {
    if value.is_empty()
        || value.len() > 512
        || value
            .bytes()
            .any(|byte| byte.is_ascii_control() || byte == 0x7f)
    {
        return Err(StoreError::CorruptedIndex(format!("invalid {label}")));
    }
    Ok(())
}

fn bounded_outbox_error(error: &str) -> String {
    error.chars().take(500).collect()
}

fn outbox_has_in_flight_claim(command: &OutboxCommand) -> bool {
    command.claim.as_ref().is_some_and(|claim| !claim.resolved)
}

fn outbox_rejects_stale_queue_update(command: &OutboxCommand) -> bool {
    matches!(command.state, OutboxState::Failed | OutboxState::Delivered)
        || outbox_has_in_flight_claim(command)
}

fn outbox_owner_bytes(
    table: &Table<'_, &str, &[u8]>,
    owner_context: Option<&str>,
) -> Result<usize, StoreError> {
    let mut total = 0_usize;
    for entry in table.iter()? {
        let (_key, value) = entry?;
        let command: OutboxCommand = serde_json::from_slice(value.value())?;
        if command.owner_context.as_deref() == owner_context {
            total = total.saturating_add(value.value().len());
        }
    }
    Ok(total)
}

fn ensure_outbox_owner_quota(
    current_bytes: usize,
    incoming_bytes: usize,
) -> Result<(), StoreError> {
    if current_bytes.saturating_add(incoming_bytes) > MAX_OUTBOX_OWNER_BYTES {
        return Err(StoreError::OutboxOwnerQuotaExceeded {
            limit_bytes: MAX_OUTBOX_OWNER_BYTES,
        });
    }
    Ok(())
}

fn ensure_outbox_owner_replacement_quota(
    current_bytes: usize,
    replaced_bytes: usize,
    replacement_bytes: usize,
) -> Result<(), StoreError> {
    ensure_outbox_owner_quota(
        current_bytes.saturating_sub(replaced_bytes),
        replacement_bytes,
    )
}

fn prune_delivered_outbox_receipts(
    table: &mut Table<'_, &str, &[u8]>,
) -> Result<(usize, u64), StoreError> {
    let mut max_order = 0_u64;
    let mut delivered = Vec::new();
    for entry in table.iter()? {
        let (key, value) = entry?;
        let command: OutboxCommand = serde_json::from_slice(value.value())?;
        max_order = max_order.max(command.order);
        if command.state == OutboxState::Delivered {
            delivered.push((
                key.value().to_owned(),
                command.updated_at,
                command.order,
                command.owner_context.clone(),
            ));
        }
    }
    // Delivered rows are short-lived receipts for reconnecting clients, not
    // permanent queue history. Keep a bounded recent window per owner without
    // ever rejecting active or failed durable work because another owner filled
    // a process-global quota.
    delivered.sort_by_key(|(_, updated_at, order, _)| (*updated_at, *order));
    let mut delivered_counts = HashMap::<Option<String>, usize>::new();
    for (_, _, _, owner_context) in &delivered {
        *delivered_counts.entry(owner_context.clone()).or_default() += 1;
    }
    let mut removed = 0;
    for (command_id, _, _, owner_context) in delivered {
        let Some(delivered_count) = delivered_counts.get_mut(&owner_context) else {
            continue;
        };
        if *delivered_count <= MAX_RETAINED_DELIVERED_COMMANDS {
            continue;
        }
        if table.remove(command_id.as_str())?.is_some() {
            *delivered_count -= 1;
            removed += 1;
        }
    }
    Ok((removed, max_order))
}

fn ensure_outbox_editable(command: &OutboxCommand) -> Result<(), StoreError> {
    if command.state != OutboxState::Queued {
        return Err(StoreError::CorruptedIndex(
            "queued command is already dispatching or no longer exists".into(),
        ));
    }
    Ok(())
}

fn validate_turn_start_params(
    command_id: &str,
    remote_thread_id: &str,
    params: &Value,
) -> Result<(), StoreError> {
    let object = params
        .as_object()
        .ok_or_else(|| StoreError::CorruptedIndex("outbox params must be an object".into()))?;
    if object.get("threadId").and_then(Value::as_str) != Some(remote_thread_id)
        || object.get("clientUserMessageId").and_then(Value::as_str) != Some(command_id)
        || object
            .get("input")
            .and_then(Value::as_array)
            .is_none_or(Vec::is_empty)
    {
        return Err(StoreError::CorruptedIndex(
            "outbox turn/start id or input is invalid".into(),
        ));
    }
    Ok(())
}

fn unix_time_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |duration| {
            u64::try_from(duration.as_millis()).unwrap_or(u64::MAX)
        })
}

fn parent_thread_prefix(parent_thread_id: &str) -> Vec<u8> {
    let mut key = Vec::with_capacity(parent_thread_id.len() + 1);
    key.extend_from_slice(parent_thread_id.as_bytes());
    key.push(0);
    key
}

fn parent_thread_key(parent_thread_id: &str, child_thread_id: &str) -> Vec<u8> {
    let mut key = parent_thread_prefix(parent_thread_id);
    key.extend_from_slice(child_thread_id.as_bytes());
    key
}

fn append_replay_transaction(
    write: &redb::WriteTransaction,
    payloads: &[Vec<u8>],
    max_entries: usize,
    max_bytes: u64,
) -> Result<Vec<u64>, StoreError> {
    let mut cursors = Vec::with_capacity(payloads.len());
    {
        let mut meta = write.open_table(META)?;
        let mut replay = write.open_table(REPLAY)?;
        let mut head = meta.get("replay_head")?.map_or(0, |value| value.value());
        let mut bytes = meta.get("replay_bytes")?.map_or(0, |value| value.value());
        for payload in payloads {
            head = head.saturating_add(1);
            replay.insert(head, payload.as_slice())?;
            bytes = bytes.saturating_add(payload.len() as u64);
            cursors.push(head);
        }
        let max_entries = u64::try_from(max_entries).unwrap_or(u64::MAX);
        while replay.len()? > max_entries || bytes > max_bytes {
            let oldest = {
                let mut entries = replay.iter()?;
                entries
                    .next()
                    .transpose()?
                    .map(|(key, value)| (key.value(), value.value().len() as u64))
            };
            let Some((cursor, entry_bytes)) = oldest else {
                break;
            };
            replay.remove(cursor)?;
            bytes = bytes.saturating_sub(entry_bytes);
        }
        meta.insert("replay_head", head)?;
        meta.insert("replay_bytes", bytes)?;
    }
    Ok(cursors)
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Barrier};

    use serde_json::{Value, json};

    use super::{
        DerivedIndexSchema, IndexStore, MAX_OUTBOX_OWNER_BYTES, OutboxClaimOutcome,
        OutboxClaimResolution, OutboxClaimResolutionOutcome, OutboxPresentation, OutboxState,
        StoreError, ensure_outbox_owner_quota, ensure_outbox_owner_replacement_quota,
    };

    /// A derived schema that rebuilds its table on every open.
    struct DisposableSchema;

    impl DerivedIndexSchema for DisposableSchema {
        fn migrate(
            &self,
            write: &redb::WriteTransaction,
            _rebuild: bool,
        ) -> Result<(), StoreError> {
            const DERIVED: redb::TableDefinition<&str, u64> =
                redb::TableDefinition::new("derived_test");
            write.delete_table(DERIVED)?;
            write.open_table(DERIVED)?;
            Ok(())
        }

        fn is_current(&self, _read: &redb::ReadTransaction) -> Result<bool, StoreError> {
            Ok(false)
        }
    }

    #[test]
    fn pins_survive_replay_pruning_restart_and_derived_index_rebuild()
    -> Result<(), Box<dyn std::error::Error>> {
        let directory = tempfile::tempdir()?;
        let path = directory.path().join("state.redb");
        {
            let store = IndexStore::open(&path)?;
            let request = crate::thread_pins::ThreadPinRequest {
                thread_id: "old-chat".into(),
                pinned: true,
            };
            let cursor = store.commit_thread_pin(&request, 10, 4096)?;
            assert!(store.thread_pin("old-chat")?.pinned);
            let replay = store.replay_after(Some(0))?;
            let event: Value = serde_json::from_slice(&replay.entries[0].1)?;
            assert_eq!(event["params"]["pinCursor"], cursor);
            assert_eq!(
                event["codewideThreadPatch"]["operation"]["kind"],
                "threadPinned"
            );
            store.append_replay_batch(&[b"next".to_vec(), b"latest".to_vec()], 1, 4096)?;
            assert!(store.replay_after(Some(0))?.snapshot_required);
            assert_eq!(
                store.replay_after(Some(store.replay_head()? - 1))?.entries[0].1,
                b"latest"
            );
        }
        let store = IndexStore::open_with(&path, &[&DisposableSchema])?;
        assert_eq!(store.thread_pin_snapshot()?.thread_ids, ["old-chat"]);
        let other = IndexStore::open(directory.path().join("other.redb"))?;
        assert!(!other.thread_pin("old-chat")?.pinned);
        let cursor = store.commit_thread_pin(
            &crate::thread_pins::ThreadPinRequest {
                thread_id: "old-chat".into(),
                pinned: false,
            },
            10,
            4096,
        )?;
        assert!(store.thread_pin_snapshot()?.thread_ids.is_empty());
        assert_eq!(store.thread_pin("old-chat")?.cursor, cursor);
        Ok(())
    }

    #[test]
    fn deletion_retires_server_pin_atomically_with_replay() -> Result<(), Box<dyn std::error::Error>>
    {
        let directory = tempfile::tempdir()?;
        let store = IndexStore::open(directory.path().join("state.redb"))?;
        store.commit_thread_pin(
            &crate::thread_pins::ThreadPinRequest {
                thread_id: "chat".into(),
                pinned: true,
            },
            10,
            4096,
        )?;
        store.append_replay_batch(
            &[serde_json::to_vec(
                &serde_json::json!({"method":"thread/deleted","params":{"threadId":"chat"}}),
            )?],
            10,
            4096,
        )?;
        assert!(store.thread_pin_snapshot()?.thread_ids.is_empty());
        assert_eq!(store.replay_after(Some(0))?.entries.len(), 2);
        Ok(())
    }

    #[test]
    fn legacy_import_is_retry_safe_and_preserves_server_decisions()
    -> Result<(), Box<dyn std::error::Error>> {
        let directory = tempfile::tempdir()?;
        let path = directory.path().join("state.redb");
        let request = crate::thread_pins::ThreadPinImportRequest {
            thread_ids: vec![
                "legacy".into(),
                "unpin".into(),
                "deleted".into(),
                "legacy".into(),
            ],
        };
        let imported_cursor;
        {
            let store = IndexStore::open(&path)?;
            store.commit_thread_pin(
                &crate::thread_pins::ThreadPinRequest {
                    thread_id: "unpin".into(),
                    pinned: false,
                },
                10,
                4096,
            )?;
            store.append_replay_batch(
                &[serde_json::to_vec(&json!({
                    "method":"thread/deleted", "params":{"threadId":"deleted"}
                }))?],
                10,
                4096,
            )?;
            let before = store.replay_head()?;
            imported_cursor = store.import_thread_pins(&request, 10, 4096)?;
            assert_eq!(store.thread_pin_snapshot()?.thread_ids, ["legacy"]);
            let replay = store.replay_after(Some(before))?;
            assert_eq!(replay.entries.len(), 1);
            let event: Value = serde_json::from_slice(&replay.entries[0].1)?;
            assert_eq!(event["params"]["threadId"], "legacy");
            assert_eq!(event["params"]["pinCursor"], imported_cursor);
            assert_eq!(
                store.import_thread_pins(&request, 10, 4096)?,
                imported_cursor
            );
            assert!(
                store
                    .replay_after(Some(imported_cursor))?
                    .entries
                    .is_empty()
            );
        }
        let store = IndexStore::open(&path)?;
        assert_eq!(
            store.import_thread_pins(&request, 10, 4096)?,
            imported_cursor
        );
        store.commit_thread_pin(
            &crate::thread_pins::ThreadPinRequest {
                thread_id: "legacy".into(),
                pinned: false,
            },
            1,
            4096,
        )?;
        store.import_thread_pins(&request, 1, 4096)?;
        assert!(store.thread_pin_snapshot()?.thread_ids.is_empty());
        let other = IndexStore::open(directory.path().join("other.redb"))?;
        assert!(other.thread_pin_snapshot()?.thread_ids.is_empty());
        Ok(())
    }

    fn put_queued(store: &IndexStore, command_id: &str) -> Result<(), super::StoreError> {
        store.outbox_put_turn_start_with_presentation(
            command_id,
            "thread-a",
            json!({
                "threadId": "thread-a",
                "clientUserMessageId": command_id,
                "input": [{"type": "text", "text": command_id}],
            }),
            Some(1),
            OutboxPresentation::Queue,
        )?;
        Ok(())
    }

    #[test]
    fn owner_queue_byte_quota_has_an_explicit_non_destructive_boundary() {
        assert!(ensure_outbox_owner_quota(MAX_OUTBOX_OWNER_BYTES - 1, 1).is_ok());
        assert!(matches!(
            ensure_outbox_owner_quota(MAX_OUTBOX_OWNER_BYTES, 1),
            Err(StoreError::OutboxOwnerQuotaExceeded { limit_bytes })
                if limit_bytes == MAX_OUTBOX_OWNER_BYTES
        ));
        assert!(ensure_outbox_owner_replacement_quota(MAX_OUTBOX_OWNER_BYTES, 1, 1).is_ok());
        assert!(matches!(
            ensure_outbox_owner_replacement_quota(MAX_OUTBOX_OWNER_BYTES, 1, 2),
            Err(StoreError::OutboxOwnerQuotaExceeded { limit_bytes })
                if limit_bytes == MAX_OUTBOX_OWNER_BYTES
        ));
    }

    #[test]
    fn dispatch_and_steer_claims_have_exactly_one_winner() -> Result<(), Box<dyn std::error::Error>>
    {
        let directory = tempfile::tempdir()?;
        let store = Arc::new(IndexStore::open(directory.path().join("index.redb"))?);
        put_queued(&store, "command-a")?;
        let barrier = Arc::new(Barrier::new(3));
        let (dispatch, steer) = std::thread::scope(|scope| {
            let dispatch_store = Arc::clone(&store);
            let dispatch_barrier = Arc::clone(&barrier);
            let dispatch = scope.spawn(move || {
                dispatch_barrier.wait();
                dispatch_store.outbox_claim_dispatch("command-a")
            });
            let steer_store = Arc::clone(&store);
            let steer_barrier = Arc::clone(&barrier);
            let steer = scope.spawn(move || {
                steer_barrier.wait();
                steer_store.outbox_claim_steer("command-a", "steer-a")
            });
            barrier.wait();
            let dispatch = dispatch
                .join()
                .map_err(|_| std::io::Error::other("dispatch claim panicked"))?;
            let steer = steer
                .join()
                .map_err(|_| std::io::Error::other("steer claim panicked"))?;
            Ok::<_, Box<dyn std::error::Error>>((dispatch?, steer?))
        })?;

        let acquired = usize::from(matches!(dispatch, OutboxClaimOutcome::Acquired { .. }))
            + usize::from(matches!(steer, OutboxClaimOutcome::Acquired { .. }));
        assert_eq!(acquired, 1);
        assert_eq!(store.outbox_list(None)?[0].state, OutboxState::Uncertain);
        assert!(!store.outbox_cancel("command-a")?);
        assert!(
            store
                .outbox_fail_queued("command-a", "stale failure")?
                .is_none()
        );
        assert!(
            store
                .outbox_edit_prompt(
                    "command-a",
                    &json!([{"type": "text", "text": "replacement"}]),
                )
                .is_err()
        );
        assert!(store.outbox_place("command-a", None).is_err());
        Ok(())
    }

    #[test]
    fn terminal_steer_resolution_is_idempotent_and_stale_safe()
    -> Result<(), Box<dyn std::error::Error>> {
        let directory = tempfile::tempdir()?;
        let store = IndexStore::open(directory.path().join("index.redb"))?;
        put_queued(&store, "command-a")?;
        let OutboxClaimOutcome::Acquired { token, .. } =
            store.outbox_claim_steer("command-a", "steer-a")?
        else {
            return Err("steer claim was not acquired".into());
        };

        assert!(matches!(
            store.outbox_resolve_claim(
                "command-a",
                token,
                OutboxClaimResolution::Rejected { error: "rejected" },
            )?,
            OutboxClaimResolutionOutcome::Applied(_)
        ));
        assert!(matches!(
            store.outbox_resolve_claim("command-a", token, OutboxClaimResolution::Delivered,)?,
            OutboxClaimResolutionOutcome::AlreadyResolved(_)
        ));
        store.outbox_retry_failed("command-a")?;
        assert!(matches!(
            store.outbox_claim_steer("command-a", "steer-a")?,
            OutboxClaimOutcome::Duplicate(_)
        ));
        let OutboxClaimOutcome::Acquired {
            token: retry_token, ..
        } = store.outbox_claim_steer("command-a", "steer-b")?
        else {
            return Err("new steer operation was not acquired".into());
        };
        assert!(retry_token > token);
        assert!(matches!(
            store.outbox_resolve_claim("command-a", token, OutboxClaimResolution::Delivered,)?,
            OutboxClaimResolutionOutcome::Stale(_)
        ));
        assert!(matches!(
            store.outbox_resolve_claim(
                "command-a",
                retry_token,
                OutboxClaimResolution::Delivered,
            )?,
            OutboxClaimResolutionOutcome::Applied(_)
        ));
        assert_eq!(store.outbox_list(None)?[0].state, OutboxState::Delivered);

        put_queued(&store, "command-b")?;
        let OutboxClaimOutcome::Acquired {
            token: dispatch_token,
            ..
        } = store.outbox_claim_dispatch("command-b")?
        else {
            return Err("dispatch claim was not acquired".into());
        };
        store.outbox_resolve_claim(
            "command-b",
            dispatch_token,
            OutboxClaimResolution::NotSent { retry_after_ms: 0 },
        )?;
        let OutboxClaimOutcome::Acquired {
            token: next_dispatch_token,
            ..
        } = store.outbox_claim_dispatch("command-b")?
        else {
            return Err("not-sent dispatch was not reacquired".into());
        };
        assert!(next_dispatch_token > dispatch_token);
        Ok(())
    }

    #[test]
    fn indeterminate_steer_claim_survives_restart_without_reacquisition()
    -> Result<(), Box<dyn std::error::Error>> {
        let directory = tempfile::tempdir()?;
        let path = directory.path().join("index.redb");
        {
            let store = IndexStore::open(&path)?;
            put_queued(&store, "command-a")?;
            let OutboxClaimOutcome::Acquired { token, .. } =
                store.outbox_claim_steer("command-a", "steer-a")?
            else {
                return Err("steer claim was not acquired".into());
            };
            store.outbox_resolve_claim(
                "command-a",
                token,
                OutboxClaimResolution::Indeterminate {
                    error: "connection lost",
                    retry_after_ms: 500,
                },
            )?;
        }

        let reopened = IndexStore::open(&path)?;
        assert!(matches!(
            reopened.outbox_claim_steer("command-a", "steer-a")?,
            OutboxClaimOutcome::Duplicate(_)
        ));
        assert!(matches!(
            reopened.outbox_claim_dispatch("command-a")?,
            OutboxClaimOutcome::Unavailable(Some(_))
        ));
        assert_eq!(reopened.outbox_list(None)?[0].state, OutboxState::Uncertain);
        Ok(())
    }
}
