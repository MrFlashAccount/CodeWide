//! Projection of one thread onto the neutral `AgentThread`
//! (`host/src/threads/projection.ts`): Claude's session metadata (title,
//! first prompt, times, directory) combined with the service's own metadata
//! (settings, archive flag, title override, live status). Pure.

use agent_core::model::{
    AgentThread, AppThreadId, NativeTitleOverride, ProviderId, ThreadOrigin, ThreadSettings,
    ThreadStatus,
};

use super::session_catalog::CatalogSession;
use crate::{
    catalog::{ListRow, discovered_settings as default_discovered_settings},
    live::prompt::HISTORY_HEADER,
    state::thread_state::{ThreadState, ThreadStateOrigin},
};

/// `AgentThread.preview` is cut to this many UTF-16 units.
const PREVIEW_MAX_UNITS: usize = 200;
const MS_PER_SECOND: i64 = 1000;

/// The provider id of every Claude thread.
#[must_use]
pub fn provider_id() -> ProviderId {
    ProviderId::from_static("claude")
}

const fn seconds(ms: i64) -> i64 {
    ms.div_euclid(MS_PER_SECOND)
}

/// Everything known about one thread.
pub struct ThreadView<'a> {
    pub app_thread_id: &'a AppThreadId,
    /// The first prompt of a live turn Claude has not persisted yet, so a
    /// new thread shows its preview at once. Never stored.
    pub live_prompt: Option<String>,
    /// Catalog id of the model a session `CodeWide` never touched last
    /// answered with, when read; its settings report it instead of `default`.
    pub recorded_model: Option<String>,
    /// Sessions of the chain that exist in Claude's store, oldest first.
    pub sessions: &'a [CatalogSession],
    /// The service's metadata, or `None` for a session `CodeWide` never touched.
    pub state: Option<&'a ThreadState>,
    pub status: ThreadStatus,
}

/// Settings of a session `CodeWide` never configured, with its recorded
/// model when known.
#[must_use]
pub fn discovered_settings(recorded_model: Option<String>) -> ThreadSettings {
    let settings = default_discovered_settings();
    match recorded_model {
        Some(model) => ThreadSettings { model, ..settings },
        None => settings,
    }
}

/// The person's first prompt (a replacement session's history prefix is not one).
fn first_prompt<'a>(view: &'a ThreadView<'_>) -> Option<&'a str> {
    view.sessions
        .iter()
        .find_map(|session| {
            session
                .first_prompt
                .as_deref()
                .filter(|prompt| !prompt.starts_with(HISTORY_HEADER))
        })
        .or(view.live_prompt.as_deref())
}

fn thread_name(view: &ThreadView<'_>) -> Option<String> {
    let title = view
        .sessions
        .iter()
        .rev()
        .find_map(|session| session.title.as_deref());
    match view.state.map(|state| &state.title) {
        Some(NativeTitleOverride::Pending { name }) => Some(name.clone()),
        Some(NativeTitleOverride::Cleared { hidden_title }) => title
            .filter(|title| title != hidden_title)
            .map(ToOwned::to_owned),
        Some(NativeTitleOverride::None) | None => title.map(ToOwned::to_owned),
    }
}

fn created_at(view: &ThreadView<'_>) -> i64 {
    match (view.state, view.sessions.first()) {
        (Some(state), _) => state.created_at,
        (None, Some(first)) => seconds(first.started_at_ms()),
        (None, None) => 0,
    }
}

fn updated_at(view: &ThreadView<'_>) -> i64 {
    let created = created_at(view);
    view.sessions
        .iter()
        .map(|session| seconds(session.last_modified_ms))
        .chain([created, view.state.map_or(0, |state| state.updated_at)])
        .max()
        .unwrap_or(created)
}

fn cwd(view: &ThreadView<'_>) -> String {
    match view.state {
        Some(state) => state.cwd.clone(),
        None => view
            .sessions
            .first()
            .and_then(|session| session.cwd.clone())
            .unwrap_or_default(),
    }
}

/// The first `PREVIEW_MAX_UNITS` UTF-16 units of `text`, as JavaScript's
/// `slice` cuts it (a cut never splits a character here).
fn preview_of(text: &str) -> String {
    let mut units = 0;
    text.chars()
        .take_while(|character| {
            units += character.len_utf16();
            units <= PREVIEW_MAX_UNITS
        })
        .collect()
}

/// The neutral thread of `view`.
#[must_use]
pub fn project_thread(view: &ThreadView<'_>) -> AgentThread {
    let (archived, origin, recency_at, settings) = match view.state {
        None => (
            false,
            ThreadOrigin::External,
            None,
            discovered_settings(view.recorded_model.clone()),
        ),
        Some(state) => (
            state.is_archived(),
            match state.origin {
                ThreadStateOrigin::Created => ThreadOrigin::Interactive,
                ThreadStateOrigin::Discovered => ThreadOrigin::External,
            },
            state.recency_at,
            state.effective_settings().clone(),
        ),
    };
    AgentThread {
        app_thread_id: view.app_thread_id.clone(),
        provider: provider_id(),
        cwd: cwd(view),
        name: thread_name(view),
        // `AgentThread.preview` is the newest conversation message. The
        // service reads no history for a projection, so it reports the first
        // prompt; the adapter overlays the preview of its native index on
        // every thread the index knows.
        preview: first_prompt(view).map(preview_of).unwrap_or_default(),
        created_at: created_at(view),
        updated_at: updated_at(view),
        recency_at,
        archived,
        origin,
        status: view.status,
        settings,
        spawn: None,
        model_label: None,
    }
}

/// The `thread.list` row of `view`: a thread without a user message yet is
/// a shell (listed only among archived threads); a search term is matched
/// against the name, else the first prompt.
#[must_use]
pub fn list_row(view: &ThreadView<'_>) -> ListRow {
    let has_user_turn = view.state.is_some_and(|state| {
        state
            .turns
            .iter()
            .any(|turn| turn.origin == agent_core::model::TurnOrigin::User)
    });
    let first_prompt = first_prompt(view);
    let shell = !has_user_turn && first_prompt.is_none();
    let search_text = thread_name(view)
        .or_else(|| first_prompt.map(ToOwned::to_owned))
        .unwrap_or_default();
    ListRow::new(project_thread(view), search_text, shell)
}
