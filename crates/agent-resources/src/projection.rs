//! A thread's resource projection: the immutable resources of each finished
//! turn and the pending resources of the active turn, in history order.

use std::{
    collections::{BTreeMap, VecDeque},
    path::PathBuf,
};

use agent_core::model::{AgentTurn, TurnStatus};
use serde::{Deserialize, Serialize};

use crate::data::{PatchBucket, ResourceData, TurnResourceData};

/// Completed turn ids remembered for evicting their live overlays.
pub const RECENT_COMPLETED_TURNS: usize = 256;

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub struct ResourceProjection {
    pub cwd: Option<PathBuf>,
    pub active_turn_id: Option<String>,
    #[serde(default)]
    pub pending_data: ResourceData,
    #[serde(default)]
    pub turns: Vec<TurnResourceData>,
    pub recent_completed_turns: VecDeque<String>,
}

impl AsRef<Self> for ResourceProjection {
    fn as_ref(&self) -> &Self {
        self
    }
}

impl ResourceProjection {
    /// The projection of neutral turns in history order; a turn that is
    /// still running stays the active turn.
    #[must_use]
    pub fn from_turns(cwd: Option<PathBuf>, turns: &[AgentTurn]) -> Self {
        let mut projection = Self {
            cwd,
            ..Self::default()
        };
        for turn in turns {
            let turn_id = turn.turn_id.as_str();
            projection.started(turn_id);
            let cwd = projection.cwd.clone();
            if let Some(data) = projection.pending_for(turn_id) {
                for item in &turn.items {
                    data.apply_agent_item(turn_id, item, cwd.as_deref());
                }
            }
            if turn.status != TurnStatus::InProgress {
                projection.completed(turn_id);
            }
        }
        projection
    }

    pub fn started(&mut self, turn_id: &str) {
        if self.active_turn_id.as_deref() == Some(turn_id) {
            return;
        }
        if let Some(previous_turn_id) = self.active_turn_id.clone() {
            // Interrupted turns do not always receive an explicit terminal
            // record. Once the next turn starts, their canonical resources are
            // immutable and must not disappear from the session projection.
            self.completed(&previous_turn_id);
        }
        self.active_turn_id = Some(turn_id.to_owned());
        self.pending_data = ResourceData::default();
    }

    pub fn completed(&mut self, turn_id: &str) {
        if self.active_turn_id.as_deref() == Some(turn_id) {
            let pending = std::mem::take(&mut self.pending_data);
            self.turns.push(TurnResourceData {
                turn_id: turn_id.to_owned(),
                data: pending,
            });
            self.active_turn_id = None;
        }
        if !turn_id.is_empty() {
            self.recent_completed_turns
                .retain(|candidate| candidate != turn_id);
            self.recent_completed_turns.push_back(turn_id.to_owned());
            while self.recent_completed_turns.len() > RECENT_COMPLETED_TURNS {
                self.recent_completed_turns.pop_front();
            }
        }
    }

    pub fn aborted(&mut self, turn_id: &str) {
        self.completed(turn_id);
    }

    pub fn pending_for(&mut self, turn_id: &str) -> Option<&mut ResourceData> {
        (self.active_turn_id.as_deref() == Some(turn_id)).then_some(&mut self.pending_data)
    }

    pub fn rollback(&mut self, turns: usize) {
        let retained = self.turns.len().saturating_sub(turns);
        self.turns.truncate(retained);
        self.active_turn_id = None;
        self.pending_data = ResourceData::default();
        self.recent_completed_turns = self
            .turns
            .iter()
            .rev()
            .take(RECENT_COMPLETED_TURNS)
            .map(|turn| turn.turn_id.clone())
            .collect::<VecDeque<_>>()
            .into_iter()
            .rev()
            .collect();
    }

    #[must_use]
    pub fn materialized_summary(&self) -> ResourceData {
        let mut data = ResourceData::default();
        for turn in &self.turns {
            data.merge_summary(&turn.data);
        }
        // An interrupted or currently active turn can remain at EOF without a
        // terminal event. Its canonical, newline-terminated records are still
        // part of the thread and must survive a companion restart.
        data.merge_summary(&self.pending_data);
        data
    }

    #[must_use]
    pub fn materialized_patch(&self, path: &str) -> PatchBucket {
        let mut bucket = PatchBucket::default();
        for turn in &self.turns {
            bucket.merge_bucket(turn.data.patches.get(path));
        }
        bucket.merge_bucket(self.pending_data.patches.get(path));
        bucket
    }

    #[must_use]
    pub fn materialized_data(&self) -> ResourceData {
        let mut data = ResourceData::default();
        for turn in &self.turns {
            data.merge(&turn.data);
        }
        data.merge(&self.pending_data);
        data
    }
}

#[must_use]
pub fn last_turn_id<'a>(
    projection: &'a ResourceProjection,
    latest_live_turn: Option<&'a str>,
) -> Option<&'a str> {
    latest_live_turn.or_else(|| {
        projection
            .active_turn_id
            .as_deref()
            .or_else(|| projection.turns.last().map(|turn| turn.turn_id.as_str()))
    })
}

#[must_use]
pub fn last_turn_summary(
    projection: &ResourceProjection,
    overlays: &BTreeMap<String, ResourceData>,
    latest_live_turn: Option<&str>,
) -> ResourceData {
    let Some(turn_id) = last_turn_id(projection, latest_live_turn) else {
        return ResourceData::default();
    };
    let base = if projection.active_turn_id.as_deref() == Some(turn_id) {
        &projection.pending_data
    } else {
        projection
            .turns
            .iter()
            .rev()
            .find(|turn| turn.turn_id == turn_id)
            .map_or(&projection.pending_data, |turn| &turn.data)
    };
    let mut data = base.resolved_against(projection.cwd.as_deref());
    if let Some(overlay) = overlays.get(turn_id) {
        data.merge_missing_summary(&overlay.resolved_against(projection.cwd.as_deref()));
    }
    data
}

#[must_use]
pub fn last_turn_patch(
    projection: &ResourceProjection,
    overlays: &BTreeMap<String, ResourceData>,
    latest_live_turn: Option<&str>,
    resolved: &str,
) -> PatchBucket {
    let Some(turn_id) = last_turn_id(projection, latest_live_turn) else {
        return PatchBucket::default();
    };
    let base = if projection.active_turn_id.as_deref() == Some(turn_id) {
        &projection.pending_data
    } else {
        projection
            .turns
            .iter()
            .rev()
            .find(|turn| turn.turn_id == turn_id)
            .map_or(&projection.pending_data, |turn| &turn.data)
    };
    let resolved_base = base.resolved_against(projection.cwd.as_deref());
    let mut bucket = resolved_base
        .patches
        .get(resolved)
        .cloned()
        .unwrap_or_default();
    if let Some(overlay) = overlays.get(turn_id) {
        let overlay = overlay.resolved_against(projection.cwd.as_deref());
        bucket.merge_bucket(overlay.patches.get(resolved));
    }
    bucket
}
