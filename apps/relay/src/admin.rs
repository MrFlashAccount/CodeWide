//! Private local control socket. Closing its pairing connection closes enrollment.
use crate::{
    Result, denied,
    enrollment::{Enrollment, Phase},
    pairing::InvitationBundle,
    registry::{Registry, RouteSummary},
    server::Relay,
};
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use std::{
    fs::File,
    os::unix::fs::{FileTypeExt, OpenOptionsExt, PermissionsExt},
    path::{Path, PathBuf},
    time::Duration,
};
use tokio::{
    io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt},
    net::{UnixListener, UnixStream},
    task::JoinSet,
};
use tokio_util::sync::CancellationToken;

pub const SOCKET: &str = "control.sock";
const MAX_FRAME: usize = 64 * 1024;

#[derive(Deserialize, Serialize)]
#[serde(tag = "command", rename_all = "camelCase", deny_unknown_fields)]
pub enum Request {
    Status,
    Pair,
    Approve { candidate: String },
    Cancel,
    Invite { route: Option<String> },
    Rename { route: String, label: String },
    Revoke { route: String },
}

#[derive(Deserialize, Serialize)]
#[serde(tag = "event", rename_all = "camelCase", deny_unknown_fields)]
pub enum Reply {
    Status {
        version: String,
        port: u16,
        routes: Vec<RouteSummary>,
    },
    Pairing {
        remaining_seconds: u64,
        phase: Phase,
    },
    Invitation {
        bundle: InvitationBundle,
    },
    Revoked {
        removed: bool,
    },
    Renamed {
        updated: bool,
    },
    Error {
        message: String,
    },
}

pub struct ControlServer {
    listener: UnixListener,
    path: PathBuf,
    _lock: File,
    registry: Registry,
    relay: Relay,
    port: u16,
    pin: String,
}

impl Drop for ControlServer {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.path);
    }
}

impl ControlServer {
    /// Binds the daemon's private socket under its existing registry directory.
    /// # Errors
    /// Rejects another daemon or a non-socket at the control path.
    pub fn bind(
        root: &Path,
        registry: Registry,
        relay: Relay,
        port: u16,
        pin: String,
        group_admin: bool,
    ) -> Result<Self> {
        let lock = std::fs::OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .mode(0o600)
            .open(root.join("daemon.lock"))?;
        fs2::FileExt::try_lock_exclusive(&lock).map_err(|_| {
            std::io::Error::other("A Relay is already running with this state directory")
        })?;
        let path = root.join(SOCKET);
        match std::fs::symlink_metadata(&path) {
            Ok(metadata) if metadata.file_type().is_socket() => std::fs::remove_file(&path)?,
            Ok(_) => return Err(std::io::Error::other("Relay control path is not a socket").into()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.into()),
        }
        let listener = UnixListener::bind(&path)?;
        let mode = if group_admin { 0o660 } else { 0o600 };
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(mode))?;
        Ok(Self {
            listener,
            path,
            _lock: lock,
            registry,
            relay,
            port,
            pin,
        })
    }

    /// Serves bounded local requests until the daemon shuts down.
    /// # Errors
    /// Propagates listener failures.
    pub async fn run(&self, stop: CancellationToken) -> Result<()> {
        let mut clients = JoinSet::new();
        loop {
            tokio::select! {
                () = stop.cancelled() => break,
                Some(_) = clients.join_next(), if !clients.is_empty() => {},
                accepted = self.listener.accept(), if clients.len() < 16 => {
                    let (mut socket, _) = accepted?;
                    let registry = self.registry.clone();
                    let relay = self.relay.clone();
                    let pin = self.pin.clone();
                    let port = self.port;
                    clients.spawn(async move {
                        if let Err(error) = handle(&mut socket, registry, relay, port, pin).await {
                            let reply = Reply::Error { message: error.to_string() };
                            let _ = tokio::time::timeout(Duration::from_secs(2), write_frame(&mut socket, &reply)).await;
                        }
                    });
                }
            }
        }
        clients.abort_all();
        while clients.join_next().await.is_some() {}
        Ok(())
    }
}

async fn handle(
    socket: &mut UnixStream,
    registry: Registry,
    relay: Relay,
    port: u16,
    pin: String,
) -> Result<()> {
    let request = tokio::time::timeout(Duration::from_secs(5), read_frame(socket)).await??;
    let reply = match request {
        Request::Status => Reply::Status {
            version: env!("CODEWIDE_RELAY_VERSION").to_owned(),
            port,
            routes: registry.summaries()?,
        },
        Request::Pair => return pairing(socket, &relay.enrollment()).await,
        Request::Invite { route } => {
            let invitation = registry.create_invitation(route.as_deref())?;
            Reply::Invitation {
                bundle: InvitationBundle {
                    version: crate::pairing::INVITATION_VERSION,
                    relay_tls_pin_sha256: pin,
                    route_id: invitation.route_id,
                    invitation: invitation.token,
                },
            }
        }
        Request::Rename { route, label } => Reply::Renamed {
            updated: registry.rename(&route, &label)?,
        },
        Request::Revoke { route } => {
            let removed = registry.revoke(&route)?;
            if removed {
                relay.cancel_route(&route);
            }
            Reply::Revoked { removed }
        }
        Request::Approve { .. } | Request::Cancel => return Err(denied()),
    };
    tokio::time::timeout(Duration::from_secs(5), write_frame(socket, &reply)).await??;
    Ok(())
}

async fn pairing(socket: &mut UnixStream, enrollment: &Enrollment) -> Result<()> {
    let owner = enrollment.open()?;
    let window = &owner.0;
    let mut changes = window.changes.subscribe();
    let (mut reader, mut writer) = socket.split();
    // A single persistent reader keeps framed reads cancellation-safe.
    let (sender, mut requests) = tokio::sync::mpsc::channel(4);
    let reading = async {
        loop {
            let request = read_frame::<Request>(&mut reader).await?;
            sender.send(request).await.map_err(|_| denied())?;
        }
        #[allow(unreachable_code)]
        Ok::<(), crate::Error>(())
    };
    let writing = async {
        loop {
            let phase = changes.borrow_and_update().clone();
            write_frame(
                &mut writer,
                &Reply::Pairing {
                    remaining_seconds: window.remaining_seconds(),
                    phase: phase.clone(),
                },
            )
            .await?;
            if phase.finished() {
                return Ok(());
            }
            tokio::select! {
                () = tokio::time::sleep_until(window.deadline) => {
                    window.expire();
                }
                result = changes.changed() => result?,
                request = requests.recv() => match request {
                    Some(Request::Approve { candidate }) => window.approve(&candidate)?,
                    Some(Request::Cancel) => window.cancel(),
                    _ => return Err(denied()),
                }
            }
        }
    };
    tokio::select! {
        result = reading => result,
        result = tokio::time::timeout_at(window.deadline + Duration::from_secs(1), writing) => result?,
    }
}

/// Reads one length-delimited JSON control message with a hard allocation limit.
/// # Errors
/// Rejects oversized, incomplete, or malformed frames.
pub async fn read_frame<T: DeserializeOwned>(stream: &mut (impl AsyncRead + Unpin)) -> Result<T> {
    let length = usize::try_from(stream.read_u32().await?)?;
    if length == 0 || length > MAX_FRAME {
        return Err(denied());
    }
    let mut bytes = vec![0; length];
    stream.read_exact(&mut bytes).await?;
    Ok(serde_json::from_slice(&bytes)?)
}

/// Writes one bounded, length-delimited JSON control message.
/// # Errors
/// Propagates serialization and transport failures.
pub async fn write_frame(
    stream: &mut (impl AsyncWrite + Unpin),
    value: &impl Serialize,
) -> Result<()> {
    let bytes = serde_json::to_vec(value)?;
    if bytes.len() > MAX_FRAME {
        return Err(denied());
    }
    stream.write_u32(u32::try_from(bytes.len())?).await?;
    stream.write_all(&bytes).await?;
    stream.flush().await?;
    Ok(())
}
