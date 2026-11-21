//! The narrow contract between orchestration and the owner of a thread's
//! pending runtime requests to a person (approvals, user input).
//!
//! The sync transport owns those requests (it holds them for the devices and
//! resolves the first answer); orchestration only reads a linked child's
//! pending requests, subscribes to their changes and answers one through the
//! same resolution path a device uses. The view here is provider-neutral and
//! is the shape the agent tools report (`awaitingInput`).

use async_trait::async_trait;
use serde::{Deserialize, Serialize};

use crate::agent::model::{AppThreadId, ApprovalDecision, RuntimeResponse};

/// One runtime request of a thread that waits for a person's answer.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingInput {
    /// Opaque id, passed back to `codewide_answer_agent`.
    pub request_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub turn_id: Option<String>,
    #[serde(flatten)]
    pub request: InputRequest,
}

/// What the request asks. Only `userInput` and `approval` can be answered
/// by a parent agent; the other kinds are answered in the child's thread.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum InputRequest {
    /// Questions to the user (for example Claude's `AskUserQuestion`).
    UserInput { questions: Vec<InputQuestion> },
    /// Approval of a command or a file change.
    Approval {
        action: ApprovalAction,
        #[serde(skip_serializing_if = "Option::is_none")]
        title: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        command: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        cwd: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        reason: Option<String>,
        /// The decisions the request accepts; empty when it does not say.
        decisions: Vec<ApprovalDecision>,
    },
    /// A permission grant (answered in the child's thread).
    Permissions {
        #[serde(skip_serializing_if = "Option::is_none")]
        reason: Option<String>,
    },
    /// An MCP server's question (answered in the child's thread).
    Elicitation {
        #[serde(skip_serializing_if = "Option::is_none")]
        message: Option<String>,
    },
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ApprovalAction {
    Command,
    FileChange,
}

/// One question of a user-input request.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InputQuestion {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub header: Option<String>,
    pub question: String,
    pub options: Vec<InputOption>,
    /// A free-text answer outside `options` is accepted.
    pub allows_other: bool,
    pub secret: bool,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InputOption {
    pub label: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

/// Why an answer was not delivered.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum InputAnswerRejection {
    /// No such pending request: already answered (by the user in the child
    /// thread or an earlier call), cancelled with its turn, or unknown.
    NotPending,
    /// Another answer to it is being delivered now.
    Resolving,
    /// The answer does not fit the request's kind.
    Mismatch(&'static str),
    /// The provider did not accept the answer; retrying may succeed.
    Delivery(&'static str),
}

impl InputAnswerRejection {
    /// The text the model sees.
    #[must_use]
    pub fn message(&self, request_id: &str) -> String {
        match self {
            Self::NotPending => format!(
                "request {request_id} is no longer pending: it was already answered (possibly by the user in the agent's thread), or its turn ended"
            ),
            Self::Resolving => {
                format!("request {request_id} is already being answered by someone else")
            }
            Self::Mismatch(reason) => format!("request {request_id}: {reason}"),
            Self::Delivery(reason) => {
                format!(
                    "the answer to request {request_id} was not delivered ({reason}); retrying is safe"
                )
            }
        }
    }
}

/// The owner of pending runtime requests, as orchestration sees it.
#[async_trait]
pub trait ChildInputDesk: Send + Sync {
    /// The thread's pending requests to a person, oldest first.
    async fn pending(&self, thread: &AppThreadId) -> Vec<PendingInput>;

    /// Answers one pending request of the thread through the same
    /// resolution a device answer takes; the first answer wins.
    ///
    /// # Errors
    /// Returns why the answer was not delivered.
    async fn respond(
        &self,
        thread: &AppThreadId,
        request_id: &str,
        response: RuntimeResponse,
    ) -> Result<(), InputAnswerRejection>;

    /// Thread ids whose pending requests opened or closed (a wake-up edge;
    /// a lagging receiver rescans the threads it follows).
    fn subscribe(&self) -> tokio::sync::broadcast::Receiver<String>;
}
