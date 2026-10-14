//! History contracts of background task reports over synthetic stored
//! sessions: where a `<task-notification>` becomes a `taskNotification`
//! item, and that reports never move a turn boundary, a turn id or a fork
//! end (the same session with every report a plain peer wake rebuilds the
//! same turns).

use agent_core::model::{
    AgentItem, AgentTurn, AppThreadId, MessagePhase, Provenance, ProviderId, ProviderThreadRef,
    SubagentStatus, TaskNotificationDelivery, TaskNotificationSource, TaskNotificationStatus,
    TurnId, TurnOrigin, TurnStatus,
};
use serde_json::{Value, json};

use super::{
    chain::active_branch,
    reconstruct::{TurnEnd, turn_ends},
    tests::{
        context, item_type, messages, non_reasoning, ordering_violations, reconstruct_turns,
        records, types,
    },
    turn_index::{PromptRecord, PromptRole, TurnOutcomeRecord, TurnRecord},
};

type TestResult = Result<(), Box<dyn std::error::Error>>;

const INTERIM_NOTE: &str = "This agent stopped with background work of its own still running. It may resume on its own when that work completes or reports, and the same task-id notifies again if it does; the result below may be interim.";

struct Notification<'a> {
    task_id: &'a str,
    tool_use_id: Option<&'a str>,
    status: &'a str,
    summary: &'a str,
    note: Option<&'a str>,
    result: Option<&'a str>,
    /// `(duration_ms, tool_uses)`.
    usage: Option<(i64, i64)>,
}

fn notification_xml(fields: &Notification<'_>) -> String {
    let mut lines = vec![
        "<task-notification>".to_owned(),
        format!("<task-id>{}</task-id>", fields.task_id),
    ];
    if let Some(tool_use_id) = fields.tool_use_id {
        lines.push(format!("<tool-use-id>{tool_use_id}</tool-use-id>"));
    }
    lines.push("<output-file>/tmp/task.output</output-file>".into());
    lines.push(format!("<status>{}</status>", fields.status));
    lines.push(format!("<summary>{}</summary>", fields.summary));
    if let Some(note) = fields.note {
        lines.push(format!("<note>{note}</note>"));
    }
    if let Some(result) = fields.result {
        lines.push(format!("<result>{result}</result>"));
    }
    if let Some((duration_ms, tool_uses)) = fields.usage {
        lines.push(format!("<usage><subagent_tokens>900</subagent_tokens><tool_uses>{tool_uses}</tool_uses><duration_ms>{duration_ms}</duration_ms></usage>"));
    }
    lines.push("</task-notification>".into());
    lines.join("\n")
}

fn agent_report() -> String {
    notification_xml(&Notification {
        task_id: "a0000000000000001",
        tool_use_id: Some("toolu_agent"),
        status: "completed",
        summary: "Agent \"Review the diff\" finished",
        note: Some(INTERIM_NOTE),
        result: Some("Two issues."),
        usage: Some((12_963, 4)),
    })
}

fn test_report() -> String {
    notification_xml(&Notification {
        task_id: "btest0001",
        tool_use_id: None,
        status: "completed",
        summary: "Background command \"npm test\" completed (exit code 0)",
        note: None,
        result: None,
        usage: None,
    })
}

fn watch_report() -> String {
    notification_xml(&Notification {
        task_id: "bwatch001",
        tool_use_id: None,
        status: "killed",
        summary: "Background command \"npm run watch\" didn't finish before the previous session ended",
        note: None,
        result: None,
        usage: None,
    })
}

/// Stored messages with increasing timestamps.
struct Store {
    seconds: u32,
}

impl Store {
    fn stored(&mut self, uuid: &str, mut fields: Value) -> Value {
        self.seconds += 1;
        fields["parent_tool_use_id"] = Value::Null;
        fields["session_id"] = json!("s");
        fields["timestamp"] = json!(format!(
            "2026-10-14T10:{:02}:{:02}.000Z",
            self.seconds / 60,
            self.seconds % 60
        ));
        fields["uuid"] = json!(uuid);
        fields
    }

    fn prompt(&mut self, uuid: &str, text: &str) -> Value {
        self.stored(
            uuid,
            json!({"type": "user", "message": {"role": "user", "content": text}}),
        )
    }

    fn text(&mut self, uuid: &str, text: &str) -> Value {
        self.stored(
            uuid,
            json!({"type": "assistant", "message": {"id": format!("msg_{uuid}"),
                "role": "assistant", "content": [{"type": "text", "text": text}]}}),
        )
    }

    fn tool(&mut self, uuid: &str, id: &str, name: &str, input: &Value) -> Value {
        self.stored(
            uuid,
            json!({"type": "assistant", "message": {"id": format!("msg_{uuid}"),
                "role": "assistant",
                "content": [{"type": "tool_use", "id": id, "name": name, "input": input}]}}),
        )
    }

    fn tool_result(&mut self, uuid: &str, tool_use_id: &str, text: &str) -> Value {
        self.stored(
            uuid,
            json!({"type": "user", "message": {"role": "user", "content": [
                {"type": "tool_result", "tool_use_id": tool_use_id, "content": text}]}}),
        )
    }

    fn wake(&mut self, uuid: &str, xml: &str, kind: &str, queued: bool) -> Value {
        let mut message = json!({"type": "user", "origin": {"kind": kind},
            "message": {"role": "user", "content": xml}});
        if queued {
            message["isQueuedCommand"] = json!(true);
        }
        self.stored(uuid, message)
    }
}

/// Turn 1 starts a background agent; two reports wake turn 2; turn 3 gets a
/// report queued into it while a command runs, and one after its answer.
fn session(report_kind: &str) -> Vec<Value> {
    let mut store = Store { seconds: 0 };
    vec![
        store.prompt("u1", "Review the diff in the background."),
        store.tool(
            "a1",
            "toolu_agent",
            "Agent",
            &json!({"description": "Review the diff", "prompt": "Review it.",
                "run_in_background": true}),
        ),
        store.tool_result(
            "r1",
            "toolu_agent",
            "Async agent launched successfully.\nagentId: a0000000000000001",
        ),
        store.text("a2", "Started."),
        store.wake("n1", &agent_report(), report_kind, false),
        store.wake("n2", &test_report(), report_kind, false),
        store.text("a3", "Both finished."),
        store.prompt("u2", "Run the build."),
        store.tool(
            "a4",
            "toolu_build",
            "Bash",
            &json!({"command": "npm run build"}),
        ),
        store.wake("n3", &watch_report(), report_kind, true),
        store.tool_result("r4", "toolu_build", "built"),
        store.text("a5", "Built."),
        store.wake("n4", &test_report(), report_kind, true),
    ]
}

fn record(turn_id: &str, origin: TurnOrigin, anchor: &str) -> TurnRecord {
    TurnRecord {
        anchors: vec![anchor.to_owned()],
        completed_at: None,
        origin,
        outcome: TurnOutcomeRecord::Completed,
        prompts: if origin == TurnOrigin::User {
            vec![PromptRecord {
                client_message_id: None,
                role: PromptRole::First,
                uuid: Some(anchor.to_owned()),
            }]
        } else {
            Vec::new()
        },
        started_at: 1_791_542_400,
        turn_id: turn_id.to_owned(),
        usage: None,
    }
}

fn index() -> Vec<TurnRecord> {
    vec![
        record("turn-1", TurnOrigin::User, "u1"),
        record("turn-2", TurnOrigin::Provider, "a3"),
        record("turn-3", TurnOrigin::User, "u2"),
    ]
}

fn ends(messages: &[Value], index: &[TurnRecord]) -> Vec<TurnEnd> {
    turn_ends(&records(messages), index)
}

fn identities(turns: &[AgentTurn]) -> Vec<(TurnId, TurnOrigin, TurnStatus)> {
    turns
        .iter()
        .map(|turn| (turn.turn_id.clone(), turn.origin, turn.status))
        .collect()
}

/// `(delivery, task id)` of each report, per turn.
fn reports(turns: &[AgentTurn]) -> Vec<Vec<(TaskNotificationDelivery, &str)>> {
    turns
        .iter()
        .map(|turn| {
            turn.items
                .iter()
                .filter_map(|item| match item {
                    AgentItem::TaskNotification {
                        delivery, task_id, ..
                    } => Some((*delivery, task_id.as_str())),
                    _ => None,
                })
                .collect()
        })
        .collect()
}

#[test]
fn reports_never_move_a_turn_boundary_a_turn_id_or_a_fork_end() {
    for index in [index(), Vec::new()] {
        let with_reports = reconstruct_turns(&session("task-notification"), &index, &context());
        let plain_wakes = reconstruct_turns(&session("peer"), &index, &context());
        assert_eq!(identities(&with_reports), identities(&plain_wakes));
        assert_eq!(
            ends(&session("task-notification"), &index),
            ends(&session("peer"), &index)
        );
        assert!(reports(&plain_wakes).iter().all(Vec::is_empty));
    }
    let turn_end = |turn_id: &'static str, last_uuid: &str| TurnEnd {
        last_uuid: last_uuid.to_owned(),
        turn_id: TurnId::from_static(turn_id),
    };
    assert_eq!(
        ends(&session("task-notification"), &index()),
        [
            turn_end("turn-1", "a2"),
            turn_end("turn-2", "a3"),
            turn_end("turn-3", "a5"),
        ]
    );
}

#[test]
fn reports_lead_the_turn_they_woke_and_queued_ones_stay_where_they_arrived() -> TestResult {
    let turns = reconstruct_turns(&session("task-notification"), &index(), &context());
    assert_eq!(
        turns.iter().map(types).collect::<Vec<_>>(),
        [
            vec!["userMessage", "subagent", "agentMessage"],
            vec!["taskNotification", "taskNotification", "agentMessage"],
            vec![
                "userMessage",
                "command",
                "taskNotification",
                "agentMessage",
                "taskNotification"
            ],
        ]
    );
    let app_thread_id = context().app_thread_id;
    assert_eq!(
        turns[1].items[0],
        AgentItem::TaskNotification {
            item_id: agent_core::model::ItemId::from_static("turn-2:notification:0"),
            provenance: Some(Provenance {
                provider: ProviderId::from_static(crate::PROVIDER_ID),
                native_thread_id: ProviderThreadRef::same_as(&app_thread_id),
            }),
            delivery: TaskNotificationDelivery::Wake,
            source: TaskNotificationSource::Agent {
                agent_thread_id: AppThreadId::parse(&format!(
                    "{app_thread_id}:agent:a0000000000000001"
                )),
            },
            task_id: "a0000000000000001".into(),
            name: "Review the diff".into(),
            status: TaskNotificationStatus::Interim,
            duration_ms: Some(12_963),
            tool_uses: Some(4),
            result: Some("Two issues.".into()),
        }
    );
    let AgentItem::TaskNotification {
        source,
        name,
        status,
        delivery,
        ..
    } = &turns[1].items[1]
    else {
        return Err("the second report is missing".into());
    };
    assert_eq!(
        (source, name.as_str(), *status, *delivery),
        (
            &TaskNotificationSource::Command {
                agent_thread_id: ()
            },
            "npm test",
            TaskNotificationStatus::Completed,
            TaskNotificationDelivery::Wake
        )
    );
    let third = turns[2]
        .items
        .iter()
        .filter_map(|item| match item {
            AgentItem::TaskNotification {
                delivery,
                name,
                status,
                ..
            } => Some((*delivery, name.as_str(), *status)),
            _ => None,
        })
        .collect::<Vec<_>>();
    assert_eq!(
        third,
        [
            (
                TaskNotificationDelivery::MidTurn,
                "npm run watch",
                TaskNotificationStatus::Lost
            ),
            (
                TaskNotificationDelivery::MidTurn,
                "npm test",
                TaskNotificationStatus::Completed
            ),
        ]
    );
    // A report after the answer is not the agent's output: the answer stays final.
    assert!(turns[2].items.iter().any(|item| matches!(
        item,
        AgentItem::AgentMessage { phase: MessagePhase::Final, text, .. } if text == "Built."
    )));
    // The report also finishes the sub-agent it names.
    assert!(turns[0].items.iter().any(|item| matches!(
        item,
        AgentItem::Subagent {
            status: SubagentStatus::Completed,
            ..
        }
    )));
    assert_eq!(ordering_violations(&turns), Vec::<String>::new());
    Ok(())
}

#[test]
fn wakes_buffered_before_a_prompt_are_delivered_inside_that_user_turn() {
    let mut store = Store { seconds: 0 };
    let messages = vec![
        store.prompt("u1", "Start."),
        store.text("a1", "Started."),
        store.wake("n1", &test_report(), "task-notification", false),
        store.wake("n2", &watch_report(), "task-notification", false),
        store.prompt("u2", "Next."),
        store.text("a2", "Done."),
    ];
    let turns = reconstruct_turns(&messages, &[], &context());
    assert_eq!(
        turns.iter().map(types).collect::<Vec<_>>(),
        [
            vec!["userMessage", "agentMessage"],
            vec![
                "userMessage",
                "taskNotification",
                "taskNotification",
                "agentMessage"
            ],
        ]
    );
    assert_eq!(
        reports(&turns),
        [
            vec![],
            vec![
                (TaskNotificationDelivery::MidTurn, "btest0001"),
                (TaskNotificationDelivery::MidTurn, "bwatch001"),
            ],
        ]
    );
}

/// A report Claude queued while the agent worked is stored as a
/// `queued_command` attachment (`commandMode: task-notification`); the
/// session file's active branch delivers it as a queued wake.
#[test]
fn a_queued_report_attachment_is_a_mid_turn_report() {
    let mut store = Store { seconds: 0 };
    let mut rows = vec![
        store.prompt("u1", "Build."),
        store.tool(
            "a1",
            "toolu_build",
            "Bash",
            &json!({"command": "npm run build"}),
        ),
    ];
    let mut attachment = store.stored(
        "q1",
        json!({"type": "attachment", "attachment": {"type": "queued_command",
            "commandMode": "task-notification", "prompt": test_report()}}),
    );
    attachment["parentUuid"] = json!("a1");
    rows.push(attachment);
    let mut result = store.tool_result("r1", "toolu_build", "built");
    result["parentUuid"] = json!("q1");
    rows.push(result);
    let mut answer = store.text("a2", "Built.");
    answer["parentUuid"] = json!("r1");
    rows.push(answer);
    rows[1]["parentUuid"] = json!("u1");
    let branch = active_branch(&rows)
        .into_iter()
        .map(|row| Value::Object(row.into_owned()))
        .collect::<Vec<_>>();
    let turns = reconstruct_turns(&branch, &[], &context());
    assert_eq!(
        turns
            .iter()
            .map(|turn| turn.items.iter().map(item_type).collect::<Vec<_>>())
            .collect::<Vec<_>>(),
        [vec![
            "userMessage",
            "command",
            "taskNotification",
            "agentMessage"
        ]]
    );
    assert_eq!(
        reports(&turns),
        [vec![(TaskNotificationDelivery::MidTurn, "btest0001")]]
    );
}

/// A report woke the agent and the user interrupted it before any message:
/// live, that provider turn ran with the report leading it until the
/// interrupt. History keeps it as an interrupted provider turn that ends at
/// the marker, with the report, and a plain peer wake rebuilds the same turns.
#[test]
fn a_wake_interrupted_before_any_message_keeps_its_reports() {
    let session = |kind: &str| {
        let mut store = Store { seconds: 0 };
        vec![
            store.prompt("u1", "Start."),
            store.text("a1", "Started."),
            store.wake("n1", &test_report(), kind, false),
            store.prompt("i1", "[Request interrupted by user]"),
            store.prompt("u2", "Next."),
            store.text("a2", "Done."),
        ]
    };
    let turns = reconstruct_turns(&session("task-notification"), &[], &context());
    assert_eq!(
        identities(&turns),
        [
            (
                TurnId::from_static("u1"),
                TurnOrigin::User,
                TurnStatus::Completed
            ),
            (
                TurnId::from_static("i1"),
                TurnOrigin::Provider,
                TurnStatus::Interrupted
            ),
            (
                TurnId::from_static("u2"),
                TurnOrigin::User,
                TurnStatus::Completed
            ),
        ]
    );
    assert_eq!(
        reports(&turns),
        [
            vec![],
            vec![(TaskNotificationDelivery::Wake, "btest0001")],
            vec![],
        ]
    );
    assert_eq!(types(&turns[1]), ["taskNotification"]);
    assert_eq!(
        ends(&session("task-notification"), &[])
            .iter()
            .map(|end| end.last_uuid.as_str())
            .collect::<Vec<_>>(),
        ["a1", "i1", "a2"]
    );
    let plain = reconstruct_turns(&session("peer"), &[], &context());
    assert_eq!(identities(&plain), identities(&turns));
    assert_eq!(ordering_violations(&turns), Vec::<String>::new());
}

/// Recorded sessions: the report that woke the agent leads the wake turn and
/// is not its answer; a report queued into a running turn stays where it
/// arrived, and the same task's later idle report leads the turn it woke.
#[test]
fn recorded_sessions_place_reports_where_claude_delivered_them() -> TestResult {
    let turns = reconstruct_turns(
        &messages("background_wake_steer_interrupt")?,
        &[],
        &context(),
    );
    let wake = non_reasoning(&turns[3]);
    let AgentItem::TaskNotification {
        delivery,
        source,
        task_id,
        name,
        status,
        ..
    } = wake[0]
    else {
        return Err("the wake turn does not lead with its report".into());
    };
    assert_eq!(
        (*delivery, source, task_id.as_str(), name.as_str(), *status),
        (
            TaskNotificationDelivery::Wake,
            &TaskNotificationSource::Command {
                agent_thread_id: ()
            },
            "bf30j14g3",
            "Sleep for 25 seconds",
            TaskNotificationStatus::Completed
        )
    );
    assert!(matches!(
        wake[1],
        AgentItem::AgentMessage { phase: MessagePhase::Final, text, .. } if text == "DONE"
    ));

    let turns = reconstruct_turns(
        &messages("interactive_terminal_subagents")?,
        &[],
        &context(),
    );
    assert_eq!(
        reports(&turns),
        [
            vec![(TaskNotificationDelivery::MidTurn, "a1b2c3d4e5f600001")],
            vec![],
            vec![(TaskNotificationDelivery::Wake, "a1b2c3d4e5f600001")],
            vec![],
        ]
    );
    assert_eq!(types(&turns[2]).first(), Some(&"taskNotification"));
    assert_eq!(ordering_violations(&turns), Vec::<String>::new());
    Ok(())
}

/// Local check against a real session file; nothing of it is kept:
/// `CODEWIDE_CLAUDE_SESSION=<file.jsonl> cargo test -p agent-provider-claude real_session_reports -- --ignored --nocapture`.
#[test]
#[ignore = "reads a local Claude session named by CODEWIDE_CLAUDE_SESSION"]
fn real_session_reports() -> TestResult {
    let path = std::env::var("CODEWIDE_CLAUDE_SESSION")?;
    let rows = std::fs::read_to_string(path)?
        .lines()
        .filter_map(|line| serde_json::from_str::<Value>(line).ok())
        .collect::<Vec<_>>();
    let branch = active_branch(&rows)
        .into_iter()
        .map(|row| Value::Object(row.into_owned()))
        .collect::<Vec<_>>();
    let plain = branch
        .iter()
        .cloned()
        .map(|mut row| {
            if row["origin"]["kind"] == "task-notification" {
                row["origin"]["kind"] = json!("peer");
            }
            row
        })
        .collect::<Vec<_>>();
    let turns = reconstruct_turns(&branch, &[], &context());
    let plain_turns = reconstruct_turns(&plain, &[], &context());
    let delivered = reports(&turns);
    let count = |wanted: TaskNotificationDelivery| {
        delivered
            .iter()
            .flatten()
            .filter(|(delivery, _)| *delivery == wanted)
            .count()
    };
    let leading = turns
        .iter()
        .filter(|turn| {
            turn.items
                .iter()
                .find(|item| !matches!(item, AgentItem::Reasoning { .. }))
                .is_some_and(|item| {
                    matches!(
                        item,
                        AgentItem::TaskNotification {
                            delivery: TaskNotificationDelivery::Wake,
                            ..
                        }
                    )
                })
        })
        .count();
    println!(
        "turns {} (plain {}), wake {}, midTurn {}, turns led by a wake report {}, same ids {}, same ends {}, violations {}",
        turns.len(),
        plain_turns.len(),
        count(TaskNotificationDelivery::Wake),
        count(TaskNotificationDelivery::MidTurn),
        leading,
        identities(&turns) == identities(&plain_turns),
        ends(&branch, &[]) == ends(&plain, &[]),
        ordering_violations(&turns).len(),
    );
    assert_eq!(identities(&turns), identities(&plain_turns));
    assert_eq!(ends(&branch, &[]), ends(&plain, &[]));
    Ok(())
}
