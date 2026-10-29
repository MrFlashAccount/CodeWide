//! The wire contract between the `CodeWide` companion and forge plugins.
//!
//! A forge plugin is an executable that speaks JSON-RPC 2.0 over LSP-style
//! `Content-Length` framing on stdin/stdout, exactly like the VCS plugins.
//! The companion spawns it, sends `initialize`, then one bounded batch of
//! requests, and closes stdin. A `hostLogin` auth flow keeps its dedicated
//! process alive until the flow ends.
//!
//! This crate is shared by the companion's plugin client, the built-in GitHub
//! plugin, out-of-repo plugins and the conformance harness. Plugins depend
//! only on this crate, never on `companion-core`.
//!
//! Token confinement: no request or response carries a forge token, except
//! the companion → plugin `auth.start` of a `pasteToken` method, whose
//! [`Secret`] travels one way and never appears in a result.

pub mod framing;
pub mod methods;
pub mod plugin;
pub mod types;

#[cfg(feature = "conformance")]
pub mod conformance;

pub use framing::{FrameError, MAX_FRAME_BYTES, read_frame, write_frame};
pub use plugin::{ForgePlugin, PluginError, serve};
pub use types::*;

/// The only protocol version this crate speaks.
pub const PROTOCOL_VERSION: u32 = 1;

/// Capability identifiers a plugin declares in `initialize`.
pub mod capability {
    /// `auth.methods`, `auth.start`, `auth.poll`, `auth.verify`, `auth.disconnect`.
    pub const AUTH: &str = "forge.auth@1";
    /// `forge.pullRequests.list`.
    pub const LIST: &str = "forge.list@1";
    /// Optional structured pull-request search. Unlike `forge.list@1`, every
    /// filter in the request is part of the provider contract and may not be
    /// silently ignored.
    pub const SEARCH: &str = "forge.search@1";
    /// `forge.pullRequest.read` and `forge.pullRequest.activity`.
    pub const READ: &str = "forge.read@1";
    /// `forge.pullRequest.files`.
    pub const DIFF: &str = "forge.diff@1";
    /// `forge.pullRequest.actions` and `forge.pullRequest.action.run`.
    pub const ACTIONS: &str = "forge.actions@1";
    /// `forge.pullRequest.review.submit`.
    pub const REVIEW: &str = "forge.review@1";
    /// Optional: `forge.pullRequest.checks`.
    pub const CHECKS: &str = "forge.checks@1";
    /// Optional: `forge.pullRequest.viewed.set`.
    pub const VIEWED: &str = "forge.viewed@1";
    /// Optional: `forge.repository.resolve` and `forge.pullRequests.byBranch`.
    pub const RESOLVE: &str = "forge.resolve@1";
    /// Optional: `forge.pullRequest.scenarioContext`.
    pub const SCENARIO_CONTEXT: &str = "forge.scenarioContext@1";
    /// Optional: `forge.pullRequest.conversation` and `forge.media.read`.
    pub const CONVERSATION: &str = "forge.conversation@1";
    /// Optional: `forge.pullRequest.comment.create` and
    /// `forge.pullRequest.reviewThread.reply`, both published immediately.
    pub const COMMENTS: &str = "forge.comments@1";

    /// Capabilities every forge plugin must declare.
    pub const REQUIRED: [&str; 6] = [AUTH, LIST, READ, DIFF, ACTIONS, REVIEW];
}

/// Plugin error codes. They are a namespace separate from the companion's
/// own `-32080..-32089` client codes; the companion maps them.
pub mod code {
    /// The plugin does not own the workspace or remote (as VCS plugins).
    pub const NOT_OWNED: i64 = -32_004;
    /// The account must sign in again; the companion marks it `expired`.
    pub const AUTH_REQUIRED: i64 = -32_110;
    /// The requested optional capability is unavailable for this account.
    pub const CAPABILITY_UNAVAILABLE: i64 = -32_111;
    /// The pull request head moved; `data.headRevision` names the new head.
    pub const STALE_HEAD: i64 = -32_112;
    /// The forge refused the write; the message is the reason.
    pub const FORGE_REJECTED: i64 = -32_113;
    /// The forge rate-limited the call; `data.retryAfterSeconds` may be set.
    pub const RATE_LIMITED: i64 = -32_114;
    /// The pull request or repository does not exist for this account.
    pub const NOT_FOUND: i64 = -32_115;
    /// JSON-RPC: invalid params.
    pub const INVALID_PARAMS: i64 = -32_602;
    /// JSON-RPC: method not found.
    pub const METHOD_NOT_FOUND: i64 = -32_601;
    /// JSON-RPC: internal error.
    pub const INTERNAL: i64 = -32_603;
}
