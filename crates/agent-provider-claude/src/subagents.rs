//! Sub-agent child threads of indexed Claude sessions.
//!
//! The Claude host names the read-only thread of a sub-agent's transcript
//! `<app thread id>:agent:<agent id>` on the spawning `subagent` item
//! (`host/src/mapping/subagents.ts`); this module owns the Rust side of that
//! id format, the facts the index keeps per sub-agent, and the neutral
//! thread and companion thread-index row of a child thread. A child thread is
//! never listed in `thread.list`; it is reached through its parent's
//! `subagent` item and `companion/threadSubagents/read`.

use agent_core::model::{
    AgentItem, AgentThread, AgentTurn, AppThreadId, NativeSessionReadResult, ProviderId,
    SubagentStatus, ThreadOrigin, ThreadSettings, ThreadStatus, TurnStatus, UserContent,
};
use companion_host::thread_index::IndexedThreadMetadata;
use serde::{Deserialize, Serialize};
use serde_json::json;

const AGENT_THREAD_SEPARATOR: &str = ":agent:";
const PREVIEW_MAX_CHARS: usize = 200;

/// The child thread of sub-agent `agent_id` under `parent`.
#[must_use]
pub fn child_thread_id(parent: &AppThreadId, agent_id: &str) -> Option<AppThreadId> {
    AppThreadId::parse(&format!("{parent}{AGENT_THREAD_SEPARATOR}{agent_id}"))
}

/// The parent thread and agent id of a child thread id, or `None` for any
/// other thread id.
#[must_use]
pub fn parse_child_thread_id(thread: &AppThreadId) -> Option<(AppThreadId, &str)> {
    let (parent, agent_id) = thread.as_str().rsplit_once(AGENT_THREAD_SEPARATOR)?;
    if agent_id.is_empty() {
        return None;
    }
    Some((AppThreadId::parse(parent)?, agent_id))
}

/// What the index keeps about one sub-agent of a session; its turns are
/// stored separately.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexedSubagent {
    pub agent_id: String,
    /// The sub-agent that spawned this one; `None` for the main conversation.
    pub parent_agent_id: Option<String>,
    pub parent_tool_use_id: Option<String>,
    /// The spawning item's description and agent type, when found.
    pub description: Option<String>,
    pub agent_type: Option<String>,
    /// Start of the first turn and end (else start) of the last one, unix seconds.
    pub started_at: Option<i64>,
    pub updated_at: Option<i64>,
    /// The sub-agent still works: its spawning item says so or its last turn runs.
    pub running: bool,
}

struct Spawn<'a> {
    description: &'a str,
    agent_type: Option<&'a str>,
    status: SubagentStatus,
}

/// The spawning `subagent` item with id `tool_use_id` in any of `turns`.
fn find_spawn<'a>(
    turns: impl Iterator<Item = &'a AgentTurn>,
    tool_use_id: &str,
) -> Option<Spawn<'a>> {
    turns
        .flat_map(|turn| turn.items.iter())
        .find_map(|item| match item {
            AgentItem::Subagent {
                item_id,
                description,
                agent_type,
                status,
                ..
            } if item_id.as_str() == tool_use_id => Some(Spawn {
                description,
                agent_type: agent_type.as_deref(),
                status: *status,
            }),
            _ => None,
        })
}

/// The index facts of every sub-agent of a fresh session read, in the read's order.
#[must_use]
pub fn index(read: &NativeSessionReadResult) -> Vec<IndexedSubagent> {
    read.subagents
        .iter()
        .map(|subagent| {
            let all_turns = || {
                read.turns
                    .iter()
                    .chain(read.subagents.iter().flat_map(|other| other.turns.iter()))
            };
            let spawn = subagent
                .parent_tool_use_id
                .as_deref()
                .and_then(|tool_use_id| find_spawn(all_turns(), tool_use_id));
            let last = subagent.turns.last();
            IndexedSubagent {
                agent_id: subagent.agent_id.clone(),
                parent_agent_id: subagent.parent_agent_id.clone(),
                parent_tool_use_id: subagent.parent_tool_use_id.clone(),
                description: spawn
                    .as_ref()
                    .map(|spawn| spawn.description.to_owned())
                    .filter(|description| !description.is_empty()),
                agent_type: spawn
                    .as_ref()
                    .and_then(|spawn| spawn.agent_type.map(ToOwned::to_owned)),
                started_at: subagent.turns.first().map(|turn| turn.started_at),
                updated_at: last.map(|turn| turn.completed_at.unwrap_or(turn.started_at)),
                running: spawn
                    .as_ref()
                    .is_some_and(|spawn| spawn.status == SubagentStatus::Running)
                    || last.is_some_and(|turn| turn.status == TurnStatus::InProgress),
            }
        })
        .collect()
}

/// The first user text of a transcript, shortened like a list preview.
fn preview(turns: &[AgentTurn]) -> String {
    turns
        .iter()
        .flat_map(|turn| turn.items.iter())
        .find_map(|item| match item {
            AgentItem::UserMessage { content, .. } => {
                content.iter().find_map(|block| match block {
                    UserContent::Text { text } => {
                        Some(text.chars().take(PREVIEW_MAX_CHARS).collect())
                    }
                    UserContent::Image { .. } | UserContent::LocalImage { .. } => None,
                })
            }
            _ => None,
        })
        .unwrap_or_default()
}

/// One indexed child thread: where it lives and its turns.
pub struct ChildThread {
    pub thread_id: AppThreadId,
    pub parent: AppThreadId,
    pub cwd: String,
    pub subagent: IndexedSubagent,
    pub turns: Vec<AgentTurn>,
}

impl ChildThread {
    /// The read-only neutral thread of the sub-agent.
    #[must_use]
    pub fn thread(&self, provider: &ProviderId) -> AgentThread {
        let created_at = self.subagent.started_at.unwrap_or_default();
        AgentThread {
            app_thread_id: self.thread_id.clone(),
            provider: provider.clone(),
            cwd: self.cwd.clone(),
            name: self.subagent.description.clone(),
            preview: preview(&self.turns),
            created_at,
            updated_at: self.subagent.updated_at.unwrap_or(created_at),
            recency_at: None,
            archived: false,
            origin: ThreadOrigin::External,
            status: if self.subagent.running {
                ThreadStatus::Active
            } else {
                ThreadStatus::Idle
            },
            settings: ThreadSettings {
                model: "default".into(),
                effort: None,
                permission_profile: ":read-only".into(),
                service_tier: None,
            },
        }
    }

    /// The turn still running in the transcript, if any.
    #[must_use]
    pub fn active_turn(&self) -> Option<&AgentTurn> {
        self.turns
            .last()
            .filter(|turn| turn.status == TurnStatus::InProgress)
    }
}

/// The companion thread-index row of a child thread: its parent, nickname
/// (description) and role (agent type), in the shape of a spawned Codex
/// sub-agent so `companion/threadSubagents/read` serves it unchanged.
#[must_use]
pub fn thread_metadata(
    parent: &AppThreadId,
    cwd: &str,
    session_created_at: i64,
    subagent: &IndexedSubagent,
) -> Option<IndexedThreadMetadata> {
    let id = child_thread_id(parent, &subagent.agent_id)?;
    let parent_thread_id = match &subagent.parent_agent_id {
        Some(agent_id) => child_thread_id(parent, agent_id)?,
        None => parent.clone(),
    };
    let depth = if subagent.parent_agent_id.is_some() {
        2
    } else {
        1
    };
    let created_at = subagent.started_at.unwrap_or(session_created_at);
    Some(IndexedThreadMetadata {
        id: id.into_string(),
        parent_thread_id: Some(parent_thread_id.as_str().to_owned()),
        cwd: cwd.to_owned(),
        created_at,
        updated_at: subagent.updated_at.unwrap_or(created_at),
        model_provider: "anthropic".into(),
        cli_version: String::new(),
        source: json!({"subagent": {"thread_spawn": {
            "parent_thread_id": parent_thread_id.as_str(),
            "depth": depth,
            "agent_path": null,
            "agent_nickname": subagent.description,
            "agent_role": subagent.agent_type,
        }}}),
        agent_nickname: subagent.description.clone(),
        agent_role: subagent.agent_type.clone(),
        archived: false,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn child_ids_round_trip_and_reject_other_ids() {
        let parent = AppThreadId::from_static("5f0c2a1e-3b4d-4e6f-8a9b-0c1d2e3f4a5b");
        let child = child_thread_id(&parent, "a1b2c3d4e5f600001");
        assert_eq!(
            child.as_ref().map(AppThreadId::as_str),
            Some("5f0c2a1e-3b4d-4e6f-8a9b-0c1d2e3f4a5b:agent:a1b2c3d4e5f600001")
        );
        let parsed = child.as_ref().and_then(parse_child_thread_id);
        assert_eq!(
            parsed.map(|(parent, agent)| (parent.into_string(), agent.to_owned())),
            Some((parent.as_str().to_owned(), "a1b2c3d4e5f600001".to_owned()))
        );
        assert!(parse_child_thread_id(&parent).is_none());
        assert!(parse_child_thread_id(&AppThreadId::from_static("5f0c2a1e:agent:")).is_none());
    }
}
