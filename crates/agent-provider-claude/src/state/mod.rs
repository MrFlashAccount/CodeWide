//! The Claude host's own per-thread state, read and written: the single
//! owner of `<state dir>/threads/<app thread id>/state.json` (`ThreadState`
//! v2), `active-turn.json` and the conversion of the former v1 journal. The
//! JSON is the TypeScript host's format (`host/src/state/`), so files written
//! by either keep their meaning and no thread changes identity.
//!
//! - `thread_state.rs` — the record and its invariants;
//! - `codec.rs` — decoding with the TS codec's defaults and checks, encoding;
//! - `store.rs` — atomic owner-only writes, the startup load, thread directories;
//! - `legacy_journal.rs` — the v1 journal converted to v2.

pub mod codec;
pub mod legacy_journal;
pub mod store;
pub mod thread_state;

#[cfg(test)]
mod tests;

pub use store::{StateError, StoredThread, ThreadDirectory, ThreadStateStore};
pub use thread_state::{
    SessionChain, StateVersion, THREAD_STATE_VERSION, ThreadPresence, ThreadState,
    ThreadStateOrigin, TitleOverride,
};
