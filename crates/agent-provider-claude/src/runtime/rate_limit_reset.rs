//! Consumes one Claude subscription reset grant.
//!
//! Claude's headless control protocol reports the `cedar_ember` inventory but
//! does not expose its interactive `/limit-reset` action. The provider keeps
//! OAuth refresh with Claude itself: its caller probes Claude immediately
//! before this module reads the resulting credential, makes one reset request,
//! and probes again afterwards. Credentials live only for the request and are
//! never returned or logged.

use std::{path::PathBuf, time::Duration};

use agent_core::model::{ProviderRateLimitResetConsumption, ProviderRateLimitResetOutcome};
use reqwest::{NoProxy, Proxy, StatusCode};
use serde::{Deserialize, Serialize};

const RESET_API_ORIGIN: &str = "https://api.anthropic.com";
const RESET_REQUEST_TIMEOUT: Duration = Duration::from_secs(25);
const MAX_GRANT_ID_LENGTH: usize = 40;
const MAX_REASON_LENGTH: usize = 64;
const MAX_CLEARED_WINDOWS: usize = 16;
const MAX_WINDOW_ID_LENGTH: usize = 64;

fn outcome(outcome: ProviderRateLimitResetOutcome) -> ProviderRateLimitResetConsumption {
    ProviderRateLimitResetConsumption {
        outcome,
        reason: None,
        resets_left: None,
        cleared: Vec::new(),
        weekly_resets_at: None,
    }
}

#[derive(Debug, thiserror::Error)]
pub enum ResetConsumeError {
    #[error("Claude reset grant id is invalid")]
    InvalidGrant,
    #[error("Claude OAuth credentials are unavailable")]
    CredentialsUnavailable,
    #[error("Claude OAuth organization is unavailable")]
    OrganizationUnavailable,
    #[error("Claude reset request could not be sent: {0}")]
    Request(#[source] reqwest::Error),
}

#[derive(Deserialize)]
struct CredentialDocument {
    #[serde(rename = "claudeAiOauth")]
    oauth: Option<OAuthCredential>,
}

#[derive(Deserialize)]
struct OAuthCredential {
    #[serde(rename = "accessToken")]
    access_token: String,
}

#[derive(Deserialize)]
struct ClaudeStateDocument {
    #[serde(rename = "oauthAccount")]
    oauth_account: Option<OAuthAccount>,
}

#[derive(Deserialize)]
struct OAuthAccount {
    #[serde(rename = "organizationUuid")]
    organization_uuid: String,
}

#[derive(Serialize)]
struct ResetRequest<'a> {
    program: &'static str,
    grant_id: &'a str,
    request_id: &'a str,
}

#[derive(Deserialize)]
#[serde(rename_all = "snake_case")]
enum UpstreamOutcome {
    Reset,
    AlreadyUsed,
    NotLimited,
    Cooldown,
    Ineligible,
    Unavailable,
}

#[derive(Deserialize)]
struct UpstreamResult {
    result: UpstreamOutcome,
    reason: Option<String>,
    resets_left: Option<u32>,
    #[serde(default)]
    cleared: Vec<String>,
    weekly_resets_at: Option<String>,
}

pub struct RateLimitResetClient {
    credentials_path: PathBuf,
    state_path: PathBuf,
    http: reqwest::Client,
    serial: tokio::sync::Mutex<()>,
}

impl RateLimitResetClient {
    /// Creates the reset client with the same HTTPS proxy the Claude child
    /// receives from user settings. `NO_PROXY` is applied to that proxy.
    ///
    /// # Errors
    /// Returns an invalid proxy or HTTP client configuration.
    pub fn new(
        credentials_path: PathBuf,
        state_path: PathBuf,
        https_proxy: Option<&str>,
        no_proxy: Option<&str>,
    ) -> Result<Self, reqwest::Error> {
        let mut builder = reqwest::Client::builder().timeout(RESET_REQUEST_TIMEOUT);
        if let Some(url) = https_proxy {
            let proxy = Proxy::https(url)?.no_proxy(no_proxy.and_then(NoProxy::from_string));
            builder = builder.proxy(proxy);
        }
        Ok(Self {
            credentials_path,
            state_path,
            http: builder.build()?,
            serial: tokio::sync::Mutex::new(()),
        })
    }

    /// Consumes exactly the selected grant. Concurrent calls are serialized;
    /// every upstream attempt receives its own correlation id.
    ///
    /// # Errors
    /// Returns an invalid grant, missing Claude OAuth state, or a transport or
    /// response-decoding failure. It never includes a credential or body.
    pub async fn consume(
        &self,
        grant_id: &str,
        request_id: &str,
    ) -> Result<ProviderRateLimitResetConsumption, ResetConsumeError> {
        if !valid_grant_id(grant_id) {
            return Err(ResetConsumeError::InvalidGrant);
        }
        let _serial = self.serial.lock().await;
        let access_token = self.access_token().await?;
        let organization = self.organization().await?;
        let response = self
            .http
            .post(format!(
                "{RESET_API_ORIGIN}/api/organizations/{organization}/reset_rate_limits"
            ))
            .bearer_auth(access_token)
            .header("anthropic-version", "2023-06-01")
            .header("anthropic-beta", "oauth-2025-04-20")
            .json(&ResetRequest {
                program: "cedar_ember",
                grant_id,
                request_id,
            })
            .send()
            .await
            .map_err(ResetConsumeError::Request)?;
        let status = response.status();
        if status == StatusCode::TOO_MANY_REQUESTS {
            return Ok(outcome(ProviderRateLimitResetOutcome::RateLimited));
        }
        if matches!(status, StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN) {
            return Ok(outcome(ProviderRateLimitResetOutcome::AuthError));
        }
        if !status.is_success() {
            return Ok(outcome(ProviderRateLimitResetOutcome::Error));
        }
        let upstream = response
            .json::<UpstreamResult>()
            .await
            .map_err(ResetConsumeError::Request)?;
        Ok(validated_result(upstream))
    }

    async fn access_token(&self) -> Result<String, ResetConsumeError> {
        if let Ok(token) = std::env::var("CLAUDE_CODE_OAUTH_TOKEN")
            && !token.is_empty()
        {
            return Ok(token);
        }
        let bytes = tokio::fs::read(&self.credentials_path)
            .await
            .map_err(|_| ResetConsumeError::CredentialsUnavailable)?;
        let document: CredentialDocument = serde_json::from_slice(&bytes)
            .map_err(|_| ResetConsumeError::CredentialsUnavailable)?;
        document
            .oauth
            .map(|oauth| oauth.access_token)
            .filter(|token| !token.is_empty())
            .ok_or(ResetConsumeError::CredentialsUnavailable)
    }

    async fn organization(&self) -> Result<String, ResetConsumeError> {
        let bytes = tokio::fs::read(&self.state_path)
            .await
            .map_err(|_| ResetConsumeError::OrganizationUnavailable)?;
        let document: ClaudeStateDocument = serde_json::from_slice(&bytes)
            .map_err(|_| ResetConsumeError::OrganizationUnavailable)?;
        document
            .oauth_account
            .map(|account| account.organization_uuid)
            .filter(|id| valid_organization_id(id))
            .ok_or(ResetConsumeError::OrganizationUnavailable)
    }
}

fn valid_grant_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= MAX_GRANT_ID_LENGTH
        && id.bytes().all(|byte| {
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || matches!(byte, b'_' | b'-')
        })
}

fn valid_organization_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
}

fn bounded(value: Option<String>, max: usize) -> Option<String> {
    value.filter(|text| text.len() <= max)
}

fn valid_window_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= MAX_WINDOW_ID_LENGTH
        && id
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'_')
}

fn validated_result(upstream: UpstreamResult) -> ProviderRateLimitResetConsumption {
    let outcome = match upstream.result {
        UpstreamOutcome::Reset => ProviderRateLimitResetOutcome::Reset,
        UpstreamOutcome::AlreadyUsed => ProviderRateLimitResetOutcome::AlreadyUsed,
        UpstreamOutcome::NotLimited => ProviderRateLimitResetOutcome::NotLimited,
        UpstreamOutcome::Cooldown => ProviderRateLimitResetOutcome::Cooldown,
        UpstreamOutcome::Ineligible => ProviderRateLimitResetOutcome::Ineligible,
        UpstreamOutcome::Unavailable => ProviderRateLimitResetOutcome::Unavailable,
    };
    ProviderRateLimitResetConsumption {
        outcome,
        reason: bounded(upstream.reason, MAX_REASON_LENGTH),
        resets_left: upstream.resets_left,
        cleared: upstream
            .cleared
            .into_iter()
            .take(MAX_CLEARED_WINDOWS)
            .filter(|id| valid_window_id(id))
            .collect(),
        weekly_resets_at: bounded(upstream.weekly_resets_at, 64),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_grant_and_organization_ids() {
        assert!(valid_grant_id("weekly_1-x"));
        assert!(!valid_grant_id("Weekly"));
        assert!(valid_organization_id(
            "b2d6b383-6ef9-43e7-9eaa-8c81e2412843"
        ));
        assert!(!valid_organization_id("organization/path"));
    }

    #[test]
    fn maps_and_bounds_the_upstream_result() {
        let result = validated_result(UpstreamResult {
            result: UpstreamOutcome::Reset,
            reason: Some("reset_unconfirmed".into()),
            resets_left: Some(1),
            cleared: vec!["five_hour".into(), "Bad window".into()],
            weekly_resets_at: Some("2026-10-23T12:00:00Z".into()),
        });
        assert_eq!(result.outcome, ProviderRateLimitResetOutcome::Reset);
        assert_eq!(result.cleared, ["five_hour"]);
        assert_eq!(result.resets_left, Some(1));
    }
}
