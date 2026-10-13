//! A Claude session's listing facts, read from the first and last 64 KiB of
//! its file the way Claude's own session listing reads them: title, first
//! prompt, summary, working directory, start time, whether a person started
//! it, and whether it continued in another session.
//!
//! Field values are found by their `"name":"` key in the raw text, the
//! newest occurrence winning, so a listing never parses a whole file. Pure.

use serde_json::Value;

/// How many bytes of a file's head and of its tail a listing reads.
pub const HEAD_TAIL_BYTES: usize = 64 * 1024;
const FIRST_PROMPT_MAX_CHARS: usize = 200;
/// Entrypoints of sessions an SDK or headless run started.
const PROGRAMMATIC_ENTRYPOINTS: [&str; 3] = ["sdk-cli", "sdk-ts", "sdk-py"];

/// The listing facts of one session file.
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct SessionMeta {
    /// The custom title, else Claude's generated title.
    pub title: Option<String>,
    pub first_prompt: Option<String>,
    /// The title, else the last prompt, else the first prompt.
    pub summary: String,
    pub cwd: Option<String>,
    pub created_at_ms: Option<i64>,
    /// A person started the session (terminal, IDE), not the SDK or a daemon.
    pub interactive: bool,
    /// The session another one continues (`continued-in`).
    pub continued_in: Option<String>,
}

/// The facts of a session from `head` and `tail`; `None` for a side-chain
/// transcript or a session with nothing to show.
#[must_use]
pub fn session_meta(head: &str, tail: &str) -> Option<SessionMeta> {
    let first_line = head.split('\n').next().unwrap_or(head);
    if first_line.contains("\"isSidechain\":true") || first_line.contains("\"isSidechain\": true") {
        return None;
    }
    let title = last_field(tail, "customTitle")
        .or_else(|| last_field(head, "customTitle"))
        .or_else(|| last_field(tail, "aiTitle"))
        .or_else(|| last_field(head, "aiTitle"));
    let first_prompt = first_prompt(head);
    let summary = title
        .clone()
        .or_else(|| last_field(tail, "lastPrompt"))
        .or_else(|| last_field(tail, "summary"))
        .or_else(|| first_prompt.clone())
        .or_else(|| attachment_prompt(head))?;
    let created_at_ms = first_field(head, "timestamp")
        .and_then(|time| crate::transcript::entries::timestamp_ms(&time));
    let cwd =
        last_typed_field(tail, "relocated", "relocatedCwd").or_else(|| first_field(head, "cwd"));
    Some(SessionMeta {
        title,
        first_prompt,
        summary,
        cwd,
        created_at_ms,
        interactive: !is_programmatic(head, tail),
        continued_in: last_typed_field(tail, "continued-in", "continuedInSessionId"),
    })
}

fn is_programmatic(head: &str, tail: &str) -> bool {
    let entrypoint = first_field(head, "entrypoint").or_else(|| last_field(tail, "entrypoint"));
    if entrypoint.is_some_and(|entrypoint| PROGRAMMATIC_ENTRYPOINTS.contains(&entrypoint.as_str()))
    {
        return true;
    }
    let row = head
        .split('\n')
        .find(|line| line.contains("\"parentUuid\":"))
        .unwrap_or(head);
    matches!(
        first_field(row, "sessionKind").as_deref(),
        Some("daemon" | "daemon-worker")
    )
}

/// The string value at each `"name":"` occurrence in `text`, oldest first.
fn field_values<'a>(text: &'a str, name: &str) -> impl Iterator<Item = String> + 'a {
    let keys = [format!("\"{name}\":\""), format!("\"{name}\": \"")];
    let mut found = Vec::new();
    for key in keys {
        let mut from = 0;
        while let Some(at) = text[from..].find(&key) {
            let start = from + at + key.len();
            let bytes = text.as_bytes();
            let mut end = start;
            while end < bytes.len() {
                match bytes[end] {
                    b'\\' => end += 2,
                    b'"' => break,
                    _ => end += 1,
                }
            }
            if end >= bytes.len() {
                break;
            }
            found.push((from + at, unescape(&text[start..end])));
            from = end + 1;
        }
    }
    found.sort_by_key(|(at, _)| *at);
    found.into_iter().map(|(_, value)| value)
}

fn unescape(raw: &str) -> String {
    if !raw.contains('\\') {
        return raw.to_owned();
    }
    serde_json::from_str::<String>(&format!("\"{raw}\"")).unwrap_or_else(|_| raw.to_owned())
}

fn first_field(text: &str, name: &str) -> Option<String> {
    field_values(text, name).next()
}

fn last_field(text: &str, name: &str) -> Option<String> {
    field_values(text, name).last()
}

/// The newest `field` string of a row of type `kind`.
fn last_typed_field(text: &str, kind: &str, field: &str) -> Option<String> {
    let type_key = format!("\"type\":\"{kind}\"");
    text.lines()
        .rev()
        .filter(|line| line.contains(&type_key))
        .find_map(|line| {
            serde_json::from_str::<Value>(line)
                .ok()?
                .get(field)?
                .as_str()
                .map(ToOwned::to_owned)
        })
}

/// The first prompt a person wrote: the first user row with text that is
/// neither a tool result, injected context, a compact summary, a command
/// echo nor markup. A command without other text shows its name.
fn first_prompt(head: &str) -> Option<String> {
    let mut command_fallback = None;
    for line in head.split('\n') {
        if !(line.contains("\"type\":\"user\"") || line.contains("\"type\": \"user\""))
            || line.contains("\"tool_result\"")
            || line.contains("\"isMeta\":true")
            || line.contains("\"isMeta\": true")
            || line.contains("\"isCompactSummary\":true")
            || line.contains("\"isCompactSummary\": true")
        {
            continue;
        }
        let Ok(row) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        for text in row_texts(&row) {
            let text = without_paste_markers(&text).replace('\n', " ");
            let text = text.trim();
            if text.is_empty() {
                continue;
            }
            if let Some(name) = tagged(text, "command-name") {
                command_fallback.get_or_insert_with(|| name.to_owned());
                continue;
            }
            if let Some(command) = tagged(text, "bash-input") {
                return Some(format!("! {}", command.trim()));
            }
            if is_markup(text) {
                continue;
            }
            return Some(shorten(text));
        }
    }
    command_fallback
}

/// The texts of a user row, or none when it carries a tool result.
fn row_texts(row: &Value) -> Vec<String> {
    let Some(content) = row
        .get("message")
        .and_then(|message| message.get("content"))
    else {
        return Vec::new();
    };
    if let Some(text) = content.as_str() {
        return vec![text.to_owned()];
    }
    let mut texts = Vec::new();
    for block in content.as_array().map_or(&[][..], Vec::as_slice) {
        match block.get("type").and_then(Value::as_str) {
            Some("tool_result") => return Vec::new(),
            Some("text") => {
                if let Some(text) = block.get("text").and_then(Value::as_str) {
                    texts.push(text.to_owned());
                }
            }
            _ => {}
        }
    }
    texts
}

/// A prompt that is only an image or a document.
fn attachment_prompt(head: &str) -> Option<String> {
    head.split('\n')
        .filter(|line| line.contains("\"type\":\"user\"") || line.contains("\"type\": \"user\""))
        .filter(|line| !line.contains("\"tool_result\"") && !line.contains("\"isMeta\":true"))
        .find_map(|line| {
            if line.contains("\"type\":\"image\"") {
                Some("Image".to_owned())
            } else if line.contains("\"type\":\"document\"") {
                Some("Document".to_owned())
            } else {
                None
            }
        })
}

/// The text without Claude Code's pasted-content wrapper lines.
fn without_paste_markers(text: &str) -> String {
    if !text.contains("<pasted_content id=\"") {
        return text.to_owned();
    }
    text.lines()
        .filter(|line| {
            let line = line.trim();
            !(line.starts_with("<pasted_content id=\"") || line.starts_with("</pasted_content"))
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn tagged<'a>(text: &'a str, tag: &str) -> Option<&'a str> {
    let open = format!("<{tag}>");
    let close = format!("</{tag}>");
    let start = text.find(&open)? + open.len();
    let end = text[start..].find(&close)? + start;
    Some(&text[start..end])
}

/// Markup echoes and the interrupt marker are not prompts.
fn is_markup(text: &str) -> bool {
    if text.starts_with("[Request interrupted by user") {
        return true;
    }
    let mut characters = text.trim_start().chars();
    characters.next() == Some('<')
        && characters
            .next()
            .is_some_and(|first| first.is_ascii_lowercase())
        && characters
            .find(|character| {
                !(character.is_ascii_alphanumeric() || *character == '_' || *character == '-')
            })
            .is_some_and(|character| character.is_whitespace() || character == '>')
}

fn shorten(text: &str) -> String {
    if text.chars().count() <= FIRST_PROMPT_MAX_CHARS {
        return text.to_owned();
    }
    let cut = text
        .chars()
        .take(FIRST_PROMPT_MAX_CHARS)
        .collect::<String>();
    format!("{}…", cut.trim())
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn lines(rows: &[Value]) -> String {
        rows.iter()
            .map(Value::to_string)
            .collect::<Vec<_>>()
            .join("\n")
            + "\n"
    }

    #[test]
    fn reads_title_prompt_directory_and_kind_like_claudes_listing() {
        let text = lines(&[
            json!({"type": "user", "uuid": "c", "parentUuid": null, "timestamp": "2026-10-01T10:00:00.000Z",
                "cwd": "/work", "entrypoint": "cli", "isMeta": true, "message": {"content": "<local-command-caveat>x</local-command-caveat>"}}),
            json!({"type": "user", "uuid": "p", "parentUuid": "c", "cwd": "/work", "entrypoint": "cli",
                "message": {"content": [{"type": "text", "text": "<command-name>/review</command-name>"}]}}),
            json!({"type": "user", "uuid": "q", "parentUuid": "p", "cwd": "/work", "entrypoint": "cli",
                "message": {"content": "Fix the\nflaky \"test\""}}),
            json!({"type": "ai-title", "aiTitle": "Flaky test"}),
            json!({"type": "custom-title", "customTitle": "Mine"}),
            json!({"type": "relocated", "relocatedCwd": "/moved"}),
        ]);
        let meta = session_meta(&text, &text).unwrap_or_default();
        assert_eq!(meta.title.as_deref(), Some("Mine"));
        assert_eq!(meta.first_prompt.as_deref(), Some("Fix the flaky \"test\""));
        assert_eq!(meta.summary, "Mine");
        assert_eq!(meta.cwd.as_deref(), Some("/moved"));
        assert!(meta.interactive);
        assert_eq!(meta.created_at_ms, Some(1_790_848_800_000));
    }

    #[test]
    fn sdk_sessions_side_chains_and_commands_only() {
        let sdk = lines(&[
            json!({"type": "user", "uuid": "u", "parentUuid": null, "entrypoint": "sdk-ts",
            "message": {"content": "<command-name>/clear</command-name>"}}),
        ]);
        let meta = session_meta(&sdk, &sdk).unwrap_or_default();
        assert!(!meta.interactive);
        assert_eq!(meta.first_prompt.as_deref(), Some("/clear"));
        let side =
            lines(&[json!({"type": "user", "isSidechain": true, "message": {"content": "hi"}})]);
        assert_eq!(session_meta(&side, &side), None);
        let continued = lines(&[
            json!({"type": "user", "uuid": "u", "parentUuid": null, "message": {"content": "hi"}}),
            json!({"type": "continued-in", "continuedInSessionId": "next"}),
        ]);
        assert_eq!(
            session_meta(&continued, &continued).and_then(|meta| meta.continued_in),
            Some("next".into())
        );
    }
}
