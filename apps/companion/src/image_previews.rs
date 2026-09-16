use std::{
    collections::HashMap,
    fs::File,
    io::{BufRead, BufReader, Cursor, Seek},
    path::PathBuf,
    sync::{Arc, Mutex},
};

use axum::{
    body::Body,
    http::{HeaderMap, Response, StatusCode, header},
    response::IntoResponse,
};
use bytes::Bytes;
use image::{GenericImageView, ImageReader, Limits, imageops::FilterType};
use serde::Deserialize;
use serde_json::json;
use tokio::sync::Semaphore;

const MAX_SOURCE_BYTES: usize = 32 * 1024 * 1024;
const MAX_DECODE_DIMENSION: u32 = 16_384;
const MAX_DECODE_ALLOC_BYTES: u64 = 128 * 1024 * 1024;
const MAX_CACHE_BYTES: usize = 16 * 1024 * 1024;
const MAX_CACHE_ENTRIES: usize = 128;
const MAX_CONCURRENT_ENCODERS: usize = 4;
// Bump whenever dimensions, quality, filtering, or the encoder change output bytes.
const ENCODER_RECIPE_VERSION: &str = "webp-v1";

#[derive(Clone)]
pub struct ImagePreviewService {
    cache: Arc<Mutex<PreviewCache>>,
    encoders: Arc<Semaphore>,
}

#[derive(Default)]
struct PreviewCache {
    entries: HashMap<PreviewKey, CachedPreview>,
    bytes: usize,
    clock: u64,
}

#[derive(Clone, Debug, Eq, Hash, PartialEq)]
struct PreviewKey {
    source: String,
    variant: ImageVariant,
}

#[derive(Clone)]
struct CachedPreview {
    bytes: Bytes,
    etag: String,
    height: u32,
    last_access: u64,
    width: u32,
}

enum PreviewSource {
    Bytes(Bytes),
    Path(PathBuf),
    Shared(Arc<[u8]>),
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, Hash, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum ImageVariant {
    Preview,
    Detail,
}

#[derive(Clone, Copy, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImagePreviewQuery {
    pub variant: Option<ImageVariant>,
}

#[derive(Debug, thiserror::Error)]
pub enum ImagePreviewError {
    #[error("image_too_large")]
    TooLarge,
    #[error("unsupported_image")]
    Unsupported,
    #[error("image_preview_capacity_exceeded")]
    Capacity,
    #[error("image_preview_failed")]
    Processing,
    #[error(transparent)]
    Io(#[from] std::io::Error),
}

impl Default for ImagePreviewService {
    fn default() -> Self {
        Self::new()
    }
}

impl ImagePreviewService {
    #[must_use]
    pub fn new() -> Self {
        Self {
            cache: Arc::new(Mutex::new(PreviewCache::default())),
            encoders: Arc::new(Semaphore::new(MAX_CONCURRENT_ENCODERS)),
        }
    }

    /// Creates or reuses a bounded WebP preview for one resolved host file.
    ///
    /// # Errors
    ///
    /// Returns a stable error for unsupported, oversized, saturated, or unreadable inputs.
    pub async fn preview_file(
        &self,
        source_key: String,
        path: PathBuf,
        variant: ImageVariant,
        headers: &HeaderMap,
        head_only: bool,
    ) -> Result<Response<Body>, ImagePreviewError> {
        let key = PreviewKey {
            source: source_key,
            variant,
        };
        if let Some(response) = conditional_response(&key, headers) {
            return response;
        }
        if let Some(preview) = self.cached(&key) {
            return preview_response(preview, headers, head_only);
        }
        let _permit = self
            .encoders
            .clone()
            .acquire_owned()
            .await
            .map_err(|_| ImagePreviewError::Capacity)?;
        if let Some(preview) = self.cached(&key) {
            return preview_response(preview, headers, head_only);
        }
        let metadata = tokio::fs::metadata(&path).await?;
        if usize::try_from(metadata.len()).map_or(true, |size| size > MAX_SOURCE_BYTES) {
            return Err(ImagePreviewError::TooLarge);
        }
        self.generate(key, PreviewSource::Path(path), headers, head_only)
            .await
    }

    /// Creates or reuses a bounded WebP preview for immutable private bytes.
    ///
    /// # Errors
    ///
    /// Returns a stable error for unsupported, oversized, saturated, or invalid inputs.
    pub async fn preview_bytes(
        &self,
        source_key: String,
        bytes: Bytes,
        variant: ImageVariant,
        headers: &HeaderMap,
        head_only: bool,
    ) -> Result<Response<Body>, ImagePreviewError> {
        if bytes.len() > MAX_SOURCE_BYTES {
            return Err(ImagePreviewError::TooLarge);
        }
        let key = PreviewKey {
            source: source_key,
            variant,
        };
        if let Some(response) = conditional_response(&key, headers) {
            return response;
        }
        if let Some(preview) = self.cached(&key) {
            return preview_response(preview, headers, head_only);
        }
        let _permit = self
            .encoders
            .clone()
            .acquire_owned()
            .await
            .map_err(|_| ImagePreviewError::Capacity)?;
        if let Some(preview) = self.cached(&key) {
            return preview_response(preview, headers, head_only);
        }
        self.generate(key, PreviewSource::Bytes(bytes), headers, head_only)
            .await
    }

    /// Creates or reuses a bounded WebP preview without copying content-store bytes.
    ///
    /// # Errors
    ///
    /// Returns a stable error for unsupported, oversized, saturated, or invalid inputs.
    pub(crate) async fn preview_shared_bytes(
        &self,
        source_key: String,
        bytes: Arc<[u8]>,
        variant: ImageVariant,
        headers: &HeaderMap,
        head_only: bool,
    ) -> Result<Response<Body>, ImagePreviewError> {
        if bytes.len() > MAX_SOURCE_BYTES {
            return Err(ImagePreviewError::TooLarge);
        }
        let key = PreviewKey {
            source: source_key,
            variant,
        };
        if let Some(response) = conditional_response(&key, headers) {
            return response;
        }
        if let Some(preview) = self.cached(&key) {
            return preview_response(preview, headers, head_only);
        }
        let _permit = self
            .encoders
            .clone()
            .acquire_owned()
            .await
            .map_err(|_| ImagePreviewError::Capacity)?;
        if let Some(preview) = self.cached(&key) {
            return preview_response(preview, headers, head_only);
        }
        self.generate(key, PreviewSource::Shared(bytes), headers, head_only)
            .await
    }

    pub(crate) fn purge_media_owner(&self, owner: &str) {
        let prefix = format!("media:{owner}:");
        let mut cache = lock_cache(&self.cache);
        let removed_bytes = cache
            .entries
            .iter()
            .filter(|(key, _)| key.source.starts_with(&prefix))
            .map(|(_, preview)| preview.bytes.len())
            .sum::<usize>();
        cache
            .entries
            .retain(|key, _| !key.source.starts_with(&prefix));
        cache.bytes = cache.bytes.saturating_sub(removed_bytes);
    }

    async fn generate(
        &self,
        key: PreviewKey,
        source: PreviewSource,
        headers: &HeaderMap,
        head_only: bool,
    ) -> Result<Response<Body>, ImagePreviewError> {
        let variant = key.variant;
        let etag = preview_etag(&key);
        let mut preview = tokio::task::spawn_blocking(move || encode_webp(source, variant))
            .await
            .map_err(|_| ImagePreviewError::Processing)??;
        preview.etag = etag;
        self.remember(key, preview.clone());
        preview_response(preview, headers, head_only)
    }

    fn cached(&self, key: &PreviewKey) -> Option<CachedPreview> {
        let mut cache = lock_cache(&self.cache);
        cache.clock = cache.clock.saturating_add(1);
        let clock = cache.clock;
        let preview = cache.entries.get_mut(key)?;
        preview.last_access = clock;
        Some(preview.clone())
    }

    fn remember(&self, key: PreviewKey, mut preview: CachedPreview) {
        if preview.bytes.len() > MAX_CACHE_BYTES {
            return;
        }
        let mut cache = lock_cache(&self.cache);
        cache.clock = cache.clock.saturating_add(1);
        preview.last_access = cache.clock;
        make_room(&mut cache, preview.bytes.len());
        if let Some(replaced) = cache.entries.insert(key, preview.clone()) {
            cache.bytes = cache.bytes.saturating_sub(replaced.bytes.len());
        }
        cache.bytes = cache.bytes.saturating_add(preview.bytes.len());
    }
}

impl IntoResponse for ImagePreviewError {
    fn into_response(self) -> Response<Body> {
        let (status, code) = match self {
            Self::TooLarge => (StatusCode::PAYLOAD_TOO_LARGE, "image_too_large"),
            Self::Unsupported => (StatusCode::UNSUPPORTED_MEDIA_TYPE, "unsupported_image"),
            Self::Capacity => (
                StatusCode::TOO_MANY_REQUESTS,
                "image_preview_capacity_exceeded",
            ),
            Self::Processing | Self::Io(_) => {
                (StatusCode::INTERNAL_SERVER_ERROR, "image_preview_failed")
            }
        };
        (status, axum::Json(json!({"error": code}))).into_response()
    }
}

fn encode_webp(
    source: PreviewSource,
    variant: ImageVariant,
) -> Result<CachedPreview, ImagePreviewError> {
    match source {
        PreviewSource::Bytes(bytes) => {
            encode_webp_reader(ImageReader::new(Cursor::new(bytes)), variant)
        }
        PreviewSource::Path(path) => {
            encode_webp_reader(ImageReader::new(BufReader::new(File::open(path)?)), variant)
        }
        PreviewSource::Shared(bytes) => {
            encode_webp_reader(ImageReader::new(Cursor::new(bytes)), variant)
        }
    }
}

fn encode_webp_reader<R: BufRead + Seek>(
    reader: ImageReader<R>,
    variant: ImageVariant,
) -> Result<CachedPreview, ImagePreviewError> {
    let mut reader = reader
        .with_guessed_format()
        .map_err(|_| ImagePreviewError::Unsupported)?;
    let mut limits = Limits::default();
    limits.max_image_width = Some(MAX_DECODE_DIMENSION);
    limits.max_image_height = Some(MAX_DECODE_DIMENSION);
    limits.max_alloc = Some(MAX_DECODE_ALLOC_BYTES);
    reader.limits(limits);
    let image = reader
        .decode()
        .map_err(|_| ImagePreviewError::Unsupported)?;
    let (max_dimension, quality, filter) = match variant {
        ImageVariant::Preview => (640, 78.0, FilterType::Triangle),
        ImageVariant::Detail => (2_560, 84.0, FilterType::CatmullRom),
    };
    let resized = if image.width() > max_dimension || image.height() > max_dimension {
        image.resize(max_dimension, max_dimension, filter)
    } else {
        image
    };
    let (width, height) = resized.dimensions();
    if width == 0 || height == 0 {
        return Err(ImagePreviewError::Unsupported);
    }
    let rgba = resized.into_rgba8();
    let encoded = webp::Encoder::from_rgba(rgba.as_raw(), width, height)
        .encode_simple(false, quality)
        .map_err(|_| ImagePreviewError::Processing)?;
    let bytes = Bytes::copy_from_slice(&encoded);
    Ok(CachedPreview {
        bytes,
        etag: String::new(),
        height,
        last_access: 0,
        width,
    })
}

fn preview_etag(key: &PreviewKey) -> String {
    let variant = match key.variant {
        ImageVariant::Preview => "preview",
        ImageVariant::Detail => "detail",
    };
    let revision =
        blake3::hash(format!("{ENCODER_RECIPE_VERSION}:{}:{variant}", key.source).as_bytes());
    format!("\"webp-{revision}\"")
}

fn conditional_response(
    key: &PreviewKey,
    headers: &HeaderMap,
) -> Option<Result<Response<Body>, ImagePreviewError>> {
    let etag = preview_etag(key);
    let matches = headers
        .get(header::IF_NONE_MATCH)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| {
            value == "*" || value.split(',').any(|candidate| candidate.trim() == etag)
        });
    matches.then(|| {
        Response::builder()
            .status(StatusCode::NOT_MODIFIED)
            .header(header::CONTENT_TYPE, "image/webp")
            .header(header::CACHE_CONTROL, "private, max-age=300")
            .header(header::ETAG, etag)
            .body(Body::empty())
            .map_err(|_| ImagePreviewError::Processing)
    })
}

fn preview_response(
    preview: CachedPreview,
    headers: &HeaderMap,
    head_only: bool,
) -> Result<Response<Body>, ImagePreviewError> {
    let not_modified = headers
        .get(header::IF_NONE_MATCH)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| {
            value == "*"
                || value
                    .split(',')
                    .any(|candidate| candidate.trim() == preview.etag)
        });
    let mut response = Response::builder()
        .status(if not_modified {
            StatusCode::NOT_MODIFIED
        } else {
            StatusCode::OK
        })
        .header(header::CONTENT_TYPE, "image/webp")
        .header(header::CACHE_CONTROL, "private, max-age=300")
        .header(header::ETAG, &preview.etag)
        .header("x-image-width", preview.width)
        .header("x-image-height", preview.height)
        .header("content-security-policy", "default-src 'none'; sandbox")
        .header("x-content-type-options", "nosniff")
        .header("referrer-policy", "no-referrer");
    if !not_modified {
        response = response.header(header::CONTENT_LENGTH, preview.bytes.len());
    }
    response
        .body(if head_only || not_modified {
            Body::empty()
        } else {
            Body::from(preview.bytes)
        })
        .map_err(|_| ImagePreviewError::Processing)
}

fn make_room(cache: &mut PreviewCache, incoming: usize) {
    while (!cache.entries.is_empty())
        && (cache.bytes.saturating_add(incoming) > MAX_CACHE_BYTES
            || cache.entries.len() >= MAX_CACHE_ENTRIES)
    {
        let Some(oldest) = cache
            .entries
            .iter()
            .min_by_key(|(_, preview)| preview.last_access)
            .map(|(key, _)| key.clone())
        else {
            break;
        };
        if let Some(removed) = cache.entries.remove(&oldest) {
            cache.bytes = cache.bytes.saturating_sub(removed.bytes.len());
        }
    }
}

fn lock_cache(cache: &Mutex<PreviewCache>) -> std::sync::MutexGuard<'_, PreviewCache> {
    cache
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

#[cfg(test)]
#[allow(clippy::expect_used)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn creates_distinct_bounded_webp_variants() -> Result<(), Box<dyn std::error::Error>> {
        let source = image::DynamicImage::ImageRgba8(image::RgbaImage::from_pixel(
            1_600,
            1_200,
            image::Rgba([12, 34, 56, 255]),
        ));
        let mut png = Cursor::new(Vec::new());
        source.write_to(&mut png, image::ImageFormat::Png)?;
        let png = Bytes::from(png.into_inner());
        let service = ImagePreviewService::new();
        let preview = service
            .preview_bytes(
                "content:test".into(),
                png.clone(),
                ImageVariant::Preview,
                &HeaderMap::new(),
                false,
            )
            .await?;
        assert_eq!(preview.status(), StatusCode::OK);
        assert_eq!(preview.headers()[header::CONTENT_TYPE], "image/webp");
        assert_eq!(preview.headers()["x-image-width"], "640");
        assert_eq!(preview.headers()["x-image-height"], "480");
        let etag = preview.headers()[header::ETAG].clone();
        let mut conditional = HeaderMap::new();
        conditional.insert(header::IF_NONE_MATCH, etag);
        let cached = service
            .preview_bytes(
                "content:test".into(),
                Bytes::new(),
                ImageVariant::Preview,
                &conditional,
                false,
            )
            .await?;
        assert_eq!(cached.status(), StatusCode::NOT_MODIFIED);
        let cold_service = ImagePreviewService::new();
        let cold_cached = cold_service
            .preview_bytes(
                "content:test".into(),
                Bytes::new(),
                ImageVariant::Preview,
                &conditional,
                false,
            )
            .await?;
        assert_eq!(cold_cached.status(), StatusCode::NOT_MODIFIED);

        service
            .preview_bytes(
                "media:device-a:test".into(),
                png,
                ImageVariant::Preview,
                &HeaderMap::new(),
                false,
            )
            .await?;
        service.purge_media_owner("device-a");
        let removed = service
            .preview_bytes(
                "media:device-a:test".into(),
                Bytes::new(),
                ImageVariant::Preview,
                &HeaderMap::new(),
                false,
            )
            .await;
        assert!(matches!(removed, Err(ImagePreviewError::Unsupported)));
        Ok(())
    }
}
