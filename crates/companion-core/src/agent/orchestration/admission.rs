//! Host-owned admission policy for durable delegation.
//!
//! A plain cwd inherits the parent permissions. Isolation is opt-in. Provenance
//! and the parent ceiling come from authenticated context and parent settings.

use serde::Serialize;

use super::{
    profiles,
    task::{PermissionEnvelope, WorkspaceClaimState, WorkspaceMode},
    tools::WorkspaceRequest,
};

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RejectionCode {
    CapabilityUnavailable,
    PermissionDenied,
    WorkspaceUnavailable,
    ProviderUnavailable,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct AdmissionRejection {
    pub code: RejectionCode,
    pub message: String,
}

impl AdmissionRejection {
    #[must_use]
    pub fn new(code: RejectionCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct WorkspaceAdmission {
    pub mode: WorkspaceMode,
    pub claim_state: WorkspaceClaimState,
    pub target_profile: String,
}

/// Validates the public workspace arm and derives its effective permission
/// profile without accepting authority fields from model input.
///
/// # Errors
///
/// Returns an admission rejection when the workspace cannot be resolved or
/// the requested permission exceeds the authenticated parent ceiling.
pub fn workspace(
    request: &WorkspaceRequest,
    parent_cwd: &str,
    parent_profile: Option<&str>,
    requested_profile: Option<&str>,
) -> Result<WorkspaceAdmission, AdmissionRejection> {
    let (mode, claim_state) = match request {
        WorkspaceRequest::Inherit { cwd }
        | WorkspaceRequest::SharedReadOnly { cwd }
        | WorkspaceRequest::CompatibilitySpawn { cwd } => {
            let effective_cwd = cwd.as_deref().unwrap_or(parent_cwd);
            if effective_cwd.is_empty() {
                return Err(AdmissionRejection::new(
                    RejectionCode::WorkspaceUnavailable,
                    "the calling thread has no working directory; pass cwd or workspace.cwd",
                ));
            }
            (
                WorkspaceMode::LegacyShared,
                WorkspaceClaimState::Shared {
                    effective_cwd: effective_cwd.to_owned(),
                },
            )
        }
        WorkspaceRequest::IsolatedWrite { source_workspace } => {
            let source_workspace = source_workspace.as_deref().unwrap_or(parent_cwd);
            if source_workspace.is_empty() {
                return Err(AdmissionRejection::new(
                    RejectionCode::WorkspaceUnavailable,
                    "the calling thread has no working directory; pass workspace.sourceWorkspace",
                ));
            }
            (
                WorkspaceMode::IsolatedWrite,
                WorkspaceClaimState::Pending {
                    source_workspace: source_workspace.to_owned(),
                },
            )
        }
    };
    let target_profile = profiles::child_profile(parent_profile, requested_profile)
        .map_err(|message| AdmissionRejection::new(RejectionCode::PermissionDenied, message))?;
    Ok(WorkspaceAdmission {
        mode,
        claim_state,
        target_profile,
    })
}

#[must_use]
pub fn permission_envelope(
    parent_profile: Option<&str>,
    requested_profile: Option<&str>,
    translated_profile: String,
) -> PermissionEnvelope {
    PermissionEnvelope {
        execution_policy: None,
        parent_ceiling: parent_profile.unwrap_or("(unknown)").to_owned(),
        requested_profile: requested_profile.map(str::to_owned),
        translated_profile,
    }
}
