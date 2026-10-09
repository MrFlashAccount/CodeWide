//! Provider-neutral core of the `CodeWide` agent provider layer: the serde
//! mirror of the `codewide-agent` v1 protocol (`model`), the `AgentProvider`
//! contract and its `codex.native` compatibility surface (`provider`),
//! provider-neutral token accounting with the price-table contract (`usage`)
//! and the `wire-request-ids-v0` encoding (`request_ids`). The companion and
//! every provider adapter crate depend on it; it depends on none of them.
//! See `CONTEXT.md` and `docs/agent-providers.md`.

pub mod model;
pub mod provider;
pub mod request_ids;
pub mod usage;
