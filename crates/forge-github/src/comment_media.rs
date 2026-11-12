//! Directly loadable URLs for the images a comment body references.
//!
//! GitHub renders a comment's Markdown into `bodyHTML`, replacing each
//! attachment URL (`https://github.com/user-attachments/assets/<uuid>`, the
//! older `/<owner>/<repo>/assets/<id>/<uuid>` form, or a pasted
//! `private-user-images` URL) with a short-lived signed
//! `private-user-images.githubusercontent.com/...?jwt=…` URL that needs no
//! credential. This module pairs every GitHub image URL of the Markdown with
//! its rendered URL by the attachment's UUID, so a client can fetch it
//! directly. Public `user-images` URLs, and `raw.githubusercontent.com` URLs
//! of a public repository, are rendered unchanged and stay direct.
//!
//! An image without a pairing gets no entry and keeps the
//! `forge.media.read` path. The plugin's token is never part of a URL here:
//! every URL comes from GitHub's own rendering, and a rendered URL carrying a
//! `token` parameter is refused.

use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use forge_protocol::CommentMedia;
use serde_json::Value;
use time::{OffsetDateTime, format_description::well_known::Rfc3339};
use url::Url;

/// The most entries one comment carries.
pub const MAX_COMMENT_MEDIA: usize = 32;
const MAX_SOURCE_CHARS: usize = 2_048;
const SIGNED_HOST: &str = "private-user-images.githubusercontent.com";
const PUBLIC_USER_IMAGES_HOST: &str = "user-images.githubusercontent.com";
const RAW_HOST: &str = "raw.githubusercontent.com";
/// GitHub's public avatar host; its URLs need no credential.
pub const AVATAR_HOST: &str = "avatars.githubusercontent.com";

/// What the rendering of one comment may be trusted for.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct MediaScope {
    /// The repository is public, so its `raw.githubusercontent.com` URLs
    /// load without a credential.
    pub public_repository: bool,
}

impl MediaScope {
    /// No repository content is assumed public.
    pub const PRIVATE: Self = Self {
        public_repository: false,
    };
}

/// One `<img>` of the rendered HTML.
struct RenderedImage {
    src: String,
}

/// Pairs the GitHub image URLs of `body` with their rendered URLs in
/// `body_html`, in order of first appearance, at most
/// [`MAX_COMMENT_MEDIA`].
#[must_use]
pub fn comment_media(body: &str, body_html: &str, scope: MediaScope) -> Vec<CommentMedia> {
    if body_html.is_empty() {
        return Vec::new();
    }
    let rendered = rendered_images(body_html);
    let mut media: Vec<CommentMedia> = Vec::new();
    for source in source_urls(body) {
        if media.len() == MAX_COMMENT_MEDIA {
            break;
        }
        if media.iter().any(|entry| entry.source == source) {
            continue;
        }
        if let Some(entry) = pair(&source, &rendered, scope) {
            media.push(entry);
        }
    }
    media
}

/// Whether an avatar URL loads without a credential.
#[must_use]
pub fn avatar_is_direct(avatar_url: &str) -> bool {
    Url::parse(avatar_url).is_ok_and(|url| {
        url.scheme() == "https"
            && url.host_str() == Some(AVATAR_HOST)
            && url.port().is_none()
            && url.username().is_empty()
            && url.password().is_none()
            && !carries_credential(&url)
    })
}

fn pair(source: &str, rendered: &[RenderedImage], scope: MediaScope) -> Option<CommentMedia> {
    let parsed = Url::parse(source).ok()?;
    if let Some(uuid) = attachment_uuid(&parsed) {
        return rendered
            .iter()
            .find_map(|image| signed(image, uuid, source));
    }
    let public_host = match parsed.host_str()? {
        PUBLIC_USER_IMAGES_HOST => true,
        RAW_HOST => scope.public_repository,
        _ => false,
    };
    (public_host
        && !carries_credential(&parsed)
        && rendered.iter().any(|image| image.src == source))
    .then(|| CommentMedia {
        source: source.to_owned(),
        url: source.to_owned(),
        expires_at: None,
    })
}

/// A rendered signed URL of the attachment `uuid`, with the expiry of its
/// signature.
fn signed(image: &RenderedImage, uuid: &str, source: &str) -> Option<CommentMedia> {
    let url = Url::parse(&image.src).ok()?;
    if url.scheme() != "https"
        || url.host_str() != Some(SIGNED_HOST)
        || url.port().is_some()
        || !url.username().is_empty()
        || url.password().is_some()
        || !url.path().contains(uuid)
        || url.query_pairs().any(|(name, _)| name == "token")
    {
        return None;
    }
    let jwt = url
        .query_pairs()
        .find_map(|(name, value)| (name == "jwt").then(|| value.into_owned()))?;
    Some(CommentMedia {
        source: source.to_owned(),
        url: image.src.clone(),
        expires_at: Some(jwt_expiry(&jwt)?),
    })
}

/// The `exp` claim of an unverified JWT as RFC 3339. The signature is
/// GitHub's to check; the client only uses the time to skip a URL that has
/// already expired.
fn jwt_expiry(jwt: &str) -> Option<String> {
    let payload = jwt.split('.').nth(1)?;
    let claims: Value = serde_json::from_slice(&URL_SAFE_NO_PAD.decode(payload).ok()?).ok()?;
    let expiry = OffsetDateTime::from_unix_timestamp(claims.get("exp")?.as_i64()?).ok()?;
    expiry.format(&Rfc3339).ok()
}

/// The UUID that names a GitHub attachment, for URLs GitHub re-signs when
/// rendering.
fn attachment_uuid(url: &Url) -> Option<&str> {
    let host = url.host_str()?;
    let segments: Vec<&str> = url.path_segments()?.collect();
    let attachment = matches!(
        (host, segments.as_slice()),
        (
            "github.com",
            ["user-attachments", "assets", _] | [_, _, "assets", _, _]
        ) | (SIGNED_HOST, _)
    );
    if !attachment {
        return None;
    }
    segments.last().and_then(|last| find_uuid(last))
}

/// The first `8-4-4-4-12` lowercase hexadecimal UUID in `text`.
fn find_uuid(text: &str) -> Option<&str> {
    const SHAPE: [usize; 5] = [8, 4, 4, 4, 12];
    const LEN: usize = 36;
    let bytes = text.as_bytes();
    (0..=bytes.len().checked_sub(LEN)?).find_map(|start| {
        let candidate = text.get(start..start + LEN)?;
        let mut groups = candidate.split('-');
        let shaped = SHAPE.iter().all(|&len| {
            groups.next().is_some_and(|group| {
                group.len() == len
                    && group
                        .bytes()
                        .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
            })
        }) && groups.next().is_none();
        shaped.then_some(candidate)
    })
}

fn carries_credential(url: &Url) -> bool {
    url.query_pairs()
        .any(|(name, _)| matches!(name.as_ref(), "token" | "jwt"))
}

/// Every `https://` URL of the Markdown source, as written.
fn source_urls(body: &str) -> impl Iterator<Item = String> + '_ {
    body.match_indices("https://").filter_map(|(start, _)| {
        let rest = body.get(start..)?;
        let end = rest
            .find(|character: char| {
                character.is_whitespace()
                    || matches!(character, ')' | '(' | '"' | '\'' | '<' | '>' | '[' | ']')
            })
            .unwrap_or(rest.len());
        let candidate = rest.get(..end)?;
        (candidate.len() <= MAX_SOURCE_CHARS).then(|| candidate.to_owned())
    })
}

/// The `src` of every `<img>` in GitHub's rendered HTML, entities decoded.
fn rendered_images(html: &str) -> Vec<RenderedImage> {
    let lower = html.to_ascii_lowercase();
    lower
        .match_indices("<img")
        .filter_map(|(start, _)| {
            let tag_end = start + lower.get(start..)?.find('>')?;
            let tag = html.get(start..tag_end)?;
            attribute(tag, "src").map(|src| RenderedImage { src })
        })
        .collect()
}

/// A double-quoted attribute of one tag, as GitHub's renderer writes them.
fn attribute(tag: &str, name: &str) -> Option<String> {
    let needle = format!(" {name}=\"");
    let lower = tag.to_ascii_lowercase();
    let start = lower.find(&needle)? + needle.len();
    let end = start + tag.get(start..)?.find('"')?;
    Some(unescape(tag.get(start..end)?))
}

fn unescape(value: &str) -> String {
    value
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&amp;", "&")
}

#[cfg(test)]
#[allow(clippy::expect_used)]
mod tests {
    use super::*;

    const UUID_A: &str = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
    const UUID_B: &str = "11111111-2222-4333-8444-555555555555";
    const EXPIRES: &str = "2026-09-21T14:13:20Z";

    /// An unsigned `{"alg":"none"}` JWT expiring at `EXPIRES`, encoded from its
    /// claims so the fixture is visibly not a credential.
    fn unsigned_jwt() -> String {
        let header = URL_SAFE_NO_PAD.encode(r#"{"alg":"none"}"#);
        let claims = URL_SAFE_NO_PAD.encode(r#"{"exp":1790000000}"#);
        format!("{header}.{claims}.")
    }

    fn signed_url(uuid: &str) -> String {
        format!(
            "https://{SIGNED_HOST}/1/2-{uuid}.png?jwt={}",
            unsigned_jwt()
        )
    }

    fn rendered_img(src: &str) -> String {
        format!(
            r#"<img width="10" alt="shot" src="{}" style="max-width: 100%">"#,
            src.replace('&', "&amp;")
        )
    }

    #[test]
    fn one_attachment_pairs_with_its_signed_url() {
        let source = format!("https://github.com/user-attachments/assets/{UUID_A}");
        let body = format!("Look ![shot]({source}) here");
        let html = format!("<p>Look {} here</p>", rendered_img(&signed_url(UUID_A)));
        assert_eq!(
            comment_media(&body, &html, MediaScope::PRIVATE),
            [CommentMedia {
                source,
                url: signed_url(UUID_A),
                expires_at: Some(EXPIRES.into()),
            }]
        );
    }

    #[test]
    fn several_attachments_pair_by_uuid_not_by_order() {
        let first = format!("https://github.com/user-attachments/assets/{UUID_A}");
        let second = format!("https://github.com/o/r/assets/7/{UUID_B}");
        let body = format!(
            "<img width=\"5\" src=\"{first}\">\n\n![second]({second})\n\n![again]({first})"
        );
        // Rendered in the opposite order, entities escaped.
        let html = format!(
            "{}{}",
            rendered_img(&signed_url(UUID_B)),
            rendered_img(&signed_url(UUID_A))
        );
        let media = comment_media(&body, &html, MediaScope::PRIVATE);
        let pairs: Vec<(&str, &str)> = media
            .iter()
            .map(|entry| (entry.source.as_str(), entry.url.as_str()))
            .collect();
        let (signed_a, signed_b) = (signed_url(UUID_A), signed_url(UUID_B));
        assert_eq!(
            pairs,
            [
                (first.as_str(), signed_a.as_str()),
                (second.as_str(), signed_b.as_str())
            ],
            "each source once, with its own signed URL"
        );
    }

    #[test]
    fn a_link_wrapped_image_pairs_once() {
        let source = format!("https://github.com/user-attachments/assets/{UUID_A}");
        let body = format!("[![shot]({source})]({source})");
        let signed = signed_url(UUID_A).replace('&', "&amp;");
        let html =
            format!(r#"<a target="_blank" href="{signed}"><img src="{signed}" alt="shot"></a>"#);
        let media = comment_media(&body, &html, MediaScope::PRIVATE);
        assert_eq!(media.len(), 1);
        assert_eq!(media[0].source, source);
        assert_eq!(media[0].url, signed_url(UUID_A));
    }

    #[test]
    fn an_attachment_without_a_signed_rendering_has_no_entry() {
        let source = format!("https://github.com/user-attachments/assets/{UUID_A}");
        let body = format!("![gif]({source})");
        // GitHub sometimes keeps the original URL (animated images).
        let unsigned = format!(r#"<img src="{source}" data-animated-image="">"#);
        assert!(comment_media(&body, &unsigned, MediaScope::PRIVATE).is_empty());
        // A signed URL of another attachment does not pair.
        let other = rendered_img(&signed_url(UUID_B));
        assert!(comment_media(&body, &other, MediaScope::PRIVATE).is_empty());
        // A rendered URL carrying a token parameter is never handed out.
        let tokened = rendered_img(&format!("{}&token=x", signed_url(UUID_A)));
        assert!(comment_media(&body, &tokened, MediaScope::PRIVATE).is_empty());
        // No rendering at all.
        assert!(comment_media(&body, "", MediaScope::PRIVATE).is_empty());
    }

    #[test]
    fn non_github_images_have_no_entry() {
        let body = "![x](https://example.com/a.png) ![y](https://camo.githubusercontent.com/abc)";
        let html = format!(
            "{}{}",
            rendered_img("https://camo.githubusercontent.com/abc"),
            rendered_img("https://example.com/a.png")
        );
        assert!(comment_media(body, &html, MediaScope::PRIVATE).is_empty());
    }

    #[test]
    fn public_hosts_stay_direct_only_when_rendered_unchanged() {
        let legacy = "https://user-images.githubusercontent.com/1/2.png";
        let raw = "https://raw.githubusercontent.com/o/r/main/a.png";
        let body = format!("![a]({legacy}) ![b]({raw})");
        let html = format!("{}{}", rendered_img(legacy), rendered_img(raw));
        let private: Vec<String> = comment_media(&body, &html, MediaScope::PRIVATE)
            .into_iter()
            .map(|entry| entry.url)
            .collect();
        assert_eq!(
            private,
            [legacy],
            "raw URLs of a private repository need a credential"
        );
        let public = comment_media(
            &body,
            &html,
            MediaScope {
                public_repository: true,
            },
        );
        assert_eq!(public.len(), 2);
        assert!(public.iter().all(|entry| entry.expires_at.is_none()));
    }

    #[test]
    fn avatars_are_direct_only_on_the_public_avatar_host() {
        assert!(avatar_is_direct(
            "https://avatars.githubusercontent.com/u/1?u=abc&v=4"
        ));
        assert!(!avatar_is_direct("https://ghe.example/avatars/u/1"));
        assert!(!avatar_is_direct(
            "https://avatars.githubusercontent.com/u/1?token=x"
        ));
        assert!(!avatar_is_direct(
            "http://avatars.githubusercontent.com/u/1"
        ));
    }
}
