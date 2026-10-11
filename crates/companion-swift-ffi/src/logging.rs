//! Process-wide log output of the macOS runtime.
//!
//! The `LaunchAgent` has no terminal and no journal, so Rust records
//! (including the Claude agent host's stderr, which `agent-transport`
//! forwards as records) go to a size-capped file:
//! `~/Library/Logs/CodeWide/companion.log`, or `<state dir>/logs/companion.log`
//! where `HOME` is unknown or on other platforms (tests). When the file would
//! exceed [`MAX_LOG_BYTES`] it is renamed to `companion.log.1` (replacing the
//! previous one) and a new file is started, so at most two files exist.
//!
//! The filter is the shared companion filter (`companion_core::log_filter`).
//! The subscriber is installed at most once per process; a later call, or a
//! process that already has a global subscriber, keeps the existing one.

use std::{
    fs::{File, OpenOptions},
    io::Write,
    os::unix::fs::{DirBuilderExt, OpenOptionsExt},
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
};

use companion_core::log_filter::LogFilter;
use tracing_subscriber::fmt::MakeWriter;

/// Size at which the active log file is rotated.
pub const MAX_LOG_BYTES: u64 = 8 * 1024 * 1024;
const LOG_FILE_NAME: &str = "companion.log";
const ROTATED_LOG_FILE_NAME: &str = "companion.log.1";

static INSTALLED: OnceLock<()> = OnceLock::new();

/// The log directory for a runtime with this state directory.
#[must_use]
pub fn log_directory(state_directory: &Path) -> PathBuf {
    let home = std::env::var_os("HOME").filter(|home| !home.is_empty());
    match home {
        Some(home) if cfg!(target_os = "macos") => {
            PathBuf::from(home).join("Library/Logs/CodeWide")
        }
        _ => state_directory.join("logs"),
    }
}

/// Installs the file subscriber once. Failure to open the log file leaves the
/// process without a subscriber (as before) and is reported on stderr, which
/// launchd discards; the runtime itself keeps starting.
pub fn install(state_directory: &Path) {
    INSTALLED.get_or_init(|| {
        let directory = log_directory(state_directory);
        let log = match RotatingLog::open(&directory, MAX_LOG_BYTES) {
            Ok(log) => log,
            Err(err) => {
                // No subscriber exists yet; stderr is the only channel.
                eprintln!("CodeWide runtime log file is unavailable: {err}");
                return;
            }
        };
        let filter = LogFilter::from_env();
        let installed = tracing_subscriber::fmt()
            .with_env_filter(filter.filter)
            .with_writer(log)
            .with_ansi(false)
            .try_init()
            .is_ok();
        if installed {
            for directive in &filter.rejected_directives {
                tracing::warn!(directive = %directive, "ignored an invalid RUST_LOG directive");
            }
            tracing::info!(directory = %directory.display(), "runtime logging started");
        }
    });
}

struct LogFile {
    file: File,
    written: u64,
}

/// A log file that is rotated once when it reaches its size cap.
pub struct RotatingLog {
    directory: PathBuf,
    max_bytes: u64,
    state: Mutex<LogFile>,
}

impl RotatingLog {
    /// Opens (or creates) `companion.log` in `directory`, owner-only.
    ///
    /// # Errors
    /// Returns the I/O error of creating the directory or the file.
    pub fn open(directory: &Path, max_bytes: u64) -> std::io::Result<Self> {
        std::fs::DirBuilder::new()
            .recursive(true)
            .mode(0o700)
            .create(directory)?;
        let file = open_append(&directory.join(LOG_FILE_NAME))?;
        let written = file.metadata()?.len();
        Ok(Self {
            directory: directory.to_path_buf(),
            max_bytes,
            state: Mutex::new(LogFile { file, written }),
        })
    }

    fn write_record(&self, record: &[u8]) -> std::io::Result<()> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| std::io::Error::other("log file lock is poisoned"))?;
        let length = u64::try_from(record.len()).unwrap_or(u64::MAX);
        if state.written > 0 && state.written.saturating_add(length) > self.max_bytes {
            let active = self.directory.join(LOG_FILE_NAME);
            std::fs::rename(&active, self.directory.join(ROTATED_LOG_FILE_NAME))?;
            state.file = open_append(&active)?;
            state.written = 0;
        }
        state.file.write_all(record)?;
        state.written = state.written.saturating_add(length);
        Ok(())
    }
}

fn open_append(path: &Path) -> std::io::Result<File> {
    OpenOptions::new()
        .create(true)
        .append(true)
        .mode(0o600)
        .open(path)
}

/// One formatted record; the fmt layer writes each event through a fresh
/// writer, so a record is never split across a rotation.
pub struct RecordWriter<'a> {
    log: &'a RotatingLog,
    buffer: Vec<u8>,
}

impl Write for RecordWriter<'_> {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        self.buffer.extend_from_slice(buf);
        Ok(buf.len())
    }

    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

impl Drop for RecordWriter<'_> {
    fn drop(&mut self) {
        if !self.buffer.is_empty() {
            // A failed log write has nowhere to be reported.
            let _ = self.log.write_record(&self.buffer);
        }
    }
}

impl<'a> MakeWriter<'a> for RotatingLog {
    type Writer = RecordWriter<'a>;

    fn make_writer(&'a self) -> Self::Writer {
        RecordWriter {
            log: self,
            buffer: Vec::new(),
        }
    }
}

#[cfg(test)]
mod tests {
    use std::os::unix::fs::PermissionsExt;

    use super::*;

    fn write(log: &RotatingLog, record: &str) {
        let mut writer = log.make_writer();
        writer.write_all(record.as_bytes()).unwrap_or_default();
    }

    #[test]
    fn rotates_once_at_the_cap_and_keeps_two_owner_only_files()
    -> Result<(), Box<dyn std::error::Error>> {
        let root = tempfile::tempdir()?;
        let directory = root.path().join("logs");
        let log = RotatingLog::open(&directory, 16)?;
        write(&log, "first-record\n");
        write(&log, "second-record\n");
        write(&log, "third-record\n");
        let active = std::fs::read_to_string(directory.join(LOG_FILE_NAME))?;
        let rotated = std::fs::read_to_string(directory.join(ROTATED_LOG_FILE_NAME))?;
        assert_eq!(active, "third-record\n");
        assert_eq!(rotated, "second-record\n");
        assert_eq!(std::fs::read_dir(&directory)?.count(), 2);
        let mode = std::fs::metadata(directory.join(LOG_FILE_NAME))?
            .permissions()
            .mode();
        assert_eq!(mode & 0o777, 0o600);
        assert_eq!(
            std::fs::metadata(&directory)?.permissions().mode() & 0o777,
            0o700
        );
        Ok(())
    }

    #[test]
    fn appends_to_an_existing_file_and_counts_its_size() -> Result<(), Box<dyn std::error::Error>> {
        let root = tempfile::tempdir()?;
        std::fs::write(root.path().join(LOG_FILE_NAME), "0123456789\n")?;
        let log = RotatingLog::open(root.path(), 16)?;
        write(&log, "next-record\n");
        assert_eq!(
            std::fs::read_to_string(root.path().join(ROTATED_LOG_FILE_NAME))?,
            "0123456789\n"
        );
        assert_eq!(
            std::fs::read_to_string(root.path().join(LOG_FILE_NAME))?,
            "next-record\n"
        );
        Ok(())
    }

    #[test]
    fn the_state_directory_hosts_logs_off_macos() {
        if !cfg!(target_os = "macos") {
            assert_eq!(
                log_directory(Path::new("/state")),
                PathBuf::from("/state/logs")
            );
        }
    }
}
