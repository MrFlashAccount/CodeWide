//! Compatibility facade for the Linux host and its existing consumers.
//!
//! Domain/runtime ownership lives in `companion-core`. The Linux executable
//! imports it in-process; this crate does not introduce an IPC boundary.

pub use companion_core::*;
