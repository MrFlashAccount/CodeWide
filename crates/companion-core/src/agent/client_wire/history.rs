//! Semantic history pages (`companion/thread/history/before|after`) for
//! providers without native history storage, built from neutral
//! `thread.turns` pages in the same shape the client validates: summary
//! turns in chronological order, `hasMore`, and an opaque `sourceWitness`.
//!
//! Only immutable (finished) turns belong to history; the active turn stays
//! with the thread view. Provider turn cursors are the last returned turn id
//! and pages are strictly after it in the requested direction.
//!
//! A finished turn is not always final: a session driven outside the
//! companion (Claude in a terminal) keeps appending to its newest turn, and
//! the provider has no live turn for it. The thread view's witness is
//! therefore the content of the newest turn, and a changed anchor turn is
//! sent again. Such a change reaches open conversations as a thread
//! invalidation ([`history_invalidation`]).

use serde_json::{Value, json};

use super::{
    gateway::{RpcFailure, Target},
    items,
};
use crate::agent::{
    model::{
        AgentTurn, ERROR_INVALID_PARAMS, ItemsView, SortDirection, ThreadTurnsParams, TurnStatus,
    },
    provider::HistoryChange,
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

/// The thread view's source witness: the content of the newest finished turn.
fn turn_witness(turn: Option<&AgentTurn>) -> String {
    let encoded = turn.map_or_else(Vec::new, |turn| {
        serde_json::to_vec(turn).unwrap_or_default()
    });
    let digest = blake3::hash(&encoded);
    format!("{SOURCE_WITNESS}:{}", &digest.to_hex()[..32])
}

/// The `history` object of a `companion/thread/sync` answer from the latest
/// finished turns (chronological, as [`latest`] returns them).
///
/// - The client's anchor (`after_turn_id`) inside the window: the turns after
///   it as a `delta`, plus the anchor itself when its content no longer
///   matches the client's witness; `current` when nothing changed.
/// - Otherwise a `reset` to the window.
#[must_use]
pub fn sync_history(
    turns: &[AgentTurn],
    head_turn_id: Option<&str>,
    older_cursor: Option<&str>,
    after_turn_id: Option<&str>,
    source_witness: Option<&str>,
) -> Value {
    let witness = turn_witness(turns.last());
    let anchor = after_turn_id
        .and_then(|after| turns.iter().position(|turn| turn.turn_id.as_str() == after));
    let Some(anchor) = anchor else {
        return json!({
            "kind": "reset",
            "headTurnId": head_turn_id,
            "turns": turns.iter().map(|turn| items::turn(turn, ItemsView::Full)).collect::<Vec<_>>(),
            "hasMore": false,
            "olderCursor": older_cursor,
            "sourceWitness": witness,
        });
    };
    let anchor_unchanged = source_witness == Some(turn_witness(turns.get(anchor)).as_str());
    let first = if anchor_unchanged { anchor + 1 } else { anchor };
    let changed = turns.get(first..).unwrap_or_default();
    json!({
        "kind": if changed.is_empty() { "current" } else { "delta" },
        "headTurnId": head_turn_id,
        "turns": changed.iter().map(|turn| items::turn(turn, ItemsView::Full)).collect::<Vec<_>>(),
        "hasMore": false,
        "olderCursor": Value::Null,
        "sourceWitness": witness,
    })
}

/// The thread invalidation of a [`HistoryChange`], in the shape of the Codex
/// rollout invalidation: the client re-reads the open conversation through
/// `companion/thread/sync` and marks the thread list row active.
#[must_use]
pub fn history_invalidation(change: &HistoryChange) -> Value {
    let thread_id = change.app_thread_id.as_str();
    json!({
        "method": "companion/thread/invalidated",
        "params": {
            "threadId": thread_id,
            "archived": change.archived,
            "turnActive": false,
            "source": "providerHistory"
        },
        "codewideThreadPatch": {
            "version": 1,
            "threadId": thread_id,
            "operation": {
                "kind": "threadInvalidated",
                "archived": change.archived,
                "turnActive": false,
                "summary": {
                    "activity": true,
                    "conversationMessage": false,
                    "finalAgentResponse": false
                }
            }
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent::model::{AppThreadId, TurnId, TurnOrigin};

    fn turn(id: &'static str, completed_at: i64) -> AgentTurn {
        AgentTurn {
            turn_id: TurnId::from_static(id),
            status: TurnStatus::Completed,
            origin: TurnOrigin::User,
            started_at: 1,
            completed_at: Some(completed_at),
            error: None,
            items: Vec::new(),
            provenance: None,
            usage: None,
        }
    }

    fn ids(history: &Value) -> Vec<&str> {
        history["turns"]
            .as_array()
            .map(|turns| {
                turns
                    .iter()
                    .filter_map(|turn| turn["id"].as_str())
                    .collect()
            })
            .unwrap_or_default()
    }

    #[test]
    fn a_head_turn_appended_to_outside_the_companion_is_sent_again() {
        let first = [turn("a", 2), turn("b", 3)];
        let opened = sync_history(&first, Some("b"), None, None, None);
        assert_eq!(opened["kind"], "reset");
        assert_eq!(ids(&opened), ["a", "b"]);
        let witness = opened["sourceWitness"]
            .as_str()
            .unwrap_or_default()
            .to_owned();

        // Nothing changed since the client's read.
        let unchanged = sync_history(&first, Some("b"), None, Some("b"), Some(&witness));
        assert_eq!(unchanged["kind"], "current");
        assert_eq!(unchanged["sourceWitness"], witness.as_str());

        // A terminal kept writing into the newest turn: it comes again.
        let grown = [turn("a", 2), turn("b", 9)];
        let delta = sync_history(&grown, Some("b"), None, Some("b"), Some(&witness));
        assert_eq!(delta["kind"], "delta");
        assert_eq!(ids(&delta), ["b"]);
        assert_eq!(delta["turns"][0]["completedAt"], 9);
        assert_ne!(delta["sourceWitness"], witness.as_str());

        // A newer turn: only what follows the unchanged anchor.
        let witness = delta["sourceWitness"]
            .as_str()
            .unwrap_or_default()
            .to_owned();
        let newer = [turn("a", 2), turn("b", 9), turn("c", 10)];
        let appended = sync_history(&newer, Some("c"), None, Some("b"), Some(&witness));
        assert_eq!(appended["kind"], "delta");
        assert_eq!(ids(&appended), ["c"]);
        assert_eq!(appended["headTurnId"], "c");

        // An anchor outside the window resets it.
        let reset = sync_history(&newer, Some("c"), Some("a"), Some("gone"), Some(&witness));
        assert_eq!(reset["kind"], "reset");
        assert_eq!(ids(&reset), ["a", "b", "c"]);
        assert_eq!(reset["olderCursor"], "a");
    }

    #[test]
    fn a_history_change_is_the_patch_the_client_repairs_an_open_thread_from() {
        let payload = history_invalidation(&HistoryChange {
            app_thread_id: AppThreadId::from_static("terminal-session"),
            archived: true,
        });
        assert_eq!(payload["method"], "companion/thread/invalidated");
        let patch = &payload[crate::thread_patch::THREAD_PATCH_FIELD];
        assert_eq!(patch["version"], 1);
        assert_eq!(patch["threadId"], "terminal-session");
        assert_eq!(patch["operation"]["kind"], "threadInvalidated");
        assert_eq!(patch["operation"]["archived"], true);
        assert_eq!(patch["operation"]["summary"]["activity"], true);
        // The companion's own patch compiler leaves it as is.
        assert_eq!(
            crate::thread_patch::attach_thread_patch(payload.clone()),
            payload
        );
    }
}
