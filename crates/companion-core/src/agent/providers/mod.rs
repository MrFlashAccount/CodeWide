//! Wiring of the provider adapter crates and the factory that turns
//! configuration into a registry. Provider ids are named only here and
//! inside each adapter crate.

pub use agent_provider_claude as claude;
pub use agent_provider_codex as codex;

#[cfg(test)]
mod codex_golden_tests;
pub mod codex_hub;
#[cfg(test)]
mod codex_subscription_tests;
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
            journal_directory: config.journal_directory.clone(),
            files: self.files.clone(),
            vcs: self.vcs.clone(),
        }
    }
}

/// Builds the registry from `<state_directory>/agent-providers.json`. A
/// missing file means Codex only; an unreadable or invalid file is logged
/// once at `error` and also means Codex only, so a bad configuration can
/// never take the primary provider down.
pub fn load_registry(
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
    if let Some(host) = host {
        remove_former_claude_host(host);
    }
    let registry = build_registry(config, codex, host);
    let enabled = registry
        .enabled()
        .map(|provider| provider.descriptor().id.to_string())
        .collect::<Vec<_>>();
    info!(providers = ?enabled, "agent providers enabled");
    registry
}

/// What the machine offers Claude for `entry`: the user's `claude` and
/// login-shell `PATH`, and the thread state under the companion's state
/// directory.
fn claude_defaults(
    entry: &serde_json::Value,
    host: Option<&ProviderHost>,
) -> claude::config::ClaudeDefaults {
    claude::config::ClaudeDefaults::discover(
        entry,
        host.map_or_else(PathBuf::new, |host| {
            host.state_directory.join("claude-journal")
        }),
    )
}

/// Removes the files of the former Claude agent host (the installer's
/// directories, the unpacked host, the downloaded Agent SDK).
fn remove_former_claude_host(host: &ProviderHost) {
    let home = std::env::var_os("HOME").map(PathBuf::from);
    let removed = claude::legacy_install::remove(&claude::legacy_install::former_host_directories(
        home.as_deref(),
        &host.state_directory,
    ));
    if removed > 0 {
        info!(removed, "removed the former Claude agent host's files");
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

/// Claude without a `providers.claude` entry: it runs when the user's
/// `claude` is found.
fn automatic_claude(host: Option<&ProviderHost>) -> Option<Arc<dyn AgentProvider>> {
    let empty = serde_json::Value::Object(serde_json::Map::new());
    match claude::ClaudeConfig::automatic(&claude_defaults(&empty, host)) {
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
) -> Arc<ProviderRegistry> {
    let codex_id = ProviderId::from_static(codex::PROVIDER_ID);
    let config = config.unwrap_or_else(|| AgentProvidersConfig::primary_only(codex_id.clone()));
    let mut providers: Vec<Arc<dyn AgentProvider>> = vec![codex.clone()];
    let mut disabled = Vec::new();
    let claude_configured = config
        .entries
        .iter()
        .any(|(id, _)| id.as_str() == claude::PROVIDER_ID);
    if !claude_configured && let Some(provider) = automatic_claude(host) {
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
                match claude::ClaudeConfig::parse(entry, &claude_defaults(entry, host)) {
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
        let claude = directory.join("claude");
        std::fs::write(&claude, "")?;
        Ok(serde_json::json!({
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
        let registry = build_registry(Some(config), codex, None);
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
