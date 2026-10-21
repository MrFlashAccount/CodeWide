//! Permission-profile ids at provider boundaries. Providers may use
//! different built-in ids for the same access level, so a profile inherited
//! across providers is expressed in the target provider's own catalog before
//! a thread is created.

use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};

use crate::agent::{
    client_wire::observe,
    model::{PermissionProfileCatalog, ProviderId},
    provider::AgentProvider,
};
use serde_json::Value;

/// Full access under each provider's name for it: Claude has both,
/// Codex only `:danger-full-access`. Both lift every check.
const FULL_ACCESS: [&str; 2] = [":full-access", ":danger-full-access"];
/// The least privileged built-in profile and the safe fallback when a
/// source thread's effective profile is unknown.
pub const READ_ONLY: &str = ":read-only";
/// Bound of the observed-profile map; a full map starts over.
const MAX_OBSERVED_THREADS: usize = 4_096;

/// Effective profiles of threads, observed on the client wire. This covers a
/// Codex thread whose configured sandbox has no named profile in
/// `thread/read` but whose start, resume or settings event reports the policy
/// it actually runs under.
#[derive(Default)]
pub struct ProfileObservations {
    profiles: Mutex<HashMap<(ProviderId, String), String>>,
}

impl ProfileObservations {
    fn record(&self, provider: &ProviderId, thread_id: &str, profile: &str) {
        let mut profiles = self
            .profiles
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let key = (provider.clone(), thread_id.to_owned());
        if profiles.len() >= MAX_OBSERVED_THREADS && !profiles.contains_key(&key) {
            profiles.clear();
        }
        profiles.insert(key, profile.to_owned());
    }

    /// Observes a provider notification.
    pub fn observe_event(&self, provider: &ProviderId, payload: &Value) {
        if let Some((thread_id, profile)) = observe::settings_profile(payload) {
            self.record(provider, thread_id, profile);
        }
    }

    /// Observes an RPC result.
    pub fn observe_rpc_result(&self, provider: &ProviderId, method: &str, result: &Value) {
        if let Some((thread_id, profile)) = observe::result_profile(method, result) {
            self.record(provider, thread_id, profile);
        }
    }

    /// Returns the most recently observed effective profile of `thread_id`.
    #[must_use]
    pub fn get(&self, provider: &ProviderId, thread_id: &str) -> Option<String> {
        self.profiles
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .get(&(provider.clone(), thread_id.to_owned()))
            .cloned()
    }
}

/// Expresses `profile` in `target`'s own permission-profile catalog. Missing,
/// empty, unknown and unsupported catalogs fail closed because the host cannot
/// prove that a target id is no stronger than the authenticated parent ceiling.
///
/// # Errors
/// Returns a message when the target catalog has no equivalent profile.
pub async fn for_provider(
    target: &Arc<dyn AgentProvider>,
    profile: String,
) -> Result<String, String> {
    match target.catalog_permission_profiles().await {
        Ok(catalog) => for_catalog(&profile, &catalog),
        Err(error) => Err(format!(
            "the target provider's permission profiles are unavailable: {error}"
        )),
    }
}

/// The profile in the target catalog: the same id when the target has it,
/// else the target's id for the same full-access level.
fn for_catalog(profile: &str, catalog: &PermissionProfileCatalog) -> Result<String, String> {
    if catalog.profiles.is_empty() {
        return Err("the target provider offers no permission profiles".into());
    }
    if catalog.profiles.iter().any(|row| row.id == profile) {
        return Ok(profile.to_owned());
    }
    if FULL_ACCESS.contains(&profile)
        && let Some(equivalent) = FULL_ACCESS
            .iter()
            .find(|candidate| catalog.profiles.iter().any(|row| row.id == **candidate))
    {
        return Ok((*equivalent).to_owned());
    }
    let offered = catalog
        .profiles
        .iter()
        .fold(String::new(), |mut offered, row| {
            if !offered.is_empty() {
                offered.push_str(", ");
            }
            offered.push_str(&row.id);
            offered
        });
    Err(format!(
        "the target provider has no permission profile {profile}; it offers {offered}"
    ))
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use crate::agent::model::{PermissionProfileCatalog, PermissionProfileEntry, ProviderId};

    use super::{ProfileObservations, for_catalog};

    fn catalog(ids: &[&str]) -> PermissionProfileCatalog {
        PermissionProfileCatalog {
            profiles: ids
                .iter()
                .map(|id| PermissionProfileEntry {
                    id: (*id).to_owned(),
                    display_name: (*id).to_owned(),
                    description: String::new(),
                })
                .collect(),
        }
    }

    #[test]
    fn full_access_takes_the_target_providers_name() {
        let codex = catalog(&[":read-only", ":workspace", ":danger-full-access"]);
        let claude = catalog(&[
            ":read-only",
            ":workspace",
            ":full-access",
            ":danger-full-access",
        ]);
        assert_eq!(
            for_catalog(":full-access", &codex),
            Ok(":danger-full-access".into())
        );
        assert_eq!(for_catalog(":workspace", &codex), Ok(":workspace".into()));
        assert_eq!(
            for_catalog(":full-access", &claude),
            Ok(":full-access".into())
        );
        assert!(for_catalog("team", &catalog(&[])).is_err());
        assert!(for_catalog("team", &codex).is_err());
        assert!(for_catalog(":workspace", &catalog(&[":read-only"])).is_err());
    }

    #[test]
    fn a_thread_on_its_configured_sandbox_has_the_matching_built_in_profile() {
        let observed = ProfileObservations::default();
        let codex = ProviderId::from_static("codex");
        observed.observe_rpc_result(
            &codex,
            "thread/resume",
            &json!({"thread": {"id": "t"}, "activePermissionProfile": null,
                "sandbox": {"type": "dangerFullAccess"}}),
        );
        assert_eq!(
            observed.get(&codex, "t").as_deref(),
            Some(":danger-full-access")
        );
        observed.observe_event(&codex, &json!({"method": "thread/settings/updated", "params": {
            "threadId": "t", "threadSettings": {"activePermissionProfile": null,
                "sandboxPolicy": {"type": "workspaceWrite", "writableRoots": [], "networkAccess": false}}}}));
        assert_eq!(observed.get(&codex, "t").as_deref(), Some(":workspace"));
        observed.observe_rpc_result(
            &codex,
            "thread/start",
            &json!({"thread": {"id": "u"}, "activePermissionProfile": null,
                "sandbox": {"type": "externalSandbox", "networkAccess": "restricted"}}),
        );
        assert_eq!(
            observed.get(&codex, "u"),
            None,
            "an external sandbox stays unknown"
        );
    }

    #[test]
    fn observes_profiles_from_notifications_and_results() {
        let observed = ProfileObservations::default();
        let codex = ProviderId::from_static("codex");
        observed.observe_rpc_result(
            &codex,
            "thread/start",
            &json!({"thread": {"id": "t"}, "activePermissionProfile": {"id": ":workspace"}}),
        );
        assert_eq!(observed.get(&codex, "t").as_deref(), Some(":workspace"));
        observed.observe_event(
            &codex,
            &json!({"method": "thread/settings/updated", "params": {
            "threadId": "t", "threadSettings": {"activePermissionProfile": {"id": ":read-only"}}}}),
        );
        assert_eq!(observed.get(&codex, "t").as_deref(), Some(":read-only"));
    }
}
