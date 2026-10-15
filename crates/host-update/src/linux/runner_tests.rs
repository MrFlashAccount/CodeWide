use super::*;
use crate::linux::{
    OperationRecord,
    test_support::{NeverHealthy, TEST_PRODUCT},
};
use crate::{
    HostPlatform, HostUpdateDeadlines, HostUpdateJournalV1, HostUpdateRelayState, ReleaseTargetV1,
};
use sha2::{Digest as _, Sha256};
use std::process::Command;

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
        release: None,
        artifact_size: None,
        activation_admitted: None,
        activation_target: None,
        progress: None,
        recovery_error: None,
    }
}

fn activation(record: &OperationRecord) -> ActivationRecord {
    serde_json::from_value(serde_json::to_value(record).expect("serialize product operation"))
        .expect("read narrow activation record")
}

fn persist_operation(state_root: &Path, record: &OperationRecord) {
    write_operation(state_root, &activation(record)).expect("persist operation");
}

fn read_product_operation(state_root: &Path, operation_id: &str) -> OperationRecord {
    store::read_json(
        &state_root
            .join("operations")
            .join(format!("{operation_id}.json")),
    )
    .expect("read product operation")
}

#[test]
fn a_target_that_exits_or_is_restarted_is_a_crash() {
    let started = ServiceState::parse("ActiveState=active\nNRestarts=4\n").expect("state");
    let still_starting =
        ServiceState::parse("NRestarts=4\nActiveState=activating\n").expect("state");
    assert!(!still_starting.crashed_since(&started));
    for crashed in [
        "ActiveState=activating\nNRestarts=5\n",
        "ActiveState=failed\nNRestarts=4\n",
        "ActiveState=inactive\nNRestarts=4\n",
    ] {
        let state = ServiceState::parse(crashed).expect("state");
        assert!(state.crashed_since(&started), "{crashed}");
    }
    assert_eq!(ServiceState::parse("ActiveState=active\n"), None);
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
fn activation_paths_accept_only_fixed_local_identifiers() {
    assert!(valid_operation_id("upd_00000000000000000000000000000000"));
    assert!(!valid_operation_id("../../other-operation"));
    let mut target =
        super::super::prepare::activation_target(&operation(HostUpdatePhase::Installing));
    assert!(valid_generation_identity(&target));
    target.artifact_digest = "../outside".to_owned();
    assert!(!valid_generation_identity(&target));
}

#[test]
fn activation_resumes_after_prepared_generation_was_already_published() {
    use std::os::unix::fs::PermissionsExt as _;

    let directory = tempfile::tempdir().expect("temporary directory");
    let root = directory.path();
    let operation = operation(HostUpdatePhase::Installing);
    let target = super::super::prepare::activation_target(&operation);
    let published = root.join("generations").join(&target.artifact_digest);
    fs::create_dir_all(published.join("bin")).expect("published generation");
    let executable = published.join("bin/codewide-companion");
    fs::write(&executable, b"published executable").expect("published executable");
    fs::set_permissions(&executable, fs::Permissions::from_mode(0o700)).expect("executable mode");
    store::write_json(&published.join("metadata.json"), &target).expect("published metadata");
    let runner = Runner {
        product: &TEST_PRODUCT.activation,
        health: &NeverHealthy,
        root,
        state_root: root,
        scope: SystemdScope::User,
    };

    runner
        .publish_prepared_generation(&operation.journal.operation_id, &target)
        .expect("resume after publication");
}

#[test]
fn activation_accepts_only_a_completed_local_preparation() {
    let directory = tempfile::tempdir().expect("temporary directory");
    let root = directory.path();
    let mut operation = operation(HostUpdatePhase::Installing);
    let generation = root
        .join("generations")
        .join(&operation.current.artifact_digest);
    fs::create_dir_all(&generation).expect("current generation");
    store::write_json(&generation.join("metadata.json"), &operation.current)
        .expect("current metadata");
    switch_current(
        root,
        &format!("generations/{}", operation.current.artifact_digest),
    )
    .expect("current link");

    let runner = Runner {
        product: &TEST_PRODUCT.activation,
        health: &NeverHealthy,
        root,
        state_root: root,
        scope: SystemdScope::User,
    };
    assert_eq!(
        runner
            .verify_activation_request(&activation(&operation))
            .expect_err("preparation was not admitted")
            .code,
        "activation_not_admitted"
    );
    operation.activation_admitted = Some(true);
    assert_eq!(
        runner
            .verify_activation_request(&activation(&operation))
            .expect_err("prepared target was not published")
            .code,
        "activation_target_missing"
    );
    operation.activation_target = Some(super::super::prepare::activation_target(&operation));
    runner
        .verify_activation_request(&activation(&operation))
        .expect("complete local preparation");

    let changed = root.join("generations/changed");
    fs::create_dir_all(&changed).expect("changed generation");
    store::write_json(&changed.join("metadata.json"), &operation.current)
        .expect("changed metadata");
    switch_current(root, "generations/changed").expect("changed current link");
    assert_eq!(
        runner
            .verify_activation_request(&activation(&operation))
            .expect_err("current generation changed")
            .code,
        "current_generation_changed"
    );
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
        persist_operation(state_root, &record);

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
    persist_operation(state_root, &record);
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

    super::super::prepare::strip_bootstrap_payload(&TEST_PRODUCT, payload)
        .expect("strip bootstrap material");

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
    let unsafe_line = format!("{}/../escape", TEST_PRODUCT.bundle_directory);
    assert!(unsafe_line.split('/').any(|component| component == ".."));
}

#[test]
fn archive_validation_rejects_symlink_entries() {
    let directory = tempfile::tempdir().expect("temporary directory");
    let bundle = directory.path().join(TEST_PRODUCT.bundle_directory);
    fs::create_dir(&bundle).expect("bundle");
    std::os::unix::fs::symlink("/tmp", bundle.join("escape")).expect("symlink");
    let archive = directory.path().join("payload.tar.gz");
    let status = Command::new("tar")
        .args(["-czf"])
        .arg(&archive)
        .args(["-C"])
        .arg(directory.path())
        .arg(TEST_PRODUCT.bundle_directory)
        .status()
        .expect("tar");
    assert!(status.success());
    let failure = super::super::prepare::validate_archive(&TEST_PRODUCT, &archive)
        .expect_err("symlink must be rejected");
    assert_eq!(failure.code, "archive_unsafe_entry");
}

#[test]
fn runner_source_has_no_release_delivery_or_package_logic() {
    let source = include_str!("runner.rs");
    for forbidden in [
        "artifact_url",
        "ReleaseTargetV1",
        "SignedReleaseDescriptor",
        "reqwest",
        "tar.gz",
        "validate_archive",
        "verify_file_digest",
    ] {
        assert!(!source.contains(forbidden), "runner contains {forbidden}");
    }
    assert!(source.contains("activation_target"));
}

#[tokio::test]
async fn missing_prepared_generation_fails_without_restarting_the_current_server() {
    let directory = tempfile::tempdir().expect("temporary directory");
    let root = directory.path().join("install");
    let state = directory.path().join("state");
    fs::create_dir_all(&root).expect("install root");
    let mut record = operation(HostUpdatePhase::Installing);
    let old = root.join(&record.previous_generation);
    fs::create_dir_all(&old).expect("old generation");
    store::write_json(&old.join("metadata.json"), &record.current).expect("old metadata");
    switch_current(&root, &record.previous_generation).expect("old current");
    record.activation_admitted = Some(true);
    record.activation_target = Some(super::super::prepare::activation_target(&record));
    persist_operation(&state, &record);
    store::write_json(&state.join("active.json"), &record.journal.operation_id).expect("pointer");
    store::write_json(
        &state.join("activation-request.json"),
        &record.journal.operation_id,
    )
    .expect("request");
    run_pending(
        &TEST_PRODUCT.activation,
        &NeverHealthy,
        root.clone(),
        state.clone(),
        SystemdScope::User,
    )
    .await
    .expect("runner");
    let outcome = read_operation(&state, &record.journal.operation_id).expect("durable outcome");
    assert_eq!(outcome.journal.phase, HostUpdatePhase::Failed);
    assert_eq!(
        outcome.journal.error_code.as_deref(),
        Some("generation_collision")
    );
    assert!(outcome.journal.restart_started_at.is_none());
    assert_eq!(
        fs::read_link(root.join("current")).expect("unchanged current"),
        PathBuf::from(&record.previous_generation)
    );
    run_pending(
        &TEST_PRODUCT.activation,
        &NeverHealthy,
        root,
        state,
        SystemdScope::User,
    )
    .await
    .expect("terminal resume is inert");
}

#[tokio::test]
async fn terminal_operation_clears_a_persisted_activation_request() {
    let directory = tempfile::tempdir().expect("temporary directory");
    let root = directory.path().join("install");
    let state = directory.path().join("state");
    let record = operation(HostUpdatePhase::Committed);
    persist_operation(&state, &record);
    store::write_json(&state.join("active.json"), &record.journal.operation_id).expect("pointer");
    store::write_json(
        &state.join("activation-request.json"),
        &record.journal.operation_id,
    )
    .expect("request");

    run_pending(
        &TEST_PRODUCT.activation,
        &NeverHealthy,
        root,
        state.clone(),
        SystemdScope::User,
    )
    .await
    .expect("terminal cleanup");

    assert!(!state.join("activation-request.json").exists());
}

#[test]
fn recovery_failure_preserves_the_install_failure_after_reopening() {
    let directory = tempfile::tempdir().expect("temporary directory");
    let state = directory.path();
    let record = operation(HostUpdatePhase::Installing);
    persist_operation(state, &record);
    transition(
        state,
        &record.journal.operation_id,
        HostUpdatePhase::Installing,
        HostUpdatePhase::RollingBack,
        Some((
            "target_health_timeout",
            "The updated Companion did not become healthy.",
        )),
    )
    .expect("rollback");
    transition(
        state,
        &record.journal.operation_id,
        HostUpdatePhase::RollingBack,
        HostUpdatePhase::Failed,
        Some((
            "rollback_health_failed",
            "The previous Companion did not recover.",
        )),
    )
    .expect("failure");
    let reopened = read_operation(state, &record.journal.operation_id).expect("reopen");
    assert_eq!(
        reopened.journal.error_code.as_deref(),
        Some("target_health_timeout")
    );
    assert_eq!(
        reopened.recovery_error.as_deref(),
        Some("rollback_health_failed")
    );
    let product = read_product_operation(state, &record.journal.operation_id);
    let view = super::super::guardian::operation_view(&product);
    assert!(
        view.error_message
            .expect("message")
            .contains("Recovery also failed: rollback_health_failed")
    );
}

#[test]
fn download_progress_survives_reopening_and_cannot_overwrite_a_terminal_outcome() {
    let directory = tempfile::tempdir().expect("temporary directory");
    let state = directory.path();
    let record = operation(HostUpdatePhase::Installing);
    persist_operation(state, &record);
    let progress = HostUpdateProgress::Downloading {
        downloaded_bytes: 512,
        total_bytes: Some(1024),
    };
    report_progress(state, &record.journal.operation_id, progress.clone()).expect("progress");
    assert_eq!(
        read_product_operation(state, &record.journal.operation_id).progress,
        Some(progress)
    );
    transition(
        state,
        &record.journal.operation_id,
        HostUpdatePhase::Installing,
        HostUpdatePhase::Failed,
        Some(("download_failed", "The update download was interrupted.")),
    )
    .expect("failure");
    assert!(
        report_progress(
            state,
            &record.journal.operation_id,
            HostUpdateProgress::Verifying
        )
        .is_err()
    );
    assert_eq!(
        read_operation(state, &record.journal.operation_id)
            .expect("reopen terminal")
            .journal
            .phase,
        HostUpdatePhase::Failed
    );
}

#[tokio::test]
async fn interrupted_partial_download_is_replaced_and_progress_matches_received_bytes() {
    use tokio::io::{AsyncReadExt as _, AsyncWriteExt as _};
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("HTTP fixture");
    let address = listener.local_addr().expect("address");
    let body = b"complete signed artifact fixture";
    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        body.len()
    );
    let server = tokio::spawn(async move {
        let (mut stream, _) = listener.accept().await.expect("request");
        let mut request = [0_u8; 1024];
        let mut request_bytes = 0;
        loop {
            let received = stream
                .read(&mut request[request_bytes..])
                .await
                .expect("read request");
            assert_ne!(received, 0, "request ended before complete HTTP headers");
            request_bytes += received;
            if request[..request_bytes]
                .windows(4)
                .any(|end| end == b"\r\n\r\n")
            {
                break;
            }
            assert!(
                request_bytes < request.len(),
                "bounded fixture HTTP headers"
            );
        }
        stream
            .write_all(response.as_bytes())
            .await
            .expect("headers");
        stream.write_all(body).await.expect("body");
    });
    let directory = tempfile::tempdir().expect("temporary directory");
    let state = directory.path();
    let record = operation(HostUpdatePhase::Installing);
    persist_operation(state, &record);
    let archive = state.join("artifact.tar.gz");
    fs::write(
        archive.with_extension("partial"),
        b"incomplete obsolete bytes",
    )
    .expect("interrupted download");
    super::super::prepare::download(
        &format!("http://{address}/artifact"),
        &archive,
        body.len() as u64,
        state,
        &record.journal.operation_id,
    )
    .await
    .expect("download resumes");
    server.await.expect("fixture completes");
    let received = fs::read(&archive).expect("published download");
    super::super::prepare::verify_file_digest(&archive, &hex::encode(Sha256::digest(body)))
        .expect("complete artifact digest");
    let reopened = read_operation(state, &record.journal.operation_id).expect("reopen");
    assert_eq!(
        reopened.progress,
        Some(HostUpdateProgress::Downloading {
            downloaded_bytes: received.len() as u64,
            total_bytes: Some(body.len() as u64)
        })
    );
    assert!(!archive.with_extension("partial").exists());
}
