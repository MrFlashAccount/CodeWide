use std::{
    collections::{HashMap, VecDeque},
    env, fmt,
    io::{Read, Write},
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
use portable_pty::{Child, CommandBuilder, MasterPty, PtySize, native_pty_system};
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
const MAX_REPLAY_BYTES: usize = 32 * 1024 * 1024;
const COMPLETED_RETENTION: Duration = Duration::from_mins(15);
const DETACHED_IDLE_TTL: Duration = Duration::from_hours(24);
const TERMINAL_EXITED_CLOSE_CODE: u16 = 4000;
const TERMINAL_REPLAY_CLOSE_CODE: u16 = 4004;

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
            Self::SessionOwnedByAnotherDevice => StatusCode::FORBIDDEN,
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
    authority_revoked: AtomicBool,
    last_activity: Mutex<Instant>,
    permit: Mutex<Option<OwnedSemaphorePermit>>,
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

#[derive(Default)]
struct ReplayBuffer {
    start: u64,
    end: u64,
    bytes: usize,
    chunks: VecDeque<ReplayChunk>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum TerminalState {
    Running,
    Exited,
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
            session_id.to_owned(),
            protocol,
            generation,
            owner.to_owned(),
            query.thread_id.clone(),
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
        id: String,
        protocol: TerminalProtocol,
        generation: Option<u64>,
        owner: String,
        thread_id: Option<String>,
        session: TerminalSession,
        permit: OwnedSemaphorePermit,
    ) -> Arc<Self> {
        let (commands, command_rx) = std_mpsc::sync_channel(64);
        let (output, _) = broadcast::channel(128);
        let (state, _) = watch::channel(TerminalState::Running);
        let terminal = Arc::new(Self {
            id,
            protocol,
            generation,
            owner,
            thread_id,
            commands,
            output,
            state,
            replay: Mutex::new(ReplayBuffer::default()),
            attached: AtomicUsize::new(0),
            exited: AtomicBool::new(false),
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
                terminal.append_output(&buffer[..count]);
            }
            if let Some(terminal) = reader_terminal.upgrade() {
                terminal.mark_exited();
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
            let _ = child.wait();
            if let Some(terminal) = control_terminal.upgrade() {
                terminal.mark_exited();
            }
            drop(master);
        });

        terminal
    }

    fn append_output(&self, bytes: &[u8]) {
        if bytes.is_empty()
            || self.exited.load(Ordering::Acquire)
            || self.authority_revoked.load(Ordering::Acquire)
        {
            return;
        }
        let chunk = {
            let mut replay = lock(&self.replay);
            replay.append(bytes)
        };
        self.touch();
        let _ = self.output.send(chunk);
    }

    fn resize(&self, size: PtySize) -> Result<(), TerminalError> {
        self.commands
            .try_send(WriterCommand::Resize(size))
            .map_err(|_| TerminalError::SessionNotFound)
    }

    fn close(&self) {
        let _ = self.commands.try_send(WriterCommand::Close);
    }

    pub(crate) fn revoke(&self) {
        self.authority_revoked.store(true, Ordering::Release);
        self.close();
    }

    fn mark_exited(&self) {
        if self.exited.swap(true, Ordering::AcqRel) {
            return;
        }
        self.touch();
        lock(&self.permit).take();
        self.state.send_replace(TerminalState::Exited);
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
                            terminal.close();
                        }
                        return;
                    }
                    Err(broadcast::error::RecvError::Lagged(_)) => {
                        if let Some(terminal) = terminal.upgrade() {
                            terminal.close();
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

impl ReplayBuffer {
    fn append(&mut self, bytes: &[u8]) -> ReplayChunk {
        let chunk = ReplayChunk {
            start: self.end,
            bytes: Arc::from(bytes),
        };
        self.end += u64::try_from(bytes.len()).unwrap_or(u64::MAX);
        self.bytes += bytes.len();
        self.chunks.push_back(chunk.clone());
        while self.bytes > MAX_REPLAY_BYTES && self.chunks.len() > 1 {
            if let Some(removed) = self.chunks.pop_front() {
                self.bytes -= removed.bytes.len();
                self.start = removed.start + u64::try_from(removed.bytes.len()).unwrap_or(0);
            }
        }
        chunk
    }

    fn snapshot(&self, offset: u64) -> Result<Vec<ReplayChunk>, TerminalError> {
        if offset < self.start || offset > self.end {
            return Err(TerminalError::ReplayUnavailable);
        }
        Ok(self
            .chunks
            .iter()
            .filter(|chunk| chunk.start + u64::try_from(chunk.bytes.len()).unwrap_or(0) > offset)
            .cloned()
            .collect())
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
