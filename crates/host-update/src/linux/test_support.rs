//! A product with the Companion payload shape, so the moved guardian and
//! runner tests keep exercising the layout they were written for.

use std::{path::PathBuf, sync::Arc};

use super::{
    GenerationMetadataV1, LinuxGuardianConfig, LinuxHostUpdateGuardian, LinuxProduct,
    OperationRecord, ServiceHealth,
};
use crate::{HostPlatform, HostUpdateRelayState, ReleaseTrust};

pub(super) static TEST_PRODUCT: LinuxProduct = LinuxProduct {
    platform: HostPlatform::LinuxX86_64,
    bundle_directory: "codewide-companion-x86_64-unknown-linux-musl",
    executable_name: "codewide-companion",
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
    service_unit: "codewide-companion.service",
    update_unit: "codewide-companion-update.service",
    running_version: "1.0.0",
    ready_timeout: None,
};

/// Health that never proves readiness; tests must not reach a restart.
pub(super) struct NeverHealthy;

impl ServiceHealth for NeverHealthy {
    fn identity_pin(&self, _operation: &OperationRecord) -> Option<String> {
        None
    }

    fn serves(&self, _expected: &GenerationMetadataV1, _operation: &OperationRecord) -> bool {
        false
    }
}

pub(super) fn guardian(
    root: PathBuf,
    state_root: PathBuf,
    trust: Option<ReleaseTrust>,
) -> LinuxHostUpdateGuardian {
    LinuxHostUpdateGuardian::new(LinuxGuardianConfig {
        product: &TEST_PRODUCT,
        root,
        state_root,
        identity_pin: "pin".to_owned(),
        identity_manifest: PathBuf::from("/tmp/codewide-test-identity.json"),
        relay_probe: Arc::new(|| HostUpdateRelayState {
            configured: false,
            enabled: false,
            upstream_live: false,
        }),
        trust,
    })
}
