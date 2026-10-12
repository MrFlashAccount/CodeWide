//! The Linux Companion as a product of the shared generation updater.
//!
//! `codewide-host-update` owns the journal, generations, atomic activation and
//! rollback. This module declares the Companion payload, its systemd units and
//! default locations, and proves the restarted Companion's health.

mod runner_health;

use std::{path::PathBuf, sync::Arc};

use codewide_host_update::{
    HostPlatform, HostUpdateRelayState, ReleaseTrust,
    linux::{LinuxActivationProduct, LinuxGuardianConfig, LinuxProduct, SystemdScope},
};

pub use codewide_host_update::linux::LinuxHostUpdateGuardian;

pub static COMPANION: LinuxProduct = LinuxProduct {
    activation: LinuxActivationProduct {
        executable_name: "codewide-companion",
        service_unit: "codewide-companion.service",
        ready_timeout: None,
    },
    platform: HostPlatform::LinuxX86_64,
    bundle_directory: "codewide-companion-x86_64-unknown-linux-musl",
    payload_executables: &[
        "libexec/codewide-vcs-git",
        "libexec/codewide-companion-memory-watch",
    ],
    bootstrap_only: &[
        "bootstrap",
        "systemd",
        "install.sh",
        "libexec/codewide-companion-update-guardian",
    ],
    bootstrap_guardian: "codewide-companion-update-guardian",
    running_version: env!("CODEWIDE_COMPANION_VERSION"),
};

/// The in-process guardian of the running Companion.
#[must_use]
pub fn guardian(
    root: PathBuf,
    state_root: PathBuf,
    identity_pin: String,
    identity_manifest: PathBuf,
    relay: companion_core::relay::RelayRuntime,
) -> LinuxHostUpdateGuardian {
    LinuxHostUpdateGuardian::new(LinuxGuardianConfig {
        product: &COMPANION,
        root,
        state_root,
        identity_pin,
        identity_manifest,
        relay_probe: Arc::new(move || {
            relay.status().map_or(
                HostUpdateRelayState {
                    configured: false,
                    enabled: false,
                    upstream_live: false,
                },
                |status| HostUpdateRelayState {
                    configured: status.configured,
                    enabled: status.enabled,
                    upstream_live: matches!(
                        status.connection,
                        companion_core::relay::RelayConnectionStatus::Online
                    ),
                },
            )
        }),
        trust: ReleaseTrust::embedded(),
    })
}

#[must_use]
pub fn default_root() -> PathBuf {
    std::env::var_os("CODEWIDE_COMPANION_INSTALL_ROOT").map_or_else(
        || {
            std::env::var_os("HOME").map_or_else(
                || PathBuf::from(".local/lib/codewide"),
                |home| PathBuf::from(home).join(".local/lib/codewide"),
            )
        },
        PathBuf::from,
    )
}

#[must_use]
pub fn default_state_root() -> PathBuf {
    std::env::var_os("XDG_STATE_HOME").map_or_else(
        || {
            std::env::var_os("HOME").map_or_else(
                || PathBuf::from(".local/state/codewide/host-update"),
                |home| PathBuf::from(home).join(".local/state/codewide/host-update"),
            )
        },
        |root| PathBuf::from(root).join("codewide/host-update"),
    )
}

/// Runs one queued operation from the stable bootstrap executable.
///
/// # Errors
/// Returns an error when the durable journal is corrupt or the runner cannot
/// persist, activate, verify, or roll back a generation.
pub async fn run_pending(
    root: PathBuf,
    state_root: PathBuf,
) -> Result<(), Box<dyn std::error::Error>> {
    let health = runner_health::CompanionHealth { root: root.clone() };
    codewide_host_update::linux::run_pending(
        &COMPANION.activation,
        &health,
        root,
        state_root,
        SystemdScope::User,
    )
    .await
}
