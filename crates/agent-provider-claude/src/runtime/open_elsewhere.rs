//! Which sessions another Claude process holds right now: a `claude --bg`
//! background agent or a terminal (`host/src/threads/openElsewhere.ts`).
//! Claude refuses to resume a session a background agent runs, and two
//! processes writing one session would fork its history, so no turn runs
//! in a held session and its thread is reported `openElsewhere`.
//!
//! The running set comes from [`RunningSessions`]; a session one of the
//! companion's own live processes runs is not held elsewhere. The CLI also
//! lists the companion's own processes, so a session just released (a model
//! change or a stopped command closes the process, an idle release ends it)
//! stays the companion's own while the CLI still lists it: the closed
//! process may take seconds to exit (up to its exit grace before it is
//! killed, with its commands) and the CLI may list it a while longer. The
//! first read started after the release that no longer lists the session
//! ends that, and so does [`RELEASE_TIMEOUT`]. A read younger
//! than [`MAX_AGE`] is reused (monotonic time). While any session is held the
//! set is re-read every poll interval, so a release reaches clients without a
//! new read. A failed read keeps the last known set.

use std::{
    collections::{HashMap, HashSet},
    sync::{Arc, Mutex, MutexGuard, PoisonError, Weak},
    time::Duration,
};

use tokio::{task::JoinHandle, time::Instant};
use tracing::warn;

use super::running_sessions::RunningSessions;

/// How long a read is reused.
pub const MAX_AGE: Duration = Duration::from_secs(2);
/// How long a session the companion released stays its own while the CLI
/// still lists it: the closed process's exit grace before it is killed
/// (`cli::process`, 5 s), its commands' exit and the CLI's lag.
pub const RELEASE_TIMEOUT: Duration = Duration::from_secs(15);

/// Whether one of the companion's own live processes runs a session.
pub type OwnsLive = Arc<dyn Fn(&str) -> bool + Send + Sync>;
/// Receives the sessions whose held state changed with a read.
pub type HeldChanged = Arc<dyn Fn(&HashSet<String>) + Send + Sync>;

/// What [`OpenElsewhere`] reads and whom it tells.
#[derive(Clone)]
pub struct OpenElsewhereDeps {
    /// The source of the running set.
    pub running: Arc<dyn RunningSessions>,
    /// Whether a session runs in one of the companion's own processes.
    pub owns_live: OwnsLive,
    /// Told of every session whose held state a read changed.
    pub changed: HeldChanged,
    /// How often the set is re-read while a session is held.
    pub poll: Duration,
}

/// The owner of the held-elsewhere state. Dropping it stops the polling.
pub struct OpenElsewhere {
    inner: Arc<Inner>,
}

struct Inner {
    deps: OpenElsewhereDeps,
    state: Mutex<State>,
    /// Serializes reads; a caller that waited for another read uses it.
    reading: tokio::sync::Mutex<()>,
}

#[derive(Default)]
struct State {
    /// Listed sessions, without the companion's recent releases.
    running: HashSet<String>,
    /// The sessions the last read reported held elsewhere.
    reported_held: HashSet<String>,
    /// When the companion last released each session.
    released_at: HashMap<String, Instant>,
    read_at: Option<Instant>,
    /// Whether the latest attempted refresh authoritatively confirmed the
    /// retained running set.
    refresh_confirmed: bool,
    /// Finished reads, so a caller that waited for one does not read again.
    reads: u64,
    /// The pending poll and its generation; a newer schedule supersedes it.
    poll: Option<JoinHandle<()>>,
    poll_generation: u64,
    stopped: bool,
}

impl OpenElsewhere {
    /// An owner that has read nothing yet: no session is held.
    #[must_use]
    pub fn new(deps: OpenElsewhereDeps) -> Self {
        Self {
            inner: Arc::new(Inner {
                deps,
                state: Mutex::new(State::default()),
                reading: tokio::sync::Mutex::new(()),
            }),
        }
    }

    /// Whether another process holds `session_id`, from the last read;
    /// [`Self::refresh`] or [`Self::check`] brings it up to date.
    #[must_use]
    pub fn is_held(&self, session_id: &str) -> bool {
        let listed = self.inner.lock().running.contains(session_id);
        listed && !(self.inner.deps.owns_live)(session_id)
    }

    /// Re-reads the running set unless the last read is fresh.
    pub async fn refresh(&self) {
        self.inner.refresh().await;
    }

    /// Re-reads the running-session registry and says whether the resulting
    /// snapshot is authoritative. A failed read keeps the previous set for
    /// locking, but callers must not publish terminal statuses from it.
    pub async fn refresh_confirmed(&self) -> bool {
        self.inner.refresh().await;
        self.inner.lock().refresh_confirmed
    }

    /// Starts a [`Self::refresh`] without waiting; a change reaches
    /// [`OpenElsewhereDeps::changed`].
    pub fn refresh_in_background(&self) {
        let inner = self.inner.clone();
        tokio::spawn(async move { inner.refresh().await });
    }

    /// Whether another process holds `session_id`, from a fresh read.
    pub async fn check(&self, session_id: &str) -> bool {
        self.refresh().await;
        self.is_held(session_id)
    }

    /// The companion's own process of `session_id` ended. That process may
    /// still be in the last read and in reads that start before it exits;
    /// neither proves that another process holds the session. A read that
    /// took the closing process for another one, while the companion already
    /// counted it as gone, is corrected and the change reported.
    pub fn released(&self, session_id: &str) {
        let was_reported_held = {
            let mut state = self.inner.lock();
            state
                .released_at
                .insert(session_id.to_owned(), Instant::now());
            state.running.remove(session_id);
            state.reported_held.remove(session_id)
        };
        if was_reported_held {
            (self.inner.deps.changed)(&HashSet::from([session_id.to_owned()]));
        }
    }

    /// Stops polling; later reads schedule none.
    pub fn shutdown(&self) {
        let mut state = self.inner.lock();
        state.stopped = true;
        if let Some(poll) = state.poll.take() {
            poll.abort();
        }
    }
}

impl Drop for OpenElsewhere {
    fn drop(&mut self) {
        self.shutdown();
    }
}

impl Inner {
    fn lock(&self) -> MutexGuard<'_, State> {
        self.state.lock().unwrap_or_else(PoisonError::into_inner)
    }

    async fn refresh(self: &Arc<Self>) {
        let fresh = self
            .lock()
            .read_at
            .is_some_and(|read_at| read_at.elapsed() < MAX_AGE);
        if !fresh {
            self.read().await;
        }
    }

    async fn read(self: &Arc<Self>) {
        let reads_before = self.lock().reads;
        let _reading = self.reading.lock().await;
        if self.lock().reads != reads_before {
            // A read that was in flight when this one was asked for ended.
            return;
        }
        self.read_once().await;
    }

    async fn read_once(self: &Arc<Self>) {
        let before = self.held_sessions();
        let started_at = Instant::now();
        let listed = self.deps.running.list().await;
        {
            let mut state = self.lock();
            match listed {
                Ok(listed) => {
                    let state = &mut *state;
                    state.running =
                        without_own_releases(&mut state.released_at, listed, started_at);
                    state.refresh_confirmed = true;
                }
                Err(err) => {
                    state.refresh_confirmed = false;
                    warn!(err = %err, "Claude running sessions read failed");
                }
            }
            state.read_at = Some(Instant::now());
            state.reads += 1;
        }
        let after = self.held_sessions();
        self.lock().reported_held.clone_from(&after);
        let changed: HashSet<String> = before.symmetric_difference(&after).cloned().collect();
        self.schedule_poll(!after.is_empty());
        if !changed.is_empty() {
            (self.deps.changed)(&changed);
        }
    }

    /// The listed sessions no live process of the companion runs.
    fn held_sessions(&self) -> HashSet<String> {
        let mut held = self.lock().running.clone();
        held.retain(|session_id| !(self.deps.owns_live)(session_id));
        held
    }

    fn schedule_poll(self: &Arc<Self>, any_held: bool) {
        let mut state = self.lock();
        state.poll_generation += 1;
        if let Some(poll) = state.poll.take() {
            poll.abort();
        }
        if !any_held || state.stopped {
            return;
        }
        let generation = state.poll_generation;
        let owner = Arc::downgrade(self);
        let interval = self.deps.poll;
        state.poll = Some(tokio::spawn(poll_after(owner, interval, generation)));
    }
}

/// Re-reads after `interval` unless the owner is gone or a newer schedule
/// superseded this one.
async fn poll_after(owner: Weak<Inner>, interval: Duration, generation: u64) {
    tokio::time::sleep(interval).await;
    let Some(inner) = owner.upgrade() else {
        return;
    };
    {
        let mut state = inner.lock();
        if state.poll_generation != generation {
            return;
        }
        // The running poll leaves the slot, so the schedule its own read
        // makes does not abort it.
        state.poll = None;
    }
    inner.read().await;
}

/// `listed` without the sessions the companion released and the CLI still
/// lists. A release ends once a read started after it no longer lists its
/// session (the closed process is gone) or [`RELEASE_TIMEOUT`] after it.
fn without_own_releases(
    released_at: &mut HashMap<String, Instant>,
    mut listed: HashSet<String>,
    started_at: Instant,
) -> HashSet<String> {
    // Without a representable cut-off (less than the timeout since the
    // clock's origin) no release has timed out yet.
    let timed_out_before = started_at.checked_sub(RELEASE_TIMEOUT);
    released_at.retain(|session_id, released| {
        let started_before_release = *released > started_at;
        let timed_out = timed_out_before.is_some_and(|cut_off| *released < cut_off);
        !timed_out && (started_before_release || listed.contains(session_id))
    });
    listed.retain(|session_id| !released_at.contains_key(session_id));
    listed
}

#[cfg(test)]
mod tests;
