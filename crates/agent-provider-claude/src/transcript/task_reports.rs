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

/// The `<result>` text: up to its last closing tag, since a result may quote markup.
fn result_element(body: &str) -> Option<&str> {
    let start = body.find(RESULT_OPEN)? + RESULT_OPEN.len();
    let end = body.rfind(RESULT_CLOSE)?;
    (end >= start).then(|| &body[start..end])
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

fn stored_report(body: &str) -> Option<TaskReport> {
    let task_id = non_empty(element(body, "task-id"))?;
    let usage = element(body, "usage");
    Some(TaskReport {
        task_id,
        tool_use_id: non_empty(element(body, "tool-use-id")),
        status: non_empty(element(body, "status")),
        summary: non_empty(element(body, "summary")),
        note: non_empty(element(body, "note")),
        result: result_element(body).map(ToOwned::to_owned),
        duration_ms: usage_count(usage, "duration_ms"),
        tool_uses: usage_count(usage, "tool_uses"),
    })
}

/// Every `<task-notification>` of a stored message, in order.
#[must_use]
pub fn stored_task_reports(text: &str) -> Vec<TaskReport> {
    text.split(OPEN_TAG)
        .skip(1)
        .filter_map(|part| stored_report(part.rfind(CLOSE_TAG).map_or(part, |end| &part[..end])))
        .collect()
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
