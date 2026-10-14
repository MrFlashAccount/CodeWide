//! The thread service's state and shared rules (`host/src/threads/service.ts`):
//! construction, startup, how a thread id resolves against the service's
//! metadata and Claude's store, projections, adoption of a session
//! `CodeWide` never touched, and the reaction to a session Claude created
//! (a pending title is applied, metadata refreshed). The operations are in
//! `thread_ops.rs` and `turn_ops.rs`; the output stream in `outputs.rs`.

use std::{
    path::{Path, PathBuf},
    sync::{Arc, atomic::AtomicUsize},
    time::Duration,
};

use agent_core::{
    model::{
        AgentEvent, AgentThread, AgentTurn, NativeThreadPresence, NativeTitleOverride, ThreadStatus,
    },
    provider::ProviderError,
};
use tokio::sync::{mpsc, oneshot};
use tracing::warn;

use super::{
    errors::{internal, session_gone},
    history::StoredHistoryLines,
    live_prompts::{LivePrompts, turn_prompt},
    outputs::{Notice, ServiceOutputs},
    projection::{ThreadView, discovered_settings, project_thread},
    recorded_models::RecordedModelCache,
    registry::ThreadRegistry,
    session_catalog::{CatalogSession, SessionCatalog},
    startup::load_threads,
};
use crate::{
    live::usage::{ThreadCost, UsageBaseline, ZERO_USAGE},
    native::{SessionLocation, files::is_session_id, write},
    runtime::{
        open_elsewhere::{OpenElsewhere, OpenElsewhereDeps},
        running_sessions::RunningSessions,
    },
    session::{
        handle::{SessionHandle, SessionStatus},
        ports::{ClientTools, RateLimitSink, SessionConfig, SessionDeps, SessionOutput},
        query::QueryRuntime,
    },
    state::{
        StateVersion, ThreadStateStore,
        thread_state::{SessionChain, ThreadState, ThreadStateOrigin},
    },
};

const MS_PER_SECOND: i64 = 1000;
/// Session outputs waiting for the consumer of [`ServiceOutputs`].
const OUTPUT_CAPACITY: usize = 1024;

/// The stream position after every event published before a fenced read.
pub type FenceReceiver = oneshot::Receiver<Result<u64, ProviderError>>;

/// Everything the service is built with.
pub struct ServiceDeps {
    /// Claude's session store (`$CLAUDE_CONFIG_DIR/projects`).
    pub projects_root: PathBuf,
    /// The service's own thread metadata (`<state dir>/threads/…`).
    pub state_directory: PathBuf,
    pub runtime: Arc<dyn QueryRuntime>,
    /// The `claude` executable queries run.
    pub executable: PathBuf,
    /// Milliseconds since the epoch.
    pub clock: Arc<dyn Fn() -> i64 + Send + Sync>,
    /// Ids Claude persists ([`crate::uuid::random_uuid`] outside tests).
    pub new_uuid: Arc<dyn Fn() -> String + Send + Sync>,
    pub client_tools: Arc<dyn ClientTools>,
    pub rate_limits: Arc<dyn RateLimitSink>,
    pub session_config: SessionConfig,
    /// The sessions other `claude` processes run.
    pub running_sessions: Arc<dyn RunningSessions>,
    /// How often the running sessions are re-read while one is held elsewhere.
    pub open_elsewhere_poll: Duration,
    /// Maps a recorded model id to the model catalog's id for it.
    pub model_id_for: Arc<dyn Fn(&str) -> String + Send + Sync>,
}

/// What the service publishes, in order.
pub enum ServiceOutput {
    /// An event for clients, `thread.updated` included.
    Event(Box<AgentEvent>),
    /// A fenced read's position: answer with the stream position after
    /// every event published before it.
    Fence(oneshot::Sender<Result<u64, ProviderError>>),
}

/// The Claude threads: `CodeWide` threads and sessions Claude already has.
/// Cheap to clone.
#[derive(Clone)]
pub struct ThreadService {
    pub(super) inner: Arc<ServiceInner>,
}

pub(super) struct ServiceInner {
    pub registry: Arc<ThreadRegistry>,
    pub catalog: SessionCatalog,
    pub recorded: RecordedModelCache,
    pub open_elsewhere: OpenElsewhere,
    pub live_prompts: LivePrompts,
    pub outputs: mpsc::Sender<SessionOutput>,
    pub projects_root: PathBuf,
    pub clock: Arc<dyn Fn() -> i64 + Send + Sync>,
    pub model_id_for: Arc<dyn Fn(&str) -> String + Send + Sync>,
    /// Serializes the check-then-add of a new thread, so a repeated create,
    /// fork or adoption finds the first one.
    pub adding: tokio::sync::Mutex<()>,
}

/// A thread id resolved against the service's metadata and Claude's store.
pub(super) enum Resolved {
    Deleted(SessionHandle),
    Entry(SessionHandle),
    Discovered(CatalogSession),
    Missing,
}

/// A thread clients may see: one with metadata, or a discovered session.
pub(super) enum Listed {
    Entry(SessionHandle),
    Discovered(CatalogSession),
}

impl Resolved {
    pub(super) fn listed(self) -> Option<Listed> {
        match self {
            Self::Entry(handle) => Some(Listed::Entry(handle)),
            Self::Discovered(session) => Some(Listed::Discovered(session)),
            Self::Deleted(_) | Self::Missing => None,
        }
    }
}

/// A projection with the facts an operation continues with.
pub(super) struct CurrentView {
    pub thread: AgentThread,
    pub sessions: Vec<CatalogSession>,
    pub state: Option<Arc<ThreadState>>,
    pub active: Option<AgentTurn>,
    pub fence: Option<FenceReceiver>,
}

pub(super) const fn seconds(ms: i64) -> i64 {
    ms.div_euclid(MS_PER_SECOND)
}

/// The working directory as a store location hint; an empty one is none.
pub(super) fn cwd_hint(cwd: &str) -> Option<&Path> {
    (!cwd.is_empty()).then(|| Path::new(cwd))
}

impl ThreadService {
    /// The service and its ordered output stream. Nothing is loaded yet:
    /// call [`Self::load`] before serving.
    ///
    /// # Errors
    /// When the state directory cannot be created.
    pub fn new(deps: ServiceDeps) -> std::io::Result<(Self, ServiceOutputs)> {
        let store = ThreadStateStore::open(deps.state_directory)?;
        let (persistence, index) = ThreadRegistry::persistence(store.clone());
        let (outputs, session_outputs) = mpsc::channel(OUTPUT_CAPACITY);
        let session_deps = Arc::new(SessionDeps {
            runtime: deps.runtime,
            executable: deps.executable,
            clock: deps.clock.clone(),
            new_uuid: deps.new_uuid,
            persistence,
            outputs: outputs.clone(),
            client_tools: deps.client_tools,
            history: Arc::new(StoredHistoryLines {
                projects_root: deps.projects_root.clone(),
            }),
            rate_limits: deps.rate_limits,
            config: deps.session_config,
            live_sessions: Arc::new(AtomicUsize::new(0)),
        });
        let registry = Arc::new(ThreadRegistry::new(store, index, session_deps));
        let (notices, notice_queue) = mpsc::unbounded_channel();
        let owner = registry.clone();
        let open_elsewhere = OpenElsewhere::new(OpenElsewhereDeps {
            running: deps.running_sessions,
            owns_live: Arc::new(move |session_id| {
                owner.owner_of(session_id).is_some_and(|handle| {
                    handle.status().live && handle.state().current_session_id() == session_id
                })
            }),
            changed: Arc::new(move |sessions| {
                let _ = notices.send(Notice::HeldChanged(sessions.iter().cloned().collect()));
            }),
            poll: deps.open_elsewhere_poll,
        });
        let inner = Arc::new(ServiceInner {
            registry,
            catalog: SessionCatalog::new(deps.projects_root.clone()),
            recorded: RecordedModelCache::new(deps.projects_root.clone()),
            open_elsewhere,
            live_prompts: LivePrompts::default(),
            outputs,
            projects_root: deps.projects_root,
            clock: deps.clock,
            model_id_for: deps.model_id_for,
            adding: tokio::sync::Mutex::new(()),
        });
        let stream = ServiceOutputs::new(&inner, session_outputs, notice_queue);
        Ok((Self { inner }, stream))
    }

    /// Loads every stored thread (converting v1 journals), finalizes turns a
    /// previous process left in progress as interrupted and returns their
    /// `turn.completed` events; applies pending titles of started sessions
    /// in the background. A thread already loaded is kept as it runs.
    ///
    /// # Errors
    /// When the state directory cannot be listed.
    pub async fn load(&self) -> Result<Vec<AgentEvent>, ProviderError> {
        let store = self.inner.registry.store().clone();
        let now = (self.inner.clock)();
        let loaded = tokio::task::spawn_blocking(move || load_threads(&store, now))
            .await
            .map_err(|err| internal("startup", &err))?
            .map_err(|err| internal("startup", &err))?;
        let mut events = Vec::new();
        for thread in loaded {
            if self
                .inner
                .registry
                .get(thread.state.app_thread_id.as_str())
                .is_some()
            {
                continue;
            }
            let pending_title = matches!(thread.state.title, NativeTitleOverride::Pending { .. })
                && thread.state.session_started;
            let handle = self.inner.registry.register(thread.state);
            events.extend(thread.finalized);
            if pending_title {
                self.inner.session_ready(handle);
            }
        }
        Ok(events)
    }

    /// Ends every live session and the open-elsewhere polling.
    pub async fn shutdown(&self) {
        self.inner.open_elsewhere.shutdown();
        self.inner.registry.shutdown().await;
    }
}

impl ServiceInner {
    pub(super) fn now_seconds(&self) -> i64 {
        seconds((self.clock)())
    }

    /// Publishes `thread.updated` in order with the sessions' events.
    pub(super) async fn emit_updated(&self, thread: AgentThread) {
        // The receiver lives as long as the service's consumer.
        let _ = self
            .outputs
            .send(SessionOutput::Event(Box::new(AgentEvent::ThreadUpdated {
                thread,
            })))
            .await;
    }

    /// A fence at the current end of the output stream.
    pub(super) async fn fence(&self) -> FenceReceiver {
        let (sender, receiver) = oneshot::channel();
        let _ = self.outputs.send(SessionOutput::Fence(sender)).await;
        receiver
    }

    pub(super) fn entry_status(&self, state: &ThreadState, status: &SessionStatus) -> ThreadStatus {
        if status.active_turn_id.is_some() {
            ThreadStatus::Active
        } else if status.live {
            ThreadStatus::Idle
        } else if self.open_elsewhere.is_held(state.current_session_id()) {
            ThreadStatus::OpenElsewhere
        } else {
            ThreadStatus::NotLoaded
        }
    }

    pub(super) fn cached_sessions(&self, state: &ThreadState) -> Vec<CatalogSession> {
        state
            .session_ids
            .iter()
            .filter_map(|session_id| self.catalog.cached(session_id))
            .collect()
    }

    pub(super) async fn fresh_sessions(
        &self,
        state: &ThreadState,
    ) -> Result<Vec<CatalogSession>, ProviderError> {
        let mut sessions = Vec::new();
        for session_id in state.session_ids.iter() {
            sessions.extend(self.catalog.refresh(session_id).await?);
        }
        Ok(sessions)
    }

    pub(super) fn project_state(
        &self,
        state: &ThreadState,
        status: &SessionStatus,
        live_prompt: Option<String>,
        sessions: &[CatalogSession],
    ) -> AgentThread {
        project_thread(&ThreadView {
            app_thread_id: &state.app_thread_id,
            live_prompt,
            recorded_model: None,
            sessions,
            state: Some(state),
            status: self.entry_status(state, status),
        })
    }

    /// The thread from the published state, the prompt the stream showed
    /// and the cached session metadata: no I/O, no wait on the session.
    pub(super) fn project_published(&self, handle: &SessionHandle) -> AgentThread {
        let state = handle.state();
        let live_prompt = self.live_prompts.prompt(&state.app_thread_id);
        let sessions = self.cached_sessions(&state);
        self.project_state(&state, &handle.status(), live_prompt, &sessions)
    }

    /// Catalog id of the session's last answering model, from the last read.
    pub(super) fn recorded_model_of(&self, session_id: &str) -> Option<String> {
        self.recorded
            .cached(session_id)
            .map(|recorded| (self.model_id_for)(&recorded))
    }

    pub(super) fn project_discovered(&self, session: &CatalogSession) -> Option<AgentThread> {
        let app_thread_id = agent_core::model::AppThreadId::parse(&session.session_id)?;
        let status = if self.open_elsewhere.is_held(&session.session_id) {
            ThreadStatus::OpenElsewhere
        } else {
            ThreadStatus::NotLoaded
        };
        Some(project_thread(&ThreadView {
            app_thread_id: &app_thread_id,
            live_prompt: None,
            recorded_model: self.recorded_model_of(&session.session_id),
            sessions: std::slice::from_ref(session),
            state: None,
            status,
        }))
    }

    /// Resolves a thread id: the service's metadata first; else, for a
    /// uuid no chain claims, Claude's store.
    pub(super) async fn resolve(&self, app_thread_id: &str) -> Result<Resolved, ProviderError> {
        if let Some(handle) = self.registry.get(app_thread_id) {
            return Ok(if handle.state().is_deleted() {
                Resolved::Deleted(handle)
            } else {
                Resolved::Entry(handle)
            });
        }
        // A replacement session belongs to its thread and is not a thread itself.
        if !is_session_id(app_thread_id) || self.registry.is_claimed(app_thread_id) {
            return Ok(Resolved::Missing);
        }
        Ok(match self.catalog.refresh(app_thread_id).await? {
            Some(session) => Resolved::Discovered(session),
            None => Resolved::Missing,
        })
    }

    /// The current projection of a listed thread, with fresh session
    /// metadata; `fenced` adds a fence after every event before the read.
    pub(super) async fn current_view(
        &self,
        listed: &Listed,
        fenced: bool,
    ) -> Result<CurrentView, ProviderError> {
        match listed {
            Listed::Entry(handle) => {
                let (state, active, fence) = handle
                    .read(fenced)
                    .await
                    .map_err(|err| session_gone(&err))?;
                let sessions = self.fresh_sessions(&state).await?;
                let thread = self.project_state(
                    &state,
                    &handle.status(),
                    active.as_ref().and_then(turn_prompt),
                    &sessions,
                );
                Ok(CurrentView {
                    thread,
                    sessions,
                    state: Some(state),
                    active,
                    fence,
                })
            }
            Listed::Discovered(session) => {
                self.recorded.load(session).await;
                let thread = self
                    .project_discovered(session)
                    .ok_or_else(|| internal("thread view", &"session id is not a thread id"))?;
                let fence = if fenced {
                    Some(self.fence().await)
                } else {
                    None
                };
                Ok(CurrentView {
                    thread,
                    sessions: vec![session.clone()],
                    state: None,
                    active: None,
                    fence,
                })
            }
        }
    }

    /// The thread from its latest state, its in-flight turn and the cached
    /// session metadata.
    pub(super) async fn project_handle(
        &self,
        handle: &SessionHandle,
    ) -> Result<AgentThread, ProviderError> {
        let (state, active, _) = handle.read(false).await.map_err(|err| session_gone(&err))?;
        let sessions = self.cached_sessions(&state);
        Ok(self.project_state(
            &state,
            &handle.status(),
            active.as_ref().and_then(turn_prompt),
            &sessions,
        ))
    }

    /// Metadata for a session `CodeWide` has not touched yet; the existing
    /// thread when it has.
    pub(super) async fn adopt(
        &self,
        session: &CatalogSession,
        presence: NativeThreadPresence,
    ) -> Result<SessionHandle, ProviderError> {
        let _adding = self.adding.lock().await;
        if let Some(existing) = self.registry.get(&session.session_id) {
            return Ok(existing);
        }
        let app_thread_id = agent_core::model::AppThreadId::parse(&session.session_id)
            .ok_or_else(|| internal("adopt", &"session id is not a thread id"))?;
        self.registry
            .add(ThreadState {
                app_thread_id,
                created_at: seconds(session.started_at_ms()),
                cwd: session.cwd.clone().unwrap_or_default(),
                origin: ThreadStateOrigin::Discovered,
                pending_settings: None,
                presence,
                recency_at: None,
                session_ids: SessionChain::new(session.session_id.clone()),
                session_started: true,
                // CodeWide continues the session with the model it last answered with.
                settings: discovered_settings(self.recorded_model_of(&session.session_id)),
                title: NativeTitleOverride::None,
                // A discovered session may hold usage the service never measured.
                total_cost: ThreadCost::Unknown,
                total_usage: ZERO_USAGE,
                turns: Vec::new(),
                updated_at: seconds(session.last_modified_ms),
                usage_baseline: UsageBaseline::Unknown,
                version: StateVersion::default(),
            })
            .await
    }

    /// The session of a listed thread, adopting a discovered session.
    pub(super) async fn entry_for(
        &self,
        app_thread_id: &str,
    ) -> Result<Option<SessionHandle>, ProviderError> {
        match self.resolve(app_thread_id).await? {
            Resolved::Entry(handle) => Ok(Some(handle)),
            Resolved::Discovered(session) => {
                self.recorded.load(&session).await;
                self.adopt(&session, NativeThreadPresence::Listed { archived: false })
                    .await
                    .map(Some)
            }
            Resolved::Deleted(_) | Resolved::Missing => Ok(None),
        }
    }

    /// Claude created the thread's session: applies a pending title, then
    /// refreshes its metadata and publishes the thread when that changed it.
    /// Runs in the background, as the host does.
    pub(super) fn session_ready(self: &Arc<Self>, handle: SessionHandle) {
        let service = self.clone();
        tokio::spawn(async move {
            let before = service.project_published(&handle);
            if let Err(err) = service.refresh_after_ready(&handle, &before).await {
                warn!(app_thread_id = %before.app_thread_id, err = %err, "claude session metadata refresh failed");
            }
        });
    }

    async fn refresh_after_ready(
        &self,
        handle: &SessionHandle,
        before: &AgentThread,
    ) -> Result<(), ProviderError> {
        self.apply_pending_title(handle).await?;
        self.fresh_sessions(&handle.state()).await?;
        let thread = self.project_published(handle);
        if !handle.state().is_deleted() && thread != *before {
            self.emit_updated(thread).await;
        }
        Ok(())
    }

    async fn apply_pending_title(&self, handle: &SessionHandle) -> Result<(), ProviderError> {
        let state = handle.state();
        let NativeTitleOverride::Pending { name } = &state.title else {
            return Ok(());
        };
        let session_id = state.current_session_id().to_owned();
        let root = self.projects_root.clone();
        let cwd = state.cwd.clone();
        let title = name.clone();
        let id = session_id.clone();
        tokio::task::spawn_blocking(move || {
            write::rename(
                &root,
                &SessionLocation {
                    session_id: &id,
                    cwd: cwd_hint(&cwd),
                },
                &title,
            )
        })
        .await
        .map_err(|err| internal("rename", &err))?
        .map_err(|err| internal("rename", &err))?;
        self.catalog.remember_title(&session_id, name);
        let applied = state.title.clone();
        handle
            .edit(Box::new(move |state| {
                if state.title == applied {
                    state.title = NativeTitleOverride::None;
                }
            }))
            .await
            .map_err(|err| session_gone(&err))?;
        Ok(())
    }
}
