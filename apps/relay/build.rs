use std::{env, error::Error, fs, io, path::PathBuf};

use serde_json::Value;

fn main() -> Result<(), Box<dyn Error>> {
    println!("cargo:rerun-if-changed=contract/pairing.json");
    println!("cargo:rerun-if-env-changed=CODEWIDE_RELAY_VERSION");
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
