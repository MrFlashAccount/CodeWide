//! Codex host integration of the sync hub: constructors that build a
//! Codex-only registry from an App Server connection (the existing host
//! flags and tests) with the Codex storage attached to the adapter, and
//! installation of the Codex-owned account pool.
//!
//! The account pool lives inside the Codex adapter; the hub only journals
//! its events. Hosts with more providers build the registry with
//! `agent::providers::build_registry` and call `SyncHub::with_registry`.

use std::sync::Arc;

use super::{CodexProvider, storage::CodexStorage};
use crate::{
    account_pool::AccountPoolService, history_service::HistoryService, store::IndexStore,
    sync::SyncHub, upstream::UpstreamHandle,
};

impl SyncHub {
    /// Creates a passive event/replay companion over one App Server that
    /// does not execute client RPC.
    #[must_use]
    pub fn new(upstream: UpstreamHandle, store: Arc<IndexStore>, history: HistoryService) -> Self {
        let codex = Arc::new(CodexProvider::new(upstream).with_storage(CodexStorage::new(history)));
        Self::with_registry(
            Arc::new(super::super::codex_only(codex, Vec::new())),
            store,
            false,
        )
    }

    /// Creates an active companion over one App Server with authenticated
    /// RPC forwarding and durable command delivery.
    #[must_use]
    pub fn with_mutations(
        upstream: UpstreamHandle,
        store: Arc<IndexStore>,
        history: HistoryService,
    ) -> Self {
        let codex = Arc::new(CodexProvider::new(upstream).with_storage(CodexStorage::new(history)));
        Self::with_registry(
            Arc::new(super::super::codex_only(codex, Vec::new())),
            store,
            true,
        )
    }

    /// Installs the companion-owned multi-account scheduler into the Codex
    /// adapter and journals its events through the durable client channel.
    #[must_use]
    pub fn with_account_pool(self, account_pool: &Arc<AccountPoolService>) -> Self {
        let codex = self
            .registry()
            .enabled()
            .find_map(|provider| provider.as_any().downcast_ref::<CodexProvider>());
        if let Some(codex) = codex {
            codex.install_account_pool(account_pool.clone());
            self.forward_provider_local_events(account_pool.subscribe_events());
        }
        self
    }
}
