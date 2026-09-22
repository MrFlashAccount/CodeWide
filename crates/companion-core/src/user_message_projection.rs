//! Converts Desktop's file envelope to displayable App Server user inputs.
//! Canonical rollout text remains untouched; only the outbound projection changes.

use std::path::Path;

use serde_json::{Value, json};

struct FileMention<'a> {
    name: &'a str,
    path: &'a str,
}

struct DesktopEnvelope<'a> {
    files: Vec<FileMention<'a>>,
    request: &'a str,
    request_offset: usize,
}

pub(crate) fn project_desktop_content(parts: &mut Vec<Value>) {
    if !parts.iter().any(|part| {
        part.get("type").and_then(Value::as_str) == Some("text")
            && part
                .get("text")
                .and_then(Value::as_str)
                .is_some_and(|text| {
                    text.trim_start()
                        .starts_with("# Files mentioned by the user:")
                })
    }) {
        return;
    }
    // Replacing an envelope produces multiple inputs. Move existing values
    // into the new sequence so ordinary content keeps its data and ordering.
    for mut part in std::mem::take(parts) {
        let envelope = (part.get("type").and_then(Value::as_str) == Some("text"))
            .then(|| part.get("text").and_then(Value::as_str))
            .flatten()
            .and_then(desktop_envelope);
        let Some(envelope) = envelope else {
            parts.push(part);
            continue;
        };
        for file in envelope.files {
            parts.push(match mentioned_attachment_kind(file.name) {
                "image" => json!({"type": "localImage", "path": file.path}),
                "audio" => json!({"type": "localAudio", "path": file.path}),
                _ => json!({"type": "mention", "name": file.name, "path": file.path}),
            });
        }
        let offset = envelope.request_offset;
        let end = offset + envelope.request.len();
        let text = Value::String(envelope.request.to_owned());
        part["text"] = text;
        if let Some(elements) = part.get_mut("text_elements").and_then(Value::as_array_mut) {
            elements.retain_mut(|element| rebase_text_element(element, offset, end));
        }
        parts.push(part);
    }
}

fn desktop_envelope(text: &str) -> Option<DesktopEnvelope<'_>> {
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
        if matches!(
            line.trim_end(),
            "## My request:" | "## My request for Codex:"
        ) {
            if files.is_empty() {
                return None;
            }
            let remainder = &text[offset..];
            let request = remainder.trim();
            return Some(DesktopEnvelope {
                files,
                request,
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

fn rebase_text_element(element: &mut Value, offset: usize, end: usize) -> bool {
    let Some(range) = element.get_mut("byteRange") else {
        return false;
    };
    let (Some(start), Some(finish)) = (
        range.get("start").and_then(Value::as_u64),
        range.get("end").and_then(Value::as_u64),
    ) else {
        return false;
    };
    if start < offset as u64 || finish < start || finish > end as u64 {
        return false;
    }
    range["start"] = json!(start - offset as u64);
    range["end"] = json!(finish - offset as u64);
    true
}

fn mentioned_attachment_kind(name: &str) -> &'static str {
    match mime_guess::from_path(name).first_raw() {
        Some(mime) if mime.starts_with("image/") => "image",
        Some(mime) if mime.starts_with("audio/") => "audio",
        _ => "file",
    }
}

#[cfg(test)]
mod tests {
    use super::project_desktop_content;
    use serde_json::json;

    #[test]
    fn leaves_ordinary_and_incomplete_markdown_untouched() {
        for text in [
            "## My request:\n\nKeep this heading.",
            "Example:\n# Files mentioned by the user:\n## shot.png: /tmp/shot.png\n## My request:\nKeep everything.",
            "```markdown\n# Files mentioned by the user:\n## shot.png: /tmp/shot.png\n## My request:\nKeep everything.\n```",
            "# Files mentioned by the user:\n## My request:\nNot a complete envelope.",
            "# Files mentioned by the user:\n## shot.png: /tmp/shot.png",
            "# Files mentioned by the user:\n## invalid.png:\n/tmp/invalid.png\n## My request:\nNo same-line path.",
        ] {
            let mut parts = vec![json!({"type":"text", "text":text})];
            project_desktop_content(&mut parts);
            assert_eq!(parts, vec![json!({"type":"text", "text":text})]);
        }
    }

    #[test]
    fn retains_only_authored_text_spans_and_rebases_utf8_byte_offsets() {
        let prefix =
            "# Files mentioned by the user:\n## shot.png: /tmp/shot.png\n## My request:\n\n";
        let request = "Привет [ref]";
        let mut parts = vec![
            json!({"type":"text", "text":format!("{prefix}{request}\n"), "text_elements":[
                {"byteRange":{"start":0, "end":10}, "placeholder":"metadata"},
                {"byteRange":{"start":prefix.len() + "Привет ".len(), "end":prefix.len() + request.len()}, "placeholder":"[ref]"}
            ]}),
        ];
        project_desktop_content(&mut parts);
        assert_eq!(parts[1]["text"], request);
        assert_eq!(
            parts[1]["text_elements"],
            json!([
                {"byteRange":{"start":"Привет ".len(), "end":request.len()}, "placeholder":"[ref]"}
            ])
        );
    }
}
