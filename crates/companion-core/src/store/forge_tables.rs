//! Durable tables of the forge context. Values are versioned JSON owned by
//! `crate::forge`; this module only names the tables. None holds a token.

use redb::TableDefinition;

use super::kv::BytesTable;

/// `ForgeAccountKey` → account link (provider, host, login, linked time).
pub(crate) const FORGE_ACCOUNTS: BytesTable = TableDefinition::new("forge_accounts");
/// Plugin id → provider settings (the enable flag).
pub(crate) const FORGE_PROVIDER_SETTINGS: BytesTable =
    TableDefinition::new("forge_provider_settings");
/// `PullRequestKey NUL threadId` → pull request ↔ thread link.
pub(crate) const FORGE_PR_LINKS: BytesTable = TableDefinition::new("forge_pr_links");
/// `PullRequestKey NUL threadId` → a user removal that blocks automatic
/// re-linking.
pub(crate) const FORGE_LINK_TOMBSTONES: BytesTable = TableDefinition::new("forge_link_tombstones");
/// Idempotency key → action run journal record.
pub(crate) const FORGE_ACTION_RUNS: BytesTable = TableDefinition::new("forge_action_runs");
