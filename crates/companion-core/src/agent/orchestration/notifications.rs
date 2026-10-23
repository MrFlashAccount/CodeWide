//! Deferred completion -> durable parent message handoff.
//!
//! Coordination keeps only a command reference. Turn delivery owns the result
//! message, idle-only dispatch, retries, receipts and uncertain-start recovery.

use std::{sync::Arc, time::Duration};

use serde_json::json;
use tracing::warn;

use crate::agent::model::AppThreadId;

use super::{
    OrchestrationService, ToolError,
    delivery::TerminalPayload,
    task::{DeliveryProgress, ParentDeliveryState, TaskId},
};

/// Even worst-case JSON escaping leaves the message below the outbox's 1 MiB
/// limit. The full result remains readable through `wait_task` or provider history.
const MAX_RESULT_CHARACTERS: usize = 32_000;
const RETRY_DELAY: Duration = Duration::from_secs(5);

impl OrchestrationService {
    pub(super) fn start_completion_delivery(self: &Arc<Self>) {
        let mut signals = self.task_signals.subscribe();
        let service = Arc::downgrade(self);
        tokio::spawn(async move {
            loop {
                let Some(service) = service.upgrade() else {
                    return;
                };
                let retry = service.push_pending_completions().await;
                drop(service);
                tokio::select! {
                    signal = signals.recv() => {
                        if matches!(signal, Err(tokio::sync::broadcast::error::RecvError::Closed)) { return; }
                    }
                    () = tokio::time::sleep(RETRY_DELAY), if retry => {}
                }
            }
        });
    }

    async fn push_pending_completions(&self) -> bool {
        let tasks = match self.task_journal.pending_completions().await {
            Ok(tasks) => tasks,
            Err(error) => {
                warn!(err = ?error, "deferred completion scan failed");
                return true;
            }
        };
        let mut retry = false;
        for task in tasks {
            match self.push_completion(&task).await {
                Ok(ready) => retry |= !ready,
                Err(error) => {
                    warn!(err = ?error, task_id = %task.as_str(), "deferred completion handoff failed");
                    retry = true;
                }
            }
        }
        retry
    }

    /// Returns false only while authoritative result history is unavailable.
    pub(super) async fn push_completion(&self, task_id: &TaskId) -> Result<bool, ToolError> {
        let bundle = self.task_journal.get(task_id).await?;
        if !bundle.task.state.is_terminal()
            || bundle.delivery.progress
                != (DeliveryProgress::ParentTurn {
                    state: ParentDeliveryState::AwaitingResume,
                })
        {
            return Ok(true);
        }
        let TerminalPayload::Ready { mut message, cost } = self.terminal_payload(&bundle).await?
        else {
            return Ok(false);
        };
        let truncated = message.as_mut().is_some_and(truncate_result);
        let notice = format!(
            "CodeWide delegated task finished:\n{}",
            json!({
                "taskId": bundle.task.task_id.as_str(),
                "attemptId": bundle.task.authoritative_attempt_id.as_str(),
                "agentThreadId": bundle.attempt.state.child_thread_id().map(AppThreadId::as_str),
                "status": bundle.task.state,
                "finalMessage": message,
                "resultTruncated": truncated,
                "cost": cost,
            })
        );
        let handed_off = self
            .task_journal
            .enqueue_completion(task_id, move |write, command, parent| {
                crate::turn_delivery::enqueue_completion_in_write(write, command, parent, &notice)
            })
            .await?;
        if handed_off {
            self.turn_delivery.wake();
            self.turn_delivery
                .emit_changed(bundle.task.parent_thread_id.as_str())
                .await;
        }
        Ok(true)
    }
}

fn truncate_result(message: &mut String) -> bool {
    let Some((boundary, _)) = message.char_indices().nth(MAX_RESULT_CHARACTERS) else {
        return false;
    };
    message.truncate(boundary);
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn large_results_are_bounded_without_splitting_unicode() {
        let mut result = "🦀".repeat(MAX_RESULT_CHARACTERS + 1);
        assert!(truncate_result(&mut result));
        assert_eq!(result.chars().count(), MAX_RESULT_CHARACTERS);
        assert!(!truncate_result(&mut result));
        assert_eq!(result.chars().last(), Some('🦀'));
    }
}
