//! Groups classified history entries into turns. Claude's store has no
//! explicit turn boundaries, so they are derived:
//! - the first persisted message of a turn the companion drove starts that
//!   turn (the turn index knows it);
//! - a prompt starts a user turn, unless the turn index knows it as a steer
//!   or a resent first prompt inside the current turn, or Claude queued it
//!   while a turn ran (a prompt typed while the agent was busy);
//! - a wake message starts a provider turn, unless Claude queued it while a
//!   turn ran (a notification delivered into the running turn); consecutive
//!   wakes before the turn's first message start one turn;
//! - an interrupt marker ends the current turn as interrupted;
//! - an agent frame or a compaction with no open turn starts a provider turn
//!   (for example, a background task finishing after the turn ended).
//!
//! Background task reports are kept beside the entries, never in them, so a
//! turn's id, start anchor and last stored message are those of its own
//! messages whether or not reports woke it or arrived during it:
//! - the reports of the wakes that start a provider turn lead it (`wake`);
//! - wakes buffered before a turn that a prompt or an indexed user turn
//!   starts were delivered inside that turn (`midTurn`, after its prompt);
//! - a report Claude queued into a running turn sits at its position there
//!   (`midTurn`).
//!
//! Pure; no I/O.

use std::collections::{HashMap, HashSet};

use agent_core::model::{TaskNotificationDelivery, TurnOrigin};

use super::{entries::HistoryEntry, task_reports::TaskReport};

/// A background task report delivered in a turn.
#[derive(Clone, Debug, PartialEq)]
pub struct SegmentReport {
    pub delivery: TaskNotificationDelivery,
    pub report: TaskReport,
    /// Index of the entry the report precedes; `entries.len()` after the last.
    pub position: usize,
}

#[derive(Debug)]
pub struct HistorySegment {
    /// Entries of the turn in order; a user turn starts with its prompt.
    pub entries: Vec<HistoryEntry>,
    /// Ended by an interrupt marker.
    pub interrupted: bool,
    pub origin: TurnOrigin,
    /// Task reports delivered in the turn, ordered by position.
    pub reports: Vec<SegmentReport>,
}

/// What the turn index tells the segmentation.
#[derive(Debug, Default)]
pub struct SegmentHints {
    /// Prompts that continue the open turn (steers, a first prompt resent to a new session).
    pub continuations: HashSet<String>,
    /// First persisted message of each companion-driven turn, with the turn's origin.
    pub starts: HashMap<String, TurnOrigin>,
}

/// Where the prompt of a user turn ends: reports carried into it follow it.
const AFTER_PROMPT: usize = 1;

struct Segmenter<'a> {
    segments: Vec<HistorySegment>,
    /// Index of the open segment in `segments`.
    open: Option<usize>,
    hints: &'a SegmentHints,
}

impl Segmenter<'_> {
    /// The open segment while it has no message yet (wakes collect in it).
    fn open_without_messages(&self) -> Option<usize> {
        self.open
            .filter(|index| self.segments[*index].entries.is_empty())
    }

    /// Wake reports of a turn that has no message yet, as the turn that does
    /// start delivers them: a provider turn is woken by them; a user turn got
    /// them after its prompt.
    fn carried(&mut self, origin: TurnOrigin) -> Vec<SegmentReport> {
        let Some(previous) = self.open_without_messages() else {
            return Vec::new();
        };
        let reports = std::mem::take(&mut self.segments[previous].reports);
        match origin {
            TurnOrigin::Provider => reports,
            TurnOrigin::User => reports
                .into_iter()
                .map(|report| SegmentReport {
                    delivery: TaskNotificationDelivery::MidTurn,
                    position: AFTER_PROMPT,
                    ..report
                })
                .collect(),
        }
    }

    fn start(&mut self, origin: TurnOrigin, first: Option<HistoryEntry>) -> usize {
        let reports = self.carried(origin);
        self.segments.push(HistorySegment {
            entries: first.into_iter().collect(),
            interrupted: false,
            origin,
            reports,
        });
        let index = self.segments.len() - 1;
        self.open = Some(index);
        index
    }

    /// Appends to the open turn, or starts a turn of `origin` with the entry.
    fn append(&mut self, entry: HistoryEntry, origin: TurnOrigin) {
        match self.open {
            Some(index) => self.segments[index].entries.push(entry),
            None => {
                self.start(origin, Some(entry));
            }
        }
    }

    /// A wake starts a provider turn unless Claude delivered it into a
    /// running turn; a turn that has no message yet keeps collecting wakes.
    fn wake(&mut self, queued: bool, reports: Vec<TaskReport>) {
        if queued
            && let Some(index) = self.open
            && !self.segments[index].entries.is_empty()
        {
            let segment = &mut self.segments[index];
            let position = segment.entries.len();
            segment
                .reports
                .extend(reports.into_iter().map(|report| SegmentReport {
                    delivery: TaskNotificationDelivery::MidTurn,
                    report,
                    position,
                }));
            return;
        }
        let woken = match self.open_without_messages() {
            Some(index) => index,
            None => self.start(TurnOrigin::Provider, None),
        };
        self.segments[woken]
            .reports
            .extend(reports.into_iter().map(|report| SegmentReport {
                delivery: TaskNotificationDelivery::Wake,
                report,
                position: 0,
            }));
    }

    fn add(&mut self, entry: HistoryEntry) {
        let uuid = entry.uuid().to_owned();
        if let Some(indexed_start) = self.hints.starts.get(&uuid).copied() {
            let already_first = self
                .open
                .and_then(|index| self.segments[index].entries.first())
                .is_some_and(|first| first.uuid() == uuid);
            if !already_first {
                self.start(indexed_start, Some(entry));
                return;
            }
        }
        match entry {
            HistoryEntry::Prompt { queued, .. } => {
                if self.hints.continuations.contains(&uuid) || (queued && self.open.is_some()) {
                    self.append(entry, TurnOrigin::User);
                } else {
                    self.start(TurnOrigin::User, Some(entry));
                }
            }
            HistoryEntry::Wake {
                queued, reports, ..
            } => self.wake(queued, reports),
            HistoryEntry::Interrupt { .. } => {
                if let Some(index) = self.open.take() {
                    self.segments[index].interrupted = true;
                }
            }
            HistoryEntry::Compaction { .. } | HistoryEntry::Frame { .. } => {
                self.append(entry, TurnOrigin::Provider);
            }
        }
    }
}

/// Splits entries into turn segments.
#[must_use]
pub fn history_segments(entries: Vec<HistoryEntry>, hints: &SegmentHints) -> Vec<HistorySegment> {
    let mut segmenter = Segmenter {
        segments: Vec::new(),
        open: None,
        hints,
    };
    for entry in entries {
        segmenter.add(entry);
    }
    segmenter
        .segments
        .into_iter()
        .filter(|segment| !segment.entries.is_empty())
        .collect()
}
