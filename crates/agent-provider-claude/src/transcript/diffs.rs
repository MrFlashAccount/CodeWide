//! File changes of Claude's edit tools as neutral `FileChange`s: from the
//! `tool_use` input while the call runs (and in stored history, which has no
//! structured result), and from the applied `structuredPatch` when the live
//! result carries it. Pure.

use std::fmt::Write;

use agent_core::model::{FileChange, FileChangeKind};
use serde_json::Value;

use super::json::{JsonRecord, arr_of, int_of, record, str_of};

fn lines(prefix: char, text: &str) -> String {
    if text.is_empty() {
        return String::new();
    }
    let mut out = String::with_capacity(text.len() * 2);
    for line in text.split('\n') {
        out.push(prefix);
        out.push_str(line);
        out.push('\n');
    }
    out
}

fn replacement(edit: &JsonRecord) -> String {
    lines('-', str_of(edit, "old_string").unwrap_or_default())
        + &lines('+', str_of(edit, "new_string").unwrap_or_default())
}

fn update(path: &str, diff: String) -> FileChange {
    FileChange {
        path: path.to_owned(),
        kind: FileChangeKind::Update,
        move_path: None,
        diff,
    }
}

fn add(path: &str, diff: String) -> FileChange {
    FileChange {
        path: path.to_owned(),
        kind: FileChangeKind::Add,
        move_path: None,
        diff,
    }
}

/// The change an edit tool call describes by its input.
#[must_use]
pub fn input_diff(name: &str, input: &JsonRecord) -> Vec<FileChange> {
    let path = str_of(input, "file_path")
        .or_else(|| str_of(input, "notebook_path"))
        .unwrap_or_default();
    match name {
        "Write" => vec![add(
            path,
            str_of(input, "content").unwrap_or_default().to_owned(),
        )],
        "MultiEdit" => vec![update(
            path,
            arr_of(input, "edits")
                .iter()
                .map(|edit| record(edit).map(replacement).unwrap_or_default())
                .collect(),
        )],
        "NotebookEdit" => vec![update(
            path,
            lines('+', str_of(input, "new_source").unwrap_or_default()),
        )],
        _ => vec![update(path, replacement(input))],
    }
}

struct PatchHunk {
    lines: Vec<String>,
    new_lines: i64,
    new_start: i64,
    old_lines: i64,
    old_start: i64,
}

fn parse_hunk(entry: &Value) -> Option<PatchHunk> {
    let entry = record(entry)?;
    Some(PatchHunk {
        lines: arr_of(entry, "lines")
            .iter()
            .filter_map(Value::as_str)
            .map(ToOwned::to_owned)
            .collect(),
        new_lines: int_of(entry, "newLines")?,
        new_start: int_of(entry, "newStart")?,
        old_lines: int_of(entry, "oldLines")?,
        old_start: int_of(entry, "oldStart")?,
    })
}

fn render_hunks(hunks: &[PatchHunk]) -> String {
    let mut out = String::new();
    for hunk in hunks {
        // Writing into a `String` cannot fail; the result is ignored on purpose.
        let _ = writeln!(
            out,
            "@@ -{},{} +{},{} @@",
            hunk.old_start, hunk.old_lines, hunk.new_start, hunk.new_lines
        );
        for line in &hunk.lines {
            out.push_str(line);
            out.push('\n');
        }
    }
    out
}

/// The unified diff of a structured result's patch, or `None` without hunks.
fn patch_diff(result: &JsonRecord, path: &str) -> Option<Vec<FileChange>> {
    let hunks = arr_of(result, "structuredPatch")
        .iter()
        .filter_map(parse_hunk)
        .collect::<Vec<_>>();
    (!hunks.is_empty()).then(|| vec![update(path, render_hunks(&hunks))])
}

/// What a `Write` result recorded: a created file, a patch, or the whole replaced content.
fn written_file(input: &JsonRecord, result: &JsonRecord, path: &str) -> Vec<FileChange> {
    if str_of(result, "type") == Some("create") {
        let content = str_of(result, "content")
            .or_else(|| str_of(input, "content"))
            .unwrap_or_default();
        return vec![add(path, content.to_owned())];
    }
    patch_diff(result, path).unwrap_or_else(|| {
        vec![update(
            path,
            lines('-', str_of(result, "originalFile").unwrap_or_default())
                + &lines('+', str_of(result, "content").unwrap_or_default()),
        )]
    })
}

/// The change an edit tool call applied, preferring its structured result.
#[must_use]
pub fn completed_diff(name: &str, input: &JsonRecord, tool_use_result: &Value) -> Vec<FileChange> {
    let fallback = input_diff(name, input);
    let Some(result) = record(tool_use_result) else {
        return fallback;
    };
    let result_path = str_of(result, "filePath");
    let path = result_path
        .or_else(|| fallback.first().map(|change| change.path.as_str()))
        .unwrap_or_default()
        .to_owned();
    let structured = if name == "Write" {
        Some(written_file(input, result, &path))
    } else {
        patch_diff(result, &path)
    };
    structured.unwrap_or_else(|| {
        fallback
            .into_iter()
            .map(|change| FileChange {
                path: result_path.map_or(change.path, ToOwned::to_owned),
                ..change
            })
            .collect()
    })
}
