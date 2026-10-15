//! Prompt content of a live session (`host/src/threads/prompt.ts` and
//! `host/src/history/prefix.ts`): neutral user content as Messages API
//! content blocks, and the bounded history prefix offered to a replacement
//! session after Claude lost the thread's session.
//!
//! Text passes through. A `data:` image URL becomes a base64 image block. A
//! local image (a file the companion already prepared on this host) is read
//! from disk, bounded to 20 MiB, and typed by its content signature:
//! companion attachment files carry no extension. Anything that cannot
//! become an image is described in text instead of failing the turn. Reading
//! that file is the only I/O here.

use std::fs::File;
use std::io::Read;

use agent_core::model::UserContent;
use base64::{Engine, engine::general_purpose::STANDARD};
use serde_json::{Value, json};

const MIB: u64 = 1024 * 1024;
/// Largest local image sent inline.
pub const MAX_IMAGE_BYTES: u64 = 20 * MIB;
/// Bound on the history prefix of a replacement session, header included.
pub const HISTORY_PREFIX_MAX_BYTES: usize = 16 * 1024;
/// The first line of a history prefix.
pub const HISTORY_HEADER: &str = "[Historical conversation from this thread]";

/// Image types the Messages API accepts inline.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ImageMediaType {
    Gif,
    Jpeg,
    Png,
    Webp,
}

impl ImageMediaType {
    /// The MIME type.
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Gif => "image/gif",
            Self::Jpeg => "image/jpeg",
            Self::Png => "image/png",
            Self::Webp => "image/webp",
        }
    }

    /// The type a MIME type names, if Claude takes it inline.
    #[must_use]
    pub fn parse(mime: &str) -> Option<Self> {
        [Self::Gif, Self::Jpeg, Self::Png, Self::Webp]
            .into_iter()
            .find(|candidate| candidate.as_str() == mime)
    }

    /// The type of image bytes by their signature.
    #[must_use]
    pub fn sniff(bytes: &[u8]) -> Option<Self> {
        const WEBP_TAG_OFFSET: usize = 8;
        if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
            Some(Self::Png)
        } else if bytes.starts_with(b"\xff\xd8\xff") {
            Some(Self::Jpeg)
        } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
            Some(Self::Gif)
        } else if bytes.starts_with(b"RIFF")
            && bytes
                .get(WEBP_TAG_OFFSET..)
                .is_some_and(|rest| rest.starts_with(b"WEBP"))
        {
            Some(Self::Webp)
        } else {
            None
        }
    }
}

fn text_block(text: &str) -> Value {
    json!({"type": "text", "text": text})
}

fn image_block(media_type: ImageMediaType, data: &str) -> Value {
    json!({"type": "image", "source": {"type": "base64", "media_type": media_type.as_str(), "data": data}})
}

/// The file's bytes when it is at most [`MAX_IMAGE_BYTES`] long.
fn read_bounded(path: &str) -> Option<Vec<u8>> {
    let mut bytes = Vec::new();
    File::open(path)
        .ok()?
        .take(MAX_IMAGE_BYTES + 1)
        .read_to_end(&mut bytes)
        .ok()?;
    (u64::try_from(bytes.len()).ok()? <= MAX_IMAGE_BYTES).then_some(bytes)
}

fn local_image(path: &str) -> Value {
    read_bounded(path)
        .and_then(|bytes| {
            let media_type = ImageMediaType::sniff(&bytes)?;
            Some(image_block(media_type, &STANDARD.encode(bytes)))
        })
        .unwrap_or_else(|| text_block(&format!("[Attached image could not be read: {path}]")))
}

/// `data:<image type>;base64,<data>` with a type Claude takes inline.
fn inline_image(url: &str) -> Option<(ImageMediaType, &str)> {
    let (mime, rest) = url.strip_prefix("data:")?.split_once(';')?;
    Some((ImageMediaType::parse(mime)?, rest.strip_prefix("base64,")?))
}

fn url_image(url: &str) -> Value {
    match inline_image(url) {
        Some((media_type, data)) => image_block(media_type, data),
        None => text_block(&format!("[Attached image: {url}]")),
    }
}

/// The Messages API content blocks of a user message, one per input.
#[must_use]
pub fn prompt_content(input: &[UserContent]) -> Vec<Value> {
    input
        .iter()
        .map(|content| match content {
            UserContent::Text { text } => text_block(text),
            UserContent::Image { url } => url_image(url),
            UserContent::LocalImage { path } => local_image(path),
        })
        .collect()
}

/// The plain text of user content (preview, search, history): its text
/// parts, one per line, trimmed.
#[must_use]
pub fn content_text(input: &[UserContent]) -> String {
    let texts: Vec<&str> = input
        .iter()
        .filter_map(|content| match content {
            UserContent::Text { text } => Some(text.as_str()),
            UserContent::Image { .. } | UserContent::LocalImage { .. } => None,
        })
        .collect();
    texts.join("\n").trim().to_owned()
}

/// The most recent transcript lines (whole lines only) that fit
/// [`HISTORY_PREFIX_MAX_BYTES`] under [`HISTORY_HEADER`], ending in a blank
/// line; `None` when no line fits.
#[must_use]
pub fn history_prefix(lines: &[String]) -> Option<String> {
    let mut bytes = HISTORY_HEADER.len() + 2;
    let kept = lines
        .iter()
        .rev()
        .take_while(|line| {
            let size = line.len() + 1;
            let fits = bytes + size <= HISTORY_PREFIX_MAX_BYTES;
            if fits {
                bytes += size;
            }
            fits
        })
        .count();
    let kept = lines
        .get(lines.len() - kept..)
        .filter(|kept| !kept.is_empty())?;
    Some(format!("{HISTORY_HEADER}\n{}\n\n", kept.join("\n")))
}

#[cfg(test)]
mod tests {
    use std::fs;

    use super::*;

    const JPEG: [u8; 6] = [0xff, 0xd8, 0xff, 0xe1, 0x00, 0x10];

    fn local(path: &std::path::Path) -> Vec<UserContent> {
        vec![UserContent::LocalImage {
            path: path.to_string_lossy().into_owned(),
        }]
    }

    #[test]
    fn types_a_companion_attachment_without_an_extension_by_its_content() {
        let directory = tempfile::tempdir().unwrap_or_else(|_| unreachable!());
        let path = directory.path().join("mv2wp6mz-1ykav8ev-image:9185");
        fs::write(&path, JPEG).unwrap_or_else(|_| unreachable!());
        assert_eq!(
            prompt_content(&local(&path)),
            [
                json!({"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": STANDARD.encode(JPEG)}})
            ]
        );
    }

    #[test]
    fn describes_a_file_that_is_not_a_supported_image_instead_of_failing_the_turn() {
        let directory = tempfile::tempdir().unwrap_or_else(|_| unreachable!());
        let path = directory.path().join("notes.png");
        fs::write(&path, "plain text").unwrap_or_else(|_| unreachable!());
        let missing = directory.path().join("missing.png");
        for path in [path, missing] {
            assert_eq!(
                prompt_content(&local(&path)),
                [
                    json!({"type": "text", "text": format!("[Attached image could not be read: {}]", path.display())})
                ]
            );
        }
    }

    #[test]
    fn refuses_a_local_image_over_the_bound() {
        let directory = tempfile::tempdir().unwrap_or_else(|_| unreachable!());
        let path = directory.path().join("huge");
        let mut bytes = b"\x89PNG\r\n\x1a\n".to_vec();
        bytes.resize(
            usize::try_from(MAX_IMAGE_BYTES).unwrap_or(usize::MAX) + 1,
            0,
        );
        fs::write(&path, bytes).unwrap_or_else(|_| unreachable!());
        assert_eq!(prompt_content(&local(&path))[0]["type"], "text");
    }

    #[test]
    fn sniffs_every_inline_image_type() {
        assert_eq!(
            ImageMediaType::sniff(b"\x89PNG\r\n\x1a\nrest"),
            Some(ImageMediaType::Png)
        );
        assert_eq!(ImageMediaType::sniff(b"GIF87a"), Some(ImageMediaType::Gif));
        assert_eq!(
            ImageMediaType::sniff(b"GIF89a.."),
            Some(ImageMediaType::Gif)
        );
        assert_eq!(
            ImageMediaType::sniff(b"RIFF\0\0\0\0WEBPVP8 "),
            Some(ImageMediaType::Webp)
        );
        assert_eq!(ImageMediaType::sniff(b"RIFF\0\0\0\0WAVE"), None);
        assert_eq!(ImageMediaType::sniff(b"RIFF"), None);
        assert_eq!(ImageMediaType::sniff(b"BM"), None);
    }

    #[test]
    fn maps_text_and_data_urls_and_describes_other_urls() {
        let content = [
            UserContent::Text { text: "hi".into() },
            UserContent::Image {
                url: "data:image/png;base64,AAAA".into(),
            },
            UserContent::Image {
                url: "data:image/bmp;base64,AAAA".into(),
            },
            UserContent::Image {
                url: "https://e.com/a.png".into(),
            },
        ];
        assert_eq!(
            prompt_content(&content),
            [
                json!({"type": "text", "text": "hi"}),
                json!({"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": "AAAA"}}),
                json!({"type": "text", "text": "[Attached image: data:image/bmp;base64,AAAA]"}),
                json!({"type": "text", "text": "[Attached image: https://e.com/a.png]"}),
            ]
        );
        assert_eq!(
            content_text(&[
                UserContent::Text { text: " a".into() },
                UserContent::Image { url: "x".into() },
                UserContent::Text { text: "b\n".into() },
            ]),
            "a\nb"
        );
    }

    #[test]
    fn keeps_the_most_recent_whole_lines_under_the_bound() {
        let lines: Vec<String> = (0..400)
            .map(|index| format!("User: message {index} {}", "x".repeat(80)))
            .collect();
        let prefix = history_prefix(&lines).unwrap_or_default();
        assert!(prefix.len() <= HISTORY_PREFIX_MAX_BYTES);
        assert!(prefix.starts_with("[Historical conversation from this thread]\n"));
        assert!(prefix.ends_with("x\n\n"));
        assert!(prefix.contains("message 399"));
        assert!(!prefix.contains("message 0 "));
        assert!(history_prefix(&[]).is_none());
        assert!(history_prefix(&["x".repeat(HISTORY_PREFIX_MAX_BYTES)]).is_none());
        assert_eq!(
            history_prefix(&["a".into(), "b".into()]).as_deref(),
            Some("[Historical conversation from this thread]\na\nb\n\n")
        );
    }
}
