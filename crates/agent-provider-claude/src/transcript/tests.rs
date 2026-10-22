//! History contracts over real-shaped stored sessions
//! (`fixtures/sessions`: SDK-shaped `getSessionMessages` output of local
//! probe sessions with paths and signatures removed, the same fixtures the
//! TypeScript host was checked against): derived turn boundaries, outcomes,
//! item mapping, and what the companion's turn index adds (turn ids, steers,
//! `clientMessageId` echoes, failed outcomes).

use std::path::Path;

use agent_core::model::{
    AgentItem, AgentTurn, AppThreadId, CallStatus, ExecutionStatus, MessagePhase, SubagentStatus,
    TokenUsage, TurnErrorKind, TurnOrigin, TurnStatus, TurnUsageRecord, UserContent,
};
use serde_json::{Value, json};

use super::{
    frames::{ClaudeFrame, classify_frame},
    reconstruct::{self, HistoryContext},
    turn_index::{PromptRecord, PromptRole, TurnOutcomeRecord, TurnRecord},
};

/// The stored messages of a fixture, as the reconstruction reads them.
pub(super) fn records(messages: &[Value]) -> Vec<&super::json::JsonRecord> {
    messages.iter().filter_map(Value::as_object).collect()
}

pub(super) fn reconstruct_turns(
    messages: &[Value],
    index: &[TurnRecord],
    context: &HistoryContext,
) -> Vec<AgentTurn> {
    reconstruct::reconstruct_turns(&records(messages), index, context)
}

fn reconstruct_subagent_turns(
    messages: &[Value],
    context: &HistoryContext,
    running: bool,
) -> Vec<AgentTurn> {
    reconstruct::reconstruct_subagent_turns(&records(messages), context, running)
}

fn fixture(name: &str) -> Result<Value, Box<dyn std::error::Error>> {
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("fixtures/sessions")
        .join(format!("{name}.json"));
    Ok(serde_json::from_slice(&std::fs::read(path)?)?)
}

pub(super) fn messages(name: &str) -> Result<Vec<Value>, Box<dyn std::error::Error>> {
    fixture(name)?
        .get("messages")
        .and_then(Value::as_array)
        .cloned()
        .ok_or_else(|| format!("{name} is not a session fixture").into())
}

/// Uuid of the stored user message whose text contains `needle`.
fn prompt_uuid(messages: &[Value], needle: &str) -> Result<String, Box<dyn std::error::Error>> {
    messages
        .iter()
        .filter_map(Value::as_object)
        .filter(|message| message.get("type").and_then(Value::as_str) == Some("user"))
        .find(|message| {
            message
                .get("message")
                .and_then(|inner| inner.get("content"))
                .is_some_and(|content| content.to_string().contains(needle))
        })
        .and_then(|message| message.get("uuid").and_then(Value::as_str))
        .map(ToOwned::to_owned)
        .ok_or_else(|| format!("no prompt containing {needle}").into())
}

pub(super) fn context() -> HistoryContext {
    HistoryContext {
        app_thread_id: AppThreadId::from_static("0199a3c4-7a8e-7b2c-9d1e-2f3a4b5c6d7e"),
        cwd: "/workspace".into(),
    }
}

pub(super) fn item_type(item: &AgentItem) -> &'static str {
    match item {
        AgentItem::UserMessage { .. } => "userMessage",
        AgentItem::AgentMessage { .. } => "agentMessage",
        AgentItem::Reasoning { .. } => "reasoning",
        AgentItem::Command { .. } => "command",
        AgentItem::FileChange { .. } => "fileChange",
        AgentItem::McpToolCall { .. } => "mcpToolCall",
        AgentItem::ToolCall { .. } => "toolCall",
        AgentItem::WebSearch { .. } => "webSearch",
        AgentItem::ImageView { .. } => "imageView",
        AgentItem::Plan { .. } => "plan",
        AgentItem::Compaction { .. } => "compaction",
        AgentItem::Subagent { .. } => "subagent",
        AgentItem::TaskNotification { .. } => "taskNotification",
        AgentItem::CapabilityItem { .. } => "capabilityItem",
    }
}

pub(super) fn types(turn: &AgentTurn) -> Vec<&'static str> {
    turn.items.iter().map(item_type).collect()
}

pub(super) fn non_reasoning(turn: &AgentTurn) -> Vec<&AgentItem> {
    turn.items
        .iter()
        .filter(|item| !matches!(item, AgentItem::Reasoning { .. }))
        .collect()
}

fn execution_status(item: &AgentItem) -> Option<ExecutionStatus> {
    match item {
        AgentItem::Command { status, .. } | AgentItem::FileChange { status, .. } => Some(*status),
        _ => None,
    }
}

fn user_texts(turns: &[AgentTurn]) -> Vec<String> {
    turns
        .iter()
        .flat_map(|turn| turn.items.iter())
        .filter_map(|item| match item {
            AgentItem::UserMessage { content, .. } => Some(content),
            _ => None,
        })
        .flatten()
        .filter_map(|block| match block {
            UserContent::Text { text } => Some(text.clone()),
            UserContent::Image { .. } | UserContent::LocalImage { .. } => None,
        })
        .collect()
}

/// Neutral ordering rules that hold for every rebuilt turn.
pub(super) fn ordering_violations(turns: &[AgentTurn]) -> Vec<String> {
    let mut violations = Vec::new();
    for turn in turns {
        if turn.origin == TurnOrigin::User
            && !matches!(turn.items.first(), Some(AgentItem::UserMessage { .. }))
        {
            violations.push(format!(
                "{}: user turn without a first userMessage",
                turn.turn_id
            ));
        }
        let finals = turn
            .items
            .iter()
            .filter(|item| {
                matches!(
                    item,
                    AgentItem::AgentMessage {
                        phase: MessagePhase::Final,
                        ..
                    }
                )
            })
            .count();
        if finals > 1 {
            violations.push(format!("{}: two final answers", turn.turn_id));
        }
        if turn.items.iter().any(super::builder::item_in_progress) {
            violations.push(format!("{}: open item", turn.turn_id));
        }
        if turn.status == TurnStatus::InProgress {
            violations.push(format!("{}: open turn", turn.turn_id));
        }
    }
    violations
}

#[test]
fn rebuilds_a_prompt_a_tool_call_and_the_final_answer_as_one_completed_turn()
-> Result<(), Box<dyn std::error::Error>> {
    let messages = messages("bash_then_answer")?;
    let turns = reconstruct_turns(&messages, &[], &context());
    assert_eq!(turns.len(), 1);
    let turn = &turns[0];
    assert_eq!(turn.origin, TurnOrigin::User);
    assert_eq!(turn.status, TurnStatus::Completed);
    assert_eq!(
        turn.turn_id.as_str(),
        prompt_uuid(&messages, "Run the shell command")?
    );
    let items = non_reasoning(turn);
    assert_eq!(
        items.iter().map(|item| item_type(item)).collect::<Vec<_>>(),
        ["userMessage", "command", "agentMessage"]
    );
    let AgentItem::Command {
        command,
        cwd,
        output,
        status,
        ..
    } = items[1]
    else {
        return Err("second item is not a command".into());
    };
    assert_eq!(command, "echo hi && touch b2-marker.txt");
    assert_eq!(cwd, "/workspace");
    assert_eq!(output.as_deref(), Some("hi"));
    assert_eq!(*status, ExecutionStatus::Completed);
    let AgentItem::AgentMessage { phase, text, .. } = items[2] else {
        return Err("third item is not an agent message".into());
    };
    assert_eq!(*phase, MessagePhase::Final);
    assert_eq!(text, "DONE");
    // Claude keeps only thinking signatures: reasoning items keep their ids, not their text.
    let summaries = turn
        .items
        .iter()
        .filter_map(|item| match item {
            AgentItem::Reasoning { summary, .. } => Some(summary.clone()),
            _ => None,
        })
        .collect::<Vec<_>>();
    assert_eq!(summaries, vec![Vec::<String>::new(), Vec::new()]);
    Ok(())
}

#[test]
fn marks_a_rejected_tool_call_declined_and_the_interrupted_turn_interrupted()
-> Result<(), Box<dyn std::error::Error>> {
    let turns = reconstruct_turns(&messages("declined_tool_interrupt")?, &[], &context());
    assert_eq!(
        turns.iter().map(|turn| turn.status).collect::<Vec<_>>(),
        [TurnStatus::Interrupted]
    );
    let items = non_reasoning(&turns[0]);
    assert_eq!(
        items
            .iter()
            .map(|item| (item_type(item), execution_status(item)))
            .collect::<Vec<_>>(),
        [
            ("userMessage", None),
            ("command", Some(ExecutionStatus::Declined))
        ]
    );
    Ok(())
}

#[test]
fn maps_mcp_calls_and_keeps_the_last_answer_final() -> Result<(), Box<dyn std::error::Error>> {
    let turns = reconstruct_turns(&messages("three_tools_final")?, &[], &context());
    let items = non_reasoning(&turns[0]);
    assert_eq!(
        items.iter().map(|item| item_type(item)).collect::<Vec<_>>(),
        [
            "userMessage",
            "command",
            "mcpToolCall",
            "command",
            "agentMessage"
        ]
    );
    let AgentItem::McpToolCall {
        server,
        status,
        tool,
        ..
    } = items[2]
    else {
        return Err("third item is not an MCP call".into());
    };
    assert_eq!(server, "probe");
    assert_eq!(*status, CallStatus::Completed);
    assert_eq!(tool, "write_note");
    Ok(())
}

#[test]
fn derives_turn_boundaries_from_prompts_the_interrupt_marker_and_a_task_notification_wake()
-> Result<(), Box<dyn std::error::Error>> {
    let messages = messages("background_wake_steer_interrupt")?;
    let turns = reconstruct_turns(&messages, &[], &context());
    assert_eq!(
        turns
            .iter()
            .map(|turn| (turn.origin, turn.status))
            .collect::<Vec<_>>(),
        [
            (TurnOrigin::User, TurnStatus::Completed),
            (TurnOrigin::User, TurnStatus::Interrupted),
            (TurnOrigin::User, TurnStatus::Completed),
            (TurnOrigin::Provider, TurnStatus::Completed),
        ]
    );
    assert_eq!(
        non_reasoning(&turns[0])
            .iter()
            .map(|item| (item_type(item), execution_status(item)))
            .collect::<Vec<_>>(),
        [
            ("userMessage", None),
            ("command", Some(ExecutionStatus::Failed)),
            ("command", Some(ExecutionStatus::Completed)),
            // `Monitor` runs a shell command too.
            ("command", Some(ExecutionStatus::Completed)),
        ]
    );
    let AgentItem::Command { command, .. } = non_reasoning(&turns[0])[3] else {
        return Err("fourth item is not a command".into());
    };
    assert!(command.starts_with("until [ -f "));
    // An interrupted turn has no final answer; the wake turn's answer is final.
    assert!(matches!(
        non_reasoning(&turns[1]).last(),
        Some(AgentItem::AgentMessage {
            phase: MessagePhase::Commentary,
            ..
        })
    ));
    assert_eq!(
        types(&turns[3])
            .into_iter()
            .filter(|kind| *kind != "reasoning")
            .collect::<Vec<_>>(),
        ["taskNotification", "agentMessage"]
    );
    assert!(matches!(
        non_reasoning(&turns[3])[1],
        AgentItem::AgentMessage { phase: MessagePhase::Final, text, .. } if text == "DONE"
    ));
    assert_eq!(ordering_violations(&turns), Vec::<String>::new());
    Ok(())
}

#[test]
fn uses_the_turn_index_for_turn_ids_steers_client_message_ids_and_outcomes()
-> Result<(), Box<dyn std::error::Error>> {
    let messages = messages("background_wake_steer_interrupt")?;
    let first = prompt_uuid(&messages, "Run the shell command `sleep 25`")?;
    let steer = prompt_uuid(&messages, "Write the numbers")?;
    let record = TurnRecord {
        anchors: vec![first.clone(), steer.clone()],
        completed_at: Some(1_791_542_449),
        origin: TurnOrigin::User,
        outcome: TurnOutcomeRecord::Interrupted,
        prompts: vec![
            PromptRecord {
                client_message_id: Some("client-1".into()),
                role: PromptRole::First,
                uuid: Some(first),
            },
            PromptRecord {
                client_message_id: Some("client-2".into()),
                role: PromptRole::Steer,
                uuid: Some(steer),
            },
        ],
        started_at: 1_791_542_431,
        turn_id: "turn-from-index".into(),
        usage: None,
    };
    let turns = reconstruct_turns(&messages, &[record], &context());
    assert_eq!(
        turns
            .iter()
            .map(|turn| (turn.turn_id.as_str(), turn.status))
            .collect::<Vec<_>>()[..2],
        [
            ("turn-from-index", TurnStatus::Interrupted),
            (
                prompt_uuid(&messages, "Reply with just OK")?.as_str(),
                TurnStatus::Completed
            ),
        ]
    );
    assert_eq!(turns[2].status, TurnStatus::Completed);
    let users = turns[0]
        .items
        .iter()
        .filter_map(|item| match item {
            AgentItem::UserMessage {
                item_id,
                client_message_id,
                ..
            } => Some((
                item_id.as_str(),
                client_message_id
                    .as_ref()
                    .map(agent_core::model::ClientMessageId::as_str),
            )),
            _ => None,
        })
        .collect::<Vec<_>>();
    assert_eq!(
        users,
        [
            ("turn-from-index:user:0", Some("client-1")),
            ("turn-from-index:user:1", Some("client-2")),
        ]
    );
    assert_eq!(turns[0].completed_at, Some(1_791_542_449));
    assert_eq!(turns[0].started_at, 1_791_542_431);
    Ok(())
}

#[test]
fn keeps_a_failed_outcome_its_error_and_its_usage_from_the_index()
-> Result<(), Box<dyn std::error::Error>> {
    let counts = TokenUsage {
        input_tokens: 1_010,
        cached_input_tokens: 900,
        cache_write_input_tokens: Some(100),
        output_tokens: 20,
        reasoning_output_tokens: 5,
        total_tokens: 1_030,
    };
    let recorded_usage = TurnUsageRecord {
        last: counts,
        turn: counts,
        total: counts,
        context_window: Some(200_000),
        cost: Some(agent_core::model::ProviderCost {
            basis: agent_core::model::ProviderCostBasis::List,
            model: "claude-sonnet-4-6".into(),
            turn_usd: 0.5,
            thread_usd: Some(0.5),
        }),
    };
    let messages = messages("three_tools_final")?;
    let first = prompt_uuid(&messages, "Do these three steps")?;
    let turns = reconstruct_turns(
        &messages,
        &[TurnRecord {
            anchors: vec![first.clone()],
            completed_at: None,
            origin: TurnOrigin::User,
            outcome: TurnOutcomeRecord::Failed {
                error: agent_core::model::TurnError {
                    kind: TurnErrorKind::UsageLimit,
                    message: "limit reached".into(),
                },
            },
            prompts: vec![PromptRecord {
                client_message_id: None,
                role: PromptRole::First,
                uuid: Some(first),
            }],
            started_at: 1,
            turn_id: "failed-turn".into(),
            usage: Some(recorded_usage.clone()),
        }],
        &context(),
    );
    assert_eq!(turns[0].status, TurnStatus::Failed);
    assert_eq!(turns[0].turn_id.as_str(), "failed-turn");
    assert_eq!(
        turns[0]
            .error
            .as_ref()
            .map(|error| (error.kind, error.message.as_str())),
        Some((TurnErrorKind::UsageLimit, "limit reached"))
    );
    // The usage `usage.updated` reported when the turn ended comes back on a read.
    assert_eq!(turns[0].usage, Some(recorded_usage));
    assert!(turns[1..].iter().all(|turn| turn.usage.is_none()));
    // A failed turn has no final answer.
    assert!(matches!(
        non_reasoning(&turns[0]).last(),
        Some(AgentItem::AgentMessage {
            phase: MessagePhase::Commentary,
            ..
        })
    ));
    Ok(())
}

#[test]
fn ignores_sub_agent_meta_and_malformed_messages() {
    let turns = reconstruct_turns(
        &[
            Value::Null,
            json!({"type": "user", "uuid": "u1", "timestamp": "2026-10-01T10:00:00.000Z", "parent_tool_use_id": null,
                "message": {"content": "<command-name>/clear</command-name>"}}),
            json!({"type": "user", "uuid": "u2", "timestamp": "2026-10-01T10:00:00.000Z", "parent_tool_use_id": null,
                "is_meta": true, "message": {"content": "Caveat"}}),
            json!({"type": "assistant", "uuid": "a1", "timestamp": "2026-10-01T10:00:01.000Z", "parent_tool_use_id": "toolu_task",
                "message": {"id": "msg_sub", "content": [{"type": "text", "text": "sub-agent"}]}}),
            json!({"type": "user", "uuid": "u3", "timestamp": "not a time", "parent_tool_use_id": null,
                "message": {"content": "lost"}}),
        ],
        &[],
        &context(),
    );
    assert!(turns.is_empty());
}

#[test]
fn drops_the_placeholder_claude_writes_for_an_interrupted_turn() {
    let at = |second: u32| format!("2026-10-01T10:00:{second:02}.000Z");
    let user = |uuid: &str, second: u32, content: &str| {
        json!({"type": "user", "uuid": uuid, "timestamp": at(second), "parent_tool_use_id": null,
            "message": {"role": "user", "content": content}})
    };
    let assistant = |uuid: &str, second: u32, model: &str, text: &str| {
        json!({"type": "assistant", "uuid": uuid, "timestamp": at(second), "parent_tool_use_id": null,
            "message": {"id": uuid, "model": model, "role": "assistant", "content": [{"type": "text", "text": text}]}})
    };
    let turns = reconstruct_turns(
        &[
            user("p1", 1, "first"),
            user("i1", 2, "[Request interrupted by user]"),
            assistant("s1", 3, "<synthetic>", "No response requested."),
            user("p2", 4, "second"),
            assistant("a2", 5, "claude-opus-5-5", "The answer."),
        ],
        &[],
        &context(),
    );
    let shape = turns
        .iter()
        .map(|turn| {
            (
                turn.status,
                turn.items
                    .iter()
                    .filter_map(|item| match item {
                        AgentItem::AgentMessage { phase, text, .. } => {
                            Some(format!("{phase:?}:{text}"))
                        }
                        _ => None,
                    })
                    .collect::<Vec<_>>(),
            )
        })
        .collect::<Vec<_>>();
    assert_eq!(
        shape,
        [
            (TurnStatus::Interrupted, Vec::new()),
            (TurnStatus::Completed, vec!["Final:The answer.".to_owned()]),
        ]
    );
}

fn fixture_subagent(name: &str, agent_id: &str) -> Result<Vec<Value>, Box<dyn std::error::Error>> {
    fixture(name)?
        .get("subagents")
        .and_then(|subagents| subagents.get(agent_id))
        .and_then(Value::as_array)
        .cloned()
        .ok_or_else(|| format!("{name} has no sub-agent {agent_id}").into())
}

#[test]
fn an_interactive_terminal_session_shows_every_typed_prompt_and_hides_injected_context()
-> Result<(), Box<dyn std::error::Error>> {
    let messages = messages("interactive_terminal_subagents")?;
    let turns = reconstruct_turns(&messages, &[], &context());
    assert_eq!(
        user_texts(&turns),
        [
            "Plan the release and check the build.",
            "Also look at the changelog.",
            "What is on this screenshot?",
        ]
    );
    let image_turn = turns
        .iter()
        .find(|turn| {
            turn.items.iter().any(|item| {
                matches!(item, AgentItem::UserMessage { content, .. } if content.iter().any(|block| matches!(block, UserContent::Image { .. })))
            })
        })
        .ok_or("no image turn")?;
    assert_eq!(image_turn.items.first().map(item_type), Some("userMessage"));
    let AgentItem::UserMessage { content, .. } = &image_turn.items[0] else {
        return Err("first item is not a user message".into());
    };
    assert_eq!(
        content,
        &[
            UserContent::Text {
                text: "What is on this screenshot?".into()
            },
            UserContent::Image {
                url: "data:image/png;base64,iVBORw0KGgo=".into()
            },
        ]
    );
    let shown = user_texts(&turns).join("\n");
    for hidden in [
        "Injected context",
        "<command-name>",
        "<local-command-stdout>",
        "<task-notification>",
        "Status update from a peer",
    ] {
        assert!(!shown.contains(hidden), "{hidden} is shown");
    }
    Ok(())
}

#[test]
fn queued_prompts_and_notifications_stay_in_the_running_turn_and_idle_ones_wake()
-> Result<(), Box<dyn std::error::Error>> {
    let messages = messages("interactive_terminal_subagents")?;
    let turns = reconstruct_turns(&messages, &[], &context());
    assert_eq!(
        turns.iter().map(|turn| turn.origin).collect::<Vec<_>>(),
        [
            TurnOrigin::User,
            TurnOrigin::User,
            TurnOrigin::Provider,
            TurnOrigin::Provider
        ]
    );
    assert_eq!(
        turns[0].turn_id.as_str(),
        prompt_uuid(&messages, "Plan the release")?
    );
    assert_eq!(
        types(&turns[0]),
        [
            "userMessage",
            "reasoning",
            "subagent",
            "agentMessage",
            "userMessage",
            "subagent",
            "taskNotification",
            "agentMessage",
        ]
    );
    assert_eq!(ordering_violations(&turns), Vec::<String>::new());
    Ok(())
}

#[test]
fn maps_agent_calls_to_sub_agent_items_with_their_child_thread_and_latest_status()
-> Result<(), Box<dyn std::error::Error>> {
    let messages = messages("interactive_terminal_subagents")?;
    let turns = reconstruct_turns(&messages, &[], &context());
    let thread = context().app_thread_id;
    let subagents = turns
        .iter()
        .flat_map(|turn| turn.items.iter())
        .filter_map(|item| match item {
            AgentItem::Subagent {
                item_id,
                agent_thread_id,
                agent_type,
                background,
                description,
                model,
                prompt,
                result,
                status,
                ..
            } => Some((
                item_id.as_str(),
                agent_thread_id.as_ref().map(|id| id.as_str().to_owned()),
                agent_type.clone(),
                *background,
                description.clone(),
                model.clone(),
                prompt.clone(),
                result.clone(),
                *status,
            )),
            _ => None,
        })
        .collect::<Vec<_>>();
    assert_eq!(subagents.len(), 3);
    assert_eq!(
        subagents[0],
        (
            "toolu_bg",
            Some(format!("{thread}:agent:a1b2c3d4e5f600001")),
            Some("general-purpose".into()),
            true,
            "Check the build".into(),
            None,
            "Run the build and report.".into(),
            None,
            SubagentStatus::Completed,
        )
    );
    assert_eq!(subagents[1].0, "toolu_fg");
    assert_eq!(
        subagents[1].1,
        Some(format!("{thread}:agent:a1b2c3d4e5f600002"))
    );
    assert_eq!(subagents[1].2.as_deref(), Some("Explore"));
    assert!(!subagents[1].3);
    assert_eq!(subagents[1].5.as_deref(), Some("haiku"));
    assert_eq!(
        subagents[1].7.as_deref(),
        Some("The changelog lists three fixes.")
    );
    assert_eq!(subagents[1].8, SubagentStatus::Completed);
    assert_eq!(subagents[2].0, "toolu_open");
    assert_eq!(
        subagents[2].1,
        Some(format!("{thread}:agent:a1b2c3d4e5f600003"))
    );
    assert!(subagents[2].3);
    assert_eq!(subagents[2].8, SubagentStatus::Running);
    Ok(())
}

#[test]
fn rebuilds_a_sub_agent_transcript_with_its_delegated_prompt_first()
-> Result<(), Box<dyn std::error::Error>> {
    let transcript = fixture_subagent("interactive_terminal_subagents", "a1b2c3d4e5f600003")?;
    let turns = reconstruct_subagent_turns(&transcript, &context(), false);
    assert_eq!(turns.len(), 1);
    assert_eq!(types(&turns[0]), ["userMessage", "command"]);
    assert_eq!(user_texts(&turns), ["Watch the deploy until it ends."]);
    // It no longer runs and never answered: its process ended mid-step.
    assert_eq!(turns[0].status, TurnStatus::Interrupted);
    let running = reconstruct_subagent_turns(&transcript, &context(), true);
    assert_eq!(running[0].status, TurnStatus::InProgress);
    let answered = reconstruct_subagent_turns(
        &fixture_subagent("interactive_terminal_subagents", "a1b2c3d4e5f600001")?,
        &context(),
        false,
    );
    assert_eq!(
        answered.last().map(|turn| turn.status),
        Some(TurnStatus::Completed)
    );
    Ok(())
}

#[test]
fn frames_never_fail_on_unknown_or_malformed_input() {
    for value in [
        Value::Null,
        json!("text"),
        json!({"type": "mystery"}),
        json!({"type": "assistant"}),
        json!({"type": "system", "subtype": "task_started"}),
        json!({"type": "stream_event", "event": {"type": "content_block_delta"}}),
    ] {
        let frame = classify_frame(&value);
        assert!(
            matches!(
                frame,
                ClaudeFrame::Other { .. } | ClaudeFrame::Stream { .. }
            ),
            "{value} classified as {frame:?}"
        );
    }
}

/// Reads every session file of the local Claude store as raw rows and
/// rebuilds its turns: a smoke test over real data, run by hand
/// (`cargo test -p agent-provider-claude raw_local -- --ignored --nocapture`).
/// Prints counts only, never content.
#[test]
#[ignore = "reads the developer's own ~/.claude/projects"]
fn raw_local_sessions_rebuild_without_panics() -> Result<(), Box<dyn std::error::Error>> {
    let home = std::env::var_os("HOME").ok_or("HOME is not set")?;
    let root = Path::new(&home).join(".claude/projects");
    let mut files = 0_usize;
    let mut rows = 0_usize;
    let mut turns_total = 0_usize;
    let mut violations = Vec::new();
    for project in std::fs::read_dir(&root)?.flatten() {
        for entry in std::fs::read_dir(project.path())?.flatten() {
            let path = entry.path();
            if path.extension().and_then(|extension| extension.to_str()) != Some("jsonl") {
                continue;
            }
            let text = std::fs::read_to_string(&path)?;
            let rows_of_file = text
                .lines()
                .filter(|line| !line.trim().is_empty())
                .filter_map(|line| serde_json::from_str::<Value>(line).ok())
                .collect::<Vec<_>>();
            rows += rows_of_file.len();
            files += 1;
            let branch = super::chain::active_branch(&rows_of_file);
            let messages = branch.iter().map(AsRef::as_ref).collect::<Vec<_>>();
            let turns = reconstruct::reconstruct_turns(&messages, &[], &context());
            turns_total += turns.len();
            violations.extend(ordering_violations(&turns));
        }
    }
    println!(
        "files={files} rows={rows} turns={turns_total} violations={}",
        violations.len()
    );
    for violation in violations.iter().take(10) {
        println!("  {violation}");
    }
    assert!(files > 0);
    Ok(())
}
