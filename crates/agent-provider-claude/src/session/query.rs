//! The live query a session drives: one `claude` process, or a test double.
//!
//! A query is written to in order: `initialize` first, then the user
//! messages and the answers to Claude's requests, as the Agent SDK writes
//! them (nothing before the `initialize` answer). Writes are queued and never
//! block the session; the companion's own control requests (`interrupt`,
//! `set_permission_mode`, `get_usage`) are futures the session awaits off its
//! loop. Events arrive on the receiver `open` returns.

use std::{ffi::OsString, future::Future, pin::Pin, sync::Arc};

use serde_json::Value;
use tokio::sync::{mpsc, watch};
use tokio_util::task::TaskTracker;
use tracing::warn;

use crate::cli::{
    command::QueryOptions,
    process::{ClaudeProcess, ProcessError, ProcessEvent},
    protocol::{Author, Priority},
};

/// A request the session awaits off its loop.
pub type BoxFuture<'a, Output> = Pin<Box<dyn Future<Output = Output> + Send + 'a>>;

/// One user message offered to the query.
#[derive(Clone, Debug, PartialEq)]
pub struct Offer {
    /// Messages API content blocks.
    pub content: Vec<Value>,
    /// The uuid Claude persists the message under and acknowledges it by.
    pub uuid: String,
    pub priority: Priority,
    pub author: Author,
}

/// The query of one session.
pub trait Query: Send + Sync {
    /// Resolves once Claude answered `initialize`; fails with
    /// [`ProcessError::Unsupported`] when that `claude` cannot report its
    /// session state, or when the process ended first. Default: a query
    /// without a handshake (a test double).
    fn initialized(&self) -> BoxFuture<'static, Result<(), ProcessError>> {
        Box::pin(std::future::ready(Ok(())))
    }
    /// Queues a user message.
    fn offer(&self, offer: Offer);
    /// Queues the answer to Claude's request `request_id`.
    fn respond(&self, request_id: String, outcome: Result<Value, String>);
    fn interrupt(&self) -> BoxFuture<'static, Result<(), ProcessError>>;
    fn set_permission_mode(
        &self,
        mode: &'static str,
    ) -> BoxFuture<'static, Result<(), ProcessError>>;
    /// The plan rate-limit read.
    fn read_usage(&self) -> BoxFuture<'static, Result<Value, ProcessError>>;
    /// Ends the query; its process finishes and exits.
    fn close(&self);
}

/// Opens queries.
pub trait QueryRuntime: Send + Sync {
    /// Starts a query; its events, ending with `Exited`, arrive on the receiver.
    ///
    /// # Errors
    ///
    /// Returns the spawn failure.
    fn open(
        &self,
        options: &QueryOptions,
    ) -> Result<(Arc<dyn Query>, mpsc::Receiver<ProcessEvent>), ProcessError>;

    /// Resolves once the process of every query this runtime opened has
    /// exited; closed queries' processes exit on their own. Default: a
    /// runtime that runs no process.
    fn ended(&self) -> BoxFuture<'static, ()> {
        Box::pin(std::future::ready(()))
    }
}

/// Queries as `claude` processes with the companion's environment plus
/// `environment`.
pub struct CliRuntime {
    environment: Vec<(OsString, OsString)>,
    /// One writer per process; each ends with its process's exit.
    writers: TaskTracker,
}

impl CliRuntime {
    #[must_use]
    pub fn new(environment: Vec<(OsString, OsString)>) -> Self {
        Self {
            environment,
            writers: TaskTracker::new(),
        }
    }
}

impl QueryRuntime for CliRuntime {
    fn open(
        &self,
        options: &QueryOptions,
    ) -> Result<(Arc<dyn Query>, mpsc::Receiver<ProcessEvent>), ProcessError> {
        let (process, events) = ClaudeProcess::spawn(options, &self.environment)?;
        let process = Arc::new(process);
        let (outbound, queue) = mpsc::unbounded_channel();
        let (initialized, ready) = watch::channel(Initialization::Pending);
        let servers = options.sdk_mcp_servers();
        self.writers
            .spawn(write_in_order(process.clone(), servers, queue, initialized));
        Ok((
            Arc::new(CliQuery {
                process,
                outbound,
                ready,
            }),
            events,
        ))
    }

    fn ended(&self) -> BoxFuture<'static, ()> {
        let writers = self.writers.clone();
        Box::pin(async move {
            writers.close();
            writers.wait().await;
        })
    }
}

enum Outbound {
    User(Offer),
    Respond {
        request_id: String,
        outcome: Result<Value, String>,
    },
    Close,
}

/// What the `initialize` answer established.
#[derive(Clone, Debug, PartialEq, Eq)]
enum Initialization {
    Pending,
    Ready,
    /// The answer has no `session_state`; the version Claude reported.
    Unsupported {
        version: String,
    },
}

struct CliQuery {
    process: Arc<ClaudeProcess>,
    outbound: mpsc::UnboundedSender<Outbound>,
    ready: watch::Receiver<Initialization>,
}

impl CliQuery {
    /// Waits for the `initialize` answer, then runs `request`.
    fn after_initialize<Output: Send + 'static>(
        &self,
        request: impl FnOnce(Arc<ClaudeProcess>) -> BoxFuture<'static, Result<Output, ProcessError>>
        + Send
        + 'static,
    ) -> BoxFuture<'static, Result<Output, ProcessError>> {
        let ready = self.initialized();
        let process = self.process.clone();
        Box::pin(async move {
            ready.await?;
            request(process).await
        })
    }
}

impl Query for CliQuery {
    fn initialized(&self) -> BoxFuture<'static, Result<(), ProcessError>> {
        let mut ready = self.ready.clone();
        Box::pin(async move {
            let initialization = ready
                .wait_for(|initialization| *initialization != Initialization::Pending)
                .await
                .map_err(|_| ProcessError::Ended)?;
            match &*initialization {
                Initialization::Unsupported { version } => Err(ProcessError::Unsupported {
                    version: version.clone(),
                }),
                Initialization::Pending | Initialization::Ready => Ok(()),
            }
        })
    }

    fn offer(&self, offer: Offer) {
        let _ = self.outbound.send(Outbound::User(offer));
    }

    fn respond(&self, request_id: String, outcome: Result<Value, String>) {
        let _ = self.outbound.send(Outbound::Respond {
            request_id,
            outcome,
        });
    }

    fn interrupt(&self) -> BoxFuture<'static, Result<(), ProcessError>> {
        self.after_initialize(|process| Box::pin(async move { process.interrupt().await }))
    }

    fn set_permission_mode(
        &self,
        mode: &'static str,
    ) -> BoxFuture<'static, Result<(), ProcessError>> {
        self.after_initialize(move |process| {
            Box::pin(async move { process.set_permission_mode(mode).await })
        })
    }

    fn read_usage(&self) -> BoxFuture<'static, Result<Value, ProcessError>> {
        self.after_initialize(|process| Box::pin(async move { process.read_usage().await }))
    }

    fn close(&self) {
        let _ = self.outbound.send(Outbound::Close);
    }
}

/// The single writer of one process: `initialize`, then every queued write
/// in order. A failed `initialize` is logged; the process's exit then ends
/// the session's query. A `claude` without session state writes nothing
/// more: the session closes the query once it learned why.
async fn write_in_order(
    process: Arc<ClaudeProcess>,
    servers: Vec<&'static str>,
    mut queue: mpsc::UnboundedReceiver<Outbound>,
    initialized: watch::Sender<Initialization>,
) {
    let answer = match process.initialize(&servers).await {
        Ok(answer) => answer,
        Err(err) => {
            warn!(err = %err, "Claude did not accept the session's initialize request");
            process.close().await;
            return;
        }
    };
    if answer.get("session_state").is_none() {
        let version = answer
            .get("claude_code_version")
            .and_then(Value::as_str)
            .unwrap_or("unknown")
            .to_owned();
        let _ = initialized.send(Initialization::Unsupported { version });
        while let Some(outbound) = queue.recv().await {
            if matches!(outbound, Outbound::Close) {
                break;
            }
        }
        process.close().await;
        return;
    }
    let _ = initialized.send(Initialization::Ready);
    while let Some(outbound) = queue.recv().await {
        let written = match outbound {
            Outbound::User(offer) => {
                process
                    .send_user(
                        &Value::Array(offer.content),
                        Some(&offer.uuid),
                        offer.priority,
                        offer.author,
                    )
                    .await
            }
            Outbound::Respond {
                request_id,
                outcome,
            } => {
                process
                    .respond(&request_id, outcome.as_ref().map_err(String::as_str))
                    .await
            }
            Outbound::Close => break,
        };
        if let Err(err) = written {
            warn!(err = %err, "a write to the Claude process failed");
            break;
        }
    }
    process.close().await;
}

#[cfg(test)]
mod tests {
    use std::{path::Path, time::Duration};

    use super::*;
    use crate::{
        cli::command::{SessionIdentity, profile_options},
        test_scripts::fake_claude,
    };

    /// Answers `initialize`, then reads until its input ends and records
    /// that it ended on its own.
    const FAKE_CLAUDE: &str = r#"#!/bin/sh
read -r init
printf '%s\n' '{"type":"control_response","response":{"subtype":"success","request_id":"codewide-1","response":{"commands":[]}}}'
while read -r line; do :; done
echo ended > ended.log
"#;

    fn options(directory: &Path) -> QueryOptions {
        QueryOptions {
            executable: fake_claude(directory, FAKE_CLAUDE),
            cwd: directory.to_owned(),
            model: "opus".into(),
            effort: None,
            profile: profile_options(":workspace").unwrap_or_else(|| unreachable!()),
            identity: SessionIdentity::New("s1".into()),
            client_tools: false,
        }
    }

    /// Answers `initialize` with `answer`, then reads until its input ends.
    fn answering(answer: &str) -> String {
        format!(
            "#!/bin/sh\nread -r init\nprintf '%s\\n' '{{\"type\":\"control_response\",\"response\":{{\"subtype\":\"success\",\"request_id\":\"codewide-1\",\"response\":{answer}}}}}'\nwhile read -r line; do :; done\n"
        )
    }

    async fn initialized_with(answer: &str) -> Result<(), ProcessError> {
        let directory = tempfile::tempdir().unwrap_or_else(|error| panic!("{error}"));
        let mut options = options(directory.path());
        options.executable = fake_claude(directory.path(), &answering(answer));
        let runtime = CliRuntime::new(Vec::new());
        let (query, _events) = runtime
            .open(&options)
            .unwrap_or_else(|error| panic!("{error}"));
        let initialized = tokio::time::timeout(Duration::from_secs(10), query.initialized())
            .await
            .unwrap_or_else(|_| panic!("initialize was not answered"));
        query.close();
        initialized
    }

    #[tokio::test]
    async fn a_claude_reporting_its_session_state_initializes() {
        let initialized = initialized_with(
            r#"{"commands":[],"session_state":"idle","claude_code_version":"2.1.310"}"#,
        )
        .await;
        assert!(initialized.is_ok(), "{initialized:?}");
    }

    #[tokio::test]
    async fn a_claude_without_session_state_is_unsupported_with_its_version() {
        let initialized =
            initialized_with(r#"{"commands":[],"claude_code_version":"2.0.1"}"#).await;
        assert!(
            matches!(&initialized, Err(ProcessError::Unsupported { version }) if version == "2.0.1"),
            "{initialized:?}"
        );
    }

    #[tokio::test]
    async fn ended_waits_until_closed_processes_exit_on_their_own() {
        let directory = tempfile::tempdir().unwrap_or_else(|error| panic!("{error}"));
        let runtime = CliRuntime::new(Vec::new());
        let (query, _events) = runtime
            .open(&options(directory.path()))
            .unwrap_or_else(|error| panic!("{error}"));
        query.close();
        tokio::time::timeout(Duration::from_secs(10), runtime.ended())
            .await
            .unwrap_or_else(|_| panic!("the closed process did not exit"));
        assert!(
            directory.path().join("ended.log").is_file(),
            "the process was killed instead of reading the end of its input"
        );
    }
}
