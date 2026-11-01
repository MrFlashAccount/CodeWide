//! `forge.pullRequest.conversation`: issue comments, reviews, selected
//! timeline events and review threads of one pull request, read with
//! GitHub GraphQL and merged newest first.
//!
//! Two GitHub connections feed one page: the timeline (comments, reviews,
//! events) and the review threads. Both are read backwards (`last`/`before`)
//! from their newest item. Each page reads at most [`TIMELINE_PAGE`] timeline
//! items and [`THREADS_PAGE`] threads, then emits only the entries down to
//! the latest `createdAt` at which a connection with older pages stopped, so
//! concatenated pages stay in global newest-first order. The opaque cursor
//! records where each connection resumes towards older items.
//!
//! A thread carries at most [`MAX_THREAD_COMMENTS`] comments, oldest first:
//! the first [`THREAD_COMMENTS_PAGE`] arrive with the thread and longer
//! threads are completed by follow-up reads of 100 comments each. Comments
//! beyond the bound are not returned.

use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use forge_protocol::{
    Author, AuthorKind, Comment, ConversationEntry, ConversationPage, DiffSide, EventCategory,
    EventCommits, PluginError, Reaction, ReactionContent, ReviewThread, ReviewVerdict,
    ThreadAnchor, ThreadResolution,
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::{
    api::Api,
    comment_media::{MediaScope, avatar_is_direct, comment_media},
    excerpt, pushes,
    repo::PullTarget,
};

/// Timeline items (comments, reviews and events) per page.
pub const TIMELINE_PAGE: u32 = 50;
/// Review threads per page.
pub const THREADS_PAGE: u32 = 20;
/// Comments read with each thread.
pub const THREAD_COMMENTS_PAGE: u32 = 50;
/// The most comments one thread returns.
pub const MAX_THREAD_COMMENTS: usize = 250;
const THREAD_FOLLOW_UP_PAGE: u32 = 100;
const MAX_CURSOR_CHARS: usize = 4_096;

const AUTHOR: &str = "author { __typename login avatarUrl }";
const REACTIONS: &str = "reactionGroups { content viewerHasReacted reactors { totalCount } }";
const COMMIT: &str =
    "oid abbreviatedOid messageHeadline author { user { __typename login avatarUrl } }";

fn review_comment_fields() -> String {
    format!("id {AUTHOR} createdAt lastEditedAt body bodyHTML url {REACTIONS}")
}

fn page_query() -> String {
    let actor = "actor { __typename login avatarUrl }";
    let comment = review_comment_fields();
    format!(
        r"query($owner: String!, $name: String!, $number: Int!, $timelineBefore: String, $threadsBefore: String, $withTimeline: Boolean!, $withThreads: Boolean!) {{
  repository(owner: $owner, name: $name) {{
    isPrivate
    pullRequest(number: $number) {{
      timelineItems(last: {TIMELINE_PAGE}, before: $timelineBefore, itemTypes: [ISSUE_COMMENT, PULL_REQUEST_REVIEW, PULL_REQUEST_COMMIT, MERGED_EVENT, CLOSED_EVENT, REOPENED_EVENT, HEAD_REF_FORCE_PUSHED_EVENT, READY_FOR_REVIEW_EVENT, CONVERT_TO_DRAFT_EVENT, REVIEW_REQUESTED_EVENT]) @include(if: $withTimeline) {{
        pageInfo {{ hasPreviousPage }}
        edges {{ cursor node {{
          __typename
          ... on IssueComment {{ id {AUTHOR} createdAt lastEditedAt body bodyHTML url {REACTIONS} }}
          ... on PullRequestReview {{ id {AUTHOR} createdAt submittedAt lastEditedAt state body bodyHTML url {REACTIONS} }}
          ... on MergedEvent {{ id {actor} createdAt mergeRefName commit {{ abbreviatedOid }} }}
          ... on ClosedEvent {{ id {actor} createdAt }}
          ... on ReopenedEvent {{ id {actor} createdAt }}
          ... on PullRequestCommit {{ id commit {{ {COMMIT} committedDate }} }}
          ... on HeadRefForcePushedEvent {{ id {actor} createdAt beforeCommit {{ abbreviatedOid }} afterCommit {{ {COMMIT} }} }}
          ... on ReadyForReviewEvent {{ id {actor} createdAt }}
          ... on ConvertToDraftEvent {{ id {actor} createdAt }}
          ... on ReviewRequestedEvent {{ id {actor} createdAt requestedReviewer {{ ... on User {{ login }} ... on Team {{ name }} ... on Mannequin {{ login }} }} }}
        }} }}
      }}
      reviewThreads(last: {THREADS_PAGE}, before: $threadsBefore) @include(if: $withThreads) {{
        pageInfo {{ hasPreviousPage }}
        edges {{ cursor node {{
          id path line startLine diffSide isResolved isOutdated viewerCanReply viewerCanResolve viewerCanUnresolve
          opening: comments(first: 1) {{ nodes {{ diffHunk }} }}
          comments(first: {THREAD_COMMENTS_PAGE}) {{ pageInfo {{ hasNextPage endCursor }} nodes {{ {comment} pullRequestReview {{ id }} }} }}
        }} }}
      }}
    }}
  }}
}}"
    )
}

fn thread_comments_query() -> String {
    let comment = review_comment_fields();
    format!(
        r"query($id: ID!, $after: String) {{
  node(id: $id) {{
    ... on PullRequestReviewThread {{
      comments(first: {THREAD_FOLLOW_UP_PAGE}, after: $after) {{ pageInfo {{ hasNextPage endCursor }} nodes {{ {comment} }} }}
    }}
  }}
}}"
    )
}

/// Where one connection resumes: from its newest item, before the oldest
/// item already emitted, or nowhere.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(tag = "state", rename_all = "camelCase")]
enum Phase {
    Start,
    Before { cursor: String },
    Done,
}

impl Phase {
    fn wants_read(&self) -> bool {
        !matches!(self, Self::Done)
    }

    fn before(&self) -> Option<&str> {
        match self {
            Self::Before { cursor } => Some(cursor),
            Self::Start | Self::Done => None,
        }
    }
}

/// The opaque page cursor: one resume point per GitHub connection.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct PageCursor {
    timeline: Phase,
    threads: Phase,
}

impl PageCursor {
    const FIRST: Self = Self {
        timeline: Phase::Start,
        threads: Phase::Start,
    };

    fn decode(cursor: Option<&str>) -> Result<Self, PluginError> {
        let Some(cursor) = cursor else {
            return Ok(Self::FIRST);
        };
        let invalid = || PluginError::invalid_params("invalid conversation cursor");
        if cursor.len() > MAX_CURSOR_CHARS {
            return Err(invalid());
        }
        let bytes = URL_SAFE_NO_PAD.decode(cursor).map_err(|_| invalid())?;
        serde_json::from_slice(&bytes).map_err(|_| invalid())
    }

    fn encode(&self) -> Option<String> {
        if self.timeline == Phase::Done && self.threads == Phase::Done {
            return None;
        }
        serde_json::to_vec(self)
            .ok()
            .map(|bytes| URL_SAFE_NO_PAD.encode(bytes))
    }
}

/// One edge of a connection: its cursor, its order key and its entry, if
/// the node maps to one (skipped nodes still advance the cursor).
struct Edge {
    cursor: String,
    created_at: String,
    entry: Option<ConversationEntry>,
    /// A single `PullRequestCommit`, which may join a push.
    commit: bool,
}

/// One read connection, its edges newest first.
struct Batch {
    edges: Vec<Edge>,
    /// The connection has older items than the oldest edge.
    has_older: bool,
}

/// # Errors
///
/// Returns invalid params for a malformed cursor or the mapped GitHub
/// failure.
pub async fn conversation(
    api: &Api,
    target: &PullTarget,
    cursor: Option<&str>,
) -> Result<ConversationPage, PluginError> {
    let cursor = PageCursor::decode(cursor)?;
    let data = api
        .graphql(
            &page_query(),
            json!({
                "owner": target.repo.owner,
                "name": target.repo.name,
                "number": target.number,
                "timelineBefore": cursor.timeline.before(),
                "threadsBefore": cursor.threads.before(),
                "withTimeline": cursor.timeline.wants_read(),
                "withThreads": cursor.threads.wants_read(),
            }),
        )
        .await?;
    let pull = data
        .pointer("/repository/pullRequest")
        .filter(|pull| !pull.is_null())
        .ok_or_else(|| PluginError::new(forge_protocol::code::NOT_FOUND, "Not found on GitHub"))?;
    let scope = MediaScope {
        public_repository: data.pointer("/repository/isPrivate") == Some(&Value::Bool(false)),
    };
    let timeline = cursor.timeline.wants_read().then(|| {
        batch(pull.get("timelineItems"), |node| {
            timeline_entry(node, scope)
        })
    });
    let mut threads = cursor
        .threads
        .wants_read()
        .then(|| batch(pull.get("reviewThreads"), |node| thread_entry(node, scope)));
    if let Some(threads) = &mut threads {
        complete_threads(api, pull.get("reviewThreads"), threads, scope).await?;
    }
    Ok(merge(&cursor, timeline, threads))
}

/// The edges of a backwards page arrive oldest first; the batch keeps them
/// newest first.
fn batch(connection: Option<&Value>, map: impl Fn(&Value) -> Option<ConversationEntry>) -> Batch {
    let edges = connection
        .and_then(|connection| connection.get("edges"))
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or_default();
    Batch {
        edges: edges
            .iter()
            .rev()
            .filter_map(|edge| {
                let cursor = edge.get("cursor")?.as_str()?.to_owned();
                let node = edge.get("node")?;
                let entry = map(node);
                let created_at = entry.as_ref().map_or_else(
                    || text(node, "createdAt"),
                    |entry| entry.created_at().to_owned(),
                );
                Some(Edge {
                    cursor,
                    created_at,
                    entry,
                    commit: node.get("__typename").and_then(Value::as_str)
                        == Some("PullRequestCommit"),
                })
            })
            .collect(),
        has_older: connection
            .and_then(|connection| connection.pointer("/pageInfo/hasPreviousPage"))
            .and_then(Value::as_bool)
            .unwrap_or(false),
    }
}

/// Reads the remaining comments of threads longer than one page, up to
/// [`MAX_THREAD_COMMENTS`].
async fn complete_threads(
    api: &Api,
    connection: Option<&Value>,
    threads: &mut Batch,
    scope: MediaScope,
) -> Result<(), PluginError> {
    let nodes: Vec<&Value> = connection
        .and_then(|connection| connection.get("edges"))
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|edge| edge.get("node"))
        .collect();
    for edge in &mut threads.edges {
        let Some(ConversationEntry::ReviewThread { thread }) = &mut edge.entry else {
            continue;
        };
        let Some(node) = nodes
            .iter()
            .find(|node| node.get("id").and_then(Value::as_str) == Some(thread.id.as_str()))
        else {
            continue;
        };
        let mut page_info = node.pointer("/comments/pageInfo").cloned();
        while thread.comments.len() < MAX_THREAD_COMMENTS
            && page_info
                .as_ref()
                .and_then(|info| info.get("hasNextPage"))
                .and_then(Value::as_bool)
                == Some(true)
        {
            let after = page_info
                .as_ref()
                .and_then(|info| info.get("endCursor"))
                .and_then(Value::as_str)
                .map(str::to_owned);
            let data = api
                .graphql(
                    &thread_comments_query(),
                    json!({"id": thread.id, "after": after}),
                )
                .await?;
            let Some(comments) = data.pointer("/node/comments") else {
                break;
            };
            let room = MAX_THREAD_COMMENTS - thread.comments.len();
            thread.comments.extend(
                comments
                    .get("nodes")
                    .and_then(Value::as_array)
                    .into_iter()
                    .flatten()
                    .filter_map(|node| comment(node, scope))
                    .take(room),
            );
            page_info = comments.get("pageInfo").cloned();
        }
    }
    Ok(())
}

/// Emits the entries down to the latest point at which a connection with
/// older pages stopped, newest first, and records where each connection
/// resumes.
fn merge(cursor: &PageCursor, timeline: Option<Batch>, threads: Option<Batch>) -> ConversationPage {
    let cut = [&timeline, &threads]
        .into_iter()
        .flatten()
        .filter(|batch| batch.has_older)
        .filter_map(|batch| batch.edges.last().map(|edge| edge.created_at.clone()))
        .max();
    let consumed = |batch: &Batch| match &cut {
        None => batch.edges.len(),
        Some(cut) => batch
            .edges
            .iter()
            .take_while(|edge| edge.created_at >= *cut)
            .count(),
    };
    let mut taken = [
        timeline.as_ref().map_or(0, consumed),
        threads.as_ref().map_or(0, consumed),
    ];
    if taken == [0, 0] {
        // A connection out of `createdAt` order must still make progress:
        // take the whole batch that defined the cut.
        for (index, batch) in [&timeline, &threads].into_iter().enumerate() {
            if let Some(batch) = batch
                && batch.has_older
                && cut.as_deref() == batch.edges.last().map(|edge| edge.created_at.as_str())
            {
                taken[index] = batch.edges.len();
                break;
            }
        }
    }
    let next = PageCursor {
        timeline: resume(&cursor.timeline, timeline.as_ref(), taken[0]),
        threads: resume(&cursor.threads, threads.as_ref(), taken[1]),
    };
    let taken_edges = |batch: Option<Batch>, count: usize| {
        batch
            .into_iter()
            .flat_map(move |batch| batch.edges.into_iter().take(count))
    };
    let mut entries: Vec<ConversationEntry> = taken_edges(threads, taken[1])
        .filter_map(|edge| edge.entry)
        .collect();
    entries.extend(pushes::group(taken_edges(timeline, taken[0]).map(|edge| {
        pushes::TimelineEntry {
            commit: edge.commit,
            entry: edge.entry,
        }
    })));
    entries.sort_by(|left, right| right.created_at().cmp(left.created_at()));
    ConversationPage {
        entries,
        next_cursor: next.encode(),
        // GitHub has no issues, so nothing blocks a merge through them.
        open_issues_block_merge: None,
    }
}

fn resume(previous: &Phase, batch: Option<&Batch>, taken: usize) -> Phase {
    let Some(batch) = batch else {
        return previous.clone();
    };
    if taken == batch.edges.len() && !batch.has_older {
        return Phase::Done;
    }
    match taken.checked_sub(1).and_then(|last| batch.edges.get(last)) {
        Some(edge) => Phase::Before {
            cursor: edge.cursor.clone(),
        },
        None => previous.clone(),
    }
}

fn text(value: &Value, field: &str) -> String {
    value
        .get(field)
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_owned()
}

fn optional_text(value: &Value, field: &str) -> Option<String> {
    value.get(field).and_then(Value::as_str).map(str::to_owned)
}

/// A GitHub account type (`__typename` in GraphQL, `type` in REST): a
/// `Bot` is an App or automation account; GitHub does not mark AI
/// reviewers apart from bots.
pub(crate) fn author_kind(account_type: Option<&str>) -> AuthorKind {
    match account_type {
        Some("Bot") => AuthorKind::Bot,
        _ => AuthorKind::User,
    }
}

/// A GraphQL actor; a deleted account is GitHub's `ghost`.
fn author(value: Option<&Value>) -> Author {
    let value = value.filter(|value| !value.is_null());
    let avatar_url = value.and_then(|value| optional_text(value, "avatarUrl"));
    Author {
        login: value
            .and_then(|value| value.get("login"))
            .and_then(Value::as_str)
            .unwrap_or("ghost")
            .to_owned(),
        kind: author_kind(
            value
                .and_then(|value| value.get("__typename"))
                .and_then(Value::as_str),
        ),
        avatar_direct: avatar_url.as_deref().is_some_and(avatar_is_direct),
        avatar_url,
    }
}

fn reactions(value: &Value) -> Vec<Reaction> {
    value
        .get("reactionGroups")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|group| {
            let content = match group.get("content")?.as_str()? {
                "THUMBS_UP" => ReactionContent::ThumbsUp,
                "THUMBS_DOWN" => ReactionContent::ThumbsDown,
                "LAUGH" => ReactionContent::Laugh,
                "HOORAY" => ReactionContent::Hooray,
                "CONFUSED" => ReactionContent::Confused,
                "HEART" => ReactionContent::Heart,
                "ROCKET" => ReactionContent::Rocket,
                "EYES" => ReactionContent::Eyes,
                _ => return None,
            };
            let count = group
                .pointer("/reactors/totalCount")
                .and_then(Value::as_u64)
                .and_then(|count| u32::try_from(count).ok())
                .filter(|count| *count > 0)?;
            Some(Reaction {
                content,
                count,
                viewer_reacted: group
                    .get("viewerHasReacted")
                    .and_then(Value::as_bool)
                    .unwrap_or(false),
            })
        })
        .collect()
}

/// An `IssueComment`, `PullRequestReviewComment` or review body node, with
/// direct URLs for the images its rendered `bodyHTML` signs.
pub(crate) fn comment(value: &Value, scope: MediaScope) -> Option<Comment> {
    let body = text(value, "body");
    Some(Comment {
        id: value.get("id")?.as_str()?.to_owned(),
        author: author(value.get("author")),
        created_at: value.get("createdAt")?.as_str()?.to_owned(),
        updated_at: optional_text(value, "lastEditedAt"),
        media: comment_media(&body, &text(value, "bodyHTML"), scope),
        body,
        url: optional_text(value, "url"),
        reactions: reactions(value),
    })
}

fn timeline_entry(node: &Value, scope: MediaScope) -> Option<ConversationEntry> {
    match node.get("__typename")?.as_str()? {
        "IssueComment" => Some(ConversationEntry::Comment {
            comment: comment(node, scope)?,
        }),
        "PullRequestReview" => review_entry(node, scope),
        "MergedEvent" => {
            let commit = node
                .pointer("/commit/abbreviatedOid")
                .and_then(Value::as_str)
                .unwrap_or("a commit");
            let base = node
                .get("mergeRefName")
                .and_then(Value::as_str)
                .unwrap_or("the base branch");
            event(
                node,
                EventCategory::State,
                format!("merged commit {commit} into {base}"),
            )
        }
        "ClosedEvent" => event(
            node,
            EventCategory::State,
            "closed this pull request".into(),
        ),
        "ReopenedEvent" => event(
            node,
            EventCategory::State,
            "reopened this pull request".into(),
        ),
        "PullRequestCommit" => pushes::commit_event(node, |user| author(Some(user))),
        "HeadRefForcePushedEvent" => {
            let (text, commits) = pushes::force_push(node);
            event_with_commits(node, EventCategory::Push, text, commits)
        }
        "ReadyForReviewEvent" => event(
            node,
            EventCategory::State,
            "marked this pull request as ready for review".into(),
        ),
        "ConvertToDraftEvent" => event(
            node,
            EventCategory::State,
            "converted this pull request to a draft".into(),
        ),
        "ReviewRequestedEvent" => {
            let reviewer = node.get("requestedReviewer").and_then(|reviewer| {
                reviewer
                    .get("login")
                    .or_else(|| reviewer.get("name"))
                    .and_then(Value::as_str)
            });
            event(
                node,
                EventCategory::Other,
                reviewer.map_or_else(
                    || "requested a review".to_owned(),
                    |reviewer| format!("requested a review from {reviewer}"),
                ),
            )
        }
        _ => None,
    }
}

fn event(node: &Value, category: EventCategory, text: String) -> Option<ConversationEntry> {
    event_with_commits(node, category, text, None)
}

fn event_with_commits(
    node: &Value,
    category: EventCategory,
    text: String,
    commits: Option<EventCommits>,
) -> Option<ConversationEntry> {
    Some(ConversationEntry::Event {
        id: node.get("id")?.as_str()?.to_owned(),
        author: node
            .get("actor")
            .filter(|actor| !actor.is_null())
            .map(|actor| author(Some(actor))),
        created_at: node.get("createdAt")?.as_str()?.to_owned(),
        category,
        text,
        commits,
    })
}

/// A submitted review. A `COMMENTED` review without a body only carries
/// inline comments, which appear in their threads, so it is skipped; a
/// pending review is the viewer's unpublished draft and is skipped too.
fn review_entry(node: &Value, scope: MediaScope) -> Option<ConversationEntry> {
    let verdict = match node.get("state")?.as_str()? {
        "APPROVED" => ReviewVerdict::Approved,
        "CHANGES_REQUESTED" => ReviewVerdict::ChangesRequested,
        "COMMENTED" => ReviewVerdict::Commented,
        "DISMISSED" => ReviewVerdict::Dismissed,
        _ => return None,
    };
    let created_at =
        optional_text(node, "submittedAt").or_else(|| optional_text(node, "createdAt"))?;
    let body = comment(node, scope)
        .filter(|body| !body.body.trim().is_empty())
        .map(|body| Comment {
            created_at: created_at.clone(),
            ..body
        });
    if verdict == ReviewVerdict::Commented && body.is_none() {
        return None;
    }
    Some(ConversationEntry::Review {
        id: node.get("id")?.as_str()?.to_owned(),
        author: author(node.get("author")),
        created_at,
        verdict,
        body,
    })
}

fn thread_entry(node: &Value, scope: MediaScope) -> Option<ConversationEntry> {
    let line = |field: &str| {
        node.get(field)
            .and_then(Value::as_u64)
            .and_then(|line| u32::try_from(line).ok())
    };
    let comments: Vec<Comment> = node
        .pointer("/comments/nodes")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|node| comment(node, scope))
        .take(MAX_THREAD_COMMENTS)
        .collect();
    if comments.is_empty() {
        return None;
    }
    // The review the thread was published with is its first comment's.
    let review_id = node
        .pointer("/comments/nodes/0/pullRequestReview/id")
        .and_then(Value::as_str)
        .map(str::to_owned);
    let anchor = thread_anchor(node, line("line"), line("startLine"))?;
    let excerpt = node
        .pointer("/opening/nodes/0/diffHunk")
        .and_then(Value::as_str)
        .and_then(|hunk| excerpt::from_diff_hunk(hunk, &anchor));
    Some(ConversationEntry::ReviewThread {
        thread: ReviewThread {
            id: node.get("id")?.as_str()?.to_owned(),
            anchor,
            outdated: node
                .get("isOutdated")
                .and_then(Value::as_bool)
                .unwrap_or(false),
            resolution: conversation_resolution(node),
            review_id,
            // GitHub has no iterations.
            iteration: None,
            comments,
            viewer_can_reply: node
                .get("viewerCanReply")
                .and_then(Value::as_bool)
                .unwrap_or(false),
            excerpt,
        },
    })
}

/// `isResolved`, and whether the viewer may flip it: `viewerCanUnresolve`
/// for a resolved thread, `viewerCanResolve` for an unresolved one.
pub(crate) fn conversation_resolution(node: &Value) -> ThreadResolution {
    let flag = |field: &str| node.get(field).and_then(Value::as_bool).unwrap_or(false);
    let resolved = flag("isResolved");
    ThreadResolution::Conversation {
        resolved,
        viewer_can_toggle: flag(if resolved {
            "viewerCanUnresolve"
        } else {
            "viewerCanResolve"
        }),
    }
}

/// A GitHub thread is always on a file: on its lines while `line` still
/// maps, otherwise (a file-level thread, or one outdated beyond mapping) on
/// the file. A single-line thread repeats its line as `startLine`; that
/// becomes `None`.
fn thread_anchor(node: &Value, end: Option<u32>, start: Option<u32>) -> Option<ThreadAnchor> {
    let path = node.get("path")?.as_str()?.to_owned();
    Some(match end.filter(|line| *line > 0) {
        None => ThreadAnchor::File { path },
        Some(line) => ThreadAnchor::Line {
            path,
            line,
            start_line: start.filter(|start| *start > 0 && *start < line),
            side: match node.get("diffSide").and_then(Value::as_str) {
                Some("LEFT") => DiffSide::Old,
                _ => DiffSide::New,
            },
        },
    })
}

#[cfg(test)]
#[allow(clippy::expect_used)]
mod tests {
    use super::*;

    const SCOPE: MediaScope = MediaScope::PRIVATE;

    fn reactions_json() -> Value {
        json!([
            {"content": "THUMBS_UP", "viewerHasReacted": true, "reactors": {"totalCount": 3}},
            {"content": "HEART", "viewerHasReacted": false, "reactors": {"totalCount": 0}},
            {"content": "ROCKET", "viewerHasReacted": false, "reactors": {"totalCount": 1}}
        ])
    }

    /// A backwards page as GitHub sends it: the newest items, oldest first.
    fn fixture_page(older_timeline: bool, older_threads: bool) -> Value {
        json!({
            "timelineItems": {
                "pageInfo": {"hasPreviousPage": older_timeline},
                "edges": [
                    {"cursor": "t1", "node": {"__typename": "IssueComment", "id": "IC_1",
                        "author": {"__typename": "User", "login": "octocat", "avatarUrl": "https://avatars.githubusercontent.com/u/1"},
                        "createdAt": "2026-10-01T00:00:00Z", "lastEditedAt": "2026-10-01T00:05:00Z",
                        "body": "First ![shot](https://github.com/user-attachments/assets/0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d)",
                        "bodyHTML": "<p>First <img alt=\"shot\" src=\"https://private-user-images.githubusercontent.com/1/2-0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d.png?jwt=eyJhbGciOiJub25lIn0.eyJleHAiOjE3OTAwMDAwMDB9.\"></p>",
                        "url": "https://github.com/o/r/pull/1#issuecomment-1", "reactionGroups": reactions_json()}},
                    {"cursor": "t2", "node": {"__typename": "PullRequestReview", "id": "PRR_1",
                        "author": {"login": "rev", "avatarUrl": null}, "createdAt": "2026-10-01T00:59:00Z",
                        "submittedAt": "2026-10-01T01:00:00Z", "lastEditedAt": null, "state": "CHANGES_REQUESTED",
                        "body": "Please fix the parser.", "url": "https://github.com/o/r/pull/1#pullrequestreview-1",
                        "reactionGroups": []}},
                    {"cursor": "t3", "node": {"__typename": "PullRequestReview", "id": "PRR_2",
                        "author": {"login": "rev"}, "createdAt": "2026-10-01T02:00:00Z",
                        "submittedAt": "2026-10-01T02:00:00Z", "state": "COMMENTED", "body": "",
                        "reactionGroups": []}},
                    {"cursor": "t4", "node": {"__typename": "MergedEvent", "id": "ME_1",
                        "actor": {"__typename": "Bot", "login": "merge-bot", "avatarUrl": null}, "createdAt": "2026-10-01T05:00:00Z",
                        "mergeRefName": "main", "commit": {"abbreviatedOid": "abc1234"}}},
                    {"cursor": "t5", "node": {"__typename": "ReviewRequestedEvent", "id": "RRE_1",
                        "actor": null, "createdAt": "2026-10-01T06:00:00Z",
                        "requestedReviewer": {"name": "core"}}}
                ]
            },
            "reviewThreads": {
                "pageInfo": {"hasPreviousPage": older_threads},
                "edges": [
                    {"cursor": "r1", "node": {"id": "PRRT_1", "path": "src/a.rs", "line": 42, "startLine": 40,
                        "diffSide": "RIGHT", "isResolved": true, "isOutdated": false, "viewerCanReply": true,
                        "viewerCanResolve": true, "viewerCanUnresolve": false,
                        "opening": {"nodes": [{"diffHunk": "@@ -39,3 +39,5 @@ fn parse() {\n let a = 1;\n-let b = 2;\n+let b = 3;\n+let c = 4;\n let d = 5;"}]},
                        "comments": {"pageInfo": {"hasNextPage": false, "endCursor": null}, "nodes": [
                            {"id": "PRRC_1", "author": {"login": "rev", "avatarUrl": null},
                             "createdAt": "2026-10-01T00:30:00Z", "lastEditedAt": null, "body": "Rename",
                             "url": "https://github.com/o/r/pull/1#discussion_r1", "reactionGroups": [],
                             "pullRequestReview": {"id": "PRR_1"}},
                            {"id": "PRRC_2", "author": null, "createdAt": "2026-10-01T00:40:00Z",
                             "lastEditedAt": null, "body": "Done", "url": null, "reactionGroups": []}
                        ]}}},
                    {"cursor": "r2", "node": {"id": "PRRT_2", "path": "src/b.rs", "line": null, "startLine": null,
                        "diffSide": "LEFT", "isResolved": false, "isOutdated": true, "viewerCanReply": false,
                        "viewerCanResolve": true, "viewerCanUnresolve": false,
                        "comments": {"pageInfo": {"hasNextPage": false}, "nodes": [
                            {"id": "PRRC_3", "author": {"login": "rev"}, "createdAt": "2026-10-01T03:00:00Z",
                             "body": "Old line", "reactionGroups": []}
                        ]}}},
                    {"cursor": "r3", "node": {"id": "PRRT_3", "path": "src/c.rs", "line": 7, "startLine": 7,
                        "diffSide": "RIGHT", "isResolved": false, "isOutdated": false, "viewerCanReply": true,
                        "comments": {"pageInfo": {"hasNextPage": false}, "nodes": [
                            {"id": "PRRC_4", "author": {"__typename": "Bot", "login": "copilot"}, "createdAt": "2026-10-01T07:00:00Z",
                             "body": "Later", "reactionGroups": [], "pullRequestReview": null}
                        ]}}}
                ]
            }
        })
    }

    fn page(pull: &Value, cursor: &PageCursor) -> ConversationPage {
        merge(
            cursor,
            cursor.timeline.wants_read().then(|| {
                batch(pull.get("timelineItems"), |node| {
                    timeline_entry(node, SCOPE)
                })
            }),
            cursor
                .threads
                .wants_read()
                .then(|| batch(pull.get("reviewThreads"), |node| thread_entry(node, SCOPE))),
        )
    }

    fn ids(page: &ConversationPage) -> Vec<&str> {
        page.entries
            .iter()
            .map(|entry| match entry {
                ConversationEntry::Comment { comment } => comment.id.as_str(),
                ConversationEntry::Review { id, .. } | ConversationEntry::Event { id, .. } => id,
                ConversationEntry::ReviewThread { thread } => thread.id.as_str(),
            })
            .collect()
    }

    #[test]
    fn maps_comments_reviews_threads_and_events_newest_first() {
        let result = page(&fixture_page(false, false), &PageCursor::FIRST);
        // The body-less COMMENTED review is skipped: its comments live in threads.
        assert_eq!(
            ids(&result),
            [
                "PRRT_3", "RRE_1", "ME_1", "PRRT_2", "PRR_1", "PRRT_1", "IC_1"
            ]
        );
        assert_eq!(result.next_cursor, None);
        let ConversationEntry::Comment { comment } = &result.entries[6] else {
            panic!("comment last");
        };
        assert_eq!(comment.updated_at.as_deref(), Some("2026-10-01T00:05:00Z"));
        assert!(comment.author.avatar_direct);
        assert_eq!(comment.author.kind, AuthorKind::User);
        assert_eq!(result.open_issues_block_merge, None);
        assert_eq!(
            comment
                .media
                .iter()
                .map(|media| (media.source.as_str(), media.expires_at.as_deref()))
                .collect::<Vec<_>>(),
            [(
                "https://github.com/user-attachments/assets/0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d",
                Some("2026-09-21T14:13:20Z")
            )],
            "the attachment pairs with the signed URL of its rendering"
        );
        assert_eq!(
            comment.reactions,
            vec![
                Reaction {
                    content: ReactionContent::ThumbsUp,
                    count: 3,
                    viewer_reacted: true
                },
                Reaction {
                    content: ReactionContent::Rocket,
                    count: 1,
                    viewer_reacted: false
                },
            ]
        );
        let ConversationEntry::Review { verdict, body, .. } = &result.entries[4] else {
            panic!("review fifth");
        };
        assert_eq!(*verdict, ReviewVerdict::ChangesRequested);
        let body = body.as_ref().expect("review body");
        assert_eq!(body.body, "Please fix the parser.");
        assert_eq!(body.created_at, "2026-10-01T01:00:00Z");
        assert!(
            matches!(&result.entries[2], ConversationEntry::Event { text, author: Some(actor), category: EventCategory::State, .. }
            if text == "merged commit abc1234 into main" && actor.login == "merge-bot" && actor.kind == AuthorKind::Bot)
        );
        assert!(
            matches!(&result.entries[1], ConversationEntry::Event { text, author: None, category: EventCategory::Other, .. }
            if text == "requested a review from core")
        );
    }

    #[test]
    fn maps_threads_to_anchors_resolutions_and_their_reviews() {
        let result = page(&fixture_page(false, false), &PageCursor::FIRST);
        let ConversationEntry::ReviewThread { thread } = &result.entries[5] else {
            panic!("thread sixth");
        };
        assert!(!thread.outdated && thread.viewer_can_reply);
        assert_eq!(
            thread.resolution,
            ThreadResolution::Conversation {
                resolved: true,
                viewer_can_toggle: false
            }
        );
        assert_eq!(
            thread.anchor,
            ThreadAnchor::Line {
                path: "src/a.rs".into(),
                line: 42,
                start_line: Some(40),
                side: DiffSide::New
            }
        );
        assert_eq!(
            thread.review_id.as_deref(),
            Some("PRR_1"),
            "the thread links to the review its first comment was published with"
        );
        assert_eq!(thread.iteration, None);
        assert_eq!(
            thread.excerpt.as_ref().map(|excerpt| excerpt
                .lines
                .iter()
                .map(|line| (line.number(DiffSide::New), line.text()))
                .collect::<Vec<_>>()),
            Some(vec![
                (Some(39), "let a = 1;"),
                (None, "let b = 2;"),
                (Some(40), "let b = 3;"),
                (Some(41), "let c = 4;"),
                (Some(42), "let d = 5;"),
            ]),
            "the first comment's hunk, numbered from its header"
        );
        assert_eq!(
            thread
                .comments
                .iter()
                .map(|comment| comment.id.as_str())
                .collect::<Vec<_>>(),
            ["PRRC_1", "PRRC_2"],
            "a thread's own comments stay oldest first"
        );
        assert_eq!(thread.comments[1].author.login, "ghost");
        assert_eq!(thread.comments[0].updated_at, None);
        let ConversationEntry::ReviewThread { thread: outdated } = &result.entries[3] else {
            panic!("outdated thread");
        };
        assert!(outdated.outdated && !outdated.viewer_can_reply);
        assert_eq!(
            outdated.anchor,
            ThreadAnchor::File {
                path: "src/b.rs".into()
            },
            "a line that no longer maps keeps the file"
        );
        assert_eq!(
            outdated.resolution,
            ThreadResolution::Conversation {
                resolved: false,
                viewer_can_toggle: true
            }
        );
        assert_eq!(outdated.review_id, None);
        let ConversationEntry::ReviewThread { thread: single } = &result.entries[0] else {
            panic!("single-line thread");
        };
        assert!(matches!(
            &single.anchor,
            ThreadAnchor::Line {
                line: 7,
                start_line: None,
                side: DiffSide::New,
                ..
            }
        ));
        assert_eq!(single.comments[0].author.kind, AuthorKind::Bot);
    }

    #[test]
    fn pages_stop_at_the_latest_unfinished_connection_and_resume_towards_older_items() {
        // Threads have older pages and stopped at 00:30; the timeline has
        // none: its 00:00 comment waits for the next page.
        let first = page(&fixture_page(false, true), &PageCursor::FIRST);
        assert_eq!(
            ids(&first),
            ["PRRT_3", "RRE_1", "ME_1", "PRRT_2", "PRR_1", "PRRT_1"]
        );
        let cursor = PageCursor::decode(first.next_cursor.as_deref()).expect("cursor");
        assert_eq!(
            cursor.timeline,
            Phase::Before {
                cursor: "t2".into()
            }
        );
        assert_eq!(
            cursor.threads,
            Phase::Before {
                cursor: "r1".into()
            }
        );
        // The timeline has older pages and stopped at 00:00, below every
        // thread: everything read is emitted and the threads are done.
        let second = page(&fixture_page(true, false), &PageCursor::FIRST);
        assert_eq!(second.entries.len(), 7);
        let cursor = PageCursor::decode(second.next_cursor.as_deref()).expect("cursor");
        assert_eq!(
            cursor.timeline,
            Phase::Before {
                cursor: "t1".into()
            }
        );
        assert_eq!(cursor.threads, Phase::Done);
        // A finished pair of connections ends the conversation.
        let done = PageCursor {
            timeline: Phase::Done,
            threads: Phase::Done,
        };
        assert_eq!(page(&Value::Null, &done), ConversationPage::default());
        assert!(PageCursor::decode(Some("not a cursor")).is_err());
    }

    #[test]
    fn concatenated_pages_stay_newest_first_across_connections() {
        // The older remainder of both connections, read before the first
        // page's cursor: a thread and a comment older than everything above.
        let first = page(&fixture_page(false, true), &PageCursor::FIRST);
        let resume = PageCursor::decode(first.next_cursor.as_deref()).expect("cursor");
        let older = json!({
            "timelineItems": {"pageInfo": {"hasPreviousPage": false}, "edges": [
                {"cursor": "t1", "node": {"__typename": "IssueComment", "id": "IC_1",
                    "author": {"login": "octocat"}, "createdAt": "2026-10-01T00:00:00Z",
                    "body": "First", "reactionGroups": []}}
            ]},
            "reviewThreads": {"pageInfo": {"hasPreviousPage": false}, "edges": [
                {"cursor": "r0", "node": {"id": "PRRT_0", "path": "src/z.rs", "line": 1,
                    "diffSide": "RIGHT", "isResolved": false, "isOutdated": false, "viewerCanReply": true,
                    "comments": {"pageInfo": {"hasNextPage": false}, "nodes": [
                        {"id": "PRRC_0", "author": {"login": "rev"}, "createdAt": "2026-09-30T00:00:00Z",
                         "body": "Earliest", "reactionGroups": []}
                    ]}}}
            ]}
        });
        let second = page(&older, &resume);
        assert_eq!(ids(&second), ["IC_1", "PRRT_0"]);
        assert_eq!(second.next_cursor, None);
        let all: Vec<&str> = first
            .entries
            .iter()
            .chain(&second.entries)
            .map(ConversationEntry::created_at)
            .collect();
        assert!(
            all.windows(2).all(|pair| pair[0] >= pair[1]),
            "pages concatenate newest first: {all:?}"
        );
    }

    #[test]
    fn commits_on_a_page_become_pushes_and_force_pushes_name_their_heads() {
        let commit = |cursor: &str, id: &str, at: &str| {
            json!({"cursor": cursor, "node": {"__typename": "PullRequestCommit", "id": id,
                "commit": {"oid": format!("{id:0<40}"), "abbreviatedOid": &format!("{id:0<40}")[..7],
                    "messageHeadline": format!("Commit {id}"), "committedDate": at,
                    "author": {"user": {"__typename": "User", "login": "ana", "avatarUrl": null}}}}})
        };
        let pull = json!({"timelineItems": {"pageInfo": {"hasPreviousPage": false}, "edges": [
            commit("t1", "c1", "2026-10-01T01:00:00Z"),
            commit("t2", "c2", "2026-10-01T02:00:00Z"),
            {"cursor": "t3", "node": {"__typename": "HeadRefForcePushedEvent", "id": "FP_1",
                "actor": {"login": "ana"}, "createdAt": "2026-10-01T03:00:00Z",
                "beforeCommit": {"abbreviatedOid": "c200000"},
                "afterCommit": {"oid": "f".repeat(40), "abbreviatedOid": "fffffff",
                    "messageHeadline": "Squash", "author": {"user": {"login": "ana"}}}}},
            commit("t4", "c4", "2026-10-01T04:00:00Z")
        ]}});
        let result = page(
            &pull,
            &PageCursor {
                timeline: Phase::Start,
                threads: Phase::Done,
            },
        );
        let pushes: Vec<(&str, &str, Vec<&str>)> = result
            .entries
            .iter()
            .map(|entry| match entry {
                ConversationEntry::Event {
                    id,
                    text,
                    category: EventCategory::Push,
                    commits: Some(commits),
                    ..
                } => (
                    id.as_str(),
                    text.as_str(),
                    commits
                        .items
                        .iter()
                        .map(|item| item.title.as_str())
                        .collect(),
                ),
                other => panic!("a push event, got {other:?}"),
            })
            .collect();
        assert_eq!(
            pushes,
            [
                ("c4", "added 1 commit", vec!["Commit c4"]),
                (
                    "FP_1",
                    "force-pushed the head branch from c200000 to fffffff",
                    vec!["Squash"]
                ),
                ("c2", "added 2 commits", vec!["Commit c1", "Commit c2"]),
            ],
            "a force-push ends a push; commits read oldest first"
        );
    }

    #[test]
    fn timeline_events_carry_their_category() {
        let category = |typename: &str| match timeline_entry(
            &json!({"__typename": typename, "id": "E", "actor": null, "createdAt": "2026-10-01T00:00:00Z"}),
            SCOPE,
        ) {
            Some(ConversationEntry::Event { category, .. }) => Some(category),
            _ => None,
        };
        assert_eq!(
            category("HeadRefForcePushedEvent"),
            Some(EventCategory::Push)
        );
        for state in [
            "MergedEvent",
            "ClosedEvent",
            "ReopenedEvent",
            "ReadyForReviewEvent",
            "ConvertToDraftEvent",
        ] {
            assert_eq!(category(state), Some(EventCategory::State), "{state}");
        }
        assert_eq!(category("ReviewRequestedEvent"), Some(EventCategory::Other));
        assert_eq!(category("LabeledEvent"), None);
    }
}
