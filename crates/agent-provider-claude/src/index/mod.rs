//! The Claude session index on the shared segmented offset index
//! (`agent_index::segment`): Claude's own session files and sub-agent
//! transcripts are the store of turns; the index keeps their byte ranges,
//! the state each starts from, the facts later rows report and a small
//! digest per turn.
//!
//! - `line` — one stored row read only as far as the index needs it.
//! - `source` — the `SegmentSource` of Claude's files: turn boundaries,
//!   rewinds, record keys and facts.
//! - `project` — one turn read back from its byte range.
//! - `read` — pages, windows and whole histories from turn ranges, settled
//!   with the session's facts.
//! - `session` — indexing one session from its files' checkpoints.

pub mod history;
pub mod line;
pub mod project;
pub mod read;
pub mod session;
pub mod sessions;
pub mod source;
#[cfg(test)]
pub(crate) mod testing;
#[cfg(test)]
mod tests;
