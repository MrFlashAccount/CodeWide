//! Fake `claude` executables for the tests: a link to the checked-in
//! `fixtures/bin/claude`, which runs the test's shell script with `sh`.

use std::{
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
};

static NEXT: AtomicU64 = AtomicU64::new(1);

/// A new fake `claude` in `directory` that runs `script` (shell commands)
/// and returns its path.
pub fn fake_claude(directory: &Path, script: &str) -> PathBuf {
    let path = directory.join(format!("claude-{}", NEXT.fetch_add(1, Ordering::Relaxed)));
    let mut behaviour = path.clone().into_os_string();
    behaviour.push(".sh");
    std::fs::write(&behaviour, script).unwrap_or_else(|error| panic!("{error}"));
    let fixture = Path::new(env!("CARGO_MANIFEST_DIR")).join("fixtures/bin/claude");
    std::os::unix::fs::symlink(fixture, &path).unwrap_or_else(|error| panic!("{error}"));
    path
}
