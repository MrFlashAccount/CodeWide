use std::{
    collections::HashSet,
    ffi::OsStr,
    os::unix::fs::PermissionsExt,
    path::{Path, PathBuf},
    process::Stdio,
    time::Duration,
};

use semver::Version;
use tokio::{process::Command, time::timeout};

const VERSION_COMMAND_TIMEOUT: Duration = Duration::from_secs(5);
const START_COMMAND_TIMEOUT: Duration = Duration::from_secs(15);

#[derive(Clone, Debug, uniffi::Enum)]
pub enum FfiCodexInstallation {
    NotFound {
        minimum_version: String,
    },
    Unverified {
        minimum_version: String,
    },
    UpdateRequired {
        installed_version: String,
        minimum_version: String,
    },
    Ready {
        installed_version: String,
    },
}

#[derive(Debug, thiserror::Error)]
pub enum CodexInstallationError {
    #[error("No compatible Codex installation was found")]
    NotReady,
    #[error("The installed Codex process did not finish in time")]
    TimedOut,
    #[error("The installed Codex process could not be started: {0}")]
    Spawn(#[source] std::io::Error),
    #[error("Codex could not start its App Server daemon")]
    StartFailed,
}

pub async fn inspect_codex_installation(
    home_directory: &Path,
    codex_homes: &[PathBuf],
) -> FfiCodexInstallation {
    let candidates =
        executable_candidates(home_directory, codex_homes.iter().map(PathBuf::as_path));
    inspect_candidates(candidates).await
}

async fn inspect_candidates(candidates: Vec<PathBuf>) -> FfiCodexInstallation {
    let minimum = minimum_version();
    let had_executable = !candidates.is_empty();
    let mut newest = None;

    for executable in candidates {
        if let Some(version) = codex_version(&executable).await {
            keep_newest(
                &mut newest,
                VerifiedCodexInstallation {
                    executable,
                    version,
                },
            );
        }
    }

    let Some(installation) = newest else {
        return if had_executable {
            FfiCodexInstallation::Unverified {
                minimum_version: minimum.to_string(),
            }
        } else {
            FfiCodexInstallation::NotFound {
                minimum_version: minimum.to_string(),
            }
        };
    };

    if installation.version < minimum {
        return FfiCodexInstallation::UpdateRequired {
            installed_version: installation.version.to_string(),
            minimum_version: minimum.to_string(),
        };
    }

    FfiCodexInstallation::Ready {
        installed_version: installation.version.to_string(),
    }
}

pub async fn start_codex_app_server(
    home_directory: &Path,
    codex_home: &Path,
) -> Result<(), CodexInstallationError> {
    let installation = compatible_installation(home_directory, codex_home)
        .await
        .ok_or(CodexInstallationError::NotReady)?;
    let mut command = Command::new(&installation.executable);
    command
        .args(["app-server", "daemon", "start"])
        .env("CODEX_HOME", codex_home)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .kill_on_drop(true);

    let output = timeout(START_COMMAND_TIMEOUT, command.status())
        .await
        .map_err(|_| CodexInstallationError::TimedOut)?
        .map_err(CodexInstallationError::Spawn)?;
    if output.success() {
        Ok(())
    } else {
        Err(CodexInstallationError::StartFailed)
    }
}

async fn compatible_installation(
    home_directory: &Path,
    codex_home: &Path,
) -> Option<VerifiedCodexInstallation> {
    let mut newest = None;
    for executable in executable_candidates(home_directory, std::iter::once(codex_home)) {
        if let Some(version) = codex_version(&executable).await
            && version >= minimum_version()
        {
            keep_newest(
                &mut newest,
                VerifiedCodexInstallation {
                    executable,
                    version,
                },
            );
        }
    }
    newest
}

async fn codex_version(executable: &Path) -> Option<Version> {
    let mut command = Command::new(executable);
    command
        .arg("--version")
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    let output = timeout(VERSION_COMMAND_TIMEOUT, command.output())
        .await
        .ok()?
        .ok()?;
    if !output.status.success() {
        return None;
    }
    parse_codex_version(&output.stdout)
}

fn parse_codex_version(output: &[u8]) -> Option<Version> {
    let output = std::str::from_utf8(output).ok()?;
    output
        .split_ascii_whitespace()
        .find_map(|token| Version::parse(token.trim_start_matches('v')).ok())
}

fn minimum_version() -> Version {
    Version::new(0, 155, 1)
}

fn keep_newest(
    newest: &mut Option<VerifiedCodexInstallation>,
    candidate: VerifiedCodexInstallation,
) {
    if newest
        .as_ref()
        .is_none_or(|current| candidate.version > current.version)
    {
        *newest = Some(candidate);
    }
}

fn executable_candidates<'a>(
    home_directory: &Path,
    codex_homes: impl Iterator<Item = &'a Path>,
) -> Vec<PathBuf> {
    let mut raw_candidates = Vec::new();
    for codex_home in codex_homes {
        raw_candidates.push(codex_home.join("packages/standalone/current/bin/codex"));
    }
    raw_candidates.push(home_directory.join(".local/bin/codex"));
    raw_candidates.push(home_directory.join("Applications/Codex.app/Contents/Resources/codex"));
    raw_candidates.push(PathBuf::from(
        "/Applications/Codex.app/Contents/Resources/codex",
    ));
    raw_candidates.push(PathBuf::from("/opt/homebrew/bin/codex"));
    raw_candidates.push(PathBuf::from("/usr/local/bin/codex"));
    if let Some(path) = std::env::var_os("PATH") {
        append_path_candidates(&mut raw_candidates, &path);
    }

    let mut seen = HashSet::new();
    raw_candidates
        .into_iter()
        .filter_map(|candidate| verified_executable(&candidate, &mut seen))
        .collect()
}

fn append_path_candidates(candidates: &mut Vec<PathBuf>, path: &OsStr) {
    candidates.extend(std::env::split_paths(path).map(|directory| directory.join("codex")));
}

fn verified_executable(candidate: &Path, seen: &mut HashSet<PathBuf>) -> Option<PathBuf> {
    let metadata = candidate.metadata().ok()?;
    if !metadata.is_file() || metadata.permissions().mode() & 0o111 == 0 {
        return None;
    }
    let resolved = candidate.canonicalize().ok()?;
    seen.insert(resolved.clone()).then_some(resolved)
}

#[derive(Debug)]
struct VerifiedCodexInstallation {
    executable: PathBuf,
    version: Version,
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{fs, os::unix::fs::PermissionsExt};

    #[test]
    fn parses_stable_and_prerelease_codex_versions() {
        assert_eq!(
            parse_codex_version(b"codex-cli 0.157.0\n"),
            Version::parse("0.157.0").ok()
        );
        assert_eq!(
            parse_codex_version(b"codex-cli 0.158.0-alpha.1\n"),
            Version::parse("0.158.0-alpha.1").ok()
        );
        assert_eq!(parse_codex_version(b"unknown\n"), None);
    }

    #[tokio::test]
    async fn inspection_reports_a_compatible_home_installation()
    -> Result<(), Box<dyn std::error::Error>> {
        let home = tempfile::tempdir()?;
        let executable = home.path().join(".local/bin/codex");
        write_fake_codex(&executable, "0.157.0", true)?;

        let status = inspect_candidates(vec![executable.canonicalize()?]).await;

        assert!(matches!(
            status,
            FfiCodexInstallation::Ready { installed_version }
                if installed_version == "0.157.0"
        ));
        Ok(())
    }

    #[tokio::test]
    async fn inspection_reports_when_an_installed_codex_needs_an_update()
    -> Result<(), Box<dyn std::error::Error>> {
        let home = tempfile::tempdir()?;
        let executable = home.path().join(".local/bin/codex");
        write_fake_codex(&executable, "0.154.0", true)?;

        let status = inspect_candidates(vec![executable.canonicalize()?]).await;

        match status {
            FfiCodexInstallation::UpdateRequired {
                installed_version,
                minimum_version: required_version,
            } => {
                assert_eq!(installed_version, "0.154.0");
                assert_eq!(required_version, minimum_version().to_string());
            }
            other => panic!("expected update requirement, got {other:?}"),
        }
        Ok(())
    }

    #[tokio::test]
    async fn start_uses_the_requested_codex_home_without_a_shell()
    -> Result<(), Box<dyn std::error::Error>> {
        let home = tempfile::tempdir()?;
        let codex_home = home.path().join(".codex-work");
        let executable = home.path().join(".local/bin/codex");
        let invocation = home.path().join("invocation.txt");
        write_recording_codex(&executable, &invocation)?;

        start_codex_app_server(home.path(), &codex_home).await?;

        let recorded = fs::read_to_string(invocation)?;
        assert_eq!(
            recorded,
            format!("{}|app-server daemon start", codex_home.display())
        );
        Ok(())
    }

    fn write_fake_codex(
        executable: &Path,
        version: &str,
        start_succeeds: bool,
    ) -> Result<(), Box<dyn std::error::Error>> {
        let start_status = i32::from(!start_succeeds);
        let script = format!(
            "#!/bin/sh\nif [ \"$1\" = \"--version\" ]; then printf 'codex-cli {version}\\n'; exit 0; fi\nexit {start_status}\n"
        );
        write_executable(executable, &script)
    }

    fn write_recording_codex(
        executable: &Path,
        invocation: &Path,
    ) -> Result<(), Box<dyn std::error::Error>> {
        let script = format!(
            "#!/bin/sh\nif [ \"$1\" = \"--version\" ]; then printf 'codex-cli 999.0.0\\n'; exit 0; fi\nprintf '%s|%s %s %s' \"$CODEX_HOME\" \"$1\" \"$2\" \"$3\" > '{}'\n",
            invocation.display()
        );
        write_executable(executable, &script)
    }

    fn write_executable(
        executable: &Path,
        contents: &str,
    ) -> Result<(), Box<dyn std::error::Error>> {
        if let Some(parent) = executable.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(executable, contents)?;
        let mut permissions = executable.metadata()?.permissions();
        permissions.set_mode(0o700);
        fs::set_permissions(executable, permissions)?;
        Ok(())
    }
}
