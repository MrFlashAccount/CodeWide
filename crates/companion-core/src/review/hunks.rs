//! Hunk identity over unified-diff patches, independent of any forge.
//!
//! `HunkId` is `<repo-relative path>#h<1-based ordinal>`, scoped to one diff
//! source revision. `HunkFingerprint` is a blake3 hex hash of the hunk's
//! normalized `+` and `-` lines, without line numbers or context, so a hunk
//! that only moved keeps its fingerprint across revisions. Android anchors by
//! line range, never by its own hunk index, so a parser difference cannot
//! misplace a stop.

use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(transparent)]
pub struct HunkId(String);

impl HunkId {
    #[must_use]
    pub fn new(path: &str, ordinal: usize) -> Self {
        Self(format!("{path}#h{ordinal}"))
    }

    /// Brands a client value of the `<path>#h<n>` shape.
    #[must_use]
    pub fn parse(value: &str) -> Option<Self> {
        let (path, ordinal) = value.rsplit_once("#h")?;
        (!path.is_empty()
            && value.len() <= 4_096
            && !value.chars().any(char::is_control)
            && ordinal.parse::<usize>().is_ok_and(|ordinal| ordinal > 0))
        .then(|| Self(value.to_owned()))
    }

    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

#[derive(Clone, Debug, Deserialize, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(transparent)]
pub struct HunkFingerprint(String);

impl HunkFingerprint {
    #[must_use]
    pub fn parse(value: &str) -> Option<Self> {
        (value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit()))
            .then(|| Self(value.to_ascii_lowercase()))
    }

    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Hunk {
    pub id: HunkId,
    pub ordinal: usize,
    pub old_start: u32,
    pub old_lines: u32,
    pub new_start: u32,
    pub new_lines: u32,
    pub fingerprint: HunkFingerprint,
}

/// A hunk with its body lines, for excerpts.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ParsedHunk {
    pub hunk: Hunk,
    pub lines: Vec<String>,
}

/// Parses the hunks of one file's patch. Lines before the first `@@` header
/// (file headers) are ignored; a malformed header ends parsing.
#[must_use]
pub fn parse_patch(path: &str, diff: &str) -> Vec<ParsedHunk> {
    let mut hunks: Vec<ParsedHunk> = Vec::new();
    for line in diff.lines() {
        if let Some(header) = line.strip_prefix("@@ ") {
            let Some(ranges) = parse_header(header) else {
                break;
            };
            let ordinal = hunks.len() + 1;
            hunks.push(ParsedHunk {
                hunk: Hunk {
                    id: HunkId::new(path, ordinal),
                    ordinal,
                    old_start: ranges.0,
                    old_lines: ranges.1,
                    new_start: ranges.2,
                    new_lines: ranges.3,
                    fingerprint: HunkFingerprint(String::new()),
                },
                lines: Vec::new(),
            });
        } else if let Some(current) = hunks.last_mut()
            && matches!(line.as_bytes().first(), Some(b'+' | b'-' | b' ' | b'\\'))
        {
            current.lines.push(line.to_owned());
        }
    }
    for parsed in &mut hunks {
        parsed.hunk.fingerprint = fingerprint(&parsed.lines);
    }
    hunks
}

/// `-a[,b] +c[,d] @@ ...` → `(a, b, c, d)`; omitted counts are 1.
fn parse_header(header: &str) -> Option<(u32, u32, u32, u32)> {
    let mut parts = header.split_whitespace();
    let old = parts.next()?.strip_prefix('-')?;
    let new = parts.next()?.strip_prefix('+')?;
    let range = |text: &str| -> Option<(u32, u32)> {
        match text.split_once(',') {
            Some((start, count)) => Some((start.parse().ok()?, count.parse().ok()?)),
            None => Some((text.parse().ok()?, 1)),
        }
    };
    let (old_start, old_lines) = range(old)?;
    let (new_start, new_lines) = range(new)?;
    Some((old_start, old_lines, new_start, new_lines))
}

/// blake3 of the changed lines only, each with its sign and without a
/// trailing carriage return or whitespace.
#[must_use]
pub fn fingerprint(lines: &[String]) -> HunkFingerprint {
    let mut hasher = blake3::Hasher::new();
    for line in lines {
        if matches!(line.as_bytes().first(), Some(b'+' | b'-')) {
            hasher.update(line.trim_end().as_bytes());
            hasher.update(b"\n");
        }
    }
    HunkFingerprint(hasher.finalize().to_hex().to_string())
}

#[cfg(test)]
#[allow(clippy::expect_used)]
mod tests {
    use super::*;

    const PATCH: &str =
        "@@ -1,3 +1,4 @@ fn main() {\n context\n-old\n+new\n+added\n@@ -10 +11,2 @@\n x\n+y\n";

    #[test]
    fn parses_hunks_with_ids_ranges_and_fingerprints() {
        let hunks = parse_patch("src/a.rs", PATCH);
        assert_eq!(hunks.len(), 2);
        assert_eq!(hunks[0].hunk.id.as_str(), "src/a.rs#h1");
        assert_eq!(
            (
                hunks[1].hunk.old_start,
                hunks[1].hunk.old_lines,
                hunks[1].hunk.new_start,
                hunks[1].hunk.new_lines
            ),
            (10, 1, 11, 2)
        );
        assert_eq!(hunks[0].lines.len(), 4);
    }

    #[test]
    fn fingerprints_ignore_line_numbers_and_context() {
        let moved = "@@ -40,3 +41,4 @@\n other context\n-old\n+new\n+added\n";
        assert_eq!(
            parse_patch("a", PATCH)[0].hunk.fingerprint,
            parse_patch("a", moved)[0].hunk.fingerprint
        );
        let changed = "@@ -1,3 +1,4 @@\n context\n-old\n+newer\n+added\n";
        assert_ne!(
            parse_patch("a", PATCH)[0].hunk.fingerprint,
            parse_patch("a", changed)[0].hunk.fingerprint
        );
    }

    #[test]
    fn hunk_ids_and_fingerprints_validate() {
        assert!(HunkId::parse("src/a.rs#h2").is_some());
        assert!(HunkId::parse("src/a.rs#h0").is_none());
        assert!(HunkId::parse("#h1").is_none());
        let fingerprint = parse_patch("a", PATCH)[0].hunk.fingerprint.clone();
        assert_eq!(
            HunkFingerprint::parse(fingerprint.as_str()),
            Some(fingerprint)
        );
        assert!(HunkFingerprint::parse("abc").is_none());
    }
}
