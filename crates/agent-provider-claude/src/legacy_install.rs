//! Files of the former Claude agent host, which Rust replaced: the
//! directories `install-claude-provider.sh` created (a Node.js host with its
//! `node_modules`), the host the companion unpacked and the Agent SDK it
//! downloaded under its state directory. They are removed on start.

use std::path::{Path, PathBuf};

/// The former host's directories: the installer's under `home`, the
/// companion's under `state_directory`.
#[must_use]
pub fn former_host_directories(home: Option<&Path>, state_directory: &Path) -> Vec<PathBuf> {
    let installer = home.map(|home| {
        if cfg!(target_os = "macos") {
            vec![home.join("Library/Application Support/CodeWide/ClaudeAgentHost")]
        } else {
            let lib = home.join(".local/lib/codewide");
            vec![lib.join("claude-agent-host"), lib.join("claude-sidecar")]
        }
    });
    installer
        .into_iter()
        .flatten()
        .chain([
            state_directory.join("claude-agent-host"),
            state_directory.join("claude-agent-sdk"),
        ])
        .collect()
}

/// Removes the existing `directories`; returns how many were removed.
#[must_use]
pub fn remove(directories: &[PathBuf]) -> usize {
    directories
        .iter()
        .filter(|directory| directory.is_dir())
        .filter(|directory| std::fs::remove_dir_all(directory).is_ok())
        .count()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn removes_every_former_host_directory() -> Result<(), Box<dyn std::error::Error>> {
        let home = tempfile::tempdir()?;
        let state = tempfile::tempdir()?;
        let directories = former_host_directories(Some(home.path()), state.path());
        for directory in &directories {
            std::fs::create_dir_all(directory.join("dist"))?;
        }
        let kept = state.path().join("claude-journal");
        std::fs::create_dir_all(&kept)?;
        assert_eq!(remove(&directories), directories.len());
        assert!(directories.iter().all(|directory| !directory.exists()));
        assert!(kept.is_dir());
        assert_eq!(remove(&directories), 0);
        Ok(())
    }
}
