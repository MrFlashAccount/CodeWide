//! Wiring of the provider adapter crates and the factory that turns
//! configuration into a registry. Provider ids are named only here and
//! inside each adapter crate.

pub use agent_provider_claude as claude;
pub use agent_provider_codex as codex;

#[cfg(test)]
mod codex_golden_tests;
pub mod codex_hub;
#[cfg(test)]
mod codex_tools_tests;

use std::{
    path::{Path, PathBuf},
    sync::Arc,
};

use companion_host::{files::PreviewFiles, vcs::WorkspaceVcs};

use tracing::{error, info};

use crate::store::IndexStore;

use super::{
    model::ProviderId,
    provider::AgentProvider,
    registry::{AgentProvidersConfig, CONFIG_FILE_NAME, ProviderRegistry},
};

/// Companion storage the adapters keep their own indexes in.
pub struct ProviderHost {
    /// The companion index (`state.redb`).
    pub index: Arc<IndexStore>,
    pub state_directory: PathBuf,
    /// Preview authorization for thread resources.
    pub files: Arc<dyn PreviewFiles>,
    /// The workspace VCS overlay of thread resources.
    pub vcs: Option<Arc<dyn WorkspaceVcs>>,
    /// The Claude agent host executable shipped with this companion; with
    /// it Claude runs without a `providers.claude` entry.
    pub claude_host: Option<PathBuf>,
}

impl ProviderHost {
    /// Claude's storage host; the watched session store follows the
    /// configured `CLAUDE_CONFIG_DIR`, as the host child's `claude` does.
    fn claude_storage(&self, config: &claude::ClaudeConfig) -> claude::ClaudeStorageHost {
        claude::ClaudeStorageHost {
            database: self.index.database(),
            threads: self.index.clone(),
            search_path: self.state_directory.join("claude-message-search.sqlite"),
            projects_root: config.projects_root(),
            files: self.files.clone(),
            vcs: self.vcs.clone(),
        }
    }
}

/// Builds the registry from `<state_directory>/agent-providers.json`. A
/// missing file means Codex only; an unreadable or invalid file is logged
/// once at `error` and also means Codex only, so a bad configuration can
/// never take the primary provider down.
pub async fn load_registry(
    state_directory: &Path,
    codex: Arc<codex::CodexProvider>,
    host: Option<&ProviderHost>,
) -> Arc<ProviderRegistry> {
    let path = state_directory.join(CONFIG_FILE_NAME);
    let config = match AgentProvidersConfig::load(&path) {
        Ok(config) => config,
        Err(err) => {
            error!(err = %err, "agent provider configuration is invalid; Codex only");
            None
        }
    };
    let agent_sdk = install_agent_sdk(config.as_ref(), host).await;
    let registry = build_registry(config, codex, host, agent_sdk.as_deref());
    let enabled = registry
        .enabled()
        .map(|provider| provider.descriptor().id.to_string())
        .collect::<Vec<_>>();
    info!(providers = ?enabled, "agent providers enabled");
    registry
}

/// What the machine offers Claude for `entry`: the companion's shipped host,
/// the user's `claude` and login-shell `PATH`, and the journal under the
/// companion's state directory.
fn claude_defaults(
    entry: &serde_json::Value,
    host: Option<&ProviderHost>,
    agent_sdk: Option<PathBuf>,
) -> claude::config::ClaudeDefaults {
    claude::config::ClaudeDefaults::discover(
        entry,
        host.and_then(|host| host.claude_host.clone()),
        agent_sdk,
        host.map_or_else(PathBuf::new, |host| {
            host.state_directory.join("claude-journal")
        }),
    )
}

/// Whether Claude will run a self-contained host, which loads the Agent SDK
/// the companion installs: the shipped one without an entry, or an entry
/// that names no script host and no SDK of its own.
fn needs_agent_sdk(entry: Option<&serde_json::Value>, host: &ProviderHost) -> bool {
    match entry {
        None => host.claude_host.is_some(),
        Some(serde_json::Value::Bool(false)) => false,
        Some(entry) => {
            entry.get("runtimeExecutable").is_none()
                && entry.get("agentSdk").is_none()
                && (host.claude_host.is_some() || entry.get("hostExecutable").is_some())
        }
    }
}

const AGENT_SDK_DOWNLOAD_TIMEOUT: std::time::Duration = std::time::Duration::from_mins(2);

/// Installs the pinned Agent SDK under the state directory when Claude needs
/// it (a download on the first start only), after removing the former
/// installer's host directories the entry no longer uses. A failure is
/// logged once and leaves Claude off until the next start.
async fn install_agent_sdk(
    config: Option<&AgentProvidersConfig>,
    host: Option<&ProviderHost>,
) -> Option<PathBuf> {
    let host = host?;
    let entry = config.and_then(|config| {
        config
            .entries
            .iter()
            .find(|(id, _)| id.as_str() == claude::PROVIDER_ID)
            .map(|(_, entry)| entry)
    });
    if let Some(home) = std::env::var_os("HOME").map(PathBuf::from) {
        let removed = claude::legacy_install::remove_unreferenced(
            &claude::legacy_install::legacy_install_directories(&home),
            entry,
        );
        if removed > 0 {
            info!(
                removed,
                "removed the former Claude installer's host directories"
            );
        }
    }
    if !needs_agent_sdk(entry, host) {
        return None;
    }
    let client = match reqwest::Client::builder()
        .timeout(AGENT_SDK_DOWNLOAD_TIMEOUT)
        .build()
    {
        Ok(client) => client,
        Err(err) => {
            error!(err = %err, "the Claude Agent SDK cannot be downloaded: no HTTP client");
            return None;
        }
    };
    let root = host.state_directory.join("claude-agent-sdk");
    let pin = &claude::agent_sdk::AGENT_SDK;
    match claude::agent_sdk::ensure_agent_sdk(&root, pin, &client).await {
        Ok(entry) => Some(entry),
        Err(err) => {
            error!(
                err = ?err,
                version = pin.version,
                "the Claude Agent SDK could not be installed; Claude is off until the next start"
            );
            None
        }
    }
}

fn spawn_claude(
    config: &claude::ClaudeConfig,
    host: Option<&ProviderHost>,
) -> Arc<dyn AgentProvider> {
    match host {
        Some(host) => {
            claude::ClaudeProvider::spawn_with_storage(config, host.claude_storage(config))
        }
        None => claude::ClaudeProvider::spawn(config),
    }
}

/// Claude without a `providers.claude` entry: only a companion that ships
/// the host runs it, and only when the user's `claude` is found.
fn automatic_claude(
    host: Option<&ProviderHost>,
    agent_sdk: Option<PathBuf>,
) -> Option<Arc<dyn AgentProvider>> {
    host?.claude_host.as_ref()?;
    let empty = serde_json::Value::Object(serde_json::Map::new());
    match claude::ClaudeConfig::automatic(&claude_defaults(&empty, host, agent_sdk)) {
        Ok(config) => Some(spawn_claude(&config, host)),
        Err(err) => {
            info!(err = %err, "Claude is not enabled");
            None
        }
    }
}

/// Builds the registry: the Codex adapter (from the existing host flags) is
/// always enabled; other providers come from `agent-providers.json`. An
/// invalid or unknown entry disables only that provider, with one `error`
/// log carrying the full error. A missing file means Codex only.
#[must_use]
pub fn build_registry(
    config: Option<AgentProvidersConfig>,
    codex: Arc<codex::CodexProvider>,
    host: Option<&ProviderHost>,
    agent_sdk: Option<&Path>,
) -> Arc<ProviderRegistry> {
    let codex_id = ProviderId::from_static(codex::PROVIDER_ID);
    let config = config.unwrap_or_else(|| AgentProvidersConfig::primary_only(codex_id.clone()));
    let mut providers: Vec<Arc<dyn AgentProvider>> = vec![codex.clone()];
    let mut disabled = Vec::new();
    let claude_configured = config
        .entries
        .iter()
        .any(|(id, _)| id.as_str() == claude::PROVIDER_ID);
    if !claude_configured
        && let Some(provider) = automatic_claude(host, agent_sdk.map(Path::to_path_buf))
    {
        providers.push(provider);
    }
    for (id, entry) in &config.entries {
        match id.as_str() {
            codex::PROVIDER_ID => {}
            // `false` turns off a Claude the companion would otherwise run.
            claude::PROVIDER_ID if entry == &serde_json::Value::Bool(false) => {
                info!(provider = %id, "agent provider is disabled by configuration");
                disabled.push(id.clone());
            }
            claude::PROVIDER_ID => {
                match claude::ClaudeConfig::parse(
                    entry,
                    &claude_defaults(entry, host, agent_sdk.map(Path::to_path_buf)),
                ) {
                    Ok(claude_config) => providers.push(spawn_claude(&claude_config, host)),
                    Err(err) => {
                        error!(provider = %id, err = %err, "agent provider is disabled: invalid configuration");
                        disabled.push(id.clone());
                    }
                }
            }
            _ => {
                error!(provider = %id, "agent provider is disabled: unknown provider id");
                disabled.push(id.clone());
            }
        }
    }
    let primary = match providers
        .iter()
        .find(|provider| provider.descriptor().id == config.primary)
    {
        // The primary leads the merged `thread/list`, `model/list` and
        // `permissionProfile/list`, which pass through its native surface.
        Some(provider) if provider.native_surface().is_some() => config.primary.clone(),
        Some(_) => {
            error!(
                primary = %config.primary,
                "configured primary provider cannot serve the merged client surface (codex.native); Codex leads"
            );
            codex_id.clone()
        }
        None => {
            error!(primary = %config.primary, "configured primary provider is not enabled; Codex leads");
            codex_id.clone()
        }
    };
    match ProviderRegistry::new(providers, &primary, disabled.clone()) {
        Ok(registry) => Arc::new(registry),
        Err(err) => {
            error!(err = %err, "agent provider registry is invalid; Codex only");
            Arc::new(codex_only(codex, disabled))
        }
    }
}

/// The registry of a host without other providers.
#[must_use]
pub fn codex_only(codex: Arc<codex::CodexProvider>, disabled: Vec<ProviderId>) -> ProviderRegistry {
    ProviderRegistry::single(codex, disabled)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::upstream::UpstreamHandle;

    fn claude_entry(directory: &Path) -> Result<serde_json::Value, std::io::Error> {
        let script = directory.join("host.sh");
        std::fs::write(&script, "sleep 5\n")?;
        let claude = directory.join("claude");
        std::fs::write(&claude, "")?;
        Ok(serde_json::json!({
            "runtimeExecutable": "/bin/sh",
            "sidecarEntry": script,
            "claudeExecutable": claude,
            "journalDirectory": directory.join("journal"),
        }))
    }

    #[tokio::test]
    async fn a_primary_without_the_merged_surface_falls_back_to_codex()
    -> Result<(), Box<dyn std::error::Error>> {
        let directory = tempfile::tempdir()?;
        let codex = Arc::new(codex::CodexProvider::new(UpstreamHandle::spawn(
            directory.path().join("missing.sock"),
        )));
        let config = AgentProvidersConfig::parse(
            serde_json::to_vec(&serde_json::json!({
                "version": 1,
                "primary": "claude",
                "providers": {"claude": claude_entry(directory.path())?},
            }))?
            .as_slice(),
        )?;
        let registry = build_registry(Some(config), codex, None, None);
        assert_eq!(registry.primary_id().as_str(), codex::PROVIDER_ID);
        assert!(registry.is_multi_provider());
        assert!(
            registry
                .get(&ProviderId::from_static(claude::PROVIDER_ID))
                .is_some()
        );
        Ok(())
    }
}
