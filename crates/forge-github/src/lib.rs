//! The built-in GitHub forge plugin.
//!
//! It speaks `forge-protocol` on stdin/stdout and owns every GitHub
//! credential: a token is resolved inside this process for each call (saved
//! token, then `GH_TOKEN` / `GH_ENTERPRISE_TOKEN`, then `gh auth token`) and
//! sent only in the `Authorization` header of HTTPS requests. No request or
//! response frame carries a token, except the inbound `pasteToken`
//! `auth.start`. stderr is unused; the companion discards it anyway.
//!
//! A `hostLogin` flow (`gh auth login --web`) lives in this process until
//! the companion closes stdin, which drops and kills it.

pub mod actions;
pub mod activity;
pub mod api;
pub mod auth;
pub mod checks;
pub mod comment_media;
pub mod comments;
pub mod content;
pub mod conversation;
pub mod credentials;
pub mod excerpt;
pub mod files;
pub mod gh;
pub mod login_flow;
pub mod media;
pub mod pull;
pub mod pulls;
pub mod pushes;
pub mod repo;
pub mod resolution;
pub mod review;
pub mod scenario;
pub mod secrets;

use std::{path::PathBuf, sync::Arc};

use forge_protocol::{
    ActivityParams, AuthDisconnectParams, AuthMethodsParams, AuthStartParams, AuthVerifyParams,
    ByBranchParams, ChecksParams, CommentCreateParams, ConversationParams, FileContentParams,
    FilesParams, ForgeAccountRef, ForgePlugin, InitializeParams, InitializeResult, ListParams,
    MediaReadParams, PROTOCOL_VERSION, PluginError, PluginIcon, PullRequestParams, ResolveParams,
    ResolveResult, ReviewSubmitParams, ReviewThreadReplyParams, ReviewThreadResolveParams,
    ScenarioContextParams, ViewedSetParams, capability, code, methods,
    plugin::{from_params, to_result},
};
use serde_json::{Value, json};

use crate::{
    api::Endpoints,
    auth::DEFAULT_HOST,
    credentials::{Credentials, EndpointResolver, EnvTokens},
    gh::GhCli,
    login_flow::HostLoginFlow,
    media::{MediaOrigins, MediaResolver},
    repo::{PullTarget, parse_remote},
    secrets::SecretStore,
};

/// The plugin id the companion registers for this plugin.
pub const PLUGIN_ID: &str = "github";

/// How the plugin finds its host tools and APIs.
pub struct PluginConfig {
    /// The `gh` executable; `gh` on `PATH` in production.
    pub gh_program: PathBuf,
    pub env: EnvTokens,
    pub endpoints: EndpointResolver,
    /// The media origins `forge.media.read` may fetch for a host.
    pub media: MediaResolver,
    /// The build version reported by `initialize`.
    pub version: String,
    /// How long a `hostLogin` flow may wait for the user.
    pub flow_lifetime: std::time::Duration,
}

impl PluginConfig {
    /// The production configuration: `gh` from `PATH`, tokens from the
    /// companion environment, the public GitHub APIs.
    #[must_use]
    pub fn from_process(version: &str) -> Self {
        Self {
            gh_program: PathBuf::from("gh"),
            env: EnvTokens::from_process(),
            endpoints: Arc::new(Endpoints::for_host),
            media: Arc::new(MediaOrigins::for_host),
            version: version.to_owned(),
            flow_lifetime: login_flow::DEFAULT_FLOW_LIFETIME,
        }
    }
}

pub struct GithubPlugin {
    credentials: Credentials,
    media: MediaResolver,
    version: String,
    flow_lifetime: std::time::Duration,
    initialized: bool,
    flow: Option<HostLoginFlow>,
}

impl GithubPlugin {
    #[must_use]
    pub fn new(config: PluginConfig) -> Self {
        Self {
            credentials: Credentials::new(
                config.env,
                GhCli::new(config.gh_program),
                config.endpoints,
            ),
            media: config.media,
            version: config.version,
            flow_lifetime: config.flow_lifetime,
            initialized: false,
            flow: None,
        }
    }

    fn initialize(&mut self, params: &InitializeParams) -> Result<InitializeResult, PluginError> {
        if params.protocol_version != PROTOCOL_VERSION {
            return Err(PluginError::invalid_params(format!(
                "unsupported protocol version {}",
                params.protocol_version
            )));
        }
        if !params.state_directory.is_absolute() {
            return Err(PluginError::invalid_params(
                "stateDirectory must be absolute",
            ));
        }
        self.credentials
            .set_secrets(SecretStore::new(&params.state_directory));
        self.initialized = true;
        Ok(InitializeResult {
            protocol_version: PROTOCOL_VERSION,
            provider: PLUGIN_ID.into(),
            forge_name: "GitHub".into(),
            version: self.version.clone(),
            default_host: Some(DEFAULT_HOST.into()),
            provider_icon: Some(github_mark()),
            capabilities: vec![
                capability::AUTH.into(),
                capability::LIST.into(),
                capability::SEARCH.into(),
                capability::READ.into(),
                capability::DIFF.into(),
                capability::ACTIONS.into(),
                capability::REVIEW.into(),
                capability::CHECKS.into(),
                capability::VIEWED.into(),
                capability::RESOLVE.into(),
                capability::SCENARIO_CONTEXT.into(),
                capability::CONVERSATION.into(),
                capability::COMMENTS.into(),
                capability::RESOLVE_CONVERSATION.into(),
                capability::FILE_CONTENT.into(),
            ],
            media_hosts: media::GITHUB_MEDIA_HOSTS
                .iter()
                .map(|&host| host.to_owned())
                .collect(),
            web_hosts: Vec::new(),
        })
    }

    async fn api_for(&mut self, account: &ForgeAccountRef) -> Result<api::Api, PluginError> {
        let host = auth::canonical_host(&account.host)?;
        Ok(self.credentials.resolve(&host, &account.login).await?.api)
    }

    async fn pull_request(
        &mut self,
        account: &ForgeAccountRef,
        pr_ref: &forge_protocol::ForgePrRef,
    ) -> Result<(api::Api, PullTarget), PluginError> {
        ensure_same_host(account, &pr_ref.host)?;
        let target = PullTarget::from_ref(pr_ref)?;
        Ok((self.api_for(account).await?, target))
    }

    async fn dispatch_auth(&mut self, method: &str, params: Value) -> Result<Value, PluginError> {
        match method {
            methods::AUTH_METHODS => {
                let params: AuthMethodsParams = from_params(params)?;
                let host = auth::canonical_host(params.host.as_deref().unwrap_or(DEFAULT_HOST))?;
                to_result(&auth::methods(&mut self.credentials, &host).await)
            }
            methods::AUTH_START => {
                let mut params: AuthStartParams = from_params(params)?;
                params.host = auth::canonical_host(&params.host)?;
                if params.method_id == auth::METHOD_HOST_LOGIN {
                    if self.flow.is_some() {
                        return Err(PluginError::invalid_params(
                            "a login flow is already running in this process",
                        ));
                    }
                    let (flow, result) =
                        auth::start_host_login(&self.credentials, &params.host, self.flow_lifetime)
                            .await?;
                    self.flow = Some(flow);
                    return to_result(&result);
                }
                to_result(&auth::start_linked(&mut self.credentials, params).await?)
            }
            methods::AUTH_POLL => {
                let Some(flow) = self.flow.as_mut() else {
                    return Err(PluginError::invalid_params("no login flow is running"));
                };
                let result = auth::poll(&mut self.credentials, flow).await;
                if !matches!(result, forge_protocol::AuthPollResult::Pending) {
                    self.flow = None;
                }
                to_result(&result)
            }
            methods::AUTH_VERIFY => {
                let mut params: AuthVerifyParams = from_params(params)?;
                params.host = auth::canonical_host(&params.host)?;
                to_result(&auth::verify(&mut self.credentials, params).await?)
            }
            methods::AUTH_DISCONNECT => {
                let mut params: AuthDisconnectParams = from_params(params)?;
                params.host = auth::canonical_host(&params.host)?;
                auth::disconnect(&self.credentials, params).await?;
                Ok(json!({}))
            }
            _ => Err(PluginError::new(
                code::METHOD_NOT_FOUND,
                format!("method not found: {method}"),
            )),
        }
    }

    async fn dispatch(&mut self, method: &str, params: Value) -> Result<Value, PluginError> {
        if method.starts_with("auth.") {
            return self.dispatch_auth(method, params).await;
        }
        match method {
            methods::PULL_REQUESTS_LIST => {
                let params: ListParams = from_params(params)?;
                let api = self.api_for(&params.account).await?;
                to_result(
                    &pulls::list(
                        &api,
                        &params.account.host,
                        &params.account.login,
                        params.category,
                        params.repository.as_deref(),
                        params.cursor,
                        params.limit,
                    )
                    .await?,
                )
            }
            methods::PULL_REQUESTS_SEARCH => {
                let params: forge_protocol::SearchParams = from_params(params)?;
                let api = self.api_for(&params.account).await?;
                to_result(
                    &pulls::search(
                        &api,
                        &params.account.host,
                        &params.account.login,
                        &params.query,
                        params.cursor,
                        params.limit,
                    )
                    .await?,
                )
            }
            methods::PULL_REQUESTS_BY_BRANCH => {
                let params: ByBranchParams = from_params(params)?;
                let api = self.api_for(&params.account).await?;
                to_result(
                    &pulls::by_branch(
                        &api,
                        &params.account.host,
                        &params.repository,
                        &params.branch,
                    )
                    .await?,
                )
            }
            methods::REPOSITORY_RESOLVE => {
                let params: ResolveParams = from_params(params)?;
                resolve(&params.remotes)
            }
            methods::MEDIA_READ => {
                let params: MediaReadParams = from_params(params)?;
                self.media_read(&params).await
            }
            _ => self.dispatch_pull(method, params).await,
        }
    }

    async fn dispatch_pull(&mut self, method: &str, params: Value) -> Result<Value, PluginError> {
        match method {
            methods::PULL_REQUEST_READ => {
                let params: PullRequestParams = from_params(params)?;
                let (api, target) = self.pull_request(&params.account, &params.pr_ref).await?;
                to_result(&pull::read(&api, &target).await?)
            }
            methods::PULL_REQUEST_ACTIVITY => {
                let params: ActivityParams = from_params(params)?;
                let (api, target) = self.pull_request(&params.account, &params.pr_ref).await?;
                to_result(&activity::activity(&api, &target, params.cursor.as_deref()).await?)
            }
            methods::PULL_REQUEST_CHECKS => {
                let params: ChecksParams = from_params(params)?;
                let (api, target) = self.pull_request(&params.account, &params.pr_ref).await?;
                to_result(&checks::checks(&api, &target, &params.head_revision).await?)
            }
            methods::PULL_REQUEST_FILES => {
                let params: FilesParams = from_params(params)?;
                let (api, target) = self.pull_request(&params.account, &params.pr_ref).await?;
                to_result(&files::files(&api, &target, &params.head_revision, params.cursor).await?)
            }
            methods::PULL_REQUEST_FILE_CONTENT => {
                let params: FileContentParams = from_params(params)?;
                let (api, target) = self.pull_request(&params.account, &params.pr_ref).await?;
                to_result(
                    &content::file_content(&api, &target, &params.head_revision, &params.path)
                        .await?,
                )
            }
            methods::PULL_REQUEST_ACTIONS => {
                let params: PullRequestParams = from_params(params)?;
                let login = params.account.login.clone();
                let (api, target) = self.pull_request(&params.account, &params.pr_ref).await?;
                to_result(&actions::catalog(&api, &target, &login).await?)
            }
            methods::PULL_REQUEST_ACTION_RUN => {
                let params: forge_protocol::ActionRunParams = from_params(params)?;
                let (api, target) = self.pull_request(&params.account, &params.pr_ref).await?;
                to_result(
                    &actions::run(
                        &api,
                        &target,
                        &params.action_id,
                        &params.head_revision,
                        &params.input,
                    )
                    .await?,
                )
            }
            methods::PULL_REQUEST_REVIEW_SUBMIT => {
                let params: ReviewSubmitParams = from_params(params)?;
                let (api, target) = self.pull_request(&params.account, &params.pr_ref).await?;
                to_result(
                    &review::submit(
                        &api,
                        &target,
                        &params.head_revision,
                        &params.verdict_action_id,
                        params.body.as_deref(),
                        &params.comments,
                    )
                    .await?,
                )
            }
            methods::PULL_REQUEST_VIEWED_SET => {
                let params: ViewedSetParams = from_params(params)?;
                let (api, target) = self.pull_request(&params.account, &params.pr_ref).await?;
                review::set_viewed(
                    &api,
                    &target,
                    &params.head_revision,
                    &params.path,
                    params.viewed,
                )
                .await?;
                Ok(json!({}))
            }
            methods::PULL_REQUEST_SCENARIO_CONTEXT => {
                let params: ScenarioContextParams = from_params(params)?;
                let (api, target) = self.pull_request(&params.account, &params.pr_ref).await?;
                to_result(
                    &scenario::context(&api, &target, params.scenario, params.check_id.as_deref())
                        .await?,
                )
            }
            _ => self.dispatch_conversation(method, params).await,
        }
    }

    /// `forge.conversation@1` reads, `forge.comments@1` writes and
    /// `forge.conversation.resolve@1`.
    async fn dispatch_conversation(
        &mut self,
        method: &str,
        params: Value,
    ) -> Result<Value, PluginError> {
        match method {
            methods::PULL_REQUEST_CONVERSATION => {
                let params: ConversationParams = from_params(params)?;
                let (api, target) = self.pull_request(&params.account, &params.pr_ref).await?;
                to_result(
                    &conversation::conversation(&api, &target, params.cursor.as_deref()).await?,
                )
            }
            methods::PULL_REQUEST_COMMENT_CREATE => {
                let params: CommentCreateParams = from_params(params)?;
                let (api, target) = self.pull_request(&params.account, &params.pr_ref).await?;
                to_result(&comments::create(&api, &target, &params.body).await?)
            }
            methods::PULL_REQUEST_REVIEW_THREAD_REPLY => {
                let params: ReviewThreadReplyParams = from_params(params)?;
                let (api, target) = self.pull_request(&params.account, &params.pr_ref).await?;
                to_result(&comments::reply(&api, &target, &params.thread_id, &params.body).await?)
            }
            methods::PULL_REQUEST_REVIEW_THREAD_RESOLVE => {
                let params: ReviewThreadResolveParams = from_params(params)?;
                let (api, target) = self.pull_request(&params.account, &params.pr_ref).await?;
                to_result(
                    &resolution::resolve(&api, &target, &params.thread_id, params.resolved).await?,
                )
            }
            _ => Err(PluginError::new(
                code::METHOD_NOT_FOUND,
                format!("method not found: {method}"),
            )),
        }
    }
}

impl GithubPlugin {
    /// `forge.media.read`: the URL is checked against the account host's
    /// media origins before any credential is resolved, and the token is
    /// resolved only for a credentialed origin.
    async fn media_read(&mut self, params: &MediaReadParams) -> Result<Value, PluginError> {
        let host = auth::canonical_host(&params.account.host)?;
        let origins = (self.media)(&host);
        let (url, credentialed) = media::admit(&origins, &params.url)?;
        let api = if credentialed {
            Some(self.api_for(&params.account).await?)
        } else {
            None
        };
        to_result(&media::read(&origins, api.as_ref(), url).await?)
    }
}

#[async_trait::async_trait]
impl ForgePlugin for GithubPlugin {
    async fn handle(&mut self, method: &str, params: Value) -> Result<Value, PluginError> {
        if method == methods::INITIALIZE {
            let params: InitializeParams = from_params(params)?;
            return to_result(&self.initialize(&params)?);
        }
        if !self.initialized {
            return Err(PluginError::invalid_params("initialize must come first"));
        }
        self.dispatch(method, params).await
    }
}

/// `forge.repository.resolve`: the first remote on `github.com` wins.
fn resolve(remotes: &[String]) -> Result<Value, PluginError> {
    remotes
        .iter()
        .filter_map(|remote| parse_remote(remote))
        .find(|(host, _)| host == DEFAULT_HOST)
        .map_or_else(
            || {
                Err(PluginError::new(
                    code::NOT_OWNED,
                    "no remote belongs to GitHub",
                ))
            },
            |(host, repository)| to_result(&ResolveResult { host, repository }),
        )
}

fn ensure_same_host(account: &ForgeAccountRef, host: &str) -> Result<(), PluginError> {
    if auth::canonical_host(&account.host)? == auth::canonical_host(host)? {
        Ok(())
    } else {
        Err(PluginError::invalid_params(
            "the account and the pull request are on different hosts",
        ))
    }
}

/// Serves the protocol on stdin/stdout until the companion closes stdin.
///
/// # Errors
///
/// Returns a framing error when the transport breaks.
pub async fn run_stdio(config: PluginConfig) -> Result<(), forge_protocol::FrameError> {
    let mut plugin = GithubPlugin::new(config);
    let mut reader = tokio::io::BufReader::new(tokio::io::stdin());
    let mut writer = tokio::io::stdout();
    forge_protocol::serve(&mut plugin, &mut reader, &mut writer).await
}

/// The GitHub mark (Octicons `mark-github`), shown only to identify the
/// forge, as GitHub's logo guidelines allow.
fn github_mark() -> PluginIcon {
    PluginIcon::Glyph {
        view_box: "0 0 16 16".into(),
        path: GITHUB_MARK_PATH.into(),
    }
}

const GITHUB_MARK_PATH: &str = "M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z";
