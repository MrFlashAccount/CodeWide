//! Claude provider adapter: drives the user's `claude` directly over its
//! stream-json protocol (`cli`), one actor per live thread (`session`),
//! behind the thread service (`threads`) that keeps `CodeWide`'s own thread
//! metadata (`state`) and reads and writes Claude's session store
//! (`native`, `transcript`).
//!
//! With host storage attached (`spawn_with_storage`) the adapter also keeps
//! an index of Claude's session store: a watcher notices changed session
//! files, the indexer reads them and the index answers `thread.list`,
//! `thread.turns`, `thread.owns`, message search and thread resources. The
//! adapter never stores or logs Claude credentials or tokens and never emits
//! client-wire JSON. The reset capability reads Claude's current OAuth token
//! only for the duration of one user-confirmed reset request.

pub mod background_tasks;
pub mod catalog;
pub mod cli;
pub mod config;
pub mod discovery;
pub mod indexer;
pub mod legacy_install;
pub mod live;
pub mod native;
pub mod preflight;
pub mod preview;
pub mod resources;
pub mod runtime;
pub mod search;
pub mod session;
pub mod state;
pub mod storage;
pub mod store;
pub mod subagents;
#[cfg(test)]
mod test_scripts;
#[cfg(test)]
mod test_support;
pub mod threads;
pub mod transcript;
pub mod user_text;
pub mod uuid;
pub mod watcher;

use std::path::Path;
use std::sync::{Arc, Mutex, PoisonError, Weak};
use std::time::Duration;

use agent_core::{
    model::{
        AgentEvent, AgentThread, AppThreadId, BackgroundTaskReadParams, BackgroundTaskReadResult,
        CapabilityInvokeParams, CapabilitySet, ERROR_BACKGROUND_TASK_UNAVAILABLE,
        ERROR_CAPABILITY_UNSUPPORTED, ERROR_INVALID_PARAMS, ERROR_INVALID_REQUEST, ItemsView,
        ModelCatalog, PermissionProfileCatalog, Provenance, ProviderDescriptor, ProviderId,
        ProviderRateLimits, ProviderThreadRef, RequestRespondParams, RpcError, RpcErrorData,
        SortDirection, StartWhileActiveMode, ThreadCreateParams, ThreadForkParams,
        ThreadListParams, ThreadListResult, ThreadReadResult, ThreadTurnsParams, ThreadTurnsResult,
        ThreadUpdateParams, ThreadUpdateResult, TurnInterruptParams, TurnStartParams,
        TurnStartResult, TurnSteerParams, TurnSteerResult, background_task_not_found_message,
        capability_unsupported_message, thread_not_found_message,
        turns::{MAX_TURNS_PAGE, page_turns},
    },
    naming::{CatalogNames, ModelNaming},
    provider::{
        AgentProvider, ClientToolHost, NativeThreadResources, ProviderAuth, ProviderError,
        ProviderEvent, ProviderFence, ProviderHealth, ProviderStatus, StoredMessageSearch,
    },
    usage::{CatalogPricing, ModelPricing},
};
use async_trait::async_trait;
use serde::Deserialize;
use serde_json::Value;
use tokio::sync::{mpsc, watch};
use tracing::{error, info, warn};

pub use config::{ClaudeConfig, ClaudeConfigError};
pub use storage::{ClaudeStorage, ClaudeStorageHost};
use subagents::ChildThread;

use crate::{
    background_tasks::{BackgroundTaskId, TaskFacts, TaskRead},
    runtime::{
        account::{Account, ProbeTarget},
        companion_tools::CompanionTools,
        proxy_environment::{
            ProxyEnvironment, ProxyVariable, read_user_proxy_environment, user_settings_path,
        },
        published_limits::{PublishedLimits, now_ms},
        rate_limit_reset::{RateLimitResetClient, ResetConsumeError},
        running_sessions::CliRunningSessions,
    },
    session::{ports::SessionConfig, query::CliRuntime},
    threads::{FenceReceiver, ServiceDeps, ServiceOutput, ServiceOutputs, ThreadService},
};

pub const PROVIDER_ID: &str = "claude";
const EVENT_CHANNEL_CAPACITY: usize = 2_048;
const PROVIDER_DISABLED_CODE: i64 = -32_070;
const INTERRUPT_TIMEOUT: Duration = Duration::from_secs(5);
const OPEN_ELSEWHERE_POLL: Duration = Duration::from_secs(10);
const BACKGROUND_DEFER_MAX: Duration = Duration::from_hours(4);

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ResetConsumeParams {
    grant_id: String,
    provider_id: ProviderId,
}

fn proxy_value<'value>(
    environment: &'value ProxyEnvironment,
    precedence: &[ProxyVariable],
) -> Option<&'value str> {
    precedence.iter().find_map(|selected| {
        environment
            .variables()
            .iter()
            .find(|(variable, _)| variable == selected)
            .map(|(_, value)| value.as_str())
    })
}

fn reset_client(
    config: &ClaudeConfig,
    config_directory: &Path,
    home: Option<&Path>,
    proxy: &ProxyEnvironment,
) -> Result<RateLimitResetClient, String> {
    let state_root = config
        .environment
        .claude_config_dir
        .clone()
        .or_else(|| std::env::var_os("CLAUDE_CONFIG_DIR").map(std::path::PathBuf::from))
        .or_else(|| home.map(Path::to_path_buf))
        .ok_or("Claude's state directory is unknown (no HOME)")?;
    RateLimitResetClient::new(
        config_directory.join(".credentials.json"),
        state_root.join(".claude.json"),
        proxy_value(
            proxy,
            &[
                ProxyVariable::HttpsProxy,
                ProxyVariable::HttpsProxyLower,
                ProxyVariable::HttpProxy,
                ProxyVariable::HttpProxyLower,
            ],
        ),
        proxy_value(
            proxy,
            &[ProxyVariable::NoProxy, ProxyVariable::NoProxyLower],
        ),
    )
    .map_err(|err| format!("the Claude reset client cannot be configured: {err}"))
}

/// The Claude column of the capability table. With host storage the adapter
/// adds `history.messageSearch`, `history.threadResources` and
/// `subagentThreads`.
pub const CAPABILITIES: CapabilitySet = CapabilitySet {
    turns_steer: true,
    turns_provider_initiated: true,
    threads_host_minted_ids: true,
    threads_external_discovery: true,
    threads_compact: true,
    threads_fork: true,
    requests_user_input: true,
    requests_mcp_elicitation: false,
    requests_dynamic_tool_call: false,
    settings_service_tier: false,
    settings_personality: false,
    input_skills_and_mentions: false,
    catalog_skills_plugins: false,
    review: false,
    goals: false,
    background_terminals: false,
    realtime_voice: false,
    global_supervisor: false,
    subagent_threads: false,
    accounts_pool: false,
    accounts_rate_limits: false,
    history_thread_resources: false,
    history_message_search: false,
    host_fs: false,
    host_config: false,
    codex_native: false,
    orchestration_tools: true,
    threads_cross_provider_fork: true,
    threads_background_task_output: true,
    orchestration_external_delivery: false,
    accounts_rate_limit_resets: true,
    turns_start_while_active: StartWhileActiveMode::Busy,
};

/// The loaded threads' events, initial status snapshot and service output,
/// until taken.
type PendingOutputs = (Arc<Mutex<Vec<AgentEvent>>>, ServiceOutputs);

/// The thread service once its stored threads are loaded.
struct Running {
    service: ThreadService,
    account: Arc<Account>,
    reset_client: RateLimitResetClient,
    /// Set once the stored threads are loaded.
    ready: watch::Receiver<bool>,
    /// The loaded threads' `turn.completed` events, initial status snapshot
    /// and then the service's output, taken once by `take_events`.
    outputs: Mutex<Option<PendingOutputs>>,
}

/// The Claude provider.
pub struct ClaudeProvider {
    id: ProviderId,
    /// `None` when Claude cannot run on this host (logged at start).
    running: Option<Running>,
    storage: Option<Arc<ClaudeStorage>>,
    tools: Arc<CompanionTools>,
    status: watch::Sender<ProviderStatus>,
    health: Arc<watch::Sender<ProviderHealth>>,
    rate_limits: Arc<watch::Sender<Option<ProviderRateLimits>>>,
    pricing: Arc<CatalogPricing>,
    names: Arc<CatalogNames>,
    /// The `claude` version, once read.
    version: Arc<std::sync::OnceLock<String>>,
}

impl ClaudeProvider {
    /// Starts the provider. Must be called inside a Tokio runtime.
    #[must_use]
    pub fn spawn(config: &ClaudeConfig) -> Arc<Self> {
        Arc::new(Self::start(config, None))
    }

    /// Starts the provider with the session index on the companion's host
    /// storage. Storage that cannot be opened is logged at `error`; the
    /// provider then answers from Claude's files alone.
    #[must_use]
    pub fn spawn_with_storage(config: &ClaudeConfig, host: ClaudeStorageHost) -> Arc<Self> {
        let storage = match ClaudeStorage::open(host) {
            Ok(storage) => Some(Arc::new(storage)),
            Err(err) => {
                error!(err = %err, "Claude session index is unavailable");
                None
            }
        };
        Arc::new(Self::start(config, storage))
    }

    fn start(config: &ClaudeConfig, storage: Option<Arc<ClaudeStorage>>) -> Self {
        let id = ProviderId::from_static(PROVIDER_ID);
        let (status, status_rx) = watch::channel(ProviderStatus::Live);
        let health = Arc::new(watch::Sender::new(ProviderHealth::Available(
            ProviderAuth::Unknown,
        )));
        let rate_limits = Arc::new(watch::Sender::new(None));
        let pricing = Arc::new(CatalogPricing::default());
        let names = Arc::new(CatalogNames::default());
        let tools = Arc::new(CompanionTools::new(id.clone()));
        let version = Arc::new(std::sync::OnceLock::new());
        let mut provider = Self {
            id,
            running: None,
            storage,
            tools,
            status,
            health,
            rate_limits,
            pricing,
            names,
            version,
        };
        match provider.start_service(config) {
            Ok(()) => {
                if let (Some(storage), Some(running)) = (&provider.storage, &provider.running) {
                    storage.start(status_rx, running.service.session_activity());
                }
            }
            Err(reason) => {
                error!(err = %reason, "Claude is unavailable on this host");
                provider.health.send_replace(ProviderHealth::Unavailable);
            }
        }
        provider
    }

    /// The `claude` children's environment, the probe, the account and the
    /// thread service with its loading.
    fn start_service(&mut self, config: &ClaudeConfig) -> Result<(), String> {
        let config_directory = config
            .config_directory()
            .ok_or("Claude's configuration directory is unknown (no HOME)")?;
        let mut environment = config.child_environment(std::env::var_os("PATH").as_deref());
        let home = std::env::var_os("HOME").map(std::path::PathBuf::from);
        let settings = user_settings_path(
            config.environment.claude_config_dir.as_deref(),
            home.as_deref().unwrap_or(&config_directory),
        );
        // Continuing without the user's proxy could bypass a network
        // configuration they require.
        let proxy = read_user_proxy_environment(&settings)
            .map_err(|err| format!("the Claude proxy environment cannot be read: {err}"))?;
        let reset_client = reset_client(config, &config_directory, home.as_deref(), &proxy)?;
        environment.extend(proxy.environment());
        let limits = Arc::new(PublishedLimits::new(self.rate_limits.clone()));
        let account = Arc::new(Account::new(
            ProbeTarget {
                executable: config.claude_executable.clone(),
                cwd: home.unwrap_or_else(|| config.journal_directory.clone()),
                environment: environment.clone(),
            },
            self.health.clone(),
            self.pricing.clone(),
            self.names.clone(),
            limits.clone(),
        ));
        let catalog = account.clone();
        let (service, outputs) = ThreadService::new(ServiceDeps {
            projects_root: config_directory.join("projects"),
            state_directory: config.journal_directory.clone(),
            runtime: Arc::new(CliRuntime::new(environment.clone())),
            executable: config.claude_executable.clone(),
            clock: Arc::new(now_ms),
            new_uuid: Arc::new(uuid::random_uuid),
            client_tools: self.tools.clone(),
            rate_limits: limits,
            session_config: SessionConfig {
                idle_release: Duration::from_mins(u64::from(config.idle_release_minutes)),
                background_defer_max: BACKGROUND_DEFER_MAX,
                interrupt_timeout: INTERRUPT_TIMEOUT,
            },
            running_sessions: Arc::new(CliRunningSessions::new(
                config.claude_executable.clone(),
                environment.clone(),
            )),
            open_elsewhere_poll: OPEN_ELSEWHERE_POLL,
            model_id_for: Arc::new(move |recorded| catalog.id_for(recorded)),
        })
        .map_err(|err| format!("the Claude thread state directory cannot be opened: {err}"))?;
        let (ready_tx, ready) = watch::channel(false);
        let loaded = Arc::new(Mutex::new(Vec::new()));
        let service_to_load = service.clone();
        let loaded_events = loaded.clone();
        tokio::spawn(async move {
            match service_to_load.load().await {
                Ok(events) => {
                    *loaded_events.lock().unwrap_or_else(PoisonError::into_inner) = events;
                }
                Err(err) => error!(err = %err, "stored Claude threads could not be loaded"),
            }
            let _ = ready_tx.send(true);
        });
        let probe = account.clone();
        tokio::spawn(async move { probe.probe(None).await });
        let version = self.version.clone();
        let executable = config.claude_executable.clone();
        tokio::spawn(async move {
            match runtime::cli_version::read_claude_version(&executable, &environment).await {
                Ok(read) => {
                    info!(version = %read, "Claude CLI found");
                    let _ = version.set(read);
                }
                Err(err) => warn!(err = %err, "Claude CLI version is unavailable"),
            }
        });
        self.running = Some(Running {
            service,
            account,
            reset_client,
            ready,
            outputs: Mutex::new(Some((loaded, outputs))),
        });
        Ok(())
    }

    /// The thread service once its stored threads are loaded.
    async fn service(&self) -> Result<&ThreadService, ProviderError> {
        Ok(&self.running().await?.service)
    }

    /// The running parts once the stored threads are loaded.
    async fn running(&self) -> Result<&Running, ProviderError> {
        let Some(running) = &self.running else {
            return Err(ProviderError::Rejected(RpcError {
                code: PROVIDER_DISABLED_CODE,
                message: "Claude provider is disabled on this host".into(),
                data: None,
            }));
        };
        let mut ready = running.ready.clone();
        ready
            .wait_for(|ready| *ready)
            .await
            .map_err(|_| ProviderError::Disconnected("Claude thread service has stopped".into()))?;
        Ok(running)
    }

    fn stamp_turns(&self, thread: &AppThreadId, result: &mut ThreadTurnsResult) {
        let origin = provenance(&self.id, thread);
        for turn in &mut result.turns {
            turn.stamp(&origin);
        }
    }

    /// The indexed sub-agent child thread `thread` (`<parent>:agent:<agent
    /// id>`); `None` when `thread` is not a child thread id. Child threads are
    /// read-only and answered from the index alone.
    fn child_thread(&self, thread: &AppThreadId) -> Option<Result<ChildThread, ProviderError>> {
        subagents::parse_child_thread_id(thread)?;
        let found = match &self.storage {
            Some(storage) => storage.store().child_thread(thread).map_err(|err| {
                warn!(err = %err, "Claude sub-agent index cannot be read");
                ProviderError::Protocol(err.to_string())
            }),
            None => Ok(None),
        };
        Some(found.and_then(|child| {
            child.ok_or_else(|| {
                ProviderError::Rejected(RpcError::new(
                    ERROR_INVALID_REQUEST,
                    thread_not_found_message(thread.as_str()),
                ))
            })
        }))
    }

    /// The indexed preview over threads the service projected (it knows
    /// only the first prompt); without storage its preview stays.
    fn overlay_previews<'a>(&self, threads: impl IntoIterator<Item = &'a mut AgentThread>) {
        if let Some(storage) = &self.storage {
            storage.overlay_previews(threads);
        }
    }

    /// A child's transcript records the full model id; like a session's
    /// recorded model it is reported as the catalog row that names it.
    fn child_read(&self, child: &ChildThread) -> ThreadReadResult {
        let mut thread = child.thread(&self.id);
        if let Some(running) = &self.running {
            thread.settings.model = running.account.id_for(&thread.settings.model);
        }
        ThreadReadResult {
            thread,
            active_turn_id: child.active_turn().map(|turn| turn.turn_id.clone()),
        }
    }

    fn child_turns(
        &self,
        child: &ChildThread,
        params: &ThreadTurnsParams,
    ) -> Result<ThreadTurnsResult, ProviderError> {
        let mut result = page_turns(
            &child.turns,
            params.cursor.as_deref(),
            params.limit,
            params.sort_direction,
            params.items_view,
        )
        .map_err(ProviderError::Rejected)?;
        self.stamp_turns(&params.app_thread_id, &mut result);
        Ok(result)
    }

    /// A fence after every event emitted so far, for a fenced read the
    /// index answers.
    /// What the thread's own items say about `task`: newest turns first,
    /// until the call that launched it.
    async fn background_task_facts(
        &self,
        thread: &AppThreadId,
        task: &BackgroundTaskId,
    ) -> Result<TaskFacts, ProviderError> {
        let mut facts = TaskFacts::default();
        let mut cursor = None;
        loop {
            let page = self
                .thread_turns(ThreadTurnsParams {
                    app_thread_id: thread.clone(),
                    cursor,
                    limit: u32::try_from(MAX_TURNS_PAGE).unwrap_or(u32::MAX),
                    sort_direction: SortDirection::Desc,
                    items_view: ItemsView::Full,
                })
                .await?;
            if facts.scan_newest_first(task, &page.turns) {
                return Ok(facts);
            }
            match page.next_cursor {
                Some(next) => cursor = Some(next),
                None => return Ok(facts),
            }
        }
    }

    async fn fence(&self) -> Result<ProviderFence, ProviderError> {
        Ok(provider_fence(self.service().await?.fence().await?))
    }
}

/// The provider fence of a service fence.
fn provider_fence(fence: FenceReceiver) -> ProviderFence {
    ProviderFence::new(async move {
        fence
            .await
            .map_err(|_| ProviderError::Disconnected("Claude event stream has ended".into()))?
    })
}

fn optional_fence(fence: Option<FenceReceiver>) -> Result<ProviderFence, ProviderError> {
    fence
        .map(provider_fence)
        .ok_or_else(|| ProviderError::Protocol("Claude fenced read returned no fence".into()))
}

/// Forwards the loaded threads' events and then the service's output as
/// provider events: events stamped with their provenance and observed by
/// the index, fences as they come.
async fn forward_events(
    ready: watch::Receiver<bool>,
    loaded: Arc<Mutex<Vec<AgentEvent>>>,
    service: ThreadService,
    mut outputs: ServiceOutputs,
    events: mpsc::Sender<ProviderEvent>,
    storage: Option<Arc<ClaudeStorage>>,
    provider: ProviderId,
) {
    let mut ready = ready;
    if ready.wait_for(|ready| *ready).await.is_err() {
        return;
    }
    let startup = std::mem::take(&mut *loaded.lock().unwrap_or_else(PoisonError::into_inner));
    let forward = |mut event: AgentEvent| {
        stamp_event(&mut event, &provider);
        if let Some(storage) = &storage {
            storage.observe_event(&event);
        }
        ProviderEvent::Event(Box::new(event))
    };
    for event in startup {
        if events.send(forward(event)).await.is_err() {
            return;
        }
    }
    match service.status_snapshot().await {
        Ok(threads) => {
            let thread_count = threads.len();
            for thread in threads {
                if events
                    .send(forward(AgentEvent::ThreadUpdated { thread }))
                    .await
                    .is_err()
                {
                    return;
                }
            }
            info!(thread_count, "Claude startup status snapshot published");
        }
        Err(err) => warn!(err = %err, "Claude startup status snapshot failed"),
    }
    while let Some(output) = outputs.recv().await {
        let forwarded = match output {
            ServiceOutput::Event(event) => forward(*event),
            ServiceOutput::Fence(fence) => ProviderEvent::Fence(fence),
            ServiceOutput::SessionActivityChanged(sessions) => {
                if let Some(storage) = &storage {
                    storage.observe_session_activity(&sessions);
                }
                continue;
            }
        };
        if events.send(forwarded).await.is_err() {
            return;
        }
    }
}

/// The phase-1 origin of a Claude turn or item: this provider and the app
/// thread id as the native thread id.
fn provenance(provider: &ProviderId, thread: &AppThreadId) -> Provenance {
    Provenance {
        provider: provider.clone(),
        native_thread_id: ProviderThreadRef::same_as(thread),
    }
}

fn stamp_event(event: &mut AgentEvent, provider: &ProviderId) {
    match event {
        AgentEvent::TurnStarted {
            app_thread_id,
            turn,
        }
        | AgentEvent::TurnCompleted {
            app_thread_id,
            turn,
        } => {
            turn.stamp(&provenance(provider, app_thread_id));
        }
        AgentEvent::ItemStarted {
            app_thread_id,
            item,
            ..
        }
        | AgentEvent::ItemCompleted {
            app_thread_id,
            item,
            ..
        } => item.stamp(&provenance(provider, app_thread_id)),
        _ => {}
    }
}

impl ClaudeProvider {
    async fn consume_rate_limit_reset(&self, params: Value) -> Result<Value, ProviderError> {
        let request: ResetConsumeParams = serde_json::from_value(params).map_err(|_| {
            ProviderError::Rejected(RpcError::new(
                ERROR_INVALID_PARAMS,
                "providerId and grantId must identify a provider reset grant",
            ))
        })?;
        if request.provider_id.as_str() != PROVIDER_ID {
            return Err(ProviderError::Rejected(RpcError::new(
                ERROR_INVALID_PARAMS,
                "providerId does not identify the Claude provider",
            )));
        }
        let running = self.running().await?;
        // Claude owns refresh-token rotation. A probe makes it refresh and
        // persist the access token before the adapter borrows that token.
        running.account.probe(None).await;
        let result = running
            .reset_client
            .consume(&request.grant_id, &uuid::random_uuid())
            .await
            .map_err(|err| reset_consume_error(&err))?;
        // Re-read the authoritative inventory before answering. The limits
        // watch publishes the resulting provider-status change to clients.
        running.account.probe(None).await;
        serde_json::to_value(result).map_err(|err| {
            error!(err = %err, "Claude reset result could not be serialized");
            ProviderError::Protocol("Claude reset result could not be serialized".into())
        })
    }
}

#[async_trait]
impl AgentProvider for ClaudeProvider {
    fn descriptor(&self) -> ProviderDescriptor {
        ProviderDescriptor {
            id: self.id.clone(),
            display_name: "Claude".into(),
            model_provider: "anthropic".into(),
            version: self.version.get().cloned().unwrap_or_default(),
        }
    }

    fn as_any(&self) -> &dyn std::any::Any {
        self
    }

    fn capabilities(&self) -> CapabilitySet {
        let mut capabilities = CAPABILITIES;
        // Search and resources are served by this adapter's own index.
        capabilities.history_message_search = self.storage.is_some();
        capabilities.history_thread_resources = self.storage.is_some();
        // Sub-agent transcripts are indexed child threads; the index
        // publishes their tree to the companion thread index.
        capabilities.subagent_threads = self.storage.is_some();
        capabilities
    }

    fn status(&self) -> ProviderStatus {
        *self.status.borrow()
    }

    fn subscribe_status(&self) -> watch::Receiver<ProviderStatus> {
        self.status.subscribe()
    }

    fn health(&self) -> ProviderHealth {
        self.health.borrow().clone()
    }

    fn subscribe_health(&self) -> Option<watch::Receiver<ProviderHealth>> {
        Some(self.health.subscribe())
    }

    fn subscribe_rate_limits(&self) -> Option<watch::Receiver<Option<ProviderRateLimits>>> {
        Some(self.rate_limits.subscribe())
    }

    fn take_events(&self) -> mpsc::Receiver<ProviderEvent> {
        let (sender, receiver) = mpsc::channel(EVENT_CHANNEL_CAPACITY);
        let taken = self.running.as_ref().and_then(|running| {
            let outputs = running
                .outputs
                .lock()
                .unwrap_or_else(PoisonError::into_inner)
                .take();
            outputs.map(|outputs| (running.ready.clone(), running.service.clone(), outputs))
        });
        if let Some((ready, service, (loaded, outputs))) = taken {
            tokio::spawn(forward_events(
                ready,
                loaded,
                service,
                outputs,
                sender,
                self.storage.clone(),
                self.id.clone(),
            ));
        } else {
            warn!("Claude events are already taken or Claude is unavailable");
        }
        receiver
    }

    async fn catalog_models(&self) -> Result<ModelCatalog, ProviderError> {
        Ok(self.running().await?.account.catalog().await)
    }

    fn usage_pricing(&self) -> Option<Arc<dyn ModelPricing>> {
        Some(self.pricing.clone())
    }

    fn model_names(&self) -> Option<Arc<dyn ModelNaming>> {
        Some(self.names.clone())
    }

    fn user_text_cleaner(&self) -> Option<Arc<dyn agent_core::user_text::UserTextCleaner>> {
        Some(Arc::new(user_text::ClaudeUserText))
    }

    async fn catalog_permission_profiles(&self) -> Result<PermissionProfileCatalog, ProviderError> {
        Ok(PermissionProfileCatalog {
            profiles: live::permissions::permission_profiles(),
        })
    }

    async fn thread_create(
        &self,
        params: ThreadCreateParams,
    ) -> Result<AgentThread, ProviderError> {
        self.service().await?.create(params).await
    }

    async fn thread_fork(&self, params: ThreadForkParams) -> Result<AgentThread, ProviderError> {
        self.service().await?.fork(params).await
    }

    async fn thread_read(&self, thread: &AppThreadId) -> Result<ThreadReadResult, ProviderError> {
        if let Some(child) = self.child_thread(thread) {
            return child.map(|child| self.child_read(&child));
        }
        let (mut read, _) = self.service().await?.read(thread, false).await?;
        self.overlay_previews([&mut read.thread]);
        Ok(read)
    }

    async fn thread_read_fenced(
        &self,
        thread: &AppThreadId,
    ) -> Result<(ThreadReadResult, ProviderFence), ProviderError> {
        if let Some(child) = self.child_thread(thread) {
            let read = self.child_read(&child?);
            return Ok((read, self.fence().await?));
        }
        let (mut read, fence) = self.service().await?.read(thread, true).await?;
        self.overlay_previews([&mut read.thread]);
        Ok((read, optional_fence(fence)?))
    }

    async fn thread_list(
        &self,
        params: ThreadListParams,
    ) -> Result<ThreadListResult, ProviderError> {
        if let Some(indexed) = self
            .storage
            .as_ref()
            .and_then(|storage| storage.list(&params, &self.id))
        {
            return indexed.map_err(ProviderError::Rejected);
        }
        let mut listed = self.service().await?.list(params).await?;
        self.overlay_previews(&mut listed.threads);
        Ok(listed)
    }

    async fn thread_turns(
        &self,
        params: ThreadTurnsParams,
    ) -> Result<ThreadTurnsResult, ProviderError> {
        if let Some(child) = self.child_thread(&params.app_thread_id) {
            return self.child_turns(&child?, &params);
        }
        let mut result = match self
            .storage
            .as_ref()
            .and_then(|storage| storage.turns(&params))
        {
            Some(indexed) => indexed.map_err(ProviderError::Rejected)?,
            None => self.service().await?.turns(params.clone(), false).await?.0,
        };
        self.stamp_turns(&params.app_thread_id, &mut result);
        Ok(result)
    }

    async fn thread_turns_fenced(
        &self,
        params: ThreadTurnsParams,
    ) -> Result<(ThreadTurnsResult, ProviderFence), ProviderError> {
        if let Some(child) = self.child_thread(&params.app_thread_id) {
            let result = self.child_turns(&child?, &params)?;
            return Ok((result, self.fence().await?));
        }
        let (mut result, fence) = self.service().await?.turns(params.clone(), true).await?;
        self.stamp_turns(&params.app_thread_id, &mut result);
        Ok((result, optional_fence(fence)?))
    }

    async fn thread_update(
        &self,
        params: ThreadUpdateParams,
    ) -> Result<ThreadUpdateResult, ProviderError> {
        self.service().await?.update(params).await
    }

    async fn thread_owns(&self, thread: &AppThreadId) -> Result<bool, ProviderError> {
        if let Some(child) = self.child_thread(thread) {
            return Ok(child.is_ok());
        }
        if self
            .storage
            .as_ref()
            .is_some_and(|storage| storage.owns(thread))
        {
            return Ok(true);
        }
        self.service().await?.owns(thread).await
    }

    async fn thread_compact(&self, thread: &AppThreadId) -> Result<(), ProviderError> {
        self.service().await?.compact(thread).await
    }

    async fn turn_start(&self, params: TurnStartParams) -> Result<TurnStartResult, ProviderError> {
        self.service().await?.turn_start(params).await
    }

    /// Reads only `<a session of the thread>/tasks/<task id>.output` of a
    /// task the thread's own items launched or reported
    /// (`background_tasks`); a sub-agent's read-only child thread has none.
    async fn thread_background_task_read(
        &self,
        params: BackgroundTaskReadParams,
    ) -> Result<BackgroundTaskReadResult, ProviderError> {
        let Some(task) = BackgroundTaskId::parse(&params.task_id) else {
            return Err(ProviderError::Rejected(RpcError::new(
                ERROR_INVALID_PARAMS,
                "invalid background task id",
            )));
        };
        if let Some(child) = self.child_thread(&params.app_thread_id) {
            child?;
            return Err(ProviderError::Rejected(RpcError::new(
                ERROR_BACKGROUND_TASK_UNAVAILABLE,
                background_task_not_found_message(task.as_str()),
            )));
        }
        let thread = self
            .service()
            .await?
            .background_task_thread(&params.app_thread_id, &task)
            .await?;
        let facts = self
            .background_task_facts(&params.app_thread_id, &task)
            .await?;
        let temp_root = background_tasks::process_temp_root();
        tokio::task::spawn_blocking(move || {
            background_tasks::answer(&TaskRead {
                task: &task,
                facts: &facts,
                live: thread.live,
                sessions: &thread.sessions,
                temp_root: &temp_root,
                offset: params.offset,
                limit: params.limit,
            })
        })
        .await
        .map_err(|err| {
            error!(err = %err, "background task output read failed");
            ProviderError::Protocol("background task output read failed".into())
        })?
        .map_err(ProviderError::Rejected)
    }

    async fn shutdown(&self) {
        if let Some(running) = &self.running {
            running.service.shutdown().await;
        }
    }

    fn install_client_tools(&self, host: Weak<dyn ClientToolHost>) {
        if !self.tools.install(host) {
            warn!("client tools are already installed on the Claude adapter");
        }
    }

    async fn turn_steer(&self, params: TurnSteerParams) -> Result<TurnSteerResult, ProviderError> {
        self.service().await?.turn_steer(params).await
    }

    async fn turn_interrupt(&self, params: TurnInterruptParams) -> Result<(), ProviderError> {
        self.service().await?.turn_interrupt(params).await
    }

    async fn request_respond(&self, params: RequestRespondParams) -> Result<(), ProviderError> {
        self.service().await?.request_respond(params).await
    }

    async fn capability_invoke(
        &self,
        params: CapabilityInvokeParams,
    ) -> Result<Value, ProviderError> {
        if params.capability == "accounts.rateLimitResets"
            && params.method == "companion/providerRateLimits/reset/consume"
        {
            return self.consume_rate_limit_reset(params.params).await;
        }
        Err(ProviderError::Rejected(RpcError {
            code: ERROR_CAPABILITY_UNSUPPORTED,
            message: capability_unsupported_message(&params.capability),
            data: Some(RpcErrorData {
                capability: Some(params.capability),
                provider: Some(PROVIDER_ID.into()),
            }),
        }))
    }

    fn thread_resources(&self) -> Option<Arc<dyn NativeThreadResources>> {
        self.storage
            .as_ref()
            .map(|storage| -> Arc<dyn NativeThreadResources> { storage.resources() })
    }

    fn message_search(&self) -> Option<Arc<dyn StoredMessageSearch>> {
        self.storage
            .as_ref()
            .map(|storage| -> Arc<dyn StoredMessageSearch> { storage.search() })
    }

    fn take_history_changes(
        &self,
    ) -> Option<tokio::sync::mpsc::Receiver<agent_core::provider::HistoryChange>> {
        self.storage.as_ref()?.take_history_changes()
    }

    fn take_subagent_changes(
        &self,
    ) -> Option<tokio::sync::mpsc::Receiver<agent_core::provider::SubagentsChange>> {
        self.storage.as_ref()?.take_subagent_changes()
    }
}

fn reset_consume_error(error: &ResetConsumeError) -> ProviderError {
    match error {
        ResetConsumeError::InvalidGrant => {
            ProviderError::Rejected(RpcError::new(ERROR_INVALID_PARAMS, error.to_string()))
        }
        ResetConsumeError::CredentialsUnavailable | ResetConsumeError::OrganizationUnavailable => {
            ProviderError::Rejected(RpcError::new(ERROR_INVALID_REQUEST, error.to_string()))
        }
        ResetConsumeError::Request(_) => ProviderError::Protocol(error.to_string()),
    }
}
