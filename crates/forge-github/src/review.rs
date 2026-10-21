//! Review writes: submitting a review (comments and verdict in one atomic
//! GitHub review) and viewed marks.

use forge_protocol::{
    CommentOutcome, CommentOutcomeState, DiffSide, PluginError, ReviewComment, ReviewSubmitResult,
};
use reqwest::{Method, StatusCode};
use serde_json::{Value, json};

use crate::{
    actions::{VERDICT_APPROVE, VERDICT_COMMENT, VERDICT_REQUEST_CHANGES},
    api::{Api, status_error},
    repo::{PullTarget, node_id, stale_or},
};

/// `forge.pullRequest.review.submit`. GitHub creates the review atomically,
/// so every comment shares the outcome: all published, or a typed error for
/// the whole review.
///
/// # Errors
///
/// Returns `staleHead` when the head moved, `forgeRejected` when GitHub
/// refuses the review, and invalid params for an unknown verdict.
pub async fn submit(
    api: &Api,
    target: &PullTarget,
    head_revision: &str,
    verdict_action_id: &str,
    body: Option<&str>,
    comments: &[ReviewComment],
) -> Result<ReviewSubmitResult, PluginError> {
    let event = match verdict_action_id {
        VERDICT_APPROVE => "APPROVE",
        VERDICT_REQUEST_CHANGES => "REQUEST_CHANGES",
        VERDICT_COMMENT => "COMMENT",
        _ => return Err(PluginError::invalid_params("unknown verdict")),
    };
    target.fetch_at_head(api, head_revision).await?;
    let mut request = json!({
        "commit_id": head_revision,
        "event": event,
        "comments": comments.iter().map(review_comment).collect::<Vec<_>>(),
    });
    if let Some(body) = body.filter(|body| !body.trim().is_empty()) {
        request["body"] = json!(body);
    }
    let (status, response, headers) = api
        .send_raw(Method::POST, &target.path("/reviews"), request)
        .await?;
    if !status.is_success() {
        let error = status_error(status, &headers, &response);
        if status == StatusCode::UNPROCESSABLE_ENTITY {
            return Err(stale_or(api, target, head_revision, error).await);
        }
        return Err(error);
    }
    Ok(ReviewSubmitResult {
        review_url: response
            .get("html_url")
            .and_then(Value::as_str)
            .map(str::to_owned),
        comments: comments
            .iter()
            .map(|comment| CommentOutcome {
                draft_id: comment.draft_id.clone(),
                state: CommentOutcomeState::Published,
                error: None,
            })
            .collect(),
    })
}

fn review_comment(comment: &ReviewComment) -> Value {
    let side = match comment.side {
        DiffSide::New => "RIGHT",
        DiffSide::Old => "LEFT",
    };
    let mut value = json!({
        "path": comment.path,
        "body": comment.body,
        "line": comment.end_line,
        "side": side,
    });
    if comment.start_line < comment.end_line {
        value["start_line"] = json!(comment.start_line);
        value["start_side"] = json!(side);
    }
    value
}

/// `forge.pullRequest.viewed.set` at an expected head.
///
/// # Errors
///
/// Returns `staleHead` when the head moved or the mapped GitHub failure.
pub async fn set_viewed(
    api: &Api,
    target: &PullTarget,
    head_revision: &str,
    path: &str,
    viewed: bool,
) -> Result<(), PluginError> {
    if path.is_empty() || path.starts_with('/') {
        return Err(PluginError::invalid_params("invalid path"));
    }
    let pull = target.fetch_at_head(api, head_revision).await?;
    let mutation = if viewed {
        "mutation($id: ID!, $path: String!) { markFileAsViewed(input: {pullRequestId: $id, path: $path}) { clientMutationId } }"
    } else {
        "mutation($id: ID!, $path: String!) { unmarkFileAsViewed(input: {pullRequestId: $id, path: $path}) { clientMutationId } }"
    };
    api.graphql(mutation, json!({ "id": node_id(&pull)?, "path": path }))
        .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn multi_line_comments_carry_a_start_line_on_the_same_side() {
        let comment = ReviewComment {
            draft_id: "d".into(),
            path: "src/a.rs".into(),
            side: DiffSide::Old,
            start_line: 3,
            end_line: 5,
            body: "note".into(),
        };
        assert_eq!(
            review_comment(&comment),
            json!({"path": "src/a.rs", "body": "note", "line": 5, "side": "LEFT",
                   "start_line": 3, "start_side": "LEFT"})
        );
    }
}
