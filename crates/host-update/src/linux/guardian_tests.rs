use super::*;
use crate::linux::outcome::TERMINAL_OUTCOME_TTL_MS;
use crate::linux::test_support::{TEST_PRODUCT, guardian as test_guardian};
use crate::{HostPlatform, ReleaseTargetV1};

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
        release: None,
        artifact_size: None,
        activation_admitted: None,
        activation_target: None,
        progress: None,
        recovery_error: None,
    }
}

#[test]
fn flat_mutable_install_requires_manual_bootstrap() {
    let directory = tempfile::tempdir().expect("temporary directory");
    fs::write(directory.path().join("codewide-companion"), b"legacy").expect("legacy binary");
    let guardian = test_guardian(
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
    let guardian = test_guardian(
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
    let guardian = test_guardian(
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
    let guardian = bootstrap.join(TEST_PRODUCT.bootstrap_guardian);
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
    let guardian = test_guardian(directory.path().to_path_buf(), state.clone(), None);
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
fn preparation_failure_does_not_consume_the_release_sequence() {
    let directory = tempfile::tempdir().expect("temporary directory");
    let state = directory.path().join("bootstrap/state");
    let mut rejected = operation(
        "upd_00000000000000000000000000000000",
        "idem_00000000000000000000",
        42,
        HostUpdatePhase::Failed,
    );
    rejected.activation_admitted = Some(false);
    store::write_json(
        &state
            .join("operations")
            .join(format!("{}.json", rejected.journal.operation_id)),
        &rejected,
    )
    .expect("operation journal");
    let guardian = test_guardian(directory.path().to_path_buf(), state.clone(), None);
    assert_eq!(guardian.highest_sequence().expect("sequence"), 0);

    rejected.activation_admitted = Some(true);
    store::write_json(
        &state
            .join("operations")
            .join(format!("{}.json", rejected.journal.operation_id)),
        &rejected,
    )
    .expect("admitted operation journal");
    assert_eq!(guardian.highest_sequence().expect("sequence"), 42);
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

/// Digest of the generation laid out by [`install_generation`].
fn installed_digest() -> String {
    "c".repeat(64)
}

/// A failure recorded against the installed generation at `updated_at`.
fn failure_of_installed(updated_at: u64) -> OperationRecord {
    let mut record = operation(
        "upd_00000000000000000000000000000000",
        "idem_00000000000000000000",
        42,
        HostUpdatePhase::Failed,
    );
    record.journal.current_digest = installed_digest();
    record.journal.updated_at = updated_at;
    record.journal.error_code = Some("download_failed".to_owned());
    record.journal.error_message = Some("The signed update could not be downloaded.".to_owned());
    record
}

/// Persists `record` and points `active.json` at it, as apply does.
fn point_at(state: &Path, record: &OperationRecord) {
    store::write_json(
        &state
            .join("operations")
            .join(format!("{}.json", record.journal.operation_id)),
        record,
    )
    .expect("journal");
    store::write_json(&state.join("active.json"), &record.journal.operation_id).expect("pointer");
}

/// Installs one generation, points at `record` and returns the reported operation.
async fn reported_after_restart(
    root: &Path,
    record: &OperationRecord,
) -> (LinuxHostUpdateGuardian, Option<HostUpdateOperation>) {
    install_generation(root);
    let state = root.join("host-update-state");
    point_at(&state, record);
    let guardian = test_guardian(root.to_path_buf(), state, Some(test_trust()));
    let status = guardian
        .status()
        .await
        .expect("status after process restart");
    (guardian, status.active_operation)
}

#[tokio::test]
async fn recent_relevant_outcome_and_lost_acceptance_survive_restart_without_a_cached_release() {
    let directory = tempfile::tempdir().expect("temporary directory");
    let record = failure_of_installed(unix_millis());
    let (guardian, reported) = reported_after_restart(directory.path(), &record).await;
    let outcome = reported.expect("retained terminal outcome");
    assert_eq!(outcome.phase, HostUpdatePhase::Failed);
    assert_eq!(outcome.error_code.as_deref(), Some("download_failed"));
    let replay = guardian
        .apply(ApplyHostUpdateCommand {
            target_fingerprint: record.journal.target_fingerprint.clone(),
            idempotency_key: record.idempotency_key.clone(),
            initiating_device_id: record.journal.initiating_device_id.clone(),
        })
        .await
        .expect("recover lost 202 after terminal failure");
    assert_eq!(replay.operation_id, outcome.operation_id);
    assert_eq!(
        guardian
            .operation(&replay.operation_id)
            .await
            .expect("durable result")
            .error_code,
        outcome.error_code
    );
}

#[tokio::test]
async fn expired_outcome_is_dropped_and_its_pointer_removed_but_stays_readable_by_id() {
    let directory = tempfile::tempdir().expect("temporary directory");
    let record = failure_of_installed(unix_millis() - TERMINAL_OUTCOME_TTL_MS - 60_000);
    let (guardian, reported) = reported_after_restart(directory.path(), &record).await;
    assert_eq!(reported, None);
    assert!(
        !directory
            .path()
            .join("host-update-state/active.json")
            .exists()
    );
    let replay = guardian
        .apply(ApplyHostUpdateCommand {
            target_fingerprint: record.journal.target_fingerprint.clone(),
            idempotency_key: record.idempotency_key.clone(),
            initiating_device_id: record.journal.initiating_device_id.clone(),
        })
        .await
        .expect("idempotent replay after cleanup");
    assert_eq!(replay.operation_id, record.journal.operation_id);
}

#[tokio::test]
async fn outcome_of_a_replaced_generation_is_dropped_at_once() {
    let directory = tempfile::tempdir().expect("temporary directory");
    // A fresh rollback failure of 1.0.0 -> 1.1.0, after which a different
    // generation was installed manually.
    let mut record = failure_of_installed(unix_millis());
    record.journal.current_digest = "a".repeat(64);
    record.journal.error_code = Some("rollback_health_failed".to_owned());
    let (guardian, reported) = reported_after_restart(directory.path(), &record).await;
    assert_eq!(reported, None);
    assert!(
        !directory
            .path()
            .join("host-update-state/active.json")
            .exists()
    );
    assert_eq!(
        guardian
            .status()
            .await
            .expect("repeated status")
            .active_operation,
        None
    );
}

#[tokio::test]
async fn in_flight_operation_is_always_reported() {
    let directory = tempfile::tempdir().expect("temporary directory");
    // Neither generation is installed and the journal is old: in-flight state
    // is never subject to outcome retention.
    let record = operation(
        "upd_00000000000000000000000000000000",
        "idem_00000000000000000000",
        42,
        HostUpdatePhase::RollingBack,
    );
    let (_guardian, reported) = reported_after_restart(directory.path(), &record).await;
    assert_eq!(
        reported.expect("in-flight operation").phase,
        HostUpdatePhase::RollingBack
    );
    assert!(
        directory
            .path()
            .join("host-update-state/active.json")
            .exists()
    );
}

#[tokio::test]
async fn committed_outcome_is_retained_while_its_target_is_installed() {
    let directory = tempfile::tempdir().expect("temporary directory");
    let mut record = operation(
        "upd_00000000000000000000000000000000",
        "idem_00000000000000000000",
        42,
        HostUpdatePhase::Committed,
    );
    record.journal.target_digest = installed_digest();
    record.journal.updated_at = unix_millis();
    let (_guardian, reported) = reported_after_restart(directory.path(), &record).await;
    assert_eq!(
        reported.expect("committed outcome").phase,
        HostUpdatePhase::Committed
    );
}

#[tokio::test]
async fn pointer_to_a_missing_operation_is_removed_instead_of_failing_status() {
    let directory = tempfile::tempdir().expect("temporary directory");
    let root = directory.path();
    install_generation(root);
    let state = root.join("host-update-state");
    store::write_json(
        &state.join("active.json"),
        &"upd_00000000000000000000000000000000",
    )
    .expect("pointer");
    let guardian = test_guardian(root.to_path_buf(), state.clone(), Some(test_trust()));
    let status = guardian.status().await.expect("status");
    assert_eq!(status.active_operation, None);
    assert!(!state.join("active.json").exists());
}

#[tokio::test]
async fn status_never_offers_a_cached_target_that_is_not_newer_than_current() {
    let directory = tempfile::tempdir().expect("temporary directory");
    let root = directory.path();
    install_generation(root);
    let state = root.join("host-update-state");
    let guardian = test_guardian(root.to_path_buf(), state.clone(), Some(test_trust()));
    for (cached_version, offered) in [("1.0.1", true), ("1.0.0", false), ("0.9.9", false)] {
        let mut target = operation("upd_0", "idem_0", 1, HostUpdatePhase::Accepted).target;
        target.version = cached_version.to_owned();
        store::write_json(
            &state.join("available.json"),
            &CachedRelease {
                envelope: SignedReleaseDescriptor {
                    schema_version: 1,
                    key_id: "test-key".to_owned(),
                    algorithm: "ES256".to_owned(),
                    payload: "payload".to_owned(),
                    signature: "signature".to_owned(),
                },
                available: AvailableHostUpdate {
                    target,
                    target_fingerprint: "c".repeat(64),
                    release_sequence: 2,
                    expires_at: u64::MAX,
                },
            },
        )
        .expect("cached release");
        let status = guardian.status().await.expect("status");
        assert_eq!(
            status.available_target.is_some(),
            offered,
            "cached {cached_version}"
        );
    }
}

#[tokio::test]
async fn artifact_size_reads_the_head_content_length_header() {
    use tokio::io::{AsyncReadExt as _, AsyncWriteExt as _};
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("HTTP fixture");
    let address = listener.local_addr().expect("address");
    let server = tokio::spawn(async move {
        let (mut stream, _) = listener.accept().await.expect("request");
        let mut request = [0_u8; 1024];
        let mut request_bytes = 0;
        while !request[..request_bytes]
            .windows(4)
            .any(|end| end == b"\r\n\r\n")
        {
            let received = stream
                .read(&mut request[request_bytes..])
                .await
                .expect("read request");
            assert_ne!(received, 0, "request ended before complete HTTP headers");
            request_bytes += received;
        }
        assert!(request.starts_with(b"HEAD /artifact "));
        stream
            .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 52516144\r\nConnection: close\r\n\r\n")
            .await
            .expect("headers");
    });
    let size = artifact_size(&format!("http://{address}/artifact"))
        .await
        .expect("advertised size");
    server.await.expect("fixture completes");
    assert_eq!(size, 52_516_144);
}
