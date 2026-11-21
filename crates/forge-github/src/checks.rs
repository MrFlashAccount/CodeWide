//! `forge.pullRequest.checks`: check runs and commit statuses of one head.

use forge_protocol::{CheckItem, CheckItemState, ChecksResult, PluginError};
use serde_json::Value;

use crate::{
    api::Api,
    pulls::{Tally, run_bucket, status_bucket},
    repo::PullTarget,
};

/// `forge.pullRequest.checks`: check runs and commit statuses of one head.
///
/// # Errors
///
/// Returns the mapped GitHub failure.
pub async fn checks(
    api: &Api,
    target: &PullTarget,
    head_revision: &str,
) -> Result<ChecksResult, PluginError> {
    if head_revision.is_empty() || !head_revision.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(PluginError::invalid_params("invalid head revision"));
    }
    let runs = api
        .get(
            &target
                .repo
                .path(&format!("/commits/{head_revision}/check-runs")),
            &[("per_page", "100".into())],
        )
        .await?;
    let statuses = api
        .get(
            &target
                .repo
                .path(&format!("/commits/{head_revision}/status")),
            &[],
        )
        .await?;
    let mut tally = Tally::default();
    let mut items = Vec::new();
    for run in runs
        .get("check_runs")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        let Some(id) = run.get("id").and_then(Value::as_u64) else {
            continue;
        };
        let conclusion = run.get("conclusion").and_then(Value::as_str);
        let status = run.get("status").and_then(Value::as_str).unwrap_or("");
        let bucket_state = conclusion.unwrap_or(status);
        tally.add(run_bucket(bucket_state), 1);
        items.push(CheckItem {
            check_id: format!("run:{id}"),
            name: run
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or("check")
                .to_owned(),
            state: match conclusion {
                Some("success" | "neutral") => CheckItemState::Passed,
                Some("skipped") => CheckItemState::Skipped,
                Some("cancelled") => CheckItemState::Cancelled,
                Some(_) => CheckItemState::Failed,
                None => CheckItemState::Pending,
            },
            duration_seconds: duration(run),
            details_url: run
                .get("html_url")
                .or_else(|| run.get("details_url"))
                .and_then(Value::as_str)
                .map(str::to_owned),
        });
    }
    for status in statuses
        .get("statuses")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        let Some(context) = status.get("context").and_then(Value::as_str) else {
            continue;
        };
        let state = status.get("state").and_then(Value::as_str).unwrap_or("");
        tally.add(status_bucket(state), 1);
        items.push(CheckItem {
            check_id: format!("status:{context}"),
            name: context.to_owned(),
            state: match state {
                "success" => CheckItemState::Passed,
                "failure" | "error" => CheckItemState::Failed,
                _ => CheckItemState::Pending,
            },
            duration_seconds: None,
            details_url: status
                .get("target_url")
                .and_then(Value::as_str)
                .map(str::to_owned),
        });
    }
    Ok(ChecksResult {
        summary: tally.summary(),
        items,
    })
}

fn duration(run: &Value) -> Option<u64> {
    let parse = |field: &str| {
        let text = run.get(field)?.as_str()?;
        time::OffsetDateTime::parse(text, &time::format_description::well_known::Rfc3339).ok()
    };
    let started = parse("started_at")?;
    let completed = parse("completed_at")?;
    u64::try_from((completed - started).whole_seconds()).ok()
}
