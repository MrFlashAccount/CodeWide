use super::{ErrorCode, Recovery, V2Error};

impl V2Error {
    #[must_use]
    pub fn invalid_request(_message: impl Into<String>) -> Self {
        Self {
            code: ErrorCode::InvalidRequest,
            recovery: Recovery::None,
            message: "request is invalid".into(),
        }
    }

    #[must_use]
    pub fn invalid_query() -> Self {
        Self {
            code: ErrorCode::InvalidQuery,
            recovery: Recovery::None,
            message: "query is invalid".into(),
        }
    }

    #[must_use]
    pub fn forbidden(_message: impl Into<String>) -> Self {
        Self {
            code: ErrorCode::Forbidden,
            recovery: Recovery::UserAction,
            message: "request is not authorized".into(),
        }
    }

    #[must_use]
    pub fn source_unavailable(message: impl Into<String>) -> Self {
        Self {
            code: ErrorCode::SourceUnavailable,
            recovery: Recovery::Retry,
            message: message.into(),
        }
    }

    #[must_use]
    pub fn generation_changed() -> Self {
        Self {
            code: ErrorCode::GenerationChanged,
            recovery: Recovery::Reinitialize,
            message: "upstream generation changed".into(),
        }
    }

    #[must_use]
    pub fn operation_conflict() -> Self {
        Self {
            code: ErrorCode::OperationIdConflict,
            recovery: Recovery::UserAction,
            message: "operation id was already used with a different command".into(),
        }
    }

    #[must_use]
    pub fn operation_expired() -> Self {
        Self {
            code: ErrorCode::OperationExpired,
            recovery: Recovery::UserAction,
            message: "retained operation result expired".into(),
        }
    }

    #[must_use]
    pub fn operation_indeterminate(_message: impl Into<String>) -> Self {
        Self {
            code: ErrorCode::OperationIndeterminate,
            recovery: Recovery::Requery,
            message: "operation outcome could not be proven".into(),
        }
    }

    #[must_use]
    pub fn for_wire(&self) -> Self {
        let message = match self.code {
            ErrorCode::InvalidRequest => "request is invalid",
            ErrorCode::InvalidQuery => "query is invalid",
            ErrorCode::Unauthorized => "authentication is required",
            ErrorCode::Forbidden => "request is not authorized",
            ErrorCode::NotFound => "requested object was not found",
            ErrorCode::Conflict => "request conflicts with current state",
            ErrorCode::SourceUnavailable => "source is temporarily unavailable",
            ErrorCode::RateLimited => "request rate is limited",
            ErrorCode::InvalidCursor => "history cursor is invalid",
            ErrorCode::StaleCursor => "history cursor is stale",
            ErrorCode::OperationIdConflict => {
                "operation id was already used with a different command"
            }
            ErrorCode::OperationExpired => "retained operation result expired",
            ErrorCode::OperationIndeterminate => "operation outcome could not be proven",
            ErrorCode::RequestExpired => "request is no longer active",
            ErrorCode::GenerationChanged => "upstream generation changed",
            ErrorCode::UnsupportedCapability => "capability is not available",
        };
        Self {
            code: self.code,
            recovery: self.recovery,
            message: message.into(),
        }
    }
}
