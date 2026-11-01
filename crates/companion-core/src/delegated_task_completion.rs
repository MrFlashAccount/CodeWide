//! Wire contract for the model-only child-agent result notice sent to a
//! parent model. Producers serialize it here; client projection validates and
//! recognizes the same versioned envelope.
//!
//! Version 2 carries one or more reports (one per settled child work
//! request). Version 1 (one delegated task) stays readable because it is
//! persisted in provider transcripts.

use agent_core::{model::ProviderCost, user_text::DELEGATED_TASK_CONTEXT_PREFIX};
use serde::{Deserialize, Serialize};

const VERSION_1: u8 = 1;
const VERSION: u8 = 2;

/// Terminal state carried to the parent model. It intentionally keeps
/// orchestration's public vocabulary rather than borrowing a provider state.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum DelegatedTaskStatus {
    Succeeded,
    Failed,
    /// A user or system interrupt (not a parent cancel).
    Interrupted,
    Cancelled,
}

impl DelegatedTaskStatus {
    /// The client task-notification status of this outcome.
    const fn notification_status(self) -> &'static str {
        match self {
            Self::Succeeded => "completed",
            Self::Failed => "failed",
            Self::Interrupted => "interrupted",
            Self::Cancelled => "stopped",
        }
    }
}

/// Version 1: one durable delegated-task completion. Read-only compatibility.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DelegatedTaskCompletion {
    pub(crate) task_id: String,
    pub(crate) attempt_id: String,
    pub(crate) agent_thread_id: Option<String>,
    pub(crate) name: Option<String>,
    pub(crate) status: DelegatedTaskStatus,
    pub(crate) final_message: Option<String>,
    pub(crate) result_truncated: bool,
    pub(crate) cost: Option<ProviderCost>,
}

/// One child agent's settled result. The parent model receives the full
/// text; clients project only identity and status.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ChildResultReport {
    pub(crate) request_id: String,
    /// The durable task, for `codewide_wait_task`; absent for a follow-up.
    pub(crate) task_id: Option<String>,
    pub(crate) agent_thread_id: Option<String>,
    pub(crate) turn_id: Option<String>,
    pub(crate) name: Option<String>,
    pub(crate) status: DelegatedTaskStatus,
    pub(crate) final_message: Option<String>,
    pub(crate) result_truncated: bool,
    /// Provider history stayed unreadable: the text is absent and `note`
    /// tells the model how to read it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) note: Option<String>,
    pub(crate) cost: Option<ProviderCost>,
}

/// A batch of reports delivered as one parent notice.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ChildResultNotice {
    /// Human summary, e.g. "2 agent results".
    pub(crate) summary: String,
    pub(crate) reports: Vec<ChildResultReport>,
}

impl ChildResultNotice {
    #[must_use]
    pub(crate) fn new(reports: Vec<ChildResultReport>) -> Self {
        let summary = match reports.len() {
            1 => "1 agent result".to_owned(),
            count => format!("{count} agent results"),
        };
        Self { summary, reports }
    }
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct Envelope {
    version: u8,
    #[serde(flatten)]
    notice: ChildResultNotice,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct EnvelopeV1 {
    version: u8,
    #[serde(flatten)]
    completion: DelegatedTaskCompletion,
}

pub(crate) fn serialize(notice: ChildResultNotice) -> Result<String, serde_json::Error> {
    let payload = serde_json::to_string(&Envelope {
        version: VERSION,
        notice,
    })?;
    Ok(format!("{DELEGATED_TASK_CONTEXT_PREFIX}\n{payload}"))
}

/// Serializes a version 1 envelope (fixtures of persisted transcripts).
#[cfg(test)]
pub(crate) fn serialize_v1(
    completion: DelegatedTaskCompletion,
) -> Result<String, serde_json::Error> {
    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    struct Out {
        version: u8,
        #[serde(flatten)]
        completion: DelegatedTaskCompletion,
    }
    let payload = serde_json::to_string(&Out {
        version: VERSION_1,
        completion,
    })?;
    Ok(format!("{DELEGATED_TASK_CONTEXT_PREFIX}\n{payload}"))
}

/// One projected report: identity and status only, never the result text.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct ProjectedReport {
    pub(crate) request_id: Option<String>,
    pub(crate) task_id: String,
    pub(crate) agent_thread_id: Option<String>,
    pub(crate) turn_id: Option<String>,
    pub(crate) name: Option<String>,
    pub(crate) status: &'static str,
}

/// Parses either envelope version into its client projection.
pub(crate) fn parse(text: &str) -> Option<Vec<ProjectedReport>> {
    let payload = text
        .trim_start()
        .strip_prefix(DELEGATED_TASK_CONTEXT_PREFIX)?
        .strip_prefix('\n')?;
    let version = serde_json::from_str::<serde_json::Value>(payload)
        .ok()?
        .get("version")?
        .as_u64()?;
    match u8::try_from(version).ok()? {
        VERSION_1 => parse_v1(payload).map(|report| vec![report]),
        VERSION => parse_v2(payload),
        _ => None,
    }
}

fn non_blank(value: Option<&str>) -> bool {
    value.is_none_or(|value| !value.trim().is_empty())
}

fn parse_v1(payload: &str) -> Option<ProjectedReport> {
    let envelope: EnvelopeV1 = serde_json::from_str(payload).ok()?;
    let completion = envelope.completion;
    if envelope.version != VERSION_1
        || completion.task_id.trim().is_empty()
        || completion.attempt_id.trim().is_empty()
        || !non_blank(completion.agent_thread_id.as_deref())
    {
        return None;
    }
    Some(ProjectedReport {
        request_id: None,
        task_id: completion.task_id,
        agent_thread_id: completion.agent_thread_id,
        turn_id: None,
        name: completion.name,
        status: completion.status.notification_status(),
    })
}

fn parse_v2(payload: &str) -> Option<Vec<ProjectedReport>> {
    let envelope: Envelope = serde_json::from_str(payload).ok()?;
    if envelope.version != VERSION || envelope.notice.reports.is_empty() {
        return None;
    }
    envelope
        .notice
        .reports
        .into_iter()
        .map(|report| {
            if report.request_id.trim().is_empty()
                || !non_blank(report.task_id.as_deref())
                || !non_blank(report.agent_thread_id.as_deref())
                || !non_blank(report.turn_id.as_deref())
            {
                return None;
            }
            Some(ProjectedReport {
                task_id: report.task_id.unwrap_or_else(|| report.request_id.clone()),
                request_id: Some(report.request_id),
                agent_thread_id: report.agent_thread_id,
                turn_id: report.turn_id,
                name: report.name,
                status: report.status.notification_status(),
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn report(request: &str, status: DelegatedTaskStatus) -> ChildResultReport {
        ChildResultReport {
            request_id: request.into(),
            task_id: None,
            agent_thread_id: Some(format!("child-{request}")),
            turn_id: Some(format!("turn-{request}")),
            name: Some(format!("Agent {request}")),
            status,
            final_message: Some("private result".into()),
            result_truncated: false,
            note: None,
            cost: None,
        }
    }

    #[test]
    fn a_batched_notice_round_trips_with_its_summary() -> Result<(), serde_json::Error> {
        let notice = ChildResultNotice::new(vec![
            report("r1", DelegatedTaskStatus::Succeeded),
            report("r2", DelegatedTaskStatus::Interrupted),
        ]);
        assert_eq!(notice.summary, "2 agent results");
        let text = serialize(notice)?;
        let parsed =
            parse(&text).ok_or_else(|| serde_json::Error::io(std::io::Error::other("unparsed")))?;
        assert_eq!(parsed.len(), 2);
        assert_eq!(parsed[0].task_id, "r1");
        assert_eq!(parsed[1].status, "interrupted");
        assert_eq!(parsed[1].turn_id.as_deref(), Some("turn-r2"));
        Ok(())
    }

    // Version 1 envelopes are persisted in provider transcripts and must stay
    // readable after the batched version 2 format.
    #[test]
    fn a_persisted_version_1_completion_still_parses() -> Result<(), serde_json::Error> {
        let text = serialize_v1(DelegatedTaskCompletion {
            task_id: "task-1".into(),
            attempt_id: "attempt-1".into(),
            agent_thread_id: Some("child-1".into()),
            name: Some("Review".into()),
            status: DelegatedTaskStatus::Cancelled,
            final_message: Some("done".into()),
            result_truncated: false,
            cost: None,
        })?;
        assert_eq!(
            parse(&text),
            Some(vec![ProjectedReport {
                request_id: None,
                task_id: "task-1".into(),
                agent_thread_id: Some("child-1".into()),
                turn_id: None,
                name: Some("Review".into()),
                status: "stopped",
            }])
        );
        Ok(())
    }

    #[test]
    fn invalid_envelopes_are_not_notices() {
        assert!(parse("CodeWide delegated task completion:\n{\"version\":9}").is_none());
        assert!(
            parse("CodeWide delegated task completion:\n{\"version\":2,\"summary\":\"x\",\"reports\":[]}")
                .is_none()
        );
        assert!(parse("hello").is_none());
    }
}
