//! Request and result shapes of the plugin protocol.
//!
//! Field names are the wire contract (camelCase). Plugins never see the
//! companion's `PullRequestKey`; they address pull requests by
//! [`ForgePrRef`]. Every forge method after `initialize` names its account by
//! [`ForgeAccountRef`], and the plugin resolves that account's token itself.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// A forge token travelling companion → plugin once, in a `pasteToken`
/// `auth.start`. Its `Debug` never shows the value, and no result type of
/// this crate contains one.
#[derive(Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(transparent)]
pub struct Secret(String);

impl Secret {
    #[must_use]
    pub fn new(value: String) -> Self {
        Self(value)
    }

    /// The token value, for the single place that sends it to the forge.
    #[must_use]
    pub fn expose(&self) -> &str {
        &self.0
    }
}

impl std::fmt::Debug for Secret {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("Secret([redacted])")
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ClientInfo {
    pub name: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct InitializeParams {
    pub protocol_version: u32,
    pub client: ClientInfo,
    /// Capabilities the companion understands.
    pub capabilities: Vec<String>,
    /// The plugin's own directory under the companion state directory.
    pub state_directory: PathBuf,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct InitializeResult {
    pub protocol_version: u32,
    /// The plugin id; it must equal the id the companion registered.
    pub provider: String,
    /// The provider's display name.
    pub forge_name: String,
    /// Plugin build version, logged and compared by update proofs.
    pub version: String,
    /// The host a new account starts on, shown before `auth.methods` is
    /// asked (for example while the provider is disabled).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default_host: Option<String>,
    /// The provider's own icon. The companion resolves and validates it
    /// before any client sees it; an icon that does not parse as a
    /// [`PluginIcon`] is `None` here and the plugin still initializes.
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "lenient_icon"
    )]
    pub provider_icon: Option<PluginIcon>,
    pub capabilities: Vec<String>,
    /// With `forge.conversation@1`: exact lowercase hosts, other than its
    /// accounts' own hosts and their subdomains, whose media
    /// `forge.media.read` serves (GitHub's `*.githubusercontent.com` image
    /// hosts, for example). The companion routes only these through the
    /// plugin; the plugin still decides per account and URL.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub media_hosts: Vec<String>,
    /// Exact lowercase hosts, other than its accounts' own hosts, that serve
    /// the forge's web pages (Arcanum's API host is not its web host, for
    /// example). The companion lets a pull request page, a comment link or
    /// an action's `openUrl` point only at an account's host or one of these.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub web_hosts: Vec<String>,
}

/// The largest icon image, in decoded bytes, the companion accepts.
pub const MAX_ICON_BYTES: usize = 64 * 1024;

/// A provider icon as a plugin declares it. Exactly one source: an inline
/// monochrome glyph, inline image bytes, a file next to (or anywhere on) the
/// plugin host, or an `https` URL. The companion turns every source into an
/// inline glyph or image, or drops it.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum PluginIcon {
    /// One SVG path in a `0 0 W H` view box, tinted by the client.
    Glyph { view_box: String, path: String },
    /// Inline image bytes, standard base64, at most [`MAX_ICON_BYTES`].
    Image {
        mime_type: IconMimeType,
        data_base64: String,
    },
    /// An image file: absolute, or relative to the plugin executable's
    /// directory. Its extension names the type.
    File { path: PathBuf },
    /// An `https` image URL, fetched once by the companion.
    Url { url: String },
}

/// Image types a provider icon may use.
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, Hash)]
pub enum IconMimeType {
    #[serde(rename = "image/svg+xml")]
    Svg,
    #[serde(rename = "image/png")]
    Png,
    #[serde(rename = "image/webp")]
    Webp,
}

/// An unknown or malformed `providerIcon` is no icon, never a failed
/// `initialize`.
fn lenient_icon<'de, D>(deserializer: D) -> Result<Option<PluginIcon>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let value = Option::<Value>::deserialize(deserializer)?;
    Ok(value.and_then(|value| serde_json::from_value(value).ok()))
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub enum AuthMethodKind {
    LinkExisting,
    HostLogin,
    PasteToken,
    Instructions,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub enum AuthPurpose {
    Account,
    Checks,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub enum DisconnectMode {
    Unlink,
    LogoutHost,
    ForgetToken,
}

/// Where an account's token comes from, resolved by the plugin.
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub enum CredentialSource {
    SavedToken,
    Environment,
    GhCli,
    ArcToken,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AuthLink {
    pub label: String,
    pub url: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AuthMethod {
    pub method_id: String,
    pub kind: AuthMethodKind,
    pub purpose: AuthPurpose,
    pub label: String,
    pub detail: String,
    pub available: bool,
    pub unavailable_reason: Option<String>,
    /// `linkExisting` only: host logins not yet linked.
    #[serde(default)]
    pub existing_logins: Vec<String>,
    /// `pasteToken`: token creation pages, `https` on the provider host only.
    #[serde(default)]
    pub links: Vec<AuthLink>,
    /// `pasteToken`: permissions a fine-grained token needs.
    #[serde(default)]
    pub required_permissions: Vec<String>,
    #[serde(default)]
    pub disconnect_modes: Vec<DisconnectMode>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AuthMethodsParams {
    /// `None` asks for the plugin's default host.
    pub host: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AuthMethodsResult {
    pub methods: Vec<AuthMethod>,
    pub default_host: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AuthStartParams {
    pub method_id: String,
    pub host: String,
    /// `linkExisting`: the host login to link.
    pub login: Option<String>,
    /// `pasteToken` only.
    pub token: Option<Secret>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum AuthStartResult {
    /// A host login flow is running in this plugin process.
    #[serde(rename_all = "camelCase")]
    HostLogin {
        user_code: String,
        verification_uri: String,
        expires_in_seconds: u64,
    },
    /// The login is verified (and, for `pasteToken`, the token saved).
    #[serde(rename_all = "camelCase")]
    Linked {
        login: String,
        scopes: Option<Vec<String>>,
        credential_source: Option<CredentialSource>,
    },
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(tag = "state", rename_all = "camelCase")]
pub enum AuthPollResult {
    Pending,
    Complete {
        login: String,
    },
    #[serde(rename_all = "camelCase")]
    Failed {
        reason: String,
        fallback_instructions: String,
        /// Whether starting the same method again may succeed.
        #[serde(default = "retryable_by_default")]
        retryable: bool,
    },
}

fn retryable_by_default() -> bool {
    true
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AuthVerifyParams {
    pub host: String,
    pub login: String,
    pub purpose: AuthPurpose,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AuthVerifyResult {
    pub login: String,
    #[serde(default)]
    pub credential_source: Option<CredentialSource>,
    #[serde(default)]
    pub scopes: Option<Vec<String>>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AuthDisconnectParams {
    pub host: String,
    pub login: String,
    pub mode: DisconnectMode,
}

/// The account a forge call runs as.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub struct ForgeAccountRef {
    pub host: String,
    pub login: String,
}

/// A pull request as the plugin knows it. The companion issues its own
/// opaque key over these fields plus the plugin id.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub struct ForgePrRef {
    pub host: String,
    pub repository: String,
    pub number: String,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub enum PullRequestCategory {
    Involved,
    ReviewRequested,
    Authored,
    Assigned,
    Mentioned,
    Drafts,
    All,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub enum PullRequestState {
    Open,
    Draft,
    Merged,
    Closed,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub enum CheckRollup {
    Passing,
    Failing,
    Pending,
    None,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(untagged)]
pub enum CheckSummary {
    Counted {
        state: CheckRollup,
        passed: u32,
        failing: u32,
        pending: u32,
    },
    Unavailable {
        state: UnavailableTag,
        reason: String,
    },
}

/// The literal `"unavailable"` discriminator of [`CheckSummary`].
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum UnavailableTag {
    Unavailable,
}

impl CheckSummary {
    #[must_use]
    pub fn unavailable(reason: impl Into<String>) -> Self {
        Self::Unavailable {
            state: UnavailableTag::Unavailable,
            reason: reason.into(),
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum CheckItemState {
    Passed,
    Failed,
    Pending,
    Skipped,
    Cancelled,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CheckItem {
    pub check_id: String,
    pub name: String,
    pub state: CheckItemState,
    pub duration_seconds: Option<u64>,
    pub details_url: Option<String>,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ActivityKind {
    Comment,
    Review,
    Event,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ActivityItem {
    pub id: String,
    pub kind: ActivityKind,
    pub author: String,
    pub created_at: String,
    pub body: String,
    pub path: Option<String>,
    pub line: Option<u32>,
    pub review_thread_id: Option<String>,
    pub verdict_label: Option<String>,
}

/// `forge.pullRequest.activity`: items newest first by `created_at` within
/// a page; the first page holds the newest items and `next_cursor`
/// continues to older ones (a review-thread reply may stay on the page of
/// its thread's first comment).
#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ActivityPage {
    pub items: Vec<ActivityItem>,
    pub next_cursor: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ListParams {
    pub account: ForgeAccountRef,
    pub category: PullRequestCategory,
    pub repository: Option<String>,
    pub cursor: Option<String>,
    /// At most 50.
    pub limit: u32,
}

/// One row of `forge.pullRequests.list`; the companion adds the key, the
/// account and its own link facts.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ListRow {
    #[serde(rename = "ref")]
    pub pr_ref: ForgePrRef,
    pub repository: String,
    pub number: String,
    pub title: String,
    pub author: String,
    pub state: PullRequestState,
    pub review_requested_from_me: bool,
    pub checks: CheckSummary,
    pub updated_at: String,
    /// Same opaque activity witness returned by `forge.pullRequest.read`.
    /// Older plugins may omit it; the companion falls back to `updatedAt`.
    #[serde(default)]
    pub activity_revision: Option<String>,
    pub web_url: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ListResult {
    pub supported_categories: Vec<PullRequestCategory>,
    pub rows: Vec<ListRow>,
    pub next_cursor: Option<String>,
}

/// Include and exclude values of one search field. Values inside either side
/// use `OR`; the provider combines different fields with `AND`.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq, Hash)]
#[serde(
    rename_all = "camelCase",
    bound(deserialize = "T: Deserialize<'de>", serialize = "T: Serialize")
)]
pub struct SearchValues<T> {
    #[serde(default)]
    pub include: Vec<T>,
    #[serde(default)]
    pub exclude: Vec<T>,
}

impl<T> SearchValues<T> {
    fn empty() -> Self {
        Self {
            include: Vec::new(),
            exclude: Vec::new(),
        }
    }
}

impl<T> Default for SearchValues<T> {
    fn default() -> Self {
        Self::empty()
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub enum PullRequestReviewState {
    None,
    Required,
    Approved,
    ChangesRequested,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub enum PullRequestSortField {
    Updated,
    Created,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub enum SortDirection {
    Descending,
    Ascending,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub struct PullRequestSort {
    pub field: PullRequestSortField,
    pub direction: SortDirection,
}

/// Provider-neutral query of `forge.pullRequests.search`. The provider must
/// either apply every field or reject the request; partial interpretation is
/// forbidden.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub struct PullRequestSearchQuery {
    #[serde(default)]
    pub text: String,
    pub category: PullRequestCategory,
    #[serde(default = "SearchValues::empty")]
    pub repositories: SearchValues<String>,
    #[serde(default = "SearchValues::empty")]
    pub authors: SearchValues<String>,
    #[serde(default = "SearchValues::empty")]
    pub assignees: SearchValues<String>,
    #[serde(default = "SearchValues::empty")]
    pub reviewers: SearchValues<String>,
    #[serde(default = "SearchValues::empty")]
    pub review: SearchValues<PullRequestReviewState>,
    #[serde(default = "SearchValues::empty")]
    pub states: SearchValues<PullRequestState>,
    #[serde(default = "SearchValues::empty")]
    pub checks: SearchValues<CheckRollup>,
    #[serde(default = "SearchValues::empty")]
    pub labels: SearchValues<String>,
    #[serde(default = "SearchValues::empty")]
    pub base_branches: SearchValues<String>,
    #[serde(default = "SearchValues::empty")]
    pub head_branches: SearchValues<String>,
    pub sort: PullRequestSort,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SearchParams {
    pub account: ForgeAccountRef,
    pub query: PullRequestSearchQuery,
    pub cursor: Option<String>,
    /// At most 50.
    pub limit: u32,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ByBranchParams {
    pub account: ForgeAccountRef,
    pub repository: String,
    pub branch: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ByBranchResult {
    /// Open pull requests only.
    pub refs: Vec<ForgePrRef>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ResolveParams {
    pub remotes: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ResolveResult {
    pub host: String,
    pub repository: String,
}

/// Params of every call that addresses one pull request.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PullRequestParams {
    pub account: ForgeAccountRef,
    #[serde(rename = "ref")]
    pub pr_ref: ForgePrRef,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum MergeState {
    Ready,
    Blocked,
    Conflicts,
    Unknown,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MergeStatus {
    pub state: MergeState,
    pub reason: Option<String>,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DiffStats {
    pub files: u32,
    pub additions: u32,
    pub deletions: u32,
}

/// `forge.pullRequest.read`: the overview without the companion's links,
/// local checkout and action catalog.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PullRequestOverview {
    pub repository: String,
    pub number: String,
    pub title: String,
    pub author: String,
    pub state: PullRequestState,
    pub web_url: String,
    pub head_revision: String,
    /// Opaque witness that changes when user-relevant PR activity changes.
    /// Older plugins may omit it; the companion then falls back to the list
    /// row's `updatedAt`, or the head revision on a cold deep link.
    #[serde(default)]
    pub activity_revision: Option<String>,
    pub head_branch: String,
    pub base_branch: String,
    /// Untrusted Markdown.
    pub description: String,
    pub stats: DiffStats,
    pub merge: MergeStatus,
    /// Present when the plugin rolls checks into the read; `forge.checks@1`
    /// results take precedence.
    #[serde(default)]
    pub checks: Option<CheckSummary>,
    #[serde(default)]
    pub check_items: Vec<CheckItem>,
    #[serde(default)]
    pub activity: ActivityPage,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ActivityParams {
    pub account: ForgeAccountRef,
    #[serde(rename = "ref")]
    pub pr_ref: ForgePrRef,
    pub cursor: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ChecksParams {
    pub account: ForgeAccountRef,
    #[serde(rename = "ref")]
    pub pr_ref: ForgePrRef,
    pub head_revision: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ChecksResult {
    pub summary: CheckSummary,
    pub items: Vec<CheckItem>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FilesParams {
    pub account: ForgeAccountRef,
    #[serde(rename = "ref")]
    pub pr_ref: ForgePrRef,
    pub head_revision: String,
    pub cursor: Option<String>,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum FileStatus {
    Added,
    Modified,
    Removed,
    Renamed,
    Copied,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(tag = "state", rename_all = "camelCase")]
pub enum FilePatch {
    Present { text: String },
    TooLarge { bytes: Option<u64> },
    Binary,
    NotProvided,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PullRequestFile {
    pub path: String,
    pub previous_path: Option<String>,
    pub status: FileStatus,
    pub additions: u32,
    pub deletions: u32,
    pub patch: FilePatch,
    /// `None` when the forge has no viewed marks.
    pub viewed: Option<bool>,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Truncation {
    pub shown: u32,
    pub total: u32,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FilesResult {
    pub head_revision: String,
    pub files: Vec<PullRequestFile>,
    pub truncated: Option<Truncation>,
    pub next_cursor: Option<String>,
}

/// An action descriptor as a plugin emits it. The companion parses the
/// catalog leniently from raw JSON (unknown kinds become `extension`,
/// invalid descriptors are dropped), so this type is for plugin authors.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ActionDescriptor {
    pub action_id: String,
    pub kind: String,
    pub group: String,
    pub label: String,
    pub availability: Value,
    pub toggle: Option<Value>,
    pub input: Option<Value>,
    pub confirm: String,
    pub placement: String,
    pub order: i64,
    pub is_default: bool,
    pub anchor: Option<Value>,
}

/// `forge.pullRequest.actions`: descriptors valid for one head revision.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RawActionCatalog {
    pub head_revision: String,
    pub actions: Vec<Value>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ActionRunParams {
    pub account: ForgeAccountRef,
    #[serde(rename = "ref")]
    pub pr_ref: ForgePrRef,
    pub action_id: String,
    pub head_revision: String,
    /// `string | boolean | null`, matching the descriptor's input.
    pub input: Value,
    pub idempotency_key: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ActionRunResult {
    pub message: Option<String>,
    /// A page of the pull request on the forge for the person to finish the
    /// action there, when the forge allows it only from its web interface.
    /// The companion keeps it only as `https` on the pull request's host.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub open_url: Option<String>,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum DiffSide {
    New,
    Old,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReviewComment {
    pub draft_id: String,
    pub path: String,
    pub side: DiffSide,
    pub start_line: u32,
    pub end_line: u32,
    pub body: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReviewSubmitParams {
    pub account: ForgeAccountRef,
    #[serde(rename = "ref")]
    pub pr_ref: ForgePrRef,
    pub head_revision: String,
    pub verdict_action_id: String,
    pub body: Option<String>,
    pub comments: Vec<ReviewComment>,
    pub idempotency_key: String,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum CommentOutcomeState {
    Published,
    Failed,
    Outdated,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CommentOutcome {
    pub draft_id: String,
    pub state: CommentOutcomeState,
    pub error: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReviewSubmitResult {
    pub review_url: Option<String>,
    pub comments: Vec<CommentOutcome>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ViewedSetParams {
    pub account: ForgeAccountRef,
    #[serde(rename = "ref")]
    pub pr_ref: ForgePrRef,
    pub head_revision: String,
    pub path: String,
    pub viewed: bool,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub enum ScenarioKind {
    FixCi,
    Rebase,
    AddressComments,
    ReviewPr,
    Message,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ScenarioContextParams {
    pub account: ForgeAccountRef,
    #[serde(rename = "ref")]
    pub pr_ref: ForgePrRef,
    pub scenario: ScenarioKind,
    pub check_id: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FailingCheck {
    pub check_id: String,
    pub name: String,
    pub log_excerpt: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ScenarioComment {
    pub author: String,
    pub path: Option<String>,
    pub line: Option<u32>,
    pub body: String,
}

/// Untrusted third-party context, bounded by the plugin to 64 KiB.
#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ScenarioContext {
    pub conflicts: Vec<String>,
    pub failing_checks: Vec<FailingCheck>,
    pub comments: Vec<ScenarioComment>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ConversationParams {
    pub account: ForgeAccountRef,
    #[serde(rename = "ref")]
    pub pr_ref: ForgePrRef,
    /// The opaque `nextCursor` of the previous page; `None` for the first.
    pub cursor: Option<String>,
}

/// What kind of account wrote a conversation entry.
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub enum AuthorKind {
    User,
    /// An automation account: a GitHub App, a robot user.
    Bot,
    /// An AI reviewer the forge identifies as one.
    Ai,
}

/// The author of a conversation entry.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Author {
    pub login: String,
    pub kind: AuthorKind,
    pub avatar_url: Option<String>,
    /// The avatar is a public, unauthenticated URL the client may fetch
    /// directly; otherwise it goes through `forge.media.read`.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub avatar_direct: bool,
}

/// A directly loadable URL for one image the comment body references:
/// a forge-signed, short-lived URL or a public one. It never carries the
/// plugin's credential.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CommentMedia {
    /// The image URL exactly as it appears in `body`; the client's stable
    /// cache key.
    pub source: String,
    /// The URL the client fetches without credentials.
    pub url: String,
    /// RFC 3339; `None` when `url` does not expire.
    pub expires_at: Option<String>,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub enum ReactionContent {
    ThumbsUp,
    ThumbsDown,
    Laugh,
    Hooray,
    Confused,
    Heart,
    Rocket,
    Eyes,
}

/// One reaction group; only groups with `count > 0` are sent.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Reaction {
    pub content: ReactionContent,
    pub count: u32,
    pub viewer_reacted: bool,
}

/// One comment as authored. `body` is raw, untrusted Markdown that may embed
/// HTML and forge-hosted image URLs.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Comment {
    pub id: String,
    pub author: Author,
    pub created_at: String,
    /// `None` when the comment was never edited.
    pub updated_at: Option<String>,
    pub body: String,
    /// The web permalink.
    pub url: Option<String>,
    #[serde(default)]
    pub reactions: Vec<Reaction>,
    /// Directly loadable URLs for images in `body`; an image without an
    /// entry keeps the `forge.media.read` path.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub media: Vec<CommentMedia>,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub enum ReviewVerdict {
    Approved,
    ChangesRequested,
    /// No verdict: a body and/or inline threads only.
    Commented,
    Dismissed,
    /// The reviewer blocked the merge.
    MergeBlocked,
    /// The reviewer lifted their own block.
    MergeUnblocked,
    /// The reviewer took back an earlier approval.
    ApprovalWithdrawn,
}

/// Where a review thread is anchored.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ThreadAnchor {
    /// The whole pull request.
    PullRequest,
    /// A file without a line, or one whose line no longer maps.
    File { path: String },
    /// Lines of a file on one side of the diff.
    #[serde(rename_all = "camelCase")]
    Line {
        path: String,
        /// The last line, 1-based.
        line: u32,
        /// The first line of a range, strictly before `line`; `None` for one line.
        start_line: Option<u32>,
        side: DiffSide,
    },
}

impl ThreadAnchor {
    /// The anchored file, if any.
    #[must_use]
    pub fn path(&self) -> Option<&str> {
        match self {
            Self::PullRequest => None,
            Self::File { path } | Self::Line { path, .. } => Some(path),
        }
    }
}

/// The lifecycle of an issue: a review remark that must be addressed.
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub enum IssueState {
    Open,
    Resolved,
    Dropped,
}

/// Whether, and how, a review thread is settled.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ThreadResolution {
    /// The forge cannot resolve this thread.
    None,
    /// A resolvable discussion.
    #[serde(rename_all = "camelCase")]
    Conversation {
        resolved: bool,
        /// The viewer may flip `resolved` through
        /// `forge.pullRequest.reviewThread.resolve`: resolve it while it is
        /// unresolved, unresolve it while it is resolved.
        #[serde(default, skip_serializing_if = "std::ops::Not::not")]
        viewer_can_toggle: bool,
    },
    /// A review remark with its own lifecycle.
    #[serde(rename_all = "camelCase")]
    Issue {
        state: IssueState,
        /// Who last changed the state, if known.
        changed_by: Option<Author>,
        /// RFC 3339; when the state last changed, if known.
        changed_at: Option<String>,
    },
}

/// The forge iteration (revision of the pull request) a thread was written on.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Iteration {
    pub id: String,
    /// Positive; grows with time.
    pub number: u32,
}

/// A review thread; its id is the one
/// `forge.pullRequest.reviewThread.reply` and scenarios accept.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReviewThread {
    pub id: String,
    pub anchor: ThreadAnchor,
    /// The anchored code changed since the thread started.
    pub outdated: bool,
    pub resolution: ThreadResolution,
    /// The `review` entry this thread was published with.
    pub review_id: Option<String>,
    pub iteration: Option<Iteration>,
    /// Oldest first, at least one.
    pub comments: Vec<Comment>,
    pub viewer_can_reply: bool,
    /// The code the thread is anchored on, as the forge's diff showed it when
    /// the thread started; `None` when unknown. See [`CodeExcerpt::rules`].
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub excerpt: Option<CodeExcerpt>,
}

/// At most this many lines in a [`CodeExcerpt`].
pub const MAX_EXCERPT_LINES: usize = 8;
/// One excerpt line's text, in characters.
pub const MAX_EXCERPT_LINE_CHARS: usize = 400;

/// A bounded diff excerpt ending at a thread's anchored line: the context a
/// reader needs to see what the thread is about.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CodeExcerpt {
    /// Top to bottom, 1..=[`MAX_EXCERPT_LINES`]; the last is the anchored line.
    pub lines: Vec<ExcerptLine>,
}

/// One diff line of an excerpt with the line numbers its kind has.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ExcerptLine {
    /// Unchanged: present on both sides.
    #[serde(rename_all = "camelCase")]
    Context {
        old_line: u32,
        new_line: u32,
        text: String,
    },
    /// Only on the new side.
    #[serde(rename_all = "camelCase")]
    Added { new_line: u32, text: String },
    /// Only on the old side.
    #[serde(rename_all = "camelCase")]
    Removed { old_line: u32, text: String },
}

impl ExcerptLine {
    /// The line's number on one side of the diff, if it exists there.
    #[must_use]
    pub fn number(&self, side: DiffSide) -> Option<u32> {
        match (self, side) {
            (Self::Context { old_line, .. } | Self::Removed { old_line, .. }, DiffSide::Old) => {
                Some(*old_line)
            }
            (Self::Context { new_line, .. } | Self::Added { new_line, .. }, DiffSide::New) => {
                Some(*new_line)
            }
            (Self::Added { .. }, DiffSide::Old) | (Self::Removed { .. }, DiffSide::New) => None,
        }
    }

    /// The line's text, without its diff marker.
    #[must_use]
    pub fn text(&self) -> &str {
        match self {
            Self::Context { text, .. } | Self::Added { text, .. } | Self::Removed { text, .. } => {
                text
            }
        }
    }
}

impl CodeExcerpt {
    /// The rules serde cannot express, shared by the conformance harness and
    /// the companion's adapter:
    ///
    /// - 1..=[`MAX_EXCERPT_LINES`] lines, each text single-line (no control
    ///   character except a tab) and at most [`MAX_EXCERPT_LINE_CHARS`]
    ///   characters; line numbers are positive;
    /// - the lines are one contiguous piece of a diff: each side's numbers
    ///   grow by exactly one from one line carrying that side to the next;
    /// - only a `line` or `file` anchor has an excerpt; for a `line` anchor
    ///   the last line exists on the anchor's side with the anchor's `line`.
    ///   A `file` anchor (a thread whose line no longer maps) keeps the code
    ///   as it was, numbered as it was.
    ///
    /// # Errors
    ///
    /// Returns the first broken rule.
    pub fn rules(&self, anchor: &ThreadAnchor) -> Result<(), &'static str> {
        if self.lines.is_empty() || self.lines.len() > MAX_EXCERPT_LINES {
            return Err("an excerpt has 1 to 8 lines");
        }
        for line in &self.lines {
            let text = line.text();
            if text.chars().count() > MAX_EXCERPT_LINE_CHARS
                || text.chars().any(|char| char.is_control() && char != '\t')
            {
                return Err("an excerpt line is too long or not a single line");
            }
            if [DiffSide::Old, DiffSide::New]
                .into_iter()
                .any(|side| line.number(side) == Some(0))
            {
                return Err("excerpt line numbers are positive");
            }
        }
        for side in [DiffSide::Old, DiffSide::New] {
            let numbers: Vec<u32> = self
                .lines
                .iter()
                .filter_map(|line| line.number(side))
                .collect();
            if numbers
                .windows(2)
                .any(|pair| pair[0].checked_add(1) != Some(pair[1]))
            {
                return Err("excerpt lines are not one contiguous piece of the diff");
            }
        }
        match anchor {
            ThreadAnchor::PullRequest => Err("a pull request thread has no excerpt"),
            ThreadAnchor::File { .. } => Ok(()),
            ThreadAnchor::Line { line, side, .. } => {
                if self.lines.last().and_then(|last| last.number(*side)) == Some(*line) {
                    Ok(())
                } else {
                    Err("an excerpt ends at the anchored line")
                }
            }
        }
    }
}

/// What a timeline event is about.
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub enum EventCategory {
    /// New commits or a new iteration.
    Push,
    /// The pull request's own state: closed, reopened, merged, draft, ready.
    State,
    /// Checks and pipelines.
    Ci,
    Other,
}

/// One entry of a pull request conversation. A review's inline comments
/// are in their `reviewThread` entries, never inside the `review` entry.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ConversationEntry {
    Comment {
        comment: Comment,
    },
    #[serde(rename_all = "camelCase")]
    Review {
        id: String,
        author: Author,
        created_at: String,
        verdict: ReviewVerdict,
        /// The review's own summary body, if any.
        body: Option<Comment>,
    },
    ReviewThread {
        thread: ReviewThread,
    },
    #[serde(rename_all = "camelCase")]
    Event {
        id: String,
        author: Option<Author>,
        created_at: String,
        category: EventCategory,
        /// Plain text, for example "merged main into this branch".
        text: String,
        /// The commits a `push` event added; `None` for other events or when
        /// unknown. See [`EventCommits::rules`].
        #[serde(default, skip_serializing_if = "Option::is_none")]
        commits: Option<EventCommits>,
    },
}

/// At most this many commits in [`EventCommits::items`].
pub const MAX_EVENT_COMMITS: usize = 20;
/// A commit title, in characters.
pub const MAX_COMMIT_TITLE_CHARS: usize = 256;
/// A commit id (`sha`), in characters.
pub const MAX_COMMIT_SHA_CHARS: usize = 64;
/// An abbreviated commit id (`shortSha`), in characters.
pub const MAX_SHORT_SHA_CHARS: usize = 16;

/// The commits one push event added: the first ones, oldest first, and how
/// many there were.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct EventCommits {
    /// Every commit of the push, at least `items.len()`.
    pub total: u32,
    /// The push's commits oldest first, cut to [`MAX_EVENT_COMMITS`].
    pub items: Vec<EventCommit>,
}

/// One commit of a push.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct EventCommit {
    /// The full commit id: ASCII letters and digits.
    pub sha: String,
    /// The forge's abbreviation of `sha`; the client abbreviates when absent.
    pub short_sha: Option<String>,
    /// The first line of the commit message.
    pub title: String,
    /// The forge login of the commit's author, when it is known.
    pub author_login: Option<String>,
}

/// A commit id: 1..=`max` ASCII letters and digits.
#[must_use]
pub fn valid_commit_id(id: &str, max: usize) -> bool {
    !id.is_empty() && id.len() <= max && id.bytes().all(|byte| byte.is_ascii_alphanumeric())
}

impl EventCommits {
    /// The rules serde cannot express, shared by the conformance harness and
    /// the companion's adapter: only a `push` event carries commits; 1..=
    /// [`MAX_EVENT_COMMITS`] items; `total` is at least the item count; each
    /// `sha` is 1..=[`MAX_COMMIT_SHA_CHARS`] ASCII letters and digits, a
    /// `shortSha` 1..=[`MAX_SHORT_SHA_CHARS`]; a title is one line of at
    /// most [`MAX_COMMIT_TITLE_CHARS`] characters.
    ///
    /// # Errors
    ///
    /// Returns the first broken rule.
    pub fn rules(&self, category: EventCategory) -> Result<(), &'static str> {
        if category != EventCategory::Push {
            return Err("only a push event carries commits");
        }
        if self.items.is_empty() || self.items.len() > MAX_EVENT_COMMITS {
            return Err("a push event lists 1 to 20 commits");
        }
        if usize::try_from(self.total).unwrap_or(usize::MAX) < self.items.len() {
            return Err("total counts at least the listed commits");
        }
        for commit in &self.items {
            if !valid_commit_id(&commit.sha, MAX_COMMIT_SHA_CHARS)
                || commit
                    .short_sha
                    .as_deref()
                    .is_some_and(|short| !valid_commit_id(short, MAX_SHORT_SHA_CHARS))
            {
                return Err("a commit id is not 1 to 64 ASCII letters and digits");
            }
            if commit.title.chars().count() > MAX_COMMIT_TITLE_CHARS
                || commit.title.chars().any(char::is_control)
            {
                return Err("a commit title is one line of at most 256 characters");
            }
        }
        Ok(())
    }
}

impl ConversationEntry {
    /// The order key: the entry's `createdAt`, a thread's first comment's.
    #[must_use]
    pub fn created_at(&self) -> &str {
        match self {
            Self::Comment { comment } => &comment.created_at,
            Self::Review { created_at, .. } | Self::Event { created_at, .. } => created_at,
            Self::ReviewThread { thread } => thread
                .comments
                .first()
                .map_or("", |comment| comment.created_at.as_str()),
        }
    }
}

/// `forge.pullRequest.conversation`: entries newest first by
/// [`ConversationEntry::created_at`] across pages; the first page holds the
/// newest entries and `next_cursor` continues to older ones.
#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ConversationPage {
    pub entries: Vec<ConversationEntry>,
    pub next_cursor: Option<String>,
    /// Whether an open issue prevents merging; `None` when the forge has
    /// no such rule or cannot tell. Every page of one read carries the same
    /// value.
    pub open_issues_block_merge: Option<bool>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MediaReadParams {
    pub account: ForgeAccountRef,
    pub url: String,
}

/// `forge.media.read`: at most [`MAX_MEDIA_BYTES`] decoded bytes.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MediaReadResult {
    pub content_type: String,
    pub bytes_base64: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CommentCreateParams {
    pub account: ForgeAccountRef,
    #[serde(rename = "ref")]
    pub pr_ref: ForgePrRef,
    /// Markdown, 1..=[`MAX_COMMENT_BODY_CHARS`] characters after trimming.
    pub body: String,
    pub idempotency_key: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReviewThreadReplyParams {
    pub account: ForgeAccountRef,
    #[serde(rename = "ref")]
    pub pr_ref: ForgePrRef,
    pub thread_id: String,
    /// Markdown, 1..=[`MAX_COMMENT_BODY_CHARS`] characters after trimming.
    pub body: String,
    pub idempotency_key: String,
}

/// `forge.pullRequest.reviewThread.resolve`: resolve or unresolve one
/// conversation (a thread whose resolution is `conversation`).
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReviewThreadResolveParams {
    pub account: ForgeAccountRef,
    #[serde(rename = "ref")]
    pub pr_ref: ForgePrRef,
    pub thread_id: String,
    /// The state to reach: `true` resolves, `false` unresolves.
    pub resolved: bool,
    pub idempotency_key: String,
}

/// The thread's conversation resolution after the write.
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReviewThreadResolveResult {
    pub resolved: bool,
    /// As [`ThreadResolution::Conversation`]'s: the viewer may flip it again.
    pub viewer_can_toggle: bool,
}

/// The result of both comment writes: the published comment.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CommentResult {
    pub comment: Comment,
}

/// `forge.pullRequest.fileContent`: one file of a pull request at one of its
/// head revisions (the head SHA on GitHub, the diff-set id on Arcanum).
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FileContentParams {
    pub account: ForgeAccountRef,
    #[serde(rename = "ref")]
    pub pr_ref: ForgePrRef,
    /// The head revision the file is read at. Content at a revision never
    /// changes, so a plugin need not check that it is still the head.
    pub head_revision: String,
    /// A repository-relative path of the head side, `/`-separated, without
    /// empty, `.` or `..` segments.
    pub path: String,
}

/// The result of `forge.pullRequest.fileContent`.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(
    tag = "state",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum FileContent {
    /// The complete file: valid UTF-8 without NUL, at most
    /// [`MAX_FILE_CONTENT_BYTES`] bytes.
    Text { content: String },
    /// Larger than [`MAX_FILE_CONTENT_BYTES`]; `bytes` when the size is known.
    TooLarge { bytes: Option<u64> },
    /// Not text: it contains NUL or is not valid UTF-8.
    Binary,
    /// No file at this path and revision (removed, a directory, a submodule).
    Missing,
}

impl FileContent {
    /// Classifies a file's complete bytes by the protocol rules: above
    /// [`MAX_FILE_CONTENT_BYTES`] is `tooLarge`, NUL or invalid UTF-8 is
    /// `binary`, anything else is `text`.
    #[must_use]
    pub fn classify(bytes: Vec<u8>) -> Self {
        if bytes.len() > MAX_FILE_CONTENT_BYTES {
            return Self::TooLarge {
                bytes: u64::try_from(bytes.len()).ok(),
            };
        }
        if bytes.contains(&0) {
            return Self::Binary;
        }
        String::from_utf8(bytes).map_or(Self::Binary, |content| Self::Text { content })
    }
}

/// Whether `path` is a repository-relative file path `forge.pullRequest.fileContent`
/// accepts: at most 4 096 bytes, no NUL or other control character, and only
/// non-empty segments other than `.` and `..`.
#[must_use]
pub fn valid_file_path(path: &str) -> bool {
    path.len() <= MAX_FILE_PATH_BYTES
        && !path.chars().any(char::is_control)
        && path
            .split('/')
            .all(|segment| !segment.is_empty() && segment != "." && segment != "..")
}

/// The largest text `forge.pullRequest.fileContent` returns, in UTF-8 bytes.
pub const MAX_FILE_CONTENT_BYTES: usize = 1024 * 1024;
/// The longest path `forge.pullRequest.fileContent` accepts, in bytes.
pub const MAX_FILE_PATH_BYTES: usize = 4_096;

/// The largest media body `forge.media.read` returns; larger media are
/// refused with an explicit error.
pub const MAX_MEDIA_BYTES: usize = 10 * 1024 * 1024;
/// The longest comment or reply body, in characters after trimming.
pub const MAX_COMMENT_BODY_CHARS: usize = 65_536;

/// The bound a plugin keeps `forge.pullRequest.scenarioContext` within.
pub const MAX_SCENARIO_CONTEXT_BYTES: usize = 64 * 1024;
/// The largest page `forge.pullRequests.list` may be asked for.
pub const MAX_LIST_LIMIT: u32 = 50;

#[cfg(test)]
#[allow(clippy::expect_used)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn secret_never_debug_prints_its_value() {
        let secret = Secret::new("ghp_sentinel".into());
        assert!(!format!("{secret:?}").contains("ghp_sentinel"));
        let params = AuthStartParams {
            method_id: "paste".into(),
            host: "github.com".into(),
            login: None,
            token: Some(secret),
        };
        assert!(!format!("{params:?}").contains("ghp_sentinel"));
    }

    #[test]
    fn check_summary_round_trips_both_shapes() {
        let counted = json!({"state": "failing", "passed": 3, "failing": 1, "pending": 0});
        let unavailable = json!({"state": "unavailable", "reason": "Arc CI token missing"});
        for value in [counted, unavailable] {
            let parsed = serde_json::from_value::<CheckSummary>(value.clone()).expect("parses");
            assert_eq!(serde_json::to_value(parsed).expect("encodes"), value);
        }
        assert!(serde_json::from_value::<CheckSummary>(json!({"state": "unavailable"})).is_err());
    }

    #[test]
    fn involved_pull_request_category_round_trips() {
        let wire = json!("involved");
        let category = serde_json::from_value::<PullRequestCategory>(wire.clone()).expect("parses");
        assert_eq!(category, PullRequestCategory::Involved);
        assert_eq!(serde_json::to_value(category).expect("encodes"), wire);
    }

    fn wire_comment(author_kind: &str) -> serde_json::Value {
        json!({
            "id": "IC_1",
            "author": {"login": "octocat", "kind": author_kind, "avatarUrl": "https://avatars.githubusercontent.com/u/1"},
            "createdAt": "2026-10-01T00:00:00Z", "updatedAt": "2026-10-02T00:00:00Z",
            "body": "Looks **good** ![x](https://github.com/user-attachments/assets/1)",
            "url": "https://github.com/o/r/pull/1#issuecomment-1",
            "reactions": [{"content": "thumbsUp", "count": 3, "viewerReacted": true}]
        })
    }

    fn wire_thread(
        id: &str,
        anchor: &serde_json::Value,
        resolution: &serde_json::Value,
    ) -> serde_json::Value {
        json!({"kind": "reviewThread", "thread": {
            "id": id, "anchor": anchor, "outdated": false, "resolution": resolution,
            "reviewId": "PRR_1", "iteration": {"id": "it-3", "number": 3},
            "comments": [wire_comment("user")], "viewerCanReply": true}})
    }

    fn round_trips<T: serde::de::DeserializeOwned + Serialize>(value: &serde_json::Value) -> T {
        let parsed = serde_json::from_value::<T>(value.clone()).expect("parses");
        assert_eq!(&serde_json::to_value(&parsed).expect("encodes"), value);
        parsed
    }

    #[test]
    fn conversation_entries_round_trip_with_their_discriminators() {
        let page = json!({
            "entries": [
                {"kind": "comment", "comment": wire_comment("user")},
                {"kind": "review", "id": "PRR_1", "author": {"login": "rev", "kind": "ai", "avatarUrl": null},
                 "createdAt": "2026-10-01T01:00:00Z", "verdict": "changesRequested", "body": null},
                wire_thread("PRRT_1", &json!({"kind": "line", "path": "src/a.rs", "line": 42, "startLine": 40, "side": "old"}),
                    &json!({"kind": "conversation", "resolved": true})),
                {"kind": "event", "id": "E_1", "author": null, "createdAt": "2026-10-01T02:00:00Z",
                 "category": "push", "text": "merged main into this branch"}
            ],
            "nextCursor": "opaque",
            "openIssuesBlockMerge": null
        });
        let parsed: ConversationPage = round_trips(&page);
        assert!(matches!(
            &parsed.entries[1],
            ConversationEntry::Review {
                verdict: ReviewVerdict::ChangesRequested,
                body: None,
                author: Author {
                    kind: AuthorKind::Ai,
                    ..
                },
                ..
            }
        ));
        assert!(matches!(
            &parsed.entries[2],
            ConversationEntry::ReviewThread { thread } if thread.anchor == ThreadAnchor::Line {
                path: "src/a.rs".into(), line: 42, start_line: Some(40), side: DiffSide::Old
            } && thread.review_id.as_deref() == Some("PRR_1")
                && thread.iteration == Some(Iteration { id: "it-3".into(), number: 3 })
        ));
        assert_eq!(parsed.entries[2].created_at(), "2026-10-01T00:00:00Z");
        assert!(matches!(
            &parsed.entries[3],
            ConversationEntry::Event {
                category: EventCategory::Push,
                ..
            }
        ));
        for (wire, content) in [
            ("thumbsDown", ReactionContent::ThumbsDown),
            ("hooray", ReactionContent::Hooray),
            ("eyes", ReactionContent::Eyes),
        ] {
            assert_eq!(serde_json::to_value(content).expect("encodes"), json!(wire));
        }
        assert!(serde_json::from_value::<ConversationEntry>(json!({"kind": "reaction"})).is_err());
        assert!(serde_json::from_value::<ReviewVerdict>(json!("blocked")).is_err());
    }

    #[test]
    fn every_anchor_resolution_verdict_author_and_category_round_trips() {
        let anchors = [
            (json!({"kind": "pullRequest"}), None),
            (
                json!({"kind": "file", "path": "src/a.rs"}),
                Some("src/a.rs"),
            ),
            (
                json!({"kind": "line", "path": "src/b.rs", "line": 7, "startLine": null, "side": "new"}),
                Some("src/b.rs"),
            ),
        ];
        for (wire, path) in anchors {
            assert_eq!(round_trips::<ThreadAnchor>(&wire).path(), path);
        }
        let closer = json!({"login": "arc-robot", "kind": "bot", "avatarUrl": null});
        let resolutions = [
            json!({"kind": "none"}),
            json!({"kind": "conversation", "resolved": false}),
            json!({"kind": "issue", "state": "open", "changedBy": null, "changedAt": null}),
            json!({"kind": "issue", "state": "resolved", "changedBy": closer, "changedAt": "2026-10-03T00:00:00Z"}),
            json!({"kind": "issue", "state": "dropped", "changedBy": closer, "changedAt": null}),
        ];
        for wire in &resolutions {
            round_trips::<ThreadResolution>(wire);
        }
        assert_eq!(
            round_trips::<ThreadResolution>(&resolutions[3]),
            ThreadResolution::Issue {
                state: IssueState::Resolved,
                changed_by: Some(Author {
                    login: "arc-robot".into(),
                    kind: AuthorKind::Bot,
                    avatar_url: None,
                    avatar_direct: false,
                }),
                changed_at: Some("2026-10-03T00:00:00Z".into()),
            }
        );
        for (wire, verdict) in [
            ("approved", ReviewVerdict::Approved),
            ("changesRequested", ReviewVerdict::ChangesRequested),
            ("commented", ReviewVerdict::Commented),
            ("dismissed", ReviewVerdict::Dismissed),
            ("mergeBlocked", ReviewVerdict::MergeBlocked),
            ("mergeUnblocked", ReviewVerdict::MergeUnblocked),
            ("approvalWithdrawn", ReviewVerdict::ApprovalWithdrawn),
        ] {
            assert_eq!(round_trips::<ReviewVerdict>(&json!(wire)), verdict);
        }
        for (wire, kind) in [
            ("user", AuthorKind::User),
            ("bot", AuthorKind::Bot),
            ("ai", AuthorKind::Ai),
        ] {
            assert_eq!(round_trips::<AuthorKind>(&json!(wire)), kind);
        }
        for (wire, category) in [
            ("push", EventCategory::Push),
            ("state", EventCategory::State),
            ("ci", EventCategory::Ci),
            ("other", EventCategory::Other),
        ] {
            assert_eq!(round_trips::<EventCategory>(&json!(wire)), category);
        }
        let issue_page = json!({
            "entries": [wire_thread("t-1", &json!({"kind": "pullRequest"}),
                &json!({"kind": "issue", "state": "open", "changedBy": null, "changedAt": null}))],
            "nextCursor": null,
            "openIssuesBlockMerge": true
        });
        assert_eq!(
            round_trips::<ConversationPage>(&issue_page).open_issues_block_merge,
            Some(true)
        );
        // An author without a kind, and the retired flat thread fields, are refused.
        assert!(
            serde_json::from_value::<Author>(json!({"login": "a", "avatarUrl": null})).is_err()
        );
        assert!(
            serde_json::from_value::<ThreadAnchor>(json!({"kind": "line", "path": "a"})).is_err()
        );
        assert!(
            serde_json::from_value::<ThreadResolution>(json!({"kind": "issue", "state": "closed"}))
                .is_err()
        );
    }

    #[test]
    fn excerpts_commits_and_toggles_round_trip_and_stay_optional() {
        let line =
            json!({"kind": "line", "path": "a.rs", "line": 12, "startLine": null, "side": "new"});
        let mut thread = wire_thread(
            "t-1",
            &line,
            &json!({"kind": "conversation", "resolved": false, "viewerCanToggle": true}),
        );
        thread["thread"]["excerpt"] = json!({"lines": [
            {"kind": "context", "oldLine": 10, "newLine": 10, "text": "\tfn a() {"},
            {"kind": "removed", "oldLine": 11, "text": "    old();"},
            {"kind": "added", "newLine": 11, "text": "    new();"},
            {"kind": "added", "newLine": 12, "text": "    more();"}
        ]});
        let push = json!({"kind": "event", "id": "E_1", "author": null,
        "createdAt": "2026-10-01T02:00:00Z", "category": "push", "text": "added 2 commits",
        "commits": {"total": 2, "items": [
            {"sha": "a".repeat(40), "shortSha": "aaaaaaa", "title": "First", "authorLogin": "ana"},
            {"sha": "b".repeat(40), "shortSha": null, "title": "Second", "authorLogin": null}
        ]}});
        let page = round_trips::<ConversationPage>(&json!({
            "entries": [thread, push], "nextCursor": null, "openIssuesBlockMerge": null
        }));
        let ConversationEntry::ReviewThread { thread } = &page.entries[0] else {
            panic!("thread");
        };
        let excerpt = thread.excerpt.as_ref().expect("excerpt");
        assert_eq!(excerpt.rules(&thread.anchor), Ok(()));
        assert!(matches!(
            thread.resolution,
            ThreadResolution::Conversation {
                viewer_can_toggle: true,
                ..
            }
        ));
        let ConversationEntry::Event {
            category,
            commits: Some(commits),
            ..
        } = &page.entries[1]
        else {
            panic!("push");
        };
        assert_eq!(commits.rules(*category), Ok(()));
        // Absent fields read as none and are not written back.
        let bare = round_trips::<ReviewThread>(
            &wire_thread(
                "t-2",
                &line,
                &json!({"kind": "conversation", "resolved": true}),
            )["thread"],
        );
        assert_eq!(bare.excerpt, None);
        assert_eq!(
            bare.resolution,
            ThreadResolution::Conversation {
                resolved: true,
                viewer_can_toggle: false
            }
        );
        let resolve = json!({"account": {"host": "github.com", "login": "octocat"},
            "ref": {"host": "github.com", "repository": "o/r", "number": "1"},
            "threadId": "PRRT_1", "resolved": false, "idempotencyKey": "k-3"});
        assert!(!round_trips::<ReviewThreadResolveParams>(&resolve).resolved);
        round_trips::<ReviewThreadResolveResult>(
            &json!({"resolved": true, "viewerCanToggle": false}),
        );
    }

    #[test]
    fn excerpt_rules_refuse_what_no_diff_shows() {
        let excerpt = |lines: serde_json::Value| -> CodeExcerpt {
            serde_json::from_value(json!({ "lines": lines })).expect("excerpt")
        };
        let line = |line: u32, side: DiffSide| ThreadAnchor::Line {
            path: "a.rs".into(),
            line,
            start_line: None,
            side,
        };
        let file = ThreadAnchor::File {
            path: "a.rs".into(),
        };
        let removed_last = excerpt(json!([
            {"kind": "context", "oldLine": 4, "newLine": 5, "text": "a"},
            {"kind": "removed", "oldLine": 5, "text": "b"}
        ]));
        assert_eq!(removed_last.rules(&line(5, DiffSide::Old)), Ok(()));
        assert!(
            removed_last.rules(&line(5, DiffSide::New)).is_err(),
            "no new-side line"
        );
        assert!(removed_last.rules(&ThreadAnchor::PullRequest).is_err());
        assert_eq!(
            removed_last.rules(&file),
            Ok(()),
            "an outdated thread keeps old numbers"
        );
        for broken in [
            json!([]),
            json!([{"kind": "added", "newLine": 0, "text": "zero"}]),
            json!([{"kind": "added", "newLine": 1, "text": "two\nlines"}]),
            json!([{"kind": "added", "newLine": 1, "text": "x".repeat(MAX_EXCERPT_LINE_CHARS + 1)}]),
            json!([{"kind": "added", "newLine": 1, "text": "a"}, {"kind": "added", "newLine": 3, "text": "gap"}]),
            json!([{"kind": "removed", "oldLine": 2, "text": "a"}, {"kind": "context", "oldLine": 2, "newLine": 1, "text": "repeat"}]),
            json!(
                (1..=9)
                    .map(|n| json!({"kind": "added", "newLine": n, "text": "a"}))
                    .collect::<Vec<_>>()
            ),
        ] {
            assert!(excerpt(broken.clone()).rules(&file).is_err(), "{broken}");
        }
        assert!(
            serde_json::from_value::<ExcerptLine>(
                json!({"kind": "added", "oldLine": 1, "text": "a"})
            )
            .is_err(),
            "an added line has a new-side number"
        );
    }

    #[test]
    fn commit_rules_bound_push_lists() {
        let commit = |sha: &str, title: &str| EventCommit {
            sha: sha.into(),
            short_sha: None,
            title: title.into(),
            author_login: None,
        };
        let commits = |total: u32, items: Vec<EventCommit>| EventCommits { total, items };
        assert_eq!(
            commits(30, vec![commit("abc123", "Fix")]).rules(EventCategory::Push),
            Ok(())
        );
        for (category, broken) in [
            (EventCategory::State, commits(1, vec![commit("abc", "x")])),
            (EventCategory::Push, commits(0, Vec::new())),
            (EventCategory::Push, commits(0, vec![commit("abc", "x")])),
            (
                EventCategory::Push,
                commits(1, vec![commit("not-hex!", "x")]),
            ),
            (
                EventCategory::Push,
                commits(1, vec![commit("abc", "two\nlines")]),
            ),
            (
                EventCategory::Push,
                commits(21, (0..21).map(|_| commit("abc", "x")).collect()),
            ),
        ] {
            assert!(broken.rules(category).is_err(), "{broken:?}");
        }
    }

    #[test]
    fn comment_writes_and_media_reads_round_trip() {
        let values = [
            json!({"account": {"host": "github.com", "login": "octocat"},
                   "ref": {"host": "github.com", "repository": "o/r", "number": "1"},
                   "body": "Thanks", "idempotencyKey": "k-1"}),
            json!({"account": {"host": "github.com", "login": "octocat"},
                   "ref": {"host": "github.com", "repository": "o/r", "number": "1"},
                   "threadId": "PRRT_1", "body": "Done", "idempotencyKey": "k-2"}),
            json!({"account": {"host": "github.com", "login": "octocat"},
                   "url": "https://github.com/user-attachments/assets/1"}),
            json!({"contentType": "image/png", "bytesBase64": "iVBORw0KGgo="}),
        ];
        let create =
            serde_json::from_value::<CommentCreateParams>(values[0].clone()).expect("create");
        assert_eq!(serde_json::to_value(create).expect("encodes"), values[0]);
        let reply =
            serde_json::from_value::<ReviewThreadReplyParams>(values[1].clone()).expect("reply");
        assert_eq!(serde_json::to_value(reply).expect("encodes"), values[1]);
        let media = serde_json::from_value::<MediaReadParams>(values[2].clone()).expect("media");
        assert_eq!(serde_json::to_value(media).expect("encodes"), values[2]);
        let read = serde_json::from_value::<MediaReadResult>(values[3].clone()).expect("read");
        assert_eq!(serde_json::to_value(read).expect("encodes"), values[3]);
    }

    #[test]
    fn file_content_round_trips_every_state() {
        let params = json!({"account": {"host": "github.com", "login": "octocat"},
                            "ref": {"host": "github.com", "repository": "o/r", "number": "1"},
                            "headRevision": "abc", "path": "src/a.rs"});
        let parsed = serde_json::from_value::<FileContentParams>(params.clone()).expect("params");
        assert_eq!(serde_json::to_value(parsed).expect("encodes"), params);
        for value in [
            json!({"state": "text", "content": "fn main() {}\n"}),
            json!({"state": "tooLarge", "bytes": 2_000_000}),
            json!({"state": "tooLarge", "bytes": null}),
            json!({"state": "binary"}),
            json!({"state": "missing"}),
        ] {
            let parsed = serde_json::from_value::<FileContent>(value.clone()).expect("parses");
            assert_eq!(serde_json::to_value(parsed).expect("encodes"), value);
        }
        assert!(serde_json::from_value::<FileContent>(json!({"state": "text"})).is_err());
        assert!(serde_json::from_value::<FileContent>(json!({"state": "unknown"})).is_err());
    }

    #[test]
    fn file_content_classification_bounds_text_and_detects_binary() {
        assert_eq!(
            FileContent::classify(b"line\n".to_vec()),
            FileContent::Text {
                content: "line\n".into()
            }
        );
        assert_eq!(
            FileContent::classify(vec![b'a', 0, b'b']),
            FileContent::Binary
        );
        assert_eq!(FileContent::classify(vec![0xff, 0xfe]), FileContent::Binary);
        let at_bound = vec![b'a'; MAX_FILE_CONTENT_BYTES];
        assert!(matches!(
            FileContent::classify(at_bound),
            FileContent::Text { content } if content.len() == MAX_FILE_CONTENT_BYTES
        ));
        assert_eq!(
            FileContent::classify(vec![b'a'; MAX_FILE_CONTENT_BYTES + 1]),
            FileContent::TooLarge {
                bytes: Some(u64::try_from(MAX_FILE_CONTENT_BYTES + 1).expect("fits"))
            }
        );
    }

    #[test]
    fn file_paths_refuse_traversal_and_empty_segments() {
        for valid in [
            "a.rs",
            "src/a b.rs",
            "docs/ünïcode.md",
            ".github/workflows/ci.yml",
        ] {
            assert!(valid_file_path(valid), "{valid}");
        }
        for invalid in [
            "", "/a.rs", "a//b", "a/", "../a", "a/../b", "./a", "a/.", "a\0b", "a\nb",
        ] {
            assert!(!valid_file_path(invalid), "{invalid:?}");
        }
        assert!(!valid_file_path(&"a".repeat(MAX_FILE_PATH_BYTES + 1)));
    }

    #[test]
    fn initialize_media_hosts_and_identity_are_optional() {
        let info = json!({"protocolVersion": 1, "provider": "p", "forgeName": "P", "version": "1",
                          "capabilities": []});
        let parsed = serde_json::from_value::<InitializeResult>(info.clone()).expect("parses");
        assert!(parsed.media_hosts.is_empty());
        assert_eq!(parsed.default_host, None);
        assert_eq!(parsed.provider_icon, None);
        assert_eq!(serde_json::to_value(parsed).expect("encodes"), info);
    }

    #[test]
    fn every_icon_variant_round_trips() {
        let icons = [
            json!({"kind": "glyph", "viewBox": "0 0 16 16", "path": "M0 0h16v16H0z"}),
            json!({"kind": "image", "mimeType": "image/png", "dataBase64": "iVBORw0KGgo="}),
            json!({"kind": "image", "mimeType": "image/svg+xml", "dataBase64": "PHN2Zy8+"}),
            json!({"kind": "image", "mimeType": "image/webp", "dataBase64": "UklGRg=="}),
            json!({"kind": "file", "path": "icons/forge.svg"}),
            json!({"kind": "url", "url": "https://example.com/forge.png"}),
        ];
        for icon in icons {
            let info = json!({"protocolVersion": 1, "provider": "p", "forgeName": "P",
                              "version": "1", "defaultHost": "forge.example.com",
                              "providerIcon": icon, "capabilities": []});
            let parsed = serde_json::from_value::<InitializeResult>(info.clone()).expect("parses");
            assert!(parsed.provider_icon.is_some(), "{icon} parses");
            assert_eq!(serde_json::to_value(parsed).expect("encodes"), info);
        }
    }

    #[test]
    fn a_malformed_icon_is_no_icon_and_the_legacy_icon_is_ignored() {
        for icon in [
            json!({"kind": "image", "mimeType": "image/gif", "dataBase64": "R0lG"}),
            json!({"kind": "glyph", "viewBox": "0 0 24 24"}),
            json!({"kind": "url", "url": "https://x", "extra": 1}),
            json!({"kind": "sprite"}),
            json!("github"),
        ] {
            let info = json!({"protocolVersion": 1, "provider": "p", "forgeName": "P",
                              "version": "1", "providerIcon": icon, "capabilities": [],
                              "icon": {"iconKey": "p", "glyph": null}});
            let parsed = serde_json::from_value::<InitializeResult>(info).expect("parses");
            assert_eq!(parsed.provider_icon, None);
        }
    }

    #[test]
    fn auth_results_use_their_discriminators() {
        let flow = json!({
            "kind": "hostLogin", "userCode": "ABCD-1234",
            "verificationUri": "https://github.com/login/device", "expiresInSeconds": 900
        });
        assert!(matches!(
            serde_json::from_value::<AuthStartResult>(flow).expect("flow"),
            AuthStartResult::HostLogin { .. }
        ));
        let failed = json!({"state": "failed", "reason": "x", "fallbackInstructions": "y"});
        assert!(matches!(
            serde_json::from_value::<AuthPollResult>(failed).expect("failed"),
            AuthPollResult::Failed {
                retryable: true,
                ..
            }
        ));
        let final_failure = json!({"state": "failed", "reason": "x", "fallbackInstructions": "y", "retryable": false});
        assert!(matches!(
            serde_json::from_value::<AuthPollResult>(final_failure).expect("failed"),
            AuthPollResult::Failed {
                retryable: false,
                ..
            }
        ));
    }
}
