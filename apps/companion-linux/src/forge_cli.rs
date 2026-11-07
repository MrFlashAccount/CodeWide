//! `codewide-companion forge …`: the provider rollback switch (through the
//! running companion's control socket, which owns the state database),
//! external plugin registration in `forge-plugins.json`, and the plugin
//! conformance check.

use std::path::PathBuf;

use clap::{Args, Subcommand};
use codewide_companion::forge::registry::{ExternalPlugin, PluginRegistry};
use forge_protocol::{
    ForgeAccountRef, ForgePrRef,
    conformance::{self, Fixtures},
};

use super::{ControlOptions, control_request};

#[derive(Debug, Args)]
pub struct ForgeOptions {
    #[command(subcommand)]
    command: ForgeCommand,
}

#[derive(Debug, Subcommand)]
enum ForgeCommand {
    /// Built-in and external providers of the running companion.
    Provider(ProviderOptions),
    /// External forge plugins (`forge-plugins.json`) and conformance.
    Plugin(PluginOptions),
}

#[derive(Debug, Args)]
struct ProviderOptions {
    #[command(subcommand)]
    command: ProviderCommand,
}

#[derive(Debug, Subcommand)]
enum ProviderCommand {
    /// Prints every provider with its enable flag, as JSON.
    List {
        #[command(flatten)]
        control: ControlOptions,
    },
    /// Re-enables a provider; its accounts were kept.
    Enable {
        id: String,
        #[command(flatten)]
        control: ControlOptions,
    },
    /// Disables a provider (the rollback switch); accounts and secrets stay.
    Disable {
        id: String,
        #[command(flatten)]
        control: ControlOptions,
    },
}

#[derive(Debug, Args)]
struct PluginOptions {
    #[command(subcommand)]
    command: PluginCommand,
}

#[derive(Debug, Subcommand)]
enum PluginCommand {
    List {
        #[arg(long)]
        registry: Option<PathBuf>,
    },
    /// Registers an external plugin by its absolute executable path.
    Install {
        #[arg(long)]
        id: String,
        #[arg(long)]
        executable: PathBuf,
        #[arg(long = "arg")]
        args: Vec<String>,
        #[arg(long, default_value_t = 50)]
        priority: i32,
        #[arg(long)]
        registry: Option<PathBuf>,
    },
    Remove {
        id: String,
        #[arg(long)]
        registry: Option<PathBuf>,
    },
    /// Runs the conformance harness against a plugin executable.
    Check {
        executable: PathBuf,
        #[arg(long = "arg")]
        args: Vec<String>,
        /// A linked account as `host/login`.
        #[arg(long)]
        account: Option<String>,
        /// A pull request as `host/owner/repo/number` (or the plugin's own
        /// repository path with the number last).
        #[arg(long)]
        pull_request: Option<String>,
        /// A remote URL the plugin must resolve.
        #[arg(long)]
        remote: Option<String>,
        /// Also probe write methods at a deliberately stale head; a
        /// conformant plugin refuses them and writes nothing.
        #[arg(long, default_value_t = false)]
        write_probes: bool,
    },
}

/// Runs one `forge` subcommand.
///
/// # Errors
///
/// Returns the control-socket, registry or argument failure; a failed
/// conformance check is an error after its report is printed.
pub async fn run(options: ForgeOptions) -> Result<(), Box<dyn std::error::Error>> {
    match options.command {
        ForgeCommand::Provider(options) => provider(options.command).await,
        ForgeCommand::Plugin(options) => plugin(options.command).await,
    }
}

async fn provider(command: ProviderCommand) -> Result<(), Box<dyn std::error::Error>> {
    let (path, body, control, method) = match command {
        ProviderCommand::List { control } => (
            "/v1/forge/providers".to_owned(),
            None,
            control,
            reqwest::Method::GET,
        ),
        ProviderCommand::Enable { id, control } => (
            format!("/v1/forge/providers/{id}"),
            Some(r#"{"enabled":true}"#),
            control,
            reqwest::Method::PATCH,
        ),
        ProviderCommand::Disable { id, control } => (
            format!("/v1/forge/providers/{id}"),
            Some(r#"{"enabled":false}"#),
            control,
            reqwest::Method::PATCH,
        ),
    };
    println!("{}", control_request(method, &path, body, control).await?);
    Ok(())
}

async fn plugin(command: PluginCommand) -> Result<(), Box<dyn std::error::Error>> {
    match command {
        PluginCommand::List { registry } => {
            let registry = PluginRegistry::new(registry.unwrap_or_else(default_registry));
            println!("{}", serde_json::to_string(&registry.list()?)?);
        }
        PluginCommand::Install {
            id,
            executable,
            args,
            priority,
            registry,
        } => {
            let registry = PluginRegistry::new(registry.unwrap_or_else(default_registry));
            registry.install(ExternalPlugin {
                id,
                executable,
                args,
                priority,
            })?;
            println!(
                "{}",
                serde_json::json!({ "installed": true, "registry": registry.path() })
            );
        }
        PluginCommand::Remove { id, registry } => {
            let registry = PluginRegistry::new(registry.unwrap_or_else(default_registry));
            println!(
                "{}",
                serde_json::json!({ "removed": registry.remove(&id)?, "registry": registry.path() })
            );
        }
        PluginCommand::Check {
            executable,
            args,
            account,
            pull_request,
            remote,
            write_probes,
        } => {
            let fixtures = Fixtures {
                account: account.as_deref().map(parse_account).transpose()?,
                pull_request: pull_request
                    .as_deref()
                    .map(parse_pull_request)
                    .transpose()?,
                remote,
                write_probes,
            };
            let report = conformance::run(&executable, &args, &fixtures).await;
            println!("{}", serde_json::to_string_pretty(&report)?);
            if !report.passed() {
                return Err("the plugin does not conform".into());
            }
        }
    }
    Ok(())
}

fn parse_account(value: &str) -> Result<ForgeAccountRef, Box<dyn std::error::Error>> {
    let (host, login) = value
        .split_once('/')
        .filter(|(host, login)| !host.is_empty() && !login.is_empty())
        .ok_or("--account must be host/login")?;
    Ok(ForgeAccountRef {
        host: host.to_owned(),
        login: login.to_owned(),
    })
}

fn parse_pull_request(value: &str) -> Result<ForgePrRef, Box<dyn std::error::Error>> {
    let (host, rest) = value
        .split_once('/')
        .ok_or("--pull-request must be host/repository/number")?;
    let (repository, number) = rest
        .rsplit_once('/')
        .filter(|(repository, number)| !repository.is_empty() && !number.is_empty())
        .ok_or("--pull-request must be host/repository/number")?;
    Ok(ForgePrRef {
        host: host.to_owned(),
        repository: repository.to_owned(),
        number: number.to_owned(),
    })
}

fn default_registry() -> PathBuf {
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
        .join("codewide/companion/forge-plugins.json")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_fixture_references() {
        let account = parse_account("github.com/octocat").unwrap_or_else(|_| ForgeAccountRef {
            host: String::new(),
            login: String::new(),
        });
        assert_eq!(account.login, "octocat");
        let pull_request = parse_pull_request("github.com/octo/repo/12").ok();
        assert_eq!(
            pull_request.map(|pr| (pr.repository, pr.number)),
            Some(("octo/repo".to_owned(), "12".to_owned()))
        );
        assert!(parse_account("nologin").is_err());
    }
}
