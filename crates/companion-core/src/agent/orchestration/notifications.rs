//! Child work request reconciliation and parent result handoff.
//!
//! One loop owns both safety nets. The reconciler reads each child with open
//! requests at most once per pass (one history read), with per-child
//! exponential backoff from the base to the cap, reset by a live start or a
//! queue change. The same pass reads children the in-memory tracker still
//! follows as running without an open request. Before each read the child is
//! subscribed to (`AgentProvider::thread_observe`), so an end after it arrives
//! live and an end before it is in the read. A newest turn the history shows
//! ended without a live end is published as that end would have been: the
//! tracker settles (`codewide_wait_agent`) and a `turn/completed` is journaled
//! for the thread-list row and the phones. The handoff turns settled requests into one hidden,
//! model-only parent notice per batch; the turn outbox owns idle-only
//! dispatch, retries and receipts. Coordination keeps only command
//! references; the notice text lives only in the outbox.

use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    time::Duration,
};

use tokio::time::Instant;
use tracing::{debug, error, info, warn};

use super::{
    OrchestrationService, ToolError,
    agent_controls::last_turn_state,
    coordinator::watch::ChildState,
    delivery::TerminalPayload,
    journal::{JournalError, ReceiptBinding, TaskJournal},
    work_requests::{
        ChildWorkRequest, NeverStartedReason, RequestOrigin, RequestPhase, RunOutcome, Settlement,
        SuppressReason, WorkRequestId,
    },
};
use crate::{
    agent::{
        client_wire::{events::history_turn_completed, observe::TurnEnd},
        model::{
            AgentTurn, AppThreadId, ERROR_INVALID_REQUEST, ItemsView, ProviderId, SortDirection,
            ThreadTurnsParams, TurnId, TurnStatus, thread_not_found_message,
        },
        provider::{AgentProvider, ProviderError},
    },
    delegated_task_completion::{
        ChildResultNotice, ChildResultReport, DelegatedTaskStatus, serialize,
    },
    store::{OutboxState, StoreError, TurnReceipt},
    turn_delivery::{
        TurnReceiptObserver, enqueue_completion_in_write, notice_state_in_write,
        retract_notice_in_write,
    },
};

/// Even worst-case JSON escaping leaves the message below the outbox's 1 MiB
/// limit. The full result remains readable through the wait tools or history.
const MAX_RESULT_CHARACTERS: usize = 32_000;
/// A notice of several reports shares the same bound.
const MAX_NOTICE_CHARACTERS: usize = 96_000;

#[cfg(not(test))]
const BACKOFF_BASE: Duration = Duration::from_secs(1);
#[cfg(not(test))]
const BACKOFF_CAP: Duration = Duration::from_mins(1);
/// After this long without readable history, the status is delivered without
/// its text and the model is told how to read it.
#[cfg(not(test))]
const UNREADABLE_RESULT_CAP: Duration = Duration::from_mins(10);
#[cfg(test)]
const BACKOFF_BASE: Duration = Duration::from_millis(10);
#[cfg(test)]
const BACKOFF_CAP: Duration = Duration::from_millis(100);
#[cfg(test)]
const UNREADABLE_RESULT_CAP: Duration = Duration::from_millis(300);
/// A `wait_agent` waiting when the child's turn ends gets this long to take
/// the result before it is pushed (its acknowledgement settles it first).
#[cfg(not(test))]
const WAITER_GRACE: Duration = Duration::from_secs(5);
#[cfg(test)]
const WAITER_GRACE: Duration = Duration::from_millis(500);

/// Turns read for a child the tracker follows without an open request: its
/// newest turn decides, the rest only proves which tracked turn ended.
const TRACKED_HISTORY_TURNS: u32 = 10;

const UNREADABLE_NOTE: &str = "The result text could not be read from the agent's history; call codewide_wait_agent with this agentThreadId to read it.";

/// Wake-ups and per-child backoff of the delivery loop.
#[derive(Default)]
pub(super) struct DeliveryLoop {
    wake: tokio::sync::Notify,
    /// The binding of the receipt transaction in progress, published only
    /// after it commits.
    uncommitted: Mutex<Option<ReceiptBinding>>,
    receipts: Mutex<Vec<ReceiptBinding>>,
    children: Mutex<HashMap<AppThreadId, ChildBackoff>>,
}

#[derive(Clone, Copy)]
struct ChildBackoff {
    delay: Duration,
    next_at: Instant,
}

impl DeliveryLoop {
    fn children(&self) -> std::sync::MutexGuard<'_, HashMap<AppThreadId, ChildBackoff>> {
        self.children
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    /// Makes a child due now (a failed terminal write, a receipt).
    pub(super) fn mark_dirty(&self, child: &AppThreadId) {
        self.children().remove(child);
        self.wake.notify_one();
    }

    /// Restarts a child's backoff at its base (a live start, a queue change).
    pub(super) fn reset(&self, child: &AppThreadId) {
        self.children().insert(
            child.clone(),
            ChildBackoff {
                delay: BACKOFF_BASE,
                next_at: Instant::now() + BACKOFF_BASE,
            },
        );
        self.wake.notify_one();
    }

    pub(super) fn wake(&self) {
        self.wake.notify_one();
    }

    fn due(&self, child: &AppThreadId, now: Instant) -> Result<(), Instant> {
        match self.children().get(child) {
            Some(backoff) if backoff.next_at > now => Err(backoff.next_at),
            _ => Ok(()),
        }
    }

    fn back_off(&self, child: &AppThreadId, now: Instant) -> Instant {
        let mut children = self.children();
        let delay = children.get(child).map_or(BACKOFF_BASE, |backoff| {
            backoff.delay.saturating_mul(2).min(BACKOFF_CAP)
        });
        let next_at = now + delay;
        children.insert(child.clone(), ChildBackoff { delay, next_at });
        next_at
    }

    fn forget_settled(
        &self,
        open: &std::collections::BTreeMap<AppThreadId, Vec<ChildWorkRequest>>,
        tracked: &[(AppThreadId, ProviderId)],
    ) {
        self.children().retain(|child, _| {
            open.contains_key(child) || tracked.iter().any(|(running, _)| running == child)
        });
    }
}

/// Runs inside every delivery-receipt transaction: binds the request of the
/// receipt's command (or counts a notice-started parent turn) and wakes the
/// loop. Opaque identifiers only.
pub(super) struct ReceiptBinder {
    pub(super) delivery: Arc<DeliveryLoop>,
    /// Updated as soon as the receipt commits, so an agent control called
    /// right after a start already sees the running turn.
    pub(super) tracker: Arc<super::coordinator::watch::ChildTracker>,
}

impl TurnReceiptObserver for ReceiptBinder {
    fn delivered(
        &self,
        write: &redb::WriteTransaction,
        receipt: TurnReceipt<'_>,
    ) -> Result<(), StoreError> {
        let mut uncommitted = self
            .delivery
            .uncommitted
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        // A binding left by a transaction that did not commit is stale.
        *uncommitted = None;
        match TaskJournal::bind_from_receipt(write, receipt) {
            Ok(Some(binding)) => {
                *uncommitted = Some(binding);
                Ok(())
            }
            Ok(None) => Ok(()),
            Err(JournalError::Store(error)) => Err(error),
            Err(error) => {
                // A record-level conflict must not strand the provider receipt;
                // the reconciler re-reads the request from durable state.
                error!(
                    err = ?error,
                    command_id = receipt.command,
                    "a delivery receipt could not bind its child work request"
                );
                self.delivery.wake();
                Ok(())
            }
        }
    }

    fn committed(&self) {
        let binding = self
            .delivery
            .uncommitted
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .take();
        if let Some(binding) = binding {
            if let ReceiptBinding::Request {
                provider,
                child,
                turn_id,
                ..
            } = &binding
            {
                self.tracker.authorize(child.as_str(), provider.clone());
                self.tracker.register_if_absent(
                    child.as_str(),
                    super::coordinator::watch::ChildState::Running {
                        turn_id: Some(turn_id.as_str().to_owned()),
                    },
                );
                self.tracker.started(child.as_str(), turn_id.as_str());
            }
            if let ReceiptBinding::Notice {
                parent,
                consecutive,
            } = &binding
            {
                // Measured only: no cap is enforced on notice wake-ups.
                info!(
                    parent_thread_id = %parent,
                    consecutive_notice_turns = consecutive,
                    "parent turn started by a child-result notice"
                );
            }
            self.delivery
                .receipts
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .push(binding);
            self.delivery.wake();
        }
    }
}

/// One handoff pass's notion of now, as wall-clock ms and loop instant.
#[derive(Clone, Copy)]
struct Clock {
    now_ms: u64,
    now: Instant,
}

impl Clock {
    fn now() -> Self {
        Self {
            now_ms: unix_time_ms(),
            now: Instant::now(),
        }
    }

    /// Splits requests whose handoff is due now from those that wait, and
    /// returns when the earliest waiting one is due.
    fn partition_due(
        self,
        requests: Vec<ChildWorkRequest>,
    ) -> (Vec<ChildWorkRequest>, Option<Instant>) {
        let mut next = None;
        let mut due = Vec::new();
        for request in requests {
            if let RequestPhase::Settled {
                delivery:
                    super::work_requests::Delivery::AwaitingHandoff {
                        next_attempt_at_ms, ..
                    },
                ..
            } = &request.phase
                && *next_attempt_at_ms > self.now_ms
            {
                next = Some(earliest(
                    next,
                    self.now + Duration::from_millis(next_attempt_at_ms - self.now_ms),
                ));
                continue;
            }
            due.push(request);
        }
        (due, next)
    }
}

enum ParentPresence {
    Live,
    Archived,
    Deleted,
}

fn ms(duration: Duration) -> u64 {
    u64::try_from(duration.as_millis()).unwrap_or(u64::MAX)
}

fn unix_time_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |elapsed| {
            u64::try_from(elapsed.as_millis()).unwrap_or(u64::MAX)
        })
}

/// Subscribes the host to a child's live events before its history is read.
/// A failure only leaves the history read as the safety net.
async fn observe_child(provider: &Arc<dyn AgentProvider>, child: &AppThreadId) {
    if let Err(error) = provider.thread_observe(child).await {
        debug!(err = ?error, child_thread_id = %child, "child live events could not be subscribed");
    }
}

fn earliest(current: Option<Instant>, candidate: Instant) -> Instant {
    current.map_or(candidate, |current| current.min(candidate))
}

fn handoff_backoff_ms(attempts: u32) -> u64 {
    ms(BACKOFF_BASE
        .saturating_mul(1_u32 << attempts.min(16))
        .min(BACKOFF_CAP))
}

fn end_of(status: TurnStatus) -> Option<TurnEnd> {
    match status {
        TurnStatus::InProgress => None,
        TurnStatus::Completed => Some(TurnEnd::Completed),
        TurnStatus::Failed => Some(TurnEnd::Failed),
        TurnStatus::Interrupted => Some(TurnEnd::Interrupted),
    }
}

const fn notice_status(settlement: &Settlement) -> DelegatedTaskStatus {
    match settlement {
        Settlement::Ran {
            outcome: RunOutcome::Completed,
            ..
        } => DelegatedTaskStatus::Succeeded,
        Settlement::Ran {
            outcome: RunOutcome::Interrupted,
            ..
        } => DelegatedTaskStatus::Interrupted,
        Settlement::Ran {
            outcome: RunOutcome::Cancelled,
            ..
        }
        | Settlement::NeverStarted {
            reason: NeverStartedReason::CancelledByParent,
        } => DelegatedTaskStatus::Cancelled,
        Settlement::Ran {
            outcome: RunOutcome::Failed,
            ..
        }
        | Settlement::NeverStarted {
            reason: NeverStartedReason::DispatchFailed | NeverStartedReason::ChildGone,
        } => DelegatedTaskStatus::Failed,
    }
}

impl OrchestrationService {
    pub(super) fn start_delivery_loop(self: &Arc<Self>) {
        let mut signals = self.task_signals.subscribe();
        let delivery = self.delivery.clone();
        let service = Arc::downgrade(self);
        tokio::spawn(async move {
            loop {
                let Some(service) = service.upgrade() else {
                    return;
                };
                let next = service.delivery_pass().await;
                drop(service);
                let sleep = next.map_or(BACKOFF_CAP, |next| {
                    next.saturating_duration_since(Instant::now())
                });
                tokio::select! {
                    signal = signals.recv() => {
                        if matches!(signal, Err(tokio::sync::broadcast::error::RecvError::Closed)) { return; }
                    }
                    () = delivery.wake.notified() => {}
                    () = tokio::time::sleep(sleep) => {}
                }
            }
        });
    }

    /// One reconciliation and handoff pass. Returns when the next pass is due.
    async fn delivery_pass(&self) -> Option<Instant> {
        let receipts = std::mem::take(
            &mut *self
                .delivery
                .receipts
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner),
        );
        for binding in receipts {
            self.apply_receipt(binding).await;
        }
        let mut next = None;
        match self.task_journal.open_by_child().await {
            Ok(open) => {
                // Children followed as running without an open request (a
                // turn started outside a request, or one whose request
                // settled while the tracker missed the end).
                let tracked = self
                    .tracker
                    .running()
                    .into_iter()
                    .filter_map(|(child, provider)| {
                        AppThreadId::parse(&child)
                            .filter(|child| !open.contains_key(child))
                            .map(|child| (child, provider))
                    })
                    .collect::<Vec<_>>();
                self.delivery.forget_settled(&open, &tracked);
                for (child, requests) in &open {
                    let now = Instant::now();
                    if let Err(due) = self.delivery.due(child, now) {
                        next = Some(earliest(next, due));
                        continue;
                    }
                    if self.reconcile_child(child, requests).await {
                        next = Some(earliest(next, self.delivery.back_off(child, now)));
                    }
                }
                for (child, provider) in &tracked {
                    let now = Instant::now();
                    if let Err(due) = self.delivery.due(child, now) {
                        next = Some(earliest(next, due));
                        continue;
                    }
                    if self.reconcile_tracked(child, provider).await {
                        next = Some(earliest(next, self.delivery.back_off(child, now)));
                    }
                }
            }
            Err(error) => {
                error!(err = ?error, "open child work requests are unreadable");
                next = Some(earliest(next, Instant::now() + BACKOFF_BASE));
            }
        }
        match self.task_journal.handoffs_by_parent().await {
            Ok(parents) => {
                for (parent, requests) in parents {
                    if let Some(due) = self.hand_off_parent(&parent, requests).await {
                        next = Some(earliest(next, due));
                    }
                }
            }
            Err(error) => {
                error!(err = ?error, "settled child work requests are unreadable");
                next = Some(earliest(next, Instant::now() + BACKOFF_BASE));
            }
        }
        next
    }

    async fn apply_receipt(&self, binding: ReceiptBinding) {
        // The binder already updated the tracker when the receipt committed.
        let ReceiptBinding::Request {
            child,
            cancel_requested,
            task_id,
            ..
        } = binding
        else {
            return;
        };
        self.delivery.reset(&child);
        self.signal_tasks();
        // A cancel recorded before the turn existed now has a turn to stop.
        if cancel_requested && let Some(task_id) = task_id {
            match self.task_journal.get(&task_id).await {
                Ok(bundle) => {
                    if let Err(error) = self.resume_cancellation(&bundle).await {
                        warn!(err = ?error.render(), task_id = %task_id.as_str(), "cancellation of a late-started task turn failed");
                    }
                }
                Err(error) => {
                    error!(err = ?error, task_id = %task_id.as_str(), "task of a late-started turn is unreadable");
                }
            }
        }
    }

    /// Settles a child's requests from one history read. Returns whether any
    /// request of the child is still open.
    pub(super) async fn reconcile_child(
        &self,
        child: &AppThreadId,
        requests: &[ChildWorkRequest],
    ) -> bool {
        let Some(first) = requests.first() else {
            return false;
        };
        let provider_id = first.provider.clone();
        let mut open = false;
        let mut running = Vec::new();
        for request in requests {
            match &request.phase {
                RequestPhase::Queued | RequestPhase::CancelRequested { turn_id: None } => {
                    if !self.reconcile_queued(request).await {
                        open = true;
                    }
                }
                RequestPhase::Running { turn_id }
                | RequestPhase::CancelRequested {
                    turn_id: Some(turn_id),
                } => running.push(turn_id.clone()),
                RequestPhase::Settled { .. } => {}
            }
        }
        if running.is_empty() {
            return open;
        }
        let Some(provider) = self.gateway.registry().get(&provider_id).cloned() else {
            return true;
        };
        observe_child(&provider, child).await;
        let page = provider
            .thread_turns(ThreadTurnsParams {
                app_thread_id: child.clone(),
                cursor: None,
                limit: 100,
                sort_direction: SortDirection::Desc,
                items_view: ItemsView::NotLoaded,
            })
            .await;
        let turns = match page {
            Ok(page) => page.turns,
            Err(ProviderError::Rejected(rejection))
                if rejection.code == ERROR_INVALID_REQUEST
                    && rejection.message == thread_not_found_message(child.as_str()) =>
            {
                let ids = requests
                    .iter()
                    .map(|request| request.request_id.clone())
                    .collect();
                return match self
                    .task_journal
                    .settle_never_started(ids, NeverStartedReason::ChildGone)
                    .await
                {
                    Ok(_) => {
                        self.delivery.wake();
                        self.signal_tasks();
                        false
                    }
                    Err(error) => {
                        error!(err = ?error, child_thread_id = %child, "a vanished child's requests could not be settled");
                        true
                    }
                };
            }
            Err(error) => {
                warn!(err = ?error, child_thread_id = %child, "child history is temporarily unreadable");
                return true;
            }
        };
        // Before the requests settle: the release of a queued follow-up
        // marks its pending turn only over the ended turn's settled state.
        self.settle_tracker_from_history(&provider_id, &provider, child, &turns, true)
            .await;
        for turn_id in running {
            let end = turns
                .iter()
                .find(|turn| turn.turn_id == turn_id)
                .and_then(|turn| end_of(turn.status));
            match end {
                Some(end) => {
                    if !self
                        .settle_turn(&provider_id, child, &turn_id, end, false)
                        .await
                    {
                        open = true;
                    }
                }
                None => open = true,
            }
        }
        open
    }

    /// Reconciles one request still waiting for dispatch against the outbox.
    /// Returns `true` when it settled.
    async fn reconcile_queued(&self, request: &ChildWorkRequest) -> bool {
        let command = match self.turn_delivery.command(&request.command_id).await {
            Ok(command) => command,
            Err(error) => {
                warn!(err = ?error, request_id = %request.request_id.as_str(), "a queued request's command is unreadable");
                return false;
            }
        };
        let reason = match (command, &request.origin) {
            (Some(command), _) if command.state == OutboxState::Failed => {
                NeverStartedReason::DispatchFailed
            }
            (Some(command), _) => {
                // A receipt written before this request existed (legacy).
                if command.state == OutboxState::Delivered
                    && let Some(turn_id) = command.delivered_turn_id
                    && let Err(error) = self
                        .task_journal
                        .bind_stored_receipt(command.command_id, command.remote_thread_id, turn_id)
                        .await
                {
                    error!(err = ?error, request_id = %request.request_id.as_str(), "a stored receipt could not bind its request");
                }
                return false;
            }
            // A removed follow-up was cancelled before it started.
            (None, RequestOrigin::Followup) => NeverStartedReason::CancelledByParent,
            // A task's initial turn may still be a reservation; the task
            // driver owns its start.
            (None, RequestOrigin::TaskInitial { .. }) => return false,
        };
        match self
            .task_journal
            .settle_never_started(vec![request.request_id.clone()], reason)
            .await
        {
            Ok(_) => {
                self.signal_tasks();
                true
            }
            Err(error) => {
                error!(err = ?error, request_id = %request.request_id.as_str(), "a never-started request could not be settled");
                false
            }
        }
    }

    /// Settles the requests a terminal turn fact ends and runs the effects of
    /// a newly observed end. `live` facts already updated the tracker. On a
    /// journal failure the full error is logged and the child is reconciled
    /// again. Returns `true` when the fact was durably applied.
    pub(super) async fn settle_turn(
        &self,
        provider: &ProviderId,
        child: &AppThreadId,
        turn_id: &TurnId,
        end: TurnEnd,
        live: bool,
    ) -> bool {
        let waiter_hold = if self.tracker.has_waiters(child.as_str()) {
            ms(WAITER_GRACE)
        } else {
            0
        };
        match self
            .task_journal
            .settle_by_turn(provider, child.as_str(), turn_id, end, waiter_hold)
            .await
        {
            Ok(settled) => {
                // A history end already settled the tracker and journaled the
                // thread's end (`settle_tracker_from_history`).
                if !live && !settled.is_empty() {
                    self.release_queued(child, turn_id).await;
                    if self.turn_ends.receiver_count() > 0 {
                        let _ = self.turn_ends.send((
                            provider.clone(),
                            child.as_str().to_owned(),
                            turn_id.as_str().to_owned(),
                        ));
                    }
                }
                if !settled.is_empty() {
                    self.delivery.wake();
                    self.signal_tasks();
                }
                true
            }
            Err(error) => {
                error!(
                    err = ?error,
                    child_thread_id = %child,
                    turn_id = %turn_id,
                    "a terminal child turn could not be settled; the reconciler will retry"
                );
                self.delivery.mark_dirty(child);
                false
            }
        }
    }

    /// Reads a child the tracker follows as running without an open request
    /// and settles it from history. Returns whether it is still followed as
    /// running (read again after its backoff).
    async fn reconcile_tracked(&self, child: &AppThreadId, provider_id: &ProviderId) -> bool {
        let Some(provider) = self.gateway.registry().get(provider_id).cloned() else {
            return true;
        };
        observe_child(&provider, child).await;
        let page = provider
            .thread_turns(ThreadTurnsParams {
                app_thread_id: child.clone(),
                cursor: None,
                limit: TRACKED_HISTORY_TURNS,
                sort_direction: SortDirection::Desc,
                items_view: ItemsView::NotLoaded,
            })
            .await;
        match page {
            Ok(page) => {
                self.settle_tracker_from_history(provider_id, &provider, child, &page.turns, false)
                    .await;
            }
            Err(ProviderError::Rejected(rejection))
                if rejection.code == ERROR_INVALID_REQUEST
                    && rejection.message == thread_not_found_message(child.as_str()) =>
            {
                // A deleted agent never ends its turn: stop following it.
                let turn_id = match self.tracker.state(child.as_str()) {
                    Some(ChildState::Running { turn_id }) => turn_id,
                    _ => None,
                };
                self.tracker.register(
                    child.as_str(),
                    ChildState::Settled {
                        end: TurnEnd::Failed,
                        turn_id,
                        final_message: Some(format!("agent thread not found: {child}")),
                    },
                );
            }
            Err(error) => {
                warn!(err = ?error, child_thread_id = %child, "tracked child history is temporarily unreadable");
            }
        }
        self.tracker
            .state(child.as_str())
            .is_some_and(|state| state.is_running())
    }

    /// Applies one history read of a child to the in-memory tracker. A
    /// running newest turn becomes the tracked turn; an ended newest turn
    /// whose end this process never observed settles the tracker (with the
    /// turn's final message) and journals its `turn/completed`, the
    /// transition its live end would have made for the thread-list row and
    /// the phones. `untracked` registers a child this process never tracked.
    async fn settle_tracker_from_history(
        &self,
        provider_id: &ProviderId,
        provider: &Arc<dyn AgentProvider>,
        child: &AppThreadId,
        turns: &[AgentTurn],
        untracked: bool,
    ) {
        let Some(newest) = turns.first() else {
            return;
        };
        self.tracker.authorize(child.as_str(), provider_id.clone());
        let Some(end) = end_of(newest.status) else {
            self.tracker
                .started(child.as_str(), newest.turn_id.as_str());
            return;
        };
        if self
            .tracker
            .has_ended(child.as_str(), newest.turn_id.as_str())
        {
            return;
        }
        let ended = turns
            .iter()
            .filter(|turn| end_of(turn.status).is_some())
            .map(|turn| turn.turn_id.as_str())
            .collect::<Vec<_>>();
        let settled = match last_turn_state(provider, child).await {
            // The final message comes from the same newest turn, read once
            // with its items.
            Ok(state)
                if matches!(&state, ChildState::Settled { turn_id: Some(id), .. }
                    if id == newest.turn_id.as_str()) =>
            {
                state
            }
            _ => ChildState::Settled {
                end,
                turn_id: Some(newest.turn_id.as_str().to_owned()),
                final_message: newest.error.as_ref().map(|error| error.message.clone()),
            },
        };
        if !self
            .tracker
            .settle_from_history(child.as_str(), settled, &ended, untracked)
        {
            return;
        }
        info!(
            child_thread_id = %child,
            turn_id = %newest.turn_id,
            "a child turn end missing from the live stream was settled from history"
        );
        // Journal backpressure must not stall the delivery loop.
        let journal = self.journal.clone();
        let payload = history_turn_completed(child, newest);
        let child = child.clone();
        tokio::spawn(async move {
            if journal.send(payload).await.is_err() {
                warn!(child_thread_id = %child, "the journal stopped before a history turn end");
            }
        });
    }

    /// Releases queued follow-ups after the child's turn ended.
    pub(super) async fn release_queued(&self, child: &AppThreadId, ended_turn: &TurnId) {
        match self
            .turn_delivery
            .release_queued_for_thread(child.as_str())
            .await
        {
            Ok(Some(_)) => {
                self.tracker
                    .queued_after(child.as_str(), ended_turn.as_str());
                self.delivery.reset(child);
            }
            Ok(None) => {}
            Err(error) => {
                error!(err = ?error, child_thread_id = %child, "queued follow-ups could not be released");
            }
        }
    }

    /// Hands a parent's settled requests to one notice. Returns when the next
    /// attempt is due; `None` waits for a receipt or a new settlement.
    async fn hand_off_parent(
        &self,
        parent: &AppThreadId,
        requests: Vec<ChildWorkRequest>,
    ) -> Option<Instant> {
        match self
            .task_journal
            .notice_pending(parent, notice_state_in_write, retract_notice_in_write)
            .await
        {
            // Batch behind the queued notice; its receipt wakes this loop.
            Ok(true) => return None,
            Ok(false) => {}
            Err(error) => {
                error!(err = ?error, parent_thread_id = %parent, "the parent's pending notice is unreadable");
                return Some(Instant::now() + BACKOFF_BASE);
            }
        }
        let clock = Clock::now();
        let (due, mut next) = clock.partition_due(requests);
        if due.is_empty() {
            return next;
        }
        match self.parent_presence(parent).await {
            Ok(ParentPresence::Live) => {}
            Ok(gone) => {
                let reason = if matches!(gone, ParentPresence::Archived) {
                    SuppressReason::ParentArchived
                } else {
                    SuppressReason::ParentDeleted
                };
                let ids = due
                    .iter()
                    .map(|request| request.request_id.clone())
                    .collect();
                if let Err(error) = self.task_journal.suppress(ids, reason).await {
                    error!(err = ?error, parent_thread_id = %parent, "results of a gone parent could not be suppressed");
                    return Some(earliest(next, clock.now + BACKOFF_BASE));
                }
                info!(parent_thread_id = %parent, ?reason, "child results suppressed for a gone parent");
                return next;
            }
            Err(error) => {
                warn!(error = %error, parent_thread_id = %parent, "parent presence is unknown; the handoff will retry");
                return Some(earliest(next, clock.now + BACKOFF_BASE));
            }
        }
        let (handed, reports) = self.prepare_reports(due, clock, &mut next).await;
        if handed.is_empty() {
            return next;
        }
        if let Some(retry) = self.enqueue_notice(parent, handed, reports).await {
            next = Some(earliest(next, clock.now + retry));
        }
        next
    }

    /// The reports that can be handed off now, in order, bounded in size.
    /// Unreadable results are deferred with backoff until the cap.
    async fn prepare_reports(
        &self,
        due: Vec<ChildWorkRequest>,
        clock: Clock,
        next: &mut Option<Instant>,
    ) -> (Vec<ChildWorkRequest>, Vec<ChildResultReport>) {
        let mut reports = Vec::new();
        let mut handed = Vec::new();
        let mut size = 0;
        for request in due {
            let report = match self.request_report(&request).await {
                Ok(Some(report)) => report,
                Ok(None) => {
                    let RequestPhase::Settled {
                        settled_at_ms,
                        delivery: super::work_requests::Delivery::AwaitingHandoff { attempts, .. },
                        ..
                    } = &request.phase
                    else {
                        continue;
                    };
                    if clock.now_ms.saturating_sub(*settled_at_ms) < ms(UNREADABLE_RESULT_CAP) {
                        let delay = handoff_backoff_ms(*attempts);
                        if let Err(error) = self
                            .task_journal
                            .defer_handoff(&request.request_id, clock.now_ms.saturating_add(delay))
                            .await
                        {
                            error!(err = ?error, request_id = %request.request_id.as_str(), "a handoff could not be deferred");
                        }
                        *next = Some(earliest(*next, clock.now + Duration::from_millis(delay)));
                        continue;
                    }
                    self.unreadable_report(&request).await
                }
                Err(error) => {
                    warn!(err = ?error.render(), request_id = %request.request_id.as_str(), "a child result could not be prepared");
                    *next = Some(earliest(*next, clock.now + BACKOFF_BASE));
                    continue;
                }
            };
            let length = report
                .final_message
                .as_ref()
                .map_or(0, |text| text.chars().count());
            if !reports.is_empty() && size + length > MAX_NOTICE_CHARACTERS {
                // The rest goes in the next notice.
                *next = Some(earliest(*next, clock.now));
                break;
            }
            size += length;
            handed.push(request);
            reports.push(report);
        }
        (handed, reports)
    }

    /// Commits one notice for `handed`. Returns a retry delay on failure.
    async fn enqueue_notice(
        &self,
        parent: &AppThreadId,
        handed: Vec<ChildWorkRequest>,
        reports: Vec<ChildResultReport>,
    ) -> Option<Duration> {
        let command_id = handed.first()?.dedupe_key.clone();
        let ids: Vec<WorkRequestId> = handed
            .into_iter()
            .map(|request| request.request_id)
            .collect();
        let count = ids.len();
        let notice = match serialize(ChildResultNotice::new(reports)) {
            Ok(notice) => notice,
            Err(error) => {
                error!(err = ?error, parent_thread_id = %parent, "a child-result notice could not be encoded");
                return Some(BACKOFF_BASE);
            }
        };
        match self
            .task_journal
            .hand_off(
                parent,
                ids,
                command_id,
                notice_state_in_write,
                retract_notice_in_write,
                move |write, command, parent| {
                    enqueue_completion_in_write(write, command, parent, &notice)
                },
            )
            .await
        {
            Ok(super::journal::HandoffOutcome::Enqueued) => {
                info!(parent_thread_id = %parent, results = count, "child results handed to the parent");
                self.turn_delivery.wake();
                None
            }
            Ok(super::journal::HandoffOutcome::Blocked) => None,
            Ok(super::journal::HandoffOutcome::Stale) => Some(Duration::ZERO),
            Err(error) => {
                error!(err = ?error, parent_thread_id = %parent, "child results could not be handed to the parent");
                Some(BACKOFF_BASE)
            }
        }
    }

    async fn parent_presence(&self, parent: &AppThreadId) -> Result<ParentPresence, String> {
        let target = match self.gateway.resolve_thread(parent.as_str(), None).await {
            Ok(target) => target,
            Err(failure) if failure.message == thread_not_found_message(parent.as_str()) => {
                return Ok(ParentPresence::Deleted);
            }
            Err(failure) => return Err(failure.message),
        };
        match target.provider.thread_read(&target.thread_id).await {
            Ok(read) if read.thread.archived => Ok(ParentPresence::Archived),
            Ok(_) => Ok(ParentPresence::Live),
            Err(ProviderError::Rejected(rejection))
                if rejection.code == ERROR_INVALID_REQUEST
                    && rejection.message == thread_not_found_message(parent.as_str()) =>
            {
                Ok(ParentPresence::Deleted)
            }
            Err(error) => Err(error.to_string()),
        }
    }

    /// The child's display name: the task's, else the link's.
    async fn request_name(&self, request: &ChildWorkRequest) -> Option<String> {
        if let Some(task_id) = request.task_id()
            && let Ok(bundle) = self.task_journal.get(task_id).await
            && bundle.task.name.is_some()
        {
            return bundle.task.name;
        }
        let child = request.child_thread_id.as_ref()?;
        self.links
            .link_of(child.as_str())
            .await
            .ok()
            .flatten()
            .and_then(|link| link.name)
    }

    fn base_report(request: &ChildWorkRequest, name: Option<String>) -> Option<ChildResultReport> {
        let RequestPhase::Settled { settlement, .. } = &request.phase else {
            return None;
        };
        Some(ChildResultReport {
            request_id: request.request_id.as_str().to_owned(),
            task_id: request.task_id().map(|task| task.as_str().to_owned()),
            agent_thread_id: request
                .child_thread_id
                .as_ref()
                .map(|child| child.as_str().to_owned()),
            turn_id: request.turn_id().map(|turn| turn.as_str().to_owned()),
            name,
            status: notice_status(settlement),
            final_message: None,
            result_truncated: false,
            note: None,
            cost: None,
        })
    }

    /// The report of a settled request, `None` while its history is unreadable.
    async fn request_report(
        &self,
        request: &ChildWorkRequest,
    ) -> Result<Option<ChildResultReport>, ToolError> {
        let name = self.request_name(request).await;
        let Some(mut report) = Self::base_report(request, name) else {
            return Ok(None);
        };
        let payload = match (&request.phase, request.task_id()) {
            (
                RequestPhase::Settled {
                    settlement: Settlement::Ran { turn_id, .. },
                    ..
                },
                _,
            ) => match &request.child_thread_id {
                Some(child) => self.turn_payload(&request.provider, child, turn_id).await,
                None => TerminalPayload::Ready {
                    message: None,
                    cost: None,
                },
            },
            (_, Some(task_id)) => {
                let bundle = self.task_journal.get(task_id).await?;
                self.terminal_payload(&bundle).await?
            }
            (_, None) => TerminalPayload::Ready {
                message: None,
                cost: None,
            },
        };
        let TerminalPayload::Ready { mut message, cost } = payload else {
            return Ok(None);
        };
        report.result_truncated = message.as_mut().is_some_and(truncate_result);
        report.final_message = message;
        report.cost = cost;
        Ok(Some(report))
    }

    async fn unreadable_report(&self, request: &ChildWorkRequest) -> ChildResultReport {
        let name = self.request_name(request).await;
        let mut report = Self::base_report(request, name).unwrap_or_else(|| ChildResultReport {
            request_id: request.request_id.as_str().to_owned(),
            task_id: None,
            agent_thread_id: None,
            turn_id: None,
            name: None,
            status: DelegatedTaskStatus::Failed,
            final_message: None,
            result_truncated: false,
            note: None,
            cost: None,
        });
        report.note = Some(UNREADABLE_NOTE.to_owned());
        report
    }
}

fn truncate_result(message: &mut String) -> bool {
    let Some((boundary, _)) = message.char_indices().nth(MAX_RESULT_CHARACTERS) else {
        return false;
    };
    message.truncate(boundary);
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn large_results_are_bounded_without_splitting_unicode() {
        let mut result = "🦀".repeat(MAX_RESULT_CHARACTERS + 1);
        assert!(truncate_result(&mut result));
        assert_eq!(result.chars().count(), MAX_RESULT_CHARACTERS);
        assert!(!truncate_result(&mut result));
        assert_eq!(result.chars().last(), Some('🦀'));
    }

    #[test]
    fn handoff_backoff_grows_to_its_cap() {
        assert_eq!(handoff_backoff_ms(0), ms(BACKOFF_BASE));
        assert_eq!(handoff_backoff_ms(1), ms(BACKOFF_BASE) * 2);
        assert_eq!(handoff_backoff_ms(40), ms(BACKOFF_CAP));
    }
}
