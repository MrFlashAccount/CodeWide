//! One stored row of a Claude session file, read only as far as the index
//! needs it: borrowed raw fields, parsed on demand, so scanning a row costs
//! its bytes and no `serde_json::Value` tree. The classification mirrors
//! `transcript::entries` (the reader of whole rows) decision for decision;
//! the projection of a turn reads its rows with that module.

use std::borrow::Cow;

use serde::Deserialize;
use serde_json::value::RawValue;

use crate::transcript::{
    entries::{HISTORY_HEADER, INTERRUPT_MARKER, RESUME_PROMPT, is_markup, timestamp_ms},
    segments::EntryKind,
    task_reports::{TaskReport, stored_task_reports},
};

type Raw<'a> = Option<&'a RawValue>;

/// A string field; `None` when absent or not a string.
pub(crate) fn text(raw: Raw<'_>) -> Option<Cow<'_, str>> {
    let raw = raw?.get();
    if !raw.starts_with('"') {
        return None;
    }
    match serde_json::from_str::<&str>(raw) {
        Ok(text) => Some(Cow::Borrowed(text)),
        Err(_) => serde_json::from_str::<String>(raw).ok().map(Cow::Owned),
    }
}

/// A boolean field that is exactly `true`.
fn flag(raw: Raw<'_>) -> bool {
    raw.is_some_and(|raw| raw.get() == "true")
}

fn is_object(raw: Raw<'_>) -> bool {
    raw.is_some_and(|raw| raw.get().starts_with('{'))
}

fn object<'a, T: Deserialize<'a>>(raw: Raw<'a>) -> Option<T> {
    raw.filter(|raw| raw.get().starts_with('{'))
        .and_then(|raw| serde_json::from_str(raw.get()).ok())
}

/// The fields of a row the index reads.
#[derive(Default, Deserialize)]
pub(crate) struct Row<'a> {
    #[serde(rename = "type", borrow, default)]
    kind: Raw<'a>,
    #[serde(borrow, default)]
    uuid: Raw<'a>,
    #[serde(rename = "parentUuid", borrow, default)]
    parent_uuid: Raw<'a>,
    #[serde(borrow, default)]
    timestamp: Raw<'a>,
    #[serde(rename = "isSidechain", borrow, default)]
    is_sidechain: Raw<'a>,
    #[serde(rename = "teamName", borrow, default)]
    team_name: Raw<'a>,
    #[serde(rename = "isMeta", borrow, default)]
    is_meta: Raw<'a>,
    #[serde(rename = "is_meta", borrow, default)]
    is_meta_snake: Raw<'a>,
    #[serde(rename = "isCompactSummary", borrow, default)]
    is_compact_summary: Raw<'a>,
    #[serde(rename = "isVisibleInTranscriptOnly", borrow, default)]
    visible_only: Raw<'a>,
    #[serde(rename = "isQueuedCommand", borrow, default)]
    is_queued: Raw<'a>,
    #[serde(rename = "isApiErrorMessage", borrow, default)]
    is_api_error: Raw<'a>,
    #[serde(borrow, default)]
    error: Raw<'a>,
    #[serde(borrow, default)]
    parent_tool_use_id: Raw<'a>,
    #[serde(borrow, default)]
    origin: Raw<'a>,
    #[serde(borrow, default)]
    message: Raw<'a>,
    #[serde(borrow, default)]
    attachment: Raw<'a>,
    #[serde(borrow, default)]
    effort: Raw<'a>,
    #[serde(borrow, default)]
    subtype: Raw<'a>,
}

#[derive(Default, Deserialize)]
struct Message<'a> {
    #[serde(borrow, default)]
    model: Raw<'a>,
    #[serde(borrow, default)]
    content: Raw<'a>,
}

#[derive(Default, Deserialize)]
struct Origin<'a> {
    #[serde(borrow, default)]
    kind: Raw<'a>,
}

#[derive(Default, Deserialize)]
struct Attachment<'a> {
    #[serde(rename = "type", borrow, default)]
    kind: Raw<'a>,
    #[serde(rename = "commandMode", borrow, default)]
    command_mode: Raw<'a>,
    #[serde(borrow, default)]
    prompt: Raw<'a>,
    #[serde(borrow, default)]
    source_uuid: Raw<'a>,
    #[serde(rename = "isMeta", borrow, default)]
    is_meta: Raw<'a>,
    #[serde(borrow, default)]
    origin: Raw<'a>,
}

#[derive(Default, Deserialize)]
struct Block<'a> {
    #[serde(rename = "type", borrow, default)]
    kind: Raw<'a>,
    #[serde(borrow, default)]
    text: Raw<'a>,
    #[serde(borrow, default)]
    source: Raw<'a>,
    #[serde(borrow, default)]
    tool_use_id: Raw<'a>,
    #[serde(borrow, default)]
    id: Raw<'a>,
    #[serde(borrow, default)]
    name: Raw<'a>,
}

/// The blocks of a message's content: a string is one text block.
fn blocks(content: Raw<'_>) -> Vec<Block<'_>> {
    let Some(content) = content else {
        return Vec::new();
    };
    if content.get().starts_with('"') {
        return vec![Block {
            kind: None,
            text: Some(content),
            ..Block::default()
        }];
    }
    serde_json::from_str::<Vec<&RawValue>>(content.get())
        .map(|elements| {
            elements
                .into_iter()
                .filter_map(|element| object::<Block<'_>>(Some(element)))
                .collect()
        })
        .unwrap_or_default()
}

/// What a user message's content holds for classification.
struct UserBlocks<'a> {
    /// Text blocks (a string content is one) and image blocks with a source.
    parts: Vec<Part<'a>>,
    has_tool_result: bool,
}

enum Part<'a> {
    Text(Cow<'a, str>),
    Image,
}

fn user_blocks(content: Raw<'_>) -> UserBlocks<'_> {
    let mut parts = Vec::new();
    let mut has_tool_result = false;
    let string = content.is_some_and(|content| content.get().starts_with('"'));
    for block in blocks(content) {
        if string {
            parts.push(Part::Text(text(block.text).unwrap_or_default()));
            continue;
        }
        match text(block.kind).as_deref() {
            Some("text") => parts.push(Part::Text(text(block.text).unwrap_or_default())),
            Some("image") if is_object(block.source) => parts.push(Part::Image),
            Some("tool_result") => has_tool_result = true,
            _ => {}
        }
    }
    UserBlocks {
        parts,
        has_tool_result,
    }
}

impl UserBlocks<'_> {
    fn first_text(&self) -> &str {
        self.parts
            .iter()
            .find_map(|part| match part {
                Part::Text(text) => Some(text.as_ref()),
                Part::Image => None,
            })
            .unwrap_or_default()
    }

    fn is_resume(&self) -> bool {
        self.parts.iter().any(
            |part| matches!(part, Part::Text(text) if text.trim_end().ends_with(RESUME_PROMPT)),
        )
    }

    /// Whether anything is left of a prompt once the history header goes.
    fn has_prompt(&self) -> bool {
        self.parts.iter().any(|part| match part {
            Part::Text(text) => !text.starts_with(HISTORY_HEADER),
            Part::Image => true,
        })
    }
}

/// A user message as classification sees it (a stored row, or a prompt
/// Claude queued during a turn).
struct UserMessage<'a> {
    content: Raw<'a>,
    meta: bool,
    /// `origin.kind`, `"unknown"` for an origin without one.
    origin: Option<Cow<'a, str>>,
    queued: bool,
    visible_only: bool,
}

/// The kind of a user message's entry; `None` for a hidden message.
fn user_entry(message: &UserMessage<'_>) -> Option<EntryKind> {
    let content = user_blocks(message.content);
    if content.has_tool_result {
        return Some(EntryKind::Frame);
    }
    if message.meta && content.is_resume() {
        return Some(EntryKind::Resume);
    }
    let first = content.first_text();
    if message
        .origin
        .as_deref()
        .is_some_and(|origin| origin != "human")
    {
        return Some(EntryKind::Wake {
            queued: message.queued,
        });
    }
    if first.starts_with(INTERRUPT_MARKER) {
        return Some(EntryKind::Interrupt);
    }
    if message.meta || message.visible_only || is_markup(first) || !content.has_prompt() {
        return None;
    }
    Some(EntryKind::Prompt {
        queued: message.queued,
    })
}

fn origin_kind(raw: Raw<'_>) -> Option<Cow<'_, str>> {
    let origin = object::<Origin<'_>>(raw)?;
    Some(text(origin.kind).unwrap_or(Cow::Borrowed("unknown")))
}

/// What one row is for the index.
pub(crate) enum Kind {
    /// An entry of a conversation level.
    Entry(EntryKind),
    /// A system row: it names the compaction after it.
    System,
    /// A row of no entry.
    Other,
}

/// A queued prompt Claude stored as an attachment while a turn ran.
pub(crate) struct Queued<'a> {
    attachment: Attachment<'a>,
}

impl<'a> Row<'a> {
    /// Reads the fields the index needs; `None` for a malformed line.
    pub(crate) fn parse(line: &'a [u8]) -> Option<Self> {
        serde_json::from_slice(line).ok()
    }

    pub(crate) fn kind(&self) -> Option<Cow<'a, str>> {
        text(self.kind)
    }

    pub(crate) fn uuid(&self) -> Option<Cow<'a, str>> {
        text(self.uuid)
    }

    pub(crate) fn parent_uuid(&self) -> Option<Cow<'a, str>> {
        text(self.parent_uuid)
    }

    pub(crate) fn timestamp_ms(&self) -> Option<i64> {
        text(self.timestamp).and_then(|text| timestamp_ms(&text))
    }

    /// The tool call whose sub-agent wrote the row (SDK-shaped messages).
    pub(crate) fn level(&self) -> Option<Cow<'a, str>> {
        text(self.parent_tool_use_id)
    }

    /// Not a side-chain or team row: one of the session's own conversation.
    pub(crate) fn is_main_level(&self) -> bool {
        !flag(self.is_sidechain) && self.team_name.is_none_or(|raw| raw.get() == "null")
    }

    /// A compaction's boundary row.
    pub(crate) fn is_compact_boundary(&self) -> bool {
        self.kind().as_deref() == Some("system")
            && text(self.subtype).as_deref() == Some("compact_boundary")
    }

    /// A user or assistant row.
    pub(crate) fn is_conversation(&self) -> bool {
        matches!(self.kind().as_deref(), Some("user" | "assistant"))
    }

    /// A user row with a `tool_result` block.
    pub(crate) fn is_tool_result(&self) -> bool {
        self.kind().as_deref() == Some("user") && self.message_blocks().has_tool_result
    }

    /// A person's or adapter's message that ends what a queued prompt
    /// before it waited for: a user row that is neither meta nor a
    /// compaction summary.
    pub(crate) fn is_plain_user(&self) -> bool {
        self.kind().as_deref() == Some("user")
            && !flag(self.is_meta)
            && !flag(self.is_compact_summary)
            && !self.message_blocks().has_tool_result
    }

    fn message(&self) -> Message<'a> {
        object(self.message).unwrap_or_default()
    }

    fn message_blocks(&self) -> UserBlocks<'a> {
        user_blocks(self.message().content)
    }

    /// The `tool_use` blocks of an assistant row: `(id, name)`.
    pub(crate) fn tool_uses(&self) -> Vec<(Cow<'a, str>, Cow<'a, str>)> {
        if self.kind().as_deref() != Some("assistant") {
            return Vec::new();
        }
        blocks(self.message().content)
            .into_iter()
            .filter(|block| text(block.kind).as_deref() == Some("tool_use"))
            .filter_map(|block| Some((text(block.id)?, text(block.name)?)))
            .collect()
    }

    /// The tool calls a user row's `tool_result` blocks answer.
    pub(crate) fn tool_result_ids(&self) -> Vec<Cow<'a, str>> {
        if self.kind().as_deref() != Some("user") {
            return Vec::new();
        }
        blocks(self.message().content)
            .into_iter()
            .filter(|block| text(block.kind).as_deref() == Some("tool_result"))
            .filter_map(|block| text(block.tool_use_id))
            .collect()
    }

    /// The task reports of a stored task notification (any level).
    pub(crate) fn task_reports(&self) -> Vec<TaskReport> {
        if self.kind().as_deref() != Some("user")
            || origin_kind(self.origin).as_deref() != Some("task-notification")
        {
            return Vec::new();
        }
        stored_task_reports(self.message_blocks().first_text())
    }

    /// The model and effort of a main-loop answer (`last_recorded_model`).
    pub(crate) fn recorded_answer(&self) -> Option<(String, Option<String>)> {
        if self.kind().as_deref() != Some("assistant")
            || self
                .parent_tool_use_id
                .is_some_and(|raw| raw.get().starts_with('"'))
        {
            return None;
        }
        let model = text(self.message().model)
            .filter(|model| !model.is_empty() && !model.starts_with('<'))?;
        let effort = text(self.effort)
            .filter(|effort| crate::cli::command::EFFORTS.contains(&effort.as_ref()))
            .map(Cow::into_owned);
        Some((model.into_owned(), effort))
    }

    /// The queued prompt this row stores, if it is one.
    pub(crate) fn queued(&self) -> Option<Queued<'a>> {
        if self.kind().as_deref() != Some("attachment") {
            return None;
        }
        let attachment = object::<Attachment<'_>>(self.attachment)?;
        (text(attachment.kind).as_deref() == Some("queued_command"))
            .then_some(Queued { attachment })
    }

    /// What the row is at conversation level `level` (`None` for the main
    /// conversation or a sidecar's own rows). Rows without a uuid or a
    /// readable time are no entries.
    pub(crate) fn classify(&self, level: Option<&str>) -> Kind {
        if self.level().as_deref() != level
            || self.uuid().is_none()
            || self.timestamp_ms().is_none()
        {
            return Kind::Other;
        }
        match self.kind().as_deref() {
            Some("assistant") => {
                let message = self.message();
                let placeholder = text(message.model).as_deref() == Some("<synthetic>")
                    && text(self.error).is_none()
                    && !flag(self.is_api_error);
                if is_object(self.message) && !placeholder {
                    Kind::Entry(EntryKind::Frame)
                } else {
                    Kind::Other
                }
            }
            Some("user") if flag(self.is_compact_summary) => Kind::Entry(EntryKind::Compaction),
            Some("user") => {
                let message = UserMessage {
                    content: self.message().content,
                    meta: flag(self.is_meta) || flag(self.is_meta_snake),
                    origin: origin_kind(self.origin),
                    queued: flag(self.is_queued),
                    visible_only: flag(self.visible_only),
                };
                user_entry(&message).map_or(Kind::Other, Kind::Entry)
            }
            Some("system") => Kind::System,
            _ => Kind::Other,
        }
    }
}

impl<'a> Queued<'a> {
    /// The uuid of the message the prompt stands for: its source message,
    /// else the attachment row's own.
    pub(crate) fn source_uuid(&self) -> Option<Cow<'a, str>> {
        text(self.attachment.source_uuid).filter(|uuid| !uuid.is_empty())
    }

    /// A task report Claude queued: its prompt.
    pub(crate) fn task_reports(&self) -> Vec<TaskReport> {
        if text(self.attachment.command_mode).as_deref() != Some("task-notification") {
            return Vec::new();
        }
        text(self.attachment.prompt)
            .map(|prompt| stored_task_reports(&prompt))
            .unwrap_or_default()
    }

    /// The entry the prompt is once delivered (`chain::queued_prompt`).
    pub(crate) fn entry(&self) -> Option<EntryKind> {
        let prompt = self
            .attachment
            .prompt
            .filter(|prompt| matches!(prompt.get().as_bytes().first(), Some(b'"' | b'[')))?;
        let origin = match object::<Origin<'_>>(self.attachment.origin)
            .and_then(|origin| text(origin.kind))
        {
            Some(origin) => Some(origin),
            None if text(self.attachment.command_mode).as_deref() == Some("task-notification") => {
                Some(Cow::Borrowed("task-notification"))
            }
            None => None,
        };
        user_entry(&UserMessage {
            content: Some(prompt),
            meta: flag(self.attachment.is_meta),
            origin,
            queued: true,
            visible_only: false,
        })
    }
}
