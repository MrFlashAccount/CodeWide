//! Plugin method names, one source of truth for the client, plugins and the
//! conformance harness.

pub const INITIALIZE: &str = "initialize";
pub const AUTH_METHODS: &str = "auth.methods";
pub const AUTH_START: &str = "auth.start";
pub const AUTH_POLL: &str = "auth.poll";
pub const AUTH_VERIFY: &str = "auth.verify";
pub const AUTH_DISCONNECT: &str = "auth.disconnect";
pub const PULL_REQUESTS_LIST: &str = "forge.pullRequests.list";
pub const PULL_REQUESTS_SEARCH: &str = "forge.pullRequests.search";
pub const PULL_REQUESTS_BY_BRANCH: &str = "forge.pullRequests.byBranch";
pub const REPOSITORY_RESOLVE: &str = "forge.repository.resolve";
pub const PULL_REQUEST_READ: &str = "forge.pullRequest.read";
pub const PULL_REQUEST_ACTIVITY: &str = "forge.pullRequest.activity";
pub const PULL_REQUEST_CHECKS: &str = "forge.pullRequest.checks";
pub const PULL_REQUEST_FILES: &str = "forge.pullRequest.files";
pub const PULL_REQUEST_ACTIONS: &str = "forge.pullRequest.actions";
pub const PULL_REQUEST_ACTION_RUN: &str = "forge.pullRequest.action.run";
pub const PULL_REQUEST_REVIEW_SUBMIT: &str = "forge.pullRequest.review.submit";
pub const PULL_REQUEST_VIEWED_SET: &str = "forge.pullRequest.viewed.set";
pub const PULL_REQUEST_SCENARIO_CONTEXT: &str = "forge.pullRequest.scenarioContext";

/// The capability a method requires, `None` for `initialize`.
#[must_use]
pub fn required_capability(method: &str) -> Option<&'static str> {
    use crate::capability;
    Some(match method {
        AUTH_METHODS | AUTH_START | AUTH_POLL | AUTH_VERIFY | AUTH_DISCONNECT => capability::AUTH,
        PULL_REQUESTS_LIST => capability::LIST,
        PULL_REQUESTS_SEARCH => capability::SEARCH,
        PULL_REQUESTS_BY_BRANCH | REPOSITORY_RESOLVE => capability::RESOLVE,
        PULL_REQUEST_READ | PULL_REQUEST_ACTIVITY => capability::READ,
        PULL_REQUEST_CHECKS => capability::CHECKS,
        PULL_REQUEST_FILES => capability::DIFF,
        PULL_REQUEST_ACTIONS | PULL_REQUEST_ACTION_RUN => capability::ACTIONS,
        PULL_REQUEST_REVIEW_SUBMIT => capability::REVIEW,
        PULL_REQUEST_VIEWED_SET => capability::VIEWED,
        PULL_REQUEST_SCENARIO_CONTEXT => capability::SCENARIO_CONTEXT,
        _ => return None,
    })
}
