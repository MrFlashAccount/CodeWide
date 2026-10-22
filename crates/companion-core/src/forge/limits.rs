//! Companion-owned forge limits. Android renders the resulting flags
//! (`truncated`, `patch.state`) and never restates these numbers.

use std::time::Duration;

use forge_protocol::methods;

/// Default plugin call timeout.
pub const PLUGIN_CALL_TIMEOUT: Duration = Duration::from_secs(30);
/// `action.run` and `review.submit`.
pub const PLUGIN_WRITE_TIMEOUT: Duration = Duration::from_mins(1);
/// How long a call waits for a free plugin process slot.
pub const PLUGIN_SLOT_WAIT: Duration = Duration::from_secs(20);
/// How long a plugin may take to exit after stdin closes.
pub const PLUGIN_EXIT_WAIT: Duration = Duration::from_millis(500);
/// At most this many plugin processes run at once.
pub const MAX_PLUGIN_PROCESSES: usize = 4;

/// Host login flows are polled this often.
pub const AUTH_POLL_INTERVAL: Duration = Duration::from_secs(5);
/// At most this many host login flows hold a plugin process at once, so
/// reads always keep a process slot.
pub const MAX_AUTH_FLOWS: usize = 2;
/// A host login flow ends after this long; its plugin and host child end too.
pub const AUTH_FLOW_LIFETIME: Duration = Duration::from_mins(15);

/// A list or overview read is served from cache this long.
pub const READ_FRESHNESS: Duration = Duration::from_mins(1);
/// Derived account states are re-verified after this long.
pub const ACCOUNT_STATE_FRESHNESS: Duration = Duration::from_mins(1);
/// Rows per account and list page.
pub const LIST_PAGE_LIMIT: u32 = 50;
/// Files per page of `companion/pullRequest/files/read`.
pub const FILES_PAGE_MAX: usize = 100;
/// One file patch; larger ones become `patch.state = "tooLarge"`. Same bound
/// as the VCS diff limit.
pub const MAX_PATCH_BYTES: usize = 4 * 1024 * 1024;
/// Thread ids per `companion/pullRequestLinks/read`.
pub const MAX_LINK_READ_THREADS: usize = 200;
/// Thread lifecycle events of one workspace are coalesced this long before
/// branch detection runs.
pub const DETECTION_DEBOUNCE: Duration = Duration::from_secs(30);
/// Scenario context from a plugin, as fenced untrusted text.
pub const MAX_SCENARIO_CONTEXT_BYTES: usize = forge_protocol::MAX_SCENARIO_CONTEXT_BYTES;

/// The timeout of one plugin method.
#[must_use]
pub fn call_timeout(method: &str) -> Duration {
    match method {
        methods::PULL_REQUEST_ACTION_RUN | methods::PULL_REQUEST_REVIEW_SUBMIT => {
            PLUGIN_WRITE_TIMEOUT
        }
        _ => PLUGIN_CALL_TIMEOUT,
    }
}
