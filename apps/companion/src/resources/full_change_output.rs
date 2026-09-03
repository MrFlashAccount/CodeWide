//! Lazy, bounded reconstruction of diff output from the canonical rollout.

#[cfg(test)]
use super::MAX_DIFF_CHARS_PER_PATH;
use super::{
    ChangeScope, File, IndexStore, Path, PathBuf, ResourceError, ResourceRequestContext,
    ResourceService, StoreError, Value, VcsError, VcsScope, VcsService, index_rollout_fully, json,
    read_exact_at, resolve_path, rollout_file_id,
};

#[derive(Clone)]
struct PatchLocator {
    item_id: String,
    raw_path: String,
    record: crate::store::RecordRef,
    text_bytes: usize,
}

#[derive(Default)]
struct PatchTurn {
    id: String,
    patches: Vec<PatchLocator>,
}

#[derive(Default)]
struct PatchTimeline {
    active: Option<PatchTurn>,
    cwd: Option<PathBuf>,
    turns: Vec<PatchTurn>,
}

pub(super) struct FullChangeOutputPage {
    pub(super) content: String,
    pub(super) next_offset: usize,
    pub(super) revision: String,
    pub(super) total_bytes: usize,
}

impl ResourceService {
    pub(super) async fn handle_thread_change_output(
        &self,
        params: &Value,
        context: &ResourceRequestContext,
    ) -> Result<Value, ResourceError> {
        let requested = params
            .get("path")
            .and_then(Value::as_str)
            .filter(|value| !value.is_empty())
            .ok_or(ResourceError::MissingPath)?;
        let offset = params
            .get("offset")
            .and_then(Value::as_u64)
            .and_then(|value| usize::try_from(value).ok())
            .unwrap_or(0);
        let limit = params
            .get("limitBytes")
            .and_then(Value::as_u64)
            .and_then(|value| usize::try_from(value).ok())
            .filter(|value| *value > 0)
            .unwrap_or(65_536);
        let resolved = resolve_path(requested, context.projection.cwd.as_deref());
        let mut effective_scope = context.requested_scope;
        if let Some(vcs_scope) = context.requested_scope.vcs() {
            if let Some(response) = vcs_change_page_response(
                self.vcs.as_deref(),
                context.projection.cwd.as_deref(),
                &context.thread_id,
                &resolved,
                vcs_scope,
                offset,
                limit,
            )
            .await?
            {
                return Ok(response);
            }
            effective_scope = ChangeScope::Session;
        }
        let source_path = context.projection.source_path.clone();
        let index = self.index.clone();
        let selected_path = resolved.clone();
        let page = tokio::task::spawn_blocking(move || {
            read_rollout_change_page(
                &source_path,
                &index,
                &selected_path,
                effective_scope,
                offset,
                limit,
            )
        })
        .await
        .map_err(|_| ResourceError::Join)??;
        Ok(json!({
            "threadId": context.thread_id,
            "path": resolved,
            "changeScope": effective_scope,
            "content": page.content,
            "revision": page.revision,
            "totalBytes": page.total_bytes,
            "nextOffset": page.next_offset,
        }))
    }
}

async fn vcs_change_page_response(
    vcs: Option<&VcsService>,
    cwd: Option<&Path>,
    thread_id: &str,
    resolved: &str,
    scope: VcsScope,
    offset: usize,
    limit: usize,
) -> Result<Option<Value>, ResourceError> {
    let (Some(vcs), Some(cwd)) = (vcs, cwd) else {
        return Ok(None);
    };
    match vcs
        .diff_page(cwd, Path::new(resolved), scope, offset, limit)
        .await
    {
        Ok(page) => Ok(Some(json!({
            "threadId": thread_id,
            "path": page.path,
            "changeScope": page.scope,
            "content": page.content,
            "revision": format!("{}.{}", page.snapshot_id, page.revision),
            "totalBytes": page.total_bytes,
            "nextOffset": page.next_offset,
        }))),
        Err(VcsError::FileNotChanged(_)) => Ok(Some(json!({
            "threadId": thread_id,
            "path": resolved,
            "changeScope": scope,
            "content": "",
            "revision": "unchanged",
            "totalBytes": 0,
            "nextOffset": 0,
        }))),
        Err(VcsError::UnsupportedWorkspace(_)) => Ok(None),
        Err(error) => Err(error.into()),
    }
}

fn read_rollout_change_page(
    rollout_path: &Path,
    index: &IndexStore,
    requested_path: &str,
    scope: ChangeScope,
    offset: usize,
    limit: usize,
) -> Result<FullChangeOutputPage, ResourceError> {
    index_rollout_fully(index, rollout_path)?;
    let file_id = rollout_file_id(rollout_path);
    let state = index.file_state(&file_id)?.ok_or_else(|| {
        StoreError::CorruptedIndex("rollout checkpoint is missing after indexing".into())
    })?;
    let file = File::open(rollout_path)?;
    let mut timeline = PatchTimeline::default();
    for record in index.records_from(&file_id, 0)? {
        if !matches!(record.record_type, 1 | 3) {
            continue;
        }
        let line = read_record(&file, record)?;
        timeline.apply(record, &line, requested_path);
    }
    let patches = timeline.selected(scope);
    let total_bytes = patches
        .iter()
        .map(|patch| patch.text_bytes)
        .sum::<usize>()
        .saturating_add(patches.len().saturating_sub(1));
    if offset > total_bytes {
        return Err(ResourceError::InvalidOffset);
    }
    let (content, next_offset) = read_page(&file, &patches, offset, limit)?;
    let revision = format!(
        "rollout.{}.{}.{}.{}",
        state.device,
        state.inode,
        state.indexed_bytes,
        hex::encode(state.tail_hash)
    );
    Ok(FullChangeOutputPage {
        content,
        next_offset,
        revision,
        total_bytes,
    })
}

impl PatchTimeline {
    fn apply(&mut self, record: crate::store::RecordRef, line: &[u8], requested_path: &str) {
        let Ok(envelope) = serde_json::from_slice::<Value>(line) else {
            return;
        };
        let Some(payload) = envelope.get("payload") else {
            return;
        };
        let kind = payload
            .get("type")
            .and_then(Value::as_str)
            .or_else(|| envelope.get("type").and_then(Value::as_str))
            .unwrap_or("");
        match kind {
            "session_meta" => {
                self.cwd = payload
                    .get("cwd")
                    .and_then(Value::as_str)
                    .filter(|value| Path::new(value).is_absolute())
                    .map(PathBuf::from);
            }
            "task_started" => {
                if let Some(turn_id) = payload.get("turn_id").and_then(Value::as_str) {
                    self.start(turn_id);
                }
            }
            "task_complete" | "turn_aborted" => {
                let turn_id = payload
                    .get("turn_id")
                    .and_then(Value::as_str)
                    .or_else(|| self.active.as_ref().map(|turn| turn.id.as_str()))
                    .unwrap_or("")
                    .to_owned();
                self.complete(&turn_id);
            }
            "thread_rolled_back" => {
                let count = payload
                    .get("num_turns")
                    .and_then(Value::as_u64)
                    .and_then(|value| usize::try_from(value).ok())
                    .unwrap_or(1);
                self.turns.truncate(self.turns.len().saturating_sub(count));
                self.active = None;
            }
            "patch_apply_end" => self.apply_patch(record, payload, requested_path),
            _ => {}
        }
    }

    fn start(&mut self, turn_id: &str) {
        if self.active.as_ref().is_some_and(|turn| turn.id == turn_id) {
            return;
        }
        if let Some(active) = self.active.take() {
            self.turns.push(active);
        }
        self.active = Some(PatchTurn {
            id: turn_id.to_owned(),
            patches: Vec::new(),
        });
    }

    fn complete(&mut self, turn_id: &str) {
        if self.active.as_ref().is_some_and(|turn| turn.id == turn_id)
            && let Some(active) = self.active.take()
        {
            self.turns.push(active);
        }
    }

    fn apply_patch(
        &mut self,
        record: crate::store::RecordRef,
        payload: &Value,
        requested_path: &str,
    ) {
        let turn_id = payload
            .get("turn_id")
            .and_then(Value::as_str)
            .map(ToOwned::to_owned)
            .or_else(|| self.active.as_ref().map(|turn| turn.id.clone()))
            .unwrap_or_default();
        let Some(active) = self.active.as_mut().filter(|turn| turn.id == turn_id) else {
            return;
        };
        let item_id = payload.get("call_id").and_then(Value::as_str).unwrap_or("");
        let Some(changes) = payload.get("changes").and_then(Value::as_object) else {
            return;
        };
        for (raw_path, change) in changes {
            let moved = change
                .get("kind")
                .and_then(|kind| kind.get("move_path"))
                .or_else(|| change.get("move_path"))
                .and_then(Value::as_str)
                .filter(|value| !value.is_empty());
            let resolved = resolve_path(moved.unwrap_or(raw_path), self.cwd.as_deref());
            if resolved != requested_path {
                continue;
            }
            let Some(diff) = change
                .get("diff")
                .or_else(|| change.get("unified_diff"))
                .or_else(|| change.get("content"))
                .and_then(Value::as_str)
                .filter(|value| !value.is_empty())
            else {
                continue;
            };
            let locator = PatchLocator {
                item_id: item_id.to_owned(),
                raw_path: raw_path.clone(),
                record,
                text_bytes: diff.len(),
            };
            if let Some(existing) = active
                .patches
                .iter_mut()
                .find(|existing| existing.item_id == item_id)
            {
                *existing = locator;
            } else {
                active.patches.push(locator);
            }
        }
    }

    fn selected(&self, scope: ChangeScope) -> Vec<PatchLocator> {
        if scope == ChangeScope::LastTurn {
            return self
                .active
                .as_ref()
                .or_else(|| self.turns.last())
                .map_or_else(Vec::new, |turn| turn.patches.clone());
        }
        self.turns
            .iter()
            .flat_map(|turn| turn.patches.iter().cloned())
            .chain(
                self.active
                    .iter()
                    .flat_map(|turn| turn.patches.iter().cloned()),
            )
            .collect()
    }
}

fn read_page(
    file: &File,
    patches: &[PatchLocator],
    offset: usize,
    limit: usize,
) -> Result<(String, usize), ResourceError> {
    let mut output = String::new();
    let mut logical_offset = 0;
    let mut next_offset = offset;
    for (index, patch) in patches.iter().enumerate() {
        if index > 0
            && !append_segment(
                "\n",
                logical_offset,
                offset,
                limit,
                &mut output,
                &mut next_offset,
            )?
        {
            return Ok((output, next_offset));
        }
        logical_offset = logical_offset.saturating_add(usize::from(index > 0));
        let line = read_record(file, patch.record)?;
        let diff = patch_text(&line, &patch.raw_path).ok_or(ResourceError::InvalidPatchRecord)?;
        if !append_segment(
            &diff,
            logical_offset,
            offset,
            limit,
            &mut output,
            &mut next_offset,
        )? {
            return Ok((output, next_offset));
        }
        logical_offset = logical_offset.saturating_add(diff.len());
    }
    Ok((output, next_offset))
}

fn append_segment(
    segment: &str,
    segment_offset: usize,
    requested_offset: usize,
    limit: usize,
    output: &mut String,
    next_offset: &mut usize,
) -> Result<bool, ResourceError> {
    let segment_end = segment_offset.saturating_add(segment.len());
    if segment_end <= requested_offset {
        return Ok(true);
    }
    let local_start = requested_offset.saturating_sub(segment_offset);
    if !segment.is_char_boundary(local_start) {
        return Err(ResourceError::InvalidOffset);
    }
    let remaining = limit.saturating_sub(output.len());
    if remaining == 0 {
        return Ok(false);
    }
    let mut local_end = segment.len().min(local_start.saturating_add(remaining));
    while local_end > local_start && !segment.is_char_boundary(local_end) {
        local_end -= 1;
    }
    if local_end == local_start && local_start < segment.len() {
        return Ok(false);
    }
    output.push_str(&segment[local_start..local_end]);
    *next_offset = segment_offset.saturating_add(local_end);
    Ok(local_end == segment.len())
}

fn read_record(file: &File, record: crate::store::RecordRef) -> Result<Vec<u8>, ResourceError> {
    let mut line = vec![0_u8; usize::try_from(record.length).map_err(std::io::Error::other)?];
    read_exact_at(file, record.offset, &mut line)?;
    Ok(line)
}

fn patch_text(line: &[u8], raw_path: &str) -> Option<String> {
    let envelope = serde_json::from_slice::<Value>(line).ok()?;
    let change = envelope.get("payload")?.get("changes")?.get(raw_path)?;
    change
        .get("diff")
        .or_else(|| change.get("unified_diff"))
        .or_else(|| change.get("content"))?
        .as_str()
        .map(ToOwned::to_owned)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn canonical_rollout_output_remains_available_beyond_preview_cap()
    -> Result<(), Box<dyn std::error::Error>> {
        let directory = tempfile::tempdir()?;
        let rollout = directory.path().join("rollout.jsonl");
        let diff = format!("+{}\n", "x".repeat(MAX_DIFF_CHARS_PER_PATH + 128));
        let records = [
            envelope(
                "session_meta",
                &json!({"type": "session_meta", "id": "thread", "cwd": "/repo"}),
            )?,
            envelope(
                "event_msg",
                &json!({"type": "task_started", "turn_id": "turn"}),
            )?,
            envelope(
                "event_msg",
                &json!({
                    "type": "patch_apply_end",
                    "call_id": "patch",
                    "changes": {"src/main.rs": {"type": "update", "diff": diff}}
                }),
            )?,
            envelope(
                "event_msg",
                &json!({"type": "task_complete", "turn_id": "turn"}),
            )?,
        ];
        let encoded = records.join("\n") + "\n";
        std::fs::write(&rollout, encoded)?;
        let index = IndexStore::open(directory.path().join("index.redb"))?;

        let first = read_rollout_change_page(
            &rollout,
            &index,
            "/repo/src/main.rs",
            ChangeScope::Session,
            0,
            65_536,
        )?;
        let second = read_rollout_change_page(
            &rollout,
            &index,
            "/repo/src/main.rs",
            ChangeScope::Session,
            first.next_offset,
            65_536,
        )?;

        assert_eq!(first.content.len(), 65_536);
        assert_eq!(second.content.len(), 65_536);
        assert_eq!(first.total_bytes, MAX_DIFF_CHARS_PER_PATH + 130);
        assert!(first.next_offset < first.total_bytes);
        assert_eq!(second.revision, first.revision);
        Ok(())
    }

    fn envelope(kind: &str, payload: &Value) -> Result<String, serde_json::Error> {
        Ok(format!(
            "{{\"type\":{},\"payload\":{}}}",
            serde_json::to_string(kind)?,
            serde_json::to_string(&payload)?
        ))
    }
}
