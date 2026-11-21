//! `companion/pullRequest/reviewThread/resolve`: the only trigger of a
//! conversation resolution change (`forge.conversation.resolve@1`). It
//! resolves or unresolves one review thread whose resolution is
//! `conversation`, immediately, as on the forge itself. Issue states are not
//! part of this write.
//!
//! Order, each step before any forge write: the idempotency key and the
//! thread id, a replay of a known key from the journal, the account and the
//! declared capability. Only then is the write journaled `started` and the
//! plugin called. A local failure after that point (timeout, a plugin that
//! died) ends as `outcomeUnknown`; any outcome that may have written drops
//! the pull request's cache and emits its invalidation.

use forge_protocol::{ReviewThreadResolveParams, ReviewThreadResolveResult, capability, methods};
use serde::Deserialize;
use serde_json::Value;
use tracing::info;

use super::{
    ForgeContext,
    actions::{Begin, RunKind, RunState},
    errors::ForgeError,
    ids::{ReviewThreadId, valid_idempotency_key},
    params,
    plugin_client::PluginCallError,
};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ResolveRequest {
    pull_request: Value,
    thread_id: String,
    resolved: bool,
    idempotency_key: String,
}

/// The journal's `actionId`: the requested state and the thread, so a key
/// reused for the other direction or another thread is refused.
fn action_id(thread: &ReviewThreadId, resolved: bool) -> String {
    let state = if resolved { "resolved" } else { "unresolved" };
    format!("{state}:{}", thread.as_str())
}

/// `companion/pullRequest/reviewThread/resolve` → `{ resolved, viewerCanToggle }`.
///
/// # Errors
///
/// Returns invalid params for a bad key or thread id, `-32080` without
/// `forge.conversation.resolve@1`, `-32088` for an unknown thread, `-32083`
/// for a refusal or an unknown outcome.
pub async fn resolve(context: &ForgeContext, raw: &Value) -> Result<Value, ForgeError> {
    let request: ResolveRequest = params(raw)?;
    if !valid_idempotency_key(&request.idempotency_key) {
        return Err(ForgeError::invalid("invalid idempotencyKey"));
    }
    let thread = ReviewThreadId::parse(&request.thread_id)
        .ok_or_else(|| ForgeError::invalid("invalid threadId"))?;
    let (key, identity) = ForgeContext::pull_request(&request.pull_request)?;
    let action_id = action_id(&thread, request.resolved);
    let kind = RunKind::ReviewThreadResolve;
    if let Some(outcome) = context
        .journal
        .peek(&request.idempotency_key, kind, &key, &action_id)?
    {
        return outcome.map_err(ForgeError::Replayed);
    }
    let account = context.account_for(&key, &identity)?;
    let mut session = context.session(&identity.plugin_id).await?;
    if !session.supports(capability::RESOLVE_CONVERSATION) {
        session.shutdown().await;
        return Err(ForgeError::from_plugin(
            &identity.plugin_id,
            None,
            PluginCallError::CapabilityMissing(capability::RESOLVE_CONVERSATION.to_owned()),
        ));
    }
    let record = match context
        .journal
        .begin(&request.idempotency_key, kind, &key, &action_id)?
    {
        Begin::Run(record) => record,
        Begin::Replay(outcome) => {
            session.shutdown().await;
            return outcome.map_err(ForgeError::Replayed);
        }
    };
    info!(
        pull_request = %key.log_hash(),
        run_id = %record.run_id,
        "forge thread resolution started"
    );
    let called: Result<ReviewThreadResolveResult, PluginCallError> = session
        .call(
            methods::PULL_REQUEST_REVIEW_THREAD_RESOLVE,
            &ReviewThreadResolveParams {
                account: account.account_ref(),
                pr_ref: identity.pr_ref.clone(),
                thread_id: thread.as_str().to_owned(),
                resolved: request.resolved,
                idempotency_key: request.idempotency_key.clone(),
            },
        )
        .await;
    session.shutdown().await;
    let outcome = match called {
        Ok(result) => serde_json::to_value(result).map_err(|_| ForgeError::OutcomeUnknown {
            run_id: record.run_id.clone(),
        }),
        Err(error) => {
            match ForgeError::from_plugin(&identity.plugin_id, Some(&account.key), error) {
                ForgeError::Internal(_) => Err(ForgeError::OutcomeUnknown {
                    run_id: record.run_id.clone(),
                }),
                refused => {
                    info!(
                        pull_request = %key.log_hash(),
                        run_id = %record.run_id,
                        kind = refused.log_kind(),
                        "forge thread resolution refused"
                    );
                    Err(refused)
                }
            }
        }
    };
    let (state, stored, error) = match &outcome {
        Ok(value) => (RunState::Succeeded, Some(value.clone()), None),
        Err(error @ ForgeError::OutcomeUnknown { .. }) => {
            (RunState::Unknown, None, Some(error.to_rpc_error()))
        }
        Err(error) => (RunState::Rejected, None, Some(error.to_rpc_error())),
    };
    context
        .journal
        .finish(&request.idempotency_key, &record, state, stored, error)?;
    info!(run_id = %record.run_id, outcome = ?state, "forge thread resolution ended");
    if state != RunState::Rejected {
        context.cache.invalidate_pull_request(&key);
        context.events.pull_request(&key).await;
    }
    outcome.map_err(|error| context.observe(&account, error))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_key_names_one_direction_on_one_thread() {
        let thread = ReviewThreadId::parse("PRRT_1")
            .map(|thread| (action_id(&thread, true), action_id(&thread, false)));
        assert_eq!(
            thread,
            Some(("resolved:PRRT_1".to_owned(), "unresolved:PRRT_1".to_owned()))
        );
    }
}
