//! Stable out-of-process Linux Companion update and rollback guardian.

use std::path::PathBuf;

use clap::Parser;
use tracing_subscriber::EnvFilter;

#[derive(Debug, Parser)]
#[command(name = "codewide-companion-update-guardian")]
struct Cli {
    #[arg(long)]
    install_root: Option<PathBuf>,
    #[arg(long)]
    state_root: Option<PathBuf>,
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env())
        .with_target(false)
        .compact()
        .init();
    let cli = Cli::parse();
    tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .worker_threads(2)
        .thread_name("codewide-update")
        .build()?
        .block_on(codewide_companion::host_update::run_pending(
            cli.install_root.unwrap_or_else(
                codewide_companion::host_update::LinuxHostUpdateGuardian::default_root,
            ),
            cli.state_root.unwrap_or_else(
                codewide_companion::host_update::LinuxHostUpdateGuardian::default_state_root,
            ),
        ))
}
