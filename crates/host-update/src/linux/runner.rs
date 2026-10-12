//! Stable transaction runner for Linux product generations.

use std::{
    fs::{self, File, OpenOptions},
    io::{self, Read as _, Write as _},
    os::unix::fs::{OpenOptionsExt, PermissionsExt, symlink},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    time::Duration,
};

use sha2::{Digest, Sha256};

use super::{
    GenerationMetadataV1, LinuxProduct, OperationRecord, ServiceHealth, SystemdScope,
    health::{rollback_is_ready, target_is_ready},
    store, unix_millis,
};
use crate::{
    HOST_UPDATE_BOOTSTRAP_VERSION, HOST_UPDATE_JOURNAL_VERSION, HostUpdatePhase,
    HostUpdateProgress, ReleaseAdmission, ReleaseTargetV1, ReleaseTrust, admit_signed_release,
};

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
    product: &LinuxProduct,
    health: &dyn ServiceHealth,
    root: PathBuf,
    state_root: PathBuf,
    trust: Option<ReleaseTrust>,
    scope: SystemdScope,
) -> Result<(), Box<dyn std::error::Error>> {
    let runner = Runner {
        product,
        health,
        root: &root,
        state_root: &state_root,
        trust,
        scope,
    };
    let Some(operation_id) = store::read_optional_json::<String>(&state_root.join("active.json"))?
    else {
        return Ok(());
    };
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
    product: &'a LinuxProduct,
    health: &'a dyn ServiceHealth,
    root: &'a Path,
    state_root: &'a Path,
    trust: Option<ReleaseTrust>,
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
        self.verify_release_authority(&operation)?;
        let artifact_size = operation
            .artifact_size
            .filter(|size| *size > 0)
            .ok_or_else(|| {
                RunnerFailure::new(
                    "artifact_size_invalid",
                    "The queued update has no valid artifact size bound.",
                )
            })?;
        let prepared = state_root
            .join("downloads")
            .join(format!("{operation_id}.tar.gz"));
        let archive = copy_prepared_artifact(
            root,
            operation_id,
            &prepared,
            &operation.target.sha256,
            artifact_size,
        )?;
        report_progress(state_root, operation_id, HostUpdateProgress::Verifying)?;
        verify_file_digest(&archive, &operation.target.sha256).map_err(|_| {
            RunnerFailure::new(
                "artifact_digest_mismatch",
                "The downloaded update did not match its signed digest.",
            )
        })?;
        validate_archive(self.product, &archive)?;
        let generation = root.join("generations").join(&operation.target.sha256);
        report_progress(state_root, operation_id, HostUpdateProgress::Extracting)?;
        if generation.exists() {
            verify_generation(self.product, &generation, &operation.target)?;
        } else {
            stage_generation(self.product, root, operation_id, &archive, &operation)?;
        }
        set_restart_started(state_root, operation_id, &operation.journal.nonce).map_err(|_| {
            RunnerFailure::new("journal_write_failed", "Cannot persist restart state.")
        })?;
        report_progress(state_root, operation_id, HostUpdateProgress::Restarting)?;
        switch_current(root, &format!("generations/{}", operation.target.sha256))?;
        restart_service(self.scope, self.product)?;
        report_progress(state_root, operation_id, HostUpdateProgress::CheckingHealth)?;
        self.wait_for_exact_target(&operation)?;
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
        let _ = fs::remove_file(archive);
        let _ = fs::remove_file(prepared);
        Ok(())
    }

    fn verify_release_authority(&self, operation: &OperationRecord) -> Result<(), RunnerFailure> {
        let trust = self.trust.as_ref().ok_or_else(|| {
            RunnerFailure::new(
                "release_authority_unavailable",
                "The activation guardian has no embedded release authority.",
            )
        })?;
        let envelope = operation.release.as_ref().ok_or_else(|| {
            RunnerFailure::new(
                "release_authority_missing",
                "The queued update has no signed release authority.",
            )
        })?;
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
        let accepted_sequence = store::read_json::<u64>(
            &self.state_root.join("highest-sequence.json"),
        )
        .map_err(|_| {
            RunnerFailure::new(
                "release_sequence_unavailable",
                "The accepted release sequence is unreadable.",
            )
        })?;
        if accepted_sequence != operation.release_sequence {
            return Err(RunnerFailure::new(
                "release_sequence_mismatch",
                "The queued update does not match the accepted release sequence.",
            ));
        }
        let admission = ReleaseAdmission {
            trusted_key_id: &trust.key_id,
            platform: self.product.platform,
            current_version: &current.version,
            current_digest: &current.artifact_digest,
            highest_sequence: operation.release_sequence.saturating_sub(1),
            state_epoch: 1,
            bootstrap_version: HOST_UPDATE_BOOTSTRAP_VERSION,
            journal_version: HOST_UPDATE_JOURNAL_VERSION,
        };
        let (descriptor, target, fingerprint) = admit_signed_release(
            envelope,
            &trust.public_key_spki,
            unix_millis() / 1_000,
            &admission,
        )
        .map_err(|_| {
            RunnerFailure::new(
                "release_authority_invalid",
                "The activation guardian rejected the signed release authority.",
            )
        })?;
        if descriptor.sequence != operation.release_sequence
            || target != operation.target
            || fingerprint != operation.journal.target_fingerprint
            || operation.activation_admitted != Some(true)
        {
            return Err(RunnerFailure::new(
                "release_authority_mismatch",
                "The queued update does not match its signed release authority.",
            ));
        }
        Ok(())
    }

    fn wait_for_exact_target(&self, operation: &OperationRecord) -> Result<(), RunnerFailure> {
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
        while unix_millis() <= deadline {
            if target_is_ready(self.root, self.health, operation) {
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
            healthy = rollback_is_ready(root, self.health, &operation);
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

pub(super) fn verify_file_digest(path: &Path, expected: &str) -> io::Result<()> {
    let mut file = File::open(path)?;
    let actual = digest_reader(&mut file)?;
    (actual == expected)
        .then_some(())
        .ok_or_else(|| io::Error::other("artifact digest mismatch"))
}

fn copy_prepared_artifact(
    root: &Path,
    operation_id: &str,
    prepared: &Path,
    expected_digest: &str,
    expected_size: u64,
) -> Result<PathBuf, RunnerFailure> {
    let trusted_root = root.join("activation");
    store::private_directory(&trusted_root).map_err(|_| {
        RunnerFailure::new(
            "activation_storage_failed",
            "Cannot prepare trusted activation storage.",
        )
    })?;
    let target = trusted_root.join(format!("{operation_id}.tar.gz"));
    if regular_file_matches(&target, expected_digest, expected_size) {
        return Ok(target);
    }
    if target.exists() {
        return Err(RunnerFailure::new(
            "activation_artifact_collision",
            "Trusted activation storage already contains different bytes.",
        ));
    }
    let mut source = OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW)
        .open(prepared)
        .map_err(|_| {
            RunnerFailure::new(
                "prepared_artifact_unavailable",
                "The prepared update artifact is unavailable.",
            )
        })?;
    if !source.metadata().is_ok_and(|metadata| metadata.is_file()) {
        return Err(RunnerFailure::new(
            "prepared_artifact_invalid",
            "The prepared update artifact is not a regular file.",
        ));
    }
    let temporary = trusted_root.join(format!(".{operation_id}.partial"));
    let _ = fs::remove_file(&temporary);
    let mut destination = OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(&temporary)
        .map_err(|_| {
            RunnerFailure::new(
                "activation_storage_failed",
                "Cannot create the trusted activation artifact.",
            )
        })?;
    let copied_digest = copy_bounded(&mut source, &mut destination, expected_size);
    let (copied, digest) = match copied_digest {
        Ok(result) => result,
        Err(failure) => {
            let _ = fs::remove_file(&temporary);
            return Err(failure);
        }
    };
    destination.sync_all().map_err(|_| {
        RunnerFailure::new(
            "activation_storage_failed",
            "Cannot persist the trusted activation artifact.",
        )
    })?;
    if copied != expected_size || digest != expected_digest {
        let _ = fs::remove_file(&temporary);
        return Err(RunnerFailure::new(
            "artifact_digest_mismatch",
            "The prepared update did not match its signed digest.",
        ));
    }
    fs::hard_link(&temporary, &target).map_err(|_| {
        RunnerFailure::new(
            "activation_storage_failed",
            "Cannot publish the trusted activation artifact.",
        )
    })?;
    fs::remove_file(&temporary).map_err(|_| {
        RunnerFailure::new(
            "activation_storage_failed",
            "Cannot finalize the trusted activation artifact.",
        )
    })?;
    store::sync_directory(&trusted_root).map_err(|_| {
        RunnerFailure::new(
            "activation_storage_failed",
            "Cannot persist trusted activation metadata.",
        )
    })?;
    Ok(target)
}

fn regular_file_matches(path: &Path, expected_digest: &str, expected_size: u64) -> bool {
    let Ok(mut file) = OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW)
        .open(path)
    else {
        return false;
    };
    let Ok(metadata) = file.metadata() else {
        return false;
    };
    if !metadata.is_file() || metadata.len() != expected_size {
        return false;
    }
    digest_reader(&mut file).is_ok_and(|digest| digest == expected_digest)
}

fn digest_reader(reader: &mut impl io::Read) -> io::Result<String> {
    let mut hasher = Sha256::new();
    let mut buffer = vec![0_u8; 64 * 1024].into_boxed_slice();
    loop {
        let read = reader.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(hex::encode(hasher.finalize()))
}

fn copy_bounded(
    source: &mut File,
    destination: &mut File,
    expected_size: u64,
) -> Result<(u64, String), RunnerFailure> {
    let mut hasher = Sha256::new();
    let mut buffer = vec![0_u8; 64 * 1024].into_boxed_slice();
    let mut copied = 0_u64;
    loop {
        let read = source.read(&mut buffer).map_err(|_| {
            RunnerFailure::new(
                "prepared_artifact_unreadable",
                "The prepared update artifact could not be read.",
            )
        })?;
        if read == 0 {
            break;
        }
        copied = copied.saturating_add(read as u64);
        if copied > expected_size {
            return Err(RunnerFailure::new(
                "artifact_size_mismatch",
                "The prepared update exceeded its accepted size bound.",
            ));
        }
        hasher.update(&buffer[..read]);
        destination.write_all(&buffer[..read]).map_err(|_| {
            RunnerFailure::new(
                "activation_storage_failed",
                "Cannot copy the trusted activation artifact.",
            )
        })?;
    }
    Ok((copied, hex::encode(hasher.finalize())))
}

fn validate_archive(product: &LinuxProduct, archive: &Path) -> Result<(), RunnerFailure> {
    let output = Command::new("tar")
        .args(["-tzf"])
        .arg(archive)
        .output()
        .map_err(|_| RunnerFailure::new("archive_tool_unavailable", "tar is not available."))?;
    if !output.status.success() {
        return Err(RunnerFailure::new(
            "archive_invalid",
            "The update archive is invalid.",
        ));
    }
    let listing = String::from_utf8(output.stdout).map_err(|_| {
        RunnerFailure::new("archive_invalid", "The update archive has invalid paths.")
    })?;
    let bundle_directory = product.bundle_directory;
    let expected_prefix = format!("{bundle_directory}/");
    if listing.lines().any(|line| {
        line.starts_with('/')
            || line.split('/').any(|component| component == "..")
            || (line != bundle_directory && !line.starts_with(&expected_prefix))
    }) {
        return Err(RunnerFailure::new(
            "archive_unsafe_path",
            "The update archive contains an unsafe path.",
        ));
    }
    let verbose = Command::new("tar")
        .args(["-tvzf"])
        .arg(archive)
        .output()
        .map_err(|_| RunnerFailure::new("archive_tool_unavailable", "tar is not available."))?;
    if !verbose.status.success()
        || verbose
            .stdout
            .split(|byte| *byte == b'\n')
            .filter_map(|line| line.first().copied())
            .any(|kind| kind != b'-' && kind != b'd')
    {
        return Err(RunnerFailure::new(
            "archive_unsafe_entry",
            "The update archive contains a link or special file.",
        ));
    }
    Ok(())
}

fn stage_generation(
    product: &LinuxProduct,
    root: &Path,
    operation_id: &str,
    archive: &Path,
    operation: &OperationRecord,
) -> Result<(), RunnerFailure> {
    let generations = root.join("generations");
    store::private_directory(&generations).map_err(|_| {
        RunnerFailure::new(
            "generation_storage_failed",
            "Cannot prepare generation storage.",
        )
    })?;
    let staging = generations.join(format!(".staging-{operation_id}"));
    if staging.exists() {
        fs::remove_dir_all(&staging).map_err(|_| {
            RunnerFailure::new(
                "generation_storage_failed",
                "Cannot reset staged generation.",
            )
        })?;
    }
    store::private_directory(&staging).map_err(|_| {
        RunnerFailure::new(
            "generation_storage_failed",
            "Cannot create staged generation.",
        )
    })?;
    // Keep the modes of the verified archive instead of the runner's
    // UMask=0077, so a generation is identical whether the installer or a
    // remote update created it. The archive holds only files and directories.
    let status = Command::new("tar")
        .args(["--no-same-owner", "-xpzf"])
        .arg(archive)
        .args(["-C"])
        .arg(&staging)
        .status()
        .map_err(|_| RunnerFailure::new("archive_tool_unavailable", "tar is not available."))?;
    if !status.success() {
        return Err(RunnerFailure::new(
            "archive_extract_failed",
            "The update archive could not be extracted.",
        ));
    }
    let payload = staging.join(product.bundle_directory);
    let executable = payload.join("bin").join(product.executable_name);
    if !is_executable_regular_file(&executable)
        || !product
            .payload_executables
            .iter()
            .all(|path| is_executable_regular_file(&payload.join(path)))
    {
        return Err(RunnerFailure::new(
            "payload_incomplete",
            "The update payload is incomplete.",
        ));
    }
    let reported = Command::new(&executable)
        .arg("--version")
        .output()
        .map_err(|_| {
            RunnerFailure::new("payload_not_executable", "The new service cannot start.")
        })?;
    let expected = format!("{} {}\n", product.executable_name, operation.target.version);
    if !reported.status.success() || reported.stdout != expected.as_bytes() {
        return Err(RunnerFailure::new(
            "payload_version_mismatch",
            "The new service reports the wrong version.",
        ));
    }
    strip_bootstrap_payload(product, &payload)?;
    store::write_json(
        &payload.join("metadata.json"),
        &GenerationMetadataV1 {
            schema_version: 1,
            version: operation.target.version.clone(),
            build: operation.target.build.clone(),
            source_revision: operation.target.source_revision.clone(),
            artifact_digest: operation.target.sha256.clone(),
        },
    )
    .map_err(|_| {
        RunnerFailure::new(
            "generation_storage_failed",
            "Cannot persist generation metadata.",
        )
    })?;
    sync_tree(&payload).map_err(|_| {
        RunnerFailure::new(
            "generation_storage_failed",
            "Cannot persist the staged generation.",
        )
    })?;
    let target = root.join("generations").join(&operation.target.sha256);
    publish_generation(&payload, &target)?;
    store::sync_directory(&root.join("generations")).map_err(|_| {
        RunnerFailure::new(
            "generation_storage_failed",
            "Cannot persist generation activation.",
        )
    })?;
    let _ = fs::remove_dir_all(staging);
    Ok(())
}

fn publish_generation(payload: &Path, target: &Path) -> Result<(), RunnerFailure> {
    rustix::fs::renameat_with(
        rustix::fs::CWD,
        payload,
        rustix::fs::CWD,
        target,
        rustix::fs::RenameFlags::NOREPLACE,
    )
    .map_err(|_| {
        RunnerFailure::new(
            "generation_collision",
            "Cannot publish a generation over an existing path.",
        )
    })
}

fn is_executable_regular_file(path: &Path) -> bool {
    fs::symlink_metadata(path).is_ok_and(|metadata| {
        metadata.file_type().is_file() && metadata.permissions().mode() & 0o111 != 0
    })
}

fn strip_bootstrap_payload(product: &LinuxProduct, payload: &Path) -> Result<(), RunnerFailure> {
    for entry in product.bootstrap_only {
        let path = payload.join(entry);
        let removed = match fs::symlink_metadata(&path) {
            Ok(metadata) if metadata.is_dir() => fs::remove_dir_all(&path),
            Ok(_) => fs::remove_file(&path),
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(error),
        };
        removed.map_err(|_| {
            RunnerFailure::new(
                "payload_sanitization_failed",
                "Cannot remove bootstrap-only update payload files.",
            )
        })?;
    }
    Ok(())
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

fn restart_service(scope: SystemdScope, product: &LinuxProduct) -> Result<(), RunnerFailure> {
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

fn read_operation(state_root: &Path, operation_id: &str) -> io::Result<OperationRecord> {
    store::read_json(
        &state_root
            .join("operations")
            .join(format!("{operation_id}.json")),
    )
}

fn write_operation(state_root: &Path, operation: &OperationRecord) -> io::Result<()> {
    store::write_json(
        &state_root
            .join("operations")
            .join(format!("{}.json", operation.journal.operation_id)),
        operation,
    )
}

fn verify_generation(
    product: &LinuxProduct,
    path: &Path,
    target: &ReleaseTargetV1,
) -> Result<(), RunnerFailure> {
    if !fs::symlink_metadata(path)
        .is_ok_and(|metadata| metadata.is_dir() && !metadata.file_type().is_symlink())
    {
        return Err(RunnerFailure::new(
            "generation_collision",
            "The generation path is not a directory owned by the updater.",
        ));
    }
    let metadata: GenerationMetadataV1 =
        store::read_json(&path.join("metadata.json")).map_err(|_| {
            RunnerFailure::new(
                "generation_collision",
                "An invalid generation already exists.",
            )
        })?;
    if metadata.schema_version != 1
        || metadata.version != target.version
        || metadata.build != target.build
        || metadata.source_revision != target.source_revision
        || metadata.artifact_digest != target.sha256
        || !is_executable_regular_file(&path.join("bin").join(product.executable_name))
        || !product
            .payload_executables
            .iter()
            .all(|executable| is_executable_regular_file(&path.join(executable)))
        || product
            .bootstrap_only
            .iter()
            .any(|entry| fs::symlink_metadata(path.join(entry)).is_ok())
    {
        return Err(RunnerFailure::new(
            "generation_collision",
            "Generation metadata does not match the signed target.",
        ));
    }
    Ok(())
}

fn sync_tree(path: &Path) -> io::Result<()> {
    for entry in walkdir::WalkDir::new(path).contents_first(true) {
        let entry = entry.map_err(io::Error::other)?;
        if entry.file_type().is_file() {
            File::open(entry.path())?.sync_all()?;
        } else if entry.file_type().is_dir() {
            store::sync_directory(entry.path())?;
        }
    }
    Ok(())
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
