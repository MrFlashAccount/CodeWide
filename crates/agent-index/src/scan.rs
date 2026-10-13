//! The index scans: the forward loop that advances a file's checkpoint, the
//! cold tail bootstrap of a large file, prefix backfill, anchor recovery and
//! the reverse boundary visitors that find turns without an index. All of
//! them are generic over the provider's [`IndexSource`], which knows the
//! record format; this module knows only lines, offsets and turns.

use std::{
    fs::File,
    io::{BufRead, BufReader, Read},
    path::Path,
    time::Instant,
};

use companion_host::{index::StoreError, thread_index::IndexedThreadMetadata};
use serde::{Serialize, de::DeserializeOwned};

use crate::{
    file::{
        FileWitness, REVERSE_SCAN_BLOCK_BYTES, durable_end, file_id, file_identity, modified_nanos,
        modified_seconds, read_exact_at, read_line_at, seek_to, tail_hash,
    },
    store::{
        ContentEntry, FileState, IndexBatch, IndexStore, RecordRef, TurnRef, offset_key,
        record_value,
    },
};

const WRITE_BATCH_RECORDS: usize = 4_096;
const TAIL_BOOTSTRAP_FULL_SCAN_BYTES: u64 = 8 * 1024 * 1024;
const TAIL_BOOTSTRAP_TURNS: usize = 1;
const PREFIX_BACKFILL_TURNS: usize = 1;

/// A turn's materialized projection, advanced one record at a time while the
/// scan runs and persisted with the turn; later reads finish from it instead
/// of re-reading the turn's bytes.
pub trait SummaryProjection: Serialize + DeserializeOwned {
    /// Folds one record into the projection. A malformed record is the
    /// provider's to tolerate; the scan ignores the error and continues.
    ///
    /// # Errors
    ///
    /// Returns the provider's reason the record could not be folded.
    fn ingest(
        &mut self,
        line: &[u8],
        offset: u64,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>>;

    /// Whether a persisted projection was written by the current projector.
    fn is_current(&self) -> bool;
}

/// What a record means for turn ranges.
#[derive(Debug)]
pub enum Boundary {
    /// A turn starts with this record.
    Started(String),
    /// The turn `turn_id` ends after this record.
    Terminal { turn_id: String, completed: bool },
    /// The newest `n` turns before this record are removed.
    Rollback(u64),
}

/// A provider's record format, as far as the index needs to know it.
pub trait IndexSource: Send + Sync {
    type Summary: SummaryProjection;

    /// The byte tag kept with a record's offset; 0 for an unknown record.
    fn classify(&self, line: &[u8]) -> u8;

    /// Byte needles every boundary record contains; a line without one is
    /// never parsed as a boundary.
    fn boundary_needles(&self) -> &[&[u8]];

    /// The boundary a record carries, if any.
    ///
    /// # Errors
    ///
    /// Returns the parse error of a record that carries a needle but no
    /// readable boundary.
    fn boundary(&self, line: &[u8], offset: u64) -> Result<Option<Boundary>, serde_json::Error>;

    /// Needle of records that are complete turns by themselves (outside any
    /// started turn); `None` when the format has none.
    fn standalone_needle(&self) -> Option<&[u8]> {
        None
    }

    /// The turn id of a standalone record, when `line` is one.
    fn standalone_turn(&self, line: &[u8]) -> Option<String> {
        let _ = line;
        None
    }

    /// The companion thread metadata a record publishes (a session header).
    fn thread_metadata(
        &self,
        path: &Path,
        modified_at: i64,
        line: &[u8],
    ) -> Option<IndexedThreadMetadata> {
        let _ = (path, modified_at, line);
        None
    }

    /// Content pieces proven to lie in `record`, keyed by digest.
    fn content(
        &self,
        path: &Path,
        file_id: [u8; 32],
        record: RecordRef,
        line: &[u8],
    ) -> Vec<ContentEntry> {
        let _ = (path, file_id, record, line);
        Vec::new()
    }

    /// A fresh projection of the turn `turn_id`.
    fn summary(&self, turn_id: String) -> Self::Summary;
}

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

impl From<TurnRefReport> for TurnRef {
    fn from(turn: TurnRefReport) -> Self {
        Self {
            id: turn.id,
            start_offset: turn.start_offset,
            end_offset: turn.end_offset,
            completed: turn.completed,
        }
    }
}

/// A page of indexed turns read against a validated checkpoint.
#[derive(Debug)]
pub struct IndexedTurnPage {
    pub turns: Vec<TurnRef>,
    pub has_more: bool,
}

#[derive(Debug, thiserror::Error)]
pub enum IndexError {
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Store(#[from] StoreError),
    #[error("turn summary projection failed: {0}")]
    Summary(#[source] Box<dyn std::error::Error + Send + Sync>),
    #[error("file contains a record larger than 4 GiB at byte {0}")]
    RecordTooLarge(u64),
    #[error("invalid turn boundary at byte {offset}: {source}")]
    InvalidBoundary {
        offset: u64,
        source: serde_json::Error,
    },
}

type ActiveSummary<S> = (u64, String, S);
type ActiveProjection<S> = (Option<TurnRef>, Option<ActiveSummary<S>>);

/// The rows one scan step accumulated and will commit together.
struct Pending {
    records: Vec<(Vec<u8>, Vec<u8>)>,
    turns: Vec<TurnRef>,
    summaries: Vec<(u64, Vec<u8>)>,
    removed_turns: Vec<u64>,
    content: Vec<ContentEntry>,
}

impl Pending {
    fn new() -> Self {
        Self {
            records: Vec::with_capacity(WRITE_BATCH_RECORDS),
            turns: Vec::new(),
            summaries: Vec::new(),
            removed_turns: Vec::new(),
            content: Vec::new(),
        }
    }

    fn full(&self) -> bool {
        self.records.len() == WRITE_BATCH_RECORDS
    }

    /// Commits everything with `state` as the file's checkpoint, then starts
    /// the next batch.
    fn commit(
        &mut self,
        store: &IndexStore,
        id: &[u8; 32],
        state: FileState,
    ) -> Result<(), StoreError> {
        store.commit_index_batch(
            id,
            IndexBatch {
                records: &self.records,
                turns: &self.turns,
                turn_summaries: &self.summaries,
                removed_turns: &self.removed_turns,
                content: &self.content,
            },
            state,
        )?;
        self.records.clear();
        self.turns.clear();
        self.summaries.clear();
        self.removed_turns.clear();
        self.content.clear();
        Ok(())
    }
}

/// Advances the contiguous hot index for `path`.
///
/// A cold large file is bootstrapped from its newest turns so head reads do
/// not wait for the complete historical prefix. Existing indexes and appended
/// records continue forward from their durable checkpoint.
///
/// # Errors
///
/// Returns an error when the file cannot be read, an individual record is
/// larger than the index format supports, or the crash-safe store cannot
/// commit a batch.
#[allow(clippy::too_many_lines)] // One crash-safe transaction state machine is easier to audit whole.
pub fn index_file<S: IndexSource>(
    store: &IndexStore,
    source: &S,
    path: &Path,
) -> Result<IndexReport, IndexError> {
    let started = Instant::now();
    let id = file_id(path);
    let file = File::open(path)?;
    let metadata = file.metadata()?;
    let file_bytes = metadata.len();
    let durable_bytes = durable_end(&file, file_bytes)?;
    let (device, inode) = file_identity(&metadata);
    if let Some(state) = store.file_state(&id)?
        && file_state_matches(&file, state, device, inode, durable_bytes)?
        && state.indexed_bytes == durable_bytes
    {
        return finish_index_report(store, &id, started, file_bytes, 0, state);
    }

    let index_lock = store.index_lock(id);
    let _index_guard = index_lock
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    let file = File::open(path)?;
    let metadata = file.metadata()?;
    let file_bytes = metadata.len();
    let durable_bytes = durable_end(&file, file_bytes)?;
    let (device, inode) = file_identity(&metadata);
    let persisted = store.file_state(&id)?;
    let mut checkpoint_dirty = false;
    let mut state = match persisted {
        Some(candidate) if file_state_matches(&file, candidate, device, inode, durable_bytes)? => {
            candidate
        }
        Some(_) => {
            store.reset_file(&id)?;
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
            store.commit_batch(&id, &[], &[], &[], state)?;
        }
        return finish_index_report(store, &id, started, file_bytes, 0, state);
    }
    if state.indexed_bytes == 0 && state.records == 0 && durable_bytes > 0 {
        let indexed_from = tail_bootstrap_start(source, &file, file_bytes, durable_bytes)?;
        state = FileState::tail(device, inode, indexed_from);
        checkpoint_dirty = true;
    }
    state.modified_nanos = modified_nanos(&metadata);
    let mut reader = BufReader::with_capacity(1024 * 1024, file);
    seek_to(reader.get_mut(), state.indexed_bytes)?;
    let mut offset = state.indexed_bytes;
    let mut sequence = state.records;
    let initial_records = state.records;
    let mut line = Vec::new();
    let mut pending = Pending::new();
    let (mut active_turn, mut active_summary) =
        active_projection(store, source, &id, reader.get_ref(), state.indexed_bytes)?;
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
        let record = source_record(source, offset, bytes, &line)?;
        let length = record.length;
        if let Some(metadata) = source.thread_metadata(path, modified_at, &line) {
            store.threads().put_thread_metadata(&metadata)?;
        }
        pending.records.push(indexed_record(&id, record));
        pending
            .content
            .extend(source.content(path, id, record, &line));
        let boundary = boundary_of(source, &line, offset)?;
        collect_rollback_removals(
            source,
            reader.get_ref(),
            offset,
            boundary.as_ref(),
            &mut pending.removed_turns,
        )?;
        update_summary_index(
            source,
            boundary.as_ref(),
            offset,
            &line,
            &mut active_summary,
            &mut pending.summaries,
        )?;
        update_turn_indexes(
            source,
            boundary.as_ref(),
            &line,
            offset,
            length,
            &mut active_turn,
            &mut pending,
        )?;
        sequence += 1;
        offset += u64::from(length);
        if pending.full() {
            state.indexed_bytes = offset;
            state.records = sequence;
            state.tail_hash = tail_hash(reader.get_ref(), offset)?;
            remember_active_summary(active_summary.as_ref(), &mut pending.summaries)?;
            pending.commit(store, &id, state)?;
        }
    }
    if !pending.records.is_empty() || checkpoint_dirty {
        state.indexed_bytes = offset;
        state.records = sequence;
        state.tail_hash = tail_hash(reader.get_ref(), offset)?;
        remember_active_summary(active_summary.as_ref(), &mut pending.summaries)?;
        pending.commit(store, &id, state)?;
    }

    let indexed_records = sequence - initial_records;
    finish_index_report(store, &id, started, file_bytes, indexed_records, state)
}

fn finish_index_report(
    store: &IndexStore,
    id: &[u8; 32],
    started: Instant,
    file_bytes: u64,
    indexed_records: u64,
    state: FileState,
) -> Result<IndexReport, IndexError> {
    let elapsed_ms = started.elapsed().as_millis();
    let persisted = store.file_state(id)?.unwrap_or(state);
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
/// Returns an error when the file changes incompatibly, a record boundary is
/// malformed, or the durable index transaction fails.
pub fn backfill_prefix<S: IndexSource>(
    store: &IndexStore,
    source: &S,
    path: &Path,
) -> Result<IndexReport, IndexError> {
    let started = Instant::now();
    let hot = index_file(store, source, path)?;
    if hot.complete {
        return Ok(hot);
    }

    let id = file_id(path);
    let index_lock = store.index_lock(id);
    let index_guard = index_lock
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    let file = File::open(path)?;
    let metadata = file.metadata()?;
    let file_bytes = metadata.len();
    let durable_bytes = durable_end(&file, file_bytes)?;
    let (device, inode) = file_identity(&metadata);
    let Some(mut state) = store.file_state(&id)? else {
        return Err(StoreError::CorruptedIndex("file checkpoint is missing".into()).into());
    };
    if !file_state_matches(&file, state, device, inode, durable_bytes)?
        || state.indexed_bytes != durable_bytes
    {
        // The writer appended, truncated, or atomically replaced the file
        // between the hot advance and this backfill step. Release the lane and
        // let the normal forward path reconcile it before trying older bytes.
        drop(index_guard);
        return index_file(store, source, path);
    }
    if state.is_complete() {
        return finish_index_report(store, &id, started, file_bytes, 0, state);
    }

    let previous_from = state.indexed_from;
    // Backfill replays rollback records atomically with their tombstones, so
    // discovery needs only the adjacent physical range, not the whole tail.
    let mut indexed_from = 0;
    let mut remaining = PREFIX_BACKFILL_TURNS;
    visit_boundaries_reverse(source, &file, previous_from, 0, |offset, _, boundary| {
        if matches!(boundary, Boundary::Started(_)) {
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
        source,
        path,
        &file,
        &metadata,
        &id,
        &mut state,
        indexed_from,
        previous_from,
    )?;
    finish_index_report(store, &id, started, file_bytes, indexed_records, state)
}

/// Advances durable coverage through a semantic anchor and its requested older
/// neighbors. The index lane coalesces concurrent recovery; proven absence
/// completes coverage so later misses never repeat a full source scan.
///
/// # Errors
///
/// Returns an error when the file cannot be read or the index transaction
/// fails.
pub fn index_through_anchor<S: IndexSource>(
    store: &IndexStore,
    source: &S,
    path: &Path,
    anchor_id: &str,
    older_limit: usize,
) -> Result<IndexReport, IndexError> {
    let started = Instant::now();
    let hot = index_file(store, source, path)?;
    if hot.complete {
        return Ok(hot);
    }
    let id = file_id(path);
    let lane = store.index_lock(id);
    let guard = lane
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    let file = File::open(path)?;
    let metadata = file.metadata()?;
    let file_bytes = metadata.len();
    let Some(mut state) = current_indexed_coverage_from_file(store, path, &file, file_bytes)?
    else {
        drop(guard);
        return index_file(store, source, path);
    };
    if state.is_complete() {
        return finish_index_report(store, &id, started, file_bytes, 0, state);
    }
    if let Some(anchor) = store.turn_by_id(&id, anchor_id)?
        && anchor.start_offset >= state.indexed_from
    {
        let older = store.turns_desc(&id, Some(anchor.start_offset), older_limit)?;
        if older.len() == older_limit
            && older
                .iter()
                .all(|turn| turn.start_offset >= state.indexed_from)
        {
            return finish_index_report(store, &id, started, file_bytes, 0, state);
        }
    }
    let mut found = false;
    let mut remaining = older_limit;
    let mut indexed_from = 0;
    visit_logical_turns_reverse(source, &file, state.indexed_bytes, FileEnd::Live, |turn| {
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
        return finish_index_report(store, &id, started, file_bytes, 0, state);
    }
    let indexed_records = index_prefix_range(
        store,
        source,
        path,
        &file,
        &metadata,
        &id,
        &mut state,
        indexed_from,
        previous_from,
    )?;
    finish_index_report(store, &id, started, file_bytes, indexed_records, state)
}

/// Completes the historical prefix for consumers that require every source
/// record, such as attachment and changed-file projections.
///
/// # Errors
///
/// Returns an error when tail advancement or any bounded prefix step fails.
pub fn index_fully<S: IndexSource>(
    store: &IndexStore,
    source: &S,
    path: &Path,
) -> Result<IndexReport, IndexError> {
    let started = Instant::now();
    let mut report = index_file(store, source, path)?;
    let mut indexed_records = report.indexed_records;
    while !report.complete {
        report = backfill_prefix(store, source, path)?;
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

fn tail_bootstrap_start<S: IndexSource>(
    source: &S,
    file: &File,
    file_bytes: u64,
    durable_bytes: u64,
) -> Result<u64, IndexError> {
    if durable_bytes <= TAIL_BOOTSTRAP_FULL_SCAN_BYTES {
        return Ok(0);
    }
    let scan = scan_tail_turns_from_file(source, file, file_bytes, None, TAIL_BOOTSTRAP_TURNS)?;
    Ok(scan
        .turns
        .last()
        .map_or(durable_bytes, |turn| turn.start_offset))
}

#[allow(clippy::too_many_arguments)]
fn index_prefix_range<S: IndexSource>(
    store: &IndexStore,
    source: &S,
    path: &Path,
    file: &File,
    metadata: &std::fs::Metadata,
    id: &[u8; 32],
    state: &mut FileState,
    indexed_from: u64,
    previous_from: u64,
) -> Result<u64, IndexError> {
    let mut reader = BufReader::with_capacity(1024 * 1024, file.try_clone()?);
    seek_to(reader.get_mut(), indexed_from)?;
    let mut offset = indexed_from;
    let mut indexed_records = 0_u64;
    let mut line = Vec::new();
    let mut pending = Pending::new();
    let mut active_turn = None;
    let mut active_summary = None;
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
                "prefix backfill crossed its turn boundary".into(),
            )
            .into());
        }
        let record = source_record(source, offset, bytes, &line)?;
        let length = record.length;
        if let Some(metadata) = source.thread_metadata(path, modified_at, &line) {
            store.threads().put_thread_metadata(&metadata)?;
        }
        pending.records.push(indexed_record(id, record));
        pending
            .content
            .extend(source.content(path, *id, record, &line));
        let boundary = boundary_of(source, &line, offset)?;
        collect_rollback_removals(
            source,
            file,
            offset,
            boundary.as_ref(),
            &mut pending.removed_turns,
        )?;
        update_summary_index(
            source,
            boundary.as_ref(),
            offset,
            &line,
            &mut active_summary,
            &mut pending.summaries,
        )?;
        update_turn_indexes(
            source,
            boundary.as_ref(),
            &line,
            offset,
            length,
            &mut active_turn,
            &mut pending,
        )?;
        indexed_records = indexed_records.saturating_add(1);
        offset = next_offset;
        if pending.full() {
            remember_active_summary(active_summary.as_ref(), &mut pending.summaries)?;
            // Keep the old coverage checkpoint until the entire adjacent range
            // is durable. Rows written before it remain invisible after a crash.
            pending.commit(store, id, *state)?;
        }
    }
    if offset != previous_from {
        return Err(
            StoreError::CorruptedIndex("prefix backfill boundary is not aligned".into()).into(),
        );
    }
    if let Some(mut interrupted) = active_turn.take() {
        interrupted.end_offset = previous_from;
        pending.turns.push(interrupted);
    }
    remember_active_summary(active_summary.as_ref(), &mut pending.summaries)?;
    state.indexed_from = indexed_from;
    state.records = state.records.saturating_add(indexed_records);
    pending.commit(store, id, *state)?;
    Ok(indexed_records)
}

fn record_rate(records: u64, elapsed_ms: u128) -> u64 {
    (u128::from(records) * 1_000)
        .checked_div(elapsed_ms)
        .and_then(|rate| u64::try_from(rate).ok())
        .unwrap_or(records)
}

/// Reads only the file's first record and updates the shared thread metadata
/// index. This primes parent-child lookups without loading history.
///
/// # Errors
///
/// Returns an error when the header cannot be read or the metadata index
/// cannot be committed.
pub fn index_metadata<S: IndexSource>(
    store: &IndexStore,
    source: &S,
    path: &Path,
) -> Result<(), IndexError> {
    if let Some(metadata) = read_metadata(source, path)? {
        store.threads().put_thread_metadata(&metadata)?;
    }
    Ok(())
}

/// Reads only the file's first record without touching the index.
///
/// # Errors
///
/// Returns an error when the header cannot be read.
pub fn read_metadata<S: IndexSource>(
    source: &S,
    path: &Path,
) -> Result<Option<IndexedThreadMetadata>, IndexError> {
    let file = File::open(path)?;
    let metadata = file.metadata()?;
    let modified_at = modified_seconds(&metadata);
    let mut reader = BufReader::new(file);
    let mut line = Vec::new();
    Ok((reader.read_until(b'\n', &mut line)? > 0)
        .then(|| source.thread_metadata(path, modified_at, &line))
        .flatten())
}

fn update_turn_index(
    boundary: Option<&Boundary>,
    offset: u64,
    length: u32,
    active_turn: &mut Option<TurnRef>,
    turn_batch: &mut Vec<TurnRef>,
) {
    match boundary {
        Some(Boundary::Started(turn_id)) => {
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
        Some(Boundary::Terminal { turn_id, completed }) => {
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
        Some(Boundary::Rollback(count)) if *count > 0 => {
            *active_turn = None;
        }
        Some(Boundary::Rollback(_)) | None => {}
    }
}

fn update_turn_indexes<S: IndexSource>(
    source: &S,
    boundary: Option<&Boundary>,
    line: &[u8],
    offset: u64,
    length: u32,
    active_turn: &mut Option<TurnRef>,
    pending: &mut Pending,
) -> Result<(), IndexError> {
    update_turn_index(boundary, offset, length, active_turn, &mut pending.turns);
    index_standalone_turn(
        source,
        line,
        offset,
        length,
        active_turn.as_ref(),
        &mut pending.turns,
        &mut pending.summaries,
    )
}

fn update_summary_index<S: IndexSource>(
    source: &S,
    boundary: Option<&Boundary>,
    offset: u64,
    line: &[u8],
    active: &mut Option<ActiveSummary<S::Summary>>,
    batch: &mut Vec<(u64, Vec<u8>)>,
) -> Result<(), IndexError> {
    if matches!(boundary, Some(Boundary::Rollback(count)) if *count > 0) {
        *active = None;
        return Ok(());
    }
    if let Some(Boundary::Started(turn_id)) = boundary {
        remember_active_summary(active.as_ref(), batch)?;
        *active = Some((offset, turn_id.clone(), source.summary(turn_id.clone())));
    }
    if let Some((_start_offset, _turn_id, summary)) = active.as_mut() {
        // Crash fragments are tolerated by the history reader. Keep the same
        // behavior in the incremental materializer: a later durable record can
        // still complete the projection.
        let _ = summary.ingest(line, offset);
    }
    if let Some(Boundary::Terminal { turn_id, .. }) = boundary
        && active
            .as_ref()
            .is_some_and(|(_start_offset, active_turn_id, _summary)| active_turn_id == turn_id)
    {
        remember_active_summary(active.as_ref(), batch)?;
        *active = None;
    }
    Ok(())
}

fn index_standalone_turn<S: IndexSource>(
    source: &S,
    line: &[u8],
    offset: u64,
    length: u32,
    active_turn: Option<&TurnRef>,
    turn_batch: &mut Vec<TurnRef>,
    summary_batch: &mut Vec<(u64, Vec<u8>)>,
) -> Result<(), IndexError> {
    if active_turn.is_some() || source.standalone_needle().is_none() {
        return Ok(());
    }
    let Some(id) = source.standalone_turn(line) else {
        return Ok(());
    };
    let end_offset = offset + u64::from(length);
    let mut summary = source.summary(id.clone());
    summary.ingest(line, offset).map_err(IndexError::Summary)?;
    summary_batch.push((
        offset,
        serde_json::to_vec(&summary).map_err(StoreError::from)?,
    ));
    turn_batch.push(TurnRef {
        id,
        start_offset: offset,
        end_offset,
        completed: true,
    });
    Ok(())
}

fn remember_active_summary<P: SummaryProjection>(
    active: Option<&ActiveSummary<P>>,
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

fn active_projection<S: IndexSource>(
    store: &IndexStore,
    source: &S,
    id: &[u8; 32],
    file: &File,
    indexed_bytes: u64,
) -> Result<ActiveProjection<S::Summary>, IndexError> {
    let turn = store
        .turns_desc(id, None, 1)?
        .into_iter()
        .next()
        .filter(|turn| turn.end_offset == 0);
    let mut summary = turn
        .as_ref()
        .map(|turn| {
            store
                .turn_summary_state::<S::Summary>(id, turn.start_offset)
                .map(|state| {
                    state
                        .filter(SummaryProjection::is_current)
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
        let state = summary_from_file(source, file, &indexed_turn)?;
        store.put_turn_summary_state(id, turn.start_offset, &state)?;
        summary = Some((turn.start_offset, turn.id.clone(), state));
    }
    Ok((turn, summary))
}

/// Projects one turn's bytes from an open file handle into a fresh summary.
/// Malformed records are skipped while later durable records remain
/// available.
///
/// # Errors
///
/// Returns an error for an invalid span or an I/O failure.
pub fn summary_from_file<S: IndexSource>(
    source: &S,
    file: &File,
    turn: &TurnRef,
) -> Result<S::Summary, IndexError> {
    if turn.end_offset < turn.start_offset {
        return Err(StoreError::CorruptedIndex(format!(
            "turn span is invalid: {}..{}",
            turn.start_offset, turn.end_offset
        ))
        .into());
    }
    let mut snapshot = file.try_clone()?;
    seek_to(&mut snapshot, turn.start_offset)?;
    let mut reader = BufReader::new(snapshot.take(turn.end_offset - turn.start_offset));
    let mut line = Vec::new();
    let mut summary = source.summary(turn.id.clone());
    let mut malformed_records = 0_u64;
    let mut offset = turn.start_offset;
    loop {
        line.clear();
        let bytes = reader.read_until(b'\n', &mut line)?;
        if bytes == 0 {
            break;
        }
        if summary.ingest(&line, offset).is_err() {
            malformed_records = malformed_records.saturating_add(1);
        }
        offset = offset.saturating_add(bytes as u64);
    }
    if malformed_records > 0 {
        tracing::warn!(malformed_records, "skipped malformed transcript records");
    }
    Ok(summary)
}

/// Reads a descending turn page only when the persisted contiguous index
/// exactly matches the durable tail of this already-open file handle.
///
/// An open mutable turn retains `end_offset == 0`; projection owns clipping it
/// to the read's durable JSONL boundary. A missing or stale checkpoint
/// returns `None` so the caller can use the bounded cold tail scan while an
/// incremental rebuild runs in the background.
///
/// # Errors
///
/// Returns an error when the file or the index cannot be read.
pub fn current_indexed_turns_from_file(
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
    let id = file_id(path);
    let Some(state) = store.file_state(&id)? else {
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

    let mut turns = store.turns_desc(&id, before_offset, limit)?;
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
/// open source handle. The caller holds the per-file index lane while using it.
///
/// # Errors
///
/// Returns an error when the file or the index cannot be read.
pub fn current_indexed_anchor_from_file(
    store: &IndexStore,
    path: &Path,
    file: &File,
    file_bytes: u64,
    turn_id: &str,
) -> Result<Option<TurnRef>, IndexError> {
    let id = file_id(path);
    let Some(state) = current_indexed_coverage_from_file(store, path, file, file_bytes)? else {
        return Ok(None);
    };
    let durable_bytes = state.indexed_bytes;
    let anchor = store.turn_by_id(&id, turn_id)?.filter(|turn| {
        turn.start_offset >= state.indexed_from
            && turn.start_offset < durable_bytes
            && turn.end_offset <= durable_bytes
    });
    if store.file_state(&id)? != Some(state) {
        return Ok(None);
    }
    Ok(anchor)
}

/// Validates contiguous index coverage against an already-open source snapshot.
/// Complete coverage distinguishes a proven missing anchor from a cold prefix.
///
/// # Errors
///
/// Returns an error when the file or the index cannot be read.
pub fn current_indexed_coverage_from_file(
    store: &IndexStore,
    path: &Path,
    file: &File,
    file_bytes: u64,
) -> Result<Option<FileState>, IndexError> {
    let Some(state) = store.file_state(&file_id(path))? else {
        return Ok(None);
    };
    let (device, inode) = file_identity(&file.metadata()?);
    let durable_bytes = durable_end(file, file_bytes)?;
    Ok((state.indexed_bytes == durable_bytes
        && file_state_matches(file, state, device, inode, durable_bytes)?)
    .then_some(state))
}

/// Coverage of a file's frozen prefix `[0, end)`, such as a paginated fork's
/// base. The checkpoint proves the indexed bytes unchanged even while the
/// file keeps growing past them, so a live base thread does not invalidate
/// the history its forks inherited.
///
/// # Errors
///
/// Returns an error when the file or the index cannot be read.
pub fn frozen_indexed_coverage_from_file(
    store: &IndexStore,
    path: &Path,
    file: &File,
    end: u64,
) -> Result<Option<FileState>, IndexError> {
    let Some(state) = store.file_state(&file_id(path))? else {
        return Ok(None);
    };
    let metadata = file.metadata()?;
    let (device, inode) = file_identity(&metadata);
    let durable_bytes = durable_end(file, metadata.len())?;
    Ok((state.indexed_bytes >= end
        && file_state_matches(file, state, device, inode, durable_bytes)?)
    .then_some(state))
}

/// The newest indexed turns that start before `before` inside a frozen
/// prefix `[0, end)`. A turn may run past `end`; the caller closes it there.
///
/// # Errors
///
/// Returns an error when the file or the index cannot be read.
pub fn frozen_indexed_turns_from_file(
    store: &IndexStore,
    path: &Path,
    file: &File,
    end: u64,
    before: u64,
    limit: usize,
) -> Result<Option<IndexedTurnPage>, IndexError> {
    let Some(state) = frozen_indexed_coverage_from_file(store, path, file, end)? else {
        return Ok(None);
    };
    let before = before.min(end);
    if before <= state.indexed_from && !state.is_complete() {
        return Ok(None);
    }
    let id = file_id(path);
    let mut turns = store.turns_desc(&id, Some(before), limit)?;
    turns.retain(|turn| turn.start_offset >= state.indexed_from);
    if turns.is_empty() && !state.is_complete() {
        return Ok(None);
    }
    if turns.iter().any(|turn| {
        (turn.end_offset != 0 && turn.start_offset >= turn.end_offset)
            || turn.end_offset > state.indexed_bytes
    }) {
        return Ok(None);
    }
    if store.file_state(&id)? != Some(state) {
        return Ok(None);
    }
    Ok(Some(IndexedTurnPage {
        has_more: !state.is_complete() && turns.len() < limit,
        turns,
    }))
}

/// Resolves a turn inside a frozen prefix `[0, end)` from the index.
///
/// # Errors
///
/// Returns an error when the file or the index cannot be read.
pub fn frozen_indexed_anchor_from_file(
    store: &IndexStore,
    path: &Path,
    file: &File,
    end: u64,
    turn_id: &str,
) -> Result<Option<TurnRef>, IndexError> {
    let Some(state) = frozen_indexed_coverage_from_file(store, path, file, end)? else {
        return Ok(None);
    };
    let id = file_id(path);
    let anchor = store.turn_by_id(&id, turn_id)?.filter(|turn| {
        turn.start_offset >= state.indexed_from
            && turn.start_offset < end
            && turn.end_offset <= state.indexed_bytes
    });
    if store.file_state(&id)? != Some(state) {
        return Ok(None);
    }
    Ok(anchor)
}

/// Whether `file` still matches `witness`: its bytes unchanged and no
/// rollback appended after them.
///
/// # Errors
///
/// Returns an error when the file cannot be read or a boundary is malformed.
pub fn witness_matches<S: IndexSource>(
    source: &S,
    file: &File,
    file_bytes: u64,
    witness: &FileWitness,
) -> Result<bool, IndexError> {
    if !witness.bytes_match(file, file_bytes)? {
        return Ok(false);
    }
    let durable_bytes = durable_end(file, file_bytes)?;
    let mut unchanged = true;
    visit_boundaries_reverse(
        source,
        file,
        durable_bytes,
        witness.durable_bytes,
        |_, _, boundary| {
            unchanged = !matches!(boundary, Boundary::Rollback(_));
            unchanged
        },
    )?;
    Ok(unchanged)
}

/// Discovers the newest turn spans directly from the durable JSONL tail.
///
/// This is the cold-start path: it can render the latest page before a full
/// forward index exists. Older pages are served by repeating the scan with the
/// oldest returned `start_offset` as `before_offset`.
///
/// # Errors
///
/// Returns an error if the file cannot be read or a boundary is malformed.
pub fn scan_tail_turns<S: IndexSource>(
    source: &S,
    path: &Path,
    before_offset: Option<u64>,
    limit: usize,
) -> Result<TailScanReport, IndexError> {
    let file = File::open(path)?;
    let file_bytes = file.metadata()?.len();
    scan_tail_turns_from_file(source, &file, file_bytes, before_offset, limit)
}

/// Scans a stable open file handle. Keeping discovery and projection on the
/// same handle prevents a concurrent atomic replacement from mixing offsets
/// from one inode with bytes from another.
///
/// # Errors
///
/// Returns an error if the file cannot be read or a boundary is malformed.
pub fn scan_tail_turns_from_file<S: IndexSource>(
    source: &S,
    file: &File,
    file_bytes: u64,
    before_offset: Option<u64>,
    limit: usize,
) -> Result<TailScanReport, IndexError> {
    scan_tail_turns_until(
        source,
        file,
        file_bytes,
        FileEnd::Live,
        before_offset,
        limit,
    )
}

/// Scans a prefix that will never grow: a paginated fork's base. A turn the
/// fork point cut is closed at `end` instead of staying open.
///
/// # Errors
///
/// Returns an error if the file cannot be read or a boundary is malformed.
pub fn scan_frozen_tail_turns_from_file<S: IndexSource>(
    source: &S,
    file: &File,
    end: u64,
    before_offset: Option<u64>,
    limit: usize,
) -> Result<TailScanReport, IndexError> {
    scan_tail_turns_until(source, file, end, FileEnd::Frozen, before_offset, limit)
}

fn scan_tail_turns_until<S: IndexSource>(
    source: &S,
    file: &File,
    file_bytes: u64,
    file_end: FileEnd,
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
    let bytes_scanned =
        visit_logical_turns_reverse(source, file, durable_bytes, file_end, |turn| {
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
///
/// # Errors
///
/// Returns an error if the file cannot be read or a boundary is malformed.
pub fn scan_turns_after_from_file<S: IndexSource>(
    source: &S,
    file: &File,
    file_bytes: u64,
    anchor_id: &str,
    limit: usize,
) -> Result<Option<Vec<TurnRef>>, IndexError> {
    let mut found = false;
    let mut newer = std::collections::VecDeque::with_capacity(limit);
    let durable_bytes = durable_end(file, file_bytes)?;
    visit_logical_turns_reverse(source, file, durable_bytes, FileEnd::Live, |turn| {
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
///
/// # Errors
///
/// Returns an error if the file cannot be read or a boundary is malformed.
pub fn scan_turns_before_from_file<S: IndexSource>(
    source: &S,
    file: &File,
    file_bytes: u64,
    anchor_id: &str,
    limit: usize,
) -> Result<Option<Vec<TurnRef>>, IndexError> {
    scan_turns_before_until(source, file, file_bytes, FileEnd::Live, anchor_id, limit)
}

/// [`scan_turns_before_from_file`] over a frozen prefix ending at `end`; the
/// anchor may be the turn the fork point cut.
///
/// # Errors
///
/// Returns an error if the file cannot be read or a boundary is malformed.
pub fn scan_frozen_turns_before_from_file<S: IndexSource>(
    source: &S,
    file: &File,
    end: u64,
    anchor_id: &str,
    limit: usize,
) -> Result<Option<Vec<TurnRef>>, IndexError> {
    scan_turns_before_until(source, file, end, FileEnd::Frozen, anchor_id, limit)
}

fn scan_turns_before_until<S: IndexSource>(
    source: &S,
    file: &File,
    file_bytes: u64,
    file_end: FileEnd,
    anchor_id: &str,
    limit: usize,
) -> Result<Option<Vec<TurnRef>>, IndexError> {
    let mut found = false;
    let mut turns = Vec::with_capacity(limit);
    let durable_bytes = durable_end(file, file_bytes)?;
    visit_logical_turns_reverse(source, file, durable_bytes, file_end, |turn| {
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

fn collect_rollback_removals<S: IndexSource>(
    source: &S,
    file: &File,
    offset: u64,
    boundary: Option<&Boundary>,
    removed: &mut Vec<u64>,
) -> Result<(), IndexError> {
    let Some(Boundary::Rollback(count)) = boundary else {
        return Ok(());
    };
    let mut remaining = *count;
    if remaining == 0 {
        return Ok(());
    }
    visit_logical_task_turns_reverse(source, file, offset, |turn| {
        removed.push(turn.start_offset);
        remaining -= 1;
        remaining > 0
    })?;
    Ok(())
}

/// Whether records may still be appended after a scanned file's end.
#[derive(Clone, Copy)]
enum FileEnd {
    /// The newest turn without a terminal is still running (`end_offset == 0`).
    Live,
    /// The scanned end is final; an unterminated newest turn ends there.
    Frozen,
}

fn visit_logical_turns_reverse<S: IndexSource>(
    source: &S,
    file: &File,
    durable_bytes: u64,
    file_end: FileEnd,
    mut visit: impl FnMut(TurnRef) -> bool,
) -> Result<u64, IndexError> {
    let mut skipped = 0_u64;
    let mut next_start = match file_end {
        FileEnd::Live => 0,
        FileEnd::Frozen => durable_bytes,
    };
    let mut terminal: Option<(String, u64, bool)> = None;
    let mut pending_standalone = Vec::new();
    let mut stopped = false;
    let bytes_scanned =
        visit_timeline_boundaries_reverse(source, file, durable_bytes, |boundary| {
            match boundary {
                TimelineBoundary::Standalone(turn) => pending_standalone.push(turn),
                TimelineBoundary::Turn {
                    boundary: Boundary::Rollback(count),
                    ..
                } => {
                    skipped = skipped.saturating_add(count);
                }
                TimelineBoundary::Turn {
                    end_offset,
                    boundary: Boundary::Terminal { turn_id, completed },
                    ..
                } => {
                    for turn in pending_standalone.drain(..) {
                        if !visit(turn) {
                            stopped = true;
                            return false;
                        }
                    }
                    terminal = Some((turn_id, end_offset, completed));
                }
                TimelineBoundary::Turn {
                    start_offset,
                    boundary: Boundary::Started(id),
                    ..
                } => {
                    // Standalone items between this start and its terminal
                    // belong to the turn summary. Items outside a turn were
                    // already flushed at the terminal encountered in reverse.
                    pending_standalone.clear();
                    let (end_offset, completed) = terminal
                        .take()
                        .filter(|(turn_id, _, _)| turn_id == &id)
                        .map_or((next_start, false), |(_, end, completed)| (end, completed));
                    next_start = start_offset;
                    if skipped > 0 {
                        skipped -= 1;
                    } else if !visit(TurnRef {
                        id,
                        start_offset,
                        end_offset,
                        completed,
                    }) {
                        stopped = true;
                        return false;
                    }
                }
            }
            true
        })?;
    if !stopped {
        for turn in pending_standalone {
            if !visit(turn) {
                break;
            }
        }
    }
    Ok(bytes_scanned)
}

fn visit_logical_task_turns_reverse<S: IndexSource>(
    source: &S,
    file: &File,
    durable_bytes: u64,
    mut visit: impl FnMut(TurnRef) -> bool,
) -> Result<u64, IndexError> {
    let mut skipped = 0_u64;
    let mut next_start = 0;
    let mut terminal: Option<(String, u64, bool)> = None;
    visit_boundaries_reverse(source, file, durable_bytes, 0, |offset, end, boundary| {
        match boundary {
            Boundary::Rollback(count) => {
                skipped = skipped.saturating_add(count);
            }
            Boundary::Terminal { turn_id, completed } => {
                terminal = Some((turn_id, end, completed));
            }
            Boundary::Started(id) => {
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

fn boundary_of<S: IndexSource>(
    source: &S,
    line: &[u8],
    offset: u64,
) -> Result<Option<Boundary>, IndexError> {
    if !source
        .boundary_needles()
        .iter()
        .any(|needle| memchr::memmem::find(line, needle).is_some())
    {
        return Ok(None);
    }
    source
        .boundary(line, offset)
        .map_err(|source| IndexError::InvalidBoundary { offset, source })
}

/// Visits every boundary record in `stop_offset..search_end`, newest first,
/// until `visit` returns `false`. Returns the bytes scanned.
///
/// # Errors
///
/// Returns an error if the file cannot be read or a boundary is malformed.
pub fn visit_boundaries_reverse<S: IndexSource>(
    source: &S,
    file: &File,
    search_end: u64,
    stop_offset: u64,
    mut visit: impl FnMut(u64, u64, Boundary) -> bool,
) -> Result<u64, IndexError> {
    let needles = source.boundary_needles();
    let overlap = needles
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
        let mut block_matches: Vec<u64> = needles
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
            if let Some(boundary) = boundary_of(source, &line, line_start)?
                && !visit(line_start, line_start + line.len() as u64, boundary)
            {
                return Ok(bytes_scanned);
            }
        }
        position = core_start;
    }
    Ok(bytes_scanned)
}

enum TimelineBoundary {
    Turn {
        start_offset: u64,
        end_offset: u64,
        boundary: Boundary,
    },
    Standalone(TurnRef),
}

#[derive(Clone, Copy)]
enum TimelineNeedle {
    Turn,
    Standalone,
}

fn visit_timeline_boundaries_reverse<S: IndexSource>(
    source: &S,
    file: &File,
    search_end: u64,
    mut visit: impl FnMut(TimelineBoundary) -> bool,
) -> Result<u64, IndexError> {
    let needles = source.boundary_needles();
    let standalone = source.standalone_needle();
    let overlap = needles
        .iter()
        .copied()
        .chain(standalone)
        .map(<[u8]>::len)
        .max()
        .unwrap_or(0)
        .saturating_sub(1) as u64;
    let mut position = search_end;
    let mut bytes_scanned = 0_u64;
    while position > 0 {
        let core_start = position.saturating_sub(REVERSE_SCAN_BLOCK_BYTES as u64);
        let read_end = search_end.min(position.saturating_add(overlap));
        let read_size = usize::try_from(read_end - core_start).map_err(std::io::Error::other)?;
        let mut buffer = vec![0_u8; read_size];
        read_exact_at(file, &mut buffer, core_start)?;
        bytes_scanned = bytes_scanned.saturating_add(position - core_start);
        let mut matches = needles
            .iter()
            .flat_map(|needle| {
                memchr::memmem::find_iter(&buffer, needle)
                    .map(|index| (core_start + index as u64, TimelineNeedle::Turn))
            })
            .chain(standalone.into_iter().flat_map(|needle| {
                memchr::memmem::find_iter(&buffer, needle)
                    .map(|index| (core_start + index as u64, TimelineNeedle::Standalone))
            }))
            .filter(|(offset, _)| *offset >= core_start && *offset < position)
            .collect::<Vec<_>>();
        matches.sort_unstable_by_key(|item| std::cmp::Reverse(item.0));
        for (offset, needle) in matches {
            let (line_start, line) = read_line_at(file, offset, search_end)?;
            let boundary = match needle {
                TimelineNeedle::Turn => {
                    boundary_of(source, &line, line_start)?.map(|boundary| TimelineBoundary::Turn {
                        start_offset: line_start,
                        end_offset: line_start + line.len() as u64,
                        boundary,
                    })
                }
                TimelineNeedle::Standalone => source.standalone_turn(&line).map(|id| {
                    TimelineBoundary::Standalone(TurnRef {
                        id,
                        start_offset: line_start,
                        end_offset: line_start + line.len() as u64,
                        completed: true,
                    })
                }),
            };
            if boundary.is_some_and(|boundary| !visit(boundary)) {
                return Ok(bytes_scanned);
            }
        }
        position = core_start;
    }
    Ok(bytes_scanned)
}

fn source_record<S: IndexSource>(
    source: &S,
    offset: u64,
    bytes: usize,
    line: &[u8],
) -> Result<RecordRef, IndexError> {
    Ok(RecordRef {
        offset,
        length: u32::try_from(bytes).map_err(|_| IndexError::RecordTooLarge(offset))?,
        record_type: source.classify(line),
    })
}

fn indexed_record(id: &[u8; 32], record: RecordRef) -> (Vec<u8>, Vec<u8>) {
    (
        offset_key(id, record.offset),
        record_value(record.offset, record.length, record.record_type),
    )
}
