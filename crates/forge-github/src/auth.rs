//! `auth.*`: the GitHub sign-in methods.
//!
//! - `gh-existing` (`linkExisting`): link a login `gh` or the environment
//!   already holds.
//! - `gh-login` (`hostLogin`): run `gh auth login --web` on the host.
//! - `token` (`pasteToken`): validate a pasted token with `GET /user` and
//!   save it in the plugin secret store.
//! - `install-gh` (`instructions`): how to install `gh` when it is missing or
//!   too old. Nothing is installed automatically.

use forge_protocol::{
    AuthDisconnectParams, AuthLink, AuthMethod, AuthMethodKind, AuthMethodsResult, AuthPollResult,
    AuthPurpose, AuthStartParams, AuthStartResult, AuthVerifyParams, AuthVerifyResult,
    CredentialSource, DisconnectMode, PluginError, Secret, code,
};

use crate::{
    credentials::{Credentials, identify},
    gh::{GhAvailability, MIN_GH_VERSION, valid_login},
    login_flow::{FALLBACK_INSTRUCTIONS, FlowPoll, HostLoginFlow},
};

pub const DEFAULT_HOST: &str = "github.com";
pub const METHOD_LINK_EXISTING: &str = "gh-existing";
pub const METHOD_HOST_LOGIN: &str = "gh-login";
pub const METHOD_PASTE_TOKEN: &str = "token";
pub const METHOD_INSTRUCTIONS: &str = "install-gh";
/// Classic token scopes `CodeWide` needs.
pub const REQUIRED_SCOPES: [&str; 2] = ["repo", "read:org"];
const MAX_TOKEN_CHARS: usize = 255;

/// `auth.methods` for one host.
pub async fn methods(credentials: &mut Credentials, host: &str) -> AuthMethodsResult {
    let availability = credentials.gh.availability().await;
    let mut existing = match availability {
        GhAvailability::Ready { .. } => credentials.gh.logins(host).await.unwrap_or_default(),
        _ => Vec::new(),
    };
    if let Some(login) = credentials.environment_login(host).await
        && !existing
            .iter()
            .any(|known| known.eq_ignore_ascii_case(&login))
    {
        existing.push(login);
    }
    let gh_problem = match &availability {
        GhAvailability::Missing => {
            Some("The GitHub CLI (gh) is not installed on the companion host.".to_owned())
        }
        GhAvailability::TooOld { version } => Some(format!(
            "gh {version} is too old; version {}.{}.{} or newer is required.",
            MIN_GH_VERSION.0, MIN_GH_VERSION.1, MIN_GH_VERSION.2
        )),
        GhAvailability::Ready { .. } => None,
    };
    let mut methods = vec![
        link_existing_method(existing),
        host_login_method(gh_problem.clone()),
        paste_token_method(host),
    ];
    if let Some(problem) = gh_problem {
        methods.push(instructions_method(&problem));
    }
    AuthMethodsResult {
        methods,
        default_host: DEFAULT_HOST.into(),
    }
}

fn method(method_id: &str, kind: AuthMethodKind, label: &str, detail: String) -> AuthMethod {
    AuthMethod {
        method_id: method_id.into(),
        kind,
        purpose: AuthPurpose::Account,
        label: label.into(),
        detail,
        available: true,
        unavailable_reason: None,
        existing_logins: Vec::new(),
        links: Vec::new(),
        required_permissions: Vec::new(),
        disconnect_modes: Vec::new(),
    }
}

fn link_existing_method(existing: Vec<String>) -> AuthMethod {
    AuthMethod {
        available: !existing.is_empty(),
        unavailable_reason: existing
            .is_empty()
            .then(|| "No GitHub login was found on the companion host.".to_owned()),
        existing_logins: existing,
        disconnect_modes: vec![DisconnectMode::Unlink, DisconnectMode::LogoutHost],
        ..method(
            METHOD_LINK_EXISTING,
            AuthMethodKind::LinkExisting,
            "Use an existing GitHub login",
            "Links a login the GitHub CLI or the companion environment already holds. CodeWide inherits that login's scopes (gh default: repo, read:org, gist).".into(),
        )
    }
}

fn host_login_method(gh_problem: Option<String>) -> AuthMethod {
    AuthMethod {
        available: gh_problem.is_none(),
        unavailable_reason: gh_problem,
        disconnect_modes: vec![DisconnectMode::Unlink, DisconnectMode::LogoutHost],
        ..method(
            METHOD_HOST_LOGIN,
            AuthMethodKind::HostLogin,
            "Log in through gh",
            "Runs gh auth login on the companion host. Enter the one-time code on GitHub; gh keeps the token. gh requests the scopes repo, read:org and gist.".into(),
        )
    }
}

fn paste_token_method(host: &str) -> AuthMethod {
    AuthMethod {
        links: vec![
            AuthLink {
                label: "Generate token".into(),
                url: format!(
                    "https://{host}/settings/tokens/new?scopes=repo,read:org&description=CodeWide"
                ),
            },
            AuthLink {
                label: "Fine-grained token".into(),
                url: format!("https://{host}/settings/personal-access-tokens/new"),
            },
        ],
        required_permissions: vec![
            "Pull requests: read and write".into(),
            "Contents: read".into(),
            "Checks: read".into(),
            "Commit statuses: read".into(),
            "Metadata: read".into(),
        ],
        disconnect_modes: vec![DisconnectMode::ForgetToken],
        ..method(
            METHOD_PASTE_TOKEN,
            AuthMethodKind::PasteToken,
            "Paste a token",
            "Use this when gh is not on the host or you prefer not to use it. A classic token needs repo and read:org; repo grants full repository access. A fine-grained token sees only the selected repositories, and an organization may have to approve it.".into(),
        )
    }
}

fn instructions_method(problem: &str) -> AuthMethod {
    method(
        METHOD_INSTRUCTIONS,
        AuthMethodKind::Instructions,
        "Install the GitHub CLI",
        format!(
            "{problem} Install gh from https://cli.github.com on the companion host, make sure the companion service can find it on its PATH, then tap Check again."
        ),
    )
}

/// `auth.start` for `linkExisting` and `pasteToken`; `hostLogin` is started
/// by [`start_host_login`] because it keeps a flow in the plugin.
///
/// # Errors
///
/// Returns invalid params for an unknown method, and `authRequired` when the
/// login cannot be verified or a pasted token is invalid.
pub async fn start_linked(
    credentials: &mut Credentials,
    params: AuthStartParams,
) -> Result<AuthStartResult, PluginError> {
    validate_host(&params.host)?;
    match params.method_id.as_str() {
        METHOD_LINK_EXISTING => {
            let login = params
                .login
                .filter(|login| valid_login(login))
                .ok_or_else(|| PluginError::invalid_params("a valid login is required"))?;
            let verified = verify(
                credentials,
                AuthVerifyParams {
                    host: params.host,
                    login,
                    purpose: AuthPurpose::Account,
                },
            )
            .await?;
            Ok(AuthStartResult::Linked {
                login: verified.login,
                scopes: verified.scopes,
                credential_source: verified.credential_source,
            })
        }
        METHOD_PASTE_TOKEN => {
            let token = params
                .token
                .ok_or_else(|| PluginError::invalid_params("a token is required"))?;
            save_pasted_token(credentials, &params.host, token).await
        }
        _ => Err(PluginError::invalid_params(
            "unknown or non-startable method",
        )),
    }
}

async fn save_pasted_token(
    credentials: &Credentials,
    host: &str,
    token: Secret,
) -> Result<AuthStartResult, PluginError> {
    let value = token.expose();
    if value.is_empty() || value.len() > MAX_TOKEN_CHARS || value.contains(char::is_whitespace) {
        return Err(PluginError::auth_required("The token is not valid."));
    }
    let api = credentials.api_with(host, token.clone())?;
    let identity = identify(&api).await.map_err(|error| {
        if error.code == code::AUTH_REQUIRED {
            PluginError::auth_required("GitHub rejected the token. It is invalid or expired.")
        } else {
            error
        }
    })?;
    if let Some(scopes) = &identity.scopes {
        let missing: Vec<&str> = REQUIRED_SCOPES
            .iter()
            .copied()
            .filter(|required| !scopes.iter().any(|scope| scope == required))
            .collect();
        if !missing.is_empty() {
            return Err(PluginError::auth_required(format!(
                "The token is missing scopes: {}.",
                missing.join(", ")
            )));
        }
    }
    credentials
        .secrets()?
        .save(host, &identity.login, &token)
        .map_err(|_| PluginError::internal("the token could not be saved"))?;
    Ok(AuthStartResult::Linked {
        login: identity.login,
        scopes: identity.scopes,
        credential_source: Some(CredentialSource::SavedToken),
    })
}

/// Starts `gh auth login --web` and returns its device prompt.
///
/// # Errors
///
/// Returns an error when `gh` is unavailable or its output is not
/// understood; the message carries the host fallback.
pub async fn start_host_login(
    credentials: &Credentials,
    host: &str,
    lifetime: std::time::Duration,
) -> Result<(HostLoginFlow, AuthStartResult), PluginError> {
    validate_host(host)?;
    if !matches!(
        credentials.gh.availability().await,
        GhAvailability::Ready { .. }
    ) {
        return Err(PluginError::new(
            code::CAPABILITY_UNAVAILABLE,
            "gh is missing or too old on the companion host",
        ));
    }
    let (flow, prompt) = HostLoginFlow::start(&credentials.gh, host, lifetime)
        .await
        .map_err(|_| PluginError::new(code::FORGE_REJECTED, FALLBACK_INSTRUCTIONS))?;
    Ok((
        flow,
        AuthStartResult::HostLogin {
            user_code: prompt.user_code,
            verification_uri: prompt.verification_uri,
            expires_in_seconds: lifetime.as_secs(),
        },
    ))
}

/// `auth.poll` of the flow this process runs. A completed login is verified
/// before it is reported.
pub async fn poll(credentials: &mut Credentials, flow: &mut HostLoginFlow) -> AuthPollResult {
    match flow.poll() {
        FlowPoll::Pending => AuthPollResult::Pending,
        FlowPoll::Failed { reason } => AuthPollResult::Failed {
            reason,
            fallback_instructions: FALLBACK_INSTRUCTIONS.into(),
            retryable: true,
        },
        FlowPoll::Complete { login } => {
            let host = flow.host().to_owned();
            match verify(
                credentials,
                AuthVerifyParams {
                    host,
                    login,
                    purpose: AuthPurpose::Account,
                },
            )
            .await
            {
                Ok(verified) => AuthPollResult::Complete {
                    login: verified.login,
                },
                Err(_) => AuthPollResult::Failed {
                    reason: "gh finished, but the login could not be verified.".into(),
                    fallback_instructions: FALLBACK_INSTRUCTIONS.into(),
                    retryable: true,
                },
            }
        }
    }
}

/// `auth.verify`: the account's credential still proves its login.
///
/// # Errors
///
/// Returns `authRequired` when no credential proves the login, and
/// `capabilityUnavailable` for the `checks` purpose GitHub does not have.
pub async fn verify(
    credentials: &mut Credentials,
    params: AuthVerifyParams,
) -> Result<AuthVerifyResult, PluginError> {
    validate_host(&params.host)?;
    if params.purpose == AuthPurpose::Checks {
        return Err(PluginError::new(
            code::CAPABILITY_UNAVAILABLE,
            "GitHub has no separate checks credential",
        ));
    }
    let resolved = credentials.resolve(&params.host, &params.login).await?;
    let identity = identify(&resolved.api).await?;
    if !identity.login.eq_ignore_ascii_case(&params.login) {
        return Err(PluginError::auth_required(
            "The credential belongs to another GitHub login. Reconnect GitHub.",
        ));
    }
    Ok(AuthVerifyResult {
        login: identity.login,
        credential_source: Some(resolved.source),
        scopes: identity.scopes,
    })
}

/// `auth.disconnect`: `forgetToken` deletes the saved token; `logoutHost`
/// runs `gh auth logout` (the companion enforces its destructive
/// confirmation before calling).
///
/// # Errors
///
/// Returns invalid params for `unlink` (a companion-only mode) and an error
/// when the store or `gh` fails.
pub async fn disconnect(
    credentials: &Credentials,
    params: AuthDisconnectParams,
) -> Result<(), PluginError> {
    validate_host(&params.host)?;
    match params.mode {
        DisconnectMode::ForgetToken => credentials
            .secrets()?
            .forget(&params.host, &params.login)
            .map(|_| ())
            .map_err(|_| PluginError::internal("the saved token could not be deleted")),
        DisconnectMode::LogoutHost => credentials
            .gh
            .logout(&params.host, &params.login)
            .await
            .map_err(|_| PluginError::new(code::FORGE_REJECTED, "gh could not log out")),
        DisconnectMode::Unlink => Err(PluginError::invalid_params(
            "unlink is handled by the companion",
        )),
    }
}

/// Hosts are canonical DNS names: lower case, no trailing dot, an optional
/// port only on an Enterprise host. Every token, endpoint and secret file is
/// chosen by the canonical form, so `GitHub.com.` and `github.com` are one
/// host and `github.com:8443` is none.
///
/// # Errors
///
/// Returns invalid params for a malformed host.
pub fn canonical_host(host: &str) -> Result<String, PluginError> {
    let lowered = host.trim().to_ascii_lowercase();
    let (name, port) = match lowered.split_once(':') {
        Some((name, port)) => (name.trim_end_matches('.'), Some(port)),
        None => (lowered.trim_end_matches('.'), None),
    };
    let valid_name = !name.is_empty()
        && name.len() <= 253
        && !name.starts_with(['-', '.'])
        && !name.contains("..")
        && name
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'.'));
    let valid_port = port.is_none_or(|port| {
        name != DEFAULT_HOST
            && !port.is_empty()
            && port.len() <= 5
            && port.bytes().all(|byte| byte.is_ascii_digit())
    });
    if !valid_name || !valid_port {
        return Err(PluginError::invalid_params("invalid host"));
    }
    Ok(match port {
        Some(port) => format!("{name}:{port}"),
        None => name.to_owned(),
    })
}

/// Checks that `host` is already canonical.
///
/// # Errors
///
/// Returns invalid params for a malformed or non-canonical host.
pub fn validate_host(host: &str) -> Result<(), PluginError> {
    if canonical_host(host)? == host {
        Ok(())
    } else {
        Err(PluginError::invalid_params("invalid host"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hosts_are_canonical_and_github_com_takes_no_port() {
        assert_eq!(
            canonical_host("GitHub.com.").ok().as_deref(),
            Some("github.com")
        );
        assert_eq!(
            canonical_host("GHE.Example.com:8443").ok().as_deref(),
            Some("ghe.example.com:8443")
        );
        for invalid in [
            "github.com:8443",
            "",
            "-a.b",
            "a..b",
            "a b",
            "ghe.example.com:",
            "x:abc",
        ] {
            assert!(canonical_host(invalid).is_err(), "{invalid}");
        }
        assert!(validate_host("github.com").is_ok());
        assert!(validate_host("GitHub.com").is_err());
    }
}
