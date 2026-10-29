//! Shared orchestration test harness support.

use super::*;

pub(super) fn observe_pump_events(
    service: Arc<OrchestrationService>,
    mut events: tokio::sync::mpsc::Receiver<Value>,
) {
    tokio::spawn(async move {
        while let Some(event) = events.recv().await {
            let thread = event
                .pointer("/params/data/0/remoteThreadId")
                .and_then(Value::as_str)
                .and_then(AppThreadId::parse);
            let provider = match thread {
                Some(thread) => service
                    .gateway
                    .bindings()
                    .provider_of(&thread)
                    .await
                    .ok()
                    .flatten()
                    .unwrap_or_else(|| ProviderId::from_static("codex")),
                None => ProviderId::from_static("codex"),
            };
            service.observe_event(&provider, &event);
        }
    });
}

/// Applies a durable delivery receipt for `command_id`: the only path that
/// binds a request (and its task) to a provider turn.
pub(super) async fn receipt(
    journal: &crate::agent::orchestration::journal::TaskJournal,
    command_id: &str,
    child: &str,
    turn: &str,
) -> Result<(), crate::agent::orchestration::journal::JournalError> {
    journal
        .bind_stored_receipt(command_id.to_owned(), child.to_owned(), turn.to_owned())
        .await
        .map(|_| ())
}

/// Applies an authenticated terminal turn fact; returns the task it ended.
pub(super) async fn terminal(
    journal: &crate::agent::orchestration::journal::TaskJournal,
    provider: &ProviderId,
    child: &str,
    turn: &str,
    end: crate::agent::client_wire::observe::TurnEnd,
) -> Result<
    Option<crate::agent::orchestration::journal::TaskBundle>,
    crate::agent::orchestration::journal::JournalError,
> {
    let turn = crate::agent::model::TurnId::parse(turn).ok_or_else(|| {
        crate::agent::orchestration::journal::JournalError::InvalidTransition(
            "invalid turn id".into(),
        )
    })?;
    for settled in journal
        .settle_by_turn(provider, child, &turn, end, 0)
        .await?
    {
        if let Some(task_id) = settled.task_id {
            return journal.get(&task_id).await.map(Some);
        }
    }
    Ok(None)
}
