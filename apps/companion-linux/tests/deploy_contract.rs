const COMPANION_UNIT: &str = include_str!("../deploy/codewide-companion.service");
const MEMORY_WATCH_UNIT: &str = include_str!("../deploy/codewide-companion-memory-watch.service");
const UPDATE_UNIT: &str = include_str!("../deploy/codewide-companion-update.service");
const UPDATE_PATH: &str = include_str!("../deploy/codewide-companion-update.path");
const INSTALL_SCRIPT: &str = include_str!("../deploy/install.sh");
const VERIFY_SCRIPT: &str = include_str!("../deploy/verify.sh");
const RELEASE_SCRIPT: &str = include_str!("../../../scripts/release-companion");

fn settings(unit: &str) -> Vec<&str> {
    unit.lines()
        .map(str::trim)
        .filter(|line| !line.is_empty() && !line.starts_with('#'))
        .collect()
}

#[test]
fn companion_service_keeps_the_default_log_filter() {
    // A unit-level RUST_LOG used to replace the companion's default filter
    // and silence every provider crate; overrides are for local diagnosis.
    assert!(!COMPANION_UNIT.contains("RUST_LOG"));
}

#[test]
fn companion_service_relaxes_only_what_claude_is_proven_to_need() {
    // Claude runs inside this unit by default: AF_NETLINK and the namespace
    // types bubblewrap creates are the only measured relaxations.
    let unit = settings(COMPANION_UNIT);
    for expected in [
        "ProtectSystem=full",
        "NoNewPrivileges=true",
        "RestrictNamespaces=user mnt pid net ipc uts cgroup",
        "RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6 AF_NETLINK",
    ] {
        assert!(unit.contains(&expected), "the unit sets {expected}");
    }
}

#[test]
fn user_units_never_shrink_the_capability_bounding_set() {
    // A per-user manager has no effective capabilities, so it cannot drop the
    // bounding set: `CapabilityBoundingSet=` fails every start with
    // 218/CAPABILITIES (systemd 252 and 255). The process already has no
    // capabilities and NoNewPrivileges keeps it that way.
    for unit in [COMPANION_UNIT, UPDATE_UNIT, MEMORY_WATCH_UNIT] {
        assert!(!unit.contains("CapabilityBoundingSet"));
    }
}

#[test]
fn companion_service_keeps_host_ptys_available() {
    assert!(
        COMPANION_UNIT.contains("PrivateDevices=false"),
        "the terminal transport requires the host devpts namespace"
    );
    assert!(!COMPANION_UNIT.contains("PrivateDevices=true"));
}

#[test]
fn companion_services_share_host_temporary_directories() {
    for unit in [COMPANION_UNIT, MEMORY_WATCH_UNIT] {
        let mut settings = unit
            .lines()
            .map(str::trim)
            .filter(|line| line.starts_with("PrivateTmp="));
        assert_eq!(
            settings.next(),
            Some("PrivateTmp=false"),
            "host paths must remain visible"
        );
        assert_eq!(
            settings.next(),
            None,
            "no conflicting temporary namespace setting"
        );
    }
}

#[test]
fn companion_service_has_no_broad_temporary_preview_root() {
    assert!(!COMPANION_UNIT.contains("CODEWIDE_PREVIEW_ROOTS"));
    assert!(!COMPANION_UNIT.contains("/tmp/codewide-attachments"));
}

#[test]
fn default_distribution_installs_and_registers_git_plugin() {
    assert!(INSTALL_SCRIPT.contains("target/release/codewide-vcs-git"));
    assert!(INSTALL_SCRIPT.contains("vcs plugin install"));
    assert!(INSTALL_SCRIPT.contains("--id git"));
    assert!(INSTALL_SCRIPT.contains("--priority=-1000"));
    assert!(VERIFY_SCRIPT.contains("current/libexec/codewide-vcs-git"));
}

#[test]
fn default_distribution_installs_the_built_in_github_plugin() {
    assert!(INSTALL_SCRIPT.contains("target/release/codewide-forge-github"));
    assert!(INSTALL_SCRIPT.contains("\"$staging/libexec/codewide-forge-github\""));
    assert!(
        !INSTALL_SCRIPT.contains("forge plugin install"),
        "GitHub is built in and needs no registration"
    );
    assert!(VERIFY_SCRIPT.contains("current/libexec/codewide-forge-github"));
    // An older generation restored by a rollback must still parse the unit,
    // so the unit passes no forge flag; the binary derives the directory.
    assert!(!COMPANION_UNIT.contains("--bundled-plugin-dir"));
}

#[test]
fn managed_install_uses_immutable_generations_and_a_stable_guardian() {
    assert!(COMPANION_UNIT.contains("current/bin/codewide-companion serve"));
    assert!(INSTALL_SCRIPT.contains("generations/$artifact_digest"));
    assert!(INSTALL_SCRIPT.contains("mv -fT \"$install_root/.current-new\""));
    assert!(!INSTALL_SCRIPT.contains("$install_root/codewide-companion\""));
    assert!(UPDATE_UNIT.contains("bootstrap/codewide-companion-update-guardian"));
    assert!(!UPDATE_UNIT.contains("current/"));
    assert!(UPDATE_UNIT.contains("--state-root %h/.local/state/codewide/host-update"));
    assert!(UPDATE_UNIT.contains("ReadOnlyPaths=%h/.local/lib/codewide/bootstrap"));
    assert!(COMPANION_UNIT.contains("ReadOnlyPaths=%h/.local/lib/codewide/generations"));
    assert!(INSTALL_SCRIPT.contains("CODEWIDE_COMPANION_UPDATE_GUARDIAN_BINARY"));
    assert!(UPDATE_PATH.contains("activation-request.json"));
    assert!(UPDATE_PATH.contains("PathExists="));
    assert!(UPDATE_PATH.contains("Unit=codewide-companion-update.service"));
    assert!(INSTALL_SCRIPT.contains("enable --now codewide-companion-update.path"));
    assert!(UPDATE_UNIT.contains("IPAddressDeny=any"));
    assert!(!UPDATE_UNIT.contains("network-online.target"));
}

#[test]
fn remote_runner_has_no_caller_controlled_download_or_state_restore() {
    let guardian = include_str!("../../../crates/host-update/src/linux/guardian.rs");
    let prepare = include_str!("../../../crates/host-update/src/linux/prepare.rs");
    let runner = include_str!("../../../crates/host-update/src/linux/runner.rs");
    assert!(guardian.contains("cached.available.target"));
    assert!(guardian.contains("prepare_generation"));
    assert!(prepare.contains("artifact_url"));
    assert!(prepare.contains("validate_archive"));
    assert!(!guardian.contains("Command::new(\"systemctl\")"));
    for forbidden in [
        "artifact_url",
        "ReleaseTargetV1",
        "SignedReleaseDescriptor",
        "reqwest",
        "validate_archive",
        "verify_file_digest",
    ] {
        assert!(!runner.contains(forbidden), "runner contains {forbidden}");
    }
    assert!(runner.contains("LinuxActivationProduct"));
    assert!(!runner.contains("ApplyHostUpdateCommand"));
    assert!(!runner.contains("restore_state"));
}

#[test]
fn service_exposes_only_the_secure_tunnel_on_its_http_carrier() {
    assert!(!COMPANION_UNIT.contains("--insecure-http"));
    assert!(VERIFY_SCRIPT.contains("http://127.0.0.1:8766/v1/auth"));
    assert!(VERIFY_SCRIPT.contains("test \"$public_status\" = 404"));
    assert!(!VERIFY_SCRIPT.contains("--pinnedpubkey"));
    assert!(VERIFY_SCRIPT.contains("ingress=secure-tunnel-only"));
    assert!(VERIFY_SCRIPT.contains("inner-tls=required"));
}

#[test]
fn one_shot_release_validates_builds_installs_verifies_and_rolls_back() {
    assert!(RELEASE_SCRIPT.contains("do not report or poll intermediate progress"));
    assert!(RELEASE_SCRIPT.contains("git diff --check --"));
    assert!(RELEASE_SCRIPT.contains("cargo fmt --all -- --check"));
    assert!(RELEASE_SCRIPT.contains("cargo clippy --workspace --all-targets --all-features"));
    assert!(RELEASE_SCRIPT.contains("cargo test --workspace --all-features"));
    assert!(RELEASE_SCRIPT.contains("run_quiet 'running tests'"));
    assert!(RELEASE_SCRIPT.contains("cat \"$log\" >&2"));
    assert!(RELEASE_SCRIPT.contains("./scripts/build-companion.sh"));
    assert!(RELEASE_SCRIPT.contains("./apps/companion-linux/deploy/install.sh"));
    assert!(RELEASE_SCRIPT.contains("./apps/companion-linux/deploy/verify.sh"));
    assert!(RELEASE_SCRIPT.contains("restoring the previous installation"));
}

#[test]
fn installer_replaces_the_current_symlink_instead_of_moving_into_it() {
    // `current` is a symlink to a generation directory. Without `-T`, GNU mv
    // moves the new link *into* the old generation and the switch is lost.
    for line in INSTALL_SCRIPT
        .lines()
        .filter(|line| line.contains("mv ") && line.contains("\"$install_root/current\""))
    {
        assert!(
            line.contains("mv -fT"),
            "current switch must use mv -T: {line}"
        );
    }
    assert!(
        INSTALL_SCRIPT.contains("mv -fT \"$install_root/.current-new\" \"$install_root/current\"")
    );
}
