//! `forge.media.read`: one forge-hosted media file (an image embedded in a
//! comment, an avatar) fetched for an account.
//!
//! Only the origins of [`MediaOrigins`] for the account's host are fetched.
//! The account's token goes only to its own web origin (`https://github.com`
//! for `github.com`); GitHub's image hosts get no token, because their URLs
//! are public or carry their own signature. Redirects are followed by hand,
//! at most [`MAX_REDIRECTS`] times, and a hop to any other origin is refused
//! before it is requested. Bodies above
//! [`forge_protocol::MAX_MEDIA_BYTES`] are refused with `tooLarge`.

use std::{sync::Arc, time::Duration};

use base64::{Engine as _, engine::general_purpose::STANDARD};
use forge_protocol::{MAX_MEDIA_BYTES, MediaReadResult, PluginError, code};
use reqwest::{StatusCode, header, redirect::Policy};
use serde_json::json;
use url::Url;

use crate::api::{Api, status_error};

/// Hops a media read follows.
pub const MAX_REDIRECTS: usize = 5;
const MEDIA_TIMEOUT: Duration = Duration::from_secs(20);

/// GitHub's image hosts for `github.com` accounts, declared in
/// `initialize` as the plugin's media hosts.
pub const GITHUB_MEDIA_HOSTS: [&str; 6] = [
    "user-images.githubusercontent.com",
    "private-user-images.githubusercontent.com",
    "avatars.githubusercontent.com",
    "camo.githubusercontent.com",
    "raw.githubusercontent.com",
    "objects.githubusercontent.com",
];

/// The origins (`scheme://host[:port]`) media of one account host may come
/// from, split by whether the account's token is sent there.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MediaOrigins {
    pub credentialed: Vec<String>,
    pub anonymous: Vec<String>,
}

/// Maps a canonical account host to its media origins; tests point it at a
/// local server.
pub type MediaResolver = Arc<dyn Fn(&str) -> MediaOrigins + Send + Sync>;

impl MediaOrigins {
    /// `github.com` media live on `github.com` (`/user-attachments`) and the
    /// `githubusercontent.com` image hosts; an Enterprise Server host serves
    /// them on itself and its `media.`, `avatars.` and `raw.` subdomains.
    #[must_use]
    pub fn for_host(host: &str) -> Self {
        if host.eq_ignore_ascii_case(crate::auth::DEFAULT_HOST) {
            Self {
                credentialed: vec!["https://github.com".into()],
                anonymous: GITHUB_MEDIA_HOSTS
                    .iter()
                    .map(|media| format!("https://{media}"))
                    .collect(),
            }
        } else {
            Self {
                credentialed: vec![format!("https://{host}")],
                anonymous: ["media", "avatars", "raw"]
                    .iter()
                    .map(|sub| format!("https://{sub}.{host}"))
                    .collect(),
            }
        }
    }

    /// `Some(true)` for a credentialed origin, `Some(false)` for an
    /// anonymous one, `None` for anything else (including URLs with
    /// credentials).
    #[must_use]
    pub fn classify(&self, url: &Url) -> Option<bool> {
        if !url.username().is_empty() || url.password().is_some() {
            return None;
        }
        let origin = url.origin().ascii_serialization();
        if self.credentialed.contains(&origin) {
            Some(true)
        } else if self.anonymous.contains(&origin) {
            Some(false)
        } else {
            None
        }
    }
}

fn refused() -> PluginError {
    PluginError::invalid_params("the URL is not a media URL of this account's forge")
}

fn too_large() -> PluginError {
    PluginError::new(code::FORGE_REJECTED, "The media is larger than 10 MiB")
        .with_data(json!({ "kind": "tooLarge" }))
}

/// Parses and classifies a media URL before any credential is resolved.
///
/// # Errors
///
/// Returns invalid params for a malformed or foreign URL.
pub fn admit(origins: &MediaOrigins, raw: &str) -> Result<(Url, bool), PluginError> {
    let url = Url::parse(raw).map_err(|_| refused())?;
    let credentialed = origins.classify(&url).ok_or_else(refused)?;
    Ok((url, credentialed))
}

/// Fetches one admitted URL. `api` carries the account's token and is
/// required only when a hop is credentialed.
///
/// # Errors
///
/// Returns invalid params for a redirect outside the allowed origins,
/// `tooLarge` above 10 MiB, or the mapped HTTP failure.
pub async fn read(
    origins: &MediaOrigins,
    api: Option<&Api>,
    url: Url,
) -> Result<MediaReadResult, PluginError> {
    let client = reqwest::Client::builder()
        .user_agent(concat!("codewide-forge-github/", env!("CARGO_PKG_VERSION")))
        .timeout(MEDIA_TIMEOUT)
        .redirect(Policy::none())
        .build()
        .map_err(|_| PluginError::internal("the HTTP client could not be built"))?;
    let mut current = url;
    for _ in 0..=MAX_REDIRECTS {
        let credentialed = origins.classify(&current).ok_or_else(refused)?;
        let mut request = client
            .get(current.clone())
            .header(header::ACCEPT, "image/*, */*;q=0.5");
        if credentialed && let Some(api) = api {
            request = api.authorize_media(request);
        }
        let mut response = request
            .send()
            .await
            .map_err(|_| PluginError::internal("the media could not be fetched"))?;
        let status = response.status();
        if status.is_redirection() {
            let location = response
                .headers()
                .get(header::LOCATION)
                .and_then(|value| value.to_str().ok())
                .ok_or_else(|| PluginError::internal("a media redirect has no location"))?;
            current = current
                .join(location)
                .map_err(|_| PluginError::internal("a media redirect is invalid"))?;
            continue;
        }
        if status != StatusCode::OK {
            return Err(status_error(
                status,
                response.headers(),
                &serde_json::Value::Null,
            ));
        }
        if response
            .content_length()
            .is_some_and(|length| length > MAX_MEDIA_BYTES as u64)
        {
            return Err(too_large());
        }
        let content_type = response
            .headers()
            .get(header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .map_or("application/octet-stream", |value| {
                value.split(';').next().unwrap_or(value).trim()
            })
            .chars()
            .take(100)
            .collect::<String>();
        let mut bytes = Vec::new();
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|_| PluginError::internal("the media could not be fetched"))?
        {
            if bytes.len().saturating_add(chunk.len()) > MAX_MEDIA_BYTES {
                return Err(too_large());
            }
            bytes.extend_from_slice(&chunk);
        }
        return Ok(MediaReadResult {
            content_type,
            bytes_base64: STANDARD.encode(bytes),
        });
    }
    Err(PluginError::internal("the media redirects too often"))
}

#[cfg(test)]
#[allow(clippy::expect_used)]
mod tests {
    use super::*;

    #[test]
    fn github_media_origins_split_token_and_image_hosts() {
        let origins = MediaOrigins::for_host("github.com");
        let classify = |raw: &str| origins.classify(&Url::parse(raw).expect("url"));
        assert_eq!(
            classify("https://github.com/user-attachments/assets/1"),
            Some(true)
        );
        assert_eq!(
            classify("https://private-user-images.githubusercontent.com/1/a.png?jwt=x"),
            Some(false)
        );
        assert_eq!(
            classify("https://avatars.githubusercontent.com/u/1"),
            Some(false)
        );
        for foreign in [
            "http://github.com/user-attachments/assets/1",
            "https://github.com.evil.example/a.png",
            "https://user:pass@github.com/a.png",
            "https://github.com:8443/a.png",
            "https://example.com/a.png",
        ] {
            assert_eq!(classify(foreign), None, "{foreign}");
        }
        let enterprise = MediaOrigins::for_host("ghe.example.com");
        assert_eq!(
            enterprise.classify(&Url::parse("https://media.ghe.example.com/u/1").expect("url")),
            Some(false)
        );
        assert_eq!(
            enterprise
                .classify(&Url::parse("https://avatars.githubusercontent.com/u/1").expect("url")),
            None
        );
    }
}
