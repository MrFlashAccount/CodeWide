//! Greenfield authoritative Sync V2 protocol and runtime.

mod attachment_staging;
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
#[cfg(feature = "e2e-command-fault")]
mod e2e_surface_fault;
mod epoch;
pub(crate) mod files;
pub(crate) mod http;
mod ledger;
mod normalize;
mod ports;
mod production;
pub mod protocol;
mod queue_cursor;
mod read_receipts;
mod resource_cursor;
mod runtime;
pub mod scalar;
mod source;
mod terminal;
mod voice;
mod wire;
mod workspace_upload_staging;

pub use attachment_staging::{AttachmentStageError, AttachmentStageStore, StagedAttachment};
pub use auth_context::AuthenticatedContextKey;
pub(crate) use contract::{parse_definition, serialize_definition};
#[cfg(feature = "e2e-command-fault")]
pub use e2e_fault::{E2ECommandFaultState, E2ECommandFaultStatus};
#[cfg(feature = "e2e-command-fault")]
pub(crate) use e2e_surface_fault::E2ESurfaceFaultEffect;
#[cfg(feature = "e2e-command-fault")]
pub use e2e_surface_fault::{
    E2ESurfaceFaultAction, E2ESurfaceFaultControl, E2ESurfaceFaultRequest, E2ESurfaceFaultState,
    E2ESurfaceFaultStatus, E2ESurfaceFaultTarget,
};
pub use production::{ProductionServices, UpstreamSemanticSource};
pub use runtime::SyncV2Runtime;
pub use source::{
    AudienceSelector, CommandExecution, CoordinatorRecvError, SemanticSource, SnapshotData,
    SubscriptionCoordinator, WatchedThreadData,
};
pub use workspace_upload_staging::WorkspaceUploadStore;

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
