//! Built-in VCS providers and their bundled plugin binaries.
//!
//! The host passes its bundled plugin directory (the same one forge uses: the
//! Linux generation's `libexec/` through the stable `current` link, Homebrew's
//! `opt_libexec`, or `CodeWide.app/Contents/Helpers/` on macOS). `bundled:<id>`
//! is resolved against that directory at every spawn, so a generation switch
//! is picked up by the next operation without rewriting the registry. No path
//! is inferred from the running executable and none is stored; a missing
//! binary means "provider unavailable", never a fallback path.
//!
//! The companion knows only the plugin id and the binary name; repository
//! behaviour belongs to the plugin process.

use std::path::{Path, PathBuf};

/// A provider compiled into the companion's provider list.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct BuiltIn {
    pub plugin_id: &'static str,
    pub binary: &'static str,
}

/// Built-ins resolve after every external provider: the lowest priority, and
/// an external provider with an equal priority sorts first.
pub const BUILT_IN_PRIORITY: i32 = i32::MIN;

/// The built-in providers, always present (they can be disabled, never
/// removed).
pub const BUILT_INS: [BuiltIn; 1] = [BuiltIn {
    plugin_id: "git",
    binary: "codewide-vcs-git",
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

    /// The executable of a built-in provider, or `None` when the host has no
    /// bundled directory or the binary is missing.
    #[must_use]
    pub fn resolve(&self, built_in: &BuiltIn) -> Option<PathBuf> {
        let path = self.directory.as_ref()?.join(built_in.binary);
        path.is_file().then_some(path)
    }

    /// Whether a registered executable is a host-installed copy of a
    /// built-in's binary rather than a user-chosen override: a Linux
    /// generation (`…/generations/<generation>/libexec/<binary>`), a Homebrew
    /// keg (`…/Cellar/<formula>/<version>/libexec/<binary>`), or the binary in
    /// the current bundled directory.
    #[must_use]
    pub fn is_bundled_copy(&self, built_in: &BuiltIn, executable: &Path) -> bool {
        if executable.file_name().and_then(|name| name.to_str()) != Some(built_in.binary) {
            return false;
        }
        let ancestor_name = |depth: usize| {
            executable
                .ancestors()
                .nth(depth)
                .and_then(Path::file_name)
                .and_then(|name| name.to_str())
        };
        if ancestor_name(1) == Some("libexec")
            && (ancestor_name(3) == Some("generations") || ancestor_name(4) == Some("Cellar"))
        {
            return true;
        }
        self.resolve(built_in).is_some_and(|bundled| {
            bundled == executable
                || matches!(
                    (bundled.canonicalize(), executable.canonicalize()),
                    (Ok(bundled), Ok(executable)) if bundled == executable
                )
        })
    }
}

#[cfg(test)]
#[allow(clippy::expect_used)]
mod tests {
    use super::*;

    #[test]
    fn resolves_only_existing_binaries_in_the_host_directory() {
        let directory = tempfile::tempdir().expect("dir");
        let git = built_in("git").expect("built in");
        assert_eq!(BundledPlugins::default().resolve(git), None);
        let bundled = BundledPlugins::new(Some(directory.path().to_path_buf()));
        assert_eq!(bundled.resolve(git), None);
        std::fs::write(directory.path().join("codewide-vcs-git"), b"").expect("binary");
        assert_eq!(
            bundled.resolve(git),
            Some(directory.path().join("codewide-vcs-git"))
        );
    }

    #[test]
    fn recognizes_host_installed_copies_but_not_overrides() {
        let git = built_in("git").expect("built in");
        let bundled = BundledPlugins::default();
        for copy in [
            "/home/u/.local/lib/codewide/generations/abc/libexec/codewide-vcs-git",
            "/home/linuxbrew/.linuxbrew/Cellar/codewide/0.4.2/libexec/codewide-vcs-git",
        ] {
            assert!(bundled.is_bundled_copy(git, Path::new(copy)), "{copy}");
        }
        for override_path in [
            "/home/u/src/CodeWide/target/release/codewide-vcs-git",
            "/home/u/.local/lib/codewide/generations/abc/libexec/other-git",
            "/opt/generations/abc/bin/codewide-vcs-git",
        ] {
            assert!(
                !bundled.is_bundled_copy(git, Path::new(override_path)),
                "{override_path}"
            );
        }
    }

    #[test]
    fn recognizes_the_current_bundled_binary_through_links() {
        let directory = tempfile::tempdir().expect("dir");
        let generation = directory.path().join("release-1");
        std::fs::create_dir_all(&generation).expect("generation");
        std::fs::write(generation.join("codewide-vcs-git"), b"").expect("binary");
        let current = directory.path().join("current");
        std::os::unix::fs::symlink(&generation, &current).expect("link");
        let git = built_in("git").expect("built in");
        let bundled = BundledPlugins::new(Some(current));
        assert!(bundled.is_bundled_copy(git, &generation.join("codewide-vcs-git")));
    }
}
