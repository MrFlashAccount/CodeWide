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
//!
//! Pure state; the session decides when to deliver.

use std::collections::HashMap;

use crate::transcript::{
    frames::TaskStartedFrame,
    task_notifications::{TaskIdentity, reported_identity, started_task_identity},
    task_reports::TaskReport,
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

/// The background tasks of the open query and the reports waiting for a turn.
#[derive(Default)]
pub(super) struct LiveTaskReports {
    started: HashMap<String, StartedTask>,
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

    /// The query ended: its tasks end with it, and waiting reports are dropped.
    pub(super) fn forget(&mut self) {
        self.started.clear();
        self.waiting.clear();
    }
}
