//! Whole-session reads through the index, for tests and the parity harness:
//! a session indexed into a throwaway store and read back as the former
//! `nativeSession.read` answered it.

use std::sync::Arc;

use agent_core::{
    model::{
        ERROR_INVALID_REQUEST, NativeSessionReadResult, RpcError, native_session_not_found_message,
    },
    provider::ProviderError,
};

use super::{
    history::IndexedHistory,
    session::{ListedSession, index_session},
};
use crate::{
    native::{LocalSessions, host_state::HostStateCache},
    store::{ClaudeStore, StoredSession},
    test_support::MemoryThreadIndex,
};

fn failed(error: &impl std::fmt::Display) -> ProviderError {
    ProviderError::Protocol(format!("Claude session index failed: {error}"))
}

/// A store and the reads over it.
pub(crate) struct IndexedReader {
    _directory: tempfile::TempDir,
    pub(crate) store: Arc<ClaudeStore>,
    pub(crate) history: IndexedHistory,
}

impl IndexedReader {
    pub(crate) fn new(sessions: &LocalSessions) -> Result<Self, ProviderError> {
        let directory = tempfile::tempdir().map_err(|error| failed(&error))?;
        let database = companion_host::database::open(directory.path().join("index.redb"), "test")
            .map_err(|error| failed(&error))?;
        let store = Arc::new(
            ClaudeStore::attach(database, Arc::new(MemoryThreadIndex::default()))
                .map_err(|error| failed(&error))?,
        );
        let history = IndexedHistory::new(
            store.clone(),
            Arc::new(HostStateCache::new(
                sessions.journal_directory().to_path_buf(),
            )),
        );
        Ok(Self {
            _directory: directory,
            store,
            history,
        })
    }

    /// Indexes `session_id` from its files' checkpoints and reads it whole.
    pub(crate) async fn read(
        &self,
        sessions: &LocalSessions,
        session_id: &str,
    ) -> Result<NativeSessionReadResult, ProviderError> {
        Ok(self.indexed(sessions, session_id).await?.0)
    }

    /// [`Self::read`], with the session's index row.
    pub(crate) async fn indexed(
        &self,
        sessions: &LocalSessions,
        session_id: &str,
    ) -> Result<(NativeSessionReadResult, StoredSession), ProviderError> {
        let Some(activity) = sessions.activity(session_id).await else {
            return Err(ProviderError::Disconnected(
                "Claude running-session state is unavailable".into(),
            ));
        };
        let threads = self.history.host().threads();
        let Some((file, session)) = sessions.listed_session(session_id, &threads) else {
            return Err(ProviderError::Rejected(RpcError::new(
                ERROR_INVALID_REQUEST,
                native_session_not_found_message(session_id),
            )));
        };
        let changes = index_session(
            &self.store,
            &ListedSession {
                file: &file,
                session,
                owner: threads.owner_of(session_id),
            },
            activity,
        )
        .map_err(|error| failed(&error))?;
        let read = self
            .history
            .session_read(&changes.stored)
            .map_err(|error| failed(&error))?;
        Ok((read, changes.stored))
    }
}

impl LocalSessions {
    /// The session indexed into a throwaway store and read whole.
    pub(crate) async fn read(
        &self,
        session_id: &str,
    ) -> Result<NativeSessionReadResult, ProviderError> {
        IndexedReader::new(self)?.read(self, session_id).await
    }

    /// The sub-agents the index lists for the session.
    pub(crate) async fn indexed_subagents(
        &self,
        session_id: &str,
    ) -> Result<Vec<crate::subagents::IndexedSubagent>, ProviderError> {
        Ok(IndexedReader::new(self)?
            .indexed(self, session_id)
            .await?
            .1
            .subagents)
    }
}
