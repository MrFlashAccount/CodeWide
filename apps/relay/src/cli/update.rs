//! `codewide-relay update`: the running Relay updates itself.
//!
//! The terminal reaches the service through its private control socket and
//! is the update's initiating device; the shared driver applies, follows the
//! restart and confirms the new Relay.

use std::{path::PathBuf, time::Duration};

use codewide_host_update::{
    ApplyHostUpdateAccepted, ApplyHostUpdateRequest, HostUpdateOperation, HostUpdateStatus,
    linux::local_update::{
        LocalControlError, LocalUpdateControl, check_local_update, run_local_update,
    },
};
use codewide_relay::admin::{Reply, Request, read_frame, write_frame};
use tokio::net::UnixStream;

const PRODUCT: &str = "Relay";
/// A check downloads and verifies the signed release.
const CHECK_TIMEOUT: Duration = Duration::from_mins(2);
const COMMAND_TIMEOUT: Duration = Duration::from_secs(10);

/// The Relay's control socket, used as the local administrator.
pub struct RelayControl {
    pub socket: PathBuf,
    /// Shown when this account may not use the socket.
    pub access_denied: String,
}

impl RelayControl {
    async fn call(&self, request: &Request, timeout: Duration) -> Result<Reply, LocalControlError> {
        let mut socket = match UnixStream::connect(&self.socket).await {
            Ok(socket) => socket,
            Err(error) if error.kind() == std::io::ErrorKind::PermissionDenied => {
                return Err(LocalControlError::Rejected {
                    code: "access_denied".to_owned(),
                    message: self.access_denied.clone(),
                });
            }
            // A restarting Relay has no socket yet.
            Err(error) => return Err(LocalControlError::Unreachable(error.to_string())),
        };
        let exchange = async {
            write_frame(&mut socket, request).await?;
            read_frame::<Reply>(&mut socket).await
        };
        match tokio::time::timeout(timeout, exchange).await {
            Ok(Ok(Reply::UpdateRejected { code, message })) => {
                Err(LocalControlError::Rejected { code, message })
            }
            // An older Relay without these commands names the unknown one.
            Ok(Ok(Reply::Error { message })) => Err(LocalControlError::Rejected {
                code: "control_error".to_owned(),
                message,
            }),
            Ok(Ok(reply)) => Ok(reply),
            Ok(Err(error)) => Err(LocalControlError::Unreachable(error.to_string())),
            Err(_) => Err(LocalControlError::Unreachable(
                "the Relay did not answer in time".to_owned(),
            )),
        }
    }

    async fn operation_call(
        &self,
        request: &Request,
    ) -> Result<HostUpdateOperation, LocalControlError> {
        match self.call(request, COMMAND_TIMEOUT).await? {
            Reply::UpdateOperation { operation } => Ok(operation),
            _ => Err(incompatible()),
        }
    }
}

fn incompatible() -> LocalControlError {
    LocalControlError::Rejected {
        code: "invalid_response".to_owned(),
        message: "The Relay service returned an incompatible update response".to_owned(),
    }
}

#[async_trait::async_trait]
impl LocalUpdateControl for RelayControl {
    async fn check(&mut self) -> Result<HostUpdateStatus, LocalControlError> {
        match self.call(&Request::UpdateCheck, CHECK_TIMEOUT).await? {
            Reply::UpdateStatus { status } => Ok(*status),
            _ => Err(incompatible()),
        }
    }

    async fn apply(
        &mut self,
        request: &ApplyHostUpdateRequest,
    ) -> Result<ApplyHostUpdateAccepted, LocalControlError> {
        let request = Request::UpdateApply {
            target_fingerprint: request.target_fingerprint.clone(),
            idempotency_key: request.idempotency_key.clone(),
        };
        match self.call(&request, COMMAND_TIMEOUT).await? {
            Reply::UpdateAccepted { accepted } => Ok(accepted),
            _ => Err(incompatible()),
        }
    }

    async fn operation(
        &mut self,
        operation_id: &str,
    ) -> Result<HostUpdateOperation, LocalControlError> {
        self.operation_call(&Request::UpdateOperation {
            operation_id: operation_id.to_owned(),
        })
        .await
    }

    async fn reconnect(
        &mut self,
        operation_id: &str,
    ) -> Result<HostUpdateOperation, LocalControlError> {
        self.operation_call(&Request::UpdateReconnect {
            operation_id: operation_id.to_owned(),
        })
        .await
    }
}

/// Checks for, or applies, the newest Relay release. A result that leaves the
/// Relay behind the newest release is an error.
///
/// # Errors
/// Returns an error when the Relay is not updated, refuses a request or stops
/// answering.
pub async fn run(
    mut control: RelayControl,
    check_only: bool,
    json: bool,
) -> codewide_relay::Result<()> {
    let socket = control.socket.clone();
    let unreachable = |error: LocalControlError| -> codewide_relay::Error {
        match error {
            LocalControlError::Unreachable(_) => format!(
                "Cannot reach the running Relay through {}. Is the service running?",
                socket.display()
            )
            .into(),
            error => error.to_string().into(),
        }
    };
    if check_only {
        let check = check_local_update(&mut control)
            .await
            .map_err(&unreachable)?;
        return report(json, &check, check.message(PRODUCT), check.is_usable());
    }
    let outcome = run_local_update(&mut control, |event| {
        if !json {
            println!("{}", event.message(PRODUCT));
        }
    })
    .await
    .map_err(&unreachable)?;
    report(
        json,
        &outcome,
        outcome.message(PRODUCT),
        outcome.succeeded(),
    )
}

fn report(
    json: bool,
    value: &impl serde::Serialize,
    message: String,
    succeeded: bool,
) -> codewide_relay::Result<()> {
    if json {
        println!("{}", serde_json::to_string(value)?);
    }
    match (succeeded, json) {
        (true, false) => {
            println!("{message}");
            Ok(())
        }
        (true, true) => Ok(()),
        (false, false) => Err(message.into()),
        (false, true) => Err(format!("{PRODUCT} is not on the newest release").into()),
    }
}
