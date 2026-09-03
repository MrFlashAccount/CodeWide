//! Per-connection epoch state and ephemeral snapshot-to-live barrier queue.

use std::{collections::VecDeque, sync::Arc};

use super::{
    domain::{ProjectionChange, SequencedChange},
    protocol::OpenIntent,
    scalar::{Id, U64},
    source::{DeliveryBudget, DeliveryReservation},
};

#[cfg(test)]
use super::domain::SnapshotLimits;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum EpochPhase {
    WaitingOpen,
    Initializing,
    AwaitingCommit,
    Draining,
    Live,
    Closed,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CommitTuple {
    pub epoch_id: Id,
    pub revision: String,
    pub watermark: U64,
}

#[derive(Debug)]
pub struct ConnectionEpoch {
    pub id: Id,
    pub generation: u64,
    pub phase: EpochPhase,
    pub intent: OpenIntent,
    pub watermark: u64,
    queue: VecDeque<QueuedChange>,
    queue_bytes: usize,
    snapshot_reservations: Vec<DeliveryReservation>,
    budget: Arc<DeliveryBudget>,
    commit: Option<CommitTuple>,
}

#[derive(Debug)]
struct QueuedChange {
    sequenced: SequencedChange,
    bytes: usize,
    reservation: DeliveryReservation,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum QueueError {
    Overflow,
    Serialization,
}

impl ConnectionEpoch {
    #[cfg(test)]
    pub fn new(id: Id, generation: u64, intent: OpenIntent, limits: SnapshotLimits) -> Self {
        Self::new_with_budget(
            id,
            generation,
            intent,
            Arc::new(DeliveryBudget::new(limits)),
        )
    }

    pub(crate) fn new_with_budget(
        id: Id,
        generation: u64,
        intent: OpenIntent,
        budget: Arc<DeliveryBudget>,
    ) -> Self {
        Self {
            id,
            generation,
            phase: EpochPhase::WaitingOpen,
            intent,
            watermark: 0,
            queue: VecDeque::new(),
            queue_bytes: 0,
            snapshot_reservations: Vec::new(),
            budget,
            commit: None,
        }
    }

    pub fn begin_initializing(&mut self) {
        debug_assert_eq!(self.phase, EpochPhase::WaitingOpen);
        self.phase = EpochPhase::Initializing;
    }

    #[cfg(test)]
    pub fn enqueue(&mut self, change: ProjectionChange) -> Result<U64, QueueError> {
        self.enqueue_local(change)
    }

    pub(crate) fn enqueue_local(&mut self, change: ProjectionChange) -> Result<U64, QueueError> {
        let bytes = serde_json::to_vec(&change)
            .map_err(|_| QueueError::Serialization)?
            .len();
        let reservation = self.budget.reserve(bytes).ok_or(QueueError::Overflow)?;
        self.enqueue_reserved(change, reservation)
    }

    pub(crate) fn enqueue_reserved(
        &mut self,
        change: ProjectionChange,
        mut reservation: DeliveryReservation,
    ) -> Result<U64, QueueError> {
        let watermark = self.watermark.checked_add(1).ok_or(QueueError::Overflow)?;
        let sequenced = SequencedChange {
            watermark: U64::new(watermark),
            change,
        };
        let bytes = serde_json::to_vec(&sequenced)
            .map_err(|_| QueueError::Serialization)?
            .len();
        reservation
            .resize(bytes)
            .map_err(|()| QueueError::Overflow)?;
        self.watermark = watermark;
        self.queue_bytes = self.queue_bytes.saturating_add(bytes);
        self.queue.push_back(QueuedChange {
            sequenced,
            bytes,
            reservation,
        });
        Ok(U64::new(watermark))
    }

    pub fn cut_snapshot(&mut self, revision: String) -> (CommitTuple, Vec<SequencedChange>) {
        let included_tail = self.drain_queue();
        let commit = CommitTuple {
            epoch_id: self.id.clone(),
            revision,
            watermark: U64::new(self.watermark),
        };
        self.commit = Some(commit.clone());
        self.phase = EpochPhase::AwaitingCommit;
        (commit, included_tail)
    }

    #[must_use]
    pub fn validates_commit(&self, epoch_id: &Id, revision: &str, watermark: U64) -> bool {
        self.phase == EpochPhase::AwaitingCommit
            && self.commit.as_ref().is_some_and(|commit| {
                &commit.epoch_id == epoch_id
                    && commit.revision == revision
                    && commit.watermark == watermark
            })
    }

    pub fn begin_drain(&mut self) {
        self.phase = EpochPhase::Draining;
    }

    pub fn next_queued_change(&self) -> Option<SequencedChange> {
        self.queue.front().map(|entry| entry.sequenced.clone())
    }

    pub fn confirm_queued_change(&mut self) -> Option<SequencedChange> {
        let entry = self.queue.pop_front()?;
        self.queue_bytes = self.queue_bytes.saturating_sub(entry.bytes);
        Some(entry.sequenced)
    }

    pub fn enter_live(&mut self) {
        self.phase = EpochPhase::Live;
    }

    pub fn close(&mut self) {
        self.phase = EpochPhase::Closed;
        self.queue.clear();
        self.queue_bytes = 0;
        self.snapshot_reservations.clear();
        self.commit = None;
    }

    fn drain_queue(&mut self) -> Vec<SequencedChange> {
        let mut drained = Vec::with_capacity(self.queue.len());
        while let Some(entry) = self.queue.pop_front() {
            self.queue_bytes = self.queue_bytes.saturating_sub(entry.bytes);
            self.snapshot_reservations.push(entry.reservation);
            drained.push(entry.sequenced);
        }
        drained
    }

    #[must_use]
    pub fn queued_usage(&self) -> (usize, usize) {
        self.budget.usage()
    }

    pub fn confirm_snapshot_sent(&mut self) {
        self.snapshot_reservations.clear();
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;
    use crate::sync_v2::{
        domain::{ProjectionChange, SnapshotLimits},
        protocol::{CatalogIntent, CurrentThreadIntent, PendingRequestScope},
    };

    fn intent(thread_id: &str) -> OpenIntent {
        OpenIntent {
            catalog: CatalogIntent {
                active_limit: 1,
                archived_limit: 0,
            },
            current_thread: Some(CurrentThreadIntent {
                thread_id: Id::new(thread_id).unwrap(),
                turn_limit: 1,
            }),
            pending_requests: PendingRequestScope::CurrentThread,
        }
    }

    #[test]
    fn commit_tuple_and_queue_are_private_to_each_epoch() {
        let limits = SnapshotLimits {
            queue_max_events: 2,
            queue_max_bytes: 1_024,
            ..SnapshotLimits::default()
        };
        let mut first = ConnectionEpoch::new(Id::new("epoch-a").unwrap(), 7, intent("a"), limits);
        let mut second = ConnectionEpoch::new(Id::new("epoch-b").unwrap(), 7, intent("b"), limits);
        first.begin_initializing();
        second.begin_initializing();
        first
            .enqueue(ProjectionChange::AccountsChanged {
                revision: "one".into(),
            })
            .unwrap();
        let (commit, tail) = first.cut_snapshot("sync-v2-revision:a".into());
        assert_eq!(tail.len(), 1);
        assert!(first.validates_commit(&commit.epoch_id, &commit.revision, commit.watermark));
        assert!(!second.validates_commit(&commit.epoch_id, &commit.revision, commit.watermark));
        assert_eq!(second.queued_usage(), (0, 0));
    }

    #[test]
    fn event_and_byte_limits_fail_closed_without_advancing_watermark() {
        let limits = SnapshotLimits {
            queue_max_events: 1,
            queue_max_bytes: 1_024,
            ..SnapshotLimits::default()
        };
        let mut epoch =
            ConnectionEpoch::new(Id::new("epoch").unwrap(), 1, intent("thread"), limits);
        epoch.begin_initializing();
        epoch
            .enqueue(ProjectionChange::AccountsChanged {
                revision: "one".into(),
            })
            .unwrap();
        assert_eq!(
            epoch.enqueue(ProjectionChange::AccountsChanged {
                revision: "two".into(),
            }),
            Err(QueueError::Overflow)
        );
        assert_eq!(epoch.watermark, 1);
        assert_eq!(epoch.queued_usage().0, 1);
    }

    #[test]
    fn queued_delivery_stays_accounted_until_send_is_confirmed() {
        let limits = SnapshotLimits {
            queue_max_events: 2,
            queue_max_bytes: 1_024,
            ..SnapshotLimits::default()
        };
        let mut epoch =
            ConnectionEpoch::new(Id::new("epoch").unwrap(), 1, intent("thread"), limits);
        epoch.begin_initializing();
        epoch
            .enqueue(ProjectionChange::AccountsChanged {
                revision: "one".into(),
            })
            .unwrap();
        let usage_before_send = epoch.queued_usage();

        epoch.begin_drain();
        assert!(epoch.next_queued_change().is_some());
        assert_eq!(epoch.queued_usage(), usage_before_send);

        assert!(epoch.confirm_queued_change().is_some());
        assert_eq!(epoch.queued_usage(), (0, 0));
    }
}
