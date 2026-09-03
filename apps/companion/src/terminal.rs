use std::{
    collections::HashMap,
    env, fmt,
    io::{Read, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
    sync::{
        Arc, Mutex, MutexGuard,
        atomic::{AtomicBool, AtomicUsize, Ordering},
        mpsc as std_mpsc,
    },
    time::{Duration, Instant},
};

use axum::{
    extract::ws::{CloseFrame, Message, WebSocket},
    http::StatusCode,
};
use futures_util::SinkExt;
use portable_pty::{Child, CommandBuilder, ExitStatus, MasterPty, PtySize, native_pty_system};
use serde::Deserialize;
use tokio::sync::{OwnedSemaphorePermit, Semaphore, broadcast, mpsc, watch};

use crate::auth::AuthorizationChange;

mod legacy;
pub(crate) mod v2;

pub use legacy::{bridge, bridge_resumable};

const DEFAULT_COLS: u16 = 80;
const DEFAULT_ROWS: u16 = 24;
const MAX_COLS: u16 = 500;
const MAX_ROWS: u16 = 300;
const MAX_INPUT_BYTES: usize = 1024 * 1024;
const OUTPUT_CHUNK_BYTES: usize = 64 * 1024;
const REPLAY_MEMORY_BYTES: u64 = 4 * 1024 * 1024;
const MAX_REPLAY_BYTES_PER_OWNER: u64 = 256 * 1024 * 1024;
const MAX_REPLAY_BYTES_GLOBAL: u64 = 1024 * 1024 * 1024;
const COMPLETED_RETENTION: Duration = Duration::from_mins(15);
const DETACHED_IDLE_TTL: Duration = Duration::from_hours(24);
const TERMINAL_EXITED_CLOSE_CODE: u16 = 4000;
const TERMINAL_REPLAY_CLOSE_CODE: u16 = 4004;
const TERMINAL_RESOURCE_CLOSE_CODE: u16 = 4008;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalQuery {
    pub cwd: Option<String>,
    pub thread_id: Option<String>,
    pub cols: Option<u16>,
    pub rows: Option<u16>,
    pub session_id: Option<String>,
    pub offset: Option<u64>,
    pub create: Option<bool>,
}

#[derive(Debug)]
pub enum TerminalError {
    InvalidSize,
    InvalidCwd,
    InvalidThread,
    ThreadNotFound,
    ThreadResolutionFailed { reason: String },
    SessionThreadMismatch,
    InvalidSession,
    SessionNotFound,
    SessionOwnedByAnotherDevice,
    AuthorizationUnavailable,
    SessionLimitReached,
    ReplayUnavailable,
    GenerationChanged,
    SpawnFailed { stage: &'static str, reason: String },
}

impl TerminalError {
    #[must_use]
    pub const fn status(&self) -> StatusCode {
        match self {
            Self::InvalidSize | Self::InvalidCwd | Self::InvalidThread | Self::InvalidSession => {
                StatusCode::BAD_REQUEST
            }
            Self::ThreadNotFound | Self::SessionNotFound => StatusCode::NOT_FOUND,
            Self::SessionOwnedByAnotherDevice | Self::AuthorizationUnavailable => {
                StatusCode::FORBIDDEN
            }
            Self::SessionLimitReached => StatusCode::TOO_MANY_REQUESTS,
            Self::SessionThreadMismatch => StatusCode::UNPROCESSABLE_ENTITY,
            Self::ReplayUnavailable | Self::GenerationChanged => StatusCode::CONFLICT,
            Self::ThreadResolutionFailed { .. } | Self::SpawnFailed { .. } => {
                StatusCode::INTERNAL_SERVER_ERROR
            }
        }
    }

    #[must_use]
    pub const fn code(&self) -> &'static str {
        match self {
            Self::InvalidSize => "terminal_size_invalid",
            Self::InvalidCwd => "terminal_cwd_invalid",
            Self::InvalidThread => "terminal_thread_invalid",
            Self::ThreadNotFound => "terminal_thread_not_found",
            Self::ThreadResolutionFailed { .. } => "terminal_thread_resolution_failed",
            Self::SessionThreadMismatch => "terminal_session_thread_mismatch",
            Self::InvalidSession => "terminal_session_invalid",
            Self::SessionNotFound => "terminal_session_not_found",
            Self::SessionOwnedByAnotherDevice => "terminal_session_owner_mismatch",
            Self::AuthorizationUnavailable => "terminal_authorization_unavailable",
            Self::SessionLimitReached => "terminal_limit_reached",
            Self::ReplayUnavailable => "terminal_replay_unavailable",
            Self::GenerationChanged => "terminal_generation_changed",
            Self::SpawnFailed { .. } => "terminal_spawn_failed",
        }
    }

    fn spawn_failed(stage: &'static str, error: impl fmt::Display) -> Self {
        Self::SpawnFailed {
            stage,
            reason: error.to_string(),
        }
    }

    pub fn thread_resolution_failed(error: impl fmt::Display) -> Self {
        Self::ThreadResolutionFailed {
            reason: error.to_string(),
        }
    }
}

impl fmt::Display for TerminalError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidSize => formatter.write_str("terminal size is invalid"),
            Self::InvalidCwd => formatter.write_str("terminal working directory is invalid"),
            Self::InvalidThread => formatter.write_str("terminal thread id is invalid"),
            Self::ThreadNotFound => formatter.write_str("terminal thread was not found"),
            Self::ThreadResolutionFailed { reason } => {
                write!(formatter, "terminal thread resolution failed: {reason}")
            }
            Self::SessionThreadMismatch => {
                formatter.write_str("terminal session belongs to another thread")
            }
            Self::InvalidSession => formatter.write_str("terminal session id is invalid"),
            Self::SessionNotFound => formatter.write_str("terminal session was not found"),
            Self::SessionOwnedByAnotherDevice => {
                formatter.write_str("terminal session belongs to another device")
            }
            Self::AuthorizationUnavailable => {
                formatter.write_str("terminal session authorization is unavailable")
            }
            Self::SessionLimitReached => formatter.write_str("terminal session limit reached"),
            Self::ReplayUnavailable => formatter.write_str("terminal replay cursor is unavailable"),
            Self::GenerationChanged => {
                formatter.write_str("terminal session belongs to another V2 generation")
            }
            Self::SpawnFailed { stage, reason } => {
                write!(formatter, "terminal {stage} failed: {reason}")
            }
        }
    }
}

impl std::error::Error for TerminalError {}

/// Verifies that the host can allocate a pseudo-terminal before the companion
/// advertises a healthy terminal transport.
///
/// # Errors
///
/// Returns the underlying PTY allocation failure with its startup stage.
pub fn preflight() -> Result<(), TerminalError> {
    let size = validate_size(None, None)?;
    let pair = native_pty_system()
        .openpty(size)
        .map_err(|error| TerminalError::spawn_failed("openpty preflight", error))?;
    drop(pair);
    Ok(())
}

pub struct TerminalSession {
    master: Box<dyn MasterPty + Send>,
    child: Box<dyn Child + Send + Sync>,
    reader: Box<dyn Read + Send>,
    writer: Box<dyn Write + Send>,
}

pub struct TerminalAuthorization {
    device_id: String,
    changes: tokio::sync::broadcast::Receiver<AuthorizationChange>,
}

impl TerminalAuthorization {
    #[must_use]
    pub const fn new(
        device_id: String,
        changes: tokio::sync::broadcast::Receiver<AuthorizationChange>,
    ) -> Self {
        Self { device_id, changes }
    }
}

impl TerminalSession {
    /// Starts a private pseudo-terminal using the requested dimensions and
    /// working directory.
    ///
    /// # Errors
    ///
    /// Returns an error when the terminal size or working directory is invalid,
    /// or when the platform cannot create or start the pseudo-terminal.
    pub fn spawn(query: &TerminalQuery) -> Result<Self, TerminalError> {
        let size = validate_size(query.cols, query.rows)?;
        let cwd = resolve_cwd(query.cwd.as_deref())?;
        let pair = native_pty_system()
            .openpty(size)
            .map_err(|error| TerminalError::spawn_failed("openpty", error))?;
        let shell = resolve_shell();
        let mut command = CommandBuilder::new(shell);
        command.cwd(cwd);
        command.env("TERM", "xterm-256color");
        command.env("COLORTERM", "truecolor");
        command.env("TERM_PROGRAM", "CodeWide");
        let child = pair
            .slave
            .spawn_command(command)
            .map_err(|error| TerminalError::spawn_failed("shell spawn", error))?;
        drop(pair.slave);
        let reader = pair
            .master
            .try_clone_reader()
            .map_err(|error| TerminalError::spawn_failed("reader clone", error))?;
        let writer = pair
            .master
            .take_writer()
            .map_err(|error| TerminalError::spawn_failed("writer acquisition", error))?;
        Ok(Self {
            master: pair.master,
            child,
            reader,
            writer,
        })
    }
}

#[derive(Clone)]
pub struct TerminalRegistry {
    inner: Arc<TerminalRegistryInner>,
}

struct TerminalRegistryInner {
    sessions: Mutex<HashMap<TerminalRegistryKey, Arc<LiveTerminal>>>,
    slots: Arc<Semaphore>,
    replay_quota: Arc<ReplayQuota>,
}

pub struct LiveTerminal {
    id: String,
    protocol: TerminalProtocol,
    generation: Option<u64>,
    owner: String,
    thread_id: Option<String>,
    commands: std_mpsc::SyncSender<WriterCommand>,
    output: broadcast::Sender<ReplayChunk>,
    state: watch::Sender<TerminalState>,
    replay: Mutex<ReplayBuffer>,
    attached: AtomicUsize,
    exited: AtomicBool,
    closing: AtomicBool,
    authority_revoked: AtomicBool,
    last_activity: Mutex<Instant>,
    permit: Mutex<Option<OwnedSemaphorePermit>>,
}

struct LiveTerminalStart {
    id: String,
    protocol: TerminalProtocol,
    generation: Option<u64>,
    owner: String,
    thread_id: Option<String>,
    replay_quota: Arc<ReplayQuota>,
}

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
enum TerminalProtocol {
    Legacy,
    V2,
}

#[derive(Clone, Debug, Eq, Hash, PartialEq)]
struct TerminalRegistryKey {
    protocol: TerminalProtocol,
    session_id: String,
}

#[derive(Clone)]
struct ReplayChunk {
    start: u64,
    bytes: Arc<[u8]>,
}

impl fmt::Debug for ReplayChunk {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("ReplayChunk")
            .field("start", &self.start)
            .field("byte_count", &self.bytes.len())
            .finish()
    }
}

struct ReplayBuffer {
    owner: String,
    quota: Arc<ReplayQuota>,
    memory_limit: u64,
    end: u64,
    storage: ReplayStorage,
}

enum ReplayStorage {
    Memory(Vec<u8>),
    Disk(tempfile::NamedTempFile),
}

struct ReplayQuota {
    owner_limit: u64,
    global_limit: u64,
    usage: Mutex<ReplayQuotaUsage>,
}

#[derive(Default)]
struct ReplayQuotaUsage {
    global: u64,
    owners: HashMap<String, u64>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum ReplayFailure {
    OwnerQuotaExceeded,
    GlobalQuotaExceeded,
    StorageUnavailable,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum ReplayReadError {
    Unavailable,
    Failed(ReplayFailure),
}

#[derive(Clone, Debug, Eq, PartialEq)]
enum TerminalState {
    Running,
    Exited(TerminalExit),
    Failed(ReplayFailure),
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct TerminalExit {
    exit_code: Option<u32>,
    signal: Option<String>,
}

impl TerminalExit {
    fn from_status(status: Option<ExitStatus>) -> Self {
        Self {
            exit_code: status.as_ref().map(ExitStatus::exit_code),
            signal: status.and_then(|value| value.signal().map(str::to_owned)),
        }
    }
}

struct AttachmentGuard {
    terminal: Arc<LiveTerminal>,
}

impl Drop for AttachmentGuard {
    fn drop(&mut self) {
        self.terminal.attached.fetch_sub(1, Ordering::AcqRel);
        self.terminal.touch();
    }
}

impl TerminalRegistry {
    #[must_use]
    pub fn new(max_sessions: usize) -> Self {
        Self {
            inner: Arc::new(TerminalRegistryInner {
                sessions: Mutex::new(HashMap::new()),
                slots: Arc::new(Semaphore::new(max_sessions)),
                replay_quota: Arc::new(ReplayQuota::new(
                    MAX_REPLAY_BYTES_PER_OWNER,
                    MAX_REPLAY_BYTES_GLOBAL,
                )),
            }),
        }
    }

    /// Reserves one process slot for a legacy socket-owned terminal.
    ///
    /// # Errors
    ///
    /// Returns `terminal_limit_reached` when all process slots are occupied.
    pub fn legacy_permit(&self) -> Result<OwnedSemaphorePermit, TerminalError> {
        self.inner
            .slots
            .clone()
            .try_acquire_owned()
            .map_err(|_| TerminalError::SessionLimitReached)
    }

    /// Finds or creates a companion-owned terminal process.
    ///
    /// # Errors
    ///
    /// Rejects invalid identifiers, owner mismatches, missing sessions and
    /// process allocation failures.
    pub fn attach_or_create(
        &self,
        owner: &str,
        query: &TerminalQuery,
        authorization: Option<TerminalAuthorization>,
        spawn: impl FnOnce() -> Result<TerminalSession, TerminalError>,
    ) -> Result<Arc<LiveTerminal>, TerminalError> {
        self.attach_or_create_inner(
            TerminalProtocol::Legacy,
            None,
            owner,
            query,
            authorization,
            spawn,
        )
    }

    /// Finds or creates a V2 terminal qualified by protocol, audience, and generation.
    pub(crate) fn attach_or_create_v2(
        &self,
        owner: &str,
        generation: u64,
        query: &TerminalQuery,
        spawn: impl FnOnce() -> Result<TerminalSession, TerminalError>,
    ) -> Result<Arc<LiveTerminal>, TerminalError> {
        self.attach_or_create_inner(
            TerminalProtocol::V2,
            Some(generation),
            owner,
            query,
            None,
            spawn,
        )
    }

    /// Revokes the least recently used detached V2 shell for one authenticated device.
    ///
    /// This is the bounded recovery path for a client that lost its durable
    /// terminal registry during process/storage recovery. Attached terminals
    /// and terminals owned by another device are never candidates.
    pub(crate) fn reclaim_oldest_detached_v2(&self, owner: &str) -> bool {
        let candidate = {
            let sessions = lock(&self.inner.sessions);
            sessions
                .values()
                .filter(|terminal| {
                    terminal.protocol == TerminalProtocol::V2
                        && terminal.owner == owner
                        && terminal.attached.load(Ordering::Acquire) == 0
                        && !terminal.exited.load(Ordering::Acquire)
                })
                .min_by_key(|terminal| *lock(&terminal.last_activity))
                .cloned()
        };
        let Some(candidate) = candidate else {
            return false;
        };
        candidate.revoke();
        true
    }

    fn attach_or_create_inner(
        &self,
        protocol: TerminalProtocol,
        generation: Option<u64>,
        owner: &str,
        query: &TerminalQuery,
        authorization: Option<TerminalAuthorization>,
        spawn: impl FnOnce() -> Result<TerminalSession, TerminalError>,
    ) -> Result<Arc<LiveTerminal>, TerminalError> {
        let session_id = query
            .session_id
            .as_deref()
            .filter(|value| valid_session_id(value))
            .ok_or(TerminalError::InvalidSession)?;
        let key = TerminalRegistryKey {
            protocol,
            session_id: session_id.to_owned(),
        };

        {
            let mut sessions = lock(&self.inner.sessions);
            if let Some(existing) = sessions.get(&key).cloned() {
                if existing.owner != owner {
                    return Err(TerminalError::SessionOwnedByAnotherDevice);
                }
                if existing.generation == generation {
                    if existing.thread_id != query.thread_id {
                        return Err(TerminalError::SessionThreadMismatch);
                    }
                    if !existing.exited.load(Ordering::Acquire) {
                        existing.resize(validate_size(query.cols, query.rows)?)?;
                    }
                    return Ok(existing);
                }
                existing.close();
                if sessions
                    .get(&key)
                    .is_some_and(|candidate| Arc::ptr_eq(candidate, &existing))
                {
                    sessions.remove(&key);
                }
                if query.create == Some(false) {
                    return Err(TerminalError::GenerationChanged);
                }
            }
        }
        if query.create == Some(false) {
            return Err(TerminalError::SessionNotFound);
        }

        let permit = self.legacy_permit()?;
        let session = spawn()?;
        let live = LiveTerminal::start(
            LiveTerminalStart {
                id: session_id.to_owned(),
                protocol,
                generation,
                owner: owner.to_owned(),
                thread_id: query.thread_id.clone(),
                replay_quota: Arc::clone(&self.inner.replay_quota),
            },
            session,
            permit,
        );
        {
            let mut sessions = lock(&self.inner.sessions);
            if let Some(existing) = sessions.get(&key) {
                live.close();
                if existing.owner != owner {
                    return Err(TerminalError::SessionOwnedByAnotherDevice);
                }
                if existing.thread_id != query.thread_id {
                    return Err(TerminalError::SessionThreadMismatch);
                }
                if existing.generation != generation {
                    return Err(TerminalError::GenerationChanged);
                }
                return Ok(Arc::clone(existing));
            }
            sessions.insert(key, Arc::clone(&live));
        }
        if let Some(authorization) = authorization {
            live.watch_authorization(authorization);
        }
        self.schedule_cleanup(&live);
        Ok(live)
    }

    fn schedule_cleanup(&self, terminal: &Arc<LiveTerminal>) {
        let registry = Arc::downgrade(&self.inner);
        let terminal = Arc::downgrade(terminal);
        tokio::spawn(async move {
            loop {
                tokio::time::sleep(Duration::from_mins(1)).await;
                let Some(terminal) = terminal.upgrade() else {
                    return;
                };
                let elapsed = lock(&terminal.last_activity).elapsed();
                if terminal.exited.load(Ordering::Acquire) {
                    if elapsed < COMPLETED_RETENTION {
                        continue;
                    }
                } else if terminal.attached.load(Ordering::Acquire) == 0
                    && elapsed >= DETACHED_IDLE_TTL
                {
                    terminal.close();
                    continue;
                } else {
                    continue;
                }
                let Some(registry) = registry.upgrade() else {
                    return;
                };
                let mut sessions = lock(&registry.sessions);
                let key = TerminalRegistryKey {
                    protocol: terminal.protocol,
                    session_id: terminal.id.clone(),
                };
                if sessions
                    .get(&key)
                    .is_some_and(|candidate| Arc::ptr_eq(candidate, &terminal))
                {
                    sessions.remove(&key);
                }
                return;
            }
        });
    }
}

impl LiveTerminal {
    fn start(
        input: LiveTerminalStart,
        session: TerminalSession,
        permit: OwnedSemaphorePermit,
    ) -> Arc<Self> {
        let (commands, command_rx) = std_mpsc::sync_channel(64);
        let (output, _) = broadcast::channel(128);
        let (state, _) = watch::channel(TerminalState::Running);
        let replay =
            ReplayBuffer::new(input.owner.clone(), input.replay_quota, REPLAY_MEMORY_BYTES);
        let terminal = Arc::new(Self {
            id: input.id,
            protocol: input.protocol,
            generation: input.generation,
            owner: input.owner,
            thread_id: input.thread_id,
            commands,
            output,
            state,
            replay: Mutex::new(replay),
            attached: AtomicUsize::new(0),
            exited: AtomicBool::new(false),
            closing: AtomicBool::new(false),
            authority_revoked: AtomicBool::new(false),
            last_activity: Mutex::new(Instant::now()),
            permit: Mutex::new(Some(permit)),
        });

        let reader_terminal = Arc::downgrade(&terminal);
        let mut reader = session.reader;
        std::thread::spawn(move || {
            let mut buffer = vec![0_u8; OUTPUT_CHUNK_BYTES];
            loop {
                let count = match reader.read(&mut buffer) {
                    Ok(0) | Err(_) => break,
                    Ok(count) => count,
                };
                let Some(terminal) = reader_terminal.upgrade() else {
                    break;
                };
                if terminal.append_output(&buffer[..count]).is_err() {
                    break;
                }
            }
        });

        let control_terminal = Arc::downgrade(&terminal);
        std::thread::spawn(move || {
            let master = session.master;
            let mut writer = session.writer;
            let mut child = session.child;
            loop {
                if control_terminal
                    .upgrade()
                    .is_some_and(|terminal| terminal.authority_revoked.load(Ordering::Acquire))
                {
                    let _ = child.kill();
                    break;
                }
                match command_rx.recv_timeout(Duration::from_millis(100)) {
                    Ok(WriterCommand::Input(bytes)) => {
                        if control_terminal.upgrade().is_some_and(|terminal| {
                            terminal.authority_revoked.load(Ordering::Acquire)
                        }) {
                            let _ = child.kill();
                            break;
                        }
                        if writer
                            .write_all(&bytes)
                            .and_then(|()| writer.flush())
                            .is_err()
                        {
                            break;
                        }
                    }
                    Ok(WriterCommand::Resize(size)) => {
                        if master.resize(size).is_err() {
                            break;
                        }
                    }
                    Ok(WriterCommand::Close) | Err(std_mpsc::RecvTimeoutError::Disconnected) => {
                        let _ = child.kill();
                        break;
                    }
                    Err(std_mpsc::RecvTimeoutError::Timeout) => {}
                }
                match child.try_wait() {
                    Ok(Some(_)) | Err(_) => break,
                    Ok(None) => {}
                }
            }
            let status = child.wait().ok();
            if let Some(terminal) = control_terminal.upgrade() {
                terminal.mark_exited(status);
            }
            drop(master);
        });

        terminal
    }

    fn append_output(&self, bytes: &[u8]) -> Result<(), ReplayFailure> {
        if bytes.is_empty()
            || self.exited.load(Ordering::Acquire)
            || self.closing.load(Ordering::Acquire)
            || self.authority_revoked.load(Ordering::Acquire)
        {
            return Ok(());
        }
        let chunk = {
            let mut replay = lock(&self.replay);
            match replay.append(bytes) {
                Ok(chunk) => chunk,
                Err(failure) => {
                    drop(replay);
                    self.mark_failed(failure);
                    return Err(failure);
                }
            }
        };
        self.touch();
        let _ = self.output.send(chunk);
        Ok(())
    }

    fn resize(&self, size: PtySize) -> Result<(), TerminalError> {
        self.commands
            .try_send(WriterCommand::Resize(size))
            .map_err(|_| TerminalError::SessionNotFound)
    }

    fn close(&self) {
        if self.closing.swap(true, Ordering::AcqRel) {
            return;
        }
        lock(&self.replay).clear();
        let _ = self.commands.send(WriterCommand::Close);
    }

    pub(crate) fn revoke(&self) {
        self.authority_revoked.store(true, Ordering::Release);
        self.close();
    }

    pub(crate) async fn revoke_and_wait(&self) {
        let mut state = self.state.subscribe();
        self.revoke();
        loop {
            let current = state.borrow_and_update().clone();
            if matches!(current, TerminalState::Exited(_) | TerminalState::Failed(_)) {
                break;
            }
            if state.changed().await.is_err() {
                break;
            }
        }
    }

    fn mark_exited(&self, status: Option<ExitStatus>) {
        if self.exited.swap(true, Ordering::AcqRel) {
            return;
        }
        self.touch();
        lock(&self.permit).take();
        if !matches!(*self.state.borrow(), TerminalState::Failed(_)) {
            self.state
                .send_replace(TerminalState::Exited(TerminalExit::from_status(status)));
        }
    }

    fn mark_failed(&self, failure: ReplayFailure) {
        if self.exited.load(Ordering::Acquire) {
            return;
        }
        self.state.send_replace(TerminalState::Failed(failure));
        self.close();
    }

    fn touch(&self) {
        *lock(&self.last_activity) = Instant::now();
    }

    fn attach(self: &Arc<Self>) -> AttachmentGuard {
        self.attached.fetch_add(1, Ordering::AcqRel);
        self.touch();
        AttachmentGuard {
            terminal: Arc::clone(self),
        }
    }

    fn watch_authorization(self: &Arc<Self>, mut authorization: TerminalAuthorization) {
        let terminal = Arc::downgrade(self);
        tokio::spawn(async move {
            loop {
                match authorization.changes.recv().await {
                    Ok(change) if change.device_id == authorization.device_id => {
                        if let Some(terminal) = terminal.upgrade() {
                            terminal.revoke();
                        }
                        return;
                    }
                    Err(broadcast::error::RecvError::Lagged(_)) => {
                        if let Some(terminal) = terminal.upgrade() {
                            terminal.revoke();
                        }
                        return;
                    }
                    Err(broadcast::error::RecvError::Closed) => return,
                    Ok(_) => {}
                }
            }
        });
    }
}

impl ReplayQuota {
    fn new(owner_limit: u64, global_limit: u64) -> Self {
        Self {
            owner_limit,
            global_limit,
            usage: Mutex::new(ReplayQuotaUsage::default()),
        }
    }

    fn reserve(&self, owner: &str, bytes: u64) -> Result<(), ReplayFailure> {
        let mut usage = lock(&self.usage);
        let owner_usage = usage.owners.get(owner).copied().unwrap_or(0);
        let next_owner = owner_usage
            .checked_add(bytes)
            .ok_or(ReplayFailure::OwnerQuotaExceeded)?;
        if next_owner > self.owner_limit {
            return Err(ReplayFailure::OwnerQuotaExceeded);
        }
        let next_global = usage
            .global
            .checked_add(bytes)
            .ok_or(ReplayFailure::GlobalQuotaExceeded)?;
        if next_global > self.global_limit {
            return Err(ReplayFailure::GlobalQuotaExceeded);
        }
        usage.global = next_global;
        usage.owners.insert(owner.to_owned(), next_owner);
        Ok(())
    }

    fn release(&self, owner: &str, bytes: u64) {
        let mut usage = lock(&self.usage);
        usage.global = usage.global.saturating_sub(bytes);
        let Some(owner_usage) = usage.owners.get_mut(owner) else {
            return;
        };
        *owner_usage = owner_usage.saturating_sub(bytes);
        if *owner_usage == 0 {
            usage.owners.remove(owner);
        }
    }
}

impl ReplayBuffer {
    fn new(owner: String, quota: Arc<ReplayQuota>, memory_limit: u64) -> Self {
        Self {
            owner,
            quota,
            memory_limit,
            end: 0,
            storage: ReplayStorage::Memory(Vec::new()),
        }
    }

    fn append(&mut self, bytes: &[u8]) -> Result<ReplayChunk, ReplayFailure> {
        let byte_count =
            u64::try_from(bytes.len()).map_err(|_| ReplayFailure::StorageUnavailable)?;
        self.quota.reserve(&self.owner, byte_count)?;
        if let Err(failure) = self.append_reserved(bytes) {
            self.quota.release(&self.owner, byte_count);
            return Err(failure);
        }
        let chunk = ReplayChunk {
            start: self.end,
            bytes: Arc::from(bytes),
        };
        self.end += byte_count;
        Ok(chunk)
    }

    fn append_reserved(&mut self, bytes: &[u8]) -> Result<(), ReplayFailure> {
        let byte_count =
            u64::try_from(bytes.len()).map_err(|_| ReplayFailure::StorageUnavailable)?;
        if matches!(self.storage, ReplayStorage::Memory(_))
            && self.end.saturating_add(byte_count) > self.memory_limit
        {
            let mut file =
                tempfile::NamedTempFile::new().map_err(|_| ReplayFailure::StorageUnavailable)?;
            let ReplayStorage::Memory(memory) = &self.storage else {
                unreachable!();
            };
            file.write_all(memory)
                .map_err(|_| ReplayFailure::StorageUnavailable)?;
            self.storage = ReplayStorage::Disk(file);
        }
        match &mut self.storage {
            ReplayStorage::Memory(memory) => memory.extend_from_slice(bytes),
            ReplayStorage::Disk(file) => {
                file.as_file_mut()
                    .seek(SeekFrom::End(0))
                    .and_then(|_| file.write_all(bytes))
                    .map_err(|_| ReplayFailure::StorageUnavailable)?;
            }
        }
        Ok(())
    }

    fn read_chunk(&mut self, offset: u64) -> Result<Option<ReplayChunk>, ReplayReadError> {
        if offset > self.end {
            return Err(ReplayReadError::Unavailable);
        }
        if offset == self.end {
            return Ok(None);
        }
        let count = usize::try_from((self.end - offset).min(OUTPUT_CHUNK_BYTES as u64))
            .map_err(|_| ReplayReadError::Failed(ReplayFailure::StorageUnavailable))?;
        let mut bytes = vec![0_u8; count];
        match &mut self.storage {
            ReplayStorage::Memory(memory) => {
                let start = usize::try_from(offset)
                    .map_err(|_| ReplayReadError::Failed(ReplayFailure::StorageUnavailable))?;
                bytes.copy_from_slice(&memory[start..start + count]);
            }
            ReplayStorage::Disk(file) => {
                file.as_file_mut()
                    .seek(SeekFrom::Start(offset))
                    .and_then(|_| file.read_exact(&mut bytes))
                    .map_err(|_| ReplayReadError::Failed(ReplayFailure::StorageUnavailable))?;
            }
        }
        Ok(Some(ReplayChunk {
            start: offset,
            bytes: Arc::from(bytes),
        }))
    }

    fn contains_offset(&self, offset: u64) -> bool {
        offset <= self.end
    }

    fn clear(&mut self) {
        self.quota.release(&self.owner, self.end);
        self.end = 0;
        self.storage = ReplayStorage::Memory(Vec::new());
    }
}

impl Drop for ReplayBuffer {
    fn drop(&mut self) {
        self.clear();
    }
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    match mutex.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    }
}

fn valid_session_id(value: &str) -> bool {
    value.len() == 45
        && value.starts_with("terminal-")
        && value[9..]
            .bytes()
            .enumerate()
            .all(|(index, byte)| match index {
                8 | 13 | 18 | 23 => byte == b'-',
                _ => byte.is_ascii_hexdigit(),
            })
}

enum WriterCommand {
    Input(Vec<u8>),
    Resize(PtySize),
    Close,
}

fn validate_size(cols: Option<u16>, rows: Option<u16>) -> Result<PtySize, TerminalError> {
    let cols = cols.unwrap_or(DEFAULT_COLS);
    let rows = rows.unwrap_or(DEFAULT_ROWS);
    if !(2..=MAX_COLS).contains(&cols) || !(2..=MAX_ROWS).contains(&rows) {
        return Err(TerminalError::InvalidSize);
    }
    Ok(PtySize {
        rows,
        cols,
        pixel_width: 0,
        pixel_height: 0,
    })
}

fn resolve_cwd(raw: Option<&str>) -> Result<PathBuf, TerminalError> {
    let candidate = raw
        .filter(|value| !value.is_empty() && value.len() <= 4096)
        .map(PathBuf::from)
        .or_else(|| env::var_os("HOME").map(PathBuf::from))
        .or_else(|| env::current_dir().ok())
        .ok_or(TerminalError::InvalidCwd)?;
    let canonical = candidate
        .canonicalize()
        .map_err(|_| TerminalError::InvalidCwd)?;
    if !canonical.is_dir() {
        return Err(TerminalError::InvalidCwd);
    }
    Ok(canonical)
}

fn resolve_shell() -> PathBuf {
    env::var_os("SHELL")
        .map(PathBuf::from)
        .filter(|path| path.is_absolute() && Path::new(path).is_file())
        .unwrap_or_else(|| PathBuf::from("/bin/sh"))
}

include!("terminal/tests.rs");
