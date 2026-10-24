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
    pub forge_name: String,
    /// Plugin build version, logged and compared by update proofs.
    pub version: String,
    pub icon: ProviderIcon,
    pub capabilities: Vec<String>,
}

/// A provider icon: a bundled brand icon key, and an optional monochrome
/// glyph the companion sanitizes before any client sees it.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProviderIcon {
    pub icon_key: String,
    pub glyph: Option<IconGlyph>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct IconGlyph {
    pub view_box: String,
    pub path: String,
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
