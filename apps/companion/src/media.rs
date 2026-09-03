use std::{
    collections::{HashMap, HashSet},
    io,
    net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr},
    sync::{Arc, Mutex},
    time::Duration,
};

use axum::{
    body::Body,
    http::{HeaderMap, Method, Response, StatusCode, header},
    response::IntoResponse,
};
use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use bytes::Bytes;
use futures_util::{StreamExt, stream};
use rand::random;
use reqwest::Url;
use serde::Serialize;
use serde_json::json;
use tokio::{
    sync::{OwnedSemaphorePermit, Semaphore, watch},
    time::Instant,
};

use crate::ports::unix_time_ms;

const MAX_IMAGE_BYTES: usize = 16 * 1024 * 1024;
const MAX_CACHE_BYTES: usize = 64 * 1024 * 1024;
const MAX_REMOTE_STREAMS: usize = 1_024;
const MAX_CONCURRENT_MATERIALIZATIONS: usize = 4;
const MAX_CONCURRENT_TRANSFERS: usize = 16;
const MAX_REMOTE_RESPONSE_BYTES: u64 = 64 * 1024 * 1024;
const CACHED_BODY_CHUNK_BYTES: usize = 64 * 1024;
const MAX_REMOTE_STREAM_DURATION: Duration = Duration::from_mins(5);
const DNS_LOOKUP_TIMEOUT: Duration = Duration::from_secs(5);
const CACHE_TTL_MS: u64 = 15 * 60 * 1_000;
const MAX_REDIRECTS: usize = 3;

#[derive(Clone)]
pub struct MediaProxyService {
    cache: Arc<Mutex<MediaCache>>,
    materialization_slots: Arc<Semaphore>,
    transfer_slots: Arc<Semaphore>,
}

#[derive(Default)]
struct MediaCache {
    by_id: HashMap<String, CachedImage>,
    id_by_owner_url: HashMap<(String, String), String>,
    streams_by_id: HashMap<String, RemoteStream>,
    stream_id_by_owner_url: HashMap<(String, String), String>,
    owner_lifecycles: HashMap<String, watch::Sender<u64>>,
    bytes: usize,
}

#[derive(Clone)]
struct CachedImage {
    owner: String,
    source_url: String,
    bytes: Bytes,
    content_type: &'static str,
    expires_at: u64,
    last_access_at: u64,
}

#[derive(Clone)]
struct RemoteStream {
    owner: String,
    source_url: String,
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
    #[error("media_capacity_exceeded")]
    Capacity,
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
            materialization_slots: Arc::new(Semaphore::new(MAX_CONCURRENT_MATERIALIZATIONS)),
            transfer_slots: Arc::new(Semaphore::new(MAX_CONCURRENT_TRANSFERS)),
        }
    }

    #[cfg(test)]
    fn with_limits(materializations: usize, transfers: usize) -> Self {
        Self {
            cache: Arc::new(Mutex::new(MediaCache::default())),
            materialization_slots: Arc::new(Semaphore::new(materializations)),
            transfer_slots: Arc::new(Semaphore::new(transfers)),
        }
    }

    /// Downloads and caches one image for one authenticated owner.
    ///
    /// # Errors
    ///
    /// Returns a stable media error when the source is unsafe or transfer limits are exhausted.
    pub async fn materialize_for_owner(
        &self,
        owner: &str,
        raw_url: &str,
    ) -> Result<MaterializedImage, MediaError> {
        if raw_url.len() > 16_384 {
            return Err(MediaError::InvalidUrl);
        }
        let source_url = canonical_url(raw_url)?;
        if let Some(existing) = self.cached_by_url(owner, &source_url) {
            return Ok(existing);
        }
        let _permit = self
            .materialization_slots
            .clone()
            .try_acquire_owned()
            .map_err(|_| MediaError::Capacity)?;
        let mut cancellation = self.owner_cancellation(owner);
        let download = download_image(&source_url, 0);
        let (bytes, content_type) = tokio::select! {
            biased;
            changed = cancellation.changed() => {
                let _ = changed;
                return Err(MediaError::NotFound);
            }
            result = download => result?,
        };
        let now = unix_time_ms();
        let mut cache = lock_cache(&self.cache);
        if owner_was_revoked(&cancellation) {
            return Err(MediaError::NotFound);
        }
        purge_expired(&mut cache, now);
        if let Some(existing) = cached_image(&mut cache, owner, &source_url, now) {
            return Ok(existing);
        }
        let id = new_media_id();
        let image = CachedImage {
            owner: owner.to_owned(),
            source_url: source_url.clone(),
            bytes: Bytes::from(bytes),
            content_type,
            expires_at: now.saturating_add(CACHE_TTL_MS),
            last_access_at: now,
        };
        let expires_at = image.expires_at;
        make_room(&mut cache, image.bytes.len())?;
        cache.bytes = cache.bytes.saturating_add(image.bytes.len());
        cache
            .id_by_owner_url
            .insert((owner.to_owned(), source_url), id.clone());
        cache.by_id.insert(id.clone(), image);
        Ok(MaterializedImage {
            id,
            expires_at,
            reused: false,
        })
    }

    fn cached_by_url(&self, owner: &str, source_url: &str) -> Option<MaterializedImage> {
        let now = unix_time_ms();
        let mut cache = lock_cache(&self.cache);
        purge_expired(&mut cache, now);
        cached_image(&mut cache, owner, source_url, now)
    }

    /// Returns an owner-bound private image body by opaque media id.
    ///
    /// # Errors
    ///
    /// Returns not-found when the id belongs to another owner and capacity when saturated.
    pub fn serve_for_owner(
        &self,
        owner: &str,
        id: &str,
        head_only: bool,
    ) -> Result<Response<Body>, MediaError> {
        if !valid_media_id(id) {
            return Err(MediaError::NotFound);
        }
        let now = unix_time_ms();
        let mut cache = lock_cache(&self.cache);
        purge_expired(&mut cache, now);
        let image = cache.by_id.get_mut(id).ok_or(MediaError::NotFound)?;
        if image.owner != owner {
            return Err(MediaError::NotFound);
        }
        image.last_access_at = now;
        let content_type = image.content_type;
        let bytes = image.bytes.clone();
        let cancellation = owner_cancellation(&mut cache, owner);
        drop(cache);
        let permit = (!head_only)
            .then(|| self.acquire_transfer_slot())
            .transpose()?;
        Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, content_type)
            .header(header::CONTENT_LENGTH, bytes.len())
            .header(header::CACHE_CONTROL, "private, max-age=300")
            .header("content-security-policy", "default-src 'none'; sandbox")
            .header("x-content-type-options", "nosniff")
            .header("referrer-policy", "no-referrer")
            .body(if head_only {
                Body::empty()
            } else {
                cached_body(bytes, permit.ok_or(MediaError::Capacity)?, cancellation)
            })
            .map_err(|_| MediaError::Upstream)
    }

    /// Removes every cached image and stream owned by one revoked device.
    pub fn purge_owner(&self, owner: &str) {
        let mut cache = lock_cache(&self.cache);
        signal_owner_revoked(&mut cache, owner);
        let image_ids = cache
            .by_id
            .iter()
            .filter_map(|(id, image)| (image.owner == owner).then_some(id.clone()))
            .collect::<Vec<_>>();
        for id in image_ids {
            remove(&mut cache, &id);
        }
        let stream_ids = cache
            .streams_by_id
            .iter()
            .filter_map(|(id, remote)| (remote.owner == owner).then_some(id.clone()))
            .collect::<Vec<_>>();
        for id in stream_ids {
            remove_stream(&mut cache, &id);
        }
    }

    /// Registers one HTTPS asset source after an SSRF-safe ranged probe.
    ///
    /// # Errors
    ///
    /// Returns a stable media error for unsafe URLs or invalid upstream responses.
    pub async fn register_stream(
        &self,
        owner: &str,
        raw_url: &str,
    ) -> Result<MaterializedImage, MediaError> {
        if raw_url.len() > 16_384 {
            return Err(MediaError::InvalidUrl);
        }
        let source_url = canonical_url(raw_url)?;
        if let Some(existing) = self.cached_stream_by_url(owner, &source_url) {
            return Ok(existing);
        }
        let _permit = self
            .materialization_slots
            .clone()
            .try_acquire_owned()
            .map_err(|_| MediaError::Capacity)?;
        let mut cancellation = self.owner_cancellation(owner);
        let probe_range = header::HeaderValue::from_static("bytes=0-0");
        let probe = tokio::select! {
            biased;
            changed = cancellation.changed() => {
                let _ = changed;
                return Err(MediaError::NotFound);
            }
            result = request_remote_asset(&source_url, 0, Method::GET, Some(&probe_range)) => result?,
        };
        drop(probe);
        let now = unix_time_ms();
        let mut cache = lock_cache(&self.cache);
        if owner_was_revoked(&cancellation) {
            return Err(MediaError::NotFound);
        }
        purge_expired(&mut cache, now);
        if let Some(existing) = cached_remote_stream(&mut cache, owner, &source_url, now) {
            return Ok(existing);
        }
        let id = new_media_id();
        let stream = RemoteStream {
            owner: owner.to_owned(),
            source_url: source_url.clone(),
            expires_at: now.saturating_add(CACHE_TTL_MS),
            last_access_at: now,
        };
        let expires_at = stream.expires_at;
        make_stream_room(&mut cache);
        cache
            .stream_id_by_owner_url
            .insert((owner.to_owned(), source_url), id.clone());
        cache.streams_by_id.insert(id.clone(), stream);
        Ok(MaterializedImage {
            id,
            expires_at,
            reused: false,
        })
    }

    fn cached_stream_by_url(&self, owner: &str, source_url: &str) -> Option<MaterializedImage> {
        let now = unix_time_ms();
        let mut cache = lock_cache(&self.cache);
        purge_expired(&mut cache, now);
        cached_remote_stream(&mut cache, owner, source_url, now)
    }

    /// Streams one registered asset while preserving upstream byte ranges.
    ///
    /// # Errors
    ///
    /// Returns not-found for expired ids and upstream errors for failed streams.
    pub async fn stream(
        &self,
        owner: &str,
        id: &str,
        headers: &HeaderMap,
        head_only: bool,
    ) -> Result<Response<Body>, MediaError> {
        if !valid_media_id(id) {
            return Err(MediaError::NotFound);
        }
        let now = unix_time_ms();
        let (source_url, mut cancellation) = {
            let mut cache = lock_cache(&self.cache);
            purge_expired(&mut cache, now);
            let stream = cache
                .streams_by_id
                .get_mut(id)
                .ok_or(MediaError::NotFound)?;
            if stream.owner != owner {
                return Err(MediaError::NotFound);
            }
            stream.last_access_at = now;
            let source_url = stream.source_url.clone();
            let cancellation = owner_cancellation(&mut cache, owner);
            (source_url, cancellation)
        };
        let method = if head_only { Method::HEAD } else { Method::GET };
        let range = bounded_range(headers.get(header::RANGE), head_only)?;
        let permit = self.acquire_transfer_slot()?;
        let upstream = tokio::select! {
            biased;
            changed = cancellation.changed() => {
                let _ = changed;
                return Err(MediaError::NotFound);
            }
            result = request_remote_asset(&source_url, 0, method, range.as_ref()) => result?,
        };
        remote_asset_response(upstream, head_only, permit, cancellation)
    }

    fn acquire_transfer_slot(&self) -> Result<OwnedSemaphorePermit, MediaError> {
        self.transfer_slots
            .clone()
            .try_acquire_owned()
            .map_err(|_| MediaError::Capacity)
    }

    fn owner_cancellation(&self, owner: &str) -> watch::Receiver<u64> {
        let mut cache = lock_cache(&self.cache);
        owner_cancellation(&mut cache, owner)
    }
}

impl IntoResponse for MediaError {
    fn into_response(self) -> Response<Body> {
        let status = match self {
            Self::InvalidUrl | Self::InsecureUrl | Self::UnsafeHost | Self::Redirects => {
                StatusCode::BAD_REQUEST
            }
            Self::TooLarge => StatusCode::PAYLOAD_TOO_LARGE,
            Self::Capacity => StatusCode::TOO_MANY_REQUESTS,
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
    let selected = resolve_safe_host(host).await?;
    let client = pinned_client_builder(host, selected)
        .timeout(Duration::from_secs(12))
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
        drop(response);
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

async fn request_remote_asset(
    raw_url: &str,
    redirects: usize,
    method: Method,
    range: Option<&header::HeaderValue>,
) -> Result<reqwest::Response, MediaError> {
    if redirects > MAX_REDIRECTS {
        return Err(MediaError::Redirects);
    }
    let url = Url::parse(&canonical_url(raw_url)?).map_err(|_| MediaError::InvalidUrl)?;
    let host = url.host_str().ok_or(MediaError::InvalidUrl)?;
    let selected = resolve_safe_host(host).await?;
    let client = pinned_client_builder(host, selected)
        .read_timeout(Duration::from_secs(30))
        .timeout(MAX_REMOTE_STREAM_DURATION)
        .build()
        .map_err(|_| MediaError::Upstream)?;
    let mut request = client
        .request(method.clone(), url.clone())
        .header(header::ACCEPT, "*/*")
        .header(header::ACCEPT_ENCODING, "identity")
        .header(header::USER_AGENT, "CodeWide-Companion/1");
    if let Some(range) = range {
        request = request.header(header::RANGE, range);
    }
    let response = request.send().await.map_err(|error| {
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
        drop(response);
        return Box::pin(request_remote_asset(
            redirected.as_str(),
            redirects + 1,
            method,
            range,
        ))
        .await;
    }
    validate_remote_asset_metadata(response.status(), response.headers())?;
    Ok(response)
}

fn pinned_client_builder(host: &str, selected: SocketAddr) -> reqwest::ClientBuilder {
    reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(12))
        .resolve_to_addrs(host, &[selected])
}

async fn resolve_safe_host(host: &str) -> Result<SocketAddr, MediaError> {
    let addresses = tokio::time::timeout(DNS_LOOKUP_TIMEOUT, tokio::net::lookup_host((host, 443)))
        .await
        .map_err(|_| MediaError::Timeout)?
        .map_err(|_| MediaError::UnsafeHost)?
        .collect::<Vec<_>>();
    if addresses.is_empty() || addresses.iter().any(|address| !safe_ip(address.ip())) {
        return Err(MediaError::UnsafeHost);
    }
    Ok(SocketAddr::new(addresses[0].ip(), 443))
}

fn validate_remote_asset_metadata(
    status: StatusCode,
    _headers: &HeaderMap,
) -> Result<(), MediaError> {
    if status != StatusCode::OK
        && status != StatusCode::PARTIAL_CONTENT
        && status != StatusCode::RANGE_NOT_SATISFIABLE
    {
        return Err(MediaError::Upstream);
    }
    Ok(())
}

fn remote_asset_response(
    upstream: reqwest::Response,
    head_only: bool,
    permit: OwnedSemaphorePermit,
    cancellation: watch::Receiver<u64>,
) -> Result<Response<Body>, MediaError> {
    let status = upstream.status();
    let headers = upstream.headers().clone();
    if !head_only
        && upstream
            .content_length()
            .is_some_and(|length| length > MAX_REMOTE_RESPONSE_BYTES)
    {
        return Err(MediaError::TooLarge);
    }
    let mut response = Response::builder().status(status);
    for name in [
        header::CONTENT_TYPE,
        header::CONTENT_LENGTH,
        header::CONTENT_RANGE,
        header::ACCEPT_RANGES,
        header::ETAG,
        header::LAST_MODIFIED,
    ] {
        if let Some(value) = headers.get(&name) {
            response = response.header(name, value);
        }
    }
    response
        .header(header::CACHE_CONTROL, "private, no-store")
        .header("content-security-policy", "default-src 'none'; sandbox")
        .header("x-content-type-options", "nosniff")
        .header("referrer-policy", "no-referrer")
        .body(if head_only {
            Body::empty()
        } else {
            bounded_remote_body(upstream, permit, cancellation)
        })
        .map_err(|_| MediaError::Upstream)
}

fn cached_body(
    bytes: Bytes,
    permit: OwnedSemaphorePermit,
    cancellation: watch::Receiver<u64>,
) -> Body {
    let state = (bytes, 0_usize, permit, cancellation);
    let chunks = stream::try_unfold(state, |(bytes, offset, permit, cancellation)| async move {
        if owner_was_revoked(&cancellation) {
            return Err(owner_revoked_error());
        }
        if offset >= bytes.len() {
            return Ok(None);
        }
        let end = offset
            .saturating_add(CACHED_BODY_CHUNK_BYTES)
            .min(bytes.len());
        let chunk = bytes.slice(offset..end);
        Ok(Some((chunk, (bytes, end, permit, cancellation))))
    });
    Body::from_stream(chunks)
}

fn bounded_remote_body(
    upstream: reqwest::Response,
    permit: OwnedSemaphorePermit,
    cancellation: watch::Receiver<u64>,
) -> Body {
    let upstream = upstream
        .bytes_stream()
        .map(|item| item.map_err(io::Error::other));
    bounded_stream_body(
        upstream,
        permit,
        MAX_REMOTE_RESPONSE_BYTES,
        MAX_REMOTE_STREAM_DURATION,
        cancellation,
    )
}

fn bounded_stream_body<S>(
    upstream: S,
    permit: OwnedSemaphorePermit,
    byte_limit: u64,
    duration: Duration,
    cancellation: watch::Receiver<u64>,
) -> Body
where
    S: futures_util::Stream<Item = Result<Bytes, io::Error>> + Send + 'static,
{
    let deadline = Instant::now() + duration;
    let upstream = Box::pin(upstream);
    let state = (upstream, 0_u64, deadline, permit, cancellation);
    let bounded = stream::try_unfold(
        state,
        move |(mut upstream, transferred, deadline, permit, mut cancellation)| async move {
            let next = tokio::select! {
                biased;
                changed = cancellation.changed() => {
                    let _ = changed;
                    return Err(owner_revoked_error());
                }
                result = tokio::time::timeout_at(deadline, upstream.next()) => {
                    result.map_err(|_| {
                        io::Error::new(io::ErrorKind::TimedOut, "media deadline exceeded")
                    })?
                }
            };
            let Some(item) = next else {
                return Ok(None);
            };
            let chunk = item?;
            let chunk_length = u64::try_from(chunk.len()).unwrap_or(u64::MAX);
            let transferred = transferred.saturating_add(chunk_length);
            if transferred > byte_limit {
                return Err(io::Error::other("media byte limit exceeded"));
            }
            Ok(Some((
                chunk,
                (upstream, transferred, deadline, permit, cancellation),
            )))
        },
    );
    Body::from_stream(bounded)
}

fn owner_revoked_error() -> io::Error {
    io::Error::new(io::ErrorKind::PermissionDenied, "media owner revoked")
}

fn valid_media_id(id: &str) -> bool {
    id.len() == 32
        && id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
}

fn bounded_range(
    requested: Option<&header::HeaderValue>,
    head_only: bool,
) -> Result<Option<header::HeaderValue>, MediaError> {
    let Some(requested) = requested else {
        return if head_only {
            Ok(None)
        } else {
            range_header(0, MAX_REMOTE_RESPONSE_BYTES - 1).map(Some)
        };
    };
    let value = requested.to_str().map_err(|_| MediaError::InvalidUrl)?;
    if value.len() > 128 || value.contains(',') {
        return Err(MediaError::InvalidUrl);
    }
    let (start, end) = value
        .strip_prefix("bytes=")
        .and_then(|range| range.split_once('-'))
        .ok_or(MediaError::InvalidUrl)?;
    let start = parse_range_number(start)?;
    let end = parse_range_number(end)?;
    match start {
        None => bounded_suffix_range(requested, end),
        Some(start) => bounded_explicit_range(requested, start, end),
    }
}

fn bounded_suffix_range(
    requested: &header::HeaderValue,
    suffix: Option<u64>,
) -> Result<Option<header::HeaderValue>, MediaError> {
    match suffix {
        None | Some(0) => Err(MediaError::InvalidUrl),
        Some(suffix) if suffix <= MAX_REMOTE_RESPONSE_BYTES => Ok(Some(requested.clone())),
        Some(_) => Err(MediaError::TooLarge),
    }
}

fn bounded_explicit_range(
    requested: &header::HeaderValue,
    start: u64,
    end: Option<u64>,
) -> Result<Option<header::HeaderValue>, MediaError> {
    let Some(end) = end else {
        return range_header(start, start.saturating_add(MAX_REMOTE_RESPONSE_BYTES - 1)).map(Some);
    };
    if end < start {
        return Err(MediaError::InvalidUrl);
    }
    let length = end.saturating_sub(start).saturating_add(1);
    if length > MAX_REMOTE_RESPONSE_BYTES {
        Err(MediaError::TooLarge)
    } else {
        Ok(Some(requested.clone()))
    }
}

fn parse_range_number(value: &str) -> Result<Option<u64>, MediaError> {
    if value.is_empty() {
        Ok(None)
    } else {
        value
            .parse::<u64>()
            .map(Some)
            .map_err(|_| MediaError::InvalidUrl)
    }
}

fn range_header(start: u64, end: u64) -> Result<header::HeaderValue, MediaError> {
    header::HeaderValue::from_str(&format!("bytes={start}-{end}"))
        .map_err(|_| MediaError::InvalidUrl)
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

fn new_media_id() -> String {
    URL_SAFE_NO_PAD.encode(random::<[u8; 24]>())
}

fn cached_image(
    cache: &mut MediaCache,
    owner: &str,
    source_url: &str,
    now: u64,
) -> Option<MaterializedImage> {
    let id = cache
        .id_by_owner_url
        .get(&(owner.to_owned(), source_url.to_owned()))?
        .clone();
    let image = cache.by_id.get_mut(&id)?;
    image.last_access_at = now;
    Some(MaterializedImage {
        id,
        expires_at: image.expires_at,
        reused: true,
    })
}

fn cached_remote_stream(
    cache: &mut MediaCache,
    owner: &str,
    source_url: &str,
    now: u64,
) -> Option<MaterializedImage> {
    let id = cache
        .stream_id_by_owner_url
        .get(&(owner.to_owned(), source_url.to_owned()))?
        .clone();
    let remote = cache.streams_by_id.get_mut(&id)?;
    remote.last_access_at = now;
    Some(MaterializedImage {
        id,
        expires_at: remote.expires_at,
        reused: true,
    })
}

fn owner_cancellation(cache: &mut MediaCache, owner: &str) -> watch::Receiver<u64> {
    cache
        .owner_lifecycles
        .entry(owner.to_owned())
        .or_insert_with(|| watch::channel(0).0)
        .subscribe()
}

fn signal_owner_revoked(cache: &mut MediaCache, owner: &str) {
    if let Some(signal) = cache.owner_lifecycles.remove(owner) {
        signal.send_modify(|generation| {
            *generation = generation.saturating_add(1);
        });
    }
}

fn owner_was_revoked(cancellation: &watch::Receiver<u64>) -> bool {
    cancellation.has_changed().unwrap_or(true)
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
    let expired_streams = cache
        .streams_by_id
        .iter()
        .filter_map(|(id, stream)| (stream.expires_at <= now).then_some(id.clone()))
        .collect::<Vec<_>>();
    for id in expired_streams {
        remove_stream(cache, &id);
    }
    purge_unused_owner_lifecycles(cache);
}

fn purge_unused_owner_lifecycles(cache: &mut MediaCache) {
    let owners = cache
        .by_id
        .values()
        .map(|image| image.owner.as_str())
        .chain(
            cache
                .streams_by_id
                .values()
                .map(|remote| remote.owner.as_str()),
        )
        .collect::<HashSet<_>>();
    cache
        .owner_lifecycles
        .retain(|owner, signal| owners.contains(owner.as_str()) || signal.receiver_count() > 0);
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
        let key = (image.owner, image.source_url);
        if cache
            .id_by_owner_url
            .get(&key)
            .is_some_and(|stored| stored == id)
        {
            cache.id_by_owner_url.remove(&key);
        }
    }
}

fn make_stream_room(cache: &mut MediaCache) {
    if cache.streams_by_id.len() < MAX_REMOTE_STREAMS {
        return;
    }
    if let Some(oldest) = cache
        .streams_by_id
        .iter()
        .min_by_key(|(_, stream)| stream.last_access_at)
        .map(|(id, _)| id.clone())
    {
        remove_stream(cache, &oldest);
    }
}

fn remove_stream(cache: &mut MediaCache, id: &str) {
    if let Some(stream) = cache.streams_by_id.remove(id) {
        let key = (stream.owner, stream.source_url);
        if cache
            .stream_id_by_owner_url
            .get(&key)
            .is_some_and(|stored| stored == id)
        {
            cache.stream_id_by_owner_url.remove(&key);
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

    #[test]
    fn accepts_only_single_bounded_byte_ranges() {
        let bounded = bounded_range(Some(&header::HeaderValue::from_static("bytes=7-")), false)
            .ok()
            .flatten();
        assert_eq!(
            bounded,
            Some(header::HeaderValue::from_static("bytes=7-67108870"))
        );
        for value in ["bytes=0-1023", "bytes=-512"] {
            assert!(bounded_range(Some(&header::HeaderValue::from_static(value)), false).is_ok());
        }
        for value in ["items=0-1", "bytes=-", "bytes=0-1,4-8", "bytes=zero-1"] {
            assert!(bounded_range(Some(&header::HeaderValue::from_static(value)), false).is_err());
        }
        let too_large = header::HeaderValue::from_static("bytes=0-67108864");
        assert!(matches!(
            bounded_range(Some(&too_large), false),
            Err(MediaError::TooLarge)
        ));
        assert_eq!(
            bounded_range(None, false).ok().flatten(),
            Some(header::HeaderValue::from_static("bytes=0-67108863"))
        );
        assert!(matches!(bounded_range(None, true), Ok(None)));
    }

    #[test]
    fn accepts_generic_asset_metadata() {
        let mut headers = HeaderMap::new();
        headers.insert(
            header::CONTENT_TYPE,
            header::HeaderValue::from_static("application/pdf"),
        );
        headers.insert(
            header::CONTENT_LENGTH,
            header::HeaderValue::from_static("1024"),
        );
        assert!(validate_remote_asset_metadata(StatusCode::OK, &headers).is_ok());
        assert!(matches!(
            validate_remote_asset_metadata(StatusCode::FOUND, &headers),
            Err(MediaError::Upstream)
        ));
    }

    #[test]
    fn accepts_only_credential_free_https_asset_urls() {
        assert!(canonical_url("https://example.com/report.pdf#page=2").is_ok());
        assert!(matches!(
            canonical_url("http://example.com/report.pdf"),
            Err(MediaError::InsecureUrl)
        ));
        assert!(matches!(
            canonical_url("https://user:secret@example.com/report.pdf"),
            Err(MediaError::InsecureUrl)
        ));
    }

    #[test]
    fn accepts_only_opaque_media_ids() {
        assert!(valid_media_id("abcdefghijklmnopqrstuvwxyz012345"));
        assert!(!valid_media_id("../abcdefghijklmnopqrstuvwxyz012345"));
        assert!(!valid_media_id("short"));
    }

    #[tokio::test]
    async fn registered_streams_are_visible_only_to_the_owning_device() {
        let service = MediaProxyService::new();
        let id = "abcdefghijklmnopqrstuvwxyz012345".to_owned();
        let source_url = "https://example.test/report.pdf".to_owned();
        let now = unix_time_ms();
        {
            let mut cache = lock_cache(&service.cache);
            cache
                .stream_id_by_owner_url
                .insert(("device-a".to_owned(), source_url.clone()), id.clone());
            cache.streams_by_id.insert(
                id.clone(),
                RemoteStream {
                    owner: "device-a".to_owned(),
                    source_url: source_url.clone(),
                    expires_at: now.saturating_add(CACHE_TTL_MS),
                    last_access_at: now,
                },
            );
        }

        assert!(
            service
                .cached_stream_by_url("device-b", &source_url)
                .is_none()
        );
        assert!(matches!(
            service
                .stream("device-b", &id, &HeaderMap::new(), false)
                .await,
            Err(MediaError::NotFound)
        ));
        assert!(
            service
                .cached_stream_by_url("device-a", &source_url)
                .is_some()
        );
    }

    #[test]
    fn materialized_images_are_visible_only_to_the_owning_device() {
        let service = MediaProxyService::new();
        let id = "abcdefghijklmnopqrstuvwxyz012345".to_owned();
        let source_url = "https://example.test/image.png".to_owned();
        insert_test_image(&service, &id, "device-a", &source_url);

        assert!(service.cached_by_url("device-b", &source_url).is_none());
        assert!(matches!(
            service.serve_for_owner("device-b", &id, false),
            Err(MediaError::NotFound)
        ));
        assert!(service.cached_by_url("device-a", &source_url).is_some());
        assert!(service.serve_for_owner("device-a", &id, false).is_ok());
    }

    #[test]
    fn transfer_permit_is_held_until_cached_body_is_dropped() {
        let service = MediaProxyService::with_limits(1, 1);
        let first_id = "abcdefghijklmnopqrstuvwxyz012345";
        let second_id = "abcdefghijklmnopqrstuvwxyz012346";
        insert_test_image(
            &service,
            first_id,
            "device-a",
            "https://example.test/first.png",
        );
        insert_test_image(
            &service,
            second_id,
            "device-a",
            "https://example.test/second.png",
        );

        let first = service.serve_for_owner("device-a", first_id, false);
        assert!(first.is_ok());
        assert!(matches!(
            service.serve_for_owner("device-a", second_id, false),
            Err(MediaError::Capacity)
        ));
        drop(first);
        assert!(
            service
                .serve_for_owner("device-a", second_id, false)
                .is_ok()
        );
    }

    #[tokio::test]
    async fn materialization_and_probe_capacity_fail_before_network_io() {
        let service = MediaProxyService::with_limits(0, 1);

        assert!(matches!(
            service
                .materialize_for_owner("device-a", "https://example.test/image.png")
                .await,
            Err(MediaError::Capacity)
        ));
        assert!(matches!(
            service
                .register_stream("device-a", "https://example.test/report.pdf")
                .await,
            Err(MediaError::Capacity)
        ));
    }

    #[tokio::test]
    async fn streaming_body_enforces_byte_budget_and_releases_permit() {
        let service = MediaProxyService::with_limits(1, 1);
        let permit = service.acquire_transfer_slot();
        assert!(permit.is_ok());
        let chunks = stream::iter([
            Ok::<Bytes, io::Error>(Bytes::from_static(b"abc")),
            Ok(Bytes::from_static(b"def")),
        ]);
        if let Ok(permit) = permit {
            let cancellation = service.owner_cancellation("device-a");
            let body = bounded_stream_body(chunks, permit, 5, Duration::from_secs(1), cancellation);
            assert!(axum::body::to_bytes(body, 16).await.is_err());
        }
        assert_eq!(service.transfer_slots.available_permits(), 1);
    }

    #[tokio::test]
    async fn streaming_body_enforces_total_deadline_and_releases_permit() {
        let service = MediaProxyService::with_limits(1, 1);
        let permit = service.acquire_transfer_slot();
        assert!(permit.is_ok());
        let delayed = stream::once(async {
            tokio::time::sleep(Duration::from_millis(20)).await;
            Ok::<Bytes, io::Error>(Bytes::from_static(b"late"))
        });
        if let Ok(permit) = permit {
            let cancellation = service.owner_cancellation("device-a");
            let body =
                bounded_stream_body(delayed, permit, 16, Duration::from_millis(1), cancellation);
            assert!(axum::body::to_bytes(body, 16).await.is_err());
        }
        assert_eq!(service.transfer_slots.available_permits(), 1);
    }

    #[tokio::test]
    async fn revoking_owner_stops_an_issued_cached_body() {
        let service = MediaProxyService::with_limits(1, 1);
        let id = "abcdefghijklmnopqrstuvwxyz012345";
        let source_url = "https://example.test/large.png";
        let bytes = Bytes::from(vec![7_u8; CACHED_BODY_CHUNK_BYTES * 3]);
        insert_test_image_bytes(&service, id, "device-a", source_url, bytes);

        let response = service.serve_for_owner("device-a", id, false);
        let Ok(response) = response else {
            panic!("cached body should be issued to its owner");
        };
        let mut body = response.into_body().into_data_stream();
        let Some(Ok(first)) = body.next().await else {
            panic!("cached body should yield its first chunk");
        };
        assert_eq!(first.len(), CACHED_BODY_CHUNK_BYTES);

        service.purge_owner("device-a");

        assert!(matches!(body.next().await, Some(Err(_))));
        drop(body);
        assert_eq!(service.transfer_slots.available_permits(), 1);
    }

    #[tokio::test]
    async fn revoking_owner_stops_an_issued_remote_body() {
        let service = MediaProxyService::with_limits(1, 1);
        let permit = service.acquire_transfer_slot();
        let Ok(permit) = permit else {
            panic!("transfer slot should be available");
        };
        let cancellation = service.owner_cancellation("device-a");
        let chunks = stream::iter([
            Ok::<Bytes, io::Error>(Bytes::from_static(b"first")),
            Ok(Bytes::from_static(b"second")),
        ]);
        let body = bounded_stream_body(chunks, permit, 32, Duration::from_secs(1), cancellation);
        let mut body = body.into_data_stream();
        let Some(Ok(first)) = body.next().await else {
            panic!("remote body should yield its first chunk");
        };
        assert_eq!(first, Bytes::from_static(b"first"));

        service.purge_owner("device-a");

        assert!(matches!(body.next().await, Some(Err(_))));
        drop(body);
        assert_eq!(service.transfer_slots.available_permits(), 1);
    }

    #[test]
    fn purge_replaces_owner_lifecycle_for_future_registrations() {
        let service = MediaProxyService::new();
        let old = service.owner_cancellation("device-a");

        service.purge_owner("device-a");
        let current = service.owner_cancellation("device-a");

        assert!(owner_was_revoked(&old));
        assert!(!owner_was_revoked(&current));
    }

    #[test]
    fn purge_owner_removes_only_that_devices_images_and_streams() {
        let service = MediaProxyService::new();
        insert_test_image(
            &service,
            "abcdefghijklmnopqrstuvwxyz012345",
            "device-a",
            "https://example.test/a.png",
        );
        insert_test_image(
            &service,
            "abcdefghijklmnopqrstuvwxyz012346",
            "device-b",
            "https://example.test/b.png",
        );
        let now = unix_time_ms();
        {
            let mut cache = lock_cache(&service.cache);
            let source_url = "https://example.test/a.pdf".to_owned();
            cache.stream_id_by_owner_url.insert(
                ("device-a".to_owned(), source_url.clone()),
                "abcdefghijklmnopqrstuvwxyz012347".to_owned(),
            );
            cache.streams_by_id.insert(
                "abcdefghijklmnopqrstuvwxyz012347".to_owned(),
                RemoteStream {
                    owner: "device-a".to_owned(),
                    source_url,
                    expires_at: now.saturating_add(CACHE_TTL_MS),
                    last_access_at: now,
                },
            );
        }

        service.purge_owner("device-a");

        let cache = lock_cache(&service.cache);
        assert!(cache.by_id.values().all(|image| image.owner != "device-a"));
        assert!(
            cache
                .streams_by_id
                .values()
                .all(|remote| remote.owner != "device-a")
        );
        assert!(cache.by_id.values().any(|image| image.owner == "device-b"));
    }

    fn insert_test_image(service: &MediaProxyService, id: &str, owner: &str, source_url: &str) {
        insert_test_image_bytes(
            service,
            id,
            owner,
            source_url,
            Bytes::from_static(b"\x89PNG\r\n\x1a\nrest"),
        );
    }

    fn insert_test_image_bytes(
        service: &MediaProxyService,
        id: &str,
        owner: &str,
        source_url: &str,
        bytes: Bytes,
    ) {
        let now = unix_time_ms();
        let image = CachedImage {
            owner: owner.to_owned(),
            source_url: source_url.to_owned(),
            bytes,
            content_type: "image/png",
            expires_at: now.saturating_add(CACHE_TTL_MS),
            last_access_at: now,
        };
        let mut cache = lock_cache(&service.cache);
        cache.bytes = cache.bytes.saturating_add(image.bytes.len());
        cache
            .id_by_owner_url
            .insert((owner.to_owned(), source_url.to_owned()), id.to_owned());
        cache.by_id.insert(id.to_owned(), image);
    }
}
