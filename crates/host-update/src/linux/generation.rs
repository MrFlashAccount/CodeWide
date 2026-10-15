//! Stable local generation contract shared by preparation and activation.

use std::{
    fs::{self, File},
    io,
    os::unix::fs::PermissionsExt as _,
    path::Path,
};

use super::{GenerationMetadataV1, LinuxActivationProduct, runner::RunnerFailure, store};

pub(super) fn prepared_path(root: &Path, operation_id: &str) -> std::path::PathBuf {
    root.join("preparations").join(operation_id)
}

pub(super) fn publish_directory(payload: &Path, target: &Path) -> Result<(), RunnerFailure> {
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

pub(super) fn verify(
    product: &LinuxActivationProduct,
    path: &Path,
    expected: &GenerationMetadataV1,
) -> Result<(), RunnerFailure> {
    if !fs::symlink_metadata(path)
        .is_ok_and(|metadata| metadata.is_dir() && !metadata.file_type().is_symlink())
    {
        return Err(RunnerFailure::new(
            "generation_collision",
            "The generation path is not an updater-owned directory.",
        ));
    }
    let metadata: GenerationMetadataV1 =
        store::read_json(&path.join("metadata.json")).map_err(|_| {
            RunnerFailure::new("generation_collision", "Generation metadata is unreadable.")
        })?;
    if metadata != *expected
        || !is_executable_regular_file(&path.join("bin").join(product.executable_name))
    {
        return Err(RunnerFailure::new(
            "generation_collision",
            "Generation metadata does not match the prepared target.",
        ));
    }
    Ok(())
}

pub(super) fn is_executable_regular_file(path: &Path) -> bool {
    fs::symlink_metadata(path).is_ok_and(|metadata| {
        metadata.file_type().is_file() && metadata.permissions().mode() & 0o111 != 0
    })
}

pub(super) fn sync_tree(path: &Path) -> io::Result<()> {
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
