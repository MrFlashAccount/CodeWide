use std::{
    fs::OpenOptions,
    io::Write as _,
    os::unix::fs::OpenOptionsExt as _,
    path::{Path, PathBuf},
    process::Stdio,
    time::Duration,
};

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tokio::{
    io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader},
    process::{Child, ChildStdin, ChildStdout, Command},
    time::timeout,
};

use super::{
    CHANGES_CAPABILITY, DIFF_CAPABILITY, DIFF_PAGE_CAPABILITY, VcsDiff, VcsDiffPage, VcsError,
    VcsFile, VcsScope, VcsSnapshot, WORKSPACE_CREATE_CAPABILITY, WorkspaceCreateResult,
    WorkspaceSupport,
};

const REGISTRY_VERSION: u32 = 1;
const PROTOCOL_VERSION: u32 = 1;
const MAX_FRAME_BYTES: usize = 32 * 1024 * 1024;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
const WORKSPACE_CREATE_TIMEOUT: Duration = Duration::from_mins(10);
const WORKSPACE_NOT_OWNED: i64 = -32_004;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VcsPluginConfig {
    pub id: String,
    pub executable: PathBuf,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default = "default_enabled")]
    pub enabled: bool,
    #[serde(default)]
    pub priority: i32,
}

fn default_enabled() -> bool {
    true
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct RegistryFile {
    version: u32,
    plugins: Vec<VcsPluginConfig>,
}

#[derive(Clone, Debug)]
pub struct PluginRegistry {
    path: PathBuf,
}

impl PluginRegistry {
    #[must_use]
    pub fn new(path: PathBuf) -> Self {
        Self { path }
    }

    #[must_use]
    pub fn path(&self) -> &Path {
        &self.path
    }

    /// Returns all configured providers in resolution order.
    ///
    /// # Errors
    ///
    /// Returns an error when the registry cannot be read or parsed.
    pub fn list(&self) -> Result<Vec<VcsPluginConfig>, VcsError> {
        let mut plugins = self.read()?.plugins;
        sort_plugins(&mut plugins);
        Ok(plugins)
    }

    /// Returns enabled providers in resolution order.
    ///
    /// # Errors
    ///
    /// Returns an error when the registry cannot be read or parsed.
    pub fn enabled_plugins(&self) -> Result<Vec<VcsPluginConfig>, VcsError> {
        Ok(self
            .list()?
            .into_iter()
            .filter(|plugin| plugin.enabled)
            .collect())
    }

    /// Atomically installs or replaces one provider configuration.
    ///
    /// # Errors
    ///
    /// Returns an error for an invalid id or executable, or when the registry
    /// cannot be persisted.
    pub fn install(&self, mut plugin: VcsPluginConfig) -> Result<(), VcsError> {
        validate_plugin_id(&plugin.id)?;
        if !plugin.executable.is_absolute() {
            return Err(VcsError::Registry(format!(
                "plugin executable must be absolute: {}",
                plugin.executable.display()
            )));
        }
        plugin.executable = plugin.executable.canonicalize().map_err(|error| {
            VcsError::Registry(format!(
                "could not resolve plugin executable {}: {error}",
                plugin.executable.display()
            ))
        })?;
        if !plugin.executable.is_file() {
            return Err(VcsError::Registry(format!(
                "plugin executable is not a file: {}",
                plugin.executable.display()
            )));
        }
        let mut registry = self.read()?;
        registry
            .plugins
            .retain(|candidate| candidate.id != plugin.id);
        registry.plugins.push(plugin);
        sort_plugins(&mut registry.plugins);
        self.write(&registry)
    }

    /// Atomically removes one provider configuration.
    ///
    /// # Errors
    ///
    /// Returns an error for an invalid id or when the registry cannot be read
    /// or persisted.
    pub fn remove(&self, id: &str) -> Result<bool, VcsError> {
        validate_plugin_id(id)?;
        let mut registry = self.read()?;
        let previous = registry.plugins.len();
        registry.plugins.retain(|plugin| plugin.id != id);
        let removed = registry.plugins.len() != previous;
        if removed {
            self.write(&registry)?;
        }
        Ok(removed)
    }

    fn read(&self) -> Result<RegistryFile, VcsError> {
        let bytes = match std::fs::read(&self.path) {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Ok(RegistryFile {
                    version: REGISTRY_VERSION,
                    plugins: Vec::new(),
                });
            }
            Err(error) => {
                return Err(VcsError::Registry(format!(
                    "could not read {}: {error}",
                    self.path.display()
                )));
            }
        };
        let registry = serde_json::from_slice::<RegistryFile>(&bytes).map_err(|error| {
            VcsError::Registry(format!("could not parse {}: {error}", self.path.display()))
        })?;
        if registry.version != REGISTRY_VERSION {
            return Err(VcsError::Registry(format!(
                "unsupported registry version {} in {}",
                registry.version,
                self.path.display()
            )));
        }
        for plugin in &registry.plugins {
            validate_plugin_id(&plugin.id)?;
        }
        Ok(registry)
    }

    fn write(&self, registry: &RegistryFile) -> Result<(), VcsError> {
        let parent = self.path.parent().ok_or_else(|| {
            VcsError::Registry("plugin registry path has no parent directory".into())
        })?;
        std::fs::create_dir_all(parent).map_err(|error| {
            VcsError::Registry(format!("could not create {}: {error}", parent.display()))
        })?;
        let temporary = parent.join(format!(
            ".{}.{}.tmp",
            self.path
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("vcs-plugins"),
            std::process::id()
        ));
        let encoded = serde_json::to_vec_pretty(registry)
            .map_err(|error| VcsError::Registry(format!("could not encode registry: {error}")))?;
        let mut file = OpenOptions::new()
            .create(true)
            .truncate(true)
            .write(true)
            .mode(0o600)
            .open(&temporary)
            .map_err(|error| {
                VcsError::Registry(format!("could not write {}: {error}", temporary.display()))
            })?;
        file.write_all(&encoded)
            .and_then(|()| file.write_all(b"\n"))
            .and_then(|()| file.sync_all())
            .map_err(|error| {
                VcsError::Registry(format!(
                    "could not persist {}: {error}",
                    temporary.display()
                ))
            })?;
        std::fs::rename(&temporary, &self.path).map_err(|error| {
            VcsError::Registry(format!(
                "could not replace {}: {error}",
                self.path.display()
            ))
        })
    }
}

fn validate_plugin_id(id: &str) -> Result<(), VcsError> {
    let valid = !id.is_empty()
        && id.len() <= 64
        && id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'));
    if valid {
        Ok(())
    } else {
        Err(VcsError::Registry(format!("invalid plugin id: {id}")))
    }
}

fn sort_plugins(plugins: &mut [VcsPluginConfig]) {
    plugins.sort_by(|left, right| {
        right
            .priority
            .cmp(&left.priority)
            .then_with(|| left.id.cmp(&right.id))
    });
}

#[derive(Debug, thiserror::Error)]
pub enum PluginCallError {
    #[error("workspace is not owned by this provider")]
    WorkspaceNotOwned,
    #[error("provider does not support workspace creation")]
    CapabilityUnsupported,
    #[error("could not start plugin: {0}")]
    Start(std::io::Error),
    #[error("plugin request timed out")]
    Timeout,
    #[error("plugin transport failed: {0}")]
    Transport(String),
    #[error("plugin protocol failed: {0}")]
    Protocol(String),
    #[error("plugin returned error {code}: {message}")]
    Remote { code: i64, message: String },
}

pub async fn changes(
    plugin: &VcsPluginConfig,
    workspace: &Path,
    scope: VcsScope,
) -> Result<VcsSnapshot, PluginCallError> {
    let mut session = PluginSession::spawn(plugin, workspace)?;
    let initialized = session
        .request(
            1,
            "initialize",
            json!({
                "protocolVersion": PROTOCOL_VERSION,
                "client": { "name": "codewide-companion" },
                "capabilities": [CHANGES_CAPABILITY]
            }),
        )
        .await?;
    validate_initialize(plugin, &initialized, CHANGES_CAPABILITY)?;
    let result = session
        .request(
            2,
            "vcs.changes",
            json!({ "workspace": workspace, "scope": scope }),
        )
        .await;
    session.shutdown().await;
    let snapshot = serde_json::from_value::<VcsSnapshot>(result?).map_err(|error| {
        PluginCallError::Protocol(format!("invalid vcs.changes result: {error}"))
    })?;
    if snapshot.capability != CHANGES_CAPABILITY {
        return Err(PluginCallError::Protocol(format!(
            "unexpected capability {}",
            snapshot.capability
        )));
    }
    if snapshot.repository.provider != plugin.id {
        return Err(PluginCallError::Protocol(format!(
            "provider mismatch: expected {}, got {}",
            plugin.id, snapshot.repository.provider
        )));
    }
    if snapshot.scope != scope {
        return Err(PluginCallError::Protocol(format!(
            "scope mismatch: expected {scope:?}, got {:?}",
            snapshot.scope
        )));
    }
    Ok(snapshot)
}

#[expect(
    clippy::suspicious_operation_groupings,
    reason = "VcsDiff.file_id intentionally corresponds to VcsFile.id"
)]
pub async fn diff(
    plugin: &VcsPluginConfig,
    workspace: &Path,
    file: &VcsFile,
    snapshot_id: &str,
    scope: VcsScope,
) -> Result<VcsDiff, PluginCallError> {
    let mut session = PluginSession::spawn(plugin, workspace)?;
    let initialized = session
        .request(
            1,
            "initialize",
            json!({
                "protocolVersion": PROTOCOL_VERSION,
                "client": { "name": "codewide-companion" },
                "capabilities": [CHANGES_CAPABILITY, DIFF_CAPABILITY]
            }),
        )
        .await?;
    validate_initialize(plugin, &initialized, DIFF_CAPABILITY)?;
    let result = session
        .request(
            2,
            "vcs.diff",
            json!({
                "workspace": workspace,
                "path": file.path,
                "snapshotId": snapshot_id,
                "scope": scope
            }),
        )
        .await;
    session.shutdown().await;
    let diff = serde_json::from_value::<VcsDiff>(result?)
        .map_err(|error| PluginCallError::Protocol(format!("invalid vcs.diff result: {error}")))?;
    if diff.capability != DIFF_CAPABILITY {
        return Err(PluginCallError::Protocol(format!(
            "unexpected capability {}",
            diff.capability
        )));
    }
    if diff.repository.provider != plugin.id {
        return Err(PluginCallError::Protocol(format!(
            "provider mismatch: expected {}, got {}",
            plugin.id, diff.repository.provider
        )));
    }
    if diff.path != file.path || diff.file_id != file.id {
        return Err(PluginCallError::Protocol(
            "provider returned a diff for a different file".into(),
        ));
    }
    if diff.scope != scope {
        return Err(PluginCallError::Protocol(format!(
            "scope mismatch: expected {scope:?}, got {:?}",
            diff.scope
        )));
    }
    Ok(diff)
}

#[expect(
    clippy::suspicious_operation_groupings,
    reason = "VcsDiffPage.file_id intentionally corresponds to VcsFile.id"
)]
pub async fn diff_page(
    plugin: &VcsPluginConfig,
    workspace: &Path,
    file: &VcsFile,
    snapshot_id: &str,
    scope: VcsScope,
    offset: usize,
    limit: usize,
) -> Result<VcsDiffPage, PluginCallError> {
    let mut session = PluginSession::spawn(plugin, workspace)?;
    let initialized = session
        .request(
            1,
            "initialize",
            json!({
                "protocolVersion": PROTOCOL_VERSION,
                "client": { "name": "codewide-companion" },
                "capabilities": [CHANGES_CAPABILITY, DIFF_PAGE_CAPABILITY]
            }),
        )
        .await?;
    validate_initialize(plugin, &initialized, DIFF_PAGE_CAPABILITY)?;
    let result = session
        .request(
            2,
            "vcs.diffPage",
            json!({
                "workspace": workspace,
                "path": file.path,
                "snapshotId": snapshot_id,
                "scope": scope,
                "offset": offset,
                "limit": limit,
            }),
        )
        .await;
    session.shutdown().await;
    let page = serde_json::from_value::<VcsDiffPage>(result?).map_err(|error| {
        PluginCallError::Protocol(format!("invalid vcs.diffPage result: {error}"))
    })?;
    if page.capability != DIFF_PAGE_CAPABILITY {
        return Err(PluginCallError::Protocol(format!(
            "unexpected capability {}",
            page.capability
        )));
    }
    if page.provider != plugin.id {
        return Err(PluginCallError::Protocol(format!(
            "provider mismatch: expected {}, got {}",
            plugin.id, page.provider
        )));
    }
    if page.path != file.path || page.file_id != file.id {
        return Err(PluginCallError::Protocol(
            "provider returned a diff page for a different file".into(),
        ));
    }
    if page.scope != scope || page.snapshot_id != snapshot_id {
        return Err(PluginCallError::Protocol(
            "provider returned a diff page for a different snapshot".into(),
        ));
    }
    if page.next_offset < offset
        || page.next_offset > page.total_bytes
        || page.content.len() > limit
        || page.next_offset != offset.saturating_add(page.content.len())
    {
        return Err(PluginCallError::Protocol(
            "provider returned an invalid diff page boundary".into(),
        ));
    }
    Ok(page)
}

pub async fn workspace_support(
    plugin: &VcsPluginConfig,
    workspace: &Path,
) -> Result<WorkspaceSupport, PluginCallError> {
    let mut session = PluginSession::spawn(plugin, workspace)?;
    let initialized = session
        .request(
            1,
            "initialize",
            json!({
                "protocolVersion": PROTOCOL_VERSION,
                "client": { "name": "codewide-companion" },
                "capabilities": [WORKSPACE_CREATE_CAPABILITY]
            }),
        )
        .await?;
    if !validate_initialize_metadata(plugin, &initialized, WORKSPACE_CREATE_CAPABILITY)? {
        session.shutdown().await;
        return Err(PluginCallError::CapabilityUnsupported);
    }
    let result = session
        .request(2, "workspace.inspect", json!({ "workspace": workspace }))
        .await;
    session.shutdown().await;
    let support = serde_json::from_value::<WorkspaceSupport>(result?).map_err(|error| {
        PluginCallError::Protocol(format!("invalid workspace.inspect result: {error}"))
    })?;
    validate_workspace_support(plugin, &support)?;
    Ok(support)
}

pub async fn workspace_create(
    plugin: &VcsPluginConfig,
    workspace: &Path,
    request_id: &str,
    storage_root: &Path,
    progress: tokio::sync::mpsc::UnboundedSender<WorkspaceCreateResult>,
) -> Result<WorkspaceCreateResult, PluginCallError> {
    let mut session = PluginSession::spawn(plugin, workspace)?;
    let initialized = session
        .request(
            1,
            "initialize",
            json!({
                "protocolVersion": PROTOCOL_VERSION,
                "client": { "name": "codewide-companion" },
                "capabilities": [WORKSPACE_CREATE_CAPABILITY]
            }),
        )
        .await?;
    if !validate_initialize_metadata(plugin, &initialized, WORKSPACE_CREATE_CAPABILITY)? {
        session.shutdown().await;
        return Err(PluginCallError::CapabilityUnsupported);
    }
    let result = session
        .request_with_workspace_progress(
            2,
            "workspace.create",
            json!({
                "workspace": workspace,
                "requestId": request_id,
                "storageRoot": storage_root,
            }),
            request_id,
            plugin,
            &progress,
        )
        .await;
    session.shutdown().await;
    let created = serde_json::from_value::<WorkspaceCreateResult>(result?).map_err(|error| {
        PluginCallError::Protocol(format!("invalid workspace.create result: {error}"))
    })?;
    validate_workspace_result(plugin, &created)?;
    Ok(created)
}

fn validate_workspace_result(
    plugin: &VcsPluginConfig,
    created: &WorkspaceCreateResult,
) -> Result<(), PluginCallError> {
    if created.capability != WORKSPACE_CREATE_CAPABILITY {
        return Err(PluginCallError::Protocol(format!(
            "unexpected capability {}",
            created.capability
        )));
    }
    if created.provider != plugin.id {
        return Err(PluginCallError::Protocol(format!(
            "provider mismatch: expected {}, got {}",
            plugin.id, created.provider
        )));
    }
    if !created.repository_root.is_absolute() || !created.cwd.is_absolute() {
        return Err(PluginCallError::Protocol(
            "provider returned a relative workspace path".into(),
        ));
    }
    Ok(())
}

fn validate_workspace_support(
    plugin: &VcsPluginConfig,
    support: &WorkspaceSupport,
) -> Result<(), PluginCallError> {
    if support.capability != WORKSPACE_CREATE_CAPABILITY {
        return Err(PluginCallError::Protocol(format!(
            "unexpected capability {}",
            support.capability
        )));
    }
    if support.provider != plugin.id {
        return Err(PluginCallError::Protocol(format!(
            "provider mismatch: expected {}, got {}",
            plugin.id, support.provider
        )));
    }
    if !support.repository_root.is_absolute() {
        return Err(PluginCallError::Protocol(
            "provider returned a relative repository root".into(),
        ));
    }
    Ok(())
}

fn validate_initialize(
    plugin: &VcsPluginConfig,
    value: &Value,
    required_capability: &str,
) -> Result<(), PluginCallError> {
    if !validate_initialize_metadata(plugin, value, required_capability)? {
        return Err(PluginCallError::Protocol(format!(
            "provider does not advertise {required_capability}"
        )));
    }
    Ok(())
}

fn validate_initialize_metadata(
    plugin: &VcsPluginConfig,
    value: &Value,
    required_capability: &str,
) -> Result<bool, PluginCallError> {
    let protocol = value
        .get("protocolVersion")
        .and_then(Value::as_u64)
        .ok_or_else(|| {
            PluginCallError::Protocol("initialize result has no protocolVersion".into())
        })?;
    if protocol != u64::from(PROTOCOL_VERSION) {
        return Err(PluginCallError::Protocol(format!(
            "unsupported protocol version {protocol}"
        )));
    }
    let provider = value
        .get("provider")
        .and_then(Value::as_str)
        .ok_or_else(|| PluginCallError::Protocol("initialize result has no provider".into()))?;
    if provider != plugin.id {
        return Err(PluginCallError::Protocol(format!(
            "initialize provider mismatch: expected {}, got {provider}",
            plugin.id
        )));
    }
    let supports_capability = value
        .get("capabilities")
        .and_then(Value::as_array)
        .is_some_and(|capabilities| {
            capabilities
                .iter()
                .any(|capability| capability.as_str() == Some(required_capability))
        });
    Ok(supports_capability)
}

struct PluginSession {
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
}

impl PluginSession {
    fn spawn(plugin: &VcsPluginConfig, workspace: &Path) -> Result<Self, PluginCallError> {
        let mut child = Command::new(&plugin.executable)
            .args(&plugin.args)
            .current_dir(workspace)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .kill_on_drop(true)
            .spawn()
            .map_err(PluginCallError::Start)?;
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| PluginCallError::Transport("plugin stdin is unavailable".into()))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| PluginCallError::Transport("plugin stdout is unavailable".into()))?;
        Ok(Self {
            child,
            stdin,
            stdout: BufReader::new(stdout),
        })
    }

    async fn request(
        &mut self,
        id: u64,
        method: &str,
        params: Value,
    ) -> Result<Value, PluginCallError> {
        let request = json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": method,
            "params": params
        });
        let encoded = serde_json::to_vec(&request)
            .map_err(|error| PluginCallError::Protocol(error.to_string()))?;
        let operation = async {
            write_frame(&mut self.stdin, &encoded).await?;
            let response = read_frame(&mut self.stdout).await?;
            parse_response(id, &response)
        };
        timeout(request_timeout(method), operation)
            .await
            .map_err(|_| PluginCallError::Timeout)?
    }

    async fn request_with_workspace_progress(
        &mut self,
        id: u64,
        method: &str,
        params: Value,
        expected_request_id: &str,
        plugin: &VcsPluginConfig,
        progress: &tokio::sync::mpsc::UnboundedSender<WorkspaceCreateResult>,
    ) -> Result<Value, PluginCallError> {
        let request = json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": method,
            "params": params
        });
        let encoded = serde_json::to_vec(&request)
            .map_err(|error| PluginCallError::Protocol(error.to_string()))?;
        let operation = async {
            write_frame(&mut self.stdin, &encoded).await?;
            loop {
                let frame = read_frame(&mut self.stdout).await?;
                let message = serde_json::from_slice::<Value>(&frame).map_err(|error| {
                    PluginCallError::Protocol(format!("invalid JSON response: {error}"))
                })?;
                if message.get("id").is_some() {
                    return parse_response(id, &frame);
                }
                let workspace = parse_workspace_progress(&message, expected_request_id, plugin)?;
                progress.send(workspace).map_err(|_| {
                    PluginCallError::Transport("workspace progress receiver closed".into())
                })?;
            }
        };
        timeout(request_timeout(method), operation)
            .await
            .map_err(|_| PluginCallError::Timeout)?
    }

    async fn shutdown(&mut self) {
        let _ = self.stdin.shutdown().await;
        if timeout(Duration::from_millis(250), self.child.wait())
            .await
            .is_err()
        {
            let _ = self.child.start_kill();
            let _ = self.child.wait().await;
        }
    }
}

fn parse_workspace_progress(
    message: &Value,
    expected_request_id: &str,
    plugin: &VcsPluginConfig,
) -> Result<WorkspaceCreateResult, PluginCallError> {
    if message.get("jsonrpc").and_then(Value::as_str) != Some("2.0")
        || message.get("method").and_then(Value::as_str) != Some("workspace.progress")
    {
        return Err(PluginCallError::Protocol(
            "unexpected plugin notification while creating workspace".into(),
        ));
    }
    let params = message
        .get("params")
        .ok_or_else(|| PluginCallError::Protocol("workspace.progress has no params".into()))?;
    if params.get("requestId").and_then(Value::as_str) != Some(expected_request_id) {
        return Err(PluginCallError::Protocol(
            "workspace.progress requestId does not match".into(),
        ));
    }
    if params.get("phase").and_then(Value::as_str) != Some("preparing") {
        return Err(PluginCallError::Protocol(
            "workspace.progress has an unsupported phase".into(),
        ));
    }
    let workspace = serde_json::from_value::<WorkspaceCreateResult>(
        params.get("workspace").cloned().ok_or_else(|| {
            PluginCallError::Protocol("workspace.progress has no workspace".into())
        })?,
    )
    .map_err(|error| {
        PluginCallError::Protocol(format!("invalid workspace.progress workspace: {error}"))
    })?;
    validate_workspace_result(plugin, &workspace)?;
    Ok(workspace)
}

fn request_timeout(method: &str) -> Duration {
    if method == "workspace.create" {
        WORKSPACE_CREATE_TIMEOUT
    } else {
        REQUEST_TIMEOUT
    }
}

async fn write_frame(writer: &mut ChildStdin, payload: &[u8]) -> Result<(), PluginCallError> {
    if payload.len() > MAX_FRAME_BYTES {
        return Err(PluginCallError::Protocol(
            "request frame is too large".into(),
        ));
    }
    let header = format!("Content-Length: {}\r\n\r\n", payload.len());
    writer
        .write_all(header.as_bytes())
        .await
        .map_err(|error| PluginCallError::Transport(error.to_string()))?;
    writer
        .write_all(payload)
        .await
        .map_err(|error| PluginCallError::Transport(error.to_string()))?;
    writer
        .flush()
        .await
        .map_err(|error| PluginCallError::Transport(error.to_string()))
}

async fn read_frame(reader: &mut BufReader<ChildStdout>) -> Result<Vec<u8>, PluginCallError> {
    let mut content_length = None;
    loop {
        let mut line = String::new();
        let read = reader
            .read_line(&mut line)
            .await
            .map_err(|error| PluginCallError::Transport(error.to_string()))?;
        if read == 0 {
            return Err(PluginCallError::Transport(
                "plugin closed stdout before a response".into(),
            ));
        }
        if line == "\r\n" || line == "\n" {
            break;
        }
        let (name, value) = line
            .trim_end_matches(['\r', '\n'])
            .split_once(':')
            .ok_or_else(|| PluginCallError::Protocol("malformed frame header".into()))?;
        if name.eq_ignore_ascii_case("Content-Length") {
            content_length =
                Some(value.trim().parse::<usize>().map_err(|_| {
                    PluginCallError::Protocol("invalid Content-Length header".into())
                })?);
        }
    }
    let length = content_length
        .ok_or_else(|| PluginCallError::Protocol("missing Content-Length header".into()))?;
    if length > MAX_FRAME_BYTES {
        return Err(PluginCallError::Protocol(format!(
            "response frame exceeds {MAX_FRAME_BYTES} bytes"
        )));
    }
    let mut payload = vec![0; length];
    reader
        .read_exact(&mut payload)
        .await
        .map_err(|error| PluginCallError::Transport(error.to_string()))?;
    Ok(payload)
}

fn parse_response(id: u64, payload: &[u8]) -> Result<Value, PluginCallError> {
    let response = serde_json::from_slice::<Value>(payload)
        .map_err(|error| PluginCallError::Protocol(format!("invalid JSON response: {error}")))?;
    if response.get("jsonrpc").and_then(Value::as_str) != Some("2.0")
        || response.get("id").and_then(Value::as_u64) != Some(id)
    {
        return Err(PluginCallError::Protocol(
            "response JSON-RPC version or id does not match".into(),
        ));
    }
    if let Some(error) = response.get("error") {
        let code = error.get("code").and_then(Value::as_i64).unwrap_or(-32_603);
        let message = error
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or("unknown plugin error")
            .to_owned();
        if code == WORKSPACE_NOT_OWNED {
            return Err(PluginCallError::WorkspaceNotOwned);
        }
        return Err(PluginCallError::Remote { code, message });
    }
    response
        .get("result")
        .cloned()
        .ok_or_else(|| PluginCallError::Protocol("response has no result or error".into()))
}

#[cfg(test)]
#[allow(clippy::expect_used)]
mod tests {
    use super::*;

    #[test]
    fn workspace_creation_uses_the_long_running_timeout() {
        assert_eq!(
            request_timeout("workspace.create"),
            WORKSPACE_CREATE_TIMEOUT
        );
        assert_eq!(request_timeout("workspace.inspect"), REQUEST_TIMEOUT);
        assert_eq!(request_timeout("vcs.changes"), REQUEST_TIMEOUT);
    }

    #[test]
    fn registry_sorts_by_priority_and_replaces_id() {
        let directory = tempfile::tempdir().expect("temp directory");
        let executable = std::env::current_exe().expect("current executable");
        let registry = PluginRegistry::new(directory.path().join("plugins.json"));
        registry
            .install(VcsPluginConfig {
                id: "low".into(),
                executable: executable.clone(),
                args: Vec::new(),
                enabled: true,
                priority: 1,
            })
            .expect("low plugin installs");
        registry
            .install(VcsPluginConfig {
                id: "high".into(),
                executable,
                args: vec!["serve".into()],
                enabled: true,
                priority: 100,
            })
            .expect("high plugin installs");
        let plugins = registry.list().expect("registry loads");
        assert_eq!(plugins[0].id, "high");
        assert_eq!(plugins[1].id, "low");
        assert!(registry.remove("low").expect("plugin removes"));
        assert!(!registry.remove("missing").expect("missing plugin is safe"));
    }

    #[test]
    fn workspace_not_owned_is_distinct_from_plugin_failure() {
        let payload = br#"{"jsonrpc":"2.0","id":2,"error":{"code":-32004,"message":"not mine"}}"#;
        assert!(matches!(
            parse_response(2, payload),
            Err(PluginCallError::WorkspaceNotOwned)
        ));
    }

    #[test]
    fn accepts_only_matching_preparing_workspace_progress() {
        let plugin = VcsPluginConfig {
            id: "arc".into(),
            executable: PathBuf::from("/plugin"),
            args: Vec::new(),
            enabled: true,
            priority: 100,
        };
        let notification = json!({
            "jsonrpc": "2.0",
            "method": "workspace.progress",
            "params": {
                "requestId": "new-chat-1",
                "phase": "preparing",
                "workspace": {
                    "capability": WORKSPACE_CREATE_CAPABILITY,
                    "provider": "arc",
                    "repositoryRoot": "/workspace",
                    "cwd": "/workspace/project",
                    "created": true,
                }
            }
        });
        let workspace = parse_workspace_progress(&notification, "new-chat-1", &plugin)
            .expect("matching progress parses");
        assert_eq!(workspace.cwd, PathBuf::from("/workspace/project"));
        assert!(parse_workspace_progress(&notification, "different", &plugin).is_err());
    }
}
