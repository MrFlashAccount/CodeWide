//! Account links and derived account states.
//!
//! The companion keeps only the link — key, provider, host, login, linked
//! time, whether the account feeds the pull request catalog, and the last
//! credential source and scopes the plugin reported — never a token. States are derived, never stored: `connected` after the
//! plugin's last `auth.verify` succeeded, `expired` after it reported
//! `authRequired`, `error` after any other failure.

use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    time::Instant,
};

use forge_protocol::{AuthMethodKind, CredentialSource, ForgeAccountRef};
use serde::{Deserialize, Serialize};

use super::{
    errors::ForgeError,
    ids::ForgeAccountKey,
    limits,
    wire::{AccountCondition, AccountStateWire, now_rfc3339},
};
use crate::store::{IndexStore, forge_tables::FORGE_ACCOUNTS, kv::KvOp};

const LINK_VERSION: u32 = 1;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountLink {
    pub version: u32,
    pub key: ForgeAccountKey,
    pub plugin_id: String,
    pub host: String,
    pub login: String,
    pub linked_at: String,
    pub credential_source: Option<CredentialSource>,
    pub scopes: Option<Vec<String>>,
    /// Whether list and search reads include this account. A link stored
    /// before the flag existed is included.
    #[serde(default = "catalog_enabled_by_default")]
    pub catalog_enabled: bool,
}

const fn catalog_enabled_by_default() -> bool {
    true
}

impl AccountLink {
    #[must_use]
    pub fn new(
        plugin_id: &str,
        host: &str,
        login: &str,
        credential_source: Option<CredentialSource>,
        scopes: Option<Vec<String>>,
    ) -> Self {
        Self {
            version: LINK_VERSION,
            key: ForgeAccountKey::issue(plugin_id, host, login),
            plugin_id: plugin_id.to_owned(),
            host: host.to_owned(),
            login: login.to_owned(),
            linked_at: now_rfc3339(),
            credential_source,
            scopes,
            catalog_enabled: true,
        }
    }

    #[must_use]
    pub fn account_ref(&self) -> ForgeAccountRef {
        ForgeAccountRef {
            host: self.host.clone(),
            login: self.login.clone(),
        }
    }
}

/// The credential source shown when the plugin never reported one: a pasted
/// token is a saved token; anything else came from the host environment.
#[must_use]
pub fn fallback_source(kind: AuthMethodKind) -> CredentialSource {
    match kind {
        AuthMethodKind::PasteToken => CredentialSource::SavedToken,
        _ => CredentialSource::Environment,
    }
}

/// Account links in the companion store plus the in-memory derived states.
#[derive(Clone)]
pub struct Accounts {
    store: Arc<IndexStore>,
    states: Arc<Mutex<HashMap<ForgeAccountKey, (AccountCondition, Instant)>>>,
}

impl Accounts {
    #[must_use]
    pub fn new(store: Arc<IndexStore>) -> Self {
        Self {
            store,
            states: Arc::default(),
        }
    }

    /// Every link, in key order.
    ///
    /// # Errors
    ///
    /// Returns a storage failure.
    pub fn links(&self) -> Result<Vec<AccountLink>, ForgeError> {
        Ok(self
            .store
            .kv_scan(FORGE_ACCOUNTS, "")?
            .into_iter()
            .filter_map(|(_, value)| serde_json::from_slice::<AccountLink>(&value).ok())
            .collect())
    }

    /// The links of one provider.
    ///
    /// # Errors
    ///
    /// Returns a storage failure.
    pub fn links_of(&self, plugin_id: &str) -> Result<Vec<AccountLink>, ForgeError> {
        Ok(self
            .links()?
            .into_iter()
            .filter(|link| link.plugin_id == plugin_id)
            .collect())
    }

    /// One link.
    ///
    /// # Errors
    ///
    /// Returns a storage failure.
    pub fn link(&self, key: &ForgeAccountKey) -> Result<Option<AccountLink>, ForgeError> {
        Ok(self
            .store
            .kv_get(FORGE_ACCOUNTS, key.as_str())?
            .and_then(|value| serde_json::from_slice(&value).ok()))
    }

    /// Stores (or refreshes) a link and marks it connected. The first link
    /// time and the user's catalog choice of an existing link are kept, so a
    /// re-verification or a repeated sign-in never re-includes an account the
    /// user excluded.
    ///
    /// # Errors
    ///
    /// Returns a storage failure.
    pub fn save(&self, link: &AccountLink) -> Result<(), ForgeError> {
        let mut stored = link.clone();
        if let Some(existing) = self.link(&link.key)? {
            stored.linked_at = existing.linked_at;
            stored.catalog_enabled = existing.catalog_enabled;
        }
        self.put(&stored)?;
        self.observe(&link.key, AccountCondition::Connected);
        Ok(())
    }

    /// Includes or excludes one linked account from list and search reads.
    /// The link, its derived state and any plugin credential are unchanged.
    ///
    /// # Errors
    ///
    /// Returns `NotFound` for an unknown account or a storage failure.
    pub fn set_catalog_enabled(
        &self,
        key: &ForgeAccountKey,
        enabled: bool,
    ) -> Result<AccountLink, ForgeError> {
        let mut link = self.link(key)?.ok_or(ForgeError::NotFound)?;
        if link.catalog_enabled != enabled {
            link.catalog_enabled = enabled;
            self.put(&link)?;
        }
        Ok(link)
    }

    fn put(&self, link: &AccountLink) -> Result<(), ForgeError> {
        let value =
            serde_json::to_vec(link).map_err(|error| ForgeError::internal(error.to_string()))?;
        self.store.kv_apply(vec![KvOp::Put {
            table: FORGE_ACCOUNTS,
            key: link.key.as_str().to_owned(),
            value,
        }])?;
        Ok(())
    }

    /// Deletes a link; the host login and any plugin secret are untouched.
    ///
    /// # Errors
    ///
    /// Returns a storage failure.
    pub fn delete(&self, key: &ForgeAccountKey) -> Result<(), ForgeError> {
        self.store.kv_apply(vec![KvOp::Delete {
            table: FORGE_ACCOUNTS,
            key: key.as_str().to_owned(),
        }])?;
        if let Ok(mut states) = self.states.lock() {
            states.remove(key);
        }
        Ok(())
    }

    /// Records the outcome of a call made for an account.
    pub fn observe(&self, key: &ForgeAccountKey, condition: AccountCondition) {
        if let Ok(mut states) = self.states.lock() {
            states.insert(key.clone(), (condition, Instant::now()));
        }
    }

    /// The cached condition, if still fresh.
    #[must_use]
    pub fn fresh_condition(&self, key: &ForgeAccountKey) -> Option<AccountCondition> {
        let states = self.states.lock().ok()?;
        let (condition, at) = states.get(key)?;
        (at.elapsed() < limits::ACCOUNT_STATE_FRESHNESS).then(|| condition.clone())
    }

    /// The last known condition, fresh or not; `connected` when never seen.
    #[must_use]
    pub fn condition(&self, key: &ForgeAccountKey) -> AccountCondition {
        self.states
            .lock()
            .ok()
            .and_then(|states| states.get(key).map(|(condition, _)| condition.clone()))
            .unwrap_or(AccountCondition::Connected)
    }

    /// Records an error of a call: `authRequired` expires the account, other
    /// typed failures mark it `error`; local failures change nothing.
    pub fn observe_error(&self, key: &ForgeAccountKey, error: &ForgeError) {
        match error {
            ForgeError::AuthRequired { hint, .. } => self.observe(
                key,
                AccountCondition::Expired {
                    hint: if hint.is_empty() {
                        "Reconnect".into()
                    } else {
                        hint.clone()
                    },
                },
            ),
            ForgeError::ProviderUnavailable { reason, .. }
            | ForgeError::ForgeRejected { reason } => {
                self.observe(
                    key,
                    AccountCondition::Error {
                        reason: reason.clone(),
                    },
                );
            }
            _ => {}
        }
    }

    /// The wire state of a link with its current condition.
    #[must_use]
    pub fn wire(&self, link: &AccountLink) -> AccountStateWire {
        state_wire(link, self.condition(&link.key))
    }
}

#[must_use]
pub fn state_wire(link: &AccountLink, condition: AccountCondition) -> AccountStateWire {
    AccountStateWire {
        account: link.key.clone(),
        plugin_id: link.plugin_id.clone(),
        host: link.host.clone(),
        login: link.login.clone(),
        linked_at: link.linked_at.clone(),
        credential_source: link
            .credential_source
            .unwrap_or(CredentialSource::Environment),
        scopes: link.scopes.clone(),
        catalog_enabled: link.catalog_enabled,
        condition,
    }
}

#[cfg(test)]
mod tests {
    use super::AccountLink;

    #[test]
    fn a_link_stored_before_the_catalog_flag_stays_in_the_catalog() -> serde_json::Result<()> {
        let stored = serde_json::json!({
            "version": 1,
            "key": AccountLink::new("github", "github.com", "octocat", None, None).key,
            "pluginId": "github",
            "host": "github.com",
            "login": "octocat",
            "linkedAt": "2026-10-20T08:00:00Z",
            "credentialSource": null,
            "scopes": null,
        });
        let link: AccountLink = serde_json::from_value(stored)?;
        assert!(link.catalog_enabled);
        Ok(())
    }
}
