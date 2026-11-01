//! Change scopes are a provider capability: the companion forwards the
//! requested scope to the owning provider and never composes or advertises a
//! scope itself, whatever the provider id.

use std::path::{Path, PathBuf};

use serde_json::json;

use super::{VcsError, VcsPluginConfig, VcsScope, VcsService};

type TestResult = Result<(), Box<dyn std::error::Error>>;

/// A fake provider that owns every workspace. `vcs.changes` and `vcs.diff`
/// answer `<results>/<method>@<scope>.json` (with `@WORKSPACE@` replaced) or
/// fail with a provider error when that scope has no fixture. Every request
/// is appended to `<results>/requests.log` as `<method> <scope>`.
fn fake_provider(path: &Path, results: &Path) -> std::io::Result<()> {
    use std::os::unix::fs::PermissionsExt as _;

    let body = format!(
        r#"#!/bin/sh
results='{results}'
while IFS= read -r header; do
  length=$(printf '%s' "$header" | tr -d '\r ' | sed -n 's/^Content-Length://p')
  [ -n "$length" ] || continue
  IFS= read -r blank
  body=$(dd bs=1 count="$length" 2>/dev/null)
  id=$(printf '%s' "$body" | sed -n 's/.*"id":\([0-9]*\).*/\1/p')
  method=$(printf '%s' "$body" | sed -n 's/.*"method":"\([^"]*\)".*/\1/p')
  workspace=$(printf '%s' "$body" | sed -n 's/.*"workspace":"\([^"]*\)".*/\1/p')
  scope=$(printf '%s' "$body" | sed -n 's/.*"scope":"\([^"]*\)".*/\1/p')
  printf '%s %s\n' "$method" "$scope" >> "$results/requests.log"
  if [ -n "$scope" ]; then file="$results/$method@$scope.json"; else file="$results/$method.json"; fi
  if [ -f "$file" ]; then
    result=$(sed "s|@WORKSPACE@|$workspace|g" "$file")
    out="{{\"jsonrpc\":\"2.0\",\"id\":$id,\"result\":$result}}"
  else
    out="{{\"jsonrpc\":\"2.0\",\"id\":$id,\"error\":{{\"code\":-32000,\"message\":\"unsupported scope\"}}}}"
  fi
  printf 'Content-Length: %s\r\n\r\n%s' "$(printf '%s' "$out" | wc -c | tr -d ' ')" "$out"
done
"#,
        results = results.display()
    );
    std::fs::write(path, body)?;
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o755))
}

struct Fixture {
    _directory: tempfile::TempDir,
    workspace: PathBuf,
    results: PathBuf,
    service: VcsService,
}

impl Fixture {
    /// Installs a provider with `id` that serves exactly `scopes`.
    fn new(id: &str, scopes: &[&str]) -> Result<Self, Box<dyn std::error::Error>> {
        let directory = tempfile::tempdir()?;
        let workspace = directory.path().join("workspace");
        let results = directory.path().join("results");
        std::fs::create_dir_all(&workspace)?;
        std::fs::create_dir_all(&results)?;
        std::fs::write(
            results.join("initialize.json"),
            json!({"protocolVersion": 1, "provider": id, "displayName": "Fake",
                   "version": "1",
                   "capabilities": ["vcs.inspect@1", "vcs.changes@2", "vcs.diff@2"]})
            .to_string(),
        )?;
        std::fs::write(
            results.join("vcs.inspect.json"),
            json!({"capability": "vcs.inspect@1", "provider": id,
                   "repositoryRoot": "@WORKSPACE@"})
            .to_string(),
        )?;
        let repository = json!({"provider": id, "root": "@WORKSPACE@"});
        for scope in scopes {
            std::fs::write(
                results.join(format!("vcs.changes@{scope}.json")),
                json!({
                    "capability": "vcs.changes@2",
                    "repository": repository,
                    "scope": scope,
                    "availableScopes": scopes,
                    "snapshotId": format!("{scope}-1"),
                    "state": "dirty",
                    "summary": {"total": 1, "added": 0, "modified": 1, "deleted": 0,
                                "renamed": 0, "untracked": 0, "conflicted": 0},
                    "files": [{"id": "file", "path": "@WORKSPACE@/file.txt",
                               "status": "modified", "staged": true,
                               "additions": 2, "deletions": 0, "binary": false}],
                })
                .to_string(),
            )?;
            std::fs::write(
                results.join(format!("vcs.diff@{scope}.json")),
                json!({
                    "capability": "vcs.diff@2",
                    "repository": repository,
                    "scope": scope,
                    "snapshotId": format!("{scope}-1"),
                    "fileId": "file",
                    "path": "@WORKSPACE@/file.txt",
                    "status": "modified",
                    "diff": format!("diff --git a/file.txt b/file.txt\n+{scope}\n"),
                    "truncated": false,
                    "binary": false,
                    "additions": 1,
                    "deletions": 0,
                })
                .to_string(),
            )?;
        }
        fake_provider(&directory.path().join("provider"), &results)?;
        let service = VcsService::new(directory.path().join("vcs-plugins.json"), None);
        service.registry().install(VcsPluginConfig {
            id: id.into(),
            executable: directory.path().join("provider"),
            args: Vec::new(),
            enabled: true,
            priority: 100,
        })?;
        Ok(Self {
            _directory: directory,
            workspace,
            results,
            service,
        })
    }

    /// The `vcs.changes`/`vcs.diff` requests the provider received.
    fn scoped_requests(&self) -> std::io::Result<Vec<String>> {
        Ok(std::fs::read_to_string(self.results.join("requests.log"))?
            .lines()
            .filter(|line| line.starts_with("vcs.changes ") || line.starts_with("vcs.diff "))
            .map(str::to_owned)
            .collect())
    }
}

#[tokio::test]
async fn declared_scopes_are_forwarded_without_companion_additions() -> TestResult {
    // The id formerly special-cased by the companion gets no extra scope.
    let fixture = Fixture::new("arc", &["staged", "unstaged", "branch"])?;
    let snapshot = fixture
        .service
        .changes(&fixture.workspace, VcsScope::Unstaged)
        .await?;
    assert_eq!(
        snapshot.available_scopes,
        vec![VcsScope::Staged, VcsScope::Unstaged, VcsScope::Branch]
    );
    assert_eq!(fixture.scoped_requests()?, vec!["vcs.changes unstaged"]);
    Ok(())
}

#[tokio::test]
async fn an_undeclared_scope_is_a_provider_error_without_composition() -> TestResult {
    let fixture = Fixture::new("arc", &["staged", "unstaged", "branch"])?;
    let path = fixture.workspace.join("file.txt");
    let changes = fixture
        .service
        .changes(&fixture.workspace, VcsScope::Uncommitted)
        .await;
    assert!(matches!(changes, Err(VcsError::Plugin(_))), "{changes:?}");
    let diff = fixture
        .service
        .diff(&fixture.workspace, &path, VcsScope::Uncommitted)
        .await;
    assert!(matches!(diff, Err(VcsError::Plugin(_))), "{diff:?}");
    // Only the requested scope reached the provider: no staged + unstaged
    // component requests were issued to synthesize it.
    assert_eq!(
        fixture.scoped_requests()?,
        vec!["vcs.changes uncommitted", "vcs.changes uncommitted"]
    );
    Ok(())
}

#[tokio::test]
async fn a_natively_declared_uncommitted_scope_is_served_by_the_provider() -> TestResult {
    let fixture = Fixture::new("fake", &["staged", "unstaged", "uncommitted", "branch"])?;
    let path = fixture.workspace.join("file.txt");
    let snapshot = fixture
        .service
        .changes(&fixture.workspace, VcsScope::Uncommitted)
        .await?;
    assert_eq!(snapshot.scope, VcsScope::Uncommitted);
    assert_eq!(snapshot.snapshot_id, "uncommitted-1");
    assert!(snapshot.available_scopes.contains(&VcsScope::Uncommitted));
    let diff = fixture
        .service
        .diff(&fixture.workspace, &path, VcsScope::Uncommitted)
        .await?;
    assert_eq!(diff.scope, VcsScope::Uncommitted);
    assert_eq!(diff.snapshot_id, "uncommitted-1");
    assert!(diff.diff.contains("+uncommitted"));
    assert_eq!(
        fixture.scoped_requests()?,
        vec![
            "vcs.changes uncommitted",
            "vcs.changes uncommitted",
            "vcs.diff uncommitted"
        ]
    );
    Ok(())
}
