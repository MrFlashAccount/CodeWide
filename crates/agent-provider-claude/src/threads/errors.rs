//! The thread service's failures as the protocol states them
//! (`host/src/rpc/server.ts`, `packages/agent-protocol`): codes, texts and
//! the internal failure that is logged in full and answered generically.

use std::fmt::Display;

use agent_core::{
    model::{ERROR_INVALID_PARAMS, ERROR_INVALID_REQUEST, RpcError, thread_not_found_message},
    provider::ProviderError,
};
use tracing::error;

/// JSON-RPC "internal error": an operation failed for a reason that is not
/// the caller's (an unreadable file, a failed write).
const ERROR_INTERNAL: i64 = -32_603;

/// Matched by clients as the "conversation open elsewhere" failure.
pub const OPEN_ELSEWHERE_MESSAGE: &str = "This conversation is open in another app: another \
     Claude process is running this session. Close it there, then try again here.";

/// `-32602` with `message`.
pub(super) fn invalid_params(message: impl Into<String>) -> ProviderError {
    ProviderError::Rejected(RpcError::new(ERROR_INVALID_PARAMS, message))
}

/// `-32600` with `message`.
pub(super) fn invalid_request(message: impl Into<String>) -> ProviderError {
    ProviderError::Rejected(RpcError::new(ERROR_INVALID_REQUEST, message))
}

/// `-32600 "thread not found: <id>"`.
pub(super) fn not_found(app_thread_id: &str) -> ProviderError {
    invalid_request(thread_not_found_message(app_thread_id))
}

/// Logs `err` in full under `operation` and answers `-32603 "internal host
/// error"`, as the host answers an operation that threw.
pub(super) fn internal(operation: &'static str, err: &dyn Display) -> ProviderError {
    error!(operation, err = %err, "Claude thread operation failed");
    ProviderError::Rejected(RpcError::new(ERROR_INTERNAL, "internal host error"))
}

/// The session actor of a thread ended (the service is shutting down).
pub(super) fn session_gone(err: &dyn Display) -> ProviderError {
    internal("session", err)
}
