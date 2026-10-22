//! How the forge and review contexts hand work to agents, without owning
//! any agent machinery:
//!
//! - a turn goes through the existing durable queue owner (the outbox): one
//!   `turn/start` command per call, idempotent by its command id, delivered
//!   by the outbox pump when the thread is free;
//! - a new thread is created on the primary provider with its default model
//!   and an explicit permission profile, and announced on the journal;
//! - the result of a turn is read back by its client message id, as the
//!   orchestration tools do (the final agent message of that turn).
//!
//! Neither context names a provider; this module never branches on one.

use std::sync::Arc;

use serde_json::{Value, json};
use tracing::{info, warn};

use crate::{
    agent::{
        client_wire::gateway::{ClientWireGateway, default_model},
        model::{
            AgentItem, AppThreadId, ItemsView, MessagePhase, SortDirection, ThreadSettings,
            ThreadTurnsParams, TurnStatus,
        },
        permission_profiles,
    },
    store::{IndexStore, OutboxPresentation},
    turn_delivery::TurnDelivery,
};

/// How many recent turns are searched for a command's turn.
const TURN_SEARCH_LIMIT: u32 = 30;

/// The outcome of a delivered turn.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum TurnOutcome {
    /// The final agent message (or the last message when none is final).
    Completed(Option<String>),
    /// The turn failed or was interrupted.
    Ended(String),
}

#[derive(Clone)]
pub struct AgentBridge {
    gateway: Arc<ClientWireGateway>,
    store: Arc<IndexStore>,
    delivery: TurnDelivery,
    journal: tokio::sync::mpsc::Sender<Value>,
}

impl AgentBridge {
    #[must_use]
    pub(crate) fn new(
        gateway: Arc<ClientWireGateway>,
        store: Arc<IndexStore>,
        delivery: TurnDelivery,
        journal: tokio::sync::mpsc::Sender<Value>,
    ) -> Self {
        Self {
            gateway,
            store,
            delivery,
            journal,
        }
    }

    /// Queues one turn with `inputs` as separate text inputs. Reusing
    /// `command_id` with the same inputs is a no-op.
    ///
    /// # Errors
    ///
    /// Returns a short reason when the queue rejects the command.
    pub async fn enqueue(
        &self,
        thread_id: &str,
        command_id: &str,
        inputs: Vec<String>,
    ) -> Result<(), String> {
        if inputs.is_empty() {
            return Err("nothing to send".into());
        }
        let params = json!({
            "threadId": thread_id,
            "clientUserMessageId": command_id,
            "input": inputs
                .into_iter()
                .map(|text| json!({"type": "text", "text": text}))
                .collect::<Vec<_>>(),
        });
        if let Err(error) = self
            .delivery
            .put(
                command_id,
                thread_id,
                params,
                None,
                OutboxPresentation::Delivery,
                None,
            )
            .await
        {
            warn!(err = %error, thread_id, "agent turn was not queued");
            return Err("the agent queue rejected the turn".into());
        }
        self.delivery.wake();
        self.delivery.emit_changed(thread_id).await;
        Ok(())
    }

    /// Whether a thread exists for any provider.
    pub async fn thread_exists(&self, thread_id: &str) -> bool {
        self.gateway.resolve_thread(thread_id, None).await.is_ok()
    }

    /// Creates a thread on the primary provider in `cwd` with `profile`
    /// (`:read-only` or `:workspace`), announced like any new thread.
    ///
    /// # Errors
    ///
    /// Returns a short reason when the provider refuses.
    pub async fn create_thread(&self, cwd: String, profile: &str) -> Result<AppThreadId, String> {
        let (provider, wire) = self.gateway.primary();
        let model = default_model(&provider)
            .await
            .map_err(|failure| format!("no default model: {}", failure.message))?;
        let permission_profile =
            permission_profiles::for_provider(&provider, profile.to_owned()).await?;
        let thread = self
            .gateway
            .create_thread(
                &provider,
                &wire,
                cwd,
                ThreadSettings {
                    model,
                    effort: None,
                    permission_profile,
                    service_tier: None,
                },
            )
            .await
            .map_err(|failure| format!("the thread could not be created: {}", failure.message))?;
        let (_, started) = ClientWireGateway::started_thread(&thread, &wire);
        if self.journal.send(started).await.is_err() {
            warn!("journal closed before a new thread was announced");
        }
        info!(app_thread_id = %thread.app_thread_id, "thread created for a review or scenario");
        Ok(thread.app_thread_id)
    }

    /// The outcome of the turn that delivered `command_id`, `None` while it
    /// has not finished (or not started).
    pub async fn turn_outcome(&self, thread_id: &str, command_id: &str) -> Option<TurnOutcome> {
        let target = self.gateway.resolve_thread(thread_id, None).await.ok()?;
        let turns = target
            .provider
            .thread_turns(ThreadTurnsParams {
                app_thread_id: target.thread_id.clone(),
                cursor: None,
                limit: TURN_SEARCH_LIMIT,
                sort_direction: SortDirection::Desc,
                items_view: ItemsView::Full,
            })
            .await
            .ok()?;
        let turn = turns.turns.into_iter().find(|turn| {
            turn.items.iter().any(|item| {
                matches!(item, AgentItem::UserMessage { client_message_id: Some(id), .. } if id.as_str() == command_id)
            })
        })?;
        match turn.status {
            TurnStatus::InProgress => None,
            TurnStatus::Completed => {
                let mut final_answer = None;
                let mut last = None;
                for item in &turn.items {
                    if let AgentItem::AgentMessage { text, phase, .. } = item {
                        match phase {
                            MessagePhase::Final => final_answer = Some(text.clone()),
                            MessagePhase::Commentary => last = Some(text.clone()),
                        }
                    }
                }
                Some(TurnOutcome::Completed(final_answer.or(last)))
            }
            TurnStatus::Interrupted => Some(TurnOutcome::Ended("the turn was interrupted".into())),
            TurnStatus::Failed => Some(TurnOutcome::Ended(turn.error.map_or_else(
                || "the turn failed".to_owned(),
                |error| error.message.chars().take(300).collect(),
            ))),
        }
    }

    /// The working directory of a thread in the companion index.
    #[must_use]
    pub fn thread_cwd(&self, thread_id: &str) -> Option<String> {
        self.store
            .thread_metadata(thread_id)
            .ok()
            .flatten()
            .map(|metadata| metadata.cwd)
            .filter(|cwd| !cwd.is_empty())
    }
}
