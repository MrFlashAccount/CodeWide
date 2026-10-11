use base64::{Engine as _, engine::general_purpose};
use companion_core::host_update::{
    HOST_UPDATE_BOOTSTRAP_VERSION, HOST_UPDATE_JOURNAL_VERSION, HostPlatform, ReleaseDescriptorV1,
    ReleaseTargetV1, SignedReleaseDescriptor,
};
use companion_swift_ffi::{
    CompanionFfiError, FfiHostUpdateAdmission, admit_macos_host_update_release,
};
use p256::{
    ecdsa::{Signature, SigningKey, signature::Signer},
    pkcs8::EncodePublicKey,
};

type TestResult<T> = Result<T, Box<dyn std::error::Error>>;

fn signed_macos_release(
    target_version: &str,
    sequence: u64,
    rollback_digest: &str,
) -> TestResult<(String, String)> {
    let descriptor = ReleaseDescriptorV1 {
        schema_version: 1,
        channel: "stable".to_owned(),
        sequence,
        issued_at: 100,
        expires_at: 1_000,
        targets: vec![ReleaseTargetV1 {
            platform: HostPlatform::MacosUniversal,
            version: target_version.to_owned(),
            build: "42".to_owned(),
            source_revision: "a".repeat(40),
            artifact_url: format!(
                "https://github.com/MrFlashAccount/CodeWide/releases/download/v{target_version}/CodeWide.dmg"
            ),
            sha256: "b".repeat(64),
            bootstrap_version: HOST_UPDATE_BOOTSTRAP_VERSION,
            journal_version: HOST_UPDATE_JOURNAL_VERSION,
            state_epoch: 7,
            rollback_compatible_from: vec![rollback_digest.to_owned()],
        }],
    };
    let payload = serde_json::to_vec(&descriptor)?;
    let signing = SigningKey::random(&mut p256::elliptic_curve::rand_core::OsRng);
    let signature: Signature = signing.sign(&payload);
    let public_key =
        general_purpose::STANDARD.encode(signing.verifying_key().to_public_key_der()?.as_bytes());
    let envelope = SignedReleaseDescriptor {
        schema_version: 1,
        key_id: "release-v1".to_owned(),
        algorithm: "ES256".to_owned(),
        payload: general_purpose::URL_SAFE_NO_PAD.encode(payload),
        signature: general_purpose::STANDARD.encode(signature.to_der().as_bytes()),
    };
    Ok((serde_json::to_string(&envelope)?, public_key))
}

fn admit_fixture(
    target_version: &str,
    sequence: u64,
    highest_sequence: u64,
) -> TestResult<Result<FfiHostUpdateAdmission, CompanionFfiError>> {
    let current_digest = "c".repeat(64);
    let (envelope, public_key) = signed_macos_release(target_version, sequence, &current_digest)?;
    Ok(admit_macos_host_update_release(
        envelope,
        public_key,
        200,
        "release-v1".to_owned(),
        "1.0.0".to_owned(),
        current_digest,
        highest_sequence,
        7,
    ))
}

#[test]
fn macos_release_admission_reports_available_upgrade() -> TestResult<()> {
    assert!(matches!(
        admit_fixture("1.1.0", 2, 1)?,
        Ok(FfiHostUpdateAdmission::Available { .. })
    ));
    Ok(())
}

#[test]
fn macos_release_admission_reports_current_version_as_current() -> TestResult<()> {
    assert!(matches!(
        admit_fixture("1.0.0", 2, 1)?,
        Ok(FfiHostUpdateAdmission::Current)
    ));
    Ok(())
}

#[test]
fn macos_release_admission_reports_downgrade_as_current() -> TestResult<()> {
    assert!(matches!(
        admit_fixture("0.9.0", 2, 1)?,
        Ok(FfiHostUpdateAdmission::Current)
    ));
    Ok(())
}

#[test]
fn macos_release_admission_reports_genuine_replay_as_current() -> TestResult<()> {
    assert!(matches!(
        admit_fixture("1.1.0", 1, 1)?,
        Ok(FfiHostUpdateAdmission::Current)
    ));
    Ok(())
}

#[test]
fn macos_release_admission_rejects_zero_sequence() -> TestResult<()> {
    assert!(matches!(
        admit_fixture("1.1.0", 0, 0)?,
        Err(CompanionFfiError::Runtime { message })
            if message == "release descriptor sequence must be greater than zero"
    ));
    Ok(())
}
