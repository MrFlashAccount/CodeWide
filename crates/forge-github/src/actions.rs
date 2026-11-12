//! `forge.pullRequest.actions` and `forge.pullRequest.action.run`.
//!
//! The catalog is computed for one head revision. Verdicts are listed so
//! the Submit sheet can offer them, but they run only through
//! `forge.pullRequest.review.submit`, never through `action.run`.

use forge_protocol::{
    ActionDescriptor, ActionRunResult, MergeState, PluginError, PullRequestState, RawActionCatalog,
    code,
};
use reqwest::{Method, StatusCode};
use serde_json::{Value, json};

use crate::{
    api::{Api, status_error},
    pull::{merge_status, rest_state},
    repo::{PullTarget, head_sha, node_id, stale_or},
};

pub const VERDICT_APPROVE: &str = "approve";
pub const VERDICT_REQUEST_CHANGES: &str = "requestChanges";
pub const VERDICT_COMMENT: &str = "comment";
const ACTION_MERGE: &str = "merge";
const ACTION_AUTO_MERGE: &str = "autoMerge";
const ACTION_UPDATE_BRANCH: &str = "updateBranch";
const ACTION_CLOSE: &str = "close";
const ACTION_READY: &str = "markReady";

/// The merge methods a repository allows, in GitHub's order.
fn merge_methods(repository: &Value) -> Vec<(&'static str, &'static str)> {
    [
        ("allow_merge_commit", "merge", "Create a merge commit"),
        ("allow_squash_merge", "squash", "Squash and merge"),
        ("allow_rebase_merge", "rebase", "Rebase and merge"),
    ]
    .into_iter()
    .filter(|(field, _, _)| repository.get(*field).and_then(Value::as_bool) != Some(false))
    .map(|(_, value, label)| (value, label))
    .collect()
}

/// `forge.pullRequest.actions`.
///
/// # Errors
///
/// Returns the mapped GitHub failure.
pub async fn catalog(
    api: &Api,
    target: &PullTarget,
    viewer: &str,
) -> Result<RawActionCatalog, PluginError> {
    let pull = target.fetch(api).await?;
    let repository = api.get(&target.repo.path(""), &[]).await?;
    build_catalog(&pull, &repository, viewer)
}

/// One descriptor under construction; [`Action::into_value`] emits the
/// wire shape of `forge_protocol::ActionDescriptor`.
struct Action {
    id: &'static str,
    kind: &'static str,
    group: &'static str,
    label: &'static str,
    blocked: Option<String>,
    toggle: Option<bool>,
    input: Option<Value>,
    confirm: &'static str,
    placement: &'static str,
    order: i64,
    is_default: bool,
    in_header: bool,
}

impl Action {
    fn new(id: &'static str, kind: &'static str, group: &'static str, label: &'static str) -> Self {
        Self {
            id,
            kind,
            group,
            label,
            blocked: None,
            toggle: None,
            input: None,
            confirm: "none",
            placement: "secondary",
            order: 0,
            is_default: false,
            in_header: true,
        }
    }

    fn into_value(self) -> Value {
        let availability = match self.blocked {
            None => json!({"state": "enabled"}),
            Some(reason) => json!({"state": "disabled", "reason": reason}),
        };
        let descriptor = ActionDescriptor {
            action_id: self.id.to_owned(),
            kind: self.kind.to_owned(),
            group: self.group.to_owned(),
            label: self.label.to_owned(),
            availability,
            toggle: self.toggle.map(|on| json!({ "on": on })),
            input: self.input,
            confirm: self.confirm.to_owned(),
            placement: self.placement.to_owned(),
            order: self.order,
            is_default: self.is_default,
            anchor: self.in_header.then(|| json!({"kind": "header"})),
        };
        serde_json::to_value(descriptor).unwrap_or(Value::Null)
    }
}

fn build_catalog(
    pull: &Value,
    repository: &Value,
    viewer: &str,
) -> Result<RawActionCatalog, PluginError> {
    let head_revision = head_sha(pull)?;
    let state = rest_state(pull);
    let mut actions = Vec::new();
    if matches!(state, PullRequestState::Open | PullRequestState::Draft) {
        let own = pull
            .pointer("/user/login")
            .and_then(Value::as_str)
            .is_some_and(|author| author.eq_ignore_ascii_case(viewer));
        actions.extend(verdicts(own));
        actions.extend(merge_actions(pull, repository, state));
        actions.extend(state_actions(state));
    }
    Ok(RawActionCatalog {
        head_revision,
        actions: actions.into_iter().map(Action::into_value).collect(),
    })
}

fn verdicts(own: bool) -> Vec<Action> {
    let own_reason =
        own.then(|| "You cannot approve or request changes on your own pull request.".to_owned());
    [
        (10, VERDICT_APPROVE, "Approve", own_reason.clone()),
        (11, VERDICT_REQUEST_CHANGES, "Request changes", own_reason),
        (12, VERDICT_COMMENT, "Comment", None),
    ]
    .into_iter()
    .map(|(order, id, label, blocked)| Action {
        blocked,
        order,
        is_default: id == VERDICT_COMMENT,
        in_header: false,
        ..Action::new(id, "verdict", "verdict", label)
    })
    .collect()
}

fn merge_actions(pull: &Value, repository: &Value, state: PullRequestState) -> Vec<Action> {
    let methods = merge_methods(repository);
    let method_input = json!({
        "type": "enum",
        "label": "Merge method",
        "options": methods.iter().map(|(value, label)| json!({"value": value, "label": label})).collect::<Vec<_>>(),
    });
    let merge = merge_status(pull, state);
    let blocked = if methods.is_empty() {
        Some("The repository allows no merge method.".to_owned())
    } else if merge.state == MergeState::Ready {
        None
    } else {
        Some(
            merge
                .reason
                .unwrap_or_else(|| "GitHub has not computed mergeability yet.".into()),
        )
    };
    let mut actions = vec![Action {
        blocked,
        input: Some(method_input.clone()),
        confirm: "destructive",
        placement: "primary",
        order: 1,
        is_default: true,
        ..Action::new(ACTION_MERGE, "merge", "merge", "Merge")
    }];
    if repository.get("allow_auto_merge").and_then(Value::as_bool) == Some(true)
        && state == PullRequestState::Open
    {
        actions.push(Action {
            toggle: Some(pull.get("auto_merge").is_some_and(|value| !value.is_null())),
            input: Some(method_input),
            confirm: "confirm",
            order: 2,
            ..Action::new(ACTION_AUTO_MERGE, "autoMerge", "merge", "Auto-merge")
        });
    }
    if pull.get("mergeable_state").and_then(Value::as_str) == Some("behind") {
        actions.push(Action {
            confirm: "confirm",
            order: 3,
            is_default: true,
            ..Action::new(
                ACTION_UPDATE_BRANCH,
                "updateBranch",
                "branch",
                "Update branch",
            )
        });
    }
    actions
}

fn state_actions(state: PullRequestState) -> Vec<Action> {
    let mut actions = Vec::new();
    if state == PullRequestState::Draft {
        actions.push(Action {
            confirm: "confirm",
            order: 4,
            ..Action::new(ACTION_READY, "extension", "state", "Ready for review")
        });
    }
    actions.push(Action {
        confirm: "destructive",
        placement: "overflow",
        order: 20,
        in_header: false,
        ..Action::new(ACTION_CLOSE, "close", "state", "Close")
    });
    actions
}

/// `forge.pullRequest.action.run` at an expected head.
///
/// # Errors
///
/// Returns `staleHead` when the head moved, `forgeRejected` when GitHub
/// refuses, and invalid params for verdicts or unknown actions.
pub async fn run(
    api: &Api,
    target: &PullTarget,
    action_id: &str,
    head_revision: &str,
    input: &Value,
) -> Result<ActionRunResult, PluginError> {
    if matches!(
        action_id,
        VERDICT_APPROVE | VERDICT_REQUEST_CHANGES | VERDICT_COMMENT
    ) {
        return Err(PluginError::invalid_params(
            "verdicts are submitted with a review",
        ));
    }
    let pull = target.fetch_at_head(api, head_revision).await?;
    let message = match action_id {
        ACTION_MERGE => {
            let method = merge_method(input)?;
            let (status, body, headers) = api
                .send_raw(
                    Method::PUT,
                    &target.path("/merge"),
                    json!({ "merge_method": method, "sha": head_revision }),
                )
                .await?;
            match status {
                status if status.is_success() => "Merged",
                StatusCode::CONFLICT => {
                    return Err(stale_or(
                        api,
                        target,
                        head_revision,
                        status_error(status, &headers, &body),
                    )
                    .await);
                }
                _ => return Err(status_error(status, &headers, &body)),
            }
        }
        ACTION_CLOSE => {
            api.send(Method::PATCH, &target.path(""), json!({"state": "closed"}))
                .await?;
            "Closed"
        }
        ACTION_UPDATE_BRANCH => {
            let (status, body, headers) = api
                .send_raw(
                    Method::PUT,
                    &target.path("/update-branch"),
                    json!({ "expected_head_sha": head_revision }),
                )
                .await?;
            if !status.is_success() {
                return Err(stale_or(
                    api,
                    target,
                    head_revision,
                    status_error(status, &headers, &body),
                )
                .await);
            }
            "Branch update started"
        }
        ACTION_AUTO_MERGE => {
            let id = node_id(&pull)?;
            if pull.get("auto_merge").is_some_and(|value| !value.is_null()) {
                api.graphql(
                    "mutation($id: ID!) { disablePullRequestAutoMerge(input: {pullRequestId: $id}) { clientMutationId } }",
                    json!({ "id": id }),
                )
                .await?;
                "Auto-merge disabled"
            } else {
                let method = merge_method(input)?.to_ascii_uppercase();
                api.graphql(
                    "mutation($id: ID!, $method: PullRequestMergeMethod!, $head: GitObjectID!) { enablePullRequestAutoMerge(input: {pullRequestId: $id, mergeMethod: $method, expectedHeadOid: $head}) { clientMutationId } }",
                    json!({ "id": id, "method": method, "head": head_revision }),
                )
                .await?;
                "Auto-merge enabled"
            }
        }
        ACTION_READY => {
            api.graphql(
                "mutation($id: ID!) { markPullRequestReadyForReview(input: {pullRequestId: $id}) { clientMutationId } }",
                json!({ "id": node_id(&pull)? }),
            )
            .await?;
            "Marked ready for review"
        }
        _ => {
            return Err(PluginError::new(
                code::CAPABILITY_UNAVAILABLE,
                "unknown action",
            ));
        }
    };
    Ok(ActionRunResult {
        message: Some(message.to_owned()),
        open_url: None,
    })
}

fn merge_method(input: &Value) -> Result<&'static str, PluginError> {
    match input.as_str() {
        Some("merge") | None => Ok("merge"),
        Some("squash") => Ok("squash"),
        Some("rebase") => Ok("rebase"),
        Some(_) => Err(PluginError::invalid_params("unknown merge method")),
    }
}

#[cfg(test)]
#[allow(clippy::expect_used)]
mod tests {
    use super::*;

    fn pull(author: &str, mergeable_state: &str, draft: bool) -> Value {
        json!({
            "head": {"sha": "abc123"}, "state": "open", "draft": draft, "merged": false,
            "user": {"login": author}, "mergeable_state": mergeable_state, "auto_merge": null,
        })
    }

    fn ids(catalog: &RawActionCatalog) -> Vec<&str> {
        catalog
            .actions
            .iter()
            .filter_map(|action| action.get("actionId").and_then(Value::as_str))
            .collect()
    }

    #[test]
    fn own_pull_requests_cannot_be_approved_and_behind_offers_update() {
        let repository = json!({"allow_merge_commit": true, "allow_squash_merge": false, "allow_auto_merge": true});
        let catalog =
            build_catalog(&pull("octo", "behind", false), &repository, "OCTO").expect("catalog");
        assert_eq!(catalog.head_revision, "abc123");
        assert_eq!(
            ids(&catalog),
            vec![
                "approve",
                "requestChanges",
                "comment",
                "merge",
                "autoMerge",
                "updateBranch",
                "close"
            ]
        );
        assert_eq!(catalog.actions[0]["availability"]["state"], "disabled");
        assert_eq!(catalog.actions[3]["availability"]["state"], "disabled");
        assert_eq!(catalog.actions[3]["confirm"], "destructive");
        let options = catalog.actions[3]["input"]["options"]
            .as_array()
            .expect("options");
        assert_eq!(options.len(), 2, "squash is not allowed");
    }

    #[test]
    fn drafts_offer_ready_for_review_and_closed_pulls_offer_nothing() {
        let repository = json!({});
        let catalog = build_catalog(&pull("a", "draft", true), &repository, "b").expect("catalog");
        assert!(ids(&catalog).contains(&"markReady"));
        let mut closed = pull("a", "clean", false);
        closed["state"] = json!("closed");
        assert!(
            build_catalog(&closed, &repository, "b")
                .expect("catalog")
                .actions
                .is_empty()
        );
    }
}
