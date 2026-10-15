//! Terminal workflow; network and state authority remain in the daemon.
mod discovery;
mod presentation;
mod update;

use clap::{Parser, Subcommand, ValueEnum};
use codewide_relay::{
    Result,
    admin::{ControlServer, Reply, Request, SOCKET, read_frame, write_frame},
    registry::Registry,
    server::{Relay, serve},
    transport_tls::RelayTlsIdentity,
};
use socket2::{Domain, Socket, Type};
use std::{
    io::IsTerminal, os::unix::fs::PermissionsExt, path::PathBuf, process::ExitCode, time::Duration,
};
use tokio::net::{TcpListener, UnixStream};
use tokio_util::sync::CancellationToken;

#[derive(Clone, Copy, Debug, ValueEnum)]
enum Color {
    Auto,
    Always,
    Never,
}

#[derive(Parser)]
#[command(name = "codewide-relay", version = env!("CODEWIDE_RELAY_VERSION"), about = "Connect your computers through an encrypted Relay", after_help = "Quick start:\n  codewide-relay           Open the Relay menu\n  codewide-relay pair      Connect a computer in 60 seconds\n  codewide-relay status    Show paired computers\n  codewide-relay update    Update the Relay to the newest release\n  codewide-relay serve     Run the server in the foreground\n\nWithout a terminal, the default command shows status. Existing noninteractive service commands with --port continue to start the server.")]
struct Cli {
    /// Listener port (serve only; defaults to 8780).
    #[arg(long, global = true, value_parser = clap::value_parser!(u16).range(1..))]
    port: Option<u16>,
    /// Use this Relay's existing state; otherwise discover the system service.
    #[arg(long, global = true)]
    state: Option<PathBuf>,
    /// Let members of the Relay service group use the administration socket.
    #[arg(long, global = true)]
    group_admin: bool,
    /// Reachable IP:port for pairing, overriding automatic public IP discovery.
    #[arg(long, global = true)]
    address: Option<String>,
    /// Emit JSON without decoration (not for interactive pair).
    #[arg(long, global = true)]
    json: bool,
    /// Color output; `NO_COLOR` and `TERM=dumb` disable automatic color.
    #[arg(long, global = true, value_enum, default_value = "auto")]
    color: Color,
    #[command(subcommand)]
    command: Option<Command>,
}

#[derive(Subcommand)]
enum Command {
    /// Start the Relay listener and its private control socket.
    Serve,
    /// Connect a computer in 60 seconds without copying keys.
    Pair,
    /// List paired computers and route IDs from the running Relay.
    Status,
    /// Print a single-use JSON invitation for older Companions.
    Invite {
        /// Rotate credentials for an existing route.
        #[arg(long)]
        route: Option<String>,
    },
    /// Change a paired computer's display name.
    Rename {
        #[arg(long)]
        route: String,
        #[arg(long)]
        label: String,
    },
    /// Revoke one computer's access.
    Revoke {
        #[arg(long)]
        route: String,
    },
    /// Update the running Relay to the newest release and confirm it
    /// restarted healthy; otherwise the previous version is restored.
    Update {
        /// Only report whether a newer release is available.
        #[arg(long)]
        check: bool,
    },
    /// Print the state directory selected from the active service for the installer.
    #[command(hide = true)]
    BootstrapInfo,
    /// Print this executable's version, build and source revision as JSON.
    #[command(hide = true)]
    BuildInfo,
    /// Run one queued remote update; started by the stable bootstrap copy.
    #[command(hide = true)]
    UpdateRun {
        /// Install root holding `generations/`, `current` and `bootstrap/`.
        #[arg(long)]
        install_root: PathBuf,
    },
}

/// Build provenance in a fixed field order: the installer matches this exact
/// line before it records a generation's metadata.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct BuildInfo {
    schema_version: u16,
    version: &'static str,
    build: &'static str,
    source_revision: &'static str,
}

impl BuildInfo {
    fn current() -> Self {
        let source_revision = env!("CODEWIDE_RELAY_SOURCE_REVISION");
        Self {
            schema_version: 1,
            version: env!("CODEWIDE_RELAY_VERSION"),
            build: &source_revision[..12],
            source_revision,
        }
    }
}

pub async fn run() -> ExitCode {
    let cli = Cli::parse();
    presentation::configure_color(cli.color, cli.json);
    match execute(&cli).await {
        Ok(code) => code,
        Err(error) => {
            presentation::error(&error.to_string(), cli.json);
            ExitCode::FAILURE
        }
    }
}

async fn execute(cli: &Cli) -> Result<ExitCode> {
    let interactive = std::io::stdin().is_terminal() && std::io::stderr().is_terminal();
    // Preserve installed units using `relay --port N --state DIR`, while a
    // person's bare command is always an administration entry point.
    if matches!(cli.command, Some(Command::Serve))
        || (cli.command.is_none() && cli.port.is_some() && !interactive)
    {
        return run_server(cli).await.map(|()| ExitCode::SUCCESS);
    }
    if matches!(cli.command, Some(Command::BuildInfo)) {
        println!("{}", serde_json::to_string(&BuildInfo::current())?);
        return Ok(ExitCode::SUCCESS);
    }
    if let Some(Command::UpdateRun { install_root }) = &cli.command {
        let state = cli
            .state
            .clone()
            .ok_or("update-run needs the Relay --state directory")?;
        codewide_relay::update::run_pending(
            install_root.clone(),
            state.join(codewide_relay::update::GUARDIAN_STATE),
        )
        .await
        .map_err(|error| error.to_string())?;
        return Ok(ExitCode::SUCCESS);
    }
    if matches!(cli.command, Some(Command::Pair)) && (cli.json || !interactive) {
        return Err("pair needs an interactive terminal to confirm the matching symbols. For scripts or older clients, use invite.".into());
    }
    let target = discovery::target(cli.state.as_deref())?;
    if matches!(cli.command, Some(Command::BootstrapInfo)) {
        let state = target
            .state
            .to_str()
            .ok_or("The Relay state path is not valid UTF-8")?;
        if state.chars().any(char::is_control) || !target.state.is_absolute() {
            return Err("The Relay state path is unsafe".into());
        }
        println!("{state}");
        return Ok(ExitCode::SUCCESS);
    }
    if let Some(Command::Update { check }) = cli.command {
        let control = update::RelayControl {
            socket: target.state.join(SOCKET),
            access_denied: discovery::access_denied(&target).to_string(),
        };
        return update::run(control, check, cli.json)
            .await
            .map(|()| ExitCode::SUCCESS);
    }
    let mut socket = match UnixStream::connect(target.state.join(SOCKET)).await {
        Ok(socket) => socket,
        Err(error) if error.kind() == std::io::ErrorKind::PermissionDenied => {
            return Err(discovery::access_denied(&target));
        }
        Err(_) => return Err(format!("Cannot reach the Relay control socket in {}. Start or upgrade the service; no new state was created.", target.state.display()).into()),
    };
    let request = match &cli.command {
        Some(Command::Pair) => {
            write_frame(&mut socket, &Request::Status).await?;
            let Reply::Status { port, .. } =
                tokio::time::timeout(Duration::from_secs(5), read_frame(&mut socket)).await??
            else {
                return Err("The Relay service returned an incompatible status response".into());
            };
            let endpoints = discovery::public_addresses(cli.address.as_deref(), port).await?;
            socket = UnixStream::connect(target.state.join(SOCKET)).await?;
            return presentation::pair(socket, &endpoints).await;
        }
        Some(Command::Status) | None => Request::Status,
        Some(Command::Invite { route }) => Request::Invite {
            route: route.clone(),
        },
        Some(Command::Rename { route, label }) => Request::Rename {
            route: route.clone(),
            label: label.clone(),
        },
        Some(Command::Revoke { route }) => Request::Revoke {
            route: route.clone(),
        },
        Some(
            Command::BootstrapInfo
            | Command::BuildInfo
            | Command::UpdateRun { .. }
            | Command::Update { .. }
            | Command::Serve,
        ) => return Ok(ExitCode::SUCCESS),
    };
    write_frame(&mut socket, &request).await?;
    let reply = tokio::time::timeout(Duration::from_secs(5), read_frame(&mut socket)).await??;
    if cli.command.is_none() && interactive && !cli.json {
        return presentation::dashboard(&target.state, reply, cli.address.as_deref()).await;
    }
    presentation::reply(reply, cli.json).map(|()| ExitCode::SUCCESS)
}

async fn run_server(cli: &Cli) -> Result<()> {
    let root = cli
        .state
        .clone()
        .unwrap_or_else(discovery::default_state_path);
    let registry = Registry::open(&root)?;
    if cli.group_admin {
        // Group members can traverse only the root to reach control.sock.
        // Credential directories and files remain 0700/0600.
        std::fs::set_permissions(&root, std::fs::Permissions::from_mode(0o710))?;
    }
    let identity = RelayTlsIdentity::load_or_create(&root)?;
    let relay = Relay::new(registry.clone()).with_updater(
        codewide_relay::update::RelayUpdater::new(&root, identity.pin()),
    );
    let port = cli.port.unwrap_or(8780);
    let listener = public_listener(port)?;
    let control = ControlServer::bind(
        &root,
        registry,
        relay.clone(),
        port,
        identity.pin(),
        cli.group_admin,
    )?;
    if cli.json {
        println!(
            "{}",
            serde_json::json!({"event":"listening", "address": listener.local_addr()?.to_string()})
        );
    } else {
        eprintln!("CodeWide Relay · listening on {}", listener.local_addr()?);
    }
    let stop = CancellationToken::new();
    let signal = stop.clone();
    let signal_task = tokio::spawn(async move {
        let _ = shutdown_signal().await;
        signal.cancel();
    });
    let result = tokio::try_join!(
        serve(relay, listener, identity.server_config()?, stop.clone()),
        control.run(stop)
    );
    signal_task.abort();
    result.map(|_| ())
}

fn public_listener(port: u16) -> std::io::Result<TcpListener> {
    dual_stack_listener(port).or_else(|_| ipv4_listener(port))
}

fn dual_stack_listener(port: u16) -> std::io::Result<TcpListener> {
    let ipv6 = Socket::new(Domain::IPV6, Type::STREAM, None)?;
    ipv6.set_only_v6(false)?;
    ipv6.set_reuse_address(true)?;
    ipv6.bind(&std::net::SocketAddr::from((std::net::Ipv6Addr::UNSPECIFIED, port)).into())?;
    ipv6.listen(1024)?;
    ipv6.set_nonblocking(true)?;
    TcpListener::from_std(ipv6.into())
}

fn ipv4_listener(port: u16) -> std::io::Result<TcpListener> {
    let ipv4 = Socket::new(Domain::IPV4, Type::STREAM, None)?;
    ipv4.set_reuse_address(true)?;
    ipv4.bind(&std::net::SocketAddr::from((std::net::Ipv4Addr::UNSPECIFIED, port)).into())?;
    ipv4.listen(1024)?;
    ipv4.set_nonblocking(true)?;
    TcpListener::from_std(ipv4.into())
}

async fn shutdown_signal() -> std::io::Result<()> {
    let mut terminate = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())?;
    tokio::select! {
        result = tokio::signal::ctrl_c() => result,
        _ = terminate.recv() => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::{BuildInfo, public_listener};
    use socket2::SockRef;
    #[cfg(target_os = "linux")]
    use std::net::Ipv4Addr;
    #[cfg(target_os = "linux")]
    use tokio::{io::AsyncReadExt, net::TcpStream};

    #[test]
    fn build_info_keeps_the_installer_field_order() -> Result<(), serde_json::Error> {
        let line = serde_json::to_string(&BuildInfo::current())?;
        let prefix = format!(
            r#"{{"schemaVersion":1,"version":"{}","build":""#,
            env!("CODEWIDE_RELAY_VERSION")
        );
        assert!(line.starts_with(&prefix), "{line}");
        assert!(line.contains(r#"","sourceRevision":""#));
        Ok(())
    }

    #[tokio::test]
    async fn public_listener_keeps_the_restart_port_reusable() -> std::io::Result<()> {
        let listener = public_listener(0)?;

        assert!(SockRef::from(&listener).reuse_address()?);
        Ok(())
    }

    #[cfg(target_os = "linux")]
    #[tokio::test]
    async fn public_listener_rebinds_after_an_active_connection() -> std::io::Result<()> {
        let previous = tokio::net::TcpListener::bind((Ipv4Addr::UNSPECIFIED, 0)).await?;
        let port = previous.local_addr()?.port();
        let mut client = TcpStream::connect((Ipv4Addr::LOCALHOST, port)).await?;
        let (server, _) = previous.accept().await?;

        drop(server);
        let mut end = [0_u8; 1];
        assert_eq!(client.read(&mut end).await?, 0);
        drop(client);
        drop(previous);

        let replacement = public_listener(port)?;
        assert_eq!(replacement.local_addr()?.port(), port);
        Ok(())
    }
}
