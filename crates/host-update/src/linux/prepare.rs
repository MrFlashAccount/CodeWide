//! Network-facing preparation of a signed artifact by the unprivileged product.
//!
//! The activation guardian never calls this module. It consumes only the
//! operation-specific, durably published archive and independently verifies
//! both its signed release authority and its exact bytes.

use std::{
    fs::{self, OpenOptions},
    io::Write as _,
    os::unix::fs::OpenOptionsExt as _,
    path::{Path, PathBuf},
    time::Duration,
};

use futures_util::StreamExt as _;

use super::{
    HostUpdateProgress,
    host_resolver::HostResolver,
    runner::{RunnerFailure, report_progress, verify_file_digest},
    store,
};

pub(super) async fn prepare_artifact(
    url: &str,
    expected_digest: &str,
    expected_size: u64,
    state_root: &Path,
    operation_id: &str,
) -> Result<PathBuf, RunnerFailure> {
    let download_root = state_root.join("downloads");
    store::private_directory(&download_root).map_err(|_| {
        RunnerFailure::new(
            "download_storage_failed",
            "Cannot prepare download storage.",
        )
    })?;
    let archive = download_root.join(format!("{operation_id}.tar.gz"));
    if archive.is_file() && verify_file_digest(&archive, expected_digest).is_ok() {
        return Ok(archive);
    }
    remove_if_present(&archive).map_err(|_| {
        RunnerFailure::new(
            "download_storage_failed",
            "Cannot replace an invalid prepared artifact.",
        )
    })?;
    download(url, &archive, expected_size, state_root, operation_id).await?;
    report_progress(state_root, operation_id, HostUpdateProgress::Verifying)?;
    verify_file_digest(&archive, expected_digest).map_err(|_| {
        let _ = remove_if_present(&archive);
        RunnerFailure::new(
            "artifact_digest_mismatch",
            "The downloaded update did not match its signed digest.",
        )
    })?;
    Ok(archive)
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

fn remove_if_present(path: &Path) -> std::io::Result<()> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error),
    }
}
