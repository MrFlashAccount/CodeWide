//! Extraction and validation of the agent's guide answer: exactly one
//! fenced `codewide-guide` JSON block whose aliases name known hunks, each
//! at most once, within the size caps.

use std::collections::HashSet;

use serde_json::Value;

use super::{GuideChapter, GuideStop, PendingGuide};
use crate::review::{drafts::Side, hunks::HunkId, new_uuid};

pub const MAX_CHAPTERS: usize = 64;
pub const MAX_STOPS: usize = 256;
pub const MAX_STOP_TEXT_CHARS: usize = 4_000;
const MAX_REMARKS: usize = 200;
pub(super) const GUIDE_FENCE: &str = "```codewide-guide";

pub(super) struct Remark {
    pub(super) hunk: HunkId,
    pub(super) side: Side,
    pub(super) start_line: u32,
    pub(super) end_line: u32,
    pub(super) body: String,
}

pub(super) struct ParsedGuide {
    pub(super) title: String,
    pub(super) summary: String,
    pub(super) chapters: Vec<GuideChapter>,
    pub(super) support: Vec<HunkId>,
    pub(super) remarks: Vec<Remark>,
}

/// Extracts and validates the single fenced guide of a final message.
pub(super) fn parse_guide(message: &str, pending: &PendingGuide) -> Result<ParsedGuide, String> {
    let value = guide_json(message)?;
    let title = text(&value, "title", true)?.unwrap_or_default();
    let summary = text(&value, "summary", true)?.unwrap_or_default();
    let chapters_raw = value
        .get("chapters")
        .and_then(Value::as_array)
        .filter(|chapters| !chapters.is_empty())
        .ok_or_else(|| "The guide has no chapters".to_owned())?;
    if chapters_raw.len() > MAX_CHAPTERS {
        return Err(format!("The guide has more than {MAX_CHAPTERS} chapters"));
    }
    let mut walk = Walk {
        aliases: &pending.aliases,
        used: HashSet::new(),
        remarks: Vec::new(),
        stops: 0,
    };
    let mut chapters = Vec::new();
    for chapter in chapters_raw {
        let stops_raw = chapter
            .get("stops")
            .and_then(Value::as_array)
            .filter(|stops| !stops.is_empty())
            .ok_or_else(|| "A chapter has no stops".to_owned())?;
        let stops = stops_raw
            .iter()
            .map(|stop| walk.stop(stop))
            .collect::<Result<Vec<_>, _>>()?;
        chapters.push(GuideChapter {
            chapter_id: new_uuid(),
            title: text(chapter, "title", true)?.unwrap_or_default(),
            summary: text(chapter, "summary", false)?,
            stops,
        });
    }
    let support = pending
        .aliases
        .iter()
        .filter(|hunk| !walk.used.contains(*hunk))
        .cloned()
        .collect();
    Ok(ParsedGuide {
        title,
        summary,
        chapters,
        support,
        remarks: walk.remarks,
    })
}

/// The single fenced `codewide-guide` JSON of a message.
fn guide_json(message: &str) -> Result<Value, String> {
    let blocks: Vec<&str> = message
        .match_indices(GUIDE_FENCE)
        .map(|(index, _)| &message[index..])
        .collect();
    let [block] = blocks.as_slice() else {
        return Err(if blocks.is_empty() {
            "The answer has no codewide-guide block".into()
        } else {
            "The answer has more than one codewide-guide block".into()
        });
    };
    let body = block[GUIDE_FENCE.len()..]
        .split_once('\n')
        .map(|(_, rest)| rest)
        .and_then(|rest| rest.split_once("```").map(|(json, _)| json))
        .ok_or_else(|| "The codewide-guide block is not closed".to_owned())?;
    serde_json::from_str(body).map_err(|_| "The guide is not valid JSON".to_owned())
}

/// A non-empty string field; `required` rejects a missing or null one.
fn text(value: &Value, field: &str, required: bool) -> Result<Option<String>, String> {
    match value.get(field) {
        Some(Value::String(text)) if !text.trim().is_empty() => Ok(Some(text.clone())),
        None | Some(Value::Null) if !required => Ok(None),
        _ => Err(format!("The guide is missing {field}")),
    }
}

/// Validation state across every stop of one guide.
struct Walk<'a> {
    aliases: &'a [HunkId],
    used: HashSet<HunkId>,
    remarks: Vec<Remark>,
    stops: usize,
}

impl Walk<'_> {
    fn resolve(&self, alias: &str) -> Option<HunkId> {
        let index = alias.strip_prefix('h')?.parse::<usize>().ok()?;
        self.aliases.get(index.checked_sub(1)?).cloned()
    }

    fn stop(&mut self, stop: &Value) -> Result<GuideStop, String> {
        self.stops += 1;
        if self.stops > MAX_STOPS {
            return Err(format!("The guide has more than {MAX_STOPS} stops"));
        }
        let title = text(stop, "title", true)?.unwrap_or_default();
        let summary = text(stop, "summary", true)?.unwrap_or_default();
        let prose = text(stop, "prose", false)?;
        let chars = title.chars().count()
            + summary.chars().count()
            + prose.as_deref().map_or(0, |prose| prose.chars().count());
        if chars > MAX_STOP_TEXT_CHARS {
            return Err(format!(
                "A stop has more than {MAX_STOP_TEXT_CHARS} characters"
            ));
        }
        let aliases = stop
            .get("hunks")
            .and_then(Value::as_array)
            .filter(|hunks| !hunks.is_empty())
            .ok_or_else(|| "A stop names no hunks".to_owned())?;
        let mut hunk_ids = Vec::new();
        for alias in aliases {
            let alias = alias
                .as_str()
                .ok_or_else(|| "A hunk alias is not a string".to_owned())?;
            let hunk = self
                .resolve(alias)
                .ok_or_else(|| format!("Unknown hunk alias {alias}"))?;
            if !self.used.insert(hunk.clone()) {
                return Err(format!("Hunk alias {alias} is used twice"));
            }
            hunk_ids.push(hunk);
        }
        for remark in stop
            .get("remarks")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
        {
            if self.remarks.len() >= MAX_REMARKS {
                break;
            }
            if let Some(remark) = parse_remark(remark, &|alias| self.resolve(alias), &hunk_ids) {
                self.remarks.push(remark);
            }
        }
        Ok(GuideStop {
            stop_id: new_uuid(),
            title,
            summary,
            prose,
            hunk_ids,
        })
    }
}

fn parse_remark(
    value: &Value,
    resolve: &impl Fn(&str) -> Option<HunkId>,
    stop_hunks: &[HunkId],
) -> Option<Remark> {
    let hunk = resolve(value.get("hunk")?.as_str()?)?;
    if !stop_hunks.contains(&hunk) {
        return None;
    }
    let side = match value.get("side")?.as_str()? {
        "new" => Side::New,
        "old" => Side::Old,
        _ => return None,
    };
    let start_line = u32::try_from(value.get("startLine")?.as_u64()?).ok()?;
    let end_line = u32::try_from(value.get("endLine")?.as_u64()?).ok()?;
    let body = value.get("body")?.as_str()?.trim().to_owned();
    (start_line > 0
        && end_line >= start_line
        && !body.is_empty()
        && body.chars().count() <= MAX_STOP_TEXT_CHARS)
        .then_some(Remark {
            hunk,
            side,
            start_line,
            end_line,
            body,
        })
}
