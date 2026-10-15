//! `codewide-companion update`: the running Companion updates itself.
//!
//! The terminal reaches the service through its private control socket with
//! the administrator token and is the update's initiating device; the shared
//! driver applies, follows the restart and confirms the new Companion.

use std::path::PathBuf;

use codewide_host_update::{
    ApplyHostUpdateAccepted, ApplyHostUpdateRequest, HostUpdateOperation, HostUpdateStatus,
    linux::local_update::{
        LocalControlError, LocalUpdateControl, check_local_update, run_local_update,
    },
};
use serde::de::DeserializeOwned;

use crate::local_control;

const PRODUCT: &str = "Companion";

/// The Companion's control socket, authorized as the local administrator.
pub(crate) struct CompanionControl {
    pub(crate) endpoint: PathBuf,
    pub(crate) administrator_token: String,
}

#[derive(serde::Deserialize)]
struct ErrorBody {
    error: String,
    message: String,
}

impl CompanionControl {
    async fn call<Reply: DeserializeOwned>(
        &self,
        method: reqwest::Method,
        path: &str,
        body: Option<&str>,
    ) -> Result<Reply, LocalControlError> {
        let (status, text) = local_control::request(
            &self.endpoint,
            method,
            path,
            &self.administrator_token,
            body,
        )
        .await
        // A restarting Companion has no socket, or drops the connection.
        .map_err(|error| LocalControlError::Unreachable(error.to_string()))?;
        // A Companion that is still starting may answer before it serves.
        if status.is_server_error() && status != reqwest::StatusCode::INTERNAL_SERVER_ERROR {
            return Err(LocalControlError::Unreachable(format!(
                "the Companion answered {}",
                status.as_u16()
            )));
        }
        if !status.is_success() {
            return Err(serde_json::from_str::<ErrorBody>(&text).map_or_else(
                |_| LocalControlError::Rejected {
                    code: format!("http_{}", status.as_u16()),
                    message: text.trim().to_owned(),
                },
                |body| LocalControlError::Rejected {
                    code: body.error,
                    message: body.message,
                },
            ));
        }
        serde_json::from_str(&text).map_err(|error| LocalControlError::Rejected {
            code: "invalid_response".to_owned(),
            message: error.to_string(),
        })
    }
}

#[async_trait::async_trait]
impl LocalUpdateControl for CompanionControl {
    async fn check(&mut self) -> Result<HostUpdateStatus, LocalControlError> {
        self.call(reqwest::Method::POST, "/v1/host-update/check", None)
            .await
    }

    async fn apply(
        &mut self,
        request: &ApplyHostUpdateRequest,
    ) -> Result<ApplyHostUpdateAccepted, LocalControlError> {
        let body = serde_json::to_string(request)
            .map_err(|error| LocalControlError::Local(error.to_string()))?;
        self.call(reqwest::Method::POST, "/v1/host-update/apply", Some(&body))
            .await
    }

    async fn operation(
        &mut self,
        operation_id: &str,
    ) -> Result<HostUpdateOperation, LocalControlError> {
        self.call(
            reqwest::Method::GET,
            &format!("/v1/host-update/operations/{operation_id}"),
            None,
        )
        .await
    }

    async fn reconnect(
        &mut self,
        operation_id: &str,
    ) -> Result<HostUpdateOperation, LocalControlError> {
        self.call(
            reqwest::Method::POST,
            &format!("/v1/host-update/operations/{operation_id}/reconnect"),
            None,
        )
        .await
    }
}

/// Checks for, or applies, the newest Companion release. A result that
/// leaves the Companion behind the newest release is an error.
///
/// # Errors
/// Returns an error when the Companion is not updated, refuses a request or
/// stops answering.
pub(crate) async fn run(
    mut control: CompanionControl,
    check_only: bool,
    json: bool,
) -> Result<(), Box<dyn std::error::Error>> {
    let endpoint = control.endpoint.clone();
    let unreachable = |error: LocalControlError| -> Box<dyn std::error::Error> {
        match error {
            LocalControlError::Unreachable(_) => format!(
                "Cannot reach the running Companion through {}. Is the service running?",
                endpoint.display()
            )
            .into(),
            error => error.into(),
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
) -> Result<(), Box<dyn std::error::Error>> {
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
