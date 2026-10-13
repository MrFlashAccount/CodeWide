//! Groups classified history entries into turns. Claude's store has no
//! explicit turn boundaries, so they are derived:
//! - the first persisted message of a turn the companion drove starts that
//!   turn (the turn index knows it);
//! - a prompt starts a user turn, unless the turn index knows it as a steer
//!   or a resent first prompt inside the current turn, or Claude queued it
//!   while a turn ran (a prompt typed while the agent was busy);
//! - a wake message starts a provider turn, unless Claude queued it while a
//!   turn ran (a notification delivered into the running turn);
//! - an interrupt marker ends the current turn as interrupted;
//! - an agent frame or a compaction with no open turn starts a provider turn
//!   (for example, a background task finishing after the turn ended).
//!
//! Pure; no I/O.

use std::collections::{HashMap, HashSet};

use agent_core::model::TurnOrigin;

use super::entries::HistoryEntry;

#[derive(Debug)]
pub struct HistorySegment {
    /// Entries of the turn in order; a user turn starts with its prompt.
    pub entries: Vec<HistoryEntry>,
    /// Ended by an interrupt marker.
    pub interrupted: bool,
    pub origin: TurnOrigin,
}

/// What the turn index tells the segmentation.
#[derive(Debug, Default)]
pub struct SegmentHints {
    /// Prompts that continue the open turn (steers, a first prompt resent to a new session).
    pub continuations: HashSet<String>,
    /// First persisted message of each companion-driven turn, with the turn's origin.
    pub starts: HashMap<String, TurnOrigin>,
}

struct Segmenter<'a> {
    segments: Vec<HistorySegment>,
    /// Index of the open segment in `segments`.
    open: Option<usize>,
    hints: &'a SegmentHints,
}

impl Segmenter<'_> {
    fn start(&mut self, origin: TurnOrigin, first: Option<HistoryEntry>) {
        self.segments.push(HistorySegment {
            entries: first.into_iter().collect(),
            interrupted: false,
            origin,
        });
        self.open = Some(self.segments.len() - 1);
    }

    /// Appends to the open turn, or starts a turn of `origin` with the entry.
    fn append(&mut self, entry: HistoryEntry, origin: TurnOrigin) {
        match self.open {
            Some(index) => self.segments[index].entries.push(entry),
            None => self.start(origin, Some(entry)),
        }
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
            HistoryEntry::Wake { queued, .. } => {
                if !queued || self.open.is_none() {
                    self.start(TurnOrigin::Provider, None);
                }
            }
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
