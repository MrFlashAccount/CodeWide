//! The live Claude session of one thread, driven over stream-json: an actor
//! per thread (`actor.rs`) with its turns (`turn.rs`), Claude's requests
//! (`requests.rs`) and settings (`settings.rs`), reached through
//! [`handle::SessionHandle`].

mod actor;
pub mod client_tools;
pub mod handle;
pub mod ports;
pub mod query;
mod requests;
mod settings;
pub mod turn;

#[cfg(test)]
mod replay_tests;
