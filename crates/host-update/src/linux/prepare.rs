//! Network-facing preparation of a complete generation by the product.
//!
//! The activation guardian never calls this module. It consumes only the
//! operation-specific, durably published generation and therefore knows
//! nothing about release manifests, URLs, archives, or payload construction.

use std::{
    fs::{self, OpenOptions},
    io::{Read as _, Write as _},
    os::unix::fs::OpenOptionsExt as _,
    path::{Path, PathBuf},
    process::Command,
    time::Duration,
};

use futures_util::StreamExt as _;
use sha2::{Digest as _, Sha256};

use super::{
    GenerationMetadataV1, HostUpdateProgress, LinuxProduct, OperationRecord, generation,
    host_resolver::HostResolver,
    runner::{RunnerFailure, report_progress},
    store,
};

pub(super) async fn prepare_generation(
    product: &LinuxProduct,
    root: &Path,
    operation: &OperationRecord,
    expected_size: u64,
    state_root: &Path,
    operation_id: &str,
) -> Result<PathBuf, RunnerFailure> {
    let expected = activation_target(operation);
    let prepared = generation::prepared_path(root, operation_id);
    if prepared.exists() {
        verify_prepared_generation(product, &prepared, &expected)?;
        return Ok(prepared);
    }
    let download_root = state_root.join("downloads");
    store::private_directory(&download_root).map_err(|_| {
        RunnerFailure::new(
            "download_storage_failed",
            "Cannot prepare download storage.",
        )
    })?;
    let archive = download_root.join(format!("{operation_id}.tar.gz"));
    if !archive.is_file() || verify_file_digest(&archive, &operation.target.sha256).is_err() {
        remove_if_present(&archive).map_err(|_| {
            RunnerFailure::new(
                "download_storage_failed",
                "Cannot replace an invalid prepared artifact.",
            )
        })?;
        download(
            &operation.target.artifact_url,
            &archive,
            expected_size,
            state_root,
            operation_id,
        )
        .await?;
    }
    report_progress(state_root, operation_id, HostUpdateProgress::Verifying)?;
    verify_file_digest(&archive, &operation.target.sha256).map_err(|_| {
        let _ = remove_if_present(&archive);
        RunnerFailure::new(
            "artifact_digest_mismatch",
            "The downloaded update did not match its signed digest.",
        )
    })?;
    validate_archive(product, &archive)?;
    report_progress(state_root, operation_id, HostUpdateProgress::Extracting)?;
    stage_preparation(product, root, operation_id, &archive, operation)?;
    let _ = remove_if_present(&archive);
    verify_prepared_generation(product, &prepared, &expected)?;
    Ok(prepared)
}

fn verify_prepared_generation(
    product: &LinuxProduct,
    path: &Path,
    expected: &GenerationMetadataV1,
) -> Result<(), RunnerFailure> {
    generation::verify(&product.activation, path, expected)?;
    if !product
        .payload_executables
        .iter()
        .all(|executable| generation::is_executable_regular_file(&path.join(executable)))
        || product
            .bootstrap_only
            .iter()
            .any(|entry| fs::symlink_metadata(path.join(entry)).is_ok())
    {
        return Err(RunnerFailure::new(
            "generation_collision",
            "Prepared generation layout does not match the product contract.",
        ));
    }
    Ok(())
}

pub(super) fn activation_target(operation: &OperationRecord) -> GenerationMetadataV1 {
    GenerationMetadataV1 {
        schema_version: 1,
        version: operation.target.version.clone(),
        build: operation.target.build.clone(),
        source_revision: operation.target.source_revision.clone(),
        artifact_digest: operation.target.sha256.clone(),
    }
}

pub(super) async fn download(
    url: &str,
    target: &Path,
    expected_size: u64,
    state_root: &Path,
    operation_id: &str,
) -> Result<(), RunnerFailure> {
    report_progress(
        state_root,
        operation_id,
        HostUpdateProgress::Downloading {
            downloaded_bytes: 0,
            total_bytes: Some(expected_size),
        },
    )?;
    let response = download_response(url, operation_id).await?;
    let response_size = response.content_length();
    if response_size.is_some_and(|actual| expected_size != actual) {
        return Err(RunnerFailure::new(
            "artifact_size_mismatch",
            "The update download size did not match its accepted bound.",
        ));
    }
    let temporary = target.with_extension("partial");
    remove_if_present(&temporary).map_err(|_| {
        RunnerFailure::new(
            "download_storage_failed",
            "Cannot reset the interrupted download.",
        )
    })?;
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
    let downloaded =
        receive_download(response, &mut file, expected_size, state_root, operation_id).await;
    match downloaded {
        Ok(_) => {}
        Err(failure) => {
            let _ = remove_if_present(&temporary);
            return Err(failure);
        }
    }
    file.sync_all().map_err(|_| {
        RunnerFailure::new(
            "download_storage_failed",
            "Cannot persist the update download.",
        )
    })?;
    publish_download(&temporary, target, state_root)?;
    Ok(())
}

async fn receive_download(
    response: reqwest::Response,
    file: &mut std::fs::File,
    expected_size: u64,
    state_root: &Path,
    operation_id: &str,
) -> Result<u64, RunnerFailure> {
    let mut downloaded_bytes = 0_u64;
    let mut published_at = std::time::Instant::now();
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|error| {
            let error = error.without_url();
            tracing::error!(err = ?error, operation_id, "Signed update download was interrupted");
            RunnerFailure::new("download_failed", "The update download was interrupted.")
        })?;
        downloaded_bytes = downloaded_bytes.saturating_add(chunk.len() as u64);
        if downloaded_bytes > expected_size {
            return Err(RunnerFailure::new(
                "artifact_too_large",
                "The update download exceeded its accepted bound.",
            ));
        }
        file.write_all(&chunk).map_err(|_| {
            RunnerFailure::new(
                "download_storage_failed",
                "Cannot store the update download.",
            )
        })?;
        if published_at.elapsed() >= Duration::from_secs(1) {
            report_progress(
                state_root,
                operation_id,
                HostUpdateProgress::Downloading {
                    downloaded_bytes,
                    total_bytes: Some(expected_size),
                },
            )?;
            published_at = std::time::Instant::now();
        }
    }
    if downloaded_bytes != expected_size {
        return Err(RunnerFailure::new(
            "artifact_size_mismatch",
            "The update download size did not match its accepted bound.",
        ));
    }
    report_progress(
        state_root,
        operation_id,
        HostUpdateProgress::Downloading {
            downloaded_bytes,
            total_bytes: Some(expected_size),
        },
    )?;
    Ok(downloaded_bytes)
}

fn publish_download(
    temporary: &Path,
    target: &Path,
    state_root: &Path,
) -> Result<(), RunnerFailure> {
    // A hard-link publication is no-replace: an existing name is never
    // silently overwritten by a competing or compromised preparer.
    fs::hard_link(temporary, target).map_err(|_| {
        RunnerFailure::new(
            "download_storage_failed",
            "Cannot publish the update download.",
        )
    })?;
    fs::remove_file(temporary).map_err(|_| {
        RunnerFailure::new(
            "download_storage_failed",
            "Cannot finalize the update download.",
        )
    })?;
    store::sync_directory(target.parent().unwrap_or(state_root)).map_err(|_| {
        RunnerFailure::new(
            "download_storage_failed",
            "Cannot persist download metadata.",
        )
    })?;
    Ok(())
}

async fn download_response(
    url: &str,
    operation_id: &str,
) -> Result<reqwest::Response, RunnerFailure> {
    reqwest::Client::builder()
        .dns_resolver(std::sync::Arc::new(HostResolver))
        .redirect(reqwest::redirect::Policy::limited(3))
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_mins(4))
        .build()
        .map_err(|error| {
            let error = error.without_url();
            tracing::error!(err = ?error, operation_id, "Cannot initialize update downloader");
            RunnerFailure::new(
                "download_client_failed",
                "Cannot initialize the downloader.",
            )
        })?
        .get(url)
        .send()
        .await
        .and_then(reqwest::Response::error_for_status)
        .map_err(|error| {
            let error = error.without_url();
            tracing::error!(err = ?error, operation_id, "Signed update download request failed");
            RunnerFailure::new(
                "download_failed",
                "The signed update could not be downloaded.",
            )
        })
}

pub(super) fn validate_archive(
    product: &LinuxProduct,
    archive: &Path,
) -> Result<(), RunnerFailure> {
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

fn stage_preparation(
    product: &LinuxProduct,
    root: &Path,
    operation_id: &str,
    archive: &Path,
    operation: &OperationRecord,
) -> Result<(), RunnerFailure> {
    let preparations = root.join("preparations");
    store::private_directory(&preparations).map_err(|_| {
        RunnerFailure::new(
            "generation_storage_failed",
            "Cannot prepare generation storage.",
        )
    })?;
    let staging = preparations.join(format!(".staging-{operation_id}"));
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
    let executable = payload.join("bin").join(product.activation.executable_name);
    if !generation::is_executable_regular_file(&executable)
        || !product
            .payload_executables
            .iter()
            .all(|path| generation::is_executable_regular_file(&payload.join(path)))
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
    let expected = format!(
        "{} {}\n",
        product.activation.executable_name, operation.target.version
    );
    if !reported.status.success() || reported.stdout != expected.as_bytes() {
        return Err(RunnerFailure::new(
            "payload_version_mismatch",
            "The new service reports the wrong version.",
        ));
    }
    strip_bootstrap_payload(product, &payload)?;
    store::write_json(
        &payload.join("metadata.json"),
        &activation_target(operation),
    )
    .map_err(|_| {
        RunnerFailure::new(
            "generation_storage_failed",
            "Cannot persist generation metadata.",
        )
    })?;
    generation::sync_tree(&payload).map_err(|_| {
        RunnerFailure::new(
            "generation_storage_failed",
            "Cannot persist the prepared generation.",
        )
    })?;
    let prepared = generation::prepared_path(root, operation_id);
    generation::publish_directory(&payload, &prepared)?;
    store::sync_directory(&preparations).map_err(|_| {
        RunnerFailure::new(
            "generation_storage_failed",
            "Cannot persist the prepared generation.",
        )
    })?;
    let _ = fs::remove_dir_all(staging);
    Ok(())
}

pub(super) fn strip_bootstrap_payload(
    product: &LinuxProduct,
    payload: &Path,
) -> Result<(), RunnerFailure> {
    for entry in product.bootstrap_only {
        let path = payload.join(entry);
        let removed = match fs::symlink_metadata(&path) {
            Ok(metadata) if metadata.is_dir() => fs::remove_dir_all(&path),
            Ok(_) => fs::remove_file(&path),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
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

pub(super) fn verify_file_digest(path: &Path, expected: &str) -> std::io::Result<()> {
    let mut file = fs::File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0_u8; 64 * 1024].into_boxed_slice();
    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    let actual = hex::encode(hasher.finalize());
    (actual == expected)
        .then_some(())
        .ok_or_else(|| std::io::Error::other("artifact digest mismatch"))
}

fn remove_if_present(path: &Path) -> std::io::Result<()> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error),
    }
}
