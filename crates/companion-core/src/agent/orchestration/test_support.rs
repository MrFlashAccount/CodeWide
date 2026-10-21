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
