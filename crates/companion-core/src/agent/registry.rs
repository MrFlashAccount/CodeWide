//! The set of enabled providers, the capability index and host-capability
//! owners.
//!
//! Providers are kept in configured order; the first entry is the primary
//! provider, which leads `thread/list` pagination, owns the default model and
//! suppresses the provider badge. The configuration loader at the bottom only
//! parses `agent-providers.json`; mapping its provider ids to adapters is
//! `build_registry` in `agent/providers/mod.rs`, the only code outside
//! `providers/<id>/` that branches on a provider id. Everywhere else
//! providers are selected by binding or by capability.

use std::{path::Path, sync::Arc};

use serde::Deserialize;
use serde_json::{Map, Value};

use super::{
    model::{Capability, ProviderId},
    provider::AgentProvider,
};

/// Name of the provider configuration file inside the companion state directory.
pub const CONFIG_FILE_NAME: &str = "agent-providers.json";

#[derive(Debug, thiserror::Error)]
pub enum RegistryError {
    #[error("the primary provider {0} is not enabled")]
    PrimaryMissing(String),
    #[error("provider {0} is registered twice")]
    Duplicate(String),
}

/// Enabled providers in configured order, plus known-but-disabled ids.
pub struct ProviderRegistry {
    providers: Vec<Arc<dyn AgentProvider>>,
    ids: Vec<ProviderId>,
    disabled: Vec<ProviderId>,
}

impl ProviderRegistry {
    /// Builds a registry whose first provider is `primary`.
    ///
    /// # Errors
    /// Returns an error when `primary` is not among `providers` or an id repeats.
    pub fn new(
        providers: Vec<Arc<dyn AgentProvider>>,
        primary: &ProviderId,
        disabled: Vec<ProviderId>,
    ) -> Result<Self, RegistryError> {
        let mut ordered = Vec::with_capacity(providers.len());
        let mut rest = Vec::with_capacity(providers.len());
        for provider in providers {
            if &provider.descriptor().id == primary {
                ordered.push(provider);
            } else {
                rest.push(provider);
            }
        }
        if ordered.len() != 1 {
            return Err(RegistryError::PrimaryMissing(primary.to_string()));
        }
        ordered.extend(rest);
        let ids = ordered
            .iter()
            .map(|provider| provider.descriptor().id)
            .collect::<Vec<_>>();
        for (index, id) in ids.iter().enumerate() {
            if ids[..index].contains(id) {
                return Err(RegistryError::Duplicate(id.to_string()));
            }
        }
        let disabled = disabled
            .into_iter()
            .filter(|id| !ids.contains(id))
            .collect();
        Ok(Self {
            providers: ordered,
            ids,
            disabled,
        })
    }

    /// A registry with one provider, which is its primary.
    #[must_use]
    pub fn single(provider: Arc<dyn AgentProvider>, disabled: Vec<ProviderId>) -> Self {
        let id = provider.descriptor().id;
        Self {
            providers: vec![provider],
            disabled: disabled
                .into_iter()
                .filter(|candidate| candidate != &id)
                .collect(),
            ids: vec![id],
        }
    }

    /// The primary provider (first in order).
    #[must_use]
    pub fn primary(&self) -> &Arc<dyn AgentProvider> {
        &self.providers[0]
    }

    #[must_use]
    pub fn primary_id(&self) -> &ProviderId {
        &self.ids[0]
    }

    #[must_use]
    pub fn is_primary(&self, id: &ProviderId) -> bool {
        &self.ids[0] == id
    }

    /// Whether more than one provider is enabled. Client-wire extensions
    /// (`codewideAgent`, `codewideAgentProvider`) are attached only then, so
    /// a single-provider host keeps today's wire byte-for-byte.
    #[must_use]
    pub fn is_multi_provider(&self) -> bool {
        self.providers.len() > 1
    }

    #[must_use]
    pub fn get(&self, id: &ProviderId) -> Option<&Arc<dyn AgentProvider>> {
        self.ids
            .iter()
            .position(|candidate| candidate == id)
            .map(|index| &self.providers[index])
    }

    /// Enabled providers in configured order.
    pub fn enabled(&self) -> impl Iterator<Item = &Arc<dyn AgentProvider>> {
        self.providers.iter()
    }

    /// Whether `id` was configured or bound before but is not enabled now.
    #[must_use]
    pub fn is_known_disabled(&self, id: &ProviderId) -> bool {
        self.disabled.contains(id)
    }

    /// The first provider in order that declares `capability`; host-level
    /// capabilities (`host.fs`, `host.config`, account methods) route here.
    #[must_use]
    pub fn owner(&self, capability: Capability) -> Option<&Arc<dyn AgentProvider>> {
        self.providers
            .iter()
            .find(|provider| provider.capabilities().supports(capability))
    }

    /// Providers that can recognize thread ids created outside `CodeWide`.
    pub fn discovery_providers(&self) -> impl Iterator<Item = &Arc<dyn AgentProvider>> {
        self.providers.iter().filter(|provider| {
            provider
                .capabilities()
                .supports(Capability::ThreadsExternalDiscovery)
        })
    }
}

/// Display name for a provider that is not enabled, used in `-32070`.
#[must_use]
pub fn disabled_provider_name(id: &ProviderId) -> String {
    let mut characters = id.as_str().chars();
    characters.next().map_or_else(String::new, |first| {
        first.to_uppercase().chain(characters).collect()
    })
}

#[derive(Debug, thiserror::Error)]
pub enum ConfigError {
    #[error("cannot read {path}: {source}")]
    Read {
        path: String,
        source: std::io::Error,
    },
    #[error("invalid provider configuration: {0}")]
    Invalid(String),
}

/// Parsed `agent-providers.json`: the primary id and one opaque entry per
/// configured provider, validated by that provider's own adapter.
#[derive(Clone, Debug, PartialEq)]
pub struct AgentProvidersConfig {
    pub primary: ProviderId,
    pub entries: Vec<(ProviderId, Value)>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawConfig {
    version: u32,
    primary: String,
    #[serde(default)]
    providers: Map<String, Value>,
}

impl AgentProvidersConfig {
    /// The configuration used when the file is absent: the primary provider
    /// only, built from the existing host flags.
    #[must_use]
    pub fn primary_only(primary: ProviderId) -> Self {
        Self {
            primary,
            entries: Vec::new(),
        }
    }

    /// Reads the configuration file. A missing file is `Ok(None)`.
    ///
    /// # Errors
    /// Returns an error when the file exists but cannot be read or parsed.
    pub fn load(path: &Path) -> Result<Option<Self>, ConfigError> {
        let bytes = match std::fs::read(path) {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(source) => {
                return Err(ConfigError::Read {
                    path: path.display().to_string(),
                    source,
                });
            }
        };
        Self::parse(&bytes).map(Some)
    }

    /// Parses the configuration document.
    ///
    /// # Errors
    /// Returns an error for an unsupported version, an invalid id or a
    /// non-object provider entry.
    pub fn parse(bytes: &[u8]) -> Result<Self, ConfigError> {
        let raw: RawConfig = serde_json::from_slice(bytes)
            .map_err(|error| ConfigError::Invalid(error.to_string()))?;
        if raw.version != 1 {
            return Err(ConfigError::Invalid(format!(
                "unsupported version {}",
                raw.version
            )));
        }
        let primary = ProviderId::parse(&raw.primary)
            .ok_or_else(|| ConfigError::Invalid("primary must be a provider id".into()))?;
        let mut entries = Vec::with_capacity(raw.providers.len());
        for (id, entry) in raw.providers {
            let id = ProviderId::parse(&id)
                .ok_or_else(|| ConfigError::Invalid("provider ids must be non-empty".into()))?;
            if !entry.is_object() {
                return Err(ConfigError::Invalid(format!(
                    "providers.{id} must be an object"
                )));
            }
            entries.push((id, entry));
        }
        Ok(Self { primary, entries })
    }

    /// The configuration entry of one provider, if present.
    #[must_use]
    pub fn entry(&self, id: &ProviderId) -> Option<&Value> {
        self.entries
            .iter()
            .find(|(candidate, _)| candidate == id)
            .map(|(_, entry)| entry)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_primary_and_opaque_entries() -> Result<(), ConfigError> {
        let config = AgentProvidersConfig::parse(
            br#"{"version":1,"primary":"codex","providers":{"claude":{"idleReleaseMinutes":30}}}"#,
        )?;
        assert_eq!(config.primary.as_str(), "codex");
        assert_eq!(config.entries.len(), 1);
        let claude =
            ProviderId::parse("claude").ok_or_else(|| ConfigError::Invalid("id".into()))?;
        assert_eq!(
            config.entry(&claude),
            Some(&serde_json::json!({"idleReleaseMinutes": 30}))
        );
        Ok(())
    }

    #[test]
    fn rejects_unknown_versions_fields_and_non_object_entries() {
        for document in [
            br#"{"version":2,"primary":"codex"}"#.as_slice(),
            br#"{"version":1,"primary":""}"#,
            br#"{"version":1,"primary":"codex","extra":1}"#,
            br#"{"version":1,"primary":"codex","providers":{"claude":true}}"#,
        ] {
            assert!(AgentProvidersConfig::parse(document).is_err());
        }
    }

    #[test]
    fn missing_file_is_not_an_error() -> Result<(), ConfigError> {
        let directory = tempfile::tempdir().map_err(|source| ConfigError::Read {
            path: "tempdir".into(),
            source,
        })?;
        assert_eq!(
            AgentProvidersConfig::load(&directory.path().join(CONFIG_FILE_NAME))?,
            None
        );
        Ok(())
    }

    #[test]
    fn disabled_provider_names_are_capitalized_ids() {
        let id = ProviderId::parse("claude");
        assert_eq!(
            id.as_ref().map(disabled_provider_name).as_deref(),
            Some("Claude")
        );
    }
}
