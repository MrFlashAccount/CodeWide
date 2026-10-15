//! An update started from the host's own terminal.
//!
//! The terminal is the initiating device ([`crate::LOCAL_ADMINISTRATOR_DEVICE_ID`]):
//! it applies the admitted release through the service's private control
//! channel, follows the operation across the restart, and confirms the
//! restarted service by reaching it again. That receipt commits the update;
//! without it the runner rolls back at the reconnect deadline, as it does
//! when a phone that started an update never comes back.

use std::time::Duration;

use async_trait::async_trait;
use serde::Serialize;

use crate::{
    ApplyHostUpdateAccepted, ApplyHostUpdateRequest, GuardianErrorCode, HostUpdateOperation,
    HostUpdatePhase, HostUpdateProgress, HostUpdateStatus,
};

/// How often the terminal reads the operation while it runs.
const POLL_INTERVAL: Duration = Duration::from_secs(1);
/// Upper bound on following one operation; the runner's deadlines end it sooner.
const FOLLOW_LIMIT: Duration = Duration::from_mins(30);
/// Download progress is reported in steps of this many percent.
const DOWNLOAD_STEP_PERCENT: u64 = 10;
const PERCENT: u64 = 100;

/// Why a request to the service's control channel produced no answer.
#[derive(Debug, thiserror::Error)]
pub enum LocalControlError {
    /// The service did not answer; it may be restarting.
    #[error("{0}")]
    Unreachable(String),
    /// The service answered and refused the request.
    #[error("{message}")]
    Rejected { code: String, message: String },
    /// The terminal could not form a request.
    #[error("{0}")]
    Local(String),
}

/// The service's private control channel, as the terminal's update needs it.
/// Every call carries the local administrator's authority.
#[async_trait]
pub trait LocalUpdateControl: Send {
    /// Downloads and admits the current signed release, then reports status.
    async fn check(&mut self) -> Result<HostUpdateStatus, LocalControlError>;
    async fn apply(
        &mut self,
        request: &ApplyHostUpdateRequest,
    ) -> Result<ApplyHostUpdateAccepted, LocalControlError>;
    async fn operation(
        &mut self,
        operation_id: &str,
    ) -> Result<HostUpdateOperation, LocalControlError>;
    /// Confirms that the terminal reached the restarted service.
    async fn reconnect(
        &mut self,
        operation_id: &str,
    ) -> Result<HostUpdateOperation, LocalControlError>;
}

/// What a check found, before anything is applied.
#[derive(Debug, Serialize)]
#[serde(tag = "result", rename_all = "camelCase")]
pub enum LocalUpdateCheck {
    /// No newer release than the running version.
    #[serde(rename_all = "camelCase")]
    UpToDate { version: String },
    /// A newer admitted release this installation can apply.
    #[serde(rename_all = "camelCase")]
    Available {
        current_version: String,
        target_version: String,
        #[serde(skip)]
        target_fingerprint: String,
    },
    /// This installation cannot update itself; `reason` says why.
    Unavailable { reason: String },
    /// Another update is running.
    Busy { operation: HostUpdateOperation },
}

/// The result of one terminal update.
#[derive(Debug, Serialize)]
#[serde(tag = "result", rename_all = "camelCase")]
pub enum LocalUpdateOutcome {
    /// Nothing was applied; the check says why.
    NotApplied { check: LocalUpdateCheck },
    /// The restarted service runs the new version and the update is committed.
    Updated { operation: HostUpdateOperation },
    /// The update failed or rolled back; the previous version runs.
    NotUpdated { operation: HostUpdateOperation },
}

/// What the terminal shows while an update runs.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum LocalUpdateEvent {
    Started {
        current_version: String,
        target_version: String,
    },
    Stage(UpdateStage),
}

/// The visible stage of a running update.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum UpdateStage {
    Preparing,
    /// `percent` is rounded down to a reporting step; unknown without a size.
    Downloading {
        percent: Option<u64>,
    },
    Verifying,
    Extracting,
    Restarting,
    CheckingHealth,
    Confirming,
    RollingBack,
}

impl std::fmt::Display for UpdateStage {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Preparing => formatter.write_str("Preparing"),
            Self::Downloading { percent: None } => formatter.write_str("Downloading"),
            Self::Downloading {
                percent: Some(percent),
            } => write!(formatter, "Downloading {percent}%"),
            Self::Verifying => formatter.write_str("Verifying"),
            Self::Extracting => formatter.write_str("Installing"),
            Self::Restarting => formatter.write_str("Restarting"),
            Self::CheckingHealth => formatter.write_str("Checking health"),
            Self::Confirming => formatter.write_str("Confirming"),
            Self::RollingBack => formatter.write_str("Rolling back"),
        }
    }
}

impl UpdateStage {
    /// The stage of a non-terminal operation.
    fn of(operation: &HostUpdateOperation) -> Option<Self> {
        if let Some(progress) = &operation.progress {
            return Some(match progress {
                HostUpdateProgress::Downloading {
                    downloaded_bytes,
                    total_bytes,
                } => Self::Downloading {
                    percent: total_bytes.filter(|total| *total > 0).map(|total| {
                        let percent =
                            (downloaded_bytes.saturating_mul(PERCENT) / total).min(PERCENT);
                        percent - percent % DOWNLOAD_STEP_PERCENT
                    }),
                },
                HostUpdateProgress::Verifying => Self::Verifying,
                HostUpdateProgress::Extracting => Self::Extracting,
                HostUpdateProgress::Restarting => Self::Restarting,
                HostUpdateProgress::CheckingHealth => Self::CheckingHealth,
                HostUpdateProgress::AwaitingReconnect => Self::Confirming,
                HostUpdateProgress::RollingBack => Self::RollingBack,
            });
        }
        match operation.phase {
            HostUpdatePhase::Accepted | HostUpdatePhase::Installing => Some(Self::Preparing),
            HostUpdatePhase::TargetReady => Some(Self::CheckingHealth),
            HostUpdatePhase::AwaitingReconnect => Some(Self::Confirming),
            HostUpdatePhase::RollingBack => Some(Self::RollingBack),
            HostUpdatePhase::Committed | HostUpdatePhase::RolledBack | HostUpdatePhase::Failed => {
                None
            }
        }
    }
}

impl LocalUpdateCheck {
    /// One line for the terminal; `product` names the service.
    #[must_use]
    pub fn message(&self, product: &str) -> String {
        match self {
            Self::UpToDate { version } => format!("{product} {version} is up to date."),
            Self::Available {
                current_version,
                target_version,
                ..
            } => format!("{product} {target_version} is available (running {current_version})."),
            Self::Unavailable { reason } => format!(
                "{product} cannot update itself ({reason}). Reinstall it with its installer to enable updates."
            ),
            Self::Busy { operation } => format!(
                "An update of {product} to {} is already running.",
                operation.target_version
            ),
        }
    }

    /// Whether nothing stands between this installation and the newest release.
    #[must_use]
    pub const fn is_usable(&self) -> bool {
        matches!(self, Self::UpToDate { .. } | Self::Available { .. })
    }
}

impl LocalUpdateOutcome {
    /// One line for the terminal; `product` names the service.
    #[must_use]
    pub fn message(&self, product: &str) -> String {
        match self {
            Self::NotApplied { check } => check.message(product),
            Self::Updated { operation } => {
                format!("Updated {product} to {}.", operation.target_version)
            }
            Self::NotUpdated { operation } => format!(
                "{product} was not updated and still runs {}: {}",
                operation.current_version,
                operation
                    .error_message
                    .as_deref()
                    .or(operation.error_code.as_deref())
                    .unwrap_or("the update failed")
            ),
        }
    }

    /// Whether the service now runs the newest release.
    #[must_use]
    pub const fn succeeded(&self) -> bool {
        matches!(
            self,
            Self::Updated { .. }
                | Self::NotApplied {
                    check: LocalUpdateCheck::UpToDate { .. }
                }
        )
    }
}

impl LocalUpdateEvent {
    /// One progress line for the terminal; `product` names the service.
    #[must_use]
    pub fn message(&self, product: &str) -> String {
        match self {
            Self::Started {
                current_version,
                target_version,
            } => format!("Updating {product} {current_version} -> {target_version}"),
            Self::Stage(stage) => format!("  {stage}..."),
        }
    }
}

/// Downloads and admits the current signed release and says whether this
/// installation can update to it.
///
/// # Errors
/// Returns an error when the service refuses the check or does not answer.
pub async fn check_local_update<Control: LocalUpdateControl>(
    control: &mut Control,
) -> Result<LocalUpdateCheck, LocalControlError> {
    let status = match control.check().await {
        Ok(status) => status,
        Err(LocalControlError::Rejected { code, message })
            if code == GuardianErrorCode::ManualUpdateRequired.reason() =>
        {
            return Ok(LocalUpdateCheck::Unavailable { reason: message });
        }
        Err(error) => return Err(error),
    };
    if let Some(operation) = status
        .active_operation
        .filter(|operation| !operation.phase.is_terminal())
    {
        return Ok(LocalUpdateCheck::Busy { operation });
    }
    let Some(available) = status.available_target else {
        return Ok(LocalUpdateCheck::UpToDate {
            version: status.current_version,
        });
    };
    if !status.capability.supports_remote_apply() {
        return Ok(LocalUpdateCheck::Unavailable {
            reason: status
                .capability
                .unavailable_reason
                .unwrap_or_else(|| "guardian_contract_unsupported".to_owned()),
        });
    }
    Ok(LocalUpdateCheck::Available {
        current_version: status.current_version,
        target_version: available.target.version,
        target_fingerprint: available.target_fingerprint,
    })
}

/// Updates the service to the newest admitted release, if there is one. An
/// update already running (one an interrupted terminal started) is followed
/// instead and confirmed when the terminal started it.
///
/// # Errors
/// Returns an error when the service refuses a request, or stops answering
/// for longer than an update can take.
pub async fn run_local_update<Control: LocalUpdateControl>(
    control: &mut Control,
    mut on_event: impl FnMut(LocalUpdateEvent) + Send,
) -> Result<LocalUpdateOutcome, LocalControlError> {
    let (current_version, target_version, target_fingerprint) =
        match check_local_update(control).await? {
            LocalUpdateCheck::Available {
                current_version,
                target_version,
                target_fingerprint,
            } => (current_version, target_version, target_fingerprint),
            LocalUpdateCheck::Busy { operation } => {
                on_event(LocalUpdateEvent::Started {
                    current_version: operation.current_version,
                    target_version: operation.target_version,
                });
                return follow(control, &operation.operation_id, on_event).await;
            }
            check => return Ok(LocalUpdateOutcome::NotApplied { check }),
        };
    on_event(LocalUpdateEvent::Started {
        current_version,
        target_version,
    });
    let accepted = control
        .apply(&ApplyHostUpdateRequest {
            target_fingerprint,
            idempotency_key: idempotency_key()?,
        })
        .await?;
    follow(control, &accepted.operation_id, on_event).await
}

/// Follows one operation to its end across the service restart, confirming
/// the restarted service as soon as it awaits the initiator.
async fn follow<Control: LocalUpdateControl>(
    control: &mut Control,
    operation_id: &str,
    mut on_event: impl FnMut(LocalUpdateEvent) + Send,
) -> Result<LocalUpdateOutcome, LocalControlError> {
    let deadline = tokio::time::Instant::now() + FOLLOW_LIMIT;
    let mut shown = None;
    loop {
        tokio::time::sleep(POLL_INTERVAL).await;
        let operation = match control.operation(operation_id).await {
            Ok(operation) => operation,
            Err(LocalControlError::Unreachable(message)) => {
                if tokio::time::Instant::now() >= deadline {
                    return Err(LocalControlError::Unreachable(message));
                }
                continue;
            }
            Err(error) => return Err(error),
        };
        // A receipt the restarted service cannot take yet (or a dropped
        // connection) is retried on the next read; one for an update another
        // device started is refused, and that device confirms it. The
        // runner's deadline decides if no receipt ever succeeds.
        let operation = if operation.phase == HostUpdatePhase::AwaitingReconnect {
            control.reconnect(operation_id).await.unwrap_or(operation)
        } else {
            operation
        };
        match operation.phase {
            HostUpdatePhase::Committed => return Ok(LocalUpdateOutcome::Updated { operation }),
            HostUpdatePhase::RolledBack | HostUpdatePhase::Failed => {
                return Ok(LocalUpdateOutcome::NotUpdated { operation });
            }
            _ => {}
        }
        let stage = UpdateStage::of(&operation);
        if stage.is_some() && stage != shown {
            shown = stage;
            if let Some(stage) = stage {
                on_event(LocalUpdateEvent::Stage(stage));
            }
        }
    }
}

/// A fresh key; one terminal run applies one update.
fn idempotency_key() -> Result<String, LocalControlError> {
    let mut random = [0_u8; 16];
    rand::TryRngCore::try_fill_bytes(&mut rand::rngs::OsRng, &mut random)
        .map_err(|error| LocalControlError::Local(error.to_string()))?;
    Ok(format!("terminal-{}", hex::encode(random)))
}

#[cfg(test)]
#[path = "local_update_tests.rs"]
mod tests;
