//! Persistence of the host's own thread metadata: the only files the host
//! writes (`host/src/state/stateStore.ts`).
//!
//! Layout under the state directory (directory mode 0700, files 0600):
//!
//! ```text
//! threads/<appThreadId>/state.json        ThreadState (v2)
//! threads/<appThreadId>/active-turn.json  snapshot of the in-flight turn, removed when it ends
//! ```
//!
//! Every write is atomic (temporary file in the same directory, fsync, then
//! rename), so a crash leaves either the old or the new record. A directory
//! holding only a v1 journal (`thread.json`) is converted on load; the v1
//! files are left untouched. The store never touches `state.redb`,
//! `CODEX_HOME` or Claude's configuration directory.

use std::{
    io::{self, Write},
    path::{Path, PathBuf},
};

use agent_core::model::{AgentTurn, AppThreadId};

use super::{
    codec::{decode_active_turn, decode_thread_state, encode_active_turn, encode_thread_state},
    legacy_journal::convert_legacy_thread,
    thread_state::ThreadState,
};

const THREADS_DIRECTORY: &str = "threads";
const STATE_FILE: &str = "state.json";
const ACTIVE_TURN_FILE: &str = "active-turn.json";
const MAX_ID_LENGTH: usize = 128;

/// Why a thread's state could not be read or written.
#[derive(Debug, thiserror::Error)]
pub enum StateError {
    /// The thread id is not `[A-Za-z0-9-]{1,128}`, so it cannot name a directory.
    #[error("thread id is not a safe path segment")]
    UnsafeThreadId,
    /// `state.json` belongs to another thread than its directory names.
    #[error("thread state id does not match its directory")]
    ThreadIdMismatch,
    /// `thread.json` (v1) belongs to another thread than its directory names.
    #[error("legacy journal thread id does not match its directory")]
    LegacyThreadIdMismatch,
    /// A file is not a valid record of its kind.
    #[error("{file}: {source}")]
    Decode {
        file: String,
        #[source]
        source: serde_json::Error,
    },
    /// A record could not be serialized.
    #[error("thread state could not be encoded: {0}")]
    Encode(#[source] serde_json::Error),
    #[error("thread state I/O failed: {0}")]
    Io(#[from] io::Error),
}

/// One thread read at startup.
#[derive(Clone, Debug, PartialEq)]
pub struct StoredThread {
    /// The turn a previous process left in progress, if any.
    pub active_turn: Option<AgentTurn>,
    pub state: ThreadState,
}

fn is_safe_id(value: &str) -> bool {
    (1..=MAX_ID_LENGTH).contains(&value.len())
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
}

fn read_optional(path: &Path) -> io::Result<Option<Vec<u8>>> {
    match std::fs::read(path) {
        Ok(bytes) => Ok(Some(bytes)),
        Err(err) if err.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(err) => Err(err),
    }
}

/// Creates `path` and its missing parents owner-only (0700 on Unix).
fn create_private_directory(path: &Path) -> io::Result<()> {
    let mut builder = std::fs::DirBuilder::new();
    builder.recursive(true);
    #[cfg(unix)]
    std::os::unix::fs::DirBuilderExt::mode(&mut builder, 0o700);
    builder.create(path)
}

/// Atomically replaces `<directory>/<name>` with `bytes`. The temporary file
/// is created owner-only (0600 on Unix) next to the target.
fn write_atomic(directory: &Path, name: &str, bytes: &[u8]) -> io::Result<()> {
    create_private_directory(directory)?;
    let mut temporary = tempfile::Builder::new()
        .prefix(&format!(".{name}."))
        .suffix(".tmp")
        .tempfile_in(directory)?;
    temporary.write_all(bytes)?;
    temporary.as_file().sync_all()?;
    temporary
        .persist(directory.join(name))
        .map_err(|err| err.error)?;
    Ok(())
}

/// The directory of one thread, `<state dir>/threads/<app thread id>`, whose
/// name passed the safe path segment check.
#[derive(Clone, Debug)]
pub struct ThreadDirectory {
    app_thread_id: AppThreadId,
    path: PathBuf,
}

impl ThreadDirectory {
    /// The directory of `app_thread_id` under `<root>/threads`.
    ///
    /// # Errors
    /// [`StateError::UnsafeThreadId`] when the id cannot name a directory.
    pub fn new(root: &Path, app_thread_id: &str) -> Result<Self, StateError> {
        if !is_safe_id(app_thread_id) {
            return Err(StateError::UnsafeThreadId);
        }
        let app_thread_id = AppThreadId::parse(app_thread_id).ok_or(StateError::UnsafeThreadId)?;
        let path = root.join(THREADS_DIRECTORY).join(app_thread_id.as_str());
        Ok(Self {
            app_thread_id,
            path,
        })
    }

    /// Every directory under `<root>/threads` named by a safe thread id.
    /// Other entries are skipped.
    ///
    /// # Errors
    /// When `<root>/threads` cannot be listed (including when it is missing).
    pub fn list(root: &Path) -> io::Result<impl Iterator<Item = Self>> {
        let entries = std::fs::read_dir(root.join(THREADS_DIRECTORY))?;
        Ok(entries.flatten().filter_map(|entry| {
            let path = entry.path();
            let app_thread_id = AppThreadId::parse(entry.file_name().to_str()?)?;
            (is_safe_id(app_thread_id.as_str()) && path.is_dir()).then_some(Self {
                app_thread_id,
                path,
            })
        }))
    }

    /// The thread id the directory is named by.
    #[must_use]
    pub fn app_thread_id(&self) -> &AppThreadId {
        &self.app_thread_id
    }

    /// Reads `state.json`; `None` when the directory has none.
    ///
    /// # Errors
    /// When the file cannot be read, is not a v2 `ThreadState`, or names
    /// another thread.
    pub fn read_state(&self) -> Result<Option<ThreadState>, StateError> {
        let Some(bytes) = read_optional(&self.path.join(STATE_FILE))? else {
            return Ok(None);
        };
        let state = decode_thread_state(&bytes).map_err(|source| StateError::Decode {
            file: STATE_FILE.to_owned(),
            source,
        })?;
        if state.app_thread_id != self.app_thread_id {
            return Err(StateError::ThreadIdMismatch);
        }
        Ok(Some(state))
    }

    /// Reads the in-flight turn snapshot; `None` when no turn is running.
    ///
    /// # Errors
    /// When the file cannot be read or is not a v2 snapshot.
    pub fn read_active_turn(&self) -> Result<Option<AgentTurn>, StateError> {
        let Some(bytes) = read_optional(&self.path.join(ACTIVE_TURN_FILE))? else {
            return Ok(None);
        };
        decode_active_turn(&bytes)
            .map(Some)
            .map_err(|source| StateError::Decode {
                file: ACTIVE_TURN_FILE.to_owned(),
                source,
            })
    }
}

/// The host's thread state store under one state directory.
#[derive(Clone, Debug)]
pub struct ThreadStateStore {
    root: PathBuf,
}

impl ThreadStateStore {
    /// Opens the store, creating `<root>` and `<root>/threads` owner-only.
    ///
    /// # Errors
    /// When the directories cannot be created.
    pub fn open(root: PathBuf) -> io::Result<Self> {
        create_private_directory(&root.join(THREADS_DIRECTORY))?;
        Ok(Self { root })
    }

    fn directory(&self, app_thread_id: &str) -> Result<ThreadDirectory, StateError> {
        ThreadDirectory::new(&self.root, app_thread_id)
    }

    /// Atomically replaces the thread's `state.json`.
    ///
    /// # Errors
    /// For an unsafe thread id, or when the file cannot be written.
    pub fn write(&self, state: &ThreadState) -> Result<(), StateError> {
        let directory = self.directory(state.app_thread_id.as_str())?;
        let bytes = encode_thread_state(state).map_err(StateError::Encode)?;
        write_atomic(&directory.path, STATE_FILE, &bytes)?;
        Ok(())
    }

    /// Atomically replaces the thread's in-flight turn snapshot.
    ///
    /// # Errors
    /// For an unsafe thread id, or when the file cannot be written.
    pub fn write_active_turn(
        &self,
        app_thread_id: &AppThreadId,
        turn: &AgentTurn,
    ) -> Result<(), StateError> {
        let directory = self.directory(app_thread_id.as_str())?;
        let bytes = encode_active_turn(turn).map_err(StateError::Encode)?;
        write_atomic(&directory.path, ACTIVE_TURN_FILE, &bytes)?;
        Ok(())
    }

    /// Removes the in-flight turn snapshot; nothing to remove is not an error.
    ///
    /// # Errors
    /// For an unsafe thread id, or when the file exists and cannot be removed.
    pub fn clear_active_turn(&self, app_thread_id: &AppThreadId) -> Result<(), StateError> {
        let directory = self.directory(app_thread_id.as_str())?;
        match std::fs::remove_file(directory.path.join(ACTIVE_TURN_FILE)) {
            Err(err) if err.kind() != io::ErrorKind::NotFound => Err(err.into()),
            _ => Ok(()),
        }
    }

    fn read_thread(&self, directory: &ThreadDirectory) -> Result<Option<StoredThread>, StateError> {
        if let Some(state) = directory.read_state()? {
            let active_turn = directory.read_active_turn()?;
            return Ok(Some(StoredThread { active_turn, state }));
        }
        let Some(converted) = convert_legacy_thread(&directory.path, &directory.app_thread_id)?
        else {
            return Ok(None);
        };
        self.write(&converted.state)?;
        Ok(Some(converted))
    }

    /// Every stored thread, including tombstones. A thread that cannot be
    /// read is skipped and reported to `on_error` with its directory's id; a
    /// directory without `state.json` or a v1 journal is skipped silently.
    ///
    /// # Errors
    /// When `<root>/threads` cannot be listed.
    pub fn load(
        &self,
        mut on_error: impl FnMut(&AppThreadId, StateError),
    ) -> io::Result<Vec<StoredThread>> {
        let mut threads = Vec::new();
        for directory in ThreadDirectory::list(&self.root)? {
            match self.read_thread(&directory) {
                Ok(Some(stored)) => threads.push(stored),
                Ok(None) => {}
                Err(err) => on_error(directory.app_thread_id(), err),
            }
        }
        Ok(threads)
    }
}
