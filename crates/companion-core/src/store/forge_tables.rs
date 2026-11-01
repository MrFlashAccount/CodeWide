//! Durable tables of the forge context. Values are versioned JSON owned by
//! `crate::forge`; this module only names the tables. None holds a token.

use redb::TableDefinition;

use super::kv::BytesTable;

/// `ForgeAccountKey` → account link (provider, host, login, linked time).
pub(crate) const FORGE_ACCOUNTS: BytesTable = TableDefinition::new("forge_accounts");
/// Plugin id → provider settings (the enable flag).
pub(crate) const FORGE_PROVIDER_SETTINGS: BytesTable =
    TableDefinition::new("forge_provider_settings");
/// Plugin id → the display identity its plugin last declared (name, default
/// host, resolved icon), keyed by a digest of that declaration.
pub(crate) const FORGE_PROVIDER_IDENTITIES: BytesTable =
    TableDefinition::new("forge_provider_identities");
/// `PullRequestKey NUL threadId` → pull request ↔ thread link.
pub(crate) const FORGE_PR_LINKS: BytesTable = TableDefinition::new("forge_pr_links");
/// `PullRequestKey` → the one canonical conversation opened by the PR workspace.
pub(crate) const FORGE_PR_REVIEW_THREADS: BytesTable =
    TableDefinition::new("forge_pr_review_threads");
/// `PullRequestKey NUL threadId` → a user removal that blocks automatic
/// re-linking.
pub(crate) const FORGE_LINK_TOMBSTONES: BytesTable = TableDefinition::new("forge_link_tombstones");
/// Idempotency key → action run journal record.
pub(crate) const FORGE_ACTION_RUNS: BytesTable = TableDefinition::new("forge_action_runs");
/// `PullRequestKey` → the opaque activity revision last displayed by a client.
pub(crate) const FORGE_PR_ATTENTION: BytesTable = TableDefinition::new("forge_pr_attention");
/// `PullRequestKey NUL scenario slot` → the latest prompt-free scenario run
/// of that slot (thread, outbox command, head revision, settlement).
pub(crate) const FORGE_SCENARIO_RUNS: BytesTable = TableDefinition::new("forge_scenario_runs");
