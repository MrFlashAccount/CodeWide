//! Semantic source boundary and V2-only subscription coordinator.

use std::{
    collections::{HashMap, HashSet, VecDeque},
    sync::{Arc, Mutex},
};

use async_trait::async_trait;
use tokio::sync::{Notify, watch};

use crate::auth::AuthorizationContext;

use super::{
    auth_context::AuthenticatedContextKey,
    domain::{
        CatalogScope, PendingRequest, ProjectionChange, RemovalReason, SnapshotLimits,
        ThreadSummary, ThreadWindow,
    },
    protocol::{
        Action, ActionResult, CatalogSnapshot, Command, CommandResult, OpenIntent, Query,
        QueryResult, V2Error,
    },
    scalar::{Id, OperationId},
};

#[derive(Clone, Debug)]
pub struct SnapshotData {
    pub scope: CatalogScope,
    pub catalog: CatalogSnapshot,
    pub current_thread: Option<ThreadWindow>,
    pub pending_requests: Vec<PendingRequest>,
    pub source_witness: String,
}

#[derive(Clone, Debug)]
pub struct WatchedThreadData {
    pub current_thread: ThreadWindow,
    pub pending_requests: Vec<PendingRequest>,
}

#[allow(clippy::large_enum_variant)]
#[derive(Clone, Debug)]
pub enum CommandExecution {
    Completed(CommandResult),
    Failed(V2Error),
    Indeterminate(V2Error),
}

#[derive(Clone, Debug)]
pub enum AudienceSelector {
    ExactContext(AuthenticatedContextKey),
    CurrentThread {
        context: AuthenticatedContextKey,
        thread_id: Id,
    },
    CatalogPartition {
        context: AuthenticatedContextKey,
        archived: bool,
    },
    Ambiguous,
}

#[allow(clippy::large_enum_variant)]
#[derive(Clone, Debug)]
pub enum CoordinatorEvent {
    Change {
        generation: u64,
        recipient_ids: Arc<HashSet<Id>>,
        change: ProjectionChange,
    },
    RoutingInvalidated {
        generation: u64,
        recipient_ids: Arc<HashSet<Id>>,
        reason: SourceInvalidationReason,
    },
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum SourceInvalidationReason {
    SourceGap,
    UpstreamUnavailable,
}

#[derive(Clone)]
pub struct SubscriptionCoordinator {
    recipients: Arc<Mutex<HashMap<Id, Recipient>>>,
}

#[derive(Clone)]
struct Recipient {
    generation: u64,
    context: AuthenticatedContextKey,
    intent: OpenIntent,
    active_membership: Vec<Id>,
    archived_membership: Vec<Id>,
    mailbox: Arc<RecipientMailbox>,
}

struct RecipientMailbox {
    state: Mutex<MailboxState>,
    notify: Notify,
    budget: Arc<DeliveryBudget>,
}

struct MailboxState {
    queue: VecDeque<(CoordinatorEvent, DeliveryReservation)>,
    bytes: usize,
    overflowed: bool,
    closed: bool,
}

pub struct CoordinatorReceiver {
    mailbox: Arc<RecipientMailbox>,
}

pub struct ReceivedCoordinatorEvent {
    event: CoordinatorEvent,
    reservation: DeliveryReservation,
}

#[derive(Debug)]
pub struct DeliveryBudget {
    state: Mutex<DeliveryBudgetState>,
    max_events: usize,
    max_bytes: usize,
}

#[derive(Debug, Default)]
struct DeliveryBudgetState {
    events: usize,
    bytes: usize,
}

#[derive(Debug)]
pub struct DeliveryReservation {
    budget: Arc<DeliveryBudget>,
    bytes: usize,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CoordinatorRecvError {
    Empty,
    Overflow,
    Closed,
}

impl Default for SubscriptionCoordinator {
    fn default() -> Self {
        Self {
            recipients: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

impl RecipientMailbox {
    fn new(limits: SnapshotLimits) -> Self {
        let budget = Arc::new(DeliveryBudget::new(limits));
        Self {
            state: Mutex::new(MailboxState {
                queue: VecDeque::new(),
                bytes: 0,
                overflowed: false,
                closed: false,
            }),
            notify: Notify::new(),
            budget,
        }
    }

    fn push(&self, event: CoordinatorEvent) {
        let bytes = coordinator_event_bytes(&event);
        let mut state = self
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if state.closed || state.overflowed {
            return;
        }
        let Some(reservation) = self.budget.reserve(bytes) else {
            state.queue.clear();
            state.bytes = 0;
            state.overflowed = true;
            drop(state);
            self.notify.notify_one();
            return;
        };
        state.bytes = state.bytes.saturating_add(bytes);
        state.queue.push_back((event, reservation));
        drop(state);
        self.notify.notify_one();
    }

    fn close(&self) {
        let mut state = self
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        state.closed = true;
        drop(state);
        self.notify.notify_waiters();
    }
}

impl CoordinatorReceiver {
    pub async fn recv(&self) -> Result<ReceivedCoordinatorEvent, CoordinatorRecvError> {
        loop {
            let notified = self.mailbox.notify.notified();
            match self.try_recv() {
                Err(CoordinatorRecvError::Empty) => notified.await,
                result => return result,
            }
        }
    }

    pub fn try_recv(&self) -> Result<ReceivedCoordinatorEvent, CoordinatorRecvError> {
        let mut state = self
            .mailbox
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if state.overflowed {
            return Err(CoordinatorRecvError::Overflow);
        }
        if let Some((event, reservation)) = state.queue.pop_front() {
            state.bytes = state.bytes.saturating_sub(reservation.bytes);
            return Ok(ReceivedCoordinatorEvent { event, reservation });
        }
        if state.closed {
            Err(CoordinatorRecvError::Closed)
        } else {
            Err(CoordinatorRecvError::Empty)
        }
    }

    #[must_use]
    pub fn queued_usage(&self) -> (usize, usize) {
        let state = self
            .mailbox
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        (state.queue.len(), state.bytes)
    }

    pub(crate) fn budget(&self) -> Arc<DeliveryBudget> {
        self.mailbox.budget.clone()
    }

    #[cfg(test)]
    fn try_recv_event(&self) -> Result<CoordinatorEvent, CoordinatorRecvError> {
        self.try_recv().map(|received| received.into_parts().0)
    }
}

impl ReceivedCoordinatorEvent {
    pub(crate) fn into_parts(self) -> (CoordinatorEvent, DeliveryReservation) {
        (self.event, self.reservation)
    }
}

impl DeliveryBudget {
    pub(crate) fn new(limits: SnapshotLimits) -> Self {
        Self {
            state: Mutex::new(DeliveryBudgetState::default()),
            max_events: limits.queue_max_events as usize,
            max_bytes: limits.queue_max_bytes as usize,
        }
    }

    pub(crate) fn reserve(self: &Arc<Self>, bytes: usize) -> Option<DeliveryReservation> {
        let mut state = self
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let next_bytes = state.bytes.checked_add(bytes)?;
        if state.events >= self.max_events || next_bytes > self.max_bytes {
            return None;
        }
        state.events += 1;
        state.bytes = next_bytes;
        Some(DeliveryReservation {
            budget: self.clone(),
            bytes,
        })
    }

    pub(crate) fn usage(&self) -> (usize, usize) {
        let state = self
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        (state.events, state.bytes)
    }
}

impl DeliveryReservation {
    pub(crate) fn resize(&mut self, bytes: usize) -> Result<(), ()> {
        let mut state = self
            .budget
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if bytes > self.bytes {
            let increase = bytes - self.bytes;
            let next = state.bytes.checked_add(increase).ok_or(())?;
            if next > self.budget.max_bytes {
                return Err(());
            }
            state.bytes = next;
        } else {
            state.bytes = state.bytes.saturating_sub(self.bytes - bytes);
        }
        self.bytes = bytes;
        Ok(())
    }
}

impl Drop for DeliveryReservation {
    fn drop(&mut self) {
        let mut state = self
            .budget
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        state.events = state.events.saturating_sub(1);
        state.bytes = state.bytes.saturating_sub(self.bytes);
    }
}

fn coordinator_event_bytes(event: &CoordinatorEvent) -> usize {
    match event {
        CoordinatorEvent::Change { change, .. } => {
            serde_json::to_vec(change).map_or(usize::MAX, |encoded| encoded.len())
        }
        CoordinatorEvent::RoutingInvalidated { .. } => 1,
    }
}

impl SubscriptionCoordinator {
    #[allow(clippy::needless_pass_by_value)]
    fn dispatch(&self, event: CoordinatorEvent) {
        let recipient_ids = match &event {
            CoordinatorEvent::Change { recipient_ids, .. }
            | CoordinatorEvent::RoutingInvalidated { recipient_ids, .. } => recipient_ids,
        };
        let mailboxes = {
            let recipients = self
                .recipients
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            recipient_ids
                .iter()
                .filter_map(|id| {
                    recipients
                        .get(id)
                        .map(|recipient| recipient.mailbox.clone())
                })
                .collect::<Vec<_>>()
        };
        for mailbox in mailboxes {
            mailbox.push(event.clone());
        }
    }

    pub fn register(
        &self,
        recipient_id: Id,
        generation: u64,
        context: AuthenticatedContextKey,
        intent: OpenIntent,
        limits: SnapshotLimits,
    ) -> CoordinatorReceiver {
        let mailbox = Arc::new(RecipientMailbox::new(limits));
        let recipient = Recipient {
            generation,
            context,
            intent,
            active_membership: Vec::new(),
            archived_membership: Vec::new(),
            mailbox: mailbox.clone(),
        };
        if let Some(previous) = self
            .recipients
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .insert(recipient_id, recipient)
        {
            previous.mailbox.close();
        }
        CoordinatorReceiver { mailbox }
    }

    pub fn set_snapshot_membership(
        &self,
        recipient_id: &Id,
        active: &[ThreadSummary],
        archived: &[ThreadSummary],
    ) {
        if let Some(recipient) = self
            .recipients
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .get_mut(recipient_id)
        {
            recipient.active_membership = active.iter().map(|thread| thread.id.clone()).collect();
            recipient.archived_membership =
                archived.iter().map(|thread| thread.id.clone()).collect();
        }
    }

    pub fn remove(&self, recipient_id: &Id) {
        if let Some(recipient) = self
            .recipients
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .remove(recipient_id)
        {
            recipient.mailbox.close();
        }
    }

    pub fn recipient_intent(&self, recipient_id: &Id) -> Option<OpenIntent> {
        self.recipients
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .get(recipient_id)
            .map(|recipient| recipient.intent.clone())
    }

    pub fn set_current_thread(
        &self,
        recipient_id: &Id,
        current_thread: Option<super::protocol::CurrentThreadIntent>,
    ) -> Option<super::protocol::CurrentThreadIntent> {
        let mut recipients = self
            .recipients
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let recipient = recipients.get_mut(recipient_id)?;
        std::mem::replace(&mut recipient.intent.current_thread, current_thread)
    }

    pub fn current_thread_recipient_count(&self, thread_id: &Id, generation: u64) -> usize {
        self.recipients
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .values()
            .filter(|recipient| {
                recipient.generation == generation
                    && recipient
                        .intent
                        .current_thread
                        .as_ref()
                        .is_some_and(|current| &current.thread_id == thread_id)
            })
            .count()
    }

    #[allow(clippy::needless_pass_by_value)]
    pub fn publish(&self, generation: u64, selector: AudienceSelector, change: ProjectionChange) {
        let recipients = self
            .recipients
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let matching = recipients
            .iter()
            .filter_map(|(id, recipient)| {
                if recipient.generation != generation {
                    return None;
                }
                let allowed = match &selector {
                    AudienceSelector::ExactContext(context) => &recipient.context == context,
                    AudienceSelector::CurrentThread { context, thread_id } => {
                        &recipient.context == context
                            && recipient
                                .intent
                                .current_thread
                                .as_ref()
                                .is_some_and(|current| &current.thread_id == thread_id)
                    }
                    AudienceSelector::CatalogPartition { context, archived } => {
                        if &recipient.context != context {
                            return None;
                        }
                        if *archived {
                            recipient.archived_membership.iter().any(|id| {
                                projection_thread_id(&change)
                                    .is_some_and(|thread_id| thread_id == id)
                            })
                        } else {
                            recipient.active_membership.iter().any(|id| {
                                projection_thread_id(&change)
                                    .is_some_and(|thread_id| thread_id == id)
                            })
                        }
                    }
                    AudienceSelector::Ambiguous => false,
                };
                allowed.then(|| id.clone())
            })
            .collect::<HashSet<_>>();
        if matches!(selector, AudienceSelector::Ambiguous) {
            let affected = recipients
                .iter()
                .filter(|(_, recipient)| recipient.generation == generation)
                .map(|(id, _)| id.clone())
                .collect();
            drop(recipients);
            self.dispatch(CoordinatorEvent::RoutingInvalidated {
                generation,
                recipient_ids: Arc::new(affected),
                reason: SourceInvalidationReason::SourceGap,
            });
            return;
        }
        drop(recipients);
        if !matching.is_empty() {
            self.dispatch(CoordinatorEvent::Change {
                generation,
                recipient_ids: Arc::new(matching),
                change,
            });
        }
    }

    pub fn contexts(&self, generation: u64) -> HashSet<AuthenticatedContextKey> {
        self.recipients
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .values()
            .filter(|recipient| recipient.generation == generation)
            .map(|recipient| recipient.context.clone())
            .collect()
    }

    pub fn publish_catalog_upsert(
        &self,
        generation: u64,
        context: &AuthenticatedContextKey,
        thread: ThreadSummary,
    ) {
        let archived = thread.archived;
        let mut recipients = self
            .recipients
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let mut upsert = HashSet::new();
        let mut exits: HashMap<Id, HashSet<Id>> = HashMap::new();
        for (recipient_id, recipient) in recipients.iter_mut().filter(|(_, recipient)| {
            recipient.generation == generation && &recipient.context == context
        }) {
            let current = recipient
                .intent
                .current_thread
                .as_ref()
                .is_some_and(|current| current.thread_id == thread.id);
            let (target, opposite, limit) = if archived {
                (
                    &mut recipient.archived_membership,
                    &mut recipient.active_membership,
                    recipient.intent.catalog.archived_limit,
                )
            } else {
                (
                    &mut recipient.active_membership,
                    &mut recipient.archived_membership,
                    recipient.intent.catalog.active_limit,
                )
            };
            let was_in_opposite = opposite.iter().any(|candidate| candidate == &thread.id);
            opposite.retain(|candidate| candidate != &thread.id);
            let existing = target.iter().any(|candidate| candidate == &thread.id);
            if existing || current {
                upsert.insert(recipient_id.clone());
            } else if limit > 0 {
                target.insert(0, thread.id.clone());
                upsert.insert(recipient_id.clone());
                if target.len() > limit as usize
                    && let Some(evicted) = target.pop()
                {
                    exits
                        .entry(evicted)
                        .or_default()
                        .insert(recipient_id.clone());
                }
            } else if was_in_opposite {
                exits
                    .entry(thread.id.clone())
                    .or_default()
                    .insert(recipient_id.clone());
            }
        }
        drop(recipients);
        if !upsert.is_empty() {
            self.dispatch(CoordinatorEvent::Change {
                generation,
                recipient_ids: Arc::new(upsert),
                change: ProjectionChange::ThreadUpserted { thread },
            });
        }
        for (thread_id, recipient_ids) in exits {
            self.dispatch(CoordinatorEvent::Change {
                generation,
                recipient_ids: Arc::new(recipient_ids),
                change: ProjectionChange::ThreadRemoved {
                    thread_id,
                    reason: RemovalReason::OutsideScope,
                },
            });
        }
    }

    pub fn publish_thread_removed(
        &self,
        generation: u64,
        context: &AuthenticatedContextKey,
        thread_id: Id,
        reason: RemovalReason,
    ) {
        let mut recipients = self
            .recipients
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let matching = recipients
            .iter_mut()
            .filter_map(|(recipient_id, recipient)| {
                if recipient.generation != generation || &recipient.context != context {
                    return None;
                }
                let current = recipient
                    .intent
                    .current_thread
                    .as_ref()
                    .is_some_and(|current| current.thread_id == thread_id);
                let before =
                    recipient.active_membership.len() + recipient.archived_membership.len();
                recipient
                    .active_membership
                    .retain(|candidate| candidate != &thread_id);
                recipient
                    .archived_membership
                    .retain(|candidate| candidate != &thread_id);
                (current
                    || before
                        != recipient.active_membership.len() + recipient.archived_membership.len())
                .then(|| recipient_id.clone())
            })
            .collect::<HashSet<_>>();
        drop(recipients);
        if !matching.is_empty() {
            self.dispatch(CoordinatorEvent::Change {
                generation,
                recipient_ids: Arc::new(matching),
                change: ProjectionChange::ThreadRemoved { thread_id, reason },
            });
        }
    }

    pub fn invalidate_generation(&self, generation: u64) {
        self.invalidate_generation_for(generation, SourceInvalidationReason::SourceGap);
    }

    pub fn invalidate_generation_for(&self, generation: u64, reason: SourceInvalidationReason) {
        let recipients = self
            .recipients
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .iter()
            .filter(|(_, recipient)| recipient.generation == generation)
            .map(|(id, _)| id.clone())
            .collect::<HashSet<_>>();
        if !recipients.is_empty() {
            self.dispatch(CoordinatorEvent::RoutingInvalidated {
                generation,
                recipient_ids: Arc::new(recipients),
                reason,
            });
        }
    }

    pub fn invalidate_context(&self, context: &AuthenticatedContextKey) {
        let recipient_ids = self
            .recipients
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .iter()
            .filter(|(_, recipient)| &recipient.context == context)
            .map(|(id, _)| id.clone())
            .collect::<HashSet<_>>();
        if !recipient_ids.is_empty() {
            self.dispatch(CoordinatorEvent::RoutingInvalidated {
                generation: 0,
                recipient_ids: Arc::new(recipient_ids.clone()),
                reason: SourceInvalidationReason::SourceGap,
            });
        }
        for recipient_id in recipient_ids {
            self.remove(&recipient_id);
        }
    }
}

fn projection_thread_id(change: &ProjectionChange) -> Option<&Id> {
    match change {
        ProjectionChange::ThreadUpserted { thread } => Some(&thread.id),
        ProjectionChange::ThreadRemoved { thread_id, .. }
        | ProjectionChange::ResourcesChanged { thread_id, .. } => Some(thread_id),
        ProjectionChange::CurrentThreadReplaced { current_thread, .. } => {
            Some(&current_thread.thread.id)
        }
        ProjectionChange::TurnUpserted { turn } => Some(&turn.thread_id),
        ProjectionChange::PendingRequestOpened { request } => match request {
            PendingRequest::Approval { thread_id, .. }
            | PendingRequest::UserInput { thread_id, .. } => Some(thread_id),
            PendingRequest::Elicitation { thread_id, .. } => thread_id.as_ref(),
        },
        ProjectionChange::QueueChanged { thread_id, .. } => thread_id.as_ref(),
        ProjectionChange::PendingRequestClosed { .. }
        | ProjectionChange::AccountsChanged { .. } => None,
    }
}

#[async_trait]
pub trait SemanticSource: Send + Sync {
    fn generation(&self) -> u64;
    fn subscribe_generation(&self) -> watch::Receiver<u64>;
    fn coordinator(&self) -> &SubscriptionCoordinator;

    fn is_available(&self) -> bool {
        true
    }

    async fn wait_until_available(&self) -> Result<(), V2Error> {
        Ok(())
    }

    async fn purge_context(&self, context: &AuthenticatedContextKey) -> Result<(), V2Error>;

    async fn install_intent(
        &self,
        recipient_id: &Id,
        intent: &OpenIntent,
        authorization: &AuthorizationContext,
        context: &AuthenticatedContextKey,
        generation: u64,
    ) -> Result<(), V2Error>;
    async fn remove_intent(&self, recipient_id: &Id);
    async fn watch_thread(
        &self,
        _recipient_id: &Id,
        _thread: &super::protocol::CurrentThreadIntent,
        _authorization: &AuthorizationContext,
        _context: &AuthenticatedContextKey,
        _generation: u64,
    ) -> Result<WatchedThreadData, V2Error> {
        Err(V2Error::invalid_query())
    }
    async fn snapshot(
        &self,
        intent: &OpenIntent,
        authorization: &AuthorizationContext,
        context: &AuthenticatedContextKey,
        generation: u64,
    ) -> Result<SnapshotData, V2Error>;
    async fn query(
        &self,
        query: Query,
        authorization: &AuthorizationContext,
        context: &AuthenticatedContextKey,
        generation: u64,
    ) -> Result<QueryResult, V2Error>;
    async fn authorize_command(
        &self,
        command: &Command,
        authorization: &AuthorizationContext,
        context: &AuthenticatedContextKey,
        generation: u64,
    ) -> Result<(), V2Error>;
    async fn execute(
        &self,
        operation_id: &OperationId,
        command: Command,
        authorization: &AuthorizationContext,
        context: &AuthenticatedContextKey,
        generation: u64,
    ) -> CommandExecution;
    async fn resolve(
        &self,
        action: Action,
        authorization: &AuthorizationContext,
        context: &AuthenticatedContextKey,
        generation: u64,
    ) -> Result<ActionResult, V2Error>;
}

pub fn ensure_generation(source: &dyn SemanticSource, expected: u64) -> Result<(), V2Error> {
    (source.generation() == expected)
        .then_some(())
        .ok_or_else(V2Error::generation_changed)
}

pub fn capabilities(limits: SnapshotLimits) -> QueryResult {
    QueryResult::CapabilitiesRead {
        commands: super::protocol::COMMAND_KINDS
            .iter()
            .filter(|kind| **kind != "account.update")
            .map(ToString::to_string)
            .collect(),
        queries: super::protocol::QUERY_KINDS
            .iter()
            .filter(|kind| **kind != "accounts.list")
            .map(ToString::to_string)
            .collect(),
        actions: super::protocol::ACTION_KINDS
            .iter()
            .map(ToString::to_string)
            .collect(),
        limits,
    }
}

#[cfg(test)]
mod tests;
