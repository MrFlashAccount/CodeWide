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
const JSON_MEDIA_TYPE: &str = "application/vnd.github+json";
/// The contents API media type that answers a file's bytes as they are.
const RAW_MEDIA_TYPE: &str = "application/vnd.github.raw+json";
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

/// A raw contents answer, read only up to the caller's bound.
#[derive(Debug, PartialEq, Eq)]
pub enum RawReply {
    /// The complete body, within the bound.
    Body(Vec<u8>),
    /// GitHub answered 404.
    NotFound,
    /// GitHub answered JSON instead of raw bytes (a directory listing).
    NotRaw,
    /// The body exceeds the bound; `bytes` when GitHub announced its length.
    TooLarge { bytes: Option<u64> },
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

    /// `GET` a REST path in the raw media type, reading at most `max_bytes`
    /// of the body: a longer body is `TooLarge` and the rest is never read.
    ///
    /// # Errors
    ///
    /// Returns the mapped GitHub failure for any status but 404.
    pub async fn get_raw(
        &self,
        path: &str,
        query: &[(&str, String)],
        max_bytes: usize,
    ) -> Result<RawReply, PluginError> {
        let url = format!("{}{path}", self.endpoints.rest);
        let mut response = self
            .authorized_as(self.client.get(url), RAW_MEDIA_TYPE)
            .query(query)
            .send()
            .await
            .map_err(|_| unreachable_error())?;
        let status = response.status();
        if status == StatusCode::NOT_FOUND {
            return Ok(RawReply::NotFound);
        }
        if !status.is_success() {
            let headers = response.headers().clone();
            let body = response.json::<Value>().await.unwrap_or(Value::Null);
            return Err(status_error(status, &headers, &body));
        }
        let json = response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .is_some_and(|value| value.starts_with("application/json"));
        if json {
            return Ok(RawReply::NotRaw);
        }
        if let Some(length) = response
            .content_length()
            .filter(|length| usize::try_from(*length).map_or(true, |length| length > max_bytes))
        {
            return Ok(RawReply::TooLarge {
                bytes: Some(length),
            });
        }
        let mut bytes = Vec::new();
        while let Some(chunk) = response.chunk().await.map_err(|_| unreachable_error())? {
            if bytes.len().saturating_add(chunk.len()) > max_bytes {
                return Ok(RawReply::TooLarge { bytes: None });
            }
            bytes.extend_from_slice(&chunk);
        }
        Ok(RawReply::Body(bytes))
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

    /// Uploads one asset to the GitHub repository using the first-party user-attachments endpoint.
    ///
    /// # Errors
    /// Returns a permission, size or service error without exposing the token or response body.
    pub async fn upload_comment_asset(
        &self,
        repository_id: u64,
        params: forge_protocol::CommentAttachmentParams,
    ) -> Result<forge_protocol::CommentAttachmentResult, PluginError> {
        self.upload_asset_to(
            "https://uploads.github.com/user-attachments/assets",
            repository_id,
            params,
        )
        .await
    }

    async fn upload_asset_to(
        &self,
        endpoint: &str,
        repository_id: u64,
        params: forge_protocol::CommentAttachmentParams,
    ) -> Result<forge_protocol::CommentAttachmentResult, PluginError> {
        use base64::{Engine as _, engine::general_purpose::STANDARD};
        let bytes = STANDARD
            .decode(params.bytes_base64)
            .map_err(|_| PluginError::invalid_params("Invalid attachment bytes."))?;
        if bytes.is_empty() || bytes.len() > forge_protocol::MAX_MEDIA_BYTES {
            return Err(PluginError::invalid_params(
                "Attachment exceeds the 10 MiB limit or is empty.",
            ));
        }
        // One fixed origin owns both the credential and these private file bytes.
        let client = reqwest::Client::builder()
            .user_agent(concat!("codewide-forge-github/", env!("CARGO_PKG_VERSION")))
            .redirect(reqwest::redirect::Policy::none())
            .timeout(REQUEST_TIMEOUT)
            .build()
            .map_err(|_| unreachable_error())?;
        let request = client
            .post(endpoint)
            .query(&[
                ("repository_id", repository_id.to_string()),
                ("name", params.name),
                ("content_type", params.content_type),
            ])
            .header("Content-Type", "application/octet-stream")
            .body(bytes);
        let response = self
            .authorized(request)
            .send()
            .await
            .map_err(|_| unreachable_error())?;
        if !response.status().is_success() {
            return Err(PluginError::new(
                forge_protocol::code::FORGE_REJECTED,
                format!(
                    "GitHub refused the attachment (HTTP {}). Check repository write access, file type and credential support.",
                    response.status().as_u16()
                ),
            ));
        }
        response
            .json()
            .await
            .map_err(|_| PluginError::internal("GitHub did not return an attachment URL."))
    }

    fn authorized(&self, request: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
        self.authorized_as(request, JSON_MEDIA_TYPE)
    }

    fn authorized_as(
        &self,
        request: reqwest::RequestBuilder,
        media_type: &str,
    ) -> reqwest::RequestBuilder {
        request
            .bearer_auth(self.token.expose())
            .header("Accept", media_type)
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

#[cfg(test)]
mod comment_assets {
    use super::*;
    use axum::{Json, Router, body::Bytes, extract::Query, http::HeaderMap, routing::post};
    use std::collections::HashMap;

    #[tokio::test]
    async fn upload_sends_binary_to_the_repository_and_returns_the_shared_asset_url()
    -> Result<(), Box<dyn std::error::Error>> {
        async fn receive(
            query: Query<HashMap<String, String>>,
            headers: HeaderMap,
            body: Bytes,
        ) -> Json<Value> {
            assert_eq!(query["repository_id"], "42");
            assert_eq!(query["content_type"], "image/png");
            assert_eq!(query["name"], "screen #1.png");
            assert_eq!(headers["content-type"], "application/octet-stream");
            assert_eq!(headers["authorization"], "Bearer fixture");
            assert_eq!(&body[..], b"png test");
            Json(json!({"url": "https://github.com/user-attachments/assets/example"}))
        }
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await?;
        let endpoint = format!("http://{}/user-attachments/assets", listener.local_addr()?);
        let app = Router::new().route("/user-attachments/assets", post(receive));
        let server = tokio::spawn(async move { axum::serve(listener, app).await });
        let api = Api::new(
            Endpoints::for_host("github.com"),
            Secret::new("fixture".into()),
        )?;
        let params = serde_json::from_value(json!({
            "ref": {"host":"github.com","repository":"org/repo","number":"1"},
            "account":{"host":"github.com","login":"test"},
            "name":"screen #1.png","contentType":"image/png","bytesBase64":"cG5nIHRlc3Q="
        }))?;
        let result = api.upload_asset_to(&endpoint, 42, params).await?;
        assert_eq!(
            result.url,
            "https://github.com/user-attachments/assets/example"
        );
        server.abort();
        Ok(())
    }
}
