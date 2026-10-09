//! In-memory provider for unit tests of the provider layer. It records the
//! neutral calls it receives and answers from configured state.

use std::sync::{Arc, Mutex};

use async_trait::async_trait;
use serde_json::Value;
use tokio::sync::{mpsc, watch};

use super::{
    model::{
        AgentThread, AppThreadId, CapabilityInvokeParams, CapabilitySet, ModelCatalog,
        PermissionProfileCatalog, ProviderDescriptor, ProviderId, ProviderRateLimits,
        RequestRespondParams, RpcError, SortDirection, ThreadCreateParams, ThreadListParams,
        ThreadListResult, ThreadOrigin, ThreadReadResult, ThreadSettings, ThreadSortKey,
        ThreadStatus, ThreadTurnsParams, ThreadTurnsResult, ThreadUpdateParams, ThreadUpdateResult,
        TurnInterruptParams, TurnStartParams, TurnStartResult, TurnSteerParams, TurnSteerResult,
    },
    provider::{
        AgentProvider, ProviderAuth, ProviderError, ProviderEvent, ProviderFence, ProviderHealth,
        ProviderStatus,
    },
};

/// A configurable fake provider.
pub(crate) struct FakeProvider {
    pub(crate) descriptor: ProviderDescriptor,
    pub(crate) capabilities: CapabilitySet,
    pub(crate) threads: Vec<AgentThread>,
    pub(crate) owned: Vec<String>,
    pub(crate) calls: Mutex<Vec<String>>,
    pub(crate) list_params: Mutex<Vec<ThreadListParams>>,
    status: watch::Sender<ProviderStatus>,
    health: watch::Sender<ProviderHealth>,
    /// `Some` when the fake reports provider-level subscription limits.
    rate_limits: Option<watch::Sender<Option<ProviderRateLimits>>>,
}

impl FakeProvider {
    pub(crate) fn new(id: &'static str, capabilities: CapabilitySet) -> Self {
        let (status, _) = watch::channel(ProviderStatus::Live);
        let (health, _) = watch::channel(ProviderHealth::Available(ProviderAuth::Unknown));
        Self {
            descriptor: ProviderDescriptor {
                id: ProviderId::from_static(id),
                display_name: id.to_uppercase(),
                model_provider: format!("{id}-models"),
                version: "1".into(),
            },
            capabilities,
            threads: Vec::new(),
            owned: Vec::new(),
            calls: Mutex::new(Vec::new()),
            list_params: Mutex::new(Vec::new()),
            status,
            health,
            rate_limits: None,
        }
    }

    /// Makes the fake report provider-level subscription limits (none yet).
    pub(crate) fn reporting_rate_limits(mut self) -> Self {
        self.rate_limits = Some(watch::Sender::new(None));
        self
    }

    /// Publishes a limit snapshot; a fake that reports none ignores it.
    pub(crate) fn set_rate_limits(&self, limits: ProviderRateLimits) {
        if let Some(sender) = &self.rate_limits {
            sender.send_replace(Some(limits));
        }
    }

    pub(crate) fn set_transport_status(&self, status: ProviderStatus) {
        self.status.send_replace(status);
    }

    pub(crate) fn set_health(&self, health: ProviderHealth) {
        self.health.send_replace(health);
    }

    pub(crate) fn calls(&self) -> Vec<String> {
        self.calls
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clone()
    }

    fn record(&self, call: &str) {
        self.calls
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .push(call.to_owned());
    }

    pub(crate) fn into_arc(self) -> Arc<Self> {
        Arc::new(self)
    }
}

/// A thread row with one sort key used for every timestamp.
pub(crate) fn thread(provider: &'static str, id: &str, key: i64) -> AgentThread {
    AgentThread {
        app_thread_id: AppThreadId::parse(id).unwrap_or_else(|| AppThreadId::from_static("x")),
        provider: ProviderId::from_static(provider),
        cwd: "/w".into(),
        name: None,
        preview: "hello".into(),
        created_at: key,
        updated_at: key,
        recency_at: Some(key),
        archived: false,
        origin: ThreadOrigin::Interactive,
        status: ThreadStatus::Idle,
        settings: ThreadSettings {
            model: "m".into(),
            effort: None,
            permission_profile: ":workspace".into(),
            service_tier: None,
        },
    }
}

fn unsupported() -> ProviderError {
    ProviderError::Rejected(RpcError::new(-32_601, "unsupported in fake"))
}

fn sort_key(thread: &AgentThread, key: ThreadSortKey) -> i64 {
    match key {
        ThreadSortKey::CreatedAt => thread.created_at,
        ThreadSortKey::UpdatedAt => thread.updated_at,
        ThreadSortKey::RecencyAt => thread.recency_at.unwrap_or(thread.updated_at),
    }
}

#[async_trait]
impl AgentProvider for FakeProvider {
    fn descriptor(&self) -> ProviderDescriptor {
        self.descriptor.clone()
    }

    fn as_any(&self) -> &dyn std::any::Any {
        self
    }

    fn capabilities(&self) -> CapabilitySet {
        self.capabilities
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
        self.rate_limits.as_ref().map(watch::Sender::subscribe)
    }

    fn take_events(&self) -> mpsc::Receiver<ProviderEvent> {
        mpsc::channel(1).1
    }

    async fn catalog_models(&self) -> Result<ModelCatalog, ProviderError> {
        Ok(ModelCatalog { models: Vec::new() })
    }

    async fn catalog_permission_profiles(&self) -> Result<PermissionProfileCatalog, ProviderError> {
        Ok(PermissionProfileCatalog {
            profiles: Vec::new(),
        })
    }

    async fn thread_create(&self, _: ThreadCreateParams) -> Result<AgentThread, ProviderError> {
        self.record("thread.create");
        Err(unsupported())
    }

    async fn thread_read(&self, _: &AppThreadId) -> Result<ThreadReadResult, ProviderError> {
        self.record("thread.read");
        Err(unsupported())
    }

    async fn thread_read_fenced(
        &self,
        _: &AppThreadId,
    ) -> Result<(ThreadReadResult, ProviderFence), ProviderError> {
        Err(unsupported())
    }

    async fn thread_list(
        &self,
        params: ThreadListParams,
    ) -> Result<ThreadListResult, ProviderError> {
        self.record("thread.list");
        let window = params.window;
        let mut rows = self
            .threads
            .iter()
            .filter(|thread| thread.archived == params.archived)
            .filter(|thread| {
                let key = sort_key(thread, params.sort_key);
                window.is_none_or(|window| {
                    window.lower.is_none_or(|lower| {
                        if window.lower_inclusive {
                            key >= lower
                        } else {
                            key > lower
                        }
                    }) && window.upper.is_none_or(|upper| {
                        if window.upper_inclusive {
                            key <= upper
                        } else {
                            key < upper
                        }
                    })
                })
            })
            .cloned()
            .collect::<Vec<_>>();
        rows.sort_by_key(|thread| sort_key(thread, params.sort_key));
        if params.sort_direction == SortDirection::Desc {
            rows.reverse();
        }
        let offset = params
            .cursor
            .as_deref()
            .and_then(|cursor| cursor.parse::<usize>().ok())
            .unwrap_or(0);
        let limit = usize::try_from(params.limit).unwrap_or(usize::MAX);
        let end = offset.saturating_add(limit).min(rows.len());
        let next_cursor = (end < rows.len()).then(|| end.to_string());
        let threads = rows
            .get(offset..end)
            .map(<[AgentThread]>::to_vec)
            .unwrap_or_default();
        self.list_params
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .push(params);
        Ok(ThreadListResult {
            threads,
            next_cursor,
        })
    }

    async fn thread_turns(&self, _: ThreadTurnsParams) -> Result<ThreadTurnsResult, ProviderError> {
        Err(unsupported())
    }

    async fn thread_turns_fenced(
        &self,
        _: ThreadTurnsParams,
    ) -> Result<(ThreadTurnsResult, ProviderFence), ProviderError> {
        Err(unsupported())
    }

    async fn thread_update(
        &self,
        _: ThreadUpdateParams,
    ) -> Result<ThreadUpdateResult, ProviderError> {
        Err(unsupported())
    }

    async fn thread_owns(&self, thread: &AppThreadId) -> Result<bool, ProviderError> {
        self.record("thread.owns");
        Ok(self.owned.iter().any(|owned| owned == thread.as_str()))
    }

    async fn thread_compact(&self, _: &AppThreadId) -> Result<(), ProviderError> {
        Err(unsupported())
    }

    async fn turn_start(&self, _: TurnStartParams) -> Result<TurnStartResult, ProviderError> {
        self.record("turn.start");
        Err(unsupported())
    }

    async fn turn_steer(&self, _: TurnSteerParams) -> Result<TurnSteerResult, ProviderError> {
        Err(unsupported())
    }

    async fn turn_interrupt(&self, _: TurnInterruptParams) -> Result<(), ProviderError> {
        Err(unsupported())
    }

    async fn request_respond(&self, _: RequestRespondParams) -> Result<(), ProviderError> {
        Err(unsupported())
    }

    async fn capability_invoke(&self, _: CapabilityInvokeParams) -> Result<Value, ProviderError> {
        Err(unsupported())
    }
}

/// A neutral provider that keeps the threads it creates and answers turn
/// operations from scripted state, for contract tests of companion services
/// that drive providers (orchestration tools, cross-provider fork).
pub(crate) struct ScriptedProvider {
    pub(crate) descriptor: ProviderDescriptor,
    pub(crate) capabilities: CapabilitySet,
    pub(crate) threads: Mutex<Vec<AgentThread>>,
    /// Stored turns per thread, oldest first.
    pub(crate) turns: Mutex<std::collections::HashMap<String, Vec<crate::agent::model::AgentTurn>>>,
    /// `turn_start` answers `busy` while set.
    pub(crate) busy: Mutex<Option<String>>,
    pub(crate) created: Mutex<Vec<ThreadCreateParams>>,
    pub(crate) started: Mutex<Vec<TurnStartParams>>,
    pub(crate) steered: Mutex<Vec<TurnSteerParams>>,
    pub(crate) interrupted: Mutex<Vec<TurnInterruptParams>>,
    pub(crate) updated: Mutex<Vec<ThreadUpdateParams>>,
    next_id: std::sync::atomic::AtomicU64,
    status: watch::Sender<ProviderStatus>,
}

fn locked<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

impl ScriptedProvider {
    pub(crate) fn new(id: &'static str, capabilities: CapabilitySet) -> Self {
        let (status, _) = watch::channel(ProviderStatus::Live);
        Self {
            descriptor: ProviderDescriptor {
                id: ProviderId::from_static(id),
                display_name: id.to_uppercase(),
                model_provider: format!("{id}-models"),
                version: "1".into(),
            },
            capabilities,
            threads: Mutex::new(Vec::new()),
            turns: Mutex::new(std::collections::HashMap::new()),
            busy: Mutex::new(None),
            created: Mutex::new(Vec::new()),
            started: Mutex::new(Vec::new()),
            steered: Mutex::new(Vec::new()),
            interrupted: Mutex::new(Vec::new()),
            updated: Mutex::new(Vec::new()),
            next_id: std::sync::atomic::AtomicU64::new(1),
            status,
        }
    }

    /// Adds an existing thread.
    pub(crate) fn with_thread(self, thread: AgentThread) -> Self {
        locked(&self.threads).push(thread);
        self
    }

    pub(crate) fn thread(&self, id: &str) -> Option<AgentThread> {
        locked(&self.threads)
            .iter()
            .find(|thread| thread.app_thread_id.as_str() == id)
            .cloned()
    }

    pub(crate) fn set_turns(&self, thread: &str, turns: Vec<crate::agent::model::AgentTurn>) {
        locked(&self.turns).insert(thread.to_owned(), turns);
    }

    pub(crate) fn set_busy(&self, active_turn: Option<&str>) {
        *locked(&self.busy) = active_turn.map(str::to_owned);
    }

    pub(crate) fn set_status(&self, thread: &str, status: ThreadStatus) {
        if let Some(thread) = locked(&self.threads)
            .iter_mut()
            .find(|row| row.app_thread_id.as_str() == thread)
        {
            thread.status = status;
        }
    }

    pub(crate) fn created(&self) -> Vec<ThreadCreateParams> {
        locked(&self.created).clone()
    }

    pub(crate) fn started(&self) -> Vec<TurnStartParams> {
        locked(&self.started).clone()
    }

    pub(crate) fn steered(&self) -> Vec<TurnSteerParams> {
        locked(&self.steered).clone()
    }

    pub(crate) fn interrupted(&self) -> Vec<TurnInterruptParams> {
        locked(&self.interrupted).clone()
    }

    pub(crate) fn updated(&self) -> Vec<ThreadUpdateParams> {
        locked(&self.updated).clone()
    }

    fn next(&self, prefix: &str) -> String {
        let next = self
            .next_id
            .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        format!("{}-{prefix}-{next}", self.descriptor.id)
    }
}

fn not_found(id: &AppThreadId) -> ProviderError {
    ProviderError::Rejected(RpcError::new(
        -32_600,
        crate::agent::model::thread_not_found_message(id.as_str()),
    ))
}

#[async_trait]
impl AgentProvider for ScriptedProvider {
    fn descriptor(&self) -> ProviderDescriptor {
        self.descriptor.clone()
    }

    fn as_any(&self) -> &dyn std::any::Any {
        self
    }

    fn capabilities(&self) -> CapabilitySet {
        self.capabilities
    }

    fn status(&self) -> ProviderStatus {
        *self.status.borrow()
    }

    fn subscribe_status(&self) -> watch::Receiver<ProviderStatus> {
        self.status.subscribe()
    }

    fn take_events(&self) -> mpsc::Receiver<ProviderEvent> {
        mpsc::channel(1).1
    }

    async fn catalog_models(&self) -> Result<ModelCatalog, ProviderError> {
        Ok(ModelCatalog {
            models: vec![crate::agent::model::ModelEntry {
                id: format!("{}-default", self.descriptor.id),
                model: format!("{}-default", self.descriptor.id),
                display_name: "Default".into(),
                description: String::new(),
                is_default: true,
                hidden: false,
                efforts: Vec::new(),
                default_effort: None,
                input_modalities: Vec::new(),
            }],
        })
    }

    async fn catalog_permission_profiles(&self) -> Result<PermissionProfileCatalog, ProviderError> {
        Ok(PermissionProfileCatalog {
            profiles: Vec::new(),
        })
    }

    async fn thread_create(
        &self,
        params: ThreadCreateParams,
    ) -> Result<AgentThread, ProviderError> {
        let id = params.app_thread_id.clone().unwrap_or_else(|| {
            AppThreadId::parse(&self.next("thread"))
                .unwrap_or_else(|| AppThreadId::from_static("x"))
        });
        let mut created = thread("x", id.as_str(), 10);
        created.provider = self.descriptor.id.clone();
        created.cwd.clone_from(&params.cwd);
        created.settings = params.settings.clone();
        created.preview = String::new();
        locked(&self.created).push(params);
        locked(&self.threads).push(created.clone());
        Ok(created)
    }

    async fn thread_read(&self, id: &AppThreadId) -> Result<ThreadReadResult, ProviderError> {
        let thread = self.thread(id.as_str()).ok_or_else(|| not_found(id))?;
        let active_turn_id = locked(&self.turns).get(id.as_str()).and_then(|turns| {
            turns
                .iter()
                .rev()
                .find(|turn| turn.status == crate::agent::model::TurnStatus::InProgress)
                .map(|turn| turn.turn_id.clone())
        });
        Ok(ThreadReadResult {
            thread,
            active_turn_id,
        })
    }

    async fn thread_read_fenced(
        &self,
        _: &AppThreadId,
    ) -> Result<(ThreadReadResult, ProviderFence), ProviderError> {
        Err(unsupported())
    }

    async fn thread_list(&self, _: ThreadListParams) -> Result<ThreadListResult, ProviderError> {
        Err(unsupported())
    }

    async fn thread_turns(
        &self,
        params: ThreadTurnsParams,
    ) -> Result<ThreadTurnsResult, ProviderError> {
        let mut turns = locked(&self.turns)
            .get(params.app_thread_id.as_str())
            .cloned()
            .unwrap_or_default();
        if params.sort_direction == SortDirection::Desc {
            turns.reverse();
        }
        let offset = params
            .cursor
            .as_deref()
            .and_then(|cursor| cursor.parse::<usize>().ok())
            .unwrap_or(0);
        let end = offset
            .saturating_add(usize::try_from(params.limit).unwrap_or(usize::MAX))
            .min(turns.len());
        Ok(ThreadTurnsResult {
            next_cursor: (end < turns.len()).then(|| end.to_string()),
            turns: turns
                .get(offset..end)
                .map(<[_]>::to_vec)
                .unwrap_or_default(),
        })
    }

    async fn thread_turns_fenced(
        &self,
        _: ThreadTurnsParams,
    ) -> Result<(ThreadTurnsResult, ProviderFence), ProviderError> {
        Err(unsupported())
    }

    async fn thread_update(
        &self,
        params: ThreadUpdateParams,
    ) -> Result<ThreadUpdateResult, ProviderError> {
        let thread = self.thread(params.app_thread_id.as_str());
        locked(&self.updated).push(params);
        Ok(ThreadUpdateResult { thread })
    }

    async fn thread_owns(&self, id: &AppThreadId) -> Result<bool, ProviderError> {
        Ok(self.thread(id.as_str()).is_some())
    }

    async fn thread_compact(&self, _: &AppThreadId) -> Result<(), ProviderError> {
        Err(unsupported())
    }

    async fn turn_start(&self, params: TurnStartParams) -> Result<TurnStartResult, ProviderError> {
        if self.thread(params.app_thread_id.as_str()).is_none() {
            return Err(not_found(&params.app_thread_id));
        }
        locked(&self.started).push(params);
        if let Some(active) = locked(&self.busy).clone() {
            return Ok(TurnStartResult::Busy {
                active_turn_id: crate::agent::model::TurnId::parse(&active)
                    .unwrap_or_else(|| crate::agent::model::TurnId::from_static("x")),
            });
        }
        Ok(TurnStartResult::Started {
            turn_id: crate::agent::model::TurnId::parse(&self.next("turn"))
                .unwrap_or_else(|| crate::agent::model::TurnId::from_static("x")),
        })
    }

    async fn turn_steer(&self, params: TurnSteerParams) -> Result<TurnSteerResult, ProviderError> {
        let turn_id = params.expected_turn_id.clone();
        locked(&self.steered).push(params);
        Ok(TurnSteerResult { turn_id })
    }

    async fn turn_interrupt(&self, params: TurnInterruptParams) -> Result<(), ProviderError> {
        locked(&self.interrupted).push(params);
        Ok(())
    }

    async fn request_respond(&self, _: RequestRespondParams) -> Result<(), ProviderError> {
        Err(unsupported())
    }

    async fn capability_invoke(&self, _: CapabilityInvokeParams) -> Result<Value, ProviderError> {
        Err(unsupported())
    }
}
