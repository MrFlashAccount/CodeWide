//! Codex's own formats in user text (`AgentProvider::user_text_cleaner`):
//! model-only context the App Server sends as user input (environment
//! context, AGENTS.md, skills, permissions, plugins and multi-agent
//! instructions) and Codex Desktop's envelopes around the authored text (the
//! request heading, browser context, image tags, realtime delegation,
//! question replies).

use agent_core::user_text::{CleanedText, UserTextCleaner};
use serde_json::Value;

/// Cleans Codex's formats out of user text.
pub struct CodexUserText;

impl UserTextCleaner for CodexUserText {
    fn clean(&self, text: &str) -> CleanedText {
        if is_model_context(text) {
            return CleanedText::ModelContext;
        }
        authored_text(text).map_or(CleanedText::Unchanged, CleanedText::Authored)
    }
}

/// Bootstrap instructions Codex injects as user-role input.
const BOOTSTRAP_PREFIXES: &[&str] = &[
    "<recommended_plugins>",
    "# AGENTS.md instructions",
    "<AGENTS.md>",
    "<skills_instructions>",
    "<permissions instructions>",
    "<apps_instructions>",
    "<plugins_instructions>",
    "<multi_agent_mode>",
];

/// Codex's model-only context: environment context and bootstrap instructions.
fn is_model_context(text: &str) -> bool {
    let trimmed = text.trim();
    let lower = trimmed.to_ascii_lowercase();
    (lower.starts_with("<environment_context>") && lower.ends_with("</environment_context>"))
        || BOOTSTRAP_PREFIXES
            .iter()
            .any(|prefix| trimmed.starts_with(prefix))
}

/// The authored text inside Codex Desktop's envelopes, or `None` when the
/// text has none.
fn authored_text(text: &str) -> Option<String> {
    let delegated = realtime_delegation_input(text);
    let source = delegated.unwrap_or(text);
    if let Some(reply) = question_reply_text(source) {
        return Some(reply);
    }
    let request = browser_request(source)
        .or_else(|| after_heading_line(source, "## My request for Codex:"))
        .unwrap_or(source);
    let cleaned = strip_image_tags(&strip_blocks(
        request,
        "<in-app-browser-context",
        "</in-app-browser-context>",
    ));
    let cleaned = cleaned.trim();
    (delegated.is_some() || cleaned != text).then(|| cleaned.to_owned())
}

/// `<realtime_delegation><input>…</input><transcript_delta>…</transcript_delta></realtime_delegation>`.
fn realtime_delegation_input(text: &str) -> Option<&str> {
    let inner = text
        .trim()
        .strip_prefix("<realtime_delegation>")?
        .strip_suffix("</realtime_delegation>")?
        .trim();
    let input = inner.strip_prefix("<input>")?;
    let (input, rest) = input.split_once("</input>")?;
    let delta = rest.trim().strip_prefix("<transcript_delta>")?;
    delta
        .trim_end()
        .ends_with("</transcript_delta>")
        .then_some(input)
}

/// The answers of a complete Desktop question-reply envelope.
fn question_reply_text(text: &str) -> Option<String> {
    let body = text
        .trim()
        .strip_prefix("<send_user_message_question_reply>")?
        .strip_suffix("</send_user_message_question_reply>")?;
    let entries = serde_json::from_str::<Vec<Value>>(body).ok()?;
    if entries.is_empty() {
        return None;
    }
    let answers = entries
        .iter()
        .map(|entry| {
            let field = |name| entry.get(name).and_then(Value::as_str);
            field("questionItemId")?;
            field("question")?;
            field("answer")
        })
        .collect::<Option<Vec<_>>>()?;
    Some(answers.join("\n\n"))
}

/// The request after a complete leading browser-context block and its
/// `## My request:` heading.
fn browser_request(text: &str) -> Option<&str> {
    let trimmed = text.trim_start();
    if !trimmed.starts_with("<in-app-browser-context") {
        return None;
    }
    let close = "</in-app-browser-context>";
    let end = trimmed.find(close)? + close.len();
    let rest = trimmed[end..].trim_start();
    let line_end = rest.find('\n').unwrap_or(rest.len());
    (rest[..line_end].trim_end() == "## My request:").then(|| &rest[line_end..])
}

/// The text after a line that is exactly `heading`.
fn after_heading_line<'a>(text: &'a str, heading: &str) -> Option<&'a str> {
    let mut offset = 0;
    for line in text.split_inclusive('\n') {
        offset += line.len();
        if line.trim_end() == heading {
            return Some(&text[offset..]);
        }
    }
    None
}

/// Removes every complete `open…close` block (tag names compared ASCII-case-insensitively).
fn strip_blocks(text: &str, open: &str, close: &str) -> String {
    let lower = text.to_ascii_lowercase();
    let mut out = String::with_capacity(text.len());
    let mut cursor = 0;
    while let Some(start) = lower[cursor..].find(open).map(|index| cursor + index) {
        let Some(end) = lower[start..]
            .find(close)
            .map(|index| start + index + close.len())
        else {
            break;
        };
        out.push_str(&text[cursor..start]);
        cursor = end;
    }
    out.push_str(&text[cursor..]);
    out
}

/// Removes `<image …>` and `</image>` tags, keeping what they enclose.
fn strip_image_tags(text: &str) -> String {
    let lower = text.to_ascii_lowercase();
    let mut out = String::with_capacity(text.len());
    let mut cursor = 0;
    while let Some(start) = [
        lower[cursor..].find("<image"),
        lower[cursor..].find("</image"),
    ]
    .into_iter()
    .flatten()
    .min()
    .map(|index| cursor + index)
    {
        let tail = &lower[start..];
        let name_end = if tail.starts_with("</image") { 7 } else { 6 };
        let is_tag = tail[name_end..]
            .chars()
            .next()
            .is_some_and(|next| next == '>' || next.is_whitespace() || next == '/');
        let Some(close) = tail.find('>') else {
            break;
        };
        out.push_str(&text[cursor..start]);
        if !is_tag {
            out.push_str(&text[start..=start + close]);
        }
        cursor = start + close + 1;
    }
    out.push_str(&text[cursor..]);
    out
}

#[cfg(test)]
mod tests {
    use agent_core::user_text::{CleanedText, UserTextCleaner, display_text};
    use serde_json::json;

    use super::CodexUserText;

    fn shown(text: &str) -> Option<String> {
        display_text(text, &CodexUserText)
    }

    #[test]
    fn shows_only_the_authored_input_of_a_realtime_delegation() {
        let source = "<realtime_delegation>\n  <input>Первая строка\n\nВторая строка с &lt;тегом&gt;.</input>\n  <transcript_delta>assistant: hidden\nuser: hidden too</transcript_delta>\n</realtime_delegation>";
        assert_eq!(
            shown(source).as_deref(),
            Some("Первая строка\n\nВторая строка с &lt;тегом&gt;.")
        );
    }

    #[test]
    fn keeps_malformed_or_quoted_envelopes() {
        for source in [
            "<realtime_delegation><input>Keep malformed</input></realtime_delegation>",
            "Prefix <realtime_delegation><input>Keep quoted</input><transcript_delta>hidden</transcript_delta></realtime_delegation>",
            "```xml\n<realtime_delegation><input>Keep fenced</input><transcript_delta>hidden</transcript_delta></realtime_delegation>\n```",
            "<send_user_message_question_reply>not JSON</send_user_message_question_reply>",
            "<send_user_message_question_reply>[]</send_user_message_question_reply>",
            r#"<send_user_message_question_reply>[{"answer":"unproven envelope"}]</send_user_message_question_reply>"#,
            r#"<send_user_message_question_reply>[{"questionItemId":"q","question":"Q?","answer":false}]</send_user_message_question_reply>"#,
            r#"Example: <send_user_message_question_reply>[{"questionItemId":"q","question":"Q?","answer":"Keep it"}]</send_user_message_question_reply>"#,
            "## My request:\n\nKeep my heading.",
            "An example:\n\n# In app browser:\n\n## My request:\nKeep this example.",
            "```markdown\n## My request:\nDo not strip this code.\n```",
            "# Files I use\n\n## My request\n\nKeep all of this.",
            "What is <environment_context>?",
        ] {
            assert_eq!(
                CodexUserText.clean(source),
                CleanedText::Unchanged,
                "{source}"
            );
        }
    }

    #[test]
    fn shows_the_answers_of_a_question_reply() {
        let source = format!(
            "<send_user_message_question_reply>\n{}\n</send_user_message_question_reply>",
            json!([
                {"questionItemId":"question-1", "question":"Which logs?", "answer":"https://example.invalid/logs"},
                {"questionItemId":"question-2", "question":"Which environment?", "answer":"Production\nSecond line"}
            ])
        );
        assert_eq!(
            shown(&source).as_deref(),
            Some("https://example.invalid/logs\n\nProduction\nSecond line")
        );
    }

    #[test]
    fn strips_the_browser_envelope_and_keeps_later_headings() {
        for newline in ["\n", "\r\n"] {
            let source = [
                "",
                r#"<in-app-browser-context source="ambient-ui-state">"#,
                "Automatically supplied UI state.",
                "# In app browser:",
                "",
                "https://example.invalid/review",
                "</in-app-browser-context>",
                "",
                "## My request:",
                "",
                "Проверь страницу.",
                "",
                "## My request:",
                "Этот заголовок — часть моего текста.",
            ]
            .join(newline);
            let expected = [
                "Проверь страницу.",
                "",
                "## My request:",
                "Этот заголовок — часть моего текста.",
            ]
            .join(newline);
            assert_eq!(shown(&source), Some(expected));
        }
    }

    #[test]
    fn removes_the_request_heading_ambient_context_and_image_tags() {
        assert_eq!(
            shown("Intro\n\n## My request for Codex:\n\nDo it").as_deref(),
            Some("Do it")
        );
        let source = "<in-app-browser-context source=\"ambient-ui-state\">hidden</in-app-browser-context>\nОбычный текст <image name=[Image #1] path=\"/tmp/1.jpg\"></image>";
        assert_eq!(shown(source).as_deref(), Some("Обычный текст"));
        assert_eq!(
            shown("An <imagery> tag stays").as_deref(),
            Some("An <imagery> tag stays")
        );
    }

    #[test]
    fn hides_model_only_context() {
        assert_eq!(
            shown("<environment_context>\n  <cwd>/w</cwd>\n</environment_context>"),
            None
        );
        assert_eq!(shown("# AGENTS.md instructions for /w\n..."), None);
        assert_eq!(shown("<skills_instructions>…</skills_instructions>"), None);
    }
}
