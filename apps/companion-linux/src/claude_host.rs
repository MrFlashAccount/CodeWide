//! The Claude agent host this companion ships. A build with the
//! `embedded-claude-host` feature carries the Bun-compiled host; at start it
//! is written once to `<state dir>/claude-agent-host/<digest>/` (the install
//! directory of the binary is read-only to the service) and the companion
//! runs it from there. Older digests are removed.

use std::{
    io::Write,
    os::unix::fs::PermissionsExt,
    path::{Path, PathBuf},
};

#[cfg(feature = "embedded-claude-host")]
mod embedded {
    pub const BYTES: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/claude-agent-host"));
    pub const SHA256: &str = env!("CODEWIDE_CLAUDE_HOST_SHA256");
}

#[cfg_attr(
    all(not(feature = "embedded-claude-host"), not(test)),
    expect(dead_code, reason = "only a build that ships the host writes it out")
)]
const EXECUTABLE: &str = "claude-agent-host";
#[cfg_attr(
    all(not(feature = "embedded-claude-host"), not(test)),
    expect(dead_code, reason = "only a build that ships the host writes it out")
)]
const DIGEST_DIRECTORY_CHARS: usize = 16;
#[cfg_attr(
    all(not(feature = "embedded-claude-host"), not(test)),
    expect(dead_code, reason = "only a build that ships the host writes it out")
)]
const STAGING_PREFIX: &str = ".claude-agent-host-";
#[cfg_attr(
    all(not(feature = "embedded-claude-host"), not(test)),
    expect(dead_code, reason = "only a build that ships the host writes it out")
)]
/// A temporary file this old belongs to no start still running.
const STALE_AFTER: std::time::Duration = std::time::Duration::from_hours(1);

/// The shipped host's executable, written out when needed; `None` for a
/// build without it or when it cannot be written (logged).
#[must_use]
pub fn installed(state_directory: &Path) -> Option<PathBuf> {
    #[cfg(feature = "embedded-claude-host")]
    {
        let root = state_directory.join(EXECUTABLE);
        match install(&root, embedded::BYTES, embedded::SHA256) {
            Ok(executable) => Some(executable),
            Err(err) => {
                tracing::error!(err = %err, "the shipped Claude agent host could not be installed");
                None
            }
        }
    }
    #[cfg(not(feature = "embedded-claude-host"))]
    {
        let _ = state_directory;
        None
    }
}

/// Where the shipped host is (or will be) written; `None` for a build
/// without it. Writes nothing.
#[must_use]
#[cfg_attr(
    feature = "embedded-claude-host",
    expect(
        clippy::unnecessary_wraps,
        reason = "a build without the shipped host returns None"
    )
)]
pub fn shipped_path(state_directory: &Path) -> Option<PathBuf> {
    #[cfg(feature = "embedded-claude-host")]
    {
        Some(executable_path(
            &state_directory.join(EXECUTABLE),
            embedded::SHA256,
        ))
    }
    #[cfg(not(feature = "embedded-claude-host"))]
    {
        let _ = state_directory;
        None
    }
}

#[cfg_attr(
    all(not(feature = "embedded-claude-host"), not(test)),
    expect(dead_code, reason = "only a build that ships the host writes it out")
)]
fn executable_path(root: &Path, sha256: &str) -> PathBuf {
    let digest = sha256.get(..DIGEST_DIRECTORY_CHARS).unwrap_or(sha256);
    root.join(digest).join(EXECUTABLE)
}

#[cfg_attr(
    all(not(feature = "embedded-claude-host"), not(test)),
    expect(dead_code, reason = "only a build that ships the host writes it out")
)]
/// Writes `bytes` to `<root>/<digest prefix>/claude-agent-host` unless it is
/// there, through a temporary file next to it (same file system) renamed
/// into place, then removes other digests and temporary files a killed start
/// left behind.
fn install(root: &Path, bytes: &[u8], sha256: &str) -> std::io::Result<PathBuf> {
    let executable = executable_path(root, sha256);
    let directory = executable
        .parent()
        .map_or_else(|| root.to_path_buf(), Path::to_path_buf);
    if !executable.is_file() {
        std::fs::create_dir_all(&directory)?;
        let mut staged = tempfile::Builder::new()
            .prefix(STAGING_PREFIX)
            .tempfile_in(root)?;
        staged.write_all(bytes)?;
        staged.as_file().sync_all()?;
        std::fs::set_permissions(staged.path(), std::fs::Permissions::from_mode(0o700))?;
        staged.persist(&executable).map_err(|error| error.error)?;
    }
    sweep(root, &directory, std::time::SystemTime::now());
    Ok(executable)
}

#[cfg_attr(
    all(not(feature = "embedded-claude-host"), not(test)),
    expect(dead_code, reason = "only a build that ships the host writes it out")
)]
/// Removes every digest but `current` (the host of an older or newer build;
/// a rollback writes its own again) and temporary files older than
/// [`STALE_AFTER`] (younger ones may belong to a start still running).
fn sweep(root: &Path, current: &Path, now: std::time::SystemTime) {
    let Ok(entries) = std::fs::read_dir(root) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path == current {
            continue;
        }
        if entry
            .file_name()
            .to_string_lossy()
            .starts_with(STAGING_PREFIX)
        {
            let age = entry
                .metadata()
                .and_then(|metadata| metadata.modified())
                .ok()
                .and_then(|modified| now.duration_since(modified).ok());
            if age.is_some_and(|age| age >= STALE_AFTER) {
                // Best effort: a temporary file left behind only costs disk space.
                let _ = std::fs::remove_file(&path);
            }
        } else if path.is_dir() {
            // Best effort: an older host left behind only costs disk space.
            let _ = std::fs::remove_dir_all(&path);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn writes_the_host_once_and_drops_older_ones() -> Result<(), Box<dyn std::error::Error>> {
        let root = tempfile::tempdir()?;
        let old = install(root.path(), b"old", "aaaaaaaaaaaaaaaaaaaa")?;
        let executable = install(root.path(), b"#!/bin/sh\n", "0123456789abcdef0123")?;
        assert_eq!(
            executable,
            root.path().join("0123456789abcdef/claude-agent-host")
        );
        assert_eq!(std::fs::read(&executable)?, b"#!/bin/sh\n");
        assert_eq!(
            std::fs::metadata(&executable)?.permissions().mode() & 0o777,
            0o700
        );
        assert!(!old.exists());
        // A second start keeps the written file.
        assert_eq!(
            install(root.path(), b"ignored", "0123456789abcdef0123")?,
            executable
        );
        assert_eq!(std::fs::read(&executable)?, b"#!/bin/sh\n");
        Ok(())
    }

    #[test]
    fn removes_other_digests_and_only_stale_temporary_files()
    -> Result<(), Box<dyn std::error::Error>> {
        let root = tempfile::tempdir()?;
        let current = root.path().join("current");
        let older = root.path().join("older");
        std::fs::create_dir_all(&current)?;
        std::fs::create_dir_all(&older)?;
        let stale = root.path().join(".claude-agent-host-stale");
        let fresh = root.path().join(".claude-agent-host-fresh");
        std::fs::write(&stale, "")?;
        std::fs::write(&fresh, "")?;
        let now = std::time::SystemTime::now();
        std::fs::File::options()
            .write(true)
            .open(&stale)?
            .set_modified(now - STALE_AFTER - std::time::Duration::from_mins(1))?;
        sweep(root.path(), &current, now);
        assert!(current.is_dir());
        assert!(!older.exists());
        assert!(!stale.exists());
        assert!(fresh.exists());
        Ok(())
    }
}
