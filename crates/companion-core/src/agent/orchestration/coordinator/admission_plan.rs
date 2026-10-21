//! Admission planning and deterministic delegation identities.
//!
//! This module owns the pure host-policy plan assembled before durable task
//! admission. Runtime child creation and recovery remain in the coordinator.

use super::CallIdentity;
use crate::agent::{
    client_wire::gateway::default_model,
    model::{AppThreadId, Capability, ThreadSettings},
};

use crate::agent::orchestration::{
    Caller, OrchestrationService, ToolError,
    admission::{self, AdmissionRejection, RejectionCode},
    task::{PermissionEnvelope, WorkspaceClaimState, WorkspaceMode},
    tools::{DelegateRequest, WorkspaceRequest},
};

pub(super) struct DelegatePlan {
    pub(super) wire: crate::agent::client_wire::WireProvider,
    pub(super) settings: ThreadSettings,
    pub(super) workspace_mode: WorkspaceMode,
    pub(super) claim_state: WorkspaceClaimState,
    pub(super) permission: PermissionEnvelope,
    pub(super) root_thread_id: AppThreadId,
}

impl OrchestrationService {
    pub(super) async fn plan_delegate(
        &self,
        caller: &Caller,
        request: &DelegateRequest,
    ) -> Result<DelegatePlan, ToolError> {
        let parent = caller
            .provider
            .thread_read(&caller.thread)
            .await
            .map_err(|error| {
                ToolError::admission(AdmissionRejection::new(
                    RejectionCode::ProviderUnavailable,
                    format!("cannot read the calling thread: {error}"),
                ))
            })?
            .thread;
        let target = match &request.provider {
            Some(id) => self.gateway.registry().get(id).cloned().ok_or_else(|| {
                ToolError::admission(AdmissionRejection::new(
                    RejectionCode::ProviderUnavailable,
                    format!("unknown or disabled agent provider: {id}"),
                ))
            })?,
            None => caller.provider.clone(),
        };
        if !matches!(
            &request.workspace,
            WorkspaceRequest::CompatibilitySpawn { .. }
        ) && !target
            .capabilities()
            .supports(Capability::OrchestrationTools)
        {
            return Err(ToolError::admission(AdmissionRejection::new(
                RejectionCode::CapabilityUnavailable,
                "the target provider cannot install orchestration tools",
            )));
        }
        let wire = self.gateway.wire(&target);
        let same_provider = wire.descriptor.id == caller.provider.descriptor().id;
        let model = match &request.model {
            Some(model) => model.clone(),
            None if same_provider && !parent.settings.model.is_empty() => {
                parent.settings.model.clone()
            }
            None => default_model(&target).await.map_err(|failure| {
                ToolError::admission(AdmissionRejection::new(
                    RejectionCode::ProviderUnavailable,
                    format!("no default model: {}", failure.message),
                ))
            })?,
        };
        let parent_profile = Some(parent.settings.permission_profile)
            .filter(|profile| !profile.is_empty())
            .or_else(|| {
                self.profiles
                    .get(&caller.provider.descriptor().id, caller.thread.as_str())
            });
        let workspace = admission::workspace(
            &request.workspace,
            &parent.cwd,
            parent_profile.as_deref(),
            request.permission_profile.as_deref(),
        )
        .map_err(ToolError::admission)?;
        if workspace.mode == WorkspaceMode::IsolatedWrite && self.workspaces().is_none() {
            return Err(ToolError::admission(AdmissionRejection::new(
                RejectionCode::WorkspaceUnavailable,
                "workspace.create@1 is unavailable on this host",
            )));
        }
        let translated_profile = crate::agent::permission_profiles::for_provider(
            &target,
            workspace.target_profile.clone(),
        )
        .await
        .map_err(|message| {
            ToolError::admission(AdmissionRejection::new(
                RejectionCode::PermissionDenied,
                message,
            ))
        })?;
        let permission = admission::permission_envelope(
            parent_profile.as_deref(),
            request.permission_profile.as_deref(),
            translated_profile.clone(),
        );
        Ok(DelegatePlan {
            wire,
            settings: ThreadSettings {
                model,
                effort: None,
                permission_profile: translated_profile,
                service_tier: None,
            },
            workspace_mode: workspace.mode,
            claim_state: workspace.claim_state,
            permission,
            root_thread_id: self.root_thread(&caller.thread).await?,
        })
    }

    async fn root_thread(&self, thread: &AppThreadId) -> Result<AppThreadId, ToolError> {
        let mut root = thread.clone();
        let mut seen = std::collections::HashSet::from([root.as_str().to_owned()]);
        while let Some(parent) = self
            .links
            .parent_of(root.as_str())
            .await
            .map_err(|error| ToolError::message(error.to_string()))?
        {
            if !seen.insert(parent.clone()) {
                break;
            }
            let Some(parent) = AppThreadId::parse(&parent) else {
                break;
            };
            root = parent;
        }
        Ok(root)
    }
}

pub(super) fn call_key(identity: &CallIdentity) -> String {
    let mut hasher = blake3::Hasher::new();
    for part in [
        identity.provider.as_str(),
        identity.thread.as_str(),
        identity.turn.as_str(),
        identity.call_id.as_str(),
        identity.tool.as_str(),
    ] {
        hasher.update(part.as_bytes());
        hasher.update(&[0]);
    }
    hasher.finalize().to_hex().to_string()
}

pub(super) fn request_hash(request: &DelegateRequest) -> Result<String, ToolError> {
    let encoded = serde_json::to_vec(request)
        .map_err(|error| ToolError::message(format!("request encoding failed: {error}")))?;
    Ok(blake3::hash(&encoded).to_hex().to_string())
}

pub(super) fn unix_time_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |elapsed| {
            u64::try_from(elapsed.as_millis()).unwrap_or(u64::MAX)
        })
}
