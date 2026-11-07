//! Stable thread-addressed controls for cross-provider agents.
//!
//! These five tools intentionally use agent/current-turn semantics. Durable
//! task reads, acknowledgements and cancellation stay in the separate
//! task-addressed owner.

use std::{sync::Arc, time::Duration};

use tracing::error;

use super::{
    Caller, OrchestrationService, ToolError,
    coordinator::{CallIdentity, watch::ChildState},
    journal::{JournalError, TaskJournal},
    tools::{
        AgentStatus, CancelResult, ListResult, ListedAgent, SendMode, SendRequest, SendResult,
        SendStatus, WaitRequest, WaitResult,
    },
    work_requests::{
        AckSource, ChildWorkRequest, RequestOrigin, RequestPhase, RunOutcome, Settlement,
        WorkRequestId,
    },
};
use crate::agent::{
    client_wire::observe::TurnEnd,
    model::{
        AgentItem, AppThreadId, ItemsView, MessagePhase, SortDirection, ThreadStatus,
        ThreadTurnsParams, TurnId, TurnInterruptParams, TurnStatus, TurnSteerParams, UserContent,
    },
    provider::AgentProvider,
};
use crate::{store::StoreError, turn_delivery::retract_notice_in_write};

/// How long a cancellation waits for the provider to confirm an interrupt.
/// Tests shorten it because the dependencies carry no virtual-time clock.
#[cfg(not(test))]
pub(super) const INTERRUPT_TIMEOUT: Duration = Duration::from_secs(30);
#[cfg(test)]
pub(super) const INTERRUPT_TIMEOUT: Duration = Duration::from_millis(200);

/// How long a parent cancel call (from its start) waits to take the
/// cancelled result itself instead of letting it be pushed. Production uses
/// the interrupt timeout; tests widen it so a loaded test host still sees an
/// in-time end deterministically.
#[cfg(not(test))]
pub(super) const CANCEL_ACK_WINDOW: Duration = INTERRUPT_TIMEOUT;
#[cfg(test)]
pub(super) const CANCEL_ACK_WINDOW: Duration = Duration::from_secs(1);

impl OrchestrationService {
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
            return Err(format!("agent not found: {child}").into());
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
        Ok(self
            .gateway
            .registry()
            .get(&provider)
            .cloned()
            .ok_or_else(|| format!("{provider} provider is disabled on this host"))?)
    }

    /// The tracked state of an agent, read from its provider when the
    /// tracker has not seen it since the companion started.
    async fn ensure_tracked(
        &self,
        provider: &Arc<dyn AgentProvider>,
        child: &AppThreadId,
    ) -> Result<ChildState, ToolError> {
        if let Some(command) = self
            .turn_delivery
            .latest_for_thread(child.as_str())
            .await
            .map_err(|error| ToolError::message(error.to_string()))?
        {
            let command = if command.state == crate::store::OutboxState::Queued {
                self.turn_delivery
                    .first_receipt(&command.command_id)
                    .await
                    .map_err(|error| ToolError::message(error.to_string()))?
                    .unwrap_or(command)
            } else {
                command
            };
            if let Some(turn_id) = command.delivered_turn_id
                && self
                    .tracker
                    .state(child.as_str())
                    .is_some_and(|state| state.is_running())
            {
                self.tracker.started(child.as_str(), &turn_id);
            }
        }
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
        self.tracker
            .authorize(child.as_str(), provider.descriptor().id);
        self.tracker.register_if_absent(child.as_str(), state);
        Ok(self
            .tracker
            .state(child.as_str())
            .ok_or_else(|| format!("agent not found: {child}"))?)
    }

    pub(super) async fn wait(
        &self,
        caller: &Caller,
        request: WaitRequest,
    ) -> Result<WaitResult, ToolError> {
        let provider = self.child_provider(caller, &request.child).await?;
        self.ensure_tracked(&provider, &request.child).await?;
        let mut receiver = self
            .tracker
            .subscribe(request.child.as_str())
            .ok_or_else(|| format!("agent not found: {}", request.child))?;
        let mut turn_ends = self.turn_ends.subscribe();
        let caller_turn = (
            caller.provider.descriptor().id,
            caller.thread.as_str(),
            caller.turn.as_str(),
        );
        let caller_ended = async {
            loop {
                match turn_ends.recv().await {
                    Ok((provider, thread, turn))
                        if provider == caller_turn.0
                            && (thread.as_str(), turn.as_str())
                                == (caller_turn.1, caller_turn.2) =>
                    {
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
        // A terminal result returned here is the parent's: it is not pushed
        // again, and a notice still queued for it is retracted.
        if let ChildState::Settled {
            end,
            turn_id: Some(turn_id),
            ..
        } = &state
            && let Some(turn_id) = TurnId::parse(turn_id)
            && let Err(error) = self
                .task_journal
                .acknowledge_turn(
                    &provider.descriptor().id,
                    &caller.thread,
                    &request.child,
                    &turn_id,
                    *end,
                    retract_notice_in_write,
                )
                .await
        {
            error!(err = ?error, app_thread_id = %request.child, "a waited child result could not be acknowledged");
        }
        Ok(wait_result(state))
    }

    pub(super) async fn send(
        &self,
        caller: &Caller,
        request: SendRequest,
        identity: &CallIdentity,
    ) -> Result<SendResult, ToolError> {
        let provider = self.child_provider(caller, &request.child).await?;
        let state = self.ensure_tracked(&provider, &request.child).await?;
        let status = match (state, request.mode) {
            (state, SendMode::Queue) => {
                let mut hasher = blake3::Hasher::new();
                for part in [
                    identity.provider.as_str(),
                    identity.thread.as_str(),
                    identity.turn.as_str(),
                    identity.call_id.as_str(),
                    request.child.as_str(),
                    request.message.as_str(),
                ] {
                    hasher.update(part.as_bytes());
                    hasher.update(&[0]);
                }
                let command_id = format!("agent-send-{}", hasher.finalize().to_hex());
                // One follow-up is one work request, created with its command.
                let work = ChildWorkRequest::queued(
                    WorkRequestId::new(),
                    caller.thread.clone(),
                    Some(request.child.clone()),
                    provider.descriptor().id,
                    command_id.clone(),
                    RequestOrigin::Followup,
                    unix_time_ms(),
                );
                self.turn_delivery
                    .enqueue_followup(
                        &command_id,
                        request.child.as_str(),
                        request.message,
                        state.is_running(),
                        move |write| {
                            TaskJournal::record_followup_in_write(write, &work).map_err(store_error)
                        },
                    )
                    .await
                    .map_err(|error| ToolError::message(error.to_string()))?;
                self.delivery.reset(&request.child);
                if state.is_running() {
                    SendStatus::Queued
                } else {
                    let command = self
                        .turn_delivery
                        .first_receipt(&command_id)
                        .await
                        .map_err(|error| ToolError::message(error.to_string()))?;
                    if let Some(turn_id) = command
                        .as_ref()
                        .filter(|command| command.state == crate::store::OutboxState::Delivered)
                        .and_then(|command| command.delivered_turn_id.as_deref())
                    {
                        self.tracker.started(request.child.as_str(), turn_id);
                        SendStatus::Running
                    } else {
                        SendStatus::Queued
                    }
                }
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
            (ChildState::Settled { .. }, SendMode::Steer) => {
                return Err(ToolError::message(
                    "the agent is idle; send with mode \"queue\"",
                ));
            }
        };
        Ok(SendResult { status })
    }

    pub(super) async fn cancel(
        &self,
        caller: &Caller,
        child: &AppThreadId,
    ) -> Result<CancelResult, ToolError> {
        let deadline = tokio::time::Instant::now() + CANCEL_ACK_WINDOW;
        let (result, cancelled) =
            tokio::time::timeout(INTERRUPT_TIMEOUT, self.cancel_unbounded(caller, child))
                .await
                .map_err(|_| {
                    ToolError::message(
                        "interrupt was not confirmed: the provider did not answer in time; \
                     retrying is safe, and a delegated task is stopped with codewide_cancel_task",
                    )
                })??;
        // The cancel call takes the cancelled results whose end it saw in
        // time; later ends are pushed as `cancelled`. A completion that won
        // the race carries text this result does not return, so it is pushed.
        if !cancelled.is_empty() && self.await_settled(&cancelled, deadline).await {
            let mut taken = Vec::with_capacity(cancelled.len());
            for request_id in cancelled {
                if let Ok(Some(request)) = self.task_journal.request(&request_id).await
                    && matches!(
                        request.phase,
                        RequestPhase::Settled {
                            settlement: Settlement::Ran {
                                outcome: RunOutcome::Cancelled,
                                ..
                            },
                            ..
                        }
                    )
                {
                    taken.push(request_id);
                }
            }
            self.task_journal
                .acknowledge(taken, AckSource::Cancel, retract_notice_in_write)
                .await
                .map_err(ToolError::from)?;
        }
        Ok(result)
    }

    async fn cancel_unbounded(
        &self,
        caller: &Caller,
        child: &AppThreadId,
    ) -> Result<(CancelResult, Vec<WorkRequestId>), ToolError> {
        let provider = self.child_provider(caller, child).await?;
        let state = self.ensure_tracked(&provider, child).await?;
        self.tracker.clear_queue(child.as_str());
        let dropped = self
            .turn_delivery
            .cancel_queued_for_thread(child.as_str())
            .await
            .map_err(|error| ToolError::message(error.to_string()))?;
        // Dropped follow-ups never start; the cancel acknowledges them.
        self.task_journal
            .cancelled_commands(dropped)
            .await
            .map_err(ToolError::from)?;
        let ChildState::Running { turn_id } = state else {
            return Ok((
                CancelResult {
                    status: state.status(),
                },
                Vec::new(),
            ));
        };
        let cancelled = self
            .task_journal
            .cancel_child_requests(child.as_str())
            .await
            .map_err(ToolError::from)?;
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
        Ok((
            CancelResult {
                status: AgentStatus::Interrupted,
            },
            cancelled,
        ))
    }

    pub(super) async fn list(&self, caller: &Caller) -> Result<ListResult, ToolError> {
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
                task_id: link.task_id,
                provider: link.provider.into_string(),
                model: link.model,
                model_label: None,
                name: link.name,
                status,
            });
        }
        Ok(ListResult { agents })
    }
}
fn store_error(error: JournalError) -> StoreError {
    match error {
        JournalError::Store(error) => error,
        other => StoreError::CorruptedIndex(other.to_string()),
    }
}

fn unix_time_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |elapsed| {
            u64::try_from(elapsed.as_millis()).unwrap_or(u64::MAX)
        })
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
pub(super) async fn last_turn_state(
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
