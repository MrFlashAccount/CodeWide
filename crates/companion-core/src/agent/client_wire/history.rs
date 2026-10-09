//! Semantic history pages (`companion/thread/history/before|after`) for
//! providers without native history storage, built from neutral
//! `thread.turns` pages in the same shape the client validates: summary
//! turns in chronological order, `hasMore`, and an opaque `sourceWitness`.
//!
//! Only immutable (finished) turns belong to history; the active turn stays
//! with the thread view. Provider turn cursors are the last returned turn id
//! and pages are strictly after it in the requested direction.

use serde_json::{Value, json};

use super::{
    gateway::{RpcFailure, Target},
    items,
};
use crate::agent::model::{
    AgentTurn, ERROR_INVALID_PARAMS, ItemsView, SortDirection, ThreadTurnsParams, TurnStatus,
};

/// Opaque witness of the provider-owned history source. The provider's
/// journal is append-only per thread, so one constant witness is exact.
pub const SOURCE_WITNESS: &str = "codewide-agent-history-v1";
const MAX_PAGE_SIZE: u64 = 100;

/// Direction of a semantic page relative to its anchor.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Anchor {
    Before,
    After,
}

fn is_immutable(turn: &AgentTurn) -> bool {
    turn.status != TurnStatus::InProgress
}

/// Reads one semantic page.
///
/// # Errors
/// Returns `-32602` for invalid params or the provider failure.
pub async fn page(target: &Target, params: &Value, anchor: Anchor) -> Result<Value, RpcFailure> {
    let field = match anchor {
        Anchor::Before => "beforeTurnId",
        Anchor::After => "afterTurnId",
    };
    let anchor_turn = params
        .get(field)
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| RpcFailure::new(ERROR_INVALID_PARAMS, format!("{field} is required")))?;
    let limit = params
        .get("limit")
        .and_then(Value::as_u64)
        .filter(|limit| (1..=MAX_PAGE_SIZE).contains(limit))
        .ok_or_else(|| RpcFailure::new(ERROR_INVALID_PARAMS, "limit is invalid"))?;
    let limit = usize::try_from(limit).unwrap_or(1);
    let direction = match anchor {
        Anchor::Before => SortDirection::Desc,
        Anchor::After => SortDirection::Asc,
    };
    let result = target
        .provider
        .thread_turns(ThreadTurnsParams {
            app_thread_id: target.thread_id.clone(),
            cursor: Some(anchor_turn.to_owned()),
            limit: u32::try_from(limit.saturating_add(1)).unwrap_or(u32::MAX),
            sort_direction: direction,
            items_view: ItemsView::Summary,
        })
        .await
        .map_err(|error| RpcFailure::from_provider(&error))?;
    let mut turns = result
        .turns
        .into_iter()
        .filter(is_immutable)
        .take(limit.saturating_add(1))
        .collect::<Vec<_>>();
    let has_more = turns.len() > limit || (turns.len() == limit && result.next_cursor.is_some());
    turns.truncate(limit);
    if anchor == Anchor::Before {
        turns.reverse();
    }
    Ok(json!({
        "data": turns.iter().map(|turn| items::turn(turn, ItemsView::Summary)).collect::<Vec<_>>(),
        "hasMore": has_more,
        "sourceWitness": SOURCE_WITNESS,
    }))
}

/// Latest immutable history for a thread view reset: up to `limit` finished
/// turns in chronological order, the newest finished turn id, and the cursor
/// for older pages.
///
/// # Errors
/// Returns the provider failure.
pub async fn latest(
    target: &Target,
    limit: usize,
) -> Result<(Vec<AgentTurn>, Option<String>, Option<String>), RpcFailure> {
    let result = target
        .provider
        .thread_turns(ThreadTurnsParams {
            app_thread_id: target.thread_id.clone(),
            cursor: None,
            limit: u32::try_from(limit.saturating_add(1)).unwrap_or(u32::MAX),
            sort_direction: SortDirection::Desc,
            items_view: ItemsView::Full,
        })
        .await
        .map_err(|error| RpcFailure::from_provider(&error))?;
    let mut turns = result
        .turns
        .into_iter()
        .filter(is_immutable)
        .collect::<Vec<_>>();
    let head = turns.first().map(|turn| turn.turn_id.as_str().to_owned());
    let older_cursor = if turns.len() > limit || result.next_cursor.is_some() {
        turns.truncate(limit);
        turns.last().map(|turn| turn.turn_id.as_str().to_owned())
    } else {
        None
    };
    turns.reverse();
    Ok((turns, head, older_cursor))
}
