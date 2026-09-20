//! Durable multi-Companion route credentials stored as private atomic files.
use crate::{Result, auth, denied, pairing::PairResponse};
use serde::{Deserialize, Serialize};
use std::{
    fs::File,
    io::Write,
    os::unix::fs::{OpenOptionsExt, PermissionsExt},
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::{SystemTime, UNIX_EPOCH},
};
use subtle::ConstantTimeEq;

const RECORD_VERSION: u8 = 1;
const INVITATION_TTL_SECONDS: i64 = 5 * 60;

#[derive(Clone)]
pub struct Registry {
    root: Arc<PathBuf>,
    process_lock: Arc<Mutex<()>>,
    lock_file: Arc<File>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct InvitationRecord {
    version: u8,
    route_id: String,
    expires_at: i64,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RouteRecord {
    version: u8,
    token_hash: String,
    generation: u64,
}

pub struct Invitation {
    pub token: String,
    pub route_id: String,
    pub expires_at: i64,
}

pub struct AuthorizedSession {
    pub access_token: String,
    pub route_id: String,
    pub generation: u64,
}

impl Registry {
    /// Opens or creates a private directory-backed relay registry.
    /// # Errors
    /// Rejects unsafe paths and propagates filesystem failures.
    pub fn open(root: &Path) -> Result<Self> {
        ensure_private_directory(root)?;
        ensure_private_directory(&root.join("routes"))?;
        ensure_private_directory(&root.join("invitations"))?;
        let lock_path = root.join("registry.lock");
        let lock_file = std::fs::OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .mode(0o600)
            .open(lock_path)?;
        Ok(Self {
            root: Arc::new(root.to_owned()),
            process_lock: Arc::new(Mutex::new(())),
            lock_file: Arc::new(lock_file),
        })
    }

    /// Creates a single-use invitation for a new route or an explicit route rotation.
    /// # Errors
    /// Rejects an unknown rotation route and propagates filesystem failures.
    pub fn create_invitation(&self, route_id: Option<&str>) -> Result<Invitation> {
        let _guard = self.process_lock.lock().map_err(|_| denied())?;
        let _file_guard = self.lock_exclusive()?;
        let route_id = match route_id {
            Some(route_id) => {
                validate_route_id(route_id)?;
                if !self.route_path(route_id).is_file() {
                    return Err(denied());
                }
                route_id.to_owned()
            }
            None => loop {
                let candidate = auth::generate();
                if !self.route_path(&candidate).exists() {
                    break candidate;
                }
            },
        };
        let token = auth::generate();
        let expires_at = unix_seconds()? + INVITATION_TTL_SECONDS;
        create_json(
            &self.invitation_path(&token),
            &InvitationRecord {
                version: RECORD_VERSION,
                route_id: route_id.clone(),
                expires_at,
            },
        )?;
        Ok(Invitation {
            token,
            route_id,
            expires_at,
        })
    }

    /// Consumes one invitation and issues a new per-route access token.
    /// # Errors
    /// Rejects invalid, expired, reused, or route-mismatched invitations.
    pub fn pair(&self, route_id: &str, invitation: &str) -> Result<PairResponse> {
        validate_route_id(route_id)?;
        auth::validate(invitation)?;
        let _guard = self.process_lock.lock().map_err(|_| denied())?;
        let _file_guard = self.lock_exclusive()?;
        let invitation_path = self.invitation_path(invitation);
        let claimed_path = self.root.join("invitations").join(format!(
            ".claimed-{}-{}",
            auth::digest_hex(invitation),
            auth::generate()
        ));
        std::fs::rename(&invitation_path, &claimed_path).map_err(|_| denied())?;
        let record_result = read_private_json::<InvitationRecord>(&claimed_path);
        let _ = std::fs::remove_file(&claimed_path);
        let invitation_record = record_result?;
        if invitation_record.version != RECORD_VERSION
            || invitation_record.route_id != route_id
            || invitation_record.expires_at < unix_seconds()?
        {
            return Err(denied());
        }

        let generation = match self.read_route(route_id) {
            Ok(record) => record.generation.checked_add(1).ok_or_else(denied)?,
            Err(error)
                if error
                    .downcast_ref::<std::io::Error>()
                    .is_some_and(|error| error.kind() == std::io::ErrorKind::NotFound) =>
            {
                1
            }
            Err(error) => return Err(error),
        };
        let access_token = auth::generate();
        atomic_json(
            &self.route_path(route_id),
            &RouteRecord {
                version: RECORD_VERSION,
                token_hash: auth::digest_hex(&access_token),
                generation,
            },
        )?;
        Ok(PairResponse {
            route_id: route_id.to_owned(),
            access_token,
            generation,
        })
    }

    /// Authorizes one exact route/token pair.
    /// # Errors
    /// Rejects absent, revoked, malformed, or mismatched credentials.
    pub fn authorize(&self, route_id: &str, access_token: &str) -> Result<AuthorizedSession> {
        validate_route_id(route_id)?;
        auth::validate(access_token)?;
        let record = self.read_route(route_id)?;
        let actual_hash = auth::digest_hex(access_token);
        if record.version != RECORD_VERSION
            || record.token_hash.len() != actual_hash.len()
            || !bool::from(record.token_hash.as_bytes().ct_eq(actual_hash.as_bytes()))
        {
            return Err(denied());
        }
        Ok(AuthorizedSession {
            access_token: access_token.to_owned(),
            route_id: route_id.to_owned(),
            generation: record.generation,
        })
    }

    /// Returns whether this route generation is still authorized.
    /// # Errors
    /// Propagates registry failures.
    pub fn is_current(&self, route_id: &str, access_token: &str, generation: u64) -> Result<bool> {
        Ok(self
            .authorize(route_id, access_token)
            .is_ok_and(|session| session.generation == generation))
    }

    /// Revokes one route without affecting any other Companion.
    /// # Errors
    /// Rejects malformed route identifiers and propagates filesystem failures.
    pub fn revoke(&self, route_id: &str) -> Result<bool> {
        validate_route_id(route_id)?;
        let _guard = self.process_lock.lock().map_err(|_| denied())?;
        let _file_guard = self.lock_exclusive()?;
        match std::fs::remove_file(self.route_path(route_id)) {
            Ok(()) => Ok(true),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
            Err(error) => Err(error.into()),
        }
    }

    /// Returns all paired route identifiers without exposing credentials.
    /// # Errors
    /// Propagates filesystem failures and rejects malformed records.
    pub fn routes(&self) -> Result<Vec<String>> {
        let mut routes = Vec::new();
        for entry in std::fs::read_dir(self.root.join("routes"))? {
            let entry = entry?;
            if !entry.file_type()?.is_file() {
                continue;
            }
            let Some(route_id) = entry.file_name().to_str().map(str::to_owned) else {
                return Err(denied());
            };
            validate_route_id(&route_id)?;
            routes.push(route_id);
        }
        routes.sort_unstable();
        Ok(routes)
    }

    fn read_route(&self, route_id: &str) -> Result<RouteRecord> {
        read_private_json(&self.route_path(route_id))
    }

    fn route_path(&self, route_id: &str) -> PathBuf {
        self.root.join("routes").join(route_id)
    }

    fn invitation_path(&self, invitation: &str) -> PathBuf {
        self.root
            .join("invitations")
            .join(auth::digest_hex(invitation))
    }

    fn lock_exclusive(&self) -> Result<FileLock> {
        fs2::FileExt::lock_exclusive(self.lock_file.as_ref())?;
        Ok(FileLock(self.lock_file.clone()))
    }
}

struct FileLock(Arc<File>);

impl Drop for FileLock {
    fn drop(&mut self) {
        let _ = fs2::FileExt::unlock(self.0.as_ref());
    }
}

/// Validates the fixed-width lowercase hexadecimal route identifier.
/// # Errors
/// Rejects values outside the route ID wire contract.
pub fn validate_route_id(value: &str) -> Result<&str> {
    if value.len() != 64
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err(std::io::Error::other("relay route ID is invalid").into());
    }
    Ok(value)
}

fn ensure_private_directory(path: &Path) -> Result<()> {
    std::fs::create_dir_all(path)?;
    let metadata = std::fs::symlink_metadata(path)?;
    if !metadata.file_type().is_dir() {
        return Err(std::io::Error::other("relay state path must be a directory").into());
    }
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o700))?;
    Ok(())
}

fn create_json(path: &Path, value: &impl Serialize) -> Result<()> {
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(path)?;
    serde_json::to_writer(&mut file, value)?;
    file.write_all(b"\n")?;
    file.sync_all()?;
    Ok(())
}

fn atomic_json(path: &Path, value: &impl Serialize) -> Result<()> {
    let temporary = path.with_extension(format!("tmp-{}", auth::generate()));
    create_json(&temporary, value)?;
    std::fs::rename(&temporary, path)?;
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))?;
    Ok(())
}

fn read_private_json<T: for<'de> Deserialize<'de>>(path: &Path) -> Result<T> {
    let metadata = std::fs::symlink_metadata(path)?;
    if !metadata.file_type().is_file() || metadata.permissions().mode() & 0o077 != 0 {
        return Err(denied());
    }
    Ok(serde_json::from_reader(std::fs::File::open(path)?)?)
}

fn unix_seconds() -> Result<i64> {
    Ok(i64::try_from(
        SystemTime::now().duration_since(UNIX_EPOCH)?.as_secs(),
    )?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn routes_are_isolated_and_rotation_preserves_the_route() -> Result<()> {
        let directory = tempfile::tempdir()?;
        let registry = Registry::open(directory.path())?;
        let first_invitation = registry.create_invitation(None)?;
        let second_invitation = registry.create_invitation(None)?;
        let first = registry.pair(&first_invitation.route_id, &first_invitation.token)?;
        let second = registry.pair(&second_invitation.route_id, &second_invitation.token)?;
        assert!(
            registry
                .authorize(&first.route_id, &first.access_token)
                .is_ok()
        );
        assert!(
            registry
                .authorize(&second.route_id, &second.access_token)
                .is_ok()
        );
        assert!(
            registry
                .authorize(&first.route_id, &second.access_token)
                .is_err()
        );

        let rotation = registry.create_invitation(Some(&first.route_id))?;
        let rotated = registry.pair(&rotation.route_id, &rotation.token)?;
        assert_eq!(rotated.route_id, first.route_id);
        assert!(rotated.generation > first.generation);
        assert!(
            registry
                .authorize(&first.route_id, &first.access_token)
                .is_err()
        );
        assert!(
            registry
                .authorize(&second.route_id, &second.access_token)
                .is_ok()
        );
        assert!(registry.revoke(&first.route_id)?);
        assert_eq!(registry.routes()?, vec![second.route_id]);
        Ok(())
    }

    #[test]
    fn invitation_is_route_bound_and_single_use() -> Result<()> {
        let directory = tempfile::tempdir()?;
        let registry = Registry::open(directory.path())?;
        let invitation = registry.create_invitation(None)?;
        assert!(registry.pair(&auth::generate(), &invitation.token).is_err());
        assert!(
            registry
                .pair(&invitation.route_id, &invitation.token)
                .is_err()
        );
        Ok(())
    }
}
