//! Conversion of the host's inherited execution policy to App Server settings.

use agent_core::provider::{ExecutionPolicy, ExecutionSandbox};
use serde_json::{Value, json};

pub(super) fn apply(request: &mut Value, policy: &ExecutionPolicy) {
    request["approvalPolicy"] = json!(policy.approval);
    request["approvalsReviewer"] = json!(policy.reviewer);
    // A named profile carries permissions that the legacy sandbox projection
    // cannot express, including read-only exclusions. Keep that profile intact.
    match &policy.sandbox {
        ExecutionSandbox::ConfiguredProfile => {}
        ExecutionSandbox::Unrestricted => {
            request
                .as_object_mut()
                .map(|request| request.remove("permissions"));
            request["sandbox"] = json!("danger-full-access");
        }
        ExecutionSandbox::ReadOnly { network } => {
            request
                .as_object_mut()
                .map(|request| request.remove("permissions"));
            request["sandbox"] = json!("read-only");
            request["config"] = json!({"sandbox_read_only": {"network_access": network}});
        }
        ExecutionSandbox::Workspace {
            writable_roots,
            network,
            exclude_tmpdir,
            exclude_slash_tmp,
        } => {
            request
                .as_object_mut()
                .map(|request| request.remove("permissions"));
            request["sandbox"] = json!("workspace-write");
            request["config"] = json!({"sandbox_workspace_write": {
                "writable_roots": writable_roots,
                "network_access": network,
                "exclude_tmpdir_env_var": exclude_tmpdir,
                "exclude_slash_tmp": exclude_slash_tmp,
            }});
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use agent_core::provider::{ExecutionApproval, ExecutionReviewer};

    #[test]
    fn carries_network_extra_roots_tmp_and_approval_to_the_app_server() {
        let policy = ExecutionPolicy {
            sandbox: ExecutionSandbox::Workspace {
                writable_roots: vec!["/extra".into()],
                network: true,
                exclude_tmpdir: true,
                exclude_slash_tmp: false,
            },
            approval: ExecutionApproval::Never,
            reviewer: ExecutionReviewer::AutoReview,
        };
        let mut request = json!({"cwd": "/non-git", "permissions": ":workspace"});
        apply(&mut request, &policy);
        assert!(request.get("permissions").is_none());
        assert_eq!(request["sandbox"], "workspace-write");
        assert_eq!(request["approvalPolicy"], "never");
        assert_eq!(request["approvalsReviewer"], "auto_review");
        assert_eq!(
            request["config"]["sandbox_workspace_write"],
            json!({
                "writable_roots": ["/extra"], "network_access": true,
                "exclude_tmpdir_env_var": true, "exclude_slash_tmp": false,
            })
        );
    }
}
