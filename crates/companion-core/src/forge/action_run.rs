//! `companion/pullRequest/action/run`: the only trigger of a catalog action
//! (merge, close, update branch, auto-merge, extensions).
//!
//! Order of checks, each before any forge write: the idempotency key (a
//! known key replays its stored outcome), a fresh catalog for the requested
//! head (a moved head answers `-32082` with that catalog), the descriptor
//! (enabled, not a verdict or scenario), the effective confirmation level
//! (`-32089` below it), the input. Only then is the run journaled `started`
//! and the plugin called.

use forge_protocol::{
    ActionRunParams, ActionRunResult, PullRequestParams, RawActionCatalog, methods,
};
use serde::Deserialize;
use serde_json::{Value, json};
use tracing::info;

use super::{
    ForgeContext,
    accounts::AccountLink,
    actions::{
        ActionDescriptor, Begin, RunKind, RunRecord, RunState, catalog_wire, parse_catalog,
        validate_input,
    },
    errors::{Confirmation, ForgeError},
    ids::{HeadRevision, PullRequestIdentity, PullRequestKey, valid_idempotency_key},
    params,
    plugin_client::PluginSession,
    wire::ActionCatalogWire,
};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RunRequest {
    pull_request: Value,
    action_id: String,
    head_revision: String,
    input: Value,
    confirmation: Confirmation,
    idempotency_key: String,
}

/// # Errors
///
/// Returns `-32082` for a moved head, `-32089` for insufficient
/// confirmation, `-32083` for a forge refusal or an unknown outcome, and
/// invalid params for verdicts, scenarios or a reused key.
pub async fn run(context: &ForgeContext, raw: &Value) -> Result<Value, ForgeError> {
    let request: RunRequest = params(raw)?;
    if !valid_idempotency_key(&request.idempotency_key) {
        return Err(ForgeError::invalid("invalid idempotencyKey"));
    }
    let (key, identity) = ForgeContext::pull_request(&request.pull_request)?;
    let head = HeadRevision::parse(&request.head_revision)
        .ok_or_else(|| ForgeError::invalid("invalid headRevision"))?;
    if let Some(replay) = replay(context, &request, &key)? {
        return replay;
    }
    let account = context.account_for(&key, &identity)?;
    let mut session = context.session(&identity.plugin_id).await?;
    let addressed = Addressed {
        key: &key,
        identity: &identity,
        account: &account,
    };
    let result = run_in_session(context, &mut session, &request, &addressed, &head).await;
    session.shutdown().await;
    if result.is_ok() || matches!(result, Err(ForgeError::StaleHead { .. })) {
        context.cache.invalidate_pull_request(&key);
        context.events.pull_request(&key).await;
        context.events.list().await;
    }
    result.map_err(|error| context.observe(&account, error))
}

/// A known idempotency key answers from the journal without a plugin call.
fn replay(
    context: &ForgeContext,
    request: &RunRequest,
    key: &PullRequestKey,
) -> Result<Option<Result<Value, ForgeError>>, ForgeError> {
    Ok(context
        .journal
        .peek(
            &request.idempotency_key,
            RunKind::Action,
            key,
            &request.action_id,
        )?
        .map(|outcome| outcome.map_err(ForgeError::Replayed)))
}

/// The pull request and account a write addresses.
pub(super) struct Addressed<'a> {
    pub(super) key: &'a PullRequestKey,
    pub(super) identity: &'a PullRequestIdentity,
    pub(super) account: &'a AccountLink,
}

impl Addressed<'_> {
    pub(super) fn target(&self) -> PullRequestParams {
        PullRequestParams {
            account: self.account.account_ref(),
            pr_ref: self.identity.pr_ref.clone(),
        }
    }

    pub(super) fn map(&self, error: super::plugin_client::PluginCallError) -> ForgeError {
        ForgeError::from_plugin(&self.identity.plugin_id, Some(&self.account.key), error)
    }
}

/// The validated catalog at `head`; a moved head answers `-32082` with the
/// fresh catalog before anything is written.
///
/// # Errors
///
/// Returns `-32082` for a moved head or the mapped plugin failure.
pub(super) async fn catalog_at(
    session: &mut PluginSession,
    addressed: &Addressed<'_>,
    head: &HeadRevision,
) -> Result<Vec<ActionDescriptor>, ForgeError> {
    let catalog: RawActionCatalog = session
        .call(methods::PULL_REQUEST_ACTIONS, &addressed.target())
        .await
        .map_err(|error| addressed.map(error))?;
    let current = HeadRevision::parse(&catalog.head_revision)
        .ok_or_else(|| ForgeError::internal("the plugin returned an invalid head revision"))?;
    let actions = parse_catalog(&catalog.actions);
    if current != *head {
        return Err(ForgeError::StaleHead {
            catalog: serde_json::to_value(catalog_wire(current.clone(), &actions)).ok(),
            head_revision: current,
        });
    }
    Ok(actions)
}

async fn run_in_session(
    context: &ForgeContext,
    session: &mut PluginSession,
    request: &RunRequest,
    addressed: &Addressed<'_>,
    head: &HeadRevision,
) -> Result<Value, ForgeError> {
    let key = addressed.key;
    let target = addressed.target();
    let actions = catalog_at(session, addressed, head).await?;
    let action = authorize(&actions, request)?;
    let record = match context.journal.begin(
        &request.idempotency_key,
        RunKind::Action,
        key,
        &request.action_id,
    )? {
        Begin::Run(record) => record,
        Begin::Replay(Ok(value)) => return Ok(value),
        Begin::Replay(Err(error)) => return Err(ForgeError::Replayed(error)),
    };
    info!(
        pull_request = %key.log_hash(),
        action_id = %action.action_id,
        run_id = %record.run_id,
        "forge action run started"
    );
    let ran: Result<ActionRunResult, _> = session
        .call(
            methods::PULL_REQUEST_ACTION_RUN,
            &ActionRunParams {
                account: addressed.account.account_ref(),
                pr_ref: addressed.identity.pr_ref.clone(),
                action_id: action.action_id.clone(),
                head_revision: head.as_str().to_owned(),
                input: request.input.clone(),
                idempotency_key: request.idempotency_key.clone(),
            },
        )
        .await;
    match ran {
        Ok(result) => {
            let refreshed = refreshed_catalog(session, &target).await;
            let value = json!({
                "runId": record.run_id,
                "message": result.message.map(|message| message.chars().take(300).collect::<String>()),
                "catalog": refreshed,
            });
            finish(
                context,
                request,
                &record,
                RunState::Succeeded,
                Some(value.clone()),
                None,
            )?;
            Ok(value)
        }
        Err(error) => {
            let (state, error) =
                classify(session, &target, &record.run_id, addressed.map(error)).await;
            finish(
                context,
                request,
                &record,
                state,
                None,
                Some(error.to_rpc_error()),
            )?;
            info!(run_id = %record.run_id, outcome = ?state, "forge action run ended");
            Err(error)
        }
    }
}

/// The journal state of a failed run: a moved head carries the refreshed
/// catalog; a local failure (timeout, transport) is an unknown outcome.
async fn classify(
    session: &mut PluginSession,
    target: &PullRequestParams,
    run_id: &str,
    error: ForgeError,
) -> (RunState, ForgeError) {
    match error {
        ForgeError::StaleHead { head_revision, .. } => {
            let catalog = refreshed_catalog(session, target).await;
            (
                RunState::RejectedStale,
                ForgeError::StaleHead {
                    head_revision,
                    catalog: catalog.and_then(|catalog| serde_json::to_value(catalog).ok()),
                },
            )
        }
        ForgeError::Internal(_) => (
            RunState::Unknown,
            ForgeError::OutcomeUnknown {
                run_id: run_id.to_owned(),
            },
        ),
        other => (RunState::Rejected, other),
    }
}

fn finish(
    context: &ForgeContext,
    request: &RunRequest,
    record: &RunRecord,
    state: RunState,
    result: Option<Value>,
    error: Option<Value>,
) -> Result<(), ForgeError> {
    context
        .journal
        .finish(&request.idempotency_key, record, state, result, error)
}

/// The descriptor a run may execute.
fn authorize<'a>(
    actions: &'a [ActionDescriptor],
    request: &RunRequest,
) -> Result<&'a ActionDescriptor, ForgeError> {
    let action = actions
        .iter()
        .find(|action| action.action_id == request.action_id)
        .ok_or_else(|| ForgeError::invalid("unknown action for this head"))?;
    if action.kind.runs_elsewhere() {
        return Err(ForgeError::invalid(
            "verdicts run through Submit review and scenarios through scenario/start",
        ));
    }
    if !action.enabled() {
        return Err(ForgeError::invalid("the action is disabled"));
    }
    let required = action.effective_confirmation();
    if request.confirmation < required {
        return Err(ForgeError::ConfirmationRequired { required });
    }
    validate_input(action, &request.input)?;
    Ok(action)
}

async fn refreshed_catalog(
    session: &mut PluginSession,
    target: &PullRequestParams,
) -> Option<ActionCatalogWire> {
    let catalog: RawActionCatalog = session
        .call(methods::PULL_REQUEST_ACTIONS, target)
        .await
        .ok()?;
    let head = HeadRevision::parse(&catalog.head_revision)?;
    Some(catalog_wire(head, &parse_catalog(&catalog.actions)))
}

#[cfg(test)]
#[allow(clippy::expect_used)]
mod tests {
    use super::*;
    use crate::forge::actions::parse_descriptor;

    fn request(action_id: &str, confirmation: Confirmation, input: Value) -> RunRequest {
        RunRequest {
            pull_request: Value::Null,
            action_id: action_id.into(),
            head_revision: "h".into(),
            input,
            confirmation,
            idempotency_key: "k".into(),
        }
    }

    #[test]
    fn a_merge_marked_none_still_needs_destructive_confirmation() {
        let merge = parse_descriptor(&json!({
            "actionId": "merge", "kind": "merge", "group": "merge", "label": "Merge",
            "availability": {"state": "enabled"}, "confirm": "none", "placement": "primary",
            "order": 1, "isDefault": true, "anchor": null
        }))
        .expect("merge");
        let verdict = parse_descriptor(&json!({
            "actionId": "approve", "kind": "verdict", "group": "verdict", "label": "Approve",
            "availability": {"state": "enabled"}, "confirm": "none", "placement": "secondary",
            "order": 2, "isDefault": false, "anchor": null
        }))
        .expect("verdict");
        let actions = vec![merge, verdict];
        for confirmation in [Confirmation::None, Confirmation::Confirm] {
            assert_eq!(
                authorize(&actions, &request("merge", confirmation, Value::Null)).err(),
                Some(ForgeError::ConfirmationRequired {
                    required: Confirmation::Destructive
                })
            );
        }
        assert!(
            authorize(
                &actions,
                &request("merge", Confirmation::Destructive, Value::Null)
            )
            .is_ok()
        );
        assert!(matches!(
            authorize(
                &actions,
                &request("approve", Confirmation::Destructive, Value::Null)
            ),
            Err(ForgeError::InvalidParams(_))
        ));
    }
}
