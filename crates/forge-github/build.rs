use std::{env, error::Error, io};

/// The plugin reports the host build version it ships with, so an update
/// proof can tell generations apart: the Linux Companion version, else the
/// core version of the macOS app, else the crate version.
fn main() -> Result<(), Box<dyn Error>> {
    println!("cargo:rerun-if-env-changed=CODEWIDE_COMPANION_VERSION");
    println!("cargo:rerun-if-env-changed=CODEWIDE_CORE_VERSION");
    let version = env::var("CODEWIDE_COMPANION_VERSION")
        .or_else(|_| env::var("CODEWIDE_CORE_VERSION"))
        .or_else(|_| env::var("CARGO_PKG_VERSION"))
        .unwrap_or_else(|_| "unknown".to_owned());
    if version.is_empty() || version.chars().any(char::is_control) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "the plugin version must be a non-empty single-line value",
        )
        .into());
    }
    println!("cargo:rustc-env=CODEWIDE_FORGE_PLUGIN_VERSION={version}");
    Ok(())
}
