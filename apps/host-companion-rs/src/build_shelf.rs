use std::time::Duration;

use axum::{
    body::Body,
    extract::Request,
    http::{HeaderMap, Method, Response, StatusCode, header},
};
use futures_util::TryStreamExt;
use reqwest::{Client, Url, redirect::Policy};
use serde_json::json;

const REQUEST_HEADERS: &[&str] = &[
    "accept",
    "if-none-match",
    "range",
    "expo-current-update-id",
    "expo-platform",
    "expo-protocol-version",
    "expo-runtime-version",
];

pub const PUBLIC_BUILD_SHELF_PATHS: &[&str] = &[
    "/",
    "/api/builds",
    "/api/updates",
    "/api/updates/assets/*",
    "/latest.apk",
    "/CodeWide.apk",
    "/download/*",
];

#[derive(Clone)]
pub struct BuildShelfProxy {
    origin: Url,
    client: Client,
}

#[derive(Debug, thiserror::Error)]
pub enum BuildShelfError {
    #[error("Build shelf origin must be an http loopback URL")]
    UnsafeOrigin,
    #[error(transparent)]
    InvalidOrigin(#[from] url::ParseError),
    #[error(transparent)]
    Client(#[from] reqwest::Error),
}

impl BuildShelfProxy {
    /// Creates a proxy restricted to an unencrypted loopback origin. Public
    /// TLS termination stays outside the companion and arbitrary upstream
    /// proxying is intentionally impossible.
    ///
    /// # Errors
    ///
    /// Returns an error for a malformed, non-HTTP, or non-loopback origin.
    pub fn new(origin: &str) -> Result<Self, BuildShelfError> {
        let origin = Url::parse(origin)?;
        if origin.scheme() != "http" || !is_loopback_host(origin.host_str()) {
            return Err(BuildShelfError::UnsafeOrigin);
        }
        let client = Client::builder()
            .timeout(Duration::from_secs(15))
            .redirect(Policy::none())
            .build()?;
        Ok(Self { origin, client })
    }

    /// Proxies the small, explicit public build-shelf surface and preserves
    /// Expo conditional/range headers without forwarding credentials.
    pub async fn proxy(&self, request: Request) -> Response<Body> {
        if !matches!(*request.method(), Method::GET | Method::HEAD)
            || !is_public_path(request.uri().path())
        {
            return response(StatusCode::NOT_FOUND, "not_found");
        }
        let Ok(target) = self.origin.join(
            request
                .uri()
                .path_and_query()
                .map_or("/", axum::http::uri::PathAndQuery::as_str),
        ) else {
            return response(StatusCode::BAD_GATEWAY, "build_shelf_unavailable");
        };
        let mut headers = HeaderMap::new();
        for name in REQUEST_HEADERS {
            if let Some(value) = request.headers().get(*name) {
                headers.insert(*name, value.clone());
            }
        }
        let Ok(upstream) = self
            .client
            .request(request.method().clone(), target)
            .headers(headers)
            .send()
            .await
        else {
            return response(StatusCode::BAD_GATEWAY, "build_shelf_unavailable");
        };
        let status = upstream.status();
        let headers = upstream.headers().clone();
        let stream = upstream.bytes_stream().map_err(std::io::Error::other);
        let mut builder = Response::builder().status(status);
        if let Some(response_headers) = builder.headers_mut() {
            for (name, value) in &headers {
                if !is_hop_by_hop(name.as_str()) {
                    response_headers.append(name, value.clone());
                }
            }
        }
        builder
            .body(Body::from_stream(stream))
            .unwrap_or_else(|_| response(StatusCode::BAD_GATEWAY, "build_shelf_unavailable"))
    }
}

fn is_loopback_host(host: Option<&str>) -> bool {
    host.is_some_and(|host| {
        host.eq_ignore_ascii_case("localhost") || matches!(host, "127.0.0.1" | "::1")
    })
}

fn is_public_path(path: &str) -> bool {
    PUBLIC_BUILD_SHELF_PATHS.iter().any(|pattern| {
        pattern
            .strip_suffix('*')
            .map_or(path == *pattern, |prefix| path.starts_with(prefix))
    })
}

fn is_hop_by_hop(name: &str) -> bool {
    matches!(
        name,
        "connection"
            | "keep-alive"
            | "proxy-authenticate"
            | "proxy-authorization"
            | "te"
            | "trailer"
            | "transfer-encoding"
            | "upgrade"
    )
}

fn response(status: StatusCode, code: &'static str) -> Response<Body> {
    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({"error": code}).to_string()))
        .unwrap_or_else(|_| Response::new(Body::empty()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_only_loopback_http_origins() {
        assert!(BuildShelfProxy::new("http://127.0.0.1:4190").is_ok());
        assert!(BuildShelfProxy::new("http://localhost:4190").is_ok());
        assert!(BuildShelfProxy::new("https://127.0.0.1:4190").is_err());
        assert!(BuildShelfProxy::new("http://downloads.example.com").is_err());
    }

    #[test]
    fn exposes_only_the_existing_build_shelf_surface() {
        assert!(is_public_path("/api/updates"));
        assert!(is_public_path("/api/updates/assets/bundle.js"));
        assert!(is_public_path("/download/build.apk"));
        assert!(!is_public_path("/api/private"));
        assert!(!is_public_path("/v1/devices"));
    }
}
