//! `companion/pullRequest/review/submit`: the only trigger that publishes
//! review comments and a verdict to a forge.
//!
//! Drafts must be pull request drafts of the same pull request at the
//! submitted head, with a PR axis that is pending or failed (retry).
//! Agent-only drafts are never sent by Submit. The verdict must be an
//! enabled `verdict` descriptor of the current catalog; a moved head answers
//! `-32082` before anything is written. The run is journaled like an action
//! run, so a repeated key returns the stored outcome without a second
//! forge call. Per-draft results make partial publication explicit; the
//! agent halves of `both` drafts are forwarded only when the client's
//! "Also send Both comments to agent" switch is on.

use std::collections::HashMap;

use forge_protocol::{
    CommentOutcomeState, DiffSide, ReviewComment, ReviewSubmitParams, ReviewSubmitResult, methods,
};
use serde::Deserialize;
use serde_json::{Value, json};
use tracing::info;

use super::{
    ForgeContext,
    action_run::{Addressed, catalog_at},
    actions::{ActionKind, Begin, RunKind, RunState},
    errors::ForgeError,
    ids::{HeadRevision, PullRequestKey, valid_idempotency_key},
    params,
    plugin_client::PluginSession,
};
use crate::review::{
    ReviewError,
    drafts::{AgentState, DraftComment, PrState, Routing, Side},
    source::DiffSource,
};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SubmitRequest {
    pull_request: Value,
    head_revision: String,
    verdict_action_id: String,
    body: Option<String>,
    draft_ids: Vec<String>,
    forward_both_to_agent: bool,
    idempotency_key: String,
}

impl From<ReviewError> for ForgeError {
    fn from(error: ReviewError) -> Self {
        match error {
            ReviewError::Invalid(message) => Self::InvalidParams(message),
            ReviewError::NotFound => Self::NotFound,
            ReviewError::Conflict(current) => Self::Conflict {
                current: serde_json::to_value(current).unwrap_or(Value::Null),
            },
            ReviewError::ConflictValue(current) => Self::Conflict { current },
            ReviewError::Unavailable(reason) | ReviewError::Source(reason) => {
                Self::CapabilityUnavailable { reason }
            }
            ReviewError::InvalidGuide(reason) => Self::InvalidGuide { reason },
            ReviewError::GuideTooLarge(hunks) => Self::GuideTooLarge { hunks },
            ReviewError::Internal(message) => Self::Internal(message),
        }
    }
}

fn now() -> String {
    super::wire::now_rfc3339()
}

/// # Errors
///
/// Returns `-32082` for a moved head (nothing written), `-32083` for a
/// forge refusal or unknown outcome, and invalid params for drafts that do
/// not belong to this submit.
pub async fn submit(context: &ForgeContext, raw: &Value) -> Result<Value, ForgeError> {
    let request: SubmitRequest = params(raw)?;
    if !valid_idempotency_key(&request.idempotency_key) {
        return Err(ForgeError::invalid("invalid idempotencyKey"));
    }
    let (key, identity) = ForgeContext::pull_request(&request.pull_request)?;
    let head = HeadRevision::parse(&request.head_revision)
        .ok_or_else(|| ForgeError::invalid("invalid headRevision"))?;
    if let Some(outcome) = context.journal.peek(
        &request.idempotency_key,
        RunKind::Submit,
        &key,
        &request.verdict_action_id,
    )? {
        return outcome.map_err(ForgeError::Replayed);
    }
    if request
        .body
        .as_ref()
        .is_some_and(|body| body.chars().count() > 65_536)
    {
        return Err(ForgeError::invalid("the review body is too long"));
    }
    if has_repeats(&request.draft_ids) {
        return Err(ForgeError::invalid("draftIds repeat a draft"));
    }
    // A fast rejection before any plugin call; the claim inside the run is
    // the authoritative, atomic check.
    let drafts = context.review.drafts().load(&request.draft_ids)?;
    validate_drafts(&drafts, &key, &head)?;
    let account = context.account_for(&key, &identity)?;
    let mut session = context.session(&identity.plugin_id).await?;
    let addressed = Addressed {
        key: &key,
        identity: &identity,
        account: &account,
    };
    let result = submit_in_session(context, &mut session, &request, &addressed, &head).await;
    session.shutdown().await;
    let source = DiffSource::PullRequest {
        pull_request: key.as_str().to_owned(),
    };
    context.review.events().invalidated(&source).await;
    if result.is_ok() {
        context.cache.invalidate_pull_request(&key);
        context.events.pull_request(&key).await;
    }
    result.map_err(|error| context.observe(&account, error))
}

/// Whether an id occurs twice; a repeated draft would be published twice.
fn has_repeats(ids: &[String]) -> bool {
    let mut seen = std::collections::HashSet::with_capacity(ids.len());
    !ids.iter().all(|id| seen.insert(id.as_str()))
}

fn validate_drafts(
    drafts: &[DraftComment],
    key: &PullRequestKey,
    head: &HeadRevision,
) -> Result<(), ForgeError> {
    for draft in drafts {
        let same_pull_request = matches!(
            &draft.revision.source,
            DiffSource::PullRequest { pull_request } if pull_request == key.as_str()
        );
        if !same_pull_request || draft.revision.revision != head.as_str() {
            return Err(ForgeError::invalid(
                "every draft must belong to this pull request at this head",
            ));
        }
        match draft.routing.pr() {
            Some(pr) if matches!(pr.state, PrState::Pending | PrState::Failed) => {}
            Some(_) => return Err(ForgeError::invalid("a draft is not ready to submit")),
            None => return Err(ForgeError::invalid("agent-only drafts are never submitted")),
        }
    }
    Ok(())
}

async fn submit_in_session(
    context: &ForgeContext,
    session: &mut PluginSession,
    request: &SubmitRequest,
    addressed: &Addressed<'_>,
    head: &HeadRevision,
) -> Result<Value, ForgeError> {
    let actions = catalog_at(session, addressed, head).await?;
    let verdict = actions
        .iter()
        .find(|action| {
            action.action_id == request.verdict_action_id && action.kind == ActionKind::Verdict
        })
        .ok_or_else(|| ForgeError::invalid("unknown verdict for this head"))?;
    if !verdict.enabled() {
        return Err(ForgeError::invalid("the verdict is disabled"));
    }
    let record = match context.journal.begin(
        &request.idempotency_key,
        RunKind::Submit,
        addressed.key,
        &request.verdict_action_id,
    )? {
        Begin::Run(record) => record,
        Begin::Replay(outcome) => return outcome.map_err(ForgeError::Replayed),
    };
    // From here the journal always gets a terminal record.
    let result = claimed_submit(context, session, request, addressed, head, &record).await;
    let (state, stored, error) = match &result {
        Ok(value) => (RunState::Succeeded, Some(value.clone()), None),
        Err(error @ ForgeError::OutcomeUnknown { .. }) => {
            (RunState::Unknown, None, Some(error.to_rpc_error()))
        }
        Err(error @ ForgeError::StaleHead { .. }) => {
            (RunState::RejectedStale, None, Some(error.to_rpc_error()))
        }
        Err(error) => (RunState::Rejected, None, Some(error.to_rpc_error())),
    };
    context
        .journal
        .finish(&request.idempotency_key, &record, state, stored, error)?;
    info!(run_id = %record.run_id, outcome = ?state, "review submit ended");
    result
}

/// Ends the in-process submit marker of claimed drafts on every path.
struct ClaimGuard<'a> {
    store: &'a crate::review::drafts::DraftStore,
    ids: Vec<String>,
}

impl Drop for ClaimGuard<'_> {
    fn drop(&mut self) {
        self.store.end_submit(&self.ids);
    }
}

/// Claims the drafts atomically, publishes the claimed snapshot and records
/// each draft's outcome.
async fn claimed_submit(
    context: &ForgeContext,
    session: &mut PluginSession,
    request: &SubmitRequest,
    addressed: &Addressed<'_>,
    head: &HeadRevision,
    record: &super::actions::RunRecord,
) -> Result<Value, ForgeError> {
    let store = context.review.drafts();
    let drafts = store.claim_for_submit(
        &request.draft_ids,
        addressed.key.as_str(),
        head.as_str(),
        &now(),
    )?;
    let ids: Vec<String> = drafts.iter().map(|draft| draft.id.clone()).collect();
    let _guard = ClaimGuard {
        store,
        ids: ids.clone(),
    };
    info!(pull_request = %addressed.key.log_hash(), run_id = %record.run_id, drafts = ids.len(), "review submit started");
    let published = publish(session, request, addressed, head, &drafts).await;
    let settled = settle(&ids, published);
    store.update_axes(&ids, &now(), |id, routing| {
        if let (Some((state, error)), Some(pr)) = (settled.per_draft.get(id), pr_axis(routing)) {
            pr.state = *state;
            pr.error.clone_from(error);
        }
    })?;
    if let Some(error) = settled.failure {
        return Err(match error {
            ForgeError::Internal(_) => ForgeError::OutcomeUnknown {
                run_id: record.run_id.clone(),
            },
            other => other,
        });
    }
    let agent = if request.forward_both_to_agent {
        forward_both(context, &ids, &request.idempotency_key).await?
    } else {
        HashMap::new()
    };
    Ok(outcome_value(
        &record.run_id,
        settled
            .review_url
            .as_deref()
            .filter(|url| super::wire::https_on_host(url, &addressed.identity.pr_ref.host)),
        &ids,
        &settled.per_draft,
        &agent,
    ))
}

/// The single forge write of a Submit.
async fn publish(
    session: &mut PluginSession,
    request: &SubmitRequest,
    addressed: &Addressed<'_>,
    head: &HeadRevision,
    drafts: &[DraftComment],
) -> Result<ReviewSubmitResult, ForgeError> {
    let comments: Vec<ReviewComment> = drafts
        .iter()
        .map(|draft| ReviewComment {
            draft_id: draft.id.clone(),
            path: draft.anchor.path.clone(),
            side: match draft.anchor.side {
                Side::New => DiffSide::New,
                Side::Old => DiffSide::Old,
            },
            start_line: draft.anchor.start_line,
            end_line: draft.anchor.end_line,
            body: draft.body.clone(),
        })
        .collect();
    session
        .call(
            methods::PULL_REQUEST_REVIEW_SUBMIT,
            &ReviewSubmitParams {
                account: addressed.account.account_ref(),
                pr_ref: addressed.identity.pr_ref.clone(),
                head_revision: head.as_str().to_owned(),
                verdict_action_id: request.verdict_action_id.clone(),
                body: request.body.clone(),
                comments,
                idempotency_key: request.idempotency_key.clone(),
            },
        )
        .await
        .map_err(|error| addressed.map(error))
}

/// Per-draft PR axis outcomes of a Submit.
struct Settled {
    per_draft: HashMap<String, (PrState, Option<String>)>,
    review_url: Option<String>,
    failure: Option<ForgeError>,
}

/// Maps the plugin result to per-draft states. A typed error for the whole
/// review fails every draft; a local failure is `outcomeUnknown`.
fn settle(ids: &[String], published: Result<ReviewSubmitResult, ForgeError>) -> Settled {
    match published {
        Ok(result) => {
            let reported: HashMap<String, (CommentOutcomeState, Option<String>)> = result
                .comments
                .into_iter()
                .map(|comment| (comment.draft_id, (comment.state, comment.error)))
                .collect();
            let per_draft = ids
                .iter()
                .map(|id| {
                    let state = match reported.get(id) {
                        Some((CommentOutcomeState::Published, _)) => (PrState::Published, None),
                        Some((CommentOutcomeState::Outdated, error)) => {
                            (PrState::Outdated, bounded(error.as_deref()))
                        }
                        Some((CommentOutcomeState::Failed, error)) => {
                            (PrState::Failed, bounded(error.as_deref()))
                        }
                        None => (
                            PrState::Failed,
                            Some("The forge did not report this comment".into()),
                        ),
                    };
                    (id.clone(), state)
                })
                .collect();
            Settled {
                per_draft,
                review_url: result.review_url,
                failure: None,
            }
        }
        Err(error) => {
            let reason = match &error {
                ForgeError::Internal(_) => "outcomeUnknown".to_owned(),
                other => other.log_kind().to_owned(),
            };
            Settled {
                per_draft: ids
                    .iter()
                    .map(|id| (id.clone(), (PrState::Failed, Some(reason.clone()))))
                    .collect(),
                review_url: None,
                failure: Some(error),
            }
        }
    }
}

/// Forwards the agent halves of `both` drafts (the Submit switch).
async fn forward_both(
    context: &ForgeContext,
    ids: &[String],
    idempotency_key: &str,
) -> Result<HashMap<String, Result<(), String>>, ForgeError> {
    let both: Vec<DraftComment> = context
        .review
        .drafts()
        .load(ids)?
        .into_iter()
        .filter(|draft| matches!(draft.routing, Routing::Both { .. }))
        .collect();
    Ok(context
        .review
        .forward(&both, idempotency_key, |axis| {
            axis.state == AgentState::Pending
        })
        .await?
        .into_iter()
        .collect())
}

fn outcome_value(
    run_id: &str,
    review_url: Option<&str>,
    ids: &[String],
    per_draft: &HashMap<String, (PrState, Option<String>)>,
    agent: &HashMap<String, Result<(), String>>,
) -> Value {
    json!({
        "runId": run_id,
        "reviewUrl": review_url,
        "drafts": ids.iter().map(|id| {
            let (state, error) = per_draft.get(id).cloned().unwrap_or((PrState::Failed, None));
            json!({
                "draftId": id,
                "pr": match state {
                    PrState::Published => "published",
                    PrState::Outdated => "outdated",
                    _ => "failed",
                },
                "error": error,
                "agent": match agent.get(id) {
                    Some(Ok(())) => "sent",
                    Some(Err(_)) => "failed",
                    None => "notRequested",
                },
            })
        }).collect::<Vec<_>>(),
    })
}

fn pr_axis(routing: &mut Routing) -> Option<&mut crate::review::drafts::PrAxis> {
    match routing {
        Routing::Pr { pr } | Routing::Both { pr, .. } => Some(pr),
        Routing::Agent { .. } => None,
    }
}

fn bounded(error: Option<&str>) -> Option<String> {
    error.map(|error| error.chars().take(300).collect())
}
