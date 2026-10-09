//! Agent provider layer: the companion reaches coding agents only through
//! the `AgentProvider` trait, a neutral `codewide-agent` v1 model and
//! declared capabilities. Codex and Claude are equal adapters under
//! `providers/`; every thread is bound to one provider for its life
//! (`bindings`), and `client_wire` is the single translation to the
//! Codex-shaped client wire. See `agent/CONTEXT.md` and
//! `docs/agent-providers.md`.

pub mod bindings;
pub mod client_wire;
pub mod model;
pub mod provider;
pub mod providers;
pub mod registry;

#[cfg(test)]
pub(crate) mod testing;
