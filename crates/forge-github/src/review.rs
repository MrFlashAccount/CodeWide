//! Review writes: submitting a review (comments and verdict in one atomic
//! GitHub review) and viewed marks.

use forge_protocol::{
    CommentOutcome, CommentOutcomeState, DiffSide, PluginError, ReviewComment,
    ReviewCommentSubject, ReviewSubmitResult,
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
    let has_files = comments
        .iter()
        .any(|comment| matches!(comment.subject, ReviewCommentSubject::File { .. }));
    let mut request = json!({
        "commit_id": head_revision,
        "comments": comments.iter().filter_map(review_comment).collect::<Vec<_>>(),
    });
    let mut verdict = json!({ "event": event });
    if let Some(text) = body.filter(|text| !text.trim().is_empty()) {
        verdict["body"] = json!(text);
    }
    if !has_files {
        request["event"] = json!(event);
        if let Some(text) = verdict.get("body") {
            request["body"] = text.clone();
        }
    }
    let response = post_at_head(api, target, head_revision, "/reviews", request).await?;
    let response = if has_files {
        finish_file_review(api, target, head_revision, &response, comments, verdict).await?
    } else {
        response
    };
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

/// File threads can only be staged on a pending GitHub review. The initial POST creates a
/// fresh pending review (GitHub refuses if one already exists); its returned ID is the only
/// review this operation edits. Nothing is published until the final verdict.
async fn finish_file_review(
    api: &Api,
    target: &PullTarget,
    head: &str,
    pending: &Value,
    comments: &[ReviewComment],
    verdict: Value,
) -> Result<Value, PluginError> {
    let id = pending["id"]
        .as_u64()
        .ok_or_else(|| PluginError::internal("Missing pending review ID"))?;
    let path = format!("/reviews/{id}");
    let staged = async {
        let node = node_id(pending)?;
        for file in comments {
            if matches!(file.subject, ReviewCommentSubject::File { .. }) {
                stage_file_thread(api, &node, file).await?;
            }
        }
        target.fetch_at_head(api, head).await
    }
    .await;
    if let Err(error) = staged {
        // The review is still private and is known to be ours.
        api.send(Method::DELETE, &target.path(&path), Value::Null)
            .await?;
        return Err(error);
    }
    let (status, response, headers) = api
        .send_raw(
            Method::POST,
            &target.path(&format!("{path}/events")),
            verdict,
        )
        .await?;
    if !status.is_success() {
        if status.is_client_error() {
            api.send(Method::DELETE, &target.path(&path), Value::Null)
                .await?;
        }
        return Err(stale_or(api, target, head, status_error(status, &headers, &response)).await);
    }
    Ok(response)
}

/// GitHub must acknowledge the new thread before the pending review can be published.
async fn stage_file_thread(api: &Api, node: &str, file: &ReviewComment) -> Result<(), PluginError> {
    let variables = json!({"input":{
        "pullRequestReviewId":node,
        "path":file.path,
        "body":file.body,
        "subjectType":"FILE",
    }});
    let data = api.graphql(
        "mutation($input:AddPullRequestReviewThreadInput!){addPullRequestReviewThread(input:$input){thread{id}}}",
        variables,
    ).await?;
    if data
        .pointer("/addPullRequestReviewThread/thread/id")
        .and_then(Value::as_str)
        .is_none()
    {
        return Err(PluginError::internal(
            "GitHub did not confirm the file comment",
        ));
    }
    Ok(())
}

async fn post_at_head(
    api: &Api,
    target: &PullTarget,
    head: &str,
    path: &str,
    body: Value,
) -> Result<Value, PluginError> {
    let (status, response, headers) = api.send_raw(Method::POST, &target.path(path), body).await?;
    if status.is_success() {
        return Ok(response);
    }
    let error = status_error(status, &headers, &response);
    if status == StatusCode::UNPROCESSABLE_ENTITY {
        return Err(stale_or(api, target, head, error).await);
    }
    Err(error)
}

fn review_comment(comment: &ReviewComment) -> Option<Value> {
    let ReviewCommentSubject::Line {
        side,
        start_line,
        end_line,
    } = comment.subject
    else {
        return None;
    };
    let side = match side {
        DiffSide::New => "RIGHT",
        DiffSide::Old => "LEFT",
    };
    let mut value = json!({
        "path": comment.path,
        "body": comment.body,
        "line": end_line,
        "side": side,
    });
    if start_line < end_line {
        value["start_line"] = json!(start_line);
        value["start_side"] = json!(side);
    }
    Some(value)
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
            subject: ReviewCommentSubject::Line {
                side: DiffSide::Old,
                start_line: 3,
                end_line: 5,
            },
            body: "note".into(),
        };
        assert_eq!(
            review_comment(&comment),
            Some(
                json!({"path": "src/a.rs", "body": "note", "line": 5, "side": "LEFT",
                   "start_line": 3, "start_side": "LEFT"})
            )
        );
    }
}
