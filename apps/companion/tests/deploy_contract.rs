const COMPANION_UNIT: &str = include_str!("../deploy/codewide-companion.service");
const INSTALL_SCRIPT: &str = include_str!("../deploy/install.sh");
const VERIFY_SCRIPT: &str = include_str!("../deploy/verify.sh");

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
