//! Validated conversion of native execution settings to the host contract.

use serde::Deserialize;
use serde_json::Value;

use crate::agent::provider::{
    ExecutionApproval, ExecutionPolicy, ExecutionReviewer, ExecutionSandbox,
};

#[derive(Deserialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
enum SandboxDto {
    DangerFullAccess,
    ReadOnly {
        #[serde(default)]
        network_access: bool,
    },
    WorkspaceWrite {
        #[serde(default)]
        writable_roots: Vec<String>,
        #[serde(default)]
        network_access: bool,
        #[serde(default)]
        exclude_tmpdir_env_var: bool,
        #[serde(default)]
        exclude_slash_tmp: bool,
    },
}

fn policy(settings: &Value, sandbox_key: &str) -> Option<ExecutionPolicy> {
    let sandbox = if settings
        .pointer("/activePermissionProfile/id")
        .and_then(Value::as_str)
        .is_some()
    {
        ExecutionSandbox::ConfiguredProfile
    } else {
        match serde_json::from_value(settings.get(sandbox_key)?.clone()).ok()? {
            SandboxDto::DangerFullAccess => ExecutionSandbox::Unrestricted,
            SandboxDto::ReadOnly { network_access } => ExecutionSandbox::ReadOnly {
                network: network_access,
            },
            SandboxDto::WorkspaceWrite {
                writable_roots,
                network_access,
                exclude_tmpdir_env_var,
                exclude_slash_tmp,
            } => {
                if writable_roots
                    .iter()
                    .any(|root| !std::path::Path::new(root).is_absolute())
                {
                    return None;
                }
                ExecutionSandbox::Workspace {
                    writable_roots,
                    network: network_access,
                    exclude_tmpdir: exclude_tmpdir_env_var,
                    exclude_slash_tmp,
                }
            }
        }
    };
    let approval =
        serde_json::from_value::<ExecutionApproval>(settings.get("approvalPolicy")?.clone())
            .ok()?;
    let reviewer = match settings.get("approvalsReviewer").and_then(Value::as_str)? {
        "user" => ExecutionReviewer::User,
        "auto_review" | "guardian_subagent" => ExecutionReviewer::AutoReview,
        _ => return None,
    };
    Some(ExecutionPolicy {
        sandbox,
        approval,
        reviewer,
    })
}

pub(crate) fn event_policy(payload: &Value) -> Option<ExecutionPolicy> {
    if payload.get("method").and_then(Value::as_str) != Some("thread/settings/updated") {
        return None;
    }
    policy(payload.pointer("/params/threadSettings")?, "sandboxPolicy")
}

pub(crate) fn result_policy(method: &str, result: &Value) -> Option<ExecutionPolicy> {
    if !matches!(method, "thread/start" | "thread/resume" | "thread/fork") {
        return None;
    }
    policy(result, "sandbox")
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn preserves_access_and_approval_without_inventing_defaults() {
        let input = json!({"sandbox": {"type": "workspaceWrite", "writableRoots": ["/extra"],
            "networkAccess": true, "excludeTmpdirEnvVar": true, "excludeSlashTmp": false},
            "approvalPolicy": "never", "approvalsReviewer": "auto_review"});
        assert_eq!(
            result_policy("thread/start", &input),
            Some(ExecutionPolicy {
                sandbox: ExecutionSandbox::Workspace {
                    writable_roots: vec!["/extra".into()],
                    network: true,
                    exclude_tmpdir: true,
                    exclude_slash_tmp: false
                },
                approval: ExecutionApproval::Never,
                reviewer: ExecutionReviewer::AutoReview,
            })
        );
        let mut malformed = input;
        malformed["sandbox"]["writableRoots"] = json!(["relative"]);
        assert_eq!(result_policy("thread/start", &malformed), None);
        assert_eq!(
            result_policy(
                "thread/start",
                &json!({"sandbox": {"type": "workspaceWrite"}})
            ),
            None
        );
    }
}
