//! Thread operations (`thread.create`, `thread.fork`, `thread.read`,
//! `thread.owns`, `thread.list`, `thread.turns`, `thread.update`) with the
//! host's repeat semantics: create and fork with a known id return the
//! existing thread; name, archive and settings repeats answer with the
//! current thread and publish `thread.updated` only on a real change; a
//! delete is idempotent through a tombstone.

use std::{collections::HashSet, sync::Arc};

use agent_core::{
    model::{
        AgentThread, ForkBoundary, NativeThreadPresence, NativeTitleOverride, ThreadChange,
        ThreadCreateParams, ThreadForkParams, ThreadListParams, ThreadListResult, ThreadReadResult,
        ThreadSettings, ThreadTurnsParams, ThreadTurnsResult, ThreadUpdateParams,
        ThreadUpdateResult, turns::page_turns,
    },
    provider::ProviderError,
};
use tracing::error;

use super::{
    errors::{internal, invalid_params, invalid_request, not_found, session_gone},
    history::{HistorySource, session_messages, stored_turns},
    projection::{ThreadView, list_row, project_thread},
    service::{
        CurrentView, FenceReceiver, Listed, Resolved, ServiceInner, ThreadService, cwd_hint,
    },
    session_catalog::CatalogSession,
};
use crate::{
    cli::command::PermissionProfile,
    live::{
        permissions::unsupported_profile_message,
        usage::{NEW_SESSION_BASELINE, ThreadCost, ZERO_USAGE},
    },
    native::{ChainSession, ForkCut, SessionLocation, files::is_session_id, fork_cut, write},
    state::{
        StateVersion,
        thread_state::{SessionChain, ThreadState, ThreadStateOrigin},
    },
};

/// An empty or blank name clears the name.
fn normalized_name(name: Option<String>) -> Option<String> {
    name.filter(|name| !name.trim().is_empty())
}

/// The title override after the user cleared the name while Claude shows `title`.
fn cleared_title(title: Option<&str>) -> NativeTitleOverride {
    title.map_or(NativeTitleOverride::None, |title| {
        NativeTitleOverride::Cleared {
            hidden_title: title.to_owned(),
        }
    })
}

fn check_profile(settings: &ThreadSettings) -> Result<(), ProviderError> {
    match PermissionProfile::parse(&settings.permission_profile) {
        Some(_) => Ok(()),
        None => Err(invalid_params(unsupported_profile_message(
            &settings.permission_profile,
        ))),
    }
}

/// A new `CodeWide` thread's state.
fn created_state(
    app_thread_id: agent_core::model::AppThreadId,
    cwd: String,
    session_ids: SessionChain,
    session_started: bool,
    settings: ThreadSettings,
    now: i64,
) -> ThreadState {
    ThreadState {
        app_thread_id,
        created_at: now,
        cwd,
        origin: ThreadStateOrigin::Created,
        pending_settings: None,
        presence: NativeThreadPresence::Listed { archived: false },
        recency_at: None,
        session_ids,
        session_started,
        settings,
        title: NativeTitleOverride::None,
        total_cost: ThreadCost::Known { usd: 0.0 },
        total_usage: ZERO_USAGE,
        turns: Vec::new(),
        updated_at: now,
        usage_baseline: NEW_SESSION_BASELINE,
        version: StateVersion::default(),
    }
}

impl ThreadService {
    /// `thread.create`: a new thread under a host-minted UUID; the same id
    /// again returns the existing thread. Client tools come from the
    /// service's [`crate::session::ports::ClientTools`], not the params.
    ///
    /// # Errors
    /// `-32602` without a UUID id or for an unknown permission profile;
    /// `-32600` for a deleted thread.
    pub async fn create(&self, params: ThreadCreateParams) -> Result<AgentThread, ProviderError> {
        let inner = &self.inner;
        let app_thread_id = params
            .app_thread_id
            .filter(|id| is_session_id(id.as_str()))
            .ok_or_else(|| invalid_params("Claude threads need a host-minted UUID appThreadId"))?;
        check_profile(&params.settings)?;
        let _adding = inner.adding.lock().await;
        if let Some(existing) = inner.registry.get(app_thread_id.as_str()) {
            return if existing.state().is_deleted() {
                Err(not_found(app_thread_id.as_str()))
            } else {
                inner.project_handle(&existing).await
            };
        }
        let session_ids = SessionChain::new(app_thread_id.as_str().to_owned());
        let settings = ThreadSettings {
            service_tier: None,
            ..params.settings
        };
        let state = created_state(
            app_thread_id,
            params.cwd,
            session_ids,
            false,
            settings,
            inner.now_seconds(),
        );
        let handle = inner.registry.add(state).await?;
        let thread = inner.project_published(&handle);
        inner.emit_updated(thread.clone()).await;
        Ok(thread)
    }

    /// `thread.fork`: copies every session of the source's chain up to the
    /// boundary into new sessions (fresh message uuids), so the copy owns its
    /// sessions and the source is unchanged. The copy keeps the source's
    /// settings and starts with no turn index. The same fork id again
    /// returns the existing copy.
    ///
    /// # Errors
    /// `-32602` without a UUID fork id or for a boundary before the first
    /// turn; `-32600` for an unknown source or boundary turn.
    pub async fn fork(&self, params: ThreadForkParams) -> Result<AgentThread, ProviderError> {
        let inner = &self.inner;
        let fork_id = params
            .fork_app_thread_id
            .filter(|id| is_session_id(id.as_str()))
            .ok_or_else(|| {
                invalid_params("Claude forks need a host-minted UUID forkAppThreadId")
            })?;
        if let Some(existing) = existing_thread(inner, fork_id.as_str()).await? {
            return existing;
        }
        let source = inner
            .entry_for(params.app_thread_id.as_str())
            .await?
            .ok_or_else(|| not_found(params.app_thread_id.as_str()))?;
        let source_state = source.state();
        let copies = copy_sessions(inner, Arc::clone(&source_state), params.boundary).await?;
        let _adding = inner.adding.lock().await;
        if let Some(existing) = existing_thread(inner, fork_id.as_str()).await? {
            return existing;
        }
        let state = created_state(
            fork_id,
            source_state.cwd.clone(),
            copies,
            true,
            source_state.effective_settings().clone(),
            inner.now_seconds(),
        );
        let handle = inner.registry.add(state).await?;
        let thread = inner.project_published(&handle);
        inner.emit_updated(thread.clone()).await;
        Ok(thread)
    }

    /// `thread.read`; `fenced` adds the stream position after every event
    /// before the read. Starts a background check of whether another
    /// process holds the session.
    ///
    /// # Errors
    /// `-32600` for an unknown or deleted thread.
    pub async fn read(
        &self,
        app_thread_id: &agent_core::model::AppThreadId,
        fenced: bool,
    ) -> Result<(ThreadReadResult, Option<FenceReceiver>), ProviderError> {
        let inner = &self.inner;
        let listed = inner
            .resolve(app_thread_id.as_str())
            .await?
            .listed()
            .ok_or_else(|| not_found(app_thread_id.as_str()))?;
        // Opening a thread is when a client needs to know whether it can
        // write; the read itself never waits for the CLI.
        inner.open_elsewhere.refresh_in_background();
        let view = inner.current_view(&listed, fenced).await?;
        Ok((
            ThreadReadResult {
                thread: view.thread,
                active_turn_id: view.active.map(|turn| turn.turn_id),
            },
            view.fence,
        ))
    }

    /// `thread.owns`: whether the id is a listed thread.
    ///
    /// # Errors
    /// When Claude's store cannot be read.
    pub async fn owns(
        &self,
        app_thread_id: &agent_core::model::AppThreadId,
    ) -> Result<bool, ProviderError> {
        Ok(matches!(
            self.inner.resolve(app_thread_id.as_str()).await?,
            Resolved::Entry(_) | Resolved::Discovered(_)
        ))
    }

    /// `thread.list`: the service's threads and the interactive sessions no
    /// chain claims, with the host's listing semantics.
    ///
    /// # Errors
    /// `-32602` for an invalid cursor.
    pub async fn list(&self, params: ThreadListParams) -> Result<ThreadListResult, ProviderError> {
        crate::catalog::list(self.list_rows().await?, &params).map_err(ProviderError::Rejected)
    }

    /// Every currently listed thread with its authoritative lifecycle status.
    ///
    /// This is published once when the provider event stream starts. A client
    /// can otherwise retain a pre-restart `active` status forever: catalog
    /// pages intentionally cannot overwrite live lifecycle state, while the
    /// restarted provider has no transition edge to replay for an already
    /// stopped process.
    ///
    /// # Errors
    /// When Claude's process registry or session catalog cannot be read.
    pub async fn status_snapshot(&self) -> Result<Vec<AgentThread>, ProviderError> {
        if !self.inner.open_elsewhere.refresh_confirmed().await {
            return Err(ProviderError::Disconnected(
                "Claude running-session authority is unavailable".into(),
            ));
        }
        Ok(self
            .list_rows()
            .await?
            .into_iter()
            .map(|row| row.thread)
            .collect())
    }

    async fn list_rows(&self) -> Result<Vec<crate::catalog::ListRow>, ProviderError> {
        let inner = &self.inner;
        let snapshot = inner.catalog.snapshot().await?;
        let mut rows = Vec::new();
        let mut claimed = HashSet::new();
        for handle in inner.registry.all() {
            let state = handle.state();
            claimed.extend(state.session_ids.iter().map(ToOwned::to_owned));
            if state.is_deleted() {
                continue;
            }
            let sessions = state
                .session_ids
                .iter()
                .filter_map(|session_id| snapshot.get(session_id).cloned())
                .collect::<Vec<_>>();
            let status = inner.entry_status(&state, &handle.status());
            rows.push(list_row(&ThreadView {
                app_thread_id: &state.app_thread_id,
                live_prompt: inner.live_prompts.prompt(&state.app_thread_id),
                recorded_model: None,
                sessions: &sessions,
                state: Some(&state),
                status,
            }));
        }
        for session in snapshot.values() {
            let continued = session
                .continued_in
                .as_ref()
                .is_some_and(|next| snapshot.contains_key(next));
            if !session.interactive || continued || claimed.contains(&session.session_id) {
                continue;
            }
            if let Some(thread) = inner.project_discovered(session) {
                rows.push(list_row(&ThreadView {
                    app_thread_id: &thread.app_thread_id,
                    live_prompt: None,
                    recorded_model: inner.recorded_model_of(&session.session_id),
                    sessions: std::slice::from_ref(session),
                    state: None,
                    status: thread.status,
                }));
            }
        }
        Ok(rows)
    }

    /// `thread.turns`: the stored history with the in-flight turn, paged;
    /// `fenced` adds the stream position after every event before the read.
    ///
    /// # Errors
    /// `-32600` for an unknown thread, `-32602` for an invalid cursor.
    pub async fn turns(
        &self,
        params: ThreadTurnsParams,
        fenced: bool,
    ) -> Result<(ThreadTurnsResult, Option<FenceReceiver>), ProviderError> {
        let inner = &self.inner;
        let id = params.app_thread_id.as_str();
        let listed = inner
            .resolve(id)
            .await?
            .listed()
            .ok_or_else(|| not_found(id))?;
        let (turns, fence) = match listed {
            Listed::Entry(handle) => {
                let (state, active, fence) = handle
                    .read(fenced)
                    .await
                    .map_err(|err| session_gone(&err))?;
                let source = HistorySource::Thread(Arc::clone(&state));
                let stored = stored_turns(inner.projects_root.clone(), source).await?;
                (
                    crate::native::with_active_turn(stored, active, &state.turns),
                    fence,
                )
            }
            Listed::Discovered(session) => {
                let source = HistorySource::Session {
                    app_thread_id: params.app_thread_id.clone(),
                    cwd: session.cwd.unwrap_or_default(),
                };
                let turns = stored_turns(inner.projects_root.clone(), source).await?;
                let fence = if fenced {
                    Some(inner.fence().await)
                } else {
                    None
                };
                (turns, fence)
            }
        };
        let page = page_turns(
            &turns,
            params.cursor.as_deref(),
            params.limit,
            params.sort_direction,
            params.items_view,
        )
        .map_err(ProviderError::Rejected)?;
        Ok((page, fence))
    }

    /// `thread.update`: name, archive, delete or settings.
    ///
    /// # Errors
    /// `-32600` for an unknown thread, `-32602` for an unknown permission profile.
    pub async fn update(
        &self,
        params: ThreadUpdateParams,
    ) -> Result<ThreadUpdateResult, ProviderError> {
        let id = params.app_thread_id.as_str();
        let thread = match params.change {
            ThreadChange::Name { name } => Some(self.rename(id, normalized_name(name)).await?),
            ThreadChange::Archived { archived } => Some(self.archive(id, archived).await?),
            ThreadChange::Deleted => {
                self.delete(id).await?;
                None
            }
            ThreadChange::Settings {
                model,
                effort,
                permission_profile,
                service_tier: _,
            } => Some(
                self.change_settings(id, model, effort, permission_profile)
                    .await?,
            ),
        };
        Ok(ThreadUpdateResult { thread })
    }

    async fn rename(&self, id: &str, name: Option<String>) -> Result<AgentThread, ProviderError> {
        let inner = &self.inner;
        let listed = inner
            .resolve(id)
            .await?
            .listed()
            .ok_or_else(|| not_found(id))?;
        let view = inner.current_view(&listed, false).await?;
        if view.thread.name == name {
            return Ok(view.thread);
        }
        let thread = match (name, view.sessions.last()) {
            (Some(name), Some(latest)) => {
                rename_session(inner, &listed, &view, latest, name).await?
            }
            (name, latest) => {
                let title = match name {
                    None => cleared_title(latest.and_then(|latest| latest.title.as_deref())),
                    Some(name) => NativeTitleOverride::Pending { name },
                };
                let handle = match &listed {
                    Listed::Entry(handle) => handle.clone(),
                    Listed::Discovered(session) => {
                        inner
                            .adopt(session, NativeThreadPresence::Listed { archived: false })
                            .await?
                    }
                };
                handle
                    .edit(Box::new(move |state| state.title = title))
                    .await
                    .map_err(|err| session_gone(&err))?;
                inner.project_handle(&handle).await?
            }
        };
        inner.emit_updated(thread.clone()).await;
        Ok(thread)
    }

    async fn archive(&self, id: &str, archived: bool) -> Result<AgentThread, ProviderError> {
        let inner = &self.inner;
        let handle = inner.entry_for(id).await?.ok_or_else(|| not_found(id))?;
        if handle.state().is_archived() != archived {
            handle
                .edit(Box::new(move |state| {
                    state.presence = NativeThreadPresence::Listed { archived };
                }))
                .await
                .map_err(|err| session_gone(&err))?;
            inner
                .emit_updated(inner.project_handle(&handle).await?)
                .await;
        }
        inner.project_handle(&handle).await
    }

    async fn delete(&self, id: &str) -> Result<(), ProviderError> {
        let inner = &self.inner;
        let deleted_at = inner.now_seconds();
        let handle = match inner.resolve(id).await? {
            Resolved::Missing => return Err(not_found(id)),
            Resolved::Discovered(session) => {
                inner
                    .adopt(&session, NativeThreadPresence::Deleted { deleted_at })
                    .await?
            }
            Resolved::Entry(handle) | Resolved::Deleted(handle) => handle,
        };
        if !handle.state().is_deleted() {
            handle.dispose().await.map_err(|err| session_gone(&err))?;
            handle
                .edit(Box::new(move |state| {
                    state.presence = NativeThreadPresence::Deleted { deleted_at };
                }))
                .await
                .map_err(|err| session_gone(&err))?;
        }
        remove_sessions(inner, &handle.state()).await;
        Ok(())
    }

    async fn change_settings(
        &self,
        id: &str,
        model: Option<String>,
        effort: Option<String>,
        permission_profile: Option<String>,
    ) -> Result<AgentThread, ProviderError> {
        let inner = &self.inner;
        let handle = inner.entry_for(id).await?.ok_or_else(|| not_found(id))?;
        let state = handle.state();
        let current = state.effective_settings();
        let next = ThreadSettings {
            model: model.unwrap_or_else(|| current.model.clone()),
            effort: effort.or_else(|| current.effort.clone()),
            permission_profile: permission_profile
                .unwrap_or_else(|| current.permission_profile.clone()),
            service_tier: None,
        };
        check_profile(&next)?;
        handle
            .update_settings(next)
            .await
            .map_err(|err| session_gone(&err))?;
        inner.project_handle(&handle).await
    }
}

/// The thread already registered under `id`: its projection, or not found
/// for a tombstone; `None` when no thread has the id.
async fn existing_thread(
    inner: &ServiceInner,
    id: &str,
) -> Result<Option<Result<AgentThread, ProviderError>>, ProviderError> {
    let Some(existing) = inner.registry.get(id) else {
        return Ok(None);
    };
    if existing.state().is_deleted() {
        return Ok(Some(Err(not_found(id))));
    }
    Ok(Some(Ok(inner.project_handle(&existing).await?)))
}

/// Renames the thread's latest session in Claude's store.
async fn rename_session(
    inner: &ServiceInner,
    listed: &Listed,
    view: &CurrentView,
    latest: &CatalogSession,
    name: String,
) -> Result<AgentThread, ProviderError> {
    let root = inner.projects_root.clone();
    let session_id = latest.session_id.clone();
    let cwd = latest.cwd.clone();
    let title = name.clone();
    tokio::task::spawn_blocking(move || {
        write::rename(
            &root,
            &SessionLocation {
                session_id: &session_id,
                cwd: cwd.as_deref().and_then(cwd_hint),
            },
            &title,
        )
    })
    .await
    .map_err(|err| internal("rename", &err))?
    .map_err(|err| internal("rename", &err))?;
    inner.catalog.remember_title(&latest.session_id, &name);
    let state = match listed {
        Listed::Entry(handle)
            if view
                .state
                .as_ref()
                .is_some_and(|state| state.title != NativeTitleOverride::None) =>
        {
            Some(
                handle
                    .edit(Box::new(|state| state.title = NativeTitleOverride::None))
                    .await
                    .map_err(|err| session_gone(&err))?,
            )
        }
        Listed::Entry(_) => view.state.clone(),
        Listed::Discovered(_) => None,
    };
    let sessions = view
        .sessions
        .iter()
        .map(|session| {
            if session.session_id == latest.session_id {
                CatalogSession {
                    title: Some(name.clone()),
                    ..session.clone()
                }
            } else {
                session.clone()
            }
        })
        .collect::<Vec<_>>();
    Ok(project_thread(&ThreadView {
        app_thread_id: &view.thread.app_thread_id,
        live_prompt: view
            .active
            .as_ref()
            .and_then(super::live_prompts::turn_prompt),
        recorded_model: match listed {
            Listed::Discovered(session) => inner.recorded_model_of(&session.session_id),
            Listed::Entry(_) => None,
        },
        sessions: &sessions,
        state: state.as_deref(),
        status: view.thread.status,
    }))
}

/// Forks the sessions of `state`'s chain through `boundary`; returns the
/// copies, oldest first.
async fn copy_sessions(
    inner: &ServiceInner,
    state: Arc<ThreadState>,
    boundary: ForkBoundary,
) -> Result<SessionChain, ProviderError> {
    let root = inner.projects_root.clone();
    tokio::task::spawn_blocking(move || -> Result<SessionChain, ProviderError> {
        let session_ids = state.session_ids.iter().collect::<Vec<_>>();
        let records = &state.turns;
        let cwd = &state.cwd;
        let stored = session_ids
            .iter()
            .map(|session_id| session_messages(&root, session_id))
            .collect::<Result<Vec<_>, _>>()
            .map_err(|err| internal("fork", &err))?;
        let messages = stored
            .iter()
            .map(|rows| rows.iter().collect::<Vec<_>>())
            .collect::<Vec<_>>();
        let chain = session_ids
            .iter()
            .zip(&messages)
            .map(|(session_id, messages)| ChainSession {
                session_id,
                messages,
            })
            .collect::<Vec<_>>();
        let (whole, last) = match fork_cut(&chain, records, &boundary) {
            ForkCut::Cut { whole, last } => (whole, last),
            ForkCut::UnknownTurn => {
                return Err(invalid_request(
                    "the fork boundary turn is not in this thread",
                ));
            }
            ForkCut::NothingBefore => {
                return Err(invalid_params(
                    "a fork before the first turn would be empty",
                ));
            }
        };
        let copy = |session_id: &str, up_to: Option<&str>| {
            write::fork(
                &root,
                &SessionLocation {
                    session_id,
                    cwd: cwd_hint(cwd),
                },
                up_to,
            )
            .map_err(|err| internal("fork", &err))
        };
        let cuts = whole
            .iter()
            .map(|session_id| (session_id.as_str(), None))
            .chain([(last.session_id.as_str(), last.up_to_message_id.as_deref())]);
        let mut chain: Option<SessionChain> = None;
        for (session_id, up_to) in cuts {
            let forked = copy(session_id, up_to)?;
            match &mut chain {
                Some(chain) => chain.push(forked),
                None => chain = Some(SessionChain::new(forked)),
            }
        }
        chain.ok_or_else(|| internal("fork", &"the fork copied no session"))
    })
    .await
    .map_err(|err| internal("fork", &err))?
}

/// Deletes the thread's sessions from Claude's store; a failure is logged
/// and retried by a repeated delete.
async fn remove_sessions(inner: &ServiceInner, state: &ThreadState) {
    for session_id in state.session_ids.iter() {
        let root = inner.projects_root.clone();
        let cwd = state.cwd.clone();
        let id = session_id.to_owned();
        let removed = tokio::task::spawn_blocking(move || {
            write::remove(
                &root,
                &SessionLocation {
                    session_id: &id,
                    cwd: cwd_hint(&cwd),
                },
            )
        })
        .await;
        match removed {
            Ok(Ok(_)) => {}
            Ok(Err(err)) => {
                error!(app_thread_id = %state.app_thread_id, claude_session_id = session_id, err = %err, "claude session could not be deleted");
            }
            Err(err) => {
                error!(app_thread_id = %state.app_thread_id, claude_session_id = session_id, err = %err, "claude session could not be deleted");
            }
        }
        inner.catalog.forget(session_id);
    }
}
