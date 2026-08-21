#![allow(clippy::expect_used)]

use std::path::Path;

use codewide_companion::vcs::{VcsPluginConfig, VcsScope, VcsService, WORKSPACE_CREATE_CAPABILITY};
use tokio::process::Command;

fn git_plugin() -> std::path::PathBuf {
    std::path::PathBuf::from(env!("CARGO_BIN_EXE_codewide-vcs-git"))
}

async fn git(root: &Path, arguments: &[&str]) {
    let output = Command::new("git")
        .arg("-C")
        .arg(root)
        .args(arguments)
        .output()
        .await
        .expect("git starts");
    assert!(
        output.status.success(),
        "git {} failed: {}",
        arguments.join(" "),
        String::from_utf8_lossy(&output.stderr)
    );
}

#[tokio::test]
async fn git_runs_only_through_the_json_rpc_registry() {
    let directory = tempfile::tempdir().expect("temp directory");
    let state_directory = tempfile::tempdir().expect("state directory");
    git(
        directory.path(),
        &["init", "--quiet", "--initial-branch=main"],
    )
    .await;
    git(
        directory.path(),
        &["config", "user.email", "test@example.com"],
    )
    .await;
    git(directory.path(), &["config", "user.name", "Test"]).await;

    let path = directory.path().join("file.txt");
    tokio::fs::write(&path, "base\n")
        .await
        .expect("base file writes");
    git(directory.path(), &["add", "file.txt"]).await;
    git(directory.path(), &["commit", "--quiet", "-m", "base"]).await;
    tokio::fs::write(&path, "changed\n")
        .await
        .expect("changed file writes");

    let registry_path = state_directory.path().join("vcs-plugins.json");
    let service = VcsService::new(registry_path);
    service
        .registry()
        .install(VcsPluginConfig {
            id: "git".into(),
            executable: git_plugin(),
            args: Vec::new(),
            enabled: true,
            priority: -1000,
        })
        .expect("Git plugin registers");

    let snapshot = service
        .changes(directory.path(), VcsScope::Unstaged)
        .await
        .expect("Git plugin returns changes");
    assert_eq!(snapshot.repository.provider, "git");
    assert_eq!(snapshot.files.len(), 1);
    assert_eq!(snapshot.files[0].additions, Some(1));
    assert_eq!(snapshot.files[0].deletions, Some(1));

    let diff = service
        .diff(directory.path(), &path, VcsScope::Unstaged)
        .await
        .expect("Git plugin returns a diff");
    assert_eq!(diff.repository.provider, "git");
    assert!(diff.diff.contains("-base\n+changed"));
}

#[tokio::test]
async fn git_workspace_creation_is_capability_gated_and_idempotent() {
    let repository = tempfile::tempdir().expect("repository");
    let state = tempfile::tempdir().expect("state");
    let storage = tempfile::tempdir().expect("workspace storage");
    git(
        repository.path(),
        &["init", "--quiet", "--initial-branch=main"],
    )
    .await;
    git(
        repository.path(),
        &["config", "user.email", "test@example.com"],
    )
    .await;
    git(repository.path(), &["config", "user.name", "Test"]).await;
    tokio::fs::create_dir(repository.path().join("nested"))
        .await
        .expect("nested directory");
    tokio::fs::write(repository.path().join("nested/file.txt"), "base\n")
        .await
        .expect("base file");
    git(repository.path(), &["add", "."]).await;
    git(repository.path(), &["commit", "--quiet", "-m", "base"]).await;

    let service = VcsService::new(state.path().join("vcs-plugins.json"));
    service
        .registry()
        .install(VcsPluginConfig {
            id: "git".into(),
            executable: git_plugin(),
            args: Vec::new(),
            enabled: true,
            priority: -1000,
        })
        .expect("Git plugin registers");

    let selected_cwd = repository.path().join("nested");
    let support = service
        .workspace_support(&selected_cwd)
        .await
        .expect("support inspection succeeds")
        .expect("Git owns workspace");
    assert_eq!(support.capability, WORKSPACE_CREATE_CAPABILITY);
    assert_eq!(support.provider, "git");

    let first = service
        .create_workspace(&selected_cwd, "new-chat-1", storage.path())
        .await
        .expect("workspace creates");
    assert!(first.created);
    assert!(first.cwd.ends_with("nested"));
    assert!(first.cwd.join("file.txt").is_file());

    let second = service
        .create_workspace(&selected_cwd, "new-chat-1", storage.path())
        .await
        .expect("retry resolves the same workspace");
    assert!(!second.created);
    assert_eq!(second.cwd, first.cwd);

    git(
        repository.path(),
        &[
            "worktree",
            "remove",
            "--force",
            first.repository_root.to_str().expect("UTF-8 path"),
        ],
    )
    .await;
}
