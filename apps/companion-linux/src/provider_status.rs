//! `codewide-companion providers status`: an offline report of
//! `<state dir>/agent-providers.json` — which providers the companion would
//! enable and whether each configured child provider could start. It reads
//! the configuration and file metadata only; it starts no provider, makes no
//! network or model call, and never talks to the running daemon.

use std::{
    ffi::OsString,
    path::{Path, PathBuf},
};

use codewide_companion::agent::{
    providers::{claude, codex},
    registry::{AgentProvidersConfig, CONFIG_FILE_NAME},
};
use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatusReport {
    config_path: PathBuf,
    config: ConfigState,
    providers: Vec<ProviderStatus>,
}

impl StatusReport {
    /// Whether every configured provider would start.
    #[must_use]
    pub fn ready(&self) -> bool {
        !matches!(self.config, ConfigState::Invalid { .. })
            && self.providers.iter().all(|provider| {
                matches!(
                    provider.state,
                    ProviderState::BuiltIn { .. } | ProviderState::Ready { .. }
                )
            })
    }
}

#[derive(Debug, Serialize)]
#[serde(tag = "state", rename_all = "camelCase")]
enum ConfigState {
    /// No file: Codex only.
    Missing,
    /// The file is unreadable or invalid: the companion runs Codex only.
    Invalid {
        error: String,
    },
    Valid {
        primary: String,
    },
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
    /// The entry does not parse; the companion disables this provider.
    Invalid {
        error: String,
    },
    /// No adapter has this id; the companion disables it.
    Unknown,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ClaudeHostReport {
    /// The `PATH` the host child gets.
    search_path: Vec<PathBuf>,
    /// `configured` (captured by the installer) or `inherited` (the
    /// companion's own `PATH`, here: this command's `PATH`, which may differ
    /// from the service manager's).
    search_path_source: &'static str,
    claude_config_dir: Option<PathBuf>,
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
/// `PATH` when an entry configures none.
#[must_use]
pub fn report(state_directory: &Path, inherited_path: Option<&OsString>) -> StatusReport {
    let config_path = state_directory.join(CONFIG_FILE_NAME);
    let mut providers = vec![ProviderStatus {
        id: codex::PROVIDER_ID.to_owned(),
        state: ProviderState::BuiltIn {
            note: "always enabled; configured by the serve flags (a host without Codex is not supported)",
        },
    }];
    let config = match AgentProvidersConfig::load(&config_path) {
        Ok(None) => ConfigState::Missing,
        Err(err) => ConfigState::Invalid {
            error: err.to_string(),
        },
        Ok(Some(config)) => {
            for (id, entry) in &config.entries {
                let state = match id.as_str() {
                    codex::PROVIDER_ID => continue,
                    claude::PROVIDER_ID => claude_state(entry, inherited_path),
                    _ => ProviderState::Unknown,
                };
                providers.push(ProviderStatus {
                    id: id.to_string(),
                    state,
                });
            }
            ConfigState::Valid {
                primary: config.primary.to_string(),
            }
        }
    };
    StatusReport {
        config_path,
        config,
        providers,
    }
}

fn claude_state(entry: &serde_json::Value, inherited_path: Option<&OsString>) -> ProviderState {
    let config = match claude::ClaudeConfig::parse(entry) {
        Ok(config) => config,
        Err(err) => {
            return ProviderState::Invalid {
                error: err.to_string(),
            };
        }
    };
    let inherited = inherited_path.map(OsString::as_os_str);
    let host = ClaudeHostReport {
        search_path: config.host_search_path(inherited),
        search_path_source: if config.environment.search_path.is_some() {
            "configured"
        } else {
            "inherited"
        },
        claude_config_dir: config.environment.claude_config_dir.clone(),
        projects_root: config.projects_root(),
    };
    let problems = claude::preflight::preflight(&config, inherited)
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

    use serde_json::json;

    use super::*;

    fn executable(path: &Path, content: &str) -> Result<(), Box<dyn std::error::Error>> {
        std::fs::create_dir_all(path.parent().ok_or("no parent")?)?;
        std::fs::write(path, content)?;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o755))?;
        Ok(())
    }

    #[test]
    fn reports_missing_valid_and_invalid_configurations() -> Result<(), Box<dyn std::error::Error>>
    {
        let root = tempfile::tempdir()?;
        let missing = report(root.path(), None);
        assert!(matches!(missing.config, ConfigState::Missing));
        assert!(missing.ready());
        assert_eq!(missing.providers.len(), 1);

        let node = root.path().join("node/bin/node");
        let claude = root.path().join("npm/bin/claude");
        let entry = root.path().join("host/dist/main.js");
        executable(&node, "")?;
        executable(&claude, "#!/usr/bin/env node\n")?;
        executable(&entry, "")?;
        let write = |environment: serde_json::Value| {
            std::fs::write(
                root.path().join(CONFIG_FILE_NAME),
                serde_json::to_vec(&json!({
                    "version": 1, "primary": "codex",
                    "providers": {
                        "claude": {
                            "runtimeExecutable": node, "sidecarEntry": entry,
                            "claudeExecutable": claude,
                            "journalDirectory": root.path().join("journal"),
                            "environment": environment,
                        },
                        "other": {},
                    },
                }))?,
            )
        };

        write(json!({"PATH": "/usr/bin:/bin"}))?;
        let ready = report(root.path(), None);
        let value = serde_json::to_value(&ready)?;
        assert_eq!(
            value["config"],
            json!({"state": "valid", "primary": "codex"})
        );
        assert_eq!(value["providers"][1]["id"], "claude");
        assert_eq!(value["providers"][1]["status"], "ready");
        assert_eq!(
            value["providers"][1]["host"]["searchPathSource"],
            "configured"
        );
        assert_eq!(
            value["providers"][2],
            json!({"id": "other", "status": "unknown"})
        );
        assert!(!ready.ready());

        std::fs::remove_file(&node)?;
        let invalid = serde_json::to_value(report(root.path(), None))?;
        assert_eq!(invalid["providers"][1]["status"], "invalid");

        std::fs::write(root.path().join(CONFIG_FILE_NAME), "{")?;
        let broken = report(root.path(), None);
        assert!(matches!(broken.config, ConfigState::Invalid { .. }));
        assert!(!broken.ready());
        Ok(())
    }

    #[test]
    fn flags_an_interpreter_missing_from_the_host_path() -> Result<(), Box<dyn std::error::Error>> {
        let root = tempfile::tempdir()?;
        let bun = root.path().join("bun/bin/bun");
        let claude = root.path().join("npm/bin/claude");
        let entry = root.path().join("host/dist/main.js");
        executable(&bun, "")?;
        executable(&claude, "#!/usr/bin/env node\n")?;
        executable(&entry, "")?;
        std::fs::write(
            root.path().join(CONFIG_FILE_NAME),
            serde_json::to_vec(&json!({
                "version": 1, "primary": "codex",
                "providers": {"claude": {
                    "runtimeExecutable": bun, "sidecarEntry": entry, "claudeExecutable": claude,
                    "journalDirectory": root.path().join("journal"),
                }},
            }))?,
        )?;
        let status = report(root.path(), Some(&OsString::from("/nonexistent")));
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
