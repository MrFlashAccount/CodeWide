//! The companion side of the forge plugin protocol: spawn, `initialize`,
//! capability check, typed calls with timeouts, and a bounded number of
//! concurrent plugin processes.
//!
//! A plugin runs without a shell, with the companion environment (`gh` and
//! `arc` need `HOME` and `PATH`), in its own state directory, and with
//! stderr discarded so host-tool diagnostics never reach companion logs.
//! Params and results are never logged: they can carry forge content, and
//! one `auth.start` carries a pasted token.

use std::{
    os::unix::fs::PermissionsExt as _, path::PathBuf, process::Stdio, sync::Arc, time::Duration,
};

use forge_protocol::{
    ClientInfo, FrameError, InitializeParams, InitializeResult, PROTOCOL_VERSION, capability,
    methods, read_frame, write_frame,
};
use serde::{Serialize, de::DeserializeOwned};
use serde_json::{Value, json};
use tokio::{
    io::{AsyncWriteExt as _, BufReader},
    process::{Child, ChildStdin, ChildStdout, Command},
    sync::{OwnedSemaphorePermit, Semaphore},
    time::timeout,
};
use tracing::info;

use super::limits;

/// Every capability this companion understands, sent in `initialize`.
const KNOWN_CAPABILITIES: [&str; 15] = [
    capability::AUTH,
    capability::LIST,
    capability::SEARCH,
    capability::READ,
    capability::DIFF,
    capability::ACTIONS,
    capability::REVIEW,
    capability::CHECKS,
    capability::VIEWED,
    capability::RESOLVE,
    capability::SCENARIO_CONTEXT,
    capability::CONVERSATION,
    capability::COMMENTS,
    capability::RESOLVE_CONVERSATION,
    capability::FILE_CONTENT,
];

/// How to start one plugin.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PluginSpec {
    pub plugin_id: String,
    pub executable: PathBuf,
    pub args: Vec<String>,
    /// The plugin's own directory under the companion state directory.
    pub state_directory: PathBuf,
}

#[derive(Debug, thiserror::Error)]
pub enum PluginCallError {
    #[error("the plugin executable is missing")]
    Missing,
    #[error("the plugin could not start")]
    Start(#[source] std::io::Error),
    #[error("too many forge plugin processes are running")]
    Busy,
    #[error("the plugin request timed out")]
    Timeout,
    #[error("plugin transport failed: {0}")]
    Transport(String),
    #[error("plugin protocol failed: {0}")]
    Protocol(String),
    #[error("the plugin does not declare {0}")]
    CapabilityMissing(String),
    #[error("plugin error {code}")]
    Remote {
        code: i64,
        message: String,
        data: Option<Value>,
    },
}

impl From<FrameError> for PluginCallError {
    fn from(error: FrameError) -> Self {
        Self::Transport(error.to_string())
    }
}

/// The companion-wide bound on concurrent plugin processes.
#[derive(Clone)]
pub struct ProcessLimiter {
    permits: Arc<Semaphore>,
}

impl Default for ProcessLimiter {
    fn default() -> Self {
        Self::new(limits::MAX_PLUGIN_PROCESSES)
    }
}

impl ProcessLimiter {
    #[must_use]
    pub fn new(processes: usize) -> Self {
        Self {
            permits: Arc::new(Semaphore::new(processes)),
        }
    }

    async fn acquire(&self) -> Result<OwnedSemaphorePermit, PluginCallError> {
        timeout(
            limits::PLUGIN_SLOT_WAIT,
            self.permits.clone().acquire_owned(),
        )
        .await
        .map_err(|_| PluginCallError::Busy)?
        .map_err(|_| PluginCallError::Busy)
    }
}

/// One running plugin process after a successful `initialize`.
pub struct PluginSession {
    plugin_id: String,
    child: Child,
    stdin: Option<ChildStdin>,
    stdout: BufReader<ChildStdout>,
    next_id: u64,
    info: InitializeResult,
    poisoned: bool,
    _permit: OwnedSemaphorePermit,
}

impl PluginSession {
    /// Spawns and initializes a plugin.
    ///
    /// # Errors
    ///
    /// Returns an error when no process slot frees up, the plugin cannot
    /// start, or its `initialize` result is invalid or names another
    /// provider, protocol version or an incomplete capability set.
    pub async fn open(
        spec: &PluginSpec,
        limiter: &ProcessLimiter,
    ) -> Result<Self, PluginCallError> {
        if !spec.executable.is_file() {
            return Err(PluginCallError::Missing);
        }
        let permit = limiter.acquire().await?;
        std::fs::create_dir_all(&spec.state_directory).map_err(PluginCallError::Start)?;
        std::fs::set_permissions(
            &spec.state_directory,
            std::fs::Permissions::from_mode(0o700),
        )
        .map_err(PluginCallError::Start)?;
        let mut child = Command::new(&spec.executable)
            .args(&spec.args)
            .current_dir(&spec.state_directory)
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
        let mut session = Self {
            plugin_id: spec.plugin_id.clone(),
            child,
            stdin: Some(stdin),
            stdout: BufReader::new(stdout),
            next_id: 1,
            info: InitializeResult {
                protocol_version: PROTOCOL_VERSION,
                provider: spec.plugin_id.clone(),
                forge_name: String::new(),
                version: String::new(),
                default_host: None,
                provider_icon: None,
                capabilities: Vec::new(),
                media_hosts: Vec::new(),
                web_hosts: Vec::new(),
            },
            poisoned: false,
            _permit: permit,
        };
        let params = InitializeParams {
            protocol_version: PROTOCOL_VERSION,
            client: ClientInfo {
                name: "codewide-companion".into(),
            },
            capabilities: KNOWN_CAPABILITIES
                .iter()
                .map(|&cap| cap.to_owned())
                .collect(),
            state_directory: spec.state_directory.clone(),
        };
        let info: InitializeResult = session
            .raw_call(methods::INITIALIZE, &params, limits::PLUGIN_CALL_TIMEOUT)
            .await?;
        if info.protocol_version != PROTOCOL_VERSION {
            return Err(PluginCallError::Protocol(format!(
                "unsupported protocol version {}",
                info.protocol_version
            )));
        }
        if info.provider != spec.plugin_id {
            return Err(PluginCallError::Protocol(
                "initialize names another provider".into(),
            ));
        }
        if let Some(missing) = capability::REQUIRED
            .iter()
            .find(|required| !info.capabilities.iter().any(|cap| cap == *required))
        {
            return Err(PluginCallError::Protocol(format!(
                "the plugin does not declare required {missing}"
            )));
        }
        info!(
            plugin_id = %spec.plugin_id,
            plugin_version = %info.version,
            "forge plugin initialized"
        );
        session.info = info;
        Ok(session)
    }

    #[must_use]
    pub fn info(&self) -> &InitializeResult {
        &self.info
    }

    #[must_use]
    pub fn supports(&self, capability: &str) -> bool {
        self.info.capabilities.iter().any(|cap| cap == capability)
    }

    /// One typed request; the method's capability must be declared.
    ///
    /// # Errors
    ///
    /// Returns [`PluginCallError::CapabilityMissing`] without contacting the
    /// plugin, a typed remote error, or a transport, protocol or timeout
    /// failure (after which the session is unusable).
    pub async fn call<P: Serialize + Sync, R: DeserializeOwned>(
        &mut self,
        method: &str,
        params: &P,
    ) -> Result<R, PluginCallError> {
        if let Some(required) = methods::required_capability(method)
            && !self.supports(required)
        {
            return Err(PluginCallError::CapabilityMissing(required.to_owned()));
        }
        self.raw_call(method, params, limits::call_timeout(method))
            .await
    }

    async fn raw_call<P: Serialize + Sync, R: DeserializeOwned>(
        &mut self,
        method: &str,
        params: &P,
        limit: Duration,
    ) -> Result<R, PluginCallError> {
        if self.poisoned {
            return Err(PluginCallError::Transport(
                "the plugin session failed earlier".into(),
            ));
        }
        let id = self.next_id;
        self.next_id += 1;
        let request = json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": method,
            "params": params,
        });
        let encoded = serde_json::to_vec(&request)
            .map_err(|error| PluginCallError::Protocol(error.to_string()))?;
        let stdin = self
            .stdin
            .as_mut()
            .ok_or_else(|| PluginCallError::Transport("the plugin session is closed".into()))?;
        let stdout = &mut self.stdout;
        let exchange = async {
            write_frame(stdin, &encoded).await?;
            read_frame(stdout)
                .await?
                .ok_or_else(|| PluginCallError::Transport("plugin closed stdout".into()))
        };
        let frame = match timeout(limit, exchange).await {
            Ok(Ok(frame)) => frame,
            Ok(Err(error)) => {
                self.poisoned = true;
                return Err(error);
            }
            Err(_) => {
                self.poisoned = true;
                return Err(PluginCallError::Timeout);
            }
        };
        let value = parse_response(id, &frame).inspect_err(|error| {
            if !matches!(error, PluginCallError::Remote { .. }) {
                self.poisoned = true;
            }
        })?;
        serde_json::from_value(value)
            .map_err(|error| PluginCallError::Protocol(format!("invalid {method} result: {error}")))
    }

    /// Closes stdin and waits briefly; a plugin that does not exit is
    /// killed. Closing stdin is also how a host login flow is cancelled.
    pub async fn shutdown(mut self) {
        if let Some(mut stdin) = self.stdin.take() {
            let _ = stdin.shutdown().await;
        }
        if timeout(limits::PLUGIN_EXIT_WAIT, self.child.wait())
            .await
            .is_err()
        {
            let _ = self.child.start_kill();
            let _ = self.child.wait().await;
        }
    }

    #[must_use]
    pub fn plugin_id(&self) -> &str {
        &self.plugin_id
    }
}

fn parse_response(id: u64, frame: &[u8]) -> Result<Value, PluginCallError> {
    let response = serde_json::from_slice::<Value>(frame)
        .map_err(|_| PluginCallError::Protocol("invalid JSON response".into()))?;
    if response.get("jsonrpc").and_then(Value::as_str) != Some("2.0")
        || response.get("id").and_then(Value::as_u64) != Some(id)
    {
        return Err(PluginCallError::Protocol(
            "response JSON-RPC version or id does not match".into(),
        ));
    }
    if let Some(error) = response.get("error") {
        return Err(PluginCallError::Remote {
            code: error
                .get("code")
                .and_then(Value::as_i64)
                .unwrap_or(forge_protocol::code::INTERNAL),
            message: error
                .get("message")
                .and_then(Value::as_str)
                .unwrap_or("plugin error")
                .to_owned(),
            data: error.get("data").cloned(),
        });
    }
    response
        .get("result")
        .cloned()
        .ok_or_else(|| PluginCallError::Protocol("response has no result or error".into()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn remote_errors_keep_code_and_data() {
        let frame = br#"{"jsonrpc":"2.0","id":3,"error":{"code":-32112,"message":"moved","data":{"headRevision":"b"}}}"#;
        match parse_response(3, frame) {
            Err(PluginCallError::Remote { code, data, .. }) => {
                assert_eq!(code, -32_112);
                assert_eq!(data, Some(json!({"headRevision": "b"})));
            }
            other => panic!("unexpected {other:?}"),
        }
        assert!(matches!(
            parse_response(4, frame),
            Err(PluginCallError::Protocol(_))
        ));
    }
}
