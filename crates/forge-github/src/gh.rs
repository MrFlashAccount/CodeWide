//! The host's GitHub CLI (`gh`): availability, the logins it holds, their
//! tokens and logout. `gh` owns its own credential store; the plugin reads a
//! token only into its own memory for one call.
//!
//! Every invocation passes arguments directly (no shell), disables prompts,
//! colour and the update notifier, and is bounded by a timeout. Output of
//! `gh` never leaves this process.

use std::{path::PathBuf, process::Stdio, time::Duration};

use forge_protocol::Secret;
use tokio::{process::Command, time::timeout};

/// The first `gh` release with multi-account support (`--user`).
pub const MIN_GH_VERSION: (u32, u32, u32) = (2, 40, 0);
const COMMAND_TIMEOUT: Duration = Duration::from_secs(15);

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum GhAvailability {
    Missing,
    TooOld { version: String },
    Ready { version: String },
}

#[derive(Debug, thiserror::Error)]
pub enum GhError {
    #[error("gh could not be started")]
    Start(#[source] std::io::Error),
    #[error("gh did not finish in time")]
    Timeout,
    #[error("gh failed")]
    Failed,
}

/// Captured output of one `gh` run. It may contain credentials (for
/// `gh auth token`), so it is never logged or forwarded.
pub(crate) struct GhOutput {
    pub(crate) success: bool,
    pub(crate) stdout: String,
    pub(crate) stderr: String,
}

#[derive(Clone, Debug)]
pub struct GhCli {
    program: PathBuf,
}

impl GhCli {
    #[must_use]
    pub fn new(program: PathBuf) -> Self {
        Self { program }
    }

    pub(crate) fn command(&self) -> Command {
        let mut command = Command::new(&self.program);
        command
            .env("GH_PROMPT_DISABLED", "1")
            .env("GH_NO_UPDATE_NOTIFIER", "1")
            .env("NO_COLOR", "1")
            .env("GH_BROWSER", "true")
            .env("BROWSER", "true")
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        command
    }

    async fn run(&self, args: &[&str]) -> Result<GhOutput, GhError> {
        let mut command = self.command();
        command.args(args);
        let output = timeout(COMMAND_TIMEOUT, command.output())
            .await
            .map_err(|_| GhError::Timeout)?
            .map_err(GhError::Start)?;
        Ok(GhOutput {
            success: output.status.success(),
            stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
            stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
        })
    }

    /// Whether `gh` is installed and at least [`MIN_GH_VERSION`].
    pub async fn availability(&self) -> GhAvailability {
        let Ok(output) = self.run(&["--version"]).await else {
            return GhAvailability::Missing;
        };
        if !output.success {
            return GhAvailability::Missing;
        }
        match parse_version(&output.stdout) {
            Some((version, parsed)) if parsed >= MIN_GH_VERSION => {
                GhAvailability::Ready { version }
            }
            Some((version, _)) => GhAvailability::TooOld { version },
            None => GhAvailability::TooOld {
                version: "unknown".into(),
            },
        }
    }

    /// The logins `gh` reports as signed in on `host`. Accounts `gh` reports
    /// as failing are omitted.
    ///
    /// # Errors
    ///
    /// Returns an error when `gh` cannot run.
    pub async fn logins(&self, host: &str) -> Result<Vec<String>, GhError> {
        let output = self.run(&["auth", "status", "--hostname", host]).await?;
        // `gh auth status` exits 1 when any account has a problem and writes
        // to either stream depending on its version; both are parsed.
        let mut logins = parse_status_logins(&output.stdout, host);
        for login in parse_status_logins(&output.stderr, host) {
            if !logins.contains(&login) {
                logins.push(login);
            }
        }
        Ok(logins)
    }

    /// The token `gh` holds for one login, `None` when it holds none.
    ///
    /// # Errors
    ///
    /// Returns an error when `gh` cannot run.
    pub async fn token(&self, host: &str, login: &str) -> Result<Option<Secret>, GhError> {
        let output = self
            .run(&["auth", "token", "--hostname", host, "--user", login])
            .await?;
        if !output.success {
            return Ok(None);
        }
        let token = output.stdout.trim();
        if token.is_empty() || token.contains(char::is_whitespace) {
            return Ok(None);
        }
        Ok(Some(Secret::new(token.to_owned())))
    }

    /// Logs one login out of `gh` on this host.
    ///
    /// # Errors
    ///
    /// Returns an error when `gh` cannot run or refuses.
    pub async fn logout(&self, host: &str, login: &str) -> Result<(), GhError> {
        let output = self
            .run(&["auth", "logout", "--hostname", host, "--user", login])
            .await?;
        if output.success {
            Ok(())
        } else {
            Err(GhError::Failed)
        }
    }
}

/// `gh version 2.40.0 (2023-11-29)` → `("2.40.0", (2, 40, 0))`.
fn parse_version(output: &str) -> Option<(String, (u32, u32, u32))> {
    let first = output.lines().next()?;
    let version = first
        .strip_prefix("gh version ")?
        .split_whitespace()
        .next()?;
    let mut parts = version.split(['.', '-']);
    let major = parts.next()?.parse().ok()?;
    let minor = parts.next()?.parse().ok()?;
    let patch = parts.next()?.parse().ok()?;
    Some((version.to_owned(), (major, minor, patch)))
}

/// Logins from `✓ Logged in to <host> account <login> (...)` lines.
fn parse_status_logins(output: &str, host: &str) -> Vec<String> {
    let prefix = format!("Logged in to {host} account ");
    output
        .lines()
        .filter_map(|line| {
            let line = line.trim();
            let rest = line.strip_prefix('✓').unwrap_or(line).trim_start();
            let rest = rest.strip_prefix(&prefix)?;
            let login = rest.split_whitespace().next()?;
            valid_login(login).then(|| login.to_owned())
        })
        .collect()
}

/// GitHub logins: alphanumerics and single hyphens, at most 39 characters.
#[must_use]
pub fn valid_login(login: &str) -> bool {
    !login.is_empty()
        && login.len() <= 39
        && login
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
}

#[cfg(test)]
#[allow(clippy::expect_used)]
mod tests {
    use super::*;

    #[test]
    fn parses_versions_and_compares_with_the_minimum() {
        let (text, parsed) =
            parse_version("gh version 2.40.0 (2023-11-29)\nhttps://github.com/cli/cli\n")
                .expect("version");
        assert_eq!(text, "2.40.0");
        assert!(parsed >= MIN_GH_VERSION);
        let (_, old) = parse_version("gh version 2.39.2 (2023-11-14)").expect("version");
        assert!(old < MIN_GH_VERSION);
        assert!(parse_version("not gh").is_none());
    }

    #[test]
    fn reads_only_signed_in_logins_of_the_requested_host() {
        let output = "github.com\n  ✓ Logged in to github.com account octocat (keyring)\n  - Active account: true\n  - Token: gho_************\n  X Failed to log in to github.com account expired-user (keyring)\n  ✓ Logged in to github.com account hubot (/home/u/.config/gh/hosts.yml)\nghe.example.com\n  ✓ Logged in to ghe.example.com account other (keyring)\n";
        assert_eq!(
            parse_status_logins(output, "github.com"),
            vec!["octocat".to_owned(), "hubot".to_owned()]
        );
    }
}
