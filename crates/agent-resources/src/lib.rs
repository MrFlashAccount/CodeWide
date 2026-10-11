//! Thread resources shared by provider adapters: the resource model
//! (`data`), the per-turn projection (`projection`) and the request handling
//! with VCS and live overlays (`service`). A provider supplies its projection
//! through `ProjectionSource` — from its own records (Codex rollouts) or from
//! neutral turns (`ResourceProjection::from_turns`, Claude) — and the client
//! receives the same response shapes for every provider.

pub mod data;
pub mod projection;
pub mod service;
#[cfg(test)]
mod tests;

pub use data::{ChangeScope, MAX_DIFF_CHARS_PER_PATH, ResourceData};
pub use projection::ResourceProjection;
pub use service::{ProjectionSource, ResourceRequestContext, ThreadResources};

/// A failed resource read. Provider failures keep their own message.
#[derive(Debug, thiserror::Error)]
pub enum ResourceError {
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
    #[error("threadId is required")]
    MissingThreadId,
    #[error("path is required")]
    MissingPath,
    #[error("resource projection task failed")]
    Join,
    #[error(transparent)]
    Vcs(#[from] companion_host::vcs::VcsError),
    #[error(transparent)]
    Source(Box<dyn std::error::Error + Send + Sync>),
}
