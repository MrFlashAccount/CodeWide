//! `companion/pullRequest/comment/create` and
//! `companion/pullRequest/reviewThread/reply`: the only triggers of a
//! conversation comment and a review thread reply (`forge.comments@1`).
//! Both publish immediately, as on the forge itself.
//!
//! Order, each step before any forge write: the idempotency key and the
//! body bound (1..=65 536 characters after trimming), a replay of a known
//! key from the journal, the account and the declared capability. Only then
//! is the write journaled `started` and the plugin called with the trimmed
//! body. A local failure after that point (timeout, a plugin that died)
//! ends as `outcomeUnknown`; any outcome that may have written drops the
//! pull request's cache and emits its invalidation.

use forge_protocol::{
    Comment, CommentCreateParams, CommentResult, ReviewThreadReplyParams, capability, methods,
};
use serde::Deserialize;
use serde_json::{Value, json};
use tracing::info;

use super::{
    ForgeContext,
    accounts::AccountLink,
    actions::{Begin, RunKind, RunRecord, RunState},
    conversation::{PageOrigin, comment_of},
    declarations::Declaration,
    errors::ForgeError,
    ids::{PullRequestIdentity, PullRequestKey, ReviewThreadId, valid_idempotency_key},
    limits, params,
    plugin_client::{PluginCallError, PluginSession},
};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CreateRequest {
    pull_request: Value,
    body: String,
    idempotency_key: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ReplyRequest {
    pull_request: Value,
    thread_id: String,
    body: String,
    idempotency_key: String,
}

/// Where a write publishes.
enum Destination {
    Conversation,
    Thread(ReviewThreadId),
}

impl Destination {
    fn kind(&self) -> RunKind {
        match self {
            Self::Conversation => RunKind::Comment,
            Self::Thread(_) => RunKind::ReviewThreadReply,
        }
    }

    /// The journal's `actionId`: a key reused for another thread is refused.
    fn action_id(&self) -> &str {
        match self {
            Self::Conversation => "comment",
            Self::Thread(thread) => thread.as_str(),
        }
    }
}

/// `companion/pullRequest/comment/create`.
///
/// # Errors
///
/// Returns invalid params for a bad body or key, `-32080` without
/// `forge.comments@1`, `-32083` for a refusal or an unknown outcome.
pub async fn create(context: &ForgeContext, raw: &Value) -> Result<Value, ForgeError> {
    let request: CreateRequest = params(raw)?;
    publish(
        context,
        &request.pull_request,
        Destination::Conversation,
        &request.body,
        &request.idempotency_key,
    )
    .await
}

/// `companion/pullRequest/reviewThread/reply`.
///
/// # Errors
///
/// Returns invalid params for a bad body, key or thread id, `-32080`
/// without `forge.comments@1`, `-32088` for an unknown thread, `-32083`
/// for a refusal or an unknown outcome.
pub async fn reply(context: &ForgeContext, raw: &Value) -> Result<Value, ForgeError> {
    let request: ReplyRequest = params(raw)?;
    let thread = ReviewThreadId::parse(&request.thread_id)
        .ok_or_else(|| ForgeError::invalid("invalid threadId"))?;
    publish(
        context,
        &request.pull_request,
        Destination::Thread(thread),
        &request.body,
        &request.idempotency_key,
    )
    .await
}

/// The trimmed body, or invalid params outside 1..=65 536 characters.
fn valid_body(body: &str) -> Result<&str, ForgeError> {
    let trimmed = body.trim();
    let length = trimmed.chars().count();
    if length == 0 || length > limits::MAX_COMMENT_BODY_CHARS {
        return Err(ForgeError::invalid(
            "the body must have 1 to 65536 characters",
        ));
    }
    Ok(trimmed)
}

async fn publish(
    context: &ForgeContext,
    pull_request: &Value,
    destination: Destination,
    body: &str,
    idempotency_key: &str,
) -> Result<Value, ForgeError> {
    if !valid_idempotency_key(idempotency_key) {
        return Err(ForgeError::invalid("invalid idempotencyKey"));
    }
    let (key, identity) = ForgeContext::pull_request(pull_request)?;
    let body = valid_body(body)?;
    if let Some(outcome) = context.journal.peek(
        idempotency_key,
        destination.kind(),
        &key,
        destination.action_id(),
    )? {
        return outcome.map_err(ForgeError::Replayed);
    }
    let account = context.account_for(&key, &identity)?;
    let mut session = context.session(&identity.plugin_id).await?;
    if !session.supports(capability::COMMENTS) {
        session.shutdown().await;
        return Err(ForgeError::from_plugin(
            &identity.plugin_id,
            None,
            PluginCallError::CapabilityMissing(capability::COMMENTS.to_owned()),
        ));
    }
    let record = match context.journal.begin(
        idempotency_key,
        destination.kind(),
        &key,
        destination.action_id(),
    )? {
        Begin::Run(record) => record,
        Begin::Replay(outcome) => {
            session.shutdown().await;
            return outcome.map_err(ForgeError::Replayed);
        }
    };
    info!(
        pull_request = %key.log_hash(),
        run_id = %record.run_id,
        kind = ?destination.kind(),
        "forge comment write started"
    );
    let write = Write {
        key: &key,
        identity: &identity,
        account: &account,
        destination: &destination,
        body,
        idempotency_key,
    };
    let declaration = Declaration::from_info(session.info());
    let called = call(&mut session, &write).await;
    session.shutdown().await;
    let origin = PageOrigin {
        host: &identity.pr_ref.host,
        media_hosts: &declaration.media_hosts,
        web_hosts: &declaration.web_hosts,
    };
    let outcome = settle(called, &write, origin, &record);
    let (state, stored, error) = match &outcome {
        Ok(value) => (RunState::Succeeded, Some(value.clone()), None),
        Err(error @ ForgeError::OutcomeUnknown { .. }) => {
            (RunState::Unknown, None, Some(error.to_rpc_error()))
        }
        Err(error) => (RunState::Rejected, None, Some(error.to_rpc_error())),
    };
    context
        .journal
        .finish(idempotency_key, &record, state, stored, error)?;
    info!(run_id = %record.run_id, outcome = ?state, "forge comment write ended");
    if state != RunState::Rejected {
        context.cache.invalidate_pull_request(&key);
        context.events.pull_request(&key).await;
    }
    outcome.map_err(|error| context.observe(&account, error))
}

/// One journaled write.
struct Write<'a> {
    key: &'a PullRequestKey,
    identity: &'a PullRequestIdentity,
    account: &'a AccountLink,
    destination: &'a Destination,
    body: &'a str,
    idempotency_key: &'a str,
}

async fn call(
    session: &mut PluginSession,
    write: &Write<'_>,
) -> Result<CommentResult, PluginCallError> {
    let account = write.account.account_ref();
    match write.destination {
        Destination::Conversation => {
            session
                .call(
                    methods::PULL_REQUEST_COMMENT_CREATE,
                    &CommentCreateParams {
                        account,
                        pr_ref: write.identity.pr_ref.clone(),
                        body: write.body.to_owned(),
                        idempotency_key: write.idempotency_key.to_owned(),
                    },
                )
                .await
        }
        Destination::Thread(thread) => {
            session
                .call(
                    methods::PULL_REQUEST_REVIEW_THREAD_REPLY,
                    &ReviewThreadReplyParams {
                        account,
                        pr_ref: write.identity.pr_ref.clone(),
                        thread_id: thread.as_str().to_owned(),
                        body: write.body.to_owned(),
                        idempotency_key: write.idempotency_key.to_owned(),
                    },
                )
                .await
        }
    }
}

/// The client outcome of a plugin answer. A local failure, or a success
/// whose comment cannot be shown, leaves the forge state unknown.
fn settle(
    called: Result<CommentResult, PluginCallError>,
    write: &Write<'_>,
    origin: PageOrigin<'_>,
    record: &RunRecord,
) -> Result<Value, ForgeError> {
    let unknown = || ForgeError::OutcomeUnknown {
        run_id: record.run_id.clone(),
    };
    match called {
        // The journal keeps this answer for replay, so short-lived media
        // URLs stay out of it; the conversation read after the write carries
        // fresh ones.
        Ok(result) => comment_of(result.comment, origin)
            .map(|comment| Comment {
                media: Vec::new(),
                ..comment
            })
            .map(|comment| json!({ "comment": comment }))
            .ok_or_else(unknown),
        Err(error) => {
            let mapped =
                ForgeError::from_plugin(&write.identity.plugin_id, Some(&write.account.key), error);
            match mapped {
                ForgeError::Internal(_) => Err(unknown()),
                other => {
                    tracing::info!(
                        pull_request = %write.key.log_hash(),
                        run_id = %record.run_id,
                        kind = other.log_kind(),
                        "forge comment write refused"
                    );
                    Err(other)
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bodies_are_trimmed_and_bounded() {
        assert_eq!(valid_body("  hi \n").ok(), Some("hi"));
        assert!(valid_body(" \n\t").is_err());
        let longest = "é".repeat(limits::MAX_COMMENT_BODY_CHARS);
        assert!(valid_body(&format!("  {longest}  ")).is_ok());
        assert!(valid_body(&format!("{longest}x")).is_err());
    }
}
