//! Fork into another agent: `thread/fork` with `codewideAgentProvider`
//! naming a provider other than the thread's creates a new app thread on
//! that provider. The new thread's first turn carries a context handoff
//! built from the source thread's neutral history (`handoff`); the source
//! thread is unchanged. The handoff waits, durably, for the user's first
//! message unless the request carries `codewideInitialPrompt`.
//!
//! A fork to the thread's own provider is today's native fork with the
//! extension fields removed. See `docs/agent-providers.md#fork-into-another-agent`.

pub mod handoff;

use std::{collections::HashMap, sync::Arc, sync::Mutex};

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tracing::{error, info, warn};

use crate::{
    agent::{
        client_wire::{
            FORK_INITIAL_PROMPT_FIELD, PROVIDER_FIELD,
            gateway::{ClientWireGateway, RpcFailure, Target, default_model},
            observe::{TurnFact, turn_fact},
        },
        model::{
            AgentTurn, Capability, ERROR_INVALID_PARAMS, ItemsView, ProviderId, SortDirection,
            ThreadSettings, ThreadTurnsParams, TurnStartParams, UserContent,
        },
        provider::AgentProvider,
    },
    store::IndexStore,
};

const FORK_RECORD_VERSION: u32 = 1;
/// Turns read from the source thread for the handoff, newest first.
const MAX_SOURCE_TURNS: usize = 500;
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
}

/// The cross-provider fork service.
pub struct ForkService {
    gateway: Arc<ClientWireGateway>,
    store: Arc<IndexStore>,
    journal: tokio::sync::mpsc::Sender<Value>,
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
        let turns = source_turns(&source.provider, source, params).await?;
        let preamble = handoff::handoff_preamble(
            source.thread_id.as_str(),
            source.wire.descriptor.id.as_str(),
            &turns,
            handoff::DEFAULT_HANDOFF_BUDGET,
        );
        let wire = self.gateway.wire(&target);
        let (cwd, settings) = fork_settings(&target, &source_thread, params).await?;
        let thread = self
            .gateway
            .create_thread(&target, &wire, cwd, settings)
            .await?;
        let forked = thread.app_thread_id.clone();
        let initial_prompt = text_field(params, FORK_INITIAL_PROMPT_FIELD);
        let record = ForkRecord {
            v: FORK_RECORD_VERSION,
            forked_from_id: source.thread_id.as_str().to_owned(),
            source_provider: source.wire.descriptor.id.clone(),
            provider: wire.descriptor.id.clone(),
            created_at: thread.created_at,
            pending_handoff: initial_prompt.is_none().then(|| preamble.clone()),
        };
        self.write_record(forked.as_str(), &record).await?;
        if record.pending_handoff.is_some() {
            self.pending()
                .insert(forked.as_str().to_owned(), preamble.clone());
        }
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
            target
                .turn_start(TurnStartParams {
                    app_thread_id: forked.clone(),
                    client_message_id: None,
                    input: vec![
                        UserContent::Text { text: preamble },
                        UserContent::Text { text: prompt },
                    ],
                    client_tools: None,
                })
                .await
                .map_err(|error| RpcFailure::from_provider(&error))?;
        }
        Ok(response)
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

/// The fork's working directory and settings: the request's `cwd`, `model`
/// and `permissions`, else the source thread's (the target's default model).
async fn fork_settings(
    target: &Arc<dyn AgentProvider>,
    source: &crate::agent::model::AgentThread,
    params: &Value,
) -> Result<(String, ThreadSettings), RpcFailure> {
    let model = match text_field(params, "model") {
        Some(model) => model,
        None => default_model(target).await?,
    };
    let permission_profile = text_field(params, "permissions")
        .or_else(|| {
            Some(source.settings.permission_profile.clone()).filter(|profile| !profile.is_empty())
        })
        .unwrap_or_else(|| ":workspace".to_owned());
    Ok((
        text_field(params, "cwd").unwrap_or_else(|| source.cwd.clone()),
        ThreadSettings {
            model,
            effort: None,
            permission_profile,
            service_tier: None,
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
    params: &Value,
) -> Result<Vec<AgentTurn>, RpcFailure> {
    let mut turns = Vec::new();
    let mut cursor = None;
    while turns.len() < MAX_SOURCE_TURNS {
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
        turns.extend(page.turns);
        match page.next_cursor {
            Some(next) => cursor = Some(next),
            None => break,
        }
    }
    turns.truncate(MAX_SOURCE_TURNS);
    turns.reverse();
    let position = |field: &str| {
        params
            .get(field)
            .and_then(Value::as_str)
            .and_then(|id| turns.iter().position(|turn| turn.turn_id.as_str() == id))
    };
    if let Some(last) = position("lastTurnId") {
        turns.truncate(last + 1);
    } else if let Some(before) = position("beforeTurnId") {
        turns.truncate(before);
    }
    Ok(turns)
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
        claude: Arc<ScriptedProvider>,
        gateway: Arc<ClientWireGateway>,
        store: Arc<IndexStore>,
        journal: tokio::sync::mpsc::Receiver<Value>,
        _directory: tempfile::TempDir,
    }

    async fn harness(target_forks: bool) -> Result<Harness, Box<dyn std::error::Error>> {
        let directory = tempfile::tempdir()?;
        let store = Arc::new(IndexStore::open(directory.path().join("state.redb"))?);
        let mut source = thread("codex", SOURCE, 5);
        source.cwd = "/repo".into();
        let codex =
            Arc::new(ScriptedProvider::new("codex", capabilities(true)).with_thread(source));
        codex.set_turns(
            SOURCE,
            vec![
                turn("t1", "first question", "first answer"),
                turn("t2", "second question", "second answer"),
            ],
        );
        let claude = Arc::new(ScriptedProvider::new("claude", capabilities(target_forks)));
        let codex_dyn: Arc<dyn AgentProvider> = codex;
        let claude_dyn: Arc<dyn AgentProvider> = claude.clone();
        let registry = Arc::new(ProviderRegistry::new(
            vec![codex_dyn, claude_dyn],
            &ProviderId::from_static("codex"),
            Vec::new(),
        )?);
        let bindings = Arc::new(BindingStore::new(store.clone()));
        bindings
            .bind(
                &AppThreadId::from_static(SOURCE),
                &ProviderId::from_static("codex"),
                BindingOrigin::Created,
            )
            .await?;
        let gateway = Arc::new(ClientWireGateway::new(registry, bindings));
        let (journal_tx, journal) = tokio::sync::mpsc::channel(8);
        Ok(Harness {
            fork: ForkService::new(gateway.clone(), store.clone(), journal_tx),
            claude,
            gateway,
            store,
            journal,
            _directory: directory,
        })
    }

    async fn fork(harness: &Harness, params: &Value) -> Result<Value, RpcFailure> {
        let source = harness.gateway.resolve_thread(SOURCE, None).await?;
        harness
            .fork
            .fork(&source, &ProviderId::from_static("claude"), params)
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
        let created = harness.claude.created();
        assert_eq!(created.len(), 1);
        assert_eq!(created[0].cwd, "/repo");
        assert_eq!(created[0].settings.model, "claude-default");
        assert!(
            harness.claude.started().is_empty(),
            "no turn before the user's message"
        );
        let announced = harness.journal.recv().await.ok_or("no thread/started")?;
        assert_eq!(announced["params"]["thread"]["id"], forked.as_str());
        assert_eq!(announced["params"]["thread"]["forkedFromId"], SOURCE);

        let injected = harness.fork.inject("turn/start", turn_start(&forked));
        let preamble = injected["input"][0]["text"].as_str().ok_or("no handoff")?;
        assert!(preamble.contains("first question") && preamble.contains("second answer"));
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
        let restarted = ForkService::new(harness.gateway.clone(), harness.store.clone(), journal);
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
                let reopened =
                    ForkService::new(harness.gateway.clone(), harness.store.clone(), journal);
                if reopened.inject("turn/start", turn_start(&forked)) == turn_start(&forked) {
                    break;
                }
                tokio::task::yield_now().await;
            }
        })
        .await?;
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
        assert_eq!(harness.claude.created()[0].settings.model, "opus");
        let started = harness.claude.started();
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
        assert!(harness.claude.created().is_empty());
        Ok(())
    }
}
