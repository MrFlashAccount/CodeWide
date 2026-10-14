//! The service's startup (`host/src/main.ts`, `registry.ts`): every stored
//! thread is read (a v1 journal is converted on the way, by the store), and
//! a turn a previous process left in progress is finalized as interrupted:
//! its open items fail, its turn index entry is completed, its snapshot is
//! removed and its `turn.completed` is returned for publication. Runs on the
//! blocking pool.

use agent_core::model::{
    AgentEvent, AgentItem, AgentTurn, CallStatus, ExecutionStatus, TurnStatus,
};
use tracing::{error, info};

use crate::{
    state::{
        ThreadStateStore,
        thread_state::{ThreadState, TurnOutcomeRecord},
    },
    transcript::tools::fail_open_item,
};

const MS_PER_SECOND: i64 = 1000;

/// One thread read at startup, with the completion of a turn a previous
/// process left in progress.
pub struct LoadedThread {
    pub state: ThreadState,
    pub finalized: Option<AgentEvent>,
}

/// Whether the item still waits for its result.
fn is_open(item: &AgentItem) -> bool {
    match item {
        AgentItem::Command { status, .. } | AgentItem::FileChange { status, .. } => {
            *status == ExecutionStatus::InProgress
        }
        AgentItem::McpToolCall { status, .. } | AgentItem::ToolCall { status, .. } => {
            *status == CallStatus::InProgress
        }
        _ => false,
    }
}

/// The interrupted completion of `snapshot`, recorded in `state`.
fn finalize_interrupted(
    store: &ThreadStateStore,
    state: &mut ThreadState,
    snapshot: AgentTurn,
    now_ms: i64,
) -> AgentEvent {
    let completed_at = now_ms.div_euclid(MS_PER_SECOND);
    let turn = AgentTurn {
        completed_at: Some(completed_at),
        items: snapshot
            .items
            .into_iter()
            .map(|item| {
                if is_open(&item) {
                    fail_open_item(item)
                } else {
                    item
                }
            })
            .collect(),
        status: TurnStatus::Interrupted,
        ..snapshot
    };
    if let Some(record) = state
        .turns
        .iter_mut()
        .find(|record| record.turn_id == turn.turn_id.as_str())
    {
        record.completed_at = Some(completed_at);
        record.outcome = TurnOutcomeRecord::Interrupted;
        if let Err(err) = store.write(state) {
            error!(app_thread_id = %state.app_thread_id, err = %err, "thread state could not be written");
        }
    }
    if let Err(err) = store.clear_active_turn(&state.app_thread_id) {
        error!(app_thread_id = %state.app_thread_id, err = %err, "in-flight turn could not be removed");
    }
    info!(
        app_thread_id = %state.app_thread_id,
        turn_id = %turn.turn_id,
        "finalized a turn left in progress by a previous process"
    );
    AgentEvent::TurnCompleted {
        app_thread_id: state.app_thread_id.clone(),
        turn,
    }
}

/// Every stored thread; unreadable ones are logged and skipped.
///
/// # Errors
/// When the threads directory cannot be listed.
pub fn load_threads(store: &ThreadStateStore, now_ms: i64) -> std::io::Result<Vec<LoadedThread>> {
    let stored = store.load(|app_thread_id, err| {
        error!(app_thread_id = %app_thread_id, err = %err, "thread state is unreadable");
    })?;
    Ok(stored
        .into_iter()
        .map(|stored| {
            let mut state = stored.state;
            let finalized = stored
                .active_turn
                .map(|snapshot| finalize_interrupted(store, &mut state, snapshot, now_ms));
            LoadedThread { state, finalized }
        })
        .collect())
}
