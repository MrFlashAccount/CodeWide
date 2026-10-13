//! Mapping of a Claude `result` frame to a neutral turn outcome.
//!
//! `aborted_*` terminal reasons are interruptions. A `success` subtype with
//! `is_error`, any `error_*` subtype, or an authentication failure is a failed
//! turn with user-facing text. `[ede_diagnostic]` lines are internal and never
//! reach the user. Rate limits are never reported as an error here. Pure.

use agent_core::model::{TurnError, TurnErrorKind, TurnStatus};

use super::frames::ResultFrame;

#[derive(Clone, Debug, PartialEq)]
pub enum TurnOutcome {
    Completed,
    Interrupted,
    Failed(TurnError),
}

impl TurnOutcome {
    #[must_use]
    pub const fn status(&self) -> TurnStatus {
        match self {
            Self::Completed => TurnStatus::Completed,
            Self::Interrupted => TurnStatus::Interrupted,
            Self::Failed(_) => TurnStatus::Failed,
        }
    }
}

pub const AUTHENTICATION_MESSAGE: &str =
    "Claude is not signed in on this host. Run `claude auth login` on the host, then try again.";
pub const PROCESS_EXITED_MESSAGE: &str = "Claude process exited unexpectedly";
pub const LOST_SESSION_MARKER: &str = "No conversation found with session ID";
const BACKGROUND_SESSION_MARKER: &str = "That session is running in the background (";

/// User-facing failure of a Claude process that exited during a turn. A
/// session already running as a `claude --bg` background agent cannot be
/// resumed by a second process; the CLI names its short id in stderr.
#[must_use]
pub fn process_exited_error(cause: &str) -> TurnError {
    let short_id = cause.find(BACKGROUND_SESSION_MARKER).map(|at| {
        let rest = &cause[at + BACKGROUND_SESSION_MARKER.len()..];
        let end = rest
            .find(|character: char| !character.is_ascii_hexdigit())
            .unwrap_or(rest.len());
        &rest[..end]
    });
    match short_id {
        Some(short_id) => TurnError {
            kind: TurnErrorKind::ProcessExited,
            message: format!(
                "This conversation is open in another app: a Claude background agent is running this session. Wait for it to finish or run `claude stop {short_id}` on the host, then try again."
            ),
        },
        None => TurnError {
            kind: TurnErrorKind::ProcessExited,
            message: PROCESS_EXITED_MESSAGE.into(),
        },
    }
}

#[must_use]
pub fn is_interruption(frame: &ResultFrame) -> bool {
    frame
        .terminal_reason
        .as_deref()
        .is_some_and(|reason| reason.starts_with("aborted"))
}

#[must_use]
pub fn is_lost_session(frame: &ResultFrame) -> bool {
    frame
        .errors
        .iter()
        .any(|error| error.contains(LOST_SESSION_MARKER))
}

fn looks_like_authentication(text: &str) -> bool {
    let lower = text.to_ascii_lowercase();
    lower.contains("authenticat")
        || lower.contains("not logged in")
        || lower.contains("invalid api key")
        || lower
            .split(|character: char| !character.is_ascii_digit())
            .any(|token| token == "401")
}

/// `assistant_error` is the `error` of the turn's last assistant frame, if any.
#[must_use]
pub fn turn_outcome(frame: &ResultFrame, assistant_error: Option<&str>) -> TurnOutcome {
    if is_interruption(frame) {
        return TurnOutcome::Interrupted;
    }
    if frame.subtype == "success" && !frame.is_error && assistant_error.is_none() {
        return TurnOutcome::Completed;
    }
    failed_outcome(frame, assistant_error)
}

/// User-facing failure text: the result and every error except internal diagnostics.
fn failure_text(frame: &ResultFrame) -> String {
    frame
        .result
        .iter()
        .map(String::as_str)
        .chain(
            frame
                .errors
                .iter()
                .map(String::as_str)
                .filter(|error| !error.contains("[ede_diagnostic]")),
        )
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}

fn failed_outcome(frame: &ResultFrame, assistant_error: Option<&str>) -> TurnOutcome {
    let text = failure_text(frame);
    if assistant_error == Some("authentication_failed") || looks_like_authentication(&text) {
        return TurnOutcome::Failed(TurnError {
            kind: TurnErrorKind::Authentication,
            message: AUTHENTICATION_MESSAGE.into(),
        });
    }
    TurnOutcome::Failed(TurnError {
        kind: TurnErrorKind::Provider,
        message: if text.is_empty() {
            format!("Claude turn failed ({})", frame.subtype)
        } else {
            text
        },
    })
}
