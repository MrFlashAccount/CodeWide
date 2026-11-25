//! One indexed turn read back from its byte range: the rows of the range
//! replayed with the transcript's own classification and boundary rule from
//! the state the turn started in, then through the live `TurnBuilder`. Only
//! the range is read; memory is the turn's, never the file's.

use std::{
    collections::HashSet,
    fs::File,
    io::{BufRead, BufReader, Read},
};

use agent_core::model::AgentTurn;
use serde_json::Value;

use super::source::{Conversation, ScanState};
use crate::transcript::{
    chain::{queued_command, queued_prompt},
    entries::history_entries_after,
    json::{JsonRecord, is_true, str_of},
    reconstruct::{HistoryContext, replay_running_segment, replay_segment},
    segments::{HistorySegment, SegmentHints, history_segments_after},
    turn_index::TurnRecord,
};

/// What reading one turn needs besides its bytes.
pub(crate) struct TurnRead<'a> {
    pub conversation: Conversation,
    /// The state the turn started from.
    pub resume: ScanState,
    pub hints: &'a SegmentHints,
    pub records: &'a [TurnRecord],
    pub context: &'a HistoryContext,
    /// Whether Claude delivered the queued prompt stored in the attachment
    /// row `uuid` at `offset` into a running turn.
    pub delivered: &'a dyn Fn(&str, u64) -> bool,
    /// Whether a row with this uuid is stored in the file.
    pub stored: &'a dyn Fn(&str) -> bool,
    /// A sub-agent still works: its last turn stays open.
    pub running: bool,
}

/// One row of the range, with its offset.
struct RangeRow {
    offset: u64,
    row: JsonRecord,
}

fn range_rows(file: &File, start: u64, end: u64) -> std::io::Result<Vec<RangeRow>> {
    let mut handle = file.try_clone()?;
    agent_index::file::seek_to(&mut handle, start)?;
    let mut reader = BufReader::new(handle.take(end.saturating_sub(start)));
    let mut rows = Vec::new();
    let mut line = Vec::new();
    let mut offset = start;
    loop {
        line.clear();
        let bytes = reader.read_until(b'\n', &mut line)?;
        if bytes == 0 {
            break;
        }
        // A malformed row is skipped, as Claude's own reader skips it.
        if let Ok(Value::Object(row)) = serde_json::from_slice::<Value>(&line) {
            rows.push(RangeRow { offset, row });
        }
        offset += bytes as u64;
    }
    Ok(rows)
}

fn is_main_level(row: &JsonRecord) -> bool {
    !is_true(row, "isSidechain") && row.get("teamName").is_none_or(Value::is_null)
}

/// The messages of a main-conversation range: its user, assistant and
/// system rows, with each delivered queued prompt as the user message it
/// was (`chain::active_branch`).
fn main_messages(rows: Vec<RangeRow>, read: &TurnRead<'_>) -> Vec<JsonRecord> {
    let own = rows
        .iter()
        .filter_map(|row| str_of(&row.row, "uuid").map(ToOwned::to_owned))
        .collect::<HashSet<_>>();
    let mut converted = HashSet::new();
    let mut messages = Vec::with_capacity(rows.len());
    for RangeRow { offset, row } in rows {
        if !is_main_level(&row) {
            continue;
        }
        if let Some(attachment) = queued_command(&row) {
            let Some(uuid) = str_of(&row, "uuid") else {
                continue;
            };
            let source = str_of(attachment, "source_uuid").filter(|source| !source.is_empty());
            if !(read.delivered)(uuid, offset)
                || source.is_some_and(|source| {
                    source != uuid && (own.contains(source) || (read.stored)(source))
                })
            {
                continue;
            }
            let mut seen = converted.iter().map(String::as_str).collect::<HashSet<_>>();
            if let Some(prompt) = queued_prompt(&row, attachment, &mut seen) {
                if let Some(uuid) = str_of(&prompt, "uuid") {
                    converted.insert(uuid.to_owned());
                }
                messages.push(prompt);
            }
            continue;
        }
        if matches!(str_of(&row, "type"), Some("user" | "assistant" | "system")) {
            messages.push(row);
        }
    }
    messages
}

/// The rows of a sub-agent transcript range: every user, assistant and
/// system row with a uuid.
fn sidecar_messages(rows: Vec<RangeRow>) -> Vec<JsonRecord> {
    rows.into_iter()
        .map(|row| row.row)
        .filter(|row| matches!(str_of(row, "type"), Some("user" | "assistant" | "system")))
        .filter(|row| str_of(row, "uuid").is_some())
        .collect()
}

/// One segment of segments the scan and this read disagree on (a hint that
/// changed since the scan): every entry kept, in order.
fn merged(segments: Vec<HistorySegment>) -> Option<HistorySegment> {
    let mut segments = segments.into_iter();
    let mut first = segments.next()?;
    for next in segments {
        let offset = first.entries.len();
        first
            .reports
            .extend(next.reports.into_iter().map(|mut report| {
                report.position += offset;
                report
            }));
        first.entries.extend(next.entries);
        first.interrupted = next.interrupted;
    }
    Some(first)
}

/// The segment stored in `start..end` of `file`; `None` when its rows hold
/// no entry.
fn read_segment(
    file: &File,
    start: u64,
    end: u64,
    read: &TurnRead<'_>,
) -> std::io::Result<Option<HistorySegment>> {
    let rows = range_rows(file, start, end)?;
    let messages = match read.conversation {
        Conversation::Main => main_messages(rows, read),
        Conversation::Sidecar => sidecar_messages(rows),
    };
    let messages = messages.iter().collect::<Vec<_>>();
    let entries = history_entries_after(
        &messages,
        read.resume.level(),
        read.resume.previous_system.clone(),
    );
    Ok(merged(history_segments_after(
        entries,
        read.hints,
        read.resume.open.clone(),
    )))
}

/// The turn stored in `start..end` of `file`; `None` when its rows hold no
/// entry (a turn whose only message turned out hidden).
///
/// # Errors
///
/// Returns an error when the file cannot be read.
pub(crate) fn read_turn(
    file: &File,
    start: u64,
    end: u64,
    read: &TurnRead<'_>,
) -> std::io::Result<Option<AgentTurn>> {
    let Some(segment) = read_segment(file, start, end, read)? else {
        return Ok(None);
    };
    Ok(Some(match read.conversation {
        Conversation::Main => replay_segment(&segment, read.records, read.context),
        Conversation::Sidecar if read.running => replay_running_segment(&segment, read.context),
        Conversation::Sidecar => replay_segment(&segment, &[], read.context),
    }))
}

/// The uuid of the last stored message of the turn in `start..end`: the
/// point a fork through that turn copies its session to.
///
/// # Errors
///
/// Returns an error when the file cannot be read.
pub(crate) fn read_turn_end(
    file: &File,
    start: u64,
    end: u64,
    read: &TurnRead<'_>,
) -> std::io::Result<Option<String>> {
    Ok(read_segment(file, start, end, read)?
        .and_then(|segment| segment.entries.last().map(|entry| entry.uuid().to_owned())))
}
