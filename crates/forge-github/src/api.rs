//! GitHub REST and GraphQL over HTTPS.
//!
//! The token is sent only in the `Authorization` header; it never appears in
//! a URL, an error or a log. HTTP failures map to typed plugin errors whose
//! messages carry no credentials.

use std::time::Duration;

use forge_protocol::{PluginError, Secret, code};
use reqwest::{Method, StatusCode, header::HeaderMap};
use serde_json::{Value, json};

const REQUEST_TIMEOUT: Duration = Duration::from_secs(25);
const MAX_ERROR_MESSAGE_CHARS: usize = 200;

/// The API roots of one GitHub host.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Endpoints {
    pub rest: String,
    pub graphql: String,
}

impl Endpoints {
    /// `github.com` uses `api.github.com`; an Enterprise Server host serves
    /// its API under `/api`.
    #[must_use]
    pub fn for_host(host: &str) -> Self {
        if host.eq_ignore_ascii_case("github.com") {
            Self {
                rest: "https://api.github.com".into(),
                graphql: "https://api.github.com/graphql".into(),
            }
        } else {
            Self {
                rest: format!("https://{host}/api/v3"),
                graphql: format!("https://{host}/api/graphql"),
            }
        }
    }
}

/// One authenticated API session.
#[derive(Clone)]
pub struct Api {
    client: reqwest::Client,
    endpoints: Endpoints,
    token: Secret,
}

/// A REST answer with the headers some callers inspect.
pub struct Reply {
    pub body: Value,
    pub headers: HeaderMap,
}

impl Api {
    /// # Errors
    ///
    /// Returns an internal error when the HTTP client cannot be built.
    pub fn new(endpoints: Endpoints, token: Secret) -> Result<Self, PluginError> {
        let client = reqwest::Client::builder()
            .user_agent(concat!("codewide-forge-github/", env!("CARGO_PKG_VERSION")))
            .timeout(REQUEST_TIMEOUT)
            .build()
            .map_err(|_| PluginError::internal("the HTTP client could not be built"))?;
        Ok(Self {
            client,
            endpoints,
            token,
        })
    }

    /// `GET` a REST path with query parameters.
    ///
    /// # Errors
    ///
    /// Returns the mapped GitHub failure.
    pub async fn get(&self, path: &str, query: &[(&str, String)]) -> Result<Value, PluginError> {
        Ok(self.request(Method::GET, path, query, None).await?.body)
    }

    /// `GET` returning headers too (for `X-OAuth-Scopes`).
    ///
    /// # Errors
    ///
    /// Returns the mapped GitHub failure.
    pub async fn get_reply(&self, path: &str) -> Result<Reply, PluginError> {
        self.request(Method::GET, path, &[], None).await
    }

    /// A write with a JSON body.
    ///
    /// # Errors
    ///
    /// Returns the mapped GitHub failure; callers that need to tell a stale
    /// head from another refusal use [`Api::send_raw`].
    pub async fn send(
        &self,
        method: Method,
        path: &str,
        body: Value,
    ) -> Result<Value, PluginError> {
        Ok(self.request(method, path, &[], Some(body)).await?.body)
    }

    /// A write whose non-success status the caller interprets itself.
    ///
    /// # Errors
    ///
    /// Returns an error only for transport failures.
    pub async fn send_raw(
        &self,
        method: Method,
        path: &str,
        body: Value,
    ) -> Result<(StatusCode, Value, HeaderMap), PluginError> {
        let url = format!("{}{path}", self.endpoints.rest);
        let response = self
            .authorized(self.client.request(method, url))
            .json(&body)
            .send()
            .await
            .map_err(|_| unreachable_error())?;
        let status = response.status();
        let headers = response.headers().clone();
        let body = response.json::<Value>().await.unwrap_or(Value::Null);
        Ok((status, body, headers))
    }

    /// One GraphQL operation; GraphQL `errors` map to typed failures.
    ///
    /// # Errors
    ///
    /// Returns the mapped GitHub failure.
    pub async fn graphql(&self, query: &str, variables: Value) -> Result<Value, PluginError> {
        let response = self
            .authorized(self.client.post(&self.endpoints.graphql))
            .json(&json!({ "query": query, "variables": variables }))
            .send()
            .await
            .map_err(|_| unreachable_error())?;
        let status = response.status();
        let headers = response.headers().clone();
        let body = response.json::<Value>().await.unwrap_or(Value::Null);
        if !status.is_success() {
            return Err(status_error(status, &headers, &body));
        }
        if let Some(error) = body
            .get("errors")
            .and_then(Value::as_array)
            .and_then(|errors| errors.first())
        {
            return Err(graphql_error(error));
        }
        body.get("data")
            .cloned()
            .ok_or_else(|| PluginError::internal("GitHub returned no GraphQL data"))
    }

    async fn request(
        &self,
        method: Method,
        path: &str,
        query: &[(&str, String)],
        body: Option<Value>,
    ) -> Result<Reply, PluginError> {
        let url = format!("{}{path}", self.endpoints.rest);
        let mut request = self
            .authorized(self.client.request(method, url))
            .query(query);
        if let Some(body) = body {
            request = request.json(&body);
        }
        let response = request.send().await.map_err(|_| unreachable_error())?;
        let status = response.status();
        let headers = response.headers().clone();
        let body = if status == StatusCode::NO_CONTENT {
            Value::Null
        } else {
            response.json::<Value>().await.unwrap_or(Value::Null)
        };
        if status.is_success() {
            Ok(Reply { body, headers })
        } else {
            Err(status_error(status, &headers, &body))
        }
    }

    /// Adds this session's token to a media request for the account's own
    /// web origin; [`crate::media`] decides which hops may carry it.
    pub fn authorize_media(&self, request: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
        request.bearer_auth(self.token.expose())
    }

    fn authorized(&self, request: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
        request
            .bearer_auth(self.token.expose())
            .header("Accept", "application/vnd.github+json")
            .header("X-GitHub-Api-Version", "2022-11-28")
    }
}

fn unreachable_error() -> PluginError {
    PluginError::internal("GitHub could not be reached")
}

/// Maps a non-success REST or GraphQL HTTP status.
#[must_use]
pub fn status_error(status: StatusCode, headers: &HeaderMap, body: &Value) -> PluginError {
    let message = api_message(body);
    match status {
        StatusCode::UNAUTHORIZED => {
            PluginError::auth_required("GitHub rejected the credentials. Reconnect GitHub.")
        }
        StatusCode::FORBIDDEN | StatusCode::TOO_MANY_REQUESTS if rate_limited(status, headers) => {
            PluginError::new(code::RATE_LIMITED, "GitHub rate limit reached")
                .with_data(json!({ "retryAfterSeconds": retry_after(headers) }))
        }
        StatusCode::NOT_FOUND => PluginError::new(code::NOT_FOUND, "Not found on GitHub"),
        status if status.is_server_error() => PluginError::internal("GitHub is unavailable"),
        _ => PluginError::new(
            code::FORGE_REJECTED,
            message.unwrap_or_else(|| format!("GitHub refused the request ({})", status.as_u16())),
        ),
    }
}

fn rate_limited(status: StatusCode, headers: &HeaderMap) -> bool {
    status == StatusCode::TOO_MANY_REQUESTS
        || headers
            .get("x-ratelimit-remaining")
            .and_then(|value| value.to_str().ok())
            == Some("0")
        || headers.contains_key("retry-after")
}

fn retry_after(headers: &HeaderMap) -> Option<u64> {
    headers
        .get("retry-after")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.trim().parse().ok())
}

fn api_message(body: &Value) -> Option<String> {
    let message = body.get("message").and_then(Value::as_str)?;
    Some(message.chars().take(MAX_ERROR_MESSAGE_CHARS).collect())
}

fn graphql_error(error: &Value) -> PluginError {
    let message = error.get("message").and_then(Value::as_str).map_or_else(
        || "GitHub refused the request".to_owned(),
        |message| message.chars().take(MAX_ERROR_MESSAGE_CHARS).collect(),
    );
    match error.get("type").and_then(Value::as_str) {
        Some("NOT_FOUND") => PluginError::new(code::NOT_FOUND, "Not found on GitHub"),
        Some("RATE_LIMITED") => PluginError::new(code::RATE_LIMITED, "GitHub rate limit reached")
            .with_data(json!({ "retryAfterSeconds": null })),
        _ => PluginError::new(code::FORGE_REJECTED, message),
    }
}

/// The scopes of a classic token from `X-OAuth-Scopes`; `None` when GitHub
/// sends no such header (fine-grained tokens and GitHub App tokens).
#[must_use]
pub fn oauth_scopes(headers: &HeaderMap) -> Option<Vec<String>> {
    let value = headers.get("x-oauth-scopes")?.to_str().ok()?;
    Some(
        value
            .split(',')
            .map(str::trim)
            .filter(|scope| !scope.is_empty())
            .map(str::to_owned)
            .collect(),
    )
}
