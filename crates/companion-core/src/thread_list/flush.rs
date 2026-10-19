//! Flush classes of thread-list row changes.
//!
//! A row change is either sent at once (`Urgent`) or coalesced into the next
//! frame at most once per `coalesceIntervalMs` (`Coalesced`). The class of a
//! journaled payload starts from its method here; `rows.rs` escalates a change
//! to `Urgent` when it moves the row's status, membership, pin or name. The
//! subscriber additionally flushes changes of the socket's interest threads
//! within `interestFlushIntervalMs`; that rule needs the socket and lives in
//! `subscriber.rs`.

use crate::sync_live::{PendingRequestClass, classify_pending_request_method};

/// How soon a changed row reaches the subscribers.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Ord, PartialOrd)]
pub enum FlushClass {
    /// Preview, `updatedAt`, `recencyAt` and `liveActivity` changes.
    Coalesced,
    /// Status, turn lifecycle, membership, pin, name and user requests.
    Urgent,
}

/// The base flush class of a journaled payload by its method: `Urgent` for the
/// lifecycle, membership and user-command methods, `Coalesced` otherwise.
#[must_use]
pub fn method_class(method: &str) -> FlushClass {
    let urgent = matches!(
        method,
        "thread/status/changed"
            | "turn/started"
            | "turn/completed"
            | "thread/started"
            | "thread/deleted"
            | "thread/archived"
            | "thread/unarchived"
            | "companion/thread/pin/updated"
            | "thread/name/updated"
    ) || is_user_request(method);
    if urgent {
        FlushClass::Urgent
    } else {
        FlushClass::Coalesced
    }
}

/// Whether the method is one of the user-interaction requests a list row
/// shows as waiting for the user.
#[must_use]
pub fn is_user_request(method: &str) -> bool {
    matches!(
        classify_pending_request_method(method),
        Some(PendingRequestClass::UserInteraction)
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lifecycle_membership_and_user_commands_are_urgent() {
        for method in [
            "thread/status/changed",
            "turn/started",
            "turn/completed",
            "thread/started",
            "thread/deleted",
            "thread/archived",
            "thread/unarchived",
            "companion/thread/pin/updated",
            "thread/name/updated",
            "item/commandExecution/requestApproval",
            "item/fileChange/requestApproval",
        ] {
            assert_eq!(method_class(method), FlushClass::Urgent, "{method}");
        }
    }

    #[test]
    fn activity_methods_are_coalesced() {
        for method in [
            "item/agentMessage/delta",
            "item/started",
            "item/completed",
            "item/reasoning/textDelta",
            "companion/thread/progress",
            "companion/thread/invalidated",
            "item/tool/call",
        ] {
            assert_eq!(method_class(method), FlushClass::Coalesced, "{method}");
        }
    }
}
