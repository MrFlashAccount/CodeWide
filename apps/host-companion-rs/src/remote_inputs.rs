use std::sync::Arc;

use serde_json::{Map, Value, json};

use crate::files::{FileError, FileService};

const MAX_REMOTE_FILES: usize = 128;
const MAX_FIELD_CHARS: usize = 4_096;

#[derive(Debug, thiserror::Error)]
pub enum RemoteInputError {
    #[error("remote file service is unavailable")]
    FileServiceUnavailable,
    #[error("too many remote file inputs")]
    TooManyFiles,
    #[error("invalid remote file {0}")]
    InvalidField(&'static str),
    #[error("invalid remote file kind")]
    InvalidKind,
    #[error("remote file path is not UTF-8")]
    NonUtf8Path,
    #[error(transparent)]
    File(#[from] FileError),
}

/// Converts companion-only `remoteFile` inputs into App Server local inputs.
/// Root-relative references are resolved again at dispatch time, so neither a
/// direct mutation nor a durable queued command can choose an arbitrary host
/// path.
///
/// # Errors
///
/// Returns an error for malformed or excessive remote-file inputs, unavailable
/// file transport, unsafe paths, or files that disappeared before dispatch.
pub async fn prepare_remote_file_inputs(
    method: &str,
    params: Value,
    files: Option<Arc<FileService>>,
) -> Result<Value, RemoteInputError> {
    if !matches!(method, "turn/start" | "turn/steer") {
        return Ok(params);
    }
    let Some(input) = params.get("input").and_then(Value::as_array) else {
        return Ok(params);
    };
    if !input.iter().any(is_remote_file) {
        return Ok(params);
    }
    let files = files.ok_or(RemoteInputError::FileServiceUnavailable)?;
    let mut remote_files = 0_usize;
    let mut mentioned_files = Vec::new();
    let mut prepared = Vec::with_capacity(input.len());
    for raw in input {
        let Some(part) = raw
            .as_object()
            .filter(|part| part.get("type").and_then(Value::as_str) == Some("remoteFile"))
        else {
            prepared.push(raw.clone());
            continue;
        };
        remote_files += 1;
        if remote_files > MAX_REMOTE_FILES {
            return Err(RemoteInputError::TooManyFiles);
        }
        let root_id = bounded_string(part, "rootId")?;
        let relative_path = bounded_string(part, "path")?;
        let name = bounded_string(part, "name")?;
        let kind = bounded_string(part, "kind")?;
        if !matches!(kind, "image" | "audio" | "file") {
            return Err(RemoteInputError::InvalidKind);
        }
        let host_path = files.resolve_input_file(root_id, relative_path).await?;
        let host_path = host_path.to_str().ok_or(RemoteInputError::NonUtf8Path)?;
        let prepared_part = match kind {
            "image" => json!({"type": "localImage", "path": host_path}),
            "audio" => json!({"type": "localAudio", "path": host_path}),
            "file" => {
                mentioned_files.push((name.to_owned(), host_path.to_owned()));
                continue;
            }
            _ => unreachable!(),
        };
        prepared.push(prepared_part);
    }
    if !mentioned_files.is_empty() {
        wrap_text_with_mentioned_files(&mut prepared, &mentioned_files);
    }
    let mut params = params;
    if let Some(object) = params.as_object_mut() {
        object.insert("input".into(), Value::Array(prepared));
    }
    Ok(params)
}

fn wrap_text_with_mentioned_files(input: &mut Vec<Value>, files: &[(String, String)]) {
    let file_list = files
        .iter()
        .map(|(name, path)| {
            let safe_name = name.replace(':', "-").replace('`', "'");
            format!("## {safe_name}: {path}")
        })
        .collect::<Vec<_>>()
        .join("\n\n");
    let prefix =
        format!("# Files mentioned by the user:\n\n{file_list}\n\n## My request for Codex:\n\n");
    if let Some(text) = input.iter_mut().find(|part| {
        part.get("type").and_then(Value::as_str) == Some("text")
            && part.get("text").and_then(Value::as_str).is_some()
    }) {
        let Some(object) = text.as_object_mut() else {
            return;
        };
        let authored = object
            .get("text")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let wrapped = format!("{prefix}{authored}");
        shift_text_elements(object, prefix.len());
        object.insert("text".into(), Value::String(wrapped));
    } else {
        input.insert(
            0,
            json!({"type": "text", "text": prefix, "text_elements": []}),
        );
    }
}

fn shift_text_elements(text: &mut Map<String, Value>, byte_offset: usize) {
    let Some(elements) = text.get_mut("text_elements").and_then(Value::as_array_mut) else {
        return;
    };
    for element in elements {
        let Some(element) = element.as_object_mut() else {
            continue;
        };
        let range = if element.contains_key("byteRange") {
            element.get_mut("byteRange")
        } else {
            element.get_mut("byte_range")
        };
        let Some(range) = range.and_then(Value::as_object_mut) else {
            continue;
        };
        for edge in ["start", "end"] {
            let Some(value) = range.get(edge).and_then(Value::as_u64) else {
                continue;
            };
            range.insert(edge.into(), json!(value.saturating_add(byte_offset as u64)));
        }
    }
}

fn is_remote_file(value: &Value) -> bool {
    value.get("type").and_then(Value::as_str) == Some("remoteFile")
}

fn bounded_string<'a>(
    part: &'a Map<String, Value>,
    field: &'static str,
) -> Result<&'a str, RemoteInputError> {
    let value = part
        .get(field)
        .and_then(Value::as_str)
        .ok_or(RemoteInputError::InvalidField(field))?;
    if value.is_empty() || value.len() > MAX_FIELD_CHARS || value.chars().any(char::is_control) {
        return Err(RemoteInputError::InvalidField(field));
    }
    Ok(value)
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use super::*;

    #[tokio::test]
    async fn resolves_remote_files_to_app_server_input_variants()
    -> Result<(), Box<dyn std::error::Error>> {
        let directory = tempfile::tempdir()?;
        let root = directory.path().join("attachments");
        tokio::fs::create_dir(&root).await?;
        tokio::fs::write(root.join("photo.png"), b"png").await?;
        tokio::fs::write(root.join("voice.wav"), b"wav").await?;
        tokio::fs::write(root.join("notes.txt"), b"notes").await?;
        let canonical_root = tokio::fs::canonicalize(&root).await?;
        let files = Arc::new(
            FileService::open(
                HashMap::from([("attachments".into(), root.clone())]),
                Vec::new(),
                None,
                None,
            )
            .await?,
        );

        let prepared = prepare_remote_file_inputs(
            "turn/start",
            json!({"input": [
                {"type": "text", "text": "hello", "text_elements": [{"byteRange": {"start": 0, "end": 5}, "placeholder": "hello"}]},
                {"type": "remoteFile", "rootId": "attachments", "path": "photo.png", "name": "photo", "kind": "image"},
                {"type": "remoteFile", "rootId": "attachments", "path": "voice.wav", "name": "voice", "kind": "audio"},
                {"type": "remoteFile", "rootId": "attachments", "path": "notes.txt", "name": "notes", "kind": "file"}
            ]}),
            Some(files),
        )
        .await?;

        let prefix = format!(
            "# Files mentioned by the user:\n\n## notes: {}\n\n## My request for Codex:\n\n",
            canonical_root.join("notes.txt").display()
        );
        assert_eq!(
            prepared["input"][0],
            json!({
                "type": "text",
                "text": format!("{prefix}hello"),
                "text_elements": [{
                    "byteRange": {"start": prefix.len(), "end": prefix.len() + 5},
                    "placeholder": "hello"
                }]
            })
        );
        assert_eq!(
            prepared["input"][1],
            json!({"type": "localImage", "path": canonical_root.join("photo.png")})
        );
        assert_eq!(
            prepared["input"][2],
            json!({"type": "localAudio", "path": canonical_root.join("voice.wav")})
        );
        Ok(())
    }

    #[tokio::test]
    async fn creates_a_user_message_for_file_only_input() -> Result<(), Box<dyn std::error::Error>>
    {
        let directory = tempfile::tempdir()?;
        let root = directory.path().join("attachments");
        tokio::fs::create_dir(&root).await?;
        tokio::fs::write(root.join("notes.md"), b"# Notes").await?;
        let canonical_file = tokio::fs::canonicalize(root.join("notes.md")).await?;
        let files = Arc::new(
            FileService::open(
                HashMap::from([("attachments".into(), root)]),
                Vec::new(),
                None,
                None,
            )
            .await?,
        );

        let prepared = prepare_remote_file_inputs(
            "turn/start",
            json!({"input": [
                {"type": "remoteFile", "rootId": "attachments", "path": "notes.md", "name": "notes.md", "kind": "file"}
            ]}),
            Some(files),
        )
        .await?;

        assert_eq!(
            prepared["input"],
            json!([{
                "type": "text",
                "text": format!(
                    "# Files mentioned by the user:\n\n## notes.md: {}\n\n## My request for Codex:\n\n",
                    canonical_file.display()
                ),
                "text_elements": []
            }])
        );
        Ok(())
    }

    #[tokio::test]
    async fn refuses_remote_files_without_a_scoped_file_service() {
        let result = prepare_remote_file_inputs(
            "turn/start",
            json!({"input": [{"type": "remoteFile", "rootId": "attachments", "path": "photo.png", "name": "photo", "kind": "image"}]}),
            None,
        )
        .await;
        assert!(matches!(
            result,
            Err(RemoteInputError::FileServiceUnavailable)
        ));
    }
}
