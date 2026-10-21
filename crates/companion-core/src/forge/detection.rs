//! Demand-driven branch detection: `thread/started` and `turn/completed` of
//! a thread whose `cwd` is a VCS workspace schedule one detection per
//! workspace, debounced 30 seconds. There is no timer that wakes agents and
//! no poller.
//!
//! Path: the workspace's VCS provider answers `vcs.remotes@1`; forge
//! plugins are probed in priority order with `forge.repository.resolve`
//! (the first claim wins and is terminal); the claiming plugin answers
//! `forge.pullRequests.byBranch` (open pull requests only); each pair gets a
//! `branch` link unless a tombstone exists. A detached head links nothing,
//! and a provider without `vcs.remotes@1` behaves exactly as before.

use std::{
    collections::{HashMap, HashSet},
    path::PathBuf,
    sync::{Arc, Mutex},
};

use forge_protocol::{
    ByBranchParams, ByBranchResult, ResolveParams, ResolveResult, capability, methods,
};
use serde_json::Value;
use tracing::{debug, info};

use super::{
    ForgeContext,
    ids::{PullRequestKey, parse_thread_id},
    limits,
    links::LinkOutcome,
    plugin_client::PluginSession,
    wire::{AccountCondition, LinkSource},
};

/// Workspaces with a scheduled detection and the threads that asked.
#[derive(Default)]
pub struct Detector {
    pending: Mutex<HashMap<String, HashSet<String>>>,
}

/// Observes one client-wire event.
pub fn observe(context: &Arc<ForgeContext>, payload: &Value) {
    let Some((thread, cwd)) = thread_and_cwd(context, payload) else {
        return;
    };
    let schedule = {
        let Ok(mut pending) = context.detector.pending.lock() else {
            return;
        };
        let threads = pending.entry(cwd.clone()).or_default();
        let first = threads.is_empty();
        threads.insert(thread);
        first
    };
    if schedule {
        let context = context.clone();
        tokio::spawn(async move {
            tokio::time::sleep(limits::DETECTION_DEBOUNCE).await;
            let threads = context
                .detector
                .pending
                .lock()
                .ok()
                .and_then(|mut pending| pending.remove(&cwd))
                .unwrap_or_default();
            detect(&context, &cwd, &threads).await;
        });
    }
}

fn thread_and_cwd(context: &ForgeContext, payload: &Value) -> Option<(String, String)> {
    let method = payload.get("method")?.as_str()?;
    let params = payload.get("params")?;
    let (thread, cwd) = match method {
        "thread/started" => {
            let thread = params.get("thread")?;
            (
                thread.get("id")?.as_str()?.to_owned(),
                thread.get("cwd").and_then(Value::as_str).map(str::to_owned),
            )
        }
        "turn/completed" => (params.get("threadId")?.as_str()?.to_owned(), None),
        _ => return None,
    };
    parse_thread_id(&thread)?;
    let cwd = cwd.or_else(|| context.workspaces.as_ref()?.thread_cwd(&thread))?;
    (cwd.starts_with('/') && context.vcs.is_some()).then_some((thread, cwd))
}

/// Runs one detection for a workspace and links its threads.
pub async fn detect<S: std::hash::BuildHasher>(
    context: &ForgeContext,
    workspace: &str,
    threads: &HashSet<String, S>,
) {
    let Some(vcs) = &context.vcs else {
        return;
    };
    let remotes = match vcs.remotes(&PathBuf::from(workspace)).await {
        Ok(Some(remotes)) => remotes,
        Ok(None) => return,
        Err(error) => {
            debug!(reason = %error, "branch detection skipped: no VCS remotes");
            return;
        }
    };
    let Some(branch) = remotes.branch.clone() else {
        return;
    };
    let urls = remotes.ordered_urls();
    if urls.is_empty() {
        return;
    }
    let Ok(entries) = context.providers.entries() else {
        return;
    };
    for entry in entries
        .into_iter()
        .filter(|entry| entry.enabled && entry.spec.is_some())
    {
        let Some((session, resolved)) = claim(context, &entry.plugin_id, &urls).await else {
            continue;
        };
        // The first claim is terminal.
        let changed = link_branch(
            context,
            session,
            &entry.plugin_id,
            &resolved,
            &branch,
            threads,
        )
        .await;
        for key in &changed {
            context.cache.invalidate_pull_request(key);
            context.events.pull_request(key).await;
        }
        if !changed.is_empty() {
            context.events.list().await;
            info!(
                links = changed.len(),
                "branch detection linked pull requests"
            );
        }
        return;
    }
}

/// Asks one provider to claim the remotes; `None` when it does not.
async fn claim(
    context: &ForgeContext,
    plugin_id: &str,
    urls: &[String],
) -> Option<(PluginSession, ResolveResult)> {
    let mut session = context.session(plugin_id).await.ok()?;
    if !session.supports(capability::RESOLVE) {
        session.shutdown().await;
        return None;
    }
    let resolved: Result<ResolveResult, _> = session
        .call(
            methods::REPOSITORY_RESOLVE,
            &ResolveParams {
                remotes: urls.to_vec(),
            },
        )
        .await;
    if let Ok(resolved) = resolved {
        Some((session, resolved))
    } else {
        session.shutdown().await;
        None
    }
}

/// Links every thread to the open pull requests of `branch`; returns the
/// pull requests that gained a link.
async fn link_branch<S: std::hash::BuildHasher>(
    context: &ForgeContext,
    mut session: PluginSession,
    plugin_id: &str,
    resolved: &ResolveResult,
    branch: &str,
    threads: &HashSet<String, S>,
) -> Vec<PullRequestKey> {
    let account = context.accounts.links_of(plugin_id).ok().and_then(|links| {
        let candidates: Vec<_> = links
            .into_iter()
            .filter(|link| link.host.eq_ignore_ascii_case(&resolved.host))
            .collect();
        candidates
            .iter()
            .find(|link| context.accounts.condition(&link.key) == AccountCondition::Connected)
            .or_else(|| candidates.first())
            .cloned()
    });
    let Some(account) = account else {
        session.shutdown().await;
        return Vec::new();
    };
    let refs: Result<ByBranchResult, _> = session
        .call(
            methods::PULL_REQUESTS_BY_BRANCH,
            &ByBranchParams {
                account: account.account_ref(),
                repository: resolved.repository.clone(),
                branch: branch.to_owned(),
            },
        )
        .await;
    session.shutdown().await;
    let Ok(refs) = refs else {
        return Vec::new();
    };
    let mut changed = Vec::new();
    for pr_ref in refs
        .refs
        .iter()
        .filter(|pr_ref| pr_ref.host.eq_ignore_ascii_case(&resolved.host))
    {
        let key = PullRequestKey::issue(plugin_id, pr_ref);
        for thread in threads.iter().filter_map(|thread| parse_thread_id(thread)) {
            if let Ok(LinkOutcome::Created) =
                context
                    .links
                    .link(&key, plugin_id, &pr_ref.number, &thread, LinkSource::Branch)
                && !changed.contains(&key)
            {
                changed.push(key.clone());
            }
        }
    }
    changed
}
