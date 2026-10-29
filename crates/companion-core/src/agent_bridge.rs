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

use agent_core::provider::{NativeSurface, StoredThreadState};

use crate::{
    agent::{
        client_wire::gateway::{ClientWireGateway, default_model},
        model::{
            AgentItem, AgentTurn, AppThreadId, ItemsView, MessagePhase, SortDirection,
            ThreadSettings, ThreadTurnsParams, TurnStatus, thread_not_found_message,
        },
        permission_profiles,
    },
    store::{IndexStore, OutboxPresentation, OutboxState},
    turn_delivery::TurnDelivery,
    unmaterialized_threads::{self, UnmaterializedThread},
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

/// Where one queued command stands, without any prompt or answer text.
/// Times are Unix seconds.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum CommandPhase {
    /// The outbox still holds the command for its thread.
    Queued,
    /// Its turn is in progress (or delivered and not yet readable).
    Running { started_at: i64 },
    /// Its turn completed.
    Completed { finished_at: i64 },
    /// The outbox gave up on it, or its turn failed or was interrupted.
    Failed {
        finished_at: Option<i64>,
        reason: String,
    },
    /// Neither the outbox nor the recent turns know it.
    Unknown,
}

/// Whether a thread can take new work.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ThreadPresence {
    /// The thread exists and is not archived.
    Live,
    /// The thread exists but the user archived it.
    Archived,
    /// No provider knows the thread.
    Missing,
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

    /// Whether a thread can take new work. Archive state comes from the
    /// stored catalog for providers with native thread storage and from the
    /// provider's own thread read otherwise, as in the pin snapshot. A native
    /// thread without stored history yet (no first turn) is live only while
    /// its runtime still holds it; once neither does, it is missing.
    ///
    /// # Errors
    ///
    /// Returns a short reason when the thread's state cannot be read;
    /// callers must not treat that as a missing thread.
    pub async fn thread_presence(&self, thread_id: &str) -> Result<ThreadPresence, String> {
        let target = match self.gateway.resolve_thread(thread_id, None).await {
            Ok(target) => target,
            Err(failure) if failure.message == thread_not_found_message(thread_id) => {
                return Ok(ThreadPresence::Missing);
            }
            Err(failure) => {
                return Err(format!(
                    "the thread could not be resolved: {}",
                    failure.message
                ));
            }
        };
        if let Some(native) = target.native()
            && let Some(store) = native.thread_store()
        {
            return match store.thread_state(target.thread_id.as_str()).await? {
                StoredThreadState::Active => Ok(ThreadPresence::Live),
                StoredThreadState::Archived => Ok(ThreadPresence::Archived),
                StoredThreadState::Unrecorded => unrecorded_presence(native, thread_id).await,
            };
        }
        let archived = target
            .provider
            .thread_read(&target.thread_id)
            .await
            .map_err(|error| format!("the thread could not be read: {error}"))?
            .thread
            .archived;
        Ok(if archived {
            ThreadPresence::Archived
        } else {
            ThreadPresence::Live
        })
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

    /// Where the command `command_id` queued on `thread_id` stands: the
    /// outbox state while it holds the command, then the state of the turn
    /// that delivered it. Carries no prompt or answer text; a failure reason
    /// is the outbox or provider error, cut to 300 characters.
    ///
    /// # Errors
    ///
    /// Returns a short reason when the outbox cannot be read.
    pub async fn command_phase(
        &self,
        thread_id: &str,
        command_id: &str,
    ) -> Result<CommandPhase, String> {
        let command = self
            .delivery
            .command(command_id)
            .await
            .map_err(|error| format!("the agent queue could not be read: {error}"))?
            .filter(|command| command.remote_thread_id == thread_id);
        let delivered_at = match &command {
            Some(command) => match command.state {
                OutboxState::Queued | OutboxState::Uncertain => return Ok(CommandPhase::Queued),
                OutboxState::Failed => {
                    return Ok(CommandPhase::Failed {
                        finished_at: i64::try_from(command.updated_at / 1000).ok(),
                        reason: command.last_error.as_deref().map_or_else(
                            || "the turn could not be delivered".to_owned(),
                            |error| error.chars().take(300).collect(),
                        ),
                    });
                }
                OutboxState::Delivered => i64::try_from(command.updated_at / 1000).ok(),
            },
            None => None,
        };
        let Some(turn) = self.command_turn(thread_id, command_id).await else {
            // A delivered turn may not be readable yet; a pruned receipt
            // whose turn is out of the recent window is unknown.
            return Ok(delivered_at.map_or(CommandPhase::Unknown, |started_at| {
                CommandPhase::Running { started_at }
            }));
        };
        Ok(match turn.status {
            TurnStatus::InProgress => CommandPhase::Running {
                started_at: turn.started_at,
            },
            TurnStatus::Completed => CommandPhase::Completed {
                finished_at: turn.completed_at.unwrap_or(turn.started_at),
            },
            TurnStatus::Interrupted => CommandPhase::Failed {
                finished_at: turn.completed_at,
                reason: "the turn was interrupted".into(),
            },
            TurnStatus::Failed => CommandPhase::Failed {
                finished_at: turn.completed_at,
                reason: turn.error.map_or_else(
                    || "the turn failed".to_owned(),
                    |error| error.message.chars().take(300).collect(),
                ),
            },
        })
    }

    /// The recent turn of `thread_id` whose user message is `command_id`.
    async fn command_turn(&self, thread_id: &str, command_id: &str) -> Option<AgentTurn> {
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
        turns.turns.into_iter().find(|turn| {
            turn.items.iter().any(|item| {
                matches!(item, AgentItem::UserMessage { client_message_id: Some(id), .. } if id.as_str() == command_id)
            })
        })
    }

    /// The outcome of the turn that delivered `command_id`, `None` while it
    /// has not finished (or not started).
    pub async fn turn_outcome(&self, thread_id: &str, command_id: &str) -> Option<TurnOutcome> {
        let turn = self.command_turn(thread_id, command_id).await?;
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

/// The presence of a native thread its store has no history for: only the
/// runtime that started it can still hold it.
async fn unrecorded_presence(
    native: &dyn NativeSurface,
    thread_id: &str,
) -> Result<ThreadPresence, String> {
    let response = native
        .request(unmaterialized_threads::read_request(
            "agent-bridge-thread-presence",
            thread_id,
        ))
        .await
        .map_err(|error| format!("the thread could not be read: {error}"))?;
    match unmaterialized_threads::classify_read(&response, thread_id)
        .map_err(|message| format!("the thread could not be read: {message}"))?
    {
        UnmaterializedThread::Loaded(_) => Ok(ThreadPresence::Live),
        UnmaterializedThread::Gone => {
            info!(
                app_thread_id = thread_id,
                "thread has neither stored history nor a runtime"
            );
            Ok(ThreadPresence::Missing)
        }
    }
}
