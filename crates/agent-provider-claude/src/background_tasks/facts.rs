//! What a thread's own items say about one background task, and the task's
//! status. A thread knows a task it launched (a `command` item naming it as
//! its `background` task) or one reported to it (a `taskNotification` item
//! with its task id); no other task's output is ever read for it. Pure.
//!
//! Status: the newest final report's status (an `interim` report is not
//! final); else what the live session knows (a final report it received, or
//! `running` for a task it saw start); else `unknown`.

use std::path::PathBuf;

use agent_core::model::{
    AgentItem, AgentTurn, BackgroundCommand, BackgroundTaskStatus, TaskNotificationStatus,
};

use super::BackgroundTaskId;

/// The text before the output path in the result of a background `Bash`
/// call ("… Output is being written to: <path>. You will be notified …").
const OUTPUT_PATH_MARKER: &str = "Output is being written to: ";

/// A background task as the thread's live session knows it.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum LiveTaskState {
    /// The task started in the open query and has not reported.
    Running,
    /// The open query received its report.
    Reported(TaskNotificationStatus),
}

/// What the thread's items say about the task.
#[derive(Debug, Default, Eq, PartialEq)]
pub struct TaskFacts {
    /// The thread launched or was reported the task.
    pub known: bool,
    /// The newest final report's status.
    pub reported: Option<TaskNotificationStatus>,
    /// The output path the launching call's result names. A hint for where
    /// Claude's temporary directory is; it is checked like any other place.
    pub claimed_output: Option<PathBuf>,
    /// The command the launching call ran.
    pub command: Option<String>,
    /// The launching call was seen: older items cannot add anything.
    launched: bool,
}

impl TaskFacts {
    /// Adds the facts of `turns`, newest turn first, until the launching
    /// call is seen; `true` once it is (older turns can be skipped).
    pub fn scan_newest_first<'a>(
        &mut self,
        task: &BackgroundTaskId,
        turns: impl IntoIterator<Item = &'a AgentTurn>,
    ) -> bool {
        for turn in turns {
            for item in turn.items.iter().rev() {
                self.observe(task, item);
                if self.launched {
                    return true;
                }
            }
        }
        false
    }

    fn observe(&mut self, task: &BackgroundTaskId, item: &AgentItem) {
        match item {
            AgentItem::TaskNotification {
                task_id, status, ..
            } if task_id == task.as_str() => {
                self.known = true;
                if self.reported.is_none() && *status != TaskNotificationStatus::Interim {
                    self.reported = Some(*status);
                }
            }
            AgentItem::Command {
                background: Some(BackgroundCommand { task_id, .. }),
                command,
                output,
                ..
            } if task_id == task.as_str() => {
                self.known = true;
                self.launched = true;
                self.command = Some(command.clone());
                self.claimed_output = output
                    .as_deref()
                    .and_then(|output| claimed_output_path(output, task));
            }
            _ => {}
        }
    }

    /// The task's status from the newest final report, else the live
    /// session's knowledge, else `unknown`.
    #[must_use]
    pub fn status(&self, live: Option<LiveTaskState>) -> BackgroundTaskStatus {
        let final_status = |status: TaskNotificationStatus| {
            (status != TaskNotificationStatus::Interim).then_some(status)
        };
        let reported = self.reported.and_then(final_status).or(match live {
            Some(LiveTaskState::Reported(status)) => final_status(status),
            Some(LiveTaskState::Running) | None => None,
        });
        match reported {
            Some(status) => reported_status(status),
            None if live.is_some() => BackgroundTaskStatus::Running,
            None => BackgroundTaskStatus::Unknown,
        }
    }
}

const fn reported_status(status: TaskNotificationStatus) -> BackgroundTaskStatus {
    match status {
        TaskNotificationStatus::Completed => BackgroundTaskStatus::Completed,
        TaskNotificationStatus::Failed => BackgroundTaskStatus::Failed,
        TaskNotificationStatus::Killed => BackgroundTaskStatus::Killed,
        TaskNotificationStatus::Stopped => BackgroundTaskStatus::Stopped,
        TaskNotificationStatus::Lost => BackgroundTaskStatus::Lost,
        TaskNotificationStatus::Interim | TaskNotificationStatus::Unknown => {
            BackgroundTaskStatus::Unknown
        }
    }
}

/// The path after [`OUTPUT_PATH_MARKER`] through `<task id>.output`, when
/// the text names one on the same line.
fn claimed_output_path(output: &str, task: &BackgroundTaskId) -> Option<PathBuf> {
    let rest = &output[output.find(OUTPUT_PATH_MARKER)? + OUTPUT_PATH_MARKER.len()..];
    let line = rest.lines().next()?;
    let suffix = format!("/{}", task.output_file_name());
    let end = line.find(&suffix)? + suffix.len();
    Some(PathBuf::from(&line[..end]))
}

#[cfg(test)]
mod tests {
    use agent_core::model::{
        ExecutionStatus, ItemId, TaskNotificationDelivery, TaskNotificationSource, TurnId,
        TurnOrigin, TurnStatus,
    };

    use super::*;

    type TestResult = Result<(), Box<dyn std::error::Error>>;

    fn task() -> Result<BackgroundTaskId, &'static str> {
        BackgroundTaskId::parse("bd3cb8oli").ok_or("task id")
    }

    fn launch(task_id: &str) -> AgentItem {
        AgentItem::Command {
            item_id: ItemId::from_static("toolu_bg"),
            provenance: None,
            command: "npm test".into(),
            cwd: "/w".into(),
            status: ExecutionStatus::Completed,
            output: Some(format!(
                "Command running in background with ID: {task_id}. Output is being written to: /var/tmp/claude-1/-w/s/tasks/{task_id}.output. You will be notified when it completes."
            )),
            exit_code: Some(0),
            duration_ms: Some(3),
            background: Some(BackgroundCommand {
                task_id: task_id.into(),
                started_at: 1_760_000_100,
                description: None,
                state: agent_core::model::BackgroundCommandState::Running,
            }),
        }
    }

    fn report(task_id: &str, status: TaskNotificationStatus) -> AgentItem {
        AgentItem::TaskNotification {
            item_id: ItemId::from_static("turn:notification:0"),
            provenance: None,
            delivery: TaskNotificationDelivery::Wake,
            source: TaskNotificationSource::Command {
                agent_thread_id: (),
            },
            task_id: task_id.into(),
            name: "npm test".into(),
            status,
            duration_ms: None,
            tool_uses: None,
            result: None,
        }
    }

    fn turn(items: Vec<AgentItem>) -> AgentTurn {
        AgentTurn {
            turn_id: TurnId::from_static("turn"),
            status: TurnStatus::Completed,
            origin: TurnOrigin::User,
            started_at: 1,
            completed_at: Some(2),
            error: None,
            items,
            provenance: None,
            usage: None,
        }
    }

    fn facts(turns_newest_first: &[AgentTurn]) -> Result<TaskFacts, &'static str> {
        let mut facts = TaskFacts::default();
        facts.scan_newest_first(&task()?, turns_newest_first);
        Ok(facts)
    }

    #[test]
    fn a_task_the_thread_never_launched_or_reported_is_unknown_to_it() -> TestResult {
        let other = facts(&[turn(vec![
            launch("bother1"),
            report("bother1", TaskNotificationStatus::Completed),
        ])])?;
        assert!(!other.known);
        assert_eq!(other, TaskFacts::default());
        Ok(())
    }

    #[test]
    fn a_running_task_is_running_until_its_final_report() -> TestResult {
        let launched = facts(&[turn(vec![launch("bd3cb8oli")])])?;
        assert!(launched.known);
        assert_eq!(
            launched.claimed_output,
            Some(PathBuf::from(
                "/var/tmp/claude-1/-w/s/tasks/bd3cb8oli.output"
            ))
        );
        assert_eq!(launched.command.as_deref(), Some("npm test"));
        assert_eq!(
            launched.status(Some(LiveTaskState::Running)),
            BackgroundTaskStatus::Running
        );
        assert_eq!(launched.status(None), BackgroundTaskStatus::Unknown);
        assert_eq!(
            launched.status(Some(LiveTaskState::Reported(
                TaskNotificationStatus::Killed
            ))),
            BackgroundTaskStatus::Killed
        );

        let completed = facts(&[
            turn(vec![report("bd3cb8oli", TaskNotificationStatus::Completed)]),
            turn(vec![report("bd3cb8oli", TaskNotificationStatus::Interim)]),
            turn(vec![launch("bd3cb8oli")]),
        ])?;
        assert_eq!(
            completed.status(Some(LiveTaskState::Running)),
            BackgroundTaskStatus::Completed
        );
        let interim = facts(&[
            turn(vec![report("bd3cb8oli", TaskNotificationStatus::Interim)]),
            turn(vec![launch("bd3cb8oli")]),
        ])?;
        assert_eq!(
            interim.status(Some(LiveTaskState::Running)),
            BackgroundTaskStatus::Running
        );
        assert_eq!(interim.status(None), BackgroundTaskStatus::Unknown);
        Ok(())
    }

    #[test]
    fn a_reported_task_is_known_without_its_launch_and_the_scan_stops_at_the_launch() -> TestResult
    {
        let reported = facts(&[turn(vec![report(
            "bd3cb8oli",
            TaskNotificationStatus::Lost,
        )])])?;
        assert!(reported.known);
        assert_eq!(reported.claimed_output, None);
        assert_eq!(reported.command, None);
        assert_eq!(reported.status(None), BackgroundTaskStatus::Lost);

        let mut scan = TaskFacts::default();
        assert!(scan.scan_newest_first(&task()?, &[turn(vec![launch("bd3cb8oli")])]));
        // Reports older than the launch cannot exist; the scan stops there.
        assert!(!scan.scan_newest_first(&task()?, &[]));
        Ok(())
    }

    #[test]
    fn the_claimed_path_must_end_with_the_task_s_own_file() -> TestResult {
        assert_eq!(
            claimed_output_path(
                "Output is being written to: /tmp/x/other.output. Done",
                &task()?
            ),
            None
        );
        assert_eq!(claimed_output_path("no path here", &task()?), None);
        Ok(())
    }
}
