//! One page of a task's output as text: which bytes of a read window become
//! the page, so that a page never splits a UTF-8 character and the next
//! page starts at the exact byte after it. Pure.
//!
//! - A window that starts inside a character (an offset no page returned)
//!   skips the character's remaining bytes.
//! - A page ends on the last character boundary within `limit` bytes; when
//!   not even one character fits, the page is that one character, so every
//!   page makes progress.
//! - An incomplete character at the end of the file (a running task is
//!   writing it) is left for the next page; a page that would hold nothing
//!   else takes it as it is (decoded lossily), so a task that ended inside
//!   a character still reaches the end.
//! - Bytes that are not UTF-8 decode as U+FFFD; offsets always count the
//!   file's bytes.

/// The longest UTF-8 character, in bytes.
pub const MAX_CHAR_BYTES: usize = 4;

/// Bytes a window holds beyond the page limit: enough to skip a partial
/// character at its start and to see the whole character at its limit.
pub const WINDOW_SLACK: usize = 2 * (MAX_CHAR_BYTES - 1);

const fn is_continuation(byte: u8) -> bool {
    byte & 0b1100_0000 == 0b1000_0000
}

/// Bytes of the character a lead byte starts; 1 for a byte that starts none.
const fn char_len(lead: u8) -> usize {
    match lead {
        0xC0..=0xDF => 2,
        0xE0..=0xEF => 3,
        0xF0..=0xF7 => 4,
        _ => 1,
    }
}

/// Where the page starts and ends in `window`: the bytes at the requested
/// offset, `limit` + [`WINDOW_SLACK`] of them unless the file ends sooner
/// (then the window ends at the end of the file).
#[must_use]
pub fn page_bounds(window: &[u8], limit: usize) -> (usize, usize) {
    let start = window
        .iter()
        .take(MAX_CHAR_BYTES - 1)
        .take_while(|byte| is_continuation(**byte))
        .count();
    let available = window.len();
    if start >= available {
        return (available, available);
    }
    let mut end = available.min(start.saturating_add(limit.max(1)));
    if end < available {
        while end > start && is_continuation(window[end]) {
            end -= 1;
        }
    } else if let Some(lead) = (start..end)
        .rev()
        .take(MAX_CHAR_BYTES)
        .find(|at| !is_continuation(window[*at]))
        && lead + char_len(window[lead]) > end
    {
        // The file ends inside its last character.
        end = lead;
    }
    if end == start {
        end = available.min(start + char_len(window[start]));
    }
    (start, end)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Pages `bytes` from offset 0 with `limit`, as the reader does.
    fn pages(bytes: &[u8], limit: usize) -> Vec<(usize, usize)> {
        let mut offset = 0;
        let mut pages = Vec::new();
        while offset < bytes.len() {
            let window_end = bytes.len().min(offset + limit + WINDOW_SLACK);
            let (start, end) = page_bounds(&bytes[offset..window_end], limit);
            assert!(end > start, "every page makes progress");
            pages.push((offset + start, offset + end));
            offset += end;
        }
        pages
    }

    #[test]
    fn pages_cover_every_byte_and_never_split_a_character() {
        let text = "aé€😀b".repeat(7);
        for limit in 1..=12 {
            let pages = pages(text.as_bytes(), limit);
            let mut expected_start = 0;
            let mut joined = String::new();
            for (start, end) in pages {
                assert_eq!(start, expected_start, "limit {limit}");
                let page = text.get(start..end);
                assert!(
                    page.is_some(),
                    "limit {limit}: page {start}..{end} splits a char"
                );
                assert!(
                    end - start <= limit.max(MAX_CHAR_BYTES),
                    "limit {limit}: page {start}..{end} is too long"
                );
                joined.push_str(page.unwrap_or_default());
                expected_start = end;
            }
            assert_eq!(joined, text, "limit {limit}");
        }
    }

    #[test]
    fn a_multibyte_character_at_the_limit_moves_to_the_next_page() {
        // "ab€" with limit 3: the euro sign (3 bytes at 2..5) does not fit.
        let bytes = "ab€c".as_bytes();
        assert_eq!(page_bounds(bytes, 3), (0, 2));
        assert_eq!(page_bounds(&bytes[2..], 3), (0, 3));
        // Not even one character fits: the page is that character.
        assert_eq!(page_bounds("😀x".as_bytes(), 1), (0, 4));
    }

    #[test]
    fn an_offset_inside_a_character_starts_at_the_next_one() {
        let bytes = "€x".as_bytes();
        assert_eq!(page_bounds(&bytes[1..], 10), (2, 3));
    }

    #[test]
    fn an_incomplete_last_character_waits_unless_nothing_else_is_left() {
        // A running task wrote the first two bytes of "€".
        let partial = &"a€".as_bytes()[..3];
        assert_eq!(page_bounds(partial, 10), (0, 1));
        assert_eq!(page_bounds(&partial[1..], 10), (0, 2));
    }

    #[test]
    fn a_window_past_the_end_is_an_empty_page() {
        assert_eq!(page_bounds(&[], 10), (0, 0));
        assert_eq!(page_bounds(&[0x80, 0x80, 0x80], 10), (3, 3));
    }
}
