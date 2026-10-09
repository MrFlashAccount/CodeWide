use std::{env, error::Error, fs, io, path::PathBuf};

use serde_json::Value;

fn main() -> Result<(), Box<dyn Error>> {
    println!("cargo:rerun-if-changed=contract/pairing.json");
    println!("cargo:rerun-if-env-changed=CODEWIDE_RELAY_VERSION");
    println!("cargo:rerun-if-env-changed=CODEWIDE_RELAY_SOURCE_REVISION");
    println!("cargo:rerun-if-env-changed=CODEWIDE_HOST_UPDATE_SIGNING_KEY_ID");
    println!("cargo:rerun-if-env-changed=CODEWIDE_HOST_UPDATE_SIGNING_PUBLIC_KEY_SPKI");
    let version = env::var("CODEWIDE_RELAY_VERSION")
        .unwrap_or_else(|_| env::var("CARGO_PKG_VERSION").unwrap_or_else(|_| "unknown".to_owned()));
    if version.is_empty() || version.chars().any(char::is_control) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "CODEWIDE_RELAY_VERSION must be a non-empty single-line value",
        )
        .into());
    }
    println!("cargo:rustc-env=CODEWIDE_RELAY_VERSION={version}");
    let source_revision = env::var("CODEWIDE_RELAY_SOURCE_REVISION")
        .unwrap_or_else(|_| "0000000000000000000000000000000000000000".to_owned());
    if source_revision.len() != 40
        || !source_revision
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "CODEWIDE_RELAY_SOURCE_REVISION must be a lowercase 40-character Git revision",
        )
        .into());
    }
    println!("cargo:rustc-env=CODEWIDE_RELAY_SOURCE_REVISION={source_revision}");
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
            "Relay update trust variables must be absent together or contain a valid key id and base64 SPKI",
        )
        .into());
    }
    println!("cargo:rustc-env=CODEWIDE_RELAY_UPDATE_KEY_ID={key_id}");
    println!("cargo:rustc-env=CODEWIDE_RELAY_UPDATE_PUBLIC_KEY_SPKI={public_key}");
    let contract: Value = serde_json::from_str(&fs::read_to_string("contract/pairing.json")?)?;
    let protocol_version = contract
        .get("protocolVersion")
        .and_then(Value::as_u64)
        .filter(|candidate| u8::try_from(*candidate).is_ok())
        .ok_or_else(|| {
            io::Error::new(
                io::ErrorKind::InvalidData,
                "relay pairing protocolVersion must fit in u8",
            )
        })?;
    let output = PathBuf::from(
        env::var_os("OUT_DIR")
            .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "OUT_DIR must be set"))?,
    )
    .join("pairing_version.rs");
    fs::write(
        output,
        format!("pub const INVITATION_VERSION: u8 = {protocol_version};\n"),
    )?;
    Ok(())
}
