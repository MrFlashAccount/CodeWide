//! Provider adapters and the factory that turns configuration into a
//! registry. Provider ids are named only here and inside each adapter.

pub mod claude;
pub mod codex;

use std::{path::Path, sync::Arc};

use tracing::{error, info};

use super::{
    model::ProviderId,
    provider::AgentProvider,
    registry::{AgentProvidersConfig, CONFIG_FILE_NAME, ProviderRegistry},
};

/// Builds the registry from `<state_directory>/agent-providers.json`. A
/// missing file means Codex only; an unreadable or invalid file is logged
/// once at `error` and also means Codex only, so a bad configuration can
/// never take the primary provider down.
#[must_use]
pub fn load_registry(
    state_directory: &Path,
    codex: Arc<codex::CodexProvider>,
) -> Arc<ProviderRegistry> {
    let path = state_directory.join(CONFIG_FILE_NAME);
    let config = match AgentProvidersConfig::load(&path) {
        Ok(config) => config,
        Err(err) => {
            error!(err = %err, "agent provider configuration is invalid; Codex only");
            None
        }
    };
    let registry = build_registry(config, codex);
    let enabled = registry
        .enabled()
        .map(|provider| provider.descriptor().id.to_string())
        .collect::<Vec<_>>();
    info!(providers = ?enabled, "agent providers enabled");
    registry
}

/// Builds the registry: the Codex adapter (from the existing host flags) is
/// always enabled; other providers come from `agent-providers.json`. An
/// invalid or unknown entry disables only that provider, with one `error`
/// log carrying the full error. A missing file means Codex only.
#[must_use]
pub fn build_registry(
    config: Option<AgentProvidersConfig>,
    codex: Arc<codex::CodexProvider>,
) -> Arc<ProviderRegistry> {
    let codex_id = ProviderId::from_static(codex::PROVIDER_ID);
    let config = config.unwrap_or_else(|| AgentProvidersConfig::primary_only(codex_id.clone()));
    let mut providers: Vec<Arc<dyn AgentProvider>> = vec![codex.clone()];
    let mut disabled = Vec::new();
    for (id, entry) in &config.entries {
        match id.as_str() {
            codex::PROVIDER_ID => {}
            claude::PROVIDER_ID => match claude::ClaudeConfig::parse(entry) {
                Ok(claude_config) => providers.push(claude::ClaudeProvider::spawn(&claude_config)),
                Err(err) => {
                    error!(provider = %id, err = %err, "agent provider is disabled: invalid configuration");
                    disabled.push(id.clone());
                }
            },
            _ => {
                error!(provider = %id, "agent provider is disabled: unknown provider id");
                disabled.push(id.clone());
            }
        }
    }
    let primary = if providers
        .iter()
        .any(|provider| provider.descriptor().id == config.primary)
    {
        config.primary.clone()
    } else {
        error!(primary = %config.primary, "configured primary provider is not enabled; Codex leads");
        codex_id.clone()
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
