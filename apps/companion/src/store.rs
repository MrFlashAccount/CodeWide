use std::{
    collections::{HashMap, HashSet},
    path::Path,
    time::{SystemTime, UNIX_EPOCH},
};

use redb::{Database, ReadableDatabase, ReadableTable, ReadableTableMetadata, TableDefinition};
use serde::{Deserialize, Serialize};
use serde_json::Value;

const META: TableDefinition<&str, u64> = TableDefinition::new("meta");
const FILES: TableDefinition<&[u8], &[u8]> = TableDefinition::new("rollout_files");
const RECORDS: TableDefinition<&[u8], &[u8]> = TableDefinition::new("rollout_records");
const TURNS: TableDefinition<&[u8], &[u8]> = TableDefinition::new("rollout_turns");
const TURNS_BY_ID: TableDefinition<&[u8], u64> = TableDefinition::new("rollout_turns_by_id");
const REPLAY: TableDefinition<u64, &[u8]> = TableDefinition::new("sync_replay");
const OUTBOX: TableDefinition<&str, &[u8]> = TableDefinition::new("command_outbox");
const THREAD_USAGE: TableDefinition<&str, &[u8]> = TableDefinition::new("thread_usage");
const SCHEMA_VERSION: u32 = 4;
const FILE_STATE_VERSION: u8 = 1;
const FILE_STATE_BYTES: usize = 65;
const MAX_OUTBOX_COMMANDS: u64 = 1_000;
const MAX_OUTBOX_COMMAND_BYTES: usize = 1024 * 1024;
const MAX_OUTBOX_BYTES: usize = 48 * 1024 * 1024;

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
    pub order: u64,
    pub created_at: u64,
    pub updated_at: u64,
    pub last_error: Option<String>,
    #[serde(default)]
    pub attempts: u32,
    #[serde(default)]
    pub next_attempt_at: u64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TurnRef {
    pub id: String,
    pub start_offset: u64,
    pub end_offset: u64,
    pub completed: bool,
}

impl TurnRef {
    fn encode(&self) -> Result<Vec<u8>, StoreError> {
        let id_bytes = self.id.as_bytes();
        let id_length = u16::try_from(id_bytes.len())
            .map_err(|_| StoreError::CorruptedIndex("turn id is too long".into()))?;
        let mut encoded = Vec::with_capacity(20 + id_bytes.len());
        encoded.push(1);
        encoded.extend_from_slice(&self.start_offset.to_be_bytes());
        encoded.extend_from_slice(&self.end_offset.to_be_bytes());
        encoded.push(u8::from(self.completed));
        encoded.extend_from_slice(&id_length.to_be_bytes());
        encoded.extend_from_slice(id_bytes);
        Ok(encoded)
    }

    fn decode(encoded: &[u8]) -> Result<Self, StoreError> {
        if encoded.len() < 20 || encoded[0] != 1 {
            return Err(StoreError::CorruptedIndex("invalid rollout turn".into()));
        }
        let id_length = usize::from(read_u16(&encoded[18..20])?);
        if encoded.len() != 20 + id_length {
            return Err(StoreError::CorruptedIndex(
                "invalid rollout turn id length".into(),
            ));
        }
        let id = std::str::from_utf8(&encoded[20..])
            .map_err(|_| StoreError::CorruptedIndex("turn id is not UTF-8".into()))?
            .to_owned();
        Ok(Self {
            id,
            start_offset: read_u64(&encoded[1..9])?,
            end_offset: read_u64(&encoded[9..17])?,
            completed: encoded[17] != 0,
        })
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct FileState {
    pub device: u64,
    pub inode: u64,
    pub indexed_bytes: u64,
    pub records: u64,
    pub tail_hash: [u8; 32],
}

impl FileState {
    #[must_use]
    pub const fn empty(device: u64, inode: u64) -> Self {
        Self {
            device,
            inode,
            indexed_bytes: 0,
            records: 0,
            tail_hash: [0; 32],
        }
    }

    fn encode(self) -> [u8; FILE_STATE_BYTES] {
        let mut encoded = [0_u8; FILE_STATE_BYTES];
        encoded[0] = FILE_STATE_VERSION;
        encoded[1..9].copy_from_slice(&self.device.to_be_bytes());
        encoded[9..17].copy_from_slice(&self.inode.to_be_bytes());
        encoded[17..25].copy_from_slice(&self.indexed_bytes.to_be_bytes());
        encoded[25..33].copy_from_slice(&self.records.to_be_bytes());
        encoded[33..65].copy_from_slice(&self.tail_hash);
        encoded
    }

    fn decode(encoded: &[u8]) -> Result<Self, StoreError> {
        if encoded.len() != FILE_STATE_BYTES || encoded[0] != FILE_STATE_VERSION {
            return Err(StoreError::CorruptedIndex(
                "invalid rollout file state".into(),
            ));
        }
        Ok(Self {
            device: read_u64(&encoded[1..9])?,
            inode: read_u64(&encoded[9..17])?,
            indexed_bytes: read_u64(&encoded[17..25])?,
            records: read_u64(&encoded[25..33])?,
            tail_hash: encoded[33..65]
                .try_into()
                .map_err(|_| StoreError::CorruptedIndex("invalid tail hash".into()))?,
        })
    }
}

#[derive(Debug, thiserror::Error)]
pub enum StoreError {
    #[error(transparent)]
    Database(#[from] redb::Error),
    #[error(transparent)]
    DatabaseOpen(#[from] redb::DatabaseError),
    #[error(transparent)]
    Transaction(#[from] redb::TransactionError),
    #[error(transparent)]
    Table(#[from] redb::TableError),
    #[error(transparent)]
    Storage(#[from] redb::StorageError),
    #[error(transparent)]
    Commit(#[from] redb::CommitError),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
    #[error("corrupt companion index: {0}")]
    CorruptedIndex(String),
}

pub struct IndexStore {
    database: Database,
}

#[derive(Debug, Eq, PartialEq)]
pub struct ReplayPage {
    pub head_cursor: u64,
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
        let database = Database::create(path)?;
        let write = database.begin_write()?;
        {
            let mut meta = write.open_table(META)?;
            let stored = meta.get("schema_version")?.map(|value| value.value());
            match stored {
                Some(version) if version == u64::from(SCHEMA_VERSION) => {}
                None | Some(2 | 3) => {
                    meta.insert("schema_version", u64::from(SCHEMA_VERSION))?;
                }
                Some(version) => {
                    return Err(StoreError::Database(redb::Error::Corrupted(format!(
                        "unsupported schema version {version}"
                    ))));
                }
            }
            write.open_table(FILES)?;
            write.open_table(RECORDS)?;
            write.open_table(TURNS)?;
            write.open_table(TURNS_BY_ID)?;
            write.open_table(REPLAY)?;
            write.open_table(OUTBOX)?;
            write.open_table(THREAD_USAGE)?;
        }
        write.commit()?;
        Ok(Self { database })
    }

    #[must_use]
    pub const fn schema_version(&self) -> u32 {
        SCHEMA_VERSION
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

    /// Reads the durable progress for a rollout file.
    ///
    /// # Errors
    ///
    /// Returns an error if the read transaction fails or the stored state is
    /// corrupt.
    pub fn file_state(&self, file_id: &[u8; 32]) -> Result<Option<FileState>, StoreError> {
        let read = self.database.begin_read()?;
        let table = read.open_table(FILES)?;
        table
            .get(file_id.as_slice())?
            .map(|value| FileState::decode(value.value()))
            .transpose()
    }

    /// Commits rollout references and their exact source checkpoint atomically.
    ///
    /// # Errors
    ///
    /// Returns an error if a write transaction cannot be opened or committed.
    pub fn commit_batch(
        &self,
        file_id: &[u8; 32],
        records: &[(Vec<u8>, Vec<u8>)],
        turns: &[TurnRef],
        file_state: FileState,
    ) -> Result<(), StoreError> {
        let write = self.database.begin_write()?;
        {
            let mut table = write.open_table(RECORDS)?;
            for (key, value) in records {
                table.insert(key.as_slice(), value.as_slice())?;
            }
        }
        {
            let mut table = write.open_table(TURNS)?;
            let mut by_id = write.open_table(TURNS_BY_ID)?;
            for turn in turns {
                let key = offset_key(file_id, turn.start_offset);
                let value = turn.encode()?;
                table.insert(key.as_slice(), value.as_slice())?;
                let id_key = turn_id_key(file_id, &turn.id);
                by_id.insert(id_key.as_slice(), turn.start_offset)?;
            }
        }
        {
            let mut files = write.open_table(FILES)?;
            files.insert(file_id.as_slice(), file_state.encode().as_slice())?;
        }
        write.commit()?;
        Ok(())
    }

    /// Removes the derived index for one replaced or truncated rollout.
    ///
    /// # Errors
    ///
    /// Returns an error if the range cannot be removed atomically.
    pub fn reset_file(&self, file_id: &[u8; 32]) -> Result<(), StoreError> {
        let mut start = Vec::with_capacity(40);
        start.extend_from_slice(file_id);
        start.extend_from_slice(&0_u64.to_be_bytes());
        let mut end = Vec::with_capacity(40);
        end.extend_from_slice(file_id);
        end.extend_from_slice(&u64::MAX.to_be_bytes());
        let mut id_start = Vec::with_capacity(33);
        id_start.extend_from_slice(file_id);
        id_start.push(0);
        let mut id_end = Vec::with_capacity(33);
        id_end.extend_from_slice(file_id);
        id_end.push(u8::MAX);

        let write = self.database.begin_write()?;
        {
            let mut records = write.open_table(RECORDS)?;
            records.retain_in(start.as_slice()..=end.as_slice(), |_key, _value| false)?;
        }
        {
            let mut turns = write.open_table(TURNS)?;
            turns.retain_in(start.as_slice()..=end.as_slice(), |_key, _value| false)?;
        }
        {
            let mut turns_by_id = write.open_table(TURNS_BY_ID)?;
            turns_by_id.retain_in(id_start.as_slice()..=id_end.as_slice(), |_key, _value| {
                false
            })?;
        }
        {
            let mut files = write.open_table(FILES)?;
            files.remove(file_id.as_slice())?;
        }
        write.commit()?;
        Ok(())
    }

    /// Returns the number of indexed JSONL records.
    ///
    /// # Errors
    ///
    /// Returns an error if a read transaction cannot access the index table.
    pub fn record_count(&self) -> Result<u64, StoreError> {
        let read = self.database.begin_read()?;
        let table = read.open_table(RECORDS)?;
        Ok(table.len()?)
    }

    /// Returns the newest turns before an optional source offset.
    ///
    /// # Errors
    ///
    /// Returns an error if the index cannot be read or contains a corrupt row.
    pub fn turns_desc(
        &self,
        file_id: &[u8; 32],
        before_offset: Option<u64>,
        limit: usize,
    ) -> Result<Vec<TurnRef>, StoreError> {
        if limit == 0 {
            return Ok(Vec::new());
        }
        let start = offset_key(file_id, 0);
        let inclusive_end = before_offset.map_or(u64::MAX, |offset| offset.saturating_sub(1));
        let end = offset_key(file_id, inclusive_end);
        let read = self.database.begin_read()?;
        let table = read.open_table(TURNS)?;
        let mut turns = Vec::with_capacity(limit);
        for entry in table
            .range(start.as_slice()..=end.as_slice())?
            .rev()
            .take(limit)
        {
            let (_key, value) = entry?;
            turns.push(TurnRef::decode(value.value())?);
        }
        Ok(turns)
    }

    /// Resolves one turn without scanning the thread history.
    ///
    /// # Errors
    ///
    /// Returns an error if the index cannot be read or contains a corrupt row.
    pub fn turn_by_id(
        &self,
        file_id: &[u8; 32],
        turn_id: &str,
    ) -> Result<Option<TurnRef>, StoreError> {
        let read = self.database.begin_read()?;
        let by_id = read.open_table(TURNS_BY_ID)?;
        let id_key = turn_id_key(file_id, turn_id);
        let Some(offset) = by_id.get(id_key.as_slice())?.map(|value| value.value()) else {
            return Ok(None);
        };
        let turns = read.open_table(TURNS)?;
        let key = offset_key(file_id, offset);
        turns
            .get(key.as_slice())?
            .map(|value| TurnRef::decode(value.value()))
            .transpose()
    }

    /// Returns the number of indexed turns.
    ///
    /// # Errors
    ///
    /// Returns an error if the table cannot be read.
    pub fn turn_count(&self) -> Result<u64, StoreError> {
        let read = self.database.begin_read()?;
        let table = read.open_table(TURNS)?;
        Ok(table.len()?)
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
        write.commit()?;
        Ok(cursors)
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
        let oldest = replay.first()?.map(|(key, _value)| key.value());
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
    /// Returns an error for invalid commands, capacity exhaustion, corruption,
    /// or a failed transaction.
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
        validate_outbox_id(command_id, "command id")?;
        validate_outbox_id(remote_thread_id, "remote thread id")?;
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
                {
                    return Err(StoreError::CorruptedIndex(
                        "outbox command id already has a different payload".into(),
                    ));
                }
                return Ok(existing);
            }
            let mut total_bytes = params_bytes;
            let mut max_order = 0_u64;
            for entry in table.iter()? {
                let (_key, value) = entry?;
                let existing: OutboxCommand = serde_json::from_slice(value.value())?;
                total_bytes =
                    total_bytes.saturating_add(serde_json::to_vec(&existing.params)?.len());
                max_order = max_order.max(existing.order);
            }
            if table.len()? >= MAX_OUTBOX_COMMANDS || total_bytes > MAX_OUTBOX_BYTES {
                return Err(StoreError::CorruptedIndex(
                    "outbox capacity exceeded".into(),
                ));
            }
            let now = unix_time_ms();
            let command = OutboxCommand {
                command_id: command_id.to_owned(),
                remote_thread_id: remote_thread_id.to_owned(),
                method: "turn/start".into(),
                params,
                state: OutboxState::Queued,
                presentation,
                order: max_order.saturating_add(1),
                created_at: created_at.unwrap_or(now),
                updated_at: now,
                last_error: None,
                attempts: 0,
                next_attempt_at: 0,
            };
            let encoded = serde_json::to_vec(&command)?;
            table.insert(command_id, encoded.as_slice())?;
            command
        };
        write.commit()?;
        Ok(command)
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
            .filter(|command| command.next_attempt_at <= now)
            .collect())
    }

    /// Changes a command delivery state atomically.
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
            command.state = state;
            command.updated_at = unix_time_ms();
            command.last_error = last_error.map(|error| error.chars().take(500).collect());
            command.next_attempt_at = 0;
            let encoded = serde_json::to_vec(&command)?;
            table.insert(command_id, encoded.as_slice())?;
            command
        };
        write.commit()?;
        Ok(command)
    }

    /// Defers a transiently failed command without releasing the per-thread
    /// FIFO head. The attempt counter and deadline are durable across restarts.
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
            let now = unix_time_ms();
            command.state = state;
            command.attempts = command.attempts.saturating_add(1);
            command.updated_at = now;
            command.next_attempt_at = now.saturating_add(delay_ms);
            command.last_error = Some(last_error.chars().take(500).collect());
            let encoded = serde_json::to_vec(&command)?;
            table.insert(command_id, encoded.as_slice())?;
            command
        };
        write.commit()?;
        Ok(command)
    }

    /// Delays a command for a known non-failure condition without consuming a
    /// retry attempt. The returned flag reports a client-visible state change.
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
            let changed = command.state != state || command.last_error.as_deref() != last_error;
            let now = unix_time_ms();
            command.state = state;
            command.updated_at = now;
            command.next_attempt_at = now.saturating_add(delay_ms);
            command.last_error = last_error.map(|error| error.chars().take(500).collect());
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
            let encoded = table
                .get(command_id)?
                .map(|value| value.value().to_vec())
                .ok_or_else(|| StoreError::CorruptedIndex("outbox command not found".into()))?;
            let mut command: OutboxCommand = serde_json::from_slice(&encoded)?;
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
            table.insert(command_id, encoded.as_slice())?;
            command
        };
        write.commit()?;
        Ok(command)
    }

    /// Reorders one queued command relative to another command in the same
    /// thread. A `None` target places it last.
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
        let write = self.database.begin_write()?;
        let changed = {
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
            same_thread.retain(|candidate| candidate.remote_thread_id == selected.remote_thread_id);
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
            let mut changed = false;
            for (mut command, order) in same_thread.into_iter().zip(order_slots) {
                if command.order == order {
                    continue;
                }
                command.order = order;
                command.updated_at = now;
                let encoded = serde_json::to_vec(&command)?;
                table.insert(command.command_id.as_str(), encoded.as_slice())?;
                changed = true;
            }
            changed
        };
        write.commit()?;
        Ok(changed)
    }

    /// Removes a queued or failed command. Commands being reconciled or
    /// already delivered remain as idempotency receipts.
    ///
    /// # Errors
    ///
    /// Returns an error if persistence fails or the row is corrupt.
    pub fn outbox_cancel(&self, command_id: &str) -> Result<bool, StoreError> {
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
            true
        };
        write.commit()?;
        Ok(cancelled)
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

fn offset_key(file_id: &[u8; 32], offset: u64) -> Vec<u8> {
    let mut key = Vec::with_capacity(40);
    key.extend_from_slice(file_id);
    key.extend_from_slice(&offset.to_be_bytes());
    key
}

fn turn_id_key(file_id: &[u8; 32], turn_id: &str) -> Vec<u8> {
    let mut key = Vec::with_capacity(33 + turn_id.len());
    key.extend_from_slice(file_id);
    key.push(0);
    key.extend_from_slice(turn_id.as_bytes());
    key
}

fn read_u64(bytes: &[u8]) -> Result<u64, StoreError> {
    let array: [u8; 8] = bytes
        .try_into()
        .map_err(|_| StoreError::CorruptedIndex("invalid integer width".into()))?;
    Ok(u64::from_be_bytes(array))
}

fn read_u16(bytes: &[u8]) -> Result<u16, StoreError> {
    let array: [u8; 2] = bytes
        .try_into()
        .map_err(|_| StoreError::CorruptedIndex("invalid integer width".into()))?;
    Ok(u16::from_be_bytes(array))
}
