//! The segmented scan over a toy format: one JSON record per line,
//! `{"t": kind, "id": id, "parent": id, "fact": [key, value]}`. A prompt
//! (`p`) starts a turn and rewinds when its parent precedes the newest
//! record; an answer (`a`) continues the open turn, or starts one when none
//! is open or the source's hints name it; a wake (`w`) waits for the next
//! prompt or answer, whose turn then starts at the wake; an interrupt (`x`)
//! ends the turn.

use std::{collections::HashSet, sync::Mutex};

use companion_host::thread_index::IndexedThreadMetadata;
use serde::Deserialize;

use super::*;
use crate::{segment_store::SegmentTables, store::IndexTables};

const TABLES: SegmentTables = SegmentTables {
    index: IndexTables {
        files: "toy_files",
        records: "toy_records",
        turns: "toy_turns",
        turns_by_id: "toy_turns_by_id",
        removed_turns: "toy_removed_turns",
        turn_summaries: "toy_turn_summaries",
        content: "toy_content",
        content_by_file: "toy_content_by_file",
        logic_version_key: "toy_logic_version",
        logic_version: 1,
    },
    record_keys: "toy_record_keys",
    scan_states: "toy_scan_states",
    turn_states: "toy_turn_states",
    facts: "toy_facts",
};

const GROUP: [u8; 32] = [7; 32];

#[derive(Default)]
struct NoThreads;

impl companion_host::thread_index::HostThreadIndex for NoThreads {
    fn put_thread_metadata(&self, _metadata: &IndexedThreadMetadata) -> Result<(), StoreError> {
        Ok(())
    }

    fn put_thread_metadata_batch(
        &self,
        _metadata: &[IndexedThreadMetadata],
    ) -> Result<(), StoreError> {
        Ok(())
    }

    fn thread_descendants(
        &self,
        _root_thread_id: &str,
    ) -> Result<Vec<IndexedThreadMetadata>, StoreError> {
        Ok(Vec::new())
    }

    fn thread_pin_snapshot(
        &self,
    ) -> Result<companion_host::thread_index::ThreadPinSnapshot, StoreError> {
        Err(StoreError::CorruptedIndex("no pins in a toy index".into()))
    }
}

#[derive(Deserialize)]
struct Line {
    t: String,
    id: String,
    parent: Option<String>,
    fact: Option<(String, String)>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
struct ToyState {
    open: bool,
    pending: Option<(u64, Box<ToyState>)>,
    tip: Option<u64>,
}

/// The toy format; `starts` are answers the hints say start a turn.
#[derive(Default)]
struct Toy {
    starts: Mutex<HashSet<String>>,
    observed: Mutex<u64>,
}

impl Toy {
    fn observed(&self) -> u64 {
        *self
            .observed
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    fn start(state: &mut ToyState, id: &str, offset: u64) -> SegmentBoundary<ToyState> {
        let (start_offset, resume) = match state.pending.take() {
            Some((start, resume)) => (start, *resume),
            None => (offset, state.clone()),
        };
        state.open = true;
        SegmentBoundary::Started {
            turn_id: id.to_owned(),
            start_offset,
            resume,
        }
    }
}

impl SegmentSource for Toy {
    type State = ToyState;

    fn observe(
        &self,
        state: &mut ToyState,
        record: Record<'_>,
        keys: &dyn RecordKeys,
    ) -> Result<Observation<ToyState>, SegmentSourceError> {
        *self
            .observed
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner) += 1;
        let line: Line =
            serde_json::from_slice(record.line).map_err(|error| SegmentSourceError {
                offset: record.offset,
                reason: error.to_string(),
            })?;
        let mut observation = Observation {
            key: Some(line.id.clone().into_bytes()),
            ..Observation::default()
        };
        if let Some((key, value)) = line.fact {
            observation
                .facts
                .push((key.into_bytes(), value.into_bytes()));
        }
        match line.t.as_str() {
            "p" => {
                if let Some(parent) = &line.parent
                    && let Some(span) =
                        keys.span(parent.as_bytes())
                            .map_err(|error| SegmentSourceError {
                                offset: record.offset,
                                reason: error.to_string(),
                            })?
                    && state.tip.is_some_and(|tip| span.offset < tip)
                {
                    observation.boundaries.push(SegmentBoundary::RolledBackTo {
                        key: parent.clone().into_bytes(),
                    });
                    state.open = false;
                    state.pending = None;
                }
                observation
                    .boundaries
                    .push(Self::start(state, &line.id, record.offset));
                state.tip = Some(record.offset);
            }
            "a" => {
                let hinted = self
                    .starts
                    .lock()
                    .unwrap_or_else(std::sync::PoisonError::into_inner)
                    .contains(&line.id);
                if hinted || !state.open || state.pending.is_some() {
                    observation
                        .boundaries
                        .push(Self::start(state, &line.id, record.offset));
                }
                state.tip = Some(record.offset);
            }
            "w" => {
                if state.pending.is_none() {
                    let before = state.clone();
                    state.pending = Some((record.offset, Box::new(before)));
                }
            }
            "x" => {
                if state.open {
                    observation
                        .boundaries
                        .push(SegmentBoundary::Ended { completed: false });
                }
                state.open = false;
            }
            "r" => observation.boundaries.push(SegmentBoundary::Renamed {
                turn_id: line.id.clone(),
            }),
            _ => {}
        }
        Ok(observation)
    }

    fn merge_fact(&self, _key: &[u8], recorded: &[u8], observed: &[u8]) -> Vec<u8> {
        recorded.max(observed).to_vec()
    }
}

/// Turn ids with the ids of the records each range holds.
type Turns = Vec<(String, Vec<String>)>;

struct Fixture {
    _directory: tempfile::TempDir,
    store: SegmentStore,
    path: std::path::PathBuf,
}

impl Fixture {
    fn new() -> Result<Self, Box<dyn std::error::Error>> {
        let directory = tempfile::tempdir()?;
        let database = companion_host::database::open(directory.path().join("index.redb"), "test")?;
        let store = SegmentStore::attach(database, std::sync::Arc::new(NoThreads), TABLES)?;
        let path = directory.path().join("file.jsonl");
        std::fs::write(&path, "")?;
        Ok(Self {
            _directory: directory,
            store,
            path,
        })
    }

    fn append(&self, lines: &[&str]) -> Result<(), std::io::Error> {
        use std::io::Write;
        let mut file = std::fs::OpenOptions::new().append(true).open(&self.path)?;
        for line in lines {
            writeln!(file, "{line}")?;
        }
        Ok(())
    }

    fn index(&self, toy: &Toy) -> Result<SegmentReport, IndexError> {
        index_segments(&self.store, toy, &self.path, GROUP)
    }

    /// Every live turn: id and the ids of the records its range holds.
    fn turns(&self) -> Result<Turns, Box<dyn std::error::Error>> {
        let text = std::fs::read_to_string(&self.path)?;
        let state = self
            .store
            .index()
            .file_state(&file_id(&self.path))?
            .ok_or("checkpoint")?;
        let mut turns = Vec::new();
        for turn in self.store.turns_from(&file_id(&self.path), 0)? {
            let end = if turn.end_offset == 0 {
                state.indexed_bytes
            } else {
                turn.end_offset
            };
            let start = usize::try_from(turn.start_offset)?;
            let range = text.get(start..usize::try_from(end)?).ok_or("range")?;
            let ids = range
                .lines()
                .map(|line| serde_json::from_str::<Line>(line).map(|line| line.id))
                .collect::<Result<Vec<_>, _>>()?;
            turns.push((turn.id, ids));
        }
        Ok(turns)
    }
}

fn turn(id: &str, records: &[&str]) -> (String, Vec<String>) {
    (
        id.to_owned(),
        records.iter().map(|record| (*record).to_owned()).collect(),
    )
}

#[test]
fn appended_records_continue_the_open_turn_from_the_checkpoint()
-> Result<(), Box<dyn std::error::Error>> {
    let fixture = Fixture::new()?;
    let toy = Toy::default();
    fixture.append(&[r#"{"t":"p","id":"p1"}"#, r#"{"t":"a","id":"a1"}"#])?;
    let first = fixture.index(&toy)?;
    assert!(first.reset);
    assert_eq!(fixture.turns()?, [turn("p1", &["p1", "a1"])]);

    fixture.append(&[r#"{"t":"a","id":"a2"}"#, r#"{"t":"p","id":"p2"}"#])?;
    let observed = toy.observed();
    let second = fixture.index(&toy)?;
    assert_eq!(
        toy.observed() - observed,
        2,
        "only the appended records are read"
    );
    assert!(!second.reset);
    assert_eq!(
        second
            .changed
            .iter()
            .map(|turn| turn.id.as_str())
            .collect::<Vec<_>>(),
        ["p1", "p2"]
    );
    assert_eq!(
        fixture.turns()?,
        [turn("p1", &["p1", "a1", "a2"]), turn("p2", &["p2"])]
    );

    // An echo of the same bytes reads nothing.
    let observed = toy.observed();
    assert_eq!(fixture.index(&toy)?, SegmentReport::default());
    assert_eq!(toy.observed(), observed);
    Ok(())
}

#[test]
fn a_turn_starts_at_the_wake_before_the_record_that_proves_it()
-> Result<(), Box<dyn std::error::Error>> {
    let fixture = Fixture::new()?;
    let toy = Toy::default();
    fixture.append(&[
        r#"{"t":"p","id":"p1"}"#,
        r#"{"t":"x","id":"x1"}"#,
        r#"{"t":"w","id":"w1"}"#,
    ])?;
    fixture.index(&toy)?;
    // The wake waits: it belongs to no turn yet.
    assert_eq!(fixture.turns()?, [turn("p1", &["p1", "x1"])]);
    fixture.append(&[r#"{"t":"w","id":"w2"}"#, r#"{"t":"a","id":"a2"}"#])?;
    fixture.index(&toy)?;
    assert_eq!(
        fixture.turns()?,
        [turn("p1", &["p1", "x1"]), turn("a2", &["w1", "w2", "a2"])]
    );
    Ok(())
}

#[test]
fn a_rewind_removes_the_turns_after_the_record_it_returns_to_and_cuts_its_turn()
-> Result<(), Box<dyn std::error::Error>> {
    let fixture = Fixture::new()?;
    let toy = Toy::default();
    fixture.append(&[
        r#"{"t":"p","id":"p1"}"#,
        r#"{"t":"a","id":"a1"}"#,
        r#"{"t":"a","id":"a1b"}"#,
        r#"{"t":"p","id":"p2"}"#,
        r#"{"t":"a","id":"a2"}"#,
    ])?;
    fixture.index(&toy)?;
    // In a later scan the person returns to a1 and asks again.
    fixture.append(&[r#"{"t":"p","id":"p3","parent":"a1"}"#])?;
    let report = fixture.index(&toy)?;
    assert_eq!(
        report
            .removed
            .iter()
            .map(|turn| turn.id.as_str())
            .collect::<Vec<_>>(),
        ["p2"]
    );
    assert_eq!(
        fixture.turns()?,
        [turn("p1", &["p1", "a1"]), turn("p3", &["p3"])]
    );
    // The removed turn stays removed when its file is rescanned past it.
    let report = reindex_segments_from(&fixture.store, &toy, &fixture.path, GROUP, u64::MAX)?;
    assert!(report.changed.iter().all(|turn| turn.id != "p2"));
    assert_eq!(
        fixture.turns()?,
        [turn("p1", &["p1", "a1"]), turn("p3", &["p3"])]
    );
    Ok(())
}

#[test]
fn a_late_hint_is_repaired_by_rescanning_from_the_turn_before_its_record()
-> Result<(), Box<dyn std::error::Error>> {
    let fixture = Fixture::new()?;
    let toy = Toy::default();
    fixture.append(&[
        r#"{"t":"p","id":"p0"}"#,
        r#"{"t":"p","id":"p1"}"#,
        r#"{"t":"a","id":"a1"}"#,
        r#"{"t":"a","id":"a2"}"#,
        r#"{"t":"a","id":"a3"}"#,
    ])?;
    fixture.index(&toy)?;
    assert_eq!(
        fixture.turns()?,
        [turn("p0", &["p0"]), turn("p1", &["p1", "a1", "a2", "a3"])]
    );
    // The hint that a2 started its own turn arrives after the scan.
    toy.starts
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .insert("a2".into());
    let span = fixture
        .store
        .record_span(&file_id(&fixture.path), b"a2")?
        .ok_or("a2 is keyed")?;
    let observed = toy.observed();
    let report = reindex_segments_from(&fixture.store, &toy, &fixture.path, GROUP, span.offset)?;
    assert_eq!(toy.observed() - observed, 4, "p0 is not read again");
    assert_eq!(
        fixture.turns()?,
        [
            turn("p0", &["p0"]),
            turn("p1", &["p1", "a1"]),
            turn("a2", &["a2", "a3"])
        ]
    );
    let changed = report
        .changed
        .iter()
        .map(|turn| turn.id.as_str())
        .collect::<Vec<_>>();
    assert!(changed.contains(&"p1") && changed.contains(&"a2"));
    assert!(
        !changed.contains(&"p0"),
        "a turn before the rescan is unchanged"
    );
    assert!(report.removed.is_empty());

    // Withdrawing it merges the turns again, the earlier one reopened.
    toy.starts
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .clear();
    let report = reindex_segments_from(&fixture.store, &toy, &fixture.path, GROUP, span.offset)?;
    assert_eq!(
        fixture.turns()?,
        [turn("p0", &["p0"]), turn("p1", &["p1", "a1", "a2", "a3"])]
    );
    assert_eq!(
        report
            .removed
            .iter()
            .map(|turn| turn.id.as_str())
            .collect::<Vec<_>>(),
        ["a2"]
    );
    Ok(())
}

#[test]
fn a_renamed_turn_is_found_by_its_new_id_only() -> Result<(), Box<dyn std::error::Error>> {
    let fixture = Fixture::new()?;
    let toy = Toy::default();
    fixture.append(&[r#"{"t":"p","id":"p1"}"#, r#"{"t":"r","id":"turn-1"}"#])?;
    let report = fixture.index(&toy)?;
    assert_eq!(
        report
            .changed
            .iter()
            .map(|turn| turn.id.as_str())
            .collect::<Vec<_>>(),
        ["turn-1"]
    );
    let id = file_id(&fixture.path);
    assert!(fixture.store.index().turn_by_id(&id, "p1")?.is_none());
    assert_eq!(
        fixture
            .store
            .index()
            .turn_by_id(&id, "turn-1")?
            .map(|turn| turn.start_offset),
        Some(0)
    );
    Ok(())
}

#[test]
fn facts_merge_across_scans_and_rescans_keep_them() -> Result<(), Box<dyn std::error::Error>> {
    let fixture = Fixture::new()?;
    let toy = Toy::default();
    fixture.append(&[r#"{"t":"p","id":"p1","fact":["agent","2"]}"#])?;
    fixture.index(&toy)?;
    fixture.append(&[r#"{"t":"a","id":"a1","fact":["agent","1"]}"#])?;
    fixture.index(&toy)?;
    assert_eq!(fixture.store.fact(&GROUP, b"agent")?, Some(b"2".to_vec()));
    fixture.append(&[r#"{"t":"a","id":"a2","fact":["agent","3"]}"#])?;
    fixture.index(&toy)?;
    reindex_segments_from(&fixture.store, &toy, &fixture.path, GROUP, 0)?;
    assert_eq!(fixture.store.fact(&GROUP, b"agent")?, Some(b"3".to_vec()));
    Ok(())
}

#[test]
fn a_rewritten_file_is_indexed_again_from_its_first_byte() -> Result<(), Box<dyn std::error::Error>>
{
    let fixture = Fixture::new()?;
    let toy = Toy::default();
    fixture.append(&[r#"{"t":"p","id":"p1"}"#, r#"{"t":"p","id":"p2"}"#])?;
    fixture.index(&toy)?;
    std::fs::write(&fixture.path, "{\"t\":\"p\",\"id\":\"q1\"}\n")?;
    let report = fixture.index(&toy)?;
    assert!(report.reset);
    assert_eq!(
        report
            .removed
            .iter()
            .map(|turn| turn.id.as_str())
            .collect::<Vec<_>>(),
        ["p1", "p2"]
    );
    assert_eq!(fixture.turns()?, [turn("q1", &["q1"])]);
    assert!(
        fixture
            .store
            .record_span(&file_id(&fixture.path), b"p2")?
            .is_none()
    );
    Ok(())
}

#[test]
fn a_partial_last_record_waits_for_its_newline() -> Result<(), Box<dyn std::error::Error>> {
    let fixture = Fixture::new()?;
    let toy = Toy::default();
    std::fs::write(
        &fixture.path,
        "{\"t\":\"p\",\"id\":\"p1\"}\n{\"t\":\"a\",\"id\"",
    )?;
    fixture.index(&toy)?;
    assert_eq!(fixture.turns()?, [turn("p1", &["p1"])]);
    fixture.append(&[r#":"a1"}"#])?;
    fixture.index(&toy)?;
    assert_eq!(fixture.turns()?, [turn("p1", &["p1", "a1"])]);
    Ok(())
}
