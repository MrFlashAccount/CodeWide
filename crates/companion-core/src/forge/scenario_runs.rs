//! Per-intent idempotency and live state of agent scenarios on a pull
//! request.
//!
//! A slot is one intent: (pull request, scenario kind, scenario-specific
//! target). `fixCi` targets its `checkId`, a focused `addressComments` its
//! `reviewThreadId`; `message` has no slot and is never deduplicated. One
//! durable record per slot keeps the latest run: the review chat thread, the
//! outbox command carrying its turn, the head revision it started at and,
//! once known, its settlement. Records are prompt-free: no instruction,
//! context or answer text, only ids, times and a failure reason.
//!
//! Admission runs inside the review chat lane: a start whose slot already
//! has a queued or running run at the same head joins that run instead of
//! enqueuing another. Another head, or a run that finished, failed or is
//! unknown, admits a new run that replaces the record. Client idempotency
//! keys still guard transport retries in front of this, in the action
//! journal.
//!
//! State is derived on read: the recorded settlement, otherwise the
//! command's outbox state and then its turn. A turn start or end on a run's
//! thread publishes a `scenarios` invalidation of its pull request; a turn
//! end also records the settlement.

use std::{collections::BTreeMap, sync::Arc, time::Duration};

use forge_protocol::ScenarioKind;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tracing::warn;

use super::{
    ForgeContext,
    errors::ForgeError,
    ids::{HeadRevision, PullRequestKey, ReviewThreadId, parse_thread_id, valid_forge_id},
    params,
    review_chat::{Canonical, ReviewLane},
    wire::rfc3339,
};
use crate::{
    agent::model::AppThreadId,
    agent_bridge::{AgentBridge, CommandPhase},
    store::{IndexStore, forge_tables::FORGE_SCENARIO_RUNS, kv::KvOp},
};

const RECORD_VERSION: u32 = 1;
/// How long a turn end waits for the provider's turn read to agree.
const SETTLE_RETRIES: [Duration; 3] = [
    Duration::ZERO,
    Duration::from_secs(1),
    Duration::from_secs(3),
];

/// One deduplicated scenario intent of a pull request.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(
    tag = "scenario",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum ScenarioSlot {
    ReviewPr,
    Rebase,
    FixCi { check_id: Option<String> },
    AddressComments { review_thread_id: Option<String> },
}

impl ScenarioSlot {
    /// The slot of a scenario start; `None` for `message`, which is never
    /// deduplicated.
    ///
    /// # Errors
    ///
    /// Returns invalid params for a malformed `checkId`.
    pub fn of(
        scenario: ScenarioKind,
        check_id: Option<&str>,
        review_thread: Option<&ReviewThreadId>,
    ) -> Result<Option<Self>, ForgeError> {
        if let Some(check) = check_id
            && !valid_forge_id(check)
        {
            return Err(ForgeError::invalid("invalid checkId"));
        }
        Ok(match scenario {
            ScenarioKind::ReviewPr => Some(Self::ReviewPr),
            ScenarioKind::Rebase => Some(Self::Rebase),
            ScenarioKind::FixCi => Some(Self::FixCi {
                check_id: check_id.map(str::to_owned),
            }),
            ScenarioKind::AddressComments => Some(Self::AddressComments {
                review_thread_id: review_thread.map(|thread| thread.as_str().to_owned()),
            }),
            ScenarioKind::Message => None,
        })
    }

    /// The slot's part of its durable key. Ids carry no control
    /// characters, so `\u{1f}` cannot appear inside one.
    fn key_part(&self) -> String {
        match self {
            Self::ReviewPr => "reviewPr".into(),
            Self::Rebase => "rebase".into(),
            Self::FixCi { check_id: None } => "fixCi".into(),
            Self::FixCi {
                check_id: Some(check),
            } => format!("fixCi\u{1f}{check}"),
            Self::AddressComments {
                review_thread_id: None,
            } => "addressComments".into(),
            Self::AddressComments {
                review_thread_id: Some(thread),
            } => format!("addressComments\u{1f}{thread}"),
        }
    }
}

/// How a run ended, once known. Times are Unix seconds.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(
    tag = "outcome",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum Settlement {
    Done {
        finished_at: i64,
    },
    Failed {
        finished_at: Option<i64>,
        reason: String,
    },
}

/// The latest run of one slot.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScenarioRun {
    pub version: u32,
    pub pull_request: PullRequestKey,
    pub slot: ScenarioSlot,
    pub head_revision: HeadRevision,
    pub thread_id: String,
    /// The outbox command (and client user message id) of its turn.
    pub command_id: String,
    /// Unix seconds.
    pub queued_at: i64,
    pub settlement: Option<Settlement>,
}

/// The client view of one slot. Times are RFC 3339.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(
    tag = "status",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum ScenarioState {
    /// No run, or nothing provable about the last one.
    Idle,
    Queued {
        thread_id: String,
        head_revision: HeadRevision,
        queued_at: String,
    },
    Running {
        thread_id: String,
        head_revision: HeadRevision,
        started_at: String,
    },
    Done {
        thread_id: String,
        head_revision: HeadRevision,
        finished_at: String,
    },
    Failed {
        thread_id: String,
        head_revision: HeadRevision,
        finished_at: Option<String>,
        reason: String,
    },
}

impl ScenarioState {
    fn active(&self) -> bool {
        matches!(self, Self::Queued { .. } | Self::Running { .. })
    }
}

/// What scenario admission needs from the agents.
pub(crate) trait ScenarioAgents {
    fn phase(
        &self,
        thread: &str,
        command_id: &str,
    ) -> impl Future<Output = Result<CommandPhase, ForgeError>> + Send;

    fn enqueue(
        &self,
        thread: &str,
        command_id: &str,
        inputs: Vec<String>,
    ) -> impl Future<Output = Result<(), ForgeError>> + Send;
}

impl ScenarioAgents for AgentBridge {
    async fn phase(&self, thread: &str, command_id: &str) -> Result<CommandPhase, ForgeError> {
        self.command_phase(thread, command_id)
            .await
            .map_err(|reason| ForgeError::CapabilityUnavailable { reason })
    }

    async fn enqueue(
        &self,
        thread: &str,
        command_id: &str,
        inputs: Vec<String>,
    ) -> Result<(), ForgeError> {
        AgentBridge::enqueue(self, thread, command_id, inputs)
            .await
            .map_err(|reason| ForgeError::CapabilityUnavailable { reason })
    }
}

/// The durable slot records.
#[derive(Clone)]
pub struct ScenarioRuns {
    store: Arc<IndexStore>,
}

impl ScenarioRuns {
    #[must_use]
    pub fn new(store: Arc<IndexStore>) -> Self {
        Self { store }
    }

    fn key(pull_request: &PullRequestKey, slot: &ScenarioSlot) -> String {
        format!("{}\0{}", pull_request.as_str(), slot.key_part())
    }

    /// The latest run of one slot.
    ///
    /// # Errors
    ///
    /// Returns a storage failure.
    pub fn get(
        &self,
        pull_request: &PullRequestKey,
        slot: &ScenarioSlot,
    ) -> Result<Option<ScenarioRun>, ForgeError> {
        Ok(self
            .store
            .kv_get(FORGE_SCENARIO_RUNS, &Self::key(pull_request, slot))?
            .and_then(|value| serde_json::from_slice(&value).ok()))
    }

    fn put(&self, run: &ScenarioRun) -> Result<(), ForgeError> {
        let value =
            serde_json::to_vec(run).map_err(|error| ForgeError::internal(error.to_string()))?;
        self.store.kv_apply(vec![KvOp::Put {
            table: FORGE_SCENARIO_RUNS,
            key: Self::key(&run.pull_request, &run.slot),
            value,
        }])?;
        Ok(())
    }

    /// The latest run of every slot of a pull request.
    ///
    /// # Errors
    ///
    /// Returns a storage failure.
    pub fn of_pull_request(
        &self,
        pull_request: &PullRequestKey,
    ) -> Result<Vec<ScenarioRun>, ForgeError> {
        Ok(self
            .store
            .kv_scan(FORGE_SCENARIO_RUNS, &format!("{}\0", pull_request.as_str()))?
            .into_iter()
            .filter_map(|(_, value)| serde_json::from_slice(&value).ok())
            .collect())
    }

    /// Unsettled runs whose turn goes to `thread`.
    fn unsettled_on(&self, thread: &str) -> Result<Vec<ScenarioRun>, ForgeError> {
        Ok(self
            .store
            .kv_scan(FORGE_SCENARIO_RUNS, "")?
            .into_iter()
            .filter_map(|(_, value)| serde_json::from_slice::<ScenarioRun>(&value).ok())
            .filter(|run| run.settlement.is_none() && run.thread_id == thread)
            .collect())
    }

    /// Records a settlement for exactly `run`, unless the slot has moved on
    /// to another run or is settled already.
    fn settle(
        &self,
        _lane: &ReviewLane<'_>,
        run: &ScenarioRun,
        settlement: Settlement,
    ) -> Result<(), ForgeError> {
        let Some(stored) = self.get(&run.pull_request, &run.slot)? else {
            return Ok(());
        };
        if stored.command_id != run.command_id || stored.settlement.is_some() {
            return Ok(());
        }
        self.put(&ScenarioRun {
            settlement: Some(settlement),
            ..stored
        })
    }
}

/// The state of one run, and the settlement to record when the agents
/// report a terminal turn for a run not settled yet.
async fn observe_run(
    run: &ScenarioRun,
    agents: Option<&impl ScenarioAgents>,
) -> Result<(ScenarioState, Option<Settlement>), ForgeError> {
    let thread_id = run.thread_id.clone();
    let head_revision = run.head_revision.clone();
    if let Some(settlement) = &run.settlement {
        return Ok((settled_state(thread_id, head_revision, settlement), None));
    }
    let Some(agents) = agents else {
        return Ok((ScenarioState::Idle, None));
    };
    let settlement = match agents.phase(&run.thread_id, &run.command_id).await? {
        CommandPhase::Queued => {
            return Ok((
                ScenarioState::Queued {
                    thread_id,
                    head_revision,
                    queued_at: seconds(run.queued_at),
                },
                None,
            ));
        }
        CommandPhase::Running { started_at } => {
            return Ok((
                ScenarioState::Running {
                    thread_id,
                    head_revision,
                    started_at: seconds(started_at),
                },
                None,
            ));
        }
        CommandPhase::Unknown => return Ok((ScenarioState::Idle, None)),
        CommandPhase::Completed { finished_at } => Settlement::Done { finished_at },
        CommandPhase::Failed {
            finished_at,
            reason,
        } => Settlement::Failed {
            finished_at,
            reason,
        },
    };
    Ok((
        settled_state(thread_id, head_revision, &settlement),
        Some(settlement),
    ))
}

fn settled_state(
    thread_id: String,
    head_revision: HeadRevision,
    settlement: &Settlement,
) -> ScenarioState {
    match settlement {
        Settlement::Done { finished_at } => ScenarioState::Done {
            thread_id,
            head_revision,
            finished_at: seconds(*finished_at),
        },
        Settlement::Failed {
            finished_at,
            reason,
        } => ScenarioState::Failed {
            thread_id,
            head_revision,
            finished_at: finished_at.map(seconds),
            reason: reason.clone(),
        },
    }
}

fn seconds(unix: i64) -> String {
    time::OffsetDateTime::from_unix_timestamp(unix).map_or_else(|_| String::new(), rfc3339)
}

fn now_seconds() -> i64 {
    time::OffsetDateTime::now_utc().unix_timestamp()
}

/// The thread of a queued or running run of `slot` at `head`, which a new
/// start joins.
///
/// # Errors
///
/// Returns a storage failure or an unreadable agent queue.
pub(crate) async fn joinable(
    runs: &ScenarioRuns,
    pull_request: &PullRequestKey,
    slot: &ScenarioSlot,
    head: &HeadRevision,
    agents: &impl ScenarioAgents,
) -> Result<Option<AppThreadId>, ForgeError> {
    let Some(run) = runs.get(pull_request, slot)? else {
        return Ok(None);
    };
    if run.head_revision != *head || run.settlement.is_some() {
        return Ok(None);
    }
    let (state, _) = observe_run(&run, Some(agents)).await?;
    Ok(state
        .active()
        .then(|| parse_thread_id(&run.thread_id))
        .flatten())
}

/// One scenario start's request to the lane.
pub(crate) struct Admission<'a> {
    pub pull_request: &'a PullRequestKey,
    pub slot: Option<ScenarioSlot>,
    pub head: &'a HeadRevision,
    pub command_id: String,
    pub inputs: Vec<String>,
}

/// What admission decided.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum Admitted {
    /// A queued or running run of the same slot and head; nothing was sent.
    Joined(AppThreadId),
    /// A new run was queued on the review chat it resolved.
    Queued(Canonical),
}

/// Joins the slot's active run at the same head, or resolves the review
/// chat, enqueues the run's turn and records it. Runs inside the held lane,
/// so two concurrent starts of one slot queue one turn.
///
/// # Errors
///
/// Returns a storage failure, the resolution failure or the queue's
/// refusal; no record is written then.
pub(crate) async fn admit<Resolve, Resolved>(
    runs: &ScenarioRuns,
    _lane: &ReviewLane<'_>,
    agents: &impl ScenarioAgents,
    admission: Admission<'_>,
    resolve: Resolve,
) -> Result<Admitted, ForgeError>
where
    Resolve: FnOnce() -> Resolved,
    Resolved: Future<Output = Result<Canonical, ForgeError>>,
{
    if let Some(slot) = &admission.slot
        && let Some(thread) =
            joinable(runs, admission.pull_request, slot, admission.head, agents).await?
    {
        return Ok(Admitted::Joined(thread));
    }
    let canonical = resolve().await?;
    let thread = canonical.thread();
    agents
        .enqueue(thread.as_str(), &admission.command_id, admission.inputs)
        .await?;
    if let Some(slot) = admission.slot {
        runs.put(&ScenarioRun {
            version: RECORD_VERSION,
            pull_request: admission.pull_request.clone(),
            slot,
            head_revision: admission.head.clone(),
            thread_id: thread.as_str().to_owned(),
            command_id: admission.command_id,
            queued_at: now_seconds(),
            settlement: None,
        })?;
    }
    Ok(Admitted::Queued(canonical))
}

/// The state of every slot of a pull request that has a run; a slot
/// without a record is `idle`. Records any settlement observed.
///
/// # Errors
///
/// Returns a storage failure or an unreadable agent queue.
pub(crate) async fn states(
    runs: &ScenarioRuns,
    chats: &super::review_chat::ReviewChats,
    pull_request: &PullRequestKey,
    agents: Option<&impl ScenarioAgents>,
) -> Result<Vec<(ScenarioSlot, ScenarioState)>, ForgeError> {
    let mut states = Vec::new();
    let mut settled = Vec::new();
    for run in runs.of_pull_request(pull_request)? {
        let (state, settlement) = observe_run(&run, agents).await?;
        if let Some(settlement) = settlement {
            settled.push((run.clone(), settlement));
        }
        states.push((run.slot, state));
    }
    if !settled.is_empty() {
        let lane = chats.lane().await;
        for (run, settlement) in settled {
            runs.settle(&lane, &run, settlement)?;
        }
    }
    Ok(states)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ReadRequest {
    pull_request: Value,
}

/// One slot on the wire: every field is always present.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SlotStateWire {
    scenario: ScenarioKind,
    check_id: Option<String>,
    review_thread_id: Option<String>,
    state: ScenarioState,
}

impl SlotStateWire {
    fn new(slot: ScenarioSlot, state: ScenarioState) -> Self {
        let (scenario, check_id, review_thread_id) = match slot {
            ScenarioSlot::ReviewPr => (ScenarioKind::ReviewPr, None, None),
            ScenarioSlot::Rebase => (ScenarioKind::Rebase, None, None),
            ScenarioSlot::FixCi { check_id } => (ScenarioKind::FixCi, check_id, None),
            ScenarioSlot::AddressComments { review_thread_id } => {
                (ScenarioKind::AddressComments, None, review_thread_id)
            }
        };
        Self {
            scenario,
            check_id,
            review_thread_id,
            state,
        }
    }
}

/// `companion/pullRequest/scenarios/read`: the live state of the pull
/// request's scenario slots, from companion state and the agents only (no
/// plugin call). Invalidated by `pullRequest` and `scenarios` events.
///
/// # Errors
///
/// Returns invalid params for a malformed key, a storage failure or an
/// unreadable agent queue.
pub async fn read(context: &ForgeContext, raw: &Value) -> Result<Value, ForgeError> {
    let request: ReadRequest = params(raw)?;
    let (key, _) = ForgeContext::pull_request(&request.pull_request)?;
    let states = states(
        &context.scenario_runs,
        &context.review_chats,
        &key,
        context.agents.as_ref(),
    )
    .await?;
    let scenarios: Vec<SlotStateWire> = states
        .into_iter()
        .map(|(slot, state)| SlotStateWire::new(slot, state))
        .collect();
    Ok(json!({ "scenarios": scenarios }))
}

/// Publishes a `scenarios` invalidation for every pull request with an
/// unsettled run on the thread of a `turn/started` or `turn/completed`
/// event; a turn end first records the settlement.
pub fn observe(context: &Arc<ForgeContext>, payload: &Value) {
    let ended = match payload.get("method").and_then(Value::as_str) {
        Some("turn/started") => false,
        Some("turn/completed") => true,
        _ => return,
    };
    let Some(thread) = payload
        .pointer("/params/threadId")
        .and_then(Value::as_str)
        .map(str::to_owned)
    else {
        return;
    };
    let context = context.clone();
    tokio::spawn(async move {
        observe_turn(&context, &thread, ended).await;
    });
}

async fn observe_turn(context: &ForgeContext, thread: &str, ended: bool) {
    let runs = match context.scenario_runs.unsettled_on(thread) {
        Ok(runs) if !runs.is_empty() => runs,
        Ok(_) => return,
        Err(error) => {
            warn!(kind = error.log_kind(), "scenario runs were not readable");
            return;
        }
    };
    if ended && let Some(agents) = &context.agents {
        for run in &runs {
            settle_after_turn(context, agents, run).await;
        }
    }
    let pull_requests: BTreeMap<&str, &PullRequestKey> = runs
        .iter()
        .map(|run| (run.pull_request.as_str(), &run.pull_request))
        .collect();
    for pull_request in pull_requests.into_values() {
        context.events.scenarios(pull_request).await;
    }
}

/// Waits briefly for the turn read to report the end, then records it.
async fn settle_after_turn(context: &ForgeContext, agents: &AgentBridge, run: &ScenarioRun) {
    for delay in SETTLE_RETRIES {
        tokio::time::sleep(delay).await;
        match observe_run(run, Some(agents)).await {
            Ok((_, Some(settlement))) => {
                let lane = context.review_chats.lane().await;
                if let Err(error) = context.scenario_runs.settle(&lane, run, settlement) {
                    warn!(
                        kind = error.log_kind(),
                        "scenario settlement was not recorded"
                    );
                }
                return;
            }
            Ok((state, None)) if !state.active() => return,
            Ok(_) => {}
            Err(error) => {
                warn!(kind = error.log_kind(), "scenario state was not readable");
                return;
            }
        }
    }
}

#[cfg(test)]
#[allow(clippy::expect_used)]
mod tests {
    use std::{collections::HashMap, sync::Mutex};

    use forge_protocol::ForgePrRef;

    use super::*;
    use crate::forge::review_chat::ReviewChats;

    /// Agents whose commands move through phases the test sets.
    #[derive(Default)]
    struct Agents {
        phases: Mutex<HashMap<String, CommandPhase>>,
        enqueued: Mutex<Vec<(String, String)>>,
    }

    impl Agents {
        fn set(&self, command: &str, phase: CommandPhase) {
            self.phases
                .lock()
                .expect("phases")
                .insert(command.to_owned(), phase);
        }

        fn enqueued(&self) -> Vec<(String, String)> {
            self.enqueued.lock().expect("enqueued").clone()
        }
    }

    impl ScenarioAgents for Agents {
        async fn phase(&self, _thread: &str, command_id: &str) -> Result<CommandPhase, ForgeError> {
            Ok(self
                .phases
                .lock()
                .expect("phases")
                .get(command_id)
                .cloned()
                .unwrap_or(CommandPhase::Unknown))
        }

        async fn enqueue(
            &self,
            thread: &str,
            command_id: &str,
            _inputs: Vec<String>,
        ) -> Result<(), ForgeError> {
            self.enqueued
                .lock()
                .expect("enqueued")
                .push((thread.to_owned(), command_id.to_owned()));
            self.set(command_id, CommandPhase::Queued);
            Ok(())
        }
    }

    struct Fixture {
        _directory: tempfile::TempDir,
        runs: ScenarioRuns,
        chats: ReviewChats,
        key: PullRequestKey,
        agents: Agents,
        thread: AppThreadId,
    }

    impl Fixture {
        fn new() -> Result<Self, ForgeError> {
            let directory = tempfile::tempdir().expect("temporary scenario store");
            let store = Arc::new(IndexStore::open(directory.path().join("state.redb"))?);
            let key = PullRequestKey::issue(
                "github",
                &ForgePrRef {
                    host: "github.com".into(),
                    repository: "acme/widget".into(),
                    number: "42".into(),
                },
            );
            Ok(Self {
                _directory: directory,
                runs: ScenarioRuns::new(store.clone()),
                chats: ReviewChats::new(store),
                key,
                agents: Agents::default(),
                thread: AppThreadId::from_static("thread-review"),
            })
        }

        async fn start(
            &self,
            slot: Option<ScenarioSlot>,
            head: &str,
            command: &str,
        ) -> Result<Admitted, ForgeError> {
            let lane = self.chats.lane().await;
            let head = HeadRevision::parse(head).expect("head");
            admit(
                &self.runs,
                &lane,
                &self.agents,
                Admission {
                    pull_request: &self.key,
                    slot,
                    head: &head,
                    command_id: command.to_owned(),
                    inputs: vec!["instruction".into()],
                },
                || async { Ok(Canonical::Kept(self.thread.clone())) },
            )
            .await
        }

        async fn state(&self, slot: &ScenarioSlot) -> Result<ScenarioState, ForgeError> {
            Ok(
                states(&self.runs, &self.chats, &self.key, Some(&self.agents))
                    .await?
                    .into_iter()
                    .find(|(candidate, _)| candidate == slot)
                    .map_or(ScenarioState::Idle, |(_, state)| state),
            )
        }
    }

    fn queued(thread: &AppThreadId) -> Admitted {
        Admitted::Queued(Canonical::Kept(thread.clone()))
    }

    #[tokio::test]
    async fn two_starts_of_one_slot_and_head_queue_one_run() -> Result<(), ForgeError> {
        let fixture = Fixture::new()?;
        let first = fixture
            .start(Some(ScenarioSlot::ReviewPr), "head-1", "scenario-a")
            .await?;
        assert_eq!(first, queued(&fixture.thread));
        let second = fixture
            .start(Some(ScenarioSlot::ReviewPr), "head-1", "scenario-b")
            .await?;
        assert_eq!(second, Admitted::Joined(fixture.thread.clone()));
        fixture.agents.set(
            "scenario-a",
            CommandPhase::Running {
                started_at: 1_760_000_000,
            },
        );
        let third = fixture
            .start(Some(ScenarioSlot::ReviewPr), "head-1", "scenario-c")
            .await?;
        assert_eq!(third, Admitted::Joined(fixture.thread.clone()));
        assert_eq!(
            fixture.agents.enqueued(),
            vec![(fixture.thread.as_str().to_owned(), "scenario-a".to_owned())]
        );
        Ok(())
    }

    #[tokio::test]
    async fn concurrent_starts_of_one_slot_queue_one_run() -> Result<(), ForgeError> {
        let fixture = Fixture::new()?;
        let (first, second) = tokio::join!(
            fixture.start(Some(ScenarioSlot::ReviewPr), "head-1", "scenario-a"),
            fixture.start(Some(ScenarioSlot::ReviewPr), "head-1", "scenario-b"),
        );
        let mut outcomes = [first?, second?];
        outcomes.sort_by_key(|outcome| matches!(outcome, Admitted::Joined(_)));
        assert_eq!(
            outcomes,
            [
                queued(&fixture.thread),
                Admitted::Joined(fixture.thread.clone())
            ]
        );
        assert_eq!(fixture.agents.enqueued().len(), 1);
        Ok(())
    }

    #[tokio::test]
    async fn another_head_target_or_finished_run_starts_a_new_run() -> Result<(), ForgeError> {
        let fixture = Fixture::new()?;
        fixture
            .start(Some(ScenarioSlot::ReviewPr), "head-1", "scenario-a")
            .await?;
        let moved = fixture
            .start(Some(ScenarioSlot::ReviewPr), "head-2", "scenario-b")
            .await?;
        assert_eq!(moved, queued(&fixture.thread));
        let other_check = |check: &str| ScenarioSlot::FixCi {
            check_id: Some(check.into()),
        };
        fixture
            .start(Some(other_check("ci-1")), "head-2", "scenario-c")
            .await?;
        let second_check = fixture
            .start(Some(other_check("ci-2")), "head-2", "scenario-d")
            .await?;
        assert_eq!(second_check, queued(&fixture.thread));
        // A message is never deduplicated.
        fixture.start(None, "head-2", "scenario-e").await?;
        let again = fixture.start(None, "head-2", "scenario-f").await?;
        assert_eq!(again, queued(&fixture.thread));
        // Re-running after the review finished is allowed at the same head.
        fixture.agents.set(
            "scenario-b",
            CommandPhase::Completed {
                finished_at: 1_760_000_100,
            },
        );
        let rerun = fixture
            .start(Some(ScenarioSlot::ReviewPr), "head-2", "scenario-g")
            .await?;
        assert_eq!(rerun, queued(&fixture.thread));
        assert_eq!(fixture.agents.enqueued().len(), 7);
        Ok(())
    }

    #[tokio::test]
    async fn the_state_moves_from_queued_to_running_to_done_and_stays_settled()
    -> Result<(), ForgeError> {
        let fixture = Fixture::new()?;
        let slot = ScenarioSlot::ReviewPr;
        assert_eq!(fixture.state(&slot).await?, ScenarioState::Idle);
        fixture
            .start(Some(slot.clone()), "head-1", "scenario-a")
            .await?;
        assert!(matches!(
            fixture.state(&slot).await?,
            ScenarioState::Queued { .. }
        ));
        fixture.agents.set(
            "scenario-a",
            CommandPhase::Running {
                started_at: 1_760_000_000,
            },
        );
        assert_eq!(
            fixture.state(&slot).await?,
            ScenarioState::Running {
                thread_id: fixture.thread.as_str().to_owned(),
                head_revision: HeadRevision::parse("head-1").expect("head"),
                started_at: "2025-10-09T08:53:20Z".into(),
            }
        );
        fixture.agents.set(
            "scenario-a",
            CommandPhase::Completed {
                finished_at: 1_760_000_100,
            },
        );
        let done = ScenarioState::Done {
            thread_id: fixture.thread.as_str().to_owned(),
            head_revision: HeadRevision::parse("head-1").expect("head"),
            finished_at: "2025-10-09T08:55:00Z".into(),
        };
        assert_eq!(fixture.state(&slot).await?, done);
        // The settlement is recorded: the turn leaving the recent window
        // does not erase it.
        fixture.agents.set("scenario-a", CommandPhase::Unknown);
        assert_eq!(fixture.state(&slot).await?, done);
        Ok(())
    }

    #[tokio::test]
    async fn a_failed_turn_reports_its_reason_and_admits_a_retry() -> Result<(), ForgeError> {
        let fixture = Fixture::new()?;
        let slot = ScenarioSlot::Rebase;
        fixture
            .start(Some(slot.clone()), "head-1", "scenario-a")
            .await?;
        fixture.agents.set(
            "scenario-a",
            CommandPhase::Failed {
                finished_at: Some(1_760_000_100),
                reason: "usage limit reached".into(),
            },
        );
        assert!(matches!(
            fixture.state(&slot).await?,
            ScenarioState::Failed { reason, .. } if reason == "usage limit reached"
        ));
        assert_eq!(
            fixture.start(Some(slot), "head-1", "scenario-b").await?,
            queued(&fixture.thread)
        );
        Ok(())
    }

    #[tokio::test]
    async fn a_late_settlement_never_overwrites_a_newer_run() -> Result<(), ForgeError> {
        let fixture = Fixture::new()?;
        let slot = ScenarioSlot::ReviewPr;
        fixture
            .start(Some(slot.clone()), "head-1", "scenario-a")
            .await?;
        let old = fixture.runs.get(&fixture.key, &slot)?.expect("run");
        fixture
            .start(Some(slot.clone()), "head-2", "scenario-b")
            .await?;
        let lane = fixture.chats.lane().await;
        fixture.runs.settle(
            &lane,
            &old,
            Settlement::Done {
                finished_at: 1_760_000_100,
            },
        )?;
        drop(lane);
        let stored = fixture.runs.get(&fixture.key, &slot)?.expect("run");
        assert_eq!(stored.command_id, "scenario-b");
        assert_eq!(stored.settlement, None);
        Ok(())
    }

    #[tokio::test]
    async fn a_turn_on_a_run_thread_publishes_its_scenario_invalidation() -> Result<(), ForgeError>
    {
        use crate::{
            forge::{ForgeConfig, ForgeDeps, ForgeEvents, ForgeService},
            review::{ReviewEvents, ReviewService},
        };
        let directory = tempfile::tempdir().expect("temporary forge state");
        let store = Arc::new(IndexStore::open(directory.path().join("state.redb"))?);
        let (sender, mut receiver) = tokio::sync::mpsc::channel(16);
        let review =
            ReviewService::new(store.clone(), ReviewEvents::new(sender.clone()), None, None);
        let forge = ForgeService::new(
            ForgeConfig::under(directory.path(), None),
            ForgeDeps {
                store,
                events: ForgeEvents::new(sender),
                review,
                agents: None,
                workspaces: None,
                vcs: None,
            },
        );
        let context = forge.context();
        let key = PullRequestKey::issue(
            "github",
            &ForgePrRef {
                host: "github.com".into(),
                repository: "acme/widget".into(),
                number: "42".into(),
            },
        );
        context.scenario_runs.put(&ScenarioRun {
            version: RECORD_VERSION,
            pull_request: key.clone(),
            slot: ScenarioSlot::ReviewPr,
            head_revision: HeadRevision::parse("head-1").expect("head"),
            thread_id: "thread-review".into(),
            command_id: "scenario-a".into(),
            queued_at: 1_760_000_000,
            settlement: None,
        })?;

        observe_turn(context, "thread-other", false).await;
        assert!(
            receiver.try_recv().is_err(),
            "another thread publishes nothing"
        );
        observe_turn(context, "thread-review", false).await;
        assert_eq!(
            receiver.try_recv().expect("published"),
            json!({"method": "companion/forge/invalidated",
                   "params": {"scope": "scenarios", "pullRequest": key}})
        );
        assert!(
            receiver.try_recv().is_err(),
            "one invalidation per pull request"
        );
        Ok(())
    }

    #[test]
    fn slots_serialize_without_prompt_text_and_reject_bad_check_ids() {
        let slot = ScenarioSlot::of(ScenarioKind::FixCi, Some("ci-1"), None)
            .expect("slot")
            .expect("deduplicated");
        let wire =
            serde_json::to_value(SlotStateWire::new(slot, ScenarioState::Idle)).expect("wire");
        assert_eq!(
            wire,
            json!({"scenario": "fixCi", "checkId": "ci-1", "reviewThreadId": null,
                   "state": {"status": "idle"}})
        );
        assert!(ScenarioSlot::of(ScenarioKind::FixCi, Some("bad\nid"), None).is_err());
        assert!(matches!(
            ScenarioSlot::of(ScenarioKind::Message, None, None),
            Ok(None)
        ));
    }
}
