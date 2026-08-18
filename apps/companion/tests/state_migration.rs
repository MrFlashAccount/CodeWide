#![allow(clippy::unwrap_used)]

use std::{fs, os::unix::fs::PermissionsExt};

use codewide_companion::state_migration::{StateMigrationPaths, migrate_legacy_installation};
use tempfile::tempdir;

#[test]
fn atomically_moves_legacy_state_and_keeps_rollback_aliases() {
    let root = tempdir().unwrap();
    let paths = paths(root.path());
    fs::create_dir_all(&paths.legacy_config_root).unwrap();
    fs::set_permissions(&paths.legacy_config_root, fs::Permissions::from_mode(0o700)).unwrap();
    fs::write(paths.legacy_config_root.join("host.token"), "x".repeat(43)).unwrap();
    fs::write(paths.legacy_config_root.join("devices.json"), "{}").unwrap();
    set_private(&paths.legacy_config_root.join("host.token"));
    set_private(&paths.legacy_config_root.join("devices.json"));
    fs::create_dir_all(paths.current_config_root.join("attachments")).unwrap();
    fs::write(
        paths.current_config_root.join("preview-files.json"),
        r#"{"version":1,"files":[]}"#,
    )
    .unwrap();
    fs::create_dir_all(&paths.legacy_state_root).unwrap();
    fs::write(paths.legacy_state_root.join("state.redb"), "state").unwrap();

    let report = migrate_legacy_installation(&paths).unwrap();

    assert_eq!(report.migrated.len(), 2);
    assert_eq!(
        fs::read(paths.current_state_root.join("state.redb")).unwrap(),
        b"state"
    );
    assert!(
        fs::symlink_metadata(&paths.legacy_config_root)
            .unwrap()
            .file_type()
            .is_symlink()
    );
    assert!(
        fs::symlink_metadata(&paths.legacy_state_root)
            .unwrap()
            .file_type()
            .is_symlink()
    );
    let repeated = migrate_legacy_installation(&paths).unwrap();
    assert!(repeated.migrated.is_empty());
}

#[test]
fn refuses_to_merge_two_non_empty_state_roots() {
    let root = tempdir().unwrap();
    let paths = paths(root.path());
    fs::create_dir_all(&paths.legacy_config_root).unwrap();
    fs::write(paths.legacy_config_root.join("host.token"), "x".repeat(43)).unwrap();
    fs::write(paths.legacy_config_root.join("devices.json"), "{}").unwrap();
    set_private(&paths.legacy_config_root.join("host.token"));
    set_private(&paths.legacy_config_root.join("devices.json"));
    fs::create_dir_all(&paths.current_config_root).unwrap();
    fs::write(paths.current_config_root.join("host.token"), "different").unwrap();

    let error = migrate_legacy_installation(&paths).unwrap_err();
    assert_eq!(error.kind(), std::io::ErrorKind::AlreadyExists);
    assert!(paths.legacy_config_root.join("devices.json").exists());
}

#[test]
fn device_registry_is_optional_before_first_pairing() {
    let root = tempdir().unwrap();
    let paths = paths(root.path());
    fs::create_dir_all(&paths.current_config_root).unwrap();
    fs::write(paths.current_config_root.join("host.token"), "x".repeat(43)).unwrap();
    set_private(&paths.current_config_root.join("host.token"));

    let report = migrate_legacy_installation(&paths).unwrap();

    assert!(report.migrated.is_empty());
    assert!(!paths.current_config_root.join("devices.json").exists());
}

#[test]
fn preflights_every_root_before_moving_any_state() {
    let root = tempdir().unwrap();
    let paths = paths(root.path());
    fs::create_dir_all(&paths.legacy_config_root).unwrap();
    fs::write(paths.legacy_config_root.join("host.token"), "x".repeat(43)).unwrap();
    fs::write(paths.legacy_config_root.join("devices.json"), "{}").unwrap();
    set_private(&paths.legacy_config_root.join("host.token"));
    set_private(&paths.legacy_config_root.join("devices.json"));
    fs::create_dir_all(&paths.legacy_shadow_root).unwrap();
    fs::write(paths.legacy_shadow_root.join("state.redb"), "legacy").unwrap();
    fs::create_dir_all(&paths.current_shadow_root).unwrap();
    fs::write(paths.current_shadow_root.join("state.redb"), "current").unwrap();

    let error = migrate_legacy_installation(&paths).unwrap_err();

    assert_eq!(error.kind(), std::io::ErrorKind::AlreadyExists);
    assert!(paths.legacy_config_root.join("host.token").exists());
    assert!(!paths.current_config_root.exists());
}

fn set_private(path: &std::path::Path) {
    fs::set_permissions(path, fs::Permissions::from_mode(0o600)).unwrap();
}

fn paths(root: &std::path::Path) -> StateMigrationPaths {
    StateMigrationPaths {
        legacy_config_root: root.join(".codex-remote"),
        current_config_root: root.join(".codewide"),
        legacy_state_root: root.join("state/codex-remote-rust"),
        current_state_root: root.join("state/codewide-rust"),
        legacy_shadow_root: root.join("state/codex-remote-rust-shadow"),
        current_shadow_root: root.join("state/codewide-rust-shadow"),
    }
}
