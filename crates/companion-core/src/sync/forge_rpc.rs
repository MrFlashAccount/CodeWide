//! Composition of the forge and review contexts into the sync hub: their
//! construction, RPC dispatch and event observation.
//!
//! Every `companion/forge*`, `companion/pullRequest*` and
//! `companion/review*` method is claimed here before anything could forward
//! it to Codex App Server, even when the services are absent or every
//! provider is disabled. Params are never logged: one method carries a
//! pasted token.

use std::{path::PathBuf, sync::Arc};

use async_trait::async_trait;
use serde_json::{Value, json};
use tracing::info;

use super::{SessionSocket, SyncHub, send_json};
use crate::{
    agent::{
        client_tools::CompositeToolHost, client_wire::gateway::ClientWireGateway,
        model::Capability, orchestration::OrchestrationService, provider::NativeThreadResources,
        registry::ProviderRegistry,
    },
    agent_bridge::AgentBridge,
    forge::{ForgeConfig, ForgeDeps, ForgeEvents, ForgeService},
    projects::ProjectService,
    review::{
        ReviewEvents, ReviewService,
        catalogs::{SessionCatalog, ThreadResourcesLookup, VcsCatalog},
        source::SourceKind,
    },
    vcs::VcsService,
    workspaces::WorkspaceAdmission,
};

/// What a host supplies to run forge and review.
pub struct ForgeHostConfig {
    pub forge: ForgeConfig,
    pub vcs: Arc<VcsService>,
    pub projects: Arc<ProjectService>,
    /// The companion home: the working directory of threads created without
    /// a workspace.
    pub home: PathBuf,
}

impl ForgeHostConfig {
    /// The standard layout under a companion state directory; threads
    /// created without a workspace run in `HOME`.
    #[must_use]
    pub fn standard(
        state_directory: &std::path::Path,
        bundled_plugin_directory: Option<PathBuf>,
        vcs: Arc<VcsService>,
        projects: Arc<ProjectService>,
    ) -> Self {
        Self {
            forge: ForgeConfig::under(state_directory, bundled_plugin_directory),
            vcs,
            projects,
            home: std::env::var_os("HOME")
                .map_or_else(|| state_directory.to_path_buf(), PathBuf::from),
        }
    }
}

/// The services installed into the hub.
#[derive(Clone)]
pub(super) struct ForgeServices {
    pub(super) forge: Arc<ForgeService>,
    pub(super) review: Arc<ReviewService>,
}

/// Session resources by thread, routed like the hub's own resource reads.
struct HubResources {
    gateway: Arc<ClientWireGateway>,
}

#[async_trait]
impl ThreadResourcesLookup for HubResources {
    async fn resources(&self, thread_id: &str) -> Option<Arc<dyn NativeThreadResources>> {
        let registry = self.gateway.registry();
        let owner = registry
            .owner(Capability::HistoryThreadResources)
            .and_then(|provider| provider.native_surface()?.thread_resources());
        let target = self
            .gateway
            .resolve_thread(thread_id, Some(Capability::HistoryThreadResources))
            .await
            .ok()?;
        if target.native().is_none()
            && let Some(own) = target.provider.thread_resources()
        {
            return Some(own);
        }
        owner
    }
}

impl SyncHub {
    /// Installs the forge and review contexts. The forge tool joins the
    /// composite client tool host installed at construction.
    #[must_use]
    pub fn with_forge(self, config: ForgeHostConfig) -> Self {
        let agents = (self.mutation_mode == super::MutationMode::Active).then(|| {
            AgentBridge::new(
                self.gateway.clone(),
                self.store.clone(),
                self.outbox_wakeup.clone(),
                self.local_events.clone(),
            )
        });
        let admission = Arc::new(WorkspaceAdmission::new(
            config.projects,
            self.store.clone(),
            config.home,
        ));
        let review = ReviewService::new(
            self.store.clone(),
            ReviewEvents::new(self.local_events.clone()),
            agents.clone(),
            Some(admission.clone()),
        );
        review.sources().register(
            SourceKind::Vcs,
            Arc::new(VcsCatalog::new(config.vcs.clone())),
        );
        review.sources().register(
            SourceKind::Session,
            Arc::new(SessionCatalog::new(Arc::new(HubResources {
                gateway: self.gateway.clone(),
            }))),
        );
        let forge = ForgeService::new(
            config.forge,
            ForgeDeps {
                store: self.store.clone(),
                events: ForgeEvents::new(self.local_events.clone()),
                review: review.clone(),
                agents,
                workspaces: Some(admission),
                vcs: Some(config.vcs),
            },
        );
        if let Some(tools) = &self.agents.tools {
            tools.attach_forge(forge.tools());
        }
        info!("forge and review services installed");
        match self.agents.forge.write() {
            Ok(mut slot) => *slot = Some(ForgeServices { forge, review }),
            Err(poisoned) => *poisoned.into_inner() = Some(ForgeServices { forge, review }),
        }
        self
    }

    /// The forge service, when installed (admin routes use it).
    #[must_use]
    pub fn forge(&self) -> Option<Arc<ForgeService>> {
        self.forge_services().map(|services| services.forge)
    }

    pub(super) fn forge_services(&self) -> Option<ForgeServices> {
        match self.agents.forge.read() {
            Ok(slot) => slot.clone(),
            Err(poisoned) => poisoned.into_inner().clone(),
        }
    }

    /// Answers a forge or review method; `false` for any other method.
    pub(super) async fn try_handle_forge_rpc(
        &self,
        socket: &SessionSocket,
        id: &Value,
        method: &str,
        params: &Value,
    ) -> Result<bool, ()> {
        let forge_family = ForgeService::handles(method);
        if !forge_family && !ReviewService::handles(method) {
            return Ok(false);
        }
        let Some(services) = self.forge_services() else {
            let error = crate::forge::errors::ForgeError::ProviderUnavailable {
                plugin_id: None,
                capability: None,
                reason: "Forge support is not available on this companion".into(),
            };
            respond(socket, id, Err(error.to_rpc_error())).await?;
            return Ok(true);
        };
        let result = if forge_family {
            services
                .forge
                .handle(method, params)
                .await
                .map_err(|error| {
                    info!(method, kind = error.log_kind(), "forge RPC failed");
                    error.to_rpc_error()
                })
        } else {
            services
                .review
                .handle(method, params)
                .await
                .map_err(|error| {
                    let rpc = error.to_rpc_error();
                    info!(
                        method,
                        code = rpc["code"].as_i64().unwrap_or(0),
                        "review RPC failed"
                    );
                    rpc
                })
        };
        respond(socket, id, result).await?;
        Ok(true)
    }
}

/// Installs the composite client tool host (orchestration plus the forge
/// link tool) into every enabled provider; `None` without orchestration.
pub(super) fn install_client_tools(
    orchestration: Option<&Arc<OrchestrationService>>,
    registry: &ProviderRegistry,
) -> Option<Arc<CompositeToolHost>> {
    let composite = CompositeToolHost::new(orchestration?.clone(), crate::forge::tools::spec());
    for provider in registry.enabled() {
        let host: Arc<dyn agent_core::provider::ClientToolHost> = composite.clone();
        provider.install_client_tools(Arc::downgrade(&host));
    }
    Some(composite)
}

/// Feeds client-wire events to branch detection and guide completion.
pub(super) fn observe_forge_event(slot: &ForgeSlot, payload: &Value) {
    let services = match slot.read() {
        Ok(slot) => slot.clone(),
        Err(poisoned) => poisoned.into_inner().clone(),
    };
    let Some(services) = services else {
        return;
    };
    services.forge.observe_event(payload);
    if payload.get("method").and_then(Value::as_str) == Some("turn/completed")
        && let Some(thread) = payload
            .pointer("/params/threadId")
            .and_then(Value::as_str)
            .map(str::to_owned)
    {
        let review = services.review;
        tokio::spawn(async move {
            crate::review::guide::observe_turn_end(&review, &thread).await;
        });
    }
}

/// The hub's late-bound forge and review services.
pub(super) type ForgeSlot = std::sync::RwLock<Option<ForgeServices>>;

async fn respond(
    socket: &SessionSocket,
    id: &Value,
    result: Result<Value, Value>,
) -> Result<(), ()> {
    let response = match result {
        Ok(result) => json!({ "type": "rpc", "response": { "id": id, "result": result } }),
        Err(error) => json!({ "type": "rpc", "response": { "id": id, "error": error } }),
    };
    send_json(socket, &response).await.map_err(|_| ())
}
