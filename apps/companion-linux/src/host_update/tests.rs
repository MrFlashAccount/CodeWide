use super::*;

fn operation(id: &str, key: &str, sequence: u64, phase: HostUpdatePhase) -> OperationRecord {
    OperationRecord {
        journal: HostUpdateJournalV1 {
            journal_version: 1,
            operation_id: id.to_owned(),
            nonce: "fence_00000000000000000000".to_owned(),
            initiating_device_id: "device_0000000000000000000".to_owned(),
            current_digest: "a".repeat(64),
            target_digest: "b".repeat(64),
            target_fingerprint: "c".repeat(64),
            pre_update_relay: HostUpdateRelayState {
                configured: true,
                enabled: true,
                upstream_live: true,
            },
            deadlines: HostUpdateDeadlines {
                install_by: 2,
                target_ready_by: 3,
                reconnect_by: 4,
                rollback_by: 5,
            },
            phase,
            started_at: 1,
            restart_started_at: None,
            updated_at: 1,
            error_code: None,
            error_message: None,
        },
        idempotency_key: key.to_owned(),
        current: GenerationMetadataV1 {
            schema_version: 1,
            version: "1.0.0".to_owned(),
            build: "old".to_owned(),
            source_revision: "a".repeat(40),
            artifact_digest: "a".repeat(64),
        },
        target: ReleaseTargetV1 {
            platform: HostPlatform::LinuxX86_64,
            version: "1.1.0".to_owned(),
            build: "new".to_owned(),
            source_revision: "b".repeat(40),
            artifact_url:
                "https://github.com/MrFlashAccount/CodeWide/releases/download/v1.1.0/update.tar.gz"
                    .to_owned(),
            sha256: "b".repeat(64),
            bootstrap_version: 1,
            journal_version: 1,
            state_epoch: 1,
            rollback_compatible_from: vec!["a".repeat(64)],
        },
        release_sequence: sequence,
        identity_pin: "d".repeat(64),
        identity_manifest: PathBuf::from("/tmp/codewide-test-identity.json"),
        previous_generation: format!("generations/{}", "a".repeat(64)),
    }
}

#[test]
fn flat_mutable_install_requires_manual_bootstrap() {
    let directory = tempfile::tempdir().expect("temporary directory");
    fs::write(directory.path().join("codewide-companion"), b"legacy").expect("legacy binary");
    let guardian = LinuxHostUpdateGuardian::with_trust(
        directory.path().to_path_buf(),
        directory.path().join("host-update-state"),
        Some(test_trust()),
    );
    assert_eq!(
        guardian.capability().unavailable_reason.as_deref(),
        Some("manual_bootstrap_required")
    );
}

#[test]
fn build_without_embedded_trust_is_not_remotely_updatable() {
    let directory = tempfile::tempdir().expect("temporary directory");
    install_generation(directory.path());
    let guardian = LinuxHostUpdateGuardian::with_trust(
        directory.path().to_path_buf(),
        directory.path().join("host-update-state"),
        None,
    );
    let capability = guardian.capability();
    assert!(!capability.apply_supported);
    assert_eq!(
        capability.unavailable_reason.as_deref(),
        Some("unofficial_build")
    );
}

#[test]
fn embedded_trust_needs_only_the_installed_guardian_not_an_installer_config() {
    let directory = tempfile::tempdir().expect("temporary directory");
    install_generation(directory.path());
    assert!(!directory.path().join("bootstrap/config.json").exists());
    let guardian = LinuxHostUpdateGuardian::with_trust(
        directory.path().to_path_buf(),
        directory.path().join("host-update-state"),
        Some(test_trust()),
    );
    let capability = guardian.capability();
    assert!(capability.apply_supported);
    assert_eq!(capability.unavailable_reason, None);
}

fn test_trust() -> ReleaseTrust {
    ReleaseTrust {
        key_id: "test-key".to_owned(),
        public_key_spki: "dGVzdA==".to_owned(),
    }
}

/// Lays out the guardian and one immutable generation exactly as the installer does.
fn install_generation(root: &std::path::Path) {
    use std::os::unix::fs::PermissionsExt as _;
    let digest = "c".repeat(64);
    let bootstrap = root.join("bootstrap");
    fs::create_dir_all(&bootstrap).expect("bootstrap directory");
    fs::set_permissions(&bootstrap, fs::Permissions::from_mode(0o700)).expect("bootstrap mode");
    let guardian = bootstrap.join("codewide-companion-update-guardian");
    fs::write(&guardian, b"guardian").expect("guardian binary");
    fs::set_permissions(&guardian, fs::Permissions::from_mode(0o755)).expect("guardian mode");
    let generation = root.join("generations").join(&digest);
    fs::create_dir_all(&generation).expect("generation directory");
    store::write_json(
        &generation.join("metadata.json"),
        &GenerationMetadataV1 {
            schema_version: 1,
            version: "1.0.0".to_owned(),
            build: "build".to_owned(),
            source_revision: "d".repeat(40),
            artifact_digest: digest.clone(),
        },
    )
    .expect("generation metadata");
    std::os::unix::fs::symlink(format!("generations/{digest}"), root.join("current"))
        .expect("current generation");
}

#[test]
fn idempotency_and_sequence_survive_guardian_restart() {
    let directory = tempfile::tempdir().expect("temporary directory");
    let state = directory.path().join("bootstrap/state");
    let record = operation(
        "upd_00000000000000000000000000000000",
        "idem_00000000000000000000",
        42,
        HostUpdatePhase::RolledBack,
    );
    store::write_json(
        &state
            .join("operations")
            .join(format!("{}.json", record.journal.operation_id)),
        &record,
    )
    .expect("operation journal");
    let guardian = LinuxHostUpdateGuardian::new(
        directory.path().to_path_buf(),
        state.clone(),
        "pin".to_owned(),
        HostUpdateRelayState {
            configured: false,
            enabled: false,
            upstream_live: false,
        },
    );
    assert_eq!(guardian.highest_sequence().expect("sequence"), 42);
    assert_eq!(
        find_idempotency(&state, "idem_00000000000000000000")
            .expect("idempotency lookup")
            .expect("stored operation")
            .journal
            .operation_id,
        record.journal.operation_id
    );
}

#[test]
fn incompatible_guardian_state_or_rollback_requires_manual_update() {
    for error in [
        ReleaseAdmissionError::UnsupportedGuardianContract,
        ReleaseAdmissionError::IncompatibleStateEpoch,
        ReleaseAdmissionError::RollbackIncompatible,
    ] {
        let mapped = admission_error(error);
        assert_eq!(mapped.code, GuardianErrorCode::ManualUpdateRequired);
        assert_eq!(mapped.message, "manual_update_required");
    }
    assert_eq!(
        admission_error(ReleaseAdmissionError::Replay).code,
        GuardianErrorCode::PreconditionFailed
    );
}
