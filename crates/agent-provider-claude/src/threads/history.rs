//! A thread's history for the thread service, from the offset index of
//! Claude's session files (`crate::index`): a read first catches the index
//! up with the thread's sessions (only what was appended since their
//! checkpoints is read), then reads the byte ranges of the turns it needs.
//! No path reads a session whole. The in-flight turn is placed by
//! [`crate::native::with_active_turn`] (Claude persists messages only when
//! they are complete, so the live builder is the authority while a turn
//! runs).

use std::sync::{Arc, OnceLock, Weak};

use agent_core::{
    model::{AgentItem, AgentTurn, AppThreadId, MessagePhase, TurnId, UserContent},
    provider::ProviderError,
};
use tracing::warn;

use super::errors::internal;
use crate::{
    index::sessions::SessionIndex,
    live::prompt::HISTORY_PREFIX_MAX_BYTES,
    session::{ports::HistoryLines, query::BoxFuture},
    state::thread_state::ThreadState,
};

/// The session index the service reads history from, attached once the
/// provider started it ([`super::ThreadService::attach_index`]). Held
/// weakly: the index reaches the service's own running-session authority,
/// so a strong reference would keep both alive after the provider stops
/// (and with them the index database); its owner holds it.
pub type IndexSlot = Arc<OnceLock<Weak<SessionIndex>>>;

/// The attached index.
///
/// # Errors
/// Before the provider attached one (no read is served before then).
pub fn attached(slot: &IndexSlot) -> Result<Arc<SessionIndex>, ProviderError> {
    slot.get()
        .and_then(Weak::upgrade)
        .ok_or_else(|| ProviderError::Disconnected("Claude session index is not ready".into()))
}

/// Catches the index up with `session_ids` before a read.
///
/// # Errors
/// When the index cannot be advanced.
pub async fn caught_up<'s>(
    slot: &IndexSlot,
    session_ids: impl IntoIterator<Item = &'s str>,
) -> Result<Arc<SessionIndex>, ProviderError> {
    let index = attached(slot)?;
    index
        .catch_up(session_ids)
        .await
        .map_err(|err| internal("history index", &err))?;
    Ok(index)
}

/// User prompts and final answers, as lines for a replacement session's
/// history prefix.
#[must_use]
pub fn history_lines(turns: &[AgentTurn]) -> Vec<String> {
    turns
        .iter()
        .flat_map(|turn| turn.items.iter())
        .filter_map(|item| match item {
            AgentItem::UserMessage { content, .. } => {
                let text = content
                    .iter()
                    .filter_map(|content| match content {
                        UserContent::Text { text } => Some(text.as_str()),
                        UserContent::Image { .. } | UserContent::LocalImage { .. } => None,
                    })
                    .collect::<Vec<_>>()
                    .join("\n");
                (!text.is_empty()).then(|| format!("User: {text}"))
            }
            AgentItem::AgentMessage {
                text,
                phase: MessagePhase::Final,
                ..
            } => Some(format!("Claude: {text}")),
            _ => None,
        })
        .collect()
}

/// [`HistoryLines`] over the index: the thread's newest stored lines, as
/// many as a replacement session's history prefix can hold.
pub struct StoredHistoryLines {
    pub index: IndexSlot,
}

async fn recent_lines(
    slot: &IndexSlot,
    app_thread_id: AppThreadId,
    session_ids: Vec<String>,
) -> Result<Vec<String>, ProviderError> {
    let index = caught_up(slot, session_ids.iter().map(String::as_str)).await?;
    tokio::task::spawn_blocking(move || {
        index
            .history()
            .recent_lines(&app_thread_id, HISTORY_PREFIX_MAX_BYTES)
    })
    .await
    .map_err(|err| internal("history read", &err))?
    .map_err(|err| internal("history read", &err))
}

async fn stored_launch(
    slot: &IndexSlot,
    app_thread_id: AppThreadId,
    session_ids: Vec<String>,
    task_id: String,
) -> Result<Option<(TurnId, AgentItem)>, ProviderError> {
    let index = caught_up(slot, session_ids.iter().map(String::as_str)).await?;
    tokio::task::spawn_blocking(move || index.history().find_launch(&app_thread_id, &task_id))
        .await
        .map_err(|err| internal("history read", &err))?
        .map_err(|err| internal("history read", &err))
}

impl HistoryLines for StoredHistoryLines {
    fn launch(
        &self,
        state: &ThreadState,
        task_id: &str,
    ) -> BoxFuture<'static, Option<(TurnId, AgentItem)>> {
        let slot = self.index.clone();
        let app_thread_id = state.app_thread_id.clone();
        let session_ids = state.session_ids.iter().map(ToOwned::to_owned).collect();
        let task_id = task_id.to_owned();
        Box::pin(async move {
            match stored_launch(&slot, app_thread_id.clone(), session_ids, task_id).await {
                Ok(launch) => launch,
                Err(err) => {
                    warn!(app_thread_id = %app_thread_id, err = %err, "the stored launch of a reported background task is unavailable");
                    None
                }
            }
        })
    }

    fn lines(&self, state: &ThreadState) -> BoxFuture<'static, Vec<String>> {
        let slot = self.index.clone();
        let app_thread_id = state.app_thread_id.clone();
        let session_ids = state.session_ids.iter().map(ToOwned::to_owned).collect();
        Box::pin(async move {
            match recent_lines(&slot, app_thread_id.clone(), session_ids).await {
                Ok(lines) => lines,
                Err(err) => {
                    warn!(app_thread_id = %app_thread_id, err = %err, "thread history for a replacement session is unavailable");
                    Vec::new()
                }
            }
        })
    }
}
