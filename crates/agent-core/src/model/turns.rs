//! `thread.turns` paging semantics shared by every provider that pages a
//! complete turn list: the cursor is the last returned turn id and pages are
//! strictly after it in the requested direction.

use super::{
    operations::{ERROR_INVALID_PARAMS, ItemsView, RpcError, SortDirection, ThreadTurnsResult},
    thread::{AgentItem, AgentTurn, MessagePhase},
};

/// The largest page a provider returns.
pub const MAX_TURNS_PAGE: usize = 200;

/// One page of `turns` (history order) after `cursor`, with `view` applied.
///
/// # Errors
/// Returns `-32602 "invalid turns cursor"` for a cursor that is not a turn id.
pub fn page_turns(
    turns: &[AgentTurn],
    cursor: Option<&str>,
    limit: u32,
    direction: SortDirection,
    view: ItemsView,
) -> Result<ThreadTurnsResult, RpcError> {
    let ordered: Vec<&AgentTurn> = match direction {
        SortDirection::Asc => turns.iter().collect(),
        SortDirection::Desc => turns.iter().rev().collect(),
    };
    let start = match cursor {
        None => 0,
        Some(cursor) => {
            ordered
                .iter()
                .position(|turn| turn.turn_id.as_str() == cursor)
                .ok_or_else(|| RpcError {
                    code: ERROR_INVALID_PARAMS,
                    message: "invalid turns cursor".into(),
                    data: None,
                })?
                + 1
        }
    };
    let size = usize::try_from(limit)
        .unwrap_or(MAX_TURNS_PAGE)
        .clamp(1, MAX_TURNS_PAGE);
    let page = ordered
        .iter()
        .skip(start)
        .take(size)
        .map(|turn| view_items(turn, view))
        .collect::<Vec<_>>();
    let next_cursor = page
        .last()
        .filter(|_| start + size < ordered.len())
        .map(|turn| turn.turn_id.as_str().to_owned());
    Ok(ThreadTurnsResult {
        turns: page,
        next_cursor,
    })
}

/// Whether the `summary` items view keeps `item`: the user messages and the
/// final answer (what delivery reconciliation and the thread preview read),
/// the sub-agent launches (a client shows which agents a turn started and
/// which still run) and the background task reports (shown outside the
/// turn's collapsed body). No other activity item. The one summary rule:
/// `thread.turns` pages and the wire projector both apply it.
#[must_use]
pub const fn in_summary_view(item: &AgentItem) -> bool {
    matches!(
        item,
        AgentItem::UserMessage { .. }
            | AgentItem::Subagent { .. }
            | AgentItem::TaskNotification { .. }
            | AgentItem::AgentMessage {
                phase: MessagePhase::Final,
                ..
            }
    )
}

/// A turn with only the items `view` includes: none, those
/// [`in_summary_view`] keeps, or all.
#[must_use]
pub fn view_items(turn: &AgentTurn, view: ItemsView) -> AgentTurn {
    let items = match view {
        ItemsView::Full => turn.items.clone(),
        ItemsView::NotLoaded => Vec::new(),
        ItemsView::Summary => turn
            .items
            .iter()
            .filter(|item| in_summary_view(item))
            .cloned()
            .collect(),
    };
    AgentTurn {
        provenance: None,
        turn_id: turn.turn_id.clone(),
        status: turn.status,
        origin: turn.origin,
        started_at: turn.started_at,
        completed_at: turn.completed_at,
        error: turn.error.clone(),
        items,
        usage: turn.usage.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{
        ExecutionStatus, ItemId, SubagentStatus, TaskNotificationDelivery, TaskNotificationSource,
        TaskNotificationStatus, TurnId, TurnOrigin, TurnStatus,
    };

    fn turn(id: &str) -> AgentTurn {
        AgentTurn {
            provenance: None,
            turn_id: TurnId::parse(id).unwrap_or_else(|| TurnId::from_static("x")),
            status: TurnStatus::Completed,
            origin: TurnOrigin::User,
            started_at: 1,
            completed_at: Some(2),
            error: None,
            items: Vec::new(),
            usage: None,
        }
    }

    fn ids(result: &ThreadTurnsResult) -> Vec<&str> {
        result
            .turns
            .iter()
            .map(|turn| turn.turn_id.as_str())
            .collect()
    }

    #[test]
    fn pages_strictly_after_the_cursor_in_both_directions() -> Result<(), RpcError> {
        let turns = [turn("a"), turn("b"), turn("c")];
        let first = page_turns(&turns, None, 2, SortDirection::Desc, ItemsView::Full)?;
        assert_eq!(ids(&first), ["c", "b"]);
        assert_eq!(first.next_cursor.as_deref(), Some("b"));
        let second = page_turns(&turns, Some("b"), 2, SortDirection::Desc, ItemsView::Full)?;
        assert_eq!(ids(&second), ["a"]);
        assert_eq!(second.next_cursor, None);
        let ascending = page_turns(&turns, Some("a"), 5, SortDirection::Asc, ItemsView::Full)?;
        assert_eq!(ids(&ascending), ["b", "c"]);
        let error = page_turns(&turns, Some("x"), 1, SortDirection::Asc, ItemsView::Full)
            .err()
            .map(|error| error.code);
        assert_eq!(error, Some(ERROR_INVALID_PARAMS));
        Ok(())
    }

    fn item_ids(turn: &AgentTurn) -> Vec<&str> {
        turn.items
            .iter()
            .map(|item| item.item_id().as_str())
            .collect()
    }

    /// A wake turn that launched a background agent while a report arrived:
    /// one item of each kind the summary rule decides on.
    fn wake_turn() -> AgentTurn {
        let message = |id: &'static str, phase| AgentItem::AgentMessage {
            item_id: ItemId::from_static(id),
            provenance: None,
            text: id.into(),
            phase,
        };
        let mut wake = turn("wake");
        wake.items = vec![
            AgentItem::TaskNotification {
                item_id: ItemId::from_static("report"),
                provenance: None,
                delivery: TaskNotificationDelivery::Wake,
                source: TaskNotificationSource::Command {
                    agent_thread_id: (),
                },
                task_id: "b1".into(),
                name: "npm test".into(),
                status: TaskNotificationStatus::Completed,
                duration_ms: None,
                tool_uses: None,
                result: None,
            },
            message("commentary", MessagePhase::Commentary),
            AgentItem::Command {
                item_id: ItemId::from_static("command"),
                provenance: None,
                command: "npm test".into(),
                cwd: "/w".into(),
                status: ExecutionStatus::Completed,
                output: None,
                exit_code: Some(0),
                duration_ms: None,
            },
            AgentItem::Subagent {
                item_id: ItemId::from_static("launch"),
                provenance: None,
                agent_thread_id: None,
                agent_type: None,
                background: true,
                description: "Review the diff".into(),
                model: None,
                prompt: "Review it.".into(),
                result: None,
                status: SubagentStatus::Running,
            },
            message("final", MessagePhase::Final),
        ];
        wake
    }

    #[test]
    fn a_summary_page_keeps_messages_launches_and_task_reports_only() -> Result<(), RpcError> {
        let turns = [turn("a"), wake_turn()];
        let summary = page_turns(&turns, Some("a"), 5, SortDirection::Asc, ItemsView::Summary)?;
        assert_eq!(
            summary.turns.iter().map(item_ids).collect::<Vec<_>>(),
            [vec!["report", "launch", "final"]]
        );
        let full = page_turns(&turns, Some("a"), 5, SortDirection::Asc, ItemsView::Full)?;
        assert_eq!(full.turns[0].items, turns[1].items);
        Ok(())
    }
}
