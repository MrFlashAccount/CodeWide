//! Authenticated provider lifecycle observation for delegated work.
//!
//! Provider ownership is checked against durable bindings before any wait,
//! queue, task, or compatibility-tracker side effect. Task children add the
//! stronger requirement that lifecycle events match the attempt's persisted
//! provider turn.

use std::sync::Arc;

use serde_json::Value;

use super::{OrchestrationService, task::TaskState};
use crate::agent::{
    client_wire::observe::{TurnFact, turn_fact},
    model::{AppThreadId, ProviderId, TurnId},
};

impl OrchestrationService {
    /// Observes one client-wire payload from an authenticated provider.
    pub fn observe_event(self: &Arc<Self>, provider: &ProviderId, payload: &Value) {
        self.profiles.observe_event(provider, payload);
        if let Some(fact) = turn_fact(payload) {
            let thread_id = match &fact {
                TurnFact::Started { thread_id, .. }
                | TurnFact::AgentMessage { thread_id, .. }
                | TurnFact::Ended { thread_id, .. } => *thread_id,
            };
            let live_applied = self.tracker.provider_matches(thread_id, provider)
                && match &fact {
                    TurnFact::Started { .. } => true,
                    TurnFact::AgentMessage { turn_id, .. } | TurnFact::Ended { turn_id, .. } => {
                        self.tracker.accepts_turn(thread_id, turn_id)
                    }
                };
            if live_applied {
                let _ = self.tracker.observe(payload);
                if let TurnFact::Ended { turn_id, .. } = fact
                    && self.turn_ends.receiver_count() > 0
                {
                    let _ = self.turn_ends.send((
                        provider.clone(),
                        thread_id.to_owned(),
                        turn_id.to_owned(),
                    ));
                }
            }
            let service = self.clone();
            let provider = provider.clone();
            let payload = payload.clone();
            tokio::spawn(async move {
                service
                    .observe_turn_event(provider, payload, live_applied)
                    .await;
            });
        }
        if payload.get("method").and_then(Value::as_str) == Some("companion/queue/changed") {
            if let Some(commands) = payload.pointer("/params/data").and_then(Value::as_array) {
                for command in commands {
                    let Some(child) = command.get("remoteThreadId").and_then(Value::as_str) else {
                        continue;
                    };
                    let Some(turn_id) = command.get("deliveredTurnId").and_then(Value::as_str)
                    else {
                        continue;
                    };
                    let service = self.clone();
                    let provider = provider.clone();
                    let child = child.to_owned();
                    let turn_id = turn_id.to_owned();
                    tokio::spawn(async move {
                        if service.provider_owns_thread(&provider, &child).await {
                            if let Some(turn_id) = TurnId::parse(&turn_id) {
                                let _ = service
                                    .task_journal
                                    .observe_started(&provider, &child, turn_id)
                                    .await;
                            }
                            service.tracker.authorize(&child, provider);
                            service.tracker.register_if_absent(
                                &child,
                                super::coordinator::watch::ChildState::Running {
                                    turn_id: Some(turn_id.clone()),
                                },
                            );
                            service.tracker.started(&child, &turn_id);
                        }
                    });
                }
            }
            self.signal_tasks();
        }
    }

    async fn observe_turn_event(
        self: &Arc<Self>,
        provider: ProviderId,
        payload: Value,
        live_applied: bool,
    ) {
        let Some(fact) = turn_fact(&payload) else {
            return;
        };
        let thread_id = match &fact {
            TurnFact::Started { thread_id, .. }
            | TurnFact::AgentMessage { thread_id, .. }
            | TurnFact::Ended { thread_id, .. } => *thread_id,
        };
        if !live_applied && !self.provider_owns_thread(&provider, thread_id).await {
            return;
        }
        let task = self
            .task_journal
            .get_for_child(thread_id)
            .await
            .ok()
            .flatten();
        let accepted = match &fact {
            TurnFact::Started { turn_id, .. } => {
                let Some(turn_id) = TurnId::parse(turn_id) else {
                    return;
                };
                if task.as_ref().is_some_and(|bundle| {
                    !bundle.task.state.is_terminal()
                        || bundle.attempt.state.provider_turn_id() == Some(&turn_id)
                }) {
                    match self
                        .task_journal
                        .observe_started(&provider, thread_id, turn_id)
                        .await
                    {
                        Ok(Some(bundle)) => {
                            if bundle.task.state == TaskState::Cancelling {
                                let _ = self.resume_cancellation(&bundle).await;
                            }
                            true
                        }
                        Ok(None) | Err(_) => false,
                    }
                } else {
                    true
                }
            }
            TurnFact::AgentMessage { turn_id, .. } => task.as_ref().is_none_or(|bundle| {
                bundle.task.state.is_terminal()
                    && bundle
                        .attempt
                        .state
                        .provider_turn_id()
                        .is_some_and(|known| known.as_str() != *turn_id)
                    || bundle
                        .attempt
                        .state
                        .provider_turn_id()
                        .is_some_and(|known| known.as_str() == *turn_id)
            }),
            TurnFact::Ended { turn_id, end, .. } => {
                let Some(turn_id) = TurnId::parse(turn_id) else {
                    return;
                };
                if task.as_ref().is_some_and(|bundle| {
                    !bundle.task.state.is_terminal()
                        || bundle.attempt.state.provider_turn_id() == Some(&turn_id)
                }) {
                    self.task_journal
                        .observe_terminal(&provider, thread_id, turn_id, *end)
                        .await
                        .ok()
                        .flatten()
                        .is_some()
                } else {
                    true
                }
            }
        };
        if !accepted {
            return;
        }
        if !live_applied {
            self.tracker.authorize(thread_id, provider.clone());
            let _ = self.tracker.observe(&payload);
        }
        if let TurnFact::Ended { turn_id, .. } = fact {
            if !live_applied && self.turn_ends.receiver_count() > 0 {
                let _ = self
                    .turn_ends
                    .send((provider, thread_id.to_owned(), turn_id.to_owned()));
            }
            let released = self
                .turn_delivery
                .release_queued_for_thread(thread_id)
                .await;
            if matches!(released, Ok(Some(_))) {
                self.tracker.queued_after(thread_id, turn_id);
            }
        }
        self.signal_tasks();
    }

    async fn provider_owns_thread(&self, provider: &ProviderId, thread_id: &str) -> bool {
        let Some(thread) = AppThreadId::parse(thread_id) else {
            return false;
        };
        if self
            .gateway
            .bindings()
            .provider_of(&thread)
            .await
            .ok()
            .flatten()
            .as_ref()
            == Some(provider)
        {
            return true;
        }
        self.links
            .link_of(thread_id)
            .await
            .ok()
            .flatten()
            .is_some_and(|link| &link.provider == provider)
    }

    /// Observes an RPC result from an authenticated provider.
    pub fn observe_rpc_result(&self, provider: &ProviderId, method: &str, result: &Value) {
        self.profiles.observe_rpc_result(provider, method, result);
    }
}
