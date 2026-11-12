//! Compatibility-spawn authority and workspace mapping regressions.

use super::*;
use crate::agent::orchestration::{
    admission,
    task::{WorkspaceClaimState, WorkspaceMode},
    tools::WorkspaceRequest,
};
use crate::agent::provider::ThreadExecutionAuthority;

#[tokio::test]
async fn omitted_profile_on_a_workspace_parent_is_inherited() -> TestResult {
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
        ":workspace"
    );
    Ok(())
}

#[tokio::test]
async fn an_observed_writable_parent_profile_is_inherited_by_legacy_spawn() -> TestResult {
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
        ":danger-full-access"
    );
    Ok(())
}

#[tokio::test]
async fn a_provider_owned_parent_authority_survives_missing_thread_projection() -> TestResult {
    let harness = harness("").await?;
    harness.codex.set_execution_authority(
        PARENT,
        ThreadExecutionAuthority {
            permission_profile: ":danger-full-access".into(),
            policy: None,
        },
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
        ":danger-full-access"
    );
    Ok(())
}

#[tokio::test]
async fn genuinely_unknown_parent_authority_fails_closed_except_for_an_explicit_downgrade()
-> TestResult {
    let harness = harness("").await?;
    for arguments in [
        json!({"prompt": "p", "provider": "claude"}),
        json!({"prompt": "p", "provider": "claude", "permissionProfile": ":workspace"}),
    ] {
        let (success, rejected) = call(
            &harness.service,
            "codex",
            PARENT,
            "codewide_spawn_agent",
            arguments,
        )
        .await;
        assert!(!success, "{rejected}");
    }
    let (success, spawned) = call(
        &harness.service,
        "codex",
        PARENT,
        "codewide_spawn_agent",
        json!({"prompt": "p", "provider": "claude", "permissionProfile": ":read-only"}),
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
async fn a_requested_writable_profile_needs_no_workspace_service() -> TestResult {
    let harness = harness(":workspace").await?;
    let (success, rejected) = call(
        &harness.service,
        "codex",
        PARENT,
        "codewide_spawn_agent",
        json!({"prompt": "p", "provider": "claude", "permissionProfile": ":workspace"}),
    )
    .await;
    assert!(success, "{rejected}");
    assert_eq!(
        harness.claude.created()[0].settings.permission_profile,
        ":workspace"
    );
    Ok(())
}

#[test]
fn alternate_absolute_cwd_is_used_directly_with_inherited_or_explicit_permissions() -> TestResult {
    let read_only = admission::workspace(
        &WorkspaceRequest::AgentSpawn {
            cwd: Some("/alternate".into()),
        },
        "/repo",
        Some(":workspace"),
        None,
    )
    .map_err(|rejection| rejection.message)?;
    assert_eq!(read_only.mode, WorkspaceMode::LegacyShared);
    assert_eq!(read_only.target_profile, ":workspace");
    assert_eq!(
        read_only.claim_state,
        WorkspaceClaimState::Shared {
            effective_cwd: "/alternate".into()
        }
    );

    let writable = admission::workspace(
        &WorkspaceRequest::AgentSpawn {
            cwd: Some("/alternate".into()),
        },
        "/repo",
        Some(":workspace"),
        Some(":workspace"),
    )
    .map_err(|rejection| rejection.message)?;
    assert_eq!(writable.mode, WorkspaceMode::LegacyShared);
    assert_eq!(writable.target_profile, ":workspace");
    assert_eq!(
        writable.claim_state,
        WorkspaceClaimState::Shared {
            effective_cwd: "/alternate".into()
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
