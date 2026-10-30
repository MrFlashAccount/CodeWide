//! `forge.pullRequest.activity`: the conversation's comments, reviews and
//! review comments as a flat list, newest first, paged with the
//! conversation's own cursor.
//!
//! The activity is a projection of [`crate::conversation`], so both lists
//! share one global order and one resume point. Events are not activity.
//! A review comment stays on the page of its thread, which is placed by
//! the thread's first comment; within a page items are newest first.

use forge_protocol::{
    ActivityItem, ActivityKind, ActivityPage, Comment, ConversationEntry, ConversationPage,
    PluginError, ReviewThread, ReviewVerdict, ThreadAnchor,
};

use crate::{api::Api, conversation::conversation, repo::PullTarget};

/// # Errors
///
/// Returns invalid params for a malformed cursor or the mapped GitHub
/// failure.
pub async fn activity(
    api: &Api,
    target: &PullTarget,
    cursor: Option<&str>,
) -> Result<ActivityPage, PluginError> {
    Ok(activity_page(conversation(api, target, cursor).await?))
}

fn activity_page(page: ConversationPage) -> ActivityPage {
    let mut items: Vec<ActivityItem> = page.entries.into_iter().flat_map(items_of).collect();
    items.sort_by(|left, right| right.created_at.cmp(&left.created_at));
    ActivityPage {
        items,
        next_cursor: page.next_cursor,
    }
}

fn items_of(entry: ConversationEntry) -> Vec<ActivityItem> {
    match entry {
        ConversationEntry::Comment { comment } => vec![comment_item(comment, None)],
        ConversationEntry::Review {
            id,
            author,
            created_at,
            verdict,
            body,
        } => vec![ActivityItem {
            id,
            kind: ActivityKind::Review,
            author: author.login,
            created_at,
            body: body.map(|body| body.body).unwrap_or_default(),
            path: None,
            line: None,
            review_thread_id: None,
            verdict_label: Some(verdict_label(verdict).to_owned()),
        }],
        ConversationEntry::ReviewThread { thread } => thread_items(thread),
        ConversationEntry::Event { .. } => Vec::new(),
    }
}

fn thread_items(thread: ReviewThread) -> Vec<ActivityItem> {
    let (path, line) = match thread.anchor {
        ThreadAnchor::PullRequest => (None, None),
        ThreadAnchor::File { path } => (Some(path), None),
        ThreadAnchor::Line { path, line, .. } => (Some(path), Some(line)),
    };
    let location = ThreadLocation {
        thread_id: thread.id,
        path,
        line,
    };
    thread
        .comments
        .into_iter()
        .map(|comment| comment_item(comment, Some(&location)))
        .collect()
}

/// Where a review comment sits: its thread and that thread's anchor.
struct ThreadLocation {
    thread_id: String,
    path: Option<String>,
    line: Option<u32>,
}

fn comment_item(comment: Comment, location: Option<&ThreadLocation>) -> ActivityItem {
    ActivityItem {
        id: comment.id,
        kind: ActivityKind::Comment,
        author: comment.author.login,
        created_at: comment.created_at,
        body: comment.body,
        path: location.and_then(|location| location.path.clone()),
        line: location.and_then(|location| location.line),
        review_thread_id: location.map(|location| location.thread_id.clone()),
        verdict_label: None,
    }
}

const fn verdict_label(verdict: ReviewVerdict) -> &'static str {
    match verdict {
        ReviewVerdict::Approved => "Approved",
        ReviewVerdict::ChangesRequested => "Changes requested",
        ReviewVerdict::Commented => "Commented",
        ReviewVerdict::Dismissed => "Dismissed",
        ReviewVerdict::MergeBlocked => "Blocked merge",
        ReviewVerdict::MergeUnblocked => "Unblocked merge",
        ReviewVerdict::ApprovalWithdrawn => "Withdrew approval",
    }
}

#[cfg(test)]
mod tests {
    use forge_protocol::{Author, AuthorKind, DiffSide, ThreadResolution};

    use super::*;

    fn comment(id: &str, at: &str) -> Comment {
        Comment {
            id: id.into(),
            author: Author {
                login: "octocat".into(),
                kind: AuthorKind::User,
                avatar_url: None,
                avatar_direct: false,
            },
            created_at: at.into(),
            updated_at: None,
            body: format!("body of {id}"),
            url: None,
            reactions: Vec::new(),
            media: Vec::new(),
        }
    }

    #[test]
    fn flattens_a_conversation_page_newest_first_and_keeps_its_cursor() {
        let page = ConversationPage {
            entries: vec![
                ConversationEntry::Event {
                    id: "E_1".into(),
                    author: None,
                    created_at: "2026-10-01T05:00:00Z".into(),
                    category: forge_protocol::EventCategory::Push,
                    text: "force-pushed the head branch".into(),
                },
                ConversationEntry::Review {
                    id: "PRR_1".into(),
                    author: comment("x", "2026-10-01T02:00:00Z").author,
                    created_at: "2026-10-01T02:00:00Z".into(),
                    verdict: ReviewVerdict::ChangesRequested,
                    body: None,
                },
                ConversationEntry::ReviewThread {
                    thread: ReviewThread {
                        id: "PRRT_1".into(),
                        anchor: ThreadAnchor::Line {
                            path: "src/a.rs".into(),
                            line: 7,
                            start_line: None,
                            side: DiffSide::New,
                        },
                        outdated: false,
                        resolution: ThreadResolution::Conversation { resolved: false },
                        review_id: Some("PRR_1".into()),
                        iteration: None,
                        comments: vec![
                            comment("PRRC_1", "2026-10-01T01:00:00Z"),
                            comment("PRRC_2", "2026-10-01T03:00:00Z"),
                        ],
                        viewer_can_reply: true,
                    },
                },
                ConversationEntry::Comment {
                    comment: comment("IC_1", "2026-10-01T00:00:00Z"),
                },
            ],
            next_cursor: Some("older".into()),
            open_issues_block_merge: None,
        };
        let activity = activity_page(page);
        assert_eq!(
            activity
                .items
                .iter()
                .map(|item| item.id.as_str())
                .collect::<Vec<_>>(),
            ["PRRC_2", "PRR_1", "PRRC_1", "IC_1"],
            "events are not activity; items are newest first"
        );
        assert_eq!(activity.next_cursor.as_deref(), Some("older"));
        let reply = &activity.items[0];
        assert_eq!(reply.review_thread_id.as_deref(), Some("PRRT_1"));
        assert_eq!(
            (reply.path.as_deref(), reply.line),
            (Some("src/a.rs"), Some(7))
        );
        assert_eq!(
            activity.items[1].verdict_label.as_deref(),
            Some("Changes requested")
        );
        assert_eq!(activity.items[3].review_thread_id, None);
    }
}
