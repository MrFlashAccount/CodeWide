//! Stable transaction runner for Linux Companion generations.

use std::{
    fs::{self, File, OpenOptions},
    io::{self, Write},
    os::unix::fs::{OpenOptionsExt, PermissionsExt, symlink},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    time::Duration,
};

use companion_core::host_update::HostUpdatePhase;
use futures_util::StreamExt;
use sha2::{Digest, Sha256};

use super::{
    GenerationMetadataV1, OperationRecord,
    runner_health::{rollback_is_ready, target_is_ready},
    store, unix_millis,
};

const BUNDLE_DIRECTORY: &str = "codewide-companion-x86_64-unknown-linux-musl";

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

pub(super) async fn run_pending(
    root: PathBuf,
    state_root: PathBuf,
) -> Result<(), Box<dyn std::error::Error>> {
    let Some(operation_id) = store::read_optional_json::<String>(&state_root.join("active.json"))?
    else {
        return Ok(());
    };
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
                if let Err(failure) = install_and_verify(&root, &state_root, &operation_id).await {
                    rollback(
                        &root,
                        &state_root,
                        &operation_id,
                        failure.code,
                        &failure.detail,
                    )?;
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
                    rollback(
                        &root,
                        &state_root,
                        &operation_id,
                        "initiator_reconnect_timeout",
                        "The initiating device did not reconnect before the deadline.",
                    )?;
                    return Ok(());
                }
                tokio::time::sleep(Duration::from_millis(250)).await;
            }
            ResumeAction::ResumeRollback => {
                finish_rollback(&root, &state_root, &operation_id)?;
                return Ok(());
            }
            ResumeAction::Done => return Ok(()),
        }
    }
}

#[derive(Debug)]
struct RunnerFailure {
    code: &'static str,
    detail: String,
}

impl RunnerFailure {
    fn new(code: &'static str, detail: impl Into<String>) -> Self {
        Self {
            code,
            detail: detail.into().chars().take(160).collect(),
        }
    }
}

async fn install_and_verify(
    root: &Path,
    state_root: &Path,
    operation_id: &str,
) -> Result<(), RunnerFailure> {
    let operation = read_operation(state_root, operation_id)
        .map_err(|_| RunnerFailure::new("journal_unreadable", "Update journal is unreadable."))?;
    if unix_millis() > operation.journal.deadlines.install_by {
        return Err(RunnerFailure::new(
            "install_deadline_exceeded",
            "The update did not install before its deadline.",
        ));
    }
    let download_root = state_root.join("downloads");
    store::private_directory(&download_root).map_err(|_| {
        RunnerFailure::new(
            "download_storage_failed",
            "Cannot prepare download storage.",
        )
    })?;
    let archive = download_root.join(format!("{operation_id}.tar.gz"));
    if !archive.is_file() {
        download(&operation.target.artifact_url, &archive).await?;
    }
    verify_file_digest(&archive, &operation.target.sha256).map_err(|_| {
        RunnerFailure::new(
            "artifact_digest_mismatch",
            "The downloaded update did not match its signed digest.",
        )
    })?;
    validate_archive(&archive)?;
    let generation = root.join("generations").join(&operation.target.sha256);
    if generation.exists() {
        verify_generation(&generation, &operation.target)?;
    } else {
        stage_generation(root, operation_id, &archive, &operation)?;
    }
    set_restart_started(state_root, operation_id, &operation.journal.nonce)
        .map_err(|_| RunnerFailure::new("journal_write_failed", "Cannot persist restart state."))?;
    switch_current(root, &format!("generations/{}", operation.target.sha256))?;
    restart_companion()?;
    wait_for_exact_target(root, &operation)?;
    transition(
        state_root,
        operation_id,
        HostUpdatePhase::Installing,
        HostUpdatePhase::TargetReady,
        None,
    )
    .map_err(|_| RunnerFailure::new("journal_write_failed", "Cannot persist target readiness."))?;
    let _ = fs::remove_file(archive);
    Ok(())
}

fn verify_file_digest(path: &Path, expected: &str) -> io::Result<()> {
    let mut file = File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0_u8; 64 * 1024].into_boxed_slice();
    loop {
        let read = std::io::Read::read(&mut file, &mut buffer)?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    let actual = hex::encode(hasher.finalize());
    (actual == expected)
        .then_some(())
        .ok_or_else(|| io::Error::other("artifact digest mismatch"))
}

async fn download(url: &str, target: &Path) -> Result<(), RunnerFailure> {
    let response = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::limited(3))
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_mins(4))
        .build()
        .map_err(|_| {
            RunnerFailure::new(
                "download_client_failed",
                "Cannot initialize the downloader.",
            )
        })?
        .get(url)
        .send()
        .await
        .and_then(reqwest::Response::error_for_status)
        .map_err(|_| {
            RunnerFailure::new(
                "download_failed",
                "The signed update could not be downloaded.",
            )
        })?;
    let temporary = target.with_extension("partial");
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(&temporary)
        .map_err(|_| {
            RunnerFailure::new(
                "download_storage_failed",
                "Cannot create the download file.",
            )
        })?;
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|_| {
            RunnerFailure::new("download_failed", "The update download was interrupted.")
        })?;
        file.write_all(&chunk).map_err(|_| {
            RunnerFailure::new(
                "download_storage_failed",
                "Cannot store the update download.",
            )
        })?;
    }
    file.sync_all().map_err(|_| {
        RunnerFailure::new(
            "download_storage_failed",
            "Cannot persist the update download.",
        )
    })?;
    fs::rename(&temporary, target).map_err(|_| {
        RunnerFailure::new(
            "download_storage_failed",
            "Cannot publish the update download.",
        )
    })?;
    if let Some(parent) = target.parent() {
        store::sync_directory(parent).map_err(|_| {
            RunnerFailure::new(
                "download_storage_failed",
                "Cannot persist download metadata.",
            )
        })?;
    }
    Ok(())
}

fn validate_archive(archive: &Path) -> Result<(), RunnerFailure> {
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
    let expected_prefix = format!("{BUNDLE_DIRECTORY}/");
    if listing.lines().any(|line| {
        line.starts_with('/')
            || line.split('/').any(|component| component == "..")
            || (line != BUNDLE_DIRECTORY && !line.starts_with(&expected_prefix))
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
    let status = Command::new("tar")
        .args(["-xzf"])
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
    let payload = staging.join(BUNDLE_DIRECTORY);
    let companion = payload.join("bin/codewide-companion");
    let git_plugin = payload.join("libexec/codewide-vcs-git");
    let memory_watch = payload.join("libexec/codewide-companion-memory-watch");
    if !is_executable_regular_file(&companion)
        || !is_executable_regular_file(&git_plugin)
        || !is_executable_regular_file(&memory_watch)
    {
        return Err(RunnerFailure::new(
            "payload_incomplete",
            "The update payload is incomplete.",
        ));
    }
    let reported = Command::new(&companion)
        .arg("--version")
        .output()
        .map_err(|_| {
            RunnerFailure::new("payload_not_executable", "The new Companion cannot start.")
        })?;
    let expected = format!("codewide-companion {}\n", operation.target.version);
    if !reported.status.success() || reported.stdout != expected.as_bytes() {
        return Err(RunnerFailure::new(
            "payload_version_mismatch",
            "The new Companion reports the wrong version.",
        ));
    }
    strip_bootstrap_payload(&payload)?;
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
    fs::rename(&payload, &target).map_err(|_| {
        RunnerFailure::new(
            "generation_storage_failed",
            "Cannot publish the staged generation.",
        )
    })?;
    store::sync_directory(&root.join("generations")).map_err(|_| {
        RunnerFailure::new(
            "generation_storage_failed",
            "Cannot persist generation activation.",
        )
    })?;
    let _ = fs::remove_dir_all(staging);
    Ok(())
}

fn is_executable_regular_file(path: &Path) -> bool {
    fs::symlink_metadata(path).is_ok_and(|metadata| {
        metadata.file_type().is_file() && metadata.permissions().mode() & 0o111 != 0
    })
}

fn strip_bootstrap_payload(payload: &Path) -> Result<(), RunnerFailure> {
    for directory in [payload.join("bootstrap"), payload.join("systemd")] {
        if directory.exists() {
            fs::remove_dir_all(directory).map_err(|_| {
                RunnerFailure::new(
                    "payload_sanitization_failed",
                    "Cannot remove bootstrap-only update payload files.",
                )
            })?;
        }
    }
    for file in [
        payload.join("install.sh"),
        payload.join("libexec/codewide-companion-update-guardian"),
    ] {
        match fs::remove_file(file) {
            Ok(()) => {}
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(_) => {
                return Err(RunnerFailure::new(
                    "payload_sanitization_failed",
                    "Cannot remove bootstrap-only update payload files.",
                ));
            }
        }
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

fn restart_companion() -> Result<(), RunnerFailure> {
    command_success(
        "systemctl",
        &["--user", "restart", "codewide-companion.service"],
    )
    .then_some(())
    .ok_or_else(|| {
        RunnerFailure::new(
            "service_restart_failed",
            "The Companion service did not restart.",
        )
    })
}

fn wait_for_exact_target(root: &Path, operation: &OperationRecord) -> Result<(), RunnerFailure> {
    while unix_millis() <= operation.journal.deadlines.target_ready_by {
        if target_is_ready(root, operation) {
            return Ok(());
        }
        std::thread::sleep(Duration::from_millis(250));
    }
    Err(RunnerFailure::new(
        "target_health_timeout",
        "The updated Companion did not become healthy before the deadline.",
    ))
}

fn rollback(
    root: &Path,
    state_root: &Path,
    operation_id: &str,
    code: &str,
    detail: &str,
) -> Result<(), Box<dyn std::error::Error>> {
    let operation = read_operation(state_root, operation_id)?;
    if operation.journal.phase != HostUpdatePhase::RollingBack {
        transition(
            state_root,
            operation_id,
            operation.journal.phase,
            HostUpdatePhase::RollingBack,
            Some((code, detail)),
        )?;
    }
    finish_rollback(root, state_root, operation_id)
}

fn finish_rollback(
    root: &Path,
    state_root: &Path,
    operation_id: &str,
) -> Result<(), Box<dyn std::error::Error>> {
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
    restart_companion().map_err(|failure| io::Error::other(failure.detail))?;
    let mut healthy = false;
    while unix_millis() <= operation.journal.deadlines.rollback_by {
        healthy = rollback_is_ready(root, &operation);
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
                "The previous Companion did not recover.",
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

fn transition(
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
        operation.journal.error_code = Some(code.chars().take(80).collect());
        operation.journal.error_message = Some(detail.chars().take(160).collect());
    }
    write_operation(state_root, &operation)?;
    if next == HostUpdatePhase::RollingBack || next.is_terminal() {
        clear_available_release(state_root)?;
    }
    Ok(())
}

fn clear_available_release(state_root: &Path) -> io::Result<()> {
    match fs::remove_file(state_root.join("available.json")) {
        Ok(()) => store::sync_directory(state_root),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error),
    }
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
    path: &Path,
    target: &companion_core::host_update::ReleaseTargetV1,
) -> Result<(), RunnerFailure> {
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
        || !is_executable_regular_file(&path.join("bin/codewide-companion"))
        || !is_executable_regular_file(&path.join("libexec/codewide-vcs-git"))
        || !is_executable_regular_file(&path.join("libexec/codewide-companion-memory-watch"))
        || path.join("bootstrap").exists()
        || path.join("systemd").exists()
        || path
            .join("libexec/codewide-companion-update-guardian")
            .exists()
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

fn command_success(program: &str, args: &[&str]) -> bool {
    Command::new(program)
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
