//! Pull request lists: the GraphQL search per category, check rollups and
//! the open pull requests of a branch.

use forge_protocol::{
    ByBranchResult, CheckRollup, CheckSummary, ForgePrRef, ListResult, PluginError,
    PullRequestCategory, PullRequestState,
};
use serde_json::{Value, json};

use crate::{api::Api, repo::Repo};

const LIST_QUERY: &str = r"
query($q: String!, $n: Int!, $after: String) {
  search(query: $q, type: ISSUE, first: $n, after: $after) {
    pageInfo { hasNextPage endCursor }
    nodes {
      ... on PullRequest {
        number title url isDraft state updatedAt
        author { login }
        repository { nameWithOwner }
        reviewRequests(first: 25) { nodes { requestedReviewer { ... on User { login } } } }
        commits(last: 1) { nodes { commit { statusCheckRollup {
          contexts(first: 1) {
            checkRunCountsByState { state count }
            statusContextCountsByState { state count }
          }
        } } } }
      }
    }
  }
}";

/// `forge.pullRequests.list`: one GraphQL search per call.
///
/// # Errors
///
/// Returns the mapped GitHub failure.
pub async fn list(
    api: &Api,
    host: &str,
    login: &str,
    category: PullRequestCategory,
    repository: Option<&str>,
    cursor: Option<String>,
    limit: u32,
) -> Result<ListResult, PluginError> {
    let mut query = match category {
        PullRequestCategory::ReviewRequested => format!("review-requested:{login}"),
        PullRequestCategory::Authored => format!("author:{login}"),
        PullRequestCategory::Assigned => format!("assignee:{login}"),
        PullRequestCategory::Mentioned => format!("mentions:{login}"),
        PullRequestCategory::Drafts => format!("draft:true author:{login}"),
    };
    query.push_str(" is:pr is:open archived:false sort:updated-desc");
    if let Some(repository) = repository {
        query.push_str(" repo:");
        query.push_str(&Repo::parse(repository)?.full());
    }
    let data = api
        .graphql(
            LIST_QUERY,
            json!({ "q": query, "n": limit.clamp(1, forge_protocol::MAX_LIST_LIMIT), "after": cursor }),
        )
        .await?;
    let search = data
        .get("search")
        .ok_or_else(|| PluginError::internal("GitHub returned no search result"))?;
    let rows = search
        .get("nodes")
        .and_then(Value::as_array)
        .map(|nodes| {
            nodes
                .iter()
                .filter_map(|node| list_row(node, host, login))
                .collect()
        })
        .unwrap_or_default();
    let next_cursor = (search.pointer("/pageInfo/hasNextPage") == Some(&Value::Bool(true)))
        .then(|| {
            search
                .pointer("/pageInfo/endCursor")
                .and_then(Value::as_str)
                .map(str::to_owned)
        })
        .flatten();
    Ok(ListResult {
        supported_categories: vec![
            PullRequestCategory::ReviewRequested,
            PullRequestCategory::Authored,
            PullRequestCategory::Assigned,
            PullRequestCategory::Mentioned,
            PullRequestCategory::Drafts,
        ],
        rows,
        next_cursor,
    })
}

fn list_row(node: &Value, host: &str, login: &str) -> Option<forge_protocol::ListRow> {
    let number = node.get("number")?.as_u64()?.to_string();
    let repository = node
        .pointer("/repository/nameWithOwner")?
        .as_str()?
        .to_owned();
    let draft = node.get("isDraft").and_then(Value::as_bool) == Some(true);
    let state = graphql_state(node.get("state")?.as_str()?, draft);
    let review_requested_from_me = node
        .pointer("/reviewRequests/nodes")
        .and_then(Value::as_array)
        .is_some_and(|nodes| {
            nodes.iter().any(|request| {
                request
                    .pointer("/requestedReviewer/login")
                    .and_then(Value::as_str)
                    .is_some_and(|reviewer| reviewer.eq_ignore_ascii_case(login))
            })
        });
    let contexts = node.pointer("/commits/nodes/0/commit/statusCheckRollup/contexts");
    Some(forge_protocol::ListRow {
        pr_ref: ForgePrRef {
            host: host.to_owned(),
            repository: repository.clone(),
            number: number.clone(),
        },
        repository,
        number,
        title: node.get("title")?.as_str()?.to_owned(),
        author: node
            .pointer("/author/login")
            .and_then(Value::as_str)
            .unwrap_or("ghost")
            .to_owned(),
        state,
        review_requested_from_me,
        checks: contexts.map_or(
            CheckSummary::Counted {
                state: CheckRollup::None,
                passed: 0,
                failing: 0,
                pending: 0,
            },
            rollup_counts,
        ),
        updated_at: node.get("updatedAt")?.as_str()?.to_owned(),
        web_url: node.get("url")?.as_str()?.to_owned(),
    })
}

fn graphql_state(state: &str, draft: bool) -> PullRequestState {
    match state {
        "MERGED" => PullRequestState::Merged,
        "CLOSED" => PullRequestState::Closed,
        _ if draft => PullRequestState::Draft,
        _ => PullRequestState::Open,
    }
}

/// Counts of `checkRunCountsByState` and `statusContextCountsByState`.
fn rollup_counts(contexts: &Value) -> CheckSummary {
    let mut tally = Tally::default();
    for (field, map) in [
        ("checkRunCountsByState", run_bucket as fn(&str) -> Bucket),
        ("statusContextCountsByState", status_bucket),
    ] {
        for entry in contexts
            .get(field)
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
        {
            let count = entry
                .get("count")
                .and_then(Value::as_u64)
                .and_then(|count| u32::try_from(count).ok())
                .unwrap_or(0);
            let state = entry.get("state").and_then(Value::as_str).unwrap_or("");
            tally.add(map(&state.to_ascii_lowercase()), count);
        }
    }
    tally.summary()
}

#[derive(Clone, Copy)]
pub(crate) enum Bucket {
    Passed,
    Failing,
    Pending,
}

#[derive(Default)]
pub(crate) struct Tally {
    passed: u32,
    failing: u32,
    pending: u32,
}

impl Tally {
    pub(crate) fn add(&mut self, bucket: Bucket, count: u32) {
        let slot = match bucket {
            Bucket::Passed => &mut self.passed,
            Bucket::Failing => &mut self.failing,
            Bucket::Pending => &mut self.pending,
        };
        *slot = slot.saturating_add(count);
    }

    pub(crate) fn summary(&self) -> CheckSummary {
        let state = if self.failing > 0 {
            CheckRollup::Failing
        } else if self.pending > 0 {
            CheckRollup::Pending
        } else if self.passed > 0 {
            CheckRollup::Passing
        } else {
            CheckRollup::None
        };
        CheckSummary::Counted {
            state,
            passed: self.passed,
            failing: self.failing,
            pending: self.pending,
        }
    }
}

/// Check run states and conclusions (both lower-cased).
pub(crate) fn run_bucket(state: &str) -> Bucket {
    match state {
        "success" | "neutral" | "skipped" => Bucket::Passed,
        "failure" | "timed_out" | "cancelled" | "action_required" | "startup_failure" | "error"
        | "stale" => Bucket::Failing,
        _ => Bucket::Pending,
    }
}

pub(crate) fn status_bucket(state: &str) -> Bucket {
    match state {
        "success" => Bucket::Passed,
        "failure" | "error" => Bucket::Failing,
        _ => Bucket::Pending,
    }
}

const BY_BRANCH_QUERY: &str = r"
query($owner: String!, $name: String!, $branch: String!) {
  repository(owner: $owner, name: $name) {
    pullRequests(headRefName: $branch, states: OPEN, first: 20) { nodes { number } }
  }
}";

/// `forge.pullRequests.byBranch`: open pull requests whose head branch is
/// `branch`, including ones from forks.
///
/// # Errors
///
/// Returns the mapped GitHub failure.
pub async fn by_branch(
    api: &Api,
    host: &str,
    repository: &str,
    branch: &str,
) -> Result<ByBranchResult, PluginError> {
    let repo = Repo::parse(repository)?;
    if branch.is_empty() || branch.len() > 255 {
        return Err(PluginError::invalid_params("invalid branch"));
    }
    let data = api
        .graphql(
            BY_BRANCH_QUERY,
            json!({ "owner": repo.owner, "name": repo.name, "branch": branch }),
        )
        .await?;
    let refs = data
        .pointer("/repository/pullRequests/nodes")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|node| node.get("number").and_then(Value::as_u64))
        .map(|number| ForgePrRef {
            host: host.to_owned(),
            repository: repo.full(),
            number: number.to_string(),
        })
        .collect();
    Ok(ByBranchResult { refs })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rollup_counts_map_run_and_status_states() {
        let contexts = json!({
            "checkRunCountsByState": [
                {"state": "SUCCESS", "count": 3}, {"state": "FAILURE", "count": 1},
                {"state": "IN_PROGRESS", "count": 2}
            ],
            "statusContextCountsByState": [{"state": "SUCCESS", "count": 1}]
        });
        assert_eq!(
            rollup_counts(&contexts),
            CheckSummary::Counted {
                state: CheckRollup::Failing,
                passed: 4,
                failing: 1,
                pending: 2
            }
        );
    }
}
