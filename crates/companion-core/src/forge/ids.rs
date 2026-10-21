//! Branded identifiers of the forge context, validated once at the wire
//! boundary.
//!
//! `PullRequestKey` and `ForgeAccountKey` are companion-issued and opaque to
//! clients: Android never parses them. Forge numbers collide across forges,
//! so both keys include the plugin id and host.

use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use forge_protocol::{ForgeAccountRef, ForgePrRef};
use serde::{Deserialize, Serialize};

use crate::agent::model::AppThreadId;

const PULL_REQUEST_PREFIX: &str = "fpr1.";
const ACCOUNT_PREFIX: &str = "fac1.";
const MAX_KEY_BYTES: usize = 1_024;
const MAX_REVISION_BYTES: usize = 256;

/// A pull request: `fpr1.<base64url of [pluginId, host, repository, number]>`.
#[derive(Clone, Debug, Deserialize, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(transparent)]
pub struct PullRequestKey(String);

/// The decoded parts of a [`PullRequestKey`].
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PullRequestIdentity {
    pub plugin_id: String,
    pub pr_ref: ForgePrRef,
}

impl PullRequestKey {
    #[must_use]
    pub fn issue(plugin_id: &str, pr_ref: &ForgePrRef) -> Self {
        let parts = [
            plugin_id,
            pr_ref.host.as_str(),
            pr_ref.repository.as_str(),
            pr_ref.number.as_str(),
        ];
        let encoded = serde_json::to_vec(&parts).unwrap_or_default();
        Self(format!(
            "{PULL_REQUEST_PREFIX}{}",
            URL_SAFE_NO_PAD.encode(encoded)
        ))
    }

    /// Brands a client value after decoding it.
    #[must_use]
    pub fn parse(value: &str) -> Option<(Self, PullRequestIdentity)> {
        let [plugin_id, host, repository, number] = decode_parts::<4>(value, PULL_REQUEST_PREFIX)?;
        let identity = PullRequestIdentity {
            plugin_id,
            pr_ref: ForgePrRef {
                host,
                repository,
                number,
            },
        };
        // Only the canonical encoding is accepted, so one pull request has
        // exactly one key.
        let key = Self::issue(&identity.plugin_id, &identity.pr_ref);
        (key.0 == value).then_some((key, identity))
    }

    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }

    /// The decoded parts of a key this companion issued.
    #[must_use]
    pub fn identity(&self) -> Option<PullRequestIdentity> {
        Self::parse(&self.0).map(|(_, identity)| identity)
    }

    /// A short opaque digest for logs; the key itself names a repository.
    #[must_use]
    pub fn log_hash(&self) -> String {
        blake3::hash(self.0.as_bytes()).to_hex()[..16].to_owned()
    }
}

/// A linked account: `fac1.<base64url of [pluginId, host, login]>`.
#[derive(Clone, Debug, Deserialize, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(transparent)]
pub struct ForgeAccountKey(String);

/// The decoded parts of a [`ForgeAccountKey`].
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AccountIdentity {
    pub plugin_id: String,
    pub account: ForgeAccountRef,
}

impl ForgeAccountKey {
    #[must_use]
    pub fn issue(plugin_id: &str, host: &str, login: &str) -> Self {
        let parts = [plugin_id, host, login];
        let encoded = serde_json::to_vec(&parts).unwrap_or_default();
        Self(format!(
            "{ACCOUNT_PREFIX}{}",
            URL_SAFE_NO_PAD.encode(encoded)
        ))
    }

    #[must_use]
    pub fn parse(value: &str) -> Option<(Self, AccountIdentity)> {
        let [plugin_id, host, login] = decode_parts::<3>(value, ACCOUNT_PREFIX)?;
        let key = Self::issue(&plugin_id, &host, &login);
        (key.0 == value).then_some((
            key,
            AccountIdentity {
                plugin_id,
                account: ForgeAccountRef { host, login },
            },
        ))
    }

    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

fn decode_parts<const N: usize>(value: &str, prefix: &str) -> Option<[String; N]> {
    if value.len() > MAX_KEY_BYTES {
        return None;
    }
    let bytes = URL_SAFE_NO_PAD.decode(value.strip_prefix(prefix)?).ok()?;
    let parts = serde_json::from_slice::<Vec<String>>(&bytes).ok()?;
    let parts: [String; N] = parts.try_into().ok()?;
    parts
        .iter()
        .all(|part| valid_text(part, MAX_KEY_BYTES))
        .then_some(parts)
}

/// An opaque forge revision: the head SHA on GitHub, a diff-set id on
/// Arcanum.
#[derive(Clone, Debug, Deserialize, Eq, Hash, PartialEq, Serialize)]
#[serde(transparent)]
pub struct HeadRevision(String);

impl HeadRevision {
    #[must_use]
    pub fn parse(value: &str) -> Option<Self> {
        valid_text(value, MAX_REVISION_BYTES).then(|| Self(value.to_owned()))
    }

    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

/// One connect attempt.
#[derive(Clone, Debug, Deserialize, Eq, Hash, PartialEq, Serialize)]
#[serde(transparent)]
pub struct AuthFlowId(String);

impl AuthFlowId {
    #[must_use]
    pub fn mint() -> Self {
        Self(new_uuid())
    }

    #[must_use]
    pub fn parse(value: &str) -> Option<Self> {
        valid_uuid(value).then(|| Self(value.to_owned()))
    }

    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

/// A random UUID v4 string.
#[must_use]
pub fn new_uuid() -> String {
    crate::review::new_uuid()
}

/// `8-4-4-4-12` hexadecimal groups.
#[must_use]
pub fn valid_uuid(value: &str) -> bool {
    crate::review::valid_uuid(value)
}

/// A client idempotency key: a bounded opaque token without control
/// characters (UUIDs in practice).
#[must_use]
pub fn valid_idempotency_key(value: &str) -> bool {
    valid_text(value, 128)
}

/// A thread id from a client, branded only when it can also be a store key
/// segment (no control characters).
#[must_use]
pub fn parse_thread_id(value: &str) -> Option<AppThreadId> {
    if value.bytes().any(|byte| byte.is_ascii_control()) {
        return None;
    }
    AppThreadId::parse(value)
}

fn valid_text(value: &str, max: usize) -> bool {
    !value.is_empty() && value.len() <= max && !value.chars().any(char::is_control)
}

#[cfg(test)]
#[allow(clippy::expect_used)]
mod tests {
    use super::*;

    #[test]
    fn pull_request_keys_round_trip_and_reject_non_canonical_values() {
        let pr = ForgePrRef {
            host: "github.com".into(),
            repository: "octo/repo".into(),
            number: "12".into(),
        };
        let key = PullRequestKey::issue("github", &pr);
        assert!(key.as_str().starts_with("fpr1."));
        let (parsed, identity) = PullRequestKey::parse(key.as_str()).expect("parses");
        assert_eq!(parsed, key);
        assert_eq!(identity.plugin_id, "github");
        assert_eq!(identity.pr_ref, pr);
        assert!(PullRequestKey::parse("fpr1.e30").is_none());
        assert!(PullRequestKey::parse("12").is_none());
        let other = PullRequestKey::issue("arcanum", &pr);
        assert_ne!(other, key, "numbers collide across forges, keys do not");
    }

    #[test]
    fn account_keys_and_uuids_validate() {
        let key = ForgeAccountKey::issue("github", "github.com", "octocat");
        let (_, identity) = ForgeAccountKey::parse(key.as_str()).expect("parses");
        assert_eq!(identity.account.login, "octocat");
        let flow = AuthFlowId::mint();
        assert!(AuthFlowId::parse(flow.as_str()).is_some());
        assert!(AuthFlowId::parse("not-a-uuid").is_none());
        assert!(parse_thread_id("thread\0x").is_none());
    }
}
