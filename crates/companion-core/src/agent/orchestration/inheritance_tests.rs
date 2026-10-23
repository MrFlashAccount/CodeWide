//! Parent permission inheritance, ordinary cwd, and explicit isolation contracts.

use super::*;
use crate::agent::orchestration::{
    admission,
    task::{TaskId, WorkspaceClaimState, WorkspaceMode},
    tools::WorkspaceRequest,
};

#[tokio::test]
async fn spawn_inherits_permissions_and_uses_a_non_git_parent_cwd_for_both_providers() -> TestResult
{
    let cwd = tempfile::tempdir()?;
    let path = cwd.path().to_str().ok_or("invalid fixture path")?;
    for (parent_provider, parent, parent_profile, child_provider, expected) in [
        ("codex", PARENT, ":workspace", "codex", ":workspace"),
        (
            "codex",
            PARENT,
            ":danger-full-access",
            "codex",
            ":danger-full-access",
        ),
        (
            "claude",
            CLAUDE_PARENT,
            ":workspace",
            "codex",
            ":danger-full-access",
        ),
        (
            "claude",
            CLAUDE_PARENT,
            ":workspace",
            "claude",
            ":full-access",
        ),
        (
            "codex",
            PARENT,
            ":danger-full-access",
            "claude",
            ":danger-full-access",
        ),
    ] {
        let harness = harness_at(parent_profile, true, path).await?;
        let (success, result) = call(
            &harness.service,
            parent_provider,
            parent,
            "codewide_spawn_agent",
            json!({"prompt": "build", "provider": child_provider, "model": "gpt-6.1-sol"}),
        )
        .await;
        assert!(success, "{result}");
        let created = if child_provider == "codex" {
            harness.codex.created()
        } else {
            harness.claude.created()
        };
        assert_eq!(created.len(), 1);
        assert_eq!(created[0].cwd, path);
        assert_eq!(created[0].settings.permission_profile, expected);
        assert!(!cwd.path().join(".git").exists());
    }
    Ok(())
}

#[tokio::test]
async fn delegate_workspace_and_profile_are_optional_and_legacy_mode_does_not_downgrade()
-> TestResult {
    let harness = harness(":workspace").await?;
    for (call_id, workspace) in [
        ("default", None),
        ("inherit", Some(json!({"mode": "inherit"}))),
        ("legacy", Some(json!({"mode": "sharedReadOnly"}))),
    ] {
        let mut arguments =
            json!({"prompt": "build", "provider": "claude", "waitMode": "deferred"});
        if let Some(workspace) = workspace {
            arguments["workspace"] = workspace;
        }
        let (success, result) = task_tests::task_call(
            &harness.service,
            call_id,
            "codewide_delegate_task",
            arguments,
        )
        .await;
        assert!(success, "{result}");
    }
    assert_eq!(harness.claude.created().len(), 3);
    assert!(
        harness
            .claude
            .created()
            .iter()
            .all(|created| created.settings.permission_profile == ":workspace")
    );
    Ok(())
}

#[test]
fn explicit_isolation_alone_requires_a_workspace_provider() -> TestResult {
    for request in [
        WorkspaceRequest::Inherit { cwd: None },
        WorkspaceRequest::SharedReadOnly { cwd: None },
        WorkspaceRequest::CompatibilitySpawn { cwd: None },
    ] {
        let admission = admission::workspace(&request, "/non-git", Some(":full-access"), None)
            .map_err(|error| error.message)?;
        assert_eq!(admission.mode, WorkspaceMode::LegacyShared);
        assert_eq!(admission.target_profile, ":full-access");
        assert_eq!(
            admission.claim_state,
            WorkspaceClaimState::Shared {
                effective_cwd: "/non-git".into()
            }
        );
    }
    let isolated = admission::workspace(
        &WorkspaceRequest::IsolatedWrite {
            source_workspace: None,
        },
        "/non-git",
        Some(":workspace"),
        None,
    )
    .map_err(|error| error.message)?;
    assert_eq!(isolated.mode, WorkspaceMode::IsolatedWrite);
    assert_eq!(isolated.target_profile, ":workspace");
    Ok(())
}

#[tokio::test]
async fn explicit_read_only_is_respected_without_forcing_isolation() -> TestResult {
    let harness = harness(":workspace").await?;
    let (success, result) = call(
        &harness.service,
        "codex",
        PARENT,
        "codewide_spawn_agent",
        json!({"prompt": "inspect", "permissionProfile": ":read-only", "cwd": "/non-git"}),
    )
    .await;
    assert!(success, "{result}");
    assert_eq!(harness.codex.created()[0].cwd, "/non-git");
    assert_eq!(
        harness.codex.created()[0].settings.permission_profile,
        ":read-only"
    );
    Ok(())
}

#[tokio::test]
async fn workspace_failures_have_durable_diagnostics_without_claiming_uncertainty() -> TestResult {
    let harness = harness(":workspace").await?;
    let cwd = tempfile::tempdir()?;
    let operations = tempfile::tempdir()?;
    *harness
        .service
        .workspaces
        .write()
        .map_err(|_| "workspace lock poisoned")? =
        Some(Arc::new(crate::workspaces::WorkspaceService::new(
            Arc::new(crate::vcs::VcsService::new(
                operations.path().join("plugins.json"),
            )),
            operations.path().join("workspaces"),
        )));
    let (success, result) = task_tests::task_call(
        &harness.service,
        "non-git-isolated",
        "codewide_delegate_task",
        json!({"prompt": "build", "waitMode": "blocking", "permissionProfile": ":workspace",
            "workspace": {"mode": "isolatedWrite", "sourceWorkspace": cwd.path()}}),
    )
    .await;
    assert!(success, "{result}");
    let task_id =
        TaskId::parse(result["taskId"].as_str().ok_or("missing task")?).ok_or("invalid task")?;
    let bundle = harness.service.task_journal.get(&task_id).await?;
    assert_eq!(bundle.workspace.mode, WorkspaceMode::IsolatedWrite);
    assert!(matches!(
        bundle.workspace.state,
        WorkspaceClaimState::Failed { .. }
    ));
    let snapshot = harness
        .service
        .task_snapshot(&task_id)
        .await
        .map_err(super::super::ToolError::render)?;
    assert_eq!(
        snapshot.status,
        super::super::task::PublicTaskStatus::Failed
    );
    assert!(
        snapshot
            .final_message
            .as_deref()
            .is_some_and(|message| message.contains("workspace.create@1"))
    );
    assert!(snapshot.agent_thread_id.is_none());
    assert!(snapshot.recovery.is_none());
    // A duplicate or late failure must preserve the first terminal result.
    harness
        .service
        .task_journal
        .fail_workspace(&task_id)
        .await?;
    let (success, waited) = task_tests::task_call(
        &harness.service,
        "wait-workspace-failure",
        "codewide_wait_task",
        json!({"taskId": task_id.as_str(), "timeoutSeconds": 0}),
    )
    .await;
    assert!(success, "{waited}");
    assert_eq!(
        waited["finalMessage"],
        snapshot.final_message.ok_or("missing diagnostic")?
    );
    assert!(TaskId::parse(waited["taskId"].as_str().ok_or("missing task")?).is_some());
    Ok(())
}

#[tokio::test]
async fn native_execution_policy_is_frozen_durably_and_inherited_by_descendants() -> TestResult {
    use crate::agent::provider::{
        ExecutionApproval, ExecutionPolicy, ExecutionReviewer, ExecutionSandbox,
    };
    let harness = harness(":workspace").await?;
    harness.service.observe_rpc_result(
        &ProviderId::from_static("codex"),
        "thread/resume",
        &json!({"thread": {"id": PARENT}, "activePermissionProfile": null,
            "approvalPolicy": "never", "approvalsReviewer": "user",
            "sandbox": {"type": "workspaceWrite", "writableRoots": ["/extra"],
                "networkAccess": true, "excludeTmpdirEnvVar": false, "excludeSlashTmp": false}}),
    );
    let expected = ExecutionPolicy {
        sandbox: ExecutionSandbox::Workspace {
            writable_roots: vec!["/extra".into()],
            network: true,
            exclude_tmpdir: false,
            exclude_slash_tmp: false,
        },
        approval: ExecutionApproval::Never,
        reviewer: ExecutionReviewer::User,
    };
    let (success, spawned) = call(
        &harness.service,
        "codex",
        PARENT,
        "codewide_spawn_agent",
        json!({"prompt": "build"}),
    )
    .await;
    assert!(success, "{spawned}");
    let child = spawned["agentThreadId"].as_str().ok_or("missing child")?;
    assert_eq!(
        harness
            .service
            .profiles
            .execution(&ProviderId::from_static("codex"), child),
        Some(expected.clone())
    );
    let (success, grandchild) = call(
        &harness.service,
        "codex",
        child,
        "codewide_spawn_agent",
        json!({"prompt": "build again"}),
    )
    .await;
    assert!(success, "{grandchild}");
    {
        let policies = harness
            .codex
            .inherited_policies
            .lock()
            .map_err(|_| "poisoned policy fixture")?;
        assert_eq!(policies.as_slice(), &[expected.clone(), expected.clone()]);
    }
    let tasks = harness.service.task_journal.pending().await?;
    let task = harness
        .service
        .task_journal
        .get(tasks.first().ok_or("missing task")?)
        .await?;
    assert_eq!(task.task.permission.execution_policy, Some(expected));
    let roundtrip: super::super::task::OrchestrationTask =
        serde_json::from_slice(&serde_json::to_vec(&task.task)?)?;
    assert_eq!(roundtrip.permission, task.task.permission);
    Ok(())
}

#[tokio::test]
async fn an_admitted_non_git_cwd_runs_cargo_and_writes_cwd_and_slash_tmp() -> TestResult {
    // The provider is scripted; execution below uses the test host's real
    // sandbox. This checks the cwd/build contract, not a live model turn.
    let directory = tempfile::tempdir()?;
    let cwd = directory.path().to_str().ok_or("invalid path")?;
    let harness = harness_at(":workspace", true, cwd).await?;
    let (success, result) = call(
        &harness.service,
        "codex",
        PARENT,
        "codewide_spawn_agent",
        json!({"prompt": "build", "model": "gpt-6.1-sol"}),
    )
    .await;
    assert!(success, "{result}");
    let created = harness.codex.created();
    let child = created.first().ok_or("missing child")?;
    assert_eq!(child.cwd, cwd);
    assert_eq!(child.settings.permission_profile, ":workspace");
    assert!(!directory.path().join(".git").exists());
    let temporary = tempfile::Builder::new()
        .prefix("codewide-child-build-")
        .tempdir_in("/tmp")?;
    std::fs::create_dir(directory.path().join("src"))?;
    std::fs::write(
        directory.path().join("Cargo.toml"),
        "[package]\nname = \"child-build-probe\"\nversion = \"0.1.0\"\nedition = \"2024\"\n",
    )?;
    std::fs::write(
        directory.path().join("src/main.rs"),
        r#"
fn main() -> std::io::Result<()> {
    std::fs::write("cwd-proof", "cwd writable")?;
    std::fs::write(std::env::var_os("CW_TMP_PROOF").expect("tmp proof"), "tmp writable")?;
    Ok(())
}
"#,
    )?;
    let output = tokio::time::timeout(
        Duration::from_secs(30),
        tokio::process::Command::new(env!("CARGO"))
            .args(["run", "--offline", "--quiet"])
            .current_dir(&child.cwd)
            .env("CARGO_HOME", temporary.path().join("cargo-home"))
            .env("CARGO_TARGET_DIR", directory.path().join("target"))
            .env("CW_TMP_PROOF", temporary.path().join("tmp-proof"))
            .kill_on_drop(true)
            .output(),
    )
    .await??;
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert_eq!(
        std::fs::read_to_string(directory.path().join("cwd-proof"))?,
        "cwd writable"
    );
    assert_eq!(
        std::fs::read_to_string(temporary.path().join("tmp-proof"))?,
        "tmp writable"
    );
    Ok(())
}
