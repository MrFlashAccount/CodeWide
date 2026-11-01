//! The provider list: compiled-in built-ins (always present) plus external
//! entries from `forge-plugins.json`, with the durable enable flags.
//!
//! Disabling a provider is the smallest rollback: its methods answer a local
//! `-32080`, while its account links (and the plugin's own secrets) stay so
//! re-enabling restores it.

use std::{
    collections::HashSet,
    path::PathBuf,
    sync::{Arc, Mutex},
};

use serde::{Deserialize, Serialize};

use super::{
    bundled::{BUILT_INS, BundledPlugins, built_in},
    errors::ForgeError,
    plugin_client::PluginSpec,
    registry::PluginRegistry,
};
use crate::store::{IndexStore, forge_tables::FORGE_PROVIDER_SETTINGS, kv::KvOp};

const SETTINGS_VERSION: u32 = 1;

/// One provider as the companion knows it without spawning it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ProviderEntry {
    pub plugin_id: String,
    pub built_in: bool,
    pub enabled: bool,
    pub priority: i32,
    /// `None` when the plugin binary is missing.
    pub spec: Option<PluginSpec>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProviderSettings {
    version: u32,
    enabled: bool,
}

#[derive(Clone)]
pub struct ProviderCatalog {
    bundled: BundledPlugins,
    registry: PluginRegistry,
    store: Arc<IndexStore>,
    /// `<companion state>/forge-plugins`; each plugin gets a subdirectory.
    plugin_state_root: PathBuf,
    /// Providers whose missing executable was already logged; an id leaves
    /// the set once its executable exists again.
    reported_missing: Arc<Mutex<HashSet<String>>>,
}

impl ProviderCatalog {
    #[must_use]
    pub fn new(
        bundled: BundledPlugins,
        registry: PluginRegistry,
        store: Arc<IndexStore>,
        plugin_state_root: PathBuf,
    ) -> Self {
        Self {
            bundled,
            registry,
            store,
            plugin_state_root,
            reported_missing: Arc::default(),
        }
    }

    #[must_use]
    pub fn registry(&self) -> &PluginRegistry {
        &self.registry
    }

    /// Every provider in priority order; an unreadable registry hides only
    /// the external entries.
    ///
    /// # Errors
    ///
    /// Returns a storage failure of the enable flags.
    pub fn entries(&self) -> Result<Vec<ProviderEntry>, ForgeError> {
        let mut entries = Vec::new();
        for built_in in &BUILT_INS {
            entries.push(ProviderEntry {
                plugin_id: built_in.plugin_id.to_owned(),
                built_in: true,
                enabled: self.enabled(built_in.plugin_id)?,
                priority: built_in.priority,
                spec: self.bundled.resolve(built_in).map(|executable| PluginSpec {
                    plugin_id: built_in.plugin_id.to_owned(),
                    executable,
                    args: Vec::new(),
                    state_directory: self.plugin_state_root.join(built_in.plugin_id),
                }),
            });
        }
        let external = self.registry.list().unwrap_or_else(|error| {
            tracing::warn!(err = %error, "forge plugin registry is unreadable; external providers are hidden");
            Vec::new()
        });
        for plugin in external {
            entries.push(ProviderEntry {
                enabled: self.enabled(&plugin.id)?,
                priority: plugin.priority,
                spec: plugin.executable.is_file().then(|| PluginSpec {
                    plugin_id: plugin.id.clone(),
                    executable: plugin.executable.clone(),
                    args: plugin.args.clone(),
                    state_directory: self.plugin_state_root.join(&plugin.id),
                }),
                built_in: false,
                plugin_id: plugin.id,
            });
        }
        for entry in &entries {
            self.report_missing(&entry.plugin_id, entry.spec.is_none());
        }
        entries.sort_by(|left, right| {
            right
                .priority
                .cmp(&left.priority)
                .then_with(|| left.plugin_id.cmp(&right.plugin_id))
        });
        Ok(entries)
    }

    /// One provider.
    ///
    /// # Errors
    ///
    /// Returns `-32080` for an unknown provider.
    pub fn entry(&self, plugin_id: &str) -> Result<ProviderEntry, ForgeError> {
        self.entries()?
            .into_iter()
            .find(|entry| entry.plugin_id == plugin_id)
            .ok_or_else(|| ForgeError::unavailable(plugin_id, "Unknown forge provider"))
    }

    /// An enabled provider with an installed binary, ready to spawn.
    ///
    /// # Errors
    ///
    /// Returns `-32080` when the provider is unknown, disabled or missing.
    pub fn spec(&self, plugin_id: &str) -> Result<PluginSpec, ForgeError> {
        let entry = self.entry(plugin_id)?;
        if !entry.enabled {
            return Err(ForgeError::unavailable(
                plugin_id,
                "The forge provider is disabled",
            ));
        }
        entry.spec.ok_or_else(|| {
            ForgeError::unavailable(plugin_id, "The provider's plugin is not installed")
        })
    }

    /// Persists the enable flag of a known provider.
    ///
    /// # Errors
    ///
    /// Returns `-32080` for an unknown provider or a storage failure.
    pub fn set_enabled(&self, plugin_id: &str, enabled: bool) -> Result<ProviderEntry, ForgeError> {
        self.entry(plugin_id)?;
        let value = serde_json::to_vec(&ProviderSettings {
            version: SETTINGS_VERSION,
            enabled,
        })
        .map_err(|error| ForgeError::internal(error.to_string()))?;
        self.store.kv_apply(vec![KvOp::Put {
            table: FORGE_PROVIDER_SETTINGS,
            key: plugin_id.to_owned(),
            value,
        }])?;
        self.entry(plugin_id)
    }

    /// Logs a missing executable once per provider, with its id only.
    fn report_missing(&self, plugin_id: &str, missing: bool) {
        let Ok(mut reported) = self.reported_missing.lock() else {
            return;
        };
        if !missing {
            reported.remove(plugin_id);
        } else if reported.insert(plugin_id.to_owned()) {
            tracing::warn!(plugin_id = %plugin_id, "forge provider executable is missing");
        }
    }

    fn enabled(&self, plugin_id: &str) -> Result<bool, ForgeError> {
        Ok(self
            .store
            .kv_get(FORGE_PROVIDER_SETTINGS, plugin_id)?
            .and_then(|bytes| serde_json::from_slice::<ProviderSettings>(&bytes).ok())
            .is_none_or(|settings| settings.enabled))
    }

    /// Whether a plugin id names a known provider (built-in or installed).
    #[must_use]
    pub fn is_built_in(plugin_id: &str) -> bool {
        built_in(plugin_id).is_some()
    }
}
