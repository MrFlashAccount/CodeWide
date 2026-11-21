//! `forge.pullRequest.scenarioContext`: conflicts, failing checks with
//! bounded excerpts and review comments, all untrusted third-party text,
//! bounded to [`forge_protocol::MAX_SCENARIO_CONTEXT_BYTES`].

use forge_protocol::{
    FailingCheck, MAX_SCENARIO_CONTEXT_BYTES, PluginError, ScenarioComment, ScenarioContext,
    ScenarioKind,
};
use serde_json::Value;

use crate::{api::Api, repo::PullTarget};

const MAX_EXCERPT_CHARS: usize = 4_000;
const MAX_FAILING_CHECKS: usize = 10;
const MAX_COMMENTS: usize = 50;

/// # Errors
///
/// Returns the mapped GitHub failure.
pub async fn context(
    api: &Api,
    target: &PullTarget,
    scenario: ScenarioKind,
    check_id: Option<&str>,
) -> Result<ScenarioContext, PluginError> {
    let pull = target.fetch(api).await?;
    let mut context = ScenarioContext::default();
    if pull.get("mergeable_state").and_then(Value::as_str) == Some("dirty") {
        let text = |pointer: &str| {
            pull.pointer(pointer)
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_owned()
        };
        context.conflicts.push(format!(
            "{} conflicts with {}",
            text("/head/ref"),
            text("/base/ref")
        ));
    }
    if matches!(scenario, ScenarioKind::FixCi | ScenarioKind::Message) {
        let head = crate::repo::head_sha(&pull)?;
        let runs = api
            .get(
                &target.repo.path(&format!("/commits/{head}/check-runs")),
                &[("per_page", "100".into())],
            )
            .await?;
        context.failing_checks = runs
            .get("check_runs")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter(|run| {
                matches!(
                    run.get("conclusion").and_then(Value::as_str),
                    Some("failure" | "timed_out" | "startup_failure" | "action_required")
                )
            })
            .filter_map(|run| {
                let id = format!("run:{}", run.get("id")?.as_u64()?);
                if check_id.is_some_and(|wanted| wanted != id) {
                    return None;
                }
                let output = run.get("output");
                let excerpt = ["title", "summary", "text"]
                    .iter()
                    .filter_map(|field| output?.get(*field)?.as_str())
                    .collect::<Vec<_>>()
                    .join("\n");
                Some(FailingCheck {
                    check_id: id,
                    name: run.get("name")?.as_str()?.to_owned(),
                    log_excerpt: excerpt.chars().take(MAX_EXCERPT_CHARS).collect(),
                })
            })
            .take(MAX_FAILING_CHECKS)
            .collect();
    }
    if !matches!(scenario, ScenarioKind::FixCi | ScenarioKind::Rebase) {
        let query = [("per_page", "100".to_owned())];
        let review_comments = api.get(&target.path("/comments"), &query).await?;
        let issue_comments = api
            .get(
                &target
                    .repo
                    .path(&format!("/issues/{}/comments", target.number)),
                &query,
            )
            .await?;
        let mut comments = review_comments
            .as_array()
            .into_iter()
            .chain(issue_comments.as_array())
            .flatten()
            .filter_map(|comment| {
                Some(ScenarioComment {
                    author: comment.pointer("/user/login")?.as_str()?.to_owned(),
                    path: comment
                        .get("path")
                        .and_then(Value::as_str)
                        .map(str::to_owned),
                    line: comment
                        .get("line")
                        .and_then(Value::as_u64)
                        .and_then(|line| u32::try_from(line).ok()),
                    body: comment.get("body")?.as_str()?.to_owned(),
                })
            })
            .collect::<Vec<_>>();
        let skip = comments.len().saturating_sub(MAX_COMMENTS);
        context.comments = comments.drain(skip..).collect();
    }
    bound(&mut context);
    Ok(context)
}

/// Shrinks the context until its JSON fits the protocol bound: the oldest
/// comments go first, then excerpts are cut.
fn bound(context: &mut ScenarioContext) {
    let size =
        |context: &ScenarioContext| serde_json::to_vec(context).map_or(0, |bytes| bytes.len());
    while size(context) > MAX_SCENARIO_CONTEXT_BYTES && !context.comments.is_empty() {
        context.comments.remove(0);
    }
    while size(context) > MAX_SCENARIO_CONTEXT_BYTES && !context.failing_checks.is_empty() {
        for check in &mut context.failing_checks {
            let keep = check.log_excerpt.chars().count() / 2;
            check.log_excerpt = check.log_excerpt.chars().take(keep).collect();
        }
        if context
            .failing_checks
            .iter()
            .all(|check| check.log_excerpt.is_empty())
        {
            context.failing_checks.clear();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bounding_drops_oldest_comments_first() {
        let mut context = ScenarioContext {
            conflicts: Vec::new(),
            failing_checks: Vec::new(),
            comments: (0..40)
                .map(|index| ScenarioComment {
                    author: format!("user{index}"),
                    path: None,
                    line: None,
                    body: "x".repeat(4_000),
                })
                .collect(),
        };
        bound(&mut context);
        assert!(
            serde_json::to_vec(&context).map_or(0, |bytes| bytes.len())
                <= MAX_SCENARIO_CONTEXT_BYTES
        );
        assert_eq!(
            context
                .comments
                .last()
                .map(|comment| comment.author.as_str()),
            Some("user39")
        );
    }
}
