//! Wiring of the provider adapter crates and the factory that builds the
//! registry from what the machine offers. Provider ids are named only here and
//! inside each adapter crate.

pub use agent_provider_claude as claude;
pub use agent_provider_codex as codex;

#[cfg(test)]
mod codex_golden_tests;
pub mod codex_hub;
#[cfg(test)]
mod codex_session_instructions_tests;
#[cfg(test)]
mod codex_subscription_tests;
#[cfg(test)]
mod codex_tools_tests;

use std::{path::PathBuf, sync::Arc};

use companion_host::{files::PreviewFiles, vcs::WorkspaceVcs};

use tracing::{error, info};

use crate::store::IndexStore;

use super::{
    client_conventions::CLIENT_CONVENTIONS, provider::AgentProvider, registry::ProviderRegistry,
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

/// Builds the registry of this machine: Codex (from the existing host
/// flags) always, and Claude when the user's `claude` is found. No
/// configuration file is read; a former `agent-providers.json` in the state
/// directory is left untouched and ignored.
pub fn load_registry(
    codex: Arc<codex::CodexProvider>,
    host: Option<&ProviderHost>,
) -> Arc<ProviderRegistry> {
    if let Some(host) = host {
        remove_former_claude_host(host);
    }
    let registry = build_registry(codex, automatic_claude(host).into_iter().collect());
    let enabled = registry
        .enabled()
        .map(|provider| provider.descriptor().id.to_string())
        .collect::<Vec<_>>();
    info!(providers = ?enabled, "agent providers enabled");
    registry
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

/// Claude runs when the user's `claude` is found on the machine; its thread
/// state lives under the companion's state directory.
fn automatic_claude(host: Option<&ProviderHost>) -> Option<Arc<dyn AgentProvider>> {
    let defaults =
        claude::config::ClaudeDefaults::discover(host.map_or_else(PathBuf::new, |host| {
            host.state_directory.join("claude-journal")
        }));
    match claude::ClaudeConfig::automatic(&defaults) {
        Ok(config) => Some(spawn_claude(&config, host)),
        Err(err) => {
            info!(err = %err, "Claude is not enabled");
            None
        }
    }
}

/// Builds the registry of Codex and `others`, in provider-id order. Every
/// enabled provider gets the `CodeWide` client conventions
/// (`client_conventions`) for its sessions. An invalid set (a repeated id)
/// is logged at `error` and means Codex only.
#[must_use]
pub fn build_registry(
    codex: Arc<codex::CodexProvider>,
    others: Vec<Arc<dyn AgentProvider>>,
) -> Arc<ProviderRegistry> {
    let mut providers: Vec<Arc<dyn AgentProvider>> = vec![codex.clone()];
    providers.extend(others);
    // Every enabled provider hands the product conventions to its sessions.
    for provider in &providers {
        provider.install_session_instructions(CLIENT_CONVENTIONS);
    }
    match ProviderRegistry::new(providers) {
        Ok(registry) => Arc::new(registry),
        Err(err) => {
            error!(err = %err, "agent provider registry is invalid; Codex only");
            Arc::new(codex_only(codex))
        }
    }
}

/// The registry of a host without other providers.
#[must_use]
pub fn codex_only(codex: Arc<codex::CodexProvider>) -> ProviderRegistry {
    ProviderRegistry::single(codex)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::upstream::UpstreamHandle;

    #[tokio::test]
    async fn providers_are_ordered_by_id_and_codex_leads() -> Result<(), Box<dyn std::error::Error>>
    {
        let directory = tempfile::tempdir()?;
        let codex = Arc::new(codex::CodexProvider::new(UpstreamHandle::spawn(
            directory.path().join("missing.sock"),
        )));
        let claude_executable = directory.path().join("claude");
        std::fs::write(&claude_executable, "")?;
        let config = claude::ClaudeConfig::with_executable(
            claude_executable,
            &claude::config::ClaudeDefaults {
                journal_directory: directory.path().join("journal"),
                ..claude::config::ClaudeDefaults::default()
            },
        )?;
        let registry = build_registry(codex, vec![claude::ClaudeProvider::spawn(&config)]);
        let ids = registry
            .enabled()
            .map(|provider| provider.descriptor().id.into_string())
            .collect::<Vec<_>>();
        assert_eq!(ids, [claude::PROVIDER_ID, codex::PROVIDER_ID]);
        // The lead is the native-wire provider, not the first id.
        assert_eq!(registry.lead_id().as_str(), codex::PROVIDER_ID);
        assert!(registry.is_multi_provider());
        Ok(())
    }
}
