//! Neutral thread, turn and item → client wire (Codex App Server v0.155.1
//! shapes). Pure functions; the only place these shapes are produced for a
//! non-native provider.

use agent_core::{model::turns::in_summary_view, usage::TurnUsageProjection};
use companion_host::wire_items::TASK_NOTIFICATION_ITEM_TYPE;
use serde_json::{Value, json};

use super::WireProvider;
use crate::agent::model::{
    AgentItem, AgentThread, AgentTurn, AppThreadId, CallStatus, ClientMessageId, ExecutionStatus,
    FileChange, FileChangeKind, ItemsView, MessagePhase, SubagentStatus, TaskNotificationDelivery,
    TaskNotificationStatus, ThreadStatus, TurnStatus, UserContent, WebSearchAction,
};

/// Marker namespace of a capability item projected as a generic tool call.
const CAPABILITY_ITEM_NAMESPACE: &str = "codewide.capability";
/// The `CodeWide` field of a `commandExecution` that started a background
/// task: the task id `companion/thread/backgroundTask/read` takes.
pub const BACKGROUND_TASK_ID_FIELD: &str = "codewideBackgroundTaskId";

/// Projects one neutral thread. `turns` are already projected wire turns.
#[must_use]
pub fn thread(thread: &AgentThread, provider: &WireProvider, turns: &[Value]) -> Value {
    let mut projected = json!({
        "id": thread.app_thread_id.as_str(),
        "environments": null,
        "extra": null,
        "sessionId": thread.app_thread_id.as_str(),
        "forkedFromId": null,
        "parentThreadId": thread.spawn.as_ref().map(|spawn| spawn.parent_thread_id.as_str()),
        "preview": thread.preview,
        "ephemeral": false,
        "section": null,
        "sectionEnteredAt": null,
        "projectId": null,
        "historyMode": "paginated",
        "modelProvider": provider.descriptor.model_provider,
        "model": thread.settings.model,
        "reasoningEffort": thread.settings.effort,
        "createdAt": thread.created_at,
        "updatedAt": thread.updated_at,
        // The neutral order key: a thread without its own recency (a session
        // started outside CodeWide) orders by its update time. Clients that
        // persist the key as a column must not see `null` and sort it last.
        "recencyAt": thread.recency_at.unwrap_or(thread.updated_at),
        "status": thread_status(thread.status),
        "path": null,
        "cwd": thread.cwd,
        "cliVersion": provider.descriptor.version,
        "originator": null,
        "source": "appServer",
        "canAcceptDirectInput": can_accept_direct_input(thread),
        "threadSource": null,
        "agentNickname": thread.spawn.as_ref().and_then(|spawn| spawn.agent_nickname.as_deref()),
        "agentRole": thread.spawn.as_ref().and_then(|spawn| spawn.agent_role.as_deref()),
        "gitInfo": null,
        "name": thread.name,
        "daybreakEnabled": null,
        "turns": turns,
    });
    provider.attach_extension(&mut projected);
    projected
}

/// Whether this companion can run a turn in the thread: `false` while
/// another process holds it, and for a sub-agent's thread, which its parent
/// drives. A neutral provider reports a held thread as `OpenElsewhere`, so an
/// unloaded thread is held by no one and a turn loads it here. Every status
/// therefore names the lock explicitly: the client keeps the last value it
/// received, and a released thread must clear it.
#[must_use]
pub const fn can_accept_direct_input(thread: &AgentThread) -> bool {
    !matches!(thread.status, ThreadStatus::OpenElsewhere) && thread.spawn.is_none()
}

/// Projects a thread lifecycle status. A thread open elsewhere runs nothing
/// here: it is idle on the wire and `canAcceptDirectInput` carries the lock.
#[must_use]
pub fn thread_status(status: ThreadStatus) -> Value {
    match status {
        ThreadStatus::Idle | ThreadStatus::OpenElsewhere => json!({"type": "idle"}),
        ThreadStatus::Active => json!({"type": "active", "activeFlags": []}),
        ThreadStatus::NotLoaded => json!({"type": "notLoaded"}),
        ThreadStatus::Failed => json!({"type": "systemError"}),
    }
}

const fn turn_status(status: TurnStatus) -> &'static str {
    match status {
        TurnStatus::InProgress => "inProgress",
        TurnStatus::Completed => "completed",
        TurnStatus::Interrupted => "interrupted",
        TurnStatus::Failed => "failed",
    }
}

const fn items_view(view: ItemsView) -> &'static str {
    match view {
        ItemsView::NotLoaded => "notLoaded",
        ItemsView::Summary => "summary",
        ItemsView::Full => "full",
    }
}

/// Projects one turn with the requested items view; `summary` keeps the
/// items the neutral summary rule keeps ([`in_summary_view`]).
#[must_use]
pub fn turn(turn: &AgentTurn, view: ItemsView) -> Value {
    let items = match view {
        ItemsView::NotLoaded => Vec::new(),
        ItemsView::Summary => turn
            .items
            .iter()
            .filter(|item| in_summary_view(item))
            .map(item)
            .collect(),
        ItemsView::Full => turn.items.iter().map(item).collect(),
    };
    let duration_ms = turn.completed_at.map(|completed| {
        completed
            .saturating_sub(turn.started_at)
            .saturating_mul(1_000)
    });
    let mut projected = json!({
        "id": turn.turn_id.as_str(),
        "items": items,
        "itemsView": items_view(view),
        "status": turn_status(turn.status),
        "error": turn.error.as_ref().map(|error| json!({
            "message": error.message,
            "codexErrorInfo": null,
            "additionalDetails": null,
            "misalignment": null,
        })),
        "startedAt": turn.started_at,
        "completedAt": turn.completed_at,
        "durationMs": duration_ms,
    });
    // A recorded turn usage becomes the same `codewide.usage` projection a
    // Codex history read carries, so a reloaded thread keeps its usage.
    if let Some(record) = &turn.usage
        && let Ok(usage) = serde_json::to_value(TurnUsageProjection::from_record(record))
        && let Some(object) = projected.as_object_mut()
    {
        object.insert("codewide".into(), json!({ "usage": usage }));
    }
    projected
}

fn user_content(content: &UserContent) -> Value {
    match content {
        UserContent::Text { text } => json!({"type": "text", "text": text, "text_elements": []}),
        UserContent::Image { url } => json!({"type": "image", "url": url}),
        UserContent::LocalImage { path } => json!({"type": "localImage", "path": path}),
    }
}

const fn execution_status(status: ExecutionStatus) -> &'static str {
    match status {
        ExecutionStatus::InProgress => "inProgress",
        ExecutionStatus::Completed => "completed",
        ExecutionStatus::Failed => "failed",
        ExecutionStatus::Declined => "declined",
    }
}

const fn call_status(status: CallStatus) -> &'static str {
    match status {
        CallStatus::InProgress => "inProgress",
        CallStatus::Completed => "completed",
        CallStatus::Failed => "failed",
    }
}

/// `collabAgentToolCall.status`: the item stays `inProgress` while its
/// sub-agent works, also after a background launch returned, so the client
/// shows it as running.
const fn subagent_call_status(status: SubagentStatus) -> &'static str {
    match status {
        SubagentStatus::Running => "inProgress",
        SubagentStatus::Completed => "completed",
        SubagentStatus::Failed => "failed",
        SubagentStatus::Stopped => "interrupted",
    }
}

/// `CollabAgentStatus` of the sub-agent in `agentsStates`.
const fn subagent_agent_status(status: SubagentStatus) -> &'static str {
    match status {
        SubagentStatus::Running => "running",
        SubagentStatus::Completed => "completed",
        SubagentStatus::Failed => "errored",
        SubagentStatus::Stopped => "interrupted",
    }
}

const fn task_notification_delivery(delivery: TaskNotificationDelivery) -> &'static str {
    match delivery {
        TaskNotificationDelivery::Wake => "wake",
        TaskNotificationDelivery::MidTurn => "midTurn",
    }
}

const fn task_notification_status(status: TaskNotificationStatus) -> &'static str {
    match status {
        TaskNotificationStatus::Completed => "completed",
        TaskNotificationStatus::Failed => "failed",
        TaskNotificationStatus::Killed => "killed",
        TaskNotificationStatus::Stopped => "stopped",
        TaskNotificationStatus::Interim => "interim",
        TaskNotificationStatus::Lost => "lost",
        TaskNotificationStatus::Unknown => "unknown",
    }
}

/// Projects file changes into `FileUpdateChange` entries.
#[must_use]
pub fn file_changes(changes: &[FileChange]) -> Value {
    Value::Array(
        changes
            .iter()
            .map(|change| {
                let kind = match change.kind {
                    FileChangeKind::Add => json!({"type": "add"}),
                    FileChangeKind::Delete => json!({"type": "delete"}),
                    FileChangeKind::Update => {
                        json!({"type": "update", "move_path": change.move_path})
                    }
                };
                json!({"path": change.path, "kind": kind, "diff": change.diff})
            })
            .collect(),
    )
}

/// Projects one neutral item.
// WHY: one exhaustive match is the projection table of the item union;
// splitting it would scatter the wire shapes across helpers.
#[allow(clippy::too_many_lines)]
#[must_use]
pub fn item(item: &AgentItem) -> Value {
    match item {
        AgentItem::UserMessage {
            item_id,
            client_message_id,
            content,
            ..
        } => json!({
            "type": "userMessage",
            "id": item_id.as_str(),
            "clientId": client_message_id.as_ref().map(ClientMessageId::as_str),
            "content": content.iter().map(user_content).collect::<Vec<_>>(),
        }),
        AgentItem::AgentMessage {
            item_id,
            text,
            phase,
            ..
        } => json!({
            "type": "agentMessage",
            "id": item_id.as_str(),
            "text": text,
            "phase": match phase {
                MessagePhase::Commentary => "commentary",
                MessagePhase::Final => "final_answer",
            },
            "memoryCitation": null,
            "delivery": null,
            "questions": null,
        }),
        AgentItem::Reasoning {
            item_id,
            summary,
            content,
            ..
        } => json!({
            "type": "reasoning",
            "id": item_id.as_str(),
            "summary": summary,
            "content": content,
        }),
        AgentItem::Command {
            item_id,
            command,
            cwd,
            status,
            output,
            exit_code,
            duration_ms,
            background_task_id,
            ..
        } => {
            let mut projected = json!({
                "type": "commandExecution",
                "id": item_id.as_str(),
                "pluginId": null,
                "scriptPath": null,
                "command": command,
                "cwd": cwd,
                "processId": null,
                "source": "agent",
                "status": execution_status(*status),
                "commandActions": [{"type": "unknown", "command": command}],
                "aggregatedOutput": output,
                "exitCode": exit_code,
                "durationMs": duration_ms,
            });
            // Omitted for a foreground command, so a command without a
            // background task keeps its earlier bytes.
            if let Some(task_id) = background_task_id {
                projected[BACKGROUND_TASK_ID_FIELD] = json!(task_id);
            }
            projected
        }
        AgentItem::FileChange {
            item_id,
            changes,
            status,
            ..
        } => json!({
            "type": "fileChange",
            "id": item_id.as_str(),
            "changes": file_changes(changes),
            "status": execution_status(*status),
        }),
        AgentItem::McpToolCall {
            item_id,
            server,
            tool,
            arguments,
            status,
            result,
            error,
            duration_ms,
            ..
        } => json!({
            "type": "mcpToolCall",
            "id": item_id.as_str(),
            "server": server,
            "tool": tool,
            "status": call_status(*status),
            "arguments": arguments,
            "appContext": null,
            "pluginId": null,
            "readOnlyHint": null,
            "result": result.as_ref().map(|result| json!({
                "content": result.content,
                "structuredContent": result.structured_content,
                "_meta": null,
            })),
            "error": error.as_ref().map(|message| json!({"message": message})),
            "durationMs": duration_ms,
        }),
        AgentItem::ToolCall {
            item_id,
            namespace,
            tool,
            arguments,
            output,
            status,
            duration_ms,
            ..
        } => json!({
            "type": "dynamicToolCall",
            "id": item_id.as_str(),
            "namespace": namespace,
            "tool": tool,
            "arguments": arguments,
            "status": call_status(*status),
            "contentItems": output.as_ref().map(|text| json!([{"type": "inputText", "text": text}])),
            "success": match status {
                CallStatus::InProgress => None,
                CallStatus::Completed => Some(true),
                CallStatus::Failed => Some(false),
            },
            "durationMs": duration_ms,
        }),
        AgentItem::WebSearch {
            item_id,
            query,
            action,
            ..
        } => json!({
            "type": "webSearch",
            "id": item_id.as_str(),
            "query": query,
            "action": action.as_ref().map(|action| match action {
                WebSearchAction::Search { query } => {
                    json!({"type": "search", "query": query, "queries": null})
                }
                WebSearchAction::OpenPage { url } => json!({"type": "openPage", "url": url}),
            }),
        }),
        AgentItem::ImageView { item_id, path, .. } => {
            json!({"type": "imageView", "id": item_id.as_str(), "path": path})
        }
        AgentItem::Plan { item_id, text, .. } => {
            json!({"type": "plan", "id": item_id.as_str(), "text": text})
        }
        AgentItem::Compaction { item_id, .. } => {
            json!({"type": "contextCompaction", "id": item_id.as_str()})
        }
        AgentItem::Subagent {
            item_id,
            provenance,
            agent_thread_id,
            description,
            model,
            prompt,
            result,
            status,
            ..
        } => {
            let receivers = agent_thread_id
                .iter()
                .map(AppThreadId::as_str)
                .collect::<Vec<_>>();
            let states = agent_thread_id
                .iter()
                .map(|thread| {
                    (
                        thread.as_str().to_owned(),
                        json!({"status": subagent_agent_status(*status), "message": result}),
                    )
                })
                .collect::<serde_json::Map<_, _>>();
            json!({
                "type": "collabAgentToolCall",
                "id": item_id.as_str(),
                "tool": "spawnAgent",
                "status": subagent_call_status(*status),
                "senderThreadId": provenance
                    .as_ref()
                    .map_or("", |origin| origin.native_thread_id.as_str()),
                "receiverThreadIds": receivers,
                "prompt": prompt,
                "model": model,
                "reasoningEffort": null,
                "agentsStates": states,
                "codewideDescription": description,
            })
        }
        // A CodeWide extension the client renders outside the turn's bubble;
        // an older client shows it as an unsupported block.
        AgentItem::TaskNotification {
            item_id,
            delivery,
            source,
            task_id,
            name,
            status,
            duration_ms,
            tool_uses,
            result,
            ..
        } => json!({
            "type": TASK_NOTIFICATION_ITEM_TYPE,
            "id": item_id.as_str(),
            "delivery": task_notification_delivery(*delivery),
            "kind": source.kind(),
            "taskId": task_id,
            "name": name,
            "agentThreadId": source.agent_thread_id().map(AppThreadId::as_str),
            "status": task_notification_status(*status),
            "durationMs": duration_ms,
            "toolUses": tool_uses,
            "result": result,
        }),
        AgentItem::CapabilityItem {
            item_id,
            capability,
            kind,
            payload,
            ..
        } => json!({
            "type": "dynamicToolCall",
            "id": item_id.as_str(),
            "namespace": format!("{CAPABILITY_ITEM_NAMESPACE}.{capability}"),
            "tool": kind,
            "arguments": payload,
            "status": "completed",
            "contentItems": null,
            "success": true,
            "durationMs": null,
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent::model::{
        ProviderCost, ProviderCostBasis, TokenUsage, TurnId, TurnOrigin, TurnUsageRecord,
    };

    fn finished_turn(usage: Option<TurnUsageRecord>) -> AgentTurn {
        AgentTurn {
            turn_id: TurnId::from_static("turn"),
            status: TurnStatus::Completed,
            origin: TurnOrigin::User,
            started_at: 1,
            completed_at: Some(2),
            error: None,
            items: Vec::new(),
            provenance: None,
            usage,
        }
    }

    fn claude_wire() -> WireProvider {
        WireProvider {
            descriptor: crate::agent::model::ProviderDescriptor {
                id: crate::agent::model::ProviderId::from_static("claude"),
                display_name: "Claude".into(),
                model_provider: "anthropic".into(),
                version: String::new(),
            },
            capabilities: crate::agent::model::CapabilitySet::none(
                crate::agent::model::StartWhileActiveMode::Busy,
            ),
            primary_id: crate::agent::model::ProviderId::from_static("codex"),
            multi_provider: true,
        }
    }

    fn neutral_thread(spawn: Option<crate::agent::model::ThreadSpawn>) -> AgentThread {
        AgentThread {
            app_thread_id: AppThreadId::from_static("parent:agent:a1"),
            provider: crate::agent::model::ProviderId::from_static("claude"),
            cwd: "/w".into(),
            name: Some("Check the build".into()),
            preview: String::new(),
            created_at: 1,
            updated_at: 2,
            recency_at: None,
            archived: false,
            origin: crate::agent::model::ThreadOrigin::External,
            status: ThreadStatus::Active,
            settings: crate::agent::model::ThreadSettings {
                model: "default".into(),
                effort: None,
                permission_profile: ":read-only".into(),
                service_tier: None,
            },
            spawn,
        }
    }

    /// A sub-agent's thread is the parent's child on the wire, so the client
    /// files it under its parent and keeps the composer closed; a root
    /// thread names no parent and accepts input.
    #[test]
    fn a_sub_agent_thread_names_its_parent_and_takes_no_direct_input() {
        let child = thread(
            &neutral_thread(Some(crate::agent::model::ThreadSpawn {
                parent_thread_id: AppThreadId::from_static("parent"),
                agent_nickname: Some("Check the build".into()),
                agent_role: Some("Explore".into()),
            })),
            &claude_wire(),
            &[],
        );
        assert_eq!(child["parentThreadId"], "parent");
        assert_eq!(child["agentNickname"], "Check the build");
        assert_eq!(child["agentRole"], "Explore");
        assert_eq!(child["canAcceptDirectInput"], false);

        let root = thread(&neutral_thread(None), &claude_wire(), &[]);
        assert_eq!(root["parentThreadId"], Value::Null);
        assert_eq!(root["agentNickname"], Value::Null);
        assert_eq!(root["canAcceptDirectInput"], true);
    }

    #[test]
    fn a_recorded_turn_usage_becomes_the_codewide_usage_projection() {
        let counts = |input, cached, written, output| TokenUsage {
            input_tokens: input,
            cached_input_tokens: cached,
            cache_write_input_tokens: Some(written),
            output_tokens: output,
            reasoning_output_tokens: 0,
            total_tokens: input + output,
        };
        let record = TurnUsageRecord {
            last: counts(1_500, 1_000, 400, 90),
            turn: counts(3_000, 2_000, 600, 200),
            total: counts(9_000, 6_000, 900, 500),
            context_window: Some(200_000),
            cost: Some(ProviderCost {
                basis: ProviderCostBasis::List,
                model: "claude-sonnet-4-6".into(),
                turn_usd: 0.04,
                thread_usd: Some(0.12),
            }),
        };
        let projected = turn(&finished_turn(Some(record)), ItemsView::Summary);
        let usage = &projected["codewide"]["usage"];
        assert_eq!(usage["status"], "final");
        assert_eq!(usage["modelContextWindow"], 200_000);
        assert_eq!(usage["latestRequest"]["totalTokens"], 1_590);
        assert_eq!(usage["turn"]["tokens"]["cacheWriteInputTokens"], 600);
        assert_eq!(usage["turn"]["cost"]["basis"], "providerReported");
        assert_eq!(usage["turn"]["cost"]["totalCostUsd"], 0.04);
        assert_eq!(usage["turn"]["cost"]["uncachedInputTokens"], 400);
        assert_eq!(usage["thread"]["tokens"]["totalTokens"], 9_500);
        assert_eq!(usage["thread"]["cost"]["totalCostUsd"], 0.12);

        let unrecorded = turn(&finished_turn(None), ItemsView::Summary);
        assert!(unrecorded.get("codewide").is_none());
    }

    fn subagent(status: SubagentStatus, child: Option<&'static str>) -> AgentItem {
        AgentItem::Subagent {
            item_id: crate::agent::model::ItemId::from_static("toolu_spawn"),
            provenance: Some(crate::agent::model::Provenance {
                provider: crate::agent::model::ProviderId::from_static("claude"),
                native_thread_id: crate::agent::model::ProviderThreadRef::from_static("parent"),
            }),
            agent_thread_id: child.map(AppThreadId::from_static),
            agent_type: Some("Explore".into()),
            background: true,
            description: "Check the build".into(),
            model: Some("haiku".into()),
            prompt: "Run the build".into(),
            result: Some("Build passes".into()),
            status,
        }
    }

    #[test]
    fn a_subagent_is_a_spawn_collab_call_that_stays_in_progress_while_it_runs() {
        let running = item(&subagent(SubagentStatus::Running, Some("parent:agent:a1")));
        assert_eq!(running["type"], "collabAgentToolCall");
        assert_eq!(running["tool"], "spawnAgent");
        assert_eq!(running["status"], "inProgress");
        assert_eq!(running["senderThreadId"], "parent");
        assert_eq!(running["receiverThreadIds"], json!(["parent:agent:a1"]));
        assert_eq!(running["prompt"], "Run the build");
        assert_eq!(running["codewideDescription"], "Check the build");
        assert_eq!(
            running["agentsStates"]["parent:agent:a1"]["status"],
            "running"
        );

        let finished = item(&subagent(
            SubagentStatus::Completed,
            Some("parent:agent:a1"),
        ));
        assert_eq!(finished["status"], "completed");
        assert_eq!(
            finished["agentsStates"]["parent:agent:a1"],
            json!({"status": "completed", "message": "Build passes"})
        );

        let unnamed = item(&subagent(SubagentStatus::Stopped, None));
        assert_eq!(unnamed["status"], "interrupted");
        assert_eq!(unnamed["receiverThreadIds"], json!([]));
        assert_eq!(unnamed["agentsStates"], json!({}));
    }

    fn report(
        delivery: TaskNotificationDelivery,
        source: crate::agent::model::TaskNotificationSource,
        status: TaskNotificationStatus,
    ) -> AgentItem {
        AgentItem::TaskNotification {
            item_id: crate::agent::model::ItemId::from_static("turn:notification:0"),
            provenance: None,
            delivery,
            source,
            task_id: "a1".into(),
            name: "Check the build".into(),
            status,
            duration_ms: Some(12_963),
            tool_uses: Some(2),
            result: Some("Build passes".into()),
        }
    }

    #[test]
    fn a_task_report_is_a_codewide_item_with_every_field_present() {
        use crate::agent::model::TaskNotificationSource;

        let agent = item(&report(
            TaskNotificationDelivery::Wake,
            TaskNotificationSource::Agent {
                agent_thread_id: Some(AppThreadId::from_static("parent:agent:a1")),
            },
            TaskNotificationStatus::Interim,
        ));
        assert_eq!(
            agent,
            json!({
                "type": "codewideTaskNotification",
                "id": "turn:notification:0",
                "delivery": "wake",
                "kind": "agent",
                "taskId": "a1",
                "name": "Check the build",
                "agentThreadId": "parent:agent:a1",
                "status": "interim",
                "durationMs": 12_963,
                "toolUses": 2,
                "result": "Build passes",
            })
        );

        let mut command = report(
            TaskNotificationDelivery::MidTurn,
            TaskNotificationSource::Command {
                agent_thread_id: (),
            },
            TaskNotificationStatus::Lost,
        );
        if let AgentItem::TaskNotification {
            duration_ms,
            tool_uses,
            result,
            ..
        } = &mut command
        {
            *duration_ms = None;
            *tool_uses = None;
            *result = None;
        }
        let command = item(&command);
        assert_eq!(command["delivery"], "midTurn");
        assert_eq!(command["kind"], "command");
        assert_eq!(command["status"], "lost");
        for field in ["agentThreadId", "durationMs", "toolUses", "result"] {
            assert_eq!(
                command.get(field),
                Some(&Value::Null),
                "{field} must stay null"
            );
        }
    }

    #[test]
    fn a_background_command_names_its_task_and_a_foreground_one_keeps_its_bytes() {
        let command = |background_task_id: Option<&str>| AgentItem::Command {
            item_id: crate::agent::model::ItemId::from_static("toolu_1"),
            provenance: None,
            command: "npm test".into(),
            cwd: "/w".into(),
            status: ExecutionStatus::Completed,
            output: Some("Command running in background with ID: b1".into()),
            exit_code: Some(0),
            duration_ms: Some(4),
            background_task_id: background_task_id.map(str::to_owned),
        };
        let background = item(&command(Some("bd3cb8oli")));
        assert_eq!(background["type"], "commandExecution");
        assert_eq!(background[BACKGROUND_TASK_ID_FIELD], "bd3cb8oli");

        let foreground = item(&command(None));
        assert!(foreground.get(BACKGROUND_TASK_ID_FIELD).is_none());
        let mut without_field = background;
        if let Some(object) = without_field.as_object_mut() {
            object.remove(BACKGROUND_TASK_ID_FIELD);
        }
        assert_eq!(foreground, without_field);
    }

    #[test]
    fn the_summary_view_keeps_task_reports_and_agent_launches_with_the_messages() {
        let mut finished = finished_turn(None);
        finished.items = vec![
            report(
                TaskNotificationDelivery::Wake,
                crate::agent::model::TaskNotificationSource::Other {
                    agent_thread_id: (),
                },
                TaskNotificationStatus::Completed,
            ),
            AgentItem::Plan {
                item_id: crate::agent::model::ItemId::from_static("plan"),
                provenance: None,
                text: "Check".into(),
            },
            subagent(SubagentStatus::Running, None),
        ];
        let projected = turn(&finished, ItemsView::Summary);
        let types: Vec<_> = projected["items"]
            .as_array()
            .map(|items| items.iter().map(|item| item["type"].clone()).collect())
            .unwrap_or_default();
        assert_eq!(
            types,
            vec![
                json!("codewideTaskNotification"),
                json!("collabAgentToolCall")
            ]
        );
    }
}
