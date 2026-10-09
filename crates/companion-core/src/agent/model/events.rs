//! Neutral provider events (mirror of `packages/agent-protocol/src/v1/events.ts`).

use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::{
    ids::{AppThreadId, ItemId, NativeRequestId, TurnId},
    thread::{
        AgentItem, AgentThread, AgentTurn, FileChange, PlanStep, RequestResolution, RuntimeRequest,
        TokenUsage,
    },
};

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum ItemDelta {
    Text { text: String },
    Reasoning { text: String, summary_index: i64 },
    Output { text: String },
    FileChanges { changes: Vec<FileChange> },
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all_fields = "camelCase")]
pub enum AgentEvent {
    #[serde(rename = "thread.updated")]
    ThreadUpdated { thread: AgentThread },
    #[serde(rename = "turn.started")]
    TurnStarted {
        app_thread_id: AppThreadId,
        turn: AgentTurn,
    },
    #[serde(rename = "turn.completed")]
    TurnCompleted {
        app_thread_id: AppThreadId,
        turn: AgentTurn,
    },
    #[serde(rename = "item.started")]
    ItemStarted {
        app_thread_id: AppThreadId,
        turn_id: TurnId,
        item: AgentItem,
    },
    #[serde(rename = "item.delta")]
    ItemDelta {
        app_thread_id: AppThreadId,
        turn_id: TurnId,
        item_id: ItemId,
        delta: ItemDelta,
    },
    #[serde(rename = "item.completed")]
    ItemCompleted {
        app_thread_id: AppThreadId,
        turn_id: TurnId,
        item: AgentItem,
    },
    #[serde(rename = "request.opened")]
    RequestOpened {
        app_thread_id: AppThreadId,
        turn_id: TurnId,
        request_id: NativeRequestId,
        request: RuntimeRequest,
    },
    #[serde(rename = "request.resolved")]
    RequestResolved {
        app_thread_id: AppThreadId,
        request_id: NativeRequestId,
        reason: RequestResolution,
    },
    #[serde(rename = "usage.updated")]
    UsageUpdated {
        app_thread_id: AppThreadId,
        turn_id: TurnId,
        last: TokenUsage,
        total: TokenUsage,
        context_window: Option<i64>,
    },
    #[serde(rename = "plan.updated")]
    PlanUpdated {
        app_thread_id: AppThreadId,
        turn_id: TurnId,
        explanation: Option<String>,
        plan: Vec<PlanStep>,
    },
    #[serde(rename = "diff.updated")]
    DiffUpdated {
        app_thread_id: AppThreadId,
        turn_id: TurnId,
        diff: String,
    },
    #[serde(rename = "capability.event")]
    CapabilityEvent {
        app_thread_id: Option<AppThreadId>,
        capability: String,
        payload: Value,
    },
}

impl AgentEvent {
    /// The thread this event belongs to, if it is thread-scoped.
    #[must_use]
    pub fn app_thread_id(&self) -> Option<&AppThreadId> {
        match self {
            Self::ThreadUpdated { thread } => Some(&thread.app_thread_id),
            Self::TurnStarted { app_thread_id, .. }
            | Self::TurnCompleted { app_thread_id, .. }
            | Self::ItemStarted { app_thread_id, .. }
            | Self::ItemDelta { app_thread_id, .. }
            | Self::ItemCompleted { app_thread_id, .. }
            | Self::RequestOpened { app_thread_id, .. }
            | Self::RequestResolved { app_thread_id, .. }
            | Self::UsageUpdated { app_thread_id, .. }
            | Self::PlanUpdated { app_thread_id, .. }
            | Self::DiffUpdated { app_thread_id, .. } => Some(app_thread_id),
            Self::CapabilityEvent { app_thread_id, .. } => app_thread_id.as_ref(),
        }
    }
}
