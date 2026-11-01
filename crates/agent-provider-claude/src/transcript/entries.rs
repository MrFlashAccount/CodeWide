//! Classification of the messages of one conversation level into the few
//! entry kinds the history needs. Structural and total: anything
//! unrecognized is skipped. Pure.
//!
//! - An assistant message, or a user message carrying `tool_result` blocks,
//!   is a frame for the turn builder (the same classification as live). An
//!   assistant message that is no model answer (the placeholder Claude writes
//!   for an interrupted turn) is skipped, so it opens no turn.
//! - A user message whose `origin` is not a person (`origin.kind` other than
//!   `human`: task notification, peer message) wakes the agent: it is never
//!   shown as a user message. A task notification carries the background
//!   task reports (shown as `taskNotification` items) and a sub-agent's
//!   final status. Interactive Claude Code stamps a person's prompts with
//!   `origin: {kind: "human"}`; SDK-driven sessions store them without one.
//! - `isQueuedCommand` marks a message Claude delivered while the agent was
//!   busy (queued prompt, notification): it belongs to the running turn.
//!   `chain` turns a `queued_command` attachment Claude delivered into such a
//!   message (a task report's `commandMode: task-notification` gives its
//!   origin).
//! - `[Request interrupted by user…]` ends the current turn as interrupted.
//! - A meta message ending with Claude's resume prompt (written when Claude
//!   resumes an interrupted turn, or offered for `turn.continue`) resumes the
//!   conversation: it is never shown, but starts a turn.
//! - The compact summary marks a compaction; the system message right before
//!   it is the compact boundary, whose uuid anchors the turn the live
//!   compaction ran in.
//! - Meta messages (`isMeta`: injected reminders, skill bodies) and
//!   command/markup echoes (`<command-name>`, `<local-command-stdout>`,
//!   `<system-reminder>`…) are hidden; every other top-level user message is
//!   a prompt, with its text and image blocks.
//! - Only messages of one conversation level are read: the main conversation
//!   (`parent_tool_use_id` null, as live) or one sub-agent transcript (its
//!   spawning tool call). Stored sidecar rows carry no `parent_tool_use_id`;
//!   the caller reads them as their own level.

use agent_core::model::UserContent;
use serde_json::Value;

use super::{
    frames::{ClaudeFrame, classify_message, origin_kind},
    json::{JsonRecord, elements, is_true, is_true2, record, record_of, str_of},
    task_reports::{TaskReport, stored_task_reports},
};

/// The prompt that opens a replacement session's history prefix; it is not
/// the person's first prompt.
pub const HISTORY_HEADER: &str = "[Historical conversation from this thread]";
const INTERRUPT_MARKER: &str = "[Request interrupted by user";
/// The prompt Claude resumes an interrupted turn with, as a meta message.
pub const RESUME_PROMPT: &str = "Continue from where you left off.";

/// One classified stored message.
#[derive(Clone, Debug, PartialEq)]
pub enum HistoryEntry {
    Prompt {
        content: Vec<UserContent>,
        /// Delivered while the agent was busy: part of the running turn.
        queued: bool,
        timestamp_ms: i64,
        uuid: String,
    },
    Interrupt {
        timestamp_ms: i64,
        uuid: String,
    },
    /// Claude's resume prompt: resumes the conversation without a prompt.
    Resume {
        timestamp_ms: i64,
        uuid: String,
    },
    Wake {
        /// The background task reports it carries; empty for other wakes (peer messages).
        reports: Vec<TaskReport>,
        /// Delivered while the agent was busy: part of the running turn.
        queued: bool,
        timestamp_ms: i64,
        uuid: String,
    },
    Compaction {
        timestamp_ms: i64,
        uuid: String,
    },
    Frame {
        frame: ClaudeFrame,
        timestamp_ms: i64,
        uuid: String,
    },
}

impl HistoryEntry {
    #[must_use]
    pub fn uuid(&self) -> &str {
        match self {
            Self::Prompt { uuid, .. }
            | Self::Interrupt { uuid, .. }
            | Self::Resume { uuid, .. }
            | Self::Wake { uuid, .. }
            | Self::Compaction { uuid, .. }
            | Self::Frame { uuid, .. } => uuid,
        }
    }

    #[must_use]
    pub fn timestamp_ms(&self) -> i64 {
        match self {
            Self::Prompt { timestamp_ms, .. }
            | Self::Interrupt { timestamp_ms, .. }
            | Self::Resume { timestamp_ms, .. }
            | Self::Wake { timestamp_ms, .. }
            | Self::Compaction { timestamp_ms, .. }
            | Self::Frame { timestamp_ms, .. } => *timestamp_ms,
        }
    }
}

/// Command echoes, local command output and injected reminders start with a tag.
fn is_markup(text: &str) -> bool {
    let trimmed = text.trim_start();
    let mut characters = trimmed.chars();
    if characters.next() != Some('<') {
        return false;
    }
    let Some(first) = characters.next() else {
        return false;
    };
    if !first.is_ascii_lowercase() {
        return false;
    }
    characters
        .find(|character| {
            !(character.is_ascii_alphanumeric() || *character == '_' || *character == '-')
        })
        .is_some_and(|character| character.is_whitespace() || character == '>')
}

/// Text and image blocks of a stored user message.
fn user_blocks(content: Option<&Value>) -> Vec<UserContent> {
    if let Some(text) = content.and_then(Value::as_str) {
        return vec![UserContent::Text {
            text: text.to_owned(),
        }];
    }
    elements(content)
        .iter()
        .filter_map(|block| {
            let block = record(block)?;
            match str_of(block, "type") {
                Some("text") => Some(UserContent::Text {
                    text: str_of(block, "text").unwrap_or_default().to_owned(),
                }),
                Some("image") => {
                    let source = record_of(block, "source")?;
                    let media_type = str_of(source, "media_type").unwrap_or("image/png");
                    let data = str_of(source, "data").unwrap_or_default();
                    Some(UserContent::Image {
                        url: format!("data:{media_type};base64,{data}"),
                    })
                }
                _ => None,
            }
        })
        .collect()
}

fn has_tool_result(content: Option<&Value>) -> bool {
    elements(content).iter().any(|block| {
        record(block).is_some_and(|block| str_of(block, "type") == Some("tool_result"))
    })
}

/// Whether a meta message carries Claude's resume prompt. Claude may prefix
/// an adapter message with a provenance line, and a replacement session's
/// first offer leads with the history prefix, so the prompt ends a block.
fn is_resume(content: &[UserContent]) -> bool {
    content.iter().any(|block| {
        matches!(block, UserContent::Text { text } if text.trim_end().ends_with(RESUME_PROMPT))
    })
}

fn first_text(content: &[UserContent]) -> &str {
    content
        .iter()
        .find_map(|block| match block {
            UserContent::Text { text } => Some(text.as_str()),
            UserContent::Image { .. } | UserContent::LocalImage { .. } => None,
        })
        .unwrap_or_default()
}

struct StoredMessage<'a> {
    raw: &'a JsonRecord,
    timestamp_ms: i64,
    uuid: &'a str,
}

/// Parses an RFC 3339 timestamp to milliseconds since the epoch.
#[must_use]
pub fn timestamp_ms(text: &str) -> Option<i64> {
    let parsed =
        time::OffsetDateTime::parse(text, &time::format_description::well_known::Rfc3339).ok()?;
    i64::try_from(parsed.unix_timestamp_nanos() / 1_000_000).ok()
}

/// A message that wakes the agent without a person, or `None` for a person's message.
fn wake_entry(message: &StoredMessage<'_>, text: &str) -> Option<HistoryEntry> {
    let origin = origin_kind(message.raw)?;
    if origin == "human" {
        return None;
    }
    Some(HistoryEntry::Wake {
        reports: if origin == "task-notification" {
            stored_task_reports(text)
        } else {
            Vec::new()
        },
        queued: is_true(message.raw, "isQueuedCommand"),
        timestamp_ms: message.timestamp_ms,
        uuid: message.uuid.to_owned(),
    })
}

/// The task reports of every task-notification user message among `rows`,
/// with the message's time, whichever branch of the session it sits on. A
/// report is a fact about its agent, not part of a conversation: one stored
/// before a compaction or on an abandoned branch still settles the agent
/// whose spawning item a sub-agent transcript keeps.
#[must_use]
pub fn stored_task_reports_of_rows(rows: &[Value]) -> Vec<(TaskReport, i64)> {
    rows.iter()
        .filter_map(Value::as_object)
        .filter(|row| str_of(row, "type") == Some("user"))
        .filter(|row| origin_kind(row) == Some("task-notification"))
        .filter_map(|row| {
            let timestamp_ms = str_of(row, "timestamp").and_then(self::timestamp_ms)?;
            let body = record_of(row, "message").and_then(|inner| inner.get("content"));
            let content = user_blocks(body);
            Some((first_text(&content).to_owned(), timestamp_ms))
        })
        .flat_map(|(text, timestamp_ms)| {
            stored_task_reports(&text)
                .into_iter()
                .map(move |report| (report, timestamp_ms))
        })
        .collect()
}

fn user_entry(message: &StoredMessage<'_>) -> Option<HistoryEntry> {
    let body = record_of(message.raw, "message").and_then(|inner| inner.get("content"));
    if has_tool_result(body) {
        return Some(HistoryEntry::Frame {
            frame: classify_message(message.raw),
            timestamp_ms: message.timestamp_ms,
            uuid: message.uuid.to_owned(),
        });
    }
    let content = user_blocks(body);
    let text = first_text(&content);
    if let Some(wake) = wake_entry(message, text) {
        return Some(wake);
    }
    if text.starts_with(INTERRUPT_MARKER) {
        return Some(HistoryEntry::Interrupt {
            timestamp_ms: message.timestamp_ms,
            uuid: message.uuid.to_owned(),
        });
    }
    if is_true2(message.raw, "isMeta", "is_meta") {
        return is_resume(&content).then(|| HistoryEntry::Resume {
            timestamp_ms: message.timestamp_ms,
            uuid: message.uuid.to_owned(),
        });
    }
    if is_true(message.raw, "isVisibleInTranscriptOnly") || is_markup(text) {
        return None;
    }
    let prompt = content
        .into_iter()
        .filter(|block| !matches!(block, UserContent::Text { text } if text.starts_with(HISTORY_HEADER)))
        .collect::<Vec<_>>();
    if prompt.is_empty() {
        return None;
    }
    Some(HistoryEntry::Prompt {
        content: prompt,
        queued: is_true(message.raw, "isQueuedCommand"),
        timestamp_ms: message.timestamp_ms,
        uuid: message.uuid.to_owned(),
    })
}

/// Which conversation level a message belongs to, as the message says.
fn level_of(value: &JsonRecord) -> Option<&str> {
    str_of(value, "parent_tool_use_id")
}

fn stored_message<'a>(
    raw: &'a JsonRecord,
    parent_tool_use_id: Option<&str>,
) -> Option<StoredMessage<'a>> {
    if level_of(raw) != parent_tool_use_id {
        return None;
    }
    let uuid = str_of(raw, "uuid")?;
    let timestamp_ms = str_of(raw, "timestamp").and_then(timestamp_ms)?;
    Some(StoredMessage {
        raw,
        timestamp_ms,
        uuid,
    })
}

/// Classifies the messages of one conversation level, oldest first:
/// `parent_tool_use_id` is `None` for the main conversation, or the tool
/// call that spawned a sub-agent (SDK-shaped messages). Stored sidecar rows
/// name no parent and are read with `None`.
#[must_use]
pub fn history_entries(
    messages: &[&JsonRecord],
    parent_tool_use_id: Option<&str>,
) -> Vec<HistoryEntry> {
    let mut entries = Vec::new();
    let mut previous_system: Option<String> = None;
    for value in messages {
        let Some(message) = stored_message(value, parent_tool_use_id) else {
            continue;
        };
        let entry = classify_stored(&message, previous_system.as_deref());
        previous_system =
            (str_of(message.raw, "type") == Some("system")).then(|| message.uuid.to_owned());
        if let Some(entry) = entry {
            entries.push(entry);
        }
    }
    entries
}

fn classify_stored(
    message: &StoredMessage<'_>,
    previous_system: Option<&str>,
) -> Option<HistoryEntry> {
    match str_of(message.raw, "type") {
        Some("assistant") => {
            let frame = classify_message(message.raw);
            (!matches!(frame, ClaudeFrame::Other { .. })).then(|| HistoryEntry::Frame {
                frame,
                timestamp_ms: message.timestamp_ms,
                uuid: message.uuid.to_owned(),
            })
        }
        Some("user") => {
            if is_true(message.raw, "isCompactSummary") {
                return Some(HistoryEntry::Compaction {
                    timestamp_ms: message.timestamp_ms,
                    uuid: previous_system.unwrap_or(message.uuid).to_owned(),
                });
            }
            user_entry(message)
        }
        _ => None,
    }
}
