//! Where a new canonical review chat runs.
//!
//! A client that opts in (`workspace` on `chat/ensure`, or on a scenario's
//! `reviewChat` target) is never given a silently chosen directory. While no
//! live review chat exists, `{"kind": "ask"}` answers `needsWorkspace` with
//! ranked candidates instead of creating a thread, and a follow-up request
//! names the chosen directory (`{"kind": "path"}`), which is admitted before
//! use. A request without `workspace` keeps the older behavior: the local
//! checkout, else a `:read-only` thread in the companion home.
//!
//! Candidates are local checkouts of the pull request: the branch-linked
//! checkout, then project roots, then recent thread working directories
//! (each admitted by construction) that the plugins prove to be checkouts of
//! the pull request's repository ([`probe`]). Those on the pull request's
//! head branch come first.

use std::{path::PathBuf, time::Duration};

use forge_protocol::{ResolveParams, ResolveResult, capability, methods};
use futures_util::{StreamExt, stream};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use super::{
    ForgeContext, errors::ForgeError, ids::PullRequestIdentity, plugin_client::PluginSession,
    wire::OverviewWire,
};
use crate::{
    agent::permission_profiles::READ_ONLY,
    vcs::{OrderedRemotes as _, VcsRemotes, VcsService},
};

/// The profile of a thread inside a checkout of the pull request.
pub(crate) const WORKSPACE_PROFILE: &str = ":workspace";
/// Project roots probed for candidates; later projects are not suggested.
const MAX_PROBED_PROJECTS: usize = 32;
/// Recent thread working directories probed after the project roots (for
/// example a worktree an agent ran in); older ones are not suggested.
const MAX_PROBED_THREAD_DIRECTORIES: usize = 16;
/// Concurrent `vcs.remotes@1` probes.
const PROBE_CONCURRENCY: usize = 4;
/// One `vcs.remotes@1` probe; a slower workspace is not suggested.
const PROBE_TIMEOUT: Duration = Duration::from_secs(10);

/// The client's `workspace` field: it can choose, or it chose.
#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub(crate) enum WorkspaceRequest {
    // WHY: a struct variant, because serde ignores unknown fields beside the
    // tag of a unit variant.
    /// Answer `needsWorkspace` rather than choose a directory.
    Ask {},
    /// Create a missing review chat in this directory.
    Path { path: String },
}

/// How one request lets the companion place a review chat it must create.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum Placement {
    /// An older client: the local checkout, else the companion home.
    Companion,
    /// The client chooses; nothing is created.
    Ask,
    /// The client's chosen directory, admitted before use.
    Chosen(String),
}

/// How a thread is created once creation is allowed.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Creation<'a> {
    Companion,
    Chosen(&'a str),
}

impl Placement {
    pub(crate) fn of(request: Option<WorkspaceRequest>) -> Self {
        match request {
            None => Self::Companion,
            Some(WorkspaceRequest::Ask {}) => Self::Ask,
            Some(WorkspaceRequest::Path { path }) => Self::Chosen(path),
        }
    }

    /// `None` when the client must be asked instead.
    pub(crate) fn creation(&self) -> Option<Creation<'_>> {
        match self {
            Self::Companion => Some(Creation::Companion),
            Self::Ask => None,
            Self::Chosen(path) => Some(Creation::Chosen(path)),
        }
    }

    /// Whether the client opted into the discriminated result.
    pub(crate) fn opted_in(&self) -> bool {
        !matches!(self, Self::Companion)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum CandidateReason {
    /// The checkout has the pull request's head branch checked out, or
    /// tracks it.
    PullRequestBranch,
    /// The checkout belongs to the pull request's repository.
    Repository,
}

/// A suggested directory, admitted by construction (a project root or a
/// known thread directory).
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Candidate {
    pub path: String,
    pub reason: CandidateReason,
}

/// `{"kind": "needsWorkspace"}`: the first candidate is the default; an
/// empty list means the client offers no default.
pub(crate) fn needs_workspace_wire(candidates: &[Candidate]) -> Value {
    json!({"kind": "needsWorkspace", "candidates": candidates})
}

/// Head-branch checkouts first, then the rest, each in discovery order; a
/// path appears once with its best reason.
pub(crate) fn rank(found: impl IntoIterator<Item = Candidate>) -> Vec<Candidate> {
    let mut ranked: Vec<Candidate> = Vec::new();
    for candidate in found {
        if let Some(known) = ranked.iter_mut().find(|known| known.path == candidate.path) {
            known.reason = known.reason.min(candidate.reason);
        } else {
            ranked.push(candidate);
        }
    }
    // A stable sort keeps discovery order inside each reason.
    ranked.sort_by_key(|candidate| candidate.reason);
    ranked
}

/// The profile of a chosen directory: `:workspace` only for a checkout of
/// the pull request's repository, as for the companion's own local checkout.
pub(crate) fn profile(checkout: bool) -> &'static str {
    if checkout {
        WORKSPACE_PROFILE
    } else {
        READ_ONLY
    }
}

/// The ranked candidates of a pull request on this companion.
pub(crate) async fn candidates(
    context: &ForgeContext,
    identity: &PullRequestIdentity,
    overview: &OverviewWire,
) -> Vec<Candidate> {
    let linked = overview
        .local_checkout
        .as_ref()
        .map(|checkout| checkout.workspace.as_str());
    candidates_at(context, identity, &overview.head_branch, linked).await
}

/// [`candidates`] for a head branch and the branch-linked checkout.
async fn candidates_at(
    context: &ForgeContext,
    identity: &PullRequestIdentity,
    head_branch: &str,
    linked: Option<&str>,
) -> Vec<Candidate> {
    let linked = linked.map(|workspace| Candidate {
        path: workspace.to_owned(),
        reason: CandidateReason::PullRequestBranch,
    });
    let paths = match &context.workspaces {
        Some(admission) => probed_paths(
            admission.project_roots().await,
            admission
                .recent_thread_cwds(MAX_PROBED_THREAD_DIRECTORIES)
                .await,
        ),
        None => Vec::new(),
    };
    let probed = probe(context, identity, head_branch, paths).await;
    rank(linked.into_iter().chain(probed))
}

/// The bounded probe set: up to [`MAX_PROBED_PROJECTS`] project roots, then
/// up to [`MAX_PROBED_THREAD_DIRECTORIES`] thread directories that are not
/// already among them, in that order.
fn probed_paths(roots: Vec<String>, thread_directories: Vec<String>) -> Vec<String> {
    let mut paths: Vec<String> = roots.into_iter().take(MAX_PROBED_PROJECTS).collect();
    let roots = paths.len();
    for directory in thread_directories {
        if paths.len() - roots == MAX_PROBED_THREAD_DIRECTORIES {
            break;
        }
        if !paths.contains(&directory) {
            paths.push(directory);
        }
    }
    paths
}

/// Why a probed checkout of the pull request's repository is a candidate.
///
/// The caller has already proven the repository through the pull request
/// provider's `forge.repository.resolve`. A checkout is on the head branch
/// when its local branch or its upstream (tracking) branch equals the pull
/// request's head branch: a checkout may keep a local branch name of its own
/// and track the server branch the pull request names.
fn match_reason(remotes: &VcsRemotes, head_branch: &str) -> CandidateReason {
    let tracks_head = remotes
        .upstream
        .as_ref()
        .is_some_and(|upstream| upstream.branch == head_branch);
    if tracks_head || remotes.branch.as_deref() == Some(head_branch) {
        CandidateReason::PullRequestBranch
    } else {
        CandidateReason::Repository
    }
}

/// The admitted working directory and profile of a chosen directory.
///
/// # Errors
///
/// Returns invalid params when the directory is neither a project root nor
/// a known thread directory, and capability unavailable without admission.
pub(crate) async fn chosen(
    context: &ForgeContext,
    identity: &PullRequestIdentity,
    overview: &OverviewWire,
    path: &str,
) -> Result<(String, &'static str), ForgeError> {
    let linked = overview
        .local_checkout
        .as_ref()
        .map(|checkout| checkout.workspace.as_str());
    chosen_at(context, identity, &overview.head_branch, linked, path).await
}

/// [`chosen`] for a head branch and the branch-linked checkout.
async fn chosen_at(
    context: &ForgeContext,
    identity: &PullRequestIdentity,
    head_branch: &str,
    linked: Option<&str>,
    path: &str,
) -> Result<(String, &'static str), ForgeError> {
    let admission =
        context
            .workspaces
            .as_ref()
            .ok_or_else(|| ForgeError::CapabilityUnavailable {
                reason: "workspace admission is unavailable".into(),
            })?;
    let cwd = admission
        .admit(Some(path))
        .await
        .map_err(ForgeError::InvalidParams)?;
    let linked = linked.is_some_and(|workspace| workspace == cwd || workspace == path);
    // The same rule as the candidates, so a suggested directory gets
    // `:workspace` and nothing else does.
    let checkout = linked
        || !probe(context, identity, head_branch, vec![cwd.clone()])
            .await
            .is_empty();
    Ok((cwd, profile(checkout)))
}

/// The paths among `paths` that are checkouts of the pull request's
/// repository, with their reason ([`match_reason`]).
///
/// Only declared plugin capabilities prove a checkout: the workspace's VCS
/// provider answers `vcs.remotes@1` and the pull request's forge provider
/// resolves those remotes with `forge.repository.resolve` to the pull
/// request's host and repository. A path whose VCS provider has no
/// `vcs.remotes@1`, whose forge provider has no `forge.resolve@1`, or whose
/// probe fails or times out is not a checkout here. The companion never
/// substitutes a provider-specific command for a missing capability.
async fn probe(
    context: &ForgeContext,
    identity: &PullRequestIdentity,
    head_branch: &str,
    paths: Vec<String>,
) -> Vec<Candidate> {
    let Some(vcs) = context.vcs.as_ref() else {
        return Vec::new();
    };
    if paths.is_empty() {
        return Vec::new();
    }
    let Ok(mut session) = context.session(&identity.plugin_id).await else {
        return Vec::new();
    };
    if !session.supports(capability::RESOLVE) {
        session.shutdown().await;
        return Vec::new();
    }
    let remotes: Vec<(String, VcsRemotes)> = stream::iter(paths)
        .map(|path| remotes_of(vcs, path))
        .buffered(PROBE_CONCURRENCY)
        .filter_map(std::future::ready)
        .collect()
        .await;
    let mut found = Vec::new();
    for (path, remotes) in remotes {
        if same_repository(&mut session, identity, remotes.ordered_urls()).await {
            let reason = match_reason(&remotes, head_branch);
            found.push(Candidate { path, reason });
        }
    }
    session.shutdown().await;
    found
}

async fn remotes_of(vcs: &VcsService, path: String) -> Option<(String, VcsRemotes)> {
    let remotes = tokio::time::timeout(PROBE_TIMEOUT, vcs.remotes(&PathBuf::from(&path)))
        .await
        .ok()?
        .ok()??;
    Some((path, remotes))
}

async fn same_repository(
    session: &mut PluginSession,
    identity: &PullRequestIdentity,
    urls: Vec<String>,
) -> bool {
    if urls.is_empty() {
        return false;
    }
    let resolved: Result<ResolveResult, _> = session
        .call(
            methods::REPOSITORY_RESOLVE,
            &ResolveParams { remotes: urls },
        )
        .await;
    resolved.is_ok_and(|resolved| {
        resolved.host.eq_ignore_ascii_case(&identity.pr_ref.host)
            && resolved
                .repository
                .eq_ignore_ascii_case(&identity.pr_ref.repository)
    })
}

#[cfg(test)]
#[allow(clippy::expect_used)]
mod tests {
    use std::sync::Arc;

    use super::*;
    use crate::workspaces::WorkspaceAdmission;

    fn candidate(path: &str, reason: CandidateReason) -> Candidate {
        Candidate {
            path: path.into(),
            reason,
        }
    }

    #[test]
    fn head_branch_checkouts_lead_and_each_path_appears_once() {
        let ranked = rank([
            candidate("/work/widget", CandidateReason::Repository),
            candidate("/work/widget-pr", CandidateReason::PullRequestBranch),
            candidate("/work/widget-old", CandidateReason::Repository),
            candidate("/work/widget", CandidateReason::PullRequestBranch),
        ]);
        assert_eq!(
            ranked,
            vec![
                candidate("/work/widget", CandidateReason::PullRequestBranch),
                candidate("/work/widget-pr", CandidateReason::PullRequestBranch),
                candidate("/work/widget-old", CandidateReason::Repository),
            ]
        );
        assert_eq!(
            needs_workspace_wire(&ranked)["candidates"][0],
            json!({"path": "/work/widget", "reason": "pullRequestBranch"})
        );
    }

    #[test]
    fn no_checkout_offers_no_default() {
        assert_eq!(
            needs_workspace_wire(&rank([])),
            json!({"kind": "needsWorkspace", "candidates": []})
        );
    }

    #[test]
    fn the_workspace_field_is_opt_in_and_closed() {
        let parse = |value: Value| serde_json::from_value::<WorkspaceRequest>(value);
        assert_eq!(
            Placement::of(Some(parse(json!({"kind": "ask"})).expect("ask"))),
            Placement::Ask
        );
        assert_eq!(
            Placement::of(Some(
                parse(json!({"kind": "path", "path": "/work/widget"})).expect("path")
            )),
            Placement::Chosen("/work/widget".into())
        );
        assert_eq!(Placement::of(None), Placement::Companion);
        assert!(!Placement::Companion.opted_in());
        assert_eq!(Placement::Ask.creation(), None);
        assert!(parse(json!({"kind": "ask", "path": "/work/widget"})).is_err());
        assert!(parse(json!({"kind": "home"})).is_err());
    }

    fn remotes(branch: Option<&str>, upstream: Option<&str>) -> VcsRemotes {
        VcsRemotes {
            capability: crate::vcs::REMOTES_CAPABILITY.into(),
            provider: "fixture".into(),
            branch: branch.map(Into::into),
            upstream: upstream.map(|branch| crate::vcs::UpstreamRef {
                remote: "origin".into(),
                branch: branch.into(),
            }),
            remotes: Vec::new(),
        }
    }

    #[test]
    fn a_checkout_tracking_or_on_the_head_branch_is_on_it() {
        let head = "users/me/fix";
        assert_eq!(
            match_reason(&remotes(Some("pr-1-rebase"), Some(head)), head),
            CandidateReason::PullRequestBranch,
            "a local branch of its own that tracks the head branch"
        );
        assert_eq!(
            match_reason(&remotes(Some(head), None), head),
            CandidateReason::PullRequestBranch
        );
        assert_eq!(
            match_reason(&remotes(Some("trunk"), Some("trunk")), head),
            CandidateReason::Repository
        );
        assert_eq!(
            match_reason(&remotes(None, None), head),
            CandidateReason::Repository,
            "a detached checkout of the repository"
        );
    }

    #[test]
    fn thread_directories_follow_the_bounded_project_roots() {
        let roots: Vec<String> = (0..40).map(|index| format!("/p/{index}")).collect();
        let threads: Vec<String> = ["/p/0".to_owned()]
            .into_iter()
            .chain((0..20).map(|index| format!("/t/{index}")))
            .collect();
        let paths = probed_paths(roots, threads);
        assert_eq!(
            paths.len(),
            MAX_PROBED_PROJECTS + MAX_PROBED_THREAD_DIRECTORIES
        );
        assert_eq!(paths[MAX_PROBED_PROJECTS - 1], "/p/31");
        assert_eq!(
            paths[MAX_PROBED_PROJECTS], "/t/0",
            "a root is not probed twice"
        );
        assert_eq!(
            probed_paths(vec!["/p".into()], vec!["/wt".into()]),
            vec!["/p".to_owned(), "/wt".to_owned()]
        );
    }

    #[test]
    fn only_a_checkout_of_the_pull_request_gets_workspace_permissions() {
        assert_eq!(profile(true), WORKSPACE_PROFILE);
        assert_eq!(profile(false), READ_ONLY);
    }

    /// Writes an executable POSIX `sh` script.
    fn script(path: &std::path::Path, body: &str) {
        use std::os::unix::fs::PermissionsExt as _;
        std::fs::write(path, format!("#!/bin/sh\n{body}")).expect("script");
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o755)).expect("mode");
    }

    /// A Content-Length framed JSON-RPC plugin. Method `M` is answered with
    /// the first result file that exists: `<workspace>/.fixture-M.json` for
    /// the request's `workspace`, `<results>/M@<remote>.json` for its first
    /// `remotes` entry (non-alphanumerics replaced by `_`), then
    /// `<results>/M.json`; `@WORKSPACE@` is replaced by the request's
    /// `workspace`. Any other method answers method-not-found.
    fn responder(path: &std::path::Path, results: &std::path::Path) {
        script(
            path,
            &format!(
                r#"results='{results}'
while IFS= read -r header; do
  length=$(printf '%s' "$header" | tr -d '\r ' | sed -n 's/^Content-Length://p')
  [ -n "$length" ] || continue
  IFS= read -r blank
  body=$(dd bs=1 count="$length" 2>/dev/null)
  id=$(printf '%s' "$body" | sed -n 's/.*"id":\([0-9]*\).*/\1/p')
  method=$(printf '%s' "$body" | sed -n 's/.*"method":"\([^"]*\)".*/\1/p')
  workspace=$(printf '%s' "$body" | sed -n 's/.*"workspace":"\([^"]*\)".*/\1/p')
  remote=$(printf '%s' "$body" | sed -n 's/.*"remotes":\["\([^"]*\)".*/\1/p' | tr -c 'A-Za-z0-9\n' '_')
  file=''
  if [ -n "$workspace" ] && [ -f "$workspace/.fixture-$method.json" ]; then
    file="$workspace/.fixture-$method.json"
  elif [ -n "$remote" ] && [ -f "$results/$method@$remote.json" ]; then
    file="$results/$method@$remote.json"
  elif [ -f "$results/$method.json" ]; then
    file="$results/$method.json"
  fi
  if [ -n "$file" ]; then
    result=$(sed "s|@WORKSPACE@|$workspace|g" "$file")
    out="{{\"jsonrpc\":\"2.0\",\"id\":$id,\"result\":$result}}"
  else
    out="{{\"jsonrpc\":\"2.0\",\"id\":$id,\"error\":{{\"code\":-32601,\"message\":\"method not found\"}}}}"
  fi
  printf 'Content-Length: %s\r\n\r\n%s' "$(printf '%s' "$out" | wc -c | tr -d ' ')" "$out"
done
"#,
                results = results.display()
            ),
        );
    }

    /// A VCS provider that owns every workspace and answers `vcs.remotes@1`
    /// from the workspace's own `.fixture-vcs.remotes.json`.
    fn fixture_vcs(
        root: &std::path::Path,
    ) -> Result<crate::vcs::VcsService, Box<dyn std::error::Error>> {
        use crate::vcs::{VcsPluginConfig, VcsService};

        let results = root.join("vcs-results");
        std::fs::create_dir_all(&results)?;
        std::fs::write(
            results.join("initialize.json"),
            json!({"protocolVersion": 1, "provider": "fixture", "displayName": "Fixture",
               "version": "1",
               "capabilities": ["vcs.inspect@1", "vcs.changes@2", "vcs.remotes@1"]})
            .to_string(),
        )?;
        std::fs::write(
            results.join("vcs.inspect.json"),
            r#"{"capability":"vcs.inspect@1","provider":"fixture","repositoryRoot":"@WORKSPACE@"}"#,
        )?;
        responder(&root.join("vcs-fixture"), &results);
        let vcs = VcsService::new(root.join("vcs-plugins.json"), None);
        vcs.registry().install(VcsPluginConfig {
            id: "fixture".into(),
            executable: root.join("vcs-fixture"),
            args: Vec::new(),
            enabled: true,
            priority: 100,
        })?;
        Ok(vcs)
    }

    /// Writes the `vcs.remotes@1` answer of one checkout.
    fn checkout(
        path: &std::path::Path,
        branch: &str,
        upstream: &str,
        url: &str,
    ) -> Result<(), Box<dyn std::error::Error>> {
        std::fs::create_dir_all(path)?;
        std::fs::write(
            path.join(".fixture-vcs.remotes.json"),
            json!({"capability": "vcs.remotes@1", "provider": "fixture", "branch": branch,
                   "upstream": {"remote": "origin", "branch": upstream},
                   "remotes": [{"name": "origin", "url": url}]})
            .to_string(),
        )?;
        Ok(())
    }

    /// A forge provider with the required capabilities, plus
    /// `forge.resolve@1` when `resolves`. It resolves only `fixture://widget`
    /// to `forge.example`/`widget`.
    fn fixture_forge(
        root: &std::path::Path,
        resolves: bool,
    ) -> Result<crate::forge::ForgeConfig, Box<dyn std::error::Error>> {
        use crate::forge::{ForgeConfig, registry};

        let results = root.join("forge-results");
        std::fs::create_dir_all(&results)?;
        let mut capabilities: Vec<&str> = capability::REQUIRED.to_vec();
        if resolves {
            capabilities.push(capability::RESOLVE);
        }
        std::fs::write(
            results.join("initialize.json"),
            json!({"protocolVersion": forge_protocol::PROTOCOL_VERSION, "provider": "fixture",
               "forgeName": "Fixture", "version": "1",
               "icon": {"iconKey": "fixture", "glyph": null},
               "capabilities": capabilities})
            .to_string(),
        )?;
        std::fs::write(
            results.join("forge.repository.resolve@fixture___widget.json"),
            json!({"host": "forge.example", "repository": "widget"}).to_string(),
        )?;
        responder(&root.join("forge-fixture"), &results);
        let config = ForgeConfig {
            bundled_plugin_directory: None,
            registry_path: root.join("forge-plugins.json"),
            plugin_state_root: root.join("forge-plugins"),
        };
        registry::PluginRegistry::new(config.registry_path.clone()).install(
            registry::ExternalPlugin {
                id: "fixture".into(),
                executable: root.join("forge-fixture"),
                args: Vec::new(),
                priority: 10,
            },
        )?;
        Ok(config)
    }

    fn indexed_thread(id: &str, cwd: &std::path::Path) -> crate::store::IndexedThreadMetadata {
        crate::store::IndexedThreadMetadata {
            id: id.into(),
            parent_thread_id: None,
            cwd: cwd.display().to_string(),
            created_at: 1,
            updated_at: 2,
            model_provider: "openai".into(),
            cli_version: "1".into(),
            source: json!("cli"),
            agent_nickname: None,
            agent_role: None,
            archived: false,
            running: None,
        }
    }

    const HEAD: &str = "users/me/fix";

    /// Three admitted directories: a project root of the pull request's
    /// repository on trunk, a worktree an agent ran in whose local branch
    /// tracks the head branch, and a project root of another repository on a
    /// same-named branch.
    struct Workspaces {
        _directory: tempfile::TempDir,
        forge: Arc<crate::forge::ForgeService>,
        trunk: PathBuf,
        worktree: PathBuf,
        other: PathBuf,
    }

    async fn workspaces(resolves: bool) -> Result<Workspaces, Box<dyn std::error::Error>> {
        use crate::{
            forge::{ForgeDeps, ForgeEvents, ForgeService},
            review::{ReviewEvents, ReviewService},
            store::IndexStore,
        };

        let directory = tempfile::tempdir()?;
        let root = directory.path();
        let vcs = fixture_vcs(root)?;
        let config = fixture_forge(root, resolves)?;
        let trunk = root.join("widget");
        let worktree = root.join("widget-wt").join("pr-1-rebase");
        let other = root.join("other");
        checkout(&trunk, "trunk", "trunk", "fixture://widget")?;
        checkout(&worktree, "pr-1-rebase", HEAD, "fixture://widget")?;
        checkout(&other, HEAD, HEAD, "fixture://other")?;
        let projects = crate::projects::ProjectService::open(root.join("projects.json")).await?;
        for project in [&trunk, &other] {
            projects
                .handle(
                    "companion/project/add",
                    &json!({"path": project.display().to_string()}),
                )
                .await?;
        }
        let store = Arc::new(IndexStore::open(root.join("state.redb"))?);
        store.put_thread_metadata(&indexed_thread("thread-1", &worktree))?;
        let admission = Arc::new(WorkspaceAdmission::new(
            projects,
            store.clone(),
            root.join("home"),
        ));
        let (sender, _receiver) = tokio::sync::mpsc::channel(64);
        let review =
            ReviewService::new(store.clone(), ReviewEvents::new(sender.clone()), None, None);
        let forge = ForgeService::new(
            config,
            ForgeDeps {
                store,
                events: ForgeEvents::new(sender),
                review,
                agents: None,
                workspaces: Some(admission),
                vcs: Some(Arc::new(vcs)),
            },
        );
        Ok(Workspaces {
            _directory: directory,
            forge,
            trunk,
            worktree,
            other,
        })
    }

    fn identity() -> PullRequestIdentity {
        PullRequestIdentity {
            plugin_id: "fixture".into(),
            pr_ref: forge_protocol::ForgePrRef {
                host: "forge.example".into(),
                repository: "widget".into(),
                number: "1".into(),
            },
        }
    }

    fn display(path: &std::path::Path) -> String {
        path.display().to_string()
    }

    /// The worktree tracking the head branch is the default candidate, the
    /// trunk checkout of the same repository follows, and a checkout of
    /// another repository is excluded although it is on a same-named branch.
    #[tokio::test]
    async fn a_worktree_tracking_the_head_branch_is_the_default_candidate()
    -> Result<(), Box<dyn std::error::Error>> {
        let fixture = workspaces(true).await?;
        let context = fixture.forge.context();
        let identity = identity();

        // Project roots are stored canonical; thread directories as indexed.
        let found = candidates_at(context, &identity, HEAD, None).await;
        assert_eq!(
            found,
            vec![
                candidate(
                    &display(&fixture.worktree),
                    CandidateReason::PullRequestBranch
                ),
                candidate(
                    &display(&std::fs::canonicalize(&fixture.trunk)?),
                    CandidateReason::Repository
                ),
            ]
        );
        let (cwd, profile) = chosen_at(context, &identity, HEAD, None, &display(&fixture.worktree))
            .await
            .expect("worktree admitted");
        assert_eq!(
            PathBuf::from(cwd),
            std::fs::canonicalize(&fixture.worktree)?
        );
        assert_eq!(profile, WORKSPACE_PROFILE);
        let (_, profile) = chosen_at(context, &identity, HEAD, None, &display(&fixture.other))
            .await
            .expect("project admitted");
        assert_eq!(profile, READ_ONLY, "another repository is not a checkout");
        Ok(())
    }

    /// Without `forge.resolve@1` the repository is unproven: nothing is
    /// suggested and nothing gets `:workspace`, whatever branch a checkout
    /// tracks. The companion has no provider-specific substitute.
    #[tokio::test]
    async fn without_repository_resolution_no_checkout_is_suggested()
    -> Result<(), Box<dyn std::error::Error>> {
        let fixture = workspaces(false).await?;
        let context = fixture.forge.context();
        let identity = identity();

        assert_eq!(candidates_at(context, &identity, HEAD, None).await, vec![]);
        let (_, profile) = chosen_at(context, &identity, HEAD, None, &display(&fixture.worktree))
            .await
            .expect("worktree admitted");
        assert_eq!(profile, READ_ONLY);
        // A branch-linked checkout stays the default without resolution.
        let linked = display(&fixture.worktree);
        assert_eq!(
            candidates_at(context, &identity, HEAD, Some(&linked)).await,
            vec![candidate(&linked, CandidateReason::PullRequestBranch)]
        );
        Ok(())
    }

    #[tokio::test]
    async fn a_chosen_directory_is_admitted_only_when_known()
    -> Result<(), Box<dyn std::error::Error>> {
        let directory = tempfile::tempdir()?;
        let project = directory.path().join("widget");
        let unknown = directory.path().join("elsewhere");
        std::fs::create_dir_all(&project)?;
        std::fs::create_dir_all(&unknown)?;
        let projects =
            crate::projects::ProjectService::open(directory.path().join("projects.json")).await?;
        projects
            .handle(
                "companion/project/add",
                &json!({"path": project.display().to_string()}),
            )
            .await?;
        let store = Arc::new(crate::store::IndexStore::open(
            directory.path().join("state.redb"),
        )?);
        let admission = WorkspaceAdmission::new(projects, store, directory.path().join("home"));

        let admitted = admission
            .admit(Some(&project.display().to_string()))
            .await?;
        assert_eq!(PathBuf::from(admitted), std::fs::canonicalize(&project)?);
        assert!(
            admission
                .admit(Some(&unknown.display().to_string()))
                .await
                .is_err()
        );
        assert!(admission.admit(Some("relative/widget")).await.is_err());
        let canonical = std::fs::canonicalize(&project)?;
        assert!(
            admission
                .project_roots()
                .await
                .iter()
                .any(|root| std::fs::canonicalize(root).ok().as_ref() == Some(&canonical))
        );
        Ok(())
    }
}
