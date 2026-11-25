//! Resolution of a plugin's declared provider icon into the one shape a
//! client renders: an inline monochrome glyph or inline image bytes.
//!
//! Every source is validated here and nowhere else. A glyph keeps only SVG
//! path data in a small `0 0 W H` view box; image bytes must be PNG, WebP or
//! a self-contained SVG whose content matches the declared type, at most
//! [`MAX_ICON_BYTES`]. A file is read from the plugin host; a URL must be
//! `https` without credentials and is fetched by the companion, never by a
//! client, so a device never contacts a third-party host to draw an icon and
//! sees only validated inline data. Anything else resolves to `None`, which
//! clients render as a neutral icon.

use std::{
    path::{Path, PathBuf},
    time::Duration,
};

use base64::{Engine as _, engine::general_purpose::STANDARD};
use forge_protocol::{IconMimeType, MAX_ICON_BYTES, PluginIcon};
use futures_util::StreamExt as _;
use tokio::io::AsyncReadExt as _;

use super::wire::ProviderIconWire;

const MAX_GLYPH_PATH_BYTES: usize = 4 * 1024;
const MAX_VIEW_BOX_SIDE: u32 = 1024;
const FETCH_TIMEOUT: Duration = Duration::from_secs(5);
const MAX_REDIRECTS: usize = 3;

/// The outcome of resolving one declared icon.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum IconResolution {
    /// A usable icon, or a declaration that can never become one (an invalid
    /// glyph, type or size). Either is final for this declaration.
    Settled(Option<ProviderIconWire>),
    /// The source could not be read now (a network failure); the
    /// declaration may be retried later.
    Unavailable,
}

/// Fetches the bytes of an `https` icon URL. Injected so tests can stand in
/// for the network.
#[async_trait::async_trait]
pub trait IconFetcher: Send + Sync {
    /// The response body (at most `MAX_ICON_BYTES + 1` bytes) and its
    /// `Content-Type`, or `None` for a failed request.
    async fn fetch(&self, url: &url::Url) -> Option<FetchedIcon>;
}

pub struct FetchedIcon {
    pub content_type: Option<String>,
    pub bytes: Vec<u8>,
}

/// Resolves a declared icon. `plugin_directory` anchors a relative file.
pub async fn resolve(
    icon: &PluginIcon,
    plugin_directory: Option<&Path>,
    fetcher: &dyn IconFetcher,
) -> IconResolution {
    match icon {
        PluginIcon::Glyph { view_box, path } => IconResolution::Settled(glyph(view_box, path)),
        PluginIcon::Image {
            mime_type,
            data_base64,
        } => IconResolution::Settled(
            STANDARD
                .decode(data_base64)
                .ok()
                .and_then(|bytes| image(*mime_type, &bytes)),
        ),
        PluginIcon::File { path } => {
            IconResolution::Settled(read_file(path, plugin_directory).await)
        }
        PluginIcon::Url { url } => fetch_url(url, fetcher).await,
    }
}

/// A glyph survives only as path commands and numbers, starting with a
/// move, in a `0 0 W H` view box with integer sides of at most 1024.
fn glyph(view_box: &str, path: &str) -> Option<ProviderIconWire> {
    let valid_path = path.starts_with(['M', 'm'])
        && path.len() <= MAX_GLYPH_PATH_BYTES
        && path.bytes().all(|byte| {
            byte.is_ascii_digit()
                || matches!(byte, b' ' | b',' | b'.' | b'-')
                || b"MmLlHhVvCcSsQqTtAaZz".contains(&byte)
        });
    (valid_view_box(view_box) && valid_path).then(|| ProviderIconWire::Glyph {
        view_box: view_box.to_owned(),
        path: path.to_owned(),
    })
}

fn valid_view_box(view_box: &str) -> bool {
    let mut parts = view_box.split(' ');
    let side = |part: Option<&str>| {
        part.filter(|text| !text.starts_with('0') && text.bytes().all(|b| b.is_ascii_digit()))
            .and_then(|text| text.parse::<u32>().ok())
            .is_some_and(|value| (1..=MAX_VIEW_BOX_SIDE).contains(&value))
    };
    parts.next() == Some("0")
        && parts.next() == Some("0")
        && side(parts.next())
        && side(parts.next())
        && parts.next().is_none()
}

/// Image bytes pass only when their content is the declared type.
fn image(mime_type: IconMimeType, bytes: &[u8]) -> Option<ProviderIconWire> {
    if bytes.is_empty() || bytes.len() > MAX_ICON_BYTES {
        return None;
    }
    let matches = match mime_type {
        IconMimeType::Png => bytes.starts_with(b"\x89PNG\r\n\x1a\n"),
        IconMimeType::Webp => {
            bytes.len() > 12 && bytes.starts_with(b"RIFF") && &bytes[8..12] == b"WEBP"
        }
        IconMimeType::Svg => std::str::from_utf8(bytes).is_ok_and(self_contained_svg),
    };
    matches.then(|| ProviderIconWire::Image {
        mime_type,
        data_base64: STANDARD.encode(bytes),
    })
}

/// An SVG document with no script, foreign content, entity declaration or
/// reference outside itself, so drawing it never runs code or contacts a
/// host.
fn self_contained_svg(text: &str) -> bool {
    let lower = text.to_ascii_lowercase();
    let body = lower.trim_start_matches('\u{feff}').trim_start();
    let body = match body.strip_prefix("<?xml") {
        Some(rest) => rest
            .split_once("?>")
            .map_or("", |(_, rest)| rest)
            .trim_start(),
        None => body,
    };
    if !body.starts_with("<svg") {
        return false;
    }
    let forbidden = [
        "<script",
        "<foreignobject",
        "<!doctype",
        "<!entity",
        "<iframe",
        "javascript:",
        "@import",
    ];
    if forbidden.iter().any(|needle| lower.contains(needle)) {
        return false;
    }
    // Event handler attributes (`onload=`, `onclick =`, …).
    let event_handler = lower.match_indices("on").any(|(index, _)| {
        lower[..index]
            .chars()
            .next_back()
            .is_some_and(|before| before.is_ascii_whitespace())
            && lower[index + 2..]
                .trim_start_matches(|c: char| c.is_ascii_alphabetic())
                .trim_start()
                .starts_with('=')
    });
    // Only same-document references: `href="#id"` and `url(#id)`.
    let external_href = lower.match_indices("href").any(|(index, _)| {
        let rest = lower[index + 4..].trim_start();
        let Some(value) = rest.strip_prefix('=') else {
            return false;
        };
        !value
            .trim_start()
            .trim_start_matches(['"', '\''])
            .starts_with('#')
    });
    let external_url = lower.match_indices("url(").any(|(index, _)| {
        !lower[index + 4..]
            .trim_start()
            .trim_start_matches(['"', '\''])
            .starts_with('#')
    });
    !event_handler && !external_href && !external_url
}

/// Reads an icon file: absolute, or relative to the plugin's directory. The
/// extension names the type and the content must match it.
async fn read_file(path: &Path, plugin_directory: Option<&Path>) -> Option<ProviderIconWire> {
    let path: PathBuf = if path.is_absolute() {
        path.to_path_buf()
    } else {
        plugin_directory?.join(path)
    };
    let mime_type = match path
        .extension()
        .and_then(|extension| extension.to_str())?
        .to_ascii_lowercase()
        .as_str()
    {
        "svg" => IconMimeType::Svg,
        "png" => IconMimeType::Png,
        "webp" => IconMimeType::Webp,
        _ => return None,
    };
    let file = tokio::fs::File::open(&path).await.ok()?;
    let metadata = file.metadata().await.ok()?;
    let cap = u64::try_from(MAX_ICON_BYTES).ok()?;
    if !metadata.is_file() || metadata.len() > cap {
        return None;
    }
    let mut bytes = Vec::new();
    file.take(cap + 1).read_to_end(&mut bytes).await.ok()?;
    image(mime_type, &bytes)
}

/// The URL policy: `https`, a host, no credentials.
fn icon_url(candidate: &str) -> Option<url::Url> {
    let url = url::Url::parse(candidate).ok()?;
    (url.scheme() == "https"
        && url.host_str().is_some_and(|host| !host.is_empty())
        && url.username().is_empty()
        && url.password().is_none())
    .then_some(url)
}

async fn fetch_url(candidate: &str, source: &dyn IconFetcher) -> IconResolution {
    let Some(url) = icon_url(candidate) else {
        return IconResolution::Settled(None);
    };
    let Some(fetched) = source.fetch(&url).await else {
        return IconResolution::Unavailable;
    };
    let mime_type = match fetched
        .content_type
        .as_deref()
        .and_then(|value| value.split(';').next())
        .map(|value| value.trim().to_ascii_lowercase())
        .as_deref()
    {
        Some("image/svg+xml") => IconMimeType::Svg,
        Some("image/png") => IconMimeType::Png,
        Some("image/webp") => IconMimeType::Webp,
        _ => return IconResolution::Settled(None),
    };
    IconResolution::Settled(image(mime_type, &fetched.bytes))
}

/// The network fetcher: `https` only (redirects included), a short
/// timeout, and a body cut one byte past the size cap so an oversize icon
/// is rejected without being buffered.
pub struct HttpsIconFetcher {
    client: Option<reqwest::Client>,
}

impl Default for HttpsIconFetcher {
    fn default() -> Self {
        let client = reqwest::Client::builder()
            .timeout(FETCH_TIMEOUT)
            .https_only(true)
            .redirect(reqwest::redirect::Policy::custom(|attempt| {
                if attempt.previous().len() >= MAX_REDIRECTS || attempt.url().scheme() != "https" {
                    attempt.stop()
                } else {
                    attempt.follow()
                }
            }))
            .build()
            .map_err(|error| tracing::warn!(err = %error, "forge icon client unavailable"))
            .ok();
        Self { client }
    }
}

#[async_trait::async_trait]
impl IconFetcher for HttpsIconFetcher {
    async fn fetch(&self, url: &url::Url) -> Option<FetchedIcon> {
        let response = self
            .client
            .as_ref()?
            .get(url.clone())
            .send()
            .await
            .ok()?
            .error_for_status()
            .ok()?;
        let content_type = response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .map(str::to_owned);
        let mut bytes = Vec::new();
        let mut body = response.bytes_stream();
        while let Some(chunk) = body.next().await {
            let chunk = chunk.ok()?;
            let room = (MAX_ICON_BYTES + 1).saturating_sub(bytes.len());
            bytes.extend_from_slice(&chunk[..chunk.len().min(room)]);
            if bytes.len() > MAX_ICON_BYTES {
                break;
            }
        }
        Some(FetchedIcon {
            content_type,
            bytes,
        })
    }
}

#[cfg(test)]
#[allow(clippy::expect_used)]
mod tests {
    use std::sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    };

    use super::*;

    const PNG: &[u8] = b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR";
    const SVG: &str = r#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><defs><linearGradient id="g"/></defs><path fill="url(#g)" d="M0 0h8v8H0z"/></svg>"#;

    struct NoNetwork;

    #[async_trait::async_trait]
    impl IconFetcher for NoNetwork {
        async fn fetch(&self, _url: &url::Url) -> Option<FetchedIcon> {
            None
        }
    }

    struct Canned {
        content_type: &'static str,
        bytes: Vec<u8>,
        calls: Arc<AtomicUsize>,
    }

    #[async_trait::async_trait]
    impl IconFetcher for Canned {
        async fn fetch(&self, _url: &url::Url) -> Option<FetchedIcon> {
            self.calls.fetch_add(1, Ordering::SeqCst);
            Some(FetchedIcon {
                content_type: Some(self.content_type.into()),
                bytes: self.bytes.clone(),
            })
        }
    }

    async fn settled(icon: PluginIcon, directory: Option<&Path>) -> Option<ProviderIconWire> {
        match resolve(&icon, directory, &NoNetwork).await {
            IconResolution::Settled(icon) => icon,
            IconResolution::Unavailable => panic!("only URLs are unavailable"),
        }
    }

    #[tokio::test]
    async fn glyphs_survive_only_as_plain_path_data_in_a_small_view_box() {
        let glyph = |view_box: &str, path: &str| PluginIcon::Glyph {
            view_box: view_box.into(),
            path: path.into(),
        };
        assert_eq!(
            settled(glyph("0 0 16 16", "M2 2L14 14Z"), None).await,
            Some(ProviderIconWire::Glyph {
                view_box: "0 0 16 16".into(),
                path: "M2 2L14 14Z".into()
            })
        );
        for (view_box, path) in [
            ("0 0 24 24", "<script>"),
            ("0 0 24 24", "M2 2 url(#x)"),
            ("0 0 24 24", ""),
            ("0 0 24 24", "L2 2Z"),
            ("0 0 2048 24", "M2 2Z"),
            ("1 0 24 24", "M2 2Z"),
            ("0 0 0 24", "M2 2Z"),
            ("0 0 24", "M2 2Z"),
            ("0 0 24 24 1", "M2 2Z"),
            ("0 0 24.5 24", "M2 2Z"),
        ] {
            assert_eq!(
                settled(glyph(view_box, path), None).await,
                None,
                "{view_box} {path}"
            );
        }
        assert_eq!(
            settled(glyph("0 0 24 24", &"M1 1".repeat(2_000)), None).await,
            None
        );
    }

    #[tokio::test]
    async fn inline_images_must_match_their_declared_type_and_size() {
        let inline = |mime_type, bytes: &[u8]| PluginIcon::Image {
            mime_type,
            data_base64: STANDARD.encode(bytes),
        };
        assert!(matches!(
            settled(inline(IconMimeType::Png, PNG), None).await,
            Some(ProviderIconWire::Image {
                mime_type: IconMimeType::Png,
                ..
            })
        ));
        assert!(
            settled(inline(IconMimeType::Svg, SVG.as_bytes()), None)
                .await
                .is_some()
        );
        assert_eq!(settled(inline(IconMimeType::Webp, PNG), None).await, None);
        assert_eq!(settled(inline(IconMimeType::Svg, PNG), None).await, None);
        let mut large = PNG.to_vec();
        large.resize(MAX_ICON_BYTES + 1, 0);
        assert_eq!(settled(inline(IconMimeType::Png, &large), None).await, None);
        let bad_base64 = PluginIcon::Image {
            mime_type: IconMimeType::Png,
            data_base64: "not base64!".into(),
        };
        assert_eq!(settled(bad_base64, None).await, None);
    }

    #[test]
    fn svg_must_be_self_contained() {
        assert!(self_contained_svg(SVG));
        assert!(self_contained_svg(&format!(
            "<?xml version=\"1.0\"?>\n{SVG}"
        )));
        for unsafe_svg in [
            r"<svg><script>alert(1)</script></svg>",
            r#"<svg onload="x()"></svg>"#,
            "<svg\n\tonclick = \"x()\"></svg>",
            r#"<svg><image href="https://tracker.example/p.png"/></svg>"#,
            r"<svg><image xlink:href = 'http://x/p.png'/></svg>",
            r#"<svg><path style="fill:url(https://x/p)"/></svg>"#,
            r"<svg><foreignObject/></svg>",
            r#"<!DOCTYPE svg [<!ENTITY x "y">]><svg/>"#,
            r"<html><svg/></html>",
        ] {
            assert!(!self_contained_svg(unsafe_svg), "{unsafe_svg}");
        }
    }

    #[tokio::test]
    async fn files_are_read_next_to_the_plugin_with_type_and_size_checked() {
        let directory = tempfile::tempdir().expect("dir");
        std::fs::create_dir(directory.path().join("icons")).expect("icons");
        std::fs::write(directory.path().join("icons/forge.png"), PNG).expect("png");
        std::fs::write(directory.path().join("forge.svg"), SVG).expect("svg");
        std::fs::write(directory.path().join("fake.png"), SVG).expect("fake");
        std::fs::write(directory.path().join("forge.gif"), b"GIF89a").expect("gif");
        std::fs::write(
            directory.path().join("large.png"),
            [PNG, &vec![0; MAX_ICON_BYTES]].concat(),
        )
        .expect("large");
        let file = |path: &str| PluginIcon::File { path: path.into() };
        let plugin = Some(directory.path());

        let relative = settled(file("icons/forge.png"), plugin).await;
        assert_eq!(
            relative,
            Some(ProviderIconWire::Image {
                mime_type: IconMimeType::Png,
                data_base64: STANDARD.encode(PNG)
            })
        );
        let absolute = directory.path().join("forge.svg");
        assert!(
            settled(file(absolute.to_str().expect("utf-8")), None)
                .await
                .is_some()
        );
        assert_eq!(
            settled(file("fake.png"), plugin).await,
            None,
            "content is not PNG"
        );
        assert_eq!(
            settled(file("forge.gif"), plugin).await,
            None,
            "type is not allowed"
        );
        assert_eq!(
            settled(file("large.png"), plugin).await,
            None,
            "over the cap"
        );
        assert_eq!(settled(file("missing.png"), plugin).await, None);
        assert_eq!(settled(file("icons/forge.png"), None).await, None);
    }

    #[tokio::test]
    async fn urls_must_be_https_without_credentials_and_serve_an_allowed_type() {
        let calls = Arc::new(AtomicUsize::new(0));
        let png = Canned {
            content_type: "image/png; charset=binary",
            bytes: PNG.to_vec(),
            calls: calls.clone(),
        };
        let url = |url: &str| PluginIcon::Url { url: url.into() };
        assert!(matches!(
            resolve(&url("https://cdn.example/forge.png"), None, &png).await,
            IconResolution::Settled(Some(ProviderIconWire::Image { .. }))
        ));
        for refused in [
            "http://cdn.example/forge.png",
            "https://user:secret@cdn.example/forge.png",
            "file:///etc/passwd",
            "data:image/png;base64,iVBORw0KGgo=",
            "not a url",
        ] {
            assert_eq!(
                resolve(&url(refused), None, &png).await,
                IconResolution::Settled(None),
                "{refused}"
            );
        }
        assert_eq!(
            calls.load(Ordering::SeqCst),
            1,
            "a refused URL is never fetched"
        );
        let html = Canned {
            content_type: "text/html",
            bytes: b"<html/>".to_vec(),
            calls: calls.clone(),
        };
        assert_eq!(
            resolve(&url("https://cdn.example/forge.png"), None, &html).await,
            IconResolution::Settled(None)
        );
        assert_eq!(
            resolve(&url("https://cdn.example/forge.png"), None, &NoNetwork).await,
            IconResolution::Unavailable
        );
    }
}
