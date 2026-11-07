//! Host-internal execution policy frozen when a child is admitted.
//!
//! This is independent of provider wire DTOs and the public agent protocol.

use serde::{Deserialize, Serialize};

/// A provider's effective sandbox, including the access lost by copying only
/// a built-in profile name. Named profiles keep their provider configuration.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum ExecutionSandbox {
    ConfiguredProfile,
    Unrestricted,
    ReadOnly {
        network: bool,
    },
    Workspace {
        writable_roots: Vec<String>,
        network: bool,
        exclude_tmpdir: bool,
        exclude_slash_tmp: bool,
    },
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ExecutionApproval {
    Never,
    OnRequest,
    Untrusted,
    Granular {
        sandbox_approval: bool,
        rules: bool,
        mcp_elicitations: bool,
        #[serde(default)]
        request_permissions: bool,
        #[serde(default)]
        skill_approval: bool,
    },
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ExecutionReviewer {
    User,
    AutoReview,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecutionPolicy {
    pub sandbox: ExecutionSandbox,
    pub approval: ExecutionApproval,
    pub reviewer: ExecutionReviewer,
}
