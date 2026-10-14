//! Fake `claude` executables (POSIX shell scripts) for the runtime tests.

use std::{
    io::Write,
    os::unix::fs::PermissionsExt,
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
};

static NEXT: AtomicU64 = AtomicU64::new(1);

/// Writes `script` as a new executable in `directory` and returns its path.
pub fn fake_claude(directory: &Path, script: &str) -> PathBuf {
    let path = directory.join(format!("claude-{}", NEXT.fetch_add(1, Ordering::Relaxed)));
    let mut file = std::fs::File::create(&path).unwrap_or_else(|error| panic!("{error}"));
    file.write_all(script.as_bytes())
        .unwrap_or_else(|error| panic!("{error}"));
    file.sync_all().unwrap_or_else(|error| panic!("{error}"));
    drop(file);
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755))
        .unwrap_or_else(|error| panic!("{error}"));
    path
}
