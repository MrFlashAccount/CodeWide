//! Strict App Server thread-goal normalization.

use serde_json::Value;

use super::{nonnegative_safe_integer, required_id};
use crate::sync_v2::{
    domain::{ThreadGoal, ThreadGoalStatus},
    protocol::V2Error,
};

/// Converts a complete App Server goal record without inventing missing usage.
pub fn thread_goal(value: &Value) -> Result<ThreadGoal, V2Error> {
    let objective = value
        .get("objective")
        .and_then(Value::as_str)
        .filter(|objective| !objective.is_empty())
        .ok_or_else(|| V2Error::source_unavailable("thread goal omitted objective"))?
        .to_owned();
    let status = match value.get("status").and_then(Value::as_str) {
        Some("active") => ThreadGoalStatus::Active,
        Some("paused") => ThreadGoalStatus::Paused,
        Some("blocked") => ThreadGoalStatus::Blocked,
        Some("usageLimited") => ThreadGoalStatus::UsageLimited,
        Some("budgetLimited") => ThreadGoalStatus::BudgetLimited,
        Some("complete") => ThreadGoalStatus::Complete,
        _ => {
            return Err(V2Error::source_unavailable(
                "thread goal has invalid status",
            ));
        }
    };
    Ok(ThreadGoal {
        thread_id: required_id(value, "threadId")?,
        objective,
        status,
        token_budget: optional_nonnegative_integer(value.get("tokenBudget"), "tokenBudget")?,
        tokens_used: required_nonnegative_integer(value, "tokensUsed")?,
        time_used_seconds: required_nonnegative_integer(value, "timeUsedSeconds")?,
        created_at_ms: required_nonnegative_integer(value, "createdAt")?,
        updated_at_ms: required_nonnegative_integer(value, "updatedAt")?,
    })
}

fn required_nonnegative_integer(value: &Value, field: &str) -> Result<i64, V2Error> {
    nonnegative_safe_integer(value.get(field))
        .ok_or_else(|| V2Error::source_unavailable(format!("thread goal has invalid {field}")))
}

fn optional_nonnegative_integer(
    value: Option<&Value>,
    field: &str,
) -> Result<Option<i64>, V2Error> {
    match value {
        None | Some(Value::Null) => Ok(None),
        Some(value) => nonnegative_safe_integer(Some(value))
            .map(Some)
            .ok_or_else(|| V2Error::source_unavailable(format!("thread goal has invalid {field}"))),
    }
}
