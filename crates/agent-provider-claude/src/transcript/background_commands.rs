//! The state of the background commands a thread launched (`Bash` with
//! `run_in_background`, `Monitor`). One rule, [`command_state`], serves both
//! the live republication and every history read, so they cannot disagree:
//! a final report proves an end (`completed`, `failed`, or `stopped` for a
//! killed, stopped or lost task; Claude's report names no exit code) — a
//! stored one at the time it was stored, a live one when it arrived; the
//! live session adds only what it alone knows, that a launch still runs, or
//! that its process exited while the task ran (then it stopped). Without an
//! open query of this companion, the running-session authority decides
//! ([`held_state`]): Claude keeps the process, and its tasks, across turns,
//! and the process can outlive a companion restart, so a task runs while its
//! launching process holds the session and stopped once that process is
//! proven gone. History alone leaves a launch `unknown` until a read adds
//! that evidence; every Claude read does. An ended state is final
//! (`BackgroundCommandState::advanced`). Pure.

use std::collections::HashMap;

use agent_core::model::{
    AgentItem, AgentTurn, BackgroundCommand, BackgroundCommandState, TaskNotificationStatus,
};

use super::{task_notifications::reported_status, task_reports::TaskReport};

const MS_PER_SECOND: i64 = 1000;

/// What a final report says of its task, ended at `reported_at_ms`; `None`
/// for an interim report or one without a recognised status.
#[must_use]
pub fn reported_state(report: &TaskReport, reported_at_ms: i64) -> Option<BackgroundCommandState> {
    let ended_at = reported_at_ms.div_euclid(MS_PER_SECOND);
    match reported_status(report) {
        TaskNotificationStatus::Completed => Some(BackgroundCommandState::Completed {
            ended_at,
            exit_code: None,
        }),
        TaskNotificationStatus::Failed => Some(BackgroundCommandState::Failed {
            ended_at,
            exit_code: None,
        }),
        TaskNotificationStatus::Killed
        | TaskNotificationStatus::Stopped
        | TaskNotificationStatus::Lost => Some(BackgroundCommandState::Stopped { ended_at }),
        TaskNotificationStatus::Interim | TaskNotificationStatus::Unknown => None,
    }
}

/// The one authority over a background command's state: the end the session
/// file proves (`stored`), else what the live session knows (`live`), else
/// `unknown`. The live republication publishes `command_state(None, live)`;
/// a read answers `command_state(stored, live)` with the same `live`.
#[must_use]
pub fn command_state(
    stored: Option<BackgroundCommandState>,
    live: Option<BackgroundCommandState>,
) -> BackgroundCommandState {
    stored
        .unwrap_or(BackgroundCommandState::Unknown)
        .advanced(live.unwrap_or(BackgroundCommandState::Unknown))
}

/// The ended state of each task a stored final report settles, by task id;
/// the first final report wins.
#[derive(Debug, Default)]
pub struct BackgroundCommandRuns {
    ended: HashMap<String, BackgroundCommandState>,
}

impl BackgroundCommandRuns {
    /// Records a stored report that arrived at `timestamp_ms`; reports are
    /// recorded in the order they were stored.
    pub fn record(&mut self, report: &TaskReport, timestamp_ms: i64) {
        if let Some(state) = reported_state(report, timestamp_ms)
            && state.has_ended()
        {
            self.ended.entry(report.task_id.clone()).or_insert(state);
        }
    }
}

/// The background command a stored or live item launched, mutable.
fn background_of(item: &mut AgentItem) -> Option<&mut BackgroundCommand> {
    match item {
        AgentItem::Command {
            background: Some(background),
            ..
        } => Some(background),
        _ => None,
    }
}

/// Turns rebuilt from stored history: each launch takes the state its final
/// report settles, else `unknown`.
#[must_use]
pub fn settle_background_commands(
    mut turns: Vec<AgentTurn>,
    runs: &BackgroundCommandRuns,
) -> Vec<AgentTurn> {
    for item in turns.iter_mut().flat_map(|turn| turn.items.iter_mut()) {
        if let Some(background) = background_of(item) {
            background.state = command_state(runs.ended.get(&background.task_id).copied(), None);
        }
    }
    turns
}

/// Adds what the open query knows (`live`, by task id) to turns read from
/// history: a launch it still runs is `running`, one it saw end takes that
/// end; an end history already has stays.
pub fn overlay_live_background_commands<S: std::hash::BuildHasher>(
    turns: &mut [AgentTurn],
    live: &HashMap<String, BackgroundCommandState, S>,
) {
    if live.is_empty() {
        return;
    }
    for item in turns.iter_mut().flat_map(|turn| turn.items.iter_mut()) {
        if let Some(background) = background_of(item)
            && let Some(state) = live.get(&background.task_id)
        {
            background.state = command_state(Some(background.state), Some(*state));
        }
    }
}

/// The process that holds the thread's session when no query of this
/// companion is open, from the running-session authority (`claude agents`).
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum HoldingProcess {
    /// The authority could not be read (transient): nothing new is proven.
    Unavailable,
    /// No process holds the session; the companion first saw a launch's
    /// process gone at the time its `lost_at` gives.
    Stopped,
    /// A process holds it; `started_at_ms` when the CLI reports its start.
    Running { started_at_ms: Option<i64> },
}

/// What the holding process proves of one launch. A Claude background task
/// lives exactly as long as the process that launched it:
/// - a process that started no later than the launch (seconds granularity)
///   still holds the session: it runs;
/// - a later process generation holds it: the launching process is gone, so
///   the task stopped, by that generation's start at the latest;
/// - no process holds it: the task stopped, at `lost_at_s`, when the
///   companion first saw it gone;
/// - a holder without a known start, or an unreadable authority, proves no
///   end: the launch keeps running until a read can tell.
#[must_use]
pub fn held_state(
    background: &BackgroundCommand,
    process: HoldingProcess,
    lost_at_s: impl FnOnce() -> i64,
) -> BackgroundCommandState {
    match process {
        HoldingProcess::Running {
            started_at_ms: Some(started_at_ms),
        } => {
            let started_at = started_at_ms.div_euclid(MS_PER_SECOND);
            if background.started_at >= started_at {
                BackgroundCommandState::Running
            } else {
                BackgroundCommandState::Stopped {
                    ended_at: started_at,
                }
            }
        }
        HoldingProcess::Stopped => BackgroundCommandState::Stopped {
            ended_at: lost_at_s().max(background.started_at),
        },
        HoldingProcess::Running {
            started_at_ms: None,
        }
        | HoldingProcess::Unavailable => BackgroundCommandState::Running,
    }
}

/// Adds what the holding process proves to turns read from history, by the
/// same [`command_state`] rule; for a thread without an open query here.
/// `lost_at_s` gives the time the companion first saw a task's process gone.
pub fn overlay_holding_process(
    turns: &mut [AgentTurn],
    process: HoldingProcess,
    lost_at_s: &mut dyn FnMut(&BackgroundCommand) -> i64,
) {
    for item in turns.iter_mut().flat_map(|turn| turn.items.iter_mut()) {
        if let Some(background) = background_of(item)
            && !background.state.has_ended()
        {
            let held = held_state(background, process, || lost_at_s(background));
            background.state = command_state(Some(background.state), Some(held));
        }
    }
}

/// Whether any item of `turns` launched a background command that has not
/// ended: only then can the live session add anything.
#[must_use]
pub fn has_unended_background_command(turns: &[AgentTurn]) -> bool {
    turns.iter().flat_map(|turn| &turn.items).any(|item| {
        matches!(
            item,
            AgentItem::Command {
                background: Some(background),
                ..
            } if !background.state.has_ended()
        )
    })
}

#[cfg(test)]
mod tests {
    use agent_core::model::{ExecutionStatus, ItemId, TurnId, TurnOrigin, TurnStatus};

    use super::*;

    fn report(task_id: &str, status: &str) -> TaskReport {
        TaskReport {
            task_id: task_id.into(),
            tool_use_id: None,
            status: Some(status.into()),
            summary: None,
            note: None,
            result: None,
            duration_ms: None,
            tool_uses: None,
        }
    }

    fn launch(task_id: &str) -> AgentItem {
        AgentItem::Command {
            item_id: ItemId::from_static("toolu_bg"),
            provenance: None,
            command: "npm test".into(),
            cwd: "/w".into(),
            status: ExecutionStatus::Completed,
            output: None,
            exit_code: Some(0),
            duration_ms: Some(3),
            background: Some(BackgroundCommand {
                task_id: task_id.into(),
                started_at: 1_760_000_100,
                description: None,
                state: BackgroundCommandState::Running,
            }),
        }
    }

    fn turns(items: Vec<AgentItem>) -> Vec<AgentTurn> {
        vec![AgentTurn {
            turn_id: TurnId::from_static("turn"),
            status: TurnStatus::Completed,
            origin: TurnOrigin::User,
            started_at: 1,
            completed_at: Some(2),
            error: None,
            items,
            provenance: None,
            usage: None,
        }]
    }

    fn states(turns: &[AgentTurn]) -> Vec<BackgroundCommandState> {
        turns
            .iter()
            .flat_map(|turn| &turn.items)
            .filter_map(|item| match item {
                AgentItem::Command {
                    background: Some(background),
                    ..
                } => Some(background.state),
                _ => None,
            })
            .collect()
    }

    #[test]
    fn a_final_report_ends_its_task_at_the_time_it_arrived() {
        assert_eq!(
            reported_state(&report("b1", "completed"), 10_999),
            Some(BackgroundCommandState::Completed {
                ended_at: 10,
                exit_code: None
            })
        );
        assert_eq!(
            reported_state(&report("b1", "failed"), 11_000),
            Some(BackgroundCommandState::Failed {
                ended_at: 11,
                exit_code: None
            })
        );
        for stopped in ["killed", "stopped"] {
            assert_eq!(
                reported_state(&report("b1", stopped), 12_000),
                Some(BackgroundCommandState::Stopped { ended_at: 12 })
            );
        }
        assert_eq!(reported_state(&report("b1", "running"), 12_000), None);
    }

    #[test]
    fn stored_history_settles_reported_launches_and_leaves_the_rest_unknown() {
        let mut runs = BackgroundCommandRuns::default();
        runs.record(&report("b1", "completed"), 20_000);
        runs.record(&report("b1", "killed"), 30_000);
        let settled = settle_background_commands(turns(vec![launch("b1"), launch("b2")]), &runs);
        assert_eq!(
            states(&settled),
            [
                BackgroundCommandState::Completed {
                    ended_at: 20,
                    exit_code: None
                },
                BackgroundCommandState::Unknown,
            ]
        );
    }

    #[test]
    fn the_live_session_runs_unknown_launches_but_never_reopens_an_ended_one() {
        let mut runs = BackgroundCommandRuns::default();
        runs.record(&report("b1", "failed"), 20_000);
        let mut read = settle_background_commands(
            turns(vec![launch("b1"), launch("b2"), launch("b3")]),
            &runs,
        );
        assert!(has_unended_background_command(&read));
        let live = HashMap::from([
            ("b1".to_owned(), BackgroundCommandState::Running),
            ("b2".to_owned(), BackgroundCommandState::Running),
        ]);
        overlay_live_background_commands(&mut read, &live);
        assert_eq!(
            states(&read),
            [
                BackgroundCommandState::Failed {
                    ended_at: 20,
                    exit_code: None
                },
                BackgroundCommandState::Running,
                BackgroundCommandState::Unknown,
            ]
        );
    }
}
