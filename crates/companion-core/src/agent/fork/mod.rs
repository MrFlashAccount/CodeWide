//! Fork into another agent: `thread/fork` with `codewideAgentProvider`
//! naming a provider other than the thread's creates a new app thread on
//! that provider. The new thread's first turn carries a context handoff
//! built from the source thread's neutral history (`handoff`); the source
//! thread is unchanged. The handoff waits, durably, for the user's first
//! message unless the request carries `codewideInitialPrompt`; while it
//! waits, the inherited title durably materializes an otherwise empty target.
//!
//! A fork to the thread's own provider is today's native fork with the
//! extension fields removed. See `docs/agent-providers.md#fork-into-another-agent`.

mod handoff;
#[cfg(test)]
mod recovery_tests;
mod snapshot;

use std::{
    collections::{HashMap, HashSet},
    sync::Arc,
    sync::Mutex,
};

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tracing::{error, info, warn};

use crate::{
    agent::{
        client_wire::{
            FORK_INITIAL_PROMPT_FIELD, PROVIDER_FIELD, decode,
            gateway::{ClientWireGateway, RpcFailure, Target, default_model},
            observe::{TurnFact, turn_fact},
        },
        model::{
            AgentTurn, Capability, ERROR_INVALID_PARAMS, ERROR_INVALID_REQUEST, ItemsView,
            ProviderId, SortDirection, ThreadChange, ThreadSettings, ThreadTurnsParams,
            ThreadUpdateParams, TurnStartParams, TurnStartResult, UserContent,
        },
        permission_profiles::{ProfileObservations, READ_ONLY},
        provider::AgentProvider,
    },
    store::IndexStore,
};

const FORK_RECORD_VERSION: u32 = 1;
const SOURCE_PAGE: u32 = 100;

/// What a `thread/fork` request asks for.
#[derive(Debug, Eq, PartialEq)]
pub enum ForkRequest {
    /// No provider field: today's native fork, byte-identical.
    Native,
    /// A provider field: resolved against the source thread's provider.
    Provider(ProviderId),
}

/// Classifies a `thread/fork` request.
///
/// # Errors
/// Returns `-32602` for a provider field that is not a valid id.
pub fn classify(params: &Value) -> Result<ForkRequest, RpcFailure> {
    match params.get(PROVIDER_FIELD) {
        None | Some(Value::Null) => Ok(ForkRequest::Native),
        Some(Value::String(id)) => {
            ProviderId::parse(id)
                .map(ForkRequest::Provider)
                .ok_or_else(|| {
                    RpcFailure::new(ERROR_INVALID_PARAMS, "codewideAgentProvider is invalid")
                })
        }
        Some(_) => Err(RpcFailure::new(
            ERROR_INVALID_PARAMS,
            "codewideAgentProvider must be a string",
        )),
    }
}

/// Removes the `CodeWide` extension fields so a same-provider fork reaches
/// the provider as a native `thread/fork`.
pub fn strip_extension_fields(params: &mut Value) {
    if let Some(object) = params.as_object_mut() {
        object.remove(PROVIDER_FIELD);
        object.remove(FORK_INITIAL_PROMPT_FIELD);
    }
}

/// Durable record of a cross-provider fork.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct ForkRecord {
    v: u32,
    forked_from_id: String,
    source_provider: ProviderId,
    provider: ProviderId,
    /// Unix seconds.
    created_at: i64,
    /// The handoff text still waiting for the thread's first turn.
    pending_handoff: Option<String>,
    /// Recovery references outlive first-turn consumption. Older fork records
    /// have only their inline handoff and remain readable.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    snapshot: Option<snapshot::Snapshot>,
}

/// The cross-provider fork service.
pub struct ForkService {
    gateway: Arc<ClientWireGateway>,
    store: Arc<IndexStore>,
    journal: tokio::sync::mpsc::Sender<Value>,
    profiles: Arc<ProfileObservations>,
    /// Threads whose first turn still needs the handoff → handoff text.
    pending: Mutex<HashMap<String, String>>,
}

impl ForkService {
    /// Opens the service; handoffs that waited across a restart are kept.
    #[must_use]
    pub fn new(
        gateway: Arc<ClientWireGateway>,
        store: Arc<IndexStore>,
        journal: tokio::sync::mpsc::Sender<Value>,
        profiles: Arc<ProfileObservations>,
    ) -> Arc<Self> {
        let pending = match load_pending(&store) {
            Ok(pending) => pending,
            Err(err) => {
                error!(err = %err, "fork records are unreadable; pending handoffs are lost");
                HashMap::new()
            }
        };
        Arc::new(Self {
            gateway,
            store,
            journal,
            profiles,
            pending: Mutex::new(pending),
        })
    }

    fn pending(&self) -> std::sync::MutexGuard<'_, HashMap<String, String>> {
        self.pending
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    /// Forks `source` into a new thread on `target_provider`. Returns the
    /// `thread/fork` result.
    ///
    /// # Errors
    /// Returns the client-facing failure: a provider without
    /// `threads.crossProviderFork`, an unreadable source or a failed create.
    pub async fn fork(
        &self,
        source: &Target,
        target_provider: &ProviderId,
        params: &Value,
    ) -> Result<Value, RpcFailure> {
        let target = self.fork_target(source, target_provider)?;
        let source_thread = source
            .provider
            .thread_read(&source.thread_id)
            .await
            .map_err(|error| RpcFailure::from_provider(&error))?
            .thread;
        let source_profile = Some(source_thread.settings.permission_profile.clone())
            .filter(|profile| !profile.is_empty())
            .or_else(|| {
                self.profiles
                    .get(&source.wire.descriptor.id, source.thread_id.as_str())
            });
        let boundary = boundary(params)?;
        let turns = source_turns(&source.provider, source, &boundary).await?;
        let wire = self.gateway.wire(&target);
        let (cwd, settings) =
            fork_settings(&target, &source_thread, source_profile.as_deref(), params).await?;
        let initial_prompt = text_field(params, FORK_INITIAL_PROMPT_FIELD);
        let window = target
            .model_context_window(&settings.model, &cwd)
            .await
            .unwrap_or_default();
        let budget = handoff::inline_budget(window, initial_prompt.as_ref().map_or(0, String::len));
        let name = fork_name(&source_thread);
        let (snapshot, preamble) = self
            .prepare_context(source, source_thread, turns, boundary, budget)
            .await?;
        let mut thread = self
            .gateway
            .create_thread(&target, &wire, cwd, settings)
            .await?;
        let forked = thread.app_thread_id.clone();
        if initial_prompt.is_none() {
            // Codex does not write a rollout for an otherwise empty
            // `thread/start`. Persisting the fork's inherited title is a real
            // fork mutation and makes the thread resumable before the user's
            // delayed first message, without starting a synthetic model turn.
            target
                .thread_update(ThreadUpdateParams {
                    app_thread_id: forked.clone(),
                    change: ThreadChange::Name {
                        name: Some(name.clone()),
                    },
                })
                .await
                .map_err(|error| RpcFailure::from_provider(&error))?;
            thread.name = Some(name);
        }
        let mut record = ForkRecord {
            v: FORK_RECORD_VERSION,
            forked_from_id: source.thread_id.as_str().to_owned(),
            source_provider: source.wire.descriptor.id.clone(),
            provider: wire.descriptor.id.clone(),
            created_at: thread.created_at,
            pending_handoff: Some(preamble.clone()),
            snapshot: Some(snapshot),
        };
        self.write_record(forked.as_str(), &record).await?;
        self.pending()
            .insert(forked.as_str().to_owned(), preamble.clone());
        let (mut response, mut started) = ClientWireGateway::started_thread(&thread, &wire);
        for projected in [
            response.get_mut("thread"),
            started.pointer_mut("/params/thread"),
        ]
        .into_iter()
        .flatten()
        {
            projected["forkedFromId"] = json!(source.thread_id.as_str());
        }
        if target.native_surface().is_none() && self.journal.send(started).await.is_err() {
            warn!("journal closed before a forked thread was announced");
        }
        info!(
            app_thread_id = %forked,
            forked_from_id = %source.thread_id,
            provider = %wire.descriptor.id,
            "thread forked into another agent"
        );
        if let Some(prompt) = initial_prompt {
            self.start_initial(target.as_ref(), &forked, preamble, prompt, &mut record)
                .await?;
        }
        Ok(response)
    }

    async fn start_initial(
        &self,
        target: &dyn AgentProvider,
        thread: &crate::agent::model::AppThreadId,
        preamble: String,
        prompt: String,
        record: &mut ForkRecord,
    ) -> Result<(), RpcFailure> {
        let started = target
            .turn_start(TurnStartParams {
                app_thread_id: thread.clone(),
                client_message_id: None,
                input: vec![
                    UserContent::Text { text: preamble },
                    UserContent::Text { text: prompt },
                ],
                client_tools: None,
            })
            .await
            .map_err(|error| RpcFailure::from_provider(&error))?;
        if let TurnStartResult::Busy { active_turn_id } = started {
            return Err(RpcFailure::new(
                ERROR_INVALID_REQUEST,
                format!("thread has an active turn: {active_turn_id}"),
            ));
        }
        // A rejected or disconnected first start retains recovery context.
        // A positive start acknowledgement (or its live Started event)
        // proves the target accepted it, so subsequent input must not repeat it.
        record.pending_handoff = None;
        self.write_record(thread.as_str(), record).await?;
        self.pending().remove(thread.as_str());
        Ok(())
    }

    async fn prepare_context(
        &self,
        source: &Target,
        source_thread: crate::agent::model::AgentThread,
        turns: Vec<AgentTurn>,
        boundary: snapshot::Boundary,
        budget: usize,
    ) -> Result<(snapshot::Snapshot, String), RpcFailure> {
        let raw_files = source
            .provider
            .thread_history_files(&source.thread_id)
            .await
            .map_err(|error| RpcFailure::from_provider(&error))?;
        let root = self.store.path().with_extension("fork-snapshots");
        let provider_name = source.wire.descriptor.display_name.clone();
        let provider_id = source.wire.descriptor.id.to_string();
        tokio::task::spawn_blocking(move || {
            let snapshot = snapshot::write(
                &root,
                &source_thread,
                &provider_id,
                &boundary,
                &turns,
                raw_files,
            )
            .map_err(|err| {
                error!(err = ?err, "fork snapshot was not written");
                RpcFailure::new(-32_020, "Full session snapshot could not be saved")
            })?;
            let preamble = handoff::preamble(
                &source_thread,
                &provider_name,
                &turns,
                &boundary,
                &snapshot,
                budget,
            )
            .map_err(|message| RpcFailure::new(ERROR_INVALID_PARAMS, message))?;
            Ok::<_, RpcFailure>((snapshot, preamble))
        })
        .await
        .map_err(|_| RpcFailure::new(-32_020, "Full session snapshot worker failed"))?
    }

    /// The target provider; both it and the source's provider must declare
    /// `threads.crossProviderFork`.
    fn fork_target(
        &self,
        source: &Target,
        target_provider: &ProviderId,
    ) -> Result<Arc<dyn AgentProvider>, RpcFailure> {
        let target = self
            .gateway
            .registry()
            .get(target_provider)
            .cloned()
            .ok_or_else(|| RpcFailure::provider_disabled(target_provider))?;
        for (provider, id) in [
            (&source.provider, &source.wire.descriptor.id),
            (&target, target_provider),
        ] {
            if !provider
                .capabilities()
                .supports(Capability::ThreadsCrossProviderFork)
            {
                return Err(RpcFailure::capability_unsupported(
                    Capability::ThreadsCrossProviderFork,
                    id,
                ));
            }
        }
        Ok(target)
    }

    async fn write_record(&self, thread: &str, record: &ForkRecord) -> Result<(), RpcFailure> {
        let bytes = serde_json::to_vec(record)
            .map_err(|_| RpcFailure::new(-32_020, "Fork record is unavailable"))?;
        let store = self.store.clone();
        let thread = thread.to_owned();
        tokio::task::spawn_blocking(move || store.put_agent_thread_fork(&thread, &bytes))
            .await
            .map_err(|_| RpcFailure::new(-32_020, "Fork record is unavailable"))?
            .map_err(|err| {
                error!(err = ?err, "fork record was not written");
                RpcFailure::new(-32_020, "Fork record is unavailable")
            })
    }

    /// Prepends a pending handoff to a client `turn/start` (client-wire
    /// params). Every other request passes unchanged. The handoff stays
    /// pending until the thread's turn has started, so a retried delivery
    /// carries it again.
    #[must_use]
    pub fn inject(&self, method: &str, mut params: Value) -> Value {
        if method != "turn/start" {
            return params;
        }
        let Some(thread_id) = params.get("threadId").and_then(Value::as_str) else {
            return params;
        };
        let Some(preamble) = self.pending().get(thread_id).cloned() else {
            return params;
        };
        if let Some(input) = params.get_mut("input").and_then(Value::as_array_mut) {
            input.insert(
                0,
                json!({"type": "text", "text": preamble, "text_elements": []}),
            );
        }
        params
    }

    /// Observes a client-wire payload: the first started turn of a forked
    /// thread consumes its pending handoff.
    pub fn observe_event(self: &Arc<Self>, payload: &Value) {
        let Some(TurnFact::Started { thread_id, .. }) = turn_fact(payload) else {
            return;
        };
        if self.pending().remove(thread_id).is_none() {
            return;
        }
        let service = self.clone();
        let thread = thread_id.to_owned();
        tokio::spawn(async move { service.consume(&thread).await });
    }

    async fn consume(&self, thread: &str) {
        let store = self.store.clone();
        let key = thread.to_owned();
        let result = tokio::task::spawn_blocking(move || -> Result<(), String> {
            let Some(bytes) = store
                .agent_thread_fork(&key)
                .map_err(|err| err.to_string())?
            else {
                return Ok(());
            };
            let mut record: ForkRecord =
                serde_json::from_slice(&bytes).map_err(|err| err.to_string())?;
            record.pending_handoff = None;
            let bytes = serde_json::to_vec(&record).map_err(|err| err.to_string())?;
            store
                .put_agent_thread_fork(&key, &bytes)
                .map_err(|err| err.to_string())
        })
        .await;
        match result {
            Ok(Ok(())) => {}
            Ok(Err(message)) => {
                error!(error = %message, app_thread_id = %thread, "fork handoff was not marked delivered");
            }
            Err(err) => error!(err = ?err, app_thread_id = %thread, "fork handoff worker failed"),
        }
    }
}

/// A non-empty string field of the request.
fn text_field(params: &Value, field: &str) -> Option<String> {
    params
        .get(field)
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
}

fn fork_name(source: &crate::agent::model::AgentThread) -> String {
    source
        .name
        .as_deref()
        .filter(|name| !name.trim().is_empty())
        .map(str::to_owned)
        .or_else(|| {
            let preview = source.preview.trim();
            (!preview.is_empty()).then(|| preview.chars().take(80).collect())
        })
        .unwrap_or_else(|| "Forked chat".to_owned())
}

/// The fork's working directory and settings: the request's `cwd`, `model`
/// and `permissions`, else the source thread's (the target's default model);
/// the request's `config.model_reasoning_effort` and `serviceTier`, else the
/// target's defaults (the source's values belong to another provider).
async fn fork_settings(
    target: &Arc<dyn AgentProvider>,
    source: &crate::agent::model::AgentThread,
    source_profile: Option<&str>,
    params: &Value,
) -> Result<(String, ThreadSettings), RpcFailure> {
    let requested = decode::requested_settings(params);
    let model = match requested.model {
        Some(model) => model,
        None => default_model(target).await?,
    };
    let permission_profile = text_field(params, "permissions")
        .or_else(|| source_profile.map(str::to_owned))
        .unwrap_or_else(|| READ_ONLY.to_owned());
    let permission_profile =
        crate::agent::permission_profiles::for_provider(target, permission_profile)
            .await
            .map_err(|message| RpcFailure::new(ERROR_INVALID_PARAMS, message))?;
    Ok((
        text_field(params, "cwd").unwrap_or_else(|| source.cwd.clone()),
        ThreadSettings {
            model,
            effort: requested.effort,
            permission_profile,
            service_tier: requested.service_tier,
        },
    ))
}

fn load_pending(store: &IndexStore) -> Result<HashMap<String, String>, String> {
    let mut pending = HashMap::new();
    for thread in store
        .agent_thread_fork_ids()
        .map_err(|err| err.to_string())?
    {
        let Some(bytes) = store
            .agent_thread_fork(&thread)
            .map_err(|err| err.to_string())?
        else {
            continue;
        };
        let record: ForkRecord = serde_json::from_slice(&bytes).map_err(|err| err.to_string())?;
        if let Some(handoff) = record.pending_handoff {
            pending.insert(thread, handoff);
        }
    }
    Ok(pending)
}

/// The source thread's turns, oldest first, up to the fork point
/// (`lastTurnId` inclusive or `beforeTurnId` exclusive).
async fn source_turns(
    provider: &Arc<dyn AgentProvider>,
    source: &Target,
    boundary: &snapshot::Boundary,
) -> Result<Vec<AgentTurn>, RpcFailure> {
    let mut turns = Vec::new();
    let mut cursor = None;
    let mut cursors = HashSet::new();
    let mut ids = HashSet::new();
    loop {
        let page = provider
            .thread_turns(ThreadTurnsParams {
                app_thread_id: source.thread_id.clone(),
                cursor: cursor.take(),
                limit: SOURCE_PAGE,
                sort_direction: SortDirection::Desc,
                items_view: ItemsView::Full,
            })
            .await
            .map_err(|error| RpcFailure::from_provider(&error))?;
        for turn in page.turns {
            // Descending pages can overlap when the provider refreshes its
            // projection between reads. The first copy is the newest one in
            // the observed history; keep that cut instead of rejecting a
            // perfectly usable snapshot or publishing the turn twice.
            if ids.insert(turn.turn_id.clone()) {
                turns.push(turn);
            }
        }
        match page.next_cursor {
            Some(next) => {
                if !cursors.insert(next.clone()) {
                    return Err(RpcFailure::new(
                        -32_020,
                        "Source history pagination did not advance",
                    ));
                }
                cursor = Some(next);
            }
            None => break,
        }
    }
    turns.reverse();
    match boundary {
        snapshot::Boundary::Latest => {}
        snapshot::Boundary::Through(id) | snapshot::Boundary::Before(id) => {
            let position = turns
                .iter()
                .position(|turn| turn.turn_id.as_str() == id)
                .ok_or_else(|| {
                    RpcFailure::new(
                        ERROR_INVALID_PARAMS,
                        "Fork boundary was not found in the source history",
                    )
                })?;
            turns.truncate(
                position + usize::from(matches!(boundary, snapshot::Boundary::Through(_))),
            );
        }
    }
    Ok(turns)
}

fn boundary(params: &Value) -> Result<snapshot::Boundary, RpcFailure> {
    let read = |field| match params.get(field) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(id)) if !id.is_empty() => Ok(Some(id.clone())),
        _ => Err(RpcFailure::new(
            ERROR_INVALID_PARAMS,
            "Fork boundary must be a nonempty turn ID",
        )),
    };
    match (read("lastTurnId")?, read("beforeTurnId")?) {
        (None, None) => Ok(snapshot::Boundary::Latest),
        (Some(id), None) => Ok(snapshot::Boundary::Through(id)),
        (None, Some(id)) => Ok(snapshot::Boundary::Before(id)),
        (Some(_), Some(_)) => Err(RpcFailure::new(
            ERROR_INVALID_PARAMS,
            "Specify only one fork boundary",
        )),
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use serde_json::{Value, json};

    use super::*;
    use crate::agent::{
        bindings::{BindingOrigin, BindingStore},
        model::{
            AgentItem, AppThreadId, CapabilitySet, ItemId, MessagePhase, StartWhileActiveMode,
            TurnId, TurnOrigin, TurnStatus,
        },
        registry::ProviderRegistry,
        testing::{ScriptedProvider, thread},
    };

    type TestResult = Result<(), Box<dyn std::error::Error>>;

    const SOURCE: &str = "source-thread";

    fn capabilities(fork: bool) -> CapabilitySet {
        let mut capabilities = CapabilitySet::none(StartWhileActiveMode::Busy);
        capabilities.threads_host_minted_ids = true;
        capabilities.threads_cross_provider_fork = fork;
        capabilities
    }

    fn turn(id: &'static str, user: &str, answer: &str) -> AgentTurn {
        AgentTurn {
            turn_id: TurnId::from_static(id),
            status: TurnStatus::Completed,
            origin: TurnOrigin::User,
            started_at: 1,
            completed_at: Some(2),
            error: None,
            items: vec![
                AgentItem::UserMessage {
                    item_id: ItemId::from_static("u"),
                    provenance: None,
                    client_message_id: None,
                    content: vec![UserContent::Text { text: user.into() }],
                },
                AgentItem::AgentMessage {
                    item_id: ItemId::from_static("a"),
                    provenance: None,
                    text: answer.into(),
                    phase: MessagePhase::Final,
                },
            ],
            provenance: None,
            usage: None,
        }
    }

    struct Harness {
        fork: Arc<ForkService>,
        gateway: Arc<ClientWireGateway>,
        store: Arc<IndexStore>,
        journal: tokio::sync::mpsc::Receiver<Value>,
        profiles: Arc<ProfileObservations>,
        target: Arc<ScriptedProvider>,
        source: Arc<ScriptedProvider>,
        target_provider: ProviderId,
        _directory: tempfile::TempDir,
    }

    async fn harness(target_forks: bool) -> Result<Harness, Box<dyn std::error::Error>> {
        harness_for(
            "codex",
            ":workspace",
            "claude",
            &[":read-only", ":workspace", ":full-access"],
            target_forks,
        )
        .await
    }

    async fn harness_for(
        source_provider: &'static str,
        source_profile: &str,
        target_provider: &'static str,
        target_profiles: &[&'static str],
        target_forks: bool,
    ) -> Result<Harness, Box<dyn std::error::Error>> {
        let directory = tempfile::tempdir()?;
        let store = Arc::new(IndexStore::open(directory.path().join("state.redb"))?);
        let mut source = thread(source_provider, SOURCE, 5);
        source.cwd = "/repo".into();
        source.name = Some("Parser work".into());
        source.settings.permission_profile = source_profile.into();
        let source = Arc::new(
            ScriptedProvider::new(source_provider, capabilities(true)).with_thread(source),
        );
        source.set_turns(
            SOURCE,
            vec![
                turn("t1", "first question", "first answer"),
                turn("t2", "second question", "second answer"),
            ],
        );
        let target = Arc::new(
            ScriptedProvider::new(target_provider, capabilities(target_forks))
                .with_profiles(target_profiles),
        );
        let source_dyn: Arc<dyn AgentProvider> = source.clone();
        let target_dyn: Arc<dyn AgentProvider> = target.clone();
        let source_provider = ProviderId::from_static(source_provider);
        let target_provider = ProviderId::from_static(target_provider);
        let registry = Arc::new(ProviderRegistry::new(vec![source_dyn, target_dyn])?);
        let bindings = Arc::new(BindingStore::new(store.clone()));
        bindings
            .bind(
                &AppThreadId::from_static(SOURCE),
                &source_provider,
                BindingOrigin::Created,
            )
            .await?;
        let gateway = Arc::new(ClientWireGateway::new(registry, bindings));
        let (journal_tx, journal) = tokio::sync::mpsc::channel(8);
        let profiles = Arc::new(ProfileObservations::default());
        Ok(Harness {
            fork: ForkService::new(gateway.clone(), store.clone(), journal_tx, profiles.clone()),
            gateway,
            store,
            journal,
            profiles,
            target,
            source,
            target_provider,
            _directory: directory,
        })
    }

    async fn fork(harness: &Harness, params: &Value) -> Result<Value, RpcFailure> {
        let source = harness.gateway.resolve_thread(SOURCE, None).await?;
        harness
            .fork
            .fork(&source, &harness.target_provider, params)
            .await
    }

    fn turn_start(thread: &str) -> Value {
        json!({"threadId": thread, "input": [{"type": "text", "text": "go on", "text_elements": []}]})
    }

    #[test]
    fn only_a_provider_field_leaves_the_native_fork() {
        assert_eq!(
            classify(&json!({"threadId": "t"})).ok(),
            Some(ForkRequest::Native)
        );
        assert_eq!(
            classify(&json!({"threadId": "t", "codewideAgentProvider": null})).ok(),
            Some(ForkRequest::Native)
        );
        assert_eq!(
            classify(&json!({"codewideAgentProvider": "claude"})).ok(),
            Some(ForkRequest::Provider(ProviderId::from_static("claude")))
        );
        assert!(classify(&json!({"codewideAgentProvider": 1})).is_err());
        let mut params = json!({"threadId": "t", "model": "m", "codewideAgentProvider": "codex", "codewideInitialPrompt": "x"});
        strip_extension_fields(&mut params);
        assert_eq!(params, json!({"threadId": "t", "model": "m"}));
    }

    #[tokio::test]
    async fn a_cross_provider_fork_waits_for_the_first_message_with_the_handoff() -> TestResult {
        let mut harness = harness(true).await?;
        let response = fork(
            &harness,
            &json!({"threadId": SOURCE, "codewideAgentProvider": "claude"}),
        )
        .await
        .map_err(|failure| failure.message)?;
        let forked = response["thread"]["id"]
            .as_str()
            .ok_or("no thread id")?
            .to_owned();
        assert_eq!(response["thread"]["forkedFromId"], SOURCE);
        let snapshot = saved_snapshot(&harness, &response)?;
        let frozen = std::fs::read_to_string(&snapshot.path)?;
        harness.source.set_turns(
            SOURCE,
            vec![turn("later", "future request", "future answer")],
        );
        let created = harness.target.created();
        assert_eq!(created.len(), 1);
        assert_eq!(created[0].cwd, "/repo");
        assert_eq!(created[0].settings.model, "claude-default");
        assert_eq!(response["thread"]["name"], "Parser work");
        assert_eq!(harness.target.updated().len(), 1);
        assert_eq!(
            harness.target.updated()[0].change,
            ThreadChange::Name {
                name: Some("Parser work".into())
            }
        );
        assert!(
            harness.target.started().is_empty(),
            "no turn before the user's message"
        );
        let announced = harness.journal.recv().await.ok_or("no thread/started")?;
        assert_eq!(announced["params"]["thread"]["id"], forked.as_str());
        assert_eq!(announced["params"]["thread"]["forkedFromId"], SOURCE);

        let injected = harness.fork.inject("turn/start", turn_start(&forked));
        let preamble = injected["input"][0]["text"].as_str().ok_or("no handoff")?;
        assert!(preamble.contains("first question") && preamble.contains("second answer"));
        assert!(preamble.starts_with("Continue the unfinished work from the "));
        assert!(preamble.contains(snapshot.path.to_str().ok_or("non-UTF8 path")?));
        assert!(preamble.ends_with("User message:"));
        assert_eq!(injected["input"][1]["text"], "go on");
        assert_eq!(
            harness.fork.inject("turn/start", turn_start(SOURCE)),
            turn_start(SOURCE)
        );
        assert_eq!(
            harness.fork.inject("turn/steer", turn_start(&forked)),
            turn_start(&forked)
        );

        // The handoff survives a restart until a turn of the thread starts.
        let (journal, _rx) = tokio::sync::mpsc::channel(1);
        let restarted = ForkService::new(
            harness.gateway.clone(),
            harness.store.clone(),
            journal,
            harness.profiles.clone(),
        );
        assert_ne!(
            restarted.inject("turn/start", turn_start(&forked)),
            turn_start(&forked)
        );
        restarted.observe_event(
            &json!({"method": "turn/started", "params": {"threadId": forked, "turn": {"id": "x"}}}),
        );
        assert_eq!(
            restarted.inject("turn/start", turn_start(&forked)),
            turn_start(&forked)
        );
        tokio::time::timeout(std::time::Duration::from_secs(5), async {
            loop {
                let (journal, _rx) = tokio::sync::mpsc::channel(1);
                let reopened = ForkService::new(
                    harness.gateway.clone(),
                    harness.store.clone(),
                    journal,
                    harness.profiles.clone(),
                );
                if reopened.inject("turn/start", turn_start(&forked)) == turn_start(&forked) {
                    break;
                }
                tokio::task::yield_now().await;
            }
        })
        .await?;
        assert_eq!(std::fs::read_to_string(&snapshot.path)?, frozen);
        assert_eq!(saved_snapshot(&harness, &response)?, snapshot);
        Ok(())
    }

    #[tokio::test]
    async fn an_initial_prompt_starts_the_fork_at_once_up_to_the_fork_point() -> TestResult {
        let harness = harness(true).await?;
        let response = fork(
            &harness,
            &json!({"threadId": SOURCE, "codewideAgentProvider": "claude", "model": "opus",
                "lastTurnId": "t1", "codewideInitialPrompt": "continue"}),
        )
        .await
        .map_err(|failure| failure.message)?;
        let forked = response["thread"]["id"]
            .as_str()
            .ok_or("no thread id")?
            .to_owned();
        assert_eq!(harness.target.created()[0].settings.model, "opus");
        assert!(
            harness.target.updated().is_empty(),
            "the first turn materializes the target without an extra title write"
        );
        let started = harness.target.started();
        assert_eq!(started.len(), 1);
        let input = serde_json::to_value(&started[0].input)?;
        let preamble = input[0]["text"].as_str().ok_or("no handoff")?;
        assert!(preamble.contains("first answer"));
        assert!(
            !preamble.contains("second question"),
            "turns after lastTurnId are excluded"
        );
        assert_eq!(input[1]["text"], "continue");
        assert_eq!(
            harness.fork.inject("turn/start", turn_start(&forked)),
            turn_start(&forked)
        );
        Ok(())
    }

    /// A same-provider fork reaches the native surface with the Codex
    /// `ThreadForkParams` execution overrides intact.
    #[test]
    fn a_native_fork_keeps_the_model_effort_and_service_tier() {
        let mut params = json!({"threadId": "t", "model": "m", "serviceTier": "priority",
            "config": {"model_reasoning_effort": "high"},
            "codewideAgentProvider": "codex", "codewideInitialPrompt": "x"});
        strip_extension_fields(&mut params);
        assert_eq!(
            params,
            json!({"threadId": "t", "model": "m", "serviceTier": "priority",
                "config": {"model_reasoning_effort": "high"}})
        );
    }

    #[tokio::test]
    async fn a_cross_provider_fork_creates_the_target_with_the_requested_effort_and_service_tier()
    -> TestResult {
        let harness = harness(true).await?;
        fork(
            &harness,
            &json!({"threadId": SOURCE, "codewideAgentProvider": "claude", "model": "opus",
                "serviceTier": "priority", "config": {"model_reasoning_effort": "high"}}),
        )
        .await
        .map_err(|failure| failure.message)?;
        fork(
            &harness,
            &json!({"threadId": SOURCE, "codewideAgentProvider": "claude",
                "serviceTier": "", "config": {"model_reasoning_effort": ""}}),
        )
        .await
        .map_err(|failure| failure.message)?;
        let settings: Vec<ThreadSettings> = harness
            .target
            .created()
            .into_iter()
            .map(|created| created.settings)
            .collect();
        assert_eq!(
            settings,
            [
                ThreadSettings {
                    model: "opus".into(),
                    effort: Some("high".into()),
                    permission_profile: ":workspace".into(),
                    service_tier: Some("priority".into()),
                },
                ThreadSettings {
                    model: "claude-default".into(),
                    effort: None,
                    permission_profile: ":workspace".into(),
                    service_tier: None,
                },
            ]
        );
        Ok(())
    }

    #[tokio::test]
    async fn a_cross_provider_fork_uses_the_targets_full_access_profile_id() -> TestResult {
        let harness = harness_for(
            "claude",
            ":full-access",
            "codex",
            &[":read-only", ":workspace", ":danger-full-access"],
            true,
        )
        .await?;
        fork(
            &harness,
            &json!({"threadId": SOURCE, "codewideAgentProvider": "codex"}),
        )
        .await
        .map_err(|failure| failure.message)?;

        assert_eq!(
            harness.target.created()[0].settings.permission_profile,
            ":danger-full-access"
        );
        Ok(())
    }

    #[tokio::test]
    async fn a_cross_provider_fork_inherits_the_observed_codex_sandbox() -> TestResult {
        let harness = harness_for(
            "codex",
            "",
            "claude",
            &[":read-only", ":workspace", ":full-access"],
            true,
        )
        .await?;
        harness.profiles.observe_rpc_result(
            &ProviderId::from_static("codex"),
            "thread/resume",
            &json!({"thread": {"id": SOURCE}, "activePermissionProfile": null,
                "sandbox": {"type": "dangerFullAccess"}}),
        );
        fork(
            &harness,
            &json!({"threadId": SOURCE, "codewideAgentProvider": "claude"}),
        )
        .await
        .map_err(|failure| failure.message)?;

        assert_eq!(
            harness.target.created()[0].settings.permission_profile,
            ":full-access"
        );
        Ok(())
    }

    #[tokio::test]
    async fn a_cross_provider_fork_with_an_unknown_source_profile_fails_closed() -> TestResult {
        let harness = harness_for(
            "codex",
            "",
            "claude",
            &[":read-only", ":workspace", ":full-access"],
            true,
        )
        .await?;
        fork(
            &harness,
            &json!({"threadId": SOURCE, "codewideAgentProvider": "claude"}),
        )
        .await
        .map_err(|failure| failure.message)?;

        assert_eq!(
            harness.target.created()[0].settings.permission_profile,
            ":read-only"
        );
        Ok(())
    }

    #[tokio::test]
    async fn a_target_without_the_capability_is_refused_before_any_write() -> TestResult {
        let harness = harness(false).await?;
        let failure = fork(
            &harness,
            &json!({"threadId": SOURCE, "codewideAgentProvider": "claude"}),
        )
        .await
        .err()
        .ok_or("the fork must be refused")?;
        assert_eq!(failure.code, -32_072);
        assert_eq!(
            failure.data,
            Some(json!({"capability": "threads.crossProviderFork", "provider": "claude"}))
        );
        assert!(harness.target.created().is_empty());
        Ok(())
    }

    fn saved_snapshot(
        harness: &Harness,
        response: &Value,
    ) -> Result<snapshot::Snapshot, Box<dyn std::error::Error>> {
        let id = response["thread"]["id"].as_str().ok_or("no target")?;
        let bytes = harness
            .store
            .agent_thread_fork(id)?
            .ok_or("no fork record")?;
        let record: ForkRecord = serde_json::from_slice(&bytes)?;
        record.snapshot.ok_or_else(|| "no snapshot".into())
    }

    #[tokio::test]
    async fn full_snapshot_crosses_old_turn_cap_and_can_cut_before_an_old_turn() -> TestResult {
        let harness = harness(true).await?;
        let turns = (0..605)
            .map(|index| {
                let mut turn = turn(
                    "placeholder",
                    &format!("request-{index}"),
                    &format!("answer-{index}"),
                );
                turn.turn_id = TurnId::parse(&format!("turn-{index}")).ok_or("invalid turn")?;
                Ok(turn)
            })
            .collect::<Result<Vec<_>, &str>>()?;
        harness.source.set_turns(SOURCE, turns);
        let response = fork(&harness, &json!({"threadId": SOURCE}))
            .await
            .map_err(|e| e.message)?;
        let snapshot = saved_snapshot(&harness, &response)?;
        let contents = std::fs::read_to_string(&snapshot.path)?;
        assert!(contents.contains("request-0") && contents.contains("answer-604"));
        assert!(contents.contains("## Turn 605:"));
        let response = fork(
            &harness,
            &json!({"threadId": SOURCE, "beforeTurnId": "turn-2"}),
        )
        .await
        .map_err(|e| e.message)?;
        let cut = saved_snapshot(&harness, &response)?;
        let contents = std::fs::read_to_string(cut.path)?;
        assert!(contents.contains("answer-1"));
        assert!(!contents.contains("request-2"));
        Ok(())
    }

    #[tokio::test]
    async fn overlapping_history_pages_keep_the_newest_copy_of_each_turn() -> TestResult {
        let harness = harness(true).await?;
        let mut turns = vec![turn("oldest", "oldest request", "oldest answer")];
        turns.push(turn(
            "repeated",
            "stale repeated request",
            "stale repeated answer",
        ));
        for index in 2..=100 {
            let mut unique = turn(
                "placeholder",
                &format!("request-{index}"),
                &format!("answer-{index}"),
            );
            unique.turn_id =
                TurnId::parse(&format!("turn-{index}")).ok_or("invalid synthetic turn id")?;
            turns.push(unique);
        }
        turns.push(turn(
            "repeated",
            "newest repeated request",
            "newest repeated answer",
        ));
        harness.source.set_turns(SOURCE, turns);

        let source = harness
            .gateway
            .resolve_thread(SOURCE, None)
            .await
            .map_err(|failure| failure.message)?;
        let observed = source_turns(&source.provider, &source, &snapshot::Boundary::Latest)
            .await
            .map_err(|failure| failure.message)?;
        assert_eq!(observed.len(), 101);
        let mut repeated = observed
            .iter()
            .filter(|turn| turn.turn_id.as_str() == "repeated");
        let repeated_turn = repeated.next().ok_or("repeated turn was lost")?;
        assert!(repeated.next().is_none(), "repeated turn was duplicated");
        assert!(repeated_turn.items.iter().any(
            |item| matches!(item, AgentItem::AgentMessage { text, .. } if text == "newest repeated answer")
        ));

        let response = fork(&harness, &json!({"threadId": SOURCE}))
            .await
            .map_err(|failure| failure.message)?;
        let snapshot = saved_snapshot(&harness, &response)?;
        assert!(snapshot.path.is_file());
        Ok(())
    }

    #[tokio::test]
    async fn invalid_boundary_never_creates_a_target_or_substitutes_other_history() -> TestResult {
        let harness = harness(true).await?;
        for params in [
            json!({"lastTurnId": "gone"}),
            json!({"beforeTurnId": "gone"}),
            json!({"lastTurnId": "t1", "beforeTurnId": "t2"}),
            json!({"lastTurnId": 5}),
        ] {
            assert_eq!(
                fork(&harness, &params)
                    .await
                    .err()
                    .ok_or("expected failure")?
                    .code,
                ERROR_INVALID_PARAMS
            );
        }
        assert!(harness.target.created().is_empty());
        Ok(())
    }

    #[test]
    fn old_pending_fork_records_still_decode() -> TestResult {
        let record: ForkRecord = serde_json::from_value(json!({
            "v": 1, "forkedFromId": "old", "sourceProvider": "claude", "provider": "codex",
            "createdAt": 1, "pendingHandoff": "old context"
        }))?;
        assert!(record.snapshot.is_none());
        assert_eq!(record.pending_handoff.as_deref(), Some("old context"));
        Ok(())
    }

    #[tokio::test]
    async fn a_busy_initial_start_keeps_the_context_for_retry_after_restart() -> TestResult {
        let harness = harness(true).await?;
        harness.target.set_busy(Some("active"));
        let failure = fork(&harness, &json!({"codewideInitialPrompt": "continue"}))
            .await
            .err()
            .ok_or("expected busy")?;
        assert_eq!(failure.code, ERROR_INVALID_REQUEST);
        let started = harness.target.started();
        let id = started[0].app_thread_id.as_str();
        let (journal, _rx) = tokio::sync::mpsc::channel(1);
        let restarted = ForkService::new(
            harness.gateway.clone(),
            harness.store.clone(),
            journal,
            harness.profiles.clone(),
        );
        let retried = restarted.inject("turn/start", turn_start(id));
        assert!(
            retried["input"][0]["text"]
                .as_str()
                .ok_or("no context")?
                .contains("first question")
        );
        let snapshot = saved_snapshot(&harness, &json!({"thread": {"id": id}}))?;
        assert!(std::fs::read_to_string(snapshot.path)?.contains("second answer"));
        Ok(())
    }

    #[tokio::test]
    async fn the_new_user_prompt_has_no_handoff_byte_cap() -> TestResult {
        let harness = harness(true).await?;
        let prompt = format!("  New instruction\n{}\n  ", "user text ".repeat(15_000));
        fork(&harness, &json!({"codewideInitialPrompt": prompt}))
            .await
            .map_err(|error| error.message)?;
        let started = harness.target.started();
        assert_eq!(started[0].input[1], UserContent::Text { text: prompt });
        Ok(())
    }
}
