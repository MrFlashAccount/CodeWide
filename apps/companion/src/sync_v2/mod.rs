//! Greenfield authoritative Sync V2 protocol and runtime.

mod auth_context;
mod bounded;
mod canonical;
mod contract;
mod cursor;
pub mod domain;
mod epoch;
mod ledger;
mod normalize;
mod production;
pub mod protocol;
mod runtime;
pub mod scalar;
mod source;
mod wire;

pub use auth_context::AuthenticatedContextKey;
pub use production::{ProductionServices, UpstreamSemanticSource};
pub use runtime::SyncV2Runtime;
pub use source::{
    AudienceSelector, CommandExecution, CoordinatorRecvError, SemanticSource, SnapshotData,
    SubscriptionCoordinator,
};

pub const V2_UPSTREAM_MAX_MESSAGE_BYTES: usize = 64 * 1024 * 1024;

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, clap::ValueEnum)]
pub enum SyncV2Mode {
    Disabled,
    #[default]
    Canary,
}
