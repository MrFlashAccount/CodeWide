//! The provider and account directory: `companion/forge/accounts/read` and
//! `companion/forge/provider/setEnabled`.
//!
//! Account states are derived here from `auth.verify`; a provider that
//! cannot start degrades only its own card and accounts.

use std::collections::HashSet;

use forge_protocol::{
    AuthMethodKind, AuthMethodsParams, AuthMethodsResult, AuthPurpose, AuthVerifyParams,
    AuthVerifyResult, methods,
};
use serde::Deserialize;
use serde_json::{Value, json};

use super::{
    ForgeContext,
    accounts::AccountLink,
    errors::ForgeError,
    params,
    plugin_client::PluginSession,
    providers::ProviderEntry,
    wire::{
        AccountCondition, ChecksCredentialState, ChecksCredentialWire, ForgeProviderWire,
        ProviderIconWire, sanitize_methods,
    },
};

/// `companion/forge/accounts/read`.
///
/// # Errors
///
/// Returns a storage failure; plugin failures degrade single providers.
pub async fn read(context: &ForgeContext) -> Result<Value, ForgeError> {
    let mut providers = Vec::new();
    for entry in context.providers.entries()? {
        providers.push(provider_wire(context, &entry).await?);
    }
    let accounts: Vec<_> = context
        .accounts
        .links()?
        .iter()
        .map(|link| context.accounts.wire(link))
        .collect();
    Ok(json!({
        "providers": providers,
        "accounts": accounts,
        "flows": context.flows.active(),
    }))
}

/// One provider card. Spawns an enabled provider to read its methods and to
/// re-verify its accounts whose state is not fresh.
///
/// # Errors
///
/// Returns a storage failure.
pub async fn provider_wire(
    context: &ForgeContext,
    entry: &ProviderEntry,
) -> Result<ForgeProviderWire, ForgeError> {
    let offline = || ForgeProviderWire {
        plugin_id: entry.plugin_id.clone(),
        forge_name: entry.forge_name.clone(),
        icon: ProviderIconWire::key_only(&entry.icon_key),
        built_in: entry.built_in,
        enabled: entry.enabled,
        capabilities: Vec::new(),
        auth_methods: Vec::new(),
        default_host: entry.default_host.clone(),
        checks_credential: ChecksCredentialWire {
            state: ChecksCredentialState::NotApplicable,
        },
    };
    if !entry.enabled || entry.spec.is_none() {
        return Ok(offline());
    }
    let links = context.accounts.links_of(&entry.plugin_id)?;
    let mut session = match context.session(&entry.plugin_id).await {
        Ok(session) => session,
        Err(error) => {
            for link in &links {
                context.accounts.observe_error(&link.key, &error);
            }
            return Ok(offline());
        }
    };
    let wire = describe(context, &mut session, entry, &links).await;
    session.shutdown().await;
    Ok(wire.unwrap_or_else(|_| offline()))
}

async fn describe(
    context: &ForgeContext,
    session: &mut PluginSession,
    entry: &ProviderEntry,
    links: &[AccountLink],
) -> Result<ForgeProviderWire, ForgeError> {
    let methods_result: AuthMethodsResult = session
        .call(methods::AUTH_METHODS, &AuthMethodsParams { host: None })
        .await
        .map_err(|error| ForgeError::from_plugin(&entry.plugin_id, None, error))?;
    let host = methods_result.default_host.clone();
    let linked: HashSet<String> = links
        .iter()
        .filter(|link| link.host.eq_ignore_ascii_case(&host))
        .map(|link| link.login.to_ascii_lowercase())
        .collect();
    let mut auth_methods = sanitize_methods(methods_result.methods, &host);
    for method in &mut auth_methods {
        if method.kind == AuthMethodKind::LinkExisting {
            method
                .existing_logins
                .retain(|login| !linked.contains(&login.to_ascii_lowercase()));
            if method.existing_logins.is_empty() && method.available {
                method.available = false;
                method.unavailable_reason =
                    Some("Every login on the companion host is already linked.".into());
            }
        }
    }
    for link in links {
        if context.accounts.fresh_condition(&link.key).is_none() {
            verify_account(context, session, link).await;
        }
    }
    let has_checks_method = auth_methods
        .iter()
        .any(|method| method.purpose == AuthPurpose::Checks);
    let checks_credential = if has_checks_method {
        let mut connected = false;
        for link in links {
            if verify_purpose(session, link, AuthPurpose::Checks)
                .await
                .is_ok()
            {
                connected = true;
                break;
            }
        }
        if connected {
            ChecksCredentialState::Connected
        } else {
            ChecksCredentialState::Missing
        }
    } else {
        ChecksCredentialState::NotApplicable
    };
    let info = session.info();
    Ok(ForgeProviderWire {
        plugin_id: entry.plugin_id.clone(),
        forge_name: if info.forge_name.is_empty() {
            entry.forge_name.clone()
        } else {
            info.forge_name.chars().take(64).collect()
        },
        icon: ProviderIconWire::sanitize(&info.icon),
        built_in: entry.built_in,
        enabled: entry.enabled,
        capabilities: info.capabilities.clone(),
        auth_methods,
        default_host: Some(host),
        checks_credential: ChecksCredentialWire {
            state: checks_credential,
        },
    })
}

async fn verify_purpose(
    session: &mut PluginSession,
    link: &AccountLink,
    purpose: AuthPurpose,
) -> Result<AuthVerifyResult, ForgeError> {
    session
        .call(
            methods::AUTH_VERIFY,
            &AuthVerifyParams {
                host: link.host.clone(),
                login: link.login.clone(),
                purpose,
            },
        )
        .await
        .map_err(|error| ForgeError::from_plugin(&link.plugin_id, Some(&link.key), error))
}

/// Re-verifies one account and records its derived state; a changed
/// credential source or scope set refreshes the link.
pub async fn verify_account(
    context: &ForgeContext,
    session: &mut PluginSession,
    link: &AccountLink,
) {
    match verify_purpose(session, link, AuthPurpose::Account).await {
        Ok(verified) => {
            let source = verified.credential_source.or(link.credential_source);
            if source != link.credential_source || verified.scopes != link.scopes {
                let mut refreshed = link.clone();
                refreshed.credential_source = source;
                refreshed.scopes = verified.scopes;
                if context.accounts.save(&refreshed).is_err() {
                    tracing::warn!(plugin_id = %link.plugin_id, "forge account link refresh failed");
                }
            }
            context
                .accounts
                .observe(&link.key, AccountCondition::Connected);
        }
        Err(error) => match error {
            ForgeError::AuthRequired { .. }
            | ForgeError::ForgeRejected { .. }
            | ForgeError::ProviderUnavailable { .. } => {
                context.accounts.observe_error(&link.key, &error);
            }
            other => context.accounts.observe(
                &link.key,
                AccountCondition::Error {
                    reason: match other {
                        ForgeError::Internal(reason) | ForgeError::InvalidParams(reason) => reason,
                        _ => "The account could not be checked".into(),
                    },
                },
            ),
        },
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SetEnabledParams {
    plugin_id: String,
    enabled: bool,
}

/// `companion/forge/provider/setEnabled`: the rollback switch. Accounts and
/// plugin secrets are kept.
///
/// # Errors
///
/// Returns `-32080` for an unknown provider or a storage failure.
pub async fn set_enabled(context: &ForgeContext, raw: &Value) -> Result<Value, ForgeError> {
    let request: SetEnabledParams = params(raw)?;
    let entry = context
        .providers
        .set_enabled(&request.plugin_id, request.enabled)?;
    context.cache.invalidate_all();
    context.events.accounts().await;
    context.events.list().await;
    tracing::info!(plugin_id = %request.plugin_id, enabled = request.enabled, "forge provider toggled");
    Ok(json!({"provider": provider_wire(context, &entry).await?}))
}
