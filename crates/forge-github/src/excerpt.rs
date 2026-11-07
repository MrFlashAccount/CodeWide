//! A review thread's code excerpt from GitHub's `diffHunk`: the hunk of the
//! thread's first comment, from its `@@` header down to the commented line.
//! The excerpt is the hunk's tail, at most [`MAX_EXCERPT_LINES`] lines ending
//! at that line, numbered from the header.
//!
//! GitHub numbers the hunk as the diff was when the comment was written. A
//! thread whose current `line` no longer matches that numbering gets no
//! excerpt ([`CodeExcerpt::rules`] decides), so a reader never sees code
//! labelled with the wrong line.

use forge_protocol::{
    CodeExcerpt, ExcerptLine, MAX_EXCERPT_LINE_CHARS, MAX_EXCERPT_LINES, ThreadAnchor,
};

/// The excerpt of `hunk` for a thread anchored at `anchor`, or `None` when
/// the hunk is empty, malformed or does not end at the anchored line.
#[must_use]
pub fn from_diff_hunk(hunk: &str, anchor: &ThreadAnchor) -> Option<CodeExcerpt> {
    let mut lines: Vec<ExcerptLine> = Vec::new();
    let mut numbers: Option<(u32, u32)> = None;
    for raw in hunk.lines() {
        if raw.starts_with("@@") {
            // Only the piece after the last header is contiguous.
            numbers = Some(header_starts(raw)?);
            lines.clear();
            continue;
        }
        let (old, new) = numbers.as_mut()?;
        let (marker, text) = raw.split_at(raw.chars().next().map_or(0, char::len_utf8));
        let text = bounded(text);
        let line = match marker {
            "+" => ExcerptLine::Added {
                new_line: take(new)?,
                text,
            },
            "-" => ExcerptLine::Removed {
                old_line: take(old)?,
                text,
            },
            // "No newline at end of file" belongs to the line before.
            "\\" => continue,
            // A context line; a bare empty line is a blank context line
            // whose leading space was stripped.
            " " | "" => ExcerptLine::Context {
                old_line: take(old)?,
                new_line: take(new)?,
                text,
            },
            _ => return None,
        };
        lines.push(line);
    }
    let skip = lines.len().saturating_sub(MAX_EXCERPT_LINES);
    let excerpt = CodeExcerpt {
        lines: lines.split_off(skip),
    };
    excerpt.rules(anchor).is_ok().then_some(excerpt)
}

/// The old and new start lines of `@@ -a,b +c,d @@`.
fn header_starts(header: &str) -> Option<(u32, u32)> {
    let mut parts = header.split_whitespace().skip(1);
    let start = |part: Option<&str>, sign: char| -> Option<u32> {
        part?.strip_prefix(sign)?.split(',').next()?.parse().ok()
    };
    Some((start(parts.next(), '-')?, start(parts.next(), '+')?))
}

/// The current number on one side, then advances it.
fn take(number: &mut u32) -> Option<u32> {
    let current = *number;
    *number = current.checked_add(1)?;
    Some(current)
}

/// One line's text, cut to the bound, with control characters other than a
/// tab replaced so the excerpt stays one line per entry.
fn bounded(text: &str) -> String {
    text.chars()
        .take(MAX_EXCERPT_LINE_CHARS)
        .map(|char| {
            if char.is_control() && char != '\t' {
                char::REPLACEMENT_CHARACTER
            } else {
                char
            }
        })
        .collect()
}

#[cfg(test)]
#[allow(clippy::expect_used)]
mod tests {
    use forge_protocol::DiffSide;

    use super::*;

    fn line_anchor(line: u32, side: DiffSide) -> ThreadAnchor {
        ThreadAnchor::Line {
            path: "src/a.rs".into(),
            line,
            start_line: None,
            side,
        }
    }

    const HUNK: &str = "@@ -10,7 +10,9 @@ fn main() {\n context ten\n-removed eleven\n+added eleven\n+added twelve\n context\r\n\n\\ No newline at end of file";

    #[test]
    fn the_tail_of_a_hunk_is_numbered_from_its_header_and_ends_at_the_anchor() {
        let excerpt = from_diff_hunk(HUNK, &line_anchor(14, DiffSide::New)).expect("excerpt");
        assert_eq!(
            excerpt.lines,
            [
                ExcerptLine::Context {
                    old_line: 10,
                    new_line: 10,
                    text: "context ten".into()
                },
                ExcerptLine::Removed {
                    old_line: 11,
                    text: "removed eleven".into()
                },
                ExcerptLine::Added {
                    new_line: 11,
                    text: "added eleven".into()
                },
                ExcerptLine::Added {
                    new_line: 12,
                    text: "added twelve".into()
                },
                ExcerptLine::Context {
                    old_line: 12,
                    new_line: 13,
                    text: "context".into()
                },
                ExcerptLine::Context {
                    old_line: 13,
                    new_line: 14,
                    text: String::new()
                },
            ]
        );
    }

    #[test]
    fn a_long_hunk_keeps_only_its_last_lines() {
        let body: String = (1..=20)
            .map(|line| [" line ", &line.to_string(), "\n"].concat())
            .collect();
        let excerpt = from_diff_hunk(
            &format!("@@ -1,20 +1,20 @@\n{body}"),
            &line_anchor(20, DiffSide::Old),
        )
        .expect("excerpt");
        assert_eq!(excerpt.lines.len(), MAX_EXCERPT_LINES);
        assert_eq!(excerpt.lines[0].text(), "line 13");
        assert_eq!(excerpt.lines[7].number(DiffSide::Old), Some(20));
    }

    #[test]
    fn a_hunk_that_does_not_end_at_the_anchor_or_cannot_be_read_has_no_excerpt() {
        assert_eq!(from_diff_hunk(HUNK, &line_anchor(15, DiffSide::New)), None);
        assert_eq!(from_diff_hunk(HUNK, &ThreadAnchor::PullRequest), None);
        assert_eq!(
            from_diff_hunk(" no header", &line_anchor(1, DiffSide::New)),
            None
        );
        assert_eq!(from_diff_hunk("", &line_anchor(1, DiffSide::New)), None);
        assert_eq!(
            from_diff_hunk("@@ -1 +1 @@\n?odd", &line_anchor(1, DiffSide::New)),
            None
        );
        // An outdated thread keeps the code as it was, numbered as it was.
        let file = ThreadAnchor::File {
            path: "src/a.rs".into(),
        };
        assert!(from_diff_hunk(HUNK, &file).is_some());
        // The last line of a later hunk restarts the numbering.
        let two = "@@ -1,1 +1,1 @@\n one\n@@ -50,2 +60,2 @@\n fifty\n-gone";
        let excerpt = from_diff_hunk(two, &line_anchor(51, DiffSide::Old)).expect("excerpt");
        assert_eq!(excerpt.lines.len(), 2);
    }

    #[test]
    fn long_lines_are_cut_and_control_characters_replaced() {
        let long = "x".repeat(MAX_EXCERPT_LINE_CHARS + 10);
        let excerpt = from_diff_hunk(
            &format!("@@ -1 +1 @@\n+{long}\u{1b}"),
            &line_anchor(1, DiffSide::New),
        )
        .expect("excerpt");
        assert_eq!(
            excerpt.lines[0].text().chars().count(),
            MAX_EXCERPT_LINE_CHARS
        );
        let escaped = from_diff_hunk("@@ -1 +1 @@\n+a\u{1b}b\tc", &line_anchor(1, DiffSide::New))
            .expect("excerpt");
        assert_eq!(escaped.lines[0].text(), "a\u{fffd}b\tc");
    }
}
