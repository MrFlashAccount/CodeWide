//! E2E-only deterministic resource and transport fault control.

use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tokio::sync::{Mutex, Notify};

const FAULT_TIMEOUT: Duration = Duration::from_mins(3);
const MAX_MARKER_BYTES: usize = 96;

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum E2ESurfaceFaultTarget {
    ResourceList,
    ResourceRead,
    ResourceRefresh,
    ChangeRead,
    CatalogPage,
    ThreadOpen,
    HistoryPage,
    AttachmentUpload,
    TerminalOpen,
    TerminalChannel,
    TerminalReplay,
    PortDiscovery,
    PortCreate,
    PortDelete,
    PortExpire,
    TurnSubmit,
    QueueDispatch,
    PairingExchange,
    VoiceFinish,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum E2ESurfaceFaultAction {
    Hold,
    Fail {
        marker: String,
    },
    NotFound,
    ReplayUnavailable,
    InvalidCursor,
    Retry {
        #[serde(rename = "retryAfterMs")]
        retry_after_ms: u64,
    },
    Result {
        marker: String,
    },
    Uncertain {
        marker: String,
    },
    Expire {
        #[serde(rename = "tunnelId")]
        tunnel_id: String,
        #[serde(rename = "ownerDeviceId")]
        owner_device_id: String,
    },
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct E2ESurfaceFaultRequest {
    pub target: E2ESurfaceFaultTarget,
    pub action: E2ESurfaceFaultAction,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum E2ESurfaceFaultState {
    Armed,
    Intercepted,
    Triggered,
    Released,
    TimedOut,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct E2ESurfaceFaultStatus {
    pub fault_id: String,
    pub target: E2ESurfaceFaultTarget,
    pub action: E2ESurfaceFaultAction,
    pub state: E2ESurfaceFaultState,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) enum E2ESurfaceFaultEffect {
    Continue,
    Fail(String),
    NotFound,
    ReplayUnavailable,
    InvalidCursor,
    VoiceRetry(u64),
    VoiceResult(String),
    PortExpire {
        tunnel_id: String,
        owner_device_id: String,
    },
    QueueUncertain(String),
}

#[derive(Debug)]
struct ActiveFault {
    fault_id: String,
    target: E2ESurfaceFaultTarget,
    action: E2ESurfaceFaultAction,
    state: E2ESurfaceFaultState,
    deadline: Instant,
}

#[derive(Debug, Default)]
pub struct E2ESurfaceFaultControl {
    active: Mutex<Option<ActiveFault>>,
    changed: Notify,
}

impl E2ESurfaceFaultControl {
    /// Arms one validated, one-shot E2E surface fault.
    ///
    /// # Errors
    ///
    /// Returns a stable error code when the target/action pair or marker is invalid, or when
    /// another non-terminal surface fault is already active.
    pub async fn arm(
        &self,
        fault_id: String,
        request: E2ESurfaceFaultRequest,
    ) -> Result<E2ESurfaceFaultStatus, &'static str> {
        validate_request(&request)?;
        let mut active = self.active.lock().await;
        if active.as_ref().is_some_and(|fault| {
            !matches!(
                fault.state,
                E2ESurfaceFaultState::Triggered
                    | E2ESurfaceFaultState::Released
                    | E2ESurfaceFaultState::TimedOut
            )
        }) {
            return Err("e2e_surface_fault_already_active");
        }
        let fault = ActiveFault {
            fault_id,
            target: request.target,
            action: request.action,
            state: E2ESurfaceFaultState::Armed,
            deadline: Instant::now() + FAULT_TIMEOUT,
        };
        let result = status(&fault);
        *active = Some(fault);
        drop(active);
        self.changed.notify_waiters();
        Ok(result)
    }

    pub async fn status(&self, fault_id: &str) -> Option<E2ESurfaceFaultStatus> {
        let mut active = self.active.lock().await;
        let fault = active.as_mut()?;
        if fault.fault_id != fault_id {
            return None;
        }
        expire(fault);
        Some(status(fault))
    }

    pub(crate) async fn armed_action(
        &self,
        target: E2ESurfaceFaultTarget,
    ) -> Option<E2ESurfaceFaultAction> {
        let mut active = self.active.lock().await;
        let fault = active.as_mut()?;
        expire(fault);
        (fault.target == target && fault.state == E2ESurfaceFaultState::Armed)
            .then(|| fault.action.clone())
    }

    pub(crate) async fn intercept(
        &self,
        target: E2ESurfaceFaultTarget,
    ) -> Option<E2ESurfaceFaultEffect> {
        let (action, deadline) = {
            let mut active = self.active.lock().await;
            let fault = active.as_mut()?;
            expire(fault);
            if fault.target != target || fault.state != E2ESurfaceFaultState::Armed {
                return None;
            }
            fault.state = E2ESurfaceFaultState::Intercepted;
            let action = fault.action.clone();
            let deadline = fault.deadline;
            if action != E2ESurfaceFaultAction::Hold {
                fault.state = E2ESurfaceFaultState::Triggered;
            }
            drop(active);
            self.changed.notify_waiters();
            (action, deadline)
        };
        match action {
            E2ESurfaceFaultAction::Hold => {
                self.wait_for_release(deadline).await;
                Some(E2ESurfaceFaultEffect::Continue)
            }
            E2ESurfaceFaultAction::Fail { marker } => Some(E2ESurfaceFaultEffect::Fail(marker)),
            E2ESurfaceFaultAction::NotFound => Some(E2ESurfaceFaultEffect::NotFound),
            E2ESurfaceFaultAction::ReplayUnavailable => {
                Some(E2ESurfaceFaultEffect::ReplayUnavailable)
            }
            E2ESurfaceFaultAction::InvalidCursor => Some(E2ESurfaceFaultEffect::InvalidCursor),
            E2ESurfaceFaultAction::Retry { retry_after_ms } => {
                Some(E2ESurfaceFaultEffect::VoiceRetry(retry_after_ms))
            }
            E2ESurfaceFaultAction::Result { marker } => {
                Some(E2ESurfaceFaultEffect::VoiceResult(marker))
            }
            E2ESurfaceFaultAction::Uncertain { marker } => {
                Some(E2ESurfaceFaultEffect::QueueUncertain(marker))
            }
            E2ESurfaceFaultAction::Expire {
                tunnel_id,
                owner_device_id,
            } => Some(E2ESurfaceFaultEffect::PortExpire {
                tunnel_id,
                owner_device_id,
            }),
        }
    }

    pub async fn release(&self, fault_id: &str) -> Option<E2ESurfaceFaultStatus> {
        let mut active = self.active.lock().await;
        let fault = active.as_mut()?;
        if fault.fault_id != fault_id {
            return None;
        }
        expire(fault);
        if fault.state != E2ESurfaceFaultState::TimedOut {
            fault.state = E2ESurfaceFaultState::Released;
        }
        let result = status(fault);
        drop(active);
        self.changed.notify_waiters();
        Some(result)
    }

    async fn wait_for_release(&self, deadline: Instant) {
        loop {
            let notified = self.changed.notified();
            {
                let mut active = self.active.lock().await;
                let Some(fault) = active.as_mut() else {
                    return;
                };
                expire(fault);
                if matches!(
                    fault.state,
                    E2ESurfaceFaultState::Released | E2ESurfaceFaultState::TimedOut
                ) {
                    return;
                }
            }
            if tokio::time::timeout_at(deadline.into(), notified)
                .await
                .is_err()
            {
                let mut active = self.active.lock().await;
                if let Some(fault) = active.as_mut() {
                    expire(fault);
                }
                self.changed.notify_waiters();
                return;
            }
        }
    }
}

fn validate_request(request: &E2ESurfaceFaultRequest) -> Result<(), &'static str> {
    let valid_action = match request.target {
        E2ESurfaceFaultTarget::ResourceList
        | E2ESurfaceFaultTarget::ResourceRefresh
        | E2ESurfaceFaultTarget::CatalogPage => request.action == E2ESurfaceFaultAction::Hold,
        E2ESurfaceFaultTarget::ResourceRead | E2ESurfaceFaultTarget::ChangeRead => {
            matches!(
                request.action,
                E2ESurfaceFaultAction::Hold | E2ESurfaceFaultAction::Fail { .. }
            )
        }
        E2ESurfaceFaultTarget::ThreadOpen => matches!(
            request.action,
            E2ESurfaceFaultAction::Hold
                | E2ESurfaceFaultAction::Fail { .. }
                | E2ESurfaceFaultAction::NotFound
        ),
        E2ESurfaceFaultTarget::HistoryPage | E2ESurfaceFaultTarget::AttachmentUpload => matches!(
            request.action,
            E2ESurfaceFaultAction::Hold | E2ESurfaceFaultAction::Fail { .. }
        ),
        E2ESurfaceFaultTarget::TerminalReplay => matches!(
            request.action,
            E2ESurfaceFaultAction::Hold
                | E2ESurfaceFaultAction::Fail { .. }
                | E2ESurfaceFaultAction::ReplayUnavailable
                | E2ESurfaceFaultAction::InvalidCursor
        ),
        E2ESurfaceFaultTarget::TerminalOpen
        | E2ESurfaceFaultTarget::TerminalChannel
        | E2ESurfaceFaultTarget::PortDiscovery
        | E2ESurfaceFaultTarget::PortCreate
        | E2ESurfaceFaultTarget::PortDelete
        | E2ESurfaceFaultTarget::TurnSubmit
        | E2ESurfaceFaultTarget::PairingExchange => matches!(
            request.action,
            E2ESurfaceFaultAction::Hold | E2ESurfaceFaultAction::Fail { .. }
        ),
        E2ESurfaceFaultTarget::QueueDispatch => {
            matches!(
                request.action,
                E2ESurfaceFaultAction::Fail { .. } | E2ESurfaceFaultAction::Uncertain { .. }
            )
        }
        E2ESurfaceFaultTarget::PortExpire => {
            matches!(request.action, E2ESurfaceFaultAction::Expire { .. })
        }
        E2ESurfaceFaultTarget::VoiceFinish => matches!(
            request.action,
            E2ESurfaceFaultAction::Hold
                | E2ESurfaceFaultAction::Fail { .. }
                | E2ESurfaceFaultAction::Retry {
                    retry_after_ms: 100..=10_000
                }
                | E2ESurfaceFaultAction::Result { .. }
        ),
    };
    if !valid_action {
        return Err("e2e_surface_fault_action_not_supported");
    }
    if matches!(
        &request.action,
        E2ESurfaceFaultAction::Fail { marker }
            | E2ESurfaceFaultAction::Result { marker }
            | E2ESurfaceFaultAction::Uncertain { marker }
            if !valid_marker(marker)
    ) {
        return Err("e2e_surface_fault_marker_invalid");
    }
    if matches!(
        &request.action,
        E2ESurfaceFaultAction::Expire {
            tunnel_id,
            owner_device_id,
        } if !valid_identifier(tunnel_id) || !valid_identifier(owner_device_id)
    ) {
        return Err("e2e_surface_fault_identifier_invalid");
    }
    Ok(())
}

fn valid_identifier(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b':'))
}

fn valid_marker(marker: &str) -> bool {
    let lowercase = marker.to_ascii_lowercase();
    !marker.is_empty()
        && marker.len() <= MAX_MARKER_BYTES
        && marker
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b':'))
        && ![
            "authorization:",
            "cookie:",
            "credential",
            "private_sentinel",
            "secret",
        ]
        .iter()
        .any(|sensitive| lowercase.contains(sensitive))
}

fn expire(fault: &mut ActiveFault) {
    if Instant::now() >= fault.deadline
        && !matches!(
            fault.state,
            E2ESurfaceFaultState::Triggered
                | E2ESurfaceFaultState::Released
                | E2ESurfaceFaultState::TimedOut
        )
    {
        fault.state = E2ESurfaceFaultState::TimedOut;
    }
}

fn status(fault: &ActiveFault) -> E2ESurfaceFaultStatus {
    E2ESurfaceFaultStatus {
        fault_id: fault.fault_id.clone(),
        target: fault.target,
        action: fault.action.clone(),
        state: fault.state,
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use super::*;

    fn request(
        target: E2ESurfaceFaultTarget,
        action: E2ESurfaceFaultAction,
    ) -> E2ESurfaceFaultRequest {
        E2ESurfaceFaultRequest { target, action }
    }

    #[test]
    fn request_wire_shape_uses_typed_camel_case_fields() {
        let parsed = serde_json::from_value::<E2ESurfaceFaultRequest>(serde_json::json!({
            "target": "voiceFinish",
            "action": {"kind": "retry", "retryAfterMs": 250}
        }));
        assert!(matches!(
            parsed,
            Ok(E2ESurfaceFaultRequest {
                target: E2ESurfaceFaultTarget::VoiceFinish,
                action: E2ESurfaceFaultAction::Retry {
                    retry_after_ms: 250
                }
            })
        ));
        let result = serde_json::from_value::<E2ESurfaceFaultRequest>(serde_json::json!({
            "target": "voiceFinish",
            "action": {"kind": "result", "marker": "voice-result-42"}
        }));
        assert!(matches!(
            result,
            Ok(E2ESurfaceFaultRequest {
                target: E2ESurfaceFaultTarget::VoiceFinish,
                action: E2ESurfaceFaultAction::Result { marker }
            }) if marker == "voice-result-42"
        ));
    }

    #[test]
    fn parity_targets_keep_a_closed_action_contract() {
        assert!(
            validate_request(&request(
                E2ESurfaceFaultTarget::CatalogPage,
                E2ESurfaceFaultAction::Hold,
            ))
            .is_ok()
        );
        assert!(
            validate_request(&request(
                E2ESurfaceFaultTarget::TurnSubmit,
                E2ESurfaceFaultAction::Fail {
                    marker: "turn-submit-42".into(),
                },
            ))
            .is_ok()
        );
        assert!(
            validate_request(&request(
                E2ESurfaceFaultTarget::ThreadOpen,
                E2ESurfaceFaultAction::NotFound,
            ))
            .is_ok()
        );
        assert_eq!(
            validate_request(&request(
                E2ESurfaceFaultTarget::HistoryPage,
                E2ESurfaceFaultAction::NotFound,
            )),
            Err("e2e_surface_fault_action_not_supported")
        );
        assert!(
            validate_request(&request(
                E2ESurfaceFaultTarget::VoiceFinish,
                E2ESurfaceFaultAction::Result {
                    marker: "voice-result-42".into(),
                },
            ))
            .is_ok()
        );
        assert!(
            validate_request(&request(
                E2ESurfaceFaultTarget::PortExpire,
                E2ESurfaceFaultAction::Expire {
                    tunnel_id: "0123456789abcdef".into(),
                    owner_device_id: "device-42".into(),
                },
            ))
            .is_ok()
        );
        assert_eq!(
            validate_request(&request(
                E2ESurfaceFaultTarget::TurnSubmit,
                E2ESurfaceFaultAction::Result {
                    marker: "not-allowed".into(),
                },
            )),
            Err("e2e_surface_fault_action_not_supported")
        );
        assert_eq!(
            validate_request(&request(
                E2ESurfaceFaultTarget::PortExpire,
                E2ESurfaceFaultAction::Expire {
                    tunnel_id: "../not-a-tunnel".into(),
                    owner_device_id: "device-42".into(),
                },
            )),
            Err("e2e_surface_fault_identifier_invalid")
        );
    }

    #[tokio::test]
    async fn hold_intercepts_exactly_one_matching_boundary_until_release() {
        let control = Arc::new(E2ESurfaceFaultControl::default());
        let armed = control
            .arm(
                "fault-a".into(),
                request(
                    E2ESurfaceFaultTarget::ResourceRead,
                    E2ESurfaceFaultAction::Hold,
                ),
            )
            .await;
        assert!(armed.is_ok());
        assert_eq!(
            control.intercept(E2ESurfaceFaultTarget::ChangeRead).await,
            None
        );

        let held = control.clone();
        let task =
            tokio::spawn(async move { held.intercept(E2ESurfaceFaultTarget::ResourceRead).await });
        loop {
            if control.status("fault-a").await.map(|status| status.state)
                == Some(E2ESurfaceFaultState::Intercepted)
            {
                break;
            }
            tokio::task::yield_now().await;
        }
        assert!(!task.is_finished());
        assert!(control.release("fault-a").await.is_some());
        assert!(matches!(
            task.await,
            Ok(Some(E2ESurfaceFaultEffect::Continue))
        ));
        assert_eq!(
            control.intercept(E2ESurfaceFaultTarget::ResourceRead).await,
            None
        );
    }

    #[tokio::test]
    async fn fail_is_one_shot_and_preserves_the_bounded_marker() {
        let control = E2ESurfaceFaultControl::default();
        let armed = control
            .arm(
                "fault-b".into(),
                request(
                    E2ESurfaceFaultTarget::PortCreate,
                    E2ESurfaceFaultAction::Fail {
                        marker: "port-create-42".into(),
                    },
                ),
            )
            .await;
        assert!(armed.is_ok());
        assert_eq!(
            control.intercept(E2ESurfaceFaultTarget::PortCreate).await,
            Some(E2ESurfaceFaultEffect::Fail("port-create-42".into()))
        );
        assert_eq!(
            control.status("fault-b").await.map(|status| status.state),
            Some(E2ESurfaceFaultState::Triggered)
        );
        assert_eq!(
            control.intercept(E2ESurfaceFaultTarget::PortCreate).await,
            None
        );
    }

    #[tokio::test]
    async fn invalid_target_action_pairs_and_unsafe_markers_are_rejected() {
        let control = E2ESurfaceFaultControl::default();
        assert!(matches!(
            control
                .arm(
                    "fault-c".into(),
                    request(
                        E2ESurfaceFaultTarget::ResourceList,
                        E2ESurfaceFaultAction::ReplayUnavailable,
                    ),
                )
                .await,
            Err("e2e_surface_fault_action_not_supported")
        ));
        assert!(matches!(
            control
                .arm(
                    "fault-d".into(),
                    request(
                        E2ESurfaceFaultTarget::ChangeRead,
                        E2ESurfaceFaultAction::Fail {
                            marker: "secret-marker".into(),
                        },
                    ),
                )
                .await,
            Err("e2e_surface_fault_marker_invalid")
        ));
    }

    #[tokio::test]
    async fn voice_finish_retry_is_typed_and_bounded() {
        let control = E2ESurfaceFaultControl::default();
        let armed = control
            .arm(
                "voice-fault".into(),
                request(
                    E2ESurfaceFaultTarget::VoiceFinish,
                    E2ESurfaceFaultAction::Retry {
                        retry_after_ms: 250,
                    },
                ),
            )
            .await;
        assert!(armed.is_ok());
        assert_eq!(
            control.intercept(E2ESurfaceFaultTarget::VoiceFinish).await,
            Some(E2ESurfaceFaultEffect::VoiceRetry(250))
        );

        assert!(matches!(
            control
                .arm(
                    "voice-invalid".into(),
                    request(
                        E2ESurfaceFaultTarget::VoiceFinish,
                        E2ESurfaceFaultAction::Retry {
                            retry_after_ms: 10_001,
                        },
                    ),
                )
                .await,
            Err("e2e_surface_fault_action_not_supported")
        ));
    }

    #[tokio::test]
    async fn thread_not_found_is_typed_and_one_shot() -> Result<(), &'static str> {
        let control = E2ESurfaceFaultControl::default();
        control
            .arm(
                "thread-missing".into(),
                request(
                    E2ESurfaceFaultTarget::ThreadOpen,
                    E2ESurfaceFaultAction::NotFound,
                ),
            )
            .await?;
        assert_eq!(
            control.intercept(E2ESurfaceFaultTarget::ThreadOpen).await,
            Some(E2ESurfaceFaultEffect::NotFound)
        );
        assert_eq!(
            control.intercept(E2ESurfaceFaultTarget::ThreadOpen).await,
            None
        );
        Ok(())
    }
}
