//! The threads the service keeps metadata for
//! (`host/src/threads/registry.ts`): one session actor per thread, which
//! owns the thread's `ThreadState`, and the session id → thread index of
//! every session chain. Persistence goes through the store; every write of
//! a state also refreshes that index, so a replacement session the actor
//! adds to the chain is found at once.

use std::{
    collections::HashMap,
    error::Error,
    sync::{Arc, Mutex, MutexGuard, PoisonError},
};

use agent_core::{
    model::{AgentTurn, AppThreadId},
    provider::ProviderError,
};

use tracing::warn;

use super::errors::internal;
use crate::{
    session::{
        handle::SessionHandle,
        ports::{SessionDeps, StatePersistence},
    },
    state::{ThreadStateStore, thread_state::ThreadState},
};

/// How long shutdown waits for closed sessions' processes: their own exit
/// grace (`cli::process`) plus the kill after it.
const SHUTDOWN_GRACE: std::time::Duration = std::time::Duration::from_secs(10);

/// Session id → app thread id of every known chain.
type Owners = Arc<Mutex<HashMap<String, AppThreadId>>>;

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

fn note_owners(owners: &Owners, state: &ThreadState) {
    let mut owners = lock(owners);
    for session_id in state.session_ids.iter() {
        owners.insert(session_id.to_owned(), state.app_thread_id.clone());
    }
}

/// [`StatePersistence`] of every session: the state store plus the chain index.
pub struct RegistryPersistence {
    store: ThreadStateStore,
    owners: Owners,
}

impl StatePersistence for RegistryPersistence {
    fn write(&self, state: &ThreadState) -> Result<(), Box<dyn Error + Send + Sync>> {
        note_owners(&self.owners, state);
        self.store.write(state)?;
        Ok(())
    }

    fn write_active_turn(
        &self,
        app_thread_id: &AppThreadId,
        turn: Option<&AgentTurn>,
    ) -> Result<(), Box<dyn Error + Send + Sync>> {
        match turn {
            Some(turn) => self.store.write_active_turn(app_thread_id, turn)?,
            None => self.store.clear_active_turn(app_thread_id)?,
        }
        Ok(())
    }
}

/// The session actors by thread, and the chain index.
pub struct ThreadRegistry {
    entries: Mutex<HashMap<AppThreadId, SessionHandle>>,
    owners: Owners,
    store: ThreadStateStore,
    session_deps: Arc<SessionDeps>,
}

impl ThreadRegistry {
    /// The persistence sessions must be built with, sharing the registry's
    /// chain index; pass it in the `SessionDeps` given to [`Self::new`].
    #[must_use]
    pub fn persistence(store: ThreadStateStore) -> (Arc<RegistryPersistence>, RegistryIndex) {
        let owners = Owners::default();
        (
            Arc::new(RegistryPersistence {
                store,
                owners: owners.clone(),
            }),
            RegistryIndex(owners),
        )
    }

    /// A registry spawning its sessions with `session_deps`.
    #[must_use]
    pub fn new(
        store: ThreadStateStore,
        index: RegistryIndex,
        session_deps: Arc<SessionDeps>,
    ) -> Self {
        Self {
            entries: Mutex::new(HashMap::new()),
            owners: index.0,
            store,
            session_deps,
        }
    }

    /// The store states are written to.
    #[must_use]
    pub fn store(&self) -> &ThreadStateStore {
        &self.store
    }

    /// The session of a thread.
    #[must_use]
    pub fn get(&self, app_thread_id: &str) -> Option<SessionHandle> {
        let id = AppThreadId::parse(app_thread_id)?;
        lock(&self.entries).get(&id).cloned()
    }

    /// The session of the thread whose chain contains `session_id`.
    #[must_use]
    pub fn owner_of(&self, session_id: &str) -> Option<SessionHandle> {
        let owner = lock(&self.owners).get(session_id).cloned()?;
        lock(&self.entries).get(&owner).cloned()
    }

    /// Whether some chain contains `session_id`.
    #[must_use]
    pub fn is_claimed(&self, session_id: &str) -> bool {
        lock(&self.owners).contains_key(session_id)
    }

    /// Every session.
    #[must_use]
    pub fn all(&self) -> Vec<SessionHandle> {
        lock(&self.entries).values().cloned().collect()
    }

    /// Starts the session of a stored thread, unless one runs already.
    pub fn register(&self, state: ThreadState) -> SessionHandle {
        let mut entries = lock(&self.entries);
        if let Some(existing) = entries.get(&state.app_thread_id) {
            return existing.clone();
        }
        note_owners(&self.owners, &state);
        let app_thread_id = state.app_thread_id.clone();
        let handle = SessionHandle::spawn(state, self.session_deps.clone());
        entries.insert(app_thread_id, handle.clone());
        handle
    }

    /// Persists a new thread and starts its session.
    ///
    /// # Errors
    /// When the state cannot be written.
    pub async fn add(&self, state: ThreadState) -> Result<SessionHandle, ProviderError> {
        let store = self.store.clone();
        let state = tokio::task::spawn_blocking(move || store.write(&state).map(|()| state))
            .await
            .map_err(|err| internal("thread state write", &err))?
            .map_err(|err| internal("thread state write", &err))?;
        Ok(self.register(state))
    }

    /// Ends every session (service shutdown) and waits until their
    /// `claude` processes have exited on their own, at most
    /// [`SHUTDOWN_GRACE`]; the rest are killed when the runtime drops.
    pub async fn shutdown(&self) {
        let mut disposing = tokio::task::JoinSet::new();
        for handle in self.all() {
            // A session that already ended has nothing to end.
            disposing.spawn(async move {
                let _ = handle.dispose().await;
            });
        }
        disposing.join_all().await;
        if tokio::time::timeout(SHUTDOWN_GRACE, self.session_deps.runtime.ended())
            .await
            .is_err()
        {
            warn!("Claude processes were still running at shutdown");
        }
    }
}

/// The chain index shared by [`RegistryPersistence`] and [`ThreadRegistry`].
pub struct RegistryIndex(Owners);
