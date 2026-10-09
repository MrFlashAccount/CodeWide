//! Thread → provider bindings: the durable store, observation upserts, the
//! one-time backfill job and discovery on a miss.
//!
//! Invariants (phase 1): every thread has exactly one binding with exactly
//! one provider ref equal to the app thread id, and a binding's provider
//! never changes. Upserts insert only absent keys; a conflicting claim is
//! logged at `error` and ignored. Routing reads only bindings, never model
//! ids, `thread_metadata.model_provider` or id shapes.

use std::{
    collections::{BTreeMap, HashMap},
    sync::{Arc, Mutex},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use tracing::{error, info, warn};

use super::{
    model::{
        AppThreadId, ProviderId, ProviderThreadRef, SortDirection, ThreadListParams, ThreadSortKey,
    },
    provider::{AgentProvider, ProviderStatus},
    registry::ProviderRegistry,
};
use crate::store::{BindingWrite, IndexStore, StoreError};

const BINDING_RECORD_VERSION: u8 = 1;
const MAX_CACHED_BINDINGS: usize = 16_384;
const BACKFILL_MARKER_PREFIX: &str = "agent_bindings_backfill_v1:";
const BACKFILL_PAGE_SIZE: u32 = 100;
const BACKFILL_RETRY: Duration = Duration::from_secs(30);

/// How a binding came to exist.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum BindingOrigin {
    /// Written by `thread/start` before the response was sent.
    Created,
    /// Written when a provider reported or recognized the thread.
    Discovered,
    /// Written by the one-time backfill job.
    Backfilled,
}

/// Versioned durable record (`v: 1`).
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BindingRecord {
    v: u8,
    app_thread_id: AppThreadId,
    active_provider: ProviderId,
    refs: BTreeMap<ProviderId, ProviderThreadRef>,
    origin: BindingOrigin,
    created_at_ms: u64,
}

impl BindingRecord {
    fn new(app_thread_id: &AppThreadId, provider: &ProviderId, origin: BindingOrigin) -> Self {
        let created_at_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_or(0, |elapsed| {
                u64::try_from(elapsed.as_millis()).unwrap_or(u64::MAX)
            });
        // Phase 1: the provider's thread handle is the app thread id itself.
        let thread_ref = ProviderThreadRef::same_as(app_thread_id);
        Self {
            v: BINDING_RECORD_VERSION,
            app_thread_id: app_thread_id.clone(),
            active_provider: provider.clone(),
            refs: BTreeMap::from([(provider.clone(), thread_ref)]),
            origin,
            created_at_ms,
        }
    }
}

#[derive(Debug, thiserror::Error)]
pub enum BindingError {
    #[error(transparent)]
    Store(#[from] StoreError),
    #[error("binding record is invalid: {0}")]
    Invalid(#[from] serde_json::Error),
    #[error("binding worker failed: {0}")]
    Worker(String),
}

/// Result of a single bind attempt.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum BindOutcome {
    Bound,
    AlreadyBound,
    /// The thread is bound to another provider; the claim was ignored.
    Conflict {
        existing: ProviderId,
    },
}

/// Where a thread-scoped call goes.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ThreadRoute {
    /// An explicit binding exists.
    Bound(ProviderId),
    /// No binding yet; exactly one provider can discover external threads.
    /// The caller confirms the binding after that provider accepted the call.
    Provisional(ProviderId),
    /// No provider owns the id.
    Unknown,
}

/// Durable binding store with a bounded read cache.
pub struct BindingStore {
    store: Arc<IndexStore>,
    cache: Mutex<HashMap<AppThreadId, ProviderId>>,
}

impl BindingStore {
    #[must_use]
    pub fn new(store: Arc<IndexStore>) -> Self {
        Self {
            store,
            cache: Mutex::new(HashMap::new()),
        }
    }

    fn cached(&self, id: &AppThreadId) -> Option<ProviderId> {
        self.cache
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .get(id)
            .cloned()
    }

    fn remember(&self, id: AppThreadId, provider: ProviderId) {
        let mut cache = self
            .cache
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if cache.len() >= MAX_CACHED_BINDINGS {
            cache.clear();
        }
        cache.insert(id, provider);
    }

    /// The provider bound to a thread, if any.
    ///
    /// # Errors
    /// Returns an error when the durable store cannot be read.
    pub async fn provider_of(&self, id: &AppThreadId) -> Result<Option<ProviderId>, BindingError> {
        if let Some(provider) = self.cached(id) {
            return Ok(Some(provider));
        }
        let store = self.store.clone();
        let key = id.clone();
        let stored = tokio::task::spawn_blocking(move || store.agent_binding(key.as_str()))
            .await
            .map_err(|error| BindingError::Worker(error.to_string()))??;
        let Some(stored) = stored else {
            return Ok(None);
        };
        let record: BindingRecord = serde_json::from_slice(&stored)?;
        self.remember(id.clone(), record.active_provider.clone());
        Ok(Some(record.active_provider))
    }

    /// Binds one thread unless it is bound already.
    ///
    /// # Errors
    /// Returns an error when the durable store cannot be written.
    pub async fn bind(
        &self,
        id: &AppThreadId,
        provider: &ProviderId,
        origin: BindingOrigin,
    ) -> Result<BindOutcome, BindingError> {
        let outcomes = self
            .bind_many(provider, std::slice::from_ref(id), origin)
            .await?;
        Ok(outcomes
            .into_iter()
            .next()
            .unwrap_or(BindOutcome::AlreadyBound))
    }

    /// Binds every id that is not bound yet, in one transaction. Conflicting
    /// claims are logged at `error` and ignored.
    ///
    /// # Errors
    /// Returns an error when the durable store cannot be written.
    pub async fn bind_many(
        &self,
        provider: &ProviderId,
        ids: &[AppThreadId],
        origin: BindingOrigin,
    ) -> Result<Vec<BindOutcome>, BindingError> {
        let mut pending = Vec::with_capacity(ids.len());
        let mut outcomes = vec![BindOutcome::AlreadyBound; ids.len()];
        for (index, id) in ids.iter().enumerate() {
            match self.cached(id) {
                Some(existing) if &existing == provider => {}
                Some(existing) => {
                    error!(app_thread_id = %id, existing = %existing, claimed = %provider, "conflicting thread binding claim ignored");
                    outcomes[index] = BindOutcome::Conflict { existing };
                }
                None => pending.push((index, id.clone())),
            }
        }
        if pending.is_empty() {
            return Ok(outcomes);
        }
        let records = pending
            .iter()
            .map(|(_, id)| {
                serde_json::to_vec(&BindingRecord::new(id, provider, origin))
                    .map(|record| (id.clone(), record))
            })
            .collect::<Result<Vec<_>, _>>()?;
        let store = self.store.clone();
        let writes = tokio::task::spawn_blocking(move || {
            let borrowed = records
                .iter()
                .map(|(id, record)| (id.as_str(), record.as_slice()))
                .collect::<Vec<_>>();
            store.agent_bindings_insert_absent(&borrowed)
        })
        .await
        .map_err(|error| BindingError::Worker(error.to_string()))??;
        for ((index, id), write) in pending.into_iter().zip(writes) {
            match write {
                BindingWrite::Inserted => {
                    self.remember(id, provider.clone());
                    outcomes[index] = BindOutcome::Bound;
                }
                BindingWrite::Existing(existing) => {
                    let record: BindingRecord = serde_json::from_slice(&existing)?;
                    self.remember(id.clone(), record.active_provider.clone());
                    if &record.active_provider != provider {
                        error!(app_thread_id = %id, existing = %record.active_provider, claimed = %provider, "conflicting thread binding claim ignored");
                        outcomes[index] = BindOutcome::Conflict {
                            existing: record.active_provider,
                        };
                    }
                }
            }
        }
        Ok(outcomes)
    }

    /// Resolves the provider of a thread-scoped call: the binding when it
    /// exists, otherwise discovery. With exactly one discovery provider the
    /// route is provisional (no extra provider call); with several, each is
    /// asked in registry order and the first owner is bound.
    ///
    /// # Errors
    /// Returns an error when bindings cannot be read or written.
    pub async fn route(
        &self,
        registry: &ProviderRegistry,
        id: &AppThreadId,
    ) -> Result<ThreadRoute, BindingError> {
        if let Some(provider) = self.provider_of(id).await? {
            return Ok(ThreadRoute::Bound(provider));
        }
        let candidates = registry.discovery_providers().cloned().collect::<Vec<_>>();
        match candidates.as_slice() {
            [] => Ok(ThreadRoute::Unknown),
            [only] => Ok(ThreadRoute::Provisional(only.descriptor().id)),
            several => {
                for provider in several {
                    match provider.thread_owns(id).await {
                        Ok(true) => {
                            let provider_id = provider.descriptor().id;
                            self.bind(id, &provider_id, BindingOrigin::Discovered)
                                .await?;
                            return Ok(ThreadRoute::Bound(provider_id));
                        }
                        Ok(false) => {}
                        Err(error) => {
                            warn!(app_thread_id = %id, provider = %provider.descriptor().id, err = %error, "thread discovery failed");
                        }
                    }
                }
                Ok(ThreadRoute::Unknown)
            }
        }
    }

    fn backfill_marker_key(provider: &ProviderId) -> String {
        format!("{BACKFILL_MARKER_PREFIX}{provider}")
    }
}

/// Durable progress of the one-time backfill of one provider.
#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BackfillProgress {
    archived: bool,
    cursor: Option<String>,
    done: bool,
}

/// Runs the `agent_bindings_backfill_v1` job for one external-discovery
/// provider: pages its `thread.list` for non-archived then archived threads
/// and binds every row. Progress is durable after each page, so a restart
/// resumes where it stopped and never duplicates a binding.
pub async fn run_backfill(
    bindings: Arc<BindingStore>,
    provider: Arc<dyn AgentProvider>,
    start_delay: Duration,
) {
    let provider_id = provider.descriptor().id;
    let marker_key = BindingStore::backfill_marker_key(&provider_id);
    let mut progress = match read_progress(&bindings.store, &marker_key).await {
        Ok(progress) => progress,
        Err(error) => {
            error!(provider = %provider_id, err = ?error, "binding backfill marker is unreadable");
            return;
        }
    };
    if progress.done {
        return;
    }
    tokio::time::sleep(start_delay).await;
    let mut status = provider.subscribe_status();
    let mut bound = 0_usize;
    while !progress.done {
        while *status.borrow() != ProviderStatus::Live {
            if status.changed().await.is_err() {
                return;
            }
        }
        let page = provider
            .thread_list(ThreadListParams {
                archived: progress.archived,
                cwd: None,
                search_term: None,
                sort_key: ThreadSortKey::CreatedAt,
                sort_direction: SortDirection::Desc,
                window: None,
                cursor: progress.cursor.clone(),
                limit: BACKFILL_PAGE_SIZE,
            })
            .await;
        let page = match page {
            Ok(page) => page,
            Err(error) => {
                warn!(provider = %provider_id, err = %error, "binding backfill page failed; retrying");
                tokio::time::sleep(BACKFILL_RETRY).await;
                continue;
            }
        };
        let ids = page
            .threads
            .iter()
            .map(|thread| thread.app_thread_id.clone())
            .collect::<Vec<_>>();
        if let Err(error) = bindings
            .bind_many(&provider_id, &ids, BindingOrigin::Backfilled)
            .await
        {
            warn!(provider = %provider_id, err = ?error, "binding backfill write failed; retrying");
            tokio::time::sleep(BACKFILL_RETRY).await;
            continue;
        }
        bound = bound.saturating_add(ids.len());
        progress = match page.next_cursor {
            Some(cursor) => BackfillProgress {
                archived: progress.archived,
                cursor: Some(cursor),
                done: false,
            },
            None if !progress.archived => BackfillProgress {
                archived: true,
                cursor: None,
                done: false,
            },
            None => BackfillProgress {
                archived: true,
                cursor: None,
                done: true,
            },
        };
        if let Err(error) = write_progress(&bindings.store, &marker_key, &progress).await {
            warn!(provider = %provider_id, err = ?error, "binding backfill progress write failed; retrying");
            tokio::time::sleep(BACKFILL_RETRY).await;
        }
    }
    info!(provider = %provider_id, rows = bound, "binding backfill finished");
}

async fn read_progress(
    store: &Arc<IndexStore>,
    key: &str,
) -> Result<BackfillProgress, BindingError> {
    let store = store.clone();
    let key = key.to_owned();
    let stored = tokio::task::spawn_blocking(move || store.agent_meta(&key))
        .await
        .map_err(|error| BindingError::Worker(error.to_string()))??;
    match stored {
        Some(bytes) => Ok(serde_json::from_slice(&bytes)?),
        None => Ok(BackfillProgress::default()),
    }
}

async fn write_progress(
    store: &Arc<IndexStore>,
    key: &str,
    progress: &BackfillProgress,
) -> Result<(), BindingError> {
    let encoded = serde_json::to_vec(progress)?;
    let store = store.clone();
    let key = key.to_owned();
    tokio::task::spawn_blocking(move || store.put_agent_meta(&key, &encoded))
        .await
        .map_err(|error| BindingError::Worker(error.to_string()))??;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn id(value: &str) -> Result<AppThreadId, Box<dyn std::error::Error>> {
        AppThreadId::parse(value).ok_or_else(|| "invalid id".into())
    }

    fn provider(value: &str) -> Result<ProviderId, Box<dyn std::error::Error>> {
        ProviderId::parse(value).ok_or_else(|| "invalid provider".into())
    }

    #[tokio::test]
    async fn a_binding_never_changes_provider_and_survives_reopen()
    -> Result<(), Box<dyn std::error::Error>> {
        let directory = tempfile::tempdir()?;
        let path = directory.path().join("state.redb");
        {
            let bindings = BindingStore::new(Arc::new(IndexStore::open(&path)?));
            assert_eq!(
                bindings
                    .bind(
                        &id("thread-1")?,
                        &provider("claude")?,
                        BindingOrigin::Created
                    )
                    .await?,
                BindOutcome::Bound
            );
            assert_eq!(
                bindings
                    .bind(
                        &id("thread-1")?,
                        &provider("claude")?,
                        BindingOrigin::Discovered
                    )
                    .await?,
                BindOutcome::AlreadyBound
            );
            assert_eq!(
                bindings
                    .bind(
                        &id("thread-1")?,
                        &provider("codex")?,
                        BindingOrigin::Discovered
                    )
                    .await?,
                BindOutcome::Conflict {
                    existing: provider("claude")?
                }
            );
        }
        let reopened = BindingStore::new(Arc::new(IndexStore::open(&path)?));
        assert_eq!(
            reopened.provider_of(&id("thread-1")?).await?,
            Some(provider("claude")?)
        );
        assert_eq!(
            reopened
                .bind(
                    &id("thread-1")?,
                    &provider("codex")?,
                    BindingOrigin::Backfilled
                )
                .await?,
            BindOutcome::Conflict {
                existing: provider("claude")?
            }
        );
        assert_eq!(reopened.provider_of(&id("thread-2")?).await?, None);
        Ok(())
    }

    #[tokio::test]
    async fn the_record_is_versioned_with_one_ref_equal_to_the_thread_id()
    -> Result<(), Box<dyn std::error::Error>> {
        let directory = tempfile::tempdir()?;
        let store = Arc::new(IndexStore::open(directory.path().join("state.redb"))?);
        let bindings = BindingStore::new(store.clone());
        bindings
            .bind(
                &id("thread-9")?,
                &provider("codex")?,
                BindingOrigin::Backfilled,
            )
            .await?;
        let stored: serde_json::Value =
            serde_json::from_slice(&store.agent_binding("thread-9")?.ok_or("record missing")?)?;
        assert_eq!(stored["v"], 1);
        assert_eq!(stored["activeProvider"], "codex");
        assert_eq!(stored["refs"], serde_json::json!({"codex": "thread-9"}));
        assert_eq!(stored["origin"], "backfilled");
        Ok(())
    }

    fn discovery_capabilities() -> crate::agent::model::CapabilitySet {
        let mut capabilities = crate::agent::model::CapabilitySet::none(
            crate::agent::model::StartWhileActiveMode::NativeJoin,
        );
        capabilities.threads_external_discovery = true;
        capabilities
    }

    #[tokio::test]
    async fn backfill_binds_every_thread_and_resumes_after_a_restart()
    -> Result<(), Box<dyn std::error::Error>> {
        use crate::agent::testing::{FakeProvider, thread};

        let directory = tempfile::tempdir()?;
        let store = Arc::new(IndexStore::open(directory.path().join("state.redb"))?);
        let bindings = Arc::new(BindingStore::new(store.clone()));
        let mut fake = FakeProvider::new("codex", discovery_capabilities());
        fake.threads = (0..1_000)
            .map(|index| {
                let mut row = thread("codex", &format!("thread-{index:04}"), index);
                row.archived = index % 2 == 1;
                row
            })
            .collect();
        let fake = fake.into_arc();
        let first = tokio::spawn(run_backfill(bindings.clone(), fake.clone(), Duration::ZERO));
        let marker = BindingStore::backfill_marker_key(&ProviderId::from_static("codex"));
        tokio::time::timeout(Duration::from_secs(5), async {
            loop {
                if let Ok(Some(progress)) = store.agent_meta(&marker)
                    && serde_json::from_slice::<BackfillProgress>(&progress)
                        .is_ok_and(|progress| progress.cursor.as_deref() == Some("300"))
                {
                    return;
                }
                tokio::task::yield_now().await;
            }
        })
        .await?;
        first.abort();
        let calls_before_restart = fake.calls().len();
        // A fresh store handle stands for a restarted companion.
        let restarted = Arc::new(BindingStore::new(store.clone()));
        run_backfill(restarted.clone(), fake.clone(), Duration::ZERO).await;
        let resumed_calls = fake.calls().len() - calls_before_restart;
        assert!(
            resumed_calls < 10 + 5,
            "restart resumed instead of starting over"
        );
        for index in 0..1_000 {
            let id = AppThreadId::parse(&format!("thread-{index:04}")).ok_or("id")?;
            assert_eq!(
                restarted.provider_of(&id).await?,
                Some(ProviderId::from_static("codex")),
                "{id}"
            );
        }
        let progress: BackfillProgress =
            serde_json::from_slice(&store.agent_meta(&marker)?.ok_or("marker")?)?;
        assert!(progress.done);
        // A finished backfill never pages again.
        let calls = fake.calls().len();
        run_backfill(restarted, fake.clone(), Duration::ZERO).await;
        assert_eq!(fake.calls().len(), calls);
        Ok(())
    }

    #[tokio::test]
    async fn discovery_asks_owners_in_registry_order_only_when_ambiguous()
    -> Result<(), Box<dyn std::error::Error>> {
        use crate::agent::{provider::AgentProvider, testing::FakeProvider};

        let directory = tempfile::tempdir()?;
        let bindings = BindingStore::new(Arc::new(IndexStore::open(
            directory.path().join("state.redb"),
        )?));
        let lone = FakeProvider::new("codex", discovery_capabilities()).into_arc();
        let single = ProviderRegistry::single(lone.clone(), Vec::new());
        assert_eq!(
            bindings.route(&single, &id("cli-thread")?).await?,
            ThreadRoute::Provisional(ProviderId::from_static("codex"))
        );
        assert!(lone.calls().is_empty(), "a lone discoverer is not asked");

        let first = FakeProvider::new("codex", discovery_capabilities()).into_arc();
        let mut second = FakeProvider::new("other", discovery_capabilities());
        second.owned = vec!["other-thread".into()];
        let second = second.into_arc();
        let registry = ProviderRegistry::new(
            vec![
                first.clone() as Arc<dyn AgentProvider>,
                second.clone() as Arc<dyn AgentProvider>,
            ],
            &ProviderId::from_static("codex"),
            Vec::new(),
        )?;
        assert_eq!(
            bindings.route(&registry, &id("other-thread")?).await?,
            ThreadRoute::Bound(ProviderId::from_static("other"))
        );
        assert_eq!(first.calls(), ["thread.owns"]);
        assert_eq!(
            bindings.provider_of(&id("other-thread")?).await?,
            Some(ProviderId::from_static("other"))
        );
        assert_eq!(
            bindings.route(&registry, &id("nobody")?).await?,
            ThreadRoute::Unknown
        );
        Ok(())
    }
}
