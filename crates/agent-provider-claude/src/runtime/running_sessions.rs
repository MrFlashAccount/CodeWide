//! The sessions another `claude` process runs, from the `claude` CLI
//! (`host/src/claude/cliRunningSessions.ts`): `claude agents --json` prints
//! the active sessions (interactive and background) as a JSON array for
//! scripting. The CLI owns Claude's process registry; `CodeWide` never reads
//! it itself.

use std::{collections::HashSet, ffi::OsString, path::PathBuf, time::Duration};

use async_trait::async_trait;
use serde_json::Value;

use super::command_output::{CommandOutputError, command_output};

const LIST_TIMEOUT: Duration = Duration::from_secs(10);
const MAX_OUTPUT_BYTES: usize = 4_194_304;

/// Why the running sessions are unknown.
#[derive(Debug, thiserror::Error)]
pub enum RunningSessionsError {
    #[error("claude agents --json failed: {0}")]
    Command(#[from] CommandOutputError),
    #[error("claude agents --json printed invalid JSON: {0}")]
    Json(#[from] serde_json::Error),
    #[error("claude agents --json did not print an array")]
    NotAnArray,
}

/// The ids of the Claude sessions that run in some `claude` process now.
#[async_trait]
pub trait RunningSessions: Send + Sync {
    /// Lists the running sessions' ids.
    ///
    /// # Errors
    ///
    /// Returns why the list could not be read.
    async fn list(&self) -> Result<HashSet<String>, RunningSessionsError>;
}

/// The `sessionId` of every entry of the CLI's array; entries without a
/// string one are skipped.
///
/// # Errors
///
/// Returns invalid JSON or output that is not an array.
pub fn parse_running_sessions(output: &str) -> Result<HashSet<String>, RunningSessionsError> {
    let Value::Array(entries) = serde_json::from_str(output)? else {
        return Err(RunningSessionsError::NotAnArray);
    };
    Ok(entries
        .into_iter()
        .filter_map(
            |mut entry| match entry.get_mut("sessionId").map(Value::take) {
                Some(Value::String(session_id)) => Some(session_id),
                _ => None,
            },
        )
        .collect())
}

/// [`RunningSessions`] through `claude agents --json`.
#[derive(Clone, Debug)]
pub struct CliRunningSessions {
    executable: PathBuf,
    environment: Vec<(OsString, OsString)>,
}

impl CliRunningSessions {
    /// Lists through `executable`, run with `environment` added to the
    /// companion's own.
    #[must_use]
    pub fn new(executable: PathBuf, environment: Vec<(OsString, OsString)>) -> Self {
        Self {
            executable,
            environment,
        }
    }
}

#[async_trait]
impl RunningSessions for CliRunningSessions {
    async fn list(&self) -> Result<HashSet<String>, RunningSessionsError> {
        let output = command_output(
            &self.executable,
            &["agents", "--json"],
            &self.environment,
            LIST_TIMEOUT,
            MAX_OUTPUT_BYTES,
        )
        .await?;
        parse_running_sessions(&output)
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;
    use crate::test_scripts::fake_claude;

    #[test]
    fn every_entrys_session_id_is_taken_and_entries_without_one_are_skipped() {
        let output = json!([
            {
                "cwd": "/home/user",
                "id": "48d313bf",
                "kind": "background",
                "name": "Review",
                "pid": 3_226_754,
                "sessionId": "48d313bf-0ef1-44f9-a458-bd7bb443b8d1",
                "state": "done",
                "status": "idle",
            },
            {"kind": "interactive", "pid": 2_203_797, "sessionId": "01a12320-fa11-7ba5-b9fc-a190b32c8824"},
            {"kind": "interactive", "pid": 1},
            {"kind": "interactive", "sessionId": 7},
            "not an entry",
        ])
        .to_string();
        let sessions = parse_running_sessions(&output).unwrap_or_else(|error| panic!("{error}"));
        assert_eq!(
            sessions,
            HashSet::from([
                "48d313bf-0ef1-44f9-a458-bd7bb443b8d1".to_owned(),
                "01a12320-fa11-7ba5-b9fc-a190b32c8824".to_owned(),
            ])
        );
    }

    #[test]
    fn output_that_is_not_an_array_is_rejected() {
        assert!(matches!(
            parse_running_sessions("{}"),
            Err(RunningSessionsError::NotAnArray)
        ));
        assert!(matches!(
            parse_running_sessions("not json"),
            Err(RunningSessionsError::Json(_))
        ));
    }

    #[tokio::test]
    async fn the_cli_is_asked_for_its_agents_as_json() {
        let directory = tempfile::tempdir().unwrap_or_else(|error| panic!("{error}"));
        let claude = fake_claude(
            directory.path(),
            "#!/bin/sh\n[ \"$1 $2\" = 'agents --json' ] || exit 2\n[ \"$CODEWIDE_TEST\" = set ] || exit 3\necho '[{\"sessionId\":\"s1\"}]'\n",
        );
        let sessions =
            CliRunningSessions::new(claude, vec![("CODEWIDE_TEST".into(), "set".into())])
                .list()
                .await
                .unwrap_or_else(|error| panic!("{error}"));
        assert_eq!(sessions, HashSet::from(["s1".to_owned()]));
    }
}
