//! Forge reads: the cross-account list, the atomic overview, activity pages,
//! file pages with hunk catalogs, and viewed marks.
//!
//! One plugin process serves one batch per provider. An expired or failing
//! account degrades only its own list section.

use std::collections::{BTreeSet, HashMap};

use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use forge_protocol::{
    ActivityPage, ActivityParams, CheckSummary, ChecksParams, ChecksResult, FilePatch, FilesParams,
    FilesResult, ListParams, ListResult, PullRequestCategory, PullRequestOverview,
    PullRequestParams, RawActionCatalog, ViewedSetParams, capability, methods,
};
use serde::Deserialize;
use serde_json::{Value, json};

use super::{
    ForgeContext,
    accounts::AccountLink,
    actions::{catalog_wire, parse_catalog},
    cache::ListKey,
    errors::ForgeError,
    ids::{HeadRevision, PullRequestIdentity, PullRequestKey},
    limits,
    links::LinkRecord,
    params,
    plugin_client::PluginSession,
    scenarios,
    wire::{
        FileWire, FilesPageWire, ListPageWire, ListSectionWire, LocalCheckoutWire, OverviewWire,
        PatchWire, PullRequestRowWire, ViewedMarkWire, ViewedSource, now_rfc3339,
    },
};
use crate::review::{hunks::parse_patch, source::DiffSource};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ListRequest {
    category: PullRequestCategory,
    repository: Option<String>,
    cursor: Option<String>,
}

/// `companion/pullRequests/list`.
///
/// # Errors
///
/// Returns invalid params for a malformed cursor or a storage failure.
pub async fn list(context: &ForgeContext, raw: &Value) -> Result<Value, ForgeError> {
    let request: ListRequest = params(raw)?;
    if let Some(repository) = &request.repository
        && (repository.is_empty() || repository.len() > 256)
    {
        return Err(ForgeError::invalid("invalid repository"));
    }
    let key = ListKey {
        category: request.category,
        repository: request.repository.clone(),
        cursor: request.cursor.clone(),
    };
    if let Some(page) = context.cache.list(&key) {
        return to_value(&page);
    }
    let cursors = decode_cursor(request.cursor.as_deref())?;
    let mut batch = ListBatch {
        facts: link_facts(&context.links.all()?),
        sections: Vec::new(),
        next: HashMap::new(),
        repositories: BTreeSet::new(),
    };
    for entry in context.providers.entries()? {
        if !entry.enabled {
            continue;
        }
        let links: Vec<AccountLink> = context
            .accounts
            .links_of(&entry.plugin_id)?
            .into_iter()
            .filter(|link| {
                cursors
                    .as_ref()
                    .is_none_or(|cursors| cursors.contains_key(link.key.as_str()))
            })
            .collect();
        if links.is_empty() {
            continue;
        }
        let mut session = match context.session(&entry.plugin_id).await {
            Ok(session) => session,
            Err(error) => {
                for link in &links {
                    context.accounts.observe_error(&link.key, &error);
                    batch.sections.push(empty_section(context, link));
                }
                continue;
            }
        };
        for link in &links {
            let cursor = cursors
                .as_ref()
                .and_then(|cursors| cursors.get(link.key.as_str()).cloned());
            list_account(
                context,
                &mut session,
                &entry.plugin_id,
                link,
                &request,
                cursor,
                &mut batch,
            )
            .await;
        }
        session.shutdown().await;
    }
    let page = ListPageWire {
        category: request.category,
        fetched_at: now_rfc3339(),
        repositories: batch.repositories.into_iter().collect(),
        sections: batch.sections,
        next_cursor: encode_cursor(&batch.next),
    };
    context.cache.put_list(key, &page);
    to_value(&page)
}

/// The sections and cursors of one list read.
struct ListBatch {
    facts: HashMap<PullRequestKey, (usize, bool)>,
    sections: Vec<ListSectionWire>,
    next: HashMap<String, String>,
    repositories: BTreeSet<String>,
}

/// Lists one account; a failure degrades only its own section.
async fn list_account(
    context: &ForgeContext,
    session: &mut PluginSession,
    plugin_id: &str,
    link: &AccountLink,
    request: &ListRequest,
    cursor: Option<String>,
    batch: &mut ListBatch,
) {
    let listed: Result<ListResult, _> = session
        .call(
            methods::PULL_REQUESTS_LIST,
            &ListParams {
                account: link.account_ref(),
                category: request.category,
                repository: request.repository.clone(),
                cursor,
                limit: limits::LIST_PAGE_LIMIT,
            },
        )
        .await;
    let listed = match listed {
        Ok(listed) => listed,
        Err(error) => {
            let error = ForgeError::from_plugin(plugin_id, Some(&link.key), error);
            context.accounts.observe_error(&link.key, &error);
            batch.sections.push(empty_section(context, link));
            return;
        }
    };
    context
        .accounts
        .observe(&link.key, super::wire::AccountCondition::Connected);
    if let Some(cursor) = listed.next_cursor.clone() {
        batch.next.insert(link.key.as_str().to_owned(), cursor);
    }
    let rows: Vec<PullRequestRowWire> = listed
        .rows
        .into_iter()
        .filter(|row| row.pr_ref.host.eq_ignore_ascii_case(&link.host))
        .map(|row| {
            let pull_request = PullRequestKey::issue(plugin_id, &row.pr_ref);
            let (count, local) = batch
                .facts
                .get(&pull_request)
                .copied()
                .unwrap_or((0, false));
            batch.repositories.insert(row.repository.clone());
            PullRequestRowWire {
                pull_request,
                account: link.key.clone(),
                repository: row.repository,
                number: row.number,
                title: row.title,
                author: row.author,
                state: row.state,
                review_requested_from_me: row.review_requested_from_me,
                checks: row.checks,
                local_checkout: local,
                linked_thread_count: count,
                updated_at: row.updated_at,
                web_url: super::wire::page_on_host(row.web_url, &link.host),
            }
        })
        .collect();
    batch.sections.push(ListSectionWire {
        account: context.accounts.wire(link),
        supported_categories: listed.supported_categories,
        rows,
    });
}

fn empty_section(context: &ForgeContext, link: &AccountLink) -> ListSectionWire {
    ListSectionWire {
        account: context.accounts.wire(link),
        supported_categories: Vec::new(),
        rows: Vec::new(),
    }
}

/// `(linked thread count, has a branch link)` per pull request.
fn link_facts(links: &[LinkRecord]) -> HashMap<PullRequestKey, (usize, bool)> {
    let mut facts: HashMap<PullRequestKey, (usize, bool)> = HashMap::new();
    for link in links {
        let entry = facts.entry(link.pull_request.clone()).or_default();
        entry.0 += 1;
        entry.1 |= link.source == super::wire::LinkSource::Branch;
    }
    facts
}

/// The list cursor is opaque to clients and spans every account.
fn decode_cursor(cursor: Option<&str>) -> Result<Option<HashMap<String, String>>, ForgeError> {
    let Some(cursor) = cursor else {
        return Ok(None);
    };
    URL_SAFE_NO_PAD
        .decode(cursor)
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .map(Some)
        .ok_or_else(|| ForgeError::invalid("invalid cursor"))
}

fn encode_cursor(next: &HashMap<String, String>) -> Option<String> {
    (!next.is_empty())
        .then(|| serde_json::to_vec(next).ok())
        .flatten()
        .map(|bytes| URL_SAFE_NO_PAD.encode(bytes))
}

fn to_value<T: serde::Serialize>(value: &T) -> Result<Value, ForgeError> {
    serde_json::to_value(value).map_err(|error| ForgeError::internal(error.to_string()))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct OverviewRequest {
    pull_request: Value,
}

/// `companion/pullRequest/read`: one atomic snapshot of overview, catalog,
/// checks and links.
///
/// # Errors
///
/// Returns the mapped plugin failure; nothing partial is returned.
pub async fn overview(context: &ForgeContext, raw: &Value) -> Result<Value, ForgeError> {
    let request: OverviewRequest = params(raw)?;
    let (key, identity) = ForgeContext::pull_request(&request.pull_request)?;
    if let Some(overview) = context.cache.overview(&key) {
        return to_value(&overview);
    }
    let overview = load_overview(context, &key, &identity).await?;
    to_value(&overview)
}

/// Reads and caches a fresh overview.
///
/// # Errors
///
/// Returns the mapped plugin failure.
pub async fn load_overview(
    context: &ForgeContext,
    key: &PullRequestKey,
    identity: &PullRequestIdentity,
) -> Result<OverviewWire, ForgeError> {
    let account = context.account_for(key, identity)?;
    let mut session = context.session(&identity.plugin_id).await?;
    let result = read_parts(&mut session, &account, identity).await;
    session.shutdown().await;
    let (read, catalog, checks) = result.map_err(|error| context.observe(&account, error))?;
    context
        .accounts
        .observe(&account.key, super::wire::AccountCondition::Connected);
    let head_revision = HeadRevision::parse(&read.head_revision)
        .ok_or_else(|| ForgeError::internal("the plugin returned an invalid head revision"))?;
    let links = context.links.of_pull_request(key)?;
    let local_checkout = local_checkout(context, &links, &read.head_branch);
    let mut actions = parse_catalog(&catalog.actions);
    if catalog.head_revision != read.head_revision {
        // The head moved between the two reads: offer no plugin action for a
        // head the overview does not show.
        actions.clear();
    }
    let (checks, check_items) = match checks {
        Some(Ok(result)) => (result.summary, result.items),
        Some(Err(reason)) => (CheckSummary::unavailable(reason), Vec::new()),
        None => (
            read.checks
                .clone()
                .unwrap_or_else(|| CheckSummary::unavailable("Checks are not available")),
            read.check_items.clone(),
        ),
    };
    actions.extend(scenarios::descriptors(
        &read,
        &checks,
        &check_items,
        local_checkout.is_some(),
    ));
    let overview = OverviewWire {
        pull_request: key.clone(),
        account: context.accounts.wire(&account),
        repository: read.repository,
        number: read.number,
        title: read.title,
        author: read.author,
        state: read.state,
        web_url: super::wire::page_on_host(read.web_url, &identity.pr_ref.host),
        fetched_at: now_rfc3339(),
        catalog: catalog_wire(head_revision.clone(), &actions),
        head_revision,
        head_branch: read.head_branch,
        base_branch: read.base_branch,
        description: read.description,
        stats: read.stats,
        merge: read.merge,
        checks,
        check_items,
        activity: read.activity,
        links: links.iter().map(LinkRecord::wire).collect(),
        local_checkout,
    };
    if let Err(error) = context.links.observe_state(key, overview.state) {
        tracing::warn!(kind = error.log_kind(), "link state refresh failed");
    }
    context.cache.put_overview(&overview);
    Ok(overview)
}

type ReadParts = (
    PullRequestOverview,
    RawActionCatalog,
    Option<Result<ChecksResult, String>>,
);

async fn read_parts(
    session: &mut PluginSession,
    account: &AccountLink,
    identity: &PullRequestIdentity,
) -> Result<ReadParts, ForgeError> {
    let plugin = identity.plugin_id.clone();
    let map = |error| ForgeError::from_plugin(&plugin, Some(&account.key), error);
    let target = PullRequestParams {
        account: account.account_ref(),
        pr_ref: identity.pr_ref.clone(),
    };
    let read: PullRequestOverview = session
        .call(methods::PULL_REQUEST_READ, &target)
        .await
        .map_err(map)?;
    let catalog: RawActionCatalog = session
        .call(methods::PULL_REQUEST_ACTIONS, &target)
        .await
        .map_err(map)?;
    let checks = if session.supports(capability::CHECKS) {
        let checks: Result<ChecksResult, _> = session
            .call(
                methods::PULL_REQUEST_CHECKS,
                &ChecksParams {
                    account: account.account_ref(),
                    pr_ref: identity.pr_ref.clone(),
                    head_revision: read.head_revision.clone(),
                },
            )
            .await;
        Some(checks.map_err(|error| match map(error) {
            ForgeError::CapabilityUnavailable { reason }
            | ForgeError::AuthRequired { hint: reason, .. } => reason,
            _ => "Checks could not be read".to_owned(),
        }))
    } else {
        None
    };
    Ok((read, catalog, checks))
}

/// The local checkout of a pull request: a branch-linked thread whose
/// working directory is admitted (a project root or a known thread cwd).
fn local_checkout(
    context: &ForgeContext,
    links: &[LinkRecord],
    head_branch: &str,
) -> Option<LocalCheckoutWire> {
    let admission = context.workspaces.as_ref()?;
    links
        .iter()
        .filter(|link| link.source == super::wire::LinkSource::Branch)
        .find_map(|link| admission.thread_cwd(&link.thread_id))
        .map(|workspace| LocalCheckoutWire {
            workspace,
            branch: head_branch.to_owned(),
        })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ActivityRequest {
    pull_request: Value,
    cursor: Option<String>,
}

/// `companion/pullRequest/activity/read`.
///
/// # Errors
///
/// Returns the mapped plugin failure.
pub async fn activity(context: &ForgeContext, raw: &Value) -> Result<Value, ForgeError> {
    let request: ActivityRequest = params(raw)?;
    let (key, identity) = ForgeContext::pull_request(&request.pull_request)?;
    let account = context.account_for(&key, &identity)?;
    let mut session = context.session(&identity.plugin_id).await?;
    let page: Result<ActivityPage, _> = session
        .call(
            methods::PULL_REQUEST_ACTIVITY,
            &ActivityParams {
                account: account.account_ref(),
                pr_ref: identity.pr_ref.clone(),
                cursor: request.cursor,
            },
        )
        .await;
    session.shutdown().await;
    let page = page.map_err(|error| {
        context.observe(
            &account,
            ForgeError::from_plugin(&identity.plugin_id, Some(&account.key), error),
        )
    })?;
    to_value(&page)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct FilesRequest {
    pull_request: Value,
    head_revision: String,
    cursor: Option<String>,
}

/// `companion/pullRequest/files/read`: one page of at most 100 files with
/// their hunk catalogs. A stale head answers `-32082` with the new head.
///
/// # Errors
///
/// Returns `-32082` for a moved head or the mapped plugin failure.
pub async fn files(context: &ForgeContext, raw: &Value) -> Result<Value, ForgeError> {
    let request: FilesRequest = params(raw)?;
    let (key, identity) = ForgeContext::pull_request(&request.pull_request)?;
    let head = HeadRevision::parse(&request.head_revision)
        .ok_or_else(|| ForgeError::invalid("invalid headRevision"))?;
    let page = files_page(context, &key, &identity, &head, request.cursor).await?;
    to_value(&page)
}

/// Reads one files page at `head` (also the PR diff catalog source).
///
/// # Errors
///
/// Returns `-32082` for a moved head or the mapped plugin failure.
pub async fn files_page(
    context: &ForgeContext,
    key: &PullRequestKey,
    identity: &PullRequestIdentity,
    head: &HeadRevision,
    cursor: Option<String>,
) -> Result<FilesPageWire, ForgeError> {
    let account = context.account_for(key, identity)?;
    let mut session = context.session(&identity.plugin_id).await?;
    let forge_viewed = session.supports(capability::VIEWED);
    let listed: Result<FilesResult, _> = session
        .call(
            methods::PULL_REQUEST_FILES,
            &FilesParams {
                account: account.account_ref(),
                pr_ref: identity.pr_ref.clone(),
                head_revision: head.as_str().to_owned(),
                cursor,
            },
        )
        .await;
    session.shutdown().await;
    let listed = listed.map_err(|error| {
        context.observe(
            &account,
            ForgeError::from_plugin(&identity.plugin_id, Some(&account.key), error),
        )
    })?;
    if listed.head_revision != head.as_str() {
        return Err(ForgeError::StaleHead {
            head_revision: HeadRevision::parse(&listed.head_revision)
                .ok_or_else(|| ForgeError::internal("invalid head revision"))?,
            catalog: None,
        });
    }
    let source = DiffSource::PullRequest {
        pull_request: key.as_str().to_owned(),
    };
    let local = if forge_viewed {
        HashMap::new()
    } else {
        context.review.viewed().marks(&source, head.as_str())?
    };
    let mut files = listed.files;
    if files.len() > limits::FILES_PAGE_MAX {
        tracing::warn!(pull_request = %key.log_hash(), "forge plugin returned an oversized files page");
        files.truncate(limits::FILES_PAGE_MAX);
    }
    let files = files
        .into_iter()
        .map(|file| {
            let patch = match file.patch {
                FilePatch::Present { text } if text.len() > limits::MAX_PATCH_BYTES => {
                    PatchWire::TooLarge {
                        bytes: u64::try_from(text.len()).ok(),
                    }
                }
                FilePatch::Present { text } => PatchWire::Present {
                    hunks: parse_patch(&file.path, &text)
                        .into_iter()
                        .map(|parsed| parsed.hunk)
                        .collect(),
                    text,
                },
                FilePatch::TooLarge { bytes } => PatchWire::TooLarge { bytes },
                FilePatch::Binary => PatchWire::Binary,
                FilePatch::NotProvided => PatchWire::NotProvided,
            };
            let viewed = if forge_viewed {
                ViewedMarkWire {
                    viewed: file.viewed.unwrap_or(false),
                    source: ViewedSource::Forge,
                }
            } else {
                ViewedMarkWire {
                    viewed: local.get(&file.path).copied().unwrap_or(false),
                    source: ViewedSource::Companion,
                }
            };
            FileWire {
                path: file.path,
                previous_path: file.previous_path,
                status: file.status,
                additions: file.additions,
                deletions: file.deletions,
                patch,
                viewed,
            }
        })
        .collect();
    Ok(FilesPageWire {
        head_revision: head.clone(),
        files,
        truncated: listed.truncated,
        next_cursor: listed.next_cursor,
    })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ViewedRequest {
    pull_request: Value,
    head_revision: String,
    path: String,
    viewed: bool,
}

/// `companion/pullRequest/viewed/set`: the only trigger of a forge viewed
/// mark. Without `forge.viewed@1` the mark stays on this companion.
///
/// # Errors
///
/// Returns `-32082` for a moved head or the mapped plugin failure.
pub async fn set_viewed(context: &ForgeContext, raw: &Value) -> Result<Value, ForgeError> {
    let request: ViewedRequest = params(raw)?;
    let (key, identity) = ForgeContext::pull_request(&request.pull_request)?;
    let head = HeadRevision::parse(&request.head_revision)
        .ok_or_else(|| ForgeError::invalid("invalid headRevision"))?;
    if request.path.is_empty() || request.path.len() > 4_096 || request.path.contains('\0') {
        return Err(ForgeError::invalid("invalid path"));
    }
    let account = context.account_for(&key, &identity)?;
    let mut session = context.session(&identity.plugin_id).await?;
    let source = if session.supports(capability::VIEWED) {
        let result: Result<Value, _> = session
            .call(
                methods::PULL_REQUEST_VIEWED_SET,
                &ViewedSetParams {
                    account: account.account_ref(),
                    pr_ref: identity.pr_ref.clone(),
                    head_revision: head.as_str().to_owned(),
                    path: request.path.clone(),
                    viewed: request.viewed,
                },
            )
            .await;
        session.shutdown().await;
        result.map_err(|error| {
            context.observe(
                &account,
                ForgeError::from_plugin(&identity.plugin_id, Some(&account.key), error),
            )
        })?;
        ViewedSource::Forge
    } else {
        session.shutdown().await;
        context.review.viewed().set(
            &DiffSource::PullRequest {
                pull_request: key.as_str().to_owned(),
            },
            head.as_str(),
            &request.path,
            request.viewed,
        )?;
        ViewedSource::Companion
    };
    Ok(json!({"path": request.path, "viewed": request.viewed, "source": source}))
}

#[cfg(test)]
#[allow(clippy::expect_used)]
mod tests {
    use super::*;

    #[test]
    fn list_cursors_are_opaque_and_span_accounts() {
        let mut next = HashMap::new();
        next.insert("fac1.a".to_owned(), "page-2".to_owned());
        let encoded = encode_cursor(&next).expect("cursor");
        assert_eq!(decode_cursor(Some(&encoded)).expect("decodes"), Some(next));
        assert_eq!(encode_cursor(&HashMap::new()), None);
        assert!(decode_cursor(Some("not base64 json")).is_err());
    }
}
