const COMPANION_UNIT: &str = include_str!("../deploy/codewide-companion.service");
const INSTALL_SCRIPT: &str = include_str!("../deploy/install.sh");
const VERIFY_SCRIPT: &str = include_str!("../deploy/verify.sh");
const RELEASE_SCRIPT: &str = include_str!("../../../scripts/release-companion");

#[test]
fn companion_service_keeps_host_ptys_available() {
    assert!(
        COMPANION_UNIT.contains("PrivateDevices=false"),
        "the terminal transport requires the host devpts namespace"
    );
    assert!(!COMPANION_UNIT.contains("PrivateDevices=true"));
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
    assert!(VERIFY_SCRIPT.contains("plugins/codewide-vcs-git"));
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
    assert!(RELEASE_SCRIPT.contains("./apps/companion/deploy/install.sh"));
    assert!(RELEASE_SCRIPT.contains("./apps/companion/deploy/verify.sh"));
    assert!(RELEASE_SCRIPT.contains("restoring the previous installation"));
}
