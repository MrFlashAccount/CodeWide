//! The text a user wrote, as every client shows it.
//!
//! A provider wraps user text in its own envelopes and sends model-only
//! context as user-role input; only the provider knows its formats, so each
//! provider cleans its own text through [`UserTextCleaner`]
//! (`AgentProvider::user_text_cleaner`). The companion picks the cleaner of a
//! thread's provider and removes only what the companion itself adds: its
//! file envelope ([`file_envelope`]) and a cross-provider fork's context
//! handoff ([`is_companion_context`]).

use std::path::Path;

/// What a provider's cleaner made of one user text input.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum CleanedText {
    /// The text is what the user wrote.
    Unchanged,
    /// The text the user wrote inside the provider's envelope.
    Authored(String),
    /// Model-only context the provider sent as user input: not shown.
    ModelContext,
}

/// A provider's knowledge of its own envelopes and injected context.
pub trait UserTextCleaner: Send + Sync {
    /// Cleans one user text input of the provider's own formats.
    fn clean(&self, text: &str) -> CleanedText;
}

/// A cleaner for a provider without formats of its own.
pub struct NoUserTextFormats;

impl UserTextCleaner for NoUserTextFormats {
    fn clean(&self, _text: &str) -> CleanedText {
        CleanedText::Unchanged
    }
}

/// A file named in the companion's file envelope.
pub struct FileMention<'a> {
    pub name: &'a str,
    pub path: &'a str,
}

/// The companion's file envelope: the files it names and the request after them.
pub struct FileEnvelope<'a> {
    pub files: Vec<FileMention<'a>>,
    pub request: &'a str,
    /// Byte offset of `request` in the enveloped text.
    pub request_offset: usize,
}

/// Headings that end the file list. The second is the envelope's earlier
/// form, still present in stored history.
const REQUEST_HEADINGS: [&str; 2] = ["## My request:", "## My request for Codex:"];

/// The companion's file envelope (`# Files mentioned by the user:`, one
/// `## name: /absolute/path` line per file, then a request heading), when the
/// text is one.
#[must_use]
pub fn file_envelope(text: &str) -> Option<FileEnvelope<'_>> {
    let trimmed = text.trim_start();
    let mut lines = trimmed.split_inclusive('\n');
    let heading = lines.next()?;
    if heading.trim_end() != "# Files mentioned by the user:" {
        return None;
    }
    let mut offset = text.len() - trimmed.len() + heading.len();
    let mut files = Vec::new();
    for line in lines {
        offset += line.len();
        if REQUEST_HEADINGS.contains(&line.trim_end()) {
            if files.is_empty() {
                return None;
            }
            let remainder = &text[offset..];
            return Some(FileEnvelope {
                files,
                request: remainder.trim(),
                request_offset: offset + remainder.len() - remainder.trim_start().len(),
            });
        }
        if let Some(file) = file_mention(line) {
            files.push(file);
        }
    }
    None
}

fn file_mention(line: &str) -> Option<FileMention<'_>> {
    let entry = line.strip_prefix("## ")?;
    let (name, path) = entry.split_once(": ")?;
    let name = name.trim();
    let path = path.trim().trim_matches('`');
    (!name.is_empty() && !path.contains('\0') && Path::new(path).is_absolute())
        .then_some(FileMention { name, path })
}

/// Whether a text input is the companion's own model-only context: the
/// context handoff a cross-provider fork prepends to its first turn.
#[must_use]
pub fn is_companion_context(text: &str) -> bool {
    text.trim_start().starts_with("Context handoff (fork):")
}

/// The text shown for one user text input of a provider (thread-list
/// previews): `None` for model-only context, otherwise the authored text.
#[must_use]
pub fn display_text(text: &str, cleaner: &dyn UserTextCleaner) -> Option<String> {
    if is_companion_context(text) {
        return None;
    }
    let request = file_envelope(text).map_or(text, |envelope| envelope.request);
    match cleaner.clean(request) {
        CleanedText::Unchanged => Some(request.trim().to_owned()),
        CleanedText::Authored(authored) => Some(authored),
        CleanedText::ModelContext => None,
    }
}

#[cfg(test)]
mod tests {
    use super::{CleanedText, NoUserTextFormats, UserTextCleaner, display_text, file_envelope};

    struct Wrapped;

    impl UserTextCleaner for Wrapped {
        fn clean(&self, text: &str) -> CleanedText {
            match text.strip_prefix("[wrapped] ") {
                Some("context") => CleanedText::ModelContext,
                Some(inner) => CleanedText::Authored(inner.to_owned()),
                None => CleanedText::Unchanged,
            }
        }
    }

    #[test]
    fn removes_the_companion_envelope_and_asks_the_provider_for_the_rest() {
        for heading in ["## My request:", "## My request for Codex:"] {
            let text = format!(
                "# Files mentioned by the user:\n\n## a.md: /w/a.md\n\n{heading}\n\n[wrapped] Read it\n"
            );
            assert_eq!(display_text(&text, &Wrapped).as_deref(), Some("Read it"));
            assert_eq!(
                file_envelope(&text).map(|envelope| envelope.files.len()),
                Some(1)
            );
        }
        assert_eq!(
            display_text("  Plain  ", &NoUserTextFormats).as_deref(),
            Some("Plain")
        );
        assert_eq!(display_text("[wrapped] context", &Wrapped), None);
        assert_eq!(
            display_text(
                "Context handoff (fork):\nUser: hi\n\nUser message:",
                &NoUserTextFormats
            ),
            None
        );
        // Not an envelope: no file line, or a relative path.
        assert!(
            file_envelope("# Files mentioned by the user:\n## My request:\nNo files.").is_none()
        );
        assert!(
            file_envelope(
                "# Files mentioned by the user:\n## a.md: a.md\n## My request:\nRelative."
            )
            .is_none()
        );
    }
}
