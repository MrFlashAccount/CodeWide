#![allow(clippy::expect_used)]

use super::*;

async fn run_git(root: &Path, arguments: &[&str]) {
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

async fn initialize_git_repository(root: &Path) {
    run_git(root, &["init", "--quiet", "--initial-branch=main"]).await;
    run_git(root, &["config", "user.email", "test@example.com"]).await;
    run_git(root, &["config", "user.name", "Test"]).await;
}

#[test]
fn parses_porcelain_v2_snapshot() {
    let root = Path::new("/repo");
    let status = concat!(
        "# branch.oid abcdef\0",
        "# branch.head feature/vcs\0",
        "1 .M N... 100644 100644 100644 abc abc src/lib.rs\0",
        "2 R. N... 100644 100644 100644 abc def R100 src/new.rs\0",
        "src/old.rs\0",
        "? notes.txt\0",
        "u UU N... 100644 100644 100644 100644 abc def 123 conflict.rs\0",
    );
    let snapshot =
        parse_git_status(root, status.as_bytes(), VcsScope::Unstaged).expect("status parses");
    assert_eq!(snapshot.repository.branch.as_deref(), Some("feature/vcs"));
    assert_eq!(snapshot.repository.head.as_deref(), Some("abcdef"));
    assert_eq!(snapshot.state, VcsState::Conflicted);
    assert_eq!(snapshot.summary.total, 3);
    assert_eq!(snapshot.summary.modified, 1);
    assert_eq!(snapshot.summary.renamed, 0);
    assert_eq!(snapshot.summary.untracked, 1);
    assert_eq!(snapshot.summary.conflicted, 1);
    let staged =
        parse_git_status(root, status.as_bytes(), VcsScope::Staged).expect("staged status parses");
    assert_eq!(staged.summary.total, 2);
    assert_eq!(staged.summary.renamed, 1);
    let renamed = staged
        .files
        .iter()
        .find(|file| file.status == VcsFileStatus::Renamed)
        .expect("renamed file exists");
    assert_eq!(
        renamed.old_path.as_deref(),
        Some(Path::new("/repo/src/old.rs"))
    );
}

#[test]
fn parses_text_binary_and_renamed_numstat_records() {
    let stats = parse_git_numstat(
        Path::new("/repo"),
        b"3\t2\tsrc/lib.rs\0-\t-\tassets/image.png\x005\t1\t\0src/old.rs\0src/new.rs\0",
    )
    .expect("numstat parses");

    assert_eq!(stats.len(), 3);
    assert_eq!(stats[0].path, Path::new("/repo/src/lib.rs"));
    assert_eq!((stats[0].additions, stats[0].deletions), (Some(3), Some(2)));
    assert!(!stats[0].binary);
    assert_eq!(stats[1].path, Path::new("/repo/assets/image.png"));
    assert_eq!((stats[1].additions, stats[1].deletions), (None, None));
    assert!(stats[1].binary);
    assert_eq!(stats[2].path, Path::new("/repo/src/new.rs"));
    assert_eq!((stats[2].additions, stats[2].deletions), (Some(5), Some(1)));
}

#[test]
fn binary_detection_ignores_marker_text_inside_a_hunk() {
    let text = "diff --git a/a.rs b/a.rs\n--- a/a.rs\n+++ b/a.rs\n@@ -0,0 +1 @@\n+const label = \"Binary files are supported\";\n";
    let binary = "diff --git a/a.png b/a.png\nBinary files a/a.png and b/a.png differ\n";
    assert!(!is_binary_diff(text));
    assert!(is_binary_diff(binary));
}

#[test]
fn clean_snapshot_is_stable() {
    let first = parse_git_status(
        Path::new("/repo"),
        b"# branch.oid abcdef\0# branch.head main\0",
        VcsScope::Unstaged,
    )
    .expect("status parses");
    let second = parse_git_status(
        Path::new("/repo"),
        b"# branch.oid abcdef\0# branch.head main\0",
        VcsScope::Unstaged,
    )
    .expect("status parses");
    assert_eq!(first.state, VcsState::Clean);
    assert_eq!(first.snapshot_id, second.snapshot_id);
}

#[tokio::test]
async fn git_provider_detects_repository() {
    let directory = tempfile::tempdir().expect("temp directory");
    let init = Command::new("git")
        .arg("init")
        .arg("--quiet")
        .arg(directory.path())
        .output()
        .await
        .expect("git starts");
    assert!(init.status.success());
    let root = GitProvider
        .detect(directory.path())
        .await
        .expect("detect succeeds")
        .expect("repository detected");
    assert_eq!(
        root.canonicalize().expect("root canonicalizes"),
        directory.path().canonicalize().expect("temp canonicalizes")
    );
}

#[tokio::test]
async fn git_diff_combines_the_current_file_against_head() {
    let directory = tempfile::tempdir().expect("temp directory");
    for arguments in [
        vec!["init", "--quiet"],
        vec!["config", "user.email", "test@example.com"],
        vec!["config", "user.name", "Test"],
    ] {
        let output = Command::new("git")
            .arg("-C")
            .arg(directory.path())
            .args(arguments)
            .output()
            .await
            .expect("git starts");
        assert!(output.status.success());
    }
    let path = directory.path().join("file.txt");
    tokio::fs::write(&path, "old\n").await.expect("file writes");
    for arguments in [
        vec!["add", "file.txt"],
        vec!["commit", "--quiet", "-m", "base"],
    ] {
        let output = Command::new("git")
            .arg("-C")
            .arg(directory.path())
            .args(arguments)
            .output()
            .await
            .expect("git starts");
        assert!(output.status.success());
    }
    tokio::fs::write(&path, "new\nnext\n")
        .await
        .expect("file updates");
    let provider = GitProvider;
    let snapshot = provider
        .changes(directory.path(), VcsScope::Unstaged)
        .await
        .expect("snapshot loads");
    let file = snapshot.files.first().expect("changed file exists");
    assert_eq!((file.additions, file.deletions), (Some(2), Some(1)));
    let diff = provider.diff(&snapshot, file).await.expect("diff loads");
    assert_eq!(diff.repository.provider, "git");
    assert_eq!((diff.additions, diff.deletions), (2, 1));
    assert!(diff.diff.contains("-old\n+new\n+next"));
}

#[tokio::test]
async fn git_diff_synthesizes_untracked_files() {
    let directory = tempfile::tempdir().expect("temp directory");
    let init = Command::new("git")
        .arg("init")
        .arg("--quiet")
        .arg(directory.path())
        .output()
        .await
        .expect("git starts");
    assert!(init.status.success());
    let path = directory.path().join("new.txt");
    tokio::fs::write(&path, "first\nsecond\n")
        .await
        .expect("file writes");
    let provider = GitProvider;
    let snapshot = provider
        .changes(directory.path(), VcsScope::Unstaged)
        .await
        .expect("snapshot loads");
    let file = snapshot.files.first().expect("changed file exists");
    assert_eq!((file.additions, file.deletions), (Some(2), Some(0)));
    let diff = provider.diff(&snapshot, file).await.expect("diff loads");
    assert_eq!(diff.status, VcsFileStatus::Untracked);
    assert_eq!((diff.additions, diff.deletions), (2, 0));
    assert!(diff.diff.contains("--- /dev/null\n+++ b/new.txt"));
}

#[cfg(unix)]
#[tokio::test]
async fn git_diff_records_untracked_symlink_target_without_following_it() {
    let directory = tempfile::tempdir().expect("temp directory");
    let outside = tempfile::tempdir().expect("outside directory");
    initialize_git_repository(directory.path()).await;
    tokio::fs::symlink(outside.path(), directory.path().join("builds"))
        .await
        .expect("symlink creates");
    let provider = GitProvider;
    let snapshot = provider
        .changes(directory.path(), VcsScope::Unstaged)
        .await
        .expect("snapshot loads despite a symlink to a directory");
    let file = snapshot.files.first().expect("symlink is listed");
    assert_eq!(file.status, VcsFileStatus::Untracked);
    assert_eq!((file.additions, file.deletions), (Some(1), Some(0)));
    let diff = provider.diff(&snapshot, file).await.expect("diff loads");
    assert!(diff.diff.contains("new file mode 120000"));
    assert!(
        diff.diff
            .contains(&format!("+{}\n", outside.path().to_string_lossy()))
    );
}

#[tokio::test]
async fn git_scopes_separate_staged_and_unstaged_content() {
    let directory = tempfile::tempdir().expect("temp directory");
    initialize_git_repository(directory.path()).await;
    let path = directory.path().join("file.txt");
    tokio::fs::write(&path, "base\n")
        .await
        .expect("base writes");
    run_git(directory.path(), &["add", "file.txt"]).await;
    run_git(directory.path(), &["commit", "--quiet", "-m", "base"]).await;

    tokio::fs::write(&path, "staged\n")
        .await
        .expect("staged writes");
    run_git(directory.path(), &["add", "file.txt"]).await;
    tokio::fs::write(&path, "unstaged\n")
        .await
        .expect("unstaged writes");

    let provider = GitProvider;
    let staged = provider
        .changes(directory.path(), VcsScope::Staged)
        .await
        .expect("staged snapshot loads");
    let unstaged = provider
        .changes(directory.path(), VcsScope::Unstaged)
        .await
        .expect("unstaged snapshot loads");
    assert_eq!(staged.files.len(), 1);
    assert!(staged.files[0].staged);
    assert_eq!(
        (staged.files[0].additions, staged.files[0].deletions),
        (Some(1), Some(1))
    );
    assert_eq!(unstaged.files.len(), 1);
    assert!(!unstaged.files[0].staged);
    assert_eq!(
        (unstaged.files[0].additions, unstaged.files[0].deletions),
        (Some(1), Some(1))
    );

    let staged_diff = provider
        .diff(&staged, staged.files.first().expect("staged file exists"))
        .await
        .expect("staged diff loads");
    let unstaged_diff = provider
        .diff(
            &unstaged,
            unstaged.files.first().expect("unstaged file exists"),
        )
        .await
        .expect("unstaged diff loads");
    assert!(staged_diff.diff.contains("-base\n+staged"));
    assert!(!staged_diff.diff.contains("unstaged"));
    assert_eq!(staged_diff.source.as_deref(), Some("staged\n"));
    assert!(unstaged_diff.diff.contains("-staged\n+unstaged"));
    assert_eq!(unstaged_diff.source, None);

    tokio::fs::write(directory.path().join("new.txt"), "new file\n")
        .await
        .expect("untracked file writes");
    let uncommitted = provider
        .changes(directory.path(), VcsScope::Uncommitted)
        .await
        .expect("combined snapshot loads");
    assert_eq!(uncommitted.files.len(), 2);
    let combined_file = uncommitted
        .files
        .iter()
        .find(|file| file.path == path.canonicalize().expect("file canonicalizes"))
        .expect("combined file exists only once");
    assert_eq!(
        (combined_file.additions, combined_file.deletions),
        (Some(1), Some(1))
    );
    let combined_diff = provider
        .diff(&uncommitted, combined_file)
        .await
        .expect("combined diff loads");
    assert!(combined_diff.diff.contains("-base\n+unstaged"));
    assert!(!combined_diff.diff.contains("+staged"));
    assert!(
        uncommitted
            .files
            .iter()
            .any(|file| file.status == VcsFileStatus::Untracked)
    );
}

#[tokio::test]
async fn uncommitted_scope_reads_indexed_and_untracked_files_before_first_commit() {
    let directory = tempfile::tempdir().expect("temp directory");
    initialize_git_repository(directory.path()).await;
    let staged = directory.path().join("staged.txt");
    tokio::fs::write(&staged, "staged\n")
        .await
        .expect("staged file writes");
    run_git(directory.path(), &["add", "staged.txt"]).await;
    tokio::fs::write(directory.path().join("new.txt"), "untracked\n")
        .await
        .expect("untracked file writes");

    let provider = GitProvider;
    let snapshot = provider
        .changes(directory.path(), VcsScope::Uncommitted)
        .await
        .expect("unborn snapshot loads");
    assert_eq!(snapshot.summary.total, 2);
    let file = snapshot
        .files
        .iter()
        .find(|file| file.path == staged.canonicalize().expect("file canonicalizes"))
        .expect("indexed file is present");
    let diff = provider.diff(&snapshot, file).await.expect("diff loads");
    assert!(diff.diff.contains("+staged"));
}

#[tokio::test]
async fn git_branch_scope_excludes_worktree_changes() {
    let directory = tempfile::tempdir().expect("temp directory");
    initialize_git_repository(directory.path()).await;
    let path = directory.path().join("file.txt");
    tokio::fs::write(&path, "base\n")
        .await
        .expect("base writes");
    run_git(directory.path(), &["add", "file.txt"]).await;
    run_git(directory.path(), &["commit", "--quiet", "-m", "base"]).await;
    run_git(directory.path(), &["switch", "--quiet", "-c", "feature"]).await;
    tokio::fs::write(&path, "committed\n")
        .await
        .expect("commit writes");
    run_git(directory.path(), &["add", "file.txt"]).await;
    run_git(directory.path(), &["commit", "--quiet", "-m", "feature"]).await;
    tokio::fs::write(&path, "worktree\n")
        .await
        .expect("worktree writes");

    let provider = GitProvider;
    let snapshot = provider
        .changes(directory.path(), VcsScope::Branch)
        .await
        .expect("branch snapshot loads");
    assert_eq!(snapshot.scope, VcsScope::Branch);
    assert!(snapshot.repository.base.is_some());
    assert_eq!(snapshot.files.len(), 1);
    assert_eq!(
        (snapshot.files[0].additions, snapshot.files[0].deletions),
        (Some(1), Some(1))
    );

    let diff = provider
        .diff(
            &snapshot,
            snapshot.files.first().expect("branch file exists"),
        )
        .await
        .expect("branch diff loads");
    assert!(diff.diff.contains("-base\n+committed"));
    assert!(!diff.diff.contains("worktree"));
    assert_eq!(diff.source.as_deref(), Some("committed\n"));
}
