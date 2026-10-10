//! Directories the former `install-claude-provider.sh` created: a Node.js
//! host with its `node_modules`. The companion now ships the host, so they
//! are removed on start unless `providers.claude` still runs a host from
//! one of them.

use std::path::{Path, PathBuf};

use serde_json::Value;

/// The former installer's host directories under `home`.
#[must_use]
pub fn legacy_install_directories(home: &Path) -> Vec<PathBuf> {
    if cfg!(target_os = "macos") {
        vec![home.join("Library/Application Support/CodeWide/ClaudeAgentHost")]
    } else {
        let lib = home.join(".local/lib/codewide");
        vec![lib.join("claude-agent-host"), lib.join("claude-sidecar")]
    }
}

/// Whether a path the entry configures lies inside `directory`.
fn referenced(entry: Option<&Value>, directory: &Path) -> bool {
    let Some(Value::Object(fields)) = entry else {
        return false;
    };
    fields
        .values()
        .filter_map(Value::as_str)
        .any(|path| Path::new(path).starts_with(directory))
}

/// Removes the legacy directories `entry` does not use; returns how many were
/// removed. Failures are left for the next start.
#[must_use]
pub fn remove_unreferenced(directories: &[PathBuf], entry: Option<&Value>) -> usize {
    directories
        .iter()
        .filter(|directory| directory.is_dir() && !referenced(entry, directory))
        .filter(|directory| std::fs::remove_dir_all(directory).is_ok())
        .count()
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn removes_only_directories_the_entry_does_not_run_from()
    -> Result<(), Box<dyn std::error::Error>> {
        let home = tempfile::tempdir()?;
        let directories = legacy_install_directories(home.path());
        for directory in &directories {
            std::fs::create_dir_all(directory.join("dist"))?;
        }
        let first = directories.first().ok_or("no legacy directory")?;
        let entry = json!({
            "runtimeExecutable": "/usr/bin/node",
            "sidecarEntry": first.join("dist/main.js"),
        });
        assert_eq!(
            remove_unreferenced(&directories, Some(&entry)),
            directories.len() - 1
        );
        assert!(first.is_dir());
        assert_eq!(remove_unreferenced(&directories, None), 1);
        assert!(directories.iter().all(|directory| !directory.exists()));
        Ok(())
    }
}
