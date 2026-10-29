//! The one canonical ordinary conversation of a pull request.
//!
//! Opening the conversation is deliberately separate from starting an agent
//! scenario: `ensure` creates or reuses a thread and links it, but never
//! enqueues input. A scenario with the `reviewChat` target resolves its
//! thread through the same [`resolve_placed`] before it enqueues. A single
//! companion-owned lane makes concurrent callers for the same (or another)
//! pull request observe the same durable mapping. Archived threads are never
//! canonical: an archived canonical thread is replaced and stored anew.
//! Where a new thread runs is the request's [`Placement`]: an opted-in
//! client is asked instead of given a silently chosen directory, and a live
//! canonical or linked thread is always returned without asking.

use std::sync::Arc;

use serde::Deserialize;
use serde_json::{Value, json};

use super::{
    ForgeContext,
    chat_workspace::{self, Creation, Placement, WORKSPACE_PROFILE, WorkspaceRequest},
    errors::ForgeError,
    ids::{PullRequestIdentity, PullRequestKey, parse_thread_id},
    links::{LinkOutcome, Links},
    params,
    reads::load_overview,
    wire::{LinkSource, LinkedThreadWire, OverviewWire},
};
use crate::{
    agent::{model::AppThreadId, permission_profiles::READ_ONLY},
    agent_bridge::{AgentBridge, ThreadPresence},
    store::{IndexStore, forge_tables::FORGE_PR_REVIEW_THREADS, kv::KvOp},
};

#[derive(Clone)]
pub struct ReviewChats {
    lane: Arc<tokio::sync::Mutex<()>>,
    store: Arc<IndexStore>,
}

impl ReviewChats {
    #[must_use]
    pub fn new(store: Arc<IndexStore>) -> Self {
        Self {
            lane: Arc::new(tokio::sync::Mutex::new(())),
            store,
        }
    }

    /// Holds the companion-owned lane: canonical resolution and scenario
    /// admission for every pull request run one at a time inside it.
    pub(crate) async fn lane(&self) -> ReviewLane<'_> {
        ReviewLane {
            _guard: self.lane.lock().await,
        }
    }

    /// The durable canonical thread, if one was assigned.
    ///
    /// # Errors
    ///
    /// Returns a storage failure or corrupt internal record.
    pub fn get(&self, pull_request: &PullRequestKey) -> Result<Option<AppThreadId>, ForgeError> {
        self.store
            .kv_get(FORGE_PR_REVIEW_THREADS, pull_request.as_str())?
            .map(|value| {
                let thread = std::str::from_utf8(&value)
                    .ok()
                    .and_then(parse_thread_id)
                    .ok_or_else(|| ForgeError::internal("invalid stored review thread"))?;
                Ok(thread)
            })
            .transpose()
    }

    fn put(&self, pull_request: &PullRequestKey, thread: &AppThreadId) -> Result<(), ForgeError> {
        self.store.kv_apply(vec![KvOp::Put {
            table: FORGE_PR_REVIEW_THREADS,
            key: pull_request.as_str().to_owned(),
            value: thread.as_str().as_bytes().to_vec(),
        }])?;
        Ok(())
    }

    /// Clears the canonical role when that exact link is explicitly removed.
    ///
    /// # Errors
    ///
    /// Returns a storage failure.
    pub fn clear_if(
        &self,
        pull_request: &PullRequestKey,
        thread: &AppThreadId,
    ) -> Result<(), ForgeError> {
        if self.get(pull_request)?.as_ref() != Some(thread) {
            return Ok(());
        }
        self.store.kv_apply(vec![KvOp::Delete {
            table: FORGE_PR_REVIEW_THREADS,
            key: pull_request.as_str().to_owned(),
        }])?;
        Ok(())
    }
}

/// Proof that the caller holds the review chat lane.
pub(crate) struct ReviewLane<'a> {
    _guard: tokio::sync::MutexGuard<'a, ()>,
}

/// The canonical review thread a resolution settled on.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum Canonical {
    /// The stored canonical thread is live and stays canonical.
    Kept(AppThreadId),
    /// An existing linked thread became canonical.
    Reassigned(AppThreadId),
    /// A new thread was created, linked and made canonical.
    Created(AppThreadId),
}

impl Canonical {
    pub(crate) fn thread(&self) -> &AppThreadId {
        match self {
            Self::Kept(thread) | Self::Reassigned(thread) | Self::Created(thread) => thread,
        }
    }

    pub(crate) fn created(&self) -> bool {
        matches!(self, Self::Created(_))
    }
}

/// Reads whether a thread can take new work.
pub(crate) trait ThreadStates {
    fn presence(
        &self,
        thread: &AppThreadId,
    ) -> impl Future<Output = Result<ThreadPresence, ForgeError>> + Send;
}

impl ThreadStates for AgentBridge {
    async fn presence(&self, thread: &AppThreadId) -> Result<ThreadPresence, ForgeError> {
        self.thread_presence(thread.as_str())
            .await
            .map_err(|reason| ForgeError::CapabilityUnavailable { reason })
    }
}

/// What one opening of the review chat settled on.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum Opening {
    /// The canonical thread, kept, reassigned or created.
    Ready(Canonical),
    /// No live thread exists and the client chooses where one runs.
    NeedsWorkspace,
}

/// Resolves the pull request's canonical review thread inside the
/// companion-owned lane: the stored canonical thread while it is live,
/// otherwise a live linked thread (branch links first), otherwise a thread
/// from `create`, which is linked. Whatever is chosen becomes canonical;
/// archived and missing threads are never chosen.
///
/// # Errors
///
/// Returns a storage failure, an unreadable thread state or the creation
/// failure; the stored mapping is unchanged then.
// WHY: test-only since every entry point names its placement; it keeps the
// older-client resolution under test without restating the placement.
#[cfg(test)]
pub(crate) async fn resolve<Create, Created>(
    chats: &ReviewChats,
    lane: &ReviewLane<'_>,
    links: &Links,
    key: &PullRequestKey,
    identity: &PullRequestIdentity,
    states: &impl ThreadStates,
    create: Create,
) -> Result<Canonical, ForgeError>
where
    Create: FnOnce() -> Created,
    Created: Future<Output = Result<AppThreadId, ForgeError>>,
{
    let opening = resolve_placed(
        chats,
        lane,
        links,
        key,
        identity,
        states,
        &Placement::Companion,
        |_| create(),
    )
    .await?;
    match opening {
        Opening::Ready(canonical) => Ok(canonical),
        Opening::NeedsWorkspace => Err(ForgeError::internal(
            "the companion placement never asks the client",
        )),
    }
}

/// [`resolve`] for a request whose `placement` may ask the client: with
/// no live thread to keep or reuse, `Placement::Ask` creates nothing and
/// answers [`Opening::NeedsWorkspace`].
///
/// # Errors
///
/// As [`resolve`].
// WHY: the lane proof and the resolution inputs are distinct borrows of the
// caller; bundling them into a struct would only restate this parameter list.
#[allow(clippy::too_many_arguments)]
pub(crate) async fn resolve_placed<'p, Create, Created>(
    chats: &ReviewChats,
    _lane: &ReviewLane<'_>,
    links: &Links,
    key: &PullRequestKey,
    identity: &PullRequestIdentity,
    states: &impl ThreadStates,
    placement: &'p Placement,
    create: Create,
) -> Result<Opening, ForgeError>
where
    Create: FnOnce(Creation<'p>) -> Created,
    Created: Future<Output = Result<AppThreadId, ForgeError>>,
{
    if let Some(thread) = chats.get(key)?
        && states.presence(&thread).await? == ThreadPresence::Live
    {
        return Ok(Opening::Ready(Canonical::Kept(thread)));
    }
    if let Some(thread) = reusable_link(links, key, states).await? {
        chats.put(key, &thread)?;
        return Ok(Opening::Ready(Canonical::Reassigned(thread)));
    }
    let Some(creation) = placement.creation() else {
        return Ok(Opening::NeedsWorkspace);
    };
    let thread = create(creation).await?;
    let outcome = links.link(
        key,
        &identity.plugin_id,
        &identity.pr_ref.number,
        &thread,
        LinkSource::Manual,
    )?;
    debug_assert_ne!(outcome, LinkOutcome::Tombstoned);
    chats.put(key, &thread)?;
    Ok(Opening::Ready(Canonical::Created(thread)))
}

/// [`resolve_placed`] against the companion's agents under the lane,
/// publishing the change to pull request (and, for a new link, list)
/// readers.
///
/// # Errors
///
/// As [`resolve`].
pub(crate) async fn open<'p, Create, Created>(
    context: &ForgeContext,
    key: &PullRequestKey,
    identity: &PullRequestIdentity,
    agents: &AgentBridge,
    placement: &'p Placement,
    create: Create,
) -> Result<Opening, ForgeError>
where
    Create: FnOnce(Creation<'p>) -> Created,
    Created: Future<Output = Result<AppThreadId, ForgeError>>,
{
    let lane = context.review_chats.lane().await;
    let opening = resolve_placed(
        &context.review_chats,
        &lane,
        &context.links,
        key,
        identity,
        agents,
        placement,
        create,
    )
    .await?;
    drop(lane);
    if let Opening::Ready(canonical) = &opening {
        publish(context, key, canonical).await;
    }
    Ok(opening)
}

/// Publishes a resolution that changed the canonical thread.
pub(crate) async fn publish(context: &ForgeContext, key: &PullRequestKey, canonical: &Canonical) {
    if !matches!(canonical, Canonical::Kept(_)) {
        context.cache.invalidate_pull_request(key);
        context.events.pull_request(key).await;
        // List rows carry the canonical chat, so a reassignment changes them too.
        context.events.list().await;
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct EnsureRequest {
    pull_request: Value,
    /// Opt-in: without it the companion places a new chat itself and the
    /// result keeps its older `{threadId, created}` shape.
    #[serde(default)]
    workspace: Option<WorkspaceRequest>,
}

/// `companion/pullRequest/chat/ensure`.
///
/// Returns the same thread for every concurrent or later call for one pull
/// request, and the same thread a `reviewChat` scenario target resolves to.
/// It creates no user message and starts no turn. With `workspace`, the
/// result is `{"kind": "ready", threadId, created}` or, while no live chat
/// exists and the client asked, `{"kind": "needsWorkspace", candidates}`.
///
/// # Errors
///
/// Returns invalid params for a malformed key or an unadmitted chosen
/// directory, or a capability/storage error.
pub async fn ensure(context: &ForgeContext, raw: &Value) -> Result<Value, ForgeError> {
    let request: EnsureRequest = params(raw)?;
    let (key, identity) = ForgeContext::pull_request(&request.pull_request)?;
    let placement = Placement::of(request.workspace);
    let agents = context
        .agents
        .clone()
        .ok_or_else(|| ForgeError::CapabilityUnavailable {
            reason: "agents are unavailable on this companion".into(),
        })?;
    let opening = open(context, &key, &identity, &agents, &placement, |creation| {
        let agents = &agents;
        let (key, identity) = (&key, &identity);
        async move {
            let overview = load_overview(context, key, identity).await?;
            create_thread(context, agents, identity, &overview, creation).await
        }
    })
    .await?;
    match opening {
        Opening::Ready(canonical) => Ok(ready_wire(&placement, &canonical)),
        Opening::NeedsWorkspace => {
            let overview = match context.cache.overview(&key) {
                Some(overview) => overview,
                None => load_overview(context, &key, &identity).await?,
            };
            let candidates = chat_workspace::candidates(context, &identity, &overview).await;
            Ok(chat_workspace::needs_workspace_wire(&candidates))
        }
    }
}

/// The ready result: the older shape for a client that did not opt in.
fn ready_wire(placement: &Placement, canonical: &Canonical) -> Value {
    let thread = canonical.thread().as_str();
    if placement.opted_in() {
        json!({"kind": "ready", "threadId": thread, "created": canonical.created()})
    } else {
        json!({"threadId": thread, "created": canonical.created()})
    }
}

async fn reusable_link(
    links: &Links,
    key: &PullRequestKey,
    states: &impl ThreadStates,
) -> Result<Option<AppThreadId>, ForgeError> {
    let links = links.of_pull_request(key)?;
    let preferred = links
        .iter()
        .filter(|link| link.source == LinkSource::Branch)
        .chain(
            links
                .iter()
                .filter(|link| link.source != LinkSource::Branch),
        );
    for link in preferred {
        let Some(thread) = parse_thread_id(&link.thread_id) else {
            continue;
        };
        if states.presence(&thread).await? == ThreadPresence::Live {
            return Ok(Some(thread));
        }
    }
    Ok(None)
}

/// Creates the thread of a new review chat: in the chosen directory, or,
/// for an older client, in the local checkout else the companion home.
///
/// # Errors
///
/// Returns invalid params for an unadmitted chosen directory, or the
/// agents' creation failure.
pub(crate) async fn create_thread(
    context: &ForgeContext,
    agents: &AgentBridge,
    identity: &PullRequestIdentity,
    overview: &OverviewWire,
    creation: Creation<'_>,
) -> Result<AppThreadId, ForgeError> {
    let (cwd, profile) = match creation {
        Creation::Chosen(path) => chat_workspace::chosen(context, identity, overview, path).await?,
        Creation::Companion => companion_workspace(context, overview).await?,
    };
    agents
        .create_thread(cwd, profile)
        .await
        .map_err(|reason| ForgeError::CapabilityUnavailable { reason })
}

async fn companion_workspace(
    context: &ForgeContext,
    overview: &OverviewWire,
) -> Result<(String, &'static str), ForgeError> {
    if let Some(checkout) = &overview.local_checkout {
        return Ok((checkout.workspace.clone(), WORKSPACE_PROFILE));
    }
    let admission =
        context
            .workspaces
            .as_ref()
            .ok_or_else(|| ForgeError::CapabilityUnavailable {
                reason: "workspace admission is unavailable".into(),
            })?;
    Ok((
        admission
            .admit(None)
            .await
            .map_err(ForgeError::InvalidParams)?,
        READ_ONLY,
    ))
}

/// The overview's explicit canonical review thread, distinct from related links.
pub(crate) fn wire(
    context: &ForgeContext,
    key: &PullRequestKey,
) -> Result<Option<LinkedThreadWire>, ForgeError> {
    Ok(context
        .review_chats
        .get(key)?
        .map(|thread| LinkedThreadWire {
            thread_id: thread.as_str().to_owned(),
            source: LinkSource::Manual,
        }))
}

#[cfg(test)]
#[allow(clippy::expect_used)]
mod tests {
    use std::{collections::HashMap, sync::Mutex};

    use forge_protocol::ForgePrRef;

    use super::*;

    /// Thread states the agents report; an unknown thread is missing.
    #[derive(Default)]
    struct States {
        threads: Mutex<HashMap<AppThreadId, Result<ThreadPresence, ()>>>,
    }

    impl States {
        fn set(&self, thread: &AppThreadId, presence: ThreadPresence) {
            self.threads
                .lock()
                .expect("states")
                .insert(thread.clone(), Ok(presence));
        }

        fn unreadable(&self, thread: &AppThreadId) {
            self.threads
                .lock()
                .expect("states")
                .insert(thread.clone(), Err(()));
        }
    }

    impl ThreadStates for States {
        async fn presence(&self, thread: &AppThreadId) -> Result<ThreadPresence, ForgeError> {
            self.threads
                .lock()
                .expect("states")
                .get(thread)
                .copied()
                .unwrap_or(Ok(ThreadPresence::Missing))
                .map_err(|()| ForgeError::CapabilityUnavailable {
                    reason: "unreadable".into(),
                })
        }
    }

    struct Fixture {
        _directory: tempfile::TempDir,
        chats: ReviewChats,
        links: Links,
        key: PullRequestKey,
        identity: PullRequestIdentity,
        states: States,
    }

    impl Fixture {
        fn new() -> Result<Self, ForgeError> {
            let directory = tempfile::tempdir().expect("temporary review chat store");
            let store = Arc::new(IndexStore::open(directory.path().join("state.redb"))?);
            let pr_ref = ForgePrRef {
                host: "github.com".into(),
                repository: "acme/widget".into(),
                number: "42".into(),
            };
            Ok(Self {
                _directory: directory,
                chats: ReviewChats::new(store.clone()),
                links: Links::new(store),
                key: PullRequestKey::issue("github", &pr_ref),
                identity: PullRequestIdentity {
                    plugin_id: "github".into(),
                    pr_ref,
                },
                states: States::default(),
            })
        }

        fn link(&self, thread: &AppThreadId, source: LinkSource) -> Result<(), ForgeError> {
            self.links
                .link(&self.key, "github", "42", thread, source)
                .map(|_| ())
        }

        /// One resolution, as `chat/ensure` and the `reviewChat` target run it;
        /// `created` is the thread a creation would return.
        async fn resolve(&self, created: &AppThreadId) -> Result<Canonical, ForgeError> {
            let lane = self.chats.lane().await;
            resolve(
                &self.chats,
                &lane,
                &self.links,
                &self.key,
                &self.identity,
                &self.states,
                || async {
                    self.states.set(created, ThreadPresence::Live);
                    Ok(created.clone())
                },
            )
            .await
        }

        /// One resolution with a client `placement`; `created` is the thread
        /// a creation would return, and the creation's directory is recorded.
        async fn open(
            &self,
            placement: &Placement,
            created: &AppThreadId,
            chosen: &Mutex<Option<String>>,
        ) -> Result<Opening, ForgeError> {
            let lane = self.chats.lane().await;
            resolve_placed(
                &self.chats,
                &lane,
                &self.links,
                &self.key,
                &self.identity,
                &self.states,
                placement,
                |creation| async move {
                    if let Creation::Chosen(path) = creation {
                        *chosen.lock().expect("chosen") = Some(path.to_owned());
                    }
                    self.states.set(created, ThreadPresence::Live);
                    Ok(created.clone())
                },
            )
            .await
        }

        fn linked(&self) -> Result<Vec<String>, ForgeError> {
            Ok(self
                .links
                .of_pull_request(&self.key)?
                .into_iter()
                .map(|link| link.thread_id)
                .collect())
        }
    }

    #[tokio::test]
    async fn every_entry_point_resolves_the_same_created_canonical_thread() -> Result<(), ForgeError>
    {
        let fixture = Fixture::new()?;
        let first = AppThreadId::from_static("thread-first");
        let second = AppThreadId::from_static("thread-second");

        let opened = fixture.resolve(&first).await?;
        assert_eq!(opened, Canonical::Created(first.clone()));
        assert_eq!(fixture.chats.get(&fixture.key)?, Some(first.clone()));
        assert_eq!(fixture.linked()?, vec![first.as_str().to_owned()]);

        // A later scenario (or chat open) reuses it instead of creating `second`.
        let started = fixture.resolve(&second).await?;
        assert_eq!(started, Canonical::Kept(first.clone()));
        assert!(!started.created());
        assert_eq!(fixture.linked()?, vec![first.as_str().to_owned()]);
        Ok(())
    }

    #[tokio::test]
    async fn an_asking_client_without_a_live_chat_gets_no_thread() -> Result<(), ForgeError> {
        // `chat/ensure` and a scenario start with `workspace: ask` both open
        // the chat this way, so neither silently picks a directory.
        let fixture = Fixture::new()?;
        let archived = AppThreadId::from_static("thread-archived");
        let unused = AppThreadId::from_static("thread-unused");
        fixture.link(&archived, LinkSource::Branch)?;
        fixture.chats.put(&fixture.key, &archived)?;
        fixture.states.set(&archived, ThreadPresence::Archived);
        let chosen = Mutex::new(None);

        assert_eq!(
            fixture.open(&Placement::Ask, &unused, &chosen).await?,
            Opening::NeedsWorkspace
        );
        assert_eq!(fixture.chats.get(&fixture.key)?, Some(archived.clone()));
        assert_eq!(fixture.linked()?, vec![archived.as_str().to_owned()]);
        assert_eq!(*chosen.lock().expect("chosen"), None);
        Ok(())
    }

    #[tokio::test]
    async fn the_chosen_directory_creates_the_canonical_chat_once() -> Result<(), ForgeError> {
        let fixture = Fixture::new()?;
        let created = AppThreadId::from_static("thread-created");
        let unused = AppThreadId::from_static("thread-unused");
        let chosen = Mutex::new(None);

        let opened = fixture
            .open(&Placement::Chosen("/work/widget".into()), &created, &chosen)
            .await?;
        assert_eq!(opened, Opening::Ready(Canonical::Created(created.clone())));
        assert_eq!(
            chosen.lock().expect("chosen").as_deref(),
            Some("/work/widget")
        );
        assert_eq!(fixture.chats.get(&fixture.key)?, Some(created.clone()));

        // Once it exists, opening never asks again and ignores another choice.
        *chosen.lock().expect("chosen") = None;
        for placement in [Placement::Ask, Placement::Chosen("/work/other".into())] {
            assert_eq!(
                fixture.open(&placement, &unused, &chosen).await?,
                Opening::Ready(Canonical::Kept(created.clone()))
            );
        }
        assert_eq!(*chosen.lock().expect("chosen"), None);
        Ok(())
    }

    #[tokio::test]
    async fn an_asking_client_reuses_a_live_link_without_asking() -> Result<(), ForgeError> {
        let fixture = Fixture::new()?;
        let branch = AppThreadId::from_static("thread-branch");
        let unused = AppThreadId::from_static("thread-unused");
        fixture.link(&branch, LinkSource::Branch)?;
        fixture.states.set(&branch, ThreadPresence::Live);

        assert_eq!(
            fixture
                .open(&Placement::Ask, &unused, &Mutex::new(None))
                .await?,
            Opening::Ready(Canonical::Reassigned(branch.clone()))
        );
        assert_eq!(fixture.chats.get(&fixture.key)?, Some(branch));
        Ok(())
    }

    #[tokio::test]
    async fn an_archived_canonical_thread_is_replaced_by_a_live_link_branch_first()
    -> Result<(), ForgeError> {
        let fixture = Fixture::new()?;
        let archived = AppThreadId::from_static("thread-archived");
        let manual = AppThreadId::from_static("thread-manual");
        let branch = AppThreadId::from_static("thread-branch");
        let unused = AppThreadId::from_static("thread-unused");
        fixture.link(&archived, LinkSource::Manual)?;
        fixture.link(&manual, LinkSource::Manual)?;
        fixture.link(&branch, LinkSource::Branch)?;
        fixture.chats.put(&fixture.key, &archived)?;
        fixture.states.set(&archived, ThreadPresence::Archived);
        fixture.states.set(&manual, ThreadPresence::Live);
        fixture.states.set(&branch, ThreadPresence::Live);

        let resolved = fixture.resolve(&unused).await?;
        assert_eq!(resolved, Canonical::Reassigned(branch.clone()));
        assert_eq!(fixture.chats.get(&fixture.key)?, Some(branch.clone()));
        assert_eq!(fixture.resolve(&unused).await?, Canonical::Kept(branch));
        assert!(!fixture.linked()?.contains(&unused.as_str().to_owned()));
        Ok(())
    }

    #[tokio::test]
    async fn archived_and_missing_links_are_never_reused_and_a_new_thread_becomes_canonical()
    -> Result<(), ForgeError> {
        let fixture = Fixture::new()?;
        let archived_canonical = AppThreadId::from_static("thread-archived-canonical");
        let archived_branch = AppThreadId::from_static("thread-archived-branch");
        let missing = AppThreadId::from_static("thread-missing");
        let created = AppThreadId::from_static("thread-created");
        fixture.link(&archived_canonical, LinkSource::Manual)?;
        fixture.link(&archived_branch, LinkSource::Branch)?;
        fixture.link(&missing, LinkSource::Agent)?;
        fixture.chats.put(&fixture.key, &archived_canonical)?;
        fixture
            .states
            .set(&archived_canonical, ThreadPresence::Archived);
        fixture
            .states
            .set(&archived_branch, ThreadPresence::Archived);

        let resolved = fixture.resolve(&created).await?;
        assert_eq!(resolved, Canonical::Created(created.clone()));
        assert_eq!(fixture.chats.get(&fixture.key)?, Some(created.clone()));
        assert!(fixture.linked()?.contains(&created.as_str().to_owned()));
        Ok(())
    }

    #[tokio::test]
    async fn a_gone_canonical_thread_is_replaced_by_a_new_canonical_thread()
    -> Result<(), ForgeError> {
        // A chat opened but never written to has no stored history; once its
        // runtime no longer holds it, the agents report it missing.
        let fixture = Fixture::new()?;
        let gone = AppThreadId::from_static("thread-gone");
        let created = AppThreadId::from_static("thread-created");
        let unused = AppThreadId::from_static("thread-unused");
        fixture.link(&gone, LinkSource::Manual)?;
        fixture.chats.put(&fixture.key, &gone)?;
        fixture.states.set(&gone, ThreadPresence::Missing);

        assert_eq!(
            fixture.resolve(&created).await?,
            Canonical::Created(created.clone())
        );
        assert_eq!(fixture.chats.get(&fixture.key)?, Some(created.clone()));
        assert_eq!(fixture.resolve(&unused).await?, Canonical::Kept(created));
        Ok(())
    }

    #[tokio::test]
    async fn an_unreadable_canonical_state_fails_without_replacing_it() -> Result<(), ForgeError> {
        let fixture = Fixture::new()?;
        let canonical = AppThreadId::from_static("thread-canonical");
        let created = AppThreadId::from_static("thread-created");
        fixture.link(&canonical, LinkSource::Manual)?;
        fixture.chats.put(&fixture.key, &canonical)?;
        fixture.states.unreadable(&canonical);

        assert!(fixture.resolve(&created).await.is_err());
        assert_eq!(fixture.chats.get(&fixture.key)?, Some(canonical));
        assert!(!fixture.linked()?.contains(&created.as_str().to_owned()));
        Ok(())
    }

    #[test]
    fn canonical_thread_survives_new_owner_and_only_exact_unlink_clears_it()
    -> Result<(), ForgeError> {
        let directory = tempfile::tempdir().expect("temporary review chat store");
        let store = Arc::new(IndexStore::open(directory.path().join("state.redb"))?);
        let pull_request = PullRequestKey::issue(
            "github",
            &ForgePrRef {
                host: "github.com".into(),
                repository: "acme/widget".into(),
                number: "42".into(),
            },
        );
        let canonical = AppThreadId::from_static("thread-canonical");
        let another = AppThreadId::from_static("thread-another");

        ReviewChats::new(store.clone()).put(&pull_request, &canonical)?;
        let restarted = ReviewChats::new(store);
        assert_eq!(restarted.get(&pull_request)?, Some(canonical.clone()));

        restarted.clear_if(&pull_request, &another)?;
        assert_eq!(restarted.get(&pull_request)?, Some(canonical.clone()));

        restarted.clear_if(&pull_request, &canonical)?;
        assert_eq!(restarted.get(&pull_request)?, None);
        Ok(())
    }
}
