//! Permission profiles of spawned agents: the non-escalation rule and the
//! parent's effective profile as the client wire reports it.
//!
//! The built-in profiles are ordered `:read-only` < `:workspace` <
//! `:full-access` = `:danger-full-access`. A child never gets more than its
//! parent. When the parent's profile is unknown (a Codex thread whose
//! settings were not observed since the companion started), inheritance fails
//! explicitly instead of silently lowering the child to read-only.

use crate::agent::permission_profiles::READ_ONLY;

fn rank(profile: &str) -> Option<usize> {
    match profile {
        READ_ONLY => Some(0),
        ":workspace" => Some(1),
        ":full-access" | ":danger-full-access" => Some(2),
        _ => None,
    }
}

/// The child's profile: the request, else the parent's, never above the
/// parent's.
///
/// # Errors
/// Returns the message the model sees for an unknown or escalating profile.
pub fn child_profile(parent: Option<&str>, requested: Option<&str>) -> Result<String, String> {
    let Some(requested) = requested else {
        return parent.map(str::to_owned).ok_or_else(|| {
            "cannot inherit permissions: the parent thread's effective profile is unknown".into()
        });
    };
    if parent == Some(requested) {
        return Ok(requested.to_owned());
    }
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

#[cfg(test)]
mod tests {
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
        assert_eq!(
            child_profile(Some(":full-access"), Some(":danger-full-access")),
            Ok(":danger-full-access".into())
        );
        assert_eq!(
            child_profile(Some(":danger-full-access"), Some(":full-access")),
            Ok(":full-access".into())
        );
        assert!(child_profile(Some(":workspace"), Some(":custom")).is_err());
    }

    #[test]
    fn an_unknown_parent_profile_fails_closed() {
        assert!(child_profile(None, None).is_err());
        assert!(child_profile(None, Some(":workspace")).is_err());
        assert_eq!(child_profile(Some("team"), None), Ok("team".into()));
        assert_eq!(child_profile(Some("team"), Some("team")), Ok("team".into()));
        assert!(child_profile(Some("team"), Some(":workspace")).is_err());
        assert_eq!(
            child_profile(Some("team"), Some(READ_ONLY)),
            Ok(READ_ONLY.into())
        );
    }
}
