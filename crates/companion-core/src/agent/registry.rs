//! The set of enabled providers, the capability index and host-capability
//! owners.
//!
//! Providers are kept in provider-id order. No provider is configured as
//! preferred: the lead is the provider that declares `codex.native`, the
//! Codex App Server surface the client wire speaks. The lead's raw surface
//! answers the merged `thread/list`, `model/list` and
//! `permissionProfile/list`, its runtime request ids pass through unprefixed,
//! and it is the default provider of a new thread. Mapping provider ids to
//! adapters is `build_registry` in `agent/providers/mod.rs`, the only code
//! outside the adapter crates that branches on a provider id. Everywhere else
//! providers are selected by binding or by capability.

use std::sync::Arc;

use agent_core::usage::UsagePricing;

use super::{
    model::{Capability, ProviderId},
    provider::AgentProvider,
};

#[derive(Debug, thiserror::Error)]
pub enum RegistryError {
    #[error("no provider is enabled")]
    Empty,
    #[error("provider {0} is registered twice")]
    Duplicate(String),
}

/// Enabled providers in provider-id order.
pub struct ProviderRegistry {
    providers: Vec<Arc<dyn AgentProvider>>,
    ids: Vec<ProviderId>,
    /// Index of the lead provider in `providers`.
    lead: usize,
}

impl ProviderRegistry {
    /// Builds a registry of `providers` in provider-id order.
    ///
    /// # Errors
    /// Returns an error when `providers` is empty or an id repeats.
    pub fn new(mut providers: Vec<Arc<dyn AgentProvider>>) -> Result<Self, RegistryError> {
        providers.sort_by_key(|provider| provider.descriptor().id);
        let ids = providers
            .iter()
            .map(|provider| provider.descriptor().id)
            .collect::<Vec<_>>();
        if providers.is_empty() {
            return Err(RegistryError::Empty);
        }
        if let Some(pair) = ids.windows(2).find(|pair| pair[0] == pair[1]) {
            return Err(RegistryError::Duplicate(pair[0].to_string()));
        }
        // The provider speaking the client's native wire leads; a host
        // without one (test hosts) is led by the first id.
        let lead = providers
            .iter()
            .position(|provider| provider.capabilities().supports(Capability::CodexNative))
            .unwrap_or(0);
        Ok(Self {
            providers,
            ids,
            lead,
        })
    }

    /// A registry with one provider, which leads.
    #[must_use]
    pub fn single(provider: Arc<dyn AgentProvider>) -> Self {
        let id = provider.descriptor().id;
        Self {
            providers: vec![provider],
            ids: vec![id],
            lead: 0,
        }
    }

    /// Ends every enabled provider's live work (companion shutdown),
    /// concurrently.
    pub async fn shutdown(&self) {
        futures_util::future::join_all(self.providers.iter().map(|provider| provider.shutdown()))
            .await;
    }

    /// The lead provider: the one declaring `codex.native` (Codex). Its raw
    /// surface answers the merged list methods, its request ids are
    /// unprefixed, and it is the default provider of `thread/start` without
    /// `codewideAgentProvider` and of companion-created threads.
    #[must_use]
    pub fn lead(&self) -> &Arc<dyn AgentProvider> {
        &self.providers[self.lead]
    }

    #[must_use]
    pub fn lead_id(&self) -> &ProviderId {
        &self.ids[self.lead]
    }

    #[must_use]
    pub fn is_lead(&self, id: &ProviderId) -> bool {
        self.lead_id() == id
    }

    /// Whether more than one provider is enabled. Client-wire extensions
    /// (`codewideAgent`, `codewideAgentProvider`) are attached only then, so
    /// a single-provider host keeps today's wire byte-for-byte.
    #[must_use]
    pub fn is_multi_provider(&self) -> bool {
        self.providers.len() > 1
    }

    /// The enabled providers' price tables in registry order, each owned by
    /// its provider so a thread is priced only by its own provider's table.
    #[must_use]
    pub fn usage_pricing(&self) -> UsagePricing {
        UsagePricing::by_provider(
            self.ids
                .iter()
                .zip(&self.providers)
                .filter_map(|(id, provider)| {
                    provider.usage_pricing().map(|table| (id.clone(), table))
                })
                .collect(),
        )
    }

    /// The enabled providers' cleaners of their own formats in user text;
    /// a thread of an unknown provider is native-wire text, cleaned by the
    /// lead's.
    #[must_use]
    pub(crate) fn user_text_cleaners(&self) -> crate::user_message_projection::UserTextCleaners {
        crate::user_message_projection::UserTextCleaners::new(
            self.ids
                .iter()
                .zip(&self.providers)
                .filter_map(|(id, provider)| {
                    provider
                        .user_text_cleaner()
                        .map(|cleaner| (id.clone(), cleaner))
                })
                .collect(),
            self.lead_id().clone(),
        )
    }

    #[must_use]
    pub fn get(&self, id: &ProviderId) -> Option<&Arc<dyn AgentProvider>> {
        self.ids
            .iter()
            .position(|candidate| candidate == id)
            .map(|index| &self.providers[index])
    }

    /// Enabled providers in provider-id order.
    pub fn enabled(&self) -> impl Iterator<Item = &Arc<dyn AgentProvider>> {
        self.providers.iter()
    }

    /// Enabled providers other than the lead, in provider-id order.
    pub fn others(&self) -> impl Iterator<Item = &Arc<dyn AgentProvider>> {
        let lead = self.lead;
        self.providers
            .iter()
            .enumerate()
            .filter(move |(index, _)| *index != lead)
            .map(|(_, provider)| provider)
    }

    /// The owner of a host-level capability (`host.fs`, `host.config`,
    /// account methods, stored history): the lead when it declares
    /// `capability`, else the first declaring provider in id order.
    #[must_use]
    pub fn owner(&self, capability: Capability) -> Option<&Arc<dyn AgentProvider>> {
        std::iter::once(self.lead())
            .chain(self.others())
            .find(|provider| provider.capabilities().supports(capability))
    }

    /// Providers that can recognize thread ids created outside `CodeWide`:
    /// the lead first, then the others in id order.
    pub fn discovery_providers(&self) -> impl Iterator<Item = &Arc<dyn AgentProvider>> {
        std::iter::once(self.lead())
            .chain(self.others())
            .filter(|provider| {
                provider
                    .capabilities()
                    .supports(Capability::ThreadsExternalDiscovery)
            })
    }
}

/// Display name for a provider that is not enabled, used in `-32070`.
#[must_use]
pub fn disabled_provider_name(id: &ProviderId) -> String {
    let mut characters = id.as_str().chars();
    characters.next().map_or_else(String::new, |first| {
        first.to_uppercase().chain(characters).collect()
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn disabled_provider_names_are_capitalized_ids() {
        let id = ProviderId::parse("claude");
        assert_eq!(
            id.as_ref().map(disabled_provider_name).as_deref(),
            Some("Claude")
        );
    }
}
