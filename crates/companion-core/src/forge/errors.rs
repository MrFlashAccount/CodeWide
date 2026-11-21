//! Companion error codes `-32080..-32089` and their `data` shapes
//! (`ForgeErrorData` of the wire contract), plus plugin error mapping.
//!
//! Messages are short English reasons without forge content or credentials.
//! Plugin errors are reduced to their typed code and reason before they are
//! returned or logged.

use forge_protocol::code as plugin_code;
use serde_json::{Value, json};

use super::{
    ids::{ForgeAccountKey, HeadRevision},
    plugin_client::PluginCallError,
};

pub const PROVIDER_UNAVAILABLE: i64 = -32_080;
pub const AUTH_REQUIRED: i64 = -32_081;
pub const STALE_HEAD: i64 = -32_082;
pub const FORGE_REJECTED: i64 = -32_083;
pub const CAPABILITY_UNAVAILABLE: i64 = -32_084;
pub const INVALID_GUIDE: i64 = -32_085;
pub const GUIDE_TOO_LARGE: i64 = -32_086;
pub const RATE_LIMITED: i64 = -32_087;
pub const NOT_FOUND_OR_CONFLICT: i64 = -32_088;
pub const CONFIRMATION_REQUIRED: i64 = -32_089;
pub const INVALID_PARAMS: i64 = -32_602;
pub const INTERNAL: i64 = -32_603;

/// A confirmation level, ordered `none < confirm < destructive`.
#[derive(
    Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd, serde::Deserialize, serde::Serialize,
)]
#[serde(rename_all = "camelCase")]
pub enum Confirmation {
    None,
    Confirm,
    Destructive,
}

#[derive(Clone, Debug, PartialEq)]
pub enum ForgeError {
    ProviderUnavailable {
        plugin_id: Option<String>,
        capability: Option<String>,
        reason: String,
    },
    /// `account` is `None` only for a pasted token that never became an
    /// account.
    AuthRequired {
        account: Option<ForgeAccountKey>,
        hint: String,
    },
    StaleHead {
        head_revision: HeadRevision,
        catalog: Option<Value>,
    },
    ForgeRejected {
        reason: String,
    },
    OutcomeUnknown {
        run_id: String,
    },
    CapabilityUnavailable {
        reason: String,
    },
    InvalidGuide {
        reason: String,
    },
    GuideTooLarge {
        hunks: usize,
    },
    RateLimited {
        retry_after_seconds: Option<u64>,
    },
    NotFound,
    Conflict {
        current: Value,
    },
    ConfirmationRequired {
        required: Confirmation,
    },
    InvalidParams(String),
    Internal(String),
    /// A journaled JSON-RPC error returned again for a repeated key.
    Replayed(Value),
}

impl ForgeError {
    #[must_use]
    pub fn invalid(message: impl Into<String>) -> Self {
        Self::InvalidParams(message.into())
    }

    #[must_use]
    pub fn internal(message: impl Into<String>) -> Self {
        Self::Internal(message.into())
    }

    #[must_use]
    pub fn unavailable(plugin_id: &str, reason: impl Into<String>) -> Self {
        Self::ProviderUnavailable {
            plugin_id: Some(plugin_id.to_owned()),
            capability: None,
            reason: reason.into(),
        }
    }

    #[must_use]
    pub fn code(&self) -> i64 {
        match self {
            Self::ProviderUnavailable { .. } => PROVIDER_UNAVAILABLE,
            Self::AuthRequired { .. } => AUTH_REQUIRED,
            Self::StaleHead { .. } => STALE_HEAD,
            Self::ForgeRejected { .. } | Self::OutcomeUnknown { .. } => FORGE_REJECTED,
            Self::CapabilityUnavailable { .. } => CAPABILITY_UNAVAILABLE,
            Self::InvalidGuide { .. } => INVALID_GUIDE,
            Self::GuideTooLarge { .. } => GUIDE_TOO_LARGE,
            Self::RateLimited { .. } => RATE_LIMITED,
            Self::NotFound | Self::Conflict { .. } => NOT_FOUND_OR_CONFLICT,
            Self::ConfirmationRequired { .. } => CONFIRMATION_REQUIRED,
            Self::InvalidParams(_) => INVALID_PARAMS,
            Self::Internal(_) => INTERNAL,
            Self::Replayed(error) => error
                .get("code")
                .and_then(Value::as_i64)
                .unwrap_or(INTERNAL),
        }
    }

    /// The JSON-RPC `error` object.
    #[must_use]
    pub fn to_rpc_error(&self) -> Value {
        if let Self::Replayed(error) = self {
            return error.clone();
        }
        let code = self.code();
        let (message, data) = match self {
            Self::ProviderUnavailable {
                plugin_id,
                capability,
                reason,
            } => (
                reason.clone(),
                Some(
                    json!({"code": code, "kind": "providerUnavailable", "pluginId": plugin_id, "capability": capability}),
                ),
            ),
            Self::AuthRequired { account, hint } => (
                "Sign-in required".to_owned(),
                Some(
                    json!({"code": code, "kind": "authRequired", "account": account, "hint": hint}),
                ),
            ),
            Self::StaleHead {
                head_revision,
                catalog,
            } => (
                "The pull request head moved".to_owned(),
                Some(
                    json!({"code": code, "kind": "staleHead", "headRevision": head_revision, "catalog": catalog}),
                ),
            ),
            Self::ForgeRejected { reason } => (
                reason.clone(),
                Some(json!({"code": code, "kind": "forgeRejected", "reason": reason})),
            ),
            Self::OutcomeUnknown { run_id } => (
                "The outcome of the earlier attempt is unknown; refresh the pull request"
                    .to_owned(),
                Some(json!({"code": code, "kind": "outcomeUnknown", "runId": run_id})),
            ),
            Self::CapabilityUnavailable { reason } => (
                reason.clone(),
                Some(json!({"code": code, "kind": "capabilityUnavailable", "reason": reason})),
            ),
            Self::InvalidGuide { reason } => (
                reason.clone(),
                Some(json!({"code": code, "kind": "invalidGuide", "reason": reason})),
            ),
            Self::GuideTooLarge { hunks } => (
                "The diff is too large for a guide".to_owned(),
                Some(json!({"code": code, "kind": "guideTooLarge", "hunks": hunks})),
            ),
            Self::RateLimited {
                retry_after_seconds,
            } => (
                "The forge rate limit was reached".to_owned(),
                Some(
                    json!({"code": code, "kind": "rateLimited", "retryAfterSeconds": retry_after_seconds}),
                ),
            ),
            Self::NotFound => (
                "Not found".to_owned(),
                Some(json!({"code": code, "kind": "notFound", "current": null})),
            ),
            Self::Conflict { current } => (
                "The record changed on another device".to_owned(),
                Some(json!({"code": code, "kind": "conflict", "current": current})),
            ),
            Self::ConfirmationRequired { required } => (
                "Confirmation required".to_owned(),
                Some(json!({"code": code, "kind": "confirmationRequired", "required": required})),
            ),
            Self::InvalidParams(message) | Self::Internal(message) => (message.clone(), None),
            Self::Replayed(_) => (String::new(), None),
        };
        let mut error = json!({"code": code, "message": message});
        if let Some(data) = data {
            error["data"] = data;
        }
        error
    }

    /// Maps a plugin failure of a call made for `account`.
    #[must_use]
    pub fn from_plugin(
        plugin_id: &str,
        account: Option<&ForgeAccountKey>,
        error: PluginCallError,
    ) -> Self {
        match error {
            PluginCallError::Remote {
                code,
                message,
                data,
            } => match code {
                plugin_code::AUTH_REQUIRED => Self::AuthRequired {
                    account: account.cloned(),
                    hint: bounded(&message),
                },
                plugin_code::STALE_HEAD => {
                    match data
                        .as_ref()
                        .and_then(|data| data.get("headRevision"))
                        .and_then(Value::as_str)
                        .and_then(HeadRevision::parse)
                    {
                        Some(head_revision) => Self::StaleHead {
                            head_revision,
                            catalog: None,
                        },
                        None => Self::ForgeRejected {
                            reason: "The pull request head moved".into(),
                        },
                    }
                }
                plugin_code::CAPABILITY_UNAVAILABLE => Self::CapabilityUnavailable {
                    reason: bounded(&message),
                },
                plugin_code::RATE_LIMITED => Self::RateLimited {
                    retry_after_seconds: data
                        .as_ref()
                        .and_then(|data| data.get("retryAfterSeconds"))
                        .and_then(Value::as_u64),
                },
                plugin_code::NOT_FOUND | plugin_code::NOT_OWNED => Self::NotFound,
                plugin_code::INVALID_PARAMS => Self::InvalidParams(bounded(&message)),
                // `forgeRejected` and any unknown plugin code.
                _ => Self::ForgeRejected {
                    reason: bounded(&message),
                },
            },
            PluginCallError::Missing => {
                Self::unavailable(plugin_id, "The provider's plugin is not installed")
            }
            PluginCallError::CapabilityMissing(capability) => Self::ProviderUnavailable {
                plugin_id: Some(plugin_id.to_owned()),
                capability: Some(capability),
                reason: "The provider does not support this".into(),
            },
            PluginCallError::Timeout => Self::Internal("The forge plugin timed out".into()),
            PluginCallError::Start(_) => {
                Self::unavailable(plugin_id, "The forge plugin could not start")
            }
            PluginCallError::Busy => Self::Internal("Too many forge requests are running".into()),
            PluginCallError::Transport(_) | PluginCallError::Protocol(_) => {
                Self::Internal("The forge plugin failed".into())
            }
        }
    }

    /// The opaque kind for logs: no reasons, which may quote forge text.
    #[must_use]
    pub fn log_kind(&self) -> &'static str {
        match self {
            Self::ProviderUnavailable { .. } => "providerUnavailable",
            Self::AuthRequired { .. } => "authRequired",
            Self::StaleHead { .. } => "staleHead",
            Self::ForgeRejected { .. } => "forgeRejected",
            Self::OutcomeUnknown { .. } => "outcomeUnknown",
            Self::CapabilityUnavailable { .. } => "capabilityUnavailable",
            Self::InvalidGuide { .. } => "invalidGuide",
            Self::GuideTooLarge { .. } => "guideTooLarge",
            Self::RateLimited { .. } => "rateLimited",
            Self::NotFound => "notFound",
            Self::Conflict { .. } => "conflict",
            Self::ConfirmationRequired { .. } => "confirmationRequired",
            Self::InvalidParams(_) => "invalidParams",
            Self::Internal(_) => "internal",
            Self::Replayed(_) => "replayed",
        }
    }
}

impl From<crate::store::StoreError> for ForgeError {
    fn from(error: crate::store::StoreError) -> Self {
        tracing::error!(err = ?error, "forge storage failed");
        Self::Internal("Companion storage failed".into())
    }
}

fn bounded(message: &str) -> String {
    message.chars().take(300).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn error_data_carries_the_code_and_kind() {
        let error = ForgeError::ConfirmationRequired {
            required: Confirmation::Destructive,
        };
        let rpc = error.to_rpc_error();
        assert_eq!(rpc["code"], -32_089);
        assert_eq!(
            rpc["data"],
            json!({"code": -32_089, "kind": "confirmationRequired", "required": "destructive"})
        );
        assert!(Confirmation::Destructive > Confirmation::Confirm);
        assert!(Confirmation::Confirm > Confirmation::None);
    }
}
