//! The Claude thread service in Rust: the operations of the
//! `codewide-agent` v1 protocol over Claude's session store, the service's
//! own thread metadata and the live session actors (`host/src/threads/`:
//! `service.ts`, `registry.ts`, `projection.ts`, `sessionCatalog.ts`,
//! `history.ts`, and the startup of `main.ts`).
//!
//! Threads come from two sources: threads `CodeWide` created (host-minted
//! ids) and sessions Claude already has, for example started with `claude`
//! in a terminal (their session id is the thread id). Listing, reading and
//! history come from Claude's store; the service adds only its own
//! metadata, which each thread's session actor owns and persists.
//!
//! - `service.rs` — construction, startup, resolution, projections, adoption;
//! - `thread_ops.rs` / `turn_ops.rs` — the operations;
//! - `outputs.rs` — the ordered output stream;
//! - `registry.rs` — session actors and the session chain index;
//! - `projection.rs` — `AgentThread` and list rows (pure);
//! - `session_catalog.rs` — Claude's listing and cached session metadata;
//! - `history.rs` — a thread's turns from its session chain;
//! - `recorded_models.rs`, `live_prompts.rs` — projection inputs;
//! - `startup.rs` — loading and finalizing turns left in progress;
//! - `errors.rs` — protocol errors.

mod errors;
pub mod history;
mod live_prompts;
mod outputs;
pub mod projection;
mod recorded_models;
mod registry;
mod service;
pub mod session_catalog;
mod startup;
mod thread_ops;
mod turn_ops;

#[cfg(test)]
mod tests;

pub use errors::OPEN_ELSEWHERE_MESSAGE;
pub use outputs::ServiceOutputs;
pub use service::{FenceReceiver, ServiceDeps, ServiceOutput, ThreadService};
