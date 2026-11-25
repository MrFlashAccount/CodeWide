//! Claude's transcript format, read in Rust: the stored rows of a session
//! file and the frames of the CLI's stream-json output, classified and
//! mapped to the neutral model. Everything here is pure; files and processes
//! belong to the modules that read them.
//!
//! - `json` — structural access to records under both field spellings.
//! - `frames` — one message → `ClaudeFrame` (never fails).
//! - `tools`, `shell_tools`, `diffs`, `agents`, `client_tools` — tool calls
//!   → neutral items.
//! - `task_reports`, `task_notifications` — background task reports (stored
//!   `<task-notification>` messages, live `task_notification` frames) →
//!   neutral `taskNotification` items.
//! - `background_commands` — the state of the background commands a thread
//!   launched, from stored reports and the live session.
//! - `result` — the `result` frame → turn outcome.
//! - `builder` — `TurnBuilder`: one neutral turn from frames, with the
//!   ordering invariants of the protocol.
//! - `entries`, `segments`, `reconstruct`, `turn_index` — stored messages →
//!   turns: classification, derived turn boundaries, replay through the
//!   builder, and the companion's turn index.

pub mod agents;
pub mod background_commands;
pub mod builder;
pub mod chain;
pub mod client_tools;
pub mod diffs;
pub mod entries;
pub mod frames;
pub mod json;
pub mod reconstruct;
pub mod result;
pub mod segments;
pub mod shell_tools;
pub mod task_notifications;
pub mod task_reports;
pub mod tools;
pub mod turn_index;

#[cfg(test)]
mod shell_tool_tests;
#[cfg(test)]
mod task_report_tests;
#[cfg(test)]
mod tests;

/// The tool result the companion writes for a call the user declined.
pub const DECLINE_MESSAGE: &str = "User declined tool execution.";
/// The tool result the companion writes for a call cancelled with its turn.
pub const CANCEL_MESSAGE: &str = "User cancelled the turn.";
/// The tool result the companion writes under the read-only profile.
pub const READ_ONLY_DENY_PREFIX: &str = "The read-only permission profile does not allow";
