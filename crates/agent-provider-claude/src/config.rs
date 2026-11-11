//! The Claude provider's configuration, derived from the machine.
//!
//! There is no configuration file: Claude runs whenever the user's `claude`
//! is found ([`ClaudeDefaults`]). The `claude` children get the user's
//! login-shell `PATH`, because a service manager (systemd user units,
//! launchd) starts the companion with a minimal `PATH` and Claude's Bash
//! tool inherits it; without one the companion's own `PATH` is used.
//! `CLAUDE_CONFIG_DIR` comes from the companion's environment.

use std::{
    ffi::{OsStr, OsString},
    path::{Path, PathBuf},
};

pub const DEFAULT_IDLE_RELEASE_MINUTES: u32 = 30;

#[derive(Debug, thiserror::Error)]
pub enum ClaudeConfigError {
    #[error("the directory of `claude` must not contain ':'")]
    PathSeparator,
    #[error("`claude` was not found on this machine; install Claude Code")]
    NoClaude,
}

/// What the companion finds on this machine for Claude.
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct ClaudeDefaults {
    /// The user's `claude`, found on the machine.
    pub claude_executable: Option<PathBuf>,
    /// The thread state directory (`<state dir>/claude-journal`).
    pub journal_directory: PathBuf,
    /// The user's login-shell `PATH`, the children's `PATH`.
    pub login_path: Option<Vec<PathBuf>>,
}

/// Validated Claude provider configuration.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ClaudeConfig {
    pub claude_executable: PathBuf,
    /// Where each `CodeWide` thread's state lives (`threads/<id>/state.json`).
    pub journal_directory: PathBuf,
    pub idle_release_minutes: u32,
    /// The children's `PATH` after the directory of `claude` (the login
    /// shell's); `None` keeps the companion's own.
    pub search_path: Option<Vec<PathBuf>>,
}

impl ClaudeConfig {
    /// The configuration of the `claude` found on the machine.
    ///
    /// # Errors
    /// Returns why Claude cannot run (no `claude`, or a directory that
    /// cannot appear in `PATH`).
    pub fn automatic(defaults: &ClaudeDefaults) -> Result<Self, ClaudeConfigError> {
        let claude_executable = defaults
            .claude_executable
            .clone()
            .ok_or(ClaudeConfigError::NoClaude)?;
        Self::with_executable(claude_executable, defaults)
    }

    /// The configuration of a known `claude` over `defaults`.
    ///
    /// # Errors
    /// Returns [`ClaudeConfigError::PathSeparator`] when the directory of
    /// `claude` cannot appear in `PATH`.
    pub fn with_executable(
        claude_executable: PathBuf,
        defaults: &ClaudeDefaults,
    ) -> Result<Self, ClaudeConfigError> {
        let directory = executable_directory(&claude_executable);
        if directory.as_os_str().as_encoded_bytes().contains(&b':') {
            return Err(ClaudeConfigError::PathSeparator);
        }
        Ok(Self {
            claude_executable,
            journal_directory: defaults.journal_directory.clone(),
            idle_release_minutes: DEFAULT_IDLE_RELEASE_MINUTES,
            search_path: defaults.login_path.clone(),
        })
    }

    /// The children's `PATH`: the directory of `claude` first, then the
    /// login-shell `PATH`, else `inherited` (the companion's own).
    /// Duplicates keep their first position.
    #[must_use]
    pub fn search_path(&self, inherited: Option<&OsStr>) -> Vec<PathBuf> {
        let mut entries = Vec::new();
        let leading = executable_directory(&self.claude_executable);
        let rest: Vec<PathBuf> = match &self.search_path {
            Some(login) => login.clone(),
            None => inherited
                .map(std::env::split_paths)
                .into_iter()
                .flatten()
                .collect(),
        };
        for entry in std::iter::once(leading).chain(rest) {
            if !entries.contains(&entry) {
                entries.push(entry);
            }
        }
        entries
    }

    /// Variables the `claude` children get on top of the companion's
    /// environment: `PATH` (see [`Self::search_path`]).
    #[must_use]
    pub fn child_environment(&self, inherited_path: Option<&OsStr>) -> Vec<(OsString, OsString)> {
        let mut path = OsString::new();
        for (index, entry) in self.search_path(inherited_path).iter().enumerate() {
            if index > 0 {
                path.push(":");
            }
            path.push(entry);
        }
        vec![(OsString::from("PATH"), path)]
    }

    /// Claude's configuration directory from the companion's environment
    /// (`CLAUDE_CONFIG_DIR`, then `~/.claude`), the same one the children's
    /// `claude` uses.
    #[must_use]
    pub fn config_directory(&self) -> Option<PathBuf> {
        crate::watcher::config_directory()
    }

    /// Claude's session store (`<config directory>/projects`).
    #[must_use]
    pub fn projects_root(&self) -> Option<PathBuf> {
        self.config_directory()
            .map(|directory| directory.join("projects"))
    }
}

/// The directory that holds `executable`, as it will appear in `PATH`.
fn executable_directory(executable: &Path) -> PathBuf {
    executable.parent().unwrap_or(executable).to_path_buf()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn defaults(directory: &Path) -> ClaudeDefaults {
        ClaudeDefaults {
            claude_executable: None,
            journal_directory: directory.join("claude-journal"),
            login_path: None,
        }
    }

    #[test]
    fn the_found_claude_runs_with_the_login_path() -> Result<(), Box<dyn std::error::Error>> {
        let directory = tempfile::tempdir()?;
        let claude = directory.path().join("bin/claude");
        let login = vec![PathBuf::from("/opt/tools/bin"), PathBuf::from("/usr/bin")];
        let found = ClaudeDefaults {
            claude_executable: Some(claude.clone()),
            login_path: Some(login),
            ..defaults(directory.path())
        };
        let config = ClaudeConfig::automatic(&found)?;
        assert_eq!(config.claude_executable, claude);
        assert_eq!(config.idle_release_minutes, DEFAULT_IDLE_RELEASE_MINUTES);
        assert_eq!(
            config.journal_directory,
            directory.path().join("claude-journal")
        );
        assert_eq!(
            config.search_path(Some(OsStr::new("/usr/bin:/bin"))),
            [
                directory.path().join("bin"),
                "/opt/tools/bin".into(),
                "/usr/bin".into()
            ]
        );
        assert!(matches!(
            ClaudeConfig::automatic(&ClaudeDefaults {
                claude_executable: None,
                ..found
            }),
            Err(ClaudeConfigError::NoClaude)
        ));
        Ok(())
    }

    #[test]
    fn child_environment_leads_with_the_claude_directory() -> Result<(), Box<dyn std::error::Error>>
    {
        let directory = tempfile::tempdir()?;
        let claude_dir = directory.path().join("claude/bin");
        let claude = claude_dir.join("claude");
        let path = |config: &ClaudeConfig, inherited: Option<&str>| {
            config
                .child_environment(inherited.map(OsStr::new))
                .into_iter()
                .find(|(name, _)| name == "PATH")
                .map(|(_, value)| value)
        };

        // No login-shell PATH keeps the companion's PATH after the prepend.
        let plain = ClaudeConfig::with_executable(claude.clone(), &defaults(directory.path()))?;
        assert_eq!(
            path(&plain, Some("/usr/bin:/bin")),
            Some(OsString::from(format!(
                "{}:/usr/bin:/bin",
                claude_dir.display()
            )))
        );
        assert_eq!(plain.child_environment(None).len(), 1);

        // A login-shell PATH replaces the inherited one; duplicates collapse.
        let login = ClaudeDefaults {
            login_path: Some(vec![
                claude_dir.clone(),
                "/opt/tools/bin".into(),
                "/usr/bin".into(),
            ]),
            ..defaults(directory.path())
        };
        let captured = ClaudeConfig::with_executable(claude, &login)?;
        assert_eq!(
            path(&captured, Some("/usr/bin:/bin")),
            Some(OsString::from(format!(
                "{}:/opt/tools/bin:/usr/bin",
                claude_dir.display()
            )))
        );
        Ok(())
    }

    #[test]
    fn a_claude_directory_with_a_path_separator_is_rejected() {
        assert!(matches!(
            ClaudeConfig::with_executable(
                PathBuf::from("/opt/a:b/claude"),
                &defaults(Path::new("/state"))
            ),
            Err(ClaudeConfigError::PathSeparator)
        ));
    }
}
