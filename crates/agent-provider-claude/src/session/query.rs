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
use tracing::warn;

use crate::cli::{
    command::QueryOptions,
    process::{ClaudeProcess, ProcessError, ProcessEvent},
    protocol::Priority,
};

/// A request the session awaits off its loop.
pub type BoxFuture<'a, Output> = Pin<Box<dyn Future<Output = Output> + Send + 'a>>;

/// One user message offered to the query.
#[derive(Clone, Debug, PartialEq)]
pub struct Offer {
    /// Messages API content blocks.
    pub content: Vec<Value>,
    /// The uuid Claude persists the message under.
    pub uuid: Option<String>,
    pub priority: Priority,
}

/// The query of one session.
pub trait Query: Send + Sync {
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
}

/// Queries as `claude` processes with the companion's environment plus
/// `environment`.
pub struct CliRuntime {
    pub environment: Vec<(OsString, OsString)>,
}

impl QueryRuntime for CliRuntime {
    fn open(
        &self,
        options: &QueryOptions,
    ) -> Result<(Arc<dyn Query>, mpsc::Receiver<ProcessEvent>), ProcessError> {
        let (process, events) = ClaudeProcess::spawn(options, &self.environment)?;
        let process = Arc::new(process);
        let (outbound, queue) = mpsc::unbounded_channel();
        let (initialized, ready) = watch::channel(false);
        let servers = options.sdk_mcp_servers();
        tokio::spawn(write_in_order(process.clone(), servers, queue, initialized));
        Ok((
            Arc::new(CliQuery {
                process,
                outbound,
                ready,
            }),
            events,
        ))
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

struct CliQuery {
    process: Arc<ClaudeProcess>,
    outbound: mpsc::UnboundedSender<Outbound>,
    ready: watch::Receiver<bool>,
}

impl CliQuery {
    /// Waits for the `initialize` answer, then runs `request`.
    fn after_initialize<Output: Send + 'static>(
        &self,
        request: impl FnOnce(Arc<ClaudeProcess>) -> BoxFuture<'static, Result<Output, ProcessError>>
        + Send
        + 'static,
    ) -> BoxFuture<'static, Result<Output, ProcessError>> {
        let mut ready = self.ready.clone();
        let process = self.process.clone();
        Box::pin(async move {
            ready
                .wait_for(|ready| *ready)
                .await
                .map_err(|_| ProcessError::Ended)?;
            request(process).await
        })
    }
}

impl Query for CliQuery {
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
/// the session's query.
async fn write_in_order(
    process: Arc<ClaudeProcess>,
    servers: Vec<&'static str>,
    mut queue: mpsc::UnboundedReceiver<Outbound>,
    initialized: watch::Sender<bool>,
) {
    if let Err(err) = process.initialize(&servers).await {
        warn!(err = %err, "Claude did not accept the session's initialize request");
        process.close().await;
        return;
    }
    let _ = initialized.send(true);
    while let Some(outbound) = queue.recv().await {
        let written = match outbound {
            Outbound::User(offer) => {
                process
                    .send_user(
                        &Value::Array(offer.content),
                        offer.uuid.as_deref(),
                        offer.priority,
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
