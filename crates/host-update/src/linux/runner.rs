//! Stable transaction runner for Linux product generations.

use std::{
    collections::BTreeMap,
    fs, io,
    os::unix::fs::symlink,
    path::{Path, PathBuf},
    process::Stdio,
    time::Duration,
};

use serde::{Deserialize, Serialize};

use super::{
    GenerationMetadataV1, LinuxActivationProduct, ServiceHealth, ServiceHealthContext,
    SystemdScope, generation,
    health::{rollback_is_ready, target_is_ready},
    store, unix_millis,
};
use crate::{HostUpdateJournalV1, HostUpdatePhase, HostUpdateProgress};

/// Stable activation view of the product-owned operation record. Unknown
/// preparation fields are preserved opaquely when journal state is rewritten.
#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ActivationRecord {
    journal: HostUpdateJournalV1,
    current: GenerationMetadataV1,
    previous_generation: String,
    identity_pin: String,
    identity_manifest: PathBuf,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    activation_admitted: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    activation_target: Option<GenerationMetadataV1>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    progress: Option<HostUpdateProgress>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    recovery_error: Option<String>,
    #[serde(flatten)]
    opaque_product_state: BTreeMap<String, serde_json::Value>,
}

impl ActivationRecord {
    fn health_context(&self) -> ServiceHealthContext {
        ServiceHealthContext {
            identity_pin: self.identity_pin.clone(),
            identity_manifest: self.identity_manifest.clone(),
            pre_update_relay: self.journal.pre_update_relay.clone(),
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum ResumeAction {
    BeginInstall,
    ResumeInstall,
    PublishReconnectWait,
    WaitForReconnect,
    ResumeRollback,
    Done,
}

fn resume_action(phase: HostUpdatePhase) -> ResumeAction {
    match phase {
        HostUpdatePhase::Accepted => ResumeAction::BeginInstall,
        HostUpdatePhase::Installing => ResumeAction::ResumeInstall,
        HostUpdatePhase::TargetReady => ResumeAction::PublishReconnectWait,
        HostUpdatePhase::AwaitingReconnect => ResumeAction::WaitForReconnect,
        HostUpdatePhase::RollingBack => ResumeAction::ResumeRollback,
        HostUpdatePhase::Committed | HostUpdatePhase::RolledBack | HostUpdatePhase::Failed => {
            ResumeAction::Done
        }
    }
}

/// Runs one queued operation from the stable bootstrap executable.
///
/// # Errors
/// Returns an error when the durable journal is corrupt or the runner cannot
/// persist, activate, verify, or roll back a generation.
pub async fn run_pending(
    product: &LinuxActivationProduct,
    health: &dyn ServiceHealth,
    root: PathBuf,
    state_root: PathBuf,
    scope: SystemdScope,
) -> Result<(), Box<dyn std::error::Error>> {
    let runner = Runner {
        product,
        health,
        root: &root,
        state_root: &state_root,
        scope,
    };
    let Some(operation_id) = store::read_optional_json::<String>(&state_root.join("active.json"))?
    else {
        return Ok(());
    };
    if !valid_operation_id(&operation_id) {
        return Err(io::Error::other("active operation id is invalid").into());
    }
    let Some(requested_operation) =
        store::read_optional_json::<String>(&state_root.join("activation-request.json"))?
    else {
        return Ok(());
    };
    if requested_operation != operation_id {
        return Err(io::Error::other("activation request does not match active operation").into());
    }
    loop {
        let operation = read_operation(&state_root, &operation_id)?;
        match resume_action(operation.journal.phase) {
            ResumeAction::BeginInstall => {
                let not_before = operation.journal.started_at.saturating_add(1_500);
                let now = unix_millis();
                if now < not_before {
                    tokio::time::sleep(Duration::from_millis(not_before - now)).await;
                }
                transition(
                    &state_root,
                    &operation_id,
                    HostUpdatePhase::Accepted,
                    HostUpdatePhase::Installing,
                    None,
                )?;
            }
            ResumeAction::ResumeInstall => {
                if let Err(failure) = runner.install_and_verify(&operation_id) {
                    let operation = read_operation(&state_root, &operation_id)?;
                    // No replacement was activated: fail the install without
                    // restarting a healthy server or waiting for rollback.
                    if operation.journal.restart_started_at.is_none() {
                        transition(
                            &state_root,
                            &operation_id,
                            HostUpdatePhase::Installing,
                            HostUpdatePhase::Failed,
                            Some((failure.code, &failure.detail)),
                        )?;
                        return Ok(());
                    }
                    runner.rollback(&operation_id, failure.code, &failure.detail)?;
                    return Ok(());
                }
            }
            ResumeAction::PublishReconnectWait => {
                transition(
                    &state_root,
                    &operation_id,
                    HostUpdatePhase::TargetReady,
                    HostUpdatePhase::AwaitingReconnect,
                    None,
                )?;
            }
            ResumeAction::WaitForReconnect => {
                if unix_millis() > operation.journal.deadlines.reconnect_by {
                    runner.rollback(
                        &operation_id,
                        "initiator_reconnect_timeout",
                        "The initiating device did not reconnect before the deadline.",
                    )?;
                    return Ok(());
                }
                tokio::time::sleep(Duration::from_millis(250)).await;
            }
            ResumeAction::ResumeRollback => {
                runner.finish_rollback(&operation_id)?;
                return Ok(());
            }
            ResumeAction::Done => {
                clear_available_release(&state_root)?;
                return Ok(());
            }
        }
    }
}

#[derive(Debug)]
pub(super) struct RunnerFailure {
    pub(super) code: &'static str,
    pub(super) detail: String,
}

impl RunnerFailure {
    pub(super) fn new(code: &'static str, detail: impl Into<String>) -> Self {
        Self {
            code,
            detail: detail.into().chars().take(160).collect(),
        }
    }
}

/// The product and install locations one runner invocation operates on.
struct Runner<'a> {
    product: &'a LinuxActivationProduct,
    health: &'a dyn ServiceHealth,
    root: &'a Path,
    state_root: &'a Path,
    scope: SystemdScope,
}

impl Runner<'_> {
    fn install_and_verify(&self, operation_id: &str) -> Result<(), RunnerFailure> {
        let (root, state_root) = (self.root, self.state_root);
        let operation = read_operation(state_root, operation_id).map_err(|_| {
            RunnerFailure::new("journal_unreadable", "Update journal is unreadable.")
        })?;
        if unix_millis() > operation.journal.deadlines.install_by {
            return Err(RunnerFailure::new(
                "install_deadline_exceeded",
                "The update did not install before its deadline.",
            ));
        }
        let target = self.verify_activation_request(&operation)?.clone();
        self.publish_prepared_generation(operation_id, &target)?;
        set_restart_started(state_root, operation_id, &operation.journal.nonce).map_err(|_| {
            RunnerFailure::new("journal_write_failed", "Cannot persist restart state.")
        })?;
        report_progress(state_root, operation_id, HostUpdateProgress::Restarting)?;
        switch_current(root, &format!("generations/{}", target.artifact_digest))?;
        restart_service(self.scope, self.product)?;
        report_progress(state_root, operation_id, HostUpdateProgress::CheckingHealth)?;
        self.wait_for_exact_target(&operation, &target)?;
        transition(
            state_root,
            operation_id,
            HostUpdatePhase::Installing,
            HostUpdatePhase::TargetReady,
            None,
        )
        .map_err(|_| {
            RunnerFailure::new("journal_write_failed", "Cannot persist target readiness.")
        })?;
        Ok(())
    }

    fn publish_prepared_generation(
        &self,
        operation_id: &str,
        target: &GenerationMetadataV1,
    ) -> Result<(), RunnerFailure> {
        if !valid_generation_identity(target) {
            return Err(RunnerFailure::new(
                "activation_target_invalid",
                "The prepared generation identity is invalid.",
            ));
        }
        let prepared = generation::prepared_path(self.root, operation_id);
        let published = self.root.join("generations").join(&target.artifact_digest);
        if published.exists() {
            generation::verify(self.product, &published, target)?;
            if prepared.exists() {
                generation::verify(self.product, &prepared, target)?;
                fs::remove_dir_all(&prepared).map_err(|_| {
                    RunnerFailure::new(
                        "prepared_generation_cleanup_failed",
                        "Cannot remove the redundant prepared generation.",
                    )
                })?;
            }
            return Ok(());
        }
        generation::verify(self.product, &prepared, target)?;
        generation::publish_directory(&prepared, &published)?;
        store::sync_directory(&self.root.join("generations")).map_err(|_| {
            RunnerFailure::new(
                "generation_storage_failed",
                "Cannot persist generation activation.",
            )
        })
    }

    fn verify_activation_request<'a>(
        &self,
        operation: &'a ActivationRecord,
    ) -> Result<&'a GenerationMetadataV1, RunnerFailure> {
        if !valid_generation_identity(&operation.current) {
            return Err(RunnerFailure::new(
                "current_generation_invalid",
                "The previous generation identity is invalid.",
            ));
        }
        let current: GenerationMetadataV1 =
            store::read_json(&self.root.join("current/metadata.json")).map_err(|_| {
                RunnerFailure::new(
                    "current_generation_invalid",
                    "The active generation metadata is unreadable.",
                )
            })?;
        let current_link = fs::read_link(self.root.join("current"))
            .ok()
            .and_then(|path| path.to_str().map(str::to_owned));
        if current != operation.current
            || current_link.as_deref() != Some(operation.previous_generation.as_str())
            || operation.previous_generation != format!("generations/{}", current.artifact_digest)
        {
            return Err(RunnerFailure::new(
                "current_generation_changed",
                "The active generation changed after update preparation.",
            ));
        }
        if operation.activation_admitted != Some(true) {
            return Err(RunnerFailure::new(
                "activation_not_admitted",
                "The product did not finish preparing this generation.",
            ));
        }
        let target = operation.activation_target.as_ref().ok_or_else(|| {
            RunnerFailure::new(
                "activation_target_missing",
                "The product did not identify the prepared generation.",
            )
        })?;
        if !valid_generation_identity(target) {
            return Err(RunnerFailure::new(
                "activation_target_invalid",
                "The prepared generation identity is invalid.",
            ));
        }
        Ok(target)
    }

    fn wait_for_exact_target(
        &self,
        operation: &ActivationRecord,
        expected: &GenerationMetadataV1,
    ) -> Result<(), RunnerFailure> {
        let deadline = self
            .product
            .ready_timeout
            .and_then(|timeout| u64::try_from(timeout.as_millis()).ok())
            .map_or(operation.journal.deadlines.target_ready_by, |timeout| {
                operation
                    .journal
                    .deadlines
                    .target_ready_by
                    .min(unix_millis().saturating_add(timeout))
            });
        let started = service_state(self.scope, self.product.service_unit);
        let context = operation.health_context();
        while unix_millis() <= deadline {
            if target_is_ready(self.root, self.health, expected, &context) {
                return Ok(());
            }
            // A target that exits or is restarted by systemd is broken now;
            // waiting for the deadline would only extend the outage.
            if let (Some(started), Some(now)) = (
                started.as_ref(),
                service_state(self.scope, self.product.service_unit),
            ) && now.crashed_since(started)
            {
                return Err(RunnerFailure::new(
                    "target_crashed",
                    "The updated service exited during startup.",
                ));
            }
            std::thread::sleep(Duration::from_millis(250));
        }
        Err(RunnerFailure::new(
            "target_health_timeout",
            "The updated service did not become healthy before the deadline.",
        ))
    }

    fn rollback(
        &self,
        operation_id: &str,
        code: &str,
        detail: &str,
    ) -> Result<(), Box<dyn std::error::Error>> {
        let operation = read_operation(self.state_root, operation_id)?;
        if operation.journal.phase != HostUpdatePhase::RollingBack {
            transition(
                self.state_root,
                operation_id,
                operation.journal.phase,
                HostUpdatePhase::RollingBack,
                Some((code, detail)),
            )?;
        }
        self.finish_rollback(operation_id)
    }

    fn finish_rollback(&self, operation_id: &str) -> Result<(), Box<dyn std::error::Error>> {
        let (root, state_root) = (self.root, self.state_root);
        let operation = read_operation(state_root, operation_id)?;
        if unix_millis() > operation.journal.deadlines.rollback_by {
            transition(
                state_root,
                operation_id,
                HostUpdatePhase::RollingBack,
                HostUpdatePhase::Failed,
                Some((
                    "rollback_deadline_exceeded",
                    "Rollback exceeded its deadline.",
                )),
            )?;
            return Ok(());
        }
        switch_current(root, &operation.previous_generation)
            .map_err(|failure| io::Error::other(failure.detail))?;
        restart_service(self.scope, self.product)
            .map_err(|failure| io::Error::other(failure.detail))?;
        let mut healthy = false;
        while unix_millis() <= operation.journal.deadlines.rollback_by {
            healthy = rollback_is_ready(
                root,
                self.health,
                &operation.current,
                &operation.health_context(),
            );
            if healthy {
                break;
            }
            std::thread::sleep(Duration::from_millis(250));
        }
        if !healthy {
            transition(
                state_root,
                operation_id,
                HostUpdatePhase::RollingBack,
                HostUpdatePhase::Failed,
                Some((
                    "rollback_health_failed",
                    "The previous service did not recover.",
                )),
            )?;
            return Ok(());
        }
        transition(
            state_root,
            operation_id,
            HostUpdatePhase::RollingBack,
            HostUpdatePhase::RolledBack,
            None,
        )?;
        Ok(())
    }
}

fn valid_operation_id(value: &str) -> bool {
    value
        .strip_prefix("upd_")
        .is_some_and(|suffix| lower_hex(suffix, 32))
}

fn valid_generation_identity(value: &GenerationMetadataV1) -> bool {
    value.schema_version == 1
        && lower_hex(&value.artifact_digest, 64)
        && lower_hex(&value.source_revision, 40)
}

fn lower_hex(value: &str, length: usize) -> bool {
    value.len() == length
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn switch_current(root: &Path, relative_target: &str) -> Result<(), RunnerFailure> {
    let temporary = root.join(".current-next");
    if temporary.exists() || fs::symlink_metadata(&temporary).is_ok() {
        fs::remove_file(&temporary).map_err(|_| {
            RunnerFailure::new("activation_failed", "Cannot reset the activation link.")
        })?;
    }
    symlink(relative_target, &temporary).map_err(|_| {
        RunnerFailure::new("activation_failed", "Cannot create the activation link.")
    })?;
    fs::rename(&temporary, root.join("current")).map_err(|_| {
        RunnerFailure::new(
            "activation_failed",
            "Cannot atomically activate the generation.",
        )
    })?;
    store::sync_directory(root).map_err(|_| {
        RunnerFailure::new("activation_failed", "Cannot persist generation activation.")
    })
}

/// The systemd view of a service that reveals a crash after a restart.
#[derive(Debug, Eq, PartialEq)]
struct ServiceState {
    active_state: String,
    restarts: u64,
}

impl ServiceState {
    fn parse(output: &str) -> Option<Self> {
        let mut active_state = None;
        let mut restarts = None;
        for line in output.lines() {
            match line.split_once('=') {
                Some(("ActiveState", value)) => active_state = Some(value.to_owned()),
                Some(("NRestarts", value)) => restarts = value.parse().ok(),
                _ => {}
            }
        }
        Some(Self {
            active_state: active_state?,
            restarts: restarts?,
        })
    }

    /// Exited, failed, or restarted by systemd since `started` was observed.
    fn crashed_since(&self, started: &Self) -> bool {
        self.restarts > started.restarts
            || !matches!(
                self.active_state.as_str(),
                "active" | "activating" | "reloading"
            )
    }
}

fn service_state(scope: SystemdScope, unit: &str) -> Option<ServiceState> {
    let output = scope
        .command()
        .args([
            "show",
            "--property=ActiveState",
            "--property=NRestarts",
            unit,
        ])
        .output()
        .ok()
        .filter(|output| output.status.success())?;
    ServiceState::parse(&String::from_utf8(output.stdout).ok()?)
}

fn restart_service(
    scope: SystemdScope,
    product: &LinuxActivationProduct,
) -> Result<(), RunnerFailure> {
    // A crash-looping target can exhaust the unit's start limit; systemd then
    // refuses every restart, including the one that rolls back. Clear it.
    let _ = systemctl_success(scope, &["reset-failed", product.service_unit]);
    systemctl_success(scope, &["restart", product.service_unit])
        .then_some(())
        .ok_or_else(|| RunnerFailure::new("service_restart_failed", "The service did not restart."))
}

pub(super) fn transition(
    state_root: &Path,
    operation_id: &str,
    expected: HostUpdatePhase,
    next: HostUpdatePhase,
    error: Option<(&str, &str)>,
) -> Result<(), Box<dyn std::error::Error>> {
    let _lock = store::lock(&state_root.join("guardian.lock"))?;
    let mut operation = read_operation(state_root, operation_id)?;
    let nonce = operation.journal.nonce.clone();
    operation
        .journal
        .transition(&nonce, expected, next, unix_millis())?;
    if let Some((code, detail)) = error {
        if operation.journal.error_code.is_none() {
            operation.journal.error_code = Some(code.chars().take(80).collect());
            operation.journal.error_message = Some(detail.chars().take(160).collect());
        } else {
            operation.recovery_error = Some(code.chars().take(80).collect());
        }
    }
    operation.progress = match next {
        HostUpdatePhase::RollingBack => Some(HostUpdateProgress::RollingBack),
        HostUpdatePhase::AwaitingReconnect => Some(HostUpdateProgress::AwaitingReconnect),
        phase if phase.is_terminal() => None,
        _ => operation.progress,
    };
    write_operation(state_root, &operation)?;
    if next == HostUpdatePhase::RollingBack || next.is_terminal() {
        clear_available_release(state_root)?;
    }
    Ok(())
}

pub(super) fn report_progress(
    state_root: &Path,
    operation_id: &str,
    progress: HostUpdateProgress,
) -> Result<(), RunnerFailure> {
    let write = || -> Result<(), Box<dyn std::error::Error>> {
        let _lock = store::lock(&state_root.join("guardian.lock"))?;
        let mut operation = read_operation(state_root, operation_id)?;
        if operation.journal.phase != HostUpdatePhase::Installing {
            return Err(io::Error::other("stale update progress").into());
        }
        operation.progress = Some(progress);
        operation.journal.updated_at = unix_millis();
        write_operation(state_root, &operation)?;
        Ok(())
    };
    write()
        .map_err(|_| RunnerFailure::new("journal_write_failed", "Cannot persist update progress."))
}

fn clear_available_release(state_root: &Path) -> io::Result<()> {
    for name in ["available.json", "activation-request.json"] {
        match fs::remove_file(state_root.join(name)) {
            Ok(()) => {}
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(error) => return Err(error),
        }
    }
    store::sync_directory(state_root)
}

fn set_restart_started(state_root: &Path, operation_id: &str, nonce: &str) -> io::Result<()> {
    let _lock = store::lock(&state_root.join("guardian.lock"))?;
    let mut operation = read_operation(state_root, operation_id)?;
    if operation.journal.nonce != nonce || operation.journal.phase != HostUpdatePhase::Installing {
        return Err(io::Error::other("stale update fence"));
    }
    let now = unix_millis();
    operation.journal.restart_started_at = Some(now);
    operation.journal.updated_at = now;
    write_operation(state_root, &operation)?;
    Ok(())
}

fn read_operation(state_root: &Path, operation_id: &str) -> io::Result<ActivationRecord> {
    store::read_json(
        &state_root
            .join("operations")
            .join(format!("{operation_id}.json")),
    )
}

fn write_operation(state_root: &Path, operation: &ActivationRecord) -> io::Result<()> {
    store::write_json(
        &state_root
            .join("operations")
            .join(format!("{}.json", operation.journal.operation_id)),
        operation,
    )
}

fn systemctl_success(scope: SystemdScope, args: &[&str]) -> bool {
    scope
        .command()
        .args(args)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .is_ok_and(|status| status.success())
}

#[cfg(test)]
#[allow(clippy::expect_used)]
#[path = "runner_tests.rs"]
mod tests;
