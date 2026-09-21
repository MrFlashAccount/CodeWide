use clap::{Parser, Subcommand};
use codewide_relay::{
    Result,
    pairing::InvitationBundle,
    registry::Registry,
    server::{Relay, run},
    transport_tls::RelayTlsIdentity,
};
use std::{net::SocketAddr, path::PathBuf};
use tokio_util::sync::CancellationToken;

#[derive(Parser)]
#[command(name = "codewide-relay", version)]
struct Cli {
    #[arg(long, default_value_t = 8780)]
    port: u16,
    #[arg(long, global = true)]
    state: Option<PathBuf>,
    #[command(subcommand)]
    command: Option<Command>,
}

#[derive(Subcommand)]
enum Command {
    Invite {
        #[arg(long)]
        route: Option<String>,
    },
    Revoke {
        #[arg(long)]
        route: String,
    },
    Status,
}

#[tokio::main]
async fn main() -> Result<()> {
    let cli = Cli::parse();
    match cli.command {
        None => serve(cli.port, cli.state).await,
        Some(Command::Invite { route }) => {
            let state = cli.state.unwrap_or_else(default_state_path);
            let invitation = Registry::open(&state)?.create_invitation(route.as_deref())?;
            let identity = RelayTlsIdentity::load_or_create(&state)?;
            println!(
                "{}",
                serde_json::to_string(&InvitationBundle {
                    version: 4,
                    relay_tls_pin_sha256: identity.pin(),
                    route_id: invitation.route_id,
                    invitation: invitation.token,
                })?
            );
            eprintln!("relay invitation expires_at={}", invitation.expires_at);
            Ok(())
        }
        Some(Command::Revoke { route }) => {
            println!("revoked={}", registry(cli.state)?.revoke(&route)?);
            Ok(())
        }
        Some(Command::Status) => {
            for route in registry(cli.state)?.routes()? {
                println!("route={route}");
            }
            Ok(())
        }
    }
}

async fn serve(port: u16, state: Option<PathBuf>) -> Result<()> {
    let listen = SocketAddr::from(([0, 0, 0, 0], port));
    let state = state.unwrap_or_else(default_state_path);
    let registry = Registry::open(&state)?;
    let identity = RelayTlsIdentity::load_or_create(&state)?;
    eprintln!("relay listener={listen}");
    let stop = CancellationToken::new();
    let signal = stop.clone();
    tokio::spawn(async move {
        let _ = shutdown_signal().await;
        signal.cancel();
    });
    run(
        Relay::new(registry),
        listen,
        identity.server_config()?,
        stop,
    )
    .await
}

fn registry(state: Option<PathBuf>) -> Result<Registry> {
    Registry::open(&state.unwrap_or_else(default_state_path))
}

fn default_state_path() -> PathBuf {
    std::env::var_os("XDG_STATE_HOME")
        .map_or_else(
            || {
                std::env::var_os("HOME").map_or_else(
                    || PathBuf::from(".local/state"),
                    |home| PathBuf::from(home).join(".local/state"),
                )
            },
            PathBuf::from,
        )
        .join("codewide/relay")
}

#[cfg(unix)]
async fn shutdown_signal() -> std::io::Result<()> {
    let mut terminate = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())?;
    tokio::select! {
        result = tokio::signal::ctrl_c() => result,
        _ = terminate.recv() => Ok(()),
    }
}

#[cfg(not(unix))]
async fn shutdown_signal() -> std::io::Result<()> {
    tokio::signal::ctrl_c().await
}
