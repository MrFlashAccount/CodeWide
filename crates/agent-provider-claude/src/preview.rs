//! The thread-list preview of a Claude thread: its newest conversation
//! message (`AgentThread.preview`, see `docs/agent-providers.md`), with the
//! rule the Codex adapter applies to a rollout's latest turn: a finished
//! turn's last final answer, else its last agent or user message. User text
//! is shown as the conversation shows it (`ClaudeUserText`); whitespace runs
//! collapse to one space and the text is cut to 200 UTF-16 code units, as the
//! host's preview.

use agent_core::model::{AgentItem, AgentTurn, MessagePhase, TurnStatus, UserContent};

use crate::user_text::ClaudeUserText;

const PREVIEW_MAX_UTF16: usize = 200;

/// The preview of the newest message in `turns` (history order). A turn
/// without any message (a wake turn that only ran tools) yields to the turn
/// before it; `None` when no turn holds one.
#[must_use]
pub fn newest_message(turns: &[AgentTurn]) -> Option<String> {
    turns.iter().rev().find_map(turn_message)
}

/// The preview of user-authored text; `None` for model-only context.
#[must_use]
pub fn user_text(text: &str) -> Option<String> {
    agent_core::user_text::display_text(text, &ClaudeUserText)
        .map(|text| normalize(&text))
        .filter(|text| !text.is_empty())
}

fn turn_message(turn: &AgentTurn) -> Option<String> {
    let final_answer = (turn.status != TurnStatus::InProgress)
        .then(|| {
            turn.items.iter().rev().find_map(|item| match item {
                AgentItem::AgentMessage {
                    text,
                    phase: MessagePhase::Final,
                    ..
                } => agent_text(text),
                _ => None,
            })
        })
        .flatten();
    final_answer.or_else(|| {
        turn.items.iter().rev().find_map(|item| match item {
            AgentItem::AgentMessage { text, .. } => agent_text(text),
            AgentItem::UserMessage { content, .. } => content.iter().find_map(|part| match part {
                UserContent::Text { text } => user_text(text),
                UserContent::Image { .. } | UserContent::LocalImage { .. } => None,
            }),
            _ => None,
        })
    })
}

fn agent_text(text: &str) -> Option<String> {
    Some(normalize(text)).filter(|text| !text.is_empty())
}

/// Whitespace runs collapsed to one space, cut to the preview length.
fn normalize(text: &str) -> String {
    let mut units = 0;
    let mut out = String::new();
    for word in text.split_whitespace() {
        let separator = usize::from(!out.is_empty());
        if units + separator >= PREVIEW_MAX_UTF16 {
            break;
        }
        if separator == 1 {
            out.push(' ');
            units += 1;
        }
        for character in word.chars() {
            units += character.len_utf16();
            if units > PREVIEW_MAX_UTF16 {
                return out;
            }
            out.push(character);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::turn;

    #[test]
    fn the_newest_final_answer_wins_over_earlier_messages() {
        let turns = [turn("s", "first", 1), turn("s", "second", 2)];
        assert_eq!(newest_message(&turns).as_deref(), Some("answer to second"));
    }

    #[test]
    fn a_running_turn_shows_its_newest_message() {
        let mut running = turn("s", "still  typing\nhere", 2);
        running.status = TurnStatus::InProgress;
        running.items.truncate(1);
        let turns = [turn("s", "first", 1), running];
        assert_eq!(newest_message(&turns).as_deref(), Some("still typing here"));
    }

    #[test]
    fn a_turn_without_messages_yields_to_the_one_before() {
        let mut wake = turn("s", "wake", 2);
        wake.items.clear();
        let turns = [turn("s", "first", 1), wake];
        assert_eq!(newest_message(&turns).as_deref(), Some("answer to first"));
        assert_eq!(newest_message(&[]), None);
    }

    #[test]
    fn model_context_is_not_a_preview() {
        let mut notification = turn("s", "<task-notification>done</task-notification>", 2);
        notification.status = TurnStatus::InProgress;
        notification.items.truncate(1);
        let turns = [turn("s", "first", 1), notification];
        assert_eq!(newest_message(&turns).as_deref(), Some("answer to first"));
    }

    #[test]
    fn previews_are_cut_to_200_utf16_units() {
        let long = "😀".repeat(150);
        let preview = user_text(&long).unwrap_or_default();
        assert_eq!(preview.encode_utf16().count(), 200);
        assert!(long.starts_with(&preview));
    }
}
