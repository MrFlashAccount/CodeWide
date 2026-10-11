//! Permission profiles of spawned agents: the non-escalation rule and the
//! parent's effective profile as the client wire reports it.
//!
//! The built-in profiles are ordered `:read-only` < `:workspace` <
//! `:full-access` < `:danger-full-access`. A child never gets more than its
//! parent. When the parent's profile is unknown (a Codex thread whose
//! settings were not observed since the companion started), only
//! `:read-only` is allowed: the rule fails closed.

use std::{collections::HashMap, sync::Mutex};

use serde_json::Value;

use crate::agent::client_wire::observe;

pub const READ_ONLY: &str = ":read-only";
const ORDER: [&str; 4] = [
    READ_ONLY,
    ":workspace",
    ":full-access",
    ":danger-full-access",
];
/// Bound of the observed-profile map; a full map starts over.
const MAX_OBSERVED_THREADS: usize = 4_096;

fn rank(profile: &str) -> Option<usize> {
    ORDER.iter().position(|known| *known == profile)
}

/// The child's profile: the request, else the parent's, never above the
/// parent's.
///
/// # Errors
/// Returns the message the model sees for an unknown or escalating profile.
pub fn child_profile(parent: Option<&str>, requested: Option<&str>) -> Result<String, String> {
    let Some(requested) = requested else {
        return Ok(parent.unwrap_or(READ_ONLY).to_owned());
    };
    let Some(requested_rank) = rank(requested) else {
        return Err(format!("unknown permission profile: {requested}"));
    };
    let allowed = match parent {
        None => requested == READ_ONLY,
        Some(parent) => match rank(parent) {
            Some(parent_rank) => requested_rank <= parent_rank,
            // A custom parent profile has no place in the order: only the
            // same profile or the most restrictive one.
            None => requested == parent || requested == READ_ONLY,
        },
    };
    if allowed {
        Ok(requested.to_owned())
    } else {
        Err(format!(
            "permission profile {requested} exceeds this thread's profile {}",
            parent.unwrap_or("(unknown; only :read-only is allowed)")
        ))
    }
}

/// Effective profiles of threads, observed on the client wire.
#[derive(Default)]
pub struct ProfileObservations {
    profiles: Mutex<HashMap<String, String>>,
}

impl ProfileObservations {
    fn record(&self, thread_id: &str, profile: &str) {
        let mut profiles = self
            .profiles
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if profiles.len() >= MAX_OBSERVED_THREADS && !profiles.contains_key(thread_id) {
            profiles.clear();
        }
        profiles.insert(thread_id.to_owned(), profile.to_owned());
    }

    /// Observes a provider notification.
    pub fn observe_event(&self, payload: &Value) {
        if let Some((thread_id, profile)) = observe::settings_profile(payload) {
            self.record(thread_id, profile);
        }
    }

    /// Observes an RPC result.
    pub fn observe_rpc_result(&self, method: &str, result: &Value) {
        if let Some((thread_id, profile)) = observe::result_profile(method, result) {
            self.record(thread_id, profile);
        }
    }

    #[must_use]
    pub fn get(&self, thread_id: &str) -> Option<String> {
        self.profiles
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .get(thread_id)
            .cloned()
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn a_child_never_exceeds_its_parent() {
        assert_eq!(
            child_profile(Some(":workspace"), None),
            Ok(":workspace".into())
        );
        assert_eq!(
            child_profile(Some(":workspace"), Some(":read-only")),
            Ok(":read-only".into())
        );
        assert!(child_profile(Some(":workspace"), Some(":full-access")).is_err());
        assert!(child_profile(Some(":full-access"), Some(":danger-full-access")).is_err());
        assert_eq!(
            child_profile(Some(":danger-full-access"), Some(":full-access")),
            Ok(":full-access".into())
        );
        assert!(child_profile(Some(":workspace"), Some(":custom")).is_err());
    }

    #[test]
    fn an_unknown_parent_profile_fails_closed() {
        assert_eq!(child_profile(None, None), Ok(READ_ONLY.into()));
        assert!(child_profile(None, Some(":workspace")).is_err());
        assert_eq!(child_profile(Some("team"), None), Ok("team".into()));
        assert!(child_profile(Some("team"), Some(":workspace")).is_err());
        assert_eq!(
            child_profile(Some("team"), Some(READ_ONLY)),
            Ok(READ_ONLY.into())
        );
    }

    #[test]
    fn observes_profiles_from_notifications_and_results() {
        let observed = ProfileObservations::default();
        observed.observe_rpc_result(
            "thread/start",
            &json!({"thread": {"id": "t"}, "activePermissionProfile": {"id": ":workspace"}}),
        );
        assert_eq!(observed.get("t").as_deref(), Some(":workspace"));
        observed.observe_event(&json!({"method": "thread/settings/updated", "params": {
            "threadId": "t", "threadSettings": {"activePermissionProfile": {"id": ":read-only"}}}}));
        assert_eq!(observed.get("t").as_deref(), Some(":read-only"));
    }
}
