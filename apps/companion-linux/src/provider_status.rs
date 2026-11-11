//! `codewide-companion providers status`: an offline report of the
//! providers the companion would enable on this machine — Codex always,
//! Claude when the user's `claude` is found — and whether Claude could
//! start. It reads file metadata and the login shell's `PATH` only; it
//! starts no provider, makes no network or model call, and never talks to
//! the running daemon. No configuration file is read.

use std::{
    ffi::OsString,
    path::{Path, PathBuf},
};

use codewide_companion::agent::providers::{claude, codex};
use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatusReport {
    providers: Vec<ProviderStatus>,
}

impl StatusReport {
    /// Whether every provider the companion would enable could start.
    #[must_use]
    pub fn ready(&self) -> bool {
        self.providers.iter().all(|provider| {
            matches!(
                provider.state,
                ProviderState::BuiltIn { .. }
                    | ProviderState::Ready { .. }
                    | ProviderState::Off { .. }
            )
        })
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProviderStatus {
    id: String,
    #[serde(flatten)]
    state: ProviderState,
}

#[derive(Debug, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
enum ProviderState {
    /// Codex: always enabled, configured by the `serve` flags.
    BuiltIn {
        note: &'static str,
    },
    Ready {
        host: ClaudeHostReport,
    },
    NotReady {
        problems: Vec<String>,
        host: ClaudeHostReport,
    },
    /// No `claude` found: the companion runs no Claude.
    Off {
        reason: String,
    },
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ClaudeHostReport {
    /// The `PATH` the `claude` children get.
    search_path: Vec<PathBuf>,
    /// `loginShell` (the user's login-shell `PATH`) or `inherited` (the
    /// companion's own `PATH`, here: this command's `PATH`, which may differ
    /// from the service manager's).
    search_path_source: &'static str,
    /// Claude's configuration directory (`CLAUDE_CONFIG_DIR`, else
    /// `~/.claude`).
    config_directory: Option<PathBuf>,
    /// Claude's session store the companion watches.
    projects_root: Option<PathBuf>,
}

/// The default companion state directory of the Linux user service.
#[must_use]
pub fn default_state_directory() -> PathBuf {
    std::env::var_os("XDG_STATE_HOME")
        .filter(|value| !value.is_empty())
        .map_or_else(
            || {
                std::env::var_os("HOME").map_or_else(
                    || PathBuf::from(".local/state"),
                    |home| PathBuf::from(home).join(".local/state"),
                )
            },
            PathBuf::from,
        )
        .join("codewide/companion")
}

/// Builds the report; `inherited_path` stands in for the companion's own
/// `PATH` when the login shell reports none.
#[must_use]
pub fn report(state_directory: &Path, inherited_path: Option<&OsString>) -> StatusReport {
    report_with(
        &claude::config::ClaudeDefaults::discover(state_directory.join("claude-journal")),
        inherited_path,
    )
}

fn report_with(
    defaults: &claude::config::ClaudeDefaults,
    inherited_path: Option<&OsString>,
) -> StatusReport {
    StatusReport {
        providers: vec![
            ProviderStatus {
                id: codex::PROVIDER_ID.to_owned(),
                state: ProviderState::BuiltIn {
                    note: "always enabled; configured by the serve flags (a host without Codex is not supported)",
                },
            },
            ProviderStatus {
                id: claude::PROVIDER_ID.to_owned(),
                state: claude_state(defaults, inherited_path),
            },
        ],
    }
}

fn claude_state(
    defaults: &claude::config::ClaudeDefaults,
    inherited_path: Option<&OsString>,
) -> ProviderState {
    match claude::ClaudeConfig::automatic(defaults) {
        Ok(config) => config_state(&config, inherited_path),
        Err(err) => ProviderState::Off {
            reason: err.to_string(),
        },
    }
}

fn config_state(config: &claude::ClaudeConfig, inherited_path: Option<&OsString>) -> ProviderState {
    let inherited = inherited_path.map(OsString::as_os_str);
    let host = ClaudeHostReport {
        search_path: config.search_path(inherited),
        search_path_source: if config.search_path.is_some() {
            "loginShell"
        } else {
            "inherited"
        },
        config_directory: config.config_directory(),
        projects_root: config.projects_root(),
    };
    let problems = claude::preflight::preflight(config, inherited)
        .iter()
        .map(ToString::to_string)
        .collect::<Vec<_>>();
    if problems.is_empty() {
        ProviderState::Ready { host }
    } else {
        ProviderState::NotReady { problems, host }
    }
}

#[cfg(test)]
mod tests {
    use std::os::unix::fs::PermissionsExt;

    use super::*;

    fn executable(path: &Path, content: &str) -> Result<(), Box<dyn std::error::Error>> {
        std::fs::create_dir_all(path.parent().ok_or("no parent")?)?;
        std::fs::write(path, content)?;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o755))?;
        Ok(())
    }

    fn machine(
        root: &Path,
        claude: Option<PathBuf>,
        login_path: Option<Vec<PathBuf>>,
    ) -> claude::config::ClaudeDefaults {
        claude::config::ClaudeDefaults {
            claude_executable: claude,
            journal_directory: root.join("claude-journal"),
            login_path,
        }
    }

    #[test]
    fn reports_codex_and_the_found_claude() -> Result<(), Box<dyn std::error::Error>> {
        let root = tempfile::tempdir()?;
        // A machine without `claude` runs no Claude and is still ready.
        let missing = report_with(&machine(root.path(), None, None), None);
        assert!(missing.ready());
        assert!(matches!(
            missing.providers[1].state,
            ProviderState::Off { .. }
        ));

        let node = root.path().join("npm/bin/node");
        let claude = root.path().join("npm/bin/claude");
        executable(&node, "")?;
        executable(&claude, "#!/usr/bin/env node\n")?;
        let ready = report_with(
            &machine(
                root.path(),
                Some(claude),
                Some(vec!["/usr/bin".into(), "/bin".into()]),
            ),
            None,
        );
        let value = serde_json::to_value(&ready)?;
        assert_eq!(value["providers"][0]["id"], "codex");
        assert_eq!(value["providers"][1]["id"], "claude");
        assert_eq!(value["providers"][1]["status"], "ready");
        assert_eq!(
            value["providers"][1]["host"]["searchPathSource"],
            "loginShell"
        );
        assert!(ready.ready());
        Ok(())
    }

    #[test]
    fn flags_an_interpreter_missing_from_the_host_path() -> Result<(), Box<dyn std::error::Error>> {
        let root = tempfile::tempdir()?;
        let claude = root.path().join("npm/bin/claude");
        executable(&claude, "#!/usr/bin/env node\n")?;
        let status = report_with(
            &machine(root.path(), Some(claude), None),
            Some(&OsString::from("/nonexistent")),
        );
        let value = serde_json::to_value(&status)?;
        assert_eq!(value["providers"][1]["status"], "notReady");
        assert_eq!(
            value["providers"][1]["host"]["searchPathSource"],
            "inherited"
        );
        assert!(!status.ready());
        Ok(())
    }
}
