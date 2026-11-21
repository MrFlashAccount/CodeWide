//! Push events with their commits. GitHub's timeline has one
//! `PullRequestCommit` item per commit and no push item, so consecutive
//! commits by the same author, with no other timeline item between them, are
//! read as one push: "added 3 commits" listing them oldest first. A
//! force-push names the head before and after and lists the new head commit.
//!
//! Grouping happens within one conversation page; a push that straddles a
//! page boundary shows as two events.

use forge_protocol::{
    Author, ConversationEntry, EventCategory, EventCommit, EventCommits, MAX_COMMIT_SHA_CHARS,
    MAX_COMMIT_TITLE_CHARS, MAX_EVENT_COMMITS, MAX_SHORT_SHA_CHARS, valid_commit_id,
};
use serde_json::Value;

/// One `PullRequestCommit` as a push event of one commit; [`group`] folds
/// neighbouring ones. Its time is the commit's `committedDate`.
pub fn commit_event(node: &Value, author: impl Fn(&Value) -> Author) -> Option<ConversationEntry> {
    let commit = node.get("commit")?;
    let item = event_commit(commit)?;
    Some(ConversationEntry::Event {
        id: node.get("id")?.as_str()?.to_owned(),
        author: commit
            .pointer("/author/user")
            .filter(|user| !user.is_null())
            .map(author),
        created_at: commit.get("committedDate")?.as_str()?.to_owned(),
        category: EventCategory::Push,
        text: added_text(1),
        commits: Some(EventCommits {
            total: 1,
            items: vec![item],
        }),
    })
}

/// A `HeadRefForcePushedEvent`'s text and its new head commit.
pub fn force_push(node: &Value) -> (String, Option<EventCommits>) {
    let short = |field: &str| {
        node.pointer(&format!("/{field}/abbreviatedOid"))
            .and_then(Value::as_str)
            .filter(|short| valid_commit_id(short, MAX_SHORT_SHA_CHARS))
    };
    let text = match (short("beforeCommit"), short("afterCommit")) {
        (Some(before), Some(after)) => {
            format!("force-pushed the head branch from {before} to {after}")
        }
        _ => "force-pushed the head branch".to_owned(),
    };
    let commits = node
        .get("afterCommit")
        .and_then(event_commit)
        .map(|item| EventCommits {
            total: 1,
            items: vec![item],
        });
    (text, commits)
}

/// A GraphQL `Commit` as a listed commit; `None` without a usable `oid`.
fn event_commit(commit: &Value) -> Option<EventCommit> {
    let sha = commit
        .get("oid")?
        .as_str()
        .filter(|sha| valid_commit_id(sha, MAX_COMMIT_SHA_CHARS))?;
    Some(EventCommit {
        sha: sha.to_owned(),
        short_sha: commit
            .get("abbreviatedOid")
            .and_then(Value::as_str)
            .filter(|short| valid_commit_id(short, MAX_SHORT_SHA_CHARS))
            .map(str::to_owned),
        title: commit
            .get("messageHeadline")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .chars()
            .filter(|char| !char.is_control())
            .take(MAX_COMMIT_TITLE_CHARS)
            .collect(),
        author_login: commit
            .pointer("/author/user/login")
            .and_then(Value::as_str)
            .map(str::to_owned),
    })
}

fn added_text(count: u32) -> String {
    if count == 1 {
        "added 1 commit".to_owned()
    } else {
        format!("added {count} commits")
    }
}

/// One timeline entry, newest first, and whether it is a single commit
/// that may join a push.
pub struct TimelineEntry {
    pub commit: bool,
    pub entry: Option<ConversationEntry>,
}

/// Folds runs of commit events by one author into push events. `entries`
/// are newest first; any other item, mapped or skipped, ends a run. A push
/// keeps its newest commit's id, author and time, lists its commits oldest
/// first cut to [`MAX_EVENT_COMMITS`], and counts all of them.
pub fn group(entries: impl IntoIterator<Item = TimelineEntry>) -> Vec<ConversationEntry> {
    // Each push accumulates its commits newest first and is finished below.
    let mut grouped: Vec<(Option<Vec<EventCommit>>, ConversationEntry)> = Vec::new();
    let mut run_open = false;
    for TimelineEntry { commit, entry } in entries {
        let Some(entry) = entry else {
            run_open = false;
            continue;
        };
        if !commit {
            run_open = false;
            grouped.push((None, entry));
            continue;
        }
        let ConversationEntry::Event {
            author,
            commits: Some(commits),
            ..
        } = &entry
        else {
            run_open = false;
            grouped.push((None, entry));
            continue;
        };
        let login = author.as_ref().map(|author| author.login.clone());
        let joined = run_open
            && grouped.last_mut().is_some_and(|(pushed, newest)| {
                let same_author = matches!(newest, ConversationEntry::Event { author, .. }
                    if author.as_ref().map(|author| &author.login) == login.as_ref());
                match pushed {
                    Some(pushed) if same_author => {
                        pushed.extend(commits.items.iter().cloned());
                        true
                    }
                    _ => false,
                }
            });
        if !joined {
            grouped.push((Some(commits.items.clone()), entry));
        }
        run_open = true;
    }
    grouped
        .into_iter()
        .map(|(pushed, entry)| match (pushed, entry) {
            (
                Some(newest_first),
                ConversationEntry::Event {
                    id,
                    author,
                    created_at,
                    category,
                    ..
                },
            ) => {
                let total = u32::try_from(newest_first.len()).unwrap_or(u32::MAX);
                let items: Vec<EventCommit> = newest_first
                    .into_iter()
                    .rev()
                    .take(MAX_EVENT_COMMITS)
                    .collect();
                ConversationEntry::Event {
                    id,
                    author,
                    created_at,
                    category,
                    text: added_text(total),
                    commits: Some(EventCommits { total, items }),
                }
            }
            (_, entry) => entry,
        })
        .collect()
}

#[cfg(test)]
#[allow(clippy::expect_used)]
mod tests {
    use forge_protocol::AuthorKind;
    use serde_json::json;

    use super::*;

    fn author(value: &Value) -> Author {
        Author {
            login: value["login"].as_str().unwrap_or("ghost").to_owned(),
            kind: AuthorKind::User,
            avatar_url: None,
            avatar_direct: false,
        }
    }

    fn commit(id: &str, login: Option<&str>, at: &str) -> TimelineEntry {
        let sha = format!("{id:0<40}");
        TimelineEntry {
            commit: true,
            entry: commit_event(
                &json!({"id": id, "commit": {"oid": sha, "abbreviatedOid": &sha[..7],
                    "messageHeadline": format!("Commit {id}"), "committedDate": at,
                    "author": {"user": login.map(|login| json!({"login": login}))}}}),
                author,
            ),
        }
    }

    fn other(id: &str) -> TimelineEntry {
        TimelineEntry {
            commit: false,
            entry: Some(ConversationEntry::Event {
                id: id.into(),
                author: None,
                created_at: "2026-10-01T00:00:00Z".into(),
                category: EventCategory::State,
                text: "closed this pull request".into(),
                commits: None,
            }),
        }
    }

    fn pushes(entries: &[ConversationEntry]) -> Vec<(String, String, Vec<String>, u32)> {
        entries
            .iter()
            .map(|entry| match entry {
                ConversationEntry::Event {
                    id, text, commits, ..
                } => (
                    id.clone(),
                    text.clone(),
                    commits
                        .iter()
                        .flat_map(|commits| &commits.items)
                        .map(|item| item.title.clone())
                        .collect(),
                    commits.as_ref().map_or(0, |commits| commits.total),
                ),
                _ => panic!("events only"),
            })
            .collect()
    }

    #[test]
    fn consecutive_commits_of_one_author_are_one_push_listed_oldest_first() {
        // Newest first, as a page is read.
        let grouped = group([
            commit("c4", Some("ana"), "2026-10-01T04:00:00Z"),
            commit("c3", Some("ana"), "2026-10-01T03:00:00Z"),
            commit("c2", Some("bo"), "2026-10-01T02:00:00Z"),
            other("closed"),
            commit("c1", Some("bo"), "2026-10-01T01:00:00Z"),
            commit("c0", None, "2026-10-01T00:30:00Z"),
        ]);
        assert_eq!(
            pushes(&grouped),
            [
                (
                    "c4".into(),
                    "added 2 commits".into(),
                    vec!["Commit c3".into(), "Commit c4".into()],
                    2
                ),
                (
                    "c2".into(),
                    "added 1 commit".into(),
                    vec!["Commit c2".into()],
                    1
                ),
                (
                    "closed".into(),
                    "closed this pull request".into(),
                    vec![],
                    0
                ),
                (
                    "c1".into(),
                    "added 1 commit".into(),
                    vec!["Commit c1".into()],
                    1
                ),
                (
                    "c0".into(),
                    "added 1 commit".into(),
                    vec!["Commit c0".into()],
                    1
                ),
            ],
            "another author, another item or an unknown author ends a push"
        );
        let ConversationEntry::Event {
            created_at,
            author,
            commits: Some(commits),
            ..
        } = &grouped[0]
        else {
            panic!("push");
        };
        assert_eq!(
            created_at, "2026-10-01T04:00:00Z",
            "a push is as new as its newest commit"
        );
        assert_eq!(
            author.as_ref().map(|author| author.login.as_str()),
            Some("ana")
        );
        assert_eq!(commits.items[0].short_sha.as_deref(), Some("c300000"));
        assert_eq!(commits.items[0].sha.len(), 40);
        assert!(commits.rules(EventCategory::Push).is_ok());
    }

    #[test]
    fn a_long_push_lists_its_first_commits_and_counts_all() {
        let entries: Vec<TimelineEntry> = (0..25)
            .rev()
            .map(|index| commit(&format!("c{index:02}"), Some("ana"), "2026-10-01T00:00:00Z"))
            .collect();
        let grouped = group(entries);
        let ConversationEntry::Event {
            text,
            commits: Some(commits),
            ..
        } = &grouped[0]
        else {
            panic!("push");
        };
        assert_eq!(text, "added 25 commits");
        assert_eq!(commits.total, 25);
        assert_eq!(commits.items.len(), MAX_EVENT_COMMITS);
        assert_eq!(commits.items[0].title, "Commit c00");
        assert!(commits.rules(EventCategory::Push).is_ok());
    }

    #[test]
    fn a_force_push_names_both_heads_and_lists_the_new_one() {
        let (text, commits) = force_push(&json!({
            "beforeCommit": {"abbreviatedOid": "abc1234"},
            "afterCommit": {"oid": "def5678def5678def5678def5678def5678def5", "abbreviatedOid": "def5678",
                "messageHeadline": "Rebase onto main\u{7}", "author": {"user": {"login": "ana"}}}
        }));
        assert_eq!(text, "force-pushed the head branch from abc1234 to def5678");
        let commits = commits.expect("new head");
        assert_eq!(commits.items[0].title, "Rebase onto main");
        assert_eq!(commits.items[0].author_login.as_deref(), Some("ana"));
        assert_eq!(
            force_push(&json!({"beforeCommit": null, "afterCommit": null})),
            ("force-pushed the head branch".to_owned(), None)
        );
    }
}
