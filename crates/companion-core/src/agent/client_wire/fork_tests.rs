//! Same-provider fork on a provider without the native surface
//! (`ClientWireGateway::fork_thread`): the copy is bound like a created
//! thread, keeps the turns through the boundary and takes the requested
//! execution settings in one neutral `thread.update`.

use std::sync::Arc;

use serde_json::{Value, json};

use super::gateway::ClientWireGateway;
use crate::agent::{
    bindings::{BindingOrigin, BindingStore},
    model::{
        AgentThread, AgentTurn, AppThreadId, CapabilitySet, ProviderId, StartWhileActiveMode,
        ThreadChange, ThreadUpdateParams, TurnId, TurnOrigin, TurnStatus,
    },
    provider::AgentProvider,
    registry::ProviderRegistry,
    testing::{ScriptedProvider, thread},
};

type TestResult = Result<(), Box<dyn std::error::Error>>;

struct Harness {
    gateway: ClientWireGateway,
    claude: Arc<ScriptedProvider>,
    _directory: tempfile::TempDir,
}

fn turn(id: &'static str) -> AgentTurn {
    AgentTurn {
        turn_id: TurnId::from_static(id),
        status: TurnStatus::Completed,
        origin: TurnOrigin::User,
        started_at: 1,
        completed_at: Some(2),
        error: None,
        items: Vec::new(),
        provenance: None,
        usage: None,
    }
}

/// A Claude-like provider with the `source` thread (`model: "m"`, effort
/// `high`, service tier `priority`) and its three turns, bound as created.
async fn harness() -> Result<Harness, Box<dyn std::error::Error>> {
    let directory = tempfile::tempdir()?;
    let store = Arc::new(crate::store::IndexStore::open(
        directory.path().join("state.redb"),
    )?);
    let mut capabilities = CapabilitySet::none(StartWhileActiveMode::Busy);
    capabilities.threads_host_minted_ids = true;
    capabilities.threads_fork = true;
    let mut source = thread("claude", "source", 5);
    source.settings.effort = Some("high".into());
    source.settings.service_tier = Some("priority".into());
    let claude = Arc::new(ScriptedProvider::new("claude", capabilities).with_thread(source));
    claude.set_turns("source", vec![turn("t1"), turn("t2"), turn("t3")]);
    let provider: Arc<dyn AgentProvider> = claude.clone();
    let registry = Arc::new(ProviderRegistry::single(provider, Vec::new()));
    let bindings = Arc::new(BindingStore::new(store));
    bindings
        .bind(
            &AppThreadId::from_static("source"),
            &ProviderId::from_static("claude"),
            BindingOrigin::Created,
        )
        .await?;
    Ok(Harness {
        gateway: ClientWireGateway::new(registry, bindings),
        claude,
        _directory: directory,
    })
}

async fn fork(harness: &Harness, params: &Value) -> Result<AgentThread, String> {
    let source = harness
        .gateway
        .resolve_thread("source", None)
        .await
        .map_err(|failure| failure.message)?;
    harness
        .gateway
        .fork_thread(&source, params)
        .await
        .map_err(|failure| failure.message)
}

#[tokio::test]
async fn a_neutral_fork_binds_the_copy_and_applies_the_model() -> TestResult {
    let harness = harness().await?;
    let forked = fork(&harness, &json!({"lastTurnId": "t2", "model": "opus"})).await?;

    let copy = harness
        .gateway
        .resolve_thread(forked.app_thread_id.as_str(), None)
        .await
        .map_err(|failure| failure.message)?;
    assert_eq!(copy.wire.descriptor.id.as_str(), "claude");
    let kept: Vec<String> = harness
        .claude
        .turns
        .lock()
        .map_err(|_| "turns lock")?
        .get(forked.app_thread_id.as_str())
        .map(|turns| {
            turns
                .iter()
                .map(|turn| turn.turn_id.as_str().to_owned())
                .collect()
        })
        .unwrap_or_default();
    assert_eq!(kept, ["t1", "t2"]);
    assert_eq!(
        harness.claude.updated(),
        [ThreadUpdateParams {
            app_thread_id: forked.app_thread_id,
            change: ThreadChange::Settings {
                model: Some("opus".into()),
                effort: None,
                permission_profile: None,
                service_tier: None,
            },
        }]
    );
    Ok(())
}

/// Effort (`config.model_reasoning_effort`) and service tier (`serviceTier`)
/// reach the copy together with the model in a single update; a requested
/// value equal to the copy's own is not re-sent.
#[tokio::test]
async fn a_neutral_fork_applies_the_differing_effort_and_service_tier_in_one_update() -> TestResult
{
    let harness = harness().await?;
    let forked = fork(
        &harness,
        &json!({"model": "m", "serviceTier": "default",
            "config": {"model_reasoning_effort": "low"}}),
    )
    .await?;
    assert_eq!(
        harness.claude.updated(),
        [ThreadUpdateParams {
            app_thread_id: forked.app_thread_id,
            change: ThreadChange::Settings {
                model: None,
                effort: Some("low".into()),
                permission_profile: None,
                service_tier: Some("default".into()),
            },
        }]
    );
    Ok(())
}

/// Requested settings equal to the copy's, empty strings and absent fields
/// leave the copy as forked without a `thread.update`.
#[tokio::test]
async fn a_neutral_fork_without_differing_settings_sends_no_update() -> TestResult {
    let harness = harness().await?;
    fork(
        &harness,
        &json!({"model": "m", "serviceTier": "priority",
            "config": {"model_reasoning_effort": "high"}}),
    )
    .await?;
    fork(
        &harness,
        &json!({"model": "", "serviceTier": "", "config": {"model_reasoning_effort": ""}}),
    )
    .await?;
    fork(&harness, &json!({})).await?;
    assert_eq!(
        harness
            .claude
            .forked
            .lock()
            .map_err(|_| "forked lock")?
            .len(),
        3
    );
    assert!(harness.claude.updated().is_empty());
    Ok(())
}
