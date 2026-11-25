//! Authenticated provider lifecycle observation for delegated work.
//!
//! Provider ownership is checked against durable bindings before any wait,
//! queue, request or tracker side effect. A request is bound to its turn only
//! by its command's delivery receipt (`journal::requests`); live events here
//! only end turns (`settle_turn`), release queued follow-ups and feed the
//! in-memory tracker.

use std::sync::Arc;

use serde_json::Value;

use super::OrchestrationService;
use crate::agent::{
    client_wire::observe::{TurnFact, turn_fact},
    model::{AppThreadId, ProviderId, TurnId},
};

impl OrchestrationService {
    /// Observes one client-wire payload from an authenticated provider.
    pub fn observe_event(self: &Arc<Self>, provider: &ProviderId, payload: &Value) {
        self.profiles.observe_event(provider, payload);
        let Some(fact) = turn_fact(payload) else {
            return;
        };
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
        let Some(thread) = AppThreadId::parse(thread_id) else {
            return;
        };
        if !live_applied && !self.provider_owns_thread(&provider, thread_id).await {
            return;
        }
        if !live_applied {
            self.tracker.authorize(thread_id, provider.clone());
            let _ = self.tracker.observe(&payload);
        }
        match fact {
            TurnFact::Started { .. } => self.delivery.reset(&thread),
            TurnFact::AgentMessage { .. } => {}
            TurnFact::Ended { turn_id, end, .. } => {
                if !live_applied && self.turn_ends.receiver_count() > 0 {
                    let _ = self.turn_ends.send((
                        provider.clone(),
                        thread_id.to_owned(),
                        turn_id.to_owned(),
                    ));
                }
                if let Some(turn_id) = TurnId::parse(turn_id) {
                    // Queued follow-ups belong to the authenticated owner's
                    // thread, whatever request or task the ended turn served.
                    self.release_queued(&thread, &turn_id).await;
                    self.settle_turn(&provider, &thread, &turn_id, end, true)
                        .await;
                }
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
