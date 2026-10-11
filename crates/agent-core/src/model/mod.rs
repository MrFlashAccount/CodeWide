//! Serde mirror of the `codewide-agent` v1 protocol owned by
//! `packages/agent-protocol`. Both sides must round-trip the package's
//! fixtures unchanged (see the tests in this module).

pub mod capabilities;
pub mod events;
pub mod ids;
pub mod operations;
pub mod sessions;
pub mod thread;
pub mod tools;
pub mod turns;

pub use capabilities::{Capability, CapabilitySet, StartWhileActiveMode};
pub use events::{AgentEvent, ItemDelta};
pub use ids::{
    AppThreadId, ClientMessageId, ItemId, NativeRequestId, ProviderId, ProviderThreadRef,
    RuntimeRequestId, TurnId,
};
pub use operations::*;
pub use sessions::*;
pub use thread::*;
pub use tools::*;

#[cfg(test)]
mod fixture_tests;
