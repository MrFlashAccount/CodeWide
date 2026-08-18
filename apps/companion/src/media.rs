use std::{
    collections::HashMap,
    net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr},
    sync::{Arc, Mutex},
    time::Duration,
};

use axum::{
    body::Body,
    http::{Response, StatusCode, header},
    response::IntoResponse,
};
use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use rand::random;
use reqwest::Url;
use serde::Serialize;
use serde_json::json;

use crate::ports::unix_time_ms;

const MAX_IMAGE_BYTES: usize = 16 * 1024 * 1024;
const MAX_CACHE_BYTES: usize = 64 * 1024 * 1024;
const CACHE_TTL_MS: u64 = 15 * 60 * 1_000;
const MAX_REDIRECTS: usize = 3;

#[derive(Clone)]
pub struct MediaProxyService {
    cache: Arc<Mutex<MediaCache>>,
}

#[derive(Default)]
struct MediaCache {
    by_id: HashMap<String, CachedImage>,
    id_by_url: HashMap<String, String>,
    bytes: usize,
}

#[derive(Clone)]
struct CachedImage {
    source_url: String,
    bytes: Arc<[u8]>,
    content_type: &'static str,
    expires_at: u64,
    last_access_at: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MaterializedImage {
    pub id: String,
    pub expires_at: u64,
    #[serde(skip)]
    pub reused: bool,
}

#[derive(Debug, thiserror::Error)]
pub enum MediaError {
    #[error("valid_url_required")]
    InvalidUrl,
    #[error("https_image_required")]
    InsecureUrl,
    #[error("unsafe_image_host")]
    UnsafeHost,
    #[error("too_many_redirects")]
    Redirects,
    #[error("redirect_without_location")]
    RedirectLocation,
    #[error("image_upstream_failed")]
    Upstream,
    #[error("image_fetch_timeout")]
    Timeout,
    #[error("image_too_large")]
    TooLarge,
    #[error("unsupported_image")]
    Unsupported,
    #[error("image_not_found")]
    NotFound,
}

impl Default for MediaProxyService {
    fn default() -> Self {
        Self::new()
    }
}

impl MediaProxyService {
    #[must_use]
    pub fn new() -> Self {
        Self {
            cache: Arc::new(Mutex::new(MediaCache::default())),
        }
    }

    /// Downloads and privately caches one remote image after HTTPS and DNS
    /// rebinding checks.
    ///
    /// # Errors
    ///
    /// Returns a stable media error for invalid URLs, unsafe DNS answers,
    /// redirects, upstream failures, timeouts, oversized or non-image data.
    pub async fn materialize(&self, raw_url: &str) -> Result<MaterializedImage, MediaError> {
        if raw_url.len() > 16_384 {
            return Err(MediaError::InvalidUrl);
        }
        let source_url = canonical_url(raw_url)?;
        if let Some(existing) = self.cached_by_url(&source_url) {
            return Ok(existing);
        }
        let (bytes, content_type) = download_image(&source_url, 0).await?;
        let now = unix_time_ms();
        let id = URL_SAFE_NO_PAD.encode(random::<[u8; 24]>());
        let image = CachedImage {
            source_url: source_url.clone(),
            bytes: Arc::from(bytes),
            content_type,
            expires_at: now.saturating_add(CACHE_TTL_MS),
            last_access_at: now,
        };
        let expires_at = image.expires_at;
        let mut cache = lock_cache(&self.cache);
        purge_expired(&mut cache, now);
        make_room(&mut cache, image.bytes.len())?;
        cache.bytes = cache.bytes.saturating_add(image.bytes.len());
        cache.id_by_url.insert(source_url, id.clone());
        cache.by_id.insert(id.clone(), image);
        Ok(MaterializedImage {
            id,
            expires_at,
            reused: false,
        })
    }

    fn cached_by_url(&self, source_url: &str) -> Option<MaterializedImage> {
        let now = unix_time_ms();
        let mut cache = lock_cache(&self.cache);
        purge_expired(&mut cache, now);
        let id = cache.id_by_url.get(source_url)?.clone();
        let image = cache.by_id.get_mut(&id)?;
        image.last_access_at = now;
        Some(MaterializedImage {
            id,
            expires_at: image.expires_at,
            reused: true,
        })
    }

    /// Returns a private image body by opaque media id.
    ///
    /// # Errors
    ///
    /// Returns not-found for invalid, missing, or expired ids.
    pub fn serve(&self, id: &str, head_only: bool) -> Result<Response<Body>, MediaError> {
        if id.len() != 32
            || !id
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
        {
            return Err(MediaError::NotFound);
        }
        let now = unix_time_ms();
        let mut cache = lock_cache(&self.cache);
        purge_expired(&mut cache, now);
        let image = cache.by_id.get_mut(id).ok_or(MediaError::NotFound)?;
        image.last_access_at = now;
        Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, image.content_type)
            .header(header::CONTENT_LENGTH, image.bytes.len())
            .header(header::CACHE_CONTROL, "private, max-age=300")
            .header("content-security-policy", "default-src 'none'; sandbox")
            .header("x-content-type-options", "nosniff")
            .header("referrer-policy", "no-referrer")
            .body(if head_only {
                Body::empty()
            } else {
                Body::from(image.bytes.to_vec())
            })
            .map_err(|_| MediaError::Upstream)
    }
}

impl IntoResponse for MediaError {
    fn into_response(self) -> Response<Body> {
        let status = match self {
            Self::InvalidUrl | Self::InsecureUrl | Self::UnsafeHost | Self::Redirects => {
                StatusCode::BAD_REQUEST
            }
            Self::TooLarge => StatusCode::PAYLOAD_TOO_LARGE,
            Self::Unsupported => StatusCode::UNSUPPORTED_MEDIA_TYPE,
            Self::NotFound => StatusCode::NOT_FOUND,
            Self::Timeout => StatusCode::GATEWAY_TIMEOUT,
            Self::RedirectLocation | Self::Upstream => StatusCode::BAD_GATEWAY,
        };
        (status, axum::Json(json!({"error": self.to_string()}))).into_response()
    }
}

async fn download_image(
    raw_url: &str,
    redirects: usize,
) -> Result<(Vec<u8>, &'static str), MediaError> {
    if redirects > MAX_REDIRECTS {
        return Err(MediaError::Redirects);
    }
    let url = Url::parse(&canonical_url(raw_url)?).map_err(|_| MediaError::InvalidUrl)?;
    let host = url.host_str().ok_or(MediaError::InvalidUrl)?;
    let addresses = tokio::net::lookup_host((host, 443))
        .await
        .map_err(|_| MediaError::UnsafeHost)?
        .collect::<Vec<_>>();
    if addresses.is_empty() || addresses.iter().any(|address| !safe_ip(address.ip())) {
        return Err(MediaError::UnsafeHost);
    }
    let selected = SocketAddr::new(addresses[0].ip(), 443);
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(12))
        .timeout(Duration::from_secs(12))
        .resolve_to_addrs(host, &[selected])
        .build()
        .map_err(|_| MediaError::Upstream)?;
    let mut response = client
        .get(url.clone())
        .header(
            header::ACCEPT,
            "image/avif,image/webp,image/png,image/jpeg,image/gif",
        )
        .header(header::USER_AGENT, "CodeWide-Companion/1")
        .send()
        .await
        .map_err(|error| {
            if error.is_timeout() {
                MediaError::Timeout
            } else {
                MediaError::Upstream
            }
        })?;
    if response.status().is_redirection() {
        let location = response
            .headers()
            .get(header::LOCATION)
            .and_then(|value| value.to_str().ok())
            .ok_or(MediaError::RedirectLocation)?;
        let redirected = url.join(location).map_err(|_| MediaError::InvalidUrl)?;
        return Box::pin(download_image(redirected.as_str(), redirects + 1)).await;
    }
    if response.status() != StatusCode::OK {
        return Err(MediaError::Upstream);
    }
    if response
        .content_length()
        .is_some_and(|length| length > MAX_IMAGE_BYTES as u64)
    {
        return Err(MediaError::TooLarge);
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| MediaError::Upstream)? {
        if bytes.len().saturating_add(chunk.len()) > MAX_IMAGE_BYTES {
            return Err(MediaError::TooLarge);
        }
        bytes.extend_from_slice(&chunk);
    }
    let content_type = detect_image_type(&bytes).ok_or(MediaError::Unsupported)?;
    Ok((bytes, content_type))
}

fn canonical_url(value: &str) -> Result<String, MediaError> {
    let mut url = Url::parse(value).map_err(|_| MediaError::InvalidUrl)?;
    if url.scheme() != "https"
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_some_and(|port| port != 443)
    {
        return Err(MediaError::InsecureUrl);
    }
    url.set_fragment(None);
    Ok(url.to_string())
}

fn safe_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => safe_ipv4(ip),
        IpAddr::V6(ip) => safe_ipv6(ip),
    }
}

fn safe_ipv4(ip: Ipv4Addr) -> bool {
    let [a, b, c, _d] = ip.octets();
    !(a == 0
        || a == 10
        || a == 127
        || (a == 100 && (64..=127).contains(&b))
        || (a == 169 && b == 254)
        || (a == 172 && (16..=31).contains(&b))
        || (a == 192 && b == 0 && c == 0)
        || (a == 192 && b == 0 && c == 2)
        || (a == 192 && b == 88 && c == 99)
        || (a == 192 && b == 168)
        || (a == 198 && (b == 18 || b == 19))
        || (a == 198 && b == 51 && c == 100)
        || (a == 203 && b == 0 && c == 113)
        || a >= 224)
}

fn safe_ipv6(ip: Ipv6Addr) -> bool {
    let segments = ip.segments();
    !(ip.is_unspecified()
        || ip.is_loopback()
        || ip.is_multicast()
        || (segments[0] & 0xfe00) == 0xfc00
        || (segments[0] & 0xffc0) == 0xfe80
        || (segments[0] == 0x2001 && segments[1] == 0x0db8)
        || (segments[0] == 0x0064 && segments[1] == 0xff9b && segments[2..6] == [0, 0, 0, 0])
        || (segments[0] == 0x0100 && segments[1..4] == [0, 0, 0])
        || ip.to_ipv4_mapped().is_some())
}

fn detect_image_type(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(&[0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a]) {
        Some("image/png")
    } else if bytes.starts_with(&[0xff, 0xd8, 0xff]) {
        Some("image/jpeg")
    } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        Some("image/gif")
    } else if bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        Some("image/webp")
    } else if bytes.len() >= 12
        && &bytes[4..8] == b"ftyp"
        && matches!(&bytes[8..12], b"avif" | b"avis")
    {
        Some("image/avif")
    } else {
        None
    }
}

fn lock_cache(cache: &Mutex<MediaCache>) -> std::sync::MutexGuard<'_, MediaCache> {
    cache
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

fn purge_expired(cache: &mut MediaCache, now: u64) {
    let expired = cache
        .by_id
        .iter()
        .filter_map(|(id, image)| (image.expires_at <= now).then_some(id.clone()))
        .collect::<Vec<_>>();
    for id in expired {
        remove(cache, &id);
    }
}

fn make_room(cache: &mut MediaCache, incoming: usize) -> Result<(), MediaError> {
    if incoming > MAX_CACHE_BYTES {
        return Err(MediaError::TooLarge);
    }
    while cache.bytes.saturating_add(incoming) > MAX_CACHE_BYTES {
        let Some(oldest) = cache
            .by_id
            .iter()
            .min_by_key(|(_id, image)| image.last_access_at)
            .map(|(id, _image)| id.clone())
        else {
            break;
        };
        remove(cache, &oldest);
    }
    Ok(())
}

fn remove(cache: &mut MediaCache, id: &str) {
    if let Some(image) = cache.by_id.remove(id) {
        cache.bytes = cache.bytes.saturating_sub(image.bytes.len());
        if cache
            .id_by_url
            .get(&image.source_url)
            .is_some_and(|stored| stored == id)
        {
            cache.id_by_url.remove(&image.source_url);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_private_and_special_addresses() {
        for ip in ["127.0.0.1", "10.0.0.1", "192.168.1.1", "::1", "fc00::1"] {
            assert!(!safe_ip(
                ip.parse().unwrap_or(IpAddr::V4(Ipv4Addr::LOCALHOST))
            ));
        }
        assert!(safe_ip(IpAddr::V4(Ipv4Addr::new(8, 8, 8, 8))));
    }

    #[test]
    fn detects_supported_image_magic() {
        assert_eq!(
            detect_image_type(b"\x89PNG\r\n\x1a\nrest"),
            Some("image/png")
        );
        assert_eq!(detect_image_type(b"not an image"), None);
    }
}
