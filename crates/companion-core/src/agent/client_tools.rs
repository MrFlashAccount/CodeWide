//! The composite client tool host installed into every provider.
//!
//! `install_client_tools` is called at most once per provider, so the
//! orchestration tools and the forge link tool share one host. The forge
//! host is attached after the forge service starts; until then (or on a
//! companion without forge) the link tool answers "no connected forge
//! account" as an unsuccessful tool result. The declared tool list is fixed
//! for the provider's lifetime.

use std::sync::{Arc, OnceLock};

use async_trait::async_trait;

use crate::agent::{
    model::{ClientToolSpec, ProviderId, ToolCallParams, ToolCallResult},
    provider::ClientToolHost,
};

pub struct CompositeToolHost {
    orchestration: Arc<dyn ClientToolHost>,
    forge: OnceLock<Arc<dyn ClientToolHost>>,
    forge_tool: String,
    specs: Vec<ClientToolSpec>,
}

impl CompositeToolHost {
    #[must_use]
    pub fn new(orchestration: Arc<dyn ClientToolHost>, forge_spec: ClientToolSpec) -> Arc<Self> {
        let mut specs = orchestration.specs().to_vec();
        let forge_tool = forge_spec.name.clone();
        specs.push(forge_spec);
        Arc::new(Self {
            orchestration,
            forge: OnceLock::new(),
            forge_tool,
            specs,
        })
    }

    /// Attaches the forge tool host once.
    pub fn attach_forge(&self, forge: Arc<dyn ClientToolHost>) {
        let _ = self.forge.set(forge);
    }
}

#[async_trait]
impl ClientToolHost for CompositeToolHost {
    fn specs(&self) -> &[ClientToolSpec] {
        &self.specs
    }

    async fn call(&self, provider: &ProviderId, call: ToolCallParams) -> ToolCallResult {
        if call.tool == self.forge_tool {
            return match self.forge.get() {
                Some(forge) => forge.call(provider, call).await,
                None => ToolCallResult::failure("no connected forge account".to_owned()),
            };
        }
        self.orchestration.call(provider, call).await
    }
}
