//! Offline check of a parsed `providers.claude` entry: whether `claude` could
//! start under the environment the adapter gives it. It reads file metadata
//! and at most the first line of the executable (to resolve a `#!`
//! interpreter on the children's `PATH`); it starts no process and makes no
//! network or model call.

use std::{
    ffi::OsStr,
    io::{BufRead, BufReader, Read},
    os::unix::fs::PermissionsExt,
    path::{Path, PathBuf},
};

use crate::config::ClaudeConfig;

const SHEBANG_LIMIT: u64 = 256;

/// One reason `claude` would fail to start.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum PreflightProblem {
    /// The file is missing, not a regular file, or not executable.
    NotExecutable { field: &'static str },
    /// The `#!` interpreter of an executable is not found (`/usr/bin/env`
    /// interpreters are resolved on the children's `PATH`).
    InterpreterNotFound {
        field: &'static str,
        interpreter: String,
    },
}

impl std::fmt::Display for PreflightProblem {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NotExecutable { field } => {
                write!(
                    formatter,
                    "providers.claude.{field} is not an executable file"
                )
            }
            Self::InterpreterNotFound { field, interpreter } => write!(
                formatter,
                "providers.claude.{field} needs `{interpreter}`, which is not found on the host PATH"
            ),
        }
    }
}

/// Checks the entry under the children's environment; `inherited_path` is
/// the companion's own `PATH` (used when the entry configures none).
#[must_use]
pub fn preflight(config: &ClaudeConfig, inherited_path: Option<&OsStr>) -> Vec<PreflightProblem> {
    let field = "claudeExecutable";
    let executable = &config.claude_executable;
    if !is_executable(executable) {
        return vec![PreflightProblem::NotExecutable { field }];
    }
    match shebang_interpreter(executable) {
        Some(interpreter)
            if !interpreter_resolves(&interpreter, &config.search_path(inherited_path)) =>
        {
            vec![PreflightProblem::InterpreterNotFound { field, interpreter }]
        }
        _ => Vec::new(),
    }
}

fn is_executable(path: &Path) -> bool {
    std::fs::metadata(path)
        .is_ok_and(|metadata| metadata.is_file() && metadata.permissions().mode() & 0o111 != 0)
}

/// The program a `#!` line runs: the `env` target for `#!/usr/bin/env [-S] x`,
/// else the interpreter path.
fn shebang_interpreter(executable: &Path) -> Option<String> {
    let file = std::fs::File::open(executable).ok()?;
    let mut line = String::new();
    BufReader::new(file.take(SHEBANG_LIMIT))
        .read_line(&mut line)
        .ok()?;
    let command = line.strip_prefix("#!")?.trim();
    let mut words = command.split_whitespace();
    let program = words.next()?;
    if Path::new(program).file_name() == Some(OsStr::new("env")) {
        words
            .find(|word| !word.starts_with('-') && !word.contains('='))
            .map(str::to_owned)
    } else {
        Some(program.to_owned())
    }
}

fn interpreter_resolves(interpreter: &str, search_path: &[PathBuf]) -> bool {
    if interpreter.contains('/') {
        return is_executable(Path::new(interpreter));
    }
    search_path
        .iter()
        .any(|directory| is_executable(&directory.join(interpreter)))
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn executable(path: &Path, content: &str) -> Result<(), Box<dyn std::error::Error>> {
        std::fs::create_dir_all(path.parent().ok_or("no parent")?)?;
        std::fs::write(path, content)?;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o755))?;
        Ok(())
    }

    #[test]
    fn resolves_env_interpreters_on_the_children_path() -> Result<(), Box<dyn std::error::Error>> {
        let root = tempfile::tempdir()?;
        let node = root.path().join("npm/bin/node");
        let claude = root.path().join("npm/bin/claude");
        executable(&node, "\u{7f}ELF")?;
        executable(&claude, "#!/usr/bin/env node\nrequire('x')\n")?;
        let config = |environment: serde_json::Value| {
            ClaudeConfig::parse(
                &json!({"claudeExecutable": claude, "environment": environment}),
                &crate::config::ClaudeDefaults::default(),
            )
        };
        // `node` next to `claude` resolves through the directory the
        // adapter prepends, even under a minimal service PATH.
        assert_eq!(
            preflight(&config(json!({}))?, Some(OsStr::new("/usr/bin:/bin"))),
            []
        );

        std::fs::remove_file(&node)?;
        assert_eq!(
            preflight(&config(json!({"PATH": "/nonexistent"}))?, None),
            [PreflightProblem::InterpreterNotFound {
                field: "claudeExecutable",
                interpreter: "node".into()
            }]
        );
        Ok(())
    }

    #[test]
    fn reports_a_non_executable_claude() -> Result<(), Box<dyn std::error::Error>> {
        let root = tempfile::tempdir()?;
        let plain = root.path().join("plain");
        std::fs::write(&plain, "")?;
        let config = ClaudeConfig::parse(
            &json!({"claudeExecutable": plain}),
            &crate::config::ClaudeDefaults::default(),
        )?;
        assert_eq!(
            preflight(&config, None),
            [PreflightProblem::NotExecutable {
                field: "claudeExecutable"
            }]
        );
        Ok(())
    }

    #[test]
    fn reads_env_flags_and_direct_interpreters() -> Result<(), Box<dyn std::error::Error>> {
        let root = tempfile::tempdir()?;
        let script = root.path().join("script");
        for (line, expected) in [
            ("#!/usr/bin/env -S node --no-warnings\n", Some("node")),
            ("#!/usr/bin/env FOO=1 bun\n", Some("bun")),
            ("#!/usr/local/bin/node\n", Some("/usr/local/bin/node")),
            ("\u{7f}ELF", None),
        ] {
            std::fs::write(&script, line)?;
            assert_eq!(shebang_interpreter(&script).as_deref(), expected);
        }
        Ok(())
    }
}
