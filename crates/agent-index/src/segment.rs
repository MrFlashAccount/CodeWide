//! Turn ranges of a transcript whose boundaries depend on earlier records.
//!
//! [`crate::scan`] asks a stateless [`crate::IndexSource`] what each record
//! means. Some formats cannot answer from one record: whether a prompt
//! starts a turn depends on the turn open before it, a turn may start at a
//! record written before the one that proves it started, and a rewind names
//! the record it returns to instead of a turn count. A [`SegmentSource`]
//! carries its own state across records instead; the scan persists that
//! state with every checkpoint and with every turn start, so a file is
//! continued from its checkpoint (reading only the appended tail) and a
//! suffix is rescanned from any turn start ([`reindex_segments_from`]).
//!
//! The scan also keeps what such a source needs about earlier records
//! without re-reading them: the span of each record the source keys (by
//! the source's own key, e.g. a record id) and facts merged per group of
//! files (e.g. a status a later record reports about an earlier one).
//!
//! A turn is a contiguous byte range of one file. A segmented file is always
//! indexed from its first byte: there is no tail bootstrap or prefix
//! backfill, since a boundary cannot be decided without the records before
//! it.

use std::{
    collections::{BTreeMap, BTreeSet, HashMap},
    fs::File,
    io::{BufRead, BufReader},
    path::Path,
};

use companion_host::index::StoreError;
use serde::{Deserialize, Serialize, de::DeserializeOwned};

use crate::{
    file::{durable_end, file_id, file_identity, modified_nanos, seek_to, tail_hash},
    scan::{IndexError, file_state_matches},
    segment_store::{RecordSpan, SegmentRows, SegmentStore},
    store::{FileState, IndexBatch, TurnRef},
};

const WRITE_BATCH_RECORDS: usize = 4_096;

/// One durable record of a file.
#[derive(Clone, Copy, Debug)]
pub struct Record<'a> {
    /// The record's bytes, its newline included.
    pub line: &'a [u8],
    pub offset: u64,
    pub length: u32,
}

impl Record<'_> {
    /// The offset just after the record.
    #[must_use]
    pub const fn end(&self) -> u64 {
        self.offset + self.length as u64
    }
}

/// The spans of records the source keyed earlier in the same file.
pub trait RecordKeys {
    /// The span of the record `key` names, if one was scanned.
    ///
    /// # Errors
    ///
    /// Returns an error when the index cannot be read.
    fn span(&self, key: &[u8]) -> Result<Option<RecordSpan>, StoreError>;
}

/// What one record means for the index.
#[derive(Debug)]
pub struct Observation<S> {
    /// The key the record can later be named by.
    pub key: Option<Vec<u8>>,
    /// Boundaries in the order they apply.
    pub boundaries: Vec<SegmentBoundary<S>>,
    /// Facts about the file's group, merged with [`SegmentSource::merge_fact`].
    pub facts: Vec<(Vec<u8>, Vec<u8>)>,
}

impl<S> Default for Observation<S> {
    fn default() -> Self {
        Self {
            key: None,
            boundaries: Vec::new(),
            facts: Vec::new(),
        }
    }
}

/// What a record does to turn ranges.
#[derive(Debug)]
pub enum SegmentBoundary<S> {
    /// A turn `turn_id` starts at `start_offset`: this record's offset or an
    /// earlier one no other boundary followed. The open turn ends there.
    /// `resume` is the source state from which observing the records from
    /// `start_offset` on reproduces this turn.
    Started {
        turn_id: String,
        start_offset: u64,
        resume: S,
    },
    /// The open turn is known as `turn_id` from now on.
    Renamed { turn_id: String },
    /// The open turn ends after this record.
    Ended { completed: bool },
    /// The conversation returns to the record `key` names: every turn after
    /// the one holding it is removed (tombstoned, as a rollback), and that
    /// turn ends after the record. A key no record carries changes nothing.
    RolledBackTo { key: Vec<u8> },
}

/// A record format whose turn boundaries depend on the records before.
pub trait SegmentSource: Send + Sync {
    /// What the source remembers between records.
    type State: Serialize + DeserializeOwned + Default + Clone;

    /// Observes one durable record, in file order.
    ///
    /// # Errors
    ///
    /// Returns the reason a record that must be understood cannot be.
    fn observe(
        &self,
        state: &mut Self::State,
        record: Record<'_>,
        keys: &dyn RecordKeys,
    ) -> Result<Observation<Self::State>, SegmentSourceError>;

    /// The fact to keep under `key` when `observed` arrives and `recorded`
    /// is already kept. Observing the same record twice must keep the same
    /// fact (a bounded rescan observes records again).
    fn merge_fact(&self, key: &[u8], recorded: &[u8], observed: &[u8]) -> Vec<u8>;
}

/// A record a source could not understand.
#[derive(Debug, thiserror::Error)]
#[error("invalid record at byte {offset}: {reason}")]
pub struct SegmentSourceError {
    pub offset: u64,
    pub reason: String,
}

/// What a scan changed.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct SegmentReport {
    /// Turns that are new or whose id or range changed, as they are now.
    pub changed: Vec<TurnRef>,
    /// Turns that no longer exist, as they were (removed by a rollback, a
    /// rescan or a rewritten file).
    pub removed: Vec<TurnRef>,
    /// The file was indexed again from its first byte.
    pub reset: bool,
    /// Records observed.
    pub records: u64,
}

impl SegmentReport {
    fn removed_turn(&mut self, turn: TurnRef) {
        self.changed
            .retain(|changed| changed.start_offset != turn.start_offset);
        self.removed.push(turn);
    }

    /// Folds the outcome of a later scan of the same file into this one.
    pub fn then(&mut self, later: Self) {
        for turn in later.removed {
            self.changed
                .retain(|changed| changed.start_offset != turn.start_offset);
            self.removed.push(turn);
        }
        for turn in later.changed {
            self.changed
                .retain(|changed| changed.start_offset != turn.start_offset);
            self.removed.retain(|removed| {
                removed.start_offset != turn.start_offset || removed.id != turn.id
            });
            self.changed.push(turn);
        }
        self.reset |= later.reset;
        self.records += later.records;
    }
}

/// The scan cursor: the open turn and the source's state, persisted with
/// every checkpoint and every turn start.
#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(bound = "S: Serialize + DeserializeOwned")]
struct Cursor<S> {
    open: Option<OpenTurn>,
    source: S,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
struct OpenTurn {
    id: String,
    start_offset: u64,
}

impl OpenTurn {
    fn turn_ref(&self) -> TurnRef {
        TurnRef {
            id: self.id.clone(),
            start_offset: self.start_offset,
            end_offset: 0,
            completed: false,
        }
    }
}

fn encode<T: Serialize>(value: &T) -> Result<Vec<u8>, StoreError> {
    Ok(serde_json::to_vec(value)?)
}

fn decode<T: DeserializeOwned>(bytes: &[u8]) -> Result<T, StoreError> {
    Ok(serde_json::from_slice(bytes)?)
}

/// The rows of one scan step before they are committed.
#[derive(Default)]
struct Batch {
    turns: BTreeMap<u64, TurnRef>,
    removed: BTreeSet<u64>,
    renamed: Vec<String>,
    turn_states: BTreeMap<u64, Vec<u8>>,
    keys: HashMap<Vec<u8>, RecordSpan>,
    facts: HashMap<Vec<u8>, Vec<u8>>,
    records: usize,
}

impl Batch {
    fn clear(&mut self) {
        *self = Self::default();
    }
}

struct BatchKeys<'a> {
    batch: &'a Batch,
    store: &'a SegmentStore,
    file_id: [u8; 32],
}

impl RecordKeys for BatchKeys<'_> {
    fn span(&self, key: &[u8]) -> Result<Option<RecordSpan>, StoreError> {
        if let Some(span) = self.batch.keys.get(key) {
            return Ok(Some(*span));
        }
        self.store.record_span(&self.file_id, key)
    }
}

/// One forward scan over a file's durable records.
struct Scan<'a, S: SegmentSource> {
    store: &'a SegmentStore,
    source: &'a S,
    file_id: [u8; 32],
    group: [u8; 32],
    cursor: Cursor<S::State>,
    batch: Batch,
    report: SegmentReport,
}

impl<S: SegmentSource> Scan<'_, S> {
    /// The live turn with the largest start at or before `offset`, from the
    /// batch or the store.
    fn holding_turn(&self, offset: u64) -> Result<Option<TurnRef>, StoreError> {
        let batched = self
            .batch
            .turns
            .range(..=offset)
            .next_back()
            .map(|(_, turn)| turn.clone());
        let stored = self
            .store
            .index()
            .turns_desc(&self.file_id, Some(offset.saturating_add(1)), 1)?
            .into_iter()
            .next()
            .filter(|turn| !self.batch.removed.contains(&turn.start_offset));
        Ok(match (batched, stored) {
            (Some(batched), Some(stored)) if stored.start_offset > batched.start_offset => {
                Some(stored)
            }
            (Some(batched), _) => Some(batched),
            (None, stored) => stored,
        })
    }

    fn upsert(&mut self, turn: TurnRef) {
        self.report
            .changed
            .retain(|changed| changed.start_offset != turn.start_offset);
        self.report.changed.push(turn.clone());
        self.batch.turns.insert(turn.start_offset, turn);
    }

    fn end_open(&mut self, end_offset: u64, completed: bool) {
        if let Some(open) = self.cursor.open.take() {
            let mut turn = open.turn_ref();
            turn.end_offset = end_offset;
            turn.completed = completed;
            self.upsert(turn);
        }
    }

    fn roll_back_to(&mut self, span: RecordSpan) -> Result<(), StoreError> {
        let holding = self.holding_turn(span.offset)?;
        let after = holding
            .as_ref()
            .map_or(span.offset, |turn| turn.start_offset.saturating_add(1));
        let mut removed = self
            .store
            .turns_from(&self.file_id, after)?
            .into_iter()
            .filter(|turn| !self.batch.removed.contains(&turn.start_offset))
            .filter(|turn| !self.batch.turns.contains_key(&turn.start_offset))
            .collect::<Vec<_>>();
        removed.extend(
            self.batch
                .turns
                .range(after..)
                .map(|(_, turn)| turn.clone()),
        );
        for turn in removed {
            self.batch.turns.remove(&turn.start_offset);
            self.batch.turn_states.remove(&turn.start_offset);
            self.batch.removed.insert(turn.start_offset);
            self.report.removed_turn(turn);
        }
        if let Some(mut holding) = holding
            && (holding.end_offset == 0 || holding.end_offset > span.end())
        {
            holding.end_offset = span.end();
            self.upsert(holding);
        }
        self.cursor.open = None;
        Ok(())
    }

    fn apply(
        &mut self,
        record: Record<'_>,
        observation: Observation<S::State>,
    ) -> Result<(), IndexError> {
        if let Some(key) = observation.key {
            self.batch.keys.insert(
                key,
                RecordSpan {
                    offset: record.offset,
                    length: record.length,
                },
            );
        }
        for boundary in observation.boundaries {
            match boundary {
                SegmentBoundary::Started {
                    turn_id,
                    start_offset,
                    resume,
                } => {
                    let start_offset = start_offset.min(record.offset);
                    let resume = Cursor {
                        open: self.cursor.open.clone(),
                        source: resume,
                    };
                    self.end_open(start_offset, false);
                    self.batch
                        .turn_states
                        .insert(start_offset, encode(&resume)?);
                    let open = OpenTurn {
                        id: turn_id,
                        start_offset,
                    };
                    self.upsert(open.turn_ref());
                    self.cursor.open = Some(open);
                }
                SegmentBoundary::Renamed { turn_id } => {
                    if let Some(open) = self.cursor.open.as_mut()
                        && open.id != turn_id
                    {
                        let previous = std::mem::replace(&mut open.id, turn_id);
                        let turn = open.turn_ref();
                        self.batch.renamed.push(previous.clone());
                        self.report.removed.push(TurnRef {
                            id: previous,
                            ..turn.clone()
                        });
                        self.upsert(turn);
                    }
                }
                SegmentBoundary::Ended { completed } => self.end_open(record.end(), completed),
                SegmentBoundary::RolledBackTo { key } => {
                    let span = BatchKeys {
                        batch: &self.batch,
                        store: self.store,
                        file_id: self.file_id,
                    }
                    .span(&key)?;
                    if let Some(span) = span {
                        self.roll_back_to(span)?;
                    }
                }
            }
        }
        for (key, observed) in observation.facts {
            let recorded = match self.batch.facts.get(&key) {
                Some(recorded) => Some(recorded.clone()),
                None => self.store.fact(&self.group, &key)?,
            };
            let merged = match recorded {
                Some(recorded) => {
                    let merged = self.source.merge_fact(&key, &recorded, &observed);
                    if merged == recorded {
                        continue;
                    }
                    merged
                }
                None => observed,
            };
            self.batch.facts.insert(key, merged);
        }
        Ok(())
    }

    fn commit(&mut self, mut state: FileState, file: &File) -> Result<(), IndexError> {
        state.tail_hash = tail_hash(file, state.indexed_bytes)?;
        let cursor = encode(&self.cursor)?;
        let turns = self.batch.turns.values().cloned().collect::<Vec<_>>();
        let removed = self.batch.removed.iter().copied().collect::<Vec<_>>();
        let turn_states = std::mem::take(&mut self.batch.turn_states)
            .into_iter()
            .collect::<Vec<_>>();
        let keys = std::mem::take(&mut self.batch.keys)
            .into_iter()
            .collect::<Vec<_>>();
        let facts = std::mem::take(&mut self.batch.facts)
            .into_iter()
            .collect::<Vec<_>>();
        self.store.commit(
            &self.file_id,
            &self.group,
            &SegmentRows {
                index: IndexBatch {
                    records: &[],
                    turns: &turns,
                    turn_summaries: &[],
                    removed_turns: &removed,
                    content: &[],
                },
                renamed: &self.batch.renamed,
                turn_states: &turn_states,
                keys: &keys,
                facts: &facts,
                cursor: &cursor,
            },
            state,
        )?;
        self.batch.clear();
        Ok(())
    }

    /// Observes every durable record from `state.indexed_bytes` up to
    /// `durable`: the durable end of the same metadata snapshot whose
    /// modification time `state` carries, so bytes appended since are left
    /// for the next scan instead of being covered by an older time.
    fn run(&mut self, file: &File, mut state: FileState, durable: u64) -> Result<(), IndexError> {
        let mut reader = BufReader::with_capacity(256 * 1024, file.try_clone()?);
        seek_to(reader.get_mut(), state.indexed_bytes)?;
        let mut offset = state.indexed_bytes;
        let mut line = Vec::new();
        while offset < durable {
            line.clear();
            let bytes = reader.read_until(b'\n', &mut line)?;
            // Index a writer-owned final record only after its durable newline.
            if bytes == 0 || line.last() != Some(&b'\n') {
                break;
            }
            let record = Record {
                line: &line,
                offset,
                length: u32::try_from(bytes).map_err(|_| IndexError::RecordTooLarge(offset))?,
            };
            let observation = {
                let keys = BatchKeys {
                    batch: &self.batch,
                    store: self.store,
                    file_id: self.file_id,
                };
                self.source
                    .observe(&mut self.cursor.source, record, &keys)
                    .map_err(|error| IndexError::Segment(Box::new(error)))?
            };
            self.apply(record, observation)?;
            offset = record.end();
            state.records = state.records.saturating_add(1);
            self.report.records = self.report.records.saturating_add(1);
            self.batch.records += 1;
            if self.batch.records == WRITE_BATCH_RECORDS {
                state.indexed_bytes = offset;
                self.commit(state, file)?;
            }
        }
        state.indexed_bytes = offset;
        self.commit(state, file)
    }
}

/// Advances the segmented index of `path` to its durable end, reading only
/// the records after its checkpoint. A file whose indexed bytes changed
/// (rewritten, truncated, replaced) is indexed again from its first byte.
/// `group` names the files whose facts are merged together.
///
/// # Errors
///
/// Returns an error when the file cannot be read, a record is larger than
/// the index supports, the source rejects a record, or the store fails.
pub fn index_segments<S: SegmentSource>(
    store: &SegmentStore,
    source: &S,
    path: &Path,
    group: [u8; 32],
) -> Result<SegmentReport, IndexError> {
    let id = file_id(path);
    let lane = store.index().index_lock(id);
    let _guard = lane
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    let file = File::open(path)?;
    let metadata = file.metadata()?;
    let durable_bytes = durable_end(&file, metadata.len())?;
    let (device, inode) = file_identity(&metadata);
    let mut report = SegmentReport::default();
    let persisted = store.index().file_state(&id)?;
    let resumed = match persisted {
        Some(state) if file_state_matches(&file, state, device, inode, durable_bytes)? => store
            .scan_state(&id)?
            .map(|cursor| decode::<Cursor<S::State>>(&cursor))
            .transpose()?
            .map(|cursor| (state, cursor)),
        _ => None,
    };
    let (mut state, cursor) = if let Some((state, cursor)) = resumed {
        (state, cursor)
    } else {
        if persisted.is_some() {
            report.removed = store.turns_from(&id, 0)?;
            store.reset_file(&id)?;
        }
        report.reset = true;
        (FileState::empty(device, inode), Cursor::default())
    };
    if state.indexed_bytes == durable_bytes && !report.reset {
        return Ok(report);
    }
    state.modified_nanos = modified_nanos(&metadata);
    let mut scan = Scan {
        store,
        source,
        file_id: id,
        group,
        cursor,
        batch: Batch::default(),
        report,
    };
    scan.run(&file, state, durable_bytes)?;
    Ok(scan.report)
}

/// Rescans `path` from the start of the turn before the record at
/// `offset`: the turn holding the byte before it. Every turn from there on
/// is derived again from its records with the source as it is now (for
/// example after a hint the source reads changed what one of them means).
/// Bytes before that turn are not read.
///
/// # Errors
///
/// As [`index_segments`].
pub fn reindex_segments_from<S: SegmentSource>(
    store: &SegmentStore,
    source: &S,
    path: &Path,
    group: [u8; 32],
    offset: u64,
) -> Result<SegmentReport, IndexError> {
    let mut report = index_segments(store, source, path, group)?;
    if report.reset {
        return Ok(report);
    }
    let id = file_id(path);
    let lane = store.index().index_lock(id);
    let guard = lane
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    let file = File::open(path)?;
    let metadata = file.metadata()?;
    let durable_bytes = durable_end(&file, metadata.len())?;
    let (device, inode) = file_identity(&metadata);
    let Some(mut state) = store.index().file_state(&id)? else {
        return Ok(report);
    };
    if !file_state_matches(&file, state, device, inode, durable_bytes)? {
        // Changed since the forward scan: that path reconciles it first.
        drop(guard);
        report.then(index_segments(store, source, path, group)?);
        return Ok(report);
    }
    let restart = store
        .index()
        .turns_desc(&id, Some(offset), 1)?
        .into_iter()
        .next();
    let cursor = match &restart {
        Some(turn) => match store.turn_state(&id, turn.start_offset)? {
            Some(cursor) => Some(decode::<Cursor<S::State>>(&cursor)?),
            None => None,
        },
        None => Some(Cursor::default()),
    };
    let (from, cursor) = match (restart, cursor) {
        (Some(turn), Some(cursor)) => (turn.start_offset, cursor),
        // A turn without its start cursor (or none at all) restarts the
        // file: the turns before it cannot be continued exactly.
        _ => (0, Cursor::default()),
    };
    let mut rescanned = SegmentReport {
        removed: store.turns_from(&id, from)?,
        ..SegmentReport::default()
    };
    let reopened = cursor.open.as_ref().map(OpenTurn::turn_ref);
    // The turn the cursor reopens, as it was: unchanged unless the rescan
    // ends it elsewhere.
    let before = match &reopened {
        Some(turn) => store
            .index()
            .turn_by_id(&id, &turn.id)?
            .filter(|stored| stored.start_offset == turn.start_offset),
        None => None,
    };
    state.indexed_bytes = from;
    state.tail_hash = tail_hash(&file, from)?;
    state.modified_nanos = modified_nanos(&metadata);
    store.truncate_turns(&id, from, state, &encode(&cursor)?, reopened.as_ref())?;
    if let Some(reopened) = reopened {
        rescanned.changed.push(reopened);
    }
    let mut scan = Scan {
        store,
        source,
        file_id: id,
        group,
        cursor,
        batch: Batch::default(),
        report: rescanned,
    };
    scan.run(&file, state, durable_bytes)?;
    // A turn rescanned into the same id and range did not change.
    let mut rescanned = scan.report;
    let unchanged = rescanned
        .changed
        .iter()
        .filter(|turn| rescanned.removed.contains(turn) || before.as_ref() == Some(*turn))
        .cloned()
        .collect::<Vec<_>>();
    rescanned.changed.retain(|turn| !unchanged.contains(turn));
    rescanned
        .removed
        .retain(|turn| !unchanged.contains(turn) && !rescanned_ids(&rescanned.changed, turn));
    report.then(rescanned);
    Ok(report)
}

/// Whether a removed turn reappears, same id and start, among `changed`.
fn rescanned_ids(changed: &[TurnRef], removed: &TurnRef) -> bool {
    changed
        .iter()
        .any(|turn| turn.id == removed.id && turn.start_offset == removed.start_offset)
}

/// The source state the turn starting at `start_offset` was opened from;
/// observing its records from there reproduces it. `None` for a turn the
/// index does not know.
///
/// # Errors
///
/// Returns an error when the index cannot be read or the state does not
/// decode as `S`.
pub fn turn_resume_state<S: Serialize + DeserializeOwned + Default>(
    store: &SegmentStore,
    file_id: &[u8; 32],
    start_offset: u64,
) -> Result<Option<S>, StoreError> {
    store
        .turn_state(file_id, start_offset)?
        .map(|cursor| decode::<Cursor<S>>(&cursor).map(|cursor| cursor.source))
        .transpose()
}

/// The source state at the file's checkpoint (after its last indexed
/// record); `None` for a file the index does not know.
///
/// # Errors
///
/// Returns an error when the index cannot be read or the state does not
/// decode as `S`.
pub fn checkpoint_state<S: Serialize + DeserializeOwned + Default>(
    store: &SegmentStore,
    file_id: &[u8; 32],
) -> Result<Option<S>, StoreError> {
    store
        .scan_state(file_id)?
        .map(|cursor| decode::<Cursor<S>>(&cursor).map(|cursor| cursor.source))
        .transpose()
}

/// The checkpoint of `path` when it still describes the file's bytes: the
/// indexed end and the witness agree with this open handle. A read of turn
/// ranges through `file` is then exact.
///
/// # Errors
///
/// Returns an error when the file or the index cannot be read.
pub fn current_checkpoint(
    store: &SegmentStore,
    path: &Path,
    file: &File,
) -> Result<Option<FileState>, IndexError> {
    let metadata = file.metadata()?;
    let durable_bytes = durable_end(file, metadata.len())?;
    let (device, inode) = file_identity(&metadata);
    let Some(state) = store.index().file_state(&file_id(path))? else {
        return Ok(None);
    };
    Ok(file_state_matches(file, state, device, inode, durable_bytes)?.then_some(state))
}

#[cfg(test)]
mod tests;
