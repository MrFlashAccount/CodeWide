//! Agent service composition for the sync host.
//!
//! Active hosts install durable orchestration tools; passive shadows keep
//! only read-side fork observation and never expose mutation tools.

use std::sync::Arc;

use serde_json::Value;

use crate::{
    agent::{
        client_tools::CompositeToolHost, client_wire::gateway::ClientWireGateway,
        fork::ForkService, model::ProviderId, orchestration::OrchestrationService,
        permission_profiles::ProfileObservations, registry::ProviderRegistry,
    },
    store::IndexStore,
    turn_delivery::TurnDelivery,
    workspaces::WorkspaceService,
};

use super::forge_rpc;

/// Agent-layer services that observe each provider's client-wire stream.
#[derive(Clone)]
pub(super) struct AgentObservers {
    pub(super) orchestration: Option<Arc<OrchestrationService>>,
    pub(super) fork: Arc<ForkService>,
    /// The client tool host installed into every provider (active mutation
    /// mode only); it also keeps the hosts alive for the providers' weak
    /// references.
    pub(super) tools: Option<Arc<CompositeToolHost>>,
    pub(super) forge: Arc<forge_rpc::ForgeSlot>,
}

impl AgentObservers {
    pub(super) fn observe_event(&self, provider: &ProviderId, payload: &Value) {
        if let Some(orchestration) = &self.orchestration {
            orchestration.observe_event(provider, payload);
        }
        self.fork.observe_event(payload);
        forge_rpc::observe_forge_event(&self.forge, payload);
    }
}

pub(super) struct AgentComposition<'a> {
    pub(super) active: bool,
    pub(super) registry: &'a Arc<ProviderRegistry>,
    pub(super) gateway: &'a Arc<ClientWireGateway>,
    pub(super) store: &'a Arc<IndexStore>,
    pub(super) local_events: &'a tokio::sync::mpsc::Sender<Value>,
    pub(super) permission_profiles: Arc<ProfileObservations>,
    pub(super) turn_delivery: TurnDelivery,
    pub(super) workspaces: Arc<std::sync::RwLock<Option<Arc<WorkspaceService>>>>,
}

impl AgentComposition<'_> {
    pub(super) fn compose(self) -> AgentObservers {
        let orchestration = self.active.then(|| {
            let service = OrchestrationService::with_turn_delivery(
                self.gateway.clone(),
                self.store,
                self.local_events.clone(),
                self.permission_profiles.clone(),
                self.turn_delivery,
                self.workspaces,
            );
            service
        });
        let tools = forge_rpc::install_client_tools(orchestration.as_ref(), self.registry);
        AgentObservers {
            tools,
            forge: Arc::default(),
            orchestration,
            fork: ForkService::new(
                self.gateway.clone(),
                self.store.clone(),
                self.local_events.clone(),
                self.permission_profiles,
            ),
        }
    }
}
