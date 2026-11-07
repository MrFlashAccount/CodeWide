//! Cross-provider subagents driven by the model through native client-side
//! tools (`codewide_spawn_agent`, `codewide_wait_agent`,
//! `codewide_send_agent`, `codewide_cancel_agent`, `codewide_list_agents`).
//!
//! The service is the single owner of the tool semantics for every
//! provider: it is installed into each provider as its `ClientToolHost`,
//! and the provider translates the declaration and the calls to its own
//! channel (Codex `dynamicTools` / `item/tool/call`, Claude `clientTools` /
//! `tool.call`). A spawned agent is a new app thread on the chosen provider,
//! linked to the calling thread (`children`), started with the prompt only;
//! its status comes from the coordinator's live watch
//! and its permission profile never exceeds the caller's (`profiles`). Every
//! spawn, delegated task and queued follow-up is one child work request
//! (`work_requests`) whose settled result is pushed to the parent as a
//! hidden notice (`notifications`) unless a wait or cancel took it. See
//! `docs/agent-providers.md#agent-delegation-tools`.

pub mod admission;
mod agent_controls;
pub mod children;
mod coordinator;
mod delivery;
pub mod journal;
pub mod lineage;
mod notifications;
mod observer;
pub mod profiles;
mod runtime;
pub mod task;
pub mod tools;
pub mod work_requests;

#[cfg(test)]
mod tests;

/// Default host limit on agent nesting: a root thread is depth 0, its
/// children depth 1.
pub const DEFAULT_MAX_AGENT_DEPTH: usize = 5;

use std::sync::Arc;

use async_trait::async_trait;
use serde::Serialize;
use serde_json::{Value, json};
use tracing::{debug, error, info};

use self::{
    admission::AdmissionRejection,
    children::{ChildLinks, LinkError},
    coordinator::{CallIdentity, watch::ChildTracker},
    journal::{JournalError, TaskJournal},
    tools::ToolRequest,
};
use crate::{
    agent::{
        client_wire::gateway::ClientWireGateway,
        model::{
            AppThreadId, ClientToolSpec, ProviderId, ThreadStatus, ToolCallParams, ToolCallResult,
            TurnId,
        },
        permission_profiles::ProfileObservations,
        provider::{AgentProvider, ClientToolHost},
    },
    store::IndexStore,
    turn_delivery::TurnDelivery,
    workspaces::WorkspaceService,
};

/// A tool failure, shown to the model as an unsuccessful result.
#[derive(Debug)]
enum ToolError {
    Message(String),
    Admission(AdmissionRejection),
}

impl ToolError {
    fn message(message: impl Into<String>) -> Self {
        Self::Message(message.into())
    }

    const fn admission(rejection: AdmissionRejection) -> Self {
        Self::Admission(rejection)
    }

    fn render(self) -> String {
        match self {
            Self::Message(message) => message,
            Self::Admission(rejection) => serde_json::to_string(&rejection).unwrap_or_else(|_| {
                "{\"code\":\"provider_unavailable\",\"message\":\"admission failed\"}".into()
            }),
        }
    }
}

impl From<String> for ToolError {
    fn from(message: String) -> Self {
        Self::Message(message)
    }
}

impl From<&str> for ToolError {
    fn from(message: &str) -> Self {
        Self::Message(message.to_owned())
    }
}

impl From<JournalError> for ToolError {
    fn from(error: JournalError) -> Self {
        Self::Message(error.to_string())
    }
}

impl From<LinkError> for ToolError {
    fn from(error: LinkError) -> Self {
        Self::Message(error.to_string())
    }
}

/// The thread whose model called a tool, proven by the provider channel.
struct Caller {
    provider: Arc<dyn AgentProvider>,
    thread: AppThreadId,
    /// The calling turn; a wait ends with it (the provider abandons the call).
    turn: TurnId,
}

/// The orchestration tool service.
pub struct OrchestrationService {
    gateway: Arc<ClientWireGateway>,
    links: ChildLinks,
    tracker: Arc<ChildTracker>,
    task_journal: TaskJournal,
    turn_delivery: TurnDelivery,
    profiles: Arc<ProfileObservations>,
    /// Durable client-wire journal input (`thread/started` of threads created
    /// on providers without the native surface).
    journal: tokio::sync::mpsc::Sender<Value>,
    specs: Vec<ClientToolSpec>,
    /// Authenticated ended turns `(provider, thread, turn)`, so a wait tied
    /// to a calling turn cannot be stopped by another provider's payload.
    turn_ends: tokio::sync::broadcast::Sender<(ProviderId, String, String)>,
    task_signals: tokio::sync::broadcast::Sender<()>,
    workspaces: Arc<std::sync::RwLock<Option<Arc<WorkspaceService>>>>,
    recovery_gate: tokio::sync::Mutex<()>,
    task_drives: std::sync::Mutex<std::collections::HashMap<String, Arc<tokio::sync::Mutex<()>>>>,
    delegate_task_enabled: std::sync::atomic::AtomicBool,
    max_agent_depth: std::sync::atomic::AtomicUsize,
    delivery: Arc<notifications::DeliveryLoop>,
}

impl OrchestrationService {
    /// Opens the service over the companion index; every agent linked before
    /// is tracked from its next turn event.
    #[must_use]
    pub fn new(
        gateway: Arc<ClientWireGateway>,
        store: Arc<IndexStore>,
        journal: tokio::sync::mpsc::Sender<Value>,
        profiles: Arc<ProfileObservations>,
        outbox_wakeup: Arc<tokio::sync::Notify>,
        workspaces: Arc<std::sync::RwLock<Option<Arc<WorkspaceService>>>>,
    ) -> Arc<Self> {
        let service_store = store.clone();
        let turn_delivery = TurnDelivery::new(store, outbox_wakeup, journal.clone());
        Self::with_turn_delivery(
            gateway,
            &service_store,
            journal,
            profiles,
            turn_delivery,
            workspaces,
        )
    }

    #[must_use]
    pub(crate) fn with_turn_delivery(
        gateway: Arc<ClientWireGateway>,
        store: &Arc<IndexStore>,
        journal: tokio::sync::mpsc::Sender<Value>,
        profiles: Arc<ProfileObservations>,
        turn_delivery: TurnDelivery,
        workspaces: Arc<std::sync::RwLock<Option<Arc<WorkspaceService>>>>,
    ) -> Arc<Self> {
        let links = ChildLinks::new(store.clone());
        let known = links.child_owners().unwrap_or_else(|err| {
            error!(err = ?err, "subagent links are unreadable; earlier agents are tracked on demand");
            Vec::new()
        });
        let task_journal = TaskJournal::new(store.clone());
        match TaskJournal::backfill_v1(store, crate::turn_delivery::open_commands_in_write) {
            Ok(report) if !report.skipped => info!(
                tasks = report.tasks,
                followups = report.followups,
                "work_requests_backfill_v1 migrated legacy deliveries"
            ),
            Ok(_) => {}
            Err(err) => {
                error!(err = ?err, "work_requests_backfill_v1 failed; it retries on the next start");
            }
        }
        let tracker = Arc::new(ChildTracker::with_known(known));
        let delivery = Arc::new(notifications::DeliveryLoop::default());
        turn_delivery.install_receipt_observer(Arc::new(notifications::ReceiptBinder {
            delivery: delivery.clone(),
            tracker: tracker.clone(),
        }));
        let service = Arc::new(Self {
            gateway,
            links,
            tracker,
            task_journal,
            turn_delivery,
            profiles,
            journal,
            specs: tools::specs(),
            turn_ends: tokio::sync::broadcast::channel(256).0,
            task_signals: tokio::sync::broadcast::channel(256).0,
            workspaces,
            recovery_gate: tokio::sync::Mutex::new(()),
            task_drives: std::sync::Mutex::new(std::collections::HashMap::new()),
            delegate_task_enabled: std::sync::atomic::AtomicBool::new(true),
            max_agent_depth: std::sync::atomic::AtomicUsize::new(DEFAULT_MAX_AGENT_DEPTH),
            delivery,
        });
        service.start_recovery();
        service.start_delivery_loop();
        service
    }

    /// Host limit on agent nesting for new `spawn_agent` and
    /// `delegate_task` admission. Existing agents are unaffected.
    pub(crate) fn set_max_agent_depth(&self, depth: usize) {
        self.max_agent_depth
            .store(depth, std::sync::atomic::Ordering::Release);
    }

    /// Host rollout gate for new task-addressed delegation admission. The
    /// agent controls and recovery tools remain available while closed.
    pub(crate) fn set_delegate_task_enabled(&self, enabled: bool) {
        self.delegate_task_enabled
            .store(enabled, std::sync::atomic::Ordering::Release);
    }

    /// Reconciles durable non-terminal tasks after startup or after a late
    /// workspace-service installation. Concurrent triggers are serialized.
    pub(crate) fn start_recovery(self: &Arc<Self>) {
        let service = self.clone();
        tokio::spawn(async move {
            let _guard = service.recovery_gate.lock().await;
            let tasks = match service.task_journal.pending().await {
                Ok(tasks) => tasks,
                Err(error) => {
                    error!(err = ?error, "durable orchestration recovery scan failed");
                    return;
                }
            };
            for task_id in tasks {
                if let Err(error) = service.drive_task(&task_id).await {
                    error!(err = ?error, task_id = %task_id.as_str(), "durable orchestration task recovery failed");
                }
            }
        });
    }

    /// `companion/threadSubagents/read` rows of the agents a thread spawned
    /// (with their own agents), in the indexed-subagent shape the client
    /// reads (`IndexedThreadMetadata`). Each row carries `running` from the
    /// agent's current turn state, so an explicit idle clears a stale active
    /// row on the device; it is omitted only when that state is unknown.
    ///
    /// # Errors
    /// Returns the store failure.
    pub async fn subagent_rows(&self, root: &str) -> Result<Vec<Value>, LinkError> {
        let links = self.links.descendants(root).await?;
        let running =
            futures_util::future::join_all(links.iter().map(|link| self.child_running(link))).await;
        Ok(links
            .iter()
            .zip(running)
            .map(|(link, running)| {
                let model_provider = self.gateway.registry().get(&link.provider).map_or_else(
                    || link.provider.as_str().to_owned(),
                    |provider| provider.descriptor().model_provider,
                );
                let mut row = json!({
                    "id": link.child_thread_id,
                    "parentThreadId": link.parent_thread_id,
                    "cwd": link.cwd,
                    "createdAt": link.created_at,
                    "updatedAt": link.created_at,
                    "modelProvider": model_provider,
                    "cliVersion": "",
                    "source": lineage::subagent_source(link),
                    "agentNickname": link.name,
                    "agentRole": null,
                    "archived": false,
                });
                if let Some(task_id) = &link.task_id {
                    row["taskId"] = Value::String(task_id.clone());
                }
                if let Some(running) = running {
                    row["running"] = Value::Bool(running);
                }
                row
            })
            .collect())
    }

    /// Whether a linked agent runs a turn now: the tracked turn state, else
    /// its provider's current thread status. `None` when neither is readable.
    async fn child_running(&self, link: &children::ChildLink) -> Option<bool> {
        if let Some(state) = self.tracker.state(&link.child_thread_id) {
            return Some(state.is_running());
        }
        let child = AppThreadId::parse(&link.child_thread_id)?;
        let provider = self.gateway.registry().get(&link.provider)?;
        match provider.thread_read(&child).await {
            Ok(read) => Some(read.thread.status == ThreadStatus::Active),
            Err(error) => {
                debug!(err = ?error, child_thread_id = %child, "agent status is unreadable for its subagent row");
                None
            }
        }
    }

    async fn dispatch(
        &self,
        provider: &ProviderId,
        call: ToolCallParams,
    ) -> Result<Value, ToolError> {
        let request = tools::parse(&call.tool, &call.arguments)?;
        if matches!(&request, ToolRequest::Delegate(_))
            && !self
                .delegate_task_enabled
                .load(std::sync::atomic::Ordering::Acquire)
        {
            return Err(ToolError::admission(AdmissionRejection::new(
                admission::RejectionCode::CapabilityUnavailable,
                "durable task delegation is disabled on this host",
            )));
        }
        let identity = CallIdentity {
            provider: provider.clone(),
            thread: call.app_thread_id.clone(),
            turn: call.turn_id.clone(),
            call_id: call.call_id.clone(),
            tool: call.tool.clone(),
        };
        let caller = self
            .caller(provider, call.app_thread_id, call.turn_id)
            .await?;
        match request {
            ToolRequest::Delegate(request) => {
                to_json(&self.delegate(&caller, identity, request).await?)
            }
            ToolRequest::WaitTask(request) => to_json(&self.wait_task(&caller, request).await?),
            ToolRequest::CancelTask(task_id) => {
                to_json(&self.cancel_task(&caller, &task_id).await?)
            }
            ToolRequest::Spawn(request) => {
                to_json(&self.spawn_durable(&caller, identity, request).await?)
            }
            ToolRequest::Wait(request) => to_json(&self.wait(&caller, request).await?),
            ToolRequest::Send(request) => to_json(&self.send(&caller, request, &identity).await?),
            ToolRequest::Cancel(child) => to_json(&self.cancel(&caller, &child).await?),
            ToolRequest::List => to_json(&self.list(&caller).await?),
        }
    }

    /// The calling thread, which must be bound to the provider whose
    /// channel carried the call.
    async fn caller(
        &self,
        provider: &ProviderId,
        thread: AppThreadId,
        turn: TurnId,
    ) -> Result<Caller, ToolError> {
        let bound = self
            .gateway
            .bindings()
            .provider_of(&thread)
            .await
            .map_err(|err| {
                error!(err = ?err, app_thread_id = %thread, "calling thread binding is unreadable");
                "the calling thread's binding is unavailable".to_owned()
            })?;
        if bound.as_ref() != Some(provider) {
            return Err(format!("thread {thread} is not a thread of this agent").into());
        }
        let provider = self
            .gateway
            .registry()
            .get(provider)
            .cloned()
            .ok_or_else(|| format!("{provider} provider is disabled on this host"))?;
        Ok(Caller {
            provider,
            thread,
            turn,
        })
    }
}
#[async_trait]
impl ClientToolHost for OrchestrationService {
    fn specs(&self) -> &[ClientToolSpec] {
        &self.specs
    }

    async fn call(&self, provider: &ProviderId, call: ToolCallParams) -> ToolCallResult {
        let tool = call.tool.clone();
        match self.dispatch(provider, call).await {
            Ok(result) => ToolCallResult::text(result.to_string()),
            Err(error) => {
                info!(tool = %tool, provider = %provider, "orchestration tool call failed");
                ToolCallResult::failure(error.render())
            }
        }
    }
}

fn to_json<T: Serialize>(value: &T) -> Result<Value, ToolError> {
    serde_json::to_value(value)
        .map_err(|err| ToolError::message(format!("result encoding failed: {err}")))
}
