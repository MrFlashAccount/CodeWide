//! The live Claude session of one thread, driven over stream-json: an actor
//! per thread (`actor.rs`) with its turns (`turn.rs`), Claude's requests
//! (`requests.rs`), settings (`settings.rs`) and background task reports
//! (`task_reports.rs`), reached through
//! [`handle::SessionHandle`].

mod actor;
pub mod client_tools;
pub mod handle;
pub mod ports;
pub mod query;
mod requests;
mod settings;
mod task_reports;
pub mod turn;

#[cfg(test)]
mod replay_tests;
