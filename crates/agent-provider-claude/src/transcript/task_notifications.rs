//! Background task reports as neutral `taskNotification` items.
//!
//! Claude reports a background task (a sub-agent started with the `Agent`
//! tool, a background shell command, a monitor) with a `<task-notification>`
//! message in the stored session and a `task_notification` system frame
//! live. Both are read into one [`TaskReport`] (`task_reports`); the item
//! derives from it:
//! - kind and name: a summary `Agent "X" ...` is the agent X, `Background
//!   command "Y" ...` the command Y, anything else is `other` named by the
//!   summary. Live, an agent's summary is free text, so its `task_started`
//!   frame names it instead ([`started_task_identity`]); a command's live
//!   summary already has the stored form.
//! - status: `lost` when the summary says the task did not finish before the
//!   previous session ended, `interim` when the note says the result may be
//!   interim, else the reported status when it is a known one, else
//!   `unknown`.
//! - name: bounded like other labels ([`TASK_NAME_MAX_UNITS`]).
//! - result: the report's text, trimmed and bounded (live frames carry none).
//! - an agent's thread is the sub-agent child thread (`crate::subagents`).
//!
//! Pure.

use agent_core::model::{
    AgentItem, AppThreadId, ItemId, TaskNotificationDelivery, TaskNotificationSource,
    TaskNotificationStatus,
};

use super::task_reports::TaskReport;
use crate::subagents::child_thread_id;

/// Result text kept on an item, in UTF-16 code units.
pub const TASK_RESULT_MAX_UNITS: usize = 8000;
/// A name is a label: at most this many UTF-16 code units, as a preview. A
/// summary that names no agent or command is the name as a whole.
pub const TASK_NAME_MAX_UNITS: usize = 200;

const FALLBACK_NAME: &str = "Background task";
const AGENT_PREFIX: &str = "Agent \"";
const COMMAND_PREFIX: &str = "Background command \"";
const LOST_SUMMARY: &str = "didn't finish before the previous session ended";
const INTERIM_NOTE: &str = "may be interim";
/// The `task_started` task type of a sub-agent.
const AGENT_TASK_TYPE: &str = "local_agent";

/// What reported.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum TaskKind {
    Agent,
    Command,
    Other,
}

/// What reported, and the name it is shown with.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TaskIdentity {
    pub kind: TaskKind,
    pub name: String,
}

/// The quoted name after `prefix` (which ends with the opening quote): up to
/// the last quote followed by whitespace or the end, so a name may quote.
fn quoted_name<'a>(summary: &'a str, prefix: &str) -> Option<&'a str> {
    let rest = summary.strip_prefix(prefix)?;
    rest.match_indices('"')
        .rev()
        .find(|(at, _)| {
            rest[at + 1..]
                .chars()
                .next()
                .is_none_or(char::is_whitespace)
        })
        .map(|(at, _)| &rest[..at])
}

/// Kind and name as the report's summary states them.
#[must_use]
pub fn reported_identity(report: &TaskReport) -> TaskIdentity {
    let summary = report.summary.as_deref();
    if let Some(name) = summary.and_then(|summary| quoted_name(summary, AGENT_PREFIX)) {
        return TaskIdentity {
            kind: TaskKind::Agent,
            name: name.to_owned(),
        };
    }
    if let Some(name) = summary.and_then(|summary| quoted_name(summary, COMMAND_PREFIX)) {
        return TaskIdentity {
            kind: TaskKind::Command,
            name: name.to_owned(),
        };
    }
    TaskIdentity {
        kind: TaskKind::Other,
        name: summary.unwrap_or(FALLBACK_NAME).to_owned(),
    }
}

/// An agent's kind and name from its live `task_started` frame (task type
/// `local_agent`, its `Agent` call's description), which the stored summary
/// `Agent "<description>" ...` repeats. Other tasks are named by their
/// report: their live summary has the stored form, and Claude starts a
/// monitor as a `local_bash` task while reporting it as `Monitor "..."`.
#[must_use]
pub fn started_task_identity(
    task_type: Option<&str>,
    description: Option<&str>,
) -> Option<TaskIdentity> {
    let name = description.map(str::trim).filter(|name| !name.is_empty())?;
    (task_type == Some(AGENT_TASK_TYPE)).then(|| TaskIdentity {
        kind: TaskKind::Agent,
        name: name.to_owned(),
    })
}

fn reported_status(report: &TaskReport) -> TaskNotificationStatus {
    if report
        .summary
        .as_deref()
        .is_some_and(|summary| summary.contains(LOST_SUMMARY))
    {
        return TaskNotificationStatus::Lost;
    }
    if report
        .note
        .as_deref()
        .is_some_and(|note| note.contains(INTERIM_NOTE))
    {
        return TaskNotificationStatus::Interim;
    }
    match report.status.as_deref() {
        Some("completed") => TaskNotificationStatus::Completed,
        Some("failed") => TaskNotificationStatus::Failed,
        Some("killed") => TaskNotificationStatus::Killed,
        Some("stopped") => TaskNotificationStatus::Stopped,
        _ => TaskNotificationStatus::Unknown,
    }
}

/// Trimmed text of at most [`TASK_RESULT_MAX_UNITS`] UTF-16 units, cut on a
/// character boundary; `None` when nothing is left.
#[must_use]
pub fn bounded_result(text: Option<&str>) -> Option<String> {
    let trimmed = text.map(str::trim).filter(|text| !text.is_empty())?;
    Some(utf16_prefix(trimmed, TASK_RESULT_MAX_UNITS).to_owned())
}

/// The longest prefix of `text` of at most `max_units` UTF-16 units that
/// ends on a character boundary.
fn utf16_prefix(text: &str, max_units: usize) -> &str {
    let mut units = 0;
    for (at, character) in text.char_indices() {
        units += character.len_utf16();
        if units > max_units {
            return &text[..at];
        }
    }
    text
}

/// Where and as what a report is delivered.
pub struct Delivered<'a> {
    pub app_thread_id: &'a AppThreadId,
    pub delivery: TaskNotificationDelivery,
    pub identity: TaskIdentity,
    pub item_id: ItemId,
}

/// The item of one delivered report.
#[must_use]
pub fn task_notification_item(report: &TaskReport, delivered: Delivered<'_>) -> AgentItem {
    let source = match delivered.identity.kind {
        TaskKind::Agent => TaskNotificationSource::Agent {
            agent_thread_id: child_thread_id(delivered.app_thread_id, &report.task_id),
        },
        TaskKind::Command => TaskNotificationSource::Command {
            agent_thread_id: (),
        },
        TaskKind::Other => TaskNotificationSource::Other {
            agent_thread_id: (),
        },
    };
    AgentItem::TaskNotification {
        item_id: delivered.item_id,
        provenance: None,
        delivery: delivered.delivery,
        source,
        task_id: report.task_id.clone(),
        name: utf16_prefix(&delivered.identity.name, TASK_NAME_MAX_UNITS).to_owned(),
        status: reported_status(report),
        duration_ms: report.duration_ms,
        tool_uses: report.tool_uses,
        result: bounded_result(report.result.as_deref()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn report(summary: &str) -> TaskReport {
        TaskReport {
            task_id: "a0000000000000001".into(),
            tool_use_id: None,
            status: Some("completed".into()),
            summary: Some(summary.into()),
            note: None,
            result: None,
            duration_ms: None,
            tool_uses: None,
        }
    }

    fn identity(kind: TaskKind, name: &str) -> TaskIdentity {
        TaskIdentity {
            kind,
            name: name.into(),
        }
    }

    #[test]
    fn the_summary_names_agents_commands_and_other_tasks() {
        assert_eq!(
            reported_identity(&report("Agent \"Review the \"core\" diff\" finished")),
            identity(TaskKind::Agent, "Review the \"core\" diff")
        );
        assert_eq!(
            reported_identity(&report(
                "Background command \"npm run watch\" didn't finish before the previous session ended"
            )),
            identity(TaskKind::Command, "npm run watch")
        );
        assert_eq!(
            reported_identity(&report("Monitor \"Deploy log\" stream ended")),
            identity(TaskKind::Other, "Monitor \"Deploy log\" stream ended")
        );
        let unnamed = TaskReport {
            summary: None,
            ..report("")
        };
        assert_eq!(
            reported_identity(&unnamed),
            identity(TaskKind::Other, "Background task")
        );
        assert_eq!(
            started_task_identity(Some("local_agent"), Some(" Review ")),
            Some(identity(TaskKind::Agent, "Review"))
        );
        assert_eq!(started_task_identity(Some("local_bash"), Some("npm")), None);
        assert_eq!(started_task_identity(Some("local_agent"), Some("  ")), None);
    }

    #[test]
    fn lost_and_interim_reports_override_the_reported_status() {
        let app_thread_id = AppThreadId::from_static("0199a3c4-7a8e-7b2c-9d1e-2f3a4b5c6d7e");
        let status = |report: &TaskReport| match task_notification_item(
            report,
            Delivered {
                app_thread_id: &app_thread_id,
                delivery: TaskNotificationDelivery::Wake,
                identity: reported_identity(report),
                item_id: ItemId::from_static("turn:notification:0"),
            },
        ) {
            AgentItem::TaskNotification { status, .. } => Some(status),
            _ => None,
        };
        let lost =
            report("Background command \"watch\" didn't finish before the previous session ended");
        assert_eq!(status(&lost), Some(TaskNotificationStatus::Lost));
        let interim = TaskReport {
            note: Some("the result below may be interim.".into()),
            ..report("Agent \"Review\" finished")
        };
        assert_eq!(status(&interim), Some(TaskNotificationStatus::Interim));
        let odd = TaskReport {
            status: Some("exploded".into()),
            ..report("x")
        };
        assert_eq!(status(&odd), Some(TaskNotificationStatus::Unknown));
        let killed = TaskReport {
            status: Some("killed".into()),
            ..report("x")
        };
        assert_eq!(status(&killed), Some(TaskNotificationStatus::Killed));
    }

    #[test]
    fn an_agent_report_names_its_child_thread_and_others_none() {
        let app_thread_id = AppThreadId::from_static("0199a3c4-7a8e-7b2c-9d1e-2f3a4b5c6d7e");
        let source_of = |kind: TaskKind| match task_notification_item(
            &report("x"),
            Delivered {
                app_thread_id: &app_thread_id,
                delivery: TaskNotificationDelivery::MidTurn,
                identity: identity(kind, "x"),
                item_id: ItemId::from_static("turn:notification:0"),
            },
        ) {
            AgentItem::TaskNotification { source, .. } => Some(source),
            _ => None,
        };
        assert_eq!(
            source_of(TaskKind::Agent)
                .as_ref()
                .and_then(TaskNotificationSource::agent_thread_id)
                .map(AppThreadId::as_str),
            Some("0199a3c4-7a8e-7b2c-9d1e-2f3a4b5c6d7e:agent:a0000000000000001")
        );
        assert_eq!(
            source_of(TaskKind::Command),
            Some(TaskNotificationSource::Command {
                agent_thread_id: ()
            })
        );
    }

    #[test]
    fn an_unrecognised_summary_names_the_report_within_the_label_bound() {
        let app_thread_id = AppThreadId::from_static("0199a3c4-7a8e-7b2c-9d1e-2f3a4b5c6d7e");
        let long = report(&format!(
            "Monitor {}",
            "\u{1F600}".repeat(TASK_NAME_MAX_UNITS)
        ));
        let name = match task_notification_item(
            &long,
            Delivered {
                app_thread_id: &app_thread_id,
                delivery: TaskNotificationDelivery::Wake,
                identity: reported_identity(&long),
                item_id: ItemId::from_static("turn:notification:0"),
            },
        ) {
            AgentItem::TaskNotification { name, .. } => name,
            _ => String::new(),
        };
        assert_eq!(
            name,
            format!(
                "Monitor {}",
                "\u{1F600}".repeat((TASK_NAME_MAX_UNITS - 8) / 2)
            )
        );
    }

    #[test]
    fn a_result_is_trimmed_and_bounded_on_a_character_boundary() {
        let pair = "\u{1F600}";
        let long = format!("{}{pair}tail", "x".repeat(TASK_RESULT_MAX_UNITS - 1));
        assert_eq!(
            bounded_result(Some(&long)),
            Some("x".repeat(TASK_RESULT_MAX_UNITS - 1))
        );
        let padded = format!("  {}  ", "y".repeat(TASK_RESULT_MAX_UNITS + 5));
        assert_eq!(
            bounded_result(Some(&padded)).map(|text| text.encode_utf16().count()),
            Some(TASK_RESULT_MAX_UNITS)
        );
        let fits = format!("{}{pair}", "z".repeat(TASK_RESULT_MAX_UNITS - 2));
        assert_eq!(bounded_result(Some(&fits)), Some(fits.clone()));
        assert_eq!(bounded_result(Some("   ")), None);
        assert_eq!(bounded_result(None), None);
    }
}
