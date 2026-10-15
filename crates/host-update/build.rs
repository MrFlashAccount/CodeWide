use std::{env, error::Error, io};

/// Official release builds carry the host-update signing key in the binary, so
/// no installer step can drop it. A build without it is not remotely updatable.
fn main() -> Result<(), Box<dyn Error>> {
    println!("cargo:rerun-if-env-changed=CODEWIDE_HOST_UPDATE_SIGNING_KEY_ID");
    println!("cargo:rerun-if-env-changed=CODEWIDE_HOST_UPDATE_SIGNING_PUBLIC_KEY_SPKI");
    let key_id = env::var("CODEWIDE_HOST_UPDATE_SIGNING_KEY_ID").unwrap_or_default();
    let public_key = env::var("CODEWIDE_HOST_UPDATE_SIGNING_PUBLIC_KEY_SPKI").unwrap_or_default();
    let invalid_key_id = key_id.chars().any(|character| {
        !character.is_ascii_alphanumeric() && character != '_' && character != '-'
    });
    let invalid_public_key = public_key.chars().any(|character| {
        !character.is_ascii_alphanumeric() && !matches!(character, '+' | '/' | '=')
    });
    if invalid_key_id || invalid_public_key || key_id.is_empty() != public_key.is_empty() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "Host update trust variables must be absent together or contain a valid key id and base64 SPKI",
        )
        .into());
    }
    println!("cargo:rustc-env=CODEWIDE_HOST_UPDATE_KEY_ID={key_id}");
    println!("cargo:rustc-env=CODEWIDE_HOST_UPDATE_PUBLIC_KEY_SPKI={public_key}");
    Ok(())
}
