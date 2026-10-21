//! Reading background task reports: the `<task-notification>` messages of a
//! stored session and the live `task_notification` system frames, into one
//! shape ([`TaskReport`]). Structural and total: a report without a task id
//! is skipped. What a report becomes is `task_notifications`. Pure.

use serde_json::Value;

use super::json::{JsonRecord, record_of, str_of};

/// The facts of one background task report, stored or live.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TaskReport {
    /// The task's id; for a sub-agent, its agent id.
    pub task_id: String,
    /// The tool call that started the task.
    pub tool_use_id: Option<String>,
    /// The status as reported (`completed`, `failed`, `killed`, `stopped`, ...).
    pub status: Option<String>,
    pub summary: Option<String>,
    /// Claude's `<note>` about the report (stored reports only).
    pub note: Option<String>,
    /// The report's result text, untrimmed (stored reports only).
    pub result: Option<String>,
    pub duration_ms: Option<i64>,
    pub tool_uses: Option<i64>,
}

const OPEN_TAG: &str = "<task-notification>";
const CLOSE_TAG: &str = "</task-notification>";
const RESULT_OPEN: &str = "<result>";
const RESULT_CLOSE: &str = "</result>";
/// The largest integer a JSON number carries exactly (2^53 - 1).
const MAX_EXACT_INTEGER: i64 = 9_007_199_254_740_991;

fn non_empty(text: Option<&str>) -> Option<String> {
    text.map(str::trim)
        .filter(|text| !text.is_empty())
        .map(ToOwned::to_owned)
}

fn exact_count(value: i64) -> Option<i64> {
    (0..=MAX_EXACT_INTEGER).contains(&value).then_some(value)
}

/// The text of the first `<name>` element, or `None`.
fn element<'a>(body: &'a str, name: &str) -> Option<&'a str> {
    let open = format!("<{name}>");
    let start = body.find(&open)? + open.len();
    let end = body[start..].find(&format!("</{name}>"))? + start;
    Some(&body[start..end])
}

/// The text of every `<name>` element, in order.
fn elements<'a>(body: &'a str, name: &str) -> Vec<&'a str> {
    let open = format!("<{name}>");
    let close = format!("</{name}>");
    let mut found = Vec::new();
    let mut at = 0;
    while let Some(offset) = body[at..].find(&open) {
        let start = at + offset + open.len();
        let Some(length) = body[start..].find(&close) else {
            break;
        };
        found.push(&body[start..start + length]);
        at = start + length + close.len();
    }
    found
}

/// The count after the first `<name>` or `name:` in a usage block
/// (`<duration_ms>12</duration_ms>` or `duration_ms: 12`).
fn usage_count(usage: Option<&str>, name: &str) -> Option<i64> {
    let usage = usage?;
    usage.match_indices(name).find_map(|(at, _)| {
        let rest = &usage[at + name.len()..];
        let digits = if let Some(rest) = rest.strip_prefix('>') {
            rest
        } else {
            rest.strip_prefix(':')?.trim_start()
        };
        let end = digits
            .find(|character: char| !character.is_ascii_digit())
            .unwrap_or(digits.len());
        digits[..end].parse::<i64>().ok().and_then(exact_count)
    })
}

/// One stored notification split around its result. The result is opaque:
/// it may quote markup, even a whole `<task-notification>` or `<usage>`, so
/// the other elements are read only before (`head`) and after (`tail`) it.
struct StoredNotification<'a> {
    head: &'a str,
    result: Option<&'a str>,
    tail: &'a str,
}

impl<'a> StoredNotification<'a> {
    /// The notification whose body starts `body`, and the length of `body`
    /// it spans (through its closing tag). A result runs to its last
    /// `</result>` before the notification's end: the first closing tag
    /// after the result that ends the message or precedes the next
    /// notification. Without a result the first closing tag ends it.
    fn split(body: &'a str) -> (Self, usize) {
        let close = body.find(CLOSE_TAG);
        let result_open = body
            .find(RESULT_OPEN)
            .filter(|open| close.is_none_or(|close| *open < close));
        if let Some(open) = result_open {
            let start = open + RESULT_OPEN.len();
            if let Some((result_end, end)) = result_and_end(body, start) {
                let notification = Self {
                    head: &body[..open],
                    result: Some(&body[start..result_end]),
                    tail: &body[result_end + RESULT_CLOSE.len()..end],
                };
                return (notification, end + CLOSE_TAG.len());
            }
        }
        let (end, spanned) = close.map_or((body.len(), body.len()), |close| {
            (close, close + CLOSE_TAG.len())
        });
        let notification = Self {
            head: &body[..end],
            result: None,
            tail: "",
        };
        (notification, spanned)
    }

    /// An element outside the result.
    fn element(&self, name: &str) -> Option<&'a str> {
        element(self.head, name).or_else(|| element(self.tail, name))
    }

    /// Every element `name` outside the result, in order.
    fn elements(&self, name: &str) -> Vec<&'a str> {
        let mut found = elements(self.head, name);
        found.extend(elements(self.tail, name));
        found
    }
}

/// Where a result starting at `start` ends and where its notification's
/// closing tag is; `None` without such a closing tag after a `</result>`.
fn result_and_end(body: &str, start: usize) -> Option<(usize, usize)> {
    body[start..].match_indices(CLOSE_TAG).find_map(|(at, _)| {
        let end = start + at;
        let after = body[end + CLOSE_TAG.len()..].trim_start();
        if !after.is_empty() && !after.starts_with(OPEN_TAG) {
            return None;
        }
        Some((start + body[start..end].rfind(RESULT_CLOSE)?, end))
    })
}

/// One report per task the notification names. Claude reports several tasks
/// in one notification (background agents a previous session left
/// unfinished); they share its status, summary and note, and only a single
/// task keeps the tool call that started it.
fn stored_reports(notification: &StoredNotification<'_>) -> Vec<TaskReport> {
    let task_ids: Vec<String> = notification
        .elements("task-id")
        .into_iter()
        .filter_map(|task_id| non_empty(Some(task_id)))
        .collect();
    let tool_use_id = if task_ids.len() == 1 {
        non_empty(notification.element("tool-use-id"))
    } else {
        None
    };
    let usage = notification.element("usage");
    task_ids
        .into_iter()
        .map(|task_id| TaskReport {
            task_id,
            tool_use_id: tool_use_id.clone(),
            status: non_empty(notification.element("status")),
            summary: non_empty(notification.element("summary")),
            note: non_empty(notification.element("note")),
            result: notification.result.map(ToOwned::to_owned),
            duration_ms: usage_count(usage, "duration_ms"),
            tool_uses: usage_count(usage, "tool_uses"),
        })
        .collect()
}

/// Every `<task-notification>` of a stored message, in order; one quoted
/// inside another's result is part of that result.
#[must_use]
pub fn stored_task_reports(text: &str) -> Vec<TaskReport> {
    let mut reports = Vec::new();
    let mut rest = text;
    while let Some(open) = rest.find(OPEN_TAG) {
        let body = &rest[open + OPEN_TAG.len()..];
        let (notification, spanned) = StoredNotification::split(body);
        reports.extend(stored_reports(&notification));
        rest = &body[spanned..];
    }
    reports
}

fn frame_count(usage: Option<&JsonRecord>, name: &str) -> Option<i64> {
    usage?
        .get(name)
        .and_then(Value::as_i64)
        .and_then(exact_count)
}

/// A live `task_notification` frame's report; `None` without a task id.
#[must_use]
pub fn live_task_report(frame: &JsonRecord) -> Option<TaskReport> {
    let task_id = str_of(frame, "task_id")?;
    let usage = record_of(frame, "usage");
    Some(TaskReport {
        task_id: task_id.to_owned(),
        tool_use_id: str_of(frame, "tool_use_id").map(ToOwned::to_owned),
        status: str_of(frame, "status").map(ToOwned::to_owned),
        summary: non_empty(str_of(frame, "summary")),
        note: None,
        result: None,
        duration_ms: frame_count(usage, "duration_ms"),
        tool_uses: frame_count(usage, "tool_uses"),
    })
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    const INTERIM_NOTE: &str = "This agent stopped with background work of its own still running; the result below may be interim.";

    #[test]
    fn a_stored_message_yields_every_report_with_every_field() {
        let text = format!(
            "<task-notification>\n<task-id>a0000000000000001</task-id>\n<tool-use-id>toolu_agent</tool-use-id>\n<output-file>/tmp/task.output</output-file>\n<status>completed</status>\n<summary>Agent \"Review\" finished</summary>\n<note>{INTERIM_NOTE}</note>\n<result>  Found <result>two</result> issues.  </result>\n<usage><subagent_tokens>900</subagent_tokens><tool_uses>4</tool_uses><duration_ms>12963</duration_ms></usage>\n</task-notification>\n<task-notification>\n<task-id>bwatch001</task-id>\n<status>killed</status>\n</task-notification>\n<task-notification><status>completed</status></task-notification>"
        );
        let reports = stored_task_reports(&text);
        assert_eq!(
            reports,
            [
                TaskReport {
                    task_id: "a0000000000000001".into(),
                    tool_use_id: Some("toolu_agent".into()),
                    status: Some("completed".into()),
                    summary: Some("Agent \"Review\" finished".into()),
                    note: Some(INTERIM_NOTE.into()),
                    result: Some("  Found <result>two</result> issues.  ".into()),
                    duration_ms: Some(12_963),
                    tool_uses: Some(4),
                },
                TaskReport {
                    task_id: "bwatch001".into(),
                    tool_use_id: None,
                    status: Some("killed".into()),
                    summary: None,
                    note: None,
                    result: None,
                    duration_ms: None,
                    tool_uses: None,
                },
            ]
        );
    }

    #[test]
    fn a_notification_quoted_in_a_result_is_part_of_that_result() {
        let quoted = "<task-notification>\n<task-id>bfake</task-id>\n<status>failed</status>\n<summary>Agent \"Fake\" failed</summary>\n<result>x</result>\n<usage><tool_uses>99</tool_uses></usage>\n</task-notification>";
        let result =
            format!("The log shows:\n{quoted}\nand <usage><duration_ms>7</duration_ms></usage>.");
        let text = format!(
            "<task-notification>\n<task-id>a0000000000000001</task-id>\n<status>completed</status>\n<summary>Agent \"Review\" finished</summary>\n<result>{result}</result>\n<usage><tool_uses>4</tool_uses><duration_ms>12963</duration_ms></usage>\n</task-notification>\n<task-notification>\n<task-id>btest0001</task-id>\n<status>completed</status>\n<result>ok</result>\n</task-notification>"
        );
        let reports = stored_task_reports(&text);
        assert_eq!(
            reports
                .iter()
                .map(|report| (
                    report.task_id.as_str(),
                    report.status.as_deref(),
                    report.result.as_deref(),
                    report.tool_uses,
                    report.duration_ms
                ))
                .collect::<Vec<_>>(),
            [
                (
                    "a0000000000000001",
                    Some("completed"),
                    Some(result.as_str()),
                    Some(4),
                    Some(12_963)
                ),
                ("btest0001", Some("completed"), Some("ok"), None, None),
            ]
        );
    }

    #[test]
    fn a_notification_naming_several_tasks_reports_each_of_them() {
        let reports = stored_task_reports(
            "<task-notification>\n<task-id>ac3e135eebe4b6f28</task-id>\n<task-id>aa0372f460af9cb14</task-id>\n<task-id>af34c2685a375acbd</task-id>\n<tool-use-id>toolu_x</tool-use-id>\n<status>stopped</status>\n<summary>3 background agents didn't finish before the previous session ended</summary>\n</task-notification>",
        );
        assert_eq!(
            reports
                .iter()
                .map(|report| (
                    report.task_id.as_str(),
                    report.status.as_deref(),
                    report.tool_use_id.as_deref()
                ))
                .collect::<Vec<_>>(),
            [
                ("ac3e135eebe4b6f28", Some("stopped"), None),
                ("aa0372f460af9cb14", Some("stopped"), None),
                ("af34c2685a375acbd", Some("stopped"), None),
            ]
        );
        assert!(reports.iter().all(|report| report.summary.as_deref()
            == Some("3 background agents didn't finish before the previous session ended")));
    }

    #[test]
    fn a_usage_line_in_text_form_is_read_too() {
        let reports = stored_task_reports(
            "<task-notification><task-id>t</task-id><usage>tool_uses: 3\nduration_ms: 41</usage></task-notification>",
        );
        assert_eq!(
            reports
                .first()
                .map(|report| (report.tool_uses, report.duration_ms)),
            Some((Some(3), Some(41)))
        );
    }

    #[test]
    fn a_live_frame_yields_its_report_without_text() -> Result<(), String> {
        let frame = json!({"type": "system", "subtype": "task_notification", "task_id": "bx1",
            "tool_use_id": "toolu_x", "status": "completed", "summary": "  ",
            "usage": {"duration_ms": 5183, "tool_uses": 1, "total_tokens": 10_750}});
        let report = frame
            .as_object()
            .and_then(live_task_report)
            .ok_or("no report")?;
        assert_eq!(
            report,
            TaskReport {
                task_id: "bx1".into(),
                tool_use_id: Some("toolu_x".into()),
                status: Some("completed".into()),
                summary: None,
                note: None,
                result: None,
                duration_ms: Some(5183),
                tool_uses: Some(1),
            }
        );
        let without_id = json!({"type": "system", "subtype": "task_notification"});
        assert_eq!(without_id.as_object().and_then(live_task_report), None);
        Ok(())
    }
}
