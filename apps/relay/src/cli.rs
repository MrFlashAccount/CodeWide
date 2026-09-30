//! Terminal workflow; network and state authority remain in the daemon.
mod discovery;
mod presentation;

use clap::{Parser, Subcommand, ValueEnum};
use codewide_relay::{
    Result,
    admin::{ControlServer, Reply, Request, SOCKET, read_frame, write_frame},
    registry::Registry,
    server::{Relay, serve},
    transport_tls::RelayTlsIdentity,
};
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
#[command(name = "codewide-relay", version = env!("CODEWIDE_RELAY_VERSION"), about = "Connect your computers through an encrypted Relay", after_help = "Quick start:\n  codewide-relay           Open the Relay menu\n  codewide-relay pair      Connect a computer in 60 seconds\n  codewide-relay status    Show paired computers\n  codewide-relay serve     Run the server in the foreground\n\nWithout a terminal, the default command shows status. Existing noninteractive service commands with --port continue to start the server.")]
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
    if matches!(cli.command, Some(Command::Pair)) && (cli.json || !interactive) {
        return Err("pair needs an interactive terminal to confirm the matching symbols. For scripts or older clients, use invite.".into());
    }
    let target = discovery::target(cli.state.as_deref())?;
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
            let endpoint = discovery::public_address(cli.address.as_deref(), port).await?;
            socket = UnixStream::connect(target.state.join(SOCKET)).await?;
            return presentation::pair(socket, &endpoint).await;
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
        Some(Command::Serve) => return Ok(ExitCode::SUCCESS),
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
    let relay = Relay::new(registry.clone());
    let port = cli.port.unwrap_or(8780);
    let listener = TcpListener::bind((std::net::Ipv4Addr::UNSPECIFIED, port)).await?;
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

async fn shutdown_signal() -> std::io::Result<()> {
    let mut terminate = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())?;
    tokio::select! {
        result = tokio::signal::ctrl_c() => result,
        _ = terminate.recv() => Ok(()),
    }
}
