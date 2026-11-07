//! Account connection: `companion/forge/auth/start`, `auth/cancel`,
//! `auth/submitToken` and `account/disconnect`.
//!
//! A `hostLogin` flow runs in one dedicated plugin process that lives until
//! the flow ends: the plugin keeps the host tool's login (`gh auth login
//! --web`) running between `auth.start` and `auth.poll`. Cancel, expiry or a
//! companion restart closes the plugin's stdin, and the plugin then kills
//! its child. At most one flow runs per provider and host.
//!
//! `submitToken` is the single path on which a token crosses the companion:
//! it is handed unchanged to the plugin's `auth.start` and dropped. It is
//! never journaled, logged, stored or returned; a reason that would quote it
//! is redacted.

use std::{
    collections::{HashMap, HashSet},
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

use forge_protocol::{
    AuthDisconnectParams, AuthMethod, AuthMethodKind, AuthMethodsParams, AuthMethodsResult,
    AuthPollResult, AuthPurpose, AuthStartParams, AuthStartResult, AuthVerifyParams,
    AuthVerifyResult, DisconnectMode, Secret, methods,
};
use serde::Deserialize;
use serde_json::{Value, json};
use tokio_util::sync::CancellationToken;
use tracing::{info, warn};

use super::{
    ForgeContext,
    accounts::{AccountLink, fallback_source},
    errors::{Confirmation, ForgeError},
    ids::{AuthFlowId, ForgeAccountKey, valid_idempotency_key},
    limits, params,
    plugin_client::PluginSession,
    wire::{AuthFlowStatus, AuthFlowWire, https_on_host, rfc3339},
};

/// Results of recent idempotent auth requests, kept briefly so a retried
/// request does not start a second login or paste.
const IDEMPOTENCY_WINDOW: Duration = Duration::from_mins(20);
/// A failed flow stays visible this long unless dismissed or restarted.
const FAILED_FLOW_RETENTION: Duration = Duration::from_mins(15);

struct ActiveFlow {
    wire: AuthFlowWire,
    cancel: CancellationToken,
    /// When the flow ended in a failure.
    failed_at: Option<Instant>,
}

#[derive(Clone, Default)]
pub struct AuthFlows {
    flows: Arc<Mutex<HashMap<String, ActiveFlow>>>,
    /// `(plugin, host)` pairs whose flow is starting; always locked after
    /// `flows`.
    starting: Arc<Mutex<HashSet<(String, String)>>>,
    recent: Arc<Mutex<HashMap<String, (Instant, Value)>>>,
}

/// A started-but-not-yet-registered flow slot; released on drop.
struct Reservation {
    starting: Arc<Mutex<HashSet<(String, String)>>>,
    pair: (String, String),
}

impl Drop for Reservation {
    fn drop(&mut self) {
        if let Ok(mut starting) = self.starting.lock() {
            starting.remove(&self.pair);
        }
    }
}

/// What a reservation attempt found.
enum Reserved {
    Slot(Reservation),
    Running(AuthFlowWire),
}

impl AuthFlows {
    /// Active flows for `companion/forge/accounts/read`.
    #[must_use]
    pub fn active(&self) -> Vec<AuthFlowWire> {
        let Ok(mut flows) = self.flows.lock() else {
            return Vec::new();
        };
        flows.retain(|_, flow| {
            flow.failed_at
                .is_none_or(|failed| failed.elapsed() < FAILED_FLOW_RETENTION)
        });
        flows.values().map(|flow| flow.wire.clone()).collect()
    }

    /// Reserves the `(plugin, host)` pair for a new host login in one step:
    /// a running flow of the pair is returned instead, a concurrent start of
    /// the same pair is refused, and the companion-wide flow cap holds.
    fn reserve(&self, plugin_id: &str, host: &str) -> Result<Reserved, ForgeError> {
        let flows = self
            .flows
            .lock()
            .map_err(|_| ForgeError::internal("auth flows are unavailable"))?;
        if let Some(flow) = flows.values().find(|flow| {
            flow.failed_at.is_none()
                && flow.wire.plugin_id == plugin_id
                && flow.wire.host.eq_ignore_ascii_case(host)
        }) {
            return Ok(Reserved::Running(flow.wire.clone()));
        }
        let mut starting = self
            .starting
            .lock()
            .map_err(|_| ForgeError::internal("auth flows are unavailable"))?;
        let pair = (plugin_id.to_owned(), host.to_ascii_lowercase());
        if starting.contains(&pair) {
            return Err(ForgeError::Conflict {
                current: json!({"reason": "a sign-in for this provider is starting"}),
            });
        }
        let running = flows
            .values()
            .filter(|flow| flow.failed_at.is_none())
            .count();
        if running + starting.len() >= limits::MAX_AUTH_FLOWS {
            return Err(ForgeError::CapabilityUnavailable {
                reason: "Too many sign-ins are running; finish or cancel one first".into(),
            });
        }
        starting.insert(pair.clone());
        Ok(Reserved::Slot(Reservation {
            starting: self.starting.clone(),
            pair,
        }))
    }

    /// Keeps a flow visible as failed with the reason the phone shows.
    fn fail(&self, flow_id: &str, reason: &str, retryable: bool) {
        if let Ok(mut flows) = self.flows.lock()
            && let Some(flow) = flows.get_mut(flow_id)
        {
            flow.wire.status = AuthFlowStatus::Failed {
                reason: reason.chars().take(300).collect(),
                retryable,
            };
            flow.failed_at = Some(Instant::now());
        }
    }

    fn remove(&self, flow_id: &str) -> Option<ActiveFlow> {
        self.flows.lock().ok()?.remove(flow_id)
    }

    fn recent(&self, key: &str) -> Option<Value> {
        let mut recent = self.recent.lock().ok()?;
        recent.retain(|_, (at, _)| at.elapsed() < IDEMPOTENCY_WINDOW);
        recent.get(key).map(|(_, value)| value.clone())
    }

    fn remember(&self, key: &str, value: &Value) {
        if let Ok(mut recent) = self.recent.lock() {
            recent.insert(key.to_owned(), (Instant::now(), value.clone()));
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StartParams {
    plugin_id: String,
    method_id: String,
    host: String,
    login: Option<String>,
    idempotency_key: String,
}

/// `companion/forge/auth/start`.
///
/// # Errors
///
/// Returns `-32080` for an unavailable provider, invalid params for an
/// unknown or non-startable method, and the mapped plugin failure.
pub async fn start(context: &ForgeContext, raw: &Value) -> Result<Value, ForgeError> {
    let request: StartParams = params(raw)?;
    if !valid_idempotency_key(&request.idempotency_key) {
        return Err(ForgeError::invalid("invalid idempotencyKey"));
    }
    let recent_key = format!("start\0{}", request.idempotency_key);
    if let Some(result) = context.flows.recent(&recent_key) {
        return Ok(result);
    }
    let mut session = context.session(&request.plugin_id).await?;
    let method = match find_method(&mut session, &request.host, &request.method_id).await {
        Ok(method) => method,
        Err(error) => {
            session.shutdown().await;
            return Err(error);
        }
    };
    let result = match method.kind {
        AuthMethodKind::LinkExisting => {
            let result = link_existing(context, &mut session, &request, &method).await;
            session.shutdown().await;
            result?
        }
        AuthMethodKind::HostLogin => match context.flows.reserve(&request.plugin_id, &request.host)
        {
            Ok(Reserved::Running(flow)) => {
                session.shutdown().await;
                json!({"kind": "flow", "flow": flow})
            }
            Ok(Reserved::Slot(reservation)) => {
                // The slot is released once the flow is registered or the
                // start failed.
                let started = start_host_login(context, session, &request).await;
                drop(reservation);
                started?
            }
            Err(error) => {
                session.shutdown().await;
                return Err(error);
            }
        },
        AuthMethodKind::PasteToken | AuthMethodKind::Instructions => {
            session.shutdown().await;
            return Err(ForgeError::invalid(
                "this method is not started with auth/start",
            ));
        }
    };
    context.flows.remember(&recent_key, &result);
    Ok(result)
}

async fn find_method(
    session: &mut PluginSession,
    host: &str,
    method_id: &str,
) -> Result<AuthMethod, ForgeError> {
    let plugin_id = session.plugin_id().to_owned();
    let methods = declared_methods(session, &plugin_id, host).await?;
    let method = methods
        .methods
        .into_iter()
        .find(|method| method.method_id == method_id)
        .ok_or_else(|| ForgeError::invalid("unknown auth method"))?;
    if !method.available {
        return Err(ForgeError::invalid(
            method
                .unavailable_reason
                .unwrap_or_else(|| "this method is unavailable".into()),
        ));
    }
    Ok(method)
}

/// The provider's methods, only for the host it declares (`defaultHost`):
/// a client cannot point a plugin at another host.
async fn declared_methods(
    session: &mut PluginSession,
    plugin_id: &str,
    host: &str,
) -> Result<AuthMethodsResult, ForgeError> {
    let methods: AuthMethodsResult = session
        .call(methods::AUTH_METHODS, &AuthMethodsParams { host: None })
        .await
        .map_err(|error| ForgeError::from_plugin(plugin_id, None, error))?;
    if !methods.default_host.eq_ignore_ascii_case(host) {
        return Err(ForgeError::invalid(
            "the provider does not declare this host",
        ));
    }
    Ok(methods)
}

async fn link_existing(
    context: &ForgeContext,
    session: &mut PluginSession,
    request: &StartParams,
    method: &AuthMethod,
) -> Result<Value, ForgeError> {
    let login = request
        .login
        .clone()
        .filter(|login| !login.is_empty() && login.len() <= 128)
        .ok_or_else(|| ForgeError::invalid("login is required for linkExisting"))?;
    let result: AuthStartResult = session
        .call(
            methods::AUTH_START,
            &AuthStartParams {
                method_id: request.method_id.clone(),
                host: request.host.clone(),
                login: Some(login),
                token: None,
            },
        )
        .await
        .map_err(|error| ForgeError::from_plugin(&request.plugin_id, None, error))?;
    let AuthStartResult::Linked {
        login,
        scopes,
        credential_source,
    } = result
    else {
        return Err(ForgeError::internal(
            "the plugin started a flow for linkExisting",
        ));
    };
    let link = AccountLink::new(
        &request.plugin_id,
        &request.host,
        &login,
        Some(credential_source.unwrap_or_else(|| fallback_source(method.kind))),
        scopes,
    );
    context.accounts.save(&link)?;
    context.cache.invalidate_all();
    context.events.accounts().await;
    context.events.list().await;
    info!(plugin_id = %request.plugin_id, "forge account linked");
    Ok(json!({"kind": "connected", "account": context.accounts.wire(&link)}))
}

async fn start_host_login(
    context: &ForgeContext,
    mut session: PluginSession,
    request: &StartParams,
) -> Result<Value, ForgeError> {
    let started: Result<AuthStartResult, _> = session
        .call(
            methods::AUTH_START,
            &AuthStartParams {
                method_id: request.method_id.clone(),
                host: request.host.clone(),
                login: None,
                token: None,
            },
        )
        .await;
    let started = match started {
        Ok(started) => started,
        Err(error) => {
            session.shutdown().await;
            return Err(ForgeError::from_plugin(&request.plugin_id, None, error));
        }
    };
    let AuthStartResult::HostLogin {
        user_code,
        verification_uri,
        expires_in_seconds,
    } = started
    else {
        session.shutdown().await;
        return Err(ForgeError::internal(
            "the plugin did not start a host login",
        ));
    };
    if !https_on_host(&verification_uri, &request.host)
        || user_code.is_empty()
        || user_code.len() > 64
        || user_code.chars().any(char::is_control)
    {
        session.shutdown().await;
        return Err(ForgeError::ForgeRejected {
            reason: "The host login could not start. Run the forge CLI login on the companion host, then tap Check again.".into(),
        });
    }
    let lifetime = Duration::from_secs(expires_in_seconds).min(limits::AUTH_FLOW_LIFETIME);
    let flow_id = AuthFlowId::mint();
    let wire = AuthFlowWire {
        flow_id: flow_id.clone(),
        plugin_id: request.plugin_id.clone(),
        host: request.host.clone(),
        method_id: request.method_id.clone(),
        status: AuthFlowStatus::AwaitingUser {
            user_code,
            verification_uri,
        },
        expires_at: rfc3339(
            time::OffsetDateTime::now_utc()
                + time::Duration::try_from(lifetime).unwrap_or(time::Duration::ZERO),
        ),
    };
    let cancel = CancellationToken::new();
    if let Ok(mut flows) = context.flows.flows.lock() {
        // Starting again replaces an earlier failure of the same pair.
        flows.retain(|_, flow| {
            flow.failed_at.is_none()
                || flow.wire.plugin_id != request.plugin_id
                || !flow.wire.host.eq_ignore_ascii_case(&request.host)
        });
        flows.insert(
            flow_id.as_str().to_owned(),
            ActiveFlow {
                wire: wire.clone(),
                cancel: cancel.clone(),
                failed_at: None,
            },
        );
    }
    context.events.accounts().await;
    info!(plugin_id = %request.plugin_id, flow_id = %flow_id.as_str(), "forge host login started");
    let result = json!({"kind": "flow", "flow": wire});
    spawn_poller(context, session, wire, cancel, lifetime);
    Ok(result)
}

/// How a host login flow ended.
enum FlowEnd {
    Linked,
    Cancelled,
    Failed { reason: String, retryable: bool },
}

impl FlowEnd {
    fn failed(reason: &str) -> Self {
        Self::Failed {
            reason: reason.to_owned(),
            retryable: true,
        }
    }
}

/// The flow owner: polls every 5 seconds until the flow completes, fails,
/// expires or is cancelled, then closes the plugin process. A failure stays
/// visible with its reason until the user dismisses or restarts it.
fn spawn_poller(
    context: &ForgeContext,
    session: PluginSession,
    wire: AuthFlowWire,
    cancel: CancellationToken,
    lifetime: Duration,
) {
    let flows = context.flows.clone();
    let accounts = context.accounts.clone();
    let events = context.events.clone();
    let cache = context.cache.clone();
    tokio::spawn(async move {
        let mut session = session;
        let deadline = tokio::time::Instant::now() + lifetime;
        let end = loop {
            tokio::select! {
                () = cancel.cancelled() => break FlowEnd::Cancelled,
                () = tokio::time::sleep_until(deadline) => {
                    break FlowEnd::failed("The one-time code expired. Start the login again.");
                }
                () = tokio::time::sleep(limits::AUTH_POLL_INTERVAL) => {}
            }
            let polled: Result<AuthPollResult, _> =
                session.call(methods::AUTH_POLL, &json!({})).await;
            match polled {
                Ok(AuthPollResult::Pending) => {}
                Ok(AuthPollResult::Complete { login }) => {
                    break complete(&mut session, &wire, &login, &accounts).await;
                }
                Ok(AuthPollResult::Failed {
                    reason, retryable, ..
                }) => break FlowEnd::Failed { reason, retryable },
                Err(_) => break FlowEnd::failed("The forge plugin stopped during the login."),
            }
        };
        session.shutdown().await;
        let outcome = match end {
            FlowEnd::Linked => {
                flows.remove(wire.flow_id.as_str());
                cache.invalidate_all();
                "linked"
            }
            FlowEnd::Cancelled => {
                flows.remove(wire.flow_id.as_str());
                "cancelled"
            }
            FlowEnd::Failed { reason, retryable } => {
                flows.fail(wire.flow_id.as_str(), &reason, retryable);
                "failed"
            }
        };
        info!(plugin_id = %wire.plugin_id, flow_id = %wire.flow_id.as_str(), outcome, "forge host login ended");
        events.accounts().await;
        if outcome == "linked" {
            events.list().await;
        }
    });
}

/// Verifies the login a finished flow reports and stores its link.
async fn complete(
    session: &mut PluginSession,
    wire: &AuthFlowWire,
    login: &str,
    accounts: &super::accounts::Accounts,
) -> FlowEnd {
    let verified: Result<AuthVerifyResult, _> = session
        .call(
            methods::AUTH_VERIFY,
            &AuthVerifyParams {
                host: wire.host.clone(),
                login: login.to_owned(),
                purpose: AuthPurpose::Account,
            },
        )
        .await;
    let Ok(verified) = verified else {
        return FlowEnd::failed("The login finished but could not be verified.");
    };
    let link = AccountLink::new(
        &wire.plugin_id,
        &wire.host,
        &verified.login,
        Some(
            verified
                .credential_source
                .unwrap_or_else(|| fallback_source(AuthMethodKind::HostLogin)),
        ),
        verified.scopes,
    );
    if accounts.save(&link).is_err() {
        return FlowEnd::failed("The account link could not be stored.");
    }
    FlowEnd::Linked
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CancelParams {
    flow_id: String,
}

/// `companion/forge/auth/cancel`: ends a running flow (its plugin process
/// exits and kills the host tool) or dismisses a failed one.
///
/// # Errors
///
/// Returns invalid params for a malformed flow id.
pub async fn cancel(context: &ForgeContext, raw: &Value) -> Result<Value, ForgeError> {
    let request: CancelParams = params(raw)?;
    let flow_id =
        AuthFlowId::parse(&request.flow_id).ok_or_else(|| ForgeError::invalid("invalid flowId"))?;
    if let Some(flow) = context.flows.remove(flow_id.as_str()) {
        flow.cancel.cancel();
        context.events.accounts().await;
    }
    Ok(json!({}))
}

/// The params of `companion/forge/auth/submitToken`. `Debug` is not derived:
/// the token must never be printed.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SubmitTokenParams {
    plugin_id: String,
    host: String,
    token: Secret,
    idempotency_key: String,
}

/// `companion/forge/auth/submitToken`: the token goes once to the plugin's
/// `auth.start` and is dropped with this function's frame.
///
/// # Errors
///
/// Returns `-32081` with the plugin's reason (redacted of the token) for an
/// invalid token or missing scopes.
pub async fn submit_token(context: &ForgeContext, raw: &Value) -> Result<Value, ForgeError> {
    let request: SubmitTokenParams = params(raw)?;
    if !valid_idempotency_key(&request.idempotency_key) {
        return Err(ForgeError::invalid("invalid idempotencyKey"));
    }
    let recent_key = format!("token\0{}", request.idempotency_key);
    if let Some(result) = context.flows.recent(&recent_key) {
        return Ok(result);
    }
    let mut session = context.session(&request.plugin_id).await?;
    let outcome = paste(&mut session, &request).await;
    session.shutdown().await;
    let (login, scopes, source) = match outcome {
        Ok(linked) => linked,
        Err(error) => {
            info!(plugin_id = %request.plugin_id, kind = error.log_kind(), "pasted token rejected");
            return Err(redact(error, request.token.expose()));
        }
    };
    let link = AccountLink::new(
        &request.plugin_id,
        &request.host,
        &login,
        Some(source),
        scopes,
    );
    context.accounts.save(&link)?;
    context.cache.invalidate_all();
    context.events.accounts().await;
    context.events.list().await;
    info!(plugin_id = %request.plugin_id, "forge account linked with a pasted token");
    let result = json!({"account": context.accounts.wire(&link)});
    context.flows.remember(&recent_key, &result);
    Ok(result)
}

async fn paste(
    session: &mut PluginSession,
    request: &SubmitTokenParams,
) -> Result<
    (
        String,
        Option<Vec<String>>,
        forge_protocol::CredentialSource,
    ),
    ForgeError,
> {
    let plugin_id = request.plugin_id.clone();
    let methods = declared_methods(session, &plugin_id, &request.host).await?;
    let method = methods
        .methods
        .into_iter()
        .find(|method| method.kind == AuthMethodKind::PasteToken && method.available)
        .ok_or_else(|| ForgeError::invalid("this provider does not accept a pasted token"))?;
    let result: AuthStartResult = session
        .call(
            methods::AUTH_START,
            &AuthStartParams {
                method_id: method.method_id,
                host: request.host.clone(),
                login: None,
                token: Some(request.token.clone()),
            },
        )
        .await
        .map_err(|error| ForgeError::from_plugin(&plugin_id, None, error))?;
    match result {
        AuthStartResult::Linked {
            login,
            scopes,
            credential_source,
        } => Ok((
            login,
            scopes,
            credential_source.unwrap_or(forge_protocol::CredentialSource::SavedToken),
        )),
        AuthStartResult::HostLogin { .. } => Err(ForgeError::internal(
            "the plugin started a flow for a pasted token",
        )),
    }
}

/// Removes any echo of the token from a reason before it leaves.
fn redact(error: ForgeError, token: &str) -> ForgeError {
    let clean = |text: String| {
        if token.len() >= 4 && text.contains(token) {
            text.replace(token, "[redacted]")
        } else {
            text
        }
    };
    match error {
        ForgeError::AuthRequired { hint, .. } => ForgeError::AuthRequired {
            account: None,
            hint: clean(hint),
        },
        ForgeError::ForgeRejected { reason } => ForgeError::AuthRequired {
            account: None,
            hint: clean(reason),
        },
        // A request problem (such as an undeclared host) stays one.
        ForgeError::InvalidParams(reason) => ForgeError::InvalidParams(clean(reason)),
        other => other,
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DisconnectParams {
    account: String,
    mode: DisconnectMode,
    confirmation: Confirmation,
}

/// `companion/forge/account/disconnect`.
///
/// - `unlink` deletes only the companion's link; the host login stays.
/// - `forgetToken` (required for a saved token) has the plugin delete its
///   secret file, then deletes the link.
/// - `logoutHost` logs the login out on the host for every tool, so it runs
///   only with `destructive` confirmation and only when declared.
///
/// # Errors
///
/// Returns `-32089` for `logoutHost` without destructive confirmation (and
/// runs nothing), invalid params for an undeclared mode, and the mapped
/// plugin failure.
pub async fn disconnect(context: &ForgeContext, raw: &Value) -> Result<Value, ForgeError> {
    let request: DisconnectParams = params(raw)?;
    let (key, _) = ForgeAccountKey::parse(&request.account)
        .ok_or_else(|| ForgeError::invalid("invalid account"))?;
    if request.mode == DisconnectMode::LogoutHost
        && request.confirmation != Confirmation::Destructive
    {
        return Err(ForgeError::ConfirmationRequired {
            required: Confirmation::Destructive,
        });
    }
    let link = context.accounts.link(&key)?.ok_or(ForgeError::NotFound)?;
    let saved_token = link.credential_source == Some(forge_protocol::CredentialSource::SavedToken);
    if saved_token && request.mode != DisconnectMode::ForgetToken {
        return Err(ForgeError::invalid(
            "forgetToken is required for a saved token",
        ));
    }
    if request.mode != DisconnectMode::Unlink {
        let mut session = context.session(&link.plugin_id).await?;
        let result = plugin_disconnect(&mut session, &link, request.mode).await;
        session.shutdown().await;
        result?;
    }
    context.accounts.delete(&key)?;
    context.cache.invalidate_all();
    context.events.accounts().await;
    context.events.list().await;
    info!(plugin_id = %link.plugin_id, mode = ?request.mode, "forge account disconnected");
    Ok(json!({}))
}

async fn plugin_disconnect(
    session: &mut PluginSession,
    link: &AccountLink,
    mode: DisconnectMode,
) -> Result<(), ForgeError> {
    let methods: AuthMethodsResult = session
        .call(
            methods::AUTH_METHODS,
            &AuthMethodsParams {
                host: Some(link.host.clone()),
            },
        )
        .await
        .map_err(|error| ForgeError::from_plugin(&link.plugin_id, Some(&link.key), error))?;
    let declared = methods
        .methods
        .iter()
        .filter(|method| method.purpose == AuthPurpose::Account)
        .any(|method| method.disconnect_modes.contains(&mode));
    if !declared {
        return Err(ForgeError::invalid(
            "the provider does not offer this disconnect mode",
        ));
    }
    let result: Result<Value, _> = session
        .call(
            methods::AUTH_DISCONNECT,
            &AuthDisconnectParams {
                host: link.host.clone(),
                login: link.login.clone(),
                mode,
            },
        )
        .await;
    result.map(|_| ()).map_err(|error| {
        warn!(plugin_id = %link.plugin_id, "forge plugin disconnect failed");
        ForgeError::from_plugin(&link.plugin_id, Some(&link.key), error)
    })
}

#[cfg(test)]
mod tests;
