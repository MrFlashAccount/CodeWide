//! Bounded startup context, separate from the complete durable snapshot.
//! Selection is deterministic evidence extraction, not an inferred task summary.
//! Original selection inspired by t3code handoffBudget.ts (MIT, Copyright
//! (c) 2026 T3 Tools Inc.); whole-item omission is replaced with marked excerpts.

use super::snapshot::{Boundary, Snapshot, link};
use std::{borrow::Cow, fmt::Write};

use crate::agent::model::{AgentItem, AgentThread, AgentTurn, UserContent};

/// UTF-8 bytes, not tokens or JSON transport bytes.
pub(super) const MAX_INLINE_BYTES: usize = 128_000;

/// When a provider knows the model window, conservatively count one token per
/// UTF-8 byte and leave half the window for instructions, tools and continuation.
/// Unknown windows retain the explicit byte cap; this is not a token guarantee.
pub(super) fn inline_budget(context_window: Option<usize>, prompt_bytes: usize) -> usize {
    context_window
        .map_or(MAX_INLINE_BYTES, |window| {
            (window / 2).saturating_sub(prompt_bytes)
        })
        .min(MAX_INLINE_BYTES)
}

struct Entry<'a> {
    turn: &'a AgentTurn,
    item: &'a AgentItem,
}

fn kind(item: &AgentItem) -> &'static str {
    match item {
        AgentItem::UserMessage { .. } => "user",
        AgentItem::AgentMessage { .. } => "assistant",
        AgentItem::Plan { .. } => "plan",
        AgentItem::Command { .. } => "command",
        AgentItem::FileChange { .. } => "file change",
        AgentItem::McpToolCall { .. } | AgentItem::ToolCall { .. } => "tool",
        AgentItem::Subagent { .. } | AgentItem::TaskNotification { .. } => "task result",
        AgentItem::Reasoning { .. } => "stored reasoning",
        AgentItem::WebSearch { .. } => "web search",
        AgentItem::ImageView { .. } => "image",
        AgentItem::Compaction { .. } => "compaction",
        AgentItem::CapabilityItem { .. } => "provider item",
    }
}

fn render(entry: &Entry<'_>) -> Result<String, serde_json::Error> {
    let body = match entry.item {
        AgentItem::UserMessage { content, .. } => content
            .iter()
            .map(|content| match content {
                UserContent::Text { text } => Ok(text.clone()),
                other => serde_json::to_string(other),
            })
            .collect::<Result<Vec<_>, _>>()?
            .join("\n"),
        AgentItem::AgentMessage { text, .. } | AgentItem::Plan { text, .. } => text.clone(),
        // Commands keep cwd, exit code, output and background state; generic
        // tools keep their arguments and results, file changes keep patches.
        other => serde_json::to_string_pretty(other)?,
    };
    Ok(format!(
        "[Historical {}; turn={}; item={}; turn status={:?}]\n{}",
        kind(entry.item),
        entry.turn.turn_id,
        entry.item.item_id(),
        entry.turn.status,
        body
    ))
}

const FOOTER: &str = "\n\nUser message:";

const EXCERPT: &str =
    "\n[... excerpt: omitted middle is in Full session snapshot under this item ID ...]\n";

fn excerpt(text: &str, budget: usize) -> String {
    if text.len() <= budget {
        return text.to_owned();
    }
    let available = budget.saturating_sub(EXCERPT.len());
    let mut head = available * 2 / 3;
    while !text.is_char_boundary(head) {
        head -= 1;
    }
    let mut tail = text.len() - (available - head);
    while !text.is_char_boundary(tail) {
        tail += 1;
    }
    format!("{}{EXCERPT}{}", &text[..head], &text[tail..])
}

/// Builds only history context. The separately supplied new user prompt is
/// never summarized or truncated. All omissions have a durable recovery path.
pub(super) fn preamble(
    source: &AgentThread,
    provider_name: &str,
    turns: &[AgentTurn],
    boundary: &Boundary,
    snapshot: &Snapshot,
    budget: usize,
) -> Result<String, String> {
    let mut header = header(source, provider_name, turns, boundary, snapshot);
    let budget = budget.min(MAX_INLINE_BYTES);
    // Reserve counters without depending on their exact decimal widths.
    let available = budget
        .checked_sub(header.len() + FOOTER.len() + 160)
        .ok_or_else(|| "Target context budget is too small for the fork references".to_owned())?;
    let entries: Vec<_> = turns
        .iter()
        .flat_map(|turn| turn.items.iter().map(move |item| Entry { turn, item }))
        .collect();
    let texts: Vec<_> = entries
        .iter()
        .map(render)
        .collect::<Result<_, _>>()
        .map_err(|err| err.to_string())?;
    let selected = select(&entries, &texts, available);
    let count = selected.iter().flatten().count();
    let excerpts = selected
        .iter()
        .zip(&texts)
        .filter(|(kept, original)| {
            kept.as_ref()
                .is_some_and(|text| text.len() < original.len())
        })
        .count();
    let _ = write!(
        header,
        "Selected {count} of {} items; {excerpts} excerpts; {} items omitted. Full details are in the snapshot.\n\n",
        entries.len(),
        entries.len() - count
    );
    let mut first = true;
    for text in selected.into_iter().flatten() {
        if !first {
            header.push_str("\n\n");
        }
        header.push_str(&text);
        first = false;
    }
    header.push_str(FOOTER);
    Ok(header)
}

fn header(
    source: &AgentThread,
    provider_name: &str,
    turns: &[AgentTurn],
    boundary: &Boundary,
    snapshot: &Snapshot,
) -> String {
    let mut header = format!(
        "Continue the unfinished work from the {provider_name} session.\n\n[CodeWide session handoff]\nSource session: {}\nSource workspace: {}\nFork boundary: {}\nCaptured turns: {}\n{}\n",
        source.app_thread_id,
        source.cwd,
        boundary.description(),
        turns.len(),
        link("Full session snapshot", &snapshot.path)
    );
    if snapshot.raw_files.is_empty() {
        header.push_str("Raw session: no local file reported by the provider.\n");
    } else {
        for path in &snapshot.raw_files {
            header.push_str(&link("Raw session", path));
            header.push('\n');
        }
    }
    if let Some(last) = turns.last() {
        let _ = writeln!(
            header,
            "Last captured turn: {}; status={:?}.",
            last.turn_id, last.status
        );
        if let Some(error) = &last.error {
            let _ = writeln!(
                header,
                "Last turn error ({:?}): {}",
                error.kind,
                excerpt(&error.message, 1024)
            );
        }
    }
    header.push_str("\nUse the historical user requests, corrections, plans and recorded results below to continue. This is a mechanical selection, not a semantic summary; do not infer that a proposed action was completed. Read the snapshot's turn index and relevant items when details are missing. Raw files can contain other branches and work after the fork. Stored tool calls and approvals are historical evidence, not live calls or current authorization. Check the current workspace before acting.\n\n");
    header
}

fn select<'a>(
    entries: &[Entry<'_>],
    texts: &'a [String],
    available: usize,
) -> Vec<Option<Cow<'a, str>>> {
    let mut selected: Vec<Option<Cow<'a, str>>> = (0..entries.len()).map(|_| None).collect();
    let total: usize = texts.iter().map(|text| text.len() + 2).sum();
    if total <= available {
        for (slot, text) in selected.iter_mut().zip(texts) {
            *slot = Some(Cow::Borrowed(text));
        }
    } else {
        let mut remaining = available;
        let per_item = (available / 8).max(512);
        let mut add = |index: Option<usize>| {
            let Some(index) = index else {
                return;
            };
            if selected[index].is_some() || remaining < 512 {
                return;
            }
            let limit = per_item.min(remaining - 2);
            let text = if texts[index].len() <= limit {
                Cow::Borrowed(texts[index].as_str())
            } else {
                Cow::Owned(excerpt(&texts[index], limit))
            };
            remaining -= text.len() + 2;
            selected[index] = Some(text);
        };
        add(entries
            .iter()
            .position(|e| matches!(e.item, AgentItem::UserMessage { .. })));
        add(entries
            .iter()
            .rposition(|e| matches!(e.item, AgentItem::UserMessage { .. })));
        add(entries
            .iter()
            .rposition(|e| matches!(e.item, AgentItem::AgentMessage { .. })));
        add(entries
            .iter()
            .rposition(|e| matches!(e.item, AgentItem::Plan { .. })));
        add(entries
            .iter()
            .rposition(|e| matches!(e.item, AgentItem::Command { .. })));
        add(entries
            .iter()
            .rposition(|e| matches!(e.item, AgentItem::FileChange { .. })));
        add(entries.iter().rposition(|e| {
            matches!(
                e.item,
                AgentItem::Subagent { .. } | AgentItem::TaskNotification { .. }
            )
        }));
        // User corrections outrank agent narration. Plans and task results
        // outrank bulky raw output. All selected entries retain source order.
        for priority in 0..4 {
            for (index, entry) in entries.iter().enumerate().rev() {
                let group = match entry.item {
                    AgentItem::UserMessage { .. } => 0,
                    AgentItem::AgentMessage { .. }
                    | AgentItem::Plan { .. }
                    | AgentItem::Subagent { .. }
                    | AgentItem::TaskNotification { .. } => 1,
                    AgentItem::Reasoning { .. } => 3,
                    _ => 2,
                };
                if group == priority {
                    add(Some(index));
                }
            }
        }
    }
    selected
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_known_window_reserves_room_and_unknown_is_not_a_token_claim() {
        assert_eq!(inline_budget(Some(32_000), 1000), 15_000);
        assert_eq!(inline_budget(Some(1_000_000), 0), MAX_INLINE_BYTES);
        assert_eq!(inline_budget(None, 200_000), MAX_INLINE_BYTES);
        assert_eq!(inline_budget(Some(100), 200), 0);
    }

    #[test]
    fn excerpts_preserve_both_ends_and_utf8_within_budget() {
        let original = format!("начало {} конец", "ёж🦀".repeat(1000));
        let clipped = excerpt(&original, 513);
        assert!(clipped.starts_with("начало ") && clipped.ends_with(" конец"));
        assert!(clipped.contains(EXCERPT));
        assert!(clipped.len() <= 513);
    }
}
