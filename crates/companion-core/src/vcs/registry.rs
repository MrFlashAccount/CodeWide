//! `vcs-plugins.json` v1: externally installed VCS plugins plus the durable
//! enable flags of the built-in providers.
//!
//! Built-in providers are never stored as paths. Each one is declared by the
//! companion (`bundled:<id>`) and resolved against the host's bundled plugin
//! directory on every read, so it is always present at the lowest priority.
//! Legacy entries that pinned a host-installed copy of a built-in binary are
//! replaced by that declaration when the file is read; their enable flag is
//! kept, and the next write persists the migrated file.

use std::{
    cmp::Ordering,
    fs::OpenOptions,
    io::Write as _,
    os::unix::fs::OpenOptionsExt as _,
    path::{Path, PathBuf},
};

use serde::{Deserialize, Serialize};

use super::{
    VcsError,
    bundled::{BUILT_IN_PRIORITY, BUILT_INS, BundledPlugins, built_in},
};

const REGISTRY_VERSION: u32 = 1;

/// One external provider as stored in the registry, and the spawn
/// configuration of every provider.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VcsPluginConfig {
    pub id: String,
    pub executable: PathBuf,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default = "default_enabled")]
    pub enabled: bool,
    #[serde(default)]
    pub priority: i32,
}

fn default_enabled() -> bool {
    true
}

/// A built-in provider as resolved against the bundled plugin directory.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BundledProvider {
    pub id: &'static str,
    /// `None` when the host has no bundled directory or the binary is
    /// missing: the provider is unavailable.
    pub executable: Option<PathBuf>,
    pub enabled: bool,
    pub priority: i32,
}

/// One provider in resolution order.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(tag = "source", rename_all = "camelCase")]
pub enum VcsProviderEntry {
    Bundled(BundledProvider),
    External(VcsPluginConfig),
}

impl VcsProviderEntry {
    #[must_use]
    pub fn id(&self) -> &str {
        match self {
            Self::Bundled(provider) => provider.id,
            Self::External(plugin) => &plugin.id,
        }
    }

    /// The spawn configuration of an enabled, available provider.
    fn spawnable(self) -> Option<VcsPluginConfig> {
        match self {
            Self::External(plugin) => plugin.enabled.then_some(plugin),
            Self::Bundled(provider) => {
                if !provider.enabled {
                    return None;
                }
                let Some(executable) = provider.executable else {
                    tracing::debug!(plugin_id = %provider.id, "bundled VCS provider binary is missing");
                    return None;
                };
                Some(VcsPluginConfig {
                    id: provider.id.to_owned(),
                    executable,
                    args: Vec::new(),
                    enabled: true,
                    priority: provider.priority,
                })
            }
        }
    }

    fn priority(&self) -> i32 {
        match self {
            Self::Bundled(provider) => provider.priority,
            Self::External(plugin) => plugin.priority,
        }
    }

    /// External providers sort before built-ins of equal priority.
    fn source_rank(&self) -> u8 {
        match self {
            Self::External(_) => 0,
            Self::Bundled(_) => 1,
        }
    }
}

/// Descending priority; at equal priority external before built-in, then id.
fn resolution_order(left: &VcsProviderEntry, right: &VcsProviderEntry) -> Ordering {
    right
        .priority()
        .cmp(&left.priority())
        .then_with(|| left.source_rank().cmp(&right.source_rank()))
        .then_with(|| left.id().cmp(right.id()))
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct RegistryFile {
    version: u32,
    plugins: Vec<VcsPluginConfig>,
    /// Built-in providers the user disabled; built-ins are enabled otherwise.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    disabled_built_ins: Vec<String>,
}

#[derive(Clone, Debug)]
pub struct PluginRegistry {
    path: PathBuf,
    bundled: BundledPlugins,
}

impl PluginRegistry {
    /// A registry file plus the host's bundled plugin directory, against
    /// which built-in providers are resolved on every read.
    #[must_use]
    pub fn new(path: PathBuf, bundled_plugin_directory: Option<PathBuf>) -> Self {
        Self {
            path,
            bundled: BundledPlugins::new(bundled_plugin_directory),
        }
    }

    #[must_use]
    pub fn path(&self) -> &Path {
        &self.path
    }

    /// Every provider (built-in and external) in resolution order.
    ///
    /// # Errors
    ///
    /// Returns an error when the registry cannot be read or parsed.
    pub fn list(&self) -> Result<Vec<VcsProviderEntry>, VcsError> {
        let registry = self.read()?;
        let mut entries = registry
            .plugins
            .into_iter()
            .map(VcsProviderEntry::External)
            .collect::<Vec<_>>();
        for built_in in &BUILT_INS {
            entries.push(VcsProviderEntry::Bundled(BundledProvider {
                id: built_in.plugin_id,
                executable: self.bundled.resolve(built_in),
                enabled: !registry
                    .disabled_built_ins
                    .iter()
                    .any(|id| id == built_in.plugin_id),
                priority: BUILT_IN_PRIORITY,
            }));
        }
        entries.sort_by(resolution_order);
        Ok(entries)
    }

    /// Enabled providers with an available executable, in resolution order.
    /// Built-in executables are resolved now, for this operation's spawns.
    ///
    /// # Errors
    ///
    /// Returns an error when the registry cannot be read or parsed.
    pub fn enabled_plugins(&self) -> Result<Vec<VcsPluginConfig>, VcsError> {
        Ok(self
            .list()?
            .into_iter()
            .filter_map(VcsProviderEntry::spawnable)
            .collect())
    }

    /// Atomically installs or replaces one external provider. An external
    /// plugin may reuse a built-in id with its own executable (an override
    /// that resolves before the built-in); a host-installed copy of the
    /// built-in binary is refused because the built-in already resolves it.
    ///
    /// # Errors
    ///
    /// Returns an error for an invalid id or executable, or when the registry
    /// cannot be persisted.
    pub fn install(&self, mut plugin: VcsPluginConfig) -> Result<(), VcsError> {
        validate_plugin_id(&plugin.id)?;
        if !plugin.executable.is_absolute() {
            return Err(VcsError::Registry(format!(
                "plugin executable must be absolute: {}",
                plugin.executable.display()
            )));
        }
        plugin.executable = plugin.executable.canonicalize().map_err(|error| {
            VcsError::Registry(format!(
                "could not resolve plugin executable {}: {error}",
                plugin.executable.display()
            ))
        })?;
        if !plugin.executable.is_file() {
            return Err(VcsError::Registry(format!(
                "plugin executable is not a file: {}",
                plugin.executable.display()
            )));
        }
        if let Some(built_in) = built_in(&plugin.id)
            && self.bundled.is_bundled_copy(built_in, &plugin.executable)
        {
            return Err(VcsError::Registry(format!(
                "{} is a built-in provider; its bundled executable is resolved automatically",
                plugin.id
            )));
        }
        let mut registry = self.read()?;
        registry
            .plugins
            .retain(|candidate| candidate.id != plugin.id);
        registry.plugins.push(plugin);
        self.write(&registry)
    }

    /// Atomically removes one external provider; `false` when none was
    /// installed. A built-in provider cannot be removed, only disabled.
    ///
    /// # Errors
    ///
    /// Returns an error for an invalid id or when the registry cannot be read
    /// or persisted.
    pub fn remove(&self, id: &str) -> Result<bool, VcsError> {
        validate_plugin_id(id)?;
        let mut registry = self.read()?;
        let previous = registry.plugins.len();
        registry.plugins.retain(|plugin| plugin.id != id);
        let removed = registry.plugins.len() != previous;
        if removed {
            self.write(&registry)?;
        }
        Ok(removed)
    }

    /// Persists the enable flag of every provider with this id: the built-in
    /// and an external override share the id, so they are one provider for
    /// the user. Returns `false` for an unknown id.
    ///
    /// # Errors
    ///
    /// Returns an error for an invalid id or when the registry cannot be read
    /// or persisted.
    pub fn set_enabled(&self, id: &str, enabled: bool) -> Result<bool, VcsError> {
        validate_plugin_id(id)?;
        let mut registry = self.read()?;
        let mut known = false;
        if built_in(id).is_some() {
            known = true;
            registry
                .disabled_built_ins
                .retain(|disabled| disabled != id);
            if !enabled {
                registry.disabled_built_ins.push(id.to_owned());
            }
        }
        for plugin in &mut registry.plugins {
            if plugin.id == id {
                known = true;
                plugin.enabled = enabled;
            }
        }
        if known {
            self.write(&registry)?;
        }
        Ok(known)
    }

    fn read(&self) -> Result<RegistryFile, VcsError> {
        let bytes = match std::fs::read(&self.path) {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Ok(RegistryFile {
                    version: REGISTRY_VERSION,
                    plugins: Vec::new(),
                    disabled_built_ins: Vec::new(),
                });
            }
            Err(error) => {
                return Err(VcsError::Registry(format!(
                    "could not read {}: {error}",
                    self.path.display()
                )));
            }
        };
        let registry = serde_json::from_slice::<RegistryFile>(&bytes).map_err(|error| {
            VcsError::Registry(format!("could not parse {}: {error}", self.path.display()))
        })?;
        if registry.version != REGISTRY_VERSION {
            return Err(VcsError::Registry(format!(
                "unsupported registry version {} in {}",
                registry.version,
                self.path.display()
            )));
        }
        for plugin in &registry.plugins {
            validate_plugin_id(&plugin.id)?;
        }
        Ok(self.migrate_bundled_copies(registry))
    }

    /// Replaces legacy entries that pinned a host-installed copy of a
    /// built-in binary with the built-in declaration, keeping their enable
    /// flag. Any other entry, including an override that reuses a built-in
    /// id, stays external.
    fn migrate_bundled_copies(&self, mut registry: RegistryFile) -> RegistryFile {
        let mut disabled = Vec::new();
        registry.plugins.retain(|plugin| {
            let Some(built_in) = built_in(&plugin.id) else {
                return true;
            };
            if !self.bundled.is_bundled_copy(built_in, &plugin.executable) {
                return true;
            }
            if !plugin.enabled {
                disabled.push(plugin.id.clone());
            }
            false
        });
        registry.disabled_built_ins.append(&mut disabled);
        registry
            .disabled_built_ins
            .retain(|id| built_in(id).is_some());
        registry.disabled_built_ins.sort();
        registry.disabled_built_ins.dedup();
        registry
    }

    fn write(&self, registry: &RegistryFile) -> Result<(), VcsError> {
        let parent = self.path.parent().ok_or_else(|| {
            VcsError::Registry("plugin registry path has no parent directory".into())
        })?;
        std::fs::create_dir_all(parent).map_err(|error| {
            VcsError::Registry(format!("could not create {}: {error}", parent.display()))
        })?;
        let temporary = parent.join(format!(
            ".{}.{}.tmp",
            self.path
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("vcs-plugins"),
            std::process::id()
        ));
        let encoded = serde_json::to_vec_pretty(registry)
            .map_err(|error| VcsError::Registry(format!("could not encode registry: {error}")))?;
        let mut file = OpenOptions::new()
            .create(true)
            .truncate(true)
            .write(true)
            .mode(0o600)
            .open(&temporary)
            .map_err(|error| {
                VcsError::Registry(format!("could not write {}: {error}", temporary.display()))
            })?;
        file.write_all(&encoded)
            .and_then(|()| file.write_all(b"\n"))
            .and_then(|()| file.sync_all())
            .map_err(|error| {
                VcsError::Registry(format!(
                    "could not persist {}: {error}",
                    temporary.display()
                ))
            })?;
        std::fs::rename(&temporary, &self.path).map_err(|error| {
            VcsError::Registry(format!(
                "could not replace {}: {error}",
                self.path.display()
            ))
        })
    }
}

fn validate_plugin_id(id: &str) -> Result<(), VcsError> {
    let valid = !id.is_empty()
        && id.len() <= 64
        && id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'));
    if valid {
        Ok(())
    } else {
        Err(VcsError::Registry(format!("invalid plugin id: {id}")))
    }
}

#[cfg(test)]
#[allow(clippy::expect_used)]
mod tests {
    use super::*;

    fn executable(path: &Path) -> PathBuf {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).expect("parent");
        }
        std::fs::write(path, b"#!/bin/sh\n").expect("executable");
        path.to_path_buf()
    }

    fn spawn_targets(registry: &PluginRegistry) -> Vec<(String, PathBuf)> {
        registry
            .enabled_plugins()
            .expect("registry loads")
            .into_iter()
            .map(|plugin| (plugin.id, plugin.executable))
            .collect()
    }

    #[test]
    fn registry_sorts_by_priority_and_replaces_id() {
        let directory = tempfile::tempdir().expect("temp directory");
        let executable = std::env::current_exe().expect("current executable");
        let registry = PluginRegistry::new(directory.path().join("plugins.json"), None);
        registry
            .install(VcsPluginConfig {
                id: "low".into(),
                executable: executable.clone(),
                args: Vec::new(),
                enabled: true,
                priority: 1,
            })
            .expect("low plugin installs");
        registry
            .install(VcsPluginConfig {
                id: "high".into(),
                executable,
                args: vec!["serve".into()],
                enabled: true,
                priority: 100,
            })
            .expect("high plugin installs");
        let plugins = registry.list().expect("registry loads");
        let ids = plugins.iter().map(VcsProviderEntry::id).collect::<Vec<_>>();
        assert_eq!(ids, ["high", "low", "git"]);
        assert!(registry.remove("low").expect("plugin removes"));
        assert!(!registry.remove("missing").expect("missing plugin is safe"));
    }

    #[test]
    fn bundled_git_resolves_against_the_bundled_directory_at_each_read() {
        let root = tempfile::tempdir().expect("root");
        let first = executable(&root.path().join("generations/one/libexec/codewide-vcs-git"));
        let second = executable(&root.path().join("generations/two/libexec/codewide-vcs-git"));
        let current = root.path().join("current");
        std::os::unix::fs::symlink(root.path().join("generations/one"), &current).expect("link");
        let registry_path = root.path().join("state/vcs-plugins.json");
        let registry = PluginRegistry::new(registry_path.clone(), Some(current.join("libexec")));

        let resolved = spawn_targets(&registry);
        assert_eq!(resolved.len(), 1);
        assert_eq!(resolved[0].0, "git");
        assert_eq!(
            resolved[0].1.canonicalize().expect("canonical"),
            first.canonicalize().expect("canonical")
        );

        // Activating another generation switches the link; nothing is rewritten.
        std::fs::remove_file(&current).expect("unlink");
        std::os::unix::fs::symlink(root.path().join("generations/two"), &current).expect("link");
        let resolved = spawn_targets(&registry);
        assert_eq!(
            resolved[0].1.canonicalize().expect("canonical"),
            second.canonicalize().expect("canonical")
        );
        assert!(
            !registry_path.exists(),
            "resolution never writes the registry"
        );

        // A host with a different bundled directory resolves its own binary.
        let other = PluginRegistry::new(
            registry_path.clone(),
            Some(root.path().join("generations/two/libexec")),
        );
        assert_eq!(spawn_targets(&other)[0].1, second);

        // No bundled binary: the built-in is listed but unavailable.
        let missing = PluginRegistry::new(registry_path, Some(root.path().join("absent")));
        assert!(spawn_targets(&missing).is_empty());
        assert!(matches!(
            missing.list().expect("list").as_slice(),
            [VcsProviderEntry::Bundled(BundledProvider {
                id: "git",
                executable: None,
                enabled: true,
                ..
            })]
        ));
    }

    #[test]
    fn legacy_generation_entry_migrates_to_the_bundled_declaration() {
        let root = tempfile::tempdir().expect("root");
        let old = executable(&root.path().join("generations/old/libexec/codewide-vcs-git"));
        let new = executable(&root.path().join("generations/new/libexec/codewide-vcs-git"));
        let arc = executable(&root.path().join("tools/codewide-vcs-arc"));
        let registry_path = root.path().join("vcs-plugins.json");
        std::fs::write(
            &registry_path,
            serde_json::to_vec(&serde_json::json!({
                "version": 1,
                "plugins": [
                    {"id": "git", "executable": old, "priority": -1000},
                    {"id": "arc", "executable": arc, "priority": 100}
                ]
            }))
            .expect("json"),
        )
        .expect("legacy registry");
        let registry = PluginRegistry::new(
            registry_path.clone(),
            Some(root.path().join("generations/new/libexec")),
        );

        assert_eq!(
            spawn_targets(&registry),
            [("arc".to_owned(), arc.clone()), ("git".to_owned(), new)]
        );
        // The next write persists the migration: no generation path remains.
        assert!(registry.set_enabled("arc", true).expect("write"));
        let stored = std::fs::read_to_string(&registry_path).expect("stored");
        assert!(!stored.contains("generations"), "{stored}");
        assert!(stored.contains("codewide-vcs-arc"));
    }

    #[test]
    fn legacy_disabled_generation_entry_keeps_git_disabled() {
        let root = tempfile::tempdir().expect("root");
        let old = executable(&root.path().join("generations/old/libexec/codewide-vcs-git"));
        executable(&root.path().join("bundled/codewide-vcs-git"));
        let registry_path = root.path().join("vcs-plugins.json");
        std::fs::write(
            &registry_path,
            serde_json::to_vec(&serde_json::json!({
                "version": 1,
                "plugins": [{"id": "git", "executable": old, "enabled": false, "priority": -1000}]
            }))
            .expect("json"),
        )
        .expect("legacy registry");
        let registry = PluginRegistry::new(registry_path, Some(root.path().join("bundled")));
        assert!(spawn_targets(&registry).is_empty());
        assert!(matches!(
            registry.list().expect("list").as_slice(),
            [VcsProviderEntry::Bundled(BundledProvider {
                enabled: false,
                ..
            })]
        ));
    }

    #[test]
    fn user_installed_git_override_stays_external_and_resolves_first() {
        let root = tempfile::tempdir().expect("root");
        let bundled = executable(&root.path().join("bundled/codewide-vcs-git"));
        let custom = executable(&root.path().join("src/target/release/codewide-vcs-git"));
        let registry_path = root.path().join("vcs-plugins.json");
        std::fs::write(
            &registry_path,
            serde_json::to_vec(&serde_json::json!({
                "version": 1,
                "plugins": [{"id": "git", "executable": custom, "priority": BUILT_IN_PRIORITY}]
            }))
            .expect("json"),
        )
        .expect("registry");
        let registry = PluginRegistry::new(registry_path, Some(root.path().join("bundled")));

        // A tie at the lowest priority still puts the override first.
        assert_eq!(
            spawn_targets(&registry),
            [
                ("git".to_owned(), custom.clone()),
                ("git".to_owned(), bundled.clone())
            ]
        );
        // Removing the override leaves the built-in.
        assert!(registry.remove("git").expect("remove"));
        assert_eq!(spawn_targets(&registry), [("git".to_owned(), bundled)]);
        assert!(!registry.remove("git").expect("built-in is not removable"));
        assert_eq!(spawn_targets(&registry).len(), 1);
    }

    #[test]
    fn installing_the_bundled_binary_is_refused_but_an_override_is_kept() {
        let root = tempfile::tempdir().expect("root");
        let bundled = executable(&root.path().join("bundled/codewide-vcs-git"));
        let generation = executable(&root.path().join("generations/g/libexec/codewide-vcs-git"));
        let custom = executable(&root.path().join("custom/codewide-vcs-git"));
        let registry = PluginRegistry::new(
            root.path().join("vcs-plugins.json"),
            Some(root.path().join("bundled")),
        );
        for copy in [bundled, generation] {
            assert!(matches!(
                registry.install(VcsPluginConfig {
                    id: "git".into(),
                    executable: copy,
                    args: Vec::new(),
                    enabled: true,
                    priority: -1000,
                }),
                Err(VcsError::Registry(_))
            ));
        }
        registry
            .install(VcsPluginConfig {
                id: "git".into(),
                executable: custom.clone(),
                args: Vec::new(),
                enabled: true,
                priority: 10,
            })
            .expect("override installs");
        assert!(matches!(
            registry.list().expect("list").as_slice(),
            [
                VcsProviderEntry::External(VcsPluginConfig { priority: 10, .. }),
                VcsProviderEntry::Bundled(_)
            ]
        ));
        assert_eq!(
            spawn_targets(&registry)[0].1,
            custom.canonicalize().expect("canonical")
        );
    }

    #[test]
    fn built_in_can_be_disabled_and_re_enabled_but_not_removed() {
        let root = tempfile::tempdir().expect("root");
        let bundled = executable(&root.path().join("bundled/codewide-vcs-git"));
        let custom = executable(&root.path().join("custom/codewide-vcs-git"));
        let registry_path = root.path().join("vcs-plugins.json");
        let registry =
            PluginRegistry::new(registry_path.clone(), Some(root.path().join("bundled")));
        registry
            .install(VcsPluginConfig {
                id: "git".into(),
                executable: custom,
                args: Vec::new(),
                enabled: true,
                priority: 10,
            })
            .expect("override");

        assert!(registry.set_enabled("git", false).expect("disable"));
        assert!(spawn_targets(&registry).is_empty(), "the id disables both");
        assert!(
            registry.list().expect("list").iter().any(
                |entry| matches!(entry, VcsProviderEntry::Bundled(provider) if !provider.enabled)
            ),
            "a disabled built-in stays listed"
        );
        let stored = std::fs::read_to_string(&registry_path).expect("stored");
        assert!(!stored.contains(&bundled.display().to_string()), "{stored}");

        assert!(registry.remove("git").expect("override removes"));
        assert!(
            spawn_targets(&registry).is_empty(),
            "the built-in stays disabled"
        );
        assert!(registry.set_enabled("git", true).expect("enable"));
        assert_eq!(spawn_targets(&registry), [("git".to_owned(), bundled)]);
        assert!(!registry.set_enabled("unknown", false).expect("unknown id"));
    }
}
