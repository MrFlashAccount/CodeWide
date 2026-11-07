//! Credential resolution per host and account, as t3code does it:
//!
//! 1. a saved token the user pasted, stored by this plugin;
//! 2. `GH_TOKEN` for `github.com`, or `GH_ENTERPRISE_TOKEN` for an
//!    Enterprise host only — the enterprise token is never sent to
//!    `github.com`;
//! 3. `gh auth token --hostname <host> --user <login>`.
//!
//! An environment token is used for an account only after `GET /user`
//! proves it belongs to that login. The resolved token lives only in this
//! process for the duration of one call.

use std::{collections::HashMap, sync::Arc};

use forge_protocol::{CredentialSource, PluginError, Secret};

use crate::{
    api::{Api, Endpoints, oauth_scopes},
    gh::GhCli,
    secrets::SecretStore,
};

/// Tokens from the companion environment, read once at plugin start.
#[derive(Clone, Default)]
pub struct EnvTokens {
    pub gh_token: Option<Secret>,
    pub gh_enterprise_token: Option<Secret>,
    /// The canonical `GH_HOST`: the only host `GH_ENTERPRISE_TOKEN` goes to.
    pub enterprise_host: Option<String>,
}

impl EnvTokens {
    /// Reads `GH_TOKEN` and `GH_ENTERPRISE_TOKEN`; empty values are absent.
    #[must_use]
    pub fn from_process() -> Self {
        let read = |name: &str| {
            std::env::var(name)
                .ok()
                .map(|value| value.trim().to_owned())
                .filter(|value| !value.is_empty())
                .map(Secret::new)
        };
        Self {
            gh_token: read("GH_TOKEN"),
            gh_enterprise_token: read("GH_ENTERPRISE_TOKEN"),
            enterprise_host: std::env::var("GH_HOST")
                .ok()
                .and_then(|host| crate::auth::canonical_host(&host).ok())
                .filter(|host| host != crate::auth::DEFAULT_HOST),
        }
    }

    /// The environment token that may be sent to the canonical `host`:
    /// `GH_TOKEN` only to `github.com`, `GH_ENTERPRISE_TOKEN` only to
    /// `GH_HOST`.
    #[must_use]
    pub fn for_host(&self, host: &str) -> Option<&Secret> {
        if host == crate::auth::DEFAULT_HOST {
            self.gh_token.as_ref()
        } else if self.enterprise_host.as_deref() == Some(host) {
            self.gh_enterprise_token.as_ref()
        } else {
            None
        }
    }
}

/// A token resolved for one call, with where it came from.
pub struct Resolved {
    pub api: Api,
    pub source: CredentialSource,
}

/// The identity a token proves.
pub struct Identity {
    pub login: String,
    pub scopes: Option<Vec<String>>,
}

/// Maps a host to its API roots; tests point it at a local server.
pub type EndpointResolver = Arc<dyn Fn(&str) -> Endpoints + Send + Sync>;

/// Resolves credentials for accounts and caches the login an environment
/// token belongs to for this process.
pub struct Credentials {
    pub(crate) secrets: Option<SecretStore>,
    pub(crate) env: EnvTokens,
    pub(crate) gh: GhCli,
    pub(crate) endpoints: EndpointResolver,
    env_logins: HashMap<String, Option<String>>,
}

impl Credentials {
    #[must_use]
    pub fn new(env: EnvTokens, gh: GhCli, endpoints: EndpointResolver) -> Self {
        Self {
            secrets: None,
            env,
            gh,
            endpoints,
            env_logins: HashMap::new(),
        }
    }

    pub(crate) fn set_secrets(&mut self, secrets: SecretStore) {
        self.secrets = Some(secrets);
    }

    pub(crate) fn secrets(&self) -> Result<&SecretStore, PluginError> {
        self.secrets
            .as_ref()
            .ok_or_else(|| PluginError::internal("the plugin is not initialized"))
    }

    /// An API session with an explicit token (a pasted one under check).
    ///
    /// # Errors
    ///
    /// Returns an internal error when the client cannot be built.
    pub fn api_with(&self, host: &str, token: Secret) -> Result<Api, PluginError> {
        Api::new((self.endpoints)(host), token)
    }

    /// Resolves the credential of `(host, login)` by precedence.
    ///
    /// # Errors
    ///
    /// Returns `authRequired` when no source holds a token for the login.
    pub async fn resolve(&mut self, host: &str, login: &str) -> Result<Resolved, PluginError> {
        if let Some(token) = self
            .secrets()?
            .load(host, login)
            .map_err(|_| PluginError::internal("the saved token could not be read"))?
        {
            return Ok(Resolved {
                api: self.api_with(host, token)?,
                source: CredentialSource::SavedToken,
            });
        }
        if let Some(token) = self.env.for_host(host).cloned()
            && self
                .environment_login(host)
                .await
                .is_some_and(|owner| owner.eq_ignore_ascii_case(login))
        {
            return Ok(Resolved {
                api: self.api_with(host, token)?,
                source: CredentialSource::Environment,
            });
        }
        if let Ok(Some(token)) = self.gh.token(host, login).await {
            return Ok(Resolved {
                api: self.api_with(host, token)?,
                source: CredentialSource::GhCli,
            });
        }
        Err(PluginError::auth_required("Reconnect GitHub"))
    }

    /// The login of the environment token for `host`, asked once.
    pub async fn environment_login(&mut self, host: &str) -> Option<String> {
        let key = host.to_ascii_lowercase();
        if let Some(cached) = self.env_logins.get(&key) {
            return cached.clone();
        }
        let token = self.env.for_host(host)?.clone();
        let login = match self.api_with(host, token) {
            Ok(api) => identify(&api).await.ok().map(|identity| identity.login),
            Err(_) => None,
        };
        self.env_logins.insert(key, login.clone());
        login
    }
}

/// `GET /user`: the login a token belongs to and its classic scopes.
///
/// # Errors
///
/// Returns `authRequired` for a rejected token and the mapped failure
/// otherwise.
pub async fn identify(api: &Api) -> Result<Identity, PluginError> {
    let reply = api.get_reply("/user").await?;
    let login = reply
        .body
        .get("login")
        .and_then(serde_json::Value::as_str)
        .filter(|login| crate::gh::valid_login(login))
        .ok_or_else(|| PluginError::internal("GitHub returned no login"))?
        .to_owned();
    Ok(Identity {
        login,
        scopes: oauth_scopes(&reply.headers),
    })
}
