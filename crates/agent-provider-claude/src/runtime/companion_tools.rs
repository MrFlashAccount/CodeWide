//! The companion's client tools as the sessions see them: the declared set
//! of the `ClientToolHost` the companion installs once, and its calls on
//! this provider's behalf. Until it is installed there are no client tools.

use std::sync::{Arc, OnceLock, Weak};

use agent_core::{
    model::{ClientToolSpec, ProviderId, ToolCallParams, ToolCallResult},
    provider::ClientToolHost,
};

use crate::session::{ports::ClientTools, query::BoxFuture};

/// The installed `ClientToolHost`, held weakly: the companion owns it.
pub struct CompanionTools {
    host: OnceLock<Weak<dyn ClientToolHost>>,
    provider: ProviderId,
}

impl CompanionTools {
    #[must_use]
    pub fn new(provider: ProviderId) -> Self {
        Self {
            host: OnceLock::new(),
            provider,
        }
    }

    /// Installs the host; `false` when one is installed already.
    pub fn install(&self, host: Weak<dyn ClientToolHost>) -> bool {
        self.host.set(host).is_ok()
    }

    fn host(&self) -> Option<Arc<dyn ClientToolHost>> {
        self.host.get()?.upgrade()
    }
}

impl ClientTools for CompanionTools {
    fn specs(&self) -> Vec<ClientToolSpec> {
        self.host()
            .map(|host| host.specs().to_vec())
            .unwrap_or_default()
    }

    fn call(&self, params: ToolCallParams) -> BoxFuture<'static, ToolCallResult> {
        let host = self.host();
        let provider = self.provider.clone();
        Box::pin(async move {
            match host {
                Some(host) => host.call(&provider, params).await,
                None => ToolCallResult::failure(
                    "client tools are not available on this companion".into(),
                ),
            }
        })
    }
}
