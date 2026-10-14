//! The rows of a forked Claude session, as the Agent SDK's `forkSession`
//! writes them (`lU` in `sdk.mjs`).
//!
//! A fork copies the source's main-conversation messages (user, assistant,
//! attachment and system rows; progress rows are dropped and their children
//! re-parented past them), every branch the file holds unless a cut keeps
//! only the rows through one message ([`super::fork_branch`]). Every copied
//! message gets a fresh uuid, its links (`parentUuid`, `logicalParentUuid`,
//! the uuids a compaction preserved, the prompt a queued command delivers,
//! deferred-tool announcements) follow the copies, and it records where it
//! came from (`forkedFrom`). Side-chain rows, sub-agent transcripts, file
//! history snapshots, titles, tags and other metadata rows are not copied;
//! the copy carries the source's content replacements, `atis` latch and
//! relocated directory under its own session id and ends with its own
//! custom title, `<source title> (fork)`. Pure.

use std::collections::{HashMap, HashSet};

use serde_json::{Map, Value};

use super::{
    fork_branch,
    meta::{first_prompt, last_field},
    write::ForkError,
};
use crate::transcript::json::{JsonRecord, str_of};

/// Row types a fork reads as conversation messages.
const MESSAGE_TYPES: [&str; 5] = ["user", "assistant", "attachment", "system", "progress"];
/// Fields that tie a row to the session's team, side chain or agent; a copy
/// drops them (`isSidechain` becomes `false`).
const DROPPED_FIELDS: [&str; 6] = [
    "teamName",
    "agentName",
    "sessionKind",
    "slug",
    "sourceToolAssistantUUID",
    "summarizedTurnPromptUuids",
];
/// Title of a fork whose source has none.
const UNTITLED: &str = "Forked session";
/// Longest title read from a session's `custom-title.json`, in characters.
const SIDECAR_TITLE_MAX_CHARS: usize = 200;

/// What a fork keeps from a source session file, read row by row.
#[derive(Debug, Default)]
pub(super) struct ForkSource {
    /// Main-conversation message rows with a uuid, in file order.
    transcript: Vec<JsonRecord>,
    content_replacements: Vec<Value>,
    atis_latch: Option<String>,
    relocated_cwd: Option<String>,
    history_suppressed: bool,
}

impl ForkSource {
    /// Takes one stored row of the session `source_id`.
    pub(super) fn push(&mut self, row: Value, source_id: &str) {
        let Value::Object(mut row) = row else {
            return;
        };
        let kind = str_of(&row, "type").unwrap_or_default();
        let own = str_of(&row, "sessionId") == Some(source_id);
        if MESSAGE_TYPES.contains(&kind) && str_of(&row, "uuid").is_some() {
            if !fork_branch::is_side_chain(&row) {
                self.transcript.push(row);
            }
        } else if kind == "history-suppression" {
            self.history_suppressed = true;
        } else if kind == "atis-latch" && own {
            if let Some(atis) = str_of(&row, "atis")
                .filter(|atis| atis.bytes().all(|byte| (0x21..=0x7e).contains(&byte)))
            {
                self.atis_latch = Some(atis.to_owned());
            }
        } else if kind == "content-replacement" && own {
            if let Some(Value::Array(replacements)) = row.remove("replacements") {
                self.content_replacements.extend(replacements);
            }
        } else if kind == "relocated"
            && own
            && let Some(directory) = str_of(&row, "relocatedCwd").filter(|cwd| !cwd.is_empty())
        {
            self.relocated_cwd = Some(directory.to_owned());
        }
    }
}

/// The ids and the time a fork stamps on its rows.
pub(super) struct ForkStamp<'s> {
    /// The new session's id.
    pub session_id: &'s str,
    pub source_id: &'s str,
    /// ISO-8601 UTC time with milliseconds, as JavaScript writes it.
    pub now: &'s str,
    pub title: &'s str,
}

/// The title of the source as the fork derives it: the newest custom title
/// in the file's tail, else the `custom-title.json` sidecar, else one in the
/// head, else a generated title, else the first prompt.
#[must_use]
pub(super) fn source_title(head: &str, tail: &str, sidecar: Option<String>) -> Option<String> {
    let custom = match last_field(tail, "customTitle") {
        Some(title) => Some(title),
        None => sidecar.or_else(|| last_field(head, "customTitle")),
    };
    custom
        .filter(|title| !title.is_empty())
        .or_else(|| last_field(tail, "aiTitle").filter(|title| !title.is_empty()))
        .or_else(|| last_field(head, "aiTitle").filter(|title| !title.is_empty()))
        .or_else(|| first_prompt(head).filter(|prompt| !prompt.is_empty()))
}

/// The fork's title for a source titled `source`.
#[must_use]
pub(super) fn fork_title(source: Option<&str>) -> String {
    format!("{} (fork)", source.unwrap_or(UNTITLED))
}

/// A title read from `custom-title.json`, cleaned as the SDK cleans it:
/// control and format characters become spaces, at most 200 characters.
#[must_use]
pub(super) fn sidecar_title(text: &str) -> Option<String> {
    let value = serde_json::from_str::<Value>(text).ok()?;
    let title = value.get("customTitle")?.as_str()?.trim();
    let mut cleaned = String::with_capacity(title.len());
    let mut in_run = false;
    for character in title.chars() {
        if character.is_control() || is_format(character) {
            if !in_run {
                cleaned.push(' ');
            }
            in_run = true;
        } else {
            cleaned.push(character);
            in_run = false;
        }
    }
    let cleaned = cleaned
        .chars()
        .take(SIDECAR_TITLE_MAX_CHARS)
        .collect::<String>();
    let cleaned = cleaned.trim();
    (!cleaned.is_empty()).then(|| cleaned.to_owned())
}

/// Unicode general category `Cf` (format), with the line and paragraph
/// separators the SDK cleans with it.
fn is_format(character: char) -> bool {
    matches!(
        u32::from(character),
        0x00AD
            | 0x0600..=0x0605
            | 0x061C
            | 0x06DD
            | 0x070F
            | 0x0890..=0x0891
            | 0x08E2
            | 0x180E
            | 0x200B..=0x200F
            | 0x2028..=0x202E
            | 0x2060..=0x2064
            | 0x2066..=0x206F
            | 0xFEFF
            | 0xFFF9..=0xFFFB
            | 0x110BD
            | 0x110CD
            | 0x13430..=0x1343F
            | 0x1BCA0..=0x1BCA3
            | 0x1D173..=0x1D17A
            | 0xE0001
            | 0xE0020..=0xE007F
    )
}

/// The new uuid of each copied source uuid; `copied` when a non-progress
/// row carries it (only those are written).
struct Remap {
    new: String,
    copied: bool,
}

/// Which rows a fork writes and the new uuid of every source uuid it takes.
struct Plan {
    ids: HashMap<String, Remap>,
    /// Positions of the rows written, oldest first, each with its new parent.
    rows: Vec<(usize, Option<String>)>,
}

/// The source's rows a fork writes, in order: an inherited history
/// suppression, the copied messages, then the carried metadata and the
/// fork's title. `mint` makes each fresh uuid.
///
/// # Errors
///
/// [`ForkError::NoMessages`] when the source (or the cut) holds no message,
/// [`ForkError::MessageNotFound`] when no row is `up_to`, and the error
/// `mint` returns.
pub(super) fn forked_rows(
    source: ForkSource,
    up_to: Option<&str>,
    stamp: &ForkStamp<'_>,
    mint: &mut dyn FnMut() -> Result<String, std::io::Error>,
) -> Result<Vec<JsonRecord>, ForkError> {
    let Plan { ids, rows: plans } = plan(&source.transcript, up_to, mint)?;
    let mut rows = Vec::with_capacity(plans.len() + 5);
    if source.history_suppressed {
        rows.push(record([
            ("type", Value::from("history-suppression")),
            ("sessionId", Value::from(stamp.session_id)),
            ("cause", Value::from("fork_inherit")),
            ("ts", Value::from(stamp.now)),
        ]));
    }
    let last = plans.len().saturating_sub(1);
    let mut transcript = source.transcript.into_iter().enumerate();
    for (written, (position, parent)) in plans.into_iter().enumerate() {
        let Some((_, row)) = transcript.find(|(at, _)| *at == position) else {
            break;
        };
        rows.push(copied_row(row, parent, written == last, &ids, stamp));
    }
    if !source.content_replacements.is_empty() {
        rows.push(record([
            ("type", Value::from("content-replacement")),
            ("sessionId", Value::from(stamp.session_id)),
            ("replacements", Value::Array(source.content_replacements)),
            ("uuid", Value::from(mint()?)),
            ("timestamp", Value::from(stamp.now)),
        ]));
    }
    if let Some(atis) = source.atis_latch {
        rows.push(record([
            ("type", Value::from("atis-latch")),
            ("sessionId", Value::from(stamp.session_id)),
            ("atis", Value::from(atis)),
        ]));
    }
    if let Some(directory) = source.relocated_cwd {
        rows.push(record([
            ("type", Value::from("relocated")),
            ("sessionId", Value::from(stamp.session_id)),
            ("relocatedCwd", Value::from(directory)),
        ]));
    }
    rows.push(record([
        ("type", Value::from("custom-title")),
        ("sessionId", Value::from(stamp.session_id)),
        ("customTitle", Value::from(stamp.title)),
        ("uuid", Value::from(mint()?)),
        ("timestamp", Value::from(stamp.now)),
    ]));
    Ok(rows)
}

fn record<const N: usize>(fields: [(&str, Value); N]) -> JsonRecord {
    fields
        .into_iter()
        .map(|(name, value)| (name.to_owned(), value))
        .collect()
}

fn uuid(row: &JsonRecord) -> &str {
    str_of(row, "uuid").unwrap_or_default()
}

fn is_progress(row: &JsonRecord) -> bool {
    str_of(row, "type") == Some("progress")
}

/// The rows of `transcript` a fork through `up_to` writes.
fn plan(
    transcript: &[JsonRecord],
    up_to: Option<&str>,
    mint: &mut dyn FnMut() -> Result<String, std::io::Error>,
) -> Result<Plan, ForkError> {
    if transcript.is_empty() {
        return Err(ForkError::NoMessages);
    }
    let selected = match up_to {
        None => (0..transcript.len()).collect(),
        Some(up_to) => {
            let rows = transcript.iter().collect::<Vec<_>>();
            fork_branch::cut(&rows, up_to).ok_or(ForkError::MessageNotFound)?
        }
    };
    let mut ids = HashMap::<String, Remap>::new();
    let mut by_uuid = HashMap::new();
    for position in &selected {
        let row = &transcript[*position];
        let new = mint()?;
        let copied = !is_progress(row);
        ids.entry(uuid(row).to_owned())
            .and_modify(|remap| {
                remap.new.clone_from(&new);
                remap.copied |= copied;
            })
            .or_insert(Remap { new, copied });
        by_uuid.insert(uuid(row), row);
    }
    let plans = selected
        .into_iter()
        .filter(|position| !is_progress(&transcript[*position]))
        .map(|position| {
            let parent = copied_parent(&transcript[position], &by_uuid, &ids);
            (position, parent)
        })
        .collect::<Vec<_>>();
    if plans.is_empty() {
        return Err(ForkError::NoMessages);
    }
    Ok(Plan { ids, rows: plans })
}

/// The new parent of a copied row: its parent's copy, past progress rows;
/// none when the parent was not copied.
fn copied_parent(
    row: &JsonRecord,
    by_uuid: &HashMap<&str, &JsonRecord>,
    ids: &HashMap<String, Remap>,
) -> Option<String> {
    let new_of = |id: &str| ids.get(id).map(|remap| remap.new.clone());
    let mut seen = HashSet::new();
    let mut current = str_of(row, "parentUuid").filter(|parent| !parent.is_empty());
    while let Some(id) = current {
        let ancestor = by_uuid.get(id)?;
        if !is_progress(ancestor) {
            return new_of(id);
        }
        if !seen.insert(uuid(ancestor)) {
            return new_of(uuid(ancestor));
        }
        current = str_of(ancestor, "parentUuid").filter(|parent| !parent.is_empty());
    }
    None
}

/// One source row as the fork writes it.
fn copied_row(
    mut row: JsonRecord,
    parent: Option<String>,
    is_last: bool,
    ids: &HashMap<String, Remap>,
    stamp: &ForkStamp<'_>,
) -> JsonRecord {
    let any = |id: &str| ids.get(id).map(|remap| remap.new.as_str());
    let copied = |id: &str| {
        ids.get(id)
            .filter(|remap| remap.copied)
            .map(|remap| remap.new.as_str())
    };
    let kind = str_of(&row, "type").unwrap_or_default().to_owned();
    if kind == "system" && str_of(&row, "subtype") == Some("model_refusal_fallback") {
        row.insert("neutralizedByFork".to_owned(), Value::Bool(true));
    }
    if kind == "attachment" {
        remap_attachment(&mut row, &any);
    }
    if kind == "system" {
        remap_compaction(&mut row, &copied);
    }
    if let Some(logical) = row.get_mut("logicalParentUuid")
        && !logical.is_null()
    {
        *logical = logical
            .as_str()
            .and_then(any)
            .map_or(Value::Null, Value::from);
    }
    let original = row
        .insert(
            "uuid".to_owned(),
            Value::from(any(uuid(&row)).unwrap_or_default()),
        )
        .unwrap_or(Value::Null);
    row.insert(
        "parentUuid".to_owned(),
        parent.map_or(Value::Null, Value::from),
    );
    row.insert("sessionId".to_owned(), Value::from(stamp.session_id));
    if is_last {
        row.insert("timestamp".to_owned(), Value::from(stamp.now));
    }
    row.insert("isSidechain".to_owned(), Value::Bool(false));
    for field in DROPPED_FIELDS {
        row.remove(field);
    }
    let mut origin = Map::new();
    origin.insert("sessionId".to_owned(), Value::from(stamp.source_id));
    origin.insert("messageUuid".to_owned(), original);
    row.insert("forkedFrom".to_owned(), Value::Object(origin));
    row
}

/// A queued prompt delivers its copy; a deferred-tools record announces
/// only the copied uuids it named.
fn remap_attachment<'i>(row: &mut JsonRecord, any: &impl Fn(&str) -> Option<&'i str>) {
    let Some(Value::Object(attachment)) = row.get_mut("attachment") else {
        return;
    };
    match str_of(attachment, "type") {
        Some("queued_command") => {
            if let Some(source) = str_of(attachment, "source_uuid")
                .filter(|source| !source.is_empty())
                .and_then(any)
            {
                attachment.insert("source_uuid".to_owned(), Value::from(source));
            }
        }
        Some("deferred_tools_record") => {
            if let Some(Value::Array(announced)) = attachment.get_mut("nameOnlyAnnouncements") {
                *announced = announced
                    .iter()
                    .filter_map(|id| id.as_str().and_then(any).map(Value::from))
                    .collect();
            }
        }
        _ => {}
    }
}

/// A compaction's preserved uuids name their copies (uuids not copied stay);
/// the running-turn sends it recorded are dropped.
fn remap_compaction<'i>(row: &mut JsonRecord, copied: &impl Fn(&str) -> Option<&'i str>) {
    let Some(Value::Object(metadata)) = row.get_mut("compactMetadata") else {
        return;
    };
    if !["preservedMessages", "preservedSegment", "runningTurnSends"]
        .iter()
        .any(|field| metadata.contains_key(*field))
    {
        return;
    }
    metadata.remove("runningTurnSends");
    let remap = |value: &mut Value| {
        if let Some(new) = value.as_str().and_then(copied) {
            *value = Value::from(new);
        }
    };
    for (group, fields) in [
        (
            "preservedMessages",
            ["anchorUuid", "uuids", "allUuids"].as_slice(),
        ),
        (
            "preservedSegment",
            ["headUuid", "anchorUuid", "tailUuid"].as_slice(),
        ),
    ] {
        let Some(Value::Object(group)) = metadata.get_mut(group) else {
            continue;
        };
        for field in fields {
            match group.get_mut(*field) {
                Some(Value::Array(values)) => values.iter_mut().for_each(remap),
                Some(value) => remap(value),
                None => {}
            }
        }
    }
}
