use std::{env, error::Error, io};

fn main() -> Result<(), Box<dyn Error>> {
    println!("cargo:rerun-if-env-changed=CODEWIDE_COMPANION_VERSION");
    let version = env::var("CODEWIDE_COMPANION_VERSION")
        .unwrap_or_else(|_| env::var("CARGO_PKG_VERSION").unwrap_or_else(|_| "unknown".to_owned()));
    if version.is_empty() || version.chars().any(char::is_control) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "CODEWIDE_COMPANION_VERSION must be a non-empty single-line value",
        )
        .into());
    }
    println!("cargo:rustc-env=CODEWIDE_COMPANION_VERSION={version}");
    Ok(())
}
