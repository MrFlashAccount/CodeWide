//! In-memory provider for unit tests of the provider layer. It records the
//! neutral calls it receives and answers from configured state.

use std::sync::{Arc, Mutex};

use async_trait::async_trait;
use serde_json::Value;
use tokio::sync::{mpsc, watch};

use super::{
    model::{
        AgentThread, AppThreadId, CapabilityInvokeParams, CapabilitySet, ModelCatalog,
        PermissionProfileCatalog, ProviderDescriptor, ProviderId, RequestRespondParams, RpcError,
        SortDirection, ThreadCreateParams, ThreadListParams, ThreadListResult, ThreadOrigin,
        ThreadReadResult, ThreadSettings, ThreadSortKey, ThreadStatus, ThreadTurnsParams,
        ThreadTurnsResult, ThreadUpdateParams, ThreadUpdateResult, TurnInterruptParams,
        TurnStartParams, TurnStartResult, TurnSteerParams, TurnSteerResult,
    },
    provider::{AgentProvider, ProviderError, ProviderEvent, ProviderFence, ProviderStatus},
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
}

impl FakeProvider {
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
            threads: Vec::new(),
            owned: Vec::new(),
            calls: Mutex::new(Vec::new()),
            list_params: Mutex::new(Vec::new()),
            status,
        }
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
