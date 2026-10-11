//! What this machine offers Claude before `providers.claude` is read: the
//! user's `claude` and the user's login-shell `PATH`. A service manager
//! starts the companion with a minimal `PATH`, so both are looked up the way
//! the user's own terminal sees them.

use std::{
    ffi::OsStr,
    os::unix::fs::PermissionsExt,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    time::{Duration, Instant},
};

use serde_json::Value;
use tracing::warn;

use crate::config::ClaudeDefaults;

const LOGIN_SHELL_TIMEOUT: Duration = Duration::from_secs(5);
const LOGIN_SHELL_POLL: Duration = Duration::from_millis(25);

/// Where Claude Code's installers put `claude`, relative to the home
/// directory, after the directories of `PATH`.
const HOME_CANDIDATES: [&str; 2] = [".local/bin/claude", ".claude/local/claude"];
const SYSTEM_CANDIDATES: [&str; 2] = ["/opt/homebrew/bin/claude", "/usr/local/bin/claude"];

fn is_executable_file(path: &Path) -> bool {
    path.metadata()
        .is_ok_and(|metadata| metadata.is_file() && metadata.permissions().mode() & 0o111 != 0)
}

/// The first executable `claude` in `search_path`, then in the installers'
/// usual locations.
#[must_use]
pub fn find_claude(search_path: &[PathBuf], home: Option<&Path>) -> Option<PathBuf> {
    let on_path = search_path.iter().map(|directory| directory.join("claude"));
    let in_home = home
        .into_iter()
        .flat_map(|home| HOME_CANDIDATES.map(|candidate| home.join(candidate)));
    let system = SYSTEM_CANDIDATES.map(PathBuf::from);
    on_path
        .chain(in_home)
        .chain(system)
        .find(|candidate| is_executable_file(candidate))
}

/// Absolute directories of a `PATH` value; relative entries are dropped.
#[must_use]
pub fn absolute_directories(value: &OsStr) -> Vec<PathBuf> {
    std::env::split_paths(value)
        .filter(|directory| directory.is_absolute())
        .collect()
}

/// `PATH` as the user's login shell sets it (`$SHELL -l -c 'printenv PATH'`),
/// within a bounded time; `None` when the shell is unknown, fails or hangs.
#[must_use]
pub fn login_shell_path(shell: &Path) -> Option<Vec<PathBuf>> {
    let mut child = Command::new(shell)
        .args(["-l", "-c", "printenv PATH"])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    let deadline = Instant::now() + LOGIN_SHELL_TIMEOUT;
    loop {
        match child.try_wait() {
            Ok(Some(status)) if status.success() => break,
            Ok(Some(_)) | Err(_) => return None,
            Ok(None) if Instant::now() >= deadline => {
                // The shell is abandoned; a failed kill leaves nothing to clean up.
                let _ = child.kill();
                let _ = child.wait();
                warn!("the login shell did not report PATH in time; Claude keeps the service PATH");
                return None;
            }
            Ok(None) => std::thread::sleep(LOGIN_SHELL_POLL),
        }
    }
    let output = child.wait_with_output().ok()?;
    let value = String::from_utf8(output.stdout).ok()?;
    let directories = absolute_directories(OsStr::new(value.trim()));
    (!directories.is_empty()).then_some(directories)
}

impl ClaudeDefaults {
    /// Looks up what `entry` (a `providers.claude` object, `{}` when absent)
    /// leaves to the machine, from the companion's environment (`SHELL`,
    /// `HOME`, `PATH`): the login-shell `PATH` unless the entry configures
    /// `environment.PATH`, and `claude` (on that `PATH`, on the companion's
    /// own, or in the installers' locations) unless it configures
    /// `claudeExecutable`.
    #[must_use]
    pub fn discover(
        entry: &Value,
        bundled_host: Option<PathBuf>,
        agent_sdk: Option<PathBuf>,
        journal_directory: PathBuf,
    ) -> Self {
        let configures = |pointer: &str| entry.pointer(pointer).is_some();
        let login_path = if configures("/environment/PATH") {
            None
        } else {
            std::env::var_os("SHELL")
                .map(PathBuf::from)
                .filter(|shell| shell.is_absolute())
                .and_then(|shell| login_shell_path(&shell))
        };
        let claude_executable = if configures("/claudeExecutable") {
            None
        } else {
            let inherited = std::env::var_os("PATH")
                .map(|value| absolute_directories(&value))
                .unwrap_or_default();
            let search_path = login_path
                .iter()
                .flatten()
                .chain(&inherited)
                .cloned()
                .collect::<Vec<_>>();
            let home = std::env::var_os("HOME").map(PathBuf::from);
            find_claude(&search_path, home.as_deref())
        };
        Self {
            bundled_host,
            agent_sdk,
            claude_executable,
            journal_directory,
            login_path,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn executable(path: &Path) -> Result<(), Box<dyn std::error::Error>> {
        std::fs::create_dir_all(path.parent().ok_or("no parent")?)?;
        std::fs::write(path, "")?;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o755))?;
        Ok(())
    }

    #[test]
    fn finds_claude_on_path_before_the_installer_locations()
    -> Result<(), Box<dyn std::error::Error>> {
        let root = tempfile::tempdir()?;
        let home = root.path().join("home");
        let on_path = root.path().join("tools/claude");
        let local = home.join(".local/bin/claude");
        executable(&local)?;
        assert_eq!(find_claude(&[], Some(&home)), Some(local.clone()));
        executable(&on_path)?;
        assert_eq!(
            find_claude(&[root.path().join("tools")], Some(&home)),
            Some(on_path)
        );
        // A file that is not executable is not `claude`.
        let plain = root.path().join("plain/claude");
        std::fs::create_dir_all(plain.parent().ok_or("no parent")?)?;
        std::fs::write(&plain, "")?;
        assert_eq!(
            find_claude(&[root.path().join("plain")], Some(&home)),
            Some(local)
        );
        Ok(())
    }

    #[test]
    fn reads_the_login_shell_path_and_drops_relative_entries() {
        let path = login_shell_path(Path::new("/bin/sh"));
        assert!(
            path.is_some_and(|directories| directories.iter().all(|entry| entry.is_absolute()))
        );
        assert_eq!(login_shell_path(Path::new("/nonexistent/shell")), None);
        assert_eq!(
            absolute_directories(OsStr::new("/usr/bin:bin:/opt/x")),
            [PathBuf::from("/usr/bin"), PathBuf::from("/opt/x")]
        );
    }
}
