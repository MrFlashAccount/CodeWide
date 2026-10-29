//! Sub-agent child threads of indexed Claude sessions.
//!
//! The transcript layer names the read-only thread of a sub-agent's transcript
//! `<app thread id>:agent:<agent id>` on the spawning `subagent` item
//! (`transcript/agents.rs`); this module owns the Rust side of that
//! id format, the facts the index keeps per sub-agent, and the neutral
//! thread and companion thread-index row of a child thread. A child thread is
//! never listed in `thread.list`; it is reached through its parent's
//! `subagent` item and `companion/threadSubagents/read`.

use agent_core::model::{
    AgentItem, AgentThread, AgentTurn, AppThreadId, NativeSessionReadResult, ProviderId,
    SubagentStatus, ThreadOrigin, ThreadSettings, ThreadSpawn, ThreadStatus, TurnStatus,
};
use companion_host::thread_index::IndexedThreadMetadata;
use serde::{Deserialize, Serialize};
use serde_json::json;

const AGENT_THREAD_SEPARATOR: &str = ":agent:";

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
    /// The model its own transcript last answered with; `None` when it
    /// records none.
    #[serde(default)]
    pub model: Option<String>,
    /// The reasoning effort recorded on that same answer; `None` when it
    /// records none.
    #[serde(default)]
    pub effort: Option<String>,
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
                model: subagent.model.clone(),
                effort: subagent.effort.clone(),
            }
        })
        .collect()
}

/// Whether two indexed sub-agent sets of one session list differently: an
/// agent appeared or left, or its running state, nickname, role or parent
/// changed. Activity timestamps alone do not count, so a working agent's
/// growing transcript does not re-announce it. Nor does its model: the
/// thread-index row carries no model, so a client re-reading the tree would
/// see nothing new; `thread.read` of the child reads it from the index.
#[must_use]
pub fn listed_differently(previous: &[IndexedSubagent], next: &[IndexedSubagent]) -> bool {
    fn listed(
        subagent: &IndexedSubagent,
    ) -> (&str, Option<&str>, Option<&str>, Option<&str>, bool) {
        (
            subagent.agent_id.as_str(),
            subagent.parent_agent_id.as_deref(),
            subagent.description.as_deref(),
            subagent.agent_type.as_deref(),
            subagent.running,
        )
    }
    !previous.iter().map(listed).eq(next.iter().map(listed))
}

/// One indexed child thread: where it lives, its turns and the settings of
/// the parent thread it runs under.
pub struct ChildThread {
    pub thread_id: AppThreadId,
    pub parent: AppThreadId,
    pub cwd: String,
    pub subagent: IndexedSubagent,
    pub turns: Vec<AgentTurn>,
    /// The parent thread's settings, as its own thread reports them
    /// (`catalog::thread_settings`).
    pub parent_settings: ThreadSettings,
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
            // The newest conversation message, as every thread's list preview.
            preview: crate::preview::newest_message(&self.turns).unwrap_or_default(),
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
            settings: self.settings(),
            spawn: Some(ThreadSpawn {
                parent_thread_id: self.spawning_thread(),
                agent_nickname: self.subagent.description.clone(),
                agent_role: self.subagent.agent_type.clone(),
            }),
        }
    }

    /// The settings the sub-agent runs with. Its access is the parent's: a
    /// sub-agent runs in its parent's `claude` process under that session's
    /// permission mode, and its transcript records no mode of its own. Its
    /// model is the one its transcript last answered with (an agent
    /// definition may pin another model than the parent's), else the
    /// parent's. Its effort is the one recorded on that answer: Claude Code
    /// resolves it per sub-agent (an explicit `effort` of the spawning
    /// `Agent` call, else the agent definition's, else the session's effort
    /// for the agent's model, which a model without effort support drops and
    /// an experiment may lower), so the parent's effort is never substituted
    /// and an unrecorded one stays unknown. Service tier is not reported: the
    /// adapter supports none.
    fn settings(&self) -> ThreadSettings {
        ThreadSettings {
            model: self
                .subagent
                .model
                .clone()
                .unwrap_or_else(|| self.parent_settings.model.clone()),
            effort: self.subagent.effort.clone(),
            permission_profile: self.parent_settings.permission_profile.clone(),
            service_tier: None,
        }
    }

    /// The thread whose agent started this one: the parent thread, or the
    /// child thread of the sub-agent that spawned it.
    fn spawning_thread(&self) -> AppThreadId {
        self.subagent
            .parent_agent_id
            .as_deref()
            .and_then(|agent_id| child_thread_id(&self.parent, agent_id))
            .unwrap_or_else(|| self.parent.clone())
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
/// (description), role (agent type) and whether it is running, in the shape
/// of a spawned Codex sub-agent so `companion/threadSubagents/read` serves it
/// unchanged. A Claude child has no live thread of its own, so `running` is
/// the only status a client gets for it.
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
        running: Some(subagent.running),
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

    #[test]
    fn sub_agents_list_differently_when_one_appears_or_its_status_changes() {
        let subagent = |agent_id: &str, running: bool, updated_at: i64| IndexedSubagent {
            agent_id: agent_id.into(),
            parent_agent_id: None,
            parent_tool_use_id: Some("toolu_spawn".into()),
            description: Some("Audit".into()),
            agent_type: Some("Explore".into()),
            started_at: Some(10),
            updated_at: Some(updated_at),
            running,
            model: None,
            effort: None,
        };
        let working = [subagent("a1", true, 20)];
        assert!(listed_differently(&[], &working));
        assert!(!listed_differently(&working, &[subagent("a1", true, 30)]));
        assert!(listed_differently(&working, &[subagent("a1", false, 30)]));
        assert!(listed_differently(
            &working,
            &[subagent("a1", true, 20), subagent("a2", true, 20)]
        ));
        assert!(listed_differently(&working, &[]));
    }

    #[test]
    fn sub_agents_do_not_list_differently_when_only_their_model_changes() {
        let subagent = |model: Option<&str>| IndexedSubagent {
            agent_id: "a1".into(),
            parent_agent_id: None,
            parent_tool_use_id: None,
            description: Some("Audit".into()),
            agent_type: Some("Explore".into()),
            started_at: Some(10),
            updated_at: Some(20),
            running: true,
            model: model.map(Into::into),
            effort: None,
        };
        assert!(!listed_differently(
            &[subagent(None)],
            &[subagent(Some("claude-haiku-4-5"))]
        ));
    }

    fn child(model: Option<&str>, parent_settings: ThreadSettings) -> ChildThread {
        child_with_effort(model, None, parent_settings)
    }

    fn child_with_effort(
        model: Option<&str>,
        effort: Option<&str>,
        parent_settings: ThreadSettings,
    ) -> ChildThread {
        let parent = AppThreadId::from_static("5f0c2a1e-3b4d-4e6f-8a9b-0c1d2e3f4a5b");
        ChildThread {
            thread_id: child_thread_id(&parent, "a1").unwrap_or_else(|| parent.clone()),
            parent,
            cwd: "/repo".into(),
            subagent: IndexedSubagent {
                agent_id: "a1".into(),
                parent_agent_id: None,
                parent_tool_use_id: None,
                description: Some("Audit".into()),
                agent_type: Some("Explore".into()),
                started_at: Some(10),
                updated_at: Some(20),
                running: false,
                model: model.map(Into::into),
                effort: effort.map(Into::into),
            },
            turns: Vec::new(),
            parent_settings,
        }
    }

    fn full_access_parent() -> ThreadSettings {
        ThreadSettings {
            model: "claude-opus-4-7".into(),
            effort: Some("high".into()),
            permission_profile: ":full-access".into(),
            service_tier: None,
        }
    }

    #[test]
    fn a_child_runs_with_its_parents_access_and_its_transcripts_model() {
        let provider = ProviderId::from_static("claude");
        let settings = child(Some("claude-haiku-4-5"), full_access_parent())
            .thread(&provider)
            .settings;
        assert_eq!(
            settings,
            ThreadSettings {
                model: "claude-haiku-4-5".into(),
                effort: None,
                permission_profile: ":full-access".into(),
                service_tier: None,
            }
        );
    }

    #[test]
    fn a_child_reports_the_effort_its_transcript_recorded_not_its_parents() {
        let provider = ProviderId::from_static("claude");
        // `full_access_parent` runs at `high`; the sub-agent ran at `low`
        // (an explicit `Agent` effort or its definition's).
        let settings =
            child_with_effort(Some("claude-opus-5-5"), Some("low"), full_access_parent())
                .thread(&provider)
                .settings;
        assert_eq!(settings.effort.as_deref(), Some("low"));
    }

    #[test]
    fn a_child_whose_transcript_records_no_effort_reports_none() {
        let provider = ProviderId::from_static("claude");
        let settings = child_with_effort(
            Some("claude-haiku-4-5-20251001"),
            None,
            full_access_parent(),
        )
        .thread(&provider)
        .settings;
        assert_eq!(settings.model, "claude-haiku-4-5-20251001");
        assert_eq!(settings.effort, None);
    }

    #[test]
    fn a_child_whose_transcript_records_no_model_reports_its_parents() {
        let provider = ProviderId::from_static("claude");
        let settings = child(None, full_access_parent()).thread(&provider).settings;
        assert_eq!(settings.model, "claude-opus-4-7");
        assert_eq!(settings.permission_profile, ":full-access");
    }

    #[test]
    fn a_child_row_says_whether_the_sub_agent_runs() {
        let parent = AppThreadId::from_static("5f0c2a1e-3b4d-4e6f-8a9b-0c1d2e3f4a5b");
        let subagent = |running: bool| IndexedSubagent {
            agent_id: "a1b2c3d4e5f600001".into(),
            parent_agent_id: None,
            parent_tool_use_id: None,
            description: Some("Audit".into()),
            agent_type: Some("Explore".into()),
            started_at: Some(10),
            updated_at: Some(20),
            running,
            model: None,
            effort: None,
        };
        for running in [true, false] {
            let row = thread_metadata(&parent, "/repo", 1, &subagent(running));
            assert_eq!(row.and_then(|row| row.running), Some(running));
        }
    }
}
