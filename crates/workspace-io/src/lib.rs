//! Isolated, deadline-bound access to user workspace paths.
//!
//! Agents' working directories, projects and Git trees can live on a FUSE or
//! network mount (an Arcadia `arc` mount). When its daemon stops answering,
//! every syscall on it blocks uninterruptibly. This crate owns the invariant
//! that such a mount fails only the requests that touch it:
//!
//! - every operation runs on a thread of this crate's own, never on a
//!   runtime worker or the runtime's blocking pool (which the companion's
//!   stores need), and its caller waits at most a deadline;
//! - a mount that can hang (see [`Mount::can_hang`]) has a circuit breaker: a
//!   timed-out operation marks it unhealthy and every later operation on it
//!   fails at once, until a background probe or a late completion shows it
//!   answers again;
//! - at most [`WorkspaceIoConfig::max_in_flight`] operations wait on one such
//!   mount and at most [`WorkspaceIoConfig::max_threads`] in total, so hung
//!   mounts cannot exhaust threads;
//! - the mount of a path is read from the mount table, never from the path.
//!
//! A thread blocked on a hung mount cannot be cancelled: it stays parked until
//! the syscall returns, and the in-flight cap bounds how many there are.
//! Callers must not hold a shared lock or sit in a serial owner while they
//! await an operation; a deadline protects the caller, not its neighbours.

mod mounts;

use std::{
    collections::HashMap,
    io,
    path::{Path, PathBuf},
    sync::{
        Arc, Mutex, OnceLock,
        atomic::{AtomicUsize, Ordering},
    },
    time::Duration,
};

use mounts::MountTable;
pub use mounts::{Mount, mount_of, parse_mountinfo};
use tracing::{info, warn};

/// Limits of [`WorkspaceIo`].
#[derive(Clone, Copy, Debug)]
pub struct WorkspaceIoConfig {
    /// How long a caller waits for one operation by default.
    pub deadline: Duration,
    /// Operations that may wait on one mount that can hang at once.
    pub max_in_flight: usize,
    /// How often an unhealthy mount is probed.
    pub probe_interval: Duration,
    /// Operation threads alive at once, parked ones included.
    pub max_threads: usize,
}

impl Default for WorkspaceIoConfig {
    fn default() -> Self {
        Self {
            deadline: Duration::from_secs(10),
            max_in_flight: 8,
            probe_interval: Duration::from_secs(15),
            max_threads: 128,
        }
    }
}

/// Why a workspace operation did not produce its result.
#[derive(Debug, thiserror::Error)]
pub enum WorkspaceIoError {
    /// The mount timed out earlier and has not answered since.
    #[error("{} is not responding", .mount.display())]
    Unavailable { mount: PathBuf },
    /// The operation did not finish within its deadline.
    #[error("{} did not answer within {} s", .mount.display(), .deadline.as_secs())]
    TimedOut { mount: PathBuf, deadline: Duration },
    /// Too many operations already wait on the mount, or on workspaces at all.
    #[error("too many operations wait on {}", .mount.display())]
    Saturated { mount: PathBuf },
    /// The operation itself failed.
    #[error(transparent)]
    Io(#[from] io::Error),
}

impl From<WorkspaceIoError> for io::Error {
    fn from(error: WorkspaceIoError) -> Self {
        match error {
            WorkspaceIoError::Io(error) => error,
            other => Self::new(io::ErrorKind::TimedOut, other.to_string()),
        }
    }
}

/// Health of one mount that can hang.
#[derive(Default)]
struct MountState {
    in_flight: usize,
    unhealthy: bool,
    probing: bool,
}

type Probe = dyn Fn(&Path) -> io::Result<()> + Send + Sync;

struct Inner {
    config: WorkspaceIoConfig,
    mounts: MountTable,
    states: Mutex<HashMap<PathBuf, MountState>>,
    probe: Box<Probe>,
    /// Operation and probe threads alive now.
    threads: AtomicUsize,
}

/// The process's access to user workspace paths. Cheap to clone.
#[derive(Clone)]
pub struct WorkspaceIo {
    inner: Arc<Inner>,
}

impl WorkspaceIo {
    /// Access over the process's mount table.
    #[must_use]
    pub fn new(config: WorkspaceIoConfig) -> Self {
        Self::with_mounts(config, MountTable::system(), |mount| {
            std::fs::metadata(mount).map(|_| ())
        })
    }

    /// Access over a fixed mount table and probe, for tests.
    #[must_use]
    pub fn with_mount_list(
        config: WorkspaceIoConfig,
        mounts: Vec<Mount>,
        probe: impl Fn(&Path) -> io::Result<()> + Send + Sync + 'static,
    ) -> Self {
        Self::with_mounts(
            config,
            MountTable::with_source(move || mounts.clone()),
            probe,
        )
    }

    fn with_mounts(
        config: WorkspaceIoConfig,
        mounts: MountTable,
        probe: impl Fn(&Path) -> io::Result<()> + Send + Sync + 'static,
    ) -> Self {
        Self {
            inner: Arc::new(Inner {
                config,
                mounts,
                states: Mutex::new(HashMap::new()),
                probe: Box::new(probe),
                threads: AtomicUsize::new(0),
            }),
        }
    }

    /// The access the whole process shares: mount health is process state.
    #[must_use]
    pub fn shared() -> &'static Self {
        static SHARED: OnceLock<WorkspaceIo> = OnceLock::new();
        SHARED.get_or_init(|| Self::new(WorkspaceIoConfig::default()))
    }

    /// Runs `op`, which touches `path`, within the default deadline.
    ///
    /// # Errors
    /// [`WorkspaceIoError`]: the operation's own failure, or the mount of
    /// `path` is unavailable, saturated or timed out.
    pub async fn run<T, F>(&self, path: &Path, op: F) -> Result<T, WorkspaceIoError>
    where
        T: Send + 'static,
        F: FnOnce() -> io::Result<T> + Send + 'static,
    {
        self.run_within(path, self.inner.config.deadline, op).await
    }

    /// Runs `op`, which touches `path`, within `deadline`.
    ///
    /// # Errors
    /// As [`Self::run`].
    pub async fn run_within<T, F>(
        &self,
        path: &Path,
        deadline: Duration,
        op: F,
    ) -> Result<T, WorkspaceIoError>
    where
        T: Send + 'static,
        F: FnOnce() -> io::Result<T> + Send + 'static,
    {
        let mount = self.inner.mounts.lookup(path);
        let guarded = mount.as_ref().filter(|mount| mount.can_hang()).cloned();
        let key = mount.map_or_else(|| path.to_path_buf(), |mount| mount.point);
        if let Some(guarded) = &guarded {
            self.admit(&guarded.point)?;
        }
        let mut completion = guarded.as_ref().map(|mount| Completion {
            io: self.clone(),
            mount: mount.point.clone(),
            succeeded: false,
        });
        let task = self.spawn(move || {
            let result = op();
            if let Some(completion) = &mut completion {
                completion.succeeded = result.is_ok();
            }
            drop(completion);
            result
        });
        let Some(task) = task else {
            return Err(WorkspaceIoError::Saturated { mount: key });
        };
        match tokio::time::timeout(deadline, task).await {
            Ok(Ok(result)) => result.map_err(WorkspaceIoError::Io),
            Ok(Err(_)) => Err(WorkspaceIoError::Io(io::Error::other(
                "workspace operation thread ended without a result",
            ))),
            Err(_) => {
                if let Some(guarded) = guarded {
                    self.trip(&guarded);
                }
                Err(WorkspaceIoError::TimedOut {
                    mount: key,
                    deadline,
                })
            }
        }
    }

    /// `std::fs::canonicalize` of a workspace path.
    ///
    /// # Errors
    /// The filesystem's error, or [`io::ErrorKind::TimedOut`] when the mount
    /// is unavailable, saturated or timed out.
    pub async fn canonicalize(&self, path: impl AsRef<Path>) -> io::Result<PathBuf> {
        let path = path.as_ref();
        let owned = path.to_path_buf();
        Ok(self.run(path, move || std::fs::canonicalize(owned)).await?)
    }

    /// `std::fs::metadata` of a workspace path.
    ///
    /// # Errors
    /// As [`Self::canonicalize`].
    pub async fn metadata(&self, path: impl AsRef<Path>) -> io::Result<std::fs::Metadata> {
        let path = path.as_ref();
        let owned = path.to_path_buf();
        Ok(self.run(path, move || std::fs::metadata(owned)).await?)
    }

    /// `std::fs::read` of a workspace file within `deadline`.
    ///
    /// # Errors
    /// As [`Self::canonicalize`].
    pub async fn read_within(
        &self,
        path: impl AsRef<Path>,
        deadline: Duration,
    ) -> io::Result<Vec<u8>> {
        let path = path.as_ref();
        let owned = path.to_path_buf();
        Ok(self
            .run_within(path, deadline, move || std::fs::read(owned))
            .await?)
    }

    /// Runs `op` on a new thread of this crate's own, inside the caller's
    /// runtime so it may spawn `tokio::process` children; `None` at the
    /// thread cap. A dropped receiver leaves the thread to finish alone.
    fn spawn<T, F>(&self, op: F) -> Option<tokio::sync::oneshot::Receiver<T>>
    where
        T: Send + 'static,
        F: FnOnce() -> T + Send + 'static,
    {
        let threads = &self.inner.threads;
        if threads.fetch_add(1, Ordering::SeqCst) >= self.inner.config.max_threads {
            threads.fetch_sub(1, Ordering::SeqCst);
            return None;
        }
        let (sender, receiver) = tokio::sync::oneshot::channel();
        let runtime = tokio::runtime::Handle::try_current().ok();
        let io = self.clone();
        let spawned = std::thread::Builder::new()
            .name("workspace-io".into())
            .spawn(move || {
                let _alive = ThreadSlot(io);
                let _runtime = runtime.as_ref().map(tokio::runtime::Handle::enter);
                let _ = sender.send(op());
            });
        if spawned.is_err() {
            threads.fetch_sub(1, Ordering::SeqCst);
            return None;
        }
        Some(receiver)
    }

    /// Whether operations on the mount of `path` currently fail at once.
    #[must_use]
    pub fn is_unavailable(&self, path: &Path) -> bool {
        let Some(mount) = self.inner.mounts.lookup(path).filter(Mount::can_hang) else {
            return false;
        };
        self.states()
            .get(&mount.point)
            .is_some_and(|state| state.unhealthy)
    }

    fn states(&self) -> std::sync::MutexGuard<'_, HashMap<PathBuf, MountState>> {
        self.inner
            .states
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    fn admit(&self, mount: &Path) -> Result<(), WorkspaceIoError> {
        let mut states = self.states();
        let state = states.entry(mount.to_path_buf()).or_default();
        if state.unhealthy {
            return Err(WorkspaceIoError::Unavailable {
                mount: mount.to_path_buf(),
            });
        }
        if state.in_flight >= self.inner.config.max_in_flight {
            return Err(WorkspaceIoError::Saturated {
                mount: mount.to_path_buf(),
            });
        }
        state.in_flight += 1;
        Ok(())
    }

    /// Marks `mount` unhealthy after a timeout and starts its probe.
    fn trip(&self, mount: &Mount) {
        let start_probe = {
            let mut states = self.states();
            let state = states.entry(mount.point.clone()).or_default();
            if !state.unhealthy {
                warn!(
                    mount = %mount.point.display(),
                    fs_type = %mount.fs_type,
                    "workspace mount stopped answering; failing its operations until it recovers"
                );
            }
            state.unhealthy = true;
            !std::mem::replace(&mut state.probing, true)
        };
        if start_probe {
            let io = self.clone();
            let point = mount.point.clone();
            tokio::spawn(async move { io.probe_until_healthy(point).await });
        }
    }

    /// Probes `mount` until it answers. A probe stuck on the mount is never
    /// duplicated: the next one starts only after it returns.
    async fn probe_until_healthy(self, mount: PathBuf) {
        let mut pending: Option<tokio::sync::oneshot::Receiver<io::Result<()>>> = None;
        loop {
            tokio::time::sleep(self.inner.config.probe_interval).await;
            if !self
                .states()
                .get(&mount)
                .is_some_and(|state| state.unhealthy)
            {
                break;
            }
            let handle = pending.take().or_else(|| {
                let io = self.clone();
                let point = mount.clone();
                self.spawn(move || (io.inner.probe)(&point))
            });
            let Some(mut handle) = handle else {
                continue;
            };
            match handle.try_recv() {
                Err(tokio::sync::oneshot::error::TryRecvError::Empty) => pending = Some(handle),
                Ok(Ok(())) => {
                    self.recover(&mount);
                    break;
                }
                Ok(Err(_)) | Err(tokio::sync::oneshot::error::TryRecvError::Closed) => {}
            }
        }
        if let Some(state) = self.states().get_mut(&mount) {
            state.probing = false;
        }
    }

    fn recover(&self, mount: &Path) {
        let mut states = self.states();
        if let Some(state) = states.get_mut(mount)
            && std::mem::take(&mut state.unhealthy)
        {
            info!(mount = %mount.display(), "workspace mount answers again");
        }
    }
}

/// Frees a thread of the cap when the thread ends, however it ends.
struct ThreadSlot(WorkspaceIo);

impl Drop for ThreadSlot {
    fn drop(&mut self) {
        self.0.inner.threads.fetch_sub(1, Ordering::SeqCst);
    }
}

/// Releases an operation's in-flight slot when its blocking thread returns
/// or unwinds, even long after the caller gave up; a success proves the
/// mount answers.
struct Completion {
    io: WorkspaceIo,
    mount: PathBuf,
    succeeded: bool,
}

impl Drop for Completion {
    fn drop(&mut self) {
        if let Some(state) = self.io.states().get_mut(&self.mount) {
            state.in_flight = state.in_flight.saturating_sub(1);
        }
        if self.succeeded {
            self.io.recover(&self.mount);
        }
    }
}

#[cfg(test)]
mod tests;
