//! Neutral thread settings → client-wire execution settings.
//!
//! The permission profile id is the neutral contract; the client also reads
//! the legacy approval policy and sandbox type, so they are derived from the
//! profile with one fixed rule shared by every non-native provider:
//! `:read-only` → `readOnly`, `:workspace` → `workspaceWrite`,
//! `:full-access` / `:danger-full-access` → `dangerFullAccess` with approval
//! policy `never`; every other profile asks for approval on request.

use serde_json::{Value, json};

use crate::agent::model::{AgentThread, ThreadSettings};

fn sandbox_policy(profile: &str, cwd: &str) -> Value {
    match profile {
        ":read-only" => json!({"type": "readOnly", "networkAccess": false}),
        ":full-access" | ":danger-full-access" => json!({"type": "dangerFullAccess"}),
        _ => json!({
            "type": "workspaceWrite",
            "writableRoots": [cwd],
            "networkAccess": true,
            "excludeTmpdirEnvVar": false,
            "excludeSlashTmp": false,
        }),
    }
}

fn approval_policy(profile: &str) -> &'static str {
    match profile {
        ":full-access" | ":danger-full-access" => "never",
        _ => "on-request",
    }
}

/// The legacy `(approvalPolicy, sandboxPolicy.type)` names of a profile.
#[must_use]
pub fn legacy_policy_names(profile: &str) -> (&'static str, &'static str) {
    let sandbox = match profile {
        ":read-only" => "readOnly",
        ":full-access" | ":danger-full-access" => "dangerFullAccess",
        _ => "workspaceWrite",
    };
    (approval_policy(profile), sandbox)
}

/// `ThreadSettings` for `thread/settings/updated`.
#[must_use]
pub fn thread_settings(settings: &ThreadSettings, cwd: &str, model_provider: &str) -> Value {
    json!({
        "cwd": cwd,
        "approvalPolicy": approval_policy(&settings.permission_profile),
        "approvalsReviewer": "user",
        "sandboxPolicy": sandbox_policy(&settings.permission_profile, cwd),
        "activePermissionProfile": {"id": settings.permission_profile, "extends": null},
        "model": settings.model,
        "modelProvider": model_provider,
        "serviceTier": settings.service_tier,
        "effort": settings.effort,
        "summary": null,
        "collaborationMode": {
            "mode": "default",
            "settings": {
                "model": settings.model,
                "reasoning_effort": settings.effort,
                "developer_instructions": null,
            }
        },
        "multiAgentMode": "explicitRequestOnly",
        "personality": null,
    })
}

/// The settings envelope shared by `thread/start` and `thread/resume`
/// responses (`ThreadStartResponse` / `ThreadResumeResponse` fields beside
/// `thread`).
#[must_use]
pub fn response_envelope(
    thread: &AgentThread,
    model_provider: &str,
    projected_thread: &Value,
) -> Value {
    let settings = &thread.settings;
    json!({
        "thread": projected_thread,
        "model": settings.model,
        "modelProvider": model_provider,
        "serviceTier": settings.service_tier,
        "cwd": thread.cwd,
        "runtimeWorkspaceRoots": [],
        "instructionSources": [],
        "approvalPolicy": approval_policy(&settings.permission_profile),
        "approvalsReviewer": "user",
        "sandbox": sandbox_policy(&settings.permission_profile, &thread.cwd),
        "activePermissionProfile": {"id": settings.permission_profile, "extends": null},
        "reasoningEffort": settings.effort,
        "multiAgentMode": "explicitRequestOnly",
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn profiles_map_to_the_legacy_sandbox_and_approval_fields() {
        let settings = |profile: &str| ThreadSettings {
            model: "m".into(),
            effort: None,
            permission_profile: profile.into(),
            service_tier: None,
        };
        let read_only = thread_settings(&settings(":read-only"), "/w", "anthropic");
        assert_eq!(read_only["sandboxPolicy"]["type"], "readOnly");
        assert_eq!(read_only["approvalPolicy"], "on-request");
        let workspace = thread_settings(&settings(":workspace"), "/w", "anthropic");
        assert_eq!(workspace["sandboxPolicy"]["writableRoots"], json!(["/w"]));
        let full = thread_settings(&settings(":full-access"), "/w", "anthropic");
        assert_eq!(full["sandboxPolicy"]["type"], "dangerFullAccess");
        assert_eq!(full["approvalPolicy"], "never");
        assert_eq!(full["activePermissionProfile"]["id"], ":full-access");
    }
}
