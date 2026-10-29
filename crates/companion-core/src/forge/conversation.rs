//! `companion/pullRequest/conversation/read`: one page of a pull request's
//! conversation (`forge.pullRequest.conversation@1`), validated before a
//! client sees it and cached with the overview's freshness window. A
//! conversation write, like every pull request write, drops the cache.
//!
//! The same validated pages serve the focused `addressComments` scenario,
//! which looks one review thread up by its id.

use forge_protocol::{
    Author, Comment, CommentMedia, ConversationEntry, ConversationPage, ConversationParams,
    Iteration, ReviewThread, ThreadAnchor, ThreadResolution, methods,
};
use serde::Deserialize;
use serde_json::Value;

use super::{
    ForgeContext,
    accounts::AccountLink,
    declarations::Declaration,
    errors::ForgeError,
    ids::{PullRequestIdentity, PullRequestKey, ReviewThreadId, valid_forge_id},
    limits, params,
    plugin_client::PluginSession,
    wire::https_on_host,
};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ReadRequest {
    pull_request: Value,
    cursor: Option<String>,
}

/// # Errors
///
/// Returns `-32080` without `forge.conversation@1`, invalid params for a
/// malformed cursor, or the mapped plugin failure.
pub async fn read(context: &ForgeContext, raw: &Value) -> Result<Value, ForgeError> {
    let request: ReadRequest = params(raw)?;
    if request
        .cursor
        .as_ref()
        .is_some_and(|cursor| !valid_cursor(cursor))
    {
        return Err(ForgeError::invalid("invalid cursor"));
    }
    let (key, identity) = ForgeContext::pull_request(&request.pull_request)?;
    if let Some(page) = context.cache.conversation(&key, request.cursor.as_deref()) {
        return to_value(&page);
    }
    let account = context.account_for(&key, &identity)?;
    let mut session = context.session(&identity.plugin_id).await?;
    let page = read_page(&mut session, &account, &identity, request.cursor.clone()).await;
    session.shutdown().await;
    let page = page.map_err(|error| context.observe(&account, error))?;
    context.cache.put_conversation(&key, request.cursor, &page);
    to_value(&page)
}

/// One validated page read in an open session.
///
/// # Errors
///
/// Returns `-32080` without `forge.conversation@1` or the mapped plugin
/// failure.
pub async fn read_page(
    session: &mut PluginSession,
    account: &AccountLink,
    identity: &PullRequestIdentity,
    cursor: Option<String>,
) -> Result<ConversationPage, ForgeError> {
    let page: ConversationPage = session
        .call(
            methods::PULL_REQUEST_CONVERSATION,
            &ConversationParams {
                account: account.account_ref(),
                pr_ref: identity.pr_ref.clone(),
                cursor,
            },
        )
        .await
        .map_err(|error| ForgeError::from_plugin(&identity.plugin_id, Some(&account.key), error))?;
    let declaration = Declaration::from_info(session.info());
    validate(
        page,
        PageOrigin {
            host: &identity.pr_ref.host,
            media_hosts: &declaration.media_hosts,
        },
    )
}

/// What a plugin page is checked against: the pull request's host for
/// permalinks, and the provider's declared media hosts for direct media.
#[derive(Clone, Copy, Debug)]
pub struct PageOrigin<'a> {
    pub host: &'a str,
    /// Sanitized lowercase hosts from the provider's `initialize`.
    pub media_hosts: &'a [String],
}

/// Pages through the conversation, at most
/// [`limits::MAX_THREAD_LOOKUP_PAGES`] pages, until the review thread is
/// found; always a fresh read, never the cache.
///
/// # Errors
///
/// Returns `-32080` without `forge.conversation@1`, not found for an
/// unknown thread, or the mapped plugin failure.
pub async fn find_thread(
    context: &ForgeContext,
    key: &PullRequestKey,
    identity: &PullRequestIdentity,
    thread_id: &ReviewThreadId,
) -> Result<ReviewThread, ForgeError> {
    let account = context.account_for(key, identity)?;
    let mut session = context.session(&identity.plugin_id).await?;
    let found = find_in_session(&mut session, &account, identity, thread_id).await;
    session.shutdown().await;
    found.map_err(|error| context.observe(&account, error))
}

async fn find_in_session(
    session: &mut PluginSession,
    account: &AccountLink,
    identity: &PullRequestIdentity,
    thread_id: &ReviewThreadId,
) -> Result<ReviewThread, ForgeError> {
    let mut cursor = None;
    for _ in 0..limits::MAX_THREAD_LOOKUP_PAGES {
        let page = read_page(session, account, identity, cursor).await?;
        if let Some(thread) = page.entries.into_iter().find_map(|entry| match entry {
            ConversationEntry::ReviewThread { thread } if thread.id == thread_id.as_str() => {
                Some(thread)
            }
            _ => None,
        }) {
            return Ok(thread);
        }
        let Some(next) = page.next_cursor else {
            break;
        };
        cursor = Some(next);
    }
    Err(ForgeError::NotFound)
}

/// Where a thread is anchored, as the focused scenario context names it:
/// `path:start-end`, `path:line`, the bare path, or `pull request`; and the
/// diff side of a line anchor (`none` otherwise).
#[must_use]
pub fn thread_location(thread: &ReviewThread) -> (String, &'static str) {
    match &thread.anchor {
        ThreadAnchor::PullRequest => ("pull request".to_owned(), "none"),
        ThreadAnchor::File { path } => (path.clone(), "none"),
        ThreadAnchor::Line {
            path,
            line,
            start_line,
            side,
        } => (
            start_line.map_or_else(
                || format!("{path}:{line}"),
                |start| format!("{path}:{start}-{line}"),
            ),
            match side {
                forge_protocol::DiffSide::New => "new",
                forge_protocol::DiffSide::Old => "old",
            },
        ),
    }
}

/// A thread's state as the focused scenario context names it, for example
/// `open`, `resolved, outdated` or `open issue`.
#[must_use]
pub fn thread_state(thread: &ReviewThread) -> String {
    let state = match &thread.resolution {
        ThreadResolution::None | ThreadResolution::Conversation { resolved: false } => "open",
        ThreadResolution::Conversation { resolved: true } => "resolved",
        ThreadResolution::Issue { state, .. } => match state {
            forge_protocol::IssueState::Open => "open issue",
            forge_protocol::IssueState::Resolved => "resolved issue",
            forge_protocol::IssueState::Dropped => "dropped issue",
        },
    };
    if thread.outdated {
        format!("{state}, outdated")
    } else {
        state.to_owned()
    }
}

fn valid_cursor(cursor: &str) -> bool {
    !cursor.is_empty()
        && cursor.len() <= limits::MAX_CONVERSATION_CURSOR_BYTES
        && !cursor.chars().any(char::is_control)
}

/// The validating adapter of a plugin page: an oversized page or cursor is
/// refused; entries without a valid id, threads without comments and
/// threads with an impossible anchor are dropped; an invalid `reviewId`,
/// iteration or issue `changedAt` becomes `null`; a permalink that is not `https` on the pull request's host and
/// an avatar that is not `https` become `null`; direct media and direct
/// avatars survive only as `https` URLs on a declared media host.
///
/// # Errors
///
/// Returns an internal error for an oversized page or cursor.
pub fn validate(
    page: ConversationPage,
    origin: PageOrigin<'_>,
) -> Result<ConversationPage, ForgeError> {
    if page.entries.len() > limits::MAX_CONVERSATION_ENTRIES
        || page
            .next_cursor
            .as_ref()
            .is_some_and(|cursor| !valid_cursor(cursor))
    {
        return Err(ForgeError::internal(
            "the plugin returned an invalid conversation page",
        ));
    }
    let entries = page
        .entries
        .into_iter()
        .filter_map(|entry| entry_of(entry, origin))
        .collect();
    Ok(ConversationPage {
        entries,
        next_cursor: page.next_cursor,
        open_issues_block_merge: page.open_issues_block_merge,
    })
}

fn entry_of(entry: ConversationEntry, origin: PageOrigin<'_>) -> Option<ConversationEntry> {
    match entry {
        ConversationEntry::Comment { comment } => Some(ConversationEntry::Comment {
            comment: comment_of(comment, origin)?,
        }),
        ConversationEntry::Review {
            id,
            author,
            created_at,
            verdict,
            body,
        } => valid_forge_id(&id).then(|| ConversationEntry::Review {
            id,
            author: author_of(author, origin),
            created_at,
            verdict,
            body: body.and_then(|body| comment_of(body, origin)),
        }),
        ConversationEntry::ReviewThread { thread } => {
            thread_of(thread, origin).map(|thread| ConversationEntry::ReviewThread { thread })
        }
        ConversationEntry::Event {
            id,
            author,
            created_at,
            category,
            text,
        } => valid_forge_id(&id).then(|| ConversationEntry::Event {
            id,
            author: author.map(|author| author_of(author, origin)),
            created_at,
            category,
            text: text.chars().take(limits::MAX_EVENT_TEXT_CHARS).collect(),
        }),
    }
}

/// A review thread as a client may render it, rebuilt field by field.
fn thread_of(thread: ReviewThread, origin: PageOrigin<'_>) -> Option<ReviewThread> {
    let comments: Vec<Comment> = thread
        .comments
        .into_iter()
        .filter_map(|comment| comment_of(comment, origin))
        .collect();
    if !valid_forge_id(&thread.id) || comments.is_empty() || !valid_anchor(&thread.anchor) {
        return None;
    }
    Some(ReviewThread {
        id: thread.id,
        anchor: thread.anchor,
        outdated: thread.outdated,
        resolution: resolution_of(thread.resolution, origin),
        review_id: thread.review_id.filter(|id| valid_forge_id(id)),
        iteration: thread.iteration.filter(valid_iteration),
        comments,
        viewer_can_reply: thread.viewer_can_reply,
    })
}

/// A bounded non-empty path; positive lines with `startLine` strictly
/// before `line`.
fn valid_anchor(anchor: &ThreadAnchor) -> bool {
    let valid_path = |path: &str| {
        !path.is_empty()
            && path.len() <= limits::MAX_THREAD_PATH_BYTES
            && !path.chars().any(char::is_control)
    };
    match anchor {
        ThreadAnchor::PullRequest => true,
        ThreadAnchor::File { path } => valid_path(path),
        ThreadAnchor::Line {
            path,
            line,
            start_line,
            ..
        } => {
            valid_path(path)
                && *line > 0
                && start_line.is_none_or(|start| start > 0 && start < *line)
        }
    }
}

fn valid_iteration(iteration: &Iteration) -> bool {
    iteration.number > 0 && valid_forge_id(&iteration.id)
}

fn resolution_of(resolution: ThreadResolution, origin: PageOrigin<'_>) -> ThreadResolution {
    match resolution {
        ThreadResolution::Issue {
            state,
            changed_by,
            changed_at,
        } => ThreadResolution::Issue {
            state,
            changed_by: changed_by.map(|author| author_of(author, origin)),
            changed_at: changed_at.filter(|at| rfc3339(at)),
        },
        other @ (ThreadResolution::None | ThreadResolution::Conversation { .. }) => other,
    }
}

/// A comment as a client may render it; the shape is the external DTO's,
/// re-checked field by field.
#[must_use]
pub fn comment_of(comment: Comment, origin: PageOrigin<'_>) -> Option<Comment> {
    if !valid_forge_id(&comment.id) {
        return None;
    }
    Some(Comment {
        author: author_of(comment.author, origin),
        url: comment.url.filter(|url| https_on_host(url, origin.host)),
        media: media_of(comment.media, origin.media_hosts),
        reactions: comment
            .reactions
            .into_iter()
            .filter(|reaction| reaction.count > 0)
            .collect(),
        ..comment
    })
}

fn author_of(author: Author, origin: PageOrigin<'_>) -> Author {
    let avatar_url = author.avatar_url.filter(|url| https_url(url));
    Author {
        avatar_direct: author.avatar_direct
            && avatar_url
                .as_deref()
                .is_some_and(|url| on_media_host(url, origin.media_hosts)),
        avatar_url,
        ..author
    }
}

/// Direct media a client may fetch without credentials: each `url` is
/// `https` on a host the provider declared, without user info; `source` is a
/// bounded single-line string, kept once; `expiresAt` is RFC 3339 or absent.
/// Anything else is dropped, so that image keeps the `forge.media.read` path.
fn media_of(media: Vec<CommentMedia>, media_hosts: &[String]) -> Vec<CommentMedia> {
    let mut kept: Vec<CommentMedia> = Vec::new();
    for entry in media {
        if kept.len() == limits::MAX_COMMENT_MEDIA {
            break;
        }
        let valid = bounded_url_text(&entry.source)
            && bounded_url_text(&entry.url)
            && on_media_host(&entry.url, media_hosts)
            && entry.expires_at.as_deref().is_none_or(rfc3339)
            && !kept.iter().any(|known| known.source == entry.source);
        if valid {
            kept.push(entry);
        }
    }
    kept
}

fn bounded_url_text(text: &str) -> bool {
    !text.is_empty()
        && text.len() <= limits::MAX_COMMENT_MEDIA_URL_BYTES
        && !text.chars().any(char::is_control)
}

fn rfc3339(text: &str) -> bool {
    time::OffsetDateTime::parse(text, &time::format_description::well_known::Rfc3339).is_ok()
}

/// `https` on exactly one of the declared media hosts, on the default port.
fn on_media_host(candidate: &str, media_hosts: &[String]) -> bool {
    url::Url::parse(candidate).is_ok_and(|url| {
        url.scheme() == "https"
            && url.port().is_none()
            && url.username().is_empty()
            && url.password().is_none()
            && url
                .host_str()
                .is_some_and(|host| media_hosts.iter().any(|declared| declared == host))
    })
}

fn https_url(candidate: &str) -> bool {
    url::Url::parse(candidate).is_ok_and(|url| {
        url.scheme() == "https"
            && url.host_str().is_some()
            && url.username().is_empty()
            && url.password().is_none()
    })
}

fn to_value<T: serde::Serialize>(value: &T) -> Result<Value, ForgeError> {
    serde_json::to_value(value).map_err(|error| ForgeError::internal(error.to_string()))
}

#[cfg(test)]
#[allow(clippy::expect_used)]
mod tests {
    use serde_json::json;

    use super::*;

    const MEDIA_HOSTS: &[String] = &[];
    const ORIGIN: PageOrigin<'static> = PageOrigin {
        host: "forge.test",
        media_hosts: MEDIA_HOSTS,
    };

    #[test]
    fn the_adapter_drops_invalid_entries_and_foreign_links() {
        let page: ConversationPage = serde_json::from_value(json!({
            "entries": [
                {"kind": "comment", "comment": {"id": "c1", "author": {"login": "a", "kind": "user", "avatarUrl": "javascript:alert(1)"},
                 "createdAt": "2026-10-01T00:00:00Z", "updatedAt": null, "body": "x",
                 "url": "https://evil.example/c1", "reactions": [{"content": "eyes", "count": 0, "viewerReacted": false}]}},
                {"kind": "reviewThread", "thread": {"id": "t1",
                 "anchor": {"kind": "line", "path": "a.rs", "line": 1, "startLine": null, "side": "new"},
                 "resolution": {"kind": "none"}, "reviewId": null, "iteration": null,
                 "outdated": false, "viewerCanReply": true,
                 "comments": [{"id": "", "author": {"login": "a", "kind": "user", "avatarUrl": null}, "createdAt": "x",
                               "updatedAt": null, "body": "y", "url": null, "reactions": []}]}},
                {"kind": "event", "id": "e1", "author": null, "createdAt": "2026-10-01T00:00:00Z", "category": "state", "text": "closed"}
            ],
            "nextCursor": null
        }))
        .expect("page");
        let page = validate(page, ORIGIN).expect("valid");
        assert_eq!(
            page.entries.len(),
            2,
            "a thread without valid comments is dropped"
        );
        let ConversationEntry::Comment { comment } = &page.entries[0] else {
            panic!("comment");
        };
        assert_eq!(comment.url, None);
        assert_eq!(comment.author.avatar_url, None);
        assert!(comment.reactions.is_empty());
        let oversized = ConversationPage {
            entries: Vec::new(),
            next_cursor: Some("x".repeat(limits::MAX_CONVERSATION_CURSOR_BYTES + 1)),
            open_issues_block_merge: None,
        };
        assert!(validate(oversized, ORIGIN).is_err());
    }

    #[test]
    fn direct_media_keeps_only_declared_https_hosts() {
        let page: ConversationPage = serde_json::from_value(json!({
            "entries": [
                {"kind": "comment", "comment": {"id": "c1",
                 "author": {"login": "a", "kind": "user", "avatarUrl": "https://media.forge.test/u/1", "avatarDirect": true},
                 "createdAt": "2026-10-01T00:00:00Z", "updatedAt": null, "body": "images",
                 "url": null, "reactions": [],
                 "media": [
                    {"source": "https://forge.test/a/1", "url": "https://media.forge.test/1?sig=x", "expiresAt": "2026-10-01T00:05:00Z"},
                    {"source": "https://forge.test/a/2", "url": "https://evil.example/2", "expiresAt": null},
                    {"source": "https://forge.test/a/3", "url": "http://media.forge.test/3", "expiresAt": null},
                    {"source": "https://forge.test/a/4", "url": "https://user:pw@media.forge.test/4", "expiresAt": null},
                    {"source": "https://forge.test/a/5", "url": "https://media.forge.test:8443/5", "expiresAt": null},
                    {"source": "https://forge.test/a/6", "url": "https://media.forge.test/6", "expiresAt": "tomorrow"},
                    {"source": "https://forge.test/a/1", "url": "https://media.forge.test/dup", "expiresAt": null},
                    {"source": "https://forge.test/a/7", "url": "https://MEDIA.forge.test/7", "expiresAt": null}
                 ]}},
                {"kind": "event", "id": "e1",
                 "author": {"login": "b", "kind": "user", "avatarUrl": "https://evil.example/u/2", "avatarDirect": true},
                 "createdAt": "2026-10-01T00:00:00Z", "category": "state", "text": "closed"}
            ],
            "nextCursor": null
        }))
        .expect("page");
        let media_hosts = ["media.forge.test".to_owned()];
        let page = validate(
            page,
            PageOrigin {
                host: "forge.test",
                media_hosts: &media_hosts,
            },
        )
        .expect("valid");
        let ConversationEntry::Comment { comment } = &page.entries[0] else {
            panic!("comment");
        };
        let kept: Vec<(&str, &str)> = comment
            .media
            .iter()
            .map(|media| (media.source.as_str(), media.url.as_str()))
            .collect();
        assert_eq!(
            kept,
            [
                ("https://forge.test/a/1", "https://media.forge.test/1?sig=x"),
                ("https://forge.test/a/7", "https://MEDIA.forge.test/7"),
            ],
            "foreign, plain-http, credentialed, non-default-port, badly dated and repeated entries are dropped"
        );
        assert!(comment.author.avatar_direct);
        let ConversationEntry::Event {
            author: Some(author),
            ..
        } = &page.entries[1]
        else {
            panic!("event");
        };
        assert!(
            !author.avatar_direct,
            "an avatar off the media hosts keeps the plugin path"
        );
        assert_eq!(
            author.avatar_url.as_deref(),
            Some("https://evil.example/u/2")
        );
    }

    #[test]
    fn without_declared_media_hosts_nothing_is_direct() {
        let comment: Comment = serde_json::from_value(json!({"id": "c1",
            "author": {"login": "a", "kind": "user", "avatarUrl": "https://media.forge.test/u/1", "avatarDirect": true},
            "createdAt": "2026-10-01T00:00:00Z", "updatedAt": null, "body": "x", "url": null,
            "media": [{"source": "https://forge.test/a/1", "url": "https://media.forge.test/1", "expiresAt": null}]}))
        .expect("comment");
        let comment = comment_of(
            comment,
            PageOrigin {
                host: "forge.test",
                media_hosts: &[],
            },
        )
        .expect("valid");
        assert!(comment.media.is_empty() && !comment.author.avatar_direct);
    }

    fn thread_entry(
        anchor: &Value,
        resolution: &Value,
        review_id: &Value,
        iteration: &Value,
    ) -> Value {
        json!({"kind": "reviewThread", "thread": {"id": "t", "anchor": anchor, "outdated": true,
            "resolution": resolution, "reviewId": review_id, "iteration": iteration,
            "viewerCanReply": false,
            "comments": [{"id": "c", "author": {"login": "a", "kind": "ai", "avatarUrl": null},
                          "createdAt": "2026-10-01T00:00:00Z", "updatedAt": null, "body": "x",
                          "url": null, "reactions": []}]}})
    }

    fn validated_threads(entries: &[Value], blocks: &Value) -> (Vec<ReviewThread>, Option<bool>) {
        let page: ConversationPage = serde_json::from_value(
            json!({"entries": entries, "nextCursor": null, "openIssuesBlockMerge": blocks}),
        )
        .expect("page");
        let page = validate(page, ORIGIN).expect("valid");
        let threads = page
            .entries
            .into_iter()
            .filter_map(|entry| match entry {
                ConversationEntry::ReviewThread { thread } => Some(thread),
                _ => None,
            })
            .collect();
        (threads, page.open_issues_block_merge)
    }

    #[test]
    fn the_adapter_keeps_valid_anchors_and_issues_and_drops_impossible_ones() {
        let line = |line: u32, start: Value| json!({"kind": "line", "path": "a.rs", "line": line, "startLine": start, "side": "old"});
        let none = json!({"kind": "none"});
        let issue = json!({"kind": "issue", "state": "dropped",
            "changedBy": {"login": "b", "kind": "bot", "avatarUrl": "javascript:x"},
            "changedAt": "yesterday"});
        let (kept, blocks) = validated_threads(
            &[
                thread_entry(
                    &json!({"kind": "pullRequest"}),
                    &issue,
                    &json!("review-1"),
                    &json!({"id": "it-2", "number": 2}),
                ),
                thread_entry(
                    &json!({"kind": "file", "path": "a.rs"}),
                    &none,
                    &json!(""),
                    &json!({"id": "it-0", "number": 0}),
                ),
                thread_entry(
                    &line(4, json!(2)),
                    &json!({"kind": "conversation", "resolved": true}),
                    &Value::Null,
                    &Value::Null,
                ),
                thread_entry(
                    &json!({"kind": "file", "path": ""}),
                    &none,
                    &Value::Null,
                    &Value::Null,
                ),
                thread_entry(&line(0, Value::Null), &none, &Value::Null, &Value::Null),
                thread_entry(&line(4, json!(4)), &none, &Value::Null, &Value::Null),
            ],
            &json!(true),
        );
        assert_eq!(
            blocks,
            Some(true),
            "the page-level merge rule passes through"
        );
        assert_eq!(
            kept.len(),
            3,
            "an empty path, line 0 and a reversed range are dropped"
        );
        assert_eq!(kept[0].anchor, ThreadAnchor::PullRequest);
        assert_eq!(kept[0].review_id.as_deref(), Some("review-1"));
        assert_eq!(kept[0].iteration.as_ref().map(|it| it.number), Some(2));
        assert_eq!(
            kept[0].comments[0].author.kind,
            forge_protocol::AuthorKind::Ai
        );
        let ThreadResolution::Issue {
            state,
            changed_by: Some(closer),
            changed_at,
        } = &kept[0].resolution
        else {
            panic!("issue resolution");
        };
        assert_eq!(*state, forge_protocol::IssueState::Dropped);
        assert_eq!(
            (closer.avatar_url.as_deref(), closer.kind),
            (None, forge_protocol::AuthorKind::Bot)
        );
        assert_eq!(changed_at, &None, "an unreadable change time is dropped");
        assert_eq!(kept[1].review_id, None, "an invalid review id becomes null");
        assert_eq!(kept[1].iteration, None, "iteration 0 is impossible");
        assert!(kept[1].outdated);
        assert_eq!(
            kept[2].resolution,
            ThreadResolution::Conversation { resolved: true }
        );
    }

    #[test]
    fn a_focused_context_names_every_anchor_and_resolution() {
        let thread = |anchor: Value, resolution: Value, outdated: bool| -> ReviewThread {
            let Value::Object(mut entry) =
                thread_entry(&anchor, &resolution, &Value::Null, &Value::Null)["thread"].clone()
            else {
                panic!("thread object");
            };
            entry.insert("outdated".into(), Value::Bool(outdated));
            serde_json::from_value(Value::Object(entry)).expect("thread")
        };
        let none = json!({"kind": "none"});
        let pull = thread(json!({"kind": "pullRequest"}), none.clone(), false);
        assert_eq!(thread_location(&pull), ("pull request".to_owned(), "none"));
        assert_eq!(thread_state(&pull), "open");
        let file = thread(
            json!({"kind": "file", "path": "a.rs"}),
            json!({"kind": "conversation", "resolved": true}),
            true,
        );
        assert_eq!(thread_location(&file), ("a.rs".to_owned(), "none"));
        assert_eq!(thread_state(&file), "resolved, outdated");
        let line = thread(
            json!({"kind": "line", "path": "a.rs", "line": 9, "startLine": null, "side": "old"}),
            json!({"kind": "issue", "state": "open", "changedBy": null, "changedAt": null}),
            false,
        );
        assert_eq!(thread_location(&line), ("a.rs:9".to_owned(), "old"));
        assert_eq!(thread_state(&line), "open issue");
    }
}
