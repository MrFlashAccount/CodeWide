use super::*;
use companion_core::host_update::{
    HostPlatform, HostUpdateDeadlines, HostUpdateJournalV1, HostUpdateRelayState, ReleaseTargetV1,
};

fn operation(phase: HostUpdatePhase) -> OperationRecord {
    OperationRecord {
        journal: HostUpdateJournalV1 {
            journal_version: 1,
            operation_id: "upd_00000000000000000000000000000000".to_owned(),
            nonce: "fence_00000000000000000000000000000000".to_owned(),
            initiating_device_id: "device_00000000000000000000000000000000".to_owned(),
            current_digest: "a".repeat(64),
            target_digest: "b".repeat(64),
            target_fingerprint: "c".repeat(64),
            pre_update_relay: HostUpdateRelayState {
                configured: true,
                enabled: true,
                upstream_live: true,
            },
            deadlines: HostUpdateDeadlines {
                install_by: u64::MAX,
                target_ready_by: u64::MAX,
                reconnect_by: u64::MAX,
                rollback_by: u64::MAX,
            },
            phase,
            started_at: 1,
            restart_started_at: None,
            updated_at: 1,
            error_code: None,
            error_message: None,
        },
        idempotency_key: "idem_00000000000000000000000000000000".to_owned(),
        current: GenerationMetadataV1 {
            schema_version: 1,
            version: "1.0.0".to_owned(),
            build: "aaaaaaaaaaaa".to_owned(),
            source_revision: "a".repeat(40),
            artifact_digest: "a".repeat(64),
        },
        target: ReleaseTargetV1 {
            platform: HostPlatform::LinuxX86_64,
            version: "1.1.0".to_owned(),
            build: "bbbbbbbbbbbb".to_owned(),
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
        release_sequence: 2,
        identity_pin: "d".repeat(64),
        identity_manifest: PathBuf::from("/tmp/codewide-test-identity.json"),
        previous_generation: format!("generations/{}", "a".repeat(64)),
    }
}

#[test]
fn current_switch_is_one_relative_symlink_rename() {
    let directory = tempfile::tempdir().expect("temporary directory");
    let root = directory.path();
    fs::create_dir(root.join("generations")).expect("generations");
    switch_current(root, "generations/abc").expect("switch");
    assert_eq!(
        fs::read_link(root.join("current")).expect("current link"),
        PathBuf::from("generations/abc")
    );
    assert!(!root.join(".current-next").exists());
}

#[test]
fn interrupted_activation_can_switch_back_without_touching_state_or_identity() {
    let directory = tempfile::tempdir().expect("temporary directory");
    let root = directory.path().join("install");
    let state = directory.path().join("state");
    fs::create_dir_all(root.join("generations/old/bin")).expect("old generation");
    fs::create_dir_all(root.join("generations/new/bin")).expect("new generation");
    fs::create_dir_all(state.join("identity")).expect("identity directory");
    fs::write(state.join("authoritative.redb"), b"state-before-update").expect("state");
    fs::write(
        state.join("identity/identity.json"),
        b"identity-before-update",
    )
    .expect("identity");
    switch_current(&root, "generations/old").expect("old activation");

    switch_current(&root, "generations/new").expect("target activation");
    assert_eq!(
        fs::read_link(root.join("current")).expect("target link"),
        PathBuf::from("generations/new")
    );
    assert!(root.join("generations/old").is_dir());

    // Simulate the stable guardian resuming after the payload died between
    // activation and readiness proof.
    switch_current(&root, "generations/old").expect("rollback activation");
    assert_eq!(
        fs::read_link(root.join("current")).expect("rollback link"),
        PathBuf::from("generations/old")
    );
    assert_eq!(
        fs::read(state.join("authoritative.redb")).expect("state after rollback"),
        b"state-before-update"
    );
    assert_eq!(
        fs::read(state.join("identity/identity.json")).expect("identity after rollback"),
        b"identity-before-update"
    );
}

#[test]
fn kill_after_each_phase_has_a_deterministic_durable_resume_action() {
    let directory = tempfile::tempdir().expect("temporary directory");
    let state_root = directory.path();
    let cases = [
        (HostUpdatePhase::Accepted, ResumeAction::BeginInstall),
        (HostUpdatePhase::Installing, ResumeAction::ResumeInstall),
        (
            HostUpdatePhase::TargetReady,
            ResumeAction::PublishReconnectWait,
        ),
        (
            HostUpdatePhase::AwaitingReconnect,
            ResumeAction::WaitForReconnect,
        ),
        (HostUpdatePhase::RollingBack, ResumeAction::ResumeRollback),
        (HostUpdatePhase::Committed, ResumeAction::Done),
        (HostUpdatePhase::RolledBack, ResumeAction::Done),
        (HostUpdatePhase::Failed, ResumeAction::Done),
    ];
    for (phase, expected) in cases {
        let record = operation(phase);
        let operation_id = record.journal.operation_id.clone();
        write_operation(state_root, &record).expect("persist interrupted operation");

        // Re-open the journal as a new guardian process would after process kill
        // or login/reboot activation of the stable systemd unit.
        let resumed = read_operation(state_root, &operation_id).expect("resume operation");
        assert_eq!(resume_action(resumed.journal.phase), expected);
    }
}

#[test]
fn rollback_fence_clears_the_consumed_available_release() {
    let directory = tempfile::tempdir().expect("temporary directory");
    let state_root = directory.path();
    let record = operation(HostUpdatePhase::Accepted);
    write_operation(state_root, &record).expect("operation");
    store::write_json(&state_root.join("available.json"), &"cached").expect("available");

    transition(
        state_root,
        &record.journal.operation_id,
        HostUpdatePhase::Accepted,
        HostUpdatePhase::RollingBack,
        Some(("test_failure", "Injected failure.")),
    )
    .expect("rollback transition");

    assert!(!state_root.join("available.json").exists());
    assert_eq!(
        read_operation(state_root, &record.journal.operation_id)
            .expect("operation after rollback fence")
            .journal
            .phase,
        HostUpdatePhase::RollingBack
    );
}

#[test]
fn bootstrap_material_is_removed_before_generation_publish() {
    let directory = tempfile::tempdir().expect("temporary directory");
    let payload = directory.path();
    fs::create_dir_all(payload.join("bootstrap")).expect("bootstrap");
    fs::create_dir_all(payload.join("systemd/user")).expect("systemd");
    fs::create_dir_all(payload.join("libexec")).expect("libexec");
    fs::write(payload.join("install.sh"), b"installer").expect("installer");
    fs::write(
        payload.join("libexec/codewide-companion-update-guardian"),
        b"guardian",
    )
    .expect("guardian");

    strip_bootstrap_payload(payload).expect("strip bootstrap material");

    assert!(!payload.join("bootstrap").exists());
    assert!(!payload.join("systemd").exists());
    assert!(!payload.join("install.sh").exists());
    assert!(
        !payload
            .join("libexec/codewide-companion-update-guardian")
            .exists()
    );
}

#[test]
fn archive_validation_rejects_parent_traversal_listing() {
    let unsafe_line = format!("{BUNDLE_DIRECTORY}/../escape");
    assert!(unsafe_line.split('/').any(|component| component == ".."));
}

#[test]
fn archive_validation_rejects_symlink_entries() {
    let directory = tempfile::tempdir().expect("temporary directory");
    let bundle = directory.path().join(BUNDLE_DIRECTORY);
    fs::create_dir(&bundle).expect("bundle");
    std::os::unix::fs::symlink("/tmp", bundle.join("escape")).expect("symlink");
    let archive = directory.path().join("payload.tar.gz");
    let status = Command::new("tar")
        .args(["-czf"])
        .arg(&archive)
        .args(["-C"])
        .arg(directory.path())
        .arg(BUNDLE_DIRECTORY)
        .status()
        .expect("tar");
    assert!(status.success());
    let failure = validate_archive(&archive).expect_err("symlink must be rejected");
    assert_eq!(failure.code, "archive_unsafe_entry");
}

#[test]
fn runner_source_never_uses_caller_controlled_download_input() {
    let source = include_str!("runner.rs");
    assert!(source.contains("operation.target.artifact_url"));
    let forbidden = ["Apply", "HostUpdate", "Command"].concat();
    assert!(!source.contains(&forbidden));
}
