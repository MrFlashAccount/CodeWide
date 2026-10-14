//! One short `claude` command whose standard output is read whole, bounded
//! in time and size (Node's `execFile` with `timeout` and `maxBuffer`, as
//! the host ran `claude --version` and `claude agents --json`).

use std::{
    ffi::{OsStr, OsString},
    path::Path,
    process::{ExitStatus, Stdio},
    time::Duration,
};

use tokio::{io::AsyncReadExt, process::Command};

/// Why a short `claude` command produced no output.
#[derive(Debug, thiserror::Error)]
pub enum CommandOutputError {
    #[error("claude could not be run: {0}")]
    Io(#[from] std::io::Error),
    #[error("claude did not finish within {0:?}")]
    Timeout(Duration),
    #[error("claude printed more than {0} bytes")]
    TooLarge(usize),
    #[error("claude exited with {0}")]
    Failed(ExitStatus),
    #[error("claude printed output that is not UTF-8")]
    NotUtf8,
}

/// Runs `executable` with `args` and `environment` added to the companion's
/// own and returns its standard output. Standard input and error are
/// discarded; the process is killed when it overruns `timeout` or prints
/// more than `max_bytes`.
pub(crate) async fn command_output(
    executable: &Path,
    args: &[&str],
    environment: &[(OsString, OsString)],
    timeout: Duration,
    max_bytes: usize,
) -> Result<String, CommandOutputError> {
    let mut child = Command::new(executable)
        .args(args)
        .envs(environment.iter().map(|(name, value)| (name, value)))
        .env_remove(OsStr::new("NODE_OPTIONS"))
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .spawn()?;
    let mut stdout = child
        .stdout
        .take()
        .ok_or_else(|| std::io::Error::other("claude's standard output is not piped"))?;
    let run = async {
        let mut output = Vec::new();
        // One byte more than allowed tells an overrun from an exact fit.
        let limit = u64::try_from(max_bytes).map_or(u64::MAX, |max| max.saturating_add(1));
        (&mut stdout).take(limit).read_to_end(&mut output).await?;
        if output.len() > max_bytes {
            return Err(CommandOutputError::TooLarge(max_bytes));
        }
        let status = child.wait().await?;
        if !status.success() {
            return Err(CommandOutputError::Failed(status));
        }
        String::from_utf8(output).map_err(|_| CommandOutputError::NotUtf8)
    };
    tokio::time::timeout(timeout, run)
        .await
        .map_err(|_| CommandOutputError::Timeout(timeout))?
}
