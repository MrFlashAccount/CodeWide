//! Host-owned admission policy for durable delegation.
//!
//! The model selects only a target, a narrower permission request and one of
//! the public workspace modes. Provenance and the parent ceiling come from
//! the authenticated tool-call context and parent thread read.

use serde::Serialize;

use super::{
    profiles,
    task::{PermissionEnvelope, WorkspaceClaimState, WorkspaceMode},
    tools::WorkspaceRequest,
};
use crate::agent::permission_profiles::READ_ONLY;

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
    let (mode, claim_state, requested) = match request {
        WorkspaceRequest::SharedReadOnly { cwd } => {
            let effective_cwd = cwd.as_deref().unwrap_or(parent_cwd);
            if effective_cwd.is_empty() {
                return Err(AdmissionRejection::new(
                    RejectionCode::WorkspaceUnavailable,
                    "the calling thread has no working directory; pass workspace.cwd",
                ));
            }
            (
                WorkspaceMode::SharedReadOnly,
                WorkspaceClaimState::Shared {
                    effective_cwd: effective_cwd.to_owned(),
                },
                Some(":read-only"),
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
                requested_profile,
            )
        }
        WorkspaceRequest::CompatibilitySpawn { cwd } => {
            let source_workspace = cwd.as_deref().unwrap_or(parent_cwd);
            if source_workspace.is_empty() {
                return Err(AdmissionRejection::new(
                    RejectionCode::WorkspaceUnavailable,
                    "the calling thread has no working directory; pass cwd",
                ));
            }
            match requested_profile {
                None | Some(READ_ONLY) => (
                    WorkspaceMode::SharedReadOnly,
                    WorkspaceClaimState::Shared {
                        effective_cwd: source_workspace.to_owned(),
                    },
                    Some(READ_ONLY),
                ),
                Some(requested_profile) => (
                    WorkspaceMode::IsolatedWrite,
                    WorkspaceClaimState::Pending {
                        source_workspace: source_workspace.to_owned(),
                    },
                    Some(requested_profile),
                ),
            }
        }
    };
    let target_profile = profiles::child_profile(parent_profile, requested)
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
        parent_ceiling: parent_profile.unwrap_or(":read-only").to_owned(),
        requested_profile: requested_profile.map(str::to_owned),
        translated_profile,
    }
}
