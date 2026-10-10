//! JSONL stdio framing for the upstream request/event coordinator.
//!
//! One JSON object per line. The companion sends an initialize request with
//! a fixed id, waits for its response, then sends `{"method":"initialized"}`.
//! Requests get companion-assigned ids (`codewide-stdio:<n>`); objects with a
//! `method` are notifications or server requests and are published in order.
//!
//! Two lifecycles share the framing: a single-shot child owned by the caller
//! (`spawn_stdio`, the account-enrollment App Server) and a supervised child
//! that this module launches and restarts (`spawn_supervised_stdio`, agent
//! provider sidecars).

use std::{
    collections::{HashMap, VecDeque},
    ffi::OsString,
    path::PathBuf,
    process::Stdio,
    sync::{Arc, atomic::Ordering},
    time::{Duration, Instant},
};

use serde_json::{Value, json};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    process::{ChildStderr, ChildStdin, ChildStdout, Command},
    sync::{broadcast, mpsc, watch},
};
use tracing::{error, info, warn};

use super::{
    ConnectionStateWriter, ConnectionStatus, INITIALIZE_ID, OrderedUpstreamEvent,
    PendingUpstreamRequest, UpstreamCommand, UpstreamError, app_server_version,
    complete_pending_request, publish_notification, reject_command,
};

const MAX_STDERR_LINE_BYTES: usize = 4 * 1024;
const RESTART_WINDOW: Duration = Duration::from_mins(10);
const RESTART_ALERT_THRESHOLD: usize = 5;

/// The channel ends a transport task owns.
pub(super) struct TransportParts {
    pub(super) commands: mpsc::Receiver<UpstreamCommand>,
    pub(super) events: broadcast::Sender<Value>,
    pub(super) ordered_events: Arc<std::sync::Mutex<Option<mpsc::Sender<OrderedUpstreamEvent>>>>,
    pub(super) connection_state: ConnectionStateWriter,
}

/// Where the peer's version is read from in its initialize response.
#[derive(Clone, Copy, Debug)]
pub enum VersionSource {
    /// Codex App Server `result.userAgent` (`name/<version> ...`).
    AppServerUserAgent,
    /// A JSON pointer to a version string.
    Pointer(&'static str),
}

/// Identity and handshake of one stdio peer.
#[derive(Clone, Debug)]
pub struct StdioProfile {
    /// Human-readable peer name for logs.
    pub peer: &'static str,
    /// `params` of the initialize request.
    pub initialize_params: Value,
    pub version: VersionSource,
}

impl StdioProfile {
    /// The private account-enrollment App Server.
    #[must_use]
    pub fn app_server_enrollment() -> Self {
        Self {
            peer: "private Codex App Server",
            initialize_params: json!({
                "clientInfo": {
                    "name": "codewide_account_enrollment",
                    "title": "CodeWide Account Enrollment",
                    "version": env!("CARGO_PKG_VERSION")
                },
                "capabilities": { "experimentalApi": true }
            }),
            version: VersionSource::AppServerUserAgent,
        }
    }
}

/// A child process the supervisor launches. Arguments and environment are
/// passed as-is; secrets must not be placed in arguments.
#[derive(Clone, Debug)]
pub struct SupervisedCommand {
    pub program: PathBuf,
    pub args: Vec<OsString>,
    /// Variables set on top of the inherited environment (an entry replaces
    /// the inherited value of the same name). Values are never logged.
    pub env: Vec<(OsString, OsString)>,
    /// Stable label for logs (never includes arguments).
    pub label: &'static str,
}

fn peer_version(source: VersionSource, initialized: &Value) -> Option<String> {
    match source {
        VersionSource::AppServerUserAgent => app_server_version(initialized),
        VersionSource::Pointer(pointer) => initialized
            .pointer(pointer)
            .and_then(Value::as_str)
            .filter(|version| !version.is_empty())
            .map(str::to_owned),
    }
}

pub(super) async fn run_stdio(
    mut stdin: ChildStdin,
    stdout: ChildStdout,
    mut parts: TransportParts,
    profile: StdioProfile,
) {
    let mut lines = BufReader::new(stdout).lines();
    let result = run_stdio_connection(&mut stdin, &mut lines, &mut parts, &profile, None).await;
    let _ = parts
        .connection_state
        .status
        .send(ConnectionStatus::Reconnecting);
    if let Err(error) = result {
        warn!(%error, peer = profile.peer, "stdio connection failed");
    }
    while let Ok(command) = parts.commands.try_recv() {
        reject_command(command, UpstreamError::Disconnected);
    }
}

/// Launches `command`, runs the connection, and restarts the child after it
/// exits. Logs at `error` when restarts exceed the alert threshold in the
/// window (an operational rollback trigger).
pub(super) async fn supervise(
    command: SupervisedCommand,
    profile: StdioProfile,
    mut parts: TransportParts,
    initialized: watch::Sender<Option<Value>>,
) {
    let mut attempt = 0_u32;
    let mut restarts = VecDeque::new();
    loop {
        let _ = parts
            .connection_state
            .status
            .send(ConnectionStatus::Reconnecting);
        let started = Instant::now();
        match launch(&command) {
            Ok((mut child, mut stdin, stdout, stderr)) => {
                tokio::spawn(forward_stderr(stderr, command.label));
                let mut lines = BufReader::new(stdout).lines();
                let result = run_stdio_connection(
                    &mut stdin,
                    &mut lines,
                    &mut parts,
                    &profile,
                    Some(&initialized),
                )
                .await;
                let _ = parts
                    .connection_state
                    .status
                    .send(ConnectionStatus::Reconnecting);
                drop(stdin);
                let _ = child.start_kill();
                let exit = child.wait().await;
                match result {
                    Ok(()) => {
                        warn!(peer = profile.peer, exit = ?exit.ok(), "supervised child closed its stdio");
                    }
                    Err(err) => {
                        warn!(peer = profile.peer, err = %err, exit = ?exit.ok(), "supervised child connection failed");
                    }
                }
            }
            Err(err) => error!(peer = profile.peer, err = %err, "supervised child failed to start"),
        }
        if parts.commands.is_closed() {
            return;
        }
        while let Ok(command) = parts.commands.try_recv() {
            reject_command(command, UpstreamError::Disconnected);
        }
        let now = Instant::now();
        restarts.push_back(now);
        while restarts
            .front()
            .is_some_and(|at: &Instant| now.duration_since(*at) > RESTART_WINDOW)
        {
            restarts.pop_front();
        }
        if restarts.len() > RESTART_ALERT_THRESHOLD {
            error!(
                peer = profile.peer,
                restarts = restarts.len(),
                window_secs = RESTART_WINDOW.as_secs(),
                "supervised child restarts exceed the rollback threshold"
            );
        }
        attempt = if started.elapsed() > Duration::from_mins(1) {
            0
        } else {
            attempt.saturating_add(1)
        };
        let delay = Duration::from_millis((250_u64 * 2_u64.pow(attempt.min(7))).min(30_000));
        tokio::time::sleep(delay).await;
    }
}

type LaunchedChild = (tokio::process::Child, ChildStdin, ChildStdout, ChildStderr);

fn launch(command: &SupervisedCommand) -> std::io::Result<LaunchedChild> {
    let mut child = Command::new(&command.program)
        .args(&command.args)
        .envs(command.env.iter().map(|(name, value)| (name, value)))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()?;
    let missing = || std::io::Error::other("child stdio is not piped");
    let stdin = child.stdin.take().ok_or_else(missing)?;
    let stdout = child.stdout.take().ok_or_else(missing)?;
    let stderr = child.stderr.take().ok_or_else(missing)?;
    Ok((child, stdin, stdout, stderr))
}

/// Forwards the child's structured log lines. The child owns log hygiene;
/// lines are bounded here so a misbehaving child cannot flood one record.
async fn forward_stderr(stderr: ChildStderr, label: &'static str) {
    let mut lines = BufReader::new(stderr).lines();
    while let Ok(Some(line)) = lines.next_line().await {
        let mut line = line;
        if line.len() > MAX_STDERR_LINE_BYTES {
            let mut end = MAX_STDERR_LINE_BYTES;
            while !line.is_char_boundary(end) {
                end -= 1;
            }
            line.truncate(end);
        }
        let level = serde_json::from_str::<Value>(&line).ok().and_then(|value| {
            value
                .get("level")
                .and_then(Value::as_str)
                .map(str::to_owned)
        });
        match level.as_deref() {
            Some("error" | "fatal") => error!(child = label, line = %line, "sidecar log"),
            Some("warn") => warn!(child = label, line = %line, "sidecar log"),
            _ => info!(child = label, line = %line, "sidecar log"),
        }
    }
}

#[allow(clippy::too_many_lines)]
async fn run_stdio_connection(
    stdin: &mut ChildStdin,
    lines: &mut tokio::io::Lines<BufReader<ChildStdout>>,
    parts: &mut TransportParts,
    profile: &StdioProfile,
    initialized_watch: Option<&watch::Sender<Option<Value>>>,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    write_json_line(
        stdin,
        &json!({
            "id": INITIALIZE_ID,
            "method": "initialize",
            "params": profile.initialize_params,
        }),
    )
    .await?;
    let initialized = loop {
        let Some(line) = lines.next_line().await? else {
            return Err(UpstreamError::Disconnected.into());
        };
        let value: Value = serde_json::from_str(&line)?;
        if value.get("id").and_then(Value::as_str) == Some(INITIALIZE_ID) {
            break value;
        }
        if value.get("method").and_then(Value::as_str).is_some() {
            publish_notification(&parts.events, &parts.ordered_events, value).await;
        }
    };
    if let Some(watch) = initialized_watch {
        // The whole response (result or error) is published so the owner can
        // tell a negotiation failure from a transport failure.
        let _ = watch.send(Some(initialized.clone()));
    }
    if initialized.get("error").is_some() {
        return Err(UpstreamError::Protocol(initialized.to_string()).into());
    }
    write_json_line(stdin, &json!({"method": "initialized"})).await?;
    let connection_state = &parts.connection_state;
    let _ = connection_state
        .version
        .send(peer_version(profile.version, &initialized));
    connection_state.generation.fetch_add(1, Ordering::AcqRel);
    let _ = connection_state.status.send(ConnectionStatus::Live);
    info!(peer = profile.peer, "connected over stdio");

    let mut counter = 0_u64;
    let mut pending: HashMap<String, PendingUpstreamRequest> = HashMap::new();
    let mut pending_cleanup = tokio::time::interval(Duration::from_secs(1));
    loop {
        tokio::select! {
            _ = pending_cleanup.tick() => {
                pending.retain(|_, request| !request.response.is_closed());
            }
            outbound = parts.commands.recv() => {
                let Some(outbound) = outbound else { break; };
                match outbound {
                    UpstreamCommand::Request(mut outbound) => {
                        if outbound.response.is_closed() {
                            continue;
                        }
                        counter = counter.wrapping_add(1);
                        let upstream_id = format!("codewide-stdio:{counter}");
                        let Some(object) = outbound.request.as_object_mut() else {
                            let _ = outbound.response.send(Err(UpstreamError::Protocol("request is not an object".into())));
                            continue;
                        };
                        object.insert("id".into(), Value::String(upstream_id.clone()));
                        if write_json_line(stdin, &outbound.request).await.is_err() {
                            let _ = outbound.response.send(Err(UpstreamError::Disconnected));
                            break;
                        }
                        pending.insert(upstream_id, PendingUpstreamRequest {
                            response: outbound.response,
                            fence: outbound.fence,
                        });
                    }
                    UpstreamCommand::ServerResponse(outbound) => {
                        let valid = outbound.response.get("id").is_some()
                            && (outbound.response.get("result").is_some() || outbound.response.get("error").is_some())
                            && outbound.response.get("method").is_none();
                        if !valid {
                            let _ = outbound.delivered.send(Err(UpstreamError::Protocol("invalid server response".into())));
                            continue;
                        }
                        if write_json_line(stdin, &outbound.response).await.is_ok() {
                            let _ = outbound.delivered.send(Ok(()));
                        } else {
                            let _ = outbound.delivered.send(Err(UpstreamError::Disconnected));
                            break;
                        }
                    }
                }
            }
            line = lines.next_line() => {
                let Some(line) = line? else { break; };
                let value: Value = serde_json::from_str(&line)?;
                if value.get("method").and_then(Value::as_str).is_some() {
                    publish_notification(&parts.events, &parts.ordered_events, value).await;
                    continue;
                }
                let id = match value.get("id") {
                    Some(Value::String(id)) => id.clone(),
                    Some(id) => id.to_string(),
                    None => continue,
                };
                if let Some(request) = pending.remove(&id) {
                    complete_pending_request(request, value, &parts.ordered_events).await;
                }
            }
        }
    }
    for (_, request) in pending {
        let _ = request.response.send(Err(UpstreamError::Disconnected));
    }
    Ok(())
}

async fn write_json_line(stdin: &mut ChildStdin, value: &Value) -> std::io::Result<()> {
    stdin.write_all(value.to_string().as_bytes()).await?;
    stdin.write_all(b"\n").await?;
    stdin.flush().await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn supervised_child_is_restarted_and_reinitialized()
    -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let directory = tempfile::tempdir()?;
        let counter = directory.path().join("starts");
        let script = format!(
            r#"echo "$CODEWIDE_TEST_PROBE" >> '{}'
IFS= read -r initialize
printf '%s\n' '{{"id":"codewide-companion-initialize","result":{{"provider":{{"version":"9.9"}}}}}}'
IFS= read -r initialized
IFS= read -r request
printf '%s\n' '{{"id":"codewide-stdio:1","result":{{"ok":true}}}}'
"#,
            counter.display()
        );
        let (handle, mut initialized) = super::super::UpstreamHandle::spawn_supervised_stdio(
            SupervisedCommand {
                program: PathBuf::from("sh"),
                args: vec!["-c".into(), script.into()],
                env: vec![("CODEWIDE_TEST_PROBE".into(), "from-config".into())],
                label: "test-child",
            },
            StdioProfile {
                peer: "test child",
                initialize_params: json!({"protocol": "test"}),
                version: VersionSource::Pointer("/result/provider/version"),
            },
        );
        tokio::time::timeout(Duration::from_secs(5), initialized.changed()).await??;
        assert_eq!(handle.version().as_deref(), Some("9.9"));
        let response = handle
            .request(json!({"method": "probe", "params": {}}))
            .await?;
        assert_eq!(response["result"]["ok"], true);
        // The child exits after one request; the supervisor starts it again.
        tokio::time::timeout(Duration::from_secs(5), async {
            loop {
                let starts = std::fs::read_to_string(&counter).unwrap_or_default();
                if starts.lines().count() >= 2 {
                    return;
                }
                tokio::time::sleep(Duration::from_millis(20)).await;
            }
        })
        .await?;
        let starts = std::fs::read_to_string(&counter)?;
        assert!(starts.lines().all(|line| line == "from-config"));
        Ok(())
    }
}
