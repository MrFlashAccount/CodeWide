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
//! - Claude's resume prompt starts a user turn without a prompt, unless the
//!   turn index knows it as a resent first offer inside the current turn;
//! - an interrupt marker ends the current turn as interrupted; a turn that
//!   only wakes opened ends at the marker (its id and fork end), so a wake
//!   interrupted before any message stays a turn;
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

/// What an entry is, as far as turn boundaries go.
#[derive(Clone, Copy, Debug, Eq, PartialEq, serde::Deserialize, serde::Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum EntryKind {
    Prompt { queued: bool },
    Wake { queued: bool },
    Resume,
    Interrupt,
    Compaction,
    Frame,
}

impl HistoryEntry {
    /// What the entry is for turn boundaries.
    #[must_use]
    pub const fn kind(&self) -> EntryKind {
        match self {
            Self::Prompt { queued, .. } => EntryKind::Prompt { queued: *queued },
            Self::Wake { queued, .. } => EntryKind::Wake { queued: *queued },
            Self::Resume { .. } => EntryKind::Resume,
            Self::Interrupt { .. } => EntryKind::Interrupt,
            Self::Compaction { .. } => EntryKind::Compaction,
            Self::Frame { .. } => EntryKind::Frame,
        }
    }
}

/// The turn open before an entry, as far as boundaries go.
#[derive(Clone, Debug, Default, Eq, PartialEq, serde::Deserialize, serde::Serialize)]
#[serde(tag = "open", rename_all = "camelCase")]
pub enum OpenView {
    /// No turn is open (none yet, or an interrupt ended it).
    #[default]
    None,
    /// Wakes opened a turn that has no message yet.
    Pending,
    /// A turn with messages is open.
    #[serde(rename_all = "camelCase")]
    Turn {
        /// Uuid of its first entry.
        first_uuid: String,
        /// Every entry is a prompt the index knows as a continuation.
        only_continuations: bool,
    },
}

impl OpenView {
    /// The view after `entry` joined this open turn (or started one).
    #[must_use]
    pub fn with_entry(self, kind: EntryKind, uuid: &str, hints: &SegmentHints) -> Self {
        let continuation =
            matches!(kind, EntryKind::Prompt { .. }) && hints.continuations.contains(uuid);
        match self {
            Self::Turn {
                first_uuid,
                only_continuations,
            } => Self::Turn {
                first_uuid,
                only_continuations: only_continuations && continuation,
            },
            Self::None | Self::Pending => Self::Turn {
                first_uuid: uuid.to_owned(),
                only_continuations: continuation,
            },
        }
    }
}

/// What one entry does to the turns.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Step {
    /// Starts a turn of this origin with the entry; a turn waiting with
    /// wakes only hands their reports to it.
    Start(TurnOrigin),
    /// Joins the open turn (a waiting one included); with none open, starts
    /// a turn of this origin.
    Append(TurnOrigin),
    /// A report delivered into the open turn at the entry's position.
    MidTurnReport,
    /// Adds the wake's reports to the turn waiting with wakes only.
    CollectWake,
    /// Opens a turn that waits, with the wake's reports, for its first message.
    NewPending,
    /// Ends the open turn as interrupted.
    Interrupt,
}

/// The one boundary rule: what `entry` does after `open`. History reads and
/// the incremental index both apply it, so they cannot disagree.
#[must_use]
pub fn decide(open: &OpenView, kind: EntryKind, uuid: &str, hints: &SegmentHints) -> Step {
    // The open turn already holds `uuid` first, or holds only prompts the
    // index knows as continuations: a steer delivered into a turn before its
    // first message (a wake turn steered before the model answered)
    // precedes that turn's indexed first message, which then continues the
    // turn instead of starting another with the same record.
    let opens_with_own_prompts = matches!(open, OpenView::Turn { first_uuid, only_continuations }
        if first_uuid == uuid || *only_continuations);
    if let Some(origin) = hints.starts.get(uuid).copied()
        && !opens_with_own_prompts
    {
        return Step::Start(origin);
    }
    match kind {
        EntryKind::Prompt { queued } => {
            if hints.continuations.contains(uuid) || (queued && *open != OpenView::None) {
                Step::Append(TurnOrigin::User)
            } else {
                Step::Start(TurnOrigin::User)
            }
        }
        EntryKind::Wake { queued } => match open {
            OpenView::Turn { .. } if queued => Step::MidTurnReport,
            OpenView::Pending => Step::CollectWake,
            OpenView::None | OpenView::Turn { .. } => Step::NewPending,
        },
        EntryKind::Resume => {
            if hints.continuations.contains(uuid) {
                Step::Append(TurnOrigin::User)
            } else {
                Step::Start(TurnOrigin::User)
            }
        }
        EntryKind::Interrupt => Step::Interrupt,
        EntryKind::Compaction | EntryKind::Frame => Step::Append(TurnOrigin::Provider),
    }
}

struct Segmenter<'a> {
    segments: Vec<HistorySegment>,
    /// Index of the open segment in `segments`.
    open: Option<usize>,
    /// The turn open before the first entry when it is not one of
    /// `segments` (a read that starts inside a history): it takes no entry.
    prior: OpenView,
    hints: &'a SegmentHints,
}

impl Segmenter<'_> {
    fn view(&self) -> OpenView {
        let Some(index) = self.open else {
            return self.prior.clone();
        };
        let entries = &self.segments[index].entries;
        let Some(first) = entries.first() else {
            return OpenView::Pending;
        };
        OpenView::Turn {
            first_uuid: first.uuid().to_owned(),
            only_continuations: entries.iter().all(|entry| {
                matches!(entry, HistoryEntry::Prompt { .. })
                    && self.hints.continuations.contains(entry.uuid())
            }),
        }
    }

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
        self.prior = OpenView::None;
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

    fn add(&mut self, entry: HistoryEntry) {
        let step = decide(&self.view(), entry.kind(), entry.uuid(), self.hints);
        match step {
            Step::Start(origin) => {
                self.start(origin, Some(entry));
            }
            Step::Append(origin) => match self.open {
                Some(index) => self.segments[index].entries.push(entry),
                // The prior turn is not this read's: it takes nothing.
                None if self.prior != OpenView::None => {}
                None => {
                    self.start(origin, Some(entry));
                }
            },
            Step::MidTurnReport => {
                let HistoryEntry::Wake { reports, .. } = entry else {
                    return;
                };
                let Some(index) = self.open else {
                    return;
                };
                let segment = &mut self.segments[index];
                let position = segment.entries.len();
                segment
                    .reports
                    .extend(reports.into_iter().map(|report| SegmentReport {
                        delivery: TaskNotificationDelivery::MidTurn,
                        report,
                        position,
                    }));
            }
            Step::CollectWake | Step::NewPending => {
                let HistoryEntry::Wake { reports, .. } = entry else {
                    return;
                };
                let woken = match (step, self.open_without_messages()) {
                    (Step::CollectWake, Some(index)) => index,
                    _ => self.start(TurnOrigin::Provider, None),
                };
                self.segments[woken]
                    .reports
                    .extend(reports.into_iter().map(|report| SegmentReport {
                        delivery: TaskNotificationDelivery::Wake,
                        report,
                        position: 0,
                    }));
            }
            // An interrupt marker ends the open turn as interrupted. A turn
            // woken but interrupted before any message of its own ends at
            // the marker, which becomes its only entry: live, that turn ran
            // (its wake reports lead it) until the interrupt, so history
            // keeps it, with its reports, as an interrupted provider turn
            // instead of dropping it.
            Step::Interrupt => {
                self.prior = OpenView::None;
                if let Some(index) = self.open.take() {
                    let segment = &mut self.segments[index];
                    segment.interrupted = true;
                    if segment.entries.is_empty() {
                        segment.entries.push(entry);
                    }
                }
            }
        }
    }
}

/// Splits entries into turn segments.
#[must_use]
pub fn history_segments(entries: Vec<HistoryEntry>, hints: &SegmentHints) -> Vec<HistorySegment> {
    history_segments_after(entries, hints, OpenView::None)
}

/// Splits entries that follow a turn open as `prior` into turn segments;
/// the prior turn takes none of them (they start where a turn starts).
#[must_use]
pub fn history_segments_after(
    entries: Vec<HistoryEntry>,
    hints: &SegmentHints,
    prior: OpenView,
) -> Vec<HistorySegment> {
    let mut segmenter = Segmenter {
        segments: Vec::new(),
        open: None,
        prior,
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
