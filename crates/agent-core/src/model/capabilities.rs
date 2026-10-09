//! Capability vocabulary of `codewide-agent` v1 (mirror of
//! `packages/agent-protocol/src/v1/capabilities.ts`).
//!
//! A provider declares its complete set at `initialize`. Routing and
//! degradation consult only these names; provider ids are never inspected
//! outside a provider's own adapter.

use serde::{Deserialize, Serialize};

/// Every boolean capability of v1, in protocol order.
#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub enum Capability {
    TurnsSteer,
    TurnsProviderInitiated,
    ThreadsHostMintedIds,
    ThreadsExternalDiscovery,
    ThreadsCompact,
    ThreadsFork,
    RequestsUserInput,
    RequestsMcpElicitation,
    RequestsDynamicToolCall,
    SettingsServiceTier,
    SettingsPersonality,
    InputSkillsAndMentions,
    CatalogSkillsPlugins,
    Review,
    Goals,
    BackgroundTerminals,
    RealtimeVoice,
    GlobalSupervisor,
    SubagentThreads,
    AccountsPool,
    AccountsRateLimits,
    HistoryThreadResources,
    HistoryMessageSearch,
    HostFs,
    HostConfig,
    CodexNative,
    OrchestrationTools,
    ThreadsCrossProviderFork,
}

impl Capability {
    pub const ALL: [Self; 28] = [
        Self::TurnsSteer,
        Self::TurnsProviderInitiated,
        Self::ThreadsHostMintedIds,
        Self::ThreadsExternalDiscovery,
        Self::ThreadsCompact,
        Self::ThreadsFork,
        Self::RequestsUserInput,
        Self::RequestsMcpElicitation,
        Self::RequestsDynamicToolCall,
        Self::SettingsServiceTier,
        Self::SettingsPersonality,
        Self::InputSkillsAndMentions,
        Self::CatalogSkillsPlugins,
        Self::Review,
        Self::Goals,
        Self::BackgroundTerminals,
        Self::RealtimeVoice,
        Self::GlobalSupervisor,
        Self::SubagentThreads,
        Self::AccountsPool,
        Self::AccountsRateLimits,
        Self::HistoryThreadResources,
        Self::HistoryMessageSearch,
        Self::HostFs,
        Self::HostConfig,
        Self::CodexNative,
        Self::OrchestrationTools,
        Self::ThreadsCrossProviderFork,
    ];

    /// Protocol name of the capability.
    #[must_use]
    pub const fn name(self) -> &'static str {
        match self {
            Self::TurnsSteer => "turns.steer",
            Self::TurnsProviderInitiated => "turns.providerInitiated",
            Self::ThreadsHostMintedIds => "threads.hostMintedIds",
            Self::ThreadsExternalDiscovery => "threads.externalDiscovery",
            Self::ThreadsCompact => "threads.compact",
            Self::ThreadsFork => "threads.fork",
            Self::RequestsUserInput => "requests.userInput",
            Self::RequestsMcpElicitation => "requests.mcpElicitation",
            Self::RequestsDynamicToolCall => "requests.dynamicToolCall",
            Self::SettingsServiceTier => "settings.serviceTier",
            Self::SettingsPersonality => "settings.personality",
            Self::InputSkillsAndMentions => "input.skillsAndMentions",
            Self::CatalogSkillsPlugins => "catalog.skillsPlugins",
            Self::Review => "review",
            Self::Goals => "goals",
            Self::BackgroundTerminals => "backgroundTerminals",
            Self::RealtimeVoice => "realtimeVoice",
            Self::GlobalSupervisor => "globalSupervisor",
            Self::SubagentThreads => "subagentThreads",
            Self::AccountsPool => "accounts.pool",
            Self::AccountsRateLimits => "accounts.rateLimits",
            Self::HistoryThreadResources => "history.threadResources",
            Self::HistoryMessageSearch => "history.messageSearch",
            Self::HostFs => "host.fs",
            Self::HostConfig => "host.config",
            Self::CodexNative => "codex.native",
            Self::OrchestrationTools => "orchestration.tools",
            Self::ThreadsCrossProviderFork => "threads.crossProviderFork",
        }
    }
}

/// What `turn.start` does while a turn of the same thread is active.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum StartWhileActiveMode {
    /// The provider refuses with `busy`; the companion keeps the command queued.
    Busy,
    /// The provider joins the active turn itself and reports `started`.
    NativeJoin,
}

/// The complete capability declaration of one provider.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[allow(clippy::struct_excessive_bools)] // WHY: the wire contract is one flag per capability name.
pub struct CapabilitySet {
    #[serde(rename = "turns.steer")]
    pub turns_steer: bool,
    #[serde(rename = "turns.providerInitiated")]
    pub turns_provider_initiated: bool,
    #[serde(rename = "threads.hostMintedIds")]
    pub threads_host_minted_ids: bool,
    #[serde(rename = "threads.externalDiscovery")]
    pub threads_external_discovery: bool,
    #[serde(rename = "threads.compact")]
    pub threads_compact: bool,
    #[serde(rename = "threads.fork")]
    pub threads_fork: bool,
    #[serde(rename = "requests.userInput")]
    pub requests_user_input: bool,
    #[serde(rename = "requests.mcpElicitation")]
    pub requests_mcp_elicitation: bool,
    #[serde(rename = "requests.dynamicToolCall")]
    pub requests_dynamic_tool_call: bool,
    #[serde(rename = "settings.serviceTier")]
    pub settings_service_tier: bool,
    #[serde(rename = "settings.personality")]
    pub settings_personality: bool,
    #[serde(rename = "input.skillsAndMentions")]
    pub input_skills_and_mentions: bool,
    #[serde(rename = "catalog.skillsPlugins")]
    pub catalog_skills_plugins: bool,
    pub review: bool,
    pub goals: bool,
    #[serde(rename = "backgroundTerminals")]
    pub background_terminals: bool,
    #[serde(rename = "realtimeVoice")]
    pub realtime_voice: bool,
    #[serde(rename = "globalSupervisor")]
    pub global_supervisor: bool,
    #[serde(rename = "subagentThreads")]
    pub subagent_threads: bool,
    #[serde(rename = "accounts.pool")]
    pub accounts_pool: bool,
    #[serde(rename = "accounts.rateLimits")]
    pub accounts_rate_limits: bool,
    #[serde(rename = "history.threadResources")]
    pub history_thread_resources: bool,
    #[serde(rename = "history.messageSearch")]
    pub history_message_search: bool,
    #[serde(rename = "host.fs")]
    pub host_fs: bool,
    #[serde(rename = "host.config")]
    pub host_config: bool,
    #[serde(rename = "codex.native")]
    pub codex_native: bool,
    /// The companion's orchestration tools (`codewide_*_agent`) reach the
    /// provider's model as native client-side tools. Absent in an older
    /// declaration → unsupported.
    #[serde(rename = "orchestration.tools", default)]
    pub orchestration_tools: bool,
    /// A thread of this provider can be forked into another provider's
    /// thread through a context handoff, and receive such a fork. Absent in
    /// an older declaration → unsupported.
    #[serde(rename = "threads.crossProviderFork", default)]
    pub threads_cross_provider_fork: bool,
    #[serde(rename = "turns.startWhileActive")]
    pub turns_start_while_active: StartWhileActiveMode,
}

impl CapabilitySet {
    /// A declaration without any boolean capability.
    #[must_use]
    pub const fn none(turns_start_while_active: StartWhileActiveMode) -> Self {
        Self {
            turns_steer: false,
            turns_provider_initiated: false,
            threads_host_minted_ids: false,
            threads_external_discovery: false,
            threads_compact: false,
            threads_fork: false,
            requests_user_input: false,
            requests_mcp_elicitation: false,
            requests_dynamic_tool_call: false,
            settings_service_tier: false,
            settings_personality: false,
            input_skills_and_mentions: false,
            catalog_skills_plugins: false,
            review: false,
            goals: false,
            background_terminals: false,
            realtime_voice: false,
            global_supervisor: false,
            subagent_threads: false,
            accounts_pool: false,
            accounts_rate_limits: false,
            history_thread_resources: false,
            history_message_search: false,
            host_fs: false,
            host_config: false,
            codex_native: false,
            orchestration_tools: false,
            threads_cross_provider_fork: false,
            turns_start_while_active,
        }
    }

    /// Whether the provider declares one boolean capability.
    #[must_use]
    pub const fn supports(&self, capability: Capability) -> bool {
        match capability {
            Capability::TurnsSteer => self.turns_steer,
            Capability::TurnsProviderInitiated => self.turns_provider_initiated,
            Capability::ThreadsHostMintedIds => self.threads_host_minted_ids,
            Capability::ThreadsExternalDiscovery => self.threads_external_discovery,
            Capability::ThreadsCompact => self.threads_compact,
            Capability::ThreadsFork => self.threads_fork,
            Capability::RequestsUserInput => self.requests_user_input,
            Capability::RequestsMcpElicitation => self.requests_mcp_elicitation,
            Capability::RequestsDynamicToolCall => self.requests_dynamic_tool_call,
            Capability::SettingsServiceTier => self.settings_service_tier,
            Capability::SettingsPersonality => self.settings_personality,
            Capability::InputSkillsAndMentions => self.input_skills_and_mentions,
            Capability::CatalogSkillsPlugins => self.catalog_skills_plugins,
            Capability::Review => self.review,
            Capability::Goals => self.goals,
            Capability::BackgroundTerminals => self.background_terminals,
            Capability::RealtimeVoice => self.realtime_voice,
            Capability::GlobalSupervisor => self.global_supervisor,
            Capability::SubagentThreads => self.subagent_threads,
            Capability::AccountsPool => self.accounts_pool,
            Capability::AccountsRateLimits => self.accounts_rate_limits,
            Capability::HistoryThreadResources => self.history_thread_resources,
            Capability::HistoryMessageSearch => self.history_message_search,
            Capability::HostFs => self.host_fs,
            Capability::HostConfig => self.host_config,
            Capability::CodexNative => self.codex_native,
            Capability::OrchestrationTools => self.orchestration_tools,
            Capability::ThreadsCrossProviderFork => self.threads_cross_provider_fork,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_capability_name_is_a_serialized_field() -> Result<(), serde_json::Error> {
        let declared = serde_json::to_value(CapabilitySet {
            turns_steer: true,
            turns_provider_initiated: true,
            threads_host_minted_ids: true,
            threads_external_discovery: true,
            threads_compact: true,
            threads_fork: true,
            requests_user_input: true,
            requests_mcp_elicitation: true,
            requests_dynamic_tool_call: true,
            settings_service_tier: true,
            settings_personality: true,
            input_skills_and_mentions: true,
            catalog_skills_plugins: true,
            review: true,
            goals: true,
            background_terminals: true,
            realtime_voice: true,
            global_supervisor: true,
            subagent_threads: true,
            accounts_pool: true,
            accounts_rate_limits: true,
            history_thread_resources: true,
            history_message_search: true,
            host_fs: true,
            host_config: true,
            codex_native: true,
            orchestration_tools: true,
            threads_cross_provider_fork: true,
            turns_start_while_active: StartWhileActiveMode::Busy,
        })?;
        for capability in Capability::ALL {
            assert_eq!(declared[capability.name()], true, "{}", capability.name());
        }
        assert_eq!(declared["turns.startWhileActive"], "busy");
        Ok(())
    }

    #[test]
    fn an_older_declaration_without_the_additive_names_is_unsupported()
    -> Result<(), serde_json::Error> {
        let mut older = serde_json::to_value(CapabilitySet::none(StartWhileActiveMode::Busy))?;
        if let Some(object) = older.as_object_mut() {
            object.remove("orchestration.tools");
            object.remove("threads.crossProviderFork");
        }
        let declared: CapabilitySet = serde_json::from_value(older)?;
        assert!(!declared.supports(Capability::OrchestrationTools));
        assert!(!declared.supports(Capability::ThreadsCrossProviderFork));
        Ok(())
    }
}
