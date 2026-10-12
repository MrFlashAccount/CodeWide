//! Remote updates for product hosts.
//!
//! `contract` owns the signed release, journal, phase and guardian API shared
//! by every platform. With `linux-guardian`, `linux` owns the crash-safe
//! systemd implementation: immutable generations, one atomic `current` link,
//! a stable bootstrap runner, health proof and rollback. Each product supplies
//! only its payload layout, service names and health proof.

mod contract;

pub use contract::*;

#[cfg(feature = "linux-guardian")]
pub mod linux;
