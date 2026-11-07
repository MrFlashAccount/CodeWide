//! `forge-plugins.json` v1: externally installed forge plugins (Arcanum).
//!
//! The VCS registry rule applies: the executable must be absolute and is
//! canonicalized at install; ids are short and safe; writes are atomic. A
//! built-in id cannot be taken by an external plugin.

use std::{
    fs::OpenOptions,
    io::Write as _,
    os::unix::fs::OpenOptionsExt as _,
    path::{Path, PathBuf},
};

use serde::{Deserialize, Serialize};

use super::bundled;

const REGISTRY_VERSION: u32 = 1;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalPlugin {
    pub id: String,
    pub executable: PathBuf,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub priority: i32,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct RegistryFile {
    version: u32,
    plugins: Vec<ExternalPlugin>,
}

#[derive(Debug, thiserror::Error)]
pub enum RegistryError {
    #[error("invalid forge plugin id: {0}")]
    InvalidId(String),
    #[error("{0} is a built-in provider")]
    BuiltIn(String),
    #[error("forge plugin executable must be an absolute path to a file")]
    InvalidExecutable,
    #[error("forge plugin registry is unreadable: {0}")]
    Unreadable(String),
    #[error("forge plugin registry could not be written: {0}")]
    Unwritable(String),
}

#[derive(Clone, Debug)]
pub struct PluginRegistry {
    path: PathBuf,
}

impl PluginRegistry {
    #[must_use]
    pub fn new(path: PathBuf) -> Self {
        Self { path }
    }

    #[must_use]
    pub fn path(&self) -> &Path {
        &self.path
    }

    /// External plugins in resolution order (priority, then id).
    ///
    /// # Errors
    ///
    /// Returns an error for an unreadable or invalid registry file.
    pub fn list(&self) -> Result<Vec<ExternalPlugin>, RegistryError> {
        let mut plugins = self.read()?.plugins;
        sort(&mut plugins);
        Ok(plugins)
    }

    /// Installs or replaces one external plugin.
    ///
    /// # Errors
    ///
    /// Returns an error for an invalid or built-in id, a relative or missing
    /// executable, or a failed write.
    pub fn install(&self, mut plugin: ExternalPlugin) -> Result<(), RegistryError> {
        validate_id(&plugin.id)?;
        if bundled::built_in(&plugin.id).is_some() {
            return Err(RegistryError::BuiltIn(plugin.id));
        }
        if !plugin.executable.is_absolute() {
            return Err(RegistryError::InvalidExecutable);
        }
        plugin.executable = plugin
            .executable
            .canonicalize()
            .map_err(|_| RegistryError::InvalidExecutable)?;
        if !plugin.executable.is_file() {
            return Err(RegistryError::InvalidExecutable);
        }
        let mut registry = self.read()?;
        registry.plugins.retain(|existing| existing.id != plugin.id);
        registry.plugins.push(plugin);
        sort(&mut registry.plugins);
        self.write(&registry)
    }

    /// Removes one external plugin; `false` when it was not installed.
    ///
    /// # Errors
    ///
    /// Returns an error for an invalid id or a failed write.
    pub fn remove(&self, id: &str) -> Result<bool, RegistryError> {
        validate_id(id)?;
        let mut registry = self.read()?;
        let before = registry.plugins.len();
        registry.plugins.retain(|plugin| plugin.id != id);
        let removed = registry.plugins.len() != before;
        if removed {
            self.write(&registry)?;
        }
        Ok(removed)
    }

    fn read(&self) -> Result<RegistryFile, RegistryError> {
        let bytes = match std::fs::read(&self.path) {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Ok(RegistryFile {
                    version: REGISTRY_VERSION,
                    plugins: Vec::new(),
                });
            }
            Err(error) => return Err(RegistryError::Unreadable(error.to_string())),
        };
        let registry = serde_json::from_slice::<RegistryFile>(&bytes)
            .map_err(|error| RegistryError::Unreadable(error.to_string()))?;
        if registry.version != REGISTRY_VERSION {
            return Err(RegistryError::Unreadable(format!(
                "unsupported version {}",
                registry.version
            )));
        }
        for plugin in &registry.plugins {
            validate_id(&plugin.id)?;
            if !plugin.executable.is_absolute() {
                return Err(RegistryError::InvalidExecutable);
            }
        }
        Ok(registry)
    }

    fn write(&self, registry: &RegistryFile) -> Result<(), RegistryError> {
        let unwritable = |error: std::io::Error| RegistryError::Unwritable(error.to_string());
        let parent = self
            .path
            .parent()
            .ok_or_else(|| RegistryError::Unwritable("no parent directory".into()))?;
        std::fs::create_dir_all(parent).map_err(unwritable)?;
        let temporary = parent.join(format!(".forge-plugins.{}.tmp", std::process::id()));
        let encoded = serde_json::to_vec_pretty(registry)
            .map_err(|error| RegistryError::Unwritable(error.to_string()))?;
        let mut file = OpenOptions::new()
            .create(true)
            .truncate(true)
            .write(true)
            .mode(0o600)
            .open(&temporary)
            .map_err(unwritable)?;
        file.write_all(&encoded)
            .and_then(|()| file.write_all(b"\n"))
            .and_then(|()| file.sync_all())
            .map_err(unwritable)?;
        std::fs::rename(&temporary, &self.path).map_err(unwritable)
    }
}

/// Plugin ids: 1–64 ASCII alphanumerics, `-`, `_` or `.`.
///
/// # Errors
///
/// Returns [`RegistryError::InvalidId`] otherwise.
pub fn validate_id(id: &str) -> Result<(), RegistryError> {
    let valid = !id.is_empty()
        && id.len() <= 64
        && id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
        && id != "."
        && id != "..";
    if valid {
        Ok(())
    } else {
        Err(RegistryError::InvalidId(id.to_owned()))
    }
}

fn sort(plugins: &mut [ExternalPlugin]) {
    plugins.sort_by(|left, right| {
        right
            .priority
            .cmp(&left.priority)
            .then_with(|| left.id.cmp(&right.id))
    });
}

#[cfg(test)]
#[allow(clippy::expect_used)]
mod tests {
    use super::*;

    #[test]
    fn installs_canonical_executables_and_refuses_built_in_ids() {
        let directory = tempfile::tempdir().expect("dir");
        let executable = directory.path().join("plugin");
        std::fs::write(&executable, b"#!/bin/sh\n").expect("plugin");
        let registry = PluginRegistry::new(directory.path().join("forge-plugins.json"));
        registry
            .install(ExternalPlugin {
                id: "arcanum".into(),
                executable: directory.path().join("./plugin"),
                args: Vec::new(),
                priority: 50,
            })
            .expect("install");
        let plugins = registry.list().expect("list");
        assert_eq!(plugins.len(), 1);
        assert_eq!(
            plugins[0].executable,
            executable.canonicalize().expect("canonical")
        );
        assert!(matches!(
            registry.install(ExternalPlugin {
                id: "github".into(),
                executable: executable.clone(),
                args: Vec::new(),
                priority: 0,
            }),
            Err(RegistryError::BuiltIn(_))
        ));
        assert!(matches!(
            registry.install(ExternalPlugin {
                id: "relative".into(),
                executable: PathBuf::from("plugin"),
                args: Vec::new(),
                priority: 0,
            }),
            Err(RegistryError::InvalidExecutable)
        ));
        assert!(registry.remove("arcanum").expect("remove"));
        assert!(!registry.remove("arcanum").expect("idempotent"));
    }
}
