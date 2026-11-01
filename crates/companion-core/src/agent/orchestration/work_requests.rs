//! Child work requests: the unit of child-agent result delivery.
//!
//! One request exists per `spawn_agent`, per `delegate_task` and per queued
//! `send_agent`; a steer joins the running request and creates none. A
//! request is created in the same transaction as its prompt-bearing outbox
//! command, bound to its provider turn only by that command's delivery
//! receipt, settled once the turn (or its absence) is known, and then handed
//! to the parent exactly once as a model-only notice, acknowledged by a
//! terminal wait, or suppressed because the parent is gone.
//!
//! Records are prompt-free coordination metadata. The child's final text
//! stays in provider history and the notice text in the turn outbox.

use serde::{Deserialize, Serialize};

use super::task::{DeliveryId, TaskId, is_uuid_v4, random_uuid_v4};
use crate::agent::{
    client_wire::observe::TurnEnd,
    model::{AppThreadId, ProviderId, TurnId},
};

/// Durable identity of one child work request.
#[derive(Clone, Debug, Deserialize, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(transparent)]
pub struct WorkRequestId(String);

impl WorkRequestId {
    #[must_use]
    pub fn new() -> Self {
        Self(random_uuid_v4())
    }

    #[must_use]
    pub fn parse(value: &str) -> Option<Self> {
        is_uuid_v4(value).then(|| Self(value.to_owned()))
    }

    /// A task's initial request reuses its durable delivery id, so a migrated
    /// task and a new one name their first request the same way.
    #[must_use]
    pub fn from_delivery(delivery_id: &DeliveryId) -> Self {
        Self(delivery_id.as_str().to_owned())
    }

    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl Default for WorkRequestId {
    fn default() -> Self {
        Self::new()
    }
}

/// Which tool call created the request.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum RequestOrigin {
    /// The first turn of a task admitted by `delegate_task` or `spawn_agent`.
    TaskInitial { task_id: TaskId },
    /// A queued `send_agent` follow-up.
    Followup,
}

/// How a started turn ended, after cancel attribution.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum RunOutcome {
    Completed,
    Failed,
    /// A user or system interrupt.
    Interrupted,
    /// An interrupt the parent requested.
    Cancelled,
}

/// Why a request never reached a provider turn.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum NeverStartedReason {
    CancelledByParent,
    DispatchFailed,
    ChildGone,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(
    tag = "settlement",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum Settlement {
    Ran {
        turn_id: TurnId,
        outcome: RunOutcome,
    },
    NeverStarted {
        reason: NeverStartedReason,
    },
}

/// Who took the result before or instead of a pushed notice.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum AckSource {
    WaitAgent,
    WaitTask,
    /// The parent's own cancel call observed the terminal state in time.
    Cancel,
    /// A legacy fallback delivery that was already terminal before migration.
    Migration,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SuppressReason {
    ParentDeleted,
    ParentArchived,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(
    tag = "delivery",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum Delivery {
    /// Settled, not yet handed to the parent. `next_attempt_at_ms` delays the
    /// handoff (unreadable history, or a cancel call that may still take it).
    AwaitingHandoff {
        next_attempt_at_ms: u64,
        attempts: u32,
    },
    /// Ownership moved atomically to one parent notice in the turn outbox.
    Enqueued {
        parent_command_id: String,
    },
    Acknowledged {
        by: AckSource,
    },
    Suppressed {
        reason: SuppressReason,
    },
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(
    tag = "phase",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum RequestPhase {
    /// The command waits in the outbox (or its reservation) for dispatch.
    Queued,
    Running {
        turn_id: TurnId,
    },
    /// The parent asked to cancel; `turn_id` is absent while the command has
    /// not been dispatched.
    CancelRequested {
        turn_id: Option<TurnId>,
    },
    Settled {
        settlement: Settlement,
        delivery: Delivery,
        settled_at_ms: u64,
    },
}

/// One child work request. The child is absent only while a task's child
/// thread has not been created yet.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChildWorkRequest {
    pub request_id: WorkRequestId,
    pub parent_thread_id: AppThreadId,
    pub child_thread_id: Option<AppThreadId>,
    pub provider: ProviderId,
    /// The outbox command whose delivery receipt binds this request.
    pub command_id: String,
    pub origin: RequestOrigin,
    /// The parent notice command id used when this request leads a notice.
    pub dedupe_key: String,
    pub phase: RequestPhase,
    pub created_at_ms: u64,
    pub updated_at_ms: u64,
}

/// How long a newly settled result stays with its likely taker before it is
/// pushed.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct SettleHold {
    /// A `wait_agent` was waiting on the child when the turn ended.
    pub waiter_ms: u64,
    /// Applies only after a parent cancel request.
    pub cancel_ms: u64,
}

impl SettleHold {
    pub const NONE: Self = Self {
        waiter_ms: 0,
        cancel_ms: 0,
    };
}

/// A transition that cannot apply to the current request state.
#[derive(Debug, thiserror::Error, Eq, PartialEq)]
#[error("work request transition is invalid: {0}")]
pub struct RequestTransitionError(String);

impl ChildWorkRequest {
    /// A new queued request.
    #[must_use]
    pub fn queued(
        request_id: WorkRequestId,
        parent_thread_id: AppThreadId,
        child_thread_id: Option<AppThreadId>,
        provider: ProviderId,
        command_id: String,
        origin: RequestOrigin,
        now_ms: u64,
    ) -> Self {
        let dedupe_key = format!("request-notice:{}", request_id.as_str());
        Self {
            request_id,
            parent_thread_id,
            child_thread_id,
            provider,
            command_id,
            origin,
            dedupe_key,
            phase: RequestPhase::Queued,
            created_at_ms: now_ms,
            updated_at_ms: now_ms,
        }
    }

    #[must_use]
    pub const fn task_id(&self) -> Option<&TaskId> {
        match &self.origin {
            RequestOrigin::TaskInitial { task_id } => Some(task_id),
            RequestOrigin::Followup => None,
        }
    }

    /// Whether the request still waits for its turn to start or end.
    #[must_use]
    pub const fn is_open(&self) -> bool {
        !matches!(self.phase, RequestPhase::Settled { .. })
    }

    /// Whether a settled result still waits for its parent handoff.
    #[must_use]
    pub const fn awaits_handoff(&self) -> bool {
        matches!(
            self.phase,
            RequestPhase::Settled {
                delivery: Delivery::AwaitingHandoff { .. },
                ..
            }
        )
    }

    /// The provider turn the request runs or ran in, when known.
    #[must_use]
    pub const fn turn_id(&self) -> Option<&TurnId> {
        match &self.phase {
            RequestPhase::Running { turn_id }
            | RequestPhase::CancelRequested {
                turn_id: Some(turn_id),
            }
            | RequestPhase::Settled {
                settlement: Settlement::Ran { turn_id, .. },
                ..
            } => Some(turn_id),
            _ => None,
        }
    }

    /// Records the child thread once it exists.
    ///
    /// # Errors
    /// Returns an error when the request already belongs to another child.
    pub fn attach_child(&mut self, child: &AppThreadId) -> Result<bool, RequestTransitionError> {
        match &self.child_thread_id {
            Some(known) if known == child => Ok(false),
            Some(_) => Err(RequestTransitionError(
                "request already belongs to another child thread".into(),
            )),
            None => {
                self.child_thread_id = Some(child.clone());
                Ok(true)
            }
        }
    }

    /// Binds the request to the provider turn named by its own command's
    /// delivery receipt. Repeating the same receipt is a no-op.
    ///
    /// # Errors
    /// Returns an error when the request already belongs to another turn or child.
    pub fn bind_turn(
        &mut self,
        child: &AppThreadId,
        turn_id: TurnId,
    ) -> Result<bool, RequestTransitionError> {
        let attached = self.attach_child(child)?;
        let phase = match &self.phase {
            RequestPhase::Queued => RequestPhase::Running { turn_id },
            RequestPhase::CancelRequested { turn_id: None } => RequestPhase::CancelRequested {
                turn_id: Some(turn_id),
            },
            RequestPhase::Running { turn_id: known }
            | RequestPhase::CancelRequested {
                turn_id: Some(known),
            } => {
                return if known == &turn_id {
                    Ok(attached)
                } else {
                    Err(RequestTransitionError(
                        "request already belongs to another provider turn".into(),
                    ))
                };
            }
            RequestPhase::Settled { .. } => return Ok(attached),
        };
        self.phase = phase;
        Ok(true)
    }

    /// Records the parent's cancel intent. A settled request is unchanged.
    pub fn request_cancel(&mut self) -> bool {
        let phase = match &self.phase {
            RequestPhase::Queued => RequestPhase::CancelRequested { turn_id: None },
            RequestPhase::Running { turn_id } => RequestPhase::CancelRequested {
                turn_id: Some(turn_id.clone()),
            },
            RequestPhase::CancelRequested { .. } | RequestPhase::Settled { .. } => return false,
        };
        self.phase = phase;
        true
    }

    /// Settles a request whose bound turn ended. A completed turn wins over a
    /// racing cancel; an interrupt after a parent cancel is `cancelled`, any
    /// other interrupt is `interrupted`. The handoff waits `hold_ms` (a
    /// waiting `wait_agent` may take the result first) or, after a parent
    /// cancel, at least `cancel_hold_ms` (the cancel call may take it).
    pub fn settle_turn(
        &mut self,
        turn_id: &TurnId,
        end: TurnEnd,
        now_ms: u64,
        hold: SettleHold,
    ) -> bool {
        let cancel_requested = match &self.phase {
            RequestPhase::Running { turn_id: known } if known == turn_id => false,
            RequestPhase::CancelRequested {
                turn_id: Some(known),
            } if known == turn_id => true,
            _ => return false,
        };
        let outcome = match (end, cancel_requested) {
            (TurnEnd::Completed, _) => RunOutcome::Completed,
            (TurnEnd::Failed, _) => RunOutcome::Failed,
            (TurnEnd::Interrupted, true) => RunOutcome::Cancelled,
            (TurnEnd::Interrupted, false) => RunOutcome::Interrupted,
        };
        let hold_ms = if cancel_requested {
            hold.waiter_ms.max(hold.cancel_ms)
        } else {
            hold.waiter_ms
        };
        let next_attempt_at_ms = now_ms.saturating_add(hold_ms);
        self.phase = RequestPhase::Settled {
            settlement: Settlement::Ran {
                turn_id: turn_id.clone(),
                outcome,
            },
            delivery: Delivery::AwaitingHandoff {
                next_attempt_at_ms,
                attempts: 0,
            },
            settled_at_ms: now_ms,
        };
        self.updated_at_ms = now_ms;
        true
    }

    /// Settles a request that never got a provider turn (or whose child
    /// vanished). A parent-cancelled request is acknowledged by that cancel.
    pub fn settle_never_started(&mut self, reason: NeverStartedReason, now_ms: u64) -> bool {
        let started = match &self.phase {
            RequestPhase::Queued | RequestPhase::CancelRequested { turn_id: None } => false,
            RequestPhase::Running { .. } | RequestPhase::CancelRequested { turn_id: Some(_) } => {
                true
            }
            RequestPhase::Settled { .. } => return false,
        };
        // Only a missing child can end a request whose turn already started
        // without that turn's own terminal fact.
        if started && reason != NeverStartedReason::ChildGone {
            return false;
        }
        let delivery = if reason == NeverStartedReason::CancelledByParent {
            Delivery::Acknowledged {
                by: AckSource::Cancel,
            }
        } else {
            Delivery::AwaitingHandoff {
                next_attempt_at_ms: now_ms,
                attempts: 0,
            }
        };
        self.phase = RequestPhase::Settled {
            settlement: Settlement::NeverStarted { reason },
            delivery,
            settled_at_ms: now_ms,
        };
        self.updated_at_ms = now_ms;
        true
    }

    fn delivery_mut(&mut self) -> Option<&mut Delivery> {
        match &mut self.phase {
            RequestPhase::Settled { delivery, .. } => Some(delivery),
            _ => None,
        }
    }

    /// Postpones a handoff whose result is temporarily unreadable.
    pub fn defer_handoff(&mut self, next_attempt_at_ms: u64) -> bool {
        let Some(Delivery::AwaitingHandoff {
            next_attempt_at_ms: due,
            attempts,
        }) = self.delivery_mut()
        else {
            return false;
        };
        *due = next_attempt_at_ms;
        *attempts = attempts.saturating_add(1);
        true
    }

    /// Transfers delivery ownership to one parent notice command.
    pub fn hand_off(&mut self, parent_command_id: &str) -> bool {
        let Some(delivery) = self.delivery_mut() else {
            return false;
        };
        if !matches!(delivery, Delivery::AwaitingHandoff { .. }) {
            return false;
        }
        *delivery = Delivery::Enqueued {
            parent_command_id: parent_command_id.to_owned(),
        };
        true
    }

    /// Returns a request whose notice was retracted or rejected before it
    /// reached the parent back to the handoff queue.
    pub fn return_to_handoff(&mut self, now_ms: u64) -> bool {
        let Some(delivery) = self.delivery_mut() else {
            return false;
        };
        if !matches!(delivery, Delivery::Enqueued { .. }) {
            return false;
        }
        *delivery = Delivery::AwaitingHandoff {
            next_attempt_at_ms: now_ms,
            attempts: 0,
        };
        true
    }

    /// Acknowledges a settled result. Returns the delivery it replaced so the
    /// caller can retract a still-queued notice.
    pub fn acknowledge(&mut self, by: AckSource) -> Option<Delivery> {
        let delivery = self.delivery_mut()?;
        if !matches!(
            delivery,
            Delivery::AwaitingHandoff { .. } | Delivery::Enqueued { .. }
        ) {
            return None;
        }
        Some(std::mem::replace(delivery, Delivery::Acknowledged { by }))
    }

    /// Drops a pending handoff because its parent can no longer take it.
    pub fn suppress(&mut self, reason: SuppressReason) -> bool {
        let Some(delivery) = self.delivery_mut() else {
            return false;
        };
        if !matches!(delivery, Delivery::AwaitingHandoff { .. }) {
            return false;
        }
        *delivery = Delivery::Suppressed { reason };
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request() -> ChildWorkRequest {
        ChildWorkRequest::queued(
            WorkRequestId::new(),
            AppThreadId::from_static("parent"),
            Some(AppThreadId::from_static("child")),
            ProviderId::from_static("codex"),
            "agent-send-1".into(),
            RequestOrigin::Followup,
            10,
        )
    }

    fn running(turn: &'static str) -> ChildWorkRequest {
        let mut request = request();
        assert_eq!(
            request.bind_turn(
                &AppThreadId::from_static("child"),
                TurnId::from_static(turn)
            ),
            Ok(true)
        );
        request
    }

    #[test]
    fn a_receipt_binds_once_and_a_second_turn_is_rejected() {
        let mut request = running("turn-1");
        assert_eq!(
            request.bind_turn(
                &AppThreadId::from_static("child"),
                TurnId::from_static("turn-1")
            ),
            Ok(false)
        );
        assert!(
            request
                .bind_turn(
                    &AppThreadId::from_static("child"),
                    TurnId::from_static("turn-2")
                )
                .is_err()
        );
        assert!(
            request
                .bind_turn(
                    &AppThreadId::from_static("other"),
                    TurnId::from_static("turn-1")
                )
                .is_err()
        );
    }

    #[test]
    fn interrupt_attribution_follows_the_parent_cancel_and_completion_wins() {
        let turn = TurnId::from_static("turn-1");
        let mut interrupted = running("turn-1");
        assert!(interrupted.settle_turn(&turn, TurnEnd::Interrupted, 20, SettleHold::NONE));
        assert!(matches!(
            interrupted.phase,
            RequestPhase::Settled {
                settlement: Settlement::Ran {
                    outcome: RunOutcome::Interrupted,
                    ..
                },
                ..
            }
        ));

        let mut cancelled = running("turn-1");
        assert!(cancelled.request_cancel());
        let cancel_hold = SettleHold {
            waiter_ms: 0,
            cancel_ms: 500,
        };
        assert!(cancelled.settle_turn(&turn, TurnEnd::Interrupted, 20, cancel_hold));
        assert!(matches!(
            cancelled.phase,
            RequestPhase::Settled {
                settlement: Settlement::Ran {
                    outcome: RunOutcome::Cancelled,
                    ..
                },
                delivery: Delivery::AwaitingHandoff {
                    next_attempt_at_ms: 520,
                    ..
                },
                ..
            }
        ));

        let mut raced = running("turn-1");
        raced.request_cancel();
        assert!(raced.settle_turn(&turn, TurnEnd::Completed, 20, cancel_hold));
        assert!(matches!(
            raced.phase,
            RequestPhase::Settled {
                settlement: Settlement::Ran {
                    outcome: RunOutcome::Completed,
                    ..
                },
                ..
            }
        ));
        assert!(!raced.settle_turn(&turn, TurnEnd::Failed, 30, SettleHold::NONE));
    }

    #[test]
    fn a_foreign_turn_end_does_not_settle() {
        let mut request = running("turn-1");
        assert!(!request.settle_turn(
            &TurnId::from_static("turn-2"),
            TurnEnd::Completed,
            20,
            SettleHold::NONE
        ));
        assert!(request.is_open());
    }

    #[test]
    fn delivery_is_handed_off_or_acknowledged_once() {
        let turn = TurnId::from_static("turn-1");
        let mut request = running("turn-1");
        assert!(request.acknowledge(AckSource::WaitAgent).is_none());
        request.settle_turn(&turn, TurnEnd::Completed, 20, SettleHold::NONE);
        assert!(request.awaits_handoff());
        assert!(request.defer_handoff(40));
        assert!(request.hand_off("notice-1"));
        assert!(!request.hand_off("notice-2"));
        assert!(!request.suppress(SuppressReason::ParentDeleted));
        assert_eq!(
            request.acknowledge(AckSource::WaitAgent),
            Some(Delivery::Enqueued {
                parent_command_id: "notice-1".into()
            })
        );
        assert!(request.acknowledge(AckSource::WaitTask).is_none());
        assert!(!request.return_to_handoff(50));
    }

    #[test]
    fn never_started_requests_settle_without_a_turn() {
        let mut cancelled = request();
        assert!(cancelled.settle_never_started(NeverStartedReason::CancelledByParent, 20));
        assert!(matches!(
            cancelled.phase,
            RequestPhase::Settled {
                delivery: Delivery::Acknowledged {
                    by: AckSource::Cancel
                },
                ..
            }
        ));
        let mut started = running("turn-1");
        assert!(!started.settle_never_started(NeverStartedReason::DispatchFailed, 20));
        assert!(started.settle_never_started(NeverStartedReason::ChildGone, 20));
        assert!(started.awaits_handoff());
    }

    // The persisted request encoding is the journal's durable format. A
    // decoded record must round-trip unchanged so restarts never reinterpret
    // a request.
    #[test]
    fn persisted_requests_round_trip() -> Result<(), serde_json::Error> {
        let mut request = running("turn-1");
        request.settle_turn(
            &TurnId::from_static("turn-1"),
            TurnEnd::Failed,
            30,
            SettleHold::NONE,
        );
        request.hand_off("notice-1");
        let encoded = serde_json::to_value(&request)?;
        assert_eq!(encoded["phase"]["phase"], "settled");
        assert_eq!(encoded["phase"]["settlement"]["settlement"], "ran");
        assert_eq!(encoded["phase"]["delivery"]["delivery"], "enqueued");
        let decoded: ChildWorkRequest = serde_json::from_value(encoded)?;
        assert_eq!(decoded, request);
        Ok(())
    }
}
