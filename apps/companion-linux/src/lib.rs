//! Compatibility facade for the Linux host and its existing consumers.
//!
//! Domain/runtime ownership lives in `companion-core`; the Codex adapter and
//! its storage modules live in `agent-provider-codex` and are re-exported at
//! their historical paths. The Linux executable imports them in-process; this
//! crate does not introduce an IPC boundary.

pub use agent_provider_codex::{
    account_pool, catalog, history, history_service, message_search, resources, rollout,
    rollout_store,
};
pub use companion_core::*;

/// Linux-only adapter for the durable, out-of-process host-update guardian.
pub mod host_update;
