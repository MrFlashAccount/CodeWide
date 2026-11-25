//! Resolves the PR of a composer submission from Companion-owned review-chat mappings.
//! Runs after file preparation, at dispatch, so pending rows retain only authored inputs.
use agent_core::user_text::{REVIEW_CHAT_CLOSE, REVIEW_CHAT_OPEN};
use serde_json::{Value, json};

use super::ids::PullRequestKey;
use crate::store::{IndexStore, StoreError, forge_tables::FORGE_PR_REVIEW_THREADS};

#[derive(Debug, thiserror::Error)]
pub(crate) enum ReviewInputError {
    #[error("The selected pull request is no longer assigned to this review chat.")]
    Unassigned,
    #[error("Invalid review chat pull request.")]
    InvalidKey,
    #[error(transparent)]
    Store(#[from] StoreError),
}

/// An explicit route wins, including when several PRs share a thread. Opening the same
/// thread from Threads (or an older client) uses its persisted canonical assignment.
pub(crate) fn prepare(
    store: &IndexStore,
    thread: &str,
    params: &mut Value,
) -> Result<(), ReviewInputError> {
    let Some(object) = params.as_object_mut() else {
        return Ok(());
    };
    let selected = object.remove("codewideReviewPullRequest");
    let Some(input) = object
        .get_mut("input")
        .and_then(Value::as_array_mut)
        .filter(|input| !input.is_empty())
    else {
        return Ok(());
    };
    let pr = if let Some(selected) = selected {
        let (key, identity) = selected
            .as_str()
            .and_then(PullRequestKey::parse)
            .ok_or(ReviewInputError::InvalidKey)?;
        if store
            .kv_get(FORGE_PR_REVIEW_THREADS, key.canonical_str())?
            .as_deref()
            != Some(thread.as_bytes())
            && !super::links::is_linked(store, &key, thread)?
        {
            return Err(ReviewInputError::Unassigned);
        }
        Some(identity)
    } else {
        // Only a unique assignment identifies a PR without an explicit selection.
        let keys = store.kv_keys_with_value(FORGE_PR_REVIEW_THREADS, thread.as_bytes(), 2)?;
        match keys.as_slice() {
            [] => return Ok(()),
            [key] => Some(
                PullRequestKey::parse(key)
                    .ok_or(ReviewInputError::InvalidKey)?
                    .1,
            ),
            _ => None,
        }
    };
    let context = if let Some(pr) = pr {
        let identity = json!({"provider": pr.plugin_id, "host": pr.pr_ref.host, "repository": pr.pr_ref.repository, "number": pr.pr_ref.number});
        format!(
            "The pull request for this conversation is {identity}. Use this identity when the user refers to the PR. The working directory or current branch may belong to another PR."
        )
    } else {
        "This thread is the review chat for multiple pull requests. If the request does not identify one, ask which PR the user means before acting.".into()
    };
    let text = format!("\n\n{REVIEW_CHAT_OPEN}\n{context}\n{REVIEW_CHAT_CLOSE}");
    input.push(json!({"type":"text", "text":text, "text_elements":[]}));
    Ok(())
}
