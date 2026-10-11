//! The client-wire provider list: `companion/agentProviders/read` and its
//! durable change notification `companion/agentProviders/changed`
//! (`AgentProvidersReadResult` in `packages/agent-protocol`).
//!
//! Every configured provider is listed with its status (transport lifecycle
//! plus the provider's own health), its sign-in state and its declared
//! capabilities; disabled providers follow the enabled ones. The host-level
//! capabilities say which connection-scoped features some enabled provider
//! serves. Credentials never pass through here: the sign-in state is a flag,
//! an opaque plan label and, when the provider reports it, the signed-in
//! account label (email or organization) that the client shows like a pool
//! account's email. A provider that reports provider-level subscription
//! limits (Claude) also lists its latest `rateLimits` snapshot.
//!
//! `accountLabel` and `rateLimits` are omitted when not applicable, so a
//! Codex-only read result keeps its earlier bytes.

use std::sync::Arc;

use serde_json::{Map, Value, json};
use tokio::sync::{Notify, mpsc, watch};
use tracing::warn;

use super::{
    model::ProviderRateLimits,
    provider::{AgentProvider, ProviderAuth, ProviderHealth, ProviderStatus},
    registry::{ProviderRegistry, disabled_provider_name},
};

/// Client-wire read of the provider list; answered in every mode.
pub const READ_METHOD: &str = "companion/agentProviders/read";
/// Durable change notification; emitted only in multi-provider mode.
pub const CHANGED_METHOD: &str = "companion/agentProviders/changed";

/// The current `AgentProvidersReadResult`.
#[must_use]
pub fn snapshot(registry: &ProviderRegistry) -> Value {
    let mut providers = registry
        .enabled()
        .map(|provider| enabled_entry(registry, provider.as_ref()))
        .collect::<Vec<_>>();
    providers.extend(registry.disabled().map(|id| {
        json!({
            "id": id.as_str(),
            "name": disabled_provider_name(id),
            "primary": false,
            "status": "disabled",
            "auth": "unknown",
            "planLabel": null,
            "capabilities": null,
        })
    }));
    json!({
        "providers": providers,
        "hostCapabilities": host_capabilities(registry),
    })
}

fn enabled_entry(registry: &ProviderRegistry, provider: &dyn AgentProvider) -> Value {
    let descriptor = provider.descriptor();
    let health = provider.health();
    let status = match (&health, provider.status()) {
        (ProviderHealth::Unavailable, _) => "unavailable",
        (ProviderHealth::Available(_), ProviderStatus::Live) => "live",
        (ProviderHealth::Available(_), ProviderStatus::Reconnecting) => "reconnecting",
    };
    let (auth, plan_label, account_label) = match health {
        ProviderHealth::Available(ProviderAuth::Authenticated {
            plan_label,
            account_label,
        }) => ("authenticated", plan_label, account_label),
        ProviderHealth::Available(ProviderAuth::Unauthenticated) => ("unauthenticated", None, None),
        ProviderHealth::Available(ProviderAuth::Unknown) | ProviderHealth::Unavailable => {
            ("unknown", None, None)
        }
    };
    let mut entry = json!({
        "id": descriptor.id.as_str(),
        "name": descriptor.display_name,
        "primary": registry.is_primary(&descriptor.id),
        "status": status,
        "auth": auth,
        "planLabel": plan_label,
        "capabilities": provider.capabilities(),
    });
    if let Some(fields) = entry.as_object_mut() {
        if let Some(account_label) = account_label {
            fields.insert("accountLabel".into(), Value::String(account_label));
        }
        if let Some(rate_limits) = provider.subscribe_rate_limits() {
            let latest = rate_limits.borrow().clone();
            fields.insert(
                "rateLimits".into(),
                serde_json::to_value(latest).unwrap_or(Value::Null),
            );
        }
    }
    entry
}

/// A boolean capability is a host capability when an enabled provider
/// declares it; mode-valued capabilities are thread-scoped and omitted.
fn host_capabilities(registry: &ProviderRegistry) -> Value {
    let mut merged = Map::new();
    for provider in registry.enabled() {
        let Ok(Value::Object(declared)) = serde_json::to_value(provider.capabilities()) else {
            continue;
        };
        for (name, value) in declared {
            let Some(supported) = value.as_bool() else {
                continue;
            };
            let entry = merged.entry(name).or_insert(Value::Bool(false));
            if supported {
                *entry = Value::Bool(true);
            }
        }
    }
    Value::Object(merged)
}

/// Journals `companion/agentProviders/changed` through `sink` whenever the
/// snapshot changes. Only a multi-provider host emits it, so a Codex-only
/// journal stays unchanged; its status already reaches the client as the
/// session `status` frame.
pub fn spawn_change_notifier(registry: Arc<ProviderRegistry>, sink: mpsc::Sender<Value>) {
    if !registry.is_multi_provider() {
        return;
    }
    let changed = Arc::new(Notify::new());
    for provider in registry.enabled() {
        tokio::spawn(watch_provider(
            provider.subscribe_status(),
            provider.subscribe_health(),
            changed.clone(),
        ));
        if let Some(rate_limits) = provider.subscribe_rate_limits() {
            tokio::spawn(watch_rate_limits(rate_limits, changed.clone()));
        }
    }
    // Taken after subscribing, so every later change wakes the publisher.
    let last = snapshot(&registry);
    tokio::spawn(publish_changes(registry, sink, changed, last));
}

async fn watch_provider(
    mut status: watch::Receiver<ProviderStatus>,
    health: Option<watch::Receiver<ProviderHealth>>,
    changed: Arc<Notify>,
) {
    let Some(mut health) = health else {
        while status.changed().await.is_ok() {
            changed.notify_one();
        }
        return;
    };
    loop {
        tokio::select! {
            result = status.changed() => if result.is_err() { return },
            result = health.changed() => if result.is_err() { return },
        }
        changed.notify_one();
    }
}

async fn watch_rate_limits(
    mut rate_limits: watch::Receiver<Option<ProviderRateLimits>>,
    changed: Arc<Notify>,
) {
    while rate_limits.changed().await.is_ok() {
        changed.notify_one();
    }
}

async fn publish_changes(
    registry: Arc<ProviderRegistry>,
    sink: mpsc::Sender<Value>,
    changed: Arc<Notify>,
    mut last: Value,
) {
    loop {
        changed.notified().await;
        let next = snapshot(&registry);
        if next == last {
            continue;
        }
        last = next.clone();
        if sink
            .send(json!({"method": CHANGED_METHOD, "params": next}))
            .await
            .is_err()
        {
            warn!("provider status notifications stopped: the local event channel closed");
            return;
        }
    }
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use super::*;
    use crate::agent::{model::ProviderId, testing::FakeProvider};

    fn codex() -> Arc<FakeProvider> {
        FakeProvider::new("codex", agent_provider_codex::CAPABILITIES).into_arc()
    }

    fn claude() -> Arc<FakeProvider> {
        FakeProvider::new("claude", agent_provider_claude::CAPABILITIES).into_arc()
    }

    fn registry(
        providers: Vec<Arc<dyn AgentProvider>>,
        disabled: Vec<ProviderId>,
    ) -> Result<Arc<ProviderRegistry>, Box<dyn std::error::Error>> {
        Ok(Arc::new(ProviderRegistry::new(
            providers,
            &ProviderId::from_static("codex"),
            disabled,
        )?))
    }

    #[test]
    fn lists_enabled_then_disabled_providers_with_host_capabilities()
    -> Result<(), Box<dyn std::error::Error>> {
        let codex = codex();
        let claude = claude();
        claude.set_health(ProviderHealth::Available(ProviderAuth::Authenticated {
            plan_label: Some("max".into()),
            account_label: Some("user@example.com".into()),
        }));
        let registry = registry(
            vec![codex, claude.clone()],
            vec![ProviderId::from_static("gemini")],
        )?;
        let snapshot = snapshot(&registry);
        let providers = snapshot["providers"]
            .as_array()
            .ok_or("providers must be a list")?;
        let rows = providers
            .iter()
            .map(|row| {
                (
                    row["id"].clone(),
                    row["primary"].clone(),
                    row["status"].clone(),
                    row["auth"].clone(),
                    row["planLabel"].clone(),
                )
            })
            .collect::<Vec<_>>();
        assert_eq!(
            rows,
            vec![
                (
                    json!("codex"),
                    json!(true),
                    json!("live"),
                    json!("unknown"),
                    Value::Null
                ),
                (
                    json!("claude"),
                    json!(false),
                    json!("live"),
                    json!("authenticated"),
                    json!("max")
                ),
                (
                    json!("gemini"),
                    json!(false),
                    json!("disabled"),
                    json!("unknown"),
                    Value::Null
                ),
            ]
        );
        assert_eq!(providers[1]["accountLabel"], "user@example.com");
        assert!(providers[0].get("accountLabel").is_none());
        assert_eq!(providers[1]["capabilities"]["realtimeVoice"], false);
        assert_eq!(providers[2]["capabilities"], Value::Null);
        assert_eq!(snapshot["hostCapabilities"]["realtimeVoice"], true);
        assert_eq!(snapshot["hostCapabilities"]["accounts.pool"], true);
        assert!(
            snapshot["hostCapabilities"]
                .get("turns.startWhileActive")
                .is_none()
        );
        Ok(())
    }

    fn limits(used_percent: u8) -> ProviderRateLimits {
        ProviderRateLimits {
            updated_at: 1_760_000_000,
            windows: vec![crate::agent::model::ProviderRateLimitWindow {
                id: "five_hour".into(),
                kind: crate::agent::model::RateLimitWindowKind::Session,
                label: "Session".into(),
                resets_at: Some(1_760_010_000),
                status: Some(crate::agent::model::RateLimitWindowStatus::Allowed),
                used_percent: Some(used_percent),
                window_duration_mins: Some(300),
            }],
        }
    }

    #[test]
    fn a_codex_only_entry_keeps_its_fields() -> Result<(), Box<dyn std::error::Error>> {
        let registry = registry(vec![codex()], Vec::new())?;
        let snapshot = snapshot(&registry);
        let entry = snapshot["providers"][0]
            .as_object()
            .ok_or("entry must be an object")?;
        let mut keys = entry.keys().map(String::as_str).collect::<Vec<_>>();
        keys.sort_unstable();
        assert_eq!(
            keys,
            vec![
                "auth",
                "capabilities",
                "id",
                "name",
                "planLabel",
                "primary",
                "status"
            ]
        );
        Ok(())
    }

    #[tokio::test]
    async fn lists_provider_rate_limits_and_journals_their_changes()
    -> Result<(), Box<dyn std::error::Error>> {
        let claude = Arc::new(
            FakeProvider::new("claude", agent_provider_claude::CAPABILITIES)
                .reporting_rate_limits(),
        );
        let registry = registry(vec![codex(), claude.clone()], Vec::new())?;
        let before = snapshot(&registry);
        assert!(before["providers"][0].get("rateLimits").is_none());
        assert_eq!(before["providers"][1]["rateLimits"], Value::Null);
        assert!(before["providers"][1].get("rateLimits").is_some());

        let (sink, mut journal) = mpsc::channel(8);
        spawn_change_notifier(registry, sink);
        claude.set_rate_limits(limits(42));
        let event = tokio::time::timeout(Duration::from_secs(5), journal.recv())
            .await?
            .ok_or("journal closed")?;
        assert_eq!(event["method"], CHANGED_METHOD);
        assert_eq!(
            event["params"]["providers"][1]["rateLimits"],
            json!({
                "updatedAt": 1_760_000_000,
                "windows": [{
                    "id": "five_hour",
                    "kind": "session",
                    "label": "Session",
                    "resetsAt": 1_760_010_000,
                    "status": "allowed",
                    "usedPercent": 42,
                    "windowDurationMins": 300,
                }],
            })
        );
        Ok(())
    }

    #[test]
    fn an_unavailable_provider_reports_no_sign_in() -> Result<(), Box<dyn std::error::Error>> {
        let claude = claude();
        claude.set_health(ProviderHealth::Unavailable);
        let registry = registry(vec![codex(), claude], Vec::new())?;
        let snapshot = snapshot(&registry);
        assert_eq!(snapshot["providers"][1]["status"], "unavailable");
        assert_eq!(snapshot["providers"][1]["auth"], "unknown");
        Ok(())
    }

    #[tokio::test]
    async fn journals_a_change_only_in_multi_provider_mode()
    -> Result<(), Box<dyn std::error::Error>> {
        let claude = claude();
        let (sink, mut journal) = mpsc::channel(8);
        spawn_change_notifier(registry(vec![codex(), claude.clone()], Vec::new())?, sink);
        claude.set_health(ProviderHealth::Available(ProviderAuth::Unauthenticated));
        let event = tokio::time::timeout(Duration::from_secs(5), journal.recv())
            .await?
            .ok_or("journal closed")?;
        assert_eq!(event["method"], CHANGED_METHOD);
        assert_eq!(event["params"]["providers"][1]["auth"], "unauthenticated");
        claude.set_transport_status(ProviderStatus::Reconnecting);
        let event = tokio::time::timeout(Duration::from_secs(5), journal.recv())
            .await?
            .ok_or("journal closed")?;
        assert_eq!(event["params"]["providers"][1]["status"], "reconnecting");

        let codex = codex();
        let (sink, mut journal) = mpsc::channel(8);
        spawn_change_notifier(registry(vec![codex.clone()], Vec::new())?, sink);
        codex.set_transport_status(ProviderStatus::Reconnecting);
        // A Codex-only host keeps no notifier: the sink is dropped at once.
        assert!(journal.recv().await.is_none());
        Ok(())
    }
}
