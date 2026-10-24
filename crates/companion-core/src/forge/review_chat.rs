//! The one canonical ordinary conversation of a pull request.
//!
//! Opening the conversation is deliberately separate from starting an agent
//! scenario: `ensure` creates or reuses a thread and links it, but never
//! enqueues input. A single companion-owned lane makes concurrent callers for
//! the same (or another) pull request observe the same durable mapping.

use std::sync::Arc;

use serde::Deserialize;
use serde_json::{Value, json};

use super::{
    ForgeContext,
    errors::ForgeError,
    ids::{PullRequestKey, parse_thread_id},
    links::LinkOutcome,
    params,
    reads::load_overview,
    wire::{LinkSource, LinkedThreadWire, OverviewWire},
};
use crate::{
    agent::{model::AppThreadId, permission_profiles::READ_ONLY},
    store::{IndexStore, forge_tables::FORGE_PR_REVIEW_THREADS, kv::KvOp},
};

const WORKSPACE_PROFILE: &str = ":workspace";

#[derive(Clone)]
pub struct ReviewChats {
    lane: Arc<tokio::sync::Mutex<()>>,
    store: Arc<IndexStore>,
}

impl ReviewChats {
    #[must_use]
    pub fn new(store: Arc<IndexStore>) -> Self {
        Self {
            lane: Arc::new(tokio::sync::Mutex::new(())),
            store,
        }
    }

    /// The durable canonical thread, if one was assigned.
    ///
    /// # Errors
    ///
    /// Returns a storage failure or corrupt internal record.
    pub fn get(&self, pull_request: &PullRequestKey) -> Result<Option<AppThreadId>, ForgeError> {
        self.store
            .kv_get(FORGE_PR_REVIEW_THREADS, pull_request.as_str())?
            .map(|value| {
                let thread = std::str::from_utf8(&value)
                    .ok()
                    .and_then(parse_thread_id)
                    .ok_or_else(|| ForgeError::internal("invalid stored review thread"))?;
                Ok(thread)
            })
            .transpose()
    }

    fn put(&self, pull_request: &PullRequestKey, thread: &AppThreadId) -> Result<(), ForgeError> {
        self.store.kv_apply(vec![KvOp::Put {
            table: FORGE_PR_REVIEW_THREADS,
            key: pull_request.as_str().to_owned(),
            value: thread.as_str().as_bytes().to_vec(),
        }])?;
        Ok(())
    }

    /// Clears the canonical role when that exact link is explicitly removed.
    ///
    /// # Errors
    ///
    /// Returns a storage failure.
    pub fn clear_if(
        &self,
        pull_request: &PullRequestKey,
        thread: &AppThreadId,
    ) -> Result<(), ForgeError> {
        if self.get(pull_request)?.as_ref() != Some(thread) {
            return Ok(());
        }
        self.store.kv_apply(vec![KvOp::Delete {
            table: FORGE_PR_REVIEW_THREADS,
            key: pull_request.as_str().to_owned(),
        }])?;
        Ok(())
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct EnsureRequest {
    pull_request: Value,
}

/// `companion/pullRequest/chat/ensure`.
///
/// Returns the same thread for every concurrent or later call for one pull
/// request. It creates no user message and starts no turn.
///
/// # Errors
///
/// Returns invalid params for a malformed key, or a capability/storage error.
pub async fn ensure(context: &ForgeContext, raw: &Value) -> Result<Value, ForgeError> {
    let request: EnsureRequest = params(raw)?;
    let (key, identity) = ForgeContext::pull_request(&request.pull_request)?;
    let _lane = context.review_chats.lane.lock().await;
    let agents = context
        .agents
        .clone()
        .ok_or_else(|| ForgeError::CapabilityUnavailable {
            reason: "agents are unavailable on this companion".into(),
        })?;

    if let Some(thread) = context.review_chats.get(&key)?
        && agents.thread_exists(thread.as_str()).await
    {
        return Ok(result(&thread, false));
    }

    if let Some(thread) = reusable_link(context, &key, &agents).await? {
        context.review_chats.put(&key, &thread)?;
        context.cache.invalidate_pull_request(&key);
        context.events.pull_request(&key).await;
        return Ok(result(&thread, false));
    }

    let overview = load_overview(context, &key, &identity).await?;
    let thread = create_thread(context, &agents, &overview).await?;
    let outcome = context.links.link(
        &key,
        &identity.plugin_id,
        &identity.pr_ref.number,
        &thread,
        LinkSource::Manual,
    )?;
    debug_assert_ne!(outcome, LinkOutcome::Tombstoned);
    context.review_chats.put(&key, &thread)?;
    context.cache.invalidate_pull_request(&key);
    context.events.pull_request(&key).await;
    context.events.list().await;
    Ok(result(&thread, true))
}

async fn reusable_link(
    context: &ForgeContext,
    key: &PullRequestKey,
    agents: &crate::agent_bridge::AgentBridge,
) -> Result<Option<AppThreadId>, ForgeError> {
    let links = context.links.of_pull_request(key)?;
    let preferred = links
        .iter()
        .filter(|link| link.source == LinkSource::Branch)
        .chain(
            links
                .iter()
                .filter(|link| link.source != LinkSource::Branch),
        );
    for link in preferred {
        let Some(thread) = parse_thread_id(&link.thread_id) else {
            continue;
        };
        if agents.thread_exists(thread.as_str()).await {
            return Ok(Some(thread));
        }
    }
    Ok(None)
}

pub(crate) async fn create_thread(
    context: &ForgeContext,
    agents: &crate::agent_bridge::AgentBridge,
    overview: &OverviewWire,
) -> Result<AppThreadId, ForgeError> {
    let (cwd, profile) = if let Some(checkout) = &overview.local_checkout {
        (checkout.workspace.clone(), WORKSPACE_PROFILE)
    } else {
        let admission =
            context
                .workspaces
                .as_ref()
                .ok_or_else(|| ForgeError::CapabilityUnavailable {
                    reason: "workspace admission is unavailable".into(),
                })?;
        (
            admission
                .admit(None)
                .await
                .map_err(ForgeError::InvalidParams)?,
            READ_ONLY,
        )
    };
    agents
        .create_thread(cwd, profile)
        .await
        .map_err(|reason| ForgeError::CapabilityUnavailable { reason })
}

fn result(thread: &AppThreadId, created: bool) -> Value {
    json!({"threadId": thread.as_str(), "created": created})
}

/// The overview's explicit canonical review thread, distinct from related links.
pub(crate) fn wire(
    context: &ForgeContext,
    key: &PullRequestKey,
) -> Result<Option<LinkedThreadWire>, ForgeError> {
    Ok(context
        .review_chats
        .get(key)?
        .map(|thread| LinkedThreadWire {
            thread_id: thread.as_str().to_owned(),
            source: LinkSource::Manual,
        }))
}

#[cfg(test)]
#[allow(clippy::expect_used)]
mod tests {
    use forge_protocol::ForgePrRef;

    use super::*;

    #[test]
    fn canonical_thread_survives_new_owner_and_only_exact_unlink_clears_it()
    -> Result<(), ForgeError> {
        let directory = tempfile::tempdir().expect("temporary review chat store");
        let store = Arc::new(IndexStore::open(directory.path().join("state.redb"))?);
        let pull_request = PullRequestKey::issue(
            "github",
            &ForgePrRef {
                host: "github.com".into(),
                repository: "acme/widget".into(),
                number: "42".into(),
            },
        );
        let canonical = AppThreadId::from_static("thread-canonical");
        let another = AppThreadId::from_static("thread-another");

        ReviewChats::new(store.clone()).put(&pull_request, &canonical)?;
        let restarted = ReviewChats::new(store);
        assert_eq!(restarted.get(&pull_request)?, Some(canonical.clone()));

        restarted.clear_if(&pull_request, &another)?;
        assert_eq!(restarted.get(&pull_request)?, Some(canonical.clone()));

        restarted.clear_if(&pull_request, &canonical)?;
        assert_eq!(restarted.get(&pull_request)?, None);
        Ok(())
    }
}
