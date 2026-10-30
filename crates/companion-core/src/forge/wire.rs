//! Companion → client shapes of the forge wire contract. Field names are the
//! contract; plugin DTOs pass through a validating adapter before they
//! become one of these.

use forge_protocol::{
    ActivityPage, AuthMethod, CheckItem, CheckSummary, CredentialSource, DiffStats, FileStatus,
    IconMimeType, MergeStatus, PullRequestCategory, PullRequestState, Truncation,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::{
    attention::AttentionWire,
    ids::{AuthFlowId, ForgeAccountKey, HeadRevision, PullRequestKey},
};
use crate::review::hunks::Hunk;

/// A provider icon as clients render it, already validated by
/// [`super::icons`]: a monochrome glyph the client tints, or image bytes it
/// draws as they are. A provider without a usable icon sends `null`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum ProviderIconWire {
    Glyph {
        view_box: String,
        path: String,
    },
    Image {
        mime_type: IconMimeType,
        data_base64: String,
    },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ChecksCredentialState {
    Connected,
    Missing,
    NotApplicable,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChecksCredentialWire {
    pub state: ChecksCredentialState,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ForgeProviderWire {
    pub plugin_id: String,
    pub forge_name: String,
    pub icon: Option<ProviderIconWire>,
    pub built_in: bool,
    pub enabled: bool,
    pub capabilities: Vec<String>,
    pub auth_methods: Vec<AuthMethod>,
    /// The host to start authentication on; `None` only for an external
    /// provider that cannot be started (disabled or not installed).
    pub default_host: Option<String>,
    pub checks_credential: ChecksCredentialWire,
    /// Whether the plugin can serve this provider now, re-evaluated on every
    /// directory read.
    pub installation: ProviderInstallationWire,
}

/// Installation state of one registered provider. `installed` means the
/// executable exists and, for an enabled provider, answered `initialize` and
/// `auth.methods`; a disabled provider is not spawned to prove it.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase", tag = "state")]
pub enum ProviderInstallationWire {
    Installed,
    /// The registered executable (or the bundled binary) does not exist.
    Missing {
        reason: String,
    },
    /// The executable exists but could not start or describe itself.
    Failed {
        reason: String,
    },
}

/// Keeps only token pages that are `https` on the method's host, and drops
/// methods whose shape contradicts their kind.
#[must_use]
pub fn sanitize_methods(methods: Vec<AuthMethod>, host: &str) -> Vec<AuthMethod> {
    methods
        .into_iter()
        .filter(|method| method.available || method.unavailable_reason.is_some())
        .map(|mut method| {
            method.links.retain(|link| https_on_host(&link.url, host));
            method
        })
        .collect()
}

/// `https` and exactly `host` (the provider's declared host, with its port
/// when it has one), without credentials.
#[must_use]
pub fn https_on_host(candidate: &str, host: &str) -> bool {
    url::Url::parse(candidate).is_ok_and(|url| {
        let authority = match (url.host_str(), url.port()) {
            (Some(name), Some(port)) => format!("{name}:{port}"),
            (Some(name), None) => name.to_owned(),
            (None, _) => return false,
        };
        url.scheme() == "https"
            && url.username().is_empty()
            && url.password().is_none()
            && authority.eq_ignore_ascii_case(host)
    })
}

/// A plugin-reported page of a pull request on `host`; anything else
/// becomes empty so a client never opens it.
#[must_use]
pub fn page_on_host(candidate: String, host: &str) -> String {
    if https_on_host(&candidate, host) {
        candidate
    } else {
        String::new()
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthFlowWire {
    pub flow_id: AuthFlowId,
    pub plugin_id: String,
    pub host: String,
    pub method_id: String,
    pub expires_at: String,
    #[serde(flatten)]
    pub status: AuthFlowStatus,
}

/// A host login flow waits for the user, or ended in a failure the phone
/// shows until the user dismisses it (`auth/cancel`) or starts again.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(
    tag = "state",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum AuthFlowStatus {
    AwaitingUser {
        /// A transient one-time code, not a token.
        user_code: String,
        verification_uri: String,
    },
    Failed {
        reason: String,
        retryable: bool,
    },
}

/// Derived account condition: never stored.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "state", rename_all = "camelCase")]
pub enum AccountCondition {
    Connected,
    Expired { hint: String },
    Error { reason: String },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountStateWire {
    pub account: ForgeAccountKey,
    pub plugin_id: String,
    pub host: String,
    pub login: String,
    pub linked_at: String,
    pub credential_source: CredentialSource,
    pub scopes: Option<Vec<String>>,
    /// Whether list and search reads include the account.
    pub catalog_enabled: bool,
    #[serde(flatten)]
    pub condition: AccountCondition,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PullRequestRowWire {
    pub pull_request: PullRequestKey,
    pub account: ForgeAccountKey,
    pub repository: String,
    pub number: String,
    pub title: String,
    pub author: String,
    pub state: PullRequestState,
    pub review_requested_from_me: bool,
    pub checks: CheckSummary,
    pub local_checkout: bool,
    pub linked_thread_count: usize,
    /// The canonical review chat, so a row can show its unread state; `None`
    /// until one is assigned.
    pub review_thread_id: Option<String>,
    pub updated_at: String,
    pub web_url: String,
    pub attention: AttentionWire,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ListSectionWire {
    pub account: AccountStateWire,
    pub supported_categories: Vec<PullRequestCategory>,
    pub rows: Vec<PullRequestRowWire>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ListPageWire {
    pub category: PullRequestCategory,
    pub fetched_at: String,
    pub repositories: Vec<String>,
    pub sections: Vec<ListSectionWire>,
    pub next_cursor: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum LinkSource {
    Branch,
    Manual,
    Agent,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkedThreadWire {
    pub thread_id: String,
    pub source: LinkSource,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalCheckoutWire {
    pub workspace: String,
    pub branch: String,
}

/// A validated action catalog of one head revision.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionCatalogWire {
    pub head_revision: HeadRevision,
    pub actions: Vec<Value>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OverviewWire {
    pub pull_request: PullRequestKey,
    pub account: AccountStateWire,
    pub repository: String,
    pub number: String,
    pub title: String,
    pub author: String,
    pub state: PullRequestState,
    pub web_url: String,
    pub fetched_at: String,
    pub head_revision: HeadRevision,
    pub head_branch: String,
    pub base_branch: String,
    /// Untrusted Markdown.
    pub description: String,
    pub stats: DiffStats,
    pub merge: MergeStatus,
    pub checks: CheckSummary,
    pub check_items: Vec<CheckItem>,
    pub activity: ActivityPage,
    pub links: Vec<LinkedThreadWire>,
    pub review_thread: Option<LinkedThreadWire>,
    pub local_checkout: Option<LocalCheckoutWire>,
    pub catalog: ActionCatalogWire,
    pub attention: AttentionWire,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ViewedSource {
    Forge,
    Companion,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ViewedMarkWire {
    pub viewed: bool,
    pub source: ViewedSource,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "state", rename_all = "camelCase")]
pub enum PatchWire {
    Present { text: String, hunks: Vec<Hunk> },
    TooLarge { bytes: Option<u64> },
    Binary,
    NotProvided,
}

/// `companion/pullRequest/fileContent/read`: one complete file at a head
/// revision. `text` is valid UTF-8 without NUL and at most 1 MiB.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "state", rename_all = "camelCase")]
pub enum FileContentWire {
    Text { content: String },
    TooLarge { bytes: Option<u64> },
    Binary,
    Missing,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileWire {
    pub path: String,
    pub previous_path: Option<String>,
    pub status: FileStatus,
    pub additions: u32,
    pub deletions: u32,
    pub patch: PatchWire,
    pub viewed: ViewedMarkWire,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FilesPageWire {
    pub head_revision: HeadRevision,
    pub files: Vec<FileWire>,
    pub truncated: Option<Truncation>,
    pub next_cursor: Option<String>,
}

/// RFC 3339 of now, UTC.
#[must_use]
pub fn now_rfc3339() -> String {
    rfc3339(time::OffsetDateTime::now_utc())
}

#[must_use]
pub fn rfc3339(moment: time::OffsetDateTime) -> String {
    moment
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn token_pages_must_be_https_on_the_provider_host() {
        assert!(https_on_host(
            "https://github.com/settings/tokens/new",
            "github.com"
        ));
        assert!(!https_on_host("http://github.com/settings", "github.com"));
        assert!(!https_on_host(
            "https://evil.example/settings",
            "github.com"
        ));
        assert!(!https_on_host("https://user@github.com/", "github.com"));
        assert!(https_on_host("https://ghe.test:8443/a", "ghe.test:8443"));
        assert!(!https_on_host("https://ghe.test:8443/a", "ghe.test"));
        assert!(!https_on_host("https://ghe.test/a", "ghe.test:8443"));
        assert_eq!(page_on_host("javascript:alert(1)".into(), "github.com"), "");
        assert_eq!(
            page_on_host("https://github.com/o/r/pull/1".into(), "github.com"),
            "https://github.com/o/r/pull/1"
        );
    }
}
