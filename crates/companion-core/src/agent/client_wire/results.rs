//! Neutral operation results → client-wire RPC results for thread-scoped
//! calls on providers without the `codex.native` surface.

use serde_json::{Value, json};

use super::{
    WireProvider, decode,
    gateway::{RpcFailure, Target},
    items, settings,
};
use crate::agent::model::{
    AgentTurn, ERROR_INVALID_PARAMS, ERROR_INVALID_REQUEST, ItemsView, SortDirection, ThreadChange,
    ThreadTurnsParams, ThreadUpdateParams, TurnInterruptParams, TurnStartParams, TurnStartResult,
    TurnSteerParams,
};

/// Turns read when a call asks for a thread's whole history.
const FULL_HISTORY_PAGE: u32 = 100;
const MAX_TURNS_PAGE: u64 = 100;

/// The `turn/start` result: the turn id with Codex's "not started yet" shape.
#[must_use]
pub fn turn_started(turn_id: &str) -> Value {
    json!({"turn": {
        "id": turn_id,
        "items": [],
        "itemsView": "notLoaded",
        "status": "inProgress",
        "error": null,
        "startedAt": null,
        "completedAt": null,
        "durationMs": null,
    }})
}

/// A `thread/turns/list` page.
#[must_use]
pub fn turns_page(turns: &[AgentTurn], view: ItemsView, next_cursor: Option<&str>) -> Value {
    json!({
        "data": turns.iter().map(|turn| items::turn(turn, view)).collect::<Vec<_>>(),
        "nextCursor": next_cursor,
        "backwardsCursor": null,
    })
}

fn failure(error: &crate::agent::provider::ProviderError) -> RpcFailure {
    RpcFailure::from_provider(error)
}

async fn all_turns(target: &Target) -> Result<Vec<AgentTurn>, RpcFailure> {
    let page = target
        .provider
        .thread_turns(ThreadTurnsParams {
            app_thread_id: target.thread_id.clone(),
            cursor: None,
            limit: FULL_HISTORY_PAGE,
            sort_direction: SortDirection::Asc,
            items_view: ItemsView::Full,
        })
        .await
        .map_err(|error| failure(&error))?;
    Ok(page.turns)
}

fn projected_thread(
    wire: &WireProvider,
    thread: &crate::agent::model::AgentThread,
    turns: &[AgentTurn],
) -> Value {
    let turns = turns
        .iter()
        .map(|turn| items::turn(turn, ItemsView::Full))
        .collect::<Vec<_>>();
    items::thread(thread, wire, &turns)
}

/// Executes one core thread-scoped client-wire method through neutral
/// operations and returns its wire result.
///
/// # Errors
/// Returns the client-facing failure; methods outside the core set answer
/// `-32072` for `codex.native`.
// WHY: one dispatch table over the core thread methods; each arm is a short
// decode → call → project sequence.
#[allow(clippy::too_many_lines)]
pub async fn execute(target: &Target, method: &str, params: &Value) -> Result<Value, RpcFailure> {
    let provider = &target.provider;
    let thread_id = target.thread_id.clone();
    match method {
        "thread/read" => {
            let read = provider
                .thread_read(&thread_id)
                .await
                .map_err(|error| failure(&error))?;
            let turns = if params.get("includeTurns").and_then(Value::as_bool) == Some(true) {
                all_turns(target).await?
            } else {
                Vec::new()
            };
            Ok(json!({"thread": projected_thread(&target.wire, &read.thread, &turns)}))
        }
        "thread/resume" => {
            let read = provider
                .thread_read(&thread_id)
                .await
                .map_err(|error| failure(&error))?;
            let turns = if params.get("excludeTurns").and_then(Value::as_bool) == Some(true) {
                Vec::new()
            } else {
                all_turns(target).await?
            };
            let mut response = settings::response_envelope(
                &read.thread,
                &target.wire.descriptor.model_provider,
                &projected_thread(&target.wire, &read.thread, &turns),
            );
            response["initialTurnsPage"] = Value::Null;
            response["turnsBackwardsCursor"] = Value::Null;
            response["itemsBackwardsCursor"] = Value::Null;
            Ok(response)
        }
        "thread/turns/list" => {
            let view = decode::items_view(params, ItemsView::Summary);
            let limit = params
                .get("limit")
                .and_then(Value::as_u64)
                .unwrap_or(25)
                .clamp(1, MAX_TURNS_PAGE);
            let page = provider
                .thread_turns(ThreadTurnsParams {
                    app_thread_id: thread_id,
                    cursor: params
                        .get("cursor")
                        .and_then(Value::as_str)
                        .map(str::to_owned),
                    limit: u32::try_from(limit).unwrap_or(25),
                    sort_direction: decode::sort_direction(params),
                    items_view: view,
                })
                .await
                .map_err(|error| failure(&error))?;
            Ok(turns_page(&page.turns, view, page.next_cursor.as_deref()))
        }
        "thread/items/list" => {
            let turn_id = params
                .get("turnId")
                .and_then(Value::as_str)
                .ok_or_else(|| RpcFailure::new(ERROR_INVALID_PARAMS, "turnId is required"))?;
            let turns = all_turns(target).await?;
            let turn = turns
                .iter()
                .find(|turn| turn.turn_id.as_str() == turn_id)
                .ok_or_else(|| {
                    RpcFailure::new(ERROR_INVALID_REQUEST, format!("turn not found: {turn_id}"))
                })?;
            Ok(json!({
                "data": turn.items.iter().map(|item| json!({
                    "turnId": turn.turn_id.as_str(),
                    "item": items::item(item),
                })).collect::<Vec<_>>(),
                "nextCursor": null,
                "backwardsCursor": null,
            }))
        }
        "thread/name/set" => {
            update(
                target,
                ThreadChange::Name {
                    name: params
                        .get("name")
                        .and_then(Value::as_str)
                        .map(str::to_owned),
                },
            )
            .await?;
            Ok(json!({}))
        }
        "thread/archive" => {
            update(target, ThreadChange::Archived { archived: true }).await?;
            Ok(json!({}))
        }
        "thread/unarchive" => {
            let thread = update(target, ThreadChange::Archived { archived: false }).await?;
            Ok(json!({"thread": thread.map(|thread| projected_thread(&target.wire, &thread, &[]))}))
        }
        "thread/delete" => {
            update(target, ThreadChange::Deleted).await?;
            Ok(json!({}))
        }
        "thread/settings/update" => {
            update(target, decode::settings_change(params)).await?;
            Ok(json!({}))
        }
        "thread/compact/start" => {
            provider
                .thread_compact(&thread_id)
                .await
                .map_err(|error| failure(&error))?;
            Ok(json!({}))
        }
        "turn/start" => {
            let input = decode::user_contents(params.get("input").unwrap_or(&Value::Null))
                .map_err(|message| RpcFailure::new(ERROR_INVALID_PARAMS, message))?;
            // A client sends its composer choices with the turn (a new chat
            // sends them only here); they become the thread's settings first.
            if let Some(change) = decode::turn_settings_overrides(params) {
                update(target, change).await?;
            }
            let started = provider
                .turn_start(TurnStartParams {
                    app_thread_id: thread_id,
                    client_message_id: decode::client_message_id(params),
                    input,
                    client_tools: None,
                })
                .await
                .map_err(|error| failure(&error))?;
            match started {
                TurnStartResult::Started { turn_id } => Ok(turn_started(turn_id.as_str())),
                TurnStartResult::Busy { active_turn_id } => Err(RpcFailure::new(
                    ERROR_INVALID_REQUEST,
                    format!("thread has an active turn: {active_turn_id}"),
                )),
            }
        }
        "turn/steer" => {
            let expected_turn_id = decode::turn_id(params, "expectedTurnId").ok_or_else(|| {
                RpcFailure::new(ERROR_INVALID_PARAMS, "expectedTurnId is required")
            })?;
            let input = decode::user_contents(params.get("input").unwrap_or(&Value::Null))
                .map_err(|message| RpcFailure::new(ERROR_INVALID_PARAMS, message))?;
            let steered = provider
                .turn_steer(TurnSteerParams {
                    app_thread_id: thread_id,
                    expected_turn_id,
                    client_message_id: decode::client_message_id(params),
                    input,
                })
                .await
                .map_err(|error| failure(&error))?;
            Ok(json!({"turnId": steered.turn_id.as_str()}))
        }
        "turn/interrupt" => {
            provider
                .turn_interrupt(TurnInterruptParams {
                    app_thread_id: thread_id,
                    turn_id: decode::turn_id(params, "turnId"),
                })
                .await
                .map_err(|error| failure(&error))?;
            Ok(json!({}))
        }
        _ => Err(RpcFailure::capability_unsupported(
            crate::agent::model::Capability::CodexNative,
            &target.wire.descriptor.id,
        )),
    }
}

async fn update(
    target: &Target,
    change: ThreadChange,
) -> Result<Option<crate::agent::model::AgentThread>, RpcFailure> {
    target
        .provider
        .thread_update(ThreadUpdateParams {
            app_thread_id: target.thread_id.clone(),
            change,
        })
        .await
        .map(|result| result.thread)
        .map_err(|error| failure(&error))
}
