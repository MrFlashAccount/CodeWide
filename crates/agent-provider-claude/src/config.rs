//! `providers.claude` entry of `agent-providers.json`.
//!
//! Every path is absolute; the idle release window is bounded. An invalid
//! entry disables Claude (the caller logs the full error once) and never
//! affects other providers.
//!
//! `environment` is the part of the user's environment the installer
//! captured for the host child, because a service manager (systemd user
//! units, launchd) starts the companion with a minimal `PATH`: an npm-global
//! `claude` is a `#!/usr/bin/env node` script, and Claude's Bash tool inherits
//! the host's `PATH`. Only `PATH` and `CLAUDE_CONFIG_DIR` are accepted; no
//! credential or `ANTHROPIC_*` value can be configured here.

use std::{
    ffi::{OsStr, OsString},
    path::{Path, PathBuf},
};

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
    #[error("providers.claude.environment.PATH must list absolute directories separated by ':'")]
    SearchPath,
    #[error("providers.claude.{field} must not contain ':'")]
    PathSeparator { field: &'static str },
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawEnvironment {
    #[serde(rename = "PATH")]
    path: Option<String>,
    #[serde(rename = "CLAUDE_CONFIG_DIR")]
    claude_config_dir: Option<PathBuf>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RawClaudeConfig {
    runtime_executable: PathBuf,
    sidecar_entry: PathBuf,
    claude_executable: PathBuf,
    journal_directory: PathBuf,
    idle_release_minutes: Option<u32>,
    environment: Option<RawEnvironment>,
}

/// The configured environment of the host child.
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct HostEnvironment {
    /// `PATH` captured by the installer; `None` keeps the companion's own.
    pub search_path: Option<Vec<PathBuf>>,
    /// `CLAUDE_CONFIG_DIR`; `None` keeps the companion's own (or Claude's
    /// default `~/.claude`).
    pub claude_config_dir: Option<PathBuf>,
}

/// Validated Claude provider configuration.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ClaudeConfig {
    pub runtime_executable: PathBuf,
    pub sidecar_entry: PathBuf,
    pub claude_executable: PathBuf,
    pub journal_directory: PathBuf,
    pub idle_release_minutes: u32,
    pub environment: HostEnvironment,
}

fn absolute(path: PathBuf, field: &'static str) -> Result<PathBuf, ClaudeConfigError> {
    if path.is_absolute() {
        Ok(path)
    } else {
        Err(ClaudeConfigError::NotAbsolute { field })
    }
}

fn search_path(value: &str) -> Result<Vec<PathBuf>, ClaudeConfigError> {
    // An empty entry would mean the working directory; reject it.
    let entries = value.split(':').map(PathBuf::from).collect::<Vec<_>>();
    if entries.iter().all(|entry| entry.is_absolute()) {
        Ok(entries)
    } else {
        Err(ClaudeConfigError::SearchPath)
    }
}

fn environment(raw: Option<RawEnvironment>) -> Result<HostEnvironment, ClaudeConfigError> {
    let Some(raw) = raw else {
        return Ok(HostEnvironment::default());
    };
    Ok(HostEnvironment {
        search_path: raw.path.as_deref().map(search_path).transpose()?,
        claude_config_dir: raw
            .claude_config_dir
            .map(|directory| absolute(directory, "environment.CLAUDE_CONFIG_DIR"))
            .transpose()?,
    })
}

/// The directory that holds `executable`, as it will appear in `PATH`.
fn executable_directory(
    executable: &Path,
    field: &'static str,
) -> Result<PathBuf, ClaudeConfigError> {
    let directory = executable.parent().unwrap_or(executable).to_path_buf();
    if directory.as_os_str().as_encoded_bytes().contains(&b':') {
        Err(ClaudeConfigError::PathSeparator { field })
    } else {
        Ok(directory)
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
            environment: environment(raw.environment)?,
        };
        existing(&config.runtime_executable, "runtimeExecutable")?;
        existing(&config.sidecar_entry, "sidecarEntry")?;
        existing(&config.claude_executable, "claudeExecutable")?;
        executable_directory(&config.runtime_executable, "runtimeExecutable")?;
        executable_directory(&config.claude_executable, "claudeExecutable")?;
        Ok(config)
    }

    /// The host child's `PATH`: the directories of `runtimeExecutable` and
    /// `claudeExecutable` first (so `#!/usr/bin/env node` scripts find the
    /// configured runtime), then the configured `PATH`, else `inherited` (the
    /// companion's own). Duplicates keep their first position.
    #[must_use]
    pub fn host_search_path(&self, inherited: Option<&OsStr>) -> Vec<PathBuf> {
        let mut entries = Vec::new();
        let leading = [&self.runtime_executable, &self.claude_executable]
            .into_iter()
            .map(|executable| executable.parent().unwrap_or(executable).to_path_buf());
        let rest: Vec<PathBuf> = match &self.environment.search_path {
            Some(configured) => configured.clone(),
            None => inherited
                .map(std::env::split_paths)
                .into_iter()
                .flatten()
                .collect(),
        };
        for entry in leading.chain(rest) {
            if !entries.contains(&entry) {
                entries.push(entry);
            }
        }
        entries
    }

    /// Variables the host child gets on top of the companion's environment:
    /// `PATH` (see [`Self::host_search_path`]) and, when configured,
    /// `CLAUDE_CONFIG_DIR`.
    #[must_use]
    pub fn host_environment(&self, inherited_path: Option<&OsStr>) -> Vec<(OsString, OsString)> {
        let mut path = OsString::new();
        for (index, entry) in self.host_search_path(inherited_path).iter().enumerate() {
            if index > 0 {
                path.push(":");
            }
            path.push(entry);
        }
        let mut environment = vec![(OsString::from("PATH"), path)];
        if let Some(directory) = &self.environment.claude_config_dir {
            environment.push((
                OsString::from("CLAUDE_CONFIG_DIR"),
                directory.clone().into_os_string(),
            ));
        }
        environment
    }

    /// Claude's session store the watcher observes: the configured
    /// `CLAUDE_CONFIG_DIR`, else the companion's own environment
    /// (`CLAUDE_CONFIG_DIR`, then `~/.claude`), the same directory the host
    /// child's `claude` uses.
    #[must_use]
    pub fn projects_root(&self) -> Option<PathBuf> {
        match &self.environment.claude_config_dir {
            Some(directory) => Some(directory.join("projects")),
            None => crate::watcher::projects_root(),
        }
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

    #[test]
    fn host_environment_leads_with_the_configured_executables()
    -> Result<(), Box<dyn std::error::Error>> {
        let directory = tempfile::tempdir()?;
        let runtime_dir = directory.path().join("node/bin");
        let claude_dir = directory.path().join("claude/bin");
        std::fs::create_dir_all(&runtime_dir)?;
        std::fs::create_dir_all(&claude_dir)?;
        let node = runtime_dir.join("node");
        let claude = claude_dir.join("claude");
        std::fs::write(&node, "")?;
        std::fs::write(&claude, "")?;
        let entry = |environment: Option<Value>| {
            let mut entry = json!({
                "runtimeExecutable": node, "sidecarEntry": node, "claudeExecutable": claude,
                "journalDirectory": directory.path().join("journal"),
            });
            if let Some(environment) = environment {
                entry["environment"] = environment;
            }
            entry
        };
        let path = |config: &ClaudeConfig, inherited: Option<&str>| {
            config
                .host_environment(inherited.map(OsStr::new))
                .into_iter()
                .find(|(name, _)| name == "PATH")
                .map(|(_, value)| value)
        };

        // An old entry (no environment) keeps the companion's PATH after the prepend.
        let legacy = ClaudeConfig::parse(&entry(None))?;
        assert_eq!(legacy.environment, HostEnvironment::default());
        assert_eq!(
            path(&legacy, Some("/usr/bin:/bin")),
            Some(OsString::from(format!(
                "{}:{}:/usr/bin:/bin",
                runtime_dir.display(),
                claude_dir.display()
            )))
        );
        assert_eq!(legacy.host_environment(None).len(), 1);

        // A captured PATH replaces the inherited one; duplicates collapse.
        let config_dir = directory.path().join("claude-config");
        let captured = ClaudeConfig::parse(&entry(Some(json!({
            "PATH": format!("{}:/opt/tools/bin:/usr/bin", runtime_dir.display()),
            "CLAUDE_CONFIG_DIR": config_dir,
        }))))?;
        assert_eq!(
            path(&captured, Some("/usr/bin:/bin")),
            Some(OsString::from(format!(
                "{}:{}:/opt/tools/bin:/usr/bin",
                runtime_dir.display(),
                claude_dir.display()
            )))
        );
        assert!(captured.host_environment(None).contains(&(
            OsString::from("CLAUDE_CONFIG_DIR"),
            config_dir.clone().into_os_string()
        )));
        assert_eq!(captured.projects_root(), Some(config_dir.join("projects")));
        Ok(())
    }

    #[test]
    fn environment_accepts_only_absolute_path_and_config_dir()
    -> Result<(), Box<dyn std::error::Error>> {
        let directory = tempfile::tempdir()?;
        let file = directory.path().join("bin");
        std::fs::write(&file, "")?;
        let entry = |environment: Value| {
            json!({
                "runtimeExecutable": file, "sidecarEntry": file, "claudeExecutable": file,
                "journalDirectory": directory.path(), "environment": environment,
            })
        };
        for invalid_path in ["", "/usr/bin:", "bin:/usr/bin", "/usr/bin::/bin"] {
            assert!(matches!(
                ClaudeConfig::parse(&entry(json!({"PATH": invalid_path}))),
                Err(ClaudeConfigError::SearchPath)
            ));
        }
        assert!(matches!(
            ClaudeConfig::parse(&entry(json!({"CLAUDE_CONFIG_DIR": "claude"}))),
            Err(ClaudeConfigError::NotAbsolute {
                field: "environment.CLAUDE_CONFIG_DIR"
            })
        ));
        assert!(matches!(
            ClaudeConfig::parse(&entry(json!({"ANTHROPIC_API_KEY": "x"}))),
            Err(ClaudeConfigError::Invalid(_))
        ));
        Ok(())
    }
}
