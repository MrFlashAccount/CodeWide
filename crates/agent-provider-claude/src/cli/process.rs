//! One `claude` process speaking the stream-json protocol: spawn, the
//! companion's control requests with their answers, Claude's control
//! requests and conversation messages as events, and shutdown.
//!
//! The process's stdout is read by one task; an answer to a companion
//! request resolves that request, everything else becomes a
//! [`ProcessEvent`] in order. The last 8 KiB of stderr are kept for the
//! error a failed process reports. Request ids are `codewide-<n>`.

use std::{
    collections::HashMap,
    ffi::OsString,
    process::Stdio,
    sync::{
        Arc, Mutex, PoisonError,
        atomic::{AtomicU64, Ordering},
    },
    time::Duration,
};

use serde_json::Value;
use tokio::{
    io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader},
    process::{Child, ChildStdin, Command},
    sync::{mpsc, oneshot},
};

use super::{
    command::QueryOptions,
    protocol::{
        Author, ControlRequest, Inbound, Priority, classify_line, control_request_line,
        control_response_line, initialize_request, usage_request, user_message_line,
    },
};

const EVENT_CAPACITY: usize = 1_024;
const STDERR_TAIL_BYTES: usize = 8 * 1024;
const REQUEST_TIMEOUT: Duration = Duration::from_mins(1);
const EXIT_GRACE: Duration = Duration::from_secs(5);

/// What the process reports, in order.
#[derive(Clone, Debug, PartialEq)]
pub enum ProcessEvent {
    /// A conversation or system message.
    Message(Value),
    /// A request the session must answer with [`ClaudeProcess::respond`].
    Request {
        request_id: String,
        request: ControlRequest,
    },
    /// Claude stopped waiting for the answer to `request_id`.
    Cancelled { request_id: String },
    /// The process ended; `error` names a failure (a non-zero exit with its
    /// stderr tail), `None` a clean end.
    Exited { error: Option<String> },
}

#[derive(Debug, thiserror::Error)]
pub enum ProcessError {
    #[error("Claude process I/O failed: {0}")]
    Io(#[from] std::io::Error),
    #[error("Claude refused the request: {0}")]
    Rejected(String),
    #[error("Claude did not answer the request in time")]
    Timeout,
    #[error("Claude process has ended")]
    Ended,
}

/// Waiters for the answers to the companion's requests; `None` once the
/// process's output has ended, so no request waits for an answer that
/// cannot come.
type Pending = Arc<Mutex<Option<HashMap<String, oneshot::Sender<Result<Value, String>>>>>>;

/// A running `claude` process of one session.
pub struct ClaudeProcess {
    stdin: tokio::sync::Mutex<Option<ChildStdin>>,
    pending: Pending,
    next_id: AtomicU64,
    child: tokio::sync::Mutex<Child>,
}

impl ClaudeProcess {
    /// Starts `claude` with `options` and `environment` added to the
    /// companion's own, and returns it with its event stream.
    ///
    /// # Errors
    ///
    /// Returns the spawn error.
    pub fn spawn(
        options: &QueryOptions,
        environment: &[(OsString, OsString)],
    ) -> Result<(Self, mpsc::Receiver<ProcessEvent>), ProcessError> {
        let mut command = Command::new(&options.executable);
        command
            .args(options.args())
            .current_dir(&options.cwd)
            .envs(environment.iter().cloned())
            .env_remove("NODE_OPTIONS")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            // Sessions CodeWide drives are recorded as programmatic, as under
            // the Agent SDK, so they never pass for a person's own sessions.
            .env("CLAUDE_CODE_ENTRYPOINT", "sdk-ts")
            .kill_on_drop(true);
        let mut child = command.spawn()?;
        let stdin = child.stdin.take();
        let stdout = child.stdout.take().ok_or(ProcessError::Ended)?;
        let stderr = child.stderr.take().ok_or(ProcessError::Ended)?;
        let pending: Pending = Arc::new(Mutex::new(Some(HashMap::new())));
        let tail = Arc::new(Mutex::new(String::new()));
        let (events, receiver) = mpsc::channel(EVENT_CAPACITY);
        tokio::spawn(keep_stderr_tail(stderr, tail.clone()));
        let process = Self {
            stdin: tokio::sync::Mutex::new(stdin),
            pending: pending.clone(),
            next_id: AtomicU64::new(1),
            child: tokio::sync::Mutex::new(child),
        };
        tokio::spawn(read_stdout(stdout, pending, events, tail));
        Ok((process, receiver))
    }

    async fn write_line(&self, line: &str) -> Result<(), ProcessError> {
        let mut stdin = self.stdin.lock().await;
        let stdin = stdin.as_mut().ok_or(ProcessError::Ended)?;
        stdin.write_all(line.as_bytes()).await?;
        stdin.write_all(b"\n").await?;
        stdin.flush().await?;
        Ok(())
    }

    /// Sends a control request and waits for its answer.
    ///
    /// # Errors
    ///
    /// Returns Claude's refusal, a write failure, the timeout, or the end of
    /// the process.
    pub async fn request(&self, request: &Value) -> Result<Value, ProcessError> {
        let request_id = format!("codewide-{}", self.next_id.fetch_add(1, Ordering::Relaxed));
        let (sender, answer) = oneshot::channel();
        self.pending
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .as_mut()
            .ok_or(ProcessError::Ended)?
            .insert(request_id.clone(), sender);
        if let Err(error) = self
            .write_line(&control_request_line(&request_id, request))
            .await
        {
            self.forget(&request_id);
            return Err(error);
        }
        match tokio::time::timeout(REQUEST_TIMEOUT, answer).await {
            Ok(Ok(Ok(response))) => Ok(response),
            Ok(Ok(Err(error))) => Err(ProcessError::Rejected(error)),
            Ok(Err(_)) => Err(ProcessError::Ended),
            Err(_) => {
                self.forget(&request_id);
                Err(ProcessError::Timeout)
            }
        }
    }

    fn forget(&self, request_id: &str) {
        if let Some(pending) = self
            .pending
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .as_mut()
        {
            pending.remove(request_id);
        }
    }

    /// The `initialize` handshake.
    ///
    /// # Errors
    ///
    /// See [`Self::request`].
    pub async fn initialize(&self, sdk_mcp_servers: &[&str]) -> Result<Value, ProcessError> {
        self.request(&initialize_request(sdk_mcp_servers)).await
    }

    /// Offers a user message; `uuid` is the id Claude stores it under.
    ///
    /// # Errors
    ///
    /// Returns a write failure or the end of the process.
    pub async fn send_user(
        &self,
        content: &Value,
        uuid: Option<&str>,
        priority: Priority,
        author: Author,
    ) -> Result<(), ProcessError> {
        self.write_line(&user_message_line(content, uuid, priority, author))
            .await
    }

    /// Reads the plan's rate limits (`get_usage`); its shape is Claude's
    /// and validated by the reader.
    ///
    /// # Errors
    ///
    /// See [`Self::request`].
    pub async fn read_usage(&self) -> Result<Value, ProcessError> {
        self.request(&usage_request()).await
    }

    /// Answers one of Claude's control requests.
    ///
    /// # Errors
    ///
    /// Returns a write failure or the end of the process.
    pub async fn respond(
        &self,
        request_id: &str,
        outcome: Result<&Value, &str>,
    ) -> Result<(), ProcessError> {
        self.write_line(&control_response_line(request_id, outcome))
            .await
    }

    /// Interrupts the running turn.
    ///
    /// # Errors
    ///
    /// See [`Self::request`].
    pub async fn interrupt(&self) -> Result<(), ProcessError> {
        self.request(&serde_json::json!({"subtype": "interrupt"}))
            .await
            .map(|_| ())
    }

    /// Moves the session to another permission mode.
    ///
    /// # Errors
    ///
    /// See [`Self::request`].
    pub async fn set_permission_mode(&self, mode: &str) -> Result<(), ProcessError> {
        self.request(&serde_json::json!({"subtype": "set_permission_mode", "mode": mode}))
            .await
            .map(|_| ())
    }

    /// Ends the input; the process finishes its work and exits, and is
    /// killed when it has not after a grace period.
    pub async fn close(&self) {
        self.stdin.lock().await.take();
        let mut child = self.child.lock().await;
        if tokio::time::timeout(EXIT_GRACE, child.wait())
            .await
            .is_err()
        {
            let _ = child.kill().await;
        }
    }
}

async fn keep_stderr_tail(stderr: tokio::process::ChildStderr, tail: Arc<Mutex<String>>) {
    let mut reader = BufReader::new(stderr);
    let mut buffer = vec![0_u8; 4096];
    while let Ok(read) = reader.read(&mut buffer).await {
        if read == 0 {
            break;
        }
        let mut tail = tail.lock().unwrap_or_else(PoisonError::into_inner);
        tail.push_str(&String::from_utf8_lossy(&buffer[..read]));
        if tail.len() > STDERR_TAIL_BYTES {
            let mut cut = tail.len() - STDERR_TAIL_BYTES;
            while !tail.is_char_boundary(cut) {
                cut += 1;
            }
            tail.drain(..cut);
        }
    }
}

async fn read_stdout(
    stdout: tokio::process::ChildStdout,
    pending: Pending,
    events: mpsc::Sender<ProcessEvent>,
    tail: Arc<Mutex<String>>,
) {
    let mut lines = BufReader::new(stdout).lines();
    while let Ok(Some(line)) = lines.next_line().await {
        if line.trim().is_empty() {
            continue;
        }
        let event = match classify_line(&line) {
            Inbound::ControlResponse {
                request_id,
                outcome,
            } => {
                let waiter = pending
                    .lock()
                    .unwrap_or_else(PoisonError::into_inner)
                    .as_mut()
                    .and_then(|pending| pending.remove(&request_id));
                if let Some(waiter) = waiter {
                    let _ = waiter.send(outcome);
                }
                continue;
            }
            Inbound::ControlRequest {
                request_id,
                request,
            } => ProcessEvent::Request {
                request_id,
                request,
            },
            Inbound::ControlCancel { request_id } => ProcessEvent::Cancelled { request_id },
            Inbound::Message(message) => ProcessEvent::Message(message),
        };
        if events.send(event).await.is_err() {
            return;
        }
    }
    // Every waiter, and every later request, learns the process ended.
    pending
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .take();
    let tail = tail
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .trim()
        .to_owned();
    let _ = events
        .send(ProcessEvent::Exited {
            error: (!tail.is_empty()).then_some(tail),
        })
        .await;
}
