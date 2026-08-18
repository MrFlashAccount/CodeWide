use std::{
    fs, io,
    os::unix::fs::{PermissionsExt, symlink},
    path::{Path, PathBuf},
};

use serde::Serialize;

#[derive(Debug, Clone)]
pub struct StateMigrationPaths {
    pub legacy_config_root: PathBuf,
    pub current_config_root: PathBuf,
    pub legacy_state_root: PathBuf,
    pub current_state_root: PathBuf,
    pub legacy_shadow_root: PathBuf,
    pub current_shadow_root: PathBuf,
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StateMigrationReport {
    pub migrated: Vec<String>,
    pub aliases_created: Vec<String>,
    pub unchanged: Vec<String>,
}

/// Moves legacy `CodeWide` companion state into its branded locations while keeping
/// compatibility symlinks for older binaries and tooling.
///
/// # Errors
///
/// Returns an error before changing any root when both its legacy and current
/// location contain authoritative data. It also fails when required identity
/// files are empty or have unsafe permissions after the migration.
pub fn migrate_legacy_installation(
    paths: &StateMigrationPaths,
) -> io::Result<StateMigrationReport> {
    preflight_root(
        &paths.legacy_config_root,
        &paths.current_config_root,
        RootKind::Config,
    )?;
    preflight_root(
        &paths.legacy_state_root,
        &paths.current_state_root,
        RootKind::State,
    )?;
    preflight_root(
        &paths.legacy_shadow_root,
        &paths.current_shadow_root,
        RootKind::State,
    )?;

    let mut report = StateMigrationReport::default();
    migrate_root(
        &paths.legacy_config_root,
        &paths.current_config_root,
        RootKind::Config,
        &mut report,
    )?;
    migrate_root(
        &paths.legacy_state_root,
        &paths.current_state_root,
        RootKind::State,
        &mut report,
    )?;
    migrate_root(
        &paths.legacy_shadow_root,
        &paths.current_shadow_root,
        RootKind::State,
        &mut report,
    )?;

    validate_private_file(&paths.current_config_root.join("host.token"))?;
    Ok(report)
}

#[derive(Clone, Copy)]
enum RootKind {
    Config,
    State,
}

fn preflight_root(legacy: &Path, current: &Path, kind: RootKind) -> io::Result<()> {
    if symlink_points_to(legacy, current)? || !legacy.exists() || !current.exists() {
        return Ok(());
    }
    let disposable = match kind {
        RootKind::Config => disposable_config_root(current)?,
        RootKind::State => directory_is_empty(current)?,
    };
    if disposable {
        return Ok(());
    }
    Err(io::Error::new(
        io::ErrorKind::AlreadyExists,
        format!(
            "refusing to merge non-empty legacy and CodeWide state roots: {} and {}",
            legacy.display(),
            current.display()
        ),
    ))
}

fn migrate_root(
    legacy: &Path,
    current: &Path,
    kind: RootKind,
    report: &mut StateMigrationReport,
) -> io::Result<()> {
    if symlink_points_to(legacy, current)? {
        report.unchanged.push(current.display().to_string());
        return Ok(());
    }
    if !legacy.exists() {
        if current.exists() {
            report.unchanged.push(current.display().to_string());
        }
        return Ok(());
    }
    if current.exists() {
        let disposable = match kind {
            RootKind::Config => disposable_config_root(current)?,
            RootKind::State => directory_is_empty(current)?,
        };
        if !disposable {
            return Err(io::Error::new(
                io::ErrorKind::AlreadyExists,
                format!(
                    "refusing to merge non-empty legacy and CodeWide state roots: {} and {}",
                    legacy.display(),
                    current.display()
                ),
            ));
        }
        fs::remove_dir_all(current)?;
    }
    let parent = current
        .parent()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "state root has no parent"))?;
    fs::create_dir_all(parent)?;
    fs::rename(legacy, current)?;
    fs::set_permissions(current, fs::Permissions::from_mode(0o700))?;
    symlink(current, legacy)?;
    report
        .migrated
        .push(format!("{} -> {}", legacy.display(), current.display()));
    report.aliases_created.push(legacy.display().to_string());
    Ok(())
}

fn symlink_points_to(legacy: &Path, current: &Path) -> io::Result<bool> {
    let metadata = match fs::symlink_metadata(legacy) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(false),
        Err(error) => return Err(error),
    };
    if !metadata.file_type().is_symlink() {
        return Ok(false);
    }
    let target = fs::read_link(legacy)?;
    let resolved = if target.is_absolute() {
        target
    } else {
        legacy
            .parent()
            .unwrap_or_else(|| Path::new("."))
            .join(target)
    };
    Ok(resolved == current)
}

fn directory_is_empty(path: &Path) -> io::Result<bool> {
    Ok(fs::read_dir(path)?.next().transpose()?.is_none())
}

fn disposable_config_root(path: &Path) -> io::Result<bool> {
    for entry in fs::read_dir(path)? {
        let entry = entry?;
        match entry.file_name().to_string_lossy().as_ref() {
            "attachments" if entry.file_type()?.is_dir() && directory_is_empty(&entry.path())? => {}
            "preview-files.json" if empty_preview_registry(&entry.path())? => {}
            _ => return Ok(false),
        }
    }
    Ok(true)
}

fn empty_preview_registry(path: &Path) -> io::Result<bool> {
    let value: serde_json::Value = serde_json::from_slice(&fs::read(path)?)
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
    Ok(
        value.get("version").and_then(serde_json::Value::as_u64) == Some(1)
            && value
                .get("files")
                .and_then(serde_json::Value::as_array)
                .is_some_and(Vec::is_empty),
    )
}

fn validate_private_file(path: &Path) -> io::Result<()> {
    let metadata = fs::metadata(path).map_err(|error| {
        io::Error::new(
            error.kind(),
            format!(
                "required migrated file {} is unavailable: {error}",
                path.display()
            ),
        )
    })?;
    if !metadata.is_file() || metadata.len() == 0 {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            format!("required migrated file {} is empty", path.display()),
        ));
    }
    if metadata.permissions().mode() & 0o077 != 0 {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            format!("{} must not be group/world accessible", path.display()),
        ));
    }
    Ok(())
}
