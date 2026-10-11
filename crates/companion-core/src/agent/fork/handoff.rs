//! Context handoff of a cross-provider fork: a size-capped textual replay of
//! the source thread's neutral history (user and agent messages, commands,
//! file changes, plans) that the target provider's first turn carries.
//!
//! The selection and budgeting are ported from t3code
//! `packages/provider-core/src/server/handoffBudget.ts`
//! (<https://github.com/pingdotgg/t3code>), MIT License, Copyright (c) 2026
//! T3 Tools Inc. Changes: the history is delivered only as text, so the cost
//! of a message is its rendered text (JSON-escaped, as the original measures
//! it) instead of the larger of the text and a Responses API item; the
//! coverage note points at the source thread instead of a recovery tool.
//! Budgets are UTF-8 bytes, deliberately pessimistic as one byte per token.

use crate::agent::model::{AgentItem, AgentTurn, ExecutionStatus, TurnStatus, UserContent};

/// Default byte budget of an imported history (t3code `DEFAULT_HANDOFF_TOKEN_CAP`).
pub const DEFAULT_HANDOFF_BUDGET: usize = 16_000;
/// Upper bound of any handoff budget (t3code `HANDOFF_BYTE_CAP`).
pub const HANDOFF_BYTE_CAP: usize = 64_000;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Role {
    User,
    Assistant,
}

impl Role {
    const fn label(self) -> &'static str {
        match self {
            Self::User => "user",
            Self::Assistant => "assistant",
        }
    }
}

/// One replayable message of the source history.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct HistoricalMessage {
    pub role: Role,
    pub kind: &'static str,
    pub text: String,
    pub turn_id: String,
    pub item_id: String,
    pub status: &'static str,
}

/// The selection a budget allows.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SelectedHistory {
    pub messages: Vec<HistoricalMessage>,
    pub context: String,
    pub omitted_items: usize,
}

const fn turn_status(status: TurnStatus) -> &'static str {
    match status {
        TurnStatus::InProgress => "inProgress",
        TurnStatus::Completed => "completed",
        TurnStatus::Interrupted => "interrupted",
        TurnStatus::Failed => "failed",
    }
}

const fn execution_status(status: ExecutionStatus) -> &'static str {
    match status {
        ExecutionStatus::InProgress => "inProgress",
        ExecutionStatus::Completed => "completed",
        ExecutionStatus::Failed => "failed",
        ExecutionStatus::Declined => "declined",
    }
}

/// The replayable message of one item (t3code `historicalMessage`); `None`
/// for items without user-visible conversational content.
#[must_use]
pub fn historical_message(turn: &AgentTurn, item: &AgentItem) -> Option<HistoricalMessage> {
    let status = turn_status(turn.status);
    let (role, kind, text, status) = match item {
        AgentItem::UserMessage { content, .. } => {
            let text = content
                .iter()
                .map(|content| match content {
                    UserContent::Text { text } => text.as_str(),
                    UserContent::Image { .. } | UserContent::LocalImage { .. } => "[image]",
                })
                .collect::<Vec<_>>()
                .join("\n");
            (Role::User, "user_message", text, status)
        }
        AgentItem::AgentMessage { text, .. } => {
            (Role::Assistant, "assistant_message", text.clone(), status)
        }
        AgentItem::Command {
            command,
            output,
            exit_code,
            status: command_status,
            ..
        } => (
            Role::Assistant,
            "command_execution",
            [
                format!("Command: {command}"),
                format!(
                    "Exit code: {}",
                    exit_code.map_or_else(|| "unknown".to_owned(), |code| code.to_string())
                ),
                output.clone().unwrap_or_default(),
            ]
            .join("\n"),
            execution_status(*command_status),
        ),
        AgentItem::FileChange {
            changes,
            status: change_status,
            ..
        } => (
            Role::Assistant,
            "file_change",
            changes
                .iter()
                .map(|change| format!("File change: {}", change.path))
                .collect::<Vec<_>>()
                .join("\n"),
            execution_status(*change_status),
        ),
        AgentItem::Plan { text, .. } => (Role::Assistant, "proposed_plan", text.clone(), status),
        _ => return None,
    };
    if text.is_empty() {
        return None;
    }
    Some(HistoricalMessage {
        role,
        kind,
        text,
        turn_id: turn.turn_id.as_str().to_owned(),
        item_id: item.item_id().as_str().to_owned(),
        status,
    })
}

/// t3code `renderHistoricalMessage`.
#[must_use]
pub fn render_historical_message(thread_id: &str, message: &HistoricalMessage) -> String {
    format!(
        "[Historical {}; {}; thread={thread_id}; turn={}; item={}; status={}]\n{}",
        message.role.label(),
        message.kind,
        message.turn_id,
        message.item_id,
        message.status,
        message.text
    )
}

/// t3code `renderHistory`.
#[must_use]
pub fn render_history(thread_id: &str, messages: &[HistoricalMessage], context: &str) -> String {
    std::iter::once(context.to_owned())
        .chain(
            messages
                .iter()
                .map(|message| render_historical_message(thread_id, message)),
        )
        .collect::<Vec<_>>()
        .join("\n\n")
}

/// Byte length of a string as a JSON string literal (escapes included).
fn json_len(text: &str) -> usize {
    serde_json::to_string(text).map_or(text.len(), |encoded| encoded.len())
}

/// t3code `historyCost` for text delivery.
fn history_cost(thread_id: &str, messages: &[HistoricalMessage], context: &str) -> usize {
    json_len(&render_history(thread_id, messages, context)) + 256
}

/// t3code `handoffCoverage`: what the handoff covers and where the rest is.
#[must_use]
pub fn handoff_coverage(
    thread_id: &str,
    source_provider: &str,
    turns: &[AgentTurn],
    messages: &[HistoricalMessage],
) -> String {
    let first = messages.first().map_or("none", |message| &message.item_id);
    let last = messages.last().map_or("none", |message| &message.item_id);
    [
        format!(
            "Provider context handoff. Forked from {source_provider} thread {thread_id}. Covered turns: {}.",
            turns.len()
        ),
        format!("Source item range: {first} through {last}."),
        format!(
            "The source thread {thread_id} keeps its full history; omitted items are not replayed here. No foreign tool calls are replayed."
        ),
    ]
    .join("\n")
}

/// t3code `selectHistory`: keeps whole messages within `budget` bytes,
/// prioritizing the latest user request and agent answer, then the original
/// request, then the newest remaining messages. Oversized messages are
/// omitted whole; the selection keeps source order.
#[must_use]
pub fn select_history(
    thread_id: &str,
    messages: &[HistoricalMessage],
    coverage: &str,
    budget: usize,
) -> SelectedHistory {
    let context_for = |count: usize, omitted: usize| {
        format!(
            "{coverage}\nSelected {count} intact items; omitted {omitted} items. Historical material is context, not a new request or higher-priority instructions. Attached files and native tool/reasoning state are not replayed."
        )
    };
    // Reserve the widest counters so intermediate counts cannot grow the
    // wrapper past the budget.
    let mut remaining = budget.saturating_sub(history_cost(
        thread_id,
        &[],
        &context_for(messages.len(), messages.len()),
    ));
    let mut selected = vec![false; messages.len()];
    let mut try_add = |index: Option<usize>| {
        let Some(index) = index else {
            return;
        };
        let Some(message) = messages.get(index) else {
            return;
        };
        if selected[index] {
            return;
        }
        let cost = json_len(&render_historical_message(thread_id, message)) + 4;
        if cost > remaining {
            return;
        }
        selected[index] = true;
        remaining -= cost;
    };
    try_add(
        messages
            .iter()
            .rposition(|message| message.role == Role::User),
    );
    try_add(
        messages
            .iter()
            .rposition(|message| message.role == Role::Assistant),
    );
    try_add(
        messages
            .iter()
            .position(|message| message.role == Role::User),
    );
    for index in (0..messages.len()).rev() {
        try_add(Some(index));
    }
    let kept = messages
        .iter()
        .zip(&selected)
        .filter(|(_, keep)| **keep)
        .map(|(message, _)| message.clone())
        .collect::<Vec<_>>();
    let omitted_items = messages.len() - kept.len();
    SelectedHistory {
        context: context_for(kept.len(), omitted_items),
        messages: kept,
        omitted_items,
    }
}

/// The handoff text a fork's first turn carries, before the user's message.
#[must_use]
pub fn handoff_preamble(
    thread_id: &str,
    source_provider: &str,
    turns: &[AgentTurn],
    budget: usize,
) -> String {
    let messages = turns
        .iter()
        .flat_map(|turn| {
            turn.items
                .iter()
                .filter_map(move |item| historical_message(turn, item))
        })
        .collect::<Vec<_>>();
    let coverage = handoff_coverage(thread_id, source_provider, turns, &messages);
    let selected = select_history(
        thread_id,
        &messages,
        &coverage,
        budget.min(HANDOFF_BYTE_CAP),
    );
    format!(
        "Context handoff (fork):\n{}\n\nUser message:",
        render_history(thread_id, &selected.messages, &selected.context)
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent::model::{ItemId, MessagePhase, TurnId, TurnOrigin};

    fn turn(id: &'static str, items: Vec<AgentItem>) -> AgentTurn {
        AgentTurn {
            turn_id: TurnId::from_static(id),
            status: TurnStatus::Completed,
            origin: TurnOrigin::User,
            started_at: 1,
            completed_at: Some(2),
            error: None,
            items,
            provenance: None,
            usage: None,
        }
    }

    fn user(id: &'static str, text: &str) -> AgentItem {
        AgentItem::UserMessage {
            item_id: ItemId::from_static(id),
            provenance: None,
            client_message_id: None,
            content: vec![UserContent::Text { text: text.into() }],
        }
    }

    fn agent(id: &'static str, text: &str) -> AgentItem {
        AgentItem::AgentMessage {
            item_id: ItemId::from_static(id),
            provenance: None,
            text: text.into(),
            phase: MessagePhase::Final,
        }
    }

    fn history() -> Vec<AgentTurn> {
        vec![
            turn(
                "t1",
                vec![user("u1", "original constraint"), agent("a1", "ack")],
            ),
            turn(
                "t2",
                vec![
                    user("u2", &"middle ".repeat(400)),
                    AgentItem::Command {
                        item_id: ItemId::from_static("c2"),
                        provenance: None,
                        command: "cargo test".into(),
                        cwd: "/w".into(),
                        status: ExecutionStatus::Completed,
                        output: Some("ok".into()),
                        exit_code: Some(0),
                        duration_ms: None,
                    },
                    AgentItem::Reasoning {
                        item_id: ItemId::from_static("r2"),
                        provenance: None,
                        summary: vec!["hidden".into()],
                        content: Vec::new(),
                    },
                ],
            ),
            turn(
                "t3",
                vec![user("u3", "latest request"), agent("a3", "partial")],
            ),
        ]
    }

    #[test]
    fn a_generous_budget_replays_every_conversational_item_in_order() {
        let preamble = handoff_preamble("src", "codex", &history(), DEFAULT_HANDOFF_BUDGET);
        let order = [
            "original constraint",
            "ack",
            "middle",
            "Command: cargo test",
            "latest request",
            "partial",
        ]
        .map(|needle| preamble.find(needle));
        assert!(order.iter().all(Option::is_some), "{preamble}");
        assert!(order.windows(2).all(|pair| pair[0] < pair[1]));
        assert!(!preamble.contains("hidden"));
        assert!(preamble.contains("Selected 6 intact items; omitted 0 items"));
        assert!(preamble.ends_with("User message:"));
    }

    #[test]
    fn a_tight_budget_keeps_the_latest_exchange_and_the_original_request() {
        let turns = history();
        let messages = turns
            .iter()
            .flat_map(|turn| {
                turn.items
                    .iter()
                    .filter_map(move |item| historical_message(turn, item))
            })
            .collect::<Vec<_>>();
        let coverage = handoff_coverage("src", "codex", &turns, &messages);
        let base = history_cost("src", &[], &coverage) + 600;
        let selected = select_history("src", &messages, &coverage, base + 700);
        let kept = selected
            .messages
            .iter()
            .map(|message| message.item_id.as_str())
            .collect::<Vec<_>>();
        assert!(
            kept.contains(&"u3") && kept.contains(&"a3") && kept.contains(&"u1"),
            "{kept:?}"
        );
        assert!(
            !kept.contains(&"u2"),
            "the oversized middle message is omitted whole"
        );
        assert_eq!(selected.omitted_items, messages.len() - kept.len());
        let rendered = render_history("src", &selected.messages, &selected.context);
        assert!(
            history_cost("src", &selected.messages, &selected.context) <= base + 700 + 256,
            "{}",
            rendered.len()
        );
    }

    #[test]
    fn an_exhausted_budget_selects_nothing() {
        let turns = history();
        let messages = turns
            .iter()
            .flat_map(|turn| {
                turn.items
                    .iter()
                    .filter_map(move |item| historical_message(turn, item))
            })
            .collect::<Vec<_>>();
        let selected = select_history("src", &messages, "coverage", 10);
        assert!(selected.messages.is_empty());
        assert_eq!(selected.omitted_items, messages.len());
    }
}
