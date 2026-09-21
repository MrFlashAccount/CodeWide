//! E2E-only deterministic command lifecycle fault control.

use std::time::{Duration, Instant};

use serde::Serialize;
use tokio::sync::{Mutex, Notify};

use super::scalar::OperationId;

// Appium cold-start + route remount on an emulator can consume most of a minute.
// Keep the private fault bounded while leaving enough time to observe the
// persisted correlation before the fail-safe releases the live boundary.
const FAULT_TIMEOUT: Duration = Duration::from_mins(3);

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum E2ECommandFaultState {
    Armed,
    NextCommandIntercepted,
    ReinitializeSent,
    NextLiveHeld,
    Released,
    TimedOut,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct E2ECommandFaultStatus {
    pub fault_id: String,
    pub state: E2ECommandFaultState,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub operation_id: Option<String>,
}

#[derive(Debug)]
struct ActiveFault {
    fault_id: String,
    state: E2ECommandFaultState,
    operation_id: Option<String>,
    deadline: Instant,
}

#[derive(Debug, Default)]
pub struct E2ECommandFaultControl {
    active: Mutex<Option<ActiveFault>>,
    changed: Notify,
}

impl E2ECommandFaultControl {
    pub async fn arm(&self, fault_id: String) -> Result<E2ECommandFaultStatus, &'static str> {
        let mut active = self.active.lock().await;
        if active.as_ref().is_some_and(|fault| {
            !matches!(
                fault.state,
                E2ECommandFaultState::Released | E2ECommandFaultState::TimedOut
            )
        }) {
            return Err("e2e_command_fault_already_active");
        }
        let fault = ActiveFault {
            fault_id,
            state: E2ECommandFaultState::Armed,
            operation_id: None,
            deadline: Instant::now() + FAULT_TIMEOUT,
        };
        let result = status(&fault);
        *active = Some(fault);
        drop(active);
        self.changed.notify_waiters();
        Ok(result)
    }

    pub async fn status(&self, fault_id: &str) -> Option<E2ECommandFaultStatus> {
        let mut active = self.active.lock().await;
        let fault = active.as_mut()?;
        if fault.fault_id != fault_id {
            return None;
        }
        expire(fault);
        Some(status(fault))
    }

    pub async fn intercept(&self, operation_id: &OperationId) -> Option<String> {
        let mut active = self.active.lock().await;
        let fault = active.as_mut()?;
        expire(fault);
        if fault.state != E2ECommandFaultState::Armed {
            return None;
        }
        fault.state = E2ECommandFaultState::NextCommandIntercepted;
        fault.operation_id = Some(operation_id.as_str().to_owned());
        let fault_id = fault.fault_id.clone();
        drop(active);
        self.changed.notify_waiters();
        Some(fault_id)
    }

    pub async fn mark_reinitialize_sent(&self, fault_id: &str) {
        self.transition(
            fault_id,
            E2ECommandFaultState::NextCommandIntercepted,
            E2ECommandFaultState::ReinitializeSent,
        )
        .await;
    }

    pub async fn hold_next_live(&self) {
        let deadline = {
            let mut active = self.active.lock().await;
            let Some(fault) = active.as_mut() else {
                return;
            };
            expire(fault);
            if fault.state == E2ECommandFaultState::ReinitializeSent {
                fault.state = E2ECommandFaultState::NextLiveHeld;
            } else if fault.state != E2ECommandFaultState::NextLiveHeld {
                return;
            }
            let deadline = fault.deadline;
            drop(active);
            self.changed.notify_waiters();
            deadline
        };
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
                    E2ECommandFaultState::Released | E2ECommandFaultState::TimedOut
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

    pub async fn release(&self, fault_id: &str) -> Option<E2ECommandFaultStatus> {
        let mut active = self.active.lock().await;
        let fault = active.as_mut()?;
        if fault.fault_id != fault_id {
            return None;
        }
        expire(fault);
        if fault.state != E2ECommandFaultState::TimedOut {
            fault.state = E2ECommandFaultState::Released;
        }
        let result = status(fault);
        drop(active);
        self.changed.notify_waiters();
        Some(result)
    }

    async fn transition(
        &self,
        fault_id: &str,
        expected: E2ECommandFaultState,
        next: E2ECommandFaultState,
    ) {
        let mut active = self.active.lock().await;
        let Some(fault) = active.as_mut() else {
            return;
        };
        expire(fault);
        if fault.fault_id == fault_id && fault.state == expected {
            fault.state = next;
            drop(active);
            self.changed.notify_waiters();
        }
    }
}

fn expire(fault: &mut ActiveFault) {
    if Instant::now() >= fault.deadline
        && !matches!(
            fault.state,
            E2ECommandFaultState::Released | E2ECommandFaultState::TimedOut
        )
    {
        fault.state = E2ECommandFaultState::TimedOut;
    }
}

fn status(fault: &ActiveFault) -> E2ECommandFaultStatus {
    E2ECommandFaultStatus {
        fault_id: fault.fault_id.clone(),
        state: fault.state,
        operation_id: fault.operation_id.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn one_shot_fault_holds_every_reconnecting_live_boundary_until_release()
    -> Result<(), Box<dyn std::error::Error>> {
        let control = std::sync::Arc::new(E2ECommandFaultControl::default());
        let armed = control.arm("fault-a".into()).await?;
        assert_eq!(armed.state, E2ECommandFaultState::Armed);
        let operation = OperationId::new("operation-a")?;
        let fault_id = control.intercept(&operation).await.ok_or("intercept")?;
        control.mark_reinitialize_sent(&fault_id).await;
        let held = control.clone();
        let task = tokio::spawn(async move { held.hold_next_live().await });
        loop {
            let state = control.status(&fault_id).await.ok_or("status")?;
            if state.state == E2ECommandFaultState::NextLiveHeld {
                assert_eq!(state.operation_id.as_deref(), Some("operation-a"));
                break;
            }
            tokio::task::yield_now().await;
        }
        let reconnected = control.clone();
        let second_task = tokio::spawn(async move { reconnected.hold_next_live().await });
        tokio::task::yield_now().await;
        assert!(!second_task.is_finished());
        control.release(&fault_id).await.ok_or("release")?;
        task.await?;
        second_task.await?;
        Ok(())
    }
}
