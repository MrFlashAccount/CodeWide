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
//! its status comes from its turn lifecycle on the client wire (`tracker`)
//! and its permission profile never exceeds the caller's (`profiles`). See
//! `docs/agent-providers.md#orchestration-tools`.

pub mod children;
pub mod profiles;
pub mod tools;
pub mod tracker;

#[cfg(test)]
mod tests;

use std::sync::Arc;

use async_trait::async_trait;
use serde::Serialize;
use serde_json::{Value, json};
use tracing::{error, info, warn};

use self::{
    children::{ChildLink, ChildLinks, LinkError},
    profiles::ProfileObservations,
    tools::{
        AgentStatus, CancelResult, ListResult, ListedAgent, SendMode, SendRequest, SendResult,
        SendStatus, SpawnRequest, SpawnResult, ToolRequest, WaitRequest, WaitResult,
    },
    tracker::{ChildState, ChildTracker, Delivery},
};
use crate::{
    agent::{
        client_wire::{
            gateway::{ClientWireGateway, default_model},
            observe::{TurnEnd, TurnFact, turn_fact},
        },
        model::{
            AgentItem, AppThreadId, ClientToolSpec, ItemsView, MessagePhase, ProviderId,
            SortDirection, ThreadChange, ThreadSettings, ThreadStatus, ThreadTurnsParams,
            ThreadUpdateParams, ToolCallParams, ToolCallResult, TurnId, TurnInterruptParams,
            TurnStartParams, TurnStartResult, TurnStatus, TurnSteerParams, UserContent,
        },
        provider::{AgentProvider, ClientToolHost},
    },
    store::IndexStore,
};

/// A tool failure, shown to the model as an unsuccessful result.
type ToolError = String;

/// Where and how a spawned agent runs.
struct SpawnPlan {
    target: Arc<dyn AgentProvider>,
    wire: crate::agent::client_wire::WireProvider,
    cwd: String,
    settings: ThreadSettings,
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
    profiles: ProfileObservations,
    /// Durable client-wire journal input (`thread/started` of threads created
    /// on providers without the native surface).
    journal: tokio::sync::mpsc::Sender<Value>,
    specs: Vec<ClientToolSpec>,
    /// Ended turns `(thread, turn)` of every thread, so a wait tied to a
    /// calling turn stops when that turn ends.
    turn_ends: tokio::sync::broadcast::Sender<(String, String)>,
}

impl OrchestrationService {
    /// Opens the service over the companion index; every agent linked before
    /// is tracked from its next turn event.
    #[must_use]
    pub fn new(
        gateway: Arc<ClientWireGateway>,
        store: Arc<IndexStore>,
        journal: tokio::sync::mpsc::Sender<Value>,
    ) -> Arc<Self> {
        let links = ChildLinks::new(store);
        let known = links.child_ids().unwrap_or_else(|err| {
            error!(err = ?err, "subagent links are unreadable; earlier agents are tracked on demand");
            Vec::new()
        });
        Arc::new(Self {
            gateway,
            links,
            tracker: ChildTracker::with_known(known),
            profiles: ProfileObservations::default(),
            journal,
            specs: tools::specs(),
            turn_ends: tokio::sync::broadcast::channel(256).0,
        })
    }

    /// Observes one client-wire payload of any provider: agents' turn
    /// lifecycle and threads' effective permission profiles. A turn end
    /// delivers the agent's next queued message.
    pub fn observe_event(self: &Arc<Self>, payload: &Value) {
        self.profiles.observe_event(payload);
        if let Some(TurnFact::Ended {
            thread_id, turn_id, ..
        }) = turn_fact(payload)
            && self.turn_ends.receiver_count() > 0
        {
            let _ = self
                .turn_ends
                .send((thread_id.to_owned(), turn_id.to_owned()));
        }
        if let Some(delivery) = self.tracker.observe(payload) {
            let service = self.clone();
            tokio::spawn(async move { service.deliver(delivery).await });
        }
    }

    /// Observes an RPC result (effective permission profiles).
    pub fn observe_rpc_result(&self, method: &str, result: &Value) {
        self.profiles.observe_rpc_result(method, result);
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
                json!({
                    "id": link.child_thread_id,
                    "parentThreadId": link.parent_thread_id,
                    "cwd": link.cwd,
                    "createdAt": link.created_at,
                    "updatedAt": link.created_at,
                    "modelProvider": model_provider,
                    "cliVersion": "",
                    "source": {"subagent": {"thread_spawn": {
                        "parent_thread_id": link.parent_thread_id,
                        "depth": 1,
                        "agent_path": null,
                        "agent_nickname": link.name,
                        "agent_role": null,
                    }}},
                    "agentNickname": link.name,
                    "agentRole": null,
                    "archived": false,
                })
            })
            .collect())
    }

    async fn dispatch(
        &self,
        provider: &ProviderId,
        call: ToolCallParams,
    ) -> Result<Value, ToolError> {
        let request = tools::parse(&call.tool, &call.arguments)?;
        let caller = self
            .caller(provider, call.app_thread_id, call.turn_id)
            .await?;
        match request {
            ToolRequest::Spawn(request) => to_json(&self.spawn(&caller, request).await?),
            ToolRequest::Wait(request) => to_json(&self.wait(&caller, request).await?),
            ToolRequest::Send(request) => to_json(&self.send(&caller, request).await?),
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
            return Err(format!("thread {thread} is not a thread of this agent"));
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

    /// The provider of one of the caller's agents.
    async fn child_provider(
        &self,
        caller: &Caller,
        child: &AppThreadId,
    ) -> Result<Arc<dyn AgentProvider>, ToolError> {
        let parent = self.links.parent_of(child.as_str()).await.map_err(|err| {
            error!(err = ?err, app_thread_id = %child, "subagent link is unreadable");
            "the agent's link is unavailable".to_owned()
        })?;
        if parent.as_deref() != Some(caller.thread.as_str()) {
            return Err(format!("agent not found: {child}"));
        }
        let provider = self
            .gateway
            .bindings()
            .provider_of(child)
            .await
            .map_err(|err| {
                error!(err = ?err, app_thread_id = %child, "agent binding is unreadable");
                "the agent's binding is unavailable".to_owned()
            })?
            .ok_or_else(|| format!("agent not found: {child}"))?;
        self.gateway
            .registry()
            .get(&provider)
            .cloned()
            .ok_or_else(|| format!("{provider} provider is disabled on this host"))
    }

    /// Resolves where and how an agent runs: its provider, model, working
    /// directory and a permission profile no higher than the caller's.
    async fn plan_spawn(
        &self,
        caller: &Caller,
        request: &SpawnRequest,
    ) -> Result<SpawnPlan, ToolError> {
        let parent = caller
            .provider
            .thread_read(&caller.thread)
            .await
            .map_err(|err| format!("cannot read the calling thread: {err}"))?
            .thread;
        let target = match &request.provider {
            Some(id) => self
                .gateway
                .registry()
                .get(id)
                .cloned()
                .ok_or_else(|| format!("unknown or disabled agent provider: {id}"))?,
            None => caller.provider.clone(),
        };
        let wire = self.gateway.wire(&target);
        let same_provider = wire.descriptor.id == caller.provider.descriptor().id;
        let model = match &request.model {
            Some(model) => model.clone(),
            None if same_provider && !parent.settings.model.is_empty() => {
                parent.settings.model.clone()
            }
            None => default_model(&target)
                .await
                .map_err(|failure| format!("no default model: {}", failure.message))?,
        };
        let cwd = request.cwd.clone().unwrap_or_else(|| parent.cwd.clone());
        if cwd.is_empty() {
            return Err("the calling thread has no working directory; pass cwd".into());
        }
        let parent_profile = Some(parent.settings.permission_profile)
            .filter(|profile| !profile.is_empty())
            .or_else(|| self.profiles.get(caller.thread.as_str()));
        let permission_profile = profiles::child_profile(
            parent_profile.as_deref(),
            request.permission_profile.as_deref(),
        )?;
        Ok(SpawnPlan {
            target,
            wire,
            cwd,
            settings: ThreadSettings {
                model,
                effort: None,
                permission_profile,
                service_tier: None,
            },
        })
    }

    async fn spawn(
        &self,
        caller: &Caller,
        request: SpawnRequest,
    ) -> Result<SpawnResult, ToolError> {
        let SpawnPlan {
            target,
            wire,
            cwd,
            settings,
        } = self.plan_spawn(caller, &request).await?;
        let model = settings.model.clone();
        let thread = self
            .gateway
            .create_thread(&target, &wire, cwd.clone(), settings)
            .await
            .map_err(|failure| format!("cannot create the agent's thread: {}", failure.message))?;
        let child = thread.app_thread_id.clone();
        if target.native_surface().is_none() {
            // A native provider announces its own thread; a neutral one is
            // announced here, as for a client `thread/start`.
            let (_, started) = ClientWireGateway::started_thread(&thread, &wire);
            if self.journal.send(started).await.is_err() {
                warn!("journal closed before an agent thread was announced");
            }
        }
        let link = ChildLink::new(
            caller.thread.as_str().to_owned(),
            child.as_str().to_owned(),
            wire.descriptor.id.clone(),
            model.clone(),
            request.name.clone(),
            cwd,
        );
        self.links.link(&link).await.map_err(|err| {
            error!(err = ?err, app_thread_id = %child, "subagent link was not written");
            format!("agent thread {child} was created but could not be linked to this thread")
        })?;
        self.tracker
            .register(child.as_str(), ChildState::Running { turn_id: None });
        if let Some(name) = request.name
            && let Err(err) = target
                .thread_update(ThreadUpdateParams {
                    app_thread_id: child.clone(),
                    change: ThreadChange::Name { name: Some(name) },
                })
                .await
        {
            warn!(err = %err, app_thread_id = %child, "agent thread name was not set");
        }
        info!(
            parent_thread_id = %caller.thread,
            app_thread_id = %child,
            provider = %wire.descriptor.id,
            "agent spawned"
        );
        if let Err(message) = self.start_turn(&target, &child, request.prompt).await {
            return Err(format!(
                "agent {child} was created but its first turn did not start: {message}"
            ));
        }
        Ok(SpawnResult {
            agent_thread_id: child.into_string(),
            provider: wire.descriptor.id.into_string(),
            model,
            status: AgentStatus::Running,
        })
    }

    /// Starts a turn with one text message. A busy provider keeps the
    /// message queued for after its running turn; a rejected start settles
    /// the agent as failed.
    async fn start_turn(
        &self,
        provider: &Arc<dyn AgentProvider>,
        child: &AppThreadId,
        message: String,
    ) -> Result<SendStatus, String> {
        if let Some(state) = self.tracker.state(child.as_str())
            && !state.is_running()
        {
            self.tracker
                .register(child.as_str(), ChildState::Running { turn_id: None });
        }
        let started = provider
            .turn_start(TurnStartParams {
                app_thread_id: child.clone(),
                client_message_id: None,
                input: vec![UserContent::Text {
                    text: message.clone(),
                }],
                client_tools: None,
            })
            .await
            .map_err(|err| {
                self.tracker.failed_to_start(child.as_str());
                err.to_string()
            })?;
        match started {
            TurnStartResult::Started { turn_id } => {
                self.tracker.started(child.as_str(), turn_id.as_str());
                Ok(SendStatus::Running)
            }
            TurnStartResult::Busy { active_turn_id } => {
                self.tracker
                    .started(child.as_str(), active_turn_id.as_str());
                self.tracker.requeue_front(child.as_str(), message);
                Ok(SendStatus::Queued)
            }
        }
    }

    /// Delivers a queued message after an agent's turn ended.
    async fn deliver(&self, delivery: Delivery) {
        let Some(child) = AppThreadId::parse(&delivery.child) else {
            return;
        };
        let provider = match self.gateway.bindings().provider_of(&child).await {
            Ok(Some(provider)) => self.gateway.registry().get(&provider).cloned(),
            Ok(None) => None,
            Err(err) => {
                error!(err = ?err, app_thread_id = %child, "agent binding is unreadable; queued message kept");
                self.tracker.requeue_front(child.as_str(), delivery.message);
                return;
            }
        };
        let Some(provider) = provider else {
            warn!(app_thread_id = %child, "agent provider is unavailable; queued message dropped");
            return;
        };
        if let Err(message) = self.start_turn(&provider, &child, delivery.message).await {
            warn!(app_thread_id = %child, error = %message, "queued agent message was not delivered");
        }
    }

    /// The tracked state of an agent, read from its provider when the
    /// tracker has not seen it since the companion started.
    async fn ensure_tracked(
        &self,
        provider: &Arc<dyn AgentProvider>,
        child: &AppThreadId,
    ) -> Result<ChildState, ToolError> {
        if let Some(state) = self.tracker.state(child.as_str()) {
            return Ok(state);
        }
        let read = provider
            .thread_read(child)
            .await
            .map_err(|err| format!("cannot read agent {child}: {err}"))?;
        let state = if read.thread.status == ThreadStatus::Active {
            ChildState::Running {
                turn_id: read.active_turn_id.map(TurnId::into_string),
            }
        } else {
            last_turn_state(provider, child).await?
        };
        self.tracker.register_if_absent(child.as_str(), state);
        self.tracker
            .state(child.as_str())
            .ok_or_else(|| format!("agent not found: {child}"))
    }

    async fn wait(&self, caller: &Caller, request: WaitRequest) -> Result<WaitResult, ToolError> {
        let provider = self.child_provider(caller, &request.child).await?;
        self.ensure_tracked(&provider, &request.child).await?;
        let mut receiver = self
            .tracker
            .subscribe(request.child.as_str())
            .ok_or_else(|| format!("agent not found: {}", request.child))?;
        let mut turn_ends = self.turn_ends.subscribe();
        let caller_turn = (caller.thread.as_str(), caller.turn.as_str());
        let caller_ended = async {
            loop {
                match turn_ends.recv().await {
                    Ok((thread, turn)) if (thread.as_str(), turn.as_str()) == caller_turn => {
                        return;
                    }
                    Ok(_) | Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {}
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => {
                        std::future::pending::<()>().await;
                    }
                }
            }
        };
        let settled = tokio::select! {
            settled = tokio::time::timeout(
                request.timeout,
                receiver.wait_for(|state| !state.is_running()),
            ) => settled.ok().and_then(Result::ok).map(|state| state.clone()),
            // The calling turn ended: the provider no longer waits for this
            // answer, so the wait is abandoned.
            () = caller_ended => None,
        };
        // A timeout, an ended calling turn or a closed channel reports the
        // current state.
        let state = settled.unwrap_or_else(|| receiver.borrow().clone());
        Ok(wait_result(state))
    }

    async fn send(&self, caller: &Caller, request: SendRequest) -> Result<SendResult, ToolError> {
        let provider = self.child_provider(caller, &request.child).await?;
        let state = self.ensure_tracked(&provider, &request.child).await?;
        let status = match (state, request.mode) {
            (ChildState::Running { .. }, SendMode::Queue) => {
                self.tracker
                    .enqueue(request.child.as_str(), request.message);
                SendStatus::Queued
            }
            (ChildState::Running { turn_id }, SendMode::Steer) => {
                let turn_id = match turn_id {
                    Some(turn_id) => Some(turn_id),
                    None => active_turn(&provider, &request.child).await?,
                };
                let turn_id = turn_id
                    .and_then(|turn_id| TurnId::parse(&turn_id))
                    .ok_or_else(|| {
                        "the agent's running turn is not known yet; send with mode \"queue\""
                            .to_owned()
                    })?;
                provider
                    .turn_steer(TurnSteerParams {
                        app_thread_id: request.child.clone(),
                        expected_turn_id: turn_id,
                        client_message_id: None,
                        input: vec![UserContent::Text {
                            text: request.message,
                        }],
                    })
                    .await
                    .map_err(|err| format!("steer was not accepted: {err}"))?;
                SendStatus::Running
            }
            (ChildState::Settled { .. }, _) => self
                .start_turn(&provider, &request.child, request.message)
                .await
                .map_err(|message| format!("the agent's turn did not start: {message}"))?,
        };
        Ok(SendResult { status })
    }

    async fn cancel(
        &self,
        caller: &Caller,
        child: &AppThreadId,
    ) -> Result<CancelResult, ToolError> {
        let provider = self.child_provider(caller, child).await?;
        let state = self.ensure_tracked(&provider, child).await?;
        self.tracker.clear_queue(child.as_str());
        let ChildState::Running { turn_id } = state else {
            return Ok(CancelResult {
                status: state.status(),
            });
        };
        let turn_id = match turn_id {
            Some(turn_id) => Some(turn_id),
            None => active_turn(&provider, child).await?,
        };
        provider
            .turn_interrupt(TurnInterruptParams {
                app_thread_id: child.clone(),
                turn_id: turn_id.and_then(|turn_id| TurnId::parse(&turn_id)),
            })
            .await
            .map_err(|err| format!("interrupt was not accepted: {err}"))?;
        Ok(CancelResult {
            status: AgentStatus::Interrupted,
        })
    }

    async fn list(&self, caller: &Caller) -> Result<ListResult, ToolError> {
        let links = self
            .links
            .children(caller.thread.as_str())
            .await
            .map_err(|err| {
                error!(err = ?err, app_thread_id = %caller.thread, "subagent links are unreadable");
                "this thread's agents are unavailable".to_owned()
            })?;
        let mut agents = Vec::with_capacity(links.len());
        for link in links {
            let status = match (
                AppThreadId::parse(&link.child_thread_id),
                self.gateway.registry().get(&link.provider),
            ) {
                (Some(child), Some(provider)) => self
                    .ensure_tracked(provider, &child)
                    .await
                    .ok()
                    .map(|state| state.status()),
                _ => None,
            };
            agents.push(ListedAgent {
                agent_thread_id: link.child_thread_id,
                provider: link.provider.into_string(),
                model: link.model,
                name: link.name,
                status,
            });
        }
        Ok(ListResult { agents })
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
            Err(message) => {
                info!(tool = %tool, provider = %provider, "orchestration tool call failed");
                ToolCallResult::failure(message)
            }
        }
    }
}

fn to_json<T: Serialize>(value: &T) -> Result<Value, ToolError> {
    serde_json::to_value(value).map_err(|err| format!("result encoding failed: {err}"))
}

fn wait_result(state: ChildState) -> WaitResult {
    let status = state.status();
    match state {
        ChildState::Running { turn_id } => WaitResult {
            status,
            final_message: None,
            turn_id,
        },
        ChildState::Settled {
            turn_id,
            final_message,
            ..
        } => WaitResult {
            status,
            final_message,
            turn_id,
        },
    }
}

/// The running turn of an agent whose tracker does not know its id.
async fn active_turn(
    provider: &Arc<dyn AgentProvider>,
    child: &AppThreadId,
) -> Result<Option<String>, ToolError> {
    let read = provider
        .thread_read(child)
        .await
        .map_err(|err| format!("cannot read agent {child}: {err}"))?;
    if let Some(turn_id) = read.active_turn_id {
        return Ok(Some(turn_id.into_string()));
    }
    let turns = provider
        .thread_turns(ThreadTurnsParams {
            app_thread_id: child.clone(),
            cursor: None,
            limit: 1,
            sort_direction: SortDirection::Desc,
            items_view: ItemsView::NotLoaded,
        })
        .await
        .map_err(|err| format!("cannot read agent {child}: {err}"))?;
    Ok(turns
        .turns
        .into_iter()
        .find(|turn| turn.status == TurnStatus::InProgress)
        .map(|turn| turn.turn_id.into_string()))
}

/// The state of an idle agent from its last stored turn.
async fn last_turn_state(
    provider: &Arc<dyn AgentProvider>,
    child: &AppThreadId,
) -> Result<ChildState, ToolError> {
    let turns = provider
        .thread_turns(ThreadTurnsParams {
            app_thread_id: child.clone(),
            cursor: None,
            limit: 1,
            sort_direction: SortDirection::Desc,
            items_view: ItemsView::Full,
        })
        .await
        .map_err(|err| format!("cannot read agent {child}: {err}"))?;
    let Some(turn) = turns.turns.into_iter().next() else {
        return Ok(ChildState::Settled {
            end: TurnEnd::Completed,
            turn_id: None,
            final_message: None,
        });
    };
    let end = match turn.status {
        TurnStatus::InProgress => {
            return Ok(ChildState::Running {
                turn_id: Some(turn.turn_id.into_string()),
            });
        }
        TurnStatus::Completed => TurnEnd::Completed,
        TurnStatus::Interrupted => TurnEnd::Interrupted,
        TurnStatus::Failed => TurnEnd::Failed,
    };
    let messages = turn.items.iter().filter_map(|item| match item {
        AgentItem::AgentMessage { text, phase, .. } => Some((text, *phase)),
        _ => None,
    });
    let mut final_answer = None;
    let mut last = None;
    for (text, phase) in messages {
        match phase {
            MessagePhase::Final => final_answer = Some(text.clone()),
            MessagePhase::Commentary => last = Some(text.clone()),
        }
    }
    Ok(ChildState::Settled {
        end,
        turn_id: Some(turn.turn_id.into_string()),
        final_message: final_answer
            .or(last)
            .or_else(|| turn.error.map(|error| error.message)),
    })
}
