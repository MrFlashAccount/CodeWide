//! `CodeWide` client conventions: the product's instructions to every agent
//! session the companion drives, for every provider. A later convention is
//! added here, to the one text.

use agent_core::provider::SessionInstructions;

/// The conventions every agent session receives
/// (`AgentProvider::install_session_instructions`).
///
/// File references: the `CodeWide` client opens a file only from a link, and
/// resolves a Markdown link to an absolute path (with an optional `:line`
/// or `:line:col`), a path relative to the thread's working directory, and
/// a `file://` URL. Bare paths are not linkified on the client.
pub const CLIENT_CONVENTIONS: SessionInstructions = SessionInstructions::new(concat!(
    "# CodeWide client conventions\n",
    "The user reads your messages in the CodeWide app, which opens a file only from a link.\n",
    "- Whenever you mention a file or directory on this machine, write it as a Markdown link ",
    "whose target is its absolute path: [report.md](/abs/path/report.md). ",
    "For a location, append :line or :line:col to the target: ",
    "[parser.rs:42](/abs/path/src/parser.rs:42). ",
    "Never leave a bare path or a path only in backticks. ",
    "file:///abs/path links are also accepted.",
));
