//! Host infrastructure contracts that `companion-core` hands to provider
//! adapter crates, so an adapter never depends on the companion itself:
//!
//! - `database` — redb opening with the companion page-cache budget;
//! - `index` — the shared index error vocabulary and derived-table schemas;
//! - `thread_index` — thread metadata and pins as adapters may read or write them;
//! - `content` — canonical content an adapter proves from its own sources;
//! - `files`, `vcs` — the preview-file and workspace-VCS reads thread resources use;
//! - `activity_metrics` — companion-owned activity counters on client-wire items.
//!
//! Each module is a narrow contract or value model; the implementations stay
//! with their owners in `companion-core`.

pub mod activity_metrics;
pub mod content;
pub mod database;
pub mod files;
pub mod index;
pub mod thread_index;
pub mod vcs;
