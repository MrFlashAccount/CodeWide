//! `providers.claude` entry of `agent-providers.json`.
//!
//! Every path is absolute; the idle release window is bounded. An invalid
//! entry disables Claude (the caller logs the full error once) and never
//! affects other providers.

use std::path::{Path, PathBuf};

use serde::Deserialize;
use serde_json::Value;

pub const DEFAULT_IDLE_RELEASE_MINUTES: u32 = 30;
pub const MIN_IDLE_RELEASE_MINUTES: u32 = 5;
pub const MAX_IDLE_RELEASE_MINUTES: u32 = 240;

#[derive(Debug, thiserror::Error)]
pub enum ClaudeConfigError {
    #[error("providers.claude is invalid: {0}")]
    Invalid(String),
    #[error("providers.claude.{field} must be an absolute path")]
    NotAbsolute { field: &'static str },
    #[error("providers.claude.{field} does not exist")]
    Missing { field: &'static str },
    #[error(
        "providers.claude.idleReleaseMinutes must be between {MIN_IDLE_RELEASE_MINUTES} and {MAX_IDLE_RELEASE_MINUTES}"
    )]
    IdleRelease,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RawClaudeConfig {
    runtime_executable: PathBuf,
    sidecar_entry: PathBuf,
    claude_executable: PathBuf,
    journal_directory: PathBuf,
    idle_release_minutes: Option<u32>,
}

/// Validated Claude provider configuration.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ClaudeConfig {
    pub runtime_executable: PathBuf,
    pub sidecar_entry: PathBuf,
    pub claude_executable: PathBuf,
    pub journal_directory: PathBuf,
    pub idle_release_minutes: u32,
}

fn absolute(path: PathBuf, field: &'static str) -> Result<PathBuf, ClaudeConfigError> {
    if path.is_absolute() {
        Ok(path)
    } else {
        Err(ClaudeConfigError::NotAbsolute { field })
    }
}

fn existing(path: &Path, field: &'static str) -> Result<(), ClaudeConfigError> {
    if path.exists() {
        Ok(())
    } else {
        Err(ClaudeConfigError::Missing { field })
    }
}

impl ClaudeConfig {
    /// Parses and validates the entry. Executables and the sidecar entry
    /// must exist; the journal directory is created by the sidecar.
    ///
    /// # Errors
    /// Returns the first violated rule.
    pub fn parse(entry: &Value) -> Result<Self, ClaudeConfigError> {
        let raw: RawClaudeConfig = serde_json::from_value(entry.clone())
            .map_err(|error| ClaudeConfigError::Invalid(error.to_string()))?;
        let idle_release_minutes = raw
            .idle_release_minutes
            .unwrap_or(DEFAULT_IDLE_RELEASE_MINUTES);
        if !(MIN_IDLE_RELEASE_MINUTES..=MAX_IDLE_RELEASE_MINUTES).contains(&idle_release_minutes) {
            return Err(ClaudeConfigError::IdleRelease);
        }
        let config = Self {
            runtime_executable: absolute(raw.runtime_executable, "runtimeExecutable")?,
            sidecar_entry: absolute(raw.sidecar_entry, "sidecarEntry")?,
            claude_executable: absolute(raw.claude_executable, "claudeExecutable")?,
            journal_directory: absolute(raw.journal_directory, "journalDirectory")?,
            idle_release_minutes,
        };
        existing(&config.runtime_executable, "runtimeExecutable")?;
        existing(&config.sidecar_entry, "sidecarEntry")?;
        existing(&config.claude_executable, "claudeExecutable")?;
        Ok(config)
    }

    /// Sidecar command-line arguments (paths and numbers only, no secrets).
    #[must_use]
    pub fn sidecar_args(&self) -> Vec<std::ffi::OsString> {
        vec![
            self.sidecar_entry.clone().into_os_string(),
            "--claude-executable".into(),
            self.claude_executable.clone().into_os_string(),
            "--journal-directory".into(),
            self.journal_directory.clone().into_os_string(),
            "--idle-release-minutes".into(),
            self.idle_release_minutes.to_string().into(),
        ]
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn accepts_absolute_existing_paths_and_bounds_idle_release()
    -> Result<(), Box<dyn std::error::Error>> {
        let directory = tempfile::tempdir()?;
        let file = directory.path().join("bin");
        std::fs::write(&file, "")?;
        let entry = |idle: Value| {
            json!({
                "runtimeExecutable": file,
                "sidecarEntry": file,
                "claudeExecutable": file,
                "journalDirectory": directory.path().join("journal"),
                "idleReleaseMinutes": idle,
            })
        };
        let config = ClaudeConfig::parse(&entry(json!(30)))?;
        assert_eq!(config.idle_release_minutes, 30);
        assert_eq!(
            config.sidecar_args()[1..3],
            [
                std::ffi::OsString::from("--claude-executable"),
                file.clone().into_os_string()
            ]
        );
        assert!(matches!(
            ClaudeConfig::parse(&entry(json!(4))),
            Err(ClaudeConfigError::IdleRelease)
        ));
        assert!(matches!(
            ClaudeConfig::parse(&entry(json!(241))),
            Err(ClaudeConfigError::IdleRelease)
        ));
        Ok(())
    }

    #[test]
    fn rejects_relative_missing_and_unknown_fields() -> Result<(), Box<dyn std::error::Error>> {
        let directory = tempfile::tempdir()?;
        let file = directory.path().join("bin");
        std::fs::write(&file, "")?;
        let relative = json!({
            "runtimeExecutable": "node", "sidecarEntry": file, "claudeExecutable": file,
            "journalDirectory": directory.path()
        });
        assert!(matches!(
            ClaudeConfig::parse(&relative),
            Err(ClaudeConfigError::NotAbsolute {
                field: "runtimeExecutable"
            })
        ));
        let missing = json!({
            "runtimeExecutable": file, "sidecarEntry": directory.path().join("nope"),
            "claudeExecutable": file, "journalDirectory": directory.path()
        });
        assert!(matches!(
            ClaudeConfig::parse(&missing),
            Err(ClaudeConfigError::Missing {
                field: "sidecarEntry"
            })
        ));
        let unknown = json!({
            "runtimeExecutable": file, "sidecarEntry": file, "claudeExecutable": file,
            "journalDirectory": directory.path(), "apiKey": "x"
        });
        assert!(matches!(
            ClaudeConfig::parse(&unknown),
            Err(ClaudeConfigError::Invalid(_))
        ));
        Ok(())
    }
}
