//! Version of the user's Claude Code executable (`host/src/claude/cliVersion.ts`).
//! The provider descriptor reports this runtime version, as Codex's
//! descriptor does, not the version of `CodeWide`'s adapter.

use std::{ffi::OsString, path::Path, time::Duration};

use super::command_output::{CommandOutputError, command_output};

const VERSION_TIMEOUT: Duration = Duration::from_secs(5);
const MAX_OUTPUT_BYTES: usize = 4096;
const MAX_VERSION_LENGTH: usize = 64;

/// Why no Claude version is known.
#[derive(Debug, thiserror::Error)]
pub enum CliVersionError {
    #[error("claude --version failed: {0}")]
    Command(#[from] CommandOutputError),
    #[error("claude --version did not report a semantic version")]
    NoVersion,
}

/// The length of the digit run at the start of `text`.
fn digits(text: &[u8]) -> usize {
    text.iter().take_while(|byte| byte.is_ascii_digit()).count()
}

/// The length of `\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?` at the start of
/// `text`, when it matches there.
fn version_at(text: &[u8]) -> Option<usize> {
    let mut end = 0;
    for part in 0..3 {
        if part > 0 {
            if text.get(end) != Some(&b'.') {
                return None;
            }
            end += 1;
        }
        let run = digits(&text[end..]);
        if run == 0 {
            return None;
        }
        end += run;
    }
    if matches!(text.get(end), Some(b'-' | b'+')) {
        let suffix = text[end + 1..]
            .iter()
            .take_while(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'-'))
            .count();
        if suffix > 0 {
            end += 1 + suffix;
        }
    }
    Some(end)
}

/// The first semantic version in `claude --version` output (`2.1.111 (Claude
/// Code)`, `Claude Code v2.2.0-beta.1`), at most 64 characters long.
///
/// # Errors
///
/// [`CliVersionError::NoVersion`] when the output has none, or it is too long.
pub fn parse_claude_version(output: &str) -> Result<&str, CliVersionError> {
    let bytes = output.as_bytes();
    let (start, length) = (0..bytes.len())
        .find_map(|start| version_at(&bytes[start..]).map(|length| (start, length)))
        .ok_or(CliVersionError::NoVersion)?;
    if length > MAX_VERSION_LENGTH {
        return Err(CliVersionError::NoVersion);
    }
    // The match is ASCII, so both ends are character boundaries.
    Ok(&output[start..start + length])
}

/// Runs `claude --version` once and returns the version it reports.
///
/// # Errors
///
/// Returns the command's failure or [`CliVersionError::NoVersion`].
pub async fn read_claude_version(
    executable: &Path,
    environment: &[(OsString, OsString)],
) -> Result<String, CliVersionError> {
    let output = command_output(
        executable,
        &["--version"],
        environment,
        VERSION_TIMEOUT,
        MAX_OUTPUT_BYTES,
    )
    .await?;
    parse_claude_version(&output).map(str::to_owned)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_scripts::fake_claude;

    #[test]
    fn the_version_is_extracted_from_the_human_readable_output() {
        assert_eq!(
            parse_claude_version("2.1.111 (Claude Code)\n").ok(),
            Some("2.1.111")
        );
        assert_eq!(
            parse_claude_version("Claude Code v2.2.0-beta.1\n").ok(),
            Some("2.2.0-beta.1")
        );
        assert_eq!(parse_claude_version("v1.2.3+\n").ok(), Some("1.2.3"));
        assert_eq!(parse_claude_version("1.2 then 3.4.5").ok(), Some("3.4.5"));
    }

    #[test]
    fn output_without_a_bounded_version_is_rejected() {
        for output in [
            "Claude Code\n".to_owned(),
            format!("2.1.0-{}", "a".repeat(65)),
        ] {
            assert_eq!(
                parse_claude_version(&output).map_err(|error| error.to_string()),
                Err("claude --version did not report a semantic version".to_owned())
            );
        }
    }

    #[tokio::test]
    async fn the_version_is_read_from_the_executable() {
        let directory = tempfile::tempdir().unwrap_or_else(|error| panic!("{error}"));
        let claude = fake_claude(
            directory.path(),
            "#!/bin/sh\n[ \"$1\" = --version ] || exit 2\necho '2.1.111 (Claude Code)'\n",
        );
        assert_eq!(
            read_claude_version(&claude, &[]).await.ok().as_deref(),
            Some("2.1.111")
        );
        let failing = fake_claude(directory.path(), "#!/bin/sh\necho 2.1.111\nexit 1\n");
        assert!(matches!(
            read_claude_version(&failing, &[]).await,
            Err(CliVersionError::Command(CommandOutputError::Failed(_)))
        ));
    }
}
