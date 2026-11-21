//! A child's pending request to a person is visible to its parent: the
//! agent tools report `awaitingInput`, a wait returns at once, the parent gets
//! one notice per request and can answer it; the user's own answer in the
//! child thread wins over a later parent answer.

use std::{collections::HashMap, sync::Mutex};

use async_trait::async_trait;

use super::{
    notification_tests::{
        delegate_from_claude, eventually, notice_count, notices, running_turn, settle_window,
        spawn_from_claude,
    },
    *,
};
use crate::agent::{
    model::{ApprovalDecision, RuntimeResponse},
    orchestration::input_requests::{
        ApprovalAction, ChildInputDesk, InputAnswerRejection, InputOption, InputQuestion,
        InputRequest, PendingInput,
    },
};

const CLAUDE: &str = "claude";

/// A desk over scripted pending requests: answering resolves the request.
struct FakeDesk {
    pending: Mutex<HashMap<String, Vec<PendingInput>>>,
    answered: Mutex<Vec<(String, String, RuntimeResponse)>>,
    changes: tokio::sync::broadcast::Sender<String>,
}

impl FakeDesk {
    fn install(harness: &Harness) -> Arc<Self> {
        let desk = Arc::new(Self {
            pending: Mutex::new(HashMap::new()),
            answered: Mutex::new(Vec::new()),
            changes: tokio::sync::broadcast::channel(16).0,
        });
        harness.service.install_input_desk(desk.clone());
        desk
    }

    fn open(&self, child: &AppThreadId, input: PendingInput) {
        self.lock()
            .entry(child.as_str().to_owned())
            .or_default()
            .push(input);
        let _ = self.changes.send(child.as_str().to_owned());
    }

    /// The user answered in the child thread (or the turn ended).
    fn close(&self, child: &AppThreadId, request_id: &str) {
        if let Some(inputs) = self.lock().get_mut(child.as_str()) {
            inputs.retain(|input| input.request_id != request_id);
        }
        let _ = self.changes.send(child.as_str().to_owned());
    }

    /// A repeated change signal for an unchanged pending set.
    fn touch(&self, child: &AppThreadId) {
        let _ = self.changes.send(child.as_str().to_owned());
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, HashMap<String, Vec<PendingInput>>> {
        self.pending
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    fn answered(&self) -> Vec<(String, String, RuntimeResponse)> {
        self.answered
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clone()
    }
}

#[async_trait]
impl ChildInputDesk for FakeDesk {
    async fn pending(&self, thread: &AppThreadId) -> Vec<PendingInput> {
        self.lock()
            .get(thread.as_str())
            .cloned()
            .unwrap_or_default()
    }

    async fn respond(
        &self,
        thread: &AppThreadId,
        request_id: &str,
        response: RuntimeResponse,
    ) -> Result<(), InputAnswerRejection> {
        let removed = self.lock().get_mut(thread.as_str()).is_some_and(|inputs| {
            let before = inputs.len();
            inputs.retain(|input| input.request_id != request_id);
            inputs.len() != before
        });
        if !removed {
            return Err(InputAnswerRejection::NotPending);
        }
        self.answered
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .push((thread.as_str().to_owned(), request_id.to_owned(), response));
        let _ = self.changes.send(thread.as_str().to_owned());
        Ok(())
    }

    fn subscribe(&self) -> tokio::sync::broadcast::Receiver<String> {
        self.changes.subscribe()
    }
}

fn question(request_id: &str, turn: &TurnId) -> PendingInput {
    PendingInput {
        request_id: request_id.into(),
        turn_id: Some(turn.as_str().to_owned()),
        request: InputRequest::UserInput {
            questions: vec![InputQuestion {
                id: "language".into(),
                header: Some("Language".into()),
                question: "Which language should the tool use?".into(),
                options: vec![
                    InputOption {
                        label: "Rust".into(),
                        description: Some("Matches the crate".into()),
                    },
                    InputOption {
                        label: "Go".into(),
                        description: None,
                    },
                ],
                allows_other: true,
                secret: false,
            }],
        },
    }
}

fn approval(request_id: &str, turn: &TurnId) -> PendingInput {
    PendingInput {
        request_id: request_id.into(),
        turn_id: Some(turn.as_str().to_owned()),
        request: InputRequest::Approval {
            action: ApprovalAction::Command,
            title: Some("Run a command".into()),
            command: Some("cargo publish".into()),
            cwd: Some("/repo".into()),
            reason: Some("Publish the crate".into()),
            decisions: vec![ApprovalDecision::Accept, ApprovalDecision::Decline],
        },
    }
}

async fn list_entry(harness: &Harness, child: &AppThreadId) -> Value {
    let (success, listed) = call(
        &harness.service,
        CLAUDE,
        CLAUDE_PARENT,
        "codewide_list_agents",
        json!({}),
    )
    .await;
    assert!(success, "{listed}");
    listed["agents"]
        .as_array()
        .and_then(|agents| {
            agents
                .iter()
                .find(|agent| agent["agentThreadId"] == child.as_str())
        })
        .cloned()
        .unwrap_or(Value::Null)
}

async fn answer(harness: &Harness, child: &AppThreadId, arguments: Value) -> (bool, Value) {
    let mut arguments = arguments;
    arguments["agentThreadId"] = json!(child.as_str());
    call(
        &harness.service,
        CLAUDE,
        CLAUDE_PARENT,
        "codewide_answer_agent",
        arguments,
    )
    .await
}

/// The parent's queued (not yet dispatched) commands.
async fn parent_commands(
    harness: &Harness,
) -> Result<Vec<crate::store::OutboxCommand>, Box<dyn std::error::Error>> {
    Ok(harness
        .service
        .turn_delivery
        .list(Some(CLAUDE_PARENT))
        .await?)
}

#[tokio::test]
async fn a_child_question_is_listed_announced_once_and_answered_by_the_parent() -> TestResult {
    let harness = harness(":workspace").await?;
    let desk = FakeDesk::install(&harness);
    let child = spawn_from_claude(&harness, "build").await?;
    let turn = running_turn(&harness, &child, &[]).await?;
    desk.open(&child, question("ask-1", &turn));

    let listed = list_entry(&harness, &child).await;
    assert_eq!(listed["status"], "awaitingInput");
    let pending = &listed["pendingInput"][0];
    assert_eq!(pending["requestId"], "ask-1");
    assert_eq!(pending["kind"], "userInput");
    assert_eq!(
        pending["questions"][0]["question"],
        "Which language should the tool use?"
    );
    assert_eq!(pending["questions"][0]["options"][0]["label"], "Rust");
    assert_eq!(pending["questions"][0]["options"][1]["label"], "Go");

    let received = notice_count(&harness, 1).await?;
    let report = &received[0]["reports"][0];
    assert_eq!(report["status"], "awaitingInput");
    assert_eq!(report["agentThreadId"], child.as_str());
    assert_eq!(report["turnId"], turn.as_str());
    assert_eq!(report["pendingInput"]["requestId"], "ask-1");
    assert_eq!(
        report["pendingInput"]["questions"][0]["question"],
        "Which language should the tool use?"
    );
    // Still pending and signalled again: no second notice.
    desk.touch(&child);
    settle_window().await;
    assert_eq!(notices(&harness).len(), 1);

    let (success, mismatch) = answer(
        &harness,
        &child,
        json!({"requestId": "ask-1", "decision": "accept"}),
    )
    .await;
    assert!(!success);
    assert!(
        mismatch
            .as_str()
            .is_some_and(|text| text.contains("answered with answers")),
        "{mismatch}"
    );
    let (success, unknown) = answer(
        &harness,
        &child,
        json!({"requestId": "ask-1", "answers": {"colour": "red"}}),
    )
    .await;
    assert!(!success, "{unknown}");
    assert!(desk.answered().is_empty());

    let (success, answered) = answer(
        &harness,
        &child,
        json!({"requestId": "ask-1", "answers": {"language": "Rust"}}),
    )
    .await;
    assert!(success, "{answered}");
    assert_eq!(answered, json!({"status": "answered"}));
    let recorded = desk.answered();
    assert_eq!(recorded.len(), 1);
    assert_eq!(recorded[0].0, child.as_str());
    assert_eq!(recorded[0].1, "ask-1");
    assert_eq!(
        serde_json::to_value(&recorded[0].2)?,
        json!({"type": "userInput", "answers": {"language": {"answers": ["Rust"]}}})
    );
    let listed = list_entry(&harness, &child).await;
    assert_eq!(listed["status"], "running");
    assert!(listed.get("pendingInput").is_none(), "{listed}");
    settle_window().await;
    assert_eq!(notices(&harness).len(), 1);
    Ok(())
}

#[tokio::test]
async fn a_waiting_parent_returns_promptly_and_is_not_notified_again() -> TestResult {
    let harness = harness(":workspace").await?;
    let desk = FakeDesk::install(&harness);
    harness
        .claude
        .set_status(CLAUDE_PARENT, ThreadStatus::Active);
    let child = spawn_from_claude(&harness, "build").await?;
    let turn = running_turn(&harness, &child, &[]).await?;
    let service = harness.service.clone();
    let wait_child = child.clone();
    let wait = tokio::spawn(async move {
        call(
            &service,
            CLAUDE,
            CLAUDE_PARENT,
            "codewide_wait_agent",
            json!({"agentThreadId": wait_child.as_str(), "timeoutSeconds": 300}),
        )
        .await
    });
    eventually("the waiter", async || {
        Ok(harness
            .service
            .tracker
            .has_waiters(child.as_str())
            .then_some(()))
    })
    .await?;
    desk.open(&child, question("ask-1", &turn));
    let (success, waited) = tokio::time::timeout(Duration::from_secs(5), wait)
        .await
        .map_err(|_| "the wait did not return when the child started waiting")??;
    assert!(success, "{waited}");
    assert_eq!(waited["status"], "awaitingInput");
    assert_eq!(waited["turnId"], turn.as_str());
    assert_eq!(waited["pendingInput"][0]["requestId"], "ask-1");
    assert_eq!(waited["pendingInput"][0]["questions"][0]["id"], "language");

    // The wait took it: a notice written meanwhile is withdrawn, none later.
    eventually("no queued notice", async || {
        Ok(parent_commands(&harness).await?.is_empty().then_some(()))
    })
    .await?;
    harness.claude.set_status(CLAUDE_PARENT, ThreadStatus::Idle);
    desk.touch(&child);
    settle_window().await;
    assert!(notices(&harness).is_empty());

    // Still blocked: another wait reports it at once.
    let (success, again) = tokio::time::timeout(
        Duration::from_secs(5),
        call(
            &harness.service,
            CLAUDE,
            CLAUDE_PARENT,
            "codewide_wait_agent",
            json!({"agentThreadId": child.as_str(), "timeoutSeconds": 300}),
        ),
    )
    .await
    .map_err(|_| "a wait on a blocked child did not return")?;
    assert!(success, "{again}");
    assert_eq!(again["status"], "awaitingInput");
    Ok(())
}

#[tokio::test]
async fn the_users_answer_in_the_child_thread_wins_over_a_late_parent_answer() -> TestResult {
    let harness = harness(":workspace").await?;
    let desk = FakeDesk::install(&harness);
    harness
        .claude
        .set_status(CLAUDE_PARENT, ThreadStatus::Active);
    let child = spawn_from_claude(&harness, "build").await?;
    let turn = running_turn(&harness, &child, &[]).await?;
    desk.open(&child, question("ask-1", &turn));
    eventually("the queued notice", async || {
        Ok(parent_commands(&harness)
            .await?
            .into_iter()
            .find(|command| command.command_id.starts_with("agent-input-")))
    })
    .await?;

    desk.close(&child, "ask-1");
    eventually("the withdrawn notice", async || {
        Ok(parent_commands(&harness).await?.is_empty().then_some(()))
    })
    .await?;
    let listed = list_entry(&harness, &child).await;
    assert_eq!(listed["status"], "running");

    let (success, late) = answer(
        &harness,
        &child,
        json!({"requestId": "ask-1", "answers": {"language": "Go"}}),
    )
    .await;
    assert!(!success);
    assert!(
        late.as_str()
            .is_some_and(|text| text.contains("no longer pending")),
        "{late}"
    );
    assert!(desk.answered().is_empty());
    harness.claude.set_status(CLAUDE_PARENT, ThreadStatus::Idle);
    settle_window().await;
    assert!(notices(&harness).is_empty());
    Ok(())
}

#[tokio::test]
async fn an_approval_is_reported_and_decided_by_the_parent() -> TestResult {
    let harness = harness(":workspace").await?;
    let desk = FakeDesk::install(&harness);
    let child = spawn_from_claude(&harness, "build").await?;
    let turn = running_turn(&harness, &child, &[]).await?;
    desk.open(&child, approval("approve-1", &turn));

    let (success, waited) = call(
        &harness.service,
        CLAUDE,
        CLAUDE_PARENT,
        "codewide_wait_agent",
        json!({"agentThreadId": child.as_str(), "timeoutSeconds": 300}),
    )
    .await;
    assert!(success, "{waited}");
    assert_eq!(waited["status"], "awaitingInput");
    let pending = &waited["pendingInput"][0];
    assert_eq!(pending["kind"], "approval");
    assert_eq!(pending["action"], "command");
    assert_eq!(pending["command"], "cargo publish");
    assert_eq!(pending["reason"], "Publish the crate");
    assert_eq!(pending["decisions"], json!(["accept", "decline"]));

    let (success, refused) = answer(
        &harness,
        &child,
        json!({"requestId": "approve-1", "decision": "acceptForSession"}),
    )
    .await;
    assert!(!success, "{refused}");
    let (success, decided) = answer(
        &harness,
        &child,
        json!({"requestId": "approve-1", "decision": "accept"}),
    )
    .await;
    assert!(success, "{decided}");
    assert_eq!(
        desk.answered()
            .into_iter()
            .map(|(_, id, response)| (id, response))
            .collect::<Vec<_>>(),
        [(
            "approve-1".to_owned(),
            RuntimeResponse::Approval {
                decision: ApprovalDecision::Accept
            }
        )]
    );
    let (success, again) = answer(
        &harness,
        &child,
        json!({"requestId": "approve-1", "decision": "accept"}),
    )
    .await;
    assert!(!success);
    assert!(
        again
            .as_str()
            .is_some_and(|text| text.contains("no longer pending")),
        "{again}"
    );
    Ok(())
}

#[tokio::test]
async fn a_task_wait_returns_awaiting_input_promptly() -> TestResult {
    let harness = harness(":workspace").await?;
    let desk = FakeDesk::install(&harness);
    let delegated = delegate_from_claude(&harness).await?;
    let task_id = delegated["taskId"].as_str().ok_or("no task id")?.to_owned();
    let child = AppThreadId::parse(
        delegated["agentThreadId"]
            .as_str()
            .ok_or("no agent thread")?,
    )
    .ok_or("invalid child")?;
    let turn = running_turn(&harness, &child, &[]).await?;
    let service = harness.service.clone();
    let wait_task = task_id.clone();
    let wait = tokio::spawn(async move {
        call(
            &service,
            CLAUDE,
            CLAUDE_PARENT,
            "codewide_wait_task",
            json!({"taskId": wait_task, "timeoutSeconds": 300}),
        )
        .await
    });
    settle_window().await;
    desk.open(&child, question("ask-1", &turn));
    let (success, waited) = tokio::time::timeout(Duration::from_secs(5), wait)
        .await
        .map_err(|_| "the task wait did not return when the child started waiting")??;
    assert!(success, "{waited}");
    assert_eq!(waited["taskId"], task_id.as_str());
    assert_eq!(waited["status"], "awaitingInput");
    assert_eq!(waited["agentThreadId"], child.as_str());
    assert_eq!(waited["pendingInput"][0]["requestId"], "ask-1");

    desk.close(&child, "ask-1");
    let (success, running) = call(
        &harness.service,
        CLAUDE,
        CLAUDE_PARENT,
        "codewide_wait_task",
        json!({"taskId": task_id, "timeoutSeconds": 0}),
    )
    .await;
    assert!(success, "{running}");
    assert_eq!(running["status"], "running");
    assert!(running.get("pendingInput").is_none(), "{running}");
    Ok(())
}
