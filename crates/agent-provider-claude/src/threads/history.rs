//! A thread's history from Claude's session store
//! (`host/src/threads/history.ts`): the active branch of every session of
//! its chain, oldest first, rebuilt into neutral turns with the thread's
//! turn index; the in-flight turn is placed by
//! [`crate::native::with_active_turn`] (Claude persists messages only when
//! they are complete, so the live builder is the authority while a turn
//! runs). Reads run on the blocking pool.

use std::{
    path::{Path, PathBuf},
    sync::Arc,
};

use agent_core::{
    model::{AgentItem, AgentTurn, AppThreadId, MessagePhase, UserContent},
    provider::ProviderError,
};
use serde_json::Value;
use tracing::warn;

use super::errors::internal;
use crate::{
    native::files,
    session::{ports::HistoryLines, query::BoxFuture},
    state::thread_state::ThreadState,
    transcript::{
        chain::active_branch,
        json::JsonRecord,
        reconstruct::{HistoryContext, reconstruct_turns},
        turn_index::TurnRecord,
    },
};

/// Whose history is read.
pub enum HistorySource {
    /// A thread the service keeps metadata for: its chain and turn index.
    Thread(Arc<ThreadState>),
    /// A session `CodeWide` never touched: one session, no turn index.
    Session {
        app_thread_id: AppThreadId,
        cwd: String,
    },
}

/// The stored messages (active branch, oldest first) of one session; a
/// session that does not exist has none.
///
/// # Errors
/// When the session file exists but cannot be read.
pub fn session_messages(
    projects_root: &Path,
    session_id: &str,
) -> std::io::Result<Vec<JsonRecord>> {
    let Some(file) = files::find_session(projects_root, session_id) else {
        return Ok(Vec::new());
    };
    let rows = files::rows(&file.path)?;
    Ok(active_branch(&rows)
        .into_iter()
        .map(std::borrow::Cow::into_owned)
        .collect())
}

/// The stored messages of one session as JSON values (for the recorded model).
///
/// # Errors
/// When the session file exists but cannot be read.
pub fn session_values(projects_root: &Path, session_id: &str) -> std::io::Result<Vec<Value>> {
    Ok(session_messages(projects_root, session_id)?
        .into_iter()
        .map(Value::Object)
        .collect())
}

fn rebuild<'a>(
    projects_root: &Path,
    session_ids: impl Iterator<Item = &'a str>,
    records: &[TurnRecord],
    context: &HistoryContext,
) -> std::io::Result<Vec<AgentTurn>> {
    let mut messages = Vec::new();
    for session_id in session_ids {
        messages.extend(session_messages(projects_root, session_id)?);
    }
    let messages = messages.iter().collect::<Vec<_>>();
    Ok(reconstruct_turns(&messages, records, context))
}

fn read(projects_root: &Path, source: &HistorySource) -> std::io::Result<Vec<AgentTurn>> {
    match source {
        HistorySource::Thread(state) => rebuild(
            projects_root,
            state.session_ids.iter(),
            &state.turns,
            &HistoryContext {
                app_thread_id: state.app_thread_id.clone(),
                cwd: state.cwd.clone(),
            },
        ),
        HistorySource::Session { app_thread_id, cwd } => rebuild(
            projects_root,
            std::iter::once(app_thread_id.as_str()),
            &[],
            &HistoryContext {
                app_thread_id: app_thread_id.clone(),
                cwd: cwd.clone(),
            },
        ),
    }
}

/// The completed turns of `source` rebuilt from Claude's store.
///
/// # Errors
/// When a session file cannot be read.
pub async fn stored_turns(
    projects_root: PathBuf,
    source: HistorySource,
) -> Result<Vec<AgentTurn>, ProviderError> {
    tokio::task::spawn_blocking(move || read(&projects_root, &source))
        .await
        .map_err(|err| internal("history read", &err))?
        .map_err(|err| internal("history read", &err))
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

/// [`HistoryLines`] over Claude's store: the thread's stored history.
pub struct StoredHistoryLines {
    pub projects_root: PathBuf,
}

impl HistoryLines for StoredHistoryLines {
    fn lines(&self, state: &ThreadState) -> BoxFuture<'static, Vec<String>> {
        let projects_root = self.projects_root.clone();
        // The port lends the state; the blocking read needs it owned. Only a
        // lost session's replacement asks, once per turn.
        let source = HistorySource::Thread(Arc::new(state.clone()));
        let app_thread_id = state.app_thread_id.clone();
        Box::pin(async move {
            match stored_turns(projects_root, source).await {
                Ok(turns) => history_lines(&turns),
                Err(err) => {
                    warn!(app_thread_id = %app_thread_id, err = %err, "thread history for a replacement session is unavailable");
                    Vec::new()
                }
            }
        })
    }
}
