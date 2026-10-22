//! Built-in providers and their bundled plugin binaries.
//!
//! Each host passes its bundled plugin directory in the runtime config: the
//! Linux generation's `libexec/`, Homebrew's `opt_libexec`, or
//! `CodeWide.app/Contents/Helpers/` on macOS. `bundled:<id>` is resolved
//! against that directory at every spawn, so a host update that replaces the
//! binary is picked up by the next call. No path is inferred from the
//! running executable and none is stored; a missing binary means "provider
//! unavailable", never a fallback path.

use std::path::{Path, PathBuf};

/// A provider compiled into the companion's provider list.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct BuiltIn {
    pub plugin_id: &'static str,
    pub binary: &'static str,
    pub forge_name: &'static str,
    pub icon_key: &'static str,
    pub default_host: &'static str,
    pub priority: i32,
}

/// The built-in providers, always present (they can be disabled, never
/// removed).
pub const BUILT_INS: [BuiltIn; 1] = [BuiltIn {
    plugin_id: "github",
    binary: "codewide-forge-github",
    forge_name: "GitHub",
    icon_key: "github",
    default_host: "github.com",
    priority: 100,
}];

#[must_use]
pub fn built_in(plugin_id: &str) -> Option<&'static BuiltIn> {
    BUILT_INS
        .iter()
        .find(|built_in| built_in.plugin_id == plugin_id)
}

/// The host-supplied bundled plugin directory.
#[derive(Clone, Debug, Default)]
pub struct BundledPlugins {
    directory: Option<PathBuf>,
}

impl BundledPlugins {
    #[must_use]
    pub fn new(directory: Option<PathBuf>) -> Self {
        Self { directory }
    }

    #[must_use]
    pub fn directory(&self) -> Option<&Path> {
        self.directory.as_deref()
    }

    /// The executable of a built-in provider, or `None` when the host has no
    /// bundled directory or the binary is missing.
    #[must_use]
    pub fn resolve(&self, built_in: &BuiltIn) -> Option<PathBuf> {
        let path = self.directory.as_ref()?.join(built_in.binary);
        path.is_file().then_some(path)
    }
}

#[cfg(test)]
#[allow(clippy::expect_used)]
mod tests {
    use super::*;

    #[test]
    fn resolves_only_existing_binaries_in_the_host_directory() {
        let directory = tempfile::tempdir().expect("dir");
        let github = built_in("github").expect("built in");
        assert_eq!(BundledPlugins::default().resolve(github), None);
        let bundled = BundledPlugins::new(Some(directory.path().to_path_buf()));
        assert_eq!(bundled.resolve(github), None);
        std::fs::write(directory.path().join("codewide-forge-github"), b"").expect("binary");
        assert_eq!(
            bundled.resolve(github),
            Some(directory.path().join("codewide-forge-github"))
        );
    }
}
