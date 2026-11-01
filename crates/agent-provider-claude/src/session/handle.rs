//! The owner's handle on a session actor: commands with their answers, and
//! the latest published state and status.

use std::{collections::HashMap, sync::Arc};

use agent_core::{
    model::{AgentTurn, NativeRequestId, RuntimeResponse, ThreadSettings, TurnId, TurnStartResult},
    provider::ProviderError,
};
use tokio::sync::{mpsc, oneshot, watch};

use super::{
    actor::Session,
    ports::SessionDeps,
    turn::{SteerMessage, TurnRequest},
};
use crate::{background_tasks::LiveTaskState, state::thread_state::ThreadState};
use agent_core::model::BackgroundCommandState;

/// Whether a turn runs and whether a query is open.
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct SessionStatus {
    pub active_turn_id: Option<TurnId>,
    pub live: bool,
}

/// A change of the thread's state made by its owner (title, presence, …).
pub type StateEdit = Box<dyn FnOnce(&mut ThreadState) + Send>;

/// A consistent read: the state, the in-flight turn and, for a fenced read,
/// the stream position after every event before it.
pub type SessionRead = (
    Arc<ThreadState>,
    Option<AgentTurn>,
    Option<oneshot::Receiver<Result<u64, ProviderError>>>,
);

pub(super) enum Command {
    StartTurn {
        request: TurnRequest,
        reply: oneshot::Sender<Result<TurnStartResult, String>>,
    },
    Steer {
        expected: TurnId,
        message: SteerMessage,
        reply: oneshot::Sender<Result<TurnId, String>>,
    },
    Interrupt {
        turn_id: Option<TurnId>,
        known_turn: bool,
        reply: oneshot::Sender<Result<(), String>>,
    },
    Respond {
        request_id: NativeRequestId,
        response: RuntimeResponse,
        reply: oneshot::Sender<bool>,
    },
    UpdateSettings {
        next: ThreadSettings,
        reply: oneshot::Sender<bool>,
    },
    Edit {
        change: StateEdit,
        reply: oneshot::Sender<Arc<ThreadState>>,
    },
    Read {
        fenced: bool,
        reply: oneshot::Sender<SessionRead>,
    },
    BackgroundTask {
        task_id: String,
        reply: oneshot::Sender<Option<LiveTaskState>>,
    },
    BackgroundCommands {
        reply: oneshot::Sender<Option<HashMap<String, BackgroundCommandState>>>,
    },
    Dispose {
        reply: oneshot::Sender<()>,
    },
}

/// The session actor ended (the companion is shutting down).
#[derive(Debug, thiserror::Error)]
#[error("the Claude session of this thread has ended")]
pub struct SessionGone;

/// A running session.
#[derive(Clone)]
pub struct SessionHandle {
    commands: mpsc::UnboundedSender<Command>,
    state: watch::Receiver<Arc<ThreadState>>,
    status: watch::Receiver<SessionStatus>,
}

impl SessionHandle {
    /// Starts the actor of a thread with its stored state.
    #[must_use]
    pub fn spawn(state: ThreadState, deps: Arc<SessionDeps>) -> Self {
        let (commands, command_queue) = mpsc::unbounded_channel();
        let (internal, internal_queue) = mpsc::unbounded_channel();
        let (state_tx, state_rx) = watch::channel(Arc::new(state.clone()));
        let (status_tx, status_rx) = watch::channel(SessionStatus::default());
        let session = Session::new(deps, state, state_tx, status_tx, internal);
        tokio::spawn(session.run(command_queue, internal_queue));
        Self {
            commands,
            state: state_rx,
            status: status_rx,
        }
    }

    /// The latest published state.
    #[must_use]
    pub fn state(&self) -> Arc<ThreadState> {
        self.state.borrow().clone()
    }

    #[must_use]
    pub fn status(&self) -> SessionStatus {
        self.status.borrow().clone()
    }

    async fn ask<Answer>(
        &self,
        command: impl FnOnce(oneshot::Sender<Answer>) -> Command,
    ) -> Result<Answer, SessionGone> {
        let (reply, answer) = oneshot::channel();
        self.commands
            .send(command(reply))
            .map_err(|_| SessionGone)?;
        answer.await.map_err(|_| SessionGone)
    }

    /// Starts a user turn or `/compact`; `Busy` while a turn runs.
    ///
    /// # Errors
    ///
    /// The session ended.
    pub async fn start_turn(
        &self,
        request: TurnRequest,
    ) -> Result<Result<TurnStartResult, String>, SessionGone> {
        self.ask(|reply| Command::StartTurn { request, reply })
            .await
    }

    /// Steers the active turn `expected`.
    ///
    /// # Errors
    ///
    /// The session ended.
    pub async fn steer(
        &self,
        expected: TurnId,
        message: SteerMessage,
    ) -> Result<Result<TurnId, String>, SessionGone> {
        self.ask(|reply| Command::Steer {
            expected,
            message,
            reply,
        })
        .await
    }

    /// Interrupts the active turn.
    ///
    /// # Errors
    ///
    /// The session ended.
    pub async fn interrupt(
        &self,
        turn_id: Option<TurnId>,
        known_turn: bool,
    ) -> Result<Result<(), String>, SessionGone> {
        self.ask(|reply| Command::Interrupt {
            turn_id,
            known_turn,
            reply,
        })
        .await
    }

    /// Answers a pending request; `false` when it is not pending.
    ///
    /// # Errors
    ///
    /// The session ended.
    pub async fn respond(
        &self,
        request_id: NativeRequestId,
        response: RuntimeResponse,
    ) -> Result<bool, SessionGone> {
        self.ask(|reply| Command::Respond {
            request_id,
            response,
            reply,
        })
        .await
    }

    /// Changes the settings; `false` when they are already in effect or pending.
    ///
    /// # Errors
    ///
    /// The session ended.
    pub async fn update_settings(&self, next: ThreadSettings) -> Result<bool, SessionGone> {
        self.ask(|reply| Command::UpdateSettings { next, reply })
            .await
    }

    /// Applies and persists an owner's change of the state.
    ///
    /// # Errors
    ///
    /// The session ended.
    pub async fn edit(&self, change: StateEdit) -> Result<Arc<ThreadState>, SessionGone> {
        self.ask(|reply| Command::Edit { change, reply }).await
    }

    /// A consistent read of the state and the in-flight turn.
    ///
    /// # Errors
    ///
    /// The session ended.
    pub async fn read(&self, fenced: bool) -> Result<SessionRead, SessionGone> {
        self.ask(|reply| Command::Read { fenced, reply }).await
    }

    /// What the open query knows of a background task; `None` without a
    /// query or when the task neither started nor reported in it.
    ///
    /// # Errors
    ///
    /// The session ended.
    pub async fn background_task(
        &self,
        task_id: String,
    ) -> Result<Option<LiveTaskState>, SessionGone> {
        self.ask(|reply| Command::BackgroundTask { task_id, reply })
            .await
    }

    /// The state of every background command the open query launched, by
    /// task id; `None` without an open query.
    ///
    /// # Errors
    ///
    /// The session ended.
    pub async fn background_commands(
        &self,
    ) -> Result<Option<HashMap<String, BackgroundCommandState>>, SessionGone> {
        self.ask(|reply| Command::BackgroundCommands { reply })
            .await
    }

    /// Ends the session's query and turn for good.
    ///
    /// # Errors
    ///
    /// The session ended.
    pub async fn dispose(&self) -> Result<(), SessionGone> {
        self.ask(|reply| Command::Dispose { reply }).await
    }
}
