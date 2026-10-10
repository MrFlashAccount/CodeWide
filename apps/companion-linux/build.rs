use std::{
    env,
    error::Error,
    io,
    path::{Path, PathBuf},
    process::Command,
};

use sha2::{Digest, Sha256};

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
    if env::var_os("CARGO_FEATURE_EMBEDDED_CLAUDE_HOST").is_some() {
        build_claude_host()?;
    }
    Ok(())
}

/// Bun's target for the Rust target this binary is built for.
fn bun_target(rust_target: &str) -> Result<&'static str, Box<dyn Error>> {
    Ok(match rust_target {
        "x86_64-unknown-linux-gnu" => "bun-linux-x64",
        "aarch64-unknown-linux-gnu" => "bun-linux-arm64",
        "x86_64-unknown-linux-musl" => "bun-linux-x64-musl",
        "aarch64-unknown-linux-musl" => "bun-linux-arm64-musl",
        other => return Err(format!("no Bun target for {other}").into()),
    })
}

/// The Claude agent host shipped in this binary, at
/// `$OUT_DIR/claude-agent-host`, and its SHA-256 for the install directory:
/// `CODEWIDE_CLAUDE_HOST_BINARY` when set (a host built outside this build,
/// as the container release build does), else `bun build --compile` of
/// `crates/agent-provider-claude/host` with the Agent SDK left out (the
/// companion downloads it from npm at run time).
fn build_claude_host() -> Result<(), Box<dyn Error>> {
    println!("cargo:rerun-if-env-changed=CODEWIDE_CLAUDE_HOST_BINARY");
    let output = PathBuf::from(env::var("OUT_DIR")?).join("claude-agent-host");
    match env::var_os("CODEWIDE_CLAUDE_HOST_BINARY") {
        Some(prebuilt) => {
            println!("cargo:rerun-if-changed={}", Path::new(&prebuilt).display());
            std::fs::copy(&prebuilt, &output)?;
        }
        None => compile_claude_host(&output)?,
    }
    let digest = Sha256::digest(std::fs::read(&output)?);
    let hex = digest.iter().fold(String::new(), |mut hex, byte| {
        use std::fmt::Write as _;
        // Writing to a String cannot fail.
        let _ = write!(hex, "{byte:02x}");
        hex
    });
    println!("cargo:rustc-env=CODEWIDE_CLAUDE_HOST_SHA256={hex}");
    Ok(())
}

fn compile_claude_host(output: &Path) -> Result<(), Box<dyn Error>> {
    let manifest = PathBuf::from(env::var("CARGO_MANIFEST_DIR")?);
    let host = manifest.join("../../crates/agent-provider-claude/host");
    for watched in ["src", "package.json"] {
        println!("cargo:rerun-if-changed={}", host.join(watched).display());
    }
    println!("cargo:rerun-if-env-changed=CODEWIDE_BUN");
    if !host.join("node_modules").is_dir() {
        return Err("the Claude agent host has no node_modules; run `pnpm install` first".into());
    }
    let bun = env::var_os("CODEWIDE_BUN").unwrap_or_else(|| "bun".into());
    let status = Command::new(&bun)
        .current_dir(&host)
        .args([
            "build",
            "--compile",
            "--minify",
            "--external",
            "@anthropic-ai/claude-agent-sdk",
            "--target",
            bun_target(&env::var("TARGET")?)?,
            "src/main.ts",
            "--outfile",
        ])
        .arg(output)
        .status()
        .map_err(|error| format!("cannot run Bun ({}): {error}", Path::new(&bun).display()))?;
    if !status.success() {
        return Err(
            format!("bun build --compile of the Claude agent host failed: {status}").into(),
        );
    }
    Ok(())
}
