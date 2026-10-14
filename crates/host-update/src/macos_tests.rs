use super::*;

const DEVICE: &str = "device_00000000000000000000000000000000";

fn release(version: &str) -> InstalledRelease {
    InstalledRelease {
        version: version.to_owned(),
        build: format!("20000{version}"),
        source_revision: "a".repeat(40),
    }
}

fn updater(state: &Path, installed: InstalledRelease, started_at: u64) -> MacosSparkleUpdater {
    MacosSparkleUpdater {
        state_root: state.to_path_buf(),
        installed,
        trust: Some(ReleaseTrust {
            key_id: "test".to_owned(),
            public_key_spki: String::new(),
        }),
        relay: OnceLock::new(),
        started_at,
        lock: Mutex::new(()),
    }
}

/// A checked 1.1.0 target, as `check` caches it.
fn cache_available(state: &Path) -> String {
    let target = ReleaseTargetV1 {
        platform: HostPlatform::MacosUniversal,
        version: "1.1.0".to_owned(),
        build: "200001.1.0".to_owned(),
        source_revision: "b".repeat(40),
        artifact_url:
            "https://github.com/MrFlashAccount/CodeWide/releases/download/r/CodeWide-1.1.0.dmg"
                .to_owned(),
        sha256: "b".repeat(64),
        bootstrap_version: SPARKLE_BOOTSTRAP_VERSION,
        journal_version: 1,
        state_epoch: 1,
        rollback_compatible_from: Vec::new(),
    };
    let fingerprint = target_fingerprint(&target).expect("fingerprint");
    write_json(
        &state.join("available.json"),
        &AvailableHostUpdate {
            target,
            target_fingerprint: fingerprint.clone(),
            release_sequence: 7,
            expires_at: u64::MAX,
        },
    )
    .expect("available");
    fingerprint
}

fn command(fingerprint: &str, key: &str) -> ApplyHostUpdateCommand {
    ApplyHostUpdateCommand {
        target_fingerprint: fingerprint.to_owned(),
        idempotency_key: key.to_owned(),
        initiating_device_id: DEVICE.to_owned(),
    }
}

fn write_event(state: &Path, operation_id: &str, kind: &str) {
    let record: OperationRecord = read_optional_json(
        &state
            .join("operations")
            .join(format!("{operation_id}.json")),
    )
    .expect("read")
    .expect("record");
    write_json(
        &state
            .join("commands")
            .join(format!("{operation_id}.event.json")),
        &serde_json::json!({
            "operationId": operation_id,
            "nonce": record.journal.nonce,
            "kind": kind,
            "targetVersion": "1.1.0",
            "errorMessage": "Sparkle failed",
        }),
    )
    .expect("event");
}

#[tokio::test]
async fn apply_hands_the_confirmed_target_to_the_app() -> Result<(), GuardianError> {
    let directory = tempfile::tempdir().map_err(internal)?;
    let state = directory.path();
    let updater = updater(state, release("1.0.0"), 1);
    let fingerprint = cache_available(state);

    let accepted = updater.apply(command(&fingerprint, "idem_1")).await?;

    let handed: serde_json::Value = read_optional_json(
        &state
            .join("commands")
            .join(format!("{}.json", accepted.operation_id)),
    )
    .map_err(internal)?
    .ok_or_else(not_found)?;
    assert_eq!(handed["targetVersion"], "1.1.0");
    assert_eq!(handed["targetBuild"], "200001.1.0");
    assert_eq!(
        updater.operation(&accepted.operation_id).await?.phase,
        HostUpdatePhase::Accepted
    );
    let replay = updater.apply(command(&fingerprint, "idem_1")).await?;
    assert_eq!(replay.operation_id, accepted.operation_id);
    let locked = updater
        .apply(command(&fingerprint, "idem_2"))
        .await
        .expect_err("one active update");
    assert_eq!(locked.code, GuardianErrorCode::Locked);
    Ok(())
}

#[tokio::test]
async fn apply_requires_the_checked_fingerprint() -> Result<(), GuardianError> {
    let directory = tempfile::tempdir().map_err(internal)?;
    let updater = updater(directory.path(), release("1.0.0"), 1);
    let missing = updater
        .apply(command("unknown", "idem_1"))
        .await
        .expect_err("not checked");
    assert_eq!(missing.message, "update_check_required");
    cache_available(directory.path());
    let changed = updater
        .apply(command("unknown", "idem_1"))
        .await
        .expect_err("different target");
    assert_eq!(changed.message, "target_fingerprint_changed");
    Ok(())
}

#[tokio::test]
async fn sparkle_failure_ends_the_operation_and_allows_a_retry() -> Result<(), GuardianError> {
    let directory = tempfile::tempdir().map_err(internal)?;
    let state = directory.path();
    let updater = updater(state, release("1.0.0"), 1);
    let fingerprint = cache_available(state);
    let accepted = updater.apply(command(&fingerprint, "idem_1")).await?;

    write_event(state, &accepted.operation_id, "installing");
    assert_eq!(
        updater.operation(&accepted.operation_id).await?.phase,
        HostUpdatePhase::Installing
    );
    write_event(state, &accepted.operation_id, "failed");
    let failed = updater.operation(&accepted.operation_id).await?;
    assert_eq!(failed.phase, HostUpdatePhase::Failed);
    assert_eq!(failed.error_code.as_deref(), Some("sparkle_install_failed"));

    cache_available(state);
    updater.apply(command(&fingerprint, "idem_2")).await?;
    Ok(())
}

#[tokio::test]
async fn restarted_target_waits_for_and_accepts_the_initiating_device() -> Result<(), GuardianError>
{
    let directory = tempfile::tempdir().map_err(internal)?;
    let state = directory.path();
    let before = updater(state, release("1.0.0"), 1);
    let fingerprint = cache_available(state);
    let accepted = before.apply(command(&fingerprint, "idem_1")).await?;

    let mut installed = release("1.1.0");
    installed.build = "200001.1.0".to_owned();
    let after = updater(state, installed, unix_millis().saturating_sub(1));
    let status = after.status().await?;
    let operation = status.active_operation.ok_or_else(not_found)?;
    assert_eq!(operation.phase, HostUpdatePhase::AwaitingReconnect);
    assert!(status.available_target.is_none());
    assert!(
        !state
            .join("commands")
            .join(format!("{}.json", accepted.operation_id))
            .exists()
    );

    let wrong = after
        .reconnect(ReconnectReceipt {
            operation_id: accepted.operation_id.clone(),
            device_id: "device_other".to_owned(),
        })
        .await
        .expect_err("other device");
    assert_eq!(wrong.message, "invalid_reconnect_receipt");
    let committed = after
        .reconnect(ReconnectReceipt {
            operation_id: accepted.operation_id,
            device_id: DEVICE.to_owned(),
        })
        .await?;
    assert_eq!(committed.phase, HostUpdatePhase::Committed);
    Ok(())
}

#[tokio::test]
async fn unofficial_build_cannot_update() {
    let directory = tempfile::tempdir().expect("temporary directory");
    let mut updater = updater(directory.path(), release("1.0.0"), 1);
    updater.trust = None;
    assert_eq!(
        updater.capability().unavailable_reason.as_deref(),
        Some(HOST_UPDATE_UNOFFICIAL_BUILD_REASON)
    );
    let refused = updater
        .apply(command("any", "idem_1"))
        .await
        .expect_err("unofficial");
    assert_eq!(refused.code, GuardianErrorCode::ManualUpdateRequired);
}

#[test]
fn operation_ids_are_fixed_local_identifiers() {
    assert!(valid_operation_id("upd_0123456789abcdef0123456789abcdef"));
    assert!(!valid_operation_id("upd_../../etc"));
    assert!(!valid_operation_id("0123456789abcdef0123456789abcdef"));
}
