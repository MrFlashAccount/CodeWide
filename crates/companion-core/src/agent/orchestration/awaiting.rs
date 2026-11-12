//! A linked child's runtime requests to a person, made visible to its parent.
//!
//! The pending requests themselves belong to the installed
//! [`ChildInputDesk`]; this module only projects them as the agent tools'
//! `awaitingInput` state, announces each one to the parent once with a
//! hidden idle-only notice, and routes the parent's answer back to the desk.
//! A wait that returned the request takes it: its notice is withdrawn while
//! still queued and never sent later. A request that closes (answered in the
//! child thread, or its turn ended) withdraws its still-queued notice.

use std::{
    collections::HashMap,
    sync::{Arc, Mutex, OnceLock},
};

use tokio::sync::broadcast::{Receiver, error::RecvError};
use tracing::{error, info, warn};

use super::{
    Caller, OrchestrationService, ToolError,
    input_requests::{ChildInputDesk, InputAnswerRejection, InputRequest, PendingInput},
    tools::{AnswerRequest, AnswerResult, InputAnswer},
};
use crate::{
    agent::model::{AppThreadId, RuntimeResponse, UserInputAnswer},
    delegated_task_completion::{
        ChildResultNotice, ChildResultReport, DelegatedTaskStatus, serialize,
    },
};

/// Command-id prefix of pending-request notices.
const NOTICE_PREFIX: &str = "agent-input-";

const ANSWER_NOTE: &str = "The agent's turn is blocked on this request. Answer it with codewide_answer_agent (agentThreadId, requestId), or leave it to the user, who can answer it in the agent's thread.";

/// How one announced request was handed to the parent.
#[derive(Clone, Debug, Eq, PartialEq)]
enum Mark {
    /// Its notice command is enqueued (or being enqueued).
    Noticed { command_id: String },
    /// A wait returned it; no notice is sent.
    Taken,
}

/// The parent-facing projection of children's pending requests.
#[derive(Default)]
pub(super) struct InputWatch {
    desk: OnceLock<Arc<dyn ChildInputDesk>>,
    /// Per child thread, per request id.
    marks: Mutex<HashMap<String, HashMap<String, Mark>>>,
}

impl InputWatch {
    fn marks(&self) -> std::sync::MutexGuard<'_, HashMap<String, HashMap<String, Mark>>> {
        self.marks
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }
}

impl OrchestrationService {
    /// Installs the owner of pending runtime requests and starts announcing
    /// linked children's requests to their parents. Installed at most once.
    pub(crate) fn install_input_desk(self: &Arc<Self>, desk: Arc<dyn ChildInputDesk>) {
        let receiver = desk.subscribe();
        if self.inputs.desk.set(desk).is_err() {
            warn!("a second runtime request owner was not installed");
            return;
        }
        let service = Arc::downgrade(self);
        tokio::spawn(async move {
            let mut changes = receiver;
            // Pending requests live only in this process: a notice left
            // queued by an earlier one names a request that no longer exists.
            // A request still open is announced again from its next change.
            if let Some(service) = service.upgrade() {
                match service
                    .turn_delivery
                    .retract_open_notices(NOTICE_PREFIX)
                    .await
                {
                    Ok(0) => {}
                    Ok(count) => info!(count, "stale pending-request notices were withdrawn"),
                    Err(error) => {
                        error!(err = ?error, "stale pending-request notices could not be withdrawn");
                    }
                }
            }
            loop {
                let threads = match changes.recv().await {
                    Ok(thread) => vec![thread],
                    Err(RecvError::Lagged(_)) => {
                        let Some(service) = service.upgrade() else {
                            return;
                        };
                        service.followed_input_threads()
                    }
                    Err(RecvError::Closed) => return,
                };
                let Some(service) = service.upgrade() else {
                    return;
                };
                for thread in threads {
                    service.refresh_inputs(&thread).await;
                }
            }
        });
    }

    /// Threads whose requests may have changed while the signal lagged.
    fn followed_input_threads(&self) -> Vec<String> {
        let mut threads = self.inputs.marks().keys().cloned().collect::<Vec<_>>();
        for (child, _) in self.tracker.running() {
            if !threads.contains(&child) {
                threads.push(child);
            }
        }
        threads
    }

    /// The child's pending requests to a person, oldest first.
    pub(super) async fn pending_input(&self, child: &AppThreadId) -> Vec<PendingInput> {
        match self.inputs.desk.get() {
            Some(desk) => desk.pending(child).await,
            None => Vec::new(),
        }
    }

    /// Subscribes to request changes before a waiter's first check, so a
    /// request opened in between still wakes it.
    pub(super) fn subscribe_inputs(&self) -> Option<Receiver<String>> {
        self.inputs.desk.get().map(|desk| desk.subscribe())
    }

    /// Resolves once the child has a pending request; never without a desk.
    pub(super) async fn next_awaiting(
        &self,
        child: &AppThreadId,
        changes: Option<Receiver<String>>,
    ) -> Vec<PendingInput> {
        let Some(mut changes) = changes else {
            return std::future::pending().await;
        };
        loop {
            let pending = self.pending_input(child).await;
            if !pending.is_empty() {
                return pending;
            }
            loop {
                match changes.recv().await {
                    Ok(thread) if thread == child.as_str() => break,
                    Ok(_) => {}
                    Err(RecvError::Lagged(_)) => break,
                    Err(RecvError::Closed) => return std::future::pending().await,
                }
            }
        }
    }

    /// A wait returned these requests to the parent: their notices are
    /// withdrawn while still queued and never sent later.
    pub(super) async fn take_inputs(&self, child: &AppThreadId, inputs: &[PendingInput]) {
        let retract = {
            let mut marks = self.inputs.marks();
            let entry = marks.entry(child.as_str().to_owned()).or_default();
            inputs
                .iter()
                .filter_map(
                    |input| match entry.insert(input.request_id.clone(), Mark::Taken) {
                        Some(Mark::Noticed { command_id }) => Some(command_id),
                        Some(Mark::Taken) | None => None,
                    },
                )
                .collect::<Vec<_>>()
        };
        for command_id in retract {
            self.retract_input_notice(&command_id).await;
        }
    }

    /// Reconciles one thread's announced requests with its pending ones.
    async fn refresh_inputs(&self, thread: &str) {
        let Some(child) = AppThreadId::parse(thread) else {
            return;
        };
        let link = match self.links.link_of(thread).await {
            Ok(Some(link)) => link,
            Ok(None) => return,
            Err(err) => {
                error!(err = ?err, child_thread_id = %child, "subagent link is unreadable; its pending request is not announced");
                return;
            }
        };
        let pending = self.pending_input(&child).await;
        let (announce, retract) = {
            let mut marks = self.inputs.marks();
            let entry = marks.entry(thread.to_owned()).or_default();
            let mut retract = Vec::new();
            entry.retain(|request_id, mark| {
                let open = pending.iter().any(|input| &input.request_id == request_id);
                if !open && let Mark::Noticed { command_id } = mark {
                    retract.push(command_id.clone());
                }
                open
            });
            let mut announce = Vec::new();
            for input in &pending {
                if entry.contains_key(&input.request_id) {
                    continue;
                }
                let command_id = notice_command_id(&link.parent_thread_id, thread, input);
                entry.insert(
                    input.request_id.clone(),
                    Mark::Noticed {
                        command_id: command_id.clone(),
                    },
                );
                announce.push((command_id, input.clone()));
            }
            if entry.is_empty() {
                marks.remove(thread);
            }
            (announce, retract)
        };
        for command_id in retract {
            self.retract_input_notice(&command_id).await;
        }
        for (command_id, input) in announce {
            let report = ChildResultReport {
                request_id: command_id.clone(),
                task_id: link.task_id.clone(),
                agent_thread_id: Some(thread.to_owned()),
                turn_id: input.turn_id.clone(),
                name: link.name.clone(),
                status: DelegatedTaskStatus::AwaitingInput,
                final_message: None,
                result_truncated: false,
                note: Some(ANSWER_NOTE.to_owned()),
                cost: None,
                pending_input: Some(input.clone()),
            };
            let enqueued = match serialize(ChildResultNotice::awaiting_input(report)) {
                Ok(message) => self
                    .turn_delivery
                    .enqueue_notice(&command_id, &link.parent_thread_id, message)
                    .await
                    .map_err(|error| error.to_string()),
                Err(error) => Err(error.to_string()),
            };
            match enqueued {
                Ok(()) => {
                    info!(parent_thread_id = %link.parent_thread_id, child_thread_id = %child, "a child's pending request was announced to its parent");
                }
                Err(error) => {
                    error!(error = %error, parent_thread_id = %link.parent_thread_id, child_thread_id = %child, "a child's pending request could not be announced");
                }
            }
            // A wait may have taken the request while the notice was written.
            let taken = self
                .inputs
                .marks()
                .get(thread)
                .and_then(|entry| entry.get(&input.request_id))
                .is_some_and(|mark| *mark == Mark::Taken);
            if taken {
                self.retract_input_notice(&command_id).await;
            }
        }
    }

    async fn retract_input_notice(&self, command_id: &str) {
        if let Err(error) = self.turn_delivery.retract_notice(command_id).await {
            error!(err = ?error, command_id, "a pending-request notice could not be withdrawn");
        }
    }

    /// `codewide_answer_agent`: answers one pending request of the caller's
    /// child through the desk; the first answer (the user's in the child
    /// thread, or this one) wins.
    pub(super) async fn answer(
        &self,
        caller: &Caller,
        request: AnswerRequest,
    ) -> Result<AnswerResult, ToolError> {
        self.child_provider(caller, &request.child).await?;
        let Some(desk) = self.inputs.desk.get() else {
            return Err(ToolError::message(
                "answering agent requests is unavailable on this host",
            ));
        };
        let pending = desk.pending(&request.child).await;
        let Some(input) = pending
            .iter()
            .find(|input| input.request_id == request.request_id)
        else {
            return Err(InputAnswerRejection::NotPending
                .message(&request.request_id)
                .into());
        };
        let response = runtime_response(&input.request, request.answer)
            .map_err(|reason| format!("request {}: {reason}", request.request_id))?;
        desk.respond(&request.child, &request.request_id, response)
            .await
            .map_err(|rejection| ToolError::message(rejection.message(&request.request_id)))?;
        // The request closes now; its refresh withdraws a still-queued notice.
        Ok(AnswerResult::answered())
    }
}

/// The neutral response of a parent's answer, checked against the request.
fn runtime_response(
    request: &InputRequest,
    answer: InputAnswer,
) -> Result<RuntimeResponse, String> {
    match (request, answer) {
        (InputRequest::UserInput { questions }, InputAnswer::Answers(answers)) => {
            if let Some(unknown) = answers
                .keys()
                .find(|id| !questions.iter().any(|question| &question.id == *id))
            {
                return Err(format!(
                    "{unknown} is not a question id of this request; use the ids it lists"
                ));
            }
            if answers.is_empty() {
                return Err("answers must answer at least one question".into());
            }
            Ok(RuntimeResponse::UserInput {
                answers: answers
                    .into_iter()
                    .map(|(id, answers)| (id, UserInputAnswer { answers }))
                    .collect(),
            })
        }
        (InputRequest::Approval { decisions, .. }, InputAnswer::Decision(decision)) => {
            if !decisions.is_empty() && !decisions.contains(&decision) {
                return Err("this decision is not one the request accepts".into());
            }
            Ok(RuntimeResponse::Approval { decision })
        }
        (InputRequest::UserInput { .. }, InputAnswer::Decision(_)) => {
            Err("a user-input request is answered with answers, not a decision".into())
        }
        (InputRequest::Approval { .. }, InputAnswer::Answers(_)) => {
            Err("an approval is answered with a decision, not answers".into())
        }
        (InputRequest::Permissions { .. } | InputRequest::Elicitation { .. }, _) => Err(
            "this kind of request can only be answered by the user in the agent's thread".into(),
        ),
    }
}

/// One notice command per parent, child, turn and request.
fn notice_command_id(parent: &str, child: &str, input: &PendingInput) -> String {
    let mut hasher = blake3::Hasher::new();
    for part in [
        parent,
        child,
        input.turn_id.as_deref().unwrap_or(""),
        input.request_id.as_str(),
    ] {
        hasher.update(part.as_bytes());
        hasher.update(&[0]);
    }
    format!("{NOTICE_PREFIX}{}", hasher.finalize().to_hex())
}
