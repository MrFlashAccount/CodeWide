//! Compatibility-spawn authority and workspace mapping regressions.

use super::*;
use crate::agent::orchestration::{
    admission,
    task::{WorkspaceClaimState, WorkspaceMode},
    tools::WorkspaceRequest,
};

#[tokio::test]
async fn omitted_profile_on_a_workspace_parent_is_shared_read_only() -> TestResult {
    let harness = harness(":workspace").await?;
    let (success, spawned) = call(
        &harness.service,
        "codex",
        PARENT,
        "codewide_spawn_agent",
        json!({"prompt": "p", "provider": "claude"}),
    )
    .await;
    assert!(success, "{spawned}");
    assert_eq!(harness.claude.created()[0].cwd, "/repo");
    assert_eq!(
        harness.claude.created()[0].settings.permission_profile,
        ":read-only"
    );
    Ok(())
}

#[tokio::test]
async fn an_observed_writable_parent_profile_is_not_inherited_by_legacy_spawn() -> TestResult {
    let harness = harness("").await?;
    harness.service.observe_rpc_result(
        &ProviderId::from_static("codex"),
        "thread/resume",
        &json!({"thread": {"id": PARENT}, "activePermissionProfile": null,
            "sandbox": {"type": "dangerFullAccess"}}),
    );
    let (success, spawned) = call(
        &harness.service,
        "codex",
        PARENT,
        "codewide_spawn_agent",
        json!({"prompt": "p", "provider": "claude"}),
    )
    .await;
    assert!(success, "{spawned}");
    assert_eq!(
        harness.claude.created()[0].settings.permission_profile,
        ":read-only"
    );
    Ok(())
}

#[tokio::test]
async fn a_requested_writable_profile_fails_closed_without_workspace_service() -> TestResult {
    let harness = harness(":workspace").await?;
    let (success, rejected) = call(
        &harness.service,
        "codex",
        PARENT,
        "codewide_spawn_agent",
        json!({"prompt": "p", "provider": "claude", "permissionProfile": ":workspace"}),
    )
    .await;
    assert!(!success);
    assert!(
        rejected
            .as_str()
            .is_some_and(|message| message.contains("workspace.create@1 is unavailable")),
        "{rejected}"
    );
    assert!(harness.claude.created().is_empty());
    Ok(())
}

#[test]
fn alternate_absolute_cwd_is_read_only_or_an_isolated_source_never_shared_write() -> TestResult {
    let read_only = admission::workspace(
        &WorkspaceRequest::CompatibilitySpawn {
            cwd: Some("/alternate".into()),
        },
        "/repo",
        Some(":workspace"),
        None,
    )
    .map_err(|rejection| rejection.message)?;
    assert_eq!(read_only.mode, WorkspaceMode::SharedReadOnly);
    assert_eq!(read_only.target_profile, ":read-only");
    assert_eq!(
        read_only.claim_state,
        WorkspaceClaimState::Shared {
            effective_cwd: "/alternate".into()
        }
    );

    let writable = admission::workspace(
        &WorkspaceRequest::CompatibilitySpawn {
            cwd: Some("/alternate".into()),
        },
        "/repo",
        Some(":workspace"),
        Some(":workspace"),
    )
    .map_err(|rejection| rejection.message)?;
    assert_eq!(writable.mode, WorkspaceMode::IsolatedWrite);
    assert_eq!(writable.target_profile, ":workspace");
    assert_eq!(
        writable.claim_state,
        WorkspaceClaimState::Pending {
            source_workspace: "/alternate".into()
        }
    );
    Ok(())
}

#[tokio::test]
async fn another_provider_cannot_supply_the_callers_permission_ceiling() -> TestResult {
    let harness = harness("").await?;
    harness.service.observe_rpc_result(
        &ProviderId::from_static("claude"),
        "thread/resume",
        &json!({"thread": {"id": PARENT}, "activePermissionProfile": {"id": ":full-access"}}),
    );
    let (success, _) = call(
        &harness.service,
        "codex",
        PARENT,
        "codewide_spawn_agent",
        json!({"prompt": "p", "provider": "claude", "permissionProfile": ":workspace"}),
    )
    .await;
    assert!(!success);
    assert!(harness.claude.created().is_empty());
    Ok(())
}
