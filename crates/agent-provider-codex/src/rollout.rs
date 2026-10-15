//! Codex rollouts as an [`IndexSource`] of the shared offset index, and the
//! rollout-named entry points the rest of this crate reads through.
//!
//! The index mechanics (file witnesses, checkpoints, turn ranges, tail
//! bootstrap, backfill, reverse scans) live in `agent-index`; this module
//! knows the rollout record format: `session_meta` headers, `event_msg`
//! task boundaries, rollbacks, realtime transcript items and the command
//! output the content service proves.

use std::{fs::File, path::Path};

use agent_index::{Boundary, ContentEntry, IndexSource, RecordRef, TurnRef, scan};
use companion_host::thread_index::IndexedThreadMetadata;
use serde::Deserialize;
use serde_json::Value;

use crate::{
    history::SummaryProjectionState,
    rollout_content,
    rollout_store::{FileState, RolloutStore},
};

pub use agent_index::{
    FileWitness as RolloutWitness, IndexError, IndexReport, IndexedTurnPage, TailScanReport,
    TurnRefReport,
};

const TASK_BOUNDARY_NEEDLES: [&[u8]; 4] = [
    b"\"type\":\"task_started\"",
    b"\"type\":\"task_complete\"",
    b"\"type\":\"turn_aborted\"",
    b"\"type\":\"thread_rolled_back\"",
];
const REALTIME_TRANSCRIPT_NEEDLE: &[u8] = b"\"type\":\"transcript_segment\"";

/// The rollout record format for the shared index.
pub(crate) struct CodexRollouts;

/// The one source every rollout read and scan uses.
pub(crate) const ROLLOUTS: CodexRollouts = CodexRollouts;

impl IndexSource for CodexRollouts {
    type Summary = SummaryProjectionState;

    fn classify(&self, line: &[u8]) -> u8 {
        classify_record(line)
    }

    fn boundary_needles(&self) -> &[&[u8]] {
        &TASK_BOUNDARY_NEEDLES
    }

    fn boundary(&self, line: &[u8], _offset: u64) -> Result<Option<Boundary>, serde_json::Error> {
        let parsed: BoundaryEnvelope = serde_json::from_slice(line)?;
        Ok(match parsed.payload {
            BoundaryPayload::Started { turn_id } => Some(Boundary::Started(turn_id)),
            BoundaryPayload::Completed { turn_id } => Some(Boundary::Terminal {
                turn_id,
                completed: true,
            }),
            BoundaryPayload::Aborted { turn_id } => Some(Boundary::Terminal {
                turn_id,
                completed: false,
            }),
            BoundaryPayload::Rollback { num_turns } => Some(Boundary::Rollback(num_turns)),
            BoundaryPayload::Other => None,
        })
    }

    fn standalone_needle(&self) -> Option<&[u8]> {
        Some(REALTIME_TRANSCRIPT_NEEDLE)
    }

    fn standalone_turn(&self, line: &[u8]) -> Option<String> {
        realtime_transcript_id(line)
    }

    fn thread_metadata(
        &self,
        path: &Path,
        modified_at: i64,
        line: &[u8],
    ) -> Option<IndexedThreadMetadata> {
        thread_metadata_from_record(path, modified_at, line)
    }

    fn content(
        &self,
        path: &Path,
        file_id: [u8; 32],
        record: RecordRef,
        line: &[u8],
    ) -> Vec<ContentEntry> {
        rollout_content::entries_from_record(path, file_id, record, line)
    }

    fn summary(&self, turn_id: String) -> Self::Summary {
        SummaryProjectionState::new(turn_id)
    }
}

/// The witness of an open rollout handle.
///
/// # Errors
///
/// Returns an error when the rollout cannot be read.
pub(crate) fn rollout_witness_from_file(
    file: &File,
    file_bytes: u64,
) -> Result<RolloutWitness, IndexError> {
    Ok(RolloutWitness::from_file(file, file_bytes)?)
}

/// Whether the rollout still matches `witness`: unchanged bytes and no
/// rollback appended after them.
///
/// # Errors
///
/// Returns an error when the rollout cannot be read.
pub(crate) fn rollout_witness_matches(
    file: &File,
    file_bytes: u64,
    witness: &RolloutWitness,
) -> Result<bool, IndexError> {
    scan::witness_matches(&ROLLOUTS, file, file_bytes, witness)
}

/// Advances the contiguous hot index for `path`.
///
/// # Errors
///
/// Returns an error when the rollout cannot be read, an individual record is
/// larger than the index format supports, or the crash-safe store cannot
/// commit a batch.
pub fn index_rollout(store: &RolloutStore, path: &Path) -> Result<IndexReport, IndexError> {
    scan::index_file(store, &ROLLOUTS, path)
}

/// Expands a tail-first index toward byte zero by one bounded turn range.
///
/// # Errors
///
/// Returns an error when the rollout changes incompatibly, a record boundary
/// is malformed, or the durable index transaction fails.
pub fn backfill_rollout_prefix(
    store: &RolloutStore,
    path: &Path,
) -> Result<IndexReport, IndexError> {
    scan::backfill_prefix(store, &ROLLOUTS, path)
}

/// Advances durable coverage through a semantic anchor and its requested
/// older neighbors.
pub(crate) fn index_rollout_through_anchor(
    store: &RolloutStore,
    path: &Path,
    anchor_id: &str,
    older_limit: usize,
) -> Result<IndexReport, IndexError> {
    scan::index_through_anchor(store, &ROLLOUTS, path, anchor_id, older_limit)
}

/// Completes the historical prefix for consumers that require every source
/// record, such as attachment and changed-file projections.
///
/// # Errors
///
/// Returns an error when tail advancement or any bounded prefix step fails.
pub fn index_rollout_fully(store: &RolloutStore, path: &Path) -> Result<IndexReport, IndexError> {
    scan::index_fully(store, &ROLLOUTS, path)
}

/// Reads only the canonical session header and updates the shared thread
/// metadata index. This primes parent-child lookups without loading history.
///
/// # Errors
///
/// Returns an error when the rollout header cannot be read or the metadata
/// index cannot be committed.
pub fn index_rollout_metadata(store: &RolloutStore, path: &Path) -> Result<(), IndexError> {
    scan::index_metadata(store, &ROLLOUTS, path)
}

/// Reads only the canonical session header without touching the index.
///
/// # Errors
///
/// Returns an error when the rollout header cannot be read.
pub fn read_rollout_metadata(path: &Path) -> Result<Option<IndexedThreadMetadata>, IndexError> {
    scan::read_metadata(&ROLLOUTS, path)
}

#[must_use]
pub fn rollout_file_id(path: &Path) -> [u8; 32] {
    agent_index::file_id(path)
}

/// See [`scan::current_indexed_turns_from_file`].
pub(crate) fn current_indexed_turns_from_file(
    store: &RolloutStore,
    path: &Path,
    file: &File,
    file_bytes: u64,
    before_offset: Option<u64>,
    limit: usize,
) -> Result<Option<IndexedTurnPage>, IndexError> {
    scan::current_indexed_turns_from_file(store, path, file, file_bytes, before_offset, limit)
}

/// See [`scan::current_indexed_anchor_from_file`].
pub(crate) fn current_indexed_anchor_from_file(
    store: &RolloutStore,
    path: &Path,
    file: &File,
    file_bytes: u64,
    turn_id: &str,
) -> Result<Option<TurnRef>, IndexError> {
    scan::current_indexed_anchor_from_file(store, path, file, file_bytes, turn_id)
}

/// See [`scan::current_indexed_coverage_from_file`].
pub(crate) fn current_indexed_coverage_from_file(
    store: &RolloutStore,
    path: &Path,
    file: &File,
    file_bytes: u64,
) -> Result<Option<FileState>, IndexError> {
    scan::current_indexed_coverage_from_file(store, path, file, file_bytes)
}

/// See [`scan::frozen_indexed_coverage_from_file`].
pub(crate) fn frozen_indexed_coverage_from_file(
    store: &RolloutStore,
    path: &Path,
    file: &File,
    end: u64,
) -> Result<Option<FileState>, IndexError> {
    scan::frozen_indexed_coverage_from_file(store, path, file, end)
}

/// See [`scan::frozen_indexed_turns_from_file`].
pub(crate) fn frozen_indexed_turns_from_file(
    store: &RolloutStore,
    path: &Path,
    file: &File,
    end: u64,
    before: u64,
    limit: usize,
) -> Result<Option<IndexedTurnPage>, IndexError> {
    scan::frozen_indexed_turns_from_file(store, path, file, end, before, limit)
}

/// See [`scan::frozen_indexed_anchor_from_file`].
pub(crate) fn frozen_indexed_anchor_from_file(
    store: &RolloutStore,
    path: &Path,
    file: &File,
    end: u64,
    turn_id: &str,
) -> Result<Option<TurnRef>, IndexError> {
    scan::frozen_indexed_anchor_from_file(store, path, file, end, turn_id)
}

/// Discovers the newest turn spans directly from the durable JSONL tail.
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
    scan::scan_tail_turns(&ROLLOUTS, path, before_offset, limit)
}

/// See [`scan::scan_tail_turns_from_file`].
pub(crate) fn scan_tail_turns_from_file(
    file: &File,
    file_bytes: u64,
    before_offset: Option<u64>,
    limit: usize,
) -> Result<TailScanReport, IndexError> {
    scan::scan_tail_turns_from_file(&ROLLOUTS, file, file_bytes, before_offset, limit)
}

/// See [`scan::scan_frozen_tail_turns_from_file`].
pub(crate) fn scan_frozen_tail_turns_from_file(
    file: &File,
    end: u64,
    before_offset: Option<u64>,
    limit: usize,
) -> Result<TailScanReport, IndexError> {
    scan::scan_frozen_tail_turns_from_file(&ROLLOUTS, file, end, before_offset, limit)
}

/// See [`scan::scan_turns_after_from_file`].
pub(crate) fn scan_turns_after_from_file(
    file: &File,
    file_bytes: u64,
    anchor_id: &str,
    limit: usize,
) -> Result<Option<Vec<TurnRef>>, IndexError> {
    scan::scan_turns_after_from_file(&ROLLOUTS, file, file_bytes, anchor_id, limit)
}

/// See [`scan::scan_turns_before_from_file`].
pub(crate) fn scan_turns_before_from_file(
    file: &File,
    file_bytes: u64,
    anchor_id: &str,
    limit: usize,
) -> Result<Option<Vec<TurnRef>>, IndexError> {
    scan::scan_turns_before_from_file(&ROLLOUTS, file, file_bytes, anchor_id, limit)
}

/// See [`scan::scan_frozen_turns_before_from_file`].
pub(crate) fn scan_frozen_turns_before_from_file(
    file: &File,
    end: u64,
    anchor_id: &str,
    limit: usize,
) -> Result<Option<Vec<TurnRef>>, IndexError> {
    scan::scan_frozen_turns_before_from_file(&ROLLOUTS, file, end, anchor_id, limit)
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
        // Codex reports a child's status through its own live thread events.
        running: None,
    })
}

fn realtime_transcript_id(line: &[u8]) -> Option<String> {
    memchr::memmem::find(line, REALTIME_TRANSCRIPT_NEEDLE)?;
    let envelope = serde_json::from_slice::<Value>(line).ok()?;
    if envelope.get("type").and_then(Value::as_str) != Some("realtime_item") {
        return None;
    }
    let payload = envelope.get("payload")?;
    if payload.get("type").and_then(Value::as_str) != Some("transcript_segment")
        || !matches!(
            payload.get("role").and_then(Value::as_str),
            Some("user" | "assistant")
        )
        || payload
            .get("text")
            .and_then(Value::as_str)
            .is_none_or(|text| text.trim().is_empty())
    {
        return None;
    }
    payload
        .get("id")
        .and_then(Value::as_str)
        .filter(|id| !id.is_empty())
        .map(ToOwned::to_owned)
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

#[cfg(test)]
mod tests {
    use std::io::Write;

    use agent_index::{Boundary, IndexSource};

    use super::{
        ROLLOUTS, classify_record, current_indexed_turns_from_file, frozen_indexed_turns_from_file,
        index_rollout, index_rollout_metadata, index_rollout_through_anchor, rollout_file_id,
        rollout_witness_from_file, rollout_witness_matches, scan_tail_turns_from_file,
        scan_turns_after_from_file, scan_turns_before_from_file,
    };
    use crate::history::project_summary_turn;
    use crate::rollout_store::TurnRef;

    fn task_boundary(line: &[u8]) -> Result<Option<Boundary>, serde_json::Error> {
        ROLLOUTS.boundary(line, 0)
    }

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
            task_boundary(started)?,
            Some(Boundary::Started(id)) if id == "turn-1"
        ));
        assert!(matches!(
            task_boundary(completed)?,
            Some(Boundary::Terminal { turn_id, completed: true }) if turn_id == "turn-1"
        ));
        let aborted = br#"{"timestamp":"now","type":"event_msg","payload":{"type":"turn_aborted","turn_id":"turn-2"}}"#;
        assert!(matches!(
            task_boundary(aborted)?,
            Some(Boundary::Terminal { turn_id, completed: false }) if turn_id == "turn-2"
        ));
        Ok(())
    }

    #[test]
    fn canonical_voice_transcripts_join_active_tasks_and_form_standalone_turns()
    -> Result<(), Box<dyn std::error::Error>> {
        let directory = tempfile::tempdir()?;
        let path = directory.path().join("rollout.jsonl");
        let mut writer = std::fs::File::create(&path)?;
        for line in [
            r#"{"type":"realtime_item","payload":{"type":"transcript_segment","id":"voice-before","realtime_session_id":"session","role":"user","text":"Before"}}"#,
            r#"{"type":"realtime_item","payload":{"type":"transcript_segment","id":"assistant-before","realtime_session_id":"session","role":"assistant","text":"Hello"}}"#,
            r#"{"type":"event_msg","payload":{"type":"task_started","turn_id":"task"}}"#,
            r#"{"type":"realtime_item","payload":{"type":"transcript_segment","id":"voice-inside","realtime_session_id":"session","role":"user","text":"Inside"}}"#,
            r#"{"type":"event_msg","payload":{"type":"task_complete","turn_id":"task","last_agent_message":"Answer"}}"#,
            r#"{"type":"realtime_item","payload":{"type":"transcript_segment","id":"voice-after","realtime_session_id":"session","role":"user","text":"After"}}"#,
            r#"{"type":"realtime_item","payload":{"type":"transcript_segment","id":"assistant-after","realtime_session_id":"session","role":"assistant","text":"Goodbye"}}"#,
        ] {
            writeln!(writer, "{line}")?;
        }
        writer.sync_all()?;

        let file = std::fs::File::open(&path)?;
        let bytes = file.metadata()?.len();
        let cold = scan_tail_turns_from_file(&file, bytes, None, 10)?;
        assert_eq!(
            cold.turns
                .iter()
                .map(|turn| turn.id.as_str())
                .collect::<Vec<_>>(),
            [
                "assistant-after",
                "voice-after",
                "task",
                "assistant-before",
                "voice-before"
            ]
        );

        let task = cold
            .turns
            .iter()
            .find(|turn| turn.id == "task")
            .ok_or("task turn")?;
        let task = project_summary_turn(
            &path,
            &TurnRef {
                id: task.id.clone(),
                start_offset: task.start_offset,
                end_offset: task.end_offset,
                completed: task.completed,
            },
        )?;
        assert_eq!(task["items"][0]["id"], "voice-inside");
        assert_eq!(task["items"][0]["content"][0]["text"], "Inside");

        let standalone = cold
            .turns
            .iter()
            .find(|turn| turn.id == "voice-after")
            .ok_or("standalone voice turn")?;
        let standalone = project_summary_turn(
            &path,
            &TurnRef {
                id: standalone.id.clone(),
                start_offset: standalone.start_offset,
                end_offset: standalone.end_offset,
                completed: standalone.completed,
            },
        )?;
        assert_eq!(standalone["status"], "completed");
        assert_eq!(standalone["items"][0]["id"], "voice-after");
        assert_eq!(standalone["items"][0]["content"][0]["text"], "After");

        let assistant = cold
            .turns
            .iter()
            .find(|turn| turn.id == "assistant-after")
            .ok_or("standalone assistant turn")?;
        let assistant = project_summary_turn(
            &path,
            &TurnRef {
                id: assistant.id.clone(),
                start_offset: assistant.start_offset,
                end_offset: assistant.end_offset,
                completed: assistant.completed,
            },
        )?;
        assert_eq!(assistant["status"], "completed");
        assert_eq!(assistant["items"][0]["type"], "agentMessage");
        assert_eq!(assistant["items"][0]["id"], "assistant-after");
        assert_eq!(assistant["items"][0]["text"], "Goodbye");

        let store = crate::test_support::open_rollout_store(directory.path().join("index.redb"))?;
        index_rollout(&store, &path)?;
        assert_eq!(
            store
                .turns_desc(&rollout_file_id(&path), None, 10)?
                .iter()
                .map(|turn| turn.id.as_str())
                .collect::<Vec<_>>(),
            [
                "assistant-after",
                "voice-after",
                "task",
                "assistant-before",
                "voice-before"
            ]
        );
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
        let store = crate::test_support::open_rollout_store(directory.path().join("index.redb"))?;
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
        let store = crate::test_support::open_rollout_store(directory.path().join("index.redb"))?;
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
        let store = crate::test_support::open_rollout_store(directory.path().join("index.redb"))?;
        for path in [&root, &child, &grandchild] {
            index_rollout_metadata(&store, path)?;
        }

        let descendants = store.threads().thread_descendants("root")?;
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

    fn write_turns(path: &std::path::Path, ids: &[String], padding: usize) -> std::io::Result<u64> {
        let mut writer = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(path)?;
        let filler = "x".repeat(padding);
        for id in ids {
            writeln!(
                writer,
                r#"{{"type":"event_msg","payload":{{"type":"task_started","turn_id":"{id}"}}}}"#
            )?;
            writeln!(
                writer,
                r#"{{"type":"event_msg","payload":{{"type":"agent_message","message":"{filler}","phase":"final_answer"}}}}"#
            )?;
            writeln!(
                writer,
                r#"{{"type":"event_msg","payload":{{"type":"task_complete","turn_id":"{id}"}}}}"#
            )?;
        }
        writer.sync_all()?;
        Ok(std::fs::metadata(path)?.len())
    }

    fn ids(prefix: &str, range: std::ops::Range<usize>) -> Vec<String> {
        range.map(|index| format!("{prefix}{index}")).collect()
    }

    #[test]
    fn a_frozen_prefix_stays_indexed_while_its_rollout_keeps_growing()
    -> Result<(), Box<dyn std::error::Error>> {
        let directory = tempfile::tempdir()?;
        let path = directory.path().join("rollout.jsonl");
        let end = write_turns(&path, &ids("t", 0..3), 16)?;
        let store = crate::test_support::open_rollout_store(directory.path().join("index.redb"))?;
        index_rollout(&store, &path)?;
        // The base thread goes on after the fork point without being reindexed yet.
        let grown = write_turns(&path, &ids("t", 3..4), 16)?;
        let file = std::fs::File::open(&path)?;

        assert!(current_indexed_turns_from_file(&store, &path, &file, grown, None, 10)?.is_none());
        let page = frozen_indexed_turns_from_file(&store, &path, &file, end, end, 10)?
            .ok_or("frozen prefix should be served from the index")?;
        assert_eq!(
            page.turns
                .iter()
                .map(|turn| turn.id.as_str())
                .collect::<Vec<_>>(),
            ["t2", "t1", "t0"]
        );
        assert!(!page.has_more);

        // A rewrite of the indexed bytes is never trusted.
        let rewritten = std::fs::read(&path)?
            .iter()
            .map(|byte| if *byte == b'x' { b'y' } else { *byte })
            .collect::<Vec<_>>();
        std::fs::write(&path, rewritten)?;
        let file = std::fs::File::open(&path)?;
        assert!(frozen_indexed_turns_from_file(&store, &path, &file, end, end, 10)?.is_none());
        Ok(())
    }
}
