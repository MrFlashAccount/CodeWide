//! `providers.claude` entry of `agent-providers.json`.
//!
//! Every field is optional. Without an entry, or with `{}`, Claude runs with
//! the user's `claude` found on the machine ([`ClaudeDefaults`]); `false`
//! disables Claude. An invalid entry disables Claude (the caller logs the
//! full error once) and never affects other providers.
//!
//! `environment` overrides the environment the `claude` children get,
//! because a service manager (systemd user units, launchd) starts the
//! companion with a minimal `PATH` and Claude's Bash tool inherits it;
//! without it the user's login-shell `PATH` is used. Only `PATH` and
//! `CLAUDE_CONFIG_DIR` are accepted; no credential or `ANTHROPIC_*` value
//! can be configured here.
//!
//! The fields of the former Claude agent host (`hostExecutable`, `agentSdk`,
//! `runtimeExecutable`, `sidecarEntry`) are accepted and ignored, so an
//! existing entry keeps Claude running.

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
    #[error(
        "`claude` was not found on this machine; install Claude Code or set providers.claude.claudeExecutable"
    )]
    NoClaude,
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
    claude_executable: Option<PathBuf>,
    journal_directory: Option<PathBuf>,
    idle_release_minutes: Option<u32>,
    environment: Option<RawEnvironment>,
    // The former agent host's launch fields: accepted, not used.
    #[serde(default, rename = "hostExecutable")]
    _host_executable: Option<Value>,
    #[serde(default, rename = "agentSdk")]
    _agent_sdk: Option<Value>,
    #[serde(default, rename = "runtimeExecutable")]
    _runtime_executable: Option<Value>,
    #[serde(default, rename = "sidecarEntry")]
    _sidecar_entry: Option<Value>,
}

/// What the companion knows about this machine before reading
/// `providers.claude`; every entry field falls back to it.
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct ClaudeDefaults {
    /// The user's `claude`, found on the machine.
    pub claude_executable: Option<PathBuf>,
    /// The thread state directory (`<state dir>/claude-journal`).
    pub journal_directory: PathBuf,
    /// The user's login-shell `PATH`, the children's `PATH` unless the
    /// entry configures one.
    pub login_path: Option<Vec<PathBuf>>,
}

/// The configured environment of the `claude` children.
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct ClaudeEnvironment {
    /// `PATH` (configured, else the login shell's); `None` keeps the
    /// companion's own.
    pub search_path: Option<Vec<PathBuf>>,
    /// `CLAUDE_CONFIG_DIR`; `None` keeps the companion's own (or Claude's
    /// default `~/.claude`).
    pub claude_config_dir: Option<PathBuf>,
}

/// Validated Claude provider configuration.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ClaudeConfig {
    pub claude_executable: PathBuf,
    /// Where each `CodeWide` thread's state lives (`threads/<id>/state.json`).
    pub journal_directory: PathBuf,
    pub idle_release_minutes: u32,
    pub environment: ClaudeEnvironment,
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

fn environment(
    raw: Option<RawEnvironment>,
    login_path: Option<&Vec<PathBuf>>,
) -> Result<ClaudeEnvironment, ClaudeConfigError> {
    let raw = raw.unwrap_or(RawEnvironment {
        path: None,
        claude_config_dir: None,
    });
    Ok(ClaudeEnvironment {
        search_path: match raw.path.as_deref() {
            Some(configured) => Some(search_path(configured)?),
            None => login_path.cloned(),
        },
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

fn existing(path: PathBuf, field: &'static str) -> Result<PathBuf, ClaudeConfigError> {
    let path = absolute(path, field)?;
    if path.exists() {
        Ok(path)
    } else {
        Err(ClaudeConfigError::Missing { field })
    }
}

impl ClaudeConfig {
    /// Parses and validates the entry over `defaults`. Configured paths
    /// must be absolute and exist; the journal directory is created on use.
    ///
    /// # Errors
    /// Returns the first violated rule, or why no `claude` is available.
    pub fn parse(entry: &Value, defaults: &ClaudeDefaults) -> Result<Self, ClaudeConfigError> {
        let raw: RawClaudeConfig = serde_json::from_value(entry.clone())
            .map_err(|error| ClaudeConfigError::Invalid(error.to_string()))?;
        let idle_release_minutes = raw
            .idle_release_minutes
            .unwrap_or(DEFAULT_IDLE_RELEASE_MINUTES);
        if !(MIN_IDLE_RELEASE_MINUTES..=MAX_IDLE_RELEASE_MINUTES).contains(&idle_release_minutes) {
            return Err(ClaudeConfigError::IdleRelease);
        }
        let claude_executable = match raw.claude_executable {
            Some(executable) => existing(executable, "claudeExecutable")?,
            None => defaults
                .claude_executable
                .clone()
                .ok_or(ClaudeConfigError::NoClaude)?,
        };
        executable_directory(&claude_executable, "claudeExecutable")?;
        Ok(Self {
            claude_executable,
            journal_directory: match raw.journal_directory {
                Some(directory) => absolute(directory, "journalDirectory")?,
                None => defaults.journal_directory.clone(),
            },
            idle_release_minutes,
            environment: environment(raw.environment, defaults.login_path.as_ref())?,
        })
    }

    /// The configuration without a `providers.claude` entry: the `claude`
    /// found on the machine.
    ///
    /// # Errors
    /// Returns why Claude cannot run (no `claude`).
    pub fn automatic(defaults: &ClaudeDefaults) -> Result<Self, ClaudeConfigError> {
        Self::parse(&Value::Object(serde_json::Map::new()), defaults)
    }

    /// The children's `PATH`: the directory of `claude` first, then the
    /// configured or login-shell `PATH`, else `inherited` (the companion's
    /// own). Duplicates keep their first position.
    #[must_use]
    pub fn search_path(&self, inherited: Option<&OsStr>) -> Vec<PathBuf> {
        let mut entries = Vec::new();
        let leading = self
            .claude_executable
            .parent()
            .unwrap_or(&self.claude_executable)
            .to_path_buf();
        let rest: Vec<PathBuf> = match &self.environment.search_path {
            Some(configured) => configured.clone(),
            None => inherited
                .map(std::env::split_paths)
                .into_iter()
                .flatten()
                .collect(),
        };
        for entry in std::iter::once(leading).chain(rest) {
            if !entries.contains(&entry) {
                entries.push(entry);
            }
        }
        entries
    }

    /// Variables the `claude` children get on top of the companion's
    /// environment: `PATH` (see [`Self::search_path`]) and, when configured,
    /// `CLAUDE_CONFIG_DIR`.
    #[must_use]
    pub fn child_environment(&self, inherited_path: Option<&OsStr>) -> Vec<(OsString, OsString)> {
        let mut path = OsString::new();
        for (index, entry) in self.search_path(inherited_path).iter().enumerate() {
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

    /// Claude's configuration directory: the configured
    /// `CLAUDE_CONFIG_DIR`, else the companion's own environment
    /// (`CLAUDE_CONFIG_DIR`, then `~/.claude`), the same one the children's
    /// `claude` uses.
    #[must_use]
    pub fn config_directory(&self) -> Option<PathBuf> {
        match &self.environment.claude_config_dir {
            Some(directory) => Some(directory.clone()),
            None => crate::watcher::config_directory(),
        }
    }

    /// Claude's session store (`<config directory>/projects`).
    #[must_use]
    pub fn projects_root(&self) -> Option<PathBuf> {
        self.config_directory()
            .map(|directory| directory.join("projects"))
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn defaults(directory: &Path) -> ClaudeDefaults {
        ClaudeDefaults {
            claude_executable: None,
            journal_directory: directory.join("claude-journal"),
            login_path: None,
        }
    }

    #[test]
    fn accepts_absolute_existing_paths_bounds_idle_release_and_ignores_host_fields()
    -> Result<(), Box<dyn std::error::Error>> {
        let directory = tempfile::tempdir()?;
        let file = directory.path().join("bin");
        std::fs::write(&file, "")?;
        let entry = |idle: Value| {
            json!({
                "runtimeExecutable": "node",
                "sidecarEntry": "/gone/main.js",
                "hostExecutable": file,
                "agentSdk": "/gone/sdk.mjs",
                "claudeExecutable": file,
                "journalDirectory": directory.path().join("journal"),
                "idleReleaseMinutes": idle,
            })
        };
        let defaults = defaults(directory.path());
        let config = ClaudeConfig::parse(&entry(json!(30)), &defaults)?;
        assert_eq!(config.idle_release_minutes, 30);
        assert_eq!(config.claude_executable, file);
        assert_eq!(config.journal_directory, directory.path().join("journal"));
        assert!(matches!(
            ClaudeConfig::parse(&entry(json!(4)), &defaults),
            Err(ClaudeConfigError::IdleRelease)
        ));
        assert!(matches!(
            ClaudeConfig::parse(&entry(json!(241)), &defaults),
            Err(ClaudeConfigError::IdleRelease)
        ));
        Ok(())
    }

    #[test]
    fn rejects_relative_missing_and_unknown_fields() -> Result<(), Box<dyn std::error::Error>> {
        let directory = tempfile::tempdir()?;
        let file = directory.path().join("bin");
        std::fs::write(&file, "")?;
        let defaults = defaults(directory.path());
        assert!(matches!(
            ClaudeConfig::parse(&json!({"claudeExecutable": "claude"}), &defaults),
            Err(ClaudeConfigError::NotAbsolute {
                field: "claudeExecutable"
            })
        ));
        assert!(matches!(
            ClaudeConfig::parse(
                &json!({"claudeExecutable": directory.path().join("nope")}),
                &defaults
            ),
            Err(ClaudeConfigError::Missing {
                field: "claudeExecutable"
            })
        ));
        assert!(matches!(
            ClaudeConfig::parse(&json!({"claudeExecutable": file, "apiKey": "x"}), &defaults),
            Err(ClaudeConfigError::Invalid(_))
        ));
        Ok(())
    }

    #[test]
    fn an_empty_entry_runs_the_found_claude() -> Result<(), Box<dyn std::error::Error>> {
        let directory = tempfile::tempdir()?;
        let claude = directory.path().join("bin/claude");
        let login = vec![PathBuf::from("/opt/tools/bin"), PathBuf::from("/usr/bin")];
        let found = ClaudeDefaults {
            claude_executable: Some(claude.clone()),
            login_path: Some(login),
            ..defaults(directory.path())
        };
        let config = ClaudeConfig::automatic(&found)?;
        assert_eq!(config.claude_executable, claude);
        assert_eq!(
            config.journal_directory,
            directory.path().join("claude-journal")
        );
        assert_eq!(
            config.search_path(Some(OsStr::new("/usr/bin:/bin"))),
            [
                directory.path().join("bin"),
                "/opt/tools/bin".into(),
                "/usr/bin".into()
            ]
        );
        assert!(matches!(
            ClaudeConfig::automatic(&ClaudeDefaults {
                claude_executable: None,
                ..found
            }),
            Err(ClaudeConfigError::NoClaude)
        ));
        Ok(())
    }

    #[test]
    fn child_environment_leads_with_the_claude_directory() -> Result<(), Box<dyn std::error::Error>>
    {
        let directory = tempfile::tempdir()?;
        let claude_dir = directory.path().join("claude/bin");
        std::fs::create_dir_all(&claude_dir)?;
        let claude = claude_dir.join("claude");
        std::fs::write(&claude, "")?;
        let defaults = defaults(directory.path());
        let entry = |environment: Option<Value>| {
            let mut entry = json!({"claudeExecutable": claude});
            if let Some(environment) = environment {
                entry["environment"] = environment;
            }
            entry
        };
        let path = |config: &ClaudeConfig, inherited: Option<&str>| {
            config
                .child_environment(inherited.map(OsStr::new))
                .into_iter()
                .find(|(name, _)| name == "PATH")
                .map(|(_, value)| value)
        };

        // No environment and no login-shell PATH keep the companion's PATH after the prepend.
        let plain = ClaudeConfig::parse(&entry(None), &defaults)?;
        assert_eq!(plain.environment, ClaudeEnvironment::default());
        assert_eq!(
            path(&plain, Some("/usr/bin:/bin")),
            Some(OsString::from(format!(
                "{}:/usr/bin:/bin",
                claude_dir.display()
            )))
        );
        assert_eq!(plain.child_environment(None).len(), 1);

        // A captured PATH replaces the inherited one; duplicates collapse.
        let config_dir = directory.path().join("claude-config");
        let captured = ClaudeConfig::parse(
            &entry(Some(json!({
                "PATH": format!("{}:/opt/tools/bin:/usr/bin", claude_dir.display()),
                "CLAUDE_CONFIG_DIR": config_dir,
            }))),
            &defaults,
        )?;
        assert_eq!(
            path(&captured, Some("/usr/bin:/bin")),
            Some(OsString::from(format!(
                "{}:/opt/tools/bin:/usr/bin",
                claude_dir.display()
            )))
        );
        assert!(captured.child_environment(None).contains(&(
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
        let defaults = defaults(directory.path());
        let entry =
            |environment: Value| json!({"claudeExecutable": file, "environment": environment});
        for invalid_path in ["", "/usr/bin:", "bin:/usr/bin", "/usr/bin::/bin"] {
            assert!(matches!(
                ClaudeConfig::parse(&entry(json!({"PATH": invalid_path})), &defaults),
                Err(ClaudeConfigError::SearchPath)
            ));
        }
        assert!(matches!(
            ClaudeConfig::parse(&entry(json!({"CLAUDE_CONFIG_DIR": "claude"})), &defaults),
            Err(ClaudeConfigError::NotAbsolute {
                field: "environment.CLAUDE_CONFIG_DIR"
            })
        ));
        assert!(matches!(
            ClaudeConfig::parse(&entry(json!({"ANTHROPIC_API_KEY": "x"})), &defaults),
            Err(ClaudeConfigError::Invalid(_))
        ));
        Ok(())
    }
}
