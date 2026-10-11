//! Watches rollout files written by other Codex App Server processes and
//! turns them into semantic thread invalidations for the sync hub's journal.
//! Every filesystem echo of one thread is coalesced, but the trailing write
//! is never discarded: it is the canonical repair boundary for a live
//! projection.

use std::{
    collections::HashMap,
    sync::Arc,
    time::{Duration, Instant},
};

use serde_json::Value;

use crate::{
    history_service::HistoryService, resources::ResourceService, rollout_monitor::RolloutChange,
};

const ROLLOUT_RECONCILIATION_POLL: Duration = Duration::from_millis(50);
const ROLLOUT_RECONCILIATION_RETRY: Duration = Duration::from_secs(1);

/// Runs until the change stream closes and every pending thread is reconciled.
pub(super) async fn forward(
    mut changes: tokio::sync::mpsc::Receiver<RolloutChange>,
    history: HistoryService,
    ingest: tokio::sync::mpsc::Sender<Value>,
    resources: Option<Arc<ResourceService>>,
) {
    let mut pending = HashMap::<String, RolloutChange>::new();
    let mut retry_after = HashMap::<String, Instant>::new();
    let mut changes_open = true;
    let mut poll = tokio::time::interval(ROLLOUT_RECONCILIATION_POLL);
    poll.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    loop {
        tokio::select! {
            change = changes.recv(), if changes_open => {
                match change {
                    Some(change) => {
                        history.observe_rollout_change(&change);
                        if let Some(resource_service) = &resources {
                            resource_service.schedule_prewarm(&change.thread_id);
                        }
                        // Coalesce every filesystem echo for one thread, but
                        // never discard the trailing write. That final write is
                        // the canonical repair boundary for a live projection.
                        let thread_id = change.thread_id.clone();
                        pending.insert(thread_id.clone(), change);
                        retry_after.remove(&thread_id);
                    }
                    None => changes_open = false,
                }
            }
            _ = poll.tick(), if !pending.is_empty() => {
                let now = Instant::now();
                let due = pending.keys().filter(|thread_id| {
                    retry_after.get(*thread_id).is_none_or(|retry_at| *retry_at <= now)
                }).cloned().collect::<Vec<_>>();
                for thread_id in due {
                    let Some(change) = pending.get(&thread_id).cloned() else {
                        continue;
                    };
                    match history.rollout_invalidation_event(change).await {
                        Ok(payload) => {
                            pending.remove(&thread_id);
                            retry_after.remove(&thread_id);
                            if let Some(payload) = payload
                                && ingest.send(payload).await.is_err() {
                                    return;
                                }
                        }
                        Err(error) => {
                            tracing::warn!(thread_id, %error, "canonical rollout reconciliation failed");
                            retry_after.insert(thread_id, Instant::now() + ROLLOUT_RECONCILIATION_RETRY);
                        }
                    }
                }
            }
        }
        if !changes_open && pending.is_empty() {
            return;
        }
    }
}

#[cfg(test)]
mod tests {
    use std::io::Write;

    use serde_json::json;

    use super::*;

    #[tokio::test]
    async fn rollout_echoes_publish_one_semantic_reconciliation_without_a_silence_window()
    -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let directory = tempfile::tempdir()?;
        let thread_id = "019fe7af-e2fa-70f3-88e8-99d59e10bd63";
        let sessions = directory.path().join("sessions/2026/08/18");
        std::fs::create_dir_all(&sessions)?;
        let path = sessions.join(format!("rollout-2026-08-18T12-00-00-{thread_id}.jsonl"));
        let mut rollout = std::fs::File::create(&path)?;
        for line in [
            json!({"type":"event_msg","payload":{"type":"task_started","turn_id":"turn"}}),
            json!({"type":"event_msg","payload":{"type":"user_message","message":"Question"}}),
            json!({"type":"event_msg","payload":{"type":"agent_message","message":"Complete answer"}}),
            json!({"type":"event_msg","payload":{"type":"task_complete","turn_id":"turn","last_agent_message":"Complete answer"}}),
        ] {
            writeln!(rollout, "{line}")?;
        }
        rollout.sync_all()?;

        let store = Arc::new(crate::test_support::open_rollout_store(
            directory.path().join("state.redb"),
        )?);
        let history = HistoryService::new(
            Arc::new(crate::catalog::SessionCatalog::scan(directory.path())),
            store,
        );
        let (change_tx, change_rx) = tokio::sync::mpsc::channel(4);
        let (ingest_tx, mut ingest_rx) = tokio::sync::mpsc::channel(4);
        for _ in 0..2 {
            change_tx
                .send(crate::rollout_monitor::RolloutChange {
                    thread_id: thread_id.to_owned(),
                    path: path.clone(),
                    archived: false,
                })
                .await?;
        }
        drop(change_tx);
        let forwarder = tokio::spawn(forward(change_rx, history, ingest_tx, None));

        let repaired = tokio::time::timeout(Duration::from_millis(300), ingest_rx.recv())
            .await?
            .ok_or("semantic reconciliation was not emitted")?;
        assert_eq!(repaired["method"], "companion/thread/invalidated");
        assert_eq!(repaired["params"]["threadId"], thread_id);
        forwarder.await?;
        assert!(
            ingest_rx.recv().await.is_none(),
            "coalesced rollout writes must not emit duplicate reconciliation events"
        );
        Ok(())
    }
}
