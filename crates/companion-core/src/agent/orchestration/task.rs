//! Durable orchestration task domain types.
//!
//! Tasks describe the caller-visible lifecycle. Attempts describe the one
//! provider execution selected by the task, while completion delivery is a
//! separate state machine. Keeping the three discriminated unions separate
//! prevents a failed notification from rewriting an already terminal task.

use rand::Rng;
use serde::{Deserialize, Serialize};

use crate::agent::model::{AppThreadId, ProviderCost, ProviderId, TurnId};

macro_rules! durable_id {
    ($name:ident) => {
        #[derive(Clone, Debug, Deserialize, Eq, Hash, PartialEq, Serialize)]
        #[serde(transparent)]
        pub struct $name(String);

        impl $name {
            #[must_use]
            pub fn new() -> Self {
                Self(random_uuid_v4())
            }

            #[must_use]
            pub fn parse(value: &str) -> Option<Self> {
                is_uuid_v4(value).then(|| Self(value.to_owned()))
            }

            #[must_use]
            pub fn as_str(&self) -> &str {
                &self.0
            }
        }

        impl Default for $name {
            fn default() -> Self {
                Self::new()
            }
        }
    };
}

durable_id!(TaskId);
durable_id!(AttemptId);
durable_id!(DeliveryId);
durable_id!(WorkspaceClaimId);

fn random_uuid_v4() -> String {
    let mut bytes: [u8; 16] = rand::rng().random();
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    let encoded = hex::encode(bytes);
    format!(
        "{}-{}-{}-{}-{}",
        &encoded[0..8],
        &encoded[8..12],
        &encoded[12..16],
        &encoded[16..20],
        &encoded[20..32]
    )
}

fn is_uuid_v4(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() == 36
        && bytes[8] == b'-'
        && bytes[13] == b'-'
        && bytes[18] == b'-'
        && bytes[23] == b'-'
        && bytes[14] == b'4'
        && matches!(bytes[19], b'8' | b'9' | b'a' | b'b' | b'A' | b'B')
        && bytes
            .iter()
            .enumerate()
            .all(|(index, byte)| matches!(index, 8 | 13 | 18 | 23) || byte.is_ascii_hexdigit())
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum WaitMode {
    Blocking,
    Deferred,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum WorkspaceMode {
    SharedReadOnly,
    IsolatedWrite,
    /// Shared cwd with inherited permissions; legacy spelling kept on disk.
    LegacyShared,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum TaskState {
    Admitted,
    PreparingWorkspace,
    Starting,
    ReconcilingStart,
    Running,
    Cancelling,
    Succeeded,
    Failed,
    Cancelled,
}

impl TaskState {
    #[must_use]
    pub const fn is_terminal(self) -> bool {
        matches!(self, Self::Succeeded | Self::Failed | Self::Cancelled)
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum TaskTransition {
    PrepareWorkspace,
    WorkspaceReady,
    ChildBound,
    TurnQueued,
    StartUncertain,
    TurnStarted,
    CancelRequested,
    CancelledBeforeStart,
    Succeeded,
    Failed,
    Cancelled,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(
    tag = "state",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum AttemptState {
    Admitted,
    ChildPlanned {
        child_thread_id: AppThreadId,
    },
    CreatingProviderMinted,
    ChildBound {
        child_thread_id: AppThreadId,
    },
    Started {
        child_thread_id: AppThreadId,
        provider_turn_id: TurnId,
    },
    StartUncertain {
        child_thread_id: Option<AppThreadId>,
    },
    Terminal {
        child_thread_id: AppThreadId,
        provider_turn_id: TurnId,
    },
}

impl AttemptState {
    #[must_use]
    pub const fn child_thread_id(&self) -> Option<&AppThreadId> {
        match self {
            Self::Admitted | Self::CreatingProviderMinted => None,
            Self::ChildPlanned { child_thread_id }
            | Self::ChildBound { child_thread_id }
            | Self::Started {
                child_thread_id, ..
            }
            | Self::Terminal {
                child_thread_id, ..
            } => Some(child_thread_id),
            Self::StartUncertain { child_thread_id } => child_thread_id.as_ref(),
        }
    }

    #[must_use]
    pub const fn provider_turn_id(&self) -> Option<&TurnId> {
        match self {
            Self::Started {
                provider_turn_id, ..
            }
            | Self::Terminal {
                provider_turn_id, ..
            } => Some(provider_turn_id),
            _ => None,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionEnvelope {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub execution_policy: Option<crate::agent::provider::ExecutionPolicy>,
    pub parent_ceiling: String,
    pub requested_profile: Option<String>,
    pub translated_profile: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(
    tag = "state",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum WorkspaceClaimState {
    Shared {
        effective_cwd: String,
    },
    Pending {
        source_workspace: String,
    },
    Ready {
        source_workspace: String,
        effective_cwd: String,
    },
    Failed {
        source_workspace: String,
        error: String,
    },
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceClaim {
    pub claim_id: WorkspaceClaimId,
    pub mode: WorkspaceMode,
    pub state: WorkspaceClaimState,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OrchestrationTask {
    pub task_id: TaskId,
    pub parent_thread_id: AppThreadId,
    pub root_thread_id: AppThreadId,
    pub provenance: HostProvenance,
    pub wait_mode: WaitMode,
    pub workspace_mode: WorkspaceMode,
    pub state: TaskState,
    pub authoritative_attempt_id: AttemptId,
    pub delivery_id: DeliveryId,
    pub provider: ProviderId,
    pub model: String,
    pub name: Option<String>,
    pub permission: PermissionEnvelope,
    pub workspace_claim_id: WorkspaceClaimId,
    pub created_at_ms: u64,
    pub updated_at_ms: u64,
}

impl OrchestrationTask {
    /// Applies one lifecycle transition. Replayed facts and late facts that
    /// cannot change the authoritative state are idempotent no-ops.
    ///
    /// # Errors
    /// Returns an error when the transition is not valid from the current state.
    pub fn transition(&mut self, transition: TaskTransition) -> Result<bool, String> {
        let next = match (self.state, transition) {
            (state, _) if state.is_terminal() => state,
            (TaskState::Admitted, TaskTransition::PrepareWorkspace) => {
                TaskState::PreparingWorkspace
            }
            (
                TaskState::Admitted | TaskState::PreparingWorkspace,
                TaskTransition::WorkspaceReady,
            )
            | (
                TaskState::Admitted
                | TaskState::PreparingWorkspace
                | TaskState::Starting
                | TaskState::ReconcilingStart,
                TaskTransition::ChildBound | TaskTransition::TurnQueued,
            ) => TaskState::Starting,
            (
                TaskState::Admitted
                | TaskState::PreparingWorkspace
                | TaskState::Starting
                | TaskState::ReconcilingStart,
                TaskTransition::StartUncertain,
            ) => TaskState::ReconcilingStart,
            (
                TaskState::Starting | TaskState::Running | TaskState::ReconcilingStart,
                TaskTransition::TurnStarted,
            ) => TaskState::Running,
            (TaskState::Cancelling, TaskTransition::ChildBound | TaskTransition::TurnStarted) => {
                TaskState::Cancelling
            }
            (
                TaskState::Starting
                | TaskState::Running
                | TaskState::ReconcilingStart
                | TaskState::Cancelling,
                TaskTransition::CancelRequested,
            ) => TaskState::Cancelling,
            (
                TaskState::Admitted | TaskState::PreparingWorkspace,
                TaskTransition::CancelRequested,
            )
            | (TaskState::Cancelling, TaskTransition::CancelledBeforeStart)
            | (
                TaskState::Starting
                | TaskState::ReconcilingStart
                | TaskState::Running
                | TaskState::Cancelling,
                TaskTransition::Cancelled,
            ) => TaskState::Cancelled,
            (
                TaskState::Starting
                | TaskState::ReconcilingStart
                | TaskState::Running
                | TaskState::Cancelling,
                TaskTransition::Succeeded,
            ) => TaskState::Succeeded,
            (
                TaskState::Admitted
                | TaskState::PreparingWorkspace
                | TaskState::Starting
                | TaskState::ReconcilingStart
                | TaskState::Running
                | TaskState::Cancelling,
                TaskTransition::Failed,
            ) => TaskState::Failed,
            (state, transition) => {
                return Err(format!(
                    "cannot apply {transition:?} while task is {state:?}"
                ));
            }
        };
        let changed = next != self.state;
        self.state = next;
        Ok(changed)
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum HostProvenance {
    AgentSelected,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskAttempt {
    pub attempt_id: AttemptId,
    pub task_id: TaskId,
    pub command_id: String,
    pub state: AttemptState,
}

impl TaskAttempt {
    /// Records the host-minted child selected for this attempt.
    ///
    /// # Errors
    /// Returns an error when the attempt already owns another child or phase.
    pub fn plan_child(&mut self, child_thread_id: AppThreadId) -> Result<bool, String> {
        match &self.state {
            AttemptState::Admitted => {
                self.state = AttemptState::ChildPlanned { child_thread_id };
                Ok(true)
            }
            AttemptState::ChildPlanned {
                child_thread_id: existing,
            } if existing == &child_thread_id => Ok(false),
            state => Err(format!("cannot plan a child while attempt is {state:?}")),
        }
    }

    /// Records that a provider-minted create request has begun.
    ///
    /// # Errors
    /// Returns an error when the attempt has already advanced past admission.
    pub fn begin_provider_create(&mut self) -> Result<bool, String> {
        match self.state {
            AttemptState::Admitted => {
                self.state = AttemptState::CreatingProviderMinted;
                Ok(true)
            }
            AttemptState::CreatingProviderMinted => Ok(false),
            ref state => Err(format!("cannot create a child while attempt is {state:?}")),
        }
    }

    /// Binds the provider child to this attempt.
    ///
    /// # Errors
    /// Returns an error when the child conflicts with the planned or bound child.
    pub fn bind_child(&mut self, child_thread_id: AppThreadId) -> Result<bool, String> {
        match &self.state {
            AttemptState::Admitted
            | AttemptState::CreatingProviderMinted
            | AttemptState::StartUncertain {
                child_thread_id: None,
            } => {
                self.state = AttemptState::ChildBound { child_thread_id };
                Ok(true)
            }
            AttemptState::ChildPlanned {
                child_thread_id: planned,
            }
            | AttemptState::StartUncertain {
                child_thread_id: Some(planned),
            } if planned == &child_thread_id => {
                self.state = AttemptState::ChildBound { child_thread_id };
                Ok(true)
            }
            state if state.child_thread_id() == Some(&child_thread_id) => Ok(false),
            state => Err(format!("cannot bind child while attempt is {state:?}")),
        }
    }

    /// Records ambiguity only while the provider turn identity is unknown.
    /// A received turn identity is immutable even when later recovery fails.
    pub fn mark_start_uncertain(&mut self) -> bool {
        let child_thread_id = match &self.state {
            AttemptState::Admitted | AttemptState::CreatingProviderMinted => None,
            AttemptState::ChildPlanned { child_thread_id }
            | AttemptState::ChildBound { child_thread_id } => Some(child_thread_id.clone()),
            AttemptState::StartUncertain { .. }
            | AttemptState::Started { .. }
            | AttemptState::Terminal { .. } => return false,
        };
        self.state = AttemptState::StartUncertain { child_thread_id };
        true
    }

    /// Records the authoritative provider turn receipt.
    ///
    /// # Errors
    /// Returns an error when the receipt conflicts with the bound child or turn.
    pub fn observe_started(
        &mut self,
        child_thread_id: AppThreadId,
        provider_turn_id: TurnId,
    ) -> Result<bool, String> {
        if let Some(known) = self.state.provider_turn_id() {
            return if known == &provider_turn_id {
                Ok(false)
            } else {
                Err("attempt already belongs to another provider turn".into())
            };
        }
        if self
            .state
            .child_thread_id()
            .is_some_and(|known| known != &child_thread_id)
        {
            return Err("attempt already belongs to another child thread".into());
        }
        self.state = AttemptState::Started {
            child_thread_id,
            provider_turn_id,
        };
        Ok(true)
    }

    /// Records a matching provider turn as terminal.
    ///
    /// # Errors
    /// Returns an error only when a future attempt-state invariant rejects the fact.
    pub fn observe_terminal(
        &mut self,
        child_thread_id: AppThreadId,
        provider_turn_id: TurnId,
    ) -> Result<bool, String> {
        if matches!(self.state, AttemptState::Terminal { .. }) {
            return Ok(false);
        }
        let Some(known_turn_id) = self.state.provider_turn_id() else {
            return Ok(false);
        };
        if known_turn_id != &provider_turn_id
            || self.state.child_thread_id() != Some(&child_thread_id)
        {
            return Ok(false);
        }
        self.state = AttemptState::Terminal {
            child_thread_id,
            provider_turn_id,
        };
        Ok(true)
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum DeliveryState {
    Pending,
    AwaitingResume,
    Acknowledged,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ParentDeliveryState {
    Pending,
    AwaitingResume,
    /// Completion ownership was atomically transferred to the turn outbox.
    Enqueued,
    Acknowledged,
}

/// The route determines which delivery states are valid. In particular, a
/// fallback-only delivery cannot claim ownership has moved to the turn outbox.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(tag = "route", rename_all = "camelCase")]
pub enum DeliveryProgress {
    AwaitingResume { state: DeliveryState },
    ParentTurn { state: ParentDeliveryState },
}

impl DeliveryProgress {
    pub(super) const fn terminal(self) -> Self {
        match self {
            Self::AwaitingResume {
                state: DeliveryState::Pending,
            } => Self::AwaitingResume {
                state: DeliveryState::AwaitingResume,
            },
            Self::ParentTurn {
                state: ParentDeliveryState::Pending,
            } => Self::ParentTurn {
                state: ParentDeliveryState::AwaitingResume,
            },
            progress => progress,
        }
    }

    pub(super) const fn acknowledge(self) -> Self {
        match self {
            Self::AwaitingResume {
                state: DeliveryState::AwaitingResume,
            } => Self::AwaitingResume {
                state: DeliveryState::Acknowledged,
            },
            Self::ParentTurn {
                state: ParentDeliveryState::AwaitingResume | ParentDeliveryState::Enqueued,
            } => Self::ParentTurn {
                state: ParentDeliveryState::Acknowledged,
            },
            progress => progress,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompletionDelivery {
    pub delivery_id: DeliveryId,
    pub task_id: TaskId,
    #[serde(flatten)]
    pub progress: DeliveryProgress,
    pub dedupe_key: String,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum TaskEventKind {
    Admitted,
    WorkspaceReady,
    ChildBound,
    TurnQueued,
    TurnStarted,
    StartUncertain,
    CancelRequested,
    AttemptTerminal,
    TaskTerminal,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskEvent {
    pub task_id: TaskId,
    pub sequence: u64,
    pub kind: TaskEventKind,
    pub occurred_at_ms: u64,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskSnapshot {
    pub task_id: String,
    pub attempt_id: String,
    pub provider: String,
    pub model: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agent_thread_id: Option<String>,
    pub status: PublicTaskStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub recovery: Option<RecoveryAction>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub final_message: Option<String>,
    pub cost: Option<ProviderCost>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum PublicTaskStatus {
    Running,
    StartUncertain,
    Cancelling,
    Succeeded,
    Failed,
    Cancelled,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum RecoveryAction {
    WaitTask,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn durable_ids_are_non_enumerable_uuid_v4_values() {
        let first = TaskId::new();
        let second = TaskId::new();
        assert_eq!(first.as_str().len(), 36);
        assert_eq!(first.as_str().as_bytes()[14], b'4');
        assert_ne!(first, second);
        assert_eq!(TaskId::parse(first.as_str()), Some(first));
        assert!(TaskId::parse("task-1").is_none());
    }

    // Persisted v1 fallback deliveries must remain readable after adding the
    // injected-turn route. Route/state are the declared compatibility format.
    #[test]
    fn persisted_fallback_deliveries_round_trip_and_cannot_claim_outbox_ownership()
    -> Result<(), Box<dyn std::error::Error>> {
        for state in ["pending", "awaitingResume", "acknowledged"] {
            let fixture = serde_json::json!({
                "deliveryId": DeliveryId::new(), "taskId": TaskId::new(),
                "route": "awaitingResume", "state": state, "dedupeKey": "completion-key"
            });
            let delivery: CompletionDelivery = serde_json::from_value(fixture.clone())?;
            assert_eq!(serde_json::to_value(delivery)?, fixture);
        }
        let invalid = serde_json::json!({
            "deliveryId": DeliveryId::new(), "taskId": TaskId::new(),
            "route": "awaitingResume", "state": "enqueued", "dedupeKey": "completion-key"
        });
        assert!(serde_json::from_value::<CompletionDelivery>(invalid).is_err());
        Ok(())
    }

    #[test]
    fn task_and_delivery_are_independent_state_machines() {
        assert!(TaskState::Succeeded.is_terminal());
        assert!(!TaskState::Running.is_terminal());
        assert_ne!(DeliveryState::AwaitingResume, DeliveryState::Acknowledged);
    }
}
