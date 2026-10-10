//! The Claude thread catalog from the session index: `thread.list` rows
//! projected from indexed native sessions and their `CodeWide` metadata, with
//! the host's listing semantics (`host/src/threads/listing.ts` and
//! `projection.ts`): filters, ordering, windows and the
//! `v1:<sortKey>:<direction>:<valueSec>:<id>` cursor.

use std::collections::{BTreeMap, HashMap};

use agent_core::model::{
    AgentThread, AppThreadId, ERROR_INVALID_PARAMS, NativeSession, NativeSessionCodewide,
    NativeThreadOrigin, NativeThreadPresence, NativeTitleOverride, ProviderId, RpcError,
    SortDirection, SortWindow, ThreadListParams, ThreadListResult, ThreadOrigin, ThreadSettings,
    ThreadSortKey, ThreadStatus,
};

use crate::store::StoredSession;

/// The prompt that opens a replacement session's history prefix; it is not
/// the person's first prompt.
const HISTORY_HEADER: &str = "[Historical conversation from this thread]";
const PREVIEW_MAX_UTF16: usize = 200;
const MAX_PAGE: usize = 500;

/// One indexed thread: its sessions (oldest first) and whether it has a
/// user turn.
pub struct IndexedThread<'a> {
    pub app_thread_id: &'a AppThreadId,
    pub sessions: Vec<&'a StoredSession>,
    pub has_user_turn: bool,
}

/// A listable thread with the facts filtering needs.
pub struct ListRow {
    search_text: String,
    shell: bool,
    pub thread: AgentThread,
}

/// Groups indexed sessions by thread, oldest session first.
#[must_use]
pub fn threads(sessions: &[StoredSession]) -> Vec<IndexedThread<'_>> {
    let mut grouped = BTreeMap::<&AppThreadId, Vec<&StoredSession>>::new();
    for stored in sessions {
        grouped
            .entry(&stored.session.app_thread_id)
            .or_default()
            .push(stored);
    }
    grouped
        .into_iter()
        .map(|(app_thread_id, mut sessions)| {
            sessions.sort_by(|left, right| {
                (session_start(&left.session), &left.session.session_id)
                    .cmp(&(session_start(&right.session), &right.session.session_id))
            });
            let has_user_turn = sessions.iter().any(|stored| stored.has_user_turn);
            IndexedThread {
                app_thread_id,
                sessions,
                has_user_turn,
            }
        })
        .collect()
}

/// The thread's `CodeWide` metadata: every session of a chain carries the
/// same object; the latest one wins.
fn codewide<'a>(thread: &IndexedThread<'a>) -> Option<&'a NativeSessionCodewide> {
    thread
        .sessions
        .iter()
        .rev()
        .find_map(|stored| stored.session.codewide.as_ref())
}

/// Whether the thread was deleted in `CodeWide` (a tombstone).
#[must_use]
pub fn is_deleted(sessions: &[&StoredSession]) -> bool {
    sessions
        .iter()
        .rev()
        .find_map(|stored| stored.session.codewide.as_ref())
        .is_some_and(|codewide| matches!(codewide.presence, NativeThreadPresence::Deleted { .. }))
}

/// The list row of an indexed thread, or `None` when the thread is not
/// listed: deleted, or a session started programmatically outside `CodeWide`.
#[must_use]
pub fn row(
    thread: &IndexedThread<'_>,
    provider: &ProviderId,
    status: ThreadStatus,
) -> Option<ListRow> {
    let codewide = codewide(thread);
    match codewide.map(|codewide| &codewide.presence) {
        Some(NativeThreadPresence::Deleted { .. }) => return None,
        Some(NativeThreadPresence::Listed { .. }) => {}
        None => {
            // A session CodeWide never touched is listed only when a person
            // started it and it is its own thread.
            let listed = thread.sessions.iter().any(|stored| {
                stored.session.interactive
                    && stored.session.session_id == thread.app_thread_id.as_str()
            });
            if !listed {
                return None;
            }
        }
    }
    let first_prompt = thread.sessions.iter().find_map(|stored| {
        stored
            .session
            .first_prompt
            .as_deref()
            .filter(|prompt| !prompt.starts_with(HISTORY_HEADER))
    });
    let name = name(thread, codewide);
    let created_at = codewide.map_or_else(
        || {
            thread
                .sessions
                .first()
                .map_or(0, |first| session_start(&first.session).div_euclid(1000))
        },
        |codewide| codewide.created_at,
    );
    let updated_at = thread
        .sessions
        .iter()
        .map(|stored| stored.session.last_modified_ms.div_euclid(1000))
        .chain([
            created_at,
            codewide.map_or(0, |codewide| codewide.updated_at),
        ])
        .max()
        .unwrap_or(created_at);
    let (archived, origin, recency_at, settings) = codewide.map_or_else(
        || (false, ThreadOrigin::External, None, discovered_settings()),
        |codewide| {
            (
                matches!(
                    codewide.presence,
                    NativeThreadPresence::Listed { archived: true }
                ),
                match codewide.origin {
                    NativeThreadOrigin::Interactive => ThreadOrigin::Interactive,
                    NativeThreadOrigin::External => ThreadOrigin::External,
                },
                codewide.recency_at,
                codewide.settings.clone(),
            )
        },
    );
    let cwd = codewide.map_or_else(
        || {
            thread
                .sessions
                .first()
                .and_then(|first| first.session.cwd.clone())
                .unwrap_or_default()
        },
        |codewide| codewide.cwd.clone(),
    );
    let shell = !thread.has_user_turn && first_prompt.is_none();
    Some(ListRow {
        search_text: name
            .clone()
            .or_else(|| first_prompt.map(ToOwned::to_owned))
            .unwrap_or_default(),
        shell,
        thread: AgentThread {
            app_thread_id: thread.app_thread_id.clone(),
            provider: provider.clone(),
            cwd,
            name,
            preview: first_prompt.map(preview).unwrap_or_default(),
            created_at,
            updated_at,
            recency_at,
            archived,
            origin,
            status,
            settings,
        },
    })
}

/// The latest store title of the chain under the `CodeWide` title override.
fn name(thread: &IndexedThread<'_>, codewide: Option<&NativeSessionCodewide>) -> Option<String> {
    let title = thread
        .sessions
        .iter()
        .rev()
        .find_map(|stored| stored.session.title.clone());
    match codewide.map(|codewide| &codewide.title) {
        Some(NativeTitleOverride::Pending { name }) => Some(name.clone()),
        Some(NativeTitleOverride::Cleared { hidden_title }) => {
            title.filter(|title| title != hidden_title)
        }
        Some(NativeTitleOverride::None) | None => title,
    }
}

/// Settings of a thread `CodeWide` has never configured.
fn discovered_settings() -> ThreadSettings {
    ThreadSettings {
        model: "default".into(),
        effort: None,
        permission_profile: ":read-only".into(),
        service_tier: None,
    }
}

/// The first 200 UTF-16 code units, as the host's preview.
fn preview(prompt: &str) -> String {
    let mut units = 0;
    prompt
        .chars()
        .take_while(|character| {
            units += character.len_utf16();
            units <= PREVIEW_MAX_UTF16
        })
        .collect()
}

fn session_start(session: &NativeSession) -> i64 {
    session.created_at_ms.unwrap_or(session.last_modified_ms)
}

/// One `thread.list` page over `rows`.
///
/// # Errors
/// Returns `-32602 "invalid thread list cursor"` for a cursor of another
/// sort or an unreadable one.
pub fn list(rows: Vec<ListRow>, params: &ThreadListParams) -> Result<ThreadListResult, RpcError> {
    let after = match params.cursor.as_deref() {
        None => None,
        Some(cursor) => Some(
            decode_cursor(cursor)
                .filter(|position| {
                    let (sort_key, direction) = (params.sort_key, params.sort_direction);
                    position.sort_key == sort_key && position.direction == direction
                })
                .ok_or_else(|| RpcError {
                    code: ERROR_INVALID_PARAMS,
                    message: "invalid thread list cursor".into(),
                    data: None,
                })?,
        ),
    };
    let term = params
        .search_term
        .as_deref()
        .map(str::to_lowercase)
        .unwrap_or_default();
    let mut ordered = rows
        .into_iter()
        .filter(|row| {
            row.thread.archived == params.archived
                && (params.archived || !row.shell)
                && params.cwd.as_ref().is_none_or(|cwd| &row.thread.cwd == cwd)
                && (term.is_empty() || row.search_text.to_lowercase().contains(&term))
                && in_window(
                    sort_value(&row.thread, params.sort_key),
                    params.window.as_ref(),
                )
        })
        .map(|row| row.thread)
        .collect::<Vec<_>>();
    ordered.sort_by(|left, right| {
        let order = sort_value(left, params.sort_key)
            .cmp(&sort_value(right, params.sort_key))
            .then_with(|| {
                left.app_thread_id
                    .as_str()
                    .cmp(right.app_thread_id.as_str())
            });
        match params.sort_direction {
            SortDirection::Asc => order,
            SortDirection::Desc => order.reverse(),
        }
    });
    let from = after.map_or(0, |position| {
        let descending = params.sort_direction == SortDirection::Desc;
        ordered
            .iter()
            .position(|thread| {
                let value = sort_value(thread, params.sort_key);
                if value == position.value {
                    let id = thread.app_thread_id.as_str();
                    if descending {
                        id < position.id.as_str()
                    } else {
                        id > position.id.as_str()
                    }
                } else if descending {
                    value < position.value
                } else {
                    value > position.value
                }
            })
            .unwrap_or(ordered.len())
    });
    let limit = usize::try_from(params.limit)
        .unwrap_or(MAX_PAGE)
        .clamp(1, MAX_PAGE);
    let total = ordered.len();
    let page = ordered
        .into_iter()
        .skip(from)
        .take(limit)
        .collect::<Vec<_>>();
    let next_cursor = page.last().filter(|_| from + limit < total).map(|last| {
        format!(
            "v1:{}:{}:{}:{}",
            sort_key_name(params.sort_key),
            direction_name(params.sort_direction),
            sort_value(last, params.sort_key),
            last.app_thread_id.as_str()
        )
    });
    Ok(ThreadListResult {
        threads: page,
        next_cursor,
    })
}

struct CursorPosition {
    sort_key: ThreadSortKey,
    direction: SortDirection,
    value: i64,
    id: String,
}

fn decode_cursor(cursor: &str) -> Option<CursorPosition> {
    let rest = cursor.strip_prefix("v1:")?;
    let (sort_key, rest) = rest.split_once(':')?;
    let (direction, rest) = rest.split_once(':')?;
    let (value, id) = rest.split_once(':')?;
    let sort_key = match sort_key {
        "createdAt" => ThreadSortKey::CreatedAt,
        "updatedAt" => ThreadSortKey::UpdatedAt,
        "recencyAt" => ThreadSortKey::RecencyAt,
        _ => return None,
    };
    let direction = match direction {
        "asc" => SortDirection::Asc,
        "desc" => SortDirection::Desc,
        _ => return None,
    };
    let digits = value.strip_prefix('-').unwrap_or(value);
    if id.is_empty() || digits.is_empty() || !digits.bytes().all(|byte| byte.is_ascii_digit()) {
        return None;
    }
    Some(CursorPosition {
        sort_key,
        direction,
        value: value.parse().ok()?,
        id: id.to_owned(),
    })
}

const fn sort_key_name(key: ThreadSortKey) -> &'static str {
    match key {
        ThreadSortKey::CreatedAt => "createdAt",
        ThreadSortKey::UpdatedAt => "updatedAt",
        ThreadSortKey::RecencyAt => "recencyAt",
    }
}

const fn direction_name(direction: SortDirection) -> &'static str {
    match direction {
        SortDirection::Asc => "asc",
        SortDirection::Desc => "desc",
    }
}

fn sort_value(thread: &AgentThread, key: ThreadSortKey) -> i64 {
    match key {
        ThreadSortKey::CreatedAt => thread.created_at,
        ThreadSortKey::UpdatedAt => thread.updated_at,
        ThreadSortKey::RecencyAt => thread.recency_at.unwrap_or(thread.updated_at),
    }
}

fn in_window(value: i64, window: Option<&SortWindow>) -> bool {
    let Some(window) = window else {
        return true;
    };
    if let Some(lower) = window.lower
        && (if window.lower_inclusive {
            value < lower
        } else {
            value <= lower
        })
    {
        return false;
    }
    if let Some(upper) = window.upper
        && (if window.upper_inclusive {
            value > upper
        } else {
            value >= upper
        })
    {
        return false;
    }
    true
}

/// The rows of every listed indexed thread.
#[must_use]
pub fn rows<S: std::hash::BuildHasher>(
    sessions: &[StoredSession],
    statuses: &HashMap<AppThreadId, ThreadStatus, S>,
    provider: &ProviderId,
) -> Vec<ListRow> {
    threads(sessions)
        .into_iter()
        .filter_map(|thread| {
            let status = statuses
                .get(thread.app_thread_id)
                .copied()
                .unwrap_or(ThreadStatus::NotLoaded);
            row(&thread, provider, status)
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::session_read;

    fn stored(session: &str, thread: &str, size: i64, prompts: &[&str]) -> StoredSession {
        let read = session_read(session, thread, size, prompts);
        StoredSession {
            session: read.session,
            subagents: Vec::new(),
            turn_count: u32::try_from(prompts.len()).unwrap_or(0),
            has_user_turn: !prompts.is_empty(),
        }
    }

    fn codewide(
        presence: NativeThreadPresence,
        title: NativeTitleOverride,
    ) -> NativeSessionCodewide {
        NativeSessionCodewide {
            created_at: 5,
            cwd: "/work/codewide".into(),
            origin: NativeThreadOrigin::Interactive,
            presence,
            recency_at: Some(40),
            settings: ThreadSettings {
                model: "claude-sonnet".into(),
                effort: None,
                permission_profile: ":workspace".into(),
                service_tier: None,
            },
            title,
            updated_at: 30,
        }
    }

    fn params(archived: bool) -> ThreadListParams {
        ThreadListParams {
            archived,
            cwd: None,
            search_term: None,
            sort_key: ThreadSortKey::UpdatedAt,
            sort_direction: SortDirection::Desc,
            window: None,
            cursor: None,
            limit: 50,
        }
    }

    fn ids(result: &ThreadListResult) -> Vec<&str> {
        result
            .threads
            .iter()
            .map(|thread| thread.app_thread_id.as_str())
            .collect()
    }

    #[test]
    fn rows_follow_the_host_listing_rules() -> Result<(), RpcError> {
        let provider = ProviderId::from_static("claude");
        let mut terminal = stored("terminal", "terminal", 20, &["from the terminal"]);
        terminal.session.title = Some("Terminal title".into());
        let mut programmatic = stored("sdk", "sdk", 21, &["sdk prompt"]);
        programmatic.session.interactive = false;
        let mut first = stored("chain-a", "chain", 10, &["first prompt"]);
        let mut second = stored(
            "chain-b",
            "chain",
            30,
            &["[Historical conversation from this thread] …"],
        );
        second.session.title = Some("Generated".into());
        for session in [&mut first, &mut second] {
            session.session.codewide = Some(codewide(
                NativeThreadPresence::Listed { archived: false },
                NativeTitleOverride::Cleared {
                    hidden_title: "Generated".into(),
                },
            ));
        }
        let mut renamed = stored("renamed", "renamed", 15, &["rename me"]);
        renamed.session.codewide = Some(codewide(
            NativeThreadPresence::Listed { archived: true },
            NativeTitleOverride::Pending {
                name: "Picked".into(),
            },
        ));
        let mut deleted = stored("deleted", "deleted", 16, &["gone"]);
        deleted.session.codewide = Some(codewide(
            NativeThreadPresence::Deleted { deleted_at: 50 },
            NativeTitleOverride::None,
        ));
        let mut shell = stored("shell", "shell", 17, &[]);
        shell.session.first_prompt = None;
        shell.session.codewide = Some(codewide(
            NativeThreadPresence::Listed { archived: false },
            NativeTitleOverride::None,
        ));
        let sessions = vec![
            terminal,
            programmatic,
            first,
            second,
            renamed,
            deleted,
            shell,
        ];
        let rows = rows(&sessions, &HashMap::new(), &provider);

        let listed = list(rows, &params(false))?;
        assert_eq!(ids(&listed), ["chain", "terminal"]);
        let chain = &listed.threads[0];
        assert_eq!(chain.name, None, "a cleared title hides the store title");
        assert_eq!(chain.preview, "first prompt");
        assert_eq!((chain.created_at, chain.updated_at), (5, 30));
        assert_eq!(
            chain.cwd, "/work/codewide",
            "the CodeWide thread directory wins over the session directory"
        );
        assert_eq!(chain.origin, ThreadOrigin::Interactive);
        assert_eq!(chain.settings.model, "claude-sonnet");
        let terminal = &listed.threads[1];
        assert_eq!(terminal.name.as_deref(), Some("Terminal title"));
        assert_eq!(terminal.origin, ThreadOrigin::External);
        assert_eq!(terminal.settings.permission_profile, ":read-only");
        assert_eq!(terminal.status, ThreadStatus::NotLoaded);

        let sessions_again = sessions.clone();
        let archived = list(rows_of(&sessions_again, &provider), &params(true))?;
        assert_eq!(ids(&archived), ["renamed"]);
        assert_eq!(archived.threads[0].name.as_deref(), Some("Picked"));

        let mut search = params(false);
        search.search_term = Some("TERMINAL".into());
        assert_eq!(
            ids(&list(rows_of(&sessions_again, &provider), &search)?),
            ["terminal"]
        );
        Ok(())
    }

    fn rows_of(sessions: &[StoredSession], provider: &ProviderId) -> Vec<ListRow> {
        rows(sessions, &HashMap::new(), provider)
    }

    #[test]
    fn pages_continue_strictly_after_the_cursor_and_respect_windows() -> Result<(), RpcError> {
        let provider = ProviderId::from_static("claude");
        let sessions = (0..5)
            .map(|index| {
                let id = format!("thread-{index}");
                stored(&id, &id, 10 + index, &["prompt"])
            })
            .collect::<Vec<_>>();
        let mut first_page = params(false);
        first_page.limit = 2;
        let first = list(rows_of(&sessions, &provider), &first_page)?;
        assert_eq!(ids(&first), ["thread-4", "thread-3"]);
        assert_eq!(
            first.next_cursor.as_deref(),
            Some("v1:updatedAt:desc:13:thread-3")
        );
        let mut next = first_page.clone();
        next.cursor = first.next_cursor.clone();
        let second = list(rows_of(&sessions, &provider), &next)?;
        assert_eq!(ids(&second), ["thread-2", "thread-1"]);

        let mut windowed = params(false);
        windowed.window = Some(SortWindow {
            lower: Some(11),
            lower_inclusive: false,
            upper: Some(13),
            upper_inclusive: true,
        });
        assert_eq!(
            ids(&list(rows_of(&sessions, &provider), &windowed)?),
            ["thread-3", "thread-2"]
        );

        let mut foreign = params(false);
        foreign.cursor = Some("v1:createdAt:desc:13:thread-3".into());
        let error = list(rows_of(&sessions, &provider), &foreign).err();
        assert_eq!(error.map(|error| error.code), Some(ERROR_INVALID_PARAMS));
        Ok(())
    }
}
