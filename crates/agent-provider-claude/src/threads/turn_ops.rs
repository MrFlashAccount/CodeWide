//! Turn operations (`turn.start`, `thread.compact`, `turn.steer`,
//! `turn.interrupt`, `request.respond`). A turn runs only in a listed
//! thread with a working directory whose session no other `claude` process
//! holds; a discovered session is adopted on its first turn.
//! `turn.interrupt` answers in every state.

use agent_core::{
    model::{
        AppThreadId, EXPECTED_TURN_NOT_ACTIVE, RequestRespondParams, TurnId, TurnInterruptParams,
        TurnStartParams, TurnStartResult, TurnSteerParams, TurnSteerResult,
    },
    provider::ProviderError,
};

use super::{
    errors::{OPEN_ELSEWHERE_MESSAGE, internal, invalid_request, not_found, session_gone},
    history::{HistorySource, stored_turns},
    service::{Listed, ServiceInner, ThreadService},
};
use crate::session::{
    handle::SessionHandle,
    turn::{SteerMessage, TurnRequest},
};

impl ServiceInner {
    /// The session a turn can run in: listed, with a working directory, not
    /// held by another process.
    async fn turn_entry(&self, app_thread_id: &str) -> Result<SessionHandle, ProviderError> {
        let handle = self
            .entry_for(app_thread_id)
            .await?
            .ok_or_else(|| not_found(app_thread_id))?;
        let state = handle.state();
        if state.cwd.is_empty() {
            return Err(invalid_request(
                "the Claude session has no working directory",
            ));
        }
        // A session that never started cannot be held; a live one is this companion's.
        if state.session_started
            && !handle.status().live
            && self.open_elsewhere.check(state.current_session_id()).await
        {
            return Err(invalid_request(OPEN_ELSEWHERE_MESSAGE));
        }
        Ok(handle)
    }

    /// The session of a listed thread; `None` for a discovered session.
    async fn listed_entry(
        &self,
        app_thread_id: &str,
    ) -> Result<Option<SessionHandle>, ProviderError> {
        match self
            .resolve(app_thread_id)
            .await?
            .listed()
            .ok_or_else(|| not_found(app_thread_id))?
        {
            Listed::Entry(handle) => Ok(Some(handle)),
            Listed::Discovered(_) => Ok(None),
        }
    }

    /// Whether `turn_id` is the active turn, an indexed turn or a turn of
    /// the stored history.
    async fn is_known_turn(
        &self,
        handle: &SessionHandle,
        turn_id: &TurnId,
    ) -> Result<bool, ProviderError> {
        let state = handle.state();
        if handle.status().active_turn_id.as_ref() == Some(turn_id)
            || state
                .turns
                .iter()
                .any(|record| record.turn_id == turn_id.as_str())
        {
            return Ok(true);
        }
        let turns = stored_turns(self.projects_root.clone(), HistorySource::Thread(state)).await?;
        Ok(turns.iter().any(|turn| turn.turn_id == *turn_id))
    }
}

impl ThreadService {
    /// `turn.start`: a user turn, or `busy` with the active turn. Client
    /// tools come from the service's
    /// [`crate::session::ports::ClientTools`], not the params.
    ///
    /// # Errors
    /// `-32600` for an unknown thread, one without a working directory, or
    /// one another process holds ([`OPEN_ELSEWHERE_MESSAGE`]).
    pub async fn turn_start(
        &self,
        params: TurnStartParams,
    ) -> Result<TurnStartResult, ProviderError> {
        let handle = self.inner.turn_entry(params.app_thread_id.as_str()).await?;
        handle
            .start_turn(TurnRequest::User {
                client_message_id: params.client_message_id,
                input: params.input,
            })
            .await
            .map_err(|err| session_gone(&err))?
            .map_err(|err| internal("turn.start", &err))
    }

    /// `thread.compact`: Claude's `/compact` as a provider turn.
    ///
    /// # Errors
    /// As [`Self::turn_start`], and `-32600` while a turn runs.
    pub async fn compact(&self, app_thread_id: &AppThreadId) -> Result<(), ProviderError> {
        let handle = self.inner.turn_entry(app_thread_id.as_str()).await?;
        match handle
            .start_turn(TurnRequest::Compact)
            .await
            .map_err(|err| session_gone(&err))?
            .map_err(|err| internal("thread.compact", &err))?
        {
            TurnStartResult::Busy { .. } => Err(invalid_request("thread has an active turn")),
            TurnStartResult::Started { .. } => Ok(()),
        }
    }

    /// `turn.steer` into the active turn `expected_turn_id`.
    ///
    /// # Errors
    /// `-32600` for an unknown thread or when that turn is not active.
    pub async fn turn_steer(
        &self,
        params: TurnSteerParams,
    ) -> Result<TurnSteerResult, ProviderError> {
        let Some(handle) = self
            .inner
            .listed_entry(params.app_thread_id.as_str())
            .await?
        else {
            return Err(invalid_request(EXPECTED_TURN_NOT_ACTIVE));
        };
        let turn_id = handle
            .steer(
                params.expected_turn_id,
                SteerMessage {
                    client_message_id: params.client_message_id,
                    input: params.input,
                },
            )
            .await
            .map_err(|err| session_gone(&err))?
            .map_err(invalid_request)?;
        Ok(TurnSteerResult { turn_id })
    }

    /// `turn.interrupt`: answers in every state; fails only for a turn id
    /// that is not this thread's while a turn runs.
    ///
    /// # Errors
    /// `-32600` for an unknown thread or a foreign turn id.
    pub async fn turn_interrupt(&self, params: TurnInterruptParams) -> Result<(), ProviderError> {
        let Some(handle) = self
            .inner
            .listed_entry(params.app_thread_id.as_str())
            .await?
        else {
            return Ok(());
        };
        let known = match &params.turn_id {
            Some(turn_id) if handle.status().active_turn_id.is_some() => {
                self.inner.is_known_turn(&handle, turn_id).await?
            }
            _ => true,
        };
        handle
            .interrupt(params.turn_id, known)
            .await
            .map_err(|err| session_gone(&err))?
            .map_err(invalid_request)
    }

    /// `request.respond`: answers a pending runtime request.
    ///
    /// # Errors
    /// `-32600` for an unknown thread or a request that is not pending.
    pub async fn request_respond(&self, params: RequestRespondParams) -> Result<(), ProviderError> {
        let responded = match self
            .inner
            .listed_entry(params.app_thread_id.as_str())
            .await?
        {
            Some(handle) => handle
                .respond(params.request_id, params.response)
                .await
                .map_err(|err| session_gone(&err))?,
            None => false,
        };
        if responded {
            Ok(())
        } else {
            Err(invalid_request("request is not pending"))
        }
    }
}
