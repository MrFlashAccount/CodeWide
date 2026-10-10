//! `providers.claude` entry of `agent-providers.json`.
//!
//! Every field is optional. Without an entry, or with `{}`, Claude runs the
//! agent host shipped with this companion and the user's `claude` found on
//! the machine ([`ClaudeDefaults`]); `false` disables Claude. An invalid
//! entry disables Claude (the caller logs the full error once) and never
//! affects other providers.
//!
//! `environment` overrides the environment the host child gets, because a
//! service manager (systemd user units, launchd) starts the companion with a
//! minimal `PATH` and Claude's Bash tool inherits the host's `PATH`; without
//! it the user's login-shell `PATH` is used. Only `PATH` and
//! `CLAUDE_CONFIG_DIR` are accepted; no credential or `ANTHROPIC_*` value
//! can be configured here.

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
        "this companion ships no Claude agent host; set providers.claude.hostExecutable or runtimeExecutable with sidecarEntry"
    )]
    NoHost,
    #[error(
        "`claude` was not found on this machine; install Claude Code or set providers.claude.claudeExecutable"
    )]
    NoClaude,
    #[error(
        "the Claude Agent SDK is not installed; set providers.claude.agentSdk or let the companion download it"
    )]
    NoAgentSdk,
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
    host_executable: Option<PathBuf>,
    agent_sdk: Option<PathBuf>,
    runtime_executable: Option<PathBuf>,
    sidecar_entry: Option<PathBuf>,
    claude_executable: Option<PathBuf>,
    journal_directory: Option<PathBuf>,
    idle_release_minutes: Option<u32>,
    environment: Option<RawEnvironment>,
}

/// What the companion knows about this machine before reading
/// `providers.claude`; every entry field falls back to it.
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct ClaudeDefaults {
    /// The self-contained host executable shipped with this companion.
    pub bundled_host: Option<PathBuf>,
    /// `sdk.mjs` of the Agent SDK the companion installed for that host.
    pub agent_sdk: Option<PathBuf>,
    /// The user's `claude`, found on the machine.
    pub claude_executable: Option<PathBuf>,
    /// The host's metadata directory (`<state dir>/claude-journal`).
    pub journal_directory: PathBuf,
    /// The user's login-shell `PATH`, the host child's `PATH` unless the
    /// entry configures one.
    pub login_path: Option<Vec<PathBuf>>,
}

/// How the companion starts the Claude agent host.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum HostLaunch {
    /// A self-contained host executable (`bun build --compile` with the
    /// Agent SDK left out): the one shipped with this companion, or
    /// `hostExecutable`. It loads the SDK from `agent_sdk` (`sdk.mjs`).
    Executable {
        executable: PathBuf,
        agent_sdk: PathBuf,
    },
    /// A JavaScript runtime running the host's entry script
    /// (`runtimeExecutable` + `sidecarEntry`), for development.
    Script { runtime: PathBuf, entry: PathBuf },
}

/// The configured environment of the host child.
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct HostEnvironment {
    /// `PATH` of the host child (configured, else the login shell's);
    /// `None` keeps the companion's own.
    pub search_path: Option<Vec<PathBuf>>,
    /// `CLAUDE_CONFIG_DIR`; `None` keeps the companion's own (or Claude's
    /// default `~/.claude`).
    pub claude_config_dir: Option<PathBuf>,
}

/// Validated Claude provider configuration.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ClaudeConfig {
    pub host: HostLaunch,
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

fn environment(
    raw: Option<RawEnvironment>,
    login_path: Option<&Vec<PathBuf>>,
) -> Result<HostEnvironment, ClaudeConfigError> {
    let raw = raw.unwrap_or(RawEnvironment {
        path: None,
        claude_config_dir: None,
    });
    Ok(HostEnvironment {
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

fn host_launch(
    raw: &mut RawClaudeConfig,
    defaults: &ClaudeDefaults,
) -> Result<HostLaunch, ClaudeConfigError> {
    let configured_sdk = raw.agent_sdk.take();
    let agent_sdk = || match configured_sdk.clone() {
        Some(path) => existing(path, "agentSdk"),
        None => defaults
            .agent_sdk
            .clone()
            .ok_or(ClaudeConfigError::NoAgentSdk),
    };
    match (
        raw.host_executable.take(),
        raw.runtime_executable.take(),
        raw.sidecar_entry.take(),
    ) {
        (Some(executable), None, None) => Ok(HostLaunch::Executable {
            executable: existing(executable, "hostExecutable")?,
            agent_sdk: agent_sdk()?,
        }),
        (None, Some(runtime), Some(entry)) => {
            let runtime = existing(runtime, "runtimeExecutable")?;
            executable_directory(&runtime, "runtimeExecutable")?;
            Ok(HostLaunch::Script {
                runtime,
                entry: existing(entry, "sidecarEntry")?,
            })
        }
        (None, None, None) => Ok(HostLaunch::Executable {
            executable: defaults
                .bundled_host
                .clone()
                .ok_or(ClaudeConfigError::NoHost)?,
            agent_sdk: agent_sdk()?,
        }),
        _ => Err(ClaudeConfigError::Invalid(
            "set either hostExecutable or runtimeExecutable with sidecarEntry".into(),
        )),
    }
}

impl HostLaunch {
    /// The program the companion starts.
    #[must_use]
    pub fn program(&self) -> &Path {
        match self {
            Self::Executable { executable, .. } => executable,
            Self::Script { runtime, .. } => runtime,
        }
    }
}

impl ClaudeConfig {
    /// Parses and validates the entry over `defaults`. Configured paths
    /// must be absolute and exist; the journal directory is created by the
    /// host.
    ///
    /// # Errors
    /// Returns the first violated rule, or why no host or no `claude` is
    /// available.
    pub fn parse(entry: &Value, defaults: &ClaudeDefaults) -> Result<Self, ClaudeConfigError> {
        let mut raw: RawClaudeConfig = serde_json::from_value(entry.clone())
            .map_err(|error| ClaudeConfigError::Invalid(error.to_string()))?;
        let idle_release_minutes = raw
            .idle_release_minutes
            .unwrap_or(DEFAULT_IDLE_RELEASE_MINUTES);
        if !(MIN_IDLE_RELEASE_MINUTES..=MAX_IDLE_RELEASE_MINUTES).contains(&idle_release_minutes) {
            return Err(ClaudeConfigError::IdleRelease);
        }
        let host = host_launch(&mut raw, defaults)?;
        let claude_executable = match raw.claude_executable {
            Some(executable) => existing(executable, "claudeExecutable")?,
            None => defaults
                .claude_executable
                .clone()
                .ok_or(ClaudeConfigError::NoClaude)?,
        };
        executable_directory(&claude_executable, "claudeExecutable")?;
        Ok(Self {
            host,
            claude_executable,
            journal_directory: match raw.journal_directory {
                Some(directory) => absolute(directory, "journalDirectory")?,
                None => defaults.journal_directory.clone(),
            },
            idle_release_minutes,
            environment: environment(raw.environment, defaults.login_path.as_ref())?,
        })
    }

    /// The configuration without a `providers.claude` entry: the shipped
    /// host and the `claude` found on the machine.
    ///
    /// # Errors
    /// Returns why Claude cannot run (no shipped host, no `claude`).
    pub fn automatic(defaults: &ClaudeDefaults) -> Result<Self, ClaudeConfigError> {
        Self::parse(&Value::Object(serde_json::Map::new()), defaults)
    }

    /// The host child's `PATH`: the directories of the script runtime (when
    /// one is configured) and of `claude` first, so `#!/usr/bin/env node`
    /// scripts find them, then the configured or login-shell `PATH`, else
    /// `inherited` (the companion's own). Duplicates keep their first
    /// position.
    #[must_use]
    pub fn host_search_path(&self, inherited: Option<&OsStr>) -> Vec<PathBuf> {
        let mut entries = Vec::new();
        let runtime = match &self.host {
            HostLaunch::Script { runtime, .. } => Some(runtime),
            HostLaunch::Executable { .. } => None,
        };
        let leading = runtime
            .into_iter()
            .chain([&self.claude_executable])
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

    /// Host command-line arguments after the program (paths and numbers
    /// only, no secrets): the entry script for a script host, then the
    /// host's own flags.
    #[must_use]
    pub fn host_args(&self) -> Vec<OsString> {
        let mut args = match &self.host {
            HostLaunch::Script { entry, .. } => vec![entry.clone().into_os_string()],
            HostLaunch::Executable { agent_sdk, .. } => {
                vec!["--agent-sdk".into(), agent_sdk.clone().into_os_string()]
            }
        };
        args.extend([
            "--claude-executable".into(),
            self.claude_executable.clone().into_os_string(),
            "--journal-directory".into(),
            self.journal_directory.clone().into_os_string(),
            "--idle-release-minutes".into(),
            self.idle_release_minutes.to_string().into(),
        ]);
        args
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn defaults(directory: &Path) -> ClaudeDefaults {
        ClaudeDefaults {
            bundled_host: None,
            agent_sdk: None,
            claude_executable: None,
            journal_directory: directory.join("claude-journal"),
            login_path: None,
        }
    }

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
        let defaults = defaults(directory.path());
        let config = ClaudeConfig::parse(&entry(json!(30)), &defaults)?;
        assert_eq!(config.idle_release_minutes, 30);
        assert_eq!(
            config.host_args()[..3],
            [
                file.clone().into_os_string(),
                OsString::from("--claude-executable"),
                file.clone().into_os_string()
            ]
        );
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
    fn rejects_relative_missing_mixed_and_unknown_fields() -> Result<(), Box<dyn std::error::Error>>
    {
        let directory = tempfile::tempdir()?;
        let file = directory.path().join("bin");
        std::fs::write(&file, "")?;
        let defaults = defaults(directory.path());
        let relative = json!({
            "runtimeExecutable": "node", "sidecarEntry": file, "claudeExecutable": file,
            "journalDirectory": directory.path()
        });
        assert!(matches!(
            ClaudeConfig::parse(&relative, &defaults),
            Err(ClaudeConfigError::NotAbsolute {
                field: "runtimeExecutable"
            })
        ));
        let missing = json!({
            "runtimeExecutable": file, "sidecarEntry": directory.path().join("nope"),
            "claudeExecutable": file, "journalDirectory": directory.path()
        });
        assert!(matches!(
            ClaudeConfig::parse(&missing, &defaults),
            Err(ClaudeConfigError::Missing {
                field: "sidecarEntry"
            })
        ));
        let mixed =
            json!({"hostExecutable": file, "runtimeExecutable": file, "claudeExecutable": file});
        assert!(matches!(
            ClaudeConfig::parse(&mixed, &defaults),
            Err(ClaudeConfigError::Invalid(_))
        ));
        let unknown = json!({"claudeExecutable": file, "hostExecutable": file, "apiKey": "x"});
        assert!(matches!(
            ClaudeConfig::parse(&unknown, &defaults),
            Err(ClaudeConfigError::Invalid(_))
        ));
        Ok(())
    }

    #[test]
    fn an_empty_entry_runs_the_shipped_host_with_the_found_claude()
    -> Result<(), Box<dyn std::error::Error>> {
        let directory = tempfile::tempdir()?;
        let host = directory.path().join("claude-agent-host");
        let claude = directory.path().join("bin/claude");
        let login = vec![PathBuf::from("/opt/tools/bin"), PathBuf::from("/usr/bin")];
        let sdk = directory.path().join("agent-sdk/sdk.mjs");
        let found = ClaudeDefaults {
            bundled_host: Some(host.clone()),
            agent_sdk: Some(sdk.clone()),
            claude_executable: Some(claude.clone()),
            login_path: Some(login),
            ..defaults(directory.path())
        };
        let config = ClaudeConfig::automatic(&found)?;
        assert_eq!(
            config.host,
            HostLaunch::Executable {
                executable: host.clone(),
                agent_sdk: sdk.clone()
            }
        );
        assert_eq!(config.host.program(), host);
        assert_eq!(
            config.journal_directory,
            directory.path().join("claude-journal")
        );
        assert_eq!(
            config.host_args()[..3],
            [
                OsString::from("--agent-sdk"),
                sdk.into_os_string(),
                OsString::from("--claude-executable")
            ]
        );
        assert_eq!(
            config.host_search_path(Some(OsStr::new("/usr/bin:/bin"))),
            [
                directory.path().join("bin"),
                "/opt/tools/bin".into(),
                "/usr/bin".into()
            ]
        );
        assert!(matches!(
            ClaudeConfig::automatic(&ClaudeDefaults {
                bundled_host: None,
                ..found.clone()
            }),
            Err(ClaudeConfigError::NoHost)
        ));
        assert!(matches!(
            ClaudeConfig::automatic(&ClaudeDefaults {
                agent_sdk: None,
                ..found.clone()
            }),
            Err(ClaudeConfigError::NoAgentSdk)
        ));
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
        let defaults = defaults(directory.path());
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

        // No environment and no login-shell PATH keep the companion's PATH after the prepend.
        let legacy = ClaudeConfig::parse(&entry(None), &defaults)?;
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
        let captured = ClaudeConfig::parse(
            &entry(Some(json!({
                "PATH": format!("{}:/opt/tools/bin:/usr/bin", runtime_dir.display()),
                "CLAUDE_CONFIG_DIR": config_dir,
            }))),
            &defaults,
        )?;
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
        let defaults = defaults(directory.path());
        let entry = |environment: Value| {
            json!({
                "runtimeExecutable": file, "sidecarEntry": file, "claudeExecutable": file,
                "journalDirectory": directory.path(), "environment": environment,
            })
        };
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
