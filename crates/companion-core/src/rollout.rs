use std::{
    fs::File,
    io::{BufRead, BufReader, Seek, SeekFrom},
    path::Path,
    time::Instant,
};

#[cfg(not(unix))]
use std::io::Read;
#[cfg(unix)]
use std::os::unix::fs::{FileExt, MetadataExt};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::{
    history::{HistoryError, SummaryProjectionState, summary_projection_state_from_file},
    rollout_content,
    store::{
        FileState, IndexStore, IndexedThreadMetadata, RecordRef, RolloutBatch, RolloutContentEntry,
        StoreError, TurnRef,
    },
};

const WRITE_BATCH_RECORDS: usize = 4_096;
const TAIL_CHECK_BYTES: u64 = 4_096;
const REVERSE_SCAN_BLOCK_BYTES: usize = 1024 * 1024;
const TAIL_BOOTSTRAP_FULL_SCAN_BYTES: u64 = 8 * 1024 * 1024;
const TAIL_BOOTSTRAP_TURNS: usize = 1;
const PREFIX_BACKFILL_TURNS: usize = 1;
const TASK_BOUNDARY_NEEDLES: [&[u8]; 4] = [
    b"\"type\":\"task_started\"",
    b"\"type\":\"task_complete\"",
    b"\"type\":\"turn_aborted\"",
    b"\"type\":\"thread_rolled_back\"",
];
type ActiveSummary = (u64, String, SummaryProjectionState);

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexReport {
    pub file_bytes: u64,
    pub indexed_records: u64,
    pub total_records: u64,
    pub coverage_start: u64,
    pub complete: bool,
    pub elapsed_ms: u128,
    pub records_per_second: u64,
    pub total_turns: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TailScanReport {
    pub file_bytes: u64,
    pub durable_bytes: u64,
    pub bytes_scanned: u64,
    pub elapsed_ms: u128,
    pub turns: Vec<TurnRefReport>,
}

#[derive(Debug)]
pub(crate) struct IndexedTurnPage {
    pub turns: Vec<TurnRef>,
    pub has_more: bool,
}

/// Source witness for derived history reads. Appends retain cursor validity;
/// replacements, truncation, same-length rewrites, and appended rollbacks invalidate it.
#[derive(Clone, Debug, Eq, Hash, PartialEq, Deserialize, Serialize)]
pub(crate) struct RolloutWitness {
    device: u64,
    inode: u64,
    pub durable_bytes: u64,
    tail_hash: [u8; 32],
    modified_nanos: u128,
    observed_bytes: u64,
}

pub(crate) fn rollout_witness_from_file(
    file: &File,
    file_bytes: u64,
) -> Result<RolloutWitness, IndexError> {
    let metadata = file.metadata()?;
    let (device, inode) = file_identity(&metadata);
    let durable_bytes = durable_end(file, file_bytes)?;
    Ok(RolloutWitness {
        device,
        inode,
        durable_bytes,
        tail_hash: tail_hash(file, durable_bytes)?,
        modified_nanos: metadata
            .modified()?
            .duration_since(std::time::UNIX_EPOCH)
            .map_or(0, |time| time.as_nanos()),
        observed_bytes: metadata.len(),
    })
}

pub(crate) fn rollout_witness_matches(
    file: &File,
    file_bytes: u64,
    witness: &RolloutWitness,
) -> Result<bool, IndexError> {
    let current = rollout_witness_from_file(file, file_bytes)?;
    if current.device != witness.device
        || current.inode != witness.inode
        || current.durable_bytes < witness.durable_bytes
        || tail_hash(file, witness.durable_bytes)? != witness.tail_hash
        || (current.observed_bytes == witness.observed_bytes
            && current.modified_nanos != witness.modified_nanos)
    {
        return Ok(false);
    }
    let mut unchanged = true;
    visit_task_boundaries_reverse(
        file,
        current.durable_bytes,
        witness.durable_bytes,
        |_, _, boundary| {
            unchanged = !matches!(boundary, TaskBoundary::Rollback(_));
            unchanged
        },
    )?;
    Ok(unchanged)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnRefReport {
    pub id: String,
    pub start_offset: u64,
    pub end_offset: u64,
    pub completed: bool,
}

impl From<TurnRef> for TurnRefReport {
    fn from(turn: TurnRef) -> Self {
        Self {
            id: turn.id,
            start_offset: turn.start_offset,
            end_offset: turn.end_offset,
            completed: turn.completed,
        }
    }
}

#[derive(Debug, thiserror::Error)]
pub enum IndexError {
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Store(#[from] StoreError),
    #[error(transparent)]
    History(#[from] HistoryError),
    #[error("rollout contains a record larger than 4 GiB at byte {0}")]
    RecordTooLarge(u64),
    #[error("invalid task boundary at byte {offset}: {source}")]
    InvalidTaskBoundary {
        offset: u64,
        source: serde_json::Error,
    },
}

/// Advances the contiguous hot index for `path`.
///
/// A cold large rollout is bootstrapped from its newest turns so head reads do
/// not wait for the complete historical prefix. Existing indexes and appended
/// records continue forward from their durable checkpoint.
///
/// # Errors
///
/// Returns an error when the rollout cannot be read, an individual record is
/// larger than the index format supports, or the crash-safe store cannot
/// commit a batch.
#[allow(clippy::too_many_lines)] // One crash-safe transaction state machine is easier to audit whole.
pub fn index_rollout(store: &IndexStore, path: &Path) -> Result<IndexReport, IndexError> {
    let started = Instant::now();
    let file_id = rollout_file_id(path);
    let file = File::open(path)?;
    let metadata = file.metadata()?;
    let file_bytes = metadata.len();
    let durable_bytes = durable_end(&file, file_bytes)?;
    let (device, inode) = file_identity(&metadata);
    if let Some(state) = store.file_state(&file_id)?
        && file_state_matches(&file, state, device, inode, durable_bytes)?
        && state.indexed_bytes == durable_bytes
    {
        return finish_index_report(store, &file_id, started, file_bytes, 0, state);
    }

    let index_lock = store.rollout_index_lock(file_id);
    let _index_guard = index_lock
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    let file = File::open(path)?;
    let metadata = file.metadata()?;
    let file_bytes = metadata.len();
    let durable_bytes = durable_end(&file, file_bytes)?;
    let (device, inode) = file_identity(&metadata);
    let persisted = store.file_state(&file_id)?;
    let mut checkpoint_dirty = false;
    let mut state = match persisted {
        Some(candidate) if file_state_matches(&file, candidate, device, inode, durable_bytes)? => {
            candidate
        }
        Some(_) => {
            store.reset_file(&file_id)?;
            checkpoint_dirty = true;
            FileState::empty(device, inode)
        }
        None => {
            checkpoint_dirty = true;
            FileState::empty(device, inode)
        }
    };
    if state.indexed_bytes == durable_bytes {
        if checkpoint_dirty {
            state.modified_nanos = modified_nanos(&metadata);
            state.tail_hash = tail_hash(&file, state.indexed_bytes)?;
            store.commit_batch(&file_id, &[], &[], &[], state)?;
        }
        return finish_index_report(store, &file_id, started, file_bytes, 0, state);
    }
    if state.indexed_bytes == 0 && state.records == 0 && durable_bytes > 0 {
        let indexed_from = tail_bootstrap_start(&file, file_bytes, durable_bytes)?;
        state = FileState::tail(device, inode, indexed_from);
        checkpoint_dirty = true;
    }
    state.modified_nanos = modified_nanos(&metadata);
    let mut reader = BufReader::with_capacity(1024 * 1024, file);
    reader.seek(SeekFrom::Start(state.indexed_bytes))?;
    let mut offset = state.indexed_bytes;
    let mut sequence = state.records;
    let initial_records = state.records;
    let mut line = Vec::new();
    let mut batch = Vec::with_capacity(WRITE_BATCH_RECORDS);
    let mut turn_batch = Vec::new();
    let (mut active_turn, mut active_summary) =
        active_projection(store, &file_id, reader.get_ref(), state.indexed_bytes)?;
    let mut summary_batch = Vec::new();
    let mut removed_turns = Vec::new();
    let mut content_batch = Vec::new();
    let modified_at = modified_seconds(&metadata);

    loop {
        line.clear();
        let bytes = reader.read_until(b'\n', &mut line)?;
        if bytes == 0 {
            break;
        }
        // Index a writer-owned final record only after its durable newline.
        if line.last() != Some(&b'\n') {
            break;
        }
        let record = source_record(offset, bytes, &line)?;
        let length = record.length;
        if let Some(metadata) = thread_metadata_from_record(path, modified_at, &line) {
            store.put_thread_metadata(&metadata)?;
        }
        batch.push(indexed_record(&file_id, record));
        index_content(&mut content_batch, path, file_id, record, &line);
        let boundary = task_boundary(&line, offset)?;
        collect_rollback_removals(
            reader.get_ref(),
            offset,
            boundary.as_ref(),
            &mut removed_turns,
        )?;
        update_summary_index(
            boundary.as_ref(),
            offset,
            &line,
            &mut active_summary,
            &mut summary_batch,
        )?;
        update_turn_index(
            boundary.as_ref(),
            offset,
            length,
            &mut active_turn,
            &mut turn_batch,
        );
        sequence += 1;
        offset += u64::from(length);
        if batch.len() == WRITE_BATCH_RECORDS {
            state.indexed_bytes = offset;
            state.records = sequence;
            state.tail_hash = tail_hash(reader.get_ref(), offset)?;
            remember_active_summary(active_summary.as_ref(), &mut summary_batch)?;
            store.commit_rollout_batch(
                &file_id,
                pending_rollout_batch(
                    &batch,
                    &turn_batch,
                    &summary_batch,
                    &removed_turns,
                    &content_batch,
                ),
                state,
            )?;
            batch.clear();
            turn_batch.clear();
            summary_batch.clear();
            removed_turns.clear();
            content_batch.clear();
        }
    }
    if !batch.is_empty() {
        state.indexed_bytes = offset;
        state.records = sequence;
        state.tail_hash = tail_hash(reader.get_ref(), offset)?;
        remember_active_summary(active_summary.as_ref(), &mut summary_batch)?;
        store.commit_rollout_batch(
            &file_id,
            pending_rollout_batch(
                &batch,
                &turn_batch,
                &summary_batch,
                &removed_turns,
                &content_batch,
            ),
            state,
        )?;
        checkpoint_dirty = false;
    }
    if checkpoint_dirty {
        state.indexed_bytes = offset;
        state.records = sequence;
        state.tail_hash = tail_hash(reader.get_ref(), offset)?;
        remember_active_summary(active_summary.as_ref(), &mut summary_batch)?;
        store.commit_rollout_batch(
            &file_id,
            pending_rollout_batch(
                &batch,
                &turn_batch,
                &summary_batch,
                &removed_turns,
                &content_batch,
            ),
            state,
        )?;
    }

    let indexed_records = sequence - initial_records;
    finish_index_report(store, &file_id, started, file_bytes, indexed_records, state)
}

fn finish_index_report(
    store: &IndexStore,
    file_id: &[u8; 32],
    started: Instant,
    file_bytes: u64,
    indexed_records: u64,
    state: FileState,
) -> Result<IndexReport, IndexError> {
    let elapsed_ms = started.elapsed().as_millis();
    let persisted = store.file_state(file_id)?.unwrap_or(state);
    Ok(IndexReport {
        file_bytes,
        indexed_records,
        total_records: persisted.records,
        coverage_start: persisted.indexed_from,
        complete: persisted.is_complete(),
        elapsed_ms,
        records_per_second: record_rate(indexed_records, elapsed_ms),
        total_turns: store.turn_count()?,
    })
}

/// Expands a tail-first index toward byte zero by one bounded turn range.
/// Each committed checkpoint still describes one contiguous indexed suffix, so
/// a crash cannot expose a hole as complete history.
///
/// # Errors
///
/// Returns an error when the rollout changes incompatibly, a record boundary
/// is malformed, or the durable index transaction fails.
pub fn backfill_rollout_prefix(store: &IndexStore, path: &Path) -> Result<IndexReport, IndexError> {
    let started = Instant::now();
    let hot = index_rollout(store, path)?;
    if hot.complete {
        return Ok(hot);
    }

    let file_id = rollout_file_id(path);
    let index_lock = store.rollout_index_lock(file_id);
    let index_guard = index_lock
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    let file = File::open(path)?;
    let metadata = file.metadata()?;
    let file_bytes = metadata.len();
    let durable_bytes = durable_end(&file, file_bytes)?;
    let (device, inode) = file_identity(&metadata);
    let Some(mut state) = store.file_state(&file_id)? else {
        return Err(StoreError::CorruptedIndex("rollout checkpoint is missing".into()).into());
    };
    if !file_state_matches(&file, state, device, inode, durable_bytes)?
        || state.indexed_bytes != durable_bytes
    {
        // The writer appended, truncated, or atomically replaced the rollout
        // between the hot advance and this backfill step. Release the lane and
        // let the normal forward path reconcile it before trying older bytes.
        drop(index_guard);
        return index_rollout(store, path);
    }
    if state.is_complete() {
        return finish_index_report(store, &file_id, started, file_bytes, 0, state);
    }

    let previous_from = state.indexed_from;
    // Backfill replays rollback records atomically with their tombstones, so
    // discovery needs only the adjacent physical range, not the whole tail.
    let mut indexed_from = 0;
    let mut remaining = PREFIX_BACKFILL_TURNS;
    visit_task_boundaries_reverse(&file, previous_from, 0, |offset, _, boundary| {
        if matches!(boundary, TaskBoundary::Started(_)) {
            indexed_from = offset;
            remaining -= 1;
        }
        remaining > 0
    })?;
    if indexed_from >= previous_from {
        return Err(StoreError::CorruptedIndex("prefix backfill made no progress".into()).into());
    }
    let indexed_records = index_prefix_range(
        store,
        path,
        &file,
        &metadata,
        &file_id,
        &mut state,
        indexed_from,
        previous_from,
    )?;
    finish_index_report(store, &file_id, started, file_bytes, indexed_records, state)
}

/// Advances durable coverage through a semantic anchor and its requested older
/// neighbors. The index lane coalesces concurrent recovery; proven absence
/// completes coverage so later misses never repeat a full source scan.
pub(crate) fn index_rollout_through_anchor(
    store: &IndexStore,
    path: &Path,
    anchor_id: &str,
    older_limit: usize,
) -> Result<IndexReport, IndexError> {
    let started = Instant::now();
    let hot = index_rollout(store, path)?;
    if hot.complete {
        return Ok(hot);
    }
    let file_id = rollout_file_id(path);
    let lane = store.rollout_index_lock(file_id);
    let guard = lane
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    let file = File::open(path)?;
    let metadata = file.metadata()?;
    let file_bytes = metadata.len();
    let Some(mut state) = current_indexed_coverage_from_file(store, path, &file, file_bytes)?
    else {
        drop(guard);
        return index_rollout(store, path);
    };
    if state.is_complete() {
        return finish_index_report(store, &file_id, started, file_bytes, 0, state);
    }
    if let Some(anchor) = store.turn_by_id(&file_id, anchor_id)?
        && anchor.start_offset >= state.indexed_from
    {
        let older = store.turns_desc(&file_id, Some(anchor.start_offset), older_limit)?;
        if older.len() == older_limit
            && older
                .iter()
                .all(|turn| turn.start_offset >= state.indexed_from)
        {
            return finish_index_report(store, &file_id, started, file_bytes, 0, state);
        }
    }
    let mut found = false;
    let mut remaining = older_limit;
    let mut indexed_from = 0;
    visit_logical_turns_reverse(&file, state.indexed_bytes, |turn| {
        if turn.id == anchor_id {
            found = true;
            if remaining == 0 {
                indexed_from = turn.start_offset;
                return false;
            }
        } else if found && turn.end_offset != 0 {
            remaining -= 1;
            if remaining == 0 {
                indexed_from = turn.start_offset;
                return false;
            }
        }
        true
    })?;
    let previous_from = state.indexed_from;
    if indexed_from >= previous_from {
        return finish_index_report(store, &file_id, started, file_bytes, 0, state);
    }
    let indexed_records = index_prefix_range(
        store,
        path,
        &file,
        &metadata,
        &file_id,
        &mut state,
        indexed_from,
        previous_from,
    )?;
    finish_index_report(store, &file_id, started, file_bytes, indexed_records, state)
}

/// Completes the historical prefix for consumers that require every source
/// record, such as attachment and changed-file projections.
///
/// # Errors
///
/// Returns an error when tail advancement or any bounded prefix step fails.
pub fn index_rollout_fully(store: &IndexStore, path: &Path) -> Result<IndexReport, IndexError> {
    let started = Instant::now();
    let mut report = index_rollout(store, path)?;
    let mut indexed_records = report.indexed_records;
    while !report.complete {
        report = backfill_rollout_prefix(store, path)?;
        indexed_records = indexed_records.saturating_add(report.indexed_records);
    }
    report.indexed_records = indexed_records;
    report.elapsed_ms = started.elapsed().as_millis();
    report.records_per_second = record_rate(indexed_records, report.elapsed_ms);
    Ok(report)
}

fn file_state_matches(
    file: &File,
    state: FileState,
    device: u64,
    inode: u64,
    durable_bytes: u64,
) -> Result<bool, std::io::Error> {
    Ok(state.device == device
        && state.inode == inode
        && state.indexed_from <= state.indexed_bytes
        && state.indexed_bytes <= durable_bytes
        && (state.indexed_bytes != durable_bytes
            || state.modified_nanos == modified_nanos(&file.metadata()?))
        && tail_hash(file, state.indexed_bytes)? == state.tail_hash)
}

fn tail_bootstrap_start(
    file: &File,
    file_bytes: u64,
    durable_bytes: u64,
) -> Result<u64, IndexError> {
    if durable_bytes <= TAIL_BOOTSTRAP_FULL_SCAN_BYTES {
        return Ok(0);
    }
    let scan = scan_tail_turns_from_file(file, file_bytes, None, TAIL_BOOTSTRAP_TURNS)?;
    Ok(scan
        .turns
        .last()
        .map_or(durable_bytes, |turn| turn.start_offset))
}

#[allow(clippy::too_many_arguments)]
fn index_prefix_range(
    store: &IndexStore,
    path: &Path,
    file: &File,
    metadata: &std::fs::Metadata,
    file_id: &[u8; 32],
    state: &mut FileState,
    indexed_from: u64,
    previous_from: u64,
) -> Result<u64, IndexError> {
    let mut reader = BufReader::with_capacity(1024 * 1024, file.try_clone()?);
    reader.seek(SeekFrom::Start(indexed_from))?;
    let mut offset = indexed_from;
    let mut indexed_records = 0_u64;
    let mut line = Vec::new();
    let mut batch = Vec::with_capacity(WRITE_BATCH_RECORDS);
    let mut turn_batch = Vec::new();
    let mut active_turn = None;
    let mut summary_batch = Vec::new();
    let mut active_summary = None;
    let mut removed_turns = Vec::new();
    let mut content_batch = Vec::new();
    let modified_at = modified_seconds(metadata);

    while offset < previous_from {
        line.clear();
        let bytes = reader.read_until(b'\n', &mut line)?;
        if bytes == 0 || line.last() != Some(&b'\n') {
            return Err(StoreError::CorruptedIndex(
                "prefix backfill ended outside a durable record".into(),
            )
            .into());
        }
        let next_offset = offset.saturating_add(bytes as u64);
        if next_offset > previous_from {
            return Err(StoreError::CorruptedIndex(
                "prefix backfill crossed its task boundary".into(),
            )
            .into());
        }
        let record = source_record(offset, bytes, &line)?;
        let length = record.length;
        if let Some(metadata) = thread_metadata_from_record(path, modified_at, &line) {
            store.put_thread_metadata(&metadata)?;
        }
        batch.push(indexed_record(file_id, record));
        index_content(&mut content_batch, path, *file_id, record, &line);
        let boundary = task_boundary(&line, offset)?;
        collect_rollback_removals(file, offset, boundary.as_ref(), &mut removed_turns)?;
        update_summary_index(
            boundary.as_ref(),
            offset,
            &line,
            &mut active_summary,
            &mut summary_batch,
        )?;
        update_turn_index(
            boundary.as_ref(),
            offset,
            length,
            &mut active_turn,
            &mut turn_batch,
        );
        indexed_records = indexed_records.saturating_add(1);
        offset = next_offset;
        if batch.len() == WRITE_BATCH_RECORDS {
            remember_active_summary(active_summary.as_ref(), &mut summary_batch)?;
            // Keep the old coverage checkpoint until the entire adjacent range
            // is durable. Rows written before it remain invisible after a crash.
            store.commit_rollout_batch(
                file_id,
                pending_rollout_batch(
                    &batch,
                    &turn_batch,
                    &summary_batch,
                    &removed_turns,
                    &content_batch,
                ),
                *state,
            )?;
            batch.clear();
            turn_batch.clear();
            summary_batch.clear();
            removed_turns.clear();
            content_batch.clear();
        }
    }
    if offset != previous_from {
        return Err(
            StoreError::CorruptedIndex("prefix backfill boundary is not aligned".into()).into(),
        );
    }
    if let Some(mut interrupted) = active_turn.take() {
        interrupted.end_offset = previous_from;
        turn_batch.push(interrupted);
    }
    remember_active_summary(active_summary.as_ref(), &mut summary_batch)?;
    state.indexed_from = indexed_from;
    state.records = state.records.saturating_add(indexed_records);
    store.commit_rollout_batch(
        file_id,
        pending_rollout_batch(
            &batch,
            &turn_batch,
            &summary_batch,
            &removed_turns,
            &content_batch,
        ),
        *state,
    )?;
    Ok(indexed_records)
}

fn record_rate(records: u64, elapsed_ms: u128) -> u64 {
    (u128::from(records) * 1_000)
        .checked_div(elapsed_ms)
        .and_then(|rate| u64::try_from(rate).ok())
        .unwrap_or(records)
}

/// Reads only the canonical session header and updates the shared thread
/// metadata index. This primes parent-child lookups without loading history.
///
/// # Errors
///
/// Returns an error when the rollout header cannot be read or the metadata
/// index cannot be committed.
pub fn index_rollout_metadata(store: &IndexStore, path: &Path) -> Result<(), IndexError> {
    if let Some(metadata) = read_rollout_metadata(path)? {
        store.put_thread_metadata(&metadata)?;
    }
    Ok(())
}

/// Reads only the canonical session header without touching the index.
///
/// # Errors
///
/// Returns an error when the rollout header cannot be read.
pub fn read_rollout_metadata(path: &Path) -> Result<Option<IndexedThreadMetadata>, IndexError> {
    let file = File::open(path)?;
    let metadata = file.metadata()?;
    let modified_at = metadata
        .modified()
        .ok()
        .and_then(|value| value.duration_since(std::time::UNIX_EPOCH).ok())
        .and_then(|value| i64::try_from(value.as_secs()).ok())
        .unwrap_or(0);
    let mut reader = BufReader::new(file);
    let mut line = Vec::new();
    Ok((reader.read_until(b'\n', &mut line)? > 0)
        .then(|| thread_metadata_from_record(path, modified_at, &line))
        .flatten())
}

fn thread_metadata_from_record(
    path: &Path,
    modified_at: i64,
    line: &[u8],
) -> Option<IndexedThreadMetadata> {
    memchr::memmem::find(line, b"\"type\":\"session_meta\"")?;
    let envelope = serde_json::from_slice::<Value>(line).ok()?;
    let payload = envelope.get("payload")?;
    let id = payload.get("id")?.as_str()?.to_owned();
    let source = payload
        .get("source")
        .cloned()
        .unwrap_or_else(|| Value::String("unknown".into()));
    let spawn = source
        .get("subagent")
        .or_else(|| source.get("subAgent"))
        .and_then(|value| value.get("thread_spawn"));
    let parent_thread_id = spawn
        .and_then(|value| value.get("parent_thread_id"))
        .and_then(Value::as_str)
        .map(ToOwned::to_owned);
    let agent_nickname = spawn
        .and_then(|value| value.get("agent_nickname"))
        .and_then(Value::as_str)
        .map(ToOwned::to_owned);
    let agent_role = spawn
        .and_then(|value| value.get("agent_role"))
        .and_then(Value::as_str)
        .map(ToOwned::to_owned);
    Some(IndexedThreadMetadata {
        id,
        parent_thread_id,
        cwd: payload
            .get("cwd")
            .and_then(Value::as_str)
            .unwrap_or("/")
            .to_owned(),
        created_at: modified_at,
        updated_at: modified_at,
        model_provider: payload
            .get("model_provider")
            .and_then(Value::as_str)
            .unwrap_or("openai")
            .to_owned(),
        cli_version: payload
            .get("cli_version")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_owned(),
        source,
        agent_nickname,
        agent_role,
        archived: path
            .components()
            .any(|component| component.as_os_str() == "archived_sessions"),
    })
}

fn update_turn_index(
    boundary: Option<&TaskBoundary>,
    offset: u64,
    length: u32,
    active_turn: &mut Option<TurnRef>,
    turn_batch: &mut Vec<TurnRef>,
) {
    match boundary {
        Some(TaskBoundary::Started(turn_id)) => {
            if let Some(mut interrupted) = active_turn.take() {
                interrupted.end_offset = offset;
                turn_batch.push(interrupted);
            }
            let turn = TurnRef {
                id: turn_id.clone(),
                start_offset: offset,
                end_offset: 0,
                completed: false,
            };
            turn_batch.push(turn.clone());
            *active_turn = Some(turn);
        }
        Some(TaskBoundary::Terminal { turn_id, completed }) => {
            if let Some(mut terminal) = active_turn.take() {
                if terminal.id == *turn_id {
                    terminal.end_offset = offset + u64::from(length);
                    terminal.completed = *completed;
                    turn_batch.push(terminal);
                } else {
                    *active_turn = Some(terminal);
                }
            }
        }
        Some(TaskBoundary::Rollback(count)) if *count > 0 => {
            *active_turn = None;
        }
        Some(TaskBoundary::Rollback(_)) | None => {}
    }
}

fn update_summary_index(
    boundary: Option<&TaskBoundary>,
    offset: u64,
    line: &[u8],
    active: &mut Option<ActiveSummary>,
    batch: &mut Vec<(u64, Vec<u8>)>,
) -> Result<(), IndexError> {
    if matches!(boundary, Some(TaskBoundary::Rollback(count)) if *count > 0) {
        *active = None;
        return Ok(());
    }
    if let Some(TaskBoundary::Started(turn_id)) = boundary {
        remember_active_summary(active.as_ref(), batch)?;
        *active = Some((
            offset,
            turn_id.clone(),
            SummaryProjectionState::new(turn_id.clone()),
        ));
    }
    if let Some((_start_offset, _turn_id, summary)) = active.as_mut() {
        // Crash fragments are tolerated by the history reader. Keep the same
        // behavior in the incremental materializer: a later durable record can
        // still complete the projection.
        let _ = summary.ingest_rollout_record(line, offset);
    }
    if let Some(TaskBoundary::Terminal { turn_id, .. }) = boundary
        && active
            .as_ref()
            .is_some_and(|(_start_offset, active_turn_id, _summary)| active_turn_id == turn_id)
    {
        remember_active_summary(active.as_ref(), batch)?;
        *active = None;
    }
    Ok(())
}

fn remember_active_summary(
    active: Option<&ActiveSummary>,
    batch: &mut Vec<(u64, Vec<u8>)>,
) -> Result<(), IndexError> {
    let Some((start_offset, _turn_id, summary)) = active else {
        return Ok(());
    };
    batch.push((
        *start_offset,
        serde_json::to_vec(summary).map_err(StoreError::from)?,
    ));
    Ok(())
}

fn active_projection(
    store: &IndexStore,
    file_id: &[u8; 32],
    file: &File,
    indexed_bytes: u64,
) -> Result<(Option<TurnRef>, Option<ActiveSummary>), IndexError> {
    let turn = store
        .turns_desc(file_id, None, 1)?
        .into_iter()
        .next()
        .filter(|turn| turn.end_offset == 0);
    let mut summary = turn
        .as_ref()
        .map(|turn| {
            store
                .turn_summary_state::<SummaryProjectionState>(file_id, turn.start_offset)
                .map(|state| {
                    state
                        .filter(SummaryProjectionState::is_current)
                        .map(|state| (turn.start_offset, turn.id.clone(), state))
                })
        })
        .transpose()?
        .flatten();
    if summary.is_none()
        && let Some(turn) = turn.as_ref()
    {
        let mut indexed_turn = turn.clone();
        indexed_turn.end_offset = indexed_bytes;
        let state = summary_projection_state_from_file(file, &indexed_turn)?;
        store.put_turn_summary_state(file_id, turn.start_offset, &state)?;
        summary = Some((turn.start_offset, turn.id.clone(), state));
    }
    Ok((turn, summary))
}

fn modified_seconds(metadata: &std::fs::Metadata) -> i64 {
    metadata
        .modified()
        .ok()
        .and_then(|value| value.duration_since(std::time::UNIX_EPOCH).ok())
        .and_then(|value| i64::try_from(value.as_secs()).ok())
        .unwrap_or(0)
}

fn modified_nanos(metadata: &std::fs::Metadata) -> u128 {
    metadata
        .modified()
        .ok()
        .and_then(|value| value.duration_since(std::time::UNIX_EPOCH).ok())
        .map_or(0, |value| value.as_nanos())
}

#[must_use]
pub fn rollout_file_id(path: &Path) -> [u8; 32] {
    *blake3::hash(path.as_os_str().as_encoded_bytes()).as_bytes()
}

/// Reads a descending turn page only when the persisted contiguous index
/// exactly matches the durable tail of this already-open rollout handle.
///
/// An open mutable turn retains `end_offset == 0`; projection owns clipping it
/// to the read's durable JSONL boundary. A missing or stale
/// checkpoint returns `None` so the caller can use the bounded cold tail scan
/// while an incremental rebuild runs in the background.
pub(crate) fn current_indexed_turns_from_file(
    store: &IndexStore,
    path: &Path,
    file: &File,
    file_bytes: u64,
    before_offset: Option<u64>,
    limit: usize,
) -> Result<Option<IndexedTurnPage>, IndexError> {
    let metadata = file.metadata()?;
    let (device, inode) = file_identity(&metadata);
    let durable_bytes = durable_end(file, file_bytes)?;
    let file_id = rollout_file_id(path);
    let Some(state) = store.file_state(&file_id)? else {
        return Ok(None);
    };
    if state.device != device
        || state.inode != inode
        || state.indexed_from > state.indexed_bytes
        || state.indexed_bytes != durable_bytes
        || state.modified_nanos != modified_nanos(&metadata)
        || tail_hash(file, state.indexed_bytes)? != state.tail_hash
    {
        return Ok(None);
    }
    if before_offset.is_some_and(|offset| offset <= state.indexed_from) {
        return Ok(None);
    }

    let mut turns = store.turns_desc(&file_id, before_offset, limit)?;
    // Rows may have been committed before a crash without moving the coverage
    // watermark. They remain invisible until an adjacent backfill commits.
    turns.retain(|turn| turn.start_offset >= state.indexed_from);
    if turns.is_empty() && !state.is_complete() {
        return Ok(None);
    }
    for turn in &turns {
        if turn.start_offset < state.indexed_from
            || (turn.end_offset != 0 && turn.start_offset >= turn.end_offset)
            || turn.end_offset > durable_bytes
        {
            return Ok(None);
        }
    }
    Ok(Some(IndexedTurnPage {
        has_more: !state.is_complete() && turns.len() < limit,
        turns,
    }))
}

/// Resolves a semantic anchor only inside a checkpoint validated against this
/// open source handle. The caller holds the per-rollout index lane while using it.
pub(crate) fn current_indexed_anchor_from_file(
    store: &IndexStore,
    path: &Path,
    file: &File,
    file_bytes: u64,
    turn_id: &str,
) -> Result<Option<TurnRef>, IndexError> {
    let file_id = rollout_file_id(path);
    let Some(state) = current_indexed_coverage_from_file(store, path, file, file_bytes)? else {
        return Ok(None);
    };
    let durable_bytes = state.indexed_bytes;
    let anchor = store.turn_by_id(&file_id, turn_id)?.filter(|turn| {
        turn.start_offset >= state.indexed_from
            && turn.start_offset < durable_bytes
            && turn.end_offset <= durable_bytes
    });
    if store.file_state(&file_id)? != Some(state) {
        return Ok(None);
    }
    Ok(anchor)
}

/// Validates contiguous index coverage against an already-open source snapshot.
/// Complete coverage distinguishes a proven missing anchor from a cold prefix.
pub(crate) fn current_indexed_coverage_from_file(
    store: &IndexStore,
    path: &Path,
    file: &File,
    file_bytes: u64,
) -> Result<Option<FileState>, IndexError> {
    let Some(state) = store.file_state(&rollout_file_id(path))? else {
        return Ok(None);
    };
    let (device, inode) = file_identity(&file.metadata()?);
    let durable_bytes = durable_end(file, file_bytes)?;
    Ok((state.indexed_bytes == durable_bytes
        && file_state_matches(file, state, device, inode, durable_bytes)?)
    .then_some(state))
}

/// Discovers the newest turn spans directly from the durable JSONL tail.
///
/// This is the cold-start path: it can render the latest page before a full
/// forward index exists. Older pages are served by repeating the scan with the
/// oldest returned `start_offset` as `before_offset`.
///
/// # Errors
///
/// Returns an error if the rollout cannot be read or a task boundary is
/// malformed.
pub fn scan_tail_turns(
    path: &Path,
    before_offset: Option<u64>,
    limit: usize,
) -> Result<TailScanReport, IndexError> {
    let file = File::open(path)?;
    let file_bytes = file.metadata()?.len();
    scan_tail_turns_from_file(&file, file_bytes, before_offset, limit)
}

/// Scans a stable open rollout handle. Keeping discovery and projection on the
/// same handle prevents a concurrent atomic rollout replacement from mixing
/// offsets from one inode with bytes from another.
pub(crate) fn scan_tail_turns_from_file(
    file: &File,
    file_bytes: u64,
    before_offset: Option<u64>,
    limit: usize,
) -> Result<TailScanReport, IndexError> {
    let started = Instant::now();
    let durable_bytes = durable_end(file, file_bytes)?;
    let search_end = before_offset.unwrap_or(durable_bytes).min(durable_bytes);
    if limit == 0 || search_end == 0 {
        return Ok(TailScanReport {
            file_bytes,
            durable_bytes,
            bytes_scanned: 0,
            elapsed_ms: started.elapsed().as_millis(),
            turns: Vec::new(),
        });
    }

    let mut turns = Vec::with_capacity(limit);
    let bytes_scanned = visit_logical_turns_reverse(file, durable_bytes, |turn| {
        if turn.start_offset < search_end {
            turns.push(turn.into());
        }
        turns.len() < limit
    })?;
    Ok(TailScanReport {
        file_bytes,
        durable_bytes,
        bytes_scanned,
        elapsed_ms: started.elapsed().as_millis(),
        turns,
    })
}

/// Recovers the nearest ascending page after an unindexed semantic anchor in
/// one reverse traversal. Resident memory is limited to the requested page.
pub(crate) fn scan_turns_after_from_file(
    file: &File,
    file_bytes: u64,
    anchor_id: &str,
    limit: usize,
) -> Result<Option<Vec<TurnRef>>, IndexError> {
    let mut found = false;
    let mut newer = std::collections::VecDeque::with_capacity(limit);
    visit_logical_turns_reverse(file, durable_end(file, file_bytes)?, |turn| {
        if turn.id == anchor_id {
            found = turn.end_offset != 0;
            return false;
        }
        if turn.end_offset != 0 && limit > 0 {
            if newer.len() == limit {
                newer.pop_front();
            }
            newer.push_back(turn);
        }
        true
    })?;
    Ok(found.then(|| newer.into_iter().rev().collect()))
}

/// Recovers a descending page strictly before a surviving semantic anchor.
pub(crate) fn scan_turns_before_from_file(
    file: &File,
    file_bytes: u64,
    anchor_id: &str,
    limit: usize,
) -> Result<Option<Vec<TurnRef>>, IndexError> {
    let mut found = false;
    let mut turns = Vec::with_capacity(limit);
    visit_logical_turns_reverse(file, durable_end(file, file_bytes)?, |turn| {
        if turn.id == anchor_id {
            found = turn.end_offset != 0;
            return found && limit > 0;
        }
        if found && turn.end_offset != 0 {
            turns.push(turn);
        }
        !found || turns.len() < limit
    })?;
    Ok(found.then_some(turns))
}

fn collect_rollback_removals(
    file: &File,
    offset: u64,
    boundary: Option<&TaskBoundary>,
    removed: &mut Vec<u64>,
) -> Result<(), IndexError> {
    let Some(TaskBoundary::Rollback(count)) = boundary else {
        return Ok(());
    };
    let mut remaining = *count;
    if remaining == 0 {
        return Ok(());
    }
    visit_logical_turns_reverse(file, offset, |turn| {
        removed.push(turn.start_offset);
        remaining -= 1;
        remaining > 0
    })?;
    Ok(())
}

fn visit_logical_turns_reverse(
    file: &File,
    durable_bytes: u64,
    mut visit: impl FnMut(TurnRef) -> bool,
) -> Result<u64, IndexError> {
    let mut skipped = 0_u64;
    let mut next_start = 0;
    let mut terminal: Option<(String, u64, bool)> = None;
    visit_task_boundaries_reverse(file, durable_bytes, 0, |offset, end, boundary| {
        match boundary {
            TaskBoundary::Rollback(count) => {
                skipped = skipped.saturating_add(count);
            }
            TaskBoundary::Terminal { turn_id, completed } => {
                terminal = Some((turn_id, end, completed));
            }
            TaskBoundary::Started(id) => {
                let (end_offset, completed) = terminal
                    .take()
                    .filter(|(turn_id, _, _)| turn_id == &id)
                    .map_or((next_start, false), |(_, end, completed)| (end, completed));
                next_start = offset;
                if skipped > 0 {
                    skipped -= 1;
                } else if !visit(TurnRef {
                    id,
                    start_offset: offset,
                    end_offset,
                    completed,
                }) {
                    return false;
                }
            }
        }
        true
    })
}

#[cfg(unix)]
fn file_identity(metadata: &std::fs::Metadata) -> (u64, u64) {
    (metadata.dev(), metadata.ino())
}

#[cfg(not(unix))]
fn file_identity(_metadata: &std::fs::Metadata) -> (u64, u64) {
    (0, 0)
}

#[cfg(unix)]
fn tail_hash(file: &File, indexed_bytes: u64) -> Result<[u8; 32], std::io::Error> {
    if indexed_bytes == 0 {
        return Ok([0; 32]);
    }
    let bytes = TAIL_CHECK_BYTES.min(indexed_bytes);
    let start = indexed_bytes - bytes;
    let size = usize::try_from(bytes).map_err(std::io::Error::other)?;
    let mut buffer = vec![0_u8; size];
    let mut read = 0;
    while read < buffer.len() {
        let count = file.read_at(&mut buffer[read..], start + read as u64)?;
        if count == 0 {
            return Err(std::io::Error::from(std::io::ErrorKind::UnexpectedEof));
        }
        read += count;
    }
    Ok(*blake3::hash(&buffer).as_bytes())
}

#[cfg(not(unix))]
fn tail_hash(file: &File, indexed_bytes: u64) -> Result<[u8; 32], std::io::Error> {
    use std::io::Read;

    if indexed_bytes == 0 {
        return Ok([0; 32]);
    }
    let bytes = TAIL_CHECK_BYTES.min(indexed_bytes);
    let start = indexed_bytes - bytes;
    let size = usize::try_from(bytes).map_err(std::io::Error::other)?;
    let mut cloned = file.try_clone()?;
    cloned.seek(SeekFrom::Start(start))?;
    let mut buffer = vec![0_u8; size];
    cloned.read_exact(&mut buffer)?;
    Ok(*blake3::hash(&buffer).as_bytes())
}

fn record_key(file_id: &[u8; 32], sequence: u64) -> Vec<u8> {
    let mut key = Vec::with_capacity(40);
    key.extend_from_slice(file_id);
    key.extend_from_slice(&sequence.to_be_bytes());
    key
}

fn source_record(offset: u64, bytes: usize, line: &[u8]) -> Result<RecordRef, IndexError> {
    Ok(RecordRef {
        offset,
        length: u32::try_from(bytes).map_err(|_| IndexError::RecordTooLarge(offset))?,
        record_type: classify_record(line),
    })
}

fn indexed_record(file_id: &[u8; 32], record: RecordRef) -> (Vec<u8>, Vec<u8>) {
    (
        record_key(file_id, record.offset),
        record_value(record.offset, record.length, record.record_type),
    )
}

fn index_content(
    content: &mut Vec<RolloutContentEntry>,
    path: &Path,
    file_id: [u8; 32],
    record: RecordRef,
    line: &[u8],
) {
    content.extend(rollout_content::entries_from_record(
        path, file_id, record, line,
    ));
}

fn pending_rollout_batch<'a>(
    records: &'a [(Vec<u8>, Vec<u8>)],
    turns: &'a [TurnRef],
    turn_summaries: &'a [(u64, Vec<u8>)],
    removed_turns: &'a [u64],
    content: &'a [RolloutContentEntry],
) -> RolloutBatch<'a> {
    RolloutBatch {
        records,
        turns,
        turn_summaries,
        removed_turns,
        content,
    }
}

fn record_value(offset: u64, length: u32, record_type: u8) -> Vec<u8> {
    let mut value = Vec::with_capacity(13);
    value.extend_from_slice(&offset.to_be_bytes());
    value.extend_from_slice(&length.to_be_bytes());
    value.push(record_type);
    value
}

fn classify_record(line: &[u8]) -> u8 {
    const TYPES: [(&[u8], u8); 5] = [
        (b"\"type\":\"session_meta\"", 1),
        (b"\"type\":\"turn_context\"", 2),
        (b"\"type\":\"event_msg\"", 3),
        (b"\"type\":\"response_item\"", 4),
        (b"\"type\":\"compacted\"", 5),
    ];
    let prefix = &line[..line.len().min(8 * 1024)];
    TYPES
        .iter()
        .find_map(|(needle, tag)| memchr::memmem::find(prefix, needle).map(|_| *tag))
        .unwrap_or(0)
}

#[derive(Debug)]
enum TaskBoundary {
    Started(String),
    Terminal { turn_id: String, completed: bool },
    Rollback(u64),
}

#[derive(Deserialize)]
struct BoundaryEnvelope {
    payload: BoundaryPayload,
}

#[derive(Deserialize)]
#[serde(tag = "type")]
enum BoundaryPayload {
    #[serde(rename = "task_started")]
    Started { turn_id: String },
    #[serde(rename = "task_complete")]
    Completed { turn_id: String },
    #[serde(rename = "turn_aborted")]
    Aborted { turn_id: String },
    #[serde(rename = "thread_rolled_back")]
    Rollback { num_turns: u64 },
    #[serde(other)]
    Other,
}

fn task_boundary(line: &[u8], offset: u64) -> Result<Option<TaskBoundary>, IndexError> {
    if !TASK_BOUNDARY_NEEDLES
        .iter()
        .any(|needle| memchr::memmem::find(line, needle).is_some())
    {
        return Ok(None);
    }
    let parsed: BoundaryEnvelope = serde_json::from_slice(line)
        .map_err(|source| IndexError::InvalidTaskBoundary { offset, source })?;
    match parsed.payload {
        BoundaryPayload::Started { turn_id } => Ok(Some(TaskBoundary::Started(turn_id))),
        BoundaryPayload::Completed { turn_id } => Ok(Some(TaskBoundary::Terminal {
            turn_id,
            completed: true,
        })),
        BoundaryPayload::Aborted { turn_id } => Ok(Some(TaskBoundary::Terminal {
            turn_id,
            completed: false,
        })),
        BoundaryPayload::Rollback { num_turns } => Ok(Some(TaskBoundary::Rollback(num_turns))),
        BoundaryPayload::Other => Ok(None),
    }
}

fn durable_end(file: &File, file_bytes: u64) -> Result<u64, std::io::Error> {
    if file_bytes == 0 {
        return Ok(0);
    }
    let mut position = file_bytes;
    let mut buffer = vec![0_u8; bounded_usize(file_bytes, REVERSE_SCAN_BLOCK_BYTES)];
    while position > 0 {
        let read_size = bounded_usize(position, buffer.len());
        let start = position - read_size as u64;
        read_exact_at(file, &mut buffer[..read_size], start)?;
        if let Some(index) = memchr::memrchr(b'\n', &buffer[..read_size]) {
            return Ok(start + index as u64 + 1);
        }
        position = start;
    }
    Ok(0)
}

fn visit_task_boundaries_reverse(
    file: &File,
    search_end: u64,
    stop_offset: u64,
    mut visit: impl FnMut(u64, u64, TaskBoundary) -> bool,
) -> Result<u64, IndexError> {
    let overlap = TASK_BOUNDARY_NEEDLES
        .iter()
        .map(|needle| needle.len())
        .max()
        .unwrap_or(0)
        .saturating_sub(1) as u64;
    let mut position = search_end;
    let mut bytes_scanned = 0_u64;
    while position > stop_offset {
        let core_start = position
            .saturating_sub(REVERSE_SCAN_BLOCK_BYTES as u64)
            .max(stop_offset);
        let read_end = search_end.min(position.saturating_add(overlap));
        let read_size = usize::try_from(read_end - core_start).map_err(std::io::Error::other)?;
        let mut buffer = vec![0_u8; read_size];
        read_exact_at(file, &mut buffer, core_start)?;
        bytes_scanned = bytes_scanned.saturating_add(position - core_start);
        let mut block_matches: Vec<u64> = TASK_BOUNDARY_NEEDLES
            .iter()
            .flat_map(|needle| memchr::memmem::find_iter(&buffer, needle))
            .map(|index| core_start + index as u64)
            .filter(|offset| *offset >= core_start && *offset < position)
            .collect();
        block_matches.sort_unstable_by(|left, right| right.cmp(left));
        for offset in block_matches {
            let (line_start, line) = read_line_at(file, offset, search_end)?;
            if line_start < stop_offset {
                continue;
            }
            if let Some(boundary) = task_boundary(&line, line_start)?
                && !visit(line_start, line_start + line.len() as u64, boundary)
            {
                return Ok(bytes_scanned);
            }
        }
        position = core_start;
    }
    Ok(bytes_scanned)
}

fn read_line_at(
    file: &File,
    inside_offset: u64,
    durable_bytes: u64,
) -> Result<(u64, Vec<u8>), std::io::Error> {
    let line_start = find_line_start(file, inside_offset)?;
    let line_end = find_line_end(file, inside_offset, durable_bytes)?;
    let length = usize::try_from(line_end - line_start).map_err(std::io::Error::other)?;
    let mut line = vec![0_u8; length];
    read_exact_at(file, &mut line, line_start)?;
    Ok((line_start, line))
}

fn find_line_start(file: &File, inside_offset: u64) -> Result<u64, std::io::Error> {
    let mut position = inside_offset;
    let mut buffer = vec![0_u8; 64 * 1024];
    while position > 0 {
        let read_size = bounded_usize(position, buffer.len());
        let start = position - read_size as u64;
        read_exact_at(file, &mut buffer[..read_size], start)?;
        if let Some(index) = memchr::memrchr(b'\n', &buffer[..read_size]) {
            return Ok(start + index as u64 + 1);
        }
        position = start;
    }
    Ok(0)
}

fn find_line_end(
    file: &File,
    inside_offset: u64,
    durable_bytes: u64,
) -> Result<u64, std::io::Error> {
    let mut position = inside_offset;
    let mut buffer = vec![0_u8; 64 * 1024];
    while position < durable_bytes {
        let read_size = bounded_usize(durable_bytes - position, buffer.len());
        read_exact_at(file, &mut buffer[..read_size], position)?;
        if let Some(index) = memchr::memchr(b'\n', &buffer[..read_size]) {
            return Ok(position + index as u64 + 1);
        }
        position += read_size as u64;
    }
    Ok(durable_bytes)
}

fn bounded_usize(value: u64, upper_bound: usize) -> usize {
    usize::try_from(value).map_or(upper_bound, |converted| converted.min(upper_bound))
}

#[cfg(unix)]
fn read_exact_at(file: &File, buffer: &mut [u8], offset: u64) -> Result<(), std::io::Error> {
    let mut read = 0;
    while read < buffer.len() {
        let count = file.read_at(&mut buffer[read..], offset + read as u64)?;
        if count == 0 {
            return Err(std::io::Error::from(std::io::ErrorKind::UnexpectedEof));
        }
        read += count;
    }
    Ok(())
}

#[cfg(not(unix))]
fn read_exact_at(file: &File, buffer: &mut [u8], offset: u64) -> Result<(), std::io::Error> {
    let mut cloned = file.try_clone()?;
    cloned.seek(SeekFrom::Start(offset))?;
    cloned.read_exact(buffer)
}

#[cfg(test)]
mod tests {
    use std::io::Write;

    use super::{
        TaskBoundary, classify_record, current_indexed_turns_from_file, index_rollout,
        index_rollout_metadata, index_rollout_through_anchor, rollout_file_id,
        rollout_witness_from_file, rollout_witness_matches, scan_turns_after_from_file,
        scan_turns_before_from_file, task_boundary,
    };
    use crate::store::IndexStore;

    #[test]
    fn classifies_known_rollout_records() {
        assert_eq!(classify_record(br#"{"type":"turn_context"}\n"#), 2);
        assert_eq!(classify_record(br#"{"type":"response_item"}\n"#), 4);
        assert_eq!(classify_record(br#"{"type":"future_record"}\n"#), 0);
    }

    #[test]
    fn reads_task_boundaries_without_parsing_other_records()
    -> Result<(), Box<dyn std::error::Error>> {
        let started = br#"{"timestamp":"now","type":"event_msg","payload":{"type":"task_started","turn_id":"turn-1"}}"#;
        let completed = br#"{"timestamp":"now","type":"event_msg","payload":{"type":"task_complete","turn_id":"turn-1"}}"#;
        assert!(matches!(
            task_boundary(started, 0)?,
            Some(TaskBoundary::Started(id)) if id == "turn-1"
        ));
        assert!(matches!(
            task_boundary(completed, 0)?,
            Some(TaskBoundary::Terminal { turn_id, completed: true }) if turn_id == "turn-1"
        ));
        let aborted = br#"{"timestamp":"now","type":"event_msg","payload":{"type":"turn_aborted","turn_id":"turn-2"}}"#;
        assert!(matches!(
            task_boundary(aborted, 0)?,
            Some(TaskBoundary::Terminal { turn_id, completed: false }) if turn_id == "turn-2"
        ));
        Ok(())
    }

    #[test]
    fn indexed_page_preserves_mutable_head_only_at_current_checkpoint()
    -> Result<(), Box<dyn std::error::Error>> {
        let directory = tempfile::tempdir()?;
        let path = directory.path().join("rollout.jsonl");
        let mut writer = std::fs::File::create(&path)?;
        writeln!(
            writer,
            r#"{{"type":"event_msg","payload":{{"type":"task_started","turn_id":"turn-live"}}}}"#
        )?;
        writer.sync_all()?;
        let store = IndexStore::open(directory.path().join("index.redb"))?;
        index_rollout(&store, &path)?;

        let file = std::fs::File::open(&path)?;
        let file_bytes = file.metadata()?.len();
        let page = current_indexed_turns_from_file(&store, &path, &file, file_bytes, None, 1)?
            .ok_or("current index was not used")?;
        assert_eq!(page.turns.len(), 1);
        assert_eq!(page.turns[0].end_offset, 0);
        assert!(!page.turns[0].completed);

        writeln!(
            writer,
            r#"{{"type":"event_msg","payload":{{"type":"agent_message","message":"new"}}}}"#
        )?;
        writer.sync_all()?;
        let file = std::fs::File::open(&path)?;
        let file_bytes = file.metadata()?.len();
        assert!(
            current_indexed_turns_from_file(&store, &path, &file, file_bytes, None, 1)?.is_none()
        );
        Ok(())
    }

    #[test]
    fn cold_semantic_pages_preserve_nearest_neighbors_and_exclude_rollback()
    -> Result<(), Box<dyn std::error::Error>> {
        let directory = tempfile::tempdir()?;
        let path = directory.path().join("rollout.jsonl");
        let mut writer = std::fs::File::create(&path)?;
        for id in ["a", "removed"] {
            writeln!(
                writer,
                r#"{{"type":"event_msg","payload":{{"type":"task_started","turn_id":"{id}"}}}}"#
            )?;
            writeln!(
                writer,
                r#"{{"type":"event_msg","payload":{{"type":"task_complete","turn_id":"{id}"}}}}"#
            )?;
        }
        writeln!(
            writer,
            r#"{{"type":"event_msg","payload":{{"type":"thread_rolled_back","num_turns":1}}}}"#
        )?;
        for id in ["b", "c", "d", "e"] {
            writeln!(
                writer,
                r#"{{"type":"event_msg","payload":{{"type":"task_started","turn_id":"{id}"}}}}"#
            )?;
            writeln!(
                writer,
                r#"{{"type":"event_msg","payload":{{"type":"task_complete","turn_id":"{id}"}}}}"#
            )?;
        }
        writer.sync_all()?;
        let file = std::fs::File::open(&path)?;
        let bytes = file.metadata()?.len();
        let after = scan_turns_after_from_file(&file, bytes, "a", 2)?.ok_or("anchor missing")?;
        assert_eq!(
            after
                .iter()
                .map(|turn| turn.id.as_str())
                .collect::<Vec<_>>(),
            ["b", "c"]
        );
        let before = scan_turns_before_from_file(&file, bytes, "d", 2)?.ok_or("anchor missing")?;
        assert_eq!(
            before
                .iter()
                .map(|turn| turn.id.as_str())
                .collect::<Vec<_>>(),
            ["c", "b"]
        );
        assert!(scan_turns_after_from_file(&file, bytes, "removed", 2)?.is_none());
        assert!(
            scan_turns_after_from_file(&file, bytes, "e", 2)?
                .ok_or("head missing")?
                .is_empty()
        );
        Ok(())
    }

    #[test]
    fn source_witness_survives_append_but_expires_on_rollback()
    -> Result<(), Box<dyn std::error::Error>> {
        let directory = tempfile::tempdir()?;
        let path = directory.path().join("rollout.jsonl");
        let mut writer = std::fs::File::create(&path)?;
        writeln!(
            writer,
            r#"{{"type":"event_msg","payload":{{"type":"task_started","turn_id":"a"}}}}"#
        )?;
        writeln!(
            writer,
            r#"{{"type":"event_msg","payload":{{"type":"task_complete","turn_id":"a"}}}}"#
        )?;
        writer.sync_all()?;
        let file = std::fs::File::open(&path)?;
        let witness = rollout_witness_from_file(&file, file.metadata()?.len())?;
        write!(writer, r#"{{"type":"turn_context","payload":{{}}}}"#)?;
        writer.sync_all()?;
        assert!(rollout_witness_matches(
            &file,
            file.metadata()?.len(),
            &witness
        )?);
        writeln!(writer)?;
        writeln!(
            writer,
            r#"{{"type":"event_msg","payload":{{"type":"task_started","turn_id":"b"}}}}"#
        )?;
        writer.sync_all()?;
        assert!(rollout_witness_matches(
            &file,
            file.metadata()?.len(),
            &witness
        )?);
        writeln!(
            writer,
            r#"{{"type":"event_msg","payload":{{"type":"thread_rolled_back","num_turns":1}}}}"#
        )?;
        writer.sync_all()?;
        assert!(!rollout_witness_matches(
            &file,
            file.metadata()?.len(),
            &witness
        )?);
        Ok(())
    }

    #[test]
    fn semantic_anchor_recovery_persists_coverage_and_proven_absence()
    -> Result<(), Box<dyn std::error::Error>> {
        let directory = tempfile::tempdir()?;
        let path = directory.path().join("rollout.jsonl");
        let mut writer = std::fs::File::create(&path)?;
        writeln!(
            writer,
            "{{\"type\":\"compacted\",\"payload\":{{\"padding\":\"{}\"}}}}",
            "x".repeat(9 * 1024 * 1024)
        )?;
        for id in ["a", "b", "c", "d"] {
            writeln!(
                writer,
                r#"{{"type":"event_msg","payload":{{"type":"task_started","turn_id":"{id}"}}}}"#
            )?;
            writeln!(
                writer,
                r#"{{"type":"event_msg","payload":{{"type":"task_complete","turn_id":"{id}"}}}}"#
            )?;
        }
        writer.sync_all()?;
        let store = IndexStore::open(directory.path().join("index.redb"))?;
        let cold = index_rollout(&store, &path)?;
        let recovered = index_rollout_through_anchor(&store, &path, "b", 1)?;
        assert!(recovered.coverage_start < cold.coverage_start);
        let turns = store.turns_desc(&rollout_file_id(&path), None, 10)?;
        assert_eq!(
            turns
                .iter()
                .map(|turn| turn.id.as_str())
                .collect::<Vec<_>>(),
            ["d", "c", "b", "a"]
        );
        assert_eq!(
            index_rollout_through_anchor(&store, &path, "b", 1)?.indexed_records,
            0
        );
        assert!(index_rollout_through_anchor(&store, &path, "missing", 0)?.complete);
        assert_eq!(
            index_rollout_through_anchor(&store, &path, "missing", 0)?.indexed_records,
            0
        );
        Ok(())
    }

    #[test]
    fn session_headers_build_the_parent_descendant_index() -> Result<(), Box<dyn std::error::Error>>
    {
        let directory = tempfile::tempdir()?;
        let sessions = directory.path().join("sessions");
        std::fs::create_dir_all(&sessions)?;
        let root = sessions.join("rollout-root.jsonl");
        let child = sessions.join("rollout-child.jsonl");
        let grandchild = sessions.join("rollout-grandchild.jsonl");
        std::fs::write(
            &root,
            b"{\"type\":\"session_meta\",\"payload\":{\"id\":\"root\",\"cwd\":\"/repo\",\"source\":\"cli\"}}\n",
        )?;
        std::fs::write(
            &child,
            b"{\"type\":\"session_meta\",\"payload\":{\"id\":\"child\",\"cwd\":\"/repo\",\"source\":{\"subagent\":{\"thread_spawn\":{\"parent_thread_id\":\"root\",\"agent_nickname\":\"Worker\",\"agent_role\":\"worker\"}}}}}\n",
        )?;
        std::fs::write(
            &grandchild,
            b"{\"type\":\"session_meta\",\"payload\":{\"id\":\"grandchild\",\"cwd\":\"/repo\",\"source\":{\"subagent\":{\"thread_spawn\":{\"parent_thread_id\":\"child\"}}}}}\n",
        )?;
        let store = IndexStore::open(directory.path().join("index.redb"))?;
        for path in [&root, &child, &grandchild] {
            index_rollout_metadata(&store, path)?;
        }

        let descendants = store.thread_descendants("root")?;
        assert_eq!(
            descendants
                .iter()
                .map(|metadata| metadata.id.as_str())
                .collect::<Vec<_>>(),
            vec!["child", "grandchild"]
        );
        assert_eq!(descendants[0].agent_nickname.as_deref(), Some("Worker"));
        Ok(())
    }
}
