use std::{
    collections::{HashMap, HashSet},
    io::{IsTerminal, Write},
    net::SocketAddr,
    os::unix::fs::{OpenOptionsExt, PermissionsExt},
    path::{Path, PathBuf},
    sync::Arc,
};

use base64::{Engine as _, engine::general_purpose};
use clap::{Args, Parser, Subcommand, ValueEnum};
use codewide_companion::{
    account_pool::AccountPoolService,
    auth::DeviceRegistry,
    build_shelf::BuildShelfProxy,
    catalog::SessionCatalog,
    content::{ContentProjector, PrivateContentService},
    dictation::DictationService,
    files::FileService,
    history::digest_turn,
    history_service::HistoryService,
    identity::{CompanionIdentity, rotate as rotate_identity},
    media::MediaProxyService,
    pairing_qr,
    resources::ResourceService,
    rollout::{
        TurnRefReport, index_rollout_fully, read_rollout_metadata, rollout_file_id, scan_tail_turns,
    },
    server,
    state_migration::{StateMigrationPaths, migrate_legacy_installation},
    store::{IndexStore, TurnRef},
    sync::SyncHub,
    sync_v2::{ProductionServices, SyncV2Mode, SyncV2Runtime, UpstreamSemanticSource},
    telemetry::TelemetryStore,
    terminal,
    tunnels::LocalhostTunnelService,
    upstream::UpstreamHandle,
    vcs::{PluginRegistry, VcsPluginConfig, VcsScope, VcsService},
};
use rand::{TryRngCore, rngs::OsRng};
use tokio::net::TcpListener;
use tokio::runtime::Builder as RuntimeBuilder;
use tracing::info;
use tracing_subscriber::EnvFilter;

mod local_control;

fn parse_vcs_scope(value: &str) -> Result<VcsScope, Box<dyn std::error::Error>> {
    Ok(serde_json::from_value(serde_json::Value::String(
        value.to_owned(),
    ))?)
}

#[derive(Debug, Parser)]
#[command(name = "codewide-companion")]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Debug, Subcommand)]
enum Command {
    MigrateState,
    CreateToken {
        #[arg(long)]
        token_file: Option<PathBuf>,
    },
    Serve {
        #[arg(long, default_value = "127.0.0.1:8766")]
        listen: SocketAddr,
        #[arg(long)]
        control_endpoint: Option<PathBuf>,
        #[arg(long)]
        state: PathBuf,
        #[arg(long)]
        token_file: PathBuf,
        #[arg(long)]
        app_server_socket: PathBuf,
        #[arg(long)]
        codex_home: Option<PathBuf>,
        #[arg(long)]
        device_registry: PathBuf,
        #[arg(long)]
        data_dir: Option<PathBuf>,
        #[arg(long)]
        identity_dir: Option<PathBuf>,
        /// Deprecated compatibility flag. The public carrier is always HTTP;
        /// private application traffic is protected by the inner TLS listener.
        #[arg(long, default_value_t = false, hide = true)]
        insecure_http: bool,
        #[arg(long, default_value_t = false)]
        enable_mutations: bool,
        #[arg(long, value_enum, default_value_t = SyncV2Mode::Canary)]
        sync_v2_mode: SyncV2Mode,
    },
    Identity {
        #[arg(long)]
        identity_dir: Option<PathBuf>,
    },
    RotateIdentity {
        #[arg(long)]
        identity_dir: Option<PathBuf>,
        #[arg(long, default_value_t = false)]
        confirm_device_repair: bool,
    },
    Index {
        #[arg(long)]
        state: PathBuf,
        #[arg(long)]
        rollout: PathBuf,
    },
    Tail {
        #[arg(long)]
        rollout: PathBuf,
        #[arg(long, default_value_t = 12)]
        limit: usize,
        #[arg(long)]
        before_offset: Option<u64>,
    },
    Page {
        #[arg(long)]
        state: PathBuf,
        #[arg(long)]
        rollout: PathBuf,
        #[arg(long, default_value_t = 12)]
        limit: usize,
        #[arg(long)]
        before_offset: Option<u64>,
    },
    Digest {
        #[arg(long)]
        rollout: PathBuf,
        #[arg(long)]
        turn_id: String,
        #[arg(long)]
        start_offset: u64,
        #[arg(long)]
        end_offset: u64,
    },
    DigestPage {
        #[arg(long)]
        rollout: PathBuf,
        #[arg(long, default_value_t = 12)]
        limit: usize,
        #[arg(long)]
        before_offset: Option<u64>,
    },
    Pair {
        #[command(flatten)]
        control: ControlOptions,
        #[arg(long, default_value_t = false)]
        json: bool,
        #[arg(long, value_enum, default_value = "auto")]
        qr: PairingQrMode,
        #[arg(long, conflicts_with = "json")]
        qr_output: Option<PathBuf>,
    },
    Devices {
        #[command(flatten)]
        control: ControlOptions,
    },
    Revoke {
        device_id: String,
        #[command(flatten)]
        control: ControlOptions,
    },
    Scopes {
        device_id: String,
        scopes: String,
        #[command(flatten)]
        control: ControlOptions,
    },
    Telemetry(Box<TelemetryOptions>),
    Vcs(VcsOptions),
}

#[derive(Debug, Args)]
struct TelemetryOptions {
    #[command(subcommand)]
    command: TelemetryCommand,
}

#[derive(Debug, Subcommand)]
enum TelemetryCommand {
    Query {
        #[command(flatten)]
        control: ControlOptions,
        #[arg(long)]
        from_unix_ms: Option<u64>,
        #[arg(long)]
        to_unix_ms: Option<u64>,
        #[arg(long)]
        device_id: Option<String>,
        #[arg(long)]
        batch_id: Option<String>,
        #[arg(long)]
        client_session_id: Option<String>,
        #[arg(long)]
        event_id: Option<String>,
        #[arg(long)]
        session_id: Option<String>,
        #[arg(long)]
        request_id: Option<String>,
        #[arg(long)]
        connection_id: Option<String>,
        #[arg(long)]
        thread_id: Option<String>,
        #[arg(long)]
        turn_id: Option<String>,
        #[arg(long)]
        item_id: Option<String>,
        #[arg(long)]
        name: Option<String>,
        #[arg(long, requires = "tag_value")]
        tag_name: Option<String>,
        #[arg(long, requires = "tag_name")]
        tag_value: Option<String>,
        #[arg(long, default_value_t = 500)]
        limit: usize,
        #[arg(long, default_value_t = false)]
        descending: bool,
    },
}

#[derive(Debug, Args)]
struct VcsOptions {
    #[command(subcommand)]
    command: VcsCommand,
}

#[derive(Debug, Subcommand)]
enum VcsCommand {
    Changes {
        workspace: PathBuf,
        #[arg(long, default_value = "branch")]
        scope: String,
        #[arg(long)]
        registry: Option<PathBuf>,
    },
    Diff {
        workspace: PathBuf,
        path: PathBuf,
        #[arg(long, default_value = "branch")]
        scope: String,
        #[arg(long)]
        registry: Option<PathBuf>,
    },
    Plugin(VcsPluginOptions),
}

#[derive(Debug, Args)]
struct VcsPluginOptions {
    #[command(subcommand)]
    command: VcsPluginCommand,
}

#[derive(Debug, Subcommand)]
enum VcsPluginCommand {
    List {
        #[arg(long)]
        registry: Option<PathBuf>,
    },
    Install {
        #[arg(long)]
        id: String,
        #[arg(long)]
        executable: PathBuf,
        #[arg(long = "arg")]
        args: Vec<String>,
        #[arg(long, default_value_t = 100)]
        priority: i32,
        #[arg(long, default_value_t = true)]
        enabled: bool,
        #[arg(long)]
        registry: Option<PathBuf>,
    },
    Remove {
        id: String,
        #[arg(long)]
        registry: Option<PathBuf>,
    },
}

#[derive(Clone, Copy, Debug, ValueEnum)]
enum PairingQrMode {
    Auto,
    Unicode,
    Ansi,
    Svg,
}

#[derive(Debug, Args)]
struct ControlOptions {
    #[arg(long)]
    control_endpoint: Option<PathBuf>,
    #[arg(long)]
    token_file: Option<PathBuf>,
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env())
        .with_target(false)
        .compact()
        .init();

    let worker_threads = std::thread::available_parallelism()
        .map_or(4, usize::from)
        .clamp(2, 8);
    RuntimeBuilder::new_multi_thread()
        .enable_all()
        .worker_threads(worker_threads)
        .max_blocking_threads(32)
        .thread_name("codewide")
        .build()?
        .block_on(run())
}

#[allow(clippy::too_many_lines)]
async fn run() -> Result<(), Box<dyn std::error::Error>> {
    match Cli::parse().command {
        Command::MigrateState => {
            let report = migrate_legacy_installation(&default_state_migration_paths())?;
            println!("{}", serde_json::to_string(&report)?);
        }
        Command::CreateToken { token_file } => {
            let token_file = token_file.unwrap_or_else(default_administrator_token_file);
            create_administrator_token(&token_file)?;
            println!(
                "{}",
                serde_json::json!({ "created": true, "tokenPath": token_file })
            );
        }
        Command::Serve {
            listen,
            control_endpoint,
            state,
            token_file,
            app_server_socket,
            codex_home,
            device_registry,
            data_dir,
            identity_dir,
            insecure_http,
            enable_mutations,
            sync_v2_mode,
        } => {
            serve(ServeOptions {
                listen,
                control_endpoint: control_endpoint.unwrap_or_else(default_control_endpoint),
                state_path: state,
                token_file,
                app_server_socket,
                codex_home,
                device_registry,
                data_dir,
                identity_dir,
                insecure_http,
                enable_mutations,
                sync_v2_mode,
            })
            .await?;
        }
        Command::Identity { identity_dir } => {
            let identity = CompanionIdentity::load_or_create(
                &identity_dir.unwrap_or_else(default_identity_directory),
            )?;
            println!("{}", serde_json::to_string(identity.public())?);
        }
        Command::RotateIdentity {
            identity_dir,
            confirm_device_repair,
        } => {
            if !confirm_device_repair {
                return Err(
                    "identity rotation requires --confirm-device-repair; every device must scan a fresh pairing QR"
                        .into(),
                );
            }
            let identity =
                rotate_identity(&identity_dir.unwrap_or_else(default_identity_directory))?;
            println!("{}", serde_json::to_string(identity.public())?);
        }
        Command::Index { state, rollout } => {
            let store = IndexStore::open(state)?;
            let report = index_rollout_fully(&store, &rollout)?;
            println!("{}", serde_json::to_string(&report)?);
        }
        Command::Tail {
            rollout,
            limit,
            before_offset,
        } => {
            let report = scan_tail_turns(&rollout, before_offset, limit)?;
            println!("{}", serde_json::to_string(&report)?);
        }
        Command::Page {
            state,
            rollout,
            limit,
            before_offset,
        } => {
            let store = IndexStore::open(state)?;
            let file_id = rollout_file_id(&rollout);
            let turns: Vec<TurnRefReport> = store
                .turns_desc(&file_id, before_offset, limit)?
                .into_iter()
                .map(Into::into)
                .collect();
            println!("{}", serde_json::to_string(&turns)?);
        }
        Command::Digest {
            rollout,
            turn_id,
            start_offset,
            end_offset,
        } => {
            let digest = digest_turn(
                &rollout,
                &TurnRef {
                    id: turn_id,
                    start_offset,
                    end_offset,
                    completed: false,
                },
            )?;
            println!("{}", serde_json::to_string(&digest)?);
        }
        Command::DigestPage {
            rollout,
            limit,
            before_offset,
        } => {
            let page = scan_tail_turns(&rollout, before_offset, limit)?;
            let mut digests = Vec::with_capacity(page.turns.len());
            for turn in page.turns {
                digests.push(digest_turn(
                    &rollout,
                    &TurnRef {
                        id: turn.id,
                        start_offset: turn.start_offset,
                        end_offset: turn.end_offset,
                        completed: turn.completed,
                    },
                )?);
            }
            println!("{}", serde_json::to_string(&digests)?);
        }
        Command::Pair {
            control,
            json,
            qr,
            qr_output,
        } => {
            let body =
                control_request(reqwest::Method::POST, "/v1/pairing/start", None, control).await?;
            print_pairing(&body, json, qr, qr_output.as_deref())?;
        }
        Command::Devices { control } => {
            let body = control_request(reqwest::Method::GET, "/v1/devices", None, control).await?;
            println!("{body}");
        }
        Command::Revoke { device_id, control } => {
            let path = format!(
                "/v1/devices/{}",
                percent_encoding::utf8_percent_encode(
                    &device_id,
                    percent_encoding::NON_ALPHANUMERIC
                )
            );
            let body = control_request(reqwest::Method::DELETE, &path, None, control).await?;
            println!("{body}");
        }
        Command::Scopes {
            device_id,
            scopes,
            control,
        } => {
            let scopes = scopes
                .split(',')
                .map(str::trim)
                .filter(|scope| !scope.is_empty())
                .collect::<Vec<_>>();
            if scopes.is_empty() {
                return Err("comma-separated scopes are required".into());
            }
            let path = format!(
                "/v1/devices/{}",
                percent_encoding::utf8_percent_encode(
                    &device_id,
                    percent_encoding::NON_ALPHANUMERIC
                )
            );
            let payload = serde_json::to_string(&serde_json::json!({ "scopes": scopes }))?;
            let body =
                control_request(reqwest::Method::PATCH, &path, Some(&payload), control).await?;
            println!("{body}");
        }
        Command::Telemetry(options) => match options.command {
            TelemetryCommand::Query {
                control,
                from_unix_ms,
                to_unix_ms,
                device_id,
                batch_id,
                client_session_id,
                event_id,
                session_id,
                request_id,
                connection_id,
                thread_id,
                turn_id,
                item_id,
                name,
                tag_name,
                tag_value,
                limit,
                descending,
            } => {
                let mut query = url::form_urlencoded::Serializer::new(String::new());
                if let Some(value) = from_unix_ms {
                    query.append_pair("fromUnixMs", &value.to_string());
                }
                if let Some(value) = to_unix_ms {
                    query.append_pair("toUnixMs", &value.to_string());
                }
                for (key, value) in [
                    ("deviceId", device_id),
                    ("batchId", batch_id),
                    ("clientSessionId", client_session_id),
                    ("eventId", event_id),
                    ("sessionId", session_id),
                    ("requestId", request_id),
                    ("connectionId", connection_id),
                    ("threadId", thread_id),
                    ("turnId", turn_id),
                    ("itemId", item_id),
                    ("name", name),
                    ("tagName", tag_name),
                    ("tagValue", tag_value),
                ] {
                    if let Some(value) = value {
                        query.append_pair(key, &value);
                    }
                }
                query.append_pair("limit", &limit.to_string());
                query.append_pair("descending", if descending { "true" } else { "false" });
                let path = format!("/v1/telemetry/events?{}", query.finish());
                let body = control_request(reqwest::Method::GET, &path, None, control).await?;
                println!("{body}");
            }
        },
        Command::Vcs(options) => match options.command {
            VcsCommand::Changes {
                workspace,
                scope,
                registry,
            } => {
                let service = VcsService::new(registry.unwrap_or_else(default_vcs_registry));
                let scope = parse_vcs_scope(&scope)?;
                let snapshot = service.changes(&workspace, scope).await?;
                println!("{}", serde_json::to_string(&snapshot)?);
            }
            VcsCommand::Diff {
                workspace,
                path,
                scope,
                registry,
            } => {
                let service = VcsService::new(registry.unwrap_or_else(default_vcs_registry));
                let scope = parse_vcs_scope(&scope)?;
                let diff = service.diff(&workspace, &path, scope).await?;
                println!("{}", serde_json::to_string(&diff)?);
            }
            VcsCommand::Plugin(options) => match options.command {
                VcsPluginCommand::List { registry } => {
                    let registry =
                        PluginRegistry::new(registry.unwrap_or_else(default_vcs_registry));
                    println!("{}", serde_json::to_string(&registry.list()?)?);
                }
                VcsPluginCommand::Install {
                    id,
                    executable,
                    args,
                    priority,
                    enabled,
                    registry,
                } => {
                    let registry =
                        PluginRegistry::new(registry.unwrap_or_else(default_vcs_registry));
                    registry.install(VcsPluginConfig {
                        id,
                        executable,
                        args,
                        enabled,
                        priority,
                    })?;
                    println!(
                        "{}",
                        serde_json::json!({ "installed": true, "registry": registry.path() })
                    );
                }
                VcsPluginCommand::Remove { id, registry } => {
                    let registry =
                        PluginRegistry::new(registry.unwrap_or_else(default_vcs_registry));
                    println!(
                        "{}",
                        serde_json::json!({
                            "removed": registry.remove(&id)?,
                            "id": id,
                            "registry": registry.path()
                        })
                    );
                }
            },
        },
    }
    Ok(())
}

async fn control_request(
    method: reqwest::Method,
    path: &str,
    body: Option<&str>,
    options: ControlOptions,
) -> Result<String, Box<dyn std::error::Error>> {
    let endpoint = options
        .control_endpoint
        .unwrap_or_else(default_control_endpoint);
    let token_file = options
        .token_file
        .unwrap_or_else(default_administrator_token_file);
    let token = read_administrator_token(&token_file).await?;
    let (status, response_body) =
        local_control::request(&endpoint, method, path, &token, body).await?;
    if !status.is_success() {
        return Err(format!(
            "companion returned {}: {}",
            status.as_u16(),
            response_body.trim()
        )
        .into());
    }
    Ok(response_body)
}

fn print_pairing(
    body: &str,
    json_only: bool,
    qr_mode: PairingQrMode,
    qr_output: Option<&Path>,
) -> Result<(), Box<dyn std::error::Error>> {
    let pairing = serde_json::from_str::<serde_json::Value>(body)?;
    let Some(endpoint) = std::env::var_os("CODEWIDE_PUBLIC_ENDPOINT") else {
        println!("{pairing}");
        if !json_only {
            eprintln!("Set CODEWIDE_PUBLIC_ENDPOINT to print a connection link and QR code.");
        }
        return Ok(());
    };
    let endpoint = validate_public_endpoint(&endpoint.to_string_lossy())?;
    let pairing_token = pairing
        .get("pairingToken")
        .and_then(serde_json::Value::as_str)
        .ok_or("pairing response has no token")?;
    let expires_at = pairing
        .get("expiresAt")
        .and_then(serde_json::Value::as_u64)
        .ok_or("pairing response has no expiry")?;
    let display_name =
        std::env::var("CODEWIDE_SERVER_NAME").unwrap_or_else(|_| "CodeWide host".to_owned());
    let emoji = std::env::var("CODEWIDE_SERVER_EMOJI").unwrap_or_else(|_| "🖥️".to_owned());
    let (pin, identity_expires_at) = pairing_transport_identity(&pairing, &endpoint)?;
    let mut link = url::Url::parse("codewide://pair")?;
    {
        let mut query = link.query_pairs_mut();
        query
            .append_pair("v", "1")
            .append_pair("e", endpoint.as_str())
            .append_pair("t", pairing_token)
            .append_pair("x", &expires_at.to_string())
            .append_pair("n", &display_name)
            .append_pair("i", &emoji);
        query.append_pair("p", &pin);
        if let Some(expires_at) = identity_expires_at {
            query.append_pair("y", &expires_at.to_string());
        }
    }
    let mut payload = serde_json::json!({
        "type": "codewide-pairing",
        "version": 1,
        "endpoint": endpoint.as_str(),
        "pairingToken": pairing_token,
        "expiresAt": expires_at,
        "displayName": display_name,
        "emoji": emoji,
    });
    payload
        .as_object_mut()
        .ok_or("invalid pairing payload")?
        .insert("tlsPinSha256".into(), serde_json::Value::String(pin));
    if let Some(expires_at) = identity_expires_at {
        payload
            .as_object_mut()
            .ok_or("invalid pairing payload")?
            .insert(
                "identityExpiresAt".into(),
                serde_json::Value::from(expires_at),
            );
    }
    let mut output = pairing
        .as_object()
        .cloned()
        .ok_or("invalid pairing response")?;
    output.insert(
        "endpoint".into(),
        serde_json::Value::String(endpoint.to_string()),
    );
    output.insert(
        "pairingPayload".into(),
        serde_json::Value::String(serde_json::to_string(&payload)?),
    );
    output.insert(
        "pairingLink".into(),
        serde_json::Value::String(link.to_string()),
    );
    println!("{}", serde_json::Value::Object(output));
    if !json_only {
        eprintln!("\nOpen on Android:\n{link}");
        print_pairing_qr(link.as_str(), qr_mode, qr_output)?;
    }
    Ok(())
}

fn valid_tls_pin(pin: &str) -> bool {
    pin.strip_prefix("sha256/")
        .and_then(|value| general_purpose::STANDARD.decode(value).ok())
        .is_some_and(|digest| digest.len() == 32)
}

fn pairing_transport_identity(
    pairing: &serde_json::Value,
    _endpoint: &url::Url,
) -> Result<(String, Option<u64>), Box<dyn std::error::Error>> {
    let pin = pairing
        .get("tlsPinSha256")
        .and_then(serde_json::Value::as_str)
        .ok_or("running companion returned no TLS identity pin")?
        .to_owned();
    let expires_at = pairing
        .get("identityExpiresAt")
        .and_then(serde_json::Value::as_u64);
    if !valid_tls_pin(&pin) {
        return Err("running companion returned an invalid TLS identity pin".into());
    }
    Ok((pin, expires_at))
}

fn print_pairing_qr(
    link: &str,
    requested_mode: PairingQrMode,
    qr_output: Option<&Path>,
) -> Result<(), Box<dyn std::error::Error>> {
    let mode = if matches!(requested_mode, PairingQrMode::Auto) {
        select_automatic_qr_mode(link, qr_output)?
    } else {
        requested_mode
    };
    match mode {
        PairingQrMode::Auto => unreachable!("automatic QR mode must be resolved"),
        PairingQrMode::Unicode => {
            print!("\n{}", pairing_qr::render_unicode(link)?);
            std::io::stdout().flush()?;
        }
        PairingQrMode::Ansi => {
            print!("\n{}", pairing_qr::render_ansi(link)?);
            std::io::stdout().flush()?;
        }
        PairingQrMode::Svg => {
            let path = write_pairing_svg(link, qr_output)?;
            eprintln!("\nQR code written to {}", path.display());
        }
    }
    Ok(())
}

fn select_automatic_qr_mode(
    link: &str,
    qr_output: Option<&Path>,
) -> Result<PairingQrMode, Box<dyn std::error::Error>> {
    if qr_output.is_some()
        || !std::io::stdout().is_terminal()
        || std::env::var("TERM").is_ok_and(|term| term.eq_ignore_ascii_case("dumb"))
    {
        return Ok(PairingQrMode::Svg);
    }
    let columns = terminal_columns();
    let unicode_width = pairing_qr::unicode_width(link)?;
    if terminal_has_utf8() && columns.is_none_or(|width| width >= unicode_width) {
        return Ok(PairingQrMode::Unicode);
    }
    let ansi_width = pairing_qr::ansi_width(link)?;
    if columns.is_none_or(|width| width >= ansi_width) {
        return Ok(PairingQrMode::Ansi);
    }
    Ok(PairingQrMode::Svg)
}

fn terminal_columns() -> Option<usize> {
    std::env::var("COLUMNS")
        .ok()
        .and_then(|value| value.parse().ok())
        .filter(|width| *width > 0)
}

fn terminal_has_utf8() -> bool {
    if cfg!(windows) {
        return true;
    }
    ["LC_ALL", "LC_CTYPE", "LANG"]
        .into_iter()
        .find_map(|name| std::env::var(name).ok().filter(|value| !value.is_empty()))
        .is_some_and(|locale| {
            let locale = locale.to_ascii_lowercase();
            locale.contains("utf-8") || locale.contains("utf8")
        })
}

fn write_pairing_svg(
    link: &str,
    requested_path: Option<&Path>,
) -> Result<PathBuf, Box<dyn std::error::Error>> {
    let path = if let Some(path) = requested_path {
        path.to_owned()
    } else {
        let mut random = [0_u8; 8];
        OsRng
            .try_fill_bytes(&mut random)
            .map_err(|_| "secure randomness unavailable")?;
        default_control_endpoint()
            .parent()
            .ok_or("control endpoint has no parent directory")?
            .join(format!("pairing-{}.svg", hex::encode(random)))
    };
    let parent = path
        .parent()
        .ok_or("QR output must have a parent directory")?;
    let parent_existed = parent.exists();
    std::fs::create_dir_all(parent)?;
    if !parent_existed {
        std::fs::set_permissions(parent, std::fs::Permissions::from_mode(0o700))?;
    }
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(&path)?;
    file.write_all(pairing_qr::render_svg(link)?.as_bytes())?;
    file.sync_all()?;
    Ok(path)
}

fn validate_public_endpoint(raw: &str) -> Result<url::Url, Box<dyn std::error::Error>> {
    let mut endpoint = url::Url::parse(raw)?;
    if endpoint.scheme() != "wss" && endpoint.scheme() != "ws" {
        return Err("pairing endpoint must use WebSocket".into());
    }
    let local = matches!(
        endpoint.host_str(),
        Some("localhost" | "127.0.0.1" | "::1" | "10.0.2.2")
    );
    if endpoint.scheme() == "ws" && !local {
        return Err("remote pairing endpoint must use WSS".into());
    }
    if endpoint.path().is_empty() || endpoint.path() == "/" {
        endpoint.set_path("/v1/sync");
    }
    if endpoint.path() != "/v1/sync"
        || !endpoint.username().is_empty()
        || endpoint.password().is_some()
        || endpoint.query().is_some()
        || endpoint.fragment().is_some()
    {
        return Err("invalid pairing endpoint shape".into());
    }
    Ok(endpoint)
}

struct ServeOptions {
    listen: SocketAddr,
    control_endpoint: PathBuf,
    state_path: PathBuf,
    token_file: PathBuf,
    app_server_socket: PathBuf,
    codex_home: Option<PathBuf>,
    device_registry: PathBuf,
    data_dir: Option<PathBuf>,
    identity_dir: Option<PathBuf>,
    insecure_http: bool,
    enable_mutations: bool,
    sync_v2_mode: SyncV2Mode,
}

#[allow(clippy::too_many_lines)]
async fn serve(options: ServeOptions) -> Result<(), Box<dyn std::error::Error>> {
    // Kept as a parsed no-op so existing service units keep starting while the
    // obsolete outer-TLS rollout flag is removed from deployments.
    let _ = options.insecure_http;
    terminal::preflight().map_err(|error| format!("terminal preflight failed: {error}"))?;
    info!("Terminal PTY preflight passed");
    let legacy_content_directory = options
        .token_file
        .parent()
        .map(|directory| directory.join("content-cache"));
    let token = read_administrator_token(&options.token_file).await?;
    let app_server_socket = options.app_server_socket.clone();
    let sync_v2_enabled = options.sync_v2_mode == SyncV2Mode::Canary;
    let upstream = UpstreamHandle::spawn(options.app_server_socket);
    let store = Arc::new(IndexStore::open(options.state_path.clone())?);
    let codex_home = options.codex_home.unwrap_or_else(default_codex_home);
    let state_directory = options
        .data_dir
        .or_else(|| {
            options
                .state_path
                .parent()
                .map(std::path::Path::to_path_buf)
        })
        .unwrap_or_else(|| PathBuf::from("."));
    tokio::fs::create_dir_all(&state_directory).await?;
    let telemetry = Arc::new(TelemetryStore::open_with_jsonl(
        state_directory.join("telemetry.redb"),
        state_directory.join("telemetry-jsonl"),
    )?);
    let account_pool = if options.enable_mutations {
        Some(
            AccountPoolService::open(
                upstream.clone(),
                codex_home.clone(),
                state_directory.clone(),
            )
            .await?,
        )
    } else {
        None
    };
    let catalog = Arc::new(SessionCatalog::empty(&codex_home));
    let warmup_catalog = catalog.clone();
    let metadata_store = store.clone();
    tokio::spawn(async move {
        let result = tokio::task::spawn_blocking(move || {
            let catalog_threads = warmup_catalog.refresh()?;
            let mut metadata = Vec::new();
            let mut failures = 0_usize;
            for path in warmup_catalog.rollout_paths() {
                match read_rollout_metadata(&path) {
                    Ok(Some(value)) => metadata.push(value),
                    Ok(None) => {}
                    Err(_) => failures += 1,
                }
            }
            let indexed = metadata.len();
            if metadata_store.put_thread_metadata_batch(&metadata).is_err() {
                failures = failures.saturating_add(indexed);
                return Ok::<_, codewide_companion::catalog::CatalogError>((
                    catalog_threads,
                    0,
                    failures,
                ));
            }
            Ok((catalog_threads, indexed, failures))
        })
        .await;
        match result {
            Ok(Ok((catalog_threads, indexed_metadata, metadata_failures))) => {
                info!(
                    threads = catalog_threads,
                    "Canonical rollout catalog background warmup is ready"
                );
                info!(
                    threads = indexed_metadata,
                    "Canonical thread metadata background warmup is ready"
                );
                if metadata_failures > 0 {
                    tracing::warn!(
                        failures = metadata_failures,
                        "some canonical thread metadata headers could not be indexed"
                    );
                }
            }
            Ok(Err(error)) => tracing::warn!(
                reason = %error,
                "canonical catalog background warmup failed"
            ),
            Err(error) => tracing::warn!(
                reason = %error,
                "canonical catalog background warmup task failed"
            ),
        }
    });
    let history = HistoryService::new(catalog.clone(), store.clone());
    let sync = if options.enable_mutations {
        SyncHub::with_mutations(upstream.clone(), store.clone(), history.clone())
    } else {
        SyncHub::new(upstream, store.clone(), history.clone())
    };
    let legacy_attachment_root = state_directory.join("attachments");
    let attachment_root = codex_home.join("attachments/codewide");
    tokio::fs::create_dir_all(&attachment_root).await?;
    tokio::fs::set_permissions(&attachment_root, std::fs::Permissions::from_mode(0o700)).await?;
    migrate_legacy_attachments(&legacy_attachment_root, &attachment_root)?;
    let mut roots = configured_file_roots()?;
    roots.insert("attachments".into(), attachment_root);
    let files = Arc::new(
        FileService::open_with_managed_attachments(
            roots,
            configured_preview_roots()?,
            configured_preview_path_mappings()?,
            Some(state_directory.join("preview-files.json")),
            "attachments".into(),
            configured_max_transfer_bytes()?,
        )
        .await?,
    );
    files.gc_managed_attachments().await?;
    let attachment_gc = files.clone();
    tokio::spawn(async move {
        loop {
            tokio::time::sleep(std::time::Duration::from_hours(24)).await;
            if let Err(error) = attachment_gc.gc_managed_attachments().await {
                tracing::warn!(reason = %error, "managed attachment cleanup failed");
            }
        }
    });
    let content_directory = state_directory.join("content-cache");
    let content_fallbacks = legacy_content_directory
        .filter(|directory| directory != &content_directory && directory.is_dir())
        .into_iter()
        .collect();
    let content = PrivateContentService::open_with_fallbacks(content_directory, content_fallbacks);
    let media = Arc::new(MediaProxyService::new());
    let tunnels = Arc::new(LocalhostTunnelService::new()?);
    let dictation = Arc::new(
        DictationService::open(
            codex_home.join("auth.json"),
            state_directory.join("dictation"),
        )
        .await?,
    );
    let projector = Arc::new(ContentProjector::new(content.clone()));
    let vcs = Arc::new(VcsService::new(state_directory.join("vcs-plugins.json")));
    let resources = Arc::new(
        ResourceService::open(
            state_directory.join("resource-index.redb"),
            catalog.clone(),
            store.clone(),
            files.clone(),
        )?
        .with_vcs(vcs.clone()),
    );
    let workspaces = Arc::new(codewide_companion::workspaces::WorkspaceService::new(
        vcs,
        codex_home.join("worktrees"),
    ));
    let projects =
        codewide_companion::projects::ProjectService::open(state_directory.join("projects.json"))
            .await?;
    let mut sync = sync
        .with_content_projector(projector)
        .with_dictation(dictation)
        .with_files(files.clone())
        .with_resources(resources.clone())
        .with_projects(projects.clone())
        .with_workspaces(workspaces.clone());
    if let Some(account_pool) = &account_pool {
        sync = sync.with_account_pool(account_pool);
    }
    let identity = CompanionIdentity::load_or_create(
        &options
            .identity_dir
            .clone()
            .unwrap_or_else(|| state_directory.join("identity")),
    )?;
    let sync_v2_tls_pin = identity.public().tls_pin_sha256.clone();
    let sync_v2 = sync_v2_enabled
        .then(|| {
            UpstreamHandle::spawn_with_message_limit(
                app_server_socket.clone(),
                codewide_companion::sync_v2::V2_UPSTREAM_MAX_MESSAGE_BYTES,
            )
        })
        .map(|upstream| {
            let source = UpstreamSemanticSource::new(
                upstream,
                store.clone(),
                history,
                catalog.clone(),
                ProductionServices {
                    projects: Some(projects),
                    workspaces: Some(workspaces),
                    resources: Some(resources),
                    accounts: account_pool,
                },
            );
            SyncV2Runtime::new(
                source,
                state_directory.join("sync-v2-operations.redb"),
                sync_v2_tls_pin,
            )
        })
        .transpose()?;
    let token: Arc<str> = Arc::from(token);
    let registry = Arc::new(DeviceRegistry::open(token, options.device_registry, None).await?);
    let bootstrap_listener = std::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))?;
    bootstrap_listener.set_nonblocking(true)?;
    let bootstrap_tls_target = bootstrap_listener.local_addr()?;
    let inner_listener = std::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))?;
    inner_listener.set_nonblocking(true)?;
    let inner_tls_target = inner_listener.local_addr()?;
    let mut excluded_ports = HashSet::from([options.listen.port()]);
    excluded_ports.insert(bootstrap_tls_target.port());
    excluded_ports.insert(inner_tls_target.port());
    let services = server::CompanionServices {
        build_shelf: configured_build_shelf()?,
        files: Some(files),
        content: Some(content),
        media: Some(media),
        tunnels: Some(tunnels),
        telemetry: Some(telemetry),
        catalog: Some(catalog),
        app_server_socket_path: Some(app_server_socket),
        excluded_ports,
        transport_identity: Some(identity.public().clone()),
        bootstrap_tls_target: Some(bootstrap_tls_target),
        bootstrap_tls_limit: Some(Arc::new(tokio::sync::Semaphore::new(16))),
        inner_tls_target: Some(inner_tls_target),
        inner_tls_limit: Some(Arc::new(tokio::sync::Semaphore::new(256))),
        sync_v2,
        sync_v2_mode: options.sync_v2_mode,
    };
    let bootstrap_tls = codewide_companion::device_tls::bootstrap_config(&identity)?;
    let inner_tls = codewide_companion::device_tls::device_bound_config(
        &identity,
        registry.trusted_client_spki(),
    )?;
    let routers = server::split_routers_with_registry_and_services(store, registry, sync, services);
    let control = local_control::bind(&options.control_endpoint).await?;
    info!(
        public = %options.listen,
        control = %options.control_endpoint.display(),
        mutations = options.enable_mutations,
        carrier_tls = false,
        inner_tls = true,
        "Companion is listening"
    );
    let control_server =
        axum::serve(control.listener, routers.control).with_graceful_shutdown(shutdown_signal());
    let public_server = serve_public(options.listen, routers.public);
    let bootstrap_server = serve_inner(bootstrap_listener, routers.bootstrap, bootstrap_tls);
    let inner_server = serve_device_inner(inner_listener, routers.inner, inner_tls);
    tokio::try_join!(
        public_server,
        bootstrap_server,
        inner_server,
        control_server
    )?;
    Ok(())
}

async fn serve_device_inner(
    listener: std::net::TcpListener,
    router: axum::Router,
    tls: Arc<rustls::ServerConfig>,
) -> Result<(), std::io::Error> {
    let handle = axum_server::Handle::new();
    let shutdown_handle = handle.clone();
    tokio::spawn(async move {
        shutdown_signal().await;
        shutdown_handle.graceful_shutdown(Some(std::time::Duration::from_secs(10)));
    });
    axum_server::from_tcp(listener)?
        .acceptor(codewide_companion::device_tls::DeviceTlsAcceptor::new(tls))
        .handle(handle)
        .serve(router.into_make_service())
        .await
}

async fn serve_inner(
    listener: std::net::TcpListener,
    router: axum::Router,
    tls: axum_server::tls_rustls::RustlsConfig,
) -> Result<(), std::io::Error> {
    let handle = axum_server::Handle::new();
    let shutdown_handle = handle.clone();
    tokio::spawn(async move {
        shutdown_signal().await;
        shutdown_handle.graceful_shutdown(Some(std::time::Duration::from_secs(10)));
    });
    axum_server::from_tcp_rustls(listener, tls)?
        .handle(handle)
        .serve(router.into_make_service())
        .await
}

async fn serve_public(listen: SocketAddr, router: axum::Router) -> Result<(), std::io::Error> {
    let listener = TcpListener::bind(listen).await?;
    axum::serve(listener, router)
        .with_graceful_shutdown(shutdown_signal())
        .await
}

fn migrate_legacy_attachments(
    legacy_root: &Path,
    managed_root: &Path,
) -> Result<(), Box<dyn std::error::Error>> {
    if !legacy_root.is_dir() {
        return Ok(());
    }
    for entry in walkdir::WalkDir::new(legacy_root).follow_links(false) {
        let entry = entry?;
        if !entry.file_type().is_file() {
            continue;
        }
        let relative = entry.path().strip_prefix(legacy_root)?;
        if entry
            .file_name()
            .to_str()
            .is_some_and(|name| name.contains(".upload-"))
        {
            continue;
        }
        let target = managed_root.join(relative);
        if target.exists() {
            continue;
        }
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent)?;
            std::fs::set_permissions(parent, std::fs::Permissions::from_mode(0o700))?;
        }
        if std::fs::hard_link(entry.path(), &target).is_err() {
            std::fs::copy(entry.path(), &target)?;
        }
        std::fs::set_permissions(&target, std::fs::Permissions::from_mode(0o600))?;
    }
    Ok(())
}

fn configured_file_roots() -> Result<HashMap<String, PathBuf>, Box<dyn std::error::Error>> {
    let Some(raw) = std::env::var_os("CODEWIDE_FILE_ROOTS") else {
        return Ok(HashMap::new());
    };
    let parsed = serde_json::from_str::<HashMap<String, PathBuf>>(&raw.to_string_lossy())?;
    if parsed.values().any(|path| !path.is_absolute()) {
        return Err("CODEWIDE_FILE_ROOTS values must be absolute paths".into());
    }
    Ok(parsed)
}

fn configured_preview_roots() -> Result<Vec<PathBuf>, Box<dyn std::error::Error>> {
    let Some(raw) = std::env::var_os("CODEWIDE_PREVIEW_ROOTS") else {
        return Ok(Vec::new());
    };
    let parsed = serde_json::from_str::<Vec<PathBuf>>(&raw.to_string_lossy())?;
    if parsed.iter().any(|path| !path.is_absolute()) {
        return Err("CODEWIDE_PREVIEW_ROOTS values must be absolute paths".into());
    }
    Ok(parsed)
}

fn configured_preview_path_mappings()
-> Result<HashMap<PathBuf, PathBuf>, Box<dyn std::error::Error>> {
    let Some(raw) = std::env::var_os("CODEWIDE_PREVIEW_PATH_MAPPINGS") else {
        return Ok(HashMap::new());
    };
    let parsed = serde_json::from_str::<HashMap<PathBuf, PathBuf>>(&raw.to_string_lossy())?;
    if parsed
        .iter()
        .any(|(reported, readable)| !reported.is_absolute() || !readable.is_absolute())
    {
        return Err("CODEWIDE_PREVIEW_PATH_MAPPINGS keys and values must be absolute paths".into());
    }
    Ok(parsed)
}

fn configured_max_transfer_bytes() -> Result<Option<u64>, Box<dyn std::error::Error>> {
    std::env::var("CODEWIDE_MAX_TRANSFER_BYTES")
        .ok()
        .map(|raw| raw.parse().map_err(Into::into))
        .transpose()
}

fn configured_build_shelf() -> Result<Option<BuildShelfProxy>, Box<dyn std::error::Error>> {
    std::env::var("CODEWIDE_BUILD_SHELF_ORIGIN")
        .ok()
        .filter(|raw| !raw.trim().is_empty())
        .map(|raw| BuildShelfProxy::new(&raw).map_err(Into::into))
        .transpose()
}

fn default_codex_home() -> PathBuf {
    std::env::var_os("CODEX_HOME").map_or_else(
        || {
            std::env::var_os("HOME")
                .map_or_else(|| PathBuf::from("."), PathBuf::from)
                .join(".codex")
        },
        PathBuf::from,
    )
}

fn default_vcs_registry() -> PathBuf {
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
        .join("codewide/companion/vcs-plugins.json")
}

fn default_identity_directory() -> PathBuf {
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
        .join("codewide/companion/identity")
}

fn default_control_endpoint() -> PathBuf {
    std::env::var_os("XDG_RUNTIME_DIR")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("XDG_STATE_HOME").map(PathBuf::from))
        .unwrap_or_else(|| {
            std::env::var_os("HOME").map_or_else(
                || PathBuf::from("."),
                |home| PathBuf::from(home).join(".local/state"),
            )
        })
        .join("codewide/companion-control.sock")
}

fn default_administrator_token_file() -> PathBuf {
    std::env::var_os("HOME").map_or_else(
        || PathBuf::from(".codewide/host.token"),
        |home| PathBuf::from(home).join(".codewide/host.token"),
    )
}

fn default_state_migration_paths() -> StateMigrationPaths {
    let home = std::env::var_os("HOME").map_or_else(|| PathBuf::from("."), PathBuf::from);
    let state_home =
        std::env::var_os("XDG_STATE_HOME").map_or_else(|| home.join(".local/state"), PathBuf::from);
    StateMigrationPaths {
        legacy_config_root: home.join(".codex-remote"),
        current_config_root: home.join(".codewide"),
        legacy_state_root: state_home.join("codex-remote-rust"),
        current_state_root: state_home.join("codewide-rust"),
        legacy_shadow_root: state_home.join("codex-remote-rust-shadow"),
        current_shadow_root: state_home.join("codewide-rust-shadow"),
    }
}

async fn read_administrator_token(path: &Path) -> Result<String, Box<dyn std::error::Error>> {
    let metadata = tokio::fs::metadata(path).await?;
    #[cfg(unix)]
    if std::os::unix::fs::PermissionsExt::mode(&metadata.permissions()) & 0o077 != 0 {
        return Err("token file must not be group/world accessible".into());
    }
    let token = tokio::fs::read_to_string(path).await?.trim().to_owned();
    if token.len() < 32 {
        return Err("token file does not contain a valid secret".into());
    }
    Ok(token)
}

fn create_administrator_token(path: &Path) -> Result<(), Box<dyn std::error::Error>> {
    let parent = path
        .parent()
        .ok_or("administrator token must have a parent directory")?;
    let parent_existed = parent.exists();
    std::fs::create_dir_all(parent)?;
    if !parent_existed {
        std::fs::set_permissions(parent, std::fs::Permissions::from_mode(0o700))?;
    }
    let mut random = [0_u8; 32];
    OsRng
        .try_fill_bytes(&mut random)
        .map_err(|_| "secure randomness unavailable")?;
    let token = general_purpose::URL_SAFE_NO_PAD.encode(random);
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(path)?;
    writeln!(file, "{token}")?;
    file.sync_all()?;
    Ok(())
}

async fn shutdown_signal() {
    let _ = tokio::signal::ctrl_c().await;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn legacy_attachments_are_preserved_without_copying_upload_fragments()
    -> Result<(), Box<dyn std::error::Error>> {
        let directory = tempfile::tempdir()?;
        let legacy = directory.path().join("legacy");
        let managed = directory.path().join("managed");
        std::fs::create_dir_all(legacy.join("nested"))?;
        std::fs::create_dir_all(&managed)?;
        std::fs::write(legacy.join("photo.png"), b"photo")?;
        std::fs::write(legacy.join("nested/report.md"), b"report")?;
        std::fs::write(legacy.join(".photo.png.upload-sha256-deadbeef"), b"partial")?;

        migrate_legacy_attachments(&legacy, &managed)?;

        assert_eq!(std::fs::read(managed.join("photo.png"))?, b"photo");
        assert_eq!(std::fs::read(managed.join("nested/report.md"))?, b"report");
        assert!(!managed.join(".photo.png.upload-sha256-deadbeef").exists());
        Ok(())
    }
}
