//! Which live background task reports reach this conversation, and when.
//!
//! - A report is delivered only for a task the main conversation started: a
//!   task a sub-agent owns (`owned_by_subagent`, or a spawn depth above the
//!   top level) reports to that sub-agent, and a foreground call still open
//!   in the running turn gets its outcome as the call's own result.
//! - A report that arrives while no turn runs waits; the next turn delivers
//!   every waiting report once. The query's tasks end with it: reports still
//!   waiting when it ends are dropped (the stored history shows what Claude
//!   delivered).
//! - An agent is named by its `task_started` description; other tasks by the
//!   report's summary.
//! - What the open query knows of one task (started, or reported with which
//!   status) answers its output read's status (`background_tasks`).
//! - The background commands the open query launched (`launched`, the last
//!   `command` item of each, with the turn it belongs to) take the state a
//!   final report gives (`settle`, through the same
//!   `background_commands::command_state` every read applies); its process's
//!   exit stops every one still running (`forget`). Each change is the item to republish.
//!
//! Pure state; the session decides when to deliver.

use std::collections::HashMap;

use agent_core::model::{AgentItem, BackgroundCommandState, TaskNotificationStatus, TurnId};

use crate::{
    background_tasks::LiveTaskState,
    transcript::{
        background_commands::{command_state, reported_state},
        frames::TaskStartedFrame,
        task_notifications::{
            TaskIdentity, reported_identity, reported_status, started_task_identity,
        },
        task_reports::TaskReport,
    },
};

/// A background task seen starting in the current query.
struct StartedTask {
    /// `None` when its start does not name it; the report's summary does then.
    identity: Option<TaskIdentity>,
    nested: bool,
}

/// A report delivered to this conversation, with what it reports on.
pub(super) struct DeliveredReport {
    pub identity: TaskIdentity,
    pub report: TaskReport,
}

/// A background command the open query launched: its latest `command`
/// item and the turn that item belongs to.
#[derive(Clone)]
pub(super) struct Launch {
    pub turn_id: TurnId,
    pub item: AgentItem,
}

impl Launch {
    fn state(&self) -> Option<BackgroundCommandState> {
        match &self.item {
            AgentItem::Command {
                background: Some(background),
                ..
            } => Some(background.state),
            _ => None,
        }
    }

    /// The launch after learning `next`, or `None` when it changes nothing.
    /// The launch with the state [`command_state`] gives once the live
    /// session learns `next`; `None` when it changes nothing.
    fn advanced(&self, next: BackgroundCommandState) -> Option<Self> {
        let current = self.state()?;
        let state = command_state(None, Some(current.advanced(next)));
        if state == current {
            return None;
        }
        let mut item = self.item.clone();
        if let AgentItem::Command {
            background: Some(background),
            ..
        } = &mut item
        {
            background.state = state;
        }
        Some(Self {
            turn_id: self.turn_id.clone(),
            item,
        })
    }
}

/// The background tasks of the open query and the reports waiting for a turn.
#[derive(Default)]
pub(super) struct LiveTaskReports {
    started: HashMap<String, StartedTask>,
    launches: HashMap<String, Launch>,
    /// The status of every report the open query received, by task id.
    reported: HashMap<String, TaskNotificationStatus>,
    waiting: Vec<DeliveredReport>,
}

impl LiveTaskReports {
    pub(super) fn started(&mut self, frame: &TaskStartedFrame) {
        self.started.insert(
            frame.task_id.clone(),
            StartedTask {
                identity: started_task_identity(
                    frame.task_type.as_deref(),
                    frame.description.as_deref(),
                ),
                nested: frame.nested,
            },
        );
    }

    /// Records a report the open query received, delivered here or not.
    pub(super) fn received(&mut self, report: &TaskReport) {
        self.reported
            .insert(report.task_id.clone(), reported_status(report));
    }

    /// What the open query knows of a task: its report, else that it started.
    pub(super) fn state(&self, task_id: &str) -> Option<LiveTaskState> {
        if let Some(status) = self.reported.get(task_id) {
            return Some(LiveTaskState::Reported(*status));
        }
        (self.started.contains_key(task_id) || self.launches.contains_key(task_id))
            .then_some(LiveTaskState::Running)
    }

    /// Records a `command` item of turn `turn_id` that launched a background
    /// task. An item emitted again (a turn's completion repeats it) keeps
    /// the state the launch already reached.
    pub(super) fn launched(&mut self, turn_id: &TurnId, item: &AgentItem) {
        let AgentItem::Command {
            background: Some(background),
            ..
        } = item
        else {
            return;
        };
        let launch = Launch {
            turn_id: turn_id.clone(),
            item: item.clone(),
        };
        let launch = match self
            .launches
            .get(&background.task_id)
            .and_then(Launch::state)
        {
            Some(known) => launch.advanced(known).unwrap_or(launch),
            None => launch,
        };
        self.launches.insert(background.task_id.clone(), launch);
    }

    /// A report the open query received at `now_ms` for a command it
    /// launched: the launch with its new state to republish, or `None` when
    /// the report is not final, names no launch or changes nothing.
    pub(super) fn settle(&mut self, report: &TaskReport, now_ms: i64) -> Option<Launch> {
        let state = reported_state(report, now_ms)?;
        let settled = self.launches.get(&report.task_id)?.advanced(state)?;
        self.launches
            .insert(report.task_id.clone(), settled.clone());
        Some(settled)
    }

    /// The state of every background command the open query launched, by task id.
    pub(super) fn launch_states(&self) -> HashMap<String, BackgroundCommandState> {
        self.launches
            .iter()
            .filter_map(|(task_id, launch)| Some((task_id.clone(), launch.state()?)))
            .collect()
    }

    /// The report as delivered to this conversation, or `None` for one
    /// Claude does not deliver here: a task a sub-agent owns, or a call
    /// `is_open_call` still runs in the active turn.
    pub(super) fn delivered(
        &self,
        report: &TaskReport,
        is_open_call: impl Fn(&str) -> bool,
    ) -> Option<DeliveredReport> {
        let started = self.started.get(&report.task_id);
        if started.is_some_and(|task| task.nested)
            || report.tool_use_id.as_deref().is_some_and(is_open_call)
        {
            return None;
        }
        Some(DeliveredReport {
            identity: started
                .and_then(|task| task.identity.clone())
                .unwrap_or_else(|| reported_identity(report)),
            report: report.clone(),
        })
    }

    /// Keeps a report that arrived while no turn ran for the next turn.
    pub(super) fn wait(&mut self, report: DeliveredReport) {
        self.waiting.push(report);
    }

    /// The waiting reports, oldest first; each is delivered once.
    pub(super) fn take_waiting(&mut self) -> Vec<DeliveredReport> {
        std::mem::take(&mut self.waiting)
    }

    /// The query ended and waiting reports are dropped. `exited_at_ms` is
    /// when its process exited, if it did: its running tasks stopped then,
    /// and those launches are returned to republish. A query this companion
    /// closed (`None`) leaves its process to end on its own; it keeps
    /// running its tasks, which a read then settles from the process list.
    pub(super) fn forget(&mut self, exited_at_ms: Option<i64>) -> Vec<Launch> {
        self.started.clear();
        self.reported.clear();
        self.waiting.clear();
        let launches = std::mem::take(&mut self.launches);
        let Some(exited_at_ms) = exited_at_ms else {
            return Vec::new();
        };
        let stopped = BackgroundCommandState::Stopped {
            ended_at: exited_at_ms.div_euclid(1000),
        };
        launches
            .into_values()
            .filter_map(|launch| launch.advanced(stopped))
            .collect()
    }
}
