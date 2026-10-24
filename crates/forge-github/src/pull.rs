//! One pull request's overview, merge readiness and activity.

use forge_protocol::{
    ActivityItem, ActivityKind, ActivityPage, DiffStats, MergeState, MergeStatus, PluginError,
    PullRequestOverview, PullRequestState,
};
use serde_json::Value;

use crate::{
    api::Api,
    repo::{PullTarget, head_sha},
};

const ACTIVITY_PAGE_SIZE: u32 = 50;

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

/// `forge.pullRequest.activity`: issue comments, reviews and review
/// comments of one page, oldest first.
///
/// # Errors
///
/// Returns the mapped GitHub failure.
pub async fn activity(
    api: &Api,
    target: &PullTarget,
    cursor: Option<String>,
) -> Result<ActivityPage, PluginError> {
    let page = cursor
        .as_deref()
        .map_or(Ok(1), str::parse::<u32>)
        .map_err(|_| PluginError::invalid_params("invalid activity cursor"))?
        .max(1);
    let query = [
        ("per_page", ACTIVITY_PAGE_SIZE.to_string()),
        ("page", page.to_string()),
    ];
    let comments = api
        .get(
            &target
                .repo
                .path(&format!("/issues/{}/comments", target.number)),
            &query,
        )
        .await?;
    let reviews = api.get(&target.path("/reviews"), &query).await?;
    let review_comments = api.get(&target.path("/comments"), &query).await?;
    let mut items = Vec::new();
    let mut full_page = false;
    for (list, map) in [
        (
            &comments,
            issue_comment as fn(&Value) -> Option<ActivityItem>,
        ),
        (&reviews, review),
        (&review_comments, review_comment),
    ] {
        let entries = list.as_array().map(Vec::as_slice).unwrap_or_default();
        full_page |= entries.len() >= usize::try_from(ACTIVITY_PAGE_SIZE).unwrap_or(usize::MAX);
        items.extend(entries.iter().filter_map(map));
    }
    items.sort_by(|left, right| left.created_at.cmp(&right.created_at));
    Ok(ActivityPage {
        items,
        next_cursor: full_page.then(|| (page + 1).to_string()),
    })
}

fn user(value: &Value) -> String {
    value
        .pointer("/user/login")
        .and_then(Value::as_str)
        .unwrap_or("ghost")
        .to_owned()
}

fn issue_comment(value: &Value) -> Option<ActivityItem> {
    Some(ActivityItem {
        id: format!("c{}", value.get("id")?.as_u64()?),
        kind: ActivityKind::Comment,
        author: user(value),
        created_at: value.get("created_at")?.as_str()?.to_owned(),
        body: value
            .get("body")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_owned(),
        path: None,
        line: None,
        review_thread_id: None,
        verdict_label: None,
    })
}

fn review(value: &Value) -> Option<ActivityItem> {
    let verdict = match value.get("state")?.as_str()? {
        "APPROVED" => "Approved",
        "CHANGES_REQUESTED" => "Changes requested",
        "COMMENTED" => "Commented",
        "DISMISSED" => "Dismissed",
        _ => return None,
    };
    Some(ActivityItem {
        id: format!("r{}", value.get("id")?.as_u64()?),
        kind: ActivityKind::Review,
        author: user(value),
        created_at: value.get("submitted_at")?.as_str()?.to_owned(),
        body: value
            .get("body")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_owned(),
        path: None,
        line: None,
        review_thread_id: None,
        verdict_label: Some(verdict.to_owned()),
    })
}

fn review_comment(value: &Value) -> Option<ActivityItem> {
    let id = value.get("id")?.as_u64()?;
    let root = value
        .get("in_reply_to_id")
        .and_then(Value::as_u64)
        .unwrap_or(id);
    let line = value
        .get("line")
        .and_then(Value::as_u64)
        .or_else(|| value.get("original_line").and_then(Value::as_u64))
        .and_then(|line| u32::try_from(line).ok());
    Some(ActivityItem {
        id: format!("rc{id}"),
        kind: ActivityKind::Comment,
        author: user(value),
        created_at: value.get("created_at")?.as_str()?.to_owned(),
        body: value
            .get("body")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_owned(),
        path: value.get("path").and_then(Value::as_str).map(str::to_owned),
        line,
        review_thread_id: Some(format!("t{root}")),
        verdict_label: None,
    })
}
