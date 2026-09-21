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
    pub fn unsupported_capability(_message: impl Into<String>) -> Self {
        Self {
            code: ErrorCode::UnsupportedCapability,
            recovery: Recovery::None,
            message: "capability is not available".into(),
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
            ErrorCode::SourceUnavailable if is_safe_app_server_error(&self.message) => {
                &self.message
            }
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

fn is_safe_app_server_error(message: &str) -> bool {
    let lowercase = message.to_ascii_lowercase();
    message.chars().count() <= 128
        && (message.starts_with("App Server error ") || message.starts_with("App Server error: "))
        && !message.chars().any(char::is_control)
        && ![
            "access token",
            "api key",
            "authorization:",
            "bearer ",
            "credential",
            "cookie:",
            "private key",
            "private_sentinel",
            "refresh token",
            "secret",
            "/home/",
            "/token",
            "/users/",
            "\\users\\",
        ]
        .iter()
        .any(|sensitive| lowercase.contains(sensitive))
}
