//! `forge.pullRequest.fileContent`: one complete file of a pull request at
//! its head commit, through the contents API in the raw media type.
//!
//! The file is read from the pull request's base repository at the head SHA.
//! A fork's head commit is reachable there too, because GitHub keeps every
//! pull request head under the base repository's `refs/pull/<n>/head`; the
//! account therefore needs no access to the fork. At most
//! [`MAX_FILE_CONTENT_BYTES`] are read; a longer body is never downloaded in
//! full.

use forge_protocol::{FileContent, MAX_FILE_CONTENT_BYTES, PluginError, valid_file_path};

use crate::{
    api::{Api, RawReply},
    repo::PullTarget,
};

/// `forge.pullRequest.fileContent` for one path at a head SHA.
///
/// # Errors
///
/// Returns invalid params for a revision that is not a commit SHA or a path
/// outside the protocol's rules, or the mapped GitHub failure.
pub async fn file_content(
    api: &Api,
    target: &PullTarget,
    head_revision: &str,
    path: &str,
) -> Result<FileContent, PluginError> {
    if !commit_sha(head_revision) {
        return Err(PluginError::invalid_params(
            "headRevision must be a commit SHA",
        ));
    }
    if !valid_file_path(path) {
        return Err(PluginError::invalid_params("invalid path"));
    }
    let reply = api
        .get_raw(
            &target
                .repo
                .path(&format!("/contents/{}", encode_path(path))),
            &[("ref", head_revision.to_owned())],
            MAX_FILE_CONTENT_BYTES,
        )
        .await?;
    Ok(match reply {
        RawReply::Body(bytes) => FileContent::classify(bytes),
        RawReply::NotFound | RawReply::NotRaw => FileContent::Missing,
        RawReply::TooLarge { bytes } => FileContent::TooLarge { bytes },
    })
}

/// A full SHA-1 or SHA-256 commit id in lowercase or uppercase hex.
fn commit_sha(value: &str) -> bool {
    matches!(value.len(), 40 | 64) && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

const HEX_DIGITS: &[u8; 16] = b"0123456789ABCDEF";

/// Percent-encodes every path segment, keeping only RFC 3986 unreserved
/// bytes, so no segment can change the API route. The protocol path is
/// already free of empty, `.` and `..` segments.
fn encode_path(path: &str) -> String {
    let mut encoded = String::with_capacity(path.len());
    for byte in path.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'.' | b'_' | b'~' | b'/') {
            encoded.push(char::from(byte));
        } else {
            encoded.push('%');
            encoded.push(char::from(HEX_DIGITS[usize::from(byte >> 4)]));
            encoded.push(char::from(HEX_DIGITS[usize::from(byte & 0x0f)]));
        }
    }
    encoded
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn paths_are_encoded_per_segment_and_revisions_must_be_shas() {
        assert_eq!(encode_path("src/a b/ü.rs"), "src/a%20b/%C3%BC.rs");
        assert_eq!(encode_path("a?b#c%d"), "a%3Fb%23c%25d");
        assert!(commit_sha(&"a".repeat(40)));
        assert!(commit_sha(&"F".repeat(64)));
        assert!(!commit_sha("main"));
        assert!(!commit_sha(&"g".repeat(40)));
    }
}
