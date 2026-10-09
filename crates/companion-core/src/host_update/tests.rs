#![allow(clippy::expect_used)]

use super::*;
use p256::{
    ecdsa::{SigningKey, signature::Signer},
    pkcs8::EncodePublicKey,
};

fn signed_fixture(
    target_version: &str,
    sequence: u64,
    rollback_digest: &str,
) -> (SignedReleaseDescriptor, String, Vec<u8>) {
    let artifact = b"companion artifact".to_vec();
    let target = ReleaseTargetV1 {
        platform: HostPlatform::LinuxX86_64,
        version: target_version.to_owned(),
        build: "abc123".to_owned(),
        source_revision: "a".repeat(40),
        artifact_url: format!(
            "https://github.com/MrFlashAccount/CodeWide/releases/download/v{target_version}/companion.tar.gz"
        ),
        sha256: hex::encode(Sha256::digest(&artifact)),
        bootstrap_version: 1,
        journal_version: 1,
        state_epoch: 7,
        rollback_compatible_from: vec![rollback_digest.to_owned()],
    };
    let descriptor = ReleaseDescriptorV1 {
        schema_version: 1,
        channel: "stable".to_owned(),
        sequence,
        issued_at: 100,
        expires_at: 1_000,
        targets: vec![target],
    };
    let payload = serde_json::to_vec(&descriptor).expect("serialize fixture");
    let signing = SigningKey::random(&mut p256::elliptic_curve::rand_core::OsRng);
    let signature: Signature = signing.sign(&payload);
    let public_key = general_purpose::STANDARD.encode(
        signing
            .verifying_key()
            .to_public_key_der()
            .expect("encode key")
            .as_bytes(),
    );
    (
        SignedReleaseDescriptor {
            schema_version: 1,
            key_id: "release-v1".to_owned(),
            algorithm: "ES256".to_owned(),
            payload: general_purpose::URL_SAFE_NO_PAD.encode(payload),
            signature: general_purpose::STANDARD.encode(signature.to_der().as_bytes()),
        },
        public_key,
        artifact,
    )
}

fn installed(digest: &str) -> ReleaseAdmission<'_> {
    ReleaseAdmission {
        trusted_key_id: "release-v1",
        platform: HostPlatform::LinuxX86_64,
        current_version: "1.0.0",
        current_digest: digest,
        highest_sequence: 1,
        state_epoch: 7,
        bootstrap_version: 1,
        journal_version: 1,
    }
}

#[test]
fn machine_contract_matches_shared_v1_constants() {
    let contract: serde_json::Value =
        serde_json::from_str(include_str!("../../contract/host-update-v1.json"))
            .expect("parse host update contract");
    assert_eq!(contract["apiVersion"], HOST_UPDATE_API_VERSION);
    assert_eq!(
        contract["guardianContractVersion"],
        HOST_UPDATE_GUARDIAN_CONTRACT_VERSION
    );
    assert_eq!(contract["journalVersion"], HOST_UPDATE_JOURNAL_VERSION);
    assert_eq!(contract["bootstrapVersion"], HOST_UPDATE_BOOTSTRAP_VERSION);
    assert_eq!(contract["releaseEnvelope"]["algorithm"], "ES256");
    assert_eq!(
        contract["releaseSchemaVersion"],
        HOST_UPDATE_RELEASE_SCHEMA_VERSION
    );
    assert_eq!(
        contract["terminalPhases"],
        serde_json::json!(["committed", "rolledBack", "failed"])
    );
    assert!(
        contract["transitions"]
            .as_array()
            .expect("transition list")
            .contains(&serde_json::json!(["rollingBack", "failed"]))
    );
    assert_eq!(
        serde_json::to_value(HostPlatform::LinuxX86_64).expect("serialize platform"),
        "linux-x86-64"
    );
    assert_eq!(
        serde_json::to_value(HostPlatform::MacosUniversal).expect("serialize platform"),
        "macos-universal"
    );
    assert_eq!(
        serde_json::to_value(ApplyHostUpdateCommand {
            target_fingerprint: "a".repeat(64),
            idempotency_key: "019f0000-0000-7000-8000-000000000001".to_owned(),
            initiating_device_id: "device-a".to_owned(),
        })
        .expect("serialize apply command"),
        serde_json::json!({
            "targetFingerprint": "a".repeat(64),
            "idempotencyKey": "019f0000-0000-7000-8000-000000000001",
            "initiatingDeviceId": "device-a",
        })
    );
    assert_eq!(
        serde_json::to_value(ReconnectReceipt {
            operation_id: "019f0000-0000-7000-8000-000000000001".to_owned(),
            device_id: "device-a".to_owned(),
        })
        .expect("serialize reconnect receipt"),
        serde_json::json!({
            "operationId": "019f0000-0000-7000-8000-000000000001",
            "deviceId": "device-a",
        })
    );
}

#[test]
fn signed_release_rejects_tamper_unsigned_replay_downgrade_and_wrong_digest() {
    let current_digest = "b".repeat(64);
    let (envelope, key, artifact) = signed_fixture("1.1.0", 2, &current_digest);
    let (_, target, _) = admit_signed_release(&envelope, &key, 200, &installed(&current_digest))
        .expect("valid signed release");
    verify_artifact_digest(&target, &artifact).expect("matching artifact");
    assert_eq!(
        verify_artifact_digest(&target, b"tampered"),
        Err(ReleaseAdmissionError::WrongArtifactDigest)
    );

    let mut tampered = envelope.clone();
    let mut bytes = general_purpose::URL_SAFE_NO_PAD
        .decode(&tampered.payload)
        .expect("decode payload");
    bytes[0] ^= 1;
    tampered.payload = general_purpose::URL_SAFE_NO_PAD.encode(bytes);
    assert_eq!(
        admit_signed_release(&tampered, &key, 200, &installed(&current_digest)),
        Err(ReleaseAdmissionError::InvalidSignature)
    );

    let mut unsigned = envelope.clone();
    unsigned.signature.clear();
    assert_eq!(
        admit_signed_release(&unsigned, &key, 200, &installed(&current_digest)),
        Err(ReleaseAdmissionError::UnsupportedEnvelope)
    );

    let mut replayed = installed(&current_digest);
    replayed.highest_sequence = 2;
    assert_eq!(
        admit_signed_release(&envelope, &key, 200, &replayed),
        Err(ReleaseAdmissionError::Replay)
    );

    let (downgrade, downgrade_key, _) = signed_fixture("0.9.0", 3, &current_digest);
    assert_eq!(
        admit_signed_release(&downgrade, &downgrade_key, 200, &installed(&current_digest)),
        Err(ReleaseAdmissionError::Downgrade)
    );
}

#[test]
fn release_requires_exact_source_digest_rollback_compatibility() {
    let current_digest = "c".repeat(64);
    let other_digest = "d".repeat(64);
    let (envelope, key, _) = signed_fixture("1.1.0", 2, &other_digest);
    assert_eq!(
        admit_signed_release(&envelope, &key, 200, &installed(&current_digest)),
        Err(ReleaseAdmissionError::RollbackIncompatible)
    );
}

#[test]
fn release_requires_the_pinned_key_id_and_current_freshness_window() {
    let current_digest = "c".repeat(64);
    let (envelope, key, _) = signed_fixture("1.1.0", 2, &current_digest);
    let mut wrong_key = installed(&current_digest);
    wrong_key.trusted_key_id = "release-v2";
    assert_eq!(
        admit_signed_release(&envelope, &key, 200, &wrong_key),
        Err(ReleaseAdmissionError::UnsupportedEnvelope)
    );
    assert_eq!(
        admit_signed_release(&envelope, &key, 1_001, &installed(&current_digest)),
        Err(ReleaseAdmissionError::StaleDescriptor)
    );
}

#[test]
fn baseline_verifier_checks_trust_freshness_and_sequence_without_upgrade_admission() {
    let unrelated_digest = "d".repeat(64);
    let (envelope, key, _) = signed_fixture("0.9.0", 2, &unrelated_digest);
    let descriptor = verify_signed_release_descriptor(&envelope, &key, 200, "release-v1")
        .expect("valid signed baseline descriptor");
    assert_eq!(descriptor.sequence, 2);
    assert_eq!(descriptor.targets[0].version, "0.9.0");

    let (other_envelope, _, _) = signed_fixture("0.9.0", 2, &unrelated_digest);
    let mut bad_signature = envelope.clone();
    bad_signature.signature = other_envelope.signature;
    assert_eq!(
        verify_signed_release_descriptor(&bad_signature, &key, 200, "release-v1"),
        Err(ReleaseAdmissionError::InvalidSignature)
    );
    assert_eq!(
        verify_signed_release_descriptor(&envelope, &key, 200, "release-v2"),
        Err(ReleaseAdmissionError::UnsupportedEnvelope)
    );
    assert_eq!(
        verify_signed_release_descriptor(&envelope, &key, 99, "release-v1"),
        Err(ReleaseAdmissionError::StaleDescriptor)
    );
    assert_eq!(
        verify_signed_release_descriptor(&envelope, &key, 1_001, "release-v1"),
        Err(ReleaseAdmissionError::StaleDescriptor)
    );

    let (zero_sequence, zero_key, _) = signed_fixture("0.9.0", 0, &unrelated_digest);
    assert_eq!(
        verify_signed_release_descriptor(&zero_sequence, &zero_key, 200, "release-v1"),
        Err(ReleaseAdmissionError::Replay)
    );
}

fn journal() -> HostUpdateJournalV1 {
    HostUpdateJournalV1 {
        journal_version: 1,
        operation_id: "019f0000-0000-7000-8000-000000000001".to_owned(),
        nonce: "fence".to_owned(),
        initiating_device_id: "device-a".to_owned(),
        current_digest: "a".repeat(64),
        target_digest: "b".repeat(64),
        target_fingerprint: "c".repeat(64),
        pre_update_relay: HostUpdateRelayState {
            configured: true,
            enabled: true,
            upstream_live: true,
        },
        deadlines: HostUpdateDeadlines {
            install_by: 20,
            target_ready_by: 30,
            reconnect_by: 50,
            rollback_by: 60,
        },
        phase: HostUpdatePhase::Accepted,
        started_at: 10,
        restart_started_at: None,
        updated_at: 10,
        error_code: None,
        error_message: None,
    }
}

#[test]
fn phase_transitions_are_fenced_and_late_receipts_cannot_commit_rollback() {
    let mut operation = journal();
    assert_eq!(
        operation.transition(
            "wrong",
            HostUpdatePhase::Accepted,
            HostUpdatePhase::Installing,
            11
        ),
        Err(TransitionError::StaleFence)
    );
    operation
        .transition(
            "fence",
            HostUpdatePhase::Accepted,
            HostUpdatePhase::Installing,
            11,
        )
        .expect("install transition");
    operation
        .transition(
            "fence",
            HostUpdatePhase::Installing,
            HostUpdatePhase::RollingBack,
            12,
        )
        .expect("rollback transition");
    assert_eq!(
        operation.transition(
            "fence",
            HostUpdatePhase::TargetReady,
            HostUpdatePhase::AwaitingReconnect,
            13
        ),
        Err(TransitionError::CompareAndSwapFailed)
    );
    assert_eq!(
        operation.accept_reconnect(
            "fence",
            &ReconnectReceipt {
                operation_id: operation.operation_id.clone(),
                device_id: "device-a".to_owned(),
            },
            40,
        ),
        Err(TransitionError::StaleReconnect)
    );
    operation
        .transition(
            "fence",
            HostUpdatePhase::RollingBack,
            HostUpdatePhase::Failed,
            14,
        )
        .expect("failed rollback becomes an immutable terminal outcome");
    assert!(operation.phase.is_terminal());
    assert_eq!(
        operation.transition(
            "fence",
            HostUpdatePhase::Failed,
            HostUpdatePhase::RolledBack,
            15,
        ),
        Err(TransitionError::InvalidTransition)
    );
}

#[test]
fn reconnect_requires_recorded_device_and_post_restart_freshness() {
    let mut operation = journal();
    operation.phase = HostUpdatePhase::AwaitingReconnect;
    operation.restart_started_at = Some(30);
    let mut receipt = ReconnectReceipt {
        operation_id: operation.operation_id.clone(),
        device_id: "device-b".to_owned(),
    };
    assert_eq!(
        operation.accept_reconnect("fence", &receipt, 40),
        Err(TransitionError::WrongDevice)
    );
    receipt.device_id = "device-a".to_owned();
    assert_eq!(
        operation.accept_reconnect("fence", &receipt, 30),
        Err(TransitionError::StaleReconnect)
    );
    operation
        .accept_reconnect("fence", &receipt, 40)
        .expect("fresh initiating device receipt");
    assert_eq!(operation.phase, HostUpdatePhase::Committed);
    assert_eq!(
        operation.accept_reconnect("fence", &receipt, 40),
        Err(TransitionError::CompareAndSwapFailed)
    );
}
