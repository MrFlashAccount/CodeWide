//! Agent provider layer: the companion reaches coding agents only through
//! the `AgentProvider` trait, a neutral `codewide-agent` v1 model and
//! declared capabilities, all owned by the `agent-core` crate (re-exported
//! here as `model` and `provider`). Codex and Claude are equal adapters in
//! their own crates (`agent-provider-codex`, `agent-provider-claude`), wired
//! in by `providers`; every thread is bound to one provider for its life
//! (`bindings`), and `client_wire` is the single translation to the
//! Codex-shaped client wire. See `agent/CONTEXT.md` and
//! `docs/agent-providers.md`.

pub mod bindings;
pub mod client_wire;
pub mod providers;
pub mod registry;

pub use agent_core::{model, provider};

#[cfg(test)]
pub(crate) mod testing;
