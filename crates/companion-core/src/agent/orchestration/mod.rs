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
//! its status comes from the coordinator's compatibility live watch
//! and its permission profile never exceeds the caller's (`profiles`). See
//! `docs/agent-providers.md#orchestration-tools`.

pub mod admission;
pub mod children;
mod compatibility;
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

#[cfg(test)]
mod tests;

use std::sync::Arc;

use async_trait::async_trait;
use serde::Serialize;
use serde_json::{Value, json};
use tracing::{error, info};

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
        model::{AppThreadId, ClientToolSpec, ProviderId, ToolCallParams, ToolCallResult, TurnId},
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
    tracker: ChildTracker,
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
        let service = Arc::new(Self {
            gateway,
            links,
            tracker: ChildTracker::with_known(known),
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
        });
        service.start_recovery();
        service.start_completion_delivery();
        service
    }

    /// Host rollout gate for new task-addressed delegation admission. The
    /// compatibility tools and recovery tools remain available while closed.
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
    /// reads (`IndexedThreadMetadata`).
    ///
    /// # Errors
    /// Returns the store failure.
    pub async fn subagent_rows(&self, root: &str) -> Result<Vec<Value>, LinkError> {
        let links = self.links.descendants(root).await?;
        Ok(links
            .iter()
            .map(|link| {
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
                row
            })
            .collect())
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
