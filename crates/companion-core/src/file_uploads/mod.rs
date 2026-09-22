//! Durable upload ownership, cancellation and quotas for the Companion file API.

pub(crate) mod http;
mod owner;
mod response;
mod staging;

pub use staging::WorkspaceUploadStore;
