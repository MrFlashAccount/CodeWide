//! Conversation writes, published immediately as on GitHub itself: a
//! top-level pull request comment (REST) and a reply in a review thread
//! (GraphQL `addPullRequestReviewThreadReply` with the thread node id that
//! `forge.pullRequest.conversation` returns).
//!
//! GitHub has no idempotency keys; the companion journals every write
//! before calling the plugin and never repeats a known key.

use forge_protocol::{Author, Comment, CommentResult, PluginError, code};
use reqwest::Method;
use serde_json::{Value, json};

use crate::{
    api::Api,
    comment_media::{MediaScope, avatar_is_direct},
    conversation,
    repo::PullTarget,
};

const MAX_THREAD_ID_CHARS: usize = 256;
const REPLY_MUTATION: &str = "mutation($id: ID!, $body: String!) { addPullRequestReviewThreadReply(input: {pullRequestReviewThreadId: $id, body: $body}) { comment { id author { __typename login avatarUrl } createdAt lastEditedAt body bodyHTML url reactionGroups { content viewerHasReacted reactors { totalCount } } } } }";

/// `forge.pullRequest.comment.create`: `POST /repos/{o}/{r}/issues/{n}/comments`.
///
/// # Errors
///
/// Returns invalid params for an empty body or the mapped GitHub failure.
pub async fn create(
    api: &Api,
    target: &PullTarget,
    body: &str,
) -> Result<CommentResult, PluginError> {
    require_body(body)?;
    let created = api
        .send(
            Method::POST,
            &target
                .repo
                .path(&format!("/issues/{}/comments", target.number)),
            json!({ "body": body }),
        )
        .await?;
    rest_comment(&created)
        .map(|comment| CommentResult { comment })
        .ok_or_else(|| PluginError::internal("GitHub returned no comment"))
}

/// `forge.pullRequest.reviewThread.reply`. The thread must belong to the
/// addressed pull request; another pull request's thread is not found.
///
/// # Errors
///
/// Returns invalid params for an empty body or a malformed thread id,
/// `notFound` for a thread of another pull request, or the mapped GitHub
/// failure.
pub async fn reply(
    api: &Api,
    target: &PullTarget,
    thread_id: &str,
    body: &str,
) -> Result<CommentResult, PluginError> {
    require_body(body)?;
    if thread_id.is_empty()
        || thread_id.chars().count() > MAX_THREAD_ID_CHARS
        || !thread_id.bytes().all(|byte| byte.is_ascii_graphic())
    {
        return Err(PluginError::invalid_params("invalid threadId"));
    }
    let owner = api
        .graphql(
            "query($id: ID!) { node(id: $id) { __typename ... on PullRequestReviewThread { pullRequest { number repository { nameWithOwner } } } } }",
            json!({ "id": thread_id }),
        )
        .await?;
    let pull = owner.pointer("/node/pullRequest");
    let belongs = pull
        .and_then(|pull| pull.get("number"))
        .and_then(Value::as_u64)
        == Some(target.number)
        && pull
            .and_then(|pull| pull.pointer("/repository/nameWithOwner"))
            .and_then(Value::as_str)
            .is_some_and(|name| name.eq_ignore_ascii_case(&target.repo.full()));
    if !belongs {
        return Err(PluginError::new(code::NOT_FOUND, "Not found on GitHub"));
    }
    let replied = api
        .graphql(REPLY_MUTATION, json!({ "id": thread_id, "body": body }))
        .await?;
    replied
        .pointer("/addPullRequestReviewThreadReply/comment")
        .and_then(|node| conversation::comment(node, MediaScope::PRIVATE))
        .map(|comment| CommentResult { comment })
        .ok_or_else(|| PluginError::internal("GitHub returned no comment"))
}

fn require_body(body: &str) -> Result<(), PluginError> {
    if body.trim().is_empty() || body.chars().count() > forge_protocol::MAX_COMMENT_BODY_CHARS {
        return Err(PluginError::invalid_params(
            "the body must have 1 to 65536 characters",
        ));
    }
    Ok(())
}

/// A REST issue comment, addressed by its GraphQL node id like the
/// conversation's comments. A new comment has no edits and no reactions;
/// the REST answer has no rendered body, so its images get direct URLs from
/// the conversation read that follows every write.
fn rest_comment(value: &Value) -> Option<Comment> {
    let text = |field: &str| value.get(field).and_then(Value::as_str).map(str::to_owned);
    let avatar_url = value
        .pointer("/user/avatar_url")
        .and_then(Value::as_str)
        .map(str::to_owned);
    Some(Comment {
        id: text("node_id")?,
        author: Author {
            login: value
                .pointer("/user/login")
                .and_then(Value::as_str)
                .unwrap_or("ghost")
                .to_owned(),
            kind: conversation::author_kind(value.pointer("/user/type").and_then(Value::as_str)),
            avatar_direct: avatar_url.as_deref().is_some_and(avatar_is_direct),
            avatar_url,
        },
        created_at: text("created_at")?,
        updated_at: None,
        body: text("body").unwrap_or_default(),
        url: text("html_url"),
        reactions: Vec::new(),
        media: Vec::new(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_rest_comment_maps_to_its_node_id() {
        let comment = rest_comment(&json!({
            "id": 11, "node_id": "IC_kwDO", "user": {"login": "octocat", "type": "User", "avatar_url": "https://avatars.githubusercontent.com/u/1"},
            "created_at": "2026-10-01T00:00:00Z", "updated_at": "2026-10-01T00:00:00Z",
            "body": "Thanks", "html_url": "https://github.com/o/r/pull/1#issuecomment-11"
        }));
        assert_eq!(
            comment,
            Some(Comment {
                id: "IC_kwDO".into(),
                author: Author {
                    login: "octocat".into(),
                    kind: forge_protocol::AuthorKind::User,
                    avatar_url: Some("https://avatars.githubusercontent.com/u/1".into()),
                    avatar_direct: true,
                },
                created_at: "2026-10-01T00:00:00Z".into(),
                updated_at: None,
                body: "Thanks".into(),
                url: Some("https://github.com/o/r/pull/1#issuecomment-11".into()),
                reactions: Vec::new(),
                media: Vec::new(),
            })
        );
        assert!(require_body("  \n").is_err());
        assert!(require_body(&"x".repeat(65_537)).is_err());
        assert!(require_body("ok").is_ok());
    }
}
