//! One pull request's overview and merge readiness.

use forge_protocol::{
    ActivityPage, DiffStats, MergeState, MergeStatus, PluginError, PullRequestOverview,
    PullRequestState,
};
use serde_json::Value;

use crate::{
    activity::activity,
    api::Api,
    repo::{PullTarget, head_sha},
};

/// `forge.pullRequest.read`.
///
/// # Errors
///
/// Returns the mapped GitHub failure.
pub async fn read(api: &Api, target: &PullTarget) -> Result<PullRequestOverview, PluginError> {
    let pull = target.fetch(api).await?;
    let activity = activity(api, target, None).await?;
    overview(&pull, target, activity)
}

fn overview(
    pull: &Value,
    target: &PullTarget,
    activity: ActivityPage,
) -> Result<PullRequestOverview, PluginError> {
    let text = |pointer: &str| {
        pull.pointer(pointer)
            .and_then(Value::as_str)
            .map(str::to_owned)
            .unwrap_or_default()
    };
    let count = |field: &str| {
        pull.get(field)
            .and_then(Value::as_u64)
            .and_then(|value| u32::try_from(value).ok())
            .unwrap_or(0)
    };
    let state = rest_state(pull);
    Ok(PullRequestOverview {
        repository: target.repo.full(),
        number: target.number.to_string(),
        title: text("/title"),
        author: pull
            .pointer("/user/login")
            .and_then(Value::as_str)
            .unwrap_or("ghost")
            .to_owned(),
        state,
        web_url: text("/html_url"),
        head_revision: head_sha(pull)?,
        activity_revision: pull
            .get("updated_at")
            .and_then(Value::as_str)
            .map(str::to_owned),
        head_branch: text("/head/ref"),
        base_branch: text("/base/ref"),
        description: text("/body"),
        stats: DiffStats {
            files: count("changed_files"),
            additions: count("additions"),
            deletions: count("deletions"),
        },
        merge: merge_status(pull, state),
        checks: None,
        check_items: Vec::new(),
        activity,
    })
}

/// The state of a REST pull request.
#[must_use]
pub fn rest_state(pull: &Value) -> PullRequestState {
    if pull.get("merged").and_then(Value::as_bool) == Some(true)
        || pull
            .get("merged_at")
            .is_some_and(|merged| !merged.is_null())
    {
        PullRequestState::Merged
    } else if pull.get("state").and_then(Value::as_str) == Some("closed") {
        PullRequestState::Closed
    } else if pull.get("draft").and_then(Value::as_bool) == Some(true) {
        PullRequestState::Draft
    } else {
        PullRequestState::Open
    }
}

/// The merge readiness GitHub computed (`mergeable_state`).
#[must_use]
pub fn merge_status(pull: &Value, state: PullRequestState) -> MergeStatus {
    let blocked = |reason: &str| MergeStatus {
        state: MergeState::Blocked,
        reason: Some(reason.to_owned()),
    };
    match state {
        PullRequestState::Merged => return blocked("The pull request is merged."),
        PullRequestState::Closed => return blocked("The pull request is closed."),
        PullRequestState::Draft => return blocked("Draft pull requests cannot be merged."),
        PullRequestState::Open => {}
    }
    match pull.get("mergeable_state").and_then(Value::as_str) {
        Some("clean" | "has_hooks") => MergeStatus {
            state: MergeState::Ready,
            reason: None,
        },
        Some("unstable") => MergeStatus {
            state: MergeState::Ready,
            reason: Some("Some checks are not passing.".into()),
        },
        Some("dirty") => MergeStatus {
            state: MergeState::Conflicts,
            reason: Some("This branch has conflicts with the base branch.".into()),
        },
        Some("behind") => blocked("The branch is out of date with the base branch."),
        Some("blocked") => blocked("Merging is blocked by branch protection."),
        Some("draft") => blocked("Draft pull requests cannot be merged."),
        _ => MergeStatus {
            state: MergeState::Unknown,
            reason: None,
        },
    }
}
