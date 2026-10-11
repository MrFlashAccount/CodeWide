//! The Claude Agent SDK the packaged agent host loads. The SDK is not
//! redistributed with `CodeWide`: the companion downloads the pinned package
//! from the npm registry on the user's machine, checks it against the
//! integrity recorded in the host's install lock, and unpacks it under its
//! state directory. A version already unpacked is reused without network.
//!
//! Rotation: a version directory is used only when its marker
//! (`.codewide-integrity`, written before the directory is moved into
//! place) names the pinned integrity; anything else is reinstalled. Each use
//! refreshes the marker's time. The pinned version and the most recently used
//! other one are kept (a rollback to the previous companion needs no
//! network); older versions are removed. Staging directories a killed start
//! left behind are removed once they are older than [`STALE_AFTER`].

use std::{
    io::Read,
    path::{Path, PathBuf},
};

use base64::Engine;
use sha2::{Digest, Sha512};

/// The npm package the host is built against.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct AgentSdkPin {
    pub version: &'static str,
    pub tarball_url: &'static str,
    /// Subresource integrity of the tarball (`sha512-<base64>`).
    pub integrity: &'static str,
}

/// Must equal `node_modules/@anthropic-ai/claude-agent-sdk` in
/// `host/install/package-lock.json` (checked by a test).
pub const AGENT_SDK: AgentSdkPin = AgentSdkPin {
    version: "0.3.295",
    tarball_url: "https://registry.npmjs.org/@anthropic-ai/claude-agent-sdk/-/claude-agent-sdk-0.3.295.tgz",
    integrity: "sha512-GaLZbMAqyT4ZCtDQYq2p26bjpqqRfoobVxCK+Ao283I12sGyw2ttMvjdCXclS9VKhs+/IIu8/AtjqyrX73FZ/g==",
};

/// The package is about 1.5 MB; anything far larger is not it.
const MAX_TARBALL_BYTES: usize = 64 * 1024 * 1024;
const ENTRY_FILE: &str = "sdk.mjs";
const MARKER_FILE: &str = ".codewide-integrity";
const STAGING_PREFIX: &str = ".agent-sdk-";
/// A staging directory this old belongs to no start still running.
pub const STALE_AFTER: std::time::Duration = std::time::Duration::from_hours(1);

#[derive(Debug, thiserror::Error)]
pub enum AgentSdkError {
    #[error("downloading the Claude Agent SDK failed")]
    Download(#[source] reqwest::Error),
    #[error("the Claude Agent SDK download is larger than {MAX_TARBALL_BYTES} bytes")]
    TooLarge,
    #[error("the Claude Agent SDK download does not match its pinned integrity")]
    Integrity,
    #[error("the Claude Agent SDK package has no {ENTRY_FILE}")]
    NoEntry,
    #[error("unpacking the Claude Agent SDK failed")]
    Io(#[from] std::io::Error),
}

impl AgentSdkPin {
    /// `<root>/<version>`, the unpacked package.
    #[must_use]
    pub fn directory(&self, root: &Path) -> PathBuf {
        root.join(self.version)
    }

    /// Whether `bytes` is the pinned tarball.
    #[must_use]
    pub fn matches(&self, bytes: &[u8]) -> bool {
        let digest = base64::engine::general_purpose::STANDARD.encode(Sha512::digest(bytes));
        self.integrity.strip_prefix("sha512-") == Some(digest.as_str())
    }
}

/// The SDK's `sdk.mjs` under `root`, downloading and unpacking the pinned
/// package unless a complete install of it is there; then rotates `root`.
///
/// # Errors
/// Returns the download, integrity or unpacking failure; nothing partial is
/// left as the pinned version.
pub async fn ensure_agent_sdk(
    root: &Path,
    pin: &AgentSdkPin,
    client: &reqwest::Client,
) -> Result<PathBuf, AgentSdkError> {
    let directory = pin.directory(root);
    let entry = if is_installed(&directory, pin) {
        directory.join(ENTRY_FILE)
    } else {
        let tarball = download(pin, client).await?;
        let root = root.to_path_buf();
        let pin = *pin;
        tokio::task::spawn_blocking(move || install(&root, &pin, &tarball))
            .await
            .map_err(std::io::Error::other)??
    };
    mark_used(&directory);
    rotate(root, &directory, std::time::SystemTime::now());
    Ok(entry)
}

/// A complete install of `pin`: its marker names the pinned integrity.
fn is_installed(directory: &Path, pin: &AgentSdkPin) -> bool {
    directory.join(ENTRY_FILE).is_file()
        && std::fs::read_to_string(directory.join(MARKER_FILE))
            .is_ok_and(|marker| marker.trim() == pin.integrity)
}

/// Refreshes the marker's time, which orders versions by last use.
fn mark_used(directory: &Path) {
    if let Ok(marker) = std::fs::File::options()
        .write(true)
        .open(directory.join(MARKER_FILE))
    {
        // Best effort: a stale time only changes which old version is kept.
        let _ = marker.set_modified(std::time::SystemTime::now());
    }
}

fn last_used(directory: &Path) -> std::time::SystemTime {
    std::fs::metadata(directory.join(MARKER_FILE))
        .or_else(|_| std::fs::metadata(directory))
        .and_then(|metadata| metadata.modified())
        .unwrap_or(std::time::SystemTime::UNIX_EPOCH)
}

/// Keeps `current` and the most recently used other version; removes older
/// versions and staging directories older than [`STALE_AFTER`].
fn rotate(root: &Path, current: &Path, now: std::time::SystemTime) {
    let Ok(entries) = std::fs::read_dir(root) else {
        return;
    };
    let mut versions = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if path == current || !path.is_dir() {
            continue;
        }
        if entry
            .file_name()
            .to_string_lossy()
            .starts_with(STAGING_PREFIX)
        {
            let age = std::fs::metadata(&path)
                .and_then(|metadata| metadata.modified())
                .ok()
                .and_then(|modified| now.duration_since(modified).ok());
            if age.is_some_and(|age| age >= STALE_AFTER) {
                // Best effort: a staging directory left behind only costs disk space.
                let _ = std::fs::remove_dir_all(&path);
            }
            continue;
        }
        versions.push((last_used(&path), path));
    }
    versions.sort_by_key(|(used, _)| std::cmp::Reverse(*used));
    for (_, path) in versions.iter().skip(1) {
        // Best effort: an old version left behind only costs disk space.
        let _ = std::fs::remove_dir_all(path);
    }
}

async fn download(pin: &AgentSdkPin, client: &reqwest::Client) -> Result<Vec<u8>, AgentSdkError> {
    let mut response = client
        .get(pin.tarball_url)
        .send()
        .await
        .and_then(reqwest::Response::error_for_status)
        .map_err(AgentSdkError::Download)?;
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(AgentSdkError::Download)? {
        if bytes.len() + chunk.len() > MAX_TARBALL_BYTES {
            return Err(AgentSdkError::TooLarge);
        }
        bytes.extend_from_slice(&chunk);
    }
    if pin.matches(&bytes) {
        Ok(bytes)
    } else {
        Err(AgentSdkError::Integrity)
    }
}

/// Unpacks a verified tarball (npm packs everything under `package/`) next
/// to its destination and moves it into place in one rename.
fn install(root: &Path, pin: &AgentSdkPin, tarball: &[u8]) -> Result<PathBuf, AgentSdkError> {
    std::fs::create_dir_all(root)?;
    let staging = tempfile::Builder::new()
        .prefix(STAGING_PREFIX)
        .tempdir_in(root)?;
    unpack(tarball, staging.path())?;
    let package = staging.path().join("package");
    if !package.join(ENTRY_FILE).is_file() {
        return Err(AgentSdkError::NoEntry);
    }
    std::fs::write(package.join(MARKER_FILE), pin.integrity)?;
    let destination = pin.directory(root);
    if destination.exists() && !is_installed(&destination, pin) {
        // An incomplete or foreign directory under the pinned version's name.
        std::fs::remove_dir_all(&destination)?;
    }
    match std::fs::rename(&package, &destination) {
        Ok(()) => {}
        // Another start installed it meanwhile; keep that one.
        Err(_) if is_installed(&destination, pin) => {}
        Err(error) => return Err(error.into()),
    }
    Ok(destination.join(ENTRY_FILE))
}

fn unpack(tarball: &[u8], into: &Path) -> std::io::Result<()> {
    let mut decoded = Vec::new();
    flate2::read::GzDecoder::new(tarball)
        .take(u64::try_from(MAX_TARBALL_BYTES).unwrap_or(u64::MAX) * 4)
        .read_to_end(&mut decoded)?;
    // `unpack` places every entry inside `into` and refuses `..` and absolute paths.
    tar::Archive::new(decoded.as_slice()).unpack(into)
}

#[cfg(test)]
mod tests {
    use std::io::Write;

    use super::*;

    fn tarball(files: &[(&str, &str)]) -> Result<Vec<u8>, Box<dyn std::error::Error>> {
        let mut builder = tar::Builder::new(Vec::new());
        for (path, content) in files {
            let mut header = tar::Header::new_gnu();
            header.set_size(u64::try_from(content.len())?);
            header.set_mode(0o644);
            header.set_cksum();
            builder.append_data(&mut header, path, content.as_bytes())?;
        }
        let mut encoder = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::fast());
        encoder.write_all(&builder.into_inner()?)?;
        Ok(encoder.finish()?)
    }

    fn integrity(bytes: &[u8]) -> String {
        format!(
            "sha512-{}",
            base64::engine::general_purpose::STANDARD.encode(Sha512::digest(bytes))
        )
    }

    #[test]
    fn the_pin_is_the_host_install_lock() -> Result<(), Box<dyn std::error::Error>> {
        let lock: serde_json::Value =
            serde_json::from_str(include_str!("../host/install/package-lock.json"))?;
        let package = &lock["packages"]["node_modules/@anthropic-ai/claude-agent-sdk"];
        assert_eq!(package["version"], AGENT_SDK.version);
        assert_eq!(package["resolved"], AGENT_SDK.tarball_url);
        assert_eq!(package["integrity"], AGENT_SDK.integrity);
        Ok(())
    }

    fn pin_for(bytes: &[u8]) -> AgentSdkPin {
        AgentSdkPin {
            version: "1.2.3",
            tarball_url: "https://registry.invalid/sdk.tgz",
            integrity: Box::leak(integrity(bytes).into_boxed_str()),
        }
    }

    fn set_time(path: &Path, time: std::time::SystemTime) -> std::io::Result<()> {
        std::fs::File::open(path)?.set_modified(time)
    }

    #[test]
    fn installs_a_marked_package_and_replaces_an_incomplete_one()
    -> Result<(), Box<dyn std::error::Error>> {
        let root = tempfile::tempdir()?;
        let bytes = tarball(&[("package/sdk.mjs", "export {}"), ("package/core.mjs", "")])?;
        let pin = pin_for(&bytes);
        assert!(pin.matches(&bytes));
        assert!(!pin.matches(b"other"));
        // A directory a killed start left under the pinned name: no marker.
        let directory = pin.directory(root.path());
        std::fs::create_dir_all(&directory)?;
        std::fs::write(directory.join(ENTRY_FILE), "partial")?;
        assert!(!is_installed(&directory, &pin));
        let entry = install(root.path(), &pin, &bytes)?;
        assert_eq!(entry, directory.join(ENTRY_FILE));
        assert_eq!(std::fs::read_to_string(&entry)?, "export {}");
        assert!(directory.join("core.mjs").is_file());
        assert!(is_installed(&directory, &pin));
        Ok(())
    }

    #[test]
    fn keeps_the_current_and_the_last_used_version_and_drops_stale_staging()
    -> Result<(), Box<dyn std::error::Error>> {
        let root = tempfile::tempdir()?;
        let now = std::time::SystemTime::now();
        let hour = std::time::Duration::from_hours(1);
        for (version, hours_ago) in [("1.0.0", 3), ("1.1.0", 2), ("1.2.0", 1)] {
            let directory = root.path().join(version);
            std::fs::create_dir_all(&directory)?;
            std::fs::write(directory.join(MARKER_FILE), "sha512-old")?;
            set_time(&directory.join(MARKER_FILE), now - hour * hours_ago)?;
        }
        let current = root.path().join("2.0.0");
        std::fs::create_dir_all(&current)?;
        let stale = root.path().join(".agent-sdk-stale");
        let fresh = root.path().join(".agent-sdk-fresh");
        std::fs::create_dir_all(&stale)?;
        std::fs::create_dir_all(&fresh)?;
        set_time(&stale, now - STALE_AFTER - hour)?;
        rotate(root.path(), &current, now);
        let mut left = std::fs::read_dir(root.path())?
            .map(|entry| entry.map(|entry| entry.file_name().to_string_lossy().into_owned()))
            .collect::<Result<Vec<_>, _>>()?;
        left.sort();
        // A fresh staging directory may belong to a start still running.
        assert_eq!(left, [".agent-sdk-fresh", "1.2.0", "2.0.0"]);
        Ok(())
    }

    #[tokio::test]
    async fn only_a_marked_install_is_used_without_network()
    -> Result<(), Box<dyn std::error::Error>> {
        let root = tempfile::tempdir()?;
        let directory = AGENT_SDK.directory(root.path());
        std::fs::create_dir_all(&directory)?;
        std::fs::write(directory.join(ENTRY_FILE), "")?;
        // Requests to an unreachable proxy fail at once: no network is used.
        let client = reqwest::Client::builder()
            .proxy(reqwest::Proxy::all("http://127.0.0.1:9")?)
            .build()?;
        assert!(matches!(
            ensure_agent_sdk(root.path(), &AGENT_SDK, &client).await,
            Err(AgentSdkError::Download(_))
        ));
        std::fs::write(directory.join(MARKER_FILE), AGENT_SDK.integrity)?;
        assert_eq!(
            ensure_agent_sdk(root.path(), &AGENT_SDK, &client).await?,
            directory.join(ENTRY_FILE)
        );
        Ok(())
    }

    #[test]
    fn a_package_without_the_entry_is_refused() -> Result<(), Box<dyn std::error::Error>> {
        let root = tempfile::tempdir()?;
        let bytes = tarball(&[("package/other.mjs", "")])?;
        let pin = AgentSdkPin {
            version: "1.2.3",
            tarball_url: "https://registry.invalid/sdk.tgz",
            integrity: "sha512-unused",
        };
        assert!(matches!(
            install(root.path(), &pin, &bytes),
            Err(AgentSdkError::NoEntry)
        ));
        assert!(!pin.directory(root.path()).exists());
        Ok(())
    }
}
