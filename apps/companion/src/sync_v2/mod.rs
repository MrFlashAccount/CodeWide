//! Greenfield authoritative Sync V2 protocol and runtime.

mod auth_context;
mod bounded;
mod canonical;
#[cfg(test)]
mod conformance;
mod contract;
mod cursor;
pub mod domain;
#[cfg(feature = "e2e-command-fault")]
mod e2e_fault;
mod epoch;
mod files;
pub(crate) mod http;
mod ledger;
mod normalize;
mod ports;
mod production;
pub mod protocol;
mod runtime;
pub mod scalar;
mod source;
mod terminal;
mod voice;
mod wire;

pub use auth_context::AuthenticatedContextKey;
pub(crate) use contract::{parse_definition, serialize_definition};
#[cfg(feature = "e2e-command-fault")]
pub use e2e_fault::{E2ECommandFaultState, E2ECommandFaultStatus};
pub use production::{ProductionServices, UpstreamSemanticSource};
pub use runtime::SyncV2Runtime;
pub use source::{
    AudienceSelector, CommandExecution, CoordinatorRecvError, SemanticSource, SnapshotData,
    SubscriptionCoordinator, WatchedThreadData,
};

pub const V2_UPSTREAM_MAX_MESSAGE_BYTES: usize = 64 * 1024 * 1024;

pub(crate) fn data_routes() -> axum::Router<crate::server::AppState> {
    axum::Router::new()
        .merge(files::routes())
        .merge(ports::routes())
        .merge(terminal::routes())
        .merge(voice::routes())
        .layer(axum::middleware::map_response(
            http::close_extractor_rejection,
        ))
}

pub(crate) fn all_routes() -> axum::Router<crate::server::AppState> {
    data_routes()
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, clap::ValueEnum)]
pub enum SyncV2Mode {
    Disabled,
    #[default]
    Canary,
}
