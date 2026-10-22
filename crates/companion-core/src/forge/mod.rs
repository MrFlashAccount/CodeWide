//! The forge bounded context: providers, accounts and auth flows, pull
//! request identity, plugin selection, forge calls, the action journal,
//! links, scenarios and branch detection.
//!
//! `ForgeService` owns the `companion/forge*`, `companion/pullRequest*` RPC
//! families. Every forge credential stays inside a plugin process and its
//! host tool; the companion holds account links only. Each forge write has
//! exactly one trigger, enforced here: review comments and verdicts only
//! through `companion/pullRequest/review/submit`, catalog actions only
//! through `companion/pullRequest/action/run` with sufficient
//! confirmation, viewed marks only through `companion/pullRequest/viewed/set`.
//! See `CONTEXT.md` and `docs/forge-plugins.md`.

pub mod accounts;
pub mod action_run;
pub mod actions;
pub mod auth;
pub mod bundled;
pub mod cache;
pub mod detection;
pub mod directory;
pub mod errors;
pub mod ids;
pub mod limits;
pub mod links;
pub mod plugin_client;
pub mod pr_catalog;
pub mod providers;
pub mod reads;
pub mod registry;
pub mod scenarios;
pub mod submit;
pub mod tools;
pub mod wire;

use std::{path::PathBuf, sync::Arc};

use serde::de::DeserializeOwned;
use serde_json::{Value, json};
use tracing::info;

use self::{
    accounts::{AccountLink, Accounts},
    actions::Journal,
    auth::AuthFlows,
    bundled::BundledPlugins,
    cache::ForgeCache,
    errors::ForgeError,
    ids::{PullRequestIdentity, PullRequestKey},
    links::Links,
    plugin_client::{PluginSession, ProcessLimiter},
    providers::ProviderCatalog,
    registry::PluginRegistry,
    wire::AccountCondition,
};
use crate::{review::ReviewService, store::IndexStore};

/// Where a host keeps forge state and its bundled plugins.
#[derive(Clone, Debug)]
pub struct ForgeConfig {
    /// The host's bundled plugin directory (`libexec/`, `Contents/Helpers`).
    pub bundled_plugin_directory: Option<PathBuf>,
    /// `forge-plugins.json` of external plugins.
    pub registry_path: PathBuf,
    /// `<state>/forge-plugins`: one private state directory per plugin.
    pub plugin_state_root: PathBuf,
}

impl ForgeConfig {
    /// The standard layout under a companion state directory.
    #[must_use]
    pub fn under(
        state_directory: &std::path::Path,
        bundled_plugin_directory: Option<PathBuf>,
    ) -> Self {
        Self {
            bundled_plugin_directory,
            registry_path: state_directory.join("forge-plugins.json"),
            plugin_state_root: state_directory.join("forge-plugins"),
        }
    }
}

/// Content-free invalidations; clients re-read through their resources.
#[derive(Clone)]
pub struct ForgeEvents {
    sender: tokio::sync::mpsc::Sender<Value>,
}

impl ForgeEvents {
    #[must_use]
    pub fn new(sender: tokio::sync::mpsc::Sender<Value>) -> Self {
        Self { sender }
    }

    async fn send(&self, params: Value) {
        let payload = json!({"method": "companion/forge/invalidated", "params": params});
        if self.sender.send(payload).await.is_err() {
            tracing::warn!("forge invalidation was not journaled: the journal is closed");
        }
    }

    pub async fn accounts(&self) {
        self.send(json!({"scope": "accounts"})).await;
    }

    pub async fn list(&self) {
        self.send(json!({"scope": "list"})).await;
    }

    pub async fn pull_request(&self, key: &PullRequestKey) {
        self.send(json!({"scope": "pullRequest", "pullRequest": key}))
            .await;
    }
}

/// Everything the forge flows share.
pub struct ForgeContext {
    pub providers: ProviderCatalog,
    pub limiter: ProcessLimiter,
    pub accounts: Accounts,
    pub links: Links,
    pub cache: ForgeCache,
    pub journal: Journal,
    pub events: ForgeEvents,
    pub flows: AuthFlows,
    pub review: Arc<ReviewService>,
    pub agents: Option<crate::agent_bridge::AgentBridge>,
    pub workspaces: Option<Arc<crate::workspaces::WorkspaceAdmission>>,
    pub vcs: Option<Arc<crate::vcs::VcsService>>,
    pub detector: detection::Detector,
}

impl ForgeContext {
    /// A started and initialized session of an enabled provider.
    ///
    /// # Errors
    ///
    /// Returns `-32080` when the provider is disabled, unknown or missing,
    /// or the mapped start failure.
    pub async fn session(&self, plugin_id: &str) -> Result<PluginSession, ForgeError> {
        let spec = self.providers.spec(plugin_id)?;
        PluginSession::open(&spec, &self.limiter)
            .await
            .map_err(|error| ForgeError::from_plugin(plugin_id, None, error))
    }

    /// The account that reads a pull request: the one that listed it, else
    /// a linked account of its provider and host, preferring a connected one.
    ///
    /// # Errors
    ///
    /// Returns `-32080` for a disabled or missing provider and
    /// `authRequired` when no account of that host is linked.
    pub fn account_for(
        &self,
        key: &PullRequestKey,
        identity: &PullRequestIdentity,
    ) -> Result<AccountLink, ForgeError> {
        // A disabled or missing provider answers `-32080` before any
        // account question.
        self.providers.spec(&identity.plugin_id)?;
        let candidates: Vec<AccountLink> = self
            .accounts
            .links_of(&identity.plugin_id)?
            .into_iter()
            .filter(|link| link.host.eq_ignore_ascii_case(&identity.pr_ref.host))
            .collect();
        if let Some(listed) = self.cache.listed_by(key)
            && let Some(link) = candidates.iter().find(|link| link.key == listed)
        {
            return Ok(link.clone());
        }
        candidates
            .iter()
            .find(|link| self.accounts.condition(&link.key) == AccountCondition::Connected)
            .or_else(|| candidates.first())
            .cloned()
            .ok_or_else(|| ForgeError::AuthRequired {
                account: None,
                hint: "Connect an account for this forge".into(),
            })
    }

    /// Resolves a client pull request key to its identity.
    ///
    /// # Errors
    ///
    /// Returns invalid params for a key this companion did not issue.
    pub fn pull_request(
        value: &Value,
    ) -> Result<(PullRequestKey, PullRequestIdentity), ForgeError> {
        value
            .as_str()
            .and_then(PullRequestKey::parse)
            .ok_or_else(|| ForgeError::invalid("unknown pullRequest key"))
    }

    /// Records the account outcome of a failed call and returns the error.
    #[must_use]
    pub fn observe(&self, account: &AccountLink, error: ForgeError) -> ForgeError {
        self.accounts.observe_error(&account.key, &error);
        error
    }
}

/// The forge RPC service.
pub struct ForgeService {
    context: Arc<ForgeContext>,
}

/// The dependencies a host composition supplies.
pub struct ForgeDeps {
    pub store: Arc<IndexStore>,
    pub events: ForgeEvents,
    pub review: Arc<ReviewService>,
    pub agents: Option<crate::agent_bridge::AgentBridge>,
    pub workspaces: Option<Arc<crate::workspaces::WorkspaceAdmission>>,
    pub vcs: Option<Arc<crate::vcs::VcsService>>,
}

impl ForgeService {
    #[must_use]
    pub fn new(config: ForgeConfig, deps: ForgeDeps) -> Arc<Self> {
        let providers = ProviderCatalog::new(
            BundledPlugins::new(config.bundled_plugin_directory.clone()),
            PluginRegistry::new(config.registry_path.clone()),
            deps.store.clone(),
            config.plugin_state_root,
        );
        info!(
            bundled = config.bundled_plugin_directory.is_some(),
            "forge service ready"
        );
        let context = Arc::new(ForgeContext {
            providers,
            limiter: ProcessLimiter::default(),
            accounts: Accounts::new(deps.store.clone()),
            links: Links::new(deps.store.clone()),
            cache: ForgeCache::default(),
            journal: Journal::new(deps.store),
            events: deps.events,
            flows: AuthFlows::default(),
            review: deps.review,
            agents: deps.agents,
            workspaces: deps.workspaces,
            vcs: deps.vcs,
            detector: detection::Detector::default(),
        });
        context.review.sources().register(
            crate::review::source::SourceKind::PullRequest,
            Arc::new(pr_catalog::PullRequestCatalog::new(&context)),
        );
        Arc::new(Self { context })
    }

    /// The forge's client tool host (`codewide_link_pull_request`).
    #[must_use]
    pub fn tools(&self) -> Arc<tools::ForgeTools> {
        tools::ForgeTools::new(&self.context)
    }

    #[must_use]
    pub fn context(&self) -> &Arc<ForgeContext> {
        &self.context
    }

    /// Whether `method` belongs to the forge families. Claimed even when
    /// every provider is disabled, so none reaches Codex App Server.
    #[must_use]
    pub fn handles(method: &str) -> bool {
        method.starts_with("companion/forge/") || method.starts_with("companion/pullRequest")
    }

    /// The nine known reads of the forge and review families (outside the
    /// ordered lane).
    #[must_use]
    pub fn is_known_read(method: &str) -> bool {
        matches!(
            method,
            "companion/forge/accounts/read"
                | "companion/pullRequestLinks/read"
                | "companion/pullRequests/list"
                | "companion/pullRequest/read"
                | "companion/pullRequest/activity/read"
                | "companion/pullRequest/files/read"
                | "companion/review/hunks/read"
                | "companion/review/drafts/read"
                | "companion/review/guide/read"
        )
    }

    /// Handles one forge RPC.
    ///
    /// # Errors
    ///
    /// Returns the typed forge error of the method.
    pub async fn handle(&self, method: &str, params: &Value) -> Result<Value, ForgeError> {
        let context = &self.context;
        match method {
            "companion/forge/accounts/read" => directory::read(context).await,
            "companion/forge/provider/setEnabled" => directory::set_enabled(context, params).await,
            "companion/forge/auth/start" => auth::start(context, params).await,
            "companion/forge/auth/cancel" => auth::cancel(context, params).await,
            "companion/forge/auth/submitToken" => auth::submit_token(context, params).await,
            "companion/forge/account/disconnect" => auth::disconnect(context, params).await,
            "companion/pullRequests/list" => reads::list(context, params).await,
            "companion/pullRequest/read" => reads::overview(context, params).await,
            "companion/pullRequest/activity/read" => reads::activity(context, params).await,
            "companion/pullRequest/files/read" => reads::files(context, params).await,
            "companion/pullRequest/action/run" => action_run::run(context, params).await,
            "companion/pullRequest/review/submit" => submit::submit(context, params).await,
            "companion/pullRequest/viewed/set" => reads::set_viewed(context, params).await,
            "companion/pullRequestLinks/read" => scenarios::links_read(context, params),
            "companion/pullRequest/links/set" => scenarios::links_set(context, params).await,
            "companion/pullRequest/scenario/start" => scenarios::start(context, params).await,
            _ => Err(ForgeError::invalid(format!(
                "unknown forge method {method}"
            ))),
        }
    }

    /// Every provider with its enable flag and installation state, for the
    /// local administrator.
    ///
    /// # Errors
    ///
    /// Returns a storage failure.
    pub fn admin_providers(&self) -> Result<Value, ForgeError> {
        Ok(Value::Array(
            self.context
                .providers
                .entries()?
                .into_iter()
                .map(|entry| {
                    json!({
                        "pluginId": entry.plugin_id,
                        "builtIn": entry.built_in,
                        "enabled": entry.enabled,
                        "installed": entry.spec.is_some(),
                    })
                })
                .collect(),
        ))
    }

    /// The administrator's rollback switch; same effect as the client's
    /// `companion/forge/provider/setEnabled`.
    ///
    /// # Errors
    ///
    /// Returns `-32080` for an unknown provider.
    pub async fn admin_set_enabled(
        &self,
        plugin_id: &str,
        enabled: bool,
    ) -> Result<Value, ForgeError> {
        self.handle(
            "companion/forge/provider/setEnabled",
            &json!({"pluginId": plugin_id, "enabled": enabled}),
        )
        .await
    }

    /// Observes a client-wire event for branch detection.
    pub fn observe_event(self: &Arc<Self>, payload: &Value) {
        detection::observe(&self.context, payload);
    }
}

/// Decodes typed params.
///
/// # Errors
///
/// Returns invalid params with the shape error.
pub fn params<T: DeserializeOwned>(params: &Value) -> Result<T, ForgeError> {
    serde_json::from_value(params.clone())
        .map_err(|error| ForgeError::invalid(format!("invalid params: {error}")))
}
