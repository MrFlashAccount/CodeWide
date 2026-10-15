use std::collections::VecDeque;

use super::*;
use crate::{AvailableHostUpdate, HostPlatform, HostUpdateCapability, ReleaseTargetV1};

type Reply = Result<HostUpdateOperation, LocalControlError>;

/// A service that answers operation reads from a script and records receipts.
struct ScriptedService {
    status: Result<HostUpdateStatus, LocalControlError>,
    reads: VecDeque<Reply>,
    receipts: VecDeque<Reply>,
    applied: Vec<ApplyHostUpdateRequest>,
    confirmed: Vec<String>,
}

#[async_trait]
impl LocalUpdateControl for ScriptedService {
    async fn check(&mut self) -> Result<HostUpdateStatus, LocalControlError> {
        std::mem::replace(&mut self.status, Err(unreachable()))
    }

    async fn apply(
        &mut self,
        request: &ApplyHostUpdateRequest,
    ) -> Result<ApplyHostUpdateAccepted, LocalControlError> {
        self.applied.push(request.clone());
        Ok(ApplyHostUpdateAccepted {
            operation_id: "upd_terminal".to_owned(),
            phase: HostUpdatePhase::Accepted,
        })
    }

    async fn operation(&mut self, _: &str) -> Result<HostUpdateOperation, LocalControlError> {
        self.reads.pop_front().unwrap_or_else(|| Err(unreachable()))
    }

    async fn reconnect(
        &mut self,
        operation_id: &str,
    ) -> Result<HostUpdateOperation, LocalControlError> {
        self.confirmed.push(operation_id.to_owned());
        self.receipts
            .pop_front()
            .unwrap_or_else(|| Err(unreachable()))
    }
}

fn unreachable() -> LocalControlError {
    LocalControlError::Unreachable("connection refused".to_owned())
}

fn operation(phase: HostUpdatePhase, progress: Option<HostUpdateProgress>) -> HostUpdateOperation {
    HostUpdateOperation {
        operation_id: "upd_terminal".to_owned(),
        phase,
        current_version: "0.6.3".to_owned(),
        target_version: "0.6.4".to_owned(),
        target_fingerprint: "e".repeat(64),
        started_at: 1,
        updated_at: 2,
        error_code: None,
        error_message: None,
        progress,
    }
}

fn capability() -> HostUpdateCapability {
    HostUpdateCapability {
        api_version: crate::HOST_UPDATE_API_VERSION,
        guardian_contract_version: crate::HOST_UPDATE_GUARDIAN_CONTRACT_VERSION,
        journal_version: crate::HOST_UPDATE_JOURNAL_VERSION,
        bootstrap_version: crate::HOST_UPDATE_BOOTSTRAP_VERSION,
        apply_supported: true,
        unavailable_reason: None,
    }
}

fn status(available: bool) -> HostUpdateStatus {
    HostUpdateStatus {
        platform: HostPlatform::LinuxX86_64,
        current_version: "0.6.3".to_owned(),
        current_build: "a".repeat(12),
        current_source_revision: "a".repeat(40),
        current_digest: "b".repeat(64),
        capability: capability(),
        available_target: available.then(|| AvailableHostUpdate {
            target: ReleaseTargetV1 {
                platform: HostPlatform::LinuxX86_64,
                version: "0.6.4".to_owned(),
                build: "c".repeat(12),
                source_revision: "c".repeat(40),
                artifact_url: "https://example.invalid/companion.tar.gz".to_owned(),
                sha256: "d".repeat(64),
                bootstrap_version: crate::HOST_UPDATE_BOOTSTRAP_VERSION,
                journal_version: crate::HOST_UPDATE_JOURNAL_VERSION,
                state_epoch: 1,
                rollback_compatible_from: vec!["b".repeat(64)],
            },
            target_fingerprint: "e".repeat(64),
            release_sequence: 7,
            expires_at: u64::MAX,
        }),
        active_operation: None,
    }
}

fn service(status: Result<HostUpdateStatus, LocalControlError>) -> ScriptedService {
    ScriptedService {
        status,
        reads: VecDeque::new(),
        receipts: VecDeque::new(),
        applied: Vec::new(),
        confirmed: Vec::new(),
    }
}

#[tokio::test(start_paused = true)]
async fn applies_follows_the_restart_and_commits_by_confirming_the_new_service()
-> Result<(), LocalControlError> {
    let mut service = service(Ok(status(true)));
    service.reads = VecDeque::from([
        Ok(operation(
            HostUpdatePhase::Installing,
            Some(HostUpdateProgress::Downloading {
                downloaded_bytes: 45,
                total_bytes: Some(100),
            }),
        )),
        Ok(operation(
            HostUpdatePhase::Installing,
            Some(HostUpdateProgress::Downloading {
                downloaded_bytes: 48,
                total_bytes: Some(100),
            }),
        )),
        // The service restarts into the new generation.
        Err(unreachable()),
        Err(unreachable()),
        Ok(operation(HostUpdatePhase::AwaitingReconnect, None)),
    ]);
    service.receipts = VecDeque::from([Ok(operation(HostUpdatePhase::Committed, None))]);
    let mut events = Vec::new();

    let outcome = run_local_update(&mut service, |event| events.push(event)).await?;

    assert!(
        matches!(outcome, LocalUpdateOutcome::Updated { operation } if operation.target_version == "0.6.4")
    );
    assert_eq!(service.applied.len(), 1);
    assert_eq!(service.applied[0].target_fingerprint, "e".repeat(64));
    assert_eq!(service.confirmed, ["upd_terminal"]);
    assert_eq!(
        events,
        [
            LocalUpdateEvent::Started {
                current_version: "0.6.3".to_owned(),
                target_version: "0.6.4".to_owned(),
            },
            // One line per reporting step, not per byte update.
            LocalUpdateEvent::Stage(UpdateStage::Downloading { percent: Some(40) }),
        ]
    );
    Ok(())
}

#[tokio::test(start_paused = true)]
async fn retries_a_receipt_the_restarted_service_cannot_take_yet() -> Result<(), LocalControlError>
{
    let mut service = service(Ok(status(true)));
    service.reads = VecDeque::from([
        Ok(operation(HostUpdatePhase::AwaitingReconnect, None)),
        Ok(operation(HostUpdatePhase::AwaitingReconnect, None)),
    ]);
    service.receipts = VecDeque::from([
        Err(unreachable()),
        Ok(operation(HostUpdatePhase::Committed, None)),
    ]);
    let mut events = Vec::new();

    let outcome = run_local_update(&mut service, |event| events.push(event)).await?;

    assert!(matches!(outcome, LocalUpdateOutcome::Updated { .. }));
    assert_eq!(service.confirmed.len(), 2);
    assert_eq!(
        events.last(),
        Some(&LocalUpdateEvent::Stage(UpdateStage::Confirming))
    );
    Ok(())
}

#[tokio::test(start_paused = true)]
async fn reports_a_rollback_as_not_updated() -> Result<(), LocalControlError> {
    let mut service = service(Ok(status(true)));
    let mut rolled_back = operation(HostUpdatePhase::RolledBack, None);
    rolled_back.error_code = Some("health_check_failed".to_owned());
    service.reads = VecDeque::from([
        Ok(operation(
            HostUpdatePhase::RollingBack,
            Some(HostUpdateProgress::RollingBack),
        )),
        Ok(rolled_back),
    ]);

    let outcome = run_local_update(&mut service, |_| {}).await?;

    assert!(
        matches!(outcome, LocalUpdateOutcome::NotUpdated { operation } if operation.error_code.as_deref() == Some("health_check_failed"))
    );
    assert!(service.confirmed.is_empty());
    Ok(())
}

#[tokio::test(start_paused = true)]
async fn applies_nothing_without_a_newer_release() -> Result<(), LocalControlError> {
    let mut service = service(Ok(status(false)));

    let outcome = run_local_update(&mut service, |_| {}).await?;

    assert!(
        matches!(outcome, LocalUpdateOutcome::NotApplied { check: LocalUpdateCheck::UpToDate { version } } if version == "0.6.3")
    );
    assert!(service.applied.is_empty());
    Ok(())
}

#[tokio::test(start_paused = true)]
async fn applies_nothing_on_an_installation_that_cannot_update_itself()
-> Result<(), LocalControlError> {
    let mut manual = service(Err(LocalControlError::Rejected {
        code: "manual_update_required".to_owned(),
        message: "installation is not managed".to_owned(),
    }));
    let outcome = run_local_update(&mut manual, |_| {}).await?;
    assert!(
        matches!(outcome, LocalUpdateOutcome::NotApplied { check: LocalUpdateCheck::Unavailable { reason } } if reason == "installation is not managed")
    );

    let mut disabled_status = status(true);
    disabled_status.capability = HostUpdateCapability::disabled("bootstrap_too_old");
    let mut disabled = service(Ok(disabled_status));
    let outcome = run_local_update(&mut disabled, |_| {}).await?;
    assert!(
        matches!(outcome, LocalUpdateOutcome::NotApplied { check: LocalUpdateCheck::Unavailable { reason } } if reason == "bootstrap_too_old")
    );
    assert!(manual.applied.is_empty() && disabled.applied.is_empty());
    Ok(())
}

#[tokio::test(start_paused = true)]
async fn follows_an_update_already_running_without_starting_another()
-> Result<(), LocalControlError> {
    let mut running = status(true);
    running.active_operation = Some(operation(HostUpdatePhase::Installing, None));
    let mut service = service(Ok(running));
    service.reads = VecDeque::from([
        Ok(operation(HostUpdatePhase::AwaitingReconnect, None)),
        // The phone that started it confirms it; the terminal's receipt is refused.
        Ok(operation(HostUpdatePhase::Committed, None)),
    ]);
    service.receipts = VecDeque::from([Err(LocalControlError::Rejected {
        code: "precondition_failed".to_owned(),
        message: "reconnect receipt came from a different device".to_owned(),
    })]);

    let outcome = run_local_update(&mut service, |_| {}).await?;

    assert!(matches!(outcome, LocalUpdateOutcome::Updated { .. }));
    assert!(service.applied.is_empty());
    assert_eq!(service.confirmed, ["upd_terminal"]);
    Ok(())
}

#[tokio::test(start_paused = true)]
async fn gives_up_when_the_service_never_comes_back() {
    let mut service = service(Ok(status(true)));

    let outcome = run_local_update(&mut service, |_| {}).await;

    assert!(matches!(outcome, Err(LocalControlError::Unreachable(_))));
}
