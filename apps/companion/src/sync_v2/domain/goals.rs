//! Authoritative thread-goal projection and update payloads.

use serde::{Deserialize, Serialize};

use super::required_option;
use crate::sync_v2::scalar::Id;

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ThreadGoalStatus {
    Active,
    Paused,
    Blocked,
    UsageLimited,
    BudgetLimited,
    Complete,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ThreadGoal {
    pub thread_id: Id,
    pub objective: String,
    pub status: ThreadGoalStatus,
    #[serde(deserialize_with = "required_option")]
    pub token_budget: Option<i64>,
    pub tokens_used: i64,
    pub time_used_seconds: i64,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ThreadGoalUpdate {
    pub objective: String,
    pub status: ThreadGoalStatus,
    #[serde(deserialize_with = "required_option")]
    pub token_budget: Option<i64>,
}
