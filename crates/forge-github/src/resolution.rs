//! `forge.pullRequest.reviewThread.resolve`: resolve or unresolve one
//! conversation with GraphQL `resolveReviewThread` /
//! `unresolveReviewThread`, addressed by the thread node id that
//! `forge.pullRequest.conversation` returns.
//!
//! The thread is read first: it must belong to the addressed pull request;
//! a thread already in the requested state answers that state without a
//! write; a change the viewer may not make (`viewerCanResolve` /
//! `viewerCanUnresolve`) is refused without a write.

use forge_protocol::{PluginError, ReviewThreadResolveResult, ThreadResolution, code};
use serde_json::{Value, json};

use crate::{
    api::Api,
    comments::{require_thread_id, require_thread_of},
    conversation::conversation_resolution,
    repo::PullTarget,
};

const STATE: &str = "isResolved viewerCanResolve viewerCanUnresolve";

/// What a resolve request does with a thread in its current state.
#[derive(Debug, PartialEq, Eq)]
enum Plan {
    /// Already in the requested state: answer it, write nothing.
    Settled(ReviewThreadResolveResult),
    /// Run the mutation.
    Write,
}

/// # Errors
///
/// Returns invalid params for a malformed thread id, `notFound` for a
/// thread of another pull request, `forgeRejected` when the viewer may not
/// make the change, or the mapped GitHub failure.
pub async fn resolve(
    api: &Api,
    target: &PullTarget,
    thread_id: &str,
    resolved: bool,
) -> Result<ReviewThreadResolveResult, PluginError> {
    require_thread_id(thread_id)?;
    let current = api
        .graphql(
            &format!("query($id: ID!) {{ node(id: $id) {{ __typename ... on PullRequestReviewThread {{ {STATE} pullRequest {{ number repository {{ nameWithOwner }} }} }} }} }}"),
            json!({ "id": thread_id }),
        )
        .await?;
    let node = current.get("node");
    require_thread_of(node, target)?;
    if let Plan::Settled(result) = plan(node.unwrap_or(&Value::Null), resolved)? {
        return Ok(result);
    }
    let mutation = if resolved {
        "resolveReviewThread"
    } else {
        "unresolveReviewThread"
    };
    let changed = api
        .graphql(
            &format!("mutation($id: ID!) {{ {mutation}(input: {{threadId: $id}}) {{ thread {{ {STATE} }} }} }}"),
            json!({ "id": thread_id }),
        )
        .await?;
    changed
        .pointer(&format!("/{mutation}/thread"))
        .filter(|thread| thread.is_object())
        .map(result_of)
        .ok_or_else(|| PluginError::internal("GitHub returned no thread"))
}

fn plan(node: &Value, resolved: bool) -> Result<Plan, PluginError> {
    let ThreadResolution::Conversation {
        resolved: current,
        viewer_can_toggle,
    } = conversation_resolution(node)
    else {
        return Err(PluginError::internal("a GitHub thread is a conversation"));
    };
    if current == resolved {
        return Ok(Plan::Settled(result_of(node)));
    }
    if !viewer_can_toggle {
        return Err(PluginError::new(
            code::FORGE_REJECTED,
            if resolved {
                "You cannot resolve this conversation on GitHub"
            } else {
                "You cannot unresolve this conversation on GitHub"
            },
        ));
    }
    Ok(Plan::Write)
}

fn result_of(thread: &Value) -> ReviewThreadResolveResult {
    match conversation_resolution(thread) {
        ThreadResolution::Conversation {
            resolved,
            viewer_can_toggle,
        } => ReviewThreadResolveResult {
            resolved,
            viewer_can_toggle,
        },
        ThreadResolution::None | ThreadResolution::Issue { .. } => ReviewThreadResolveResult {
            resolved: false,
            viewer_can_toggle: false,
        },
    }
}

#[cfg(test)]
#[allow(clippy::expect_used)]
mod tests {
    use super::*;

    fn thread(resolved: bool, can_resolve: bool, can_unresolve: bool) -> Value {
        json!({"isResolved": resolved, "viewerCanResolve": can_resolve, "viewerCanUnresolve": can_unresolve})
    }

    #[test]
    fn a_thread_in_the_requested_state_is_answered_without_a_write() {
        assert_eq!(
            plan(&thread(true, false, true), true).ok(),
            Some(Plan::Settled(ReviewThreadResolveResult {
                resolved: true,
                viewer_can_toggle: true
            }))
        );
        assert_eq!(
            plan(&thread(false, false, false), false).ok(),
            Some(Plan::Settled(ReviewThreadResolveResult {
                resolved: false,
                viewer_can_toggle: false
            }))
        );
    }

    #[test]
    fn a_change_follows_the_viewers_permission_in_its_direction() {
        assert_eq!(
            plan(&thread(false, true, false), true).ok(),
            Some(Plan::Write)
        );
        assert_eq!(
            plan(&thread(true, false, true), false).ok(),
            Some(Plan::Write)
        );
        let refused = plan(&thread(false, false, true), true).expect_err("may not resolve");
        assert_eq!(refused.code, code::FORGE_REJECTED);
        let refused = plan(&thread(true, true, false), false).expect_err("may not unresolve");
        assert_eq!(refused.code, code::FORGE_REJECTED);
    }
}
