//! The resource model of one thread: file changes with bounded patches and
//! attachments, built from client-wire items, neutral items or provider
//! records, plus the pure helpers the response builders share.

use std::{
    collections::{BTreeMap, HashSet},
    path::{Component, Path, PathBuf},
};

use agent_core::model::{AgentItem, FileChangeKind, UserContent};
use companion_host::vcs::{VcsFileStatus, VcsScope};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};

/// The largest diff text kept per path.
pub const MAX_DIFF_CHARS_PER_PATH: usize = 4 * 1024 * 1024;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangeResource {
    pub path: String,
    pub kind: ChangeKind,
    #[serde(default)]
    pub created_in_scope: bool,
    pub additions: u64,
    pub deletions: u64,
    pub turn_id: String,
    pub item_id: String,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ChangeKind {
    Add,
    Delete,
    Update,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ChangeScope {
    Session,
    LastTurn,
    Staged,
    Unstaged,
    Uncommitted,
    Branch,
}

impl ChangeScope {
    #[must_use]
    pub fn vcs(self) -> Option<VcsScope> {
        match self {
            Self::Session | Self::LastTurn => None,
            Self::Staged => Some(VcsScope::Staged),
            Self::Unstaged => Some(VcsScope::Unstaged),
            Self::Uncommitted => Some(VcsScope::Uncommitted),
            Self::Branch => Some(VcsScope::Branch),
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentResource {
    pub key: String,
    pub name: String,
    pub kind: AttachmentKind,
    pub path: Option<String>,
    pub url: Option<String>,
    pub origin: AttachmentOrigin,
    pub turn_id: String,
    pub item_id: String,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum AttachmentKind {
    Image,
    Audio,
    File,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum AttachmentOrigin {
    User,
    Agent,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangePatch {
    pub turn_id: String,
    pub item_id: String,
    pub kind: ChangeKind,
    pub diff: String,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub struct PatchBucket {
    pub patches: Vec<ChangePatch>,
    pub chars: usize,
    pub truncated: bool,
}

impl PatchBucket {
    pub fn merge_bucket(&mut self, other: Option<&Self>) {
        let Some(other) = other else {
            return;
        };
        for patch in &other.patches {
            if self.chars.saturating_add(patch.diff.len()) > MAX_DIFF_CHARS_PER_PATH {
                self.truncated = true;
                break;
            }
            self.chars = self.chars.saturating_add(patch.diff.len());
            self.patches.push(patch.clone());
        }
        self.truncated |= other.truncated;
    }
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub struct ResourceData {
    pub changes: BTreeMap<String, ChangeResource>,
    pub attachments: Vec<AttachmentResource>,
    pub patches: BTreeMap<String, PatchBucket>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct TurnResourceData {
    pub turn_id: String,
    pub data: ResourceData,
}

impl ResourceData {
    pub fn preview_paths(&self) -> Vec<PathBuf> {
        self.changes
            .keys()
            .chain(
                self.attachments
                    .iter()
                    .filter_map(|item| item.path.as_ref()),
            )
            .map(PathBuf::from)
            .collect()
    }

    pub fn item_ids(&self) -> HashSet<String> {
        self.changes
            .values()
            .map(|item| item.item_id.as_str())
            .chain(self.attachments.iter().map(|item| item.item_id.as_str()))
            .chain(
                self.patches
                    .values()
                    .flat_map(|bucket| &bucket.patches)
                    .map(|item| item.item_id.as_str()),
            )
            .filter(|item_id| !item_id.is_empty())
            .map(ToOwned::to_owned)
            .collect()
    }

    pub fn merge_missing_summary(&mut self, other: &Self) {
        let existing_item_ids = self.item_ids();
        for change in other.changes.values() {
            if !existing_item_ids.contains(change.item_id.as_str()) {
                self.upsert_change(change.clone());
            }
        }
        for attachment in &other.attachments {
            self.upsert_attachment(attachment.clone());
        }
    }

    #[must_use]
    pub fn resolved_against(&self, cwd: Option<&Path>) -> Self {
        let mut resolved = Self::default();
        for change in self.changes.values() {
            let mut change = change.clone();
            change.path = resolve_path(&change.path, cwd);
            resolved.upsert_change(change);
        }
        for attachment in &self.attachments {
            let mut attachment = attachment.clone();
            if let Some(path) = attachment.path.as_deref() {
                let path = resolve_path(path, cwd);
                attachment.key = format!("path:{path}");
                attachment.path = Some(path);
            }
            resolved.upsert_attachment(attachment);
        }
        for (path, bucket) in &self.patches {
            let path = resolve_path(path, cwd);
            for patch in &bucket.patches {
                resolved.append_patch(&path, patch.clone());
            }
            if bucket.truncated {
                resolved.patches.entry(path).or_default().truncated = true;
            }
        }
        resolved
    }

    pub fn merge(&mut self, other: &Self) {
        for change in other.changes.values() {
            self.upsert_change(change.clone());
        }
        for attachment in &other.attachments {
            self.upsert_attachment(attachment.clone());
        }
        for (path, bucket) in &other.patches {
            for patch in &bucket.patches {
                self.append_patch(path, patch.clone());
            }
            if bucket.truncated {
                self.patches.entry(path.clone()).or_default().truncated = true;
            }
        }
    }

    pub fn merge_summary(&mut self, other: &Self) {
        for change in other.changes.values() {
            self.upsert_change(change.clone());
        }
        for attachment in &other.attachments {
            self.upsert_attachment(attachment.clone());
        }
    }

    pub fn upsert_change(&mut self, change: ChangeResource) {
        if let Some(previous) = self.changes.get_mut(&change.path) {
            previous.kind = change.kind;
            previous.additions = previous.additions.saturating_add(change.additions);
            previous.deletions = previous.deletions.saturating_add(change.deletions);
            previous.turn_id = change.turn_id;
            previous.item_id = change.item_id;
        } else {
            self.changes.insert(change.path.clone(), change);
        }
    }

    pub fn upsert_attachment(&mut self, attachment: AttachmentResource) {
        if let Some(existing) = self
            .attachments
            .iter_mut()
            .find(|candidate| candidate.key == attachment.key)
        {
            *existing = attachment;
        } else {
            self.attachments.push(attachment);
        }
    }

    pub fn append_patch(&mut self, file_path: &str, change_patch: ChangePatch) {
        let bucket = self.patches.entry(file_path.to_owned()).or_default();
        if let Some(existing) = bucket.patches.iter_mut().find(|existing| {
            existing.turn_id == change_patch.turn_id && existing.item_id == change_patch.item_id
        }) {
            let next_chars = bucket
                .chars
                .saturating_sub(existing.diff.len())
                .saturating_add(change_patch.diff.len());
            if next_chars > MAX_DIFF_CHARS_PER_PATH {
                bucket.truncated = true;
                return;
            }
            bucket.chars = next_chars;
            *existing = change_patch;
        } else if bucket.chars.saturating_add(change_patch.diff.len()) > MAX_DIFF_CHARS_PER_PATH {
            bucket.truncated = true;
        } else {
            bucket.chars = bucket.chars.saturating_add(change_patch.diff.len());
            bucket.patches.push(change_patch);
        }
    }

    pub fn apply_change(
        &mut self,
        turn_id: &str,
        item_id: &str,
        path: &str,
        raw: &Value,
        cwd: Option<&Path>,
    ) {
        let kind_name = raw
            .get("kind")
            .and_then(|kind| {
                kind.as_str()
                    .or_else(|| kind.get("type").and_then(Value::as_str))
            })
            .or_else(|| raw.get("type").and_then(Value::as_str))
            .unwrap_or("update");
        let kind = match kind_name {
            "add" => ChangeKind::Add,
            "delete" => ChangeKind::Delete,
            _ => ChangeKind::Update,
        };
        let moved = raw
            .get("kind")
            .and_then(|kind| kind.get("move_path"))
            .or_else(|| raw.get("move_path"))
            .and_then(Value::as_str)
            .filter(|value| !value.is_empty());
        let resolved = resolve_path(moved.unwrap_or(path), cwd);
        let diff = raw
            .get("diff")
            .or_else(|| raw.get("unified_diff"))
            .or_else(|| raw.get("content"))
            .and_then(Value::as_str)
            .map(ToOwned::to_owned)
            .unwrap_or_default();
        let (additions, deletions) = diff_stats(&diff);
        self.upsert_change(ChangeResource {
            path: resolved.clone(),
            kind,
            created_in_scope: kind == ChangeKind::Add,
            additions,
            deletions,
            turn_id: turn_id.to_owned(),
            item_id: item_id.to_owned(),
        });
        if !diff.is_empty() {
            self.append_patch(
                &resolved,
                ChangePatch {
                    turn_id: turn_id.to_owned(),
                    item_id: item_id.to_owned(),
                    kind,
                    diff,
                },
            );
        }
    }

    /// Applies one neutral item, as its client-wire projection would apply.
    pub fn apply_agent_item(&mut self, turn_id: &str, item: &AgentItem, cwd: Option<&Path>) {
        let item_id = item.item_id().as_str();
        match item {
            AgentItem::FileChange { changes, .. } => {
                for change in changes {
                    // The client-wire shape: only an update carries its move.
                    let kind = match change.kind {
                        FileChangeKind::Add => json!({"type": "add"}),
                        FileChangeKind::Delete => json!({"type": "delete"}),
                        FileChangeKind::Update => {
                            json!({"type": "update", "move_path": change.move_path})
                        }
                    };
                    let raw = json!({"kind": kind, "diff": change.diff});
                    self.apply_change(turn_id, item_id, &change.path, &raw, cwd);
                }
            }
            AgentItem::UserMessage { content, .. } => {
                for part in content {
                    let part = match part {
                        UserContent::Text { text } => json!({"type": "text", "text": text}),
                        UserContent::LocalImage { path } => {
                            json!({"type": "localImage", "path": path})
                        }
                        UserContent::Image { url } => json!({"type": "image", "url": url}),
                    };
                    self.apply_user_part(turn_id, item_id, &part, cwd);
                }
            }
            AgentItem::ImageView { path, .. } => self.local_attachment(
                path,
                AttachmentKind::Image,
                AttachmentOrigin::Agent,
                turn_id,
                item_id,
                None,
                cwd,
            ),
            AgentItem::AgentMessage { text, .. } => {
                self.agent_markdown_links(text, turn_id, item_id, cwd);
            }
            _ => {}
        }
    }

    pub fn apply_materialized_item(&mut self, turn_id: &str, item: &Value, cwd: Option<&Path>) {
        let item_id = item.get("id").and_then(Value::as_str).unwrap_or("");
        match item.get("type").and_then(Value::as_str) {
            Some("FileChange") => {
                if let Some(changes) = item.get("changes").and_then(Value::as_object) {
                    for (path, raw) in changes {
                        self.apply_change(turn_id, item_id, path, raw, cwd);
                    }
                }
            }
            Some("fileChange") => {
                if let Some(changes) = item.get("changes").and_then(Value::as_array) {
                    for raw in changes {
                        if let Some(path) = raw.get("path").and_then(Value::as_str) {
                            self.apply_change(turn_id, item_id, path, raw, cwd);
                        }
                    }
                }
            }
            Some("userMessage") => {
                if let Some(content) = item.get("content").and_then(Value::as_array) {
                    for part in content {
                        self.apply_user_part(turn_id, item_id, part, cwd);
                    }
                }
            }
            Some("imageView") => {
                if let Some(path) = item.get("path").and_then(Value::as_str) {
                    self.local_attachment(
                        path,
                        AttachmentKind::Image,
                        AttachmentOrigin::Agent,
                        turn_id,
                        item_id,
                        None,
                        cwd,
                    );
                }
            }
            Some("imageGeneration") => {
                if let Some(path) = item.get("savedPath").and_then(Value::as_str) {
                    self.local_attachment(
                        path,
                        AttachmentKind::Image,
                        AttachmentOrigin::Agent,
                        turn_id,
                        item_id,
                        None,
                        cwd,
                    );
                } else if let Some(url) = item
                    .get("result")
                    .and_then(Value::as_str)
                    .filter(|url| remote_url(url))
                {
                    self.remote_attachment(
                        url,
                        "Generated image",
                        AttachmentKind::Image,
                        AttachmentOrigin::Agent,
                        turn_id,
                        item_id,
                    );
                }
            }
            Some("agentMessage") => {
                if let Some(text) = item.get("text").and_then(Value::as_str) {
                    self.agent_markdown_links(text, turn_id, item_id, cwd);
                }
            }
            _ => {}
        }
    }

    pub fn apply_user_part(
        &mut self,
        turn_id: &str,
        item_id: &str,
        part: &Value,
        cwd: Option<&Path>,
    ) {
        match part.get("type").and_then(Value::as_str) {
            Some("text") => {
                if let Some(text) = part.get("text").and_then(Value::as_str) {
                    self.mentioned_files(text, turn_id, item_id, cwd);
                }
            }
            Some("localImage") => {
                self.local_part(part, "path", AttachmentKind::Image, turn_id, item_id, cwd);
            }
            Some("localAudio") => {
                self.local_part(part, "path", AttachmentKind::Audio, turn_id, item_id, cwd);
            }
            Some("mention") => {
                self.local_part(part, "path", AttachmentKind::File, turn_id, item_id, cwd);
            }
            Some("image") => self.remote_part(
                part,
                "url",
                "Image",
                AttachmentKind::Image,
                turn_id,
                item_id,
            ),
            Some("audio") => self.remote_part(
                part,
                "url",
                "Audio",
                AttachmentKind::Audio,
                turn_id,
                item_id,
            ),
            _ => {}
        }
    }

    pub fn local_part(
        &mut self,
        part: &Value,
        field: &str,
        kind: AttachmentKind,
        turn_id: &str,
        item_id: &str,
        cwd: Option<&Path>,
    ) {
        if let Some(path) = part.get(field).and_then(Value::as_str) {
            let name = part.get("name").and_then(Value::as_str);
            self.local_attachment(
                path,
                kind,
                AttachmentOrigin::User,
                turn_id,
                item_id,
                name,
                cwd,
            );
        }
    }

    pub fn remote_part(
        &mut self,
        part: &Value,
        field: &str,
        name: &str,
        kind: AttachmentKind,
        turn_id: &str,
        item_id: &str,
    ) {
        if let Some(url) = part
            .get(field)
            .and_then(Value::as_str)
            .filter(|url| remote_url(url))
        {
            self.remote_attachment(url, name, kind, AttachmentOrigin::User, turn_id, item_id);
        }
    }

    #[allow(clippy::too_many_arguments)]
    pub fn local_attachment(
        &mut self,
        path: &str,
        kind: AttachmentKind,
        origin: AttachmentOrigin,
        turn_id: &str,
        item_id: &str,
        name: Option<&str>,
        cwd: Option<&Path>,
    ) {
        if path.contains('\0') || path.is_empty() {
            return;
        }
        let resolved = resolve_path(path, cwd);
        let name = name
            .filter(|value| !value.is_empty())
            .map_or_else(|| file_name(&resolved), ToOwned::to_owned);
        self.upsert_attachment(AttachmentResource {
            key: format!("path:{resolved}"),
            name,
            kind,
            path: Some(resolved),
            url: None,
            origin,
            turn_id: turn_id.to_owned(),
            item_id: item_id.to_owned(),
        });
    }

    #[allow(clippy::too_many_arguments)]
    pub fn remote_attachment(
        &mut self,
        url: &str,
        name: &str,
        kind: AttachmentKind,
        origin: AttachmentOrigin,
        turn_id: &str,
        item_id: &str,
    ) {
        self.upsert_attachment(AttachmentResource {
            key: format!("url:{url}"),
            name: name.to_owned(),
            kind,
            path: None,
            url: Some(url.to_owned()),
            origin,
            turn_id: turn_id.to_owned(),
            item_id: item_id.to_owned(),
        });
    }

    pub fn mentioned_files(
        &mut self,
        text: &str,
        turn_id: &str,
        item_id: &str,
        cwd: Option<&Path>,
    ) {
        let mut in_files = false;
        for line in text.lines() {
            let trimmed = line.trim();
            if trimmed == "# Files mentioned by the user:" {
                in_files = true;
                continue;
            }
            if in_files && (trimmed == "## My request:" || trimmed == "## My request for Codex:") {
                break;
            }
            if !in_files {
                continue;
            }
            let Some(entry) = trimmed.strip_prefix("## ") else {
                continue;
            };
            let Some((name, raw_path)) = entry.split_once(':') else {
                continue;
            };
            let name = name.trim();
            let path = raw_path.trim().trim_matches('`');
            if !name.is_empty() && !path.is_empty() {
                self.local_attachment(
                    path,
                    attachment_kind(name, path),
                    AttachmentOrigin::User,
                    turn_id,
                    item_id,
                    Some(name),
                    cwd,
                );
            }
        }
    }

    pub fn agent_markdown_links(
        &mut self,
        text: &str,
        turn_id: &str,
        item_id: &str,
        cwd: Option<&Path>,
    ) {
        for path in markdown_local_paths(text) {
            self.local_attachment(
                &path,
                attachment_kind(&path, &path),
                AttachmentOrigin::Agent,
                turn_id,
                item_id,
                None,
                cwd,
            );
        }
    }
}

#[must_use]
pub fn vcs_change_kind(status: VcsFileStatus) -> &'static str {
    match status {
        VcsFileStatus::Added | VcsFileStatus::Untracked => "add",
        VcsFileStatus::Deleted => "delete",
        VcsFileStatus::Modified | VcsFileStatus::Renamed | VcsFileStatus::Conflicted => "update",
    }
}

pub fn observe_turns(data: &mut ResourceData, turns: Option<&Value>, cwd: Option<&Path>) {
    let Some(turns) = turns.and_then(Value::as_array) else {
        return;
    };
    for turn in turns {
        observe_turn(data, turn, cwd);
    }
}

pub fn observe_turn(data: &mut ResourceData, turn: &Value, cwd: Option<&Path>) {
    let turn_id = turn.get("id").and_then(Value::as_str).unwrap_or("");
    let Some(items) = turn.get("items").and_then(Value::as_array) else {
        return;
    };
    for item in items {
        data.apply_materialized_item(turn_id, item, cwd);
    }
}

pub fn markdown_local_paths(text: &str) -> Vec<String> {
    let mut paths = Vec::new();
    let bytes = text.as_bytes();
    let mut cursor = 0;
    while cursor + 1 < bytes.len() {
        let Some(link_start) = text[cursor..].find("](") else {
            break;
        };
        let mut index = cursor + link_start + 2;
        while bytes.get(index).is_some_and(u8::is_ascii_whitespace) {
            index += 1;
        }
        let angle = bytes.get(index) == Some(&b'<');
        if angle {
            index += 1;
        }
        let start = index;
        let mut escaped = false;
        while let Some(&byte) = bytes.get(index) {
            if escaped {
                escaped = false;
                index += 1;
                continue;
            }
            if byte == b'\\' {
                escaped = true;
                index += 1;
                continue;
            }
            if (angle && byte == b'>') || (!angle && (byte == b')' || byte.is_ascii_whitespace())) {
                break;
            }
            index += 1;
        }
        cursor = index.saturating_add(1);
        if index == start || (angle && bytes.get(index) != Some(&b'>')) {
            continue;
        }
        let raw = text[start..index].replace("\\ ", " ");
        let without_fragment = raw.split_once('#').map_or(raw.as_str(), |(path, _)| path);
        let without_suffix = without_fragment
            .split_once('?')
            .map_or(without_fragment, |(path, _)| path);
        if without_suffix.is_empty()
            || without_suffix.starts_with('#')
            || without_suffix.starts_with("//")
            || has_uri_scheme(without_suffix)
        {
            continue;
        }
        if let Ok(decoded) = percent_encoding::percent_decode_str(without_suffix).decode_utf8()
            && !decoded.is_empty()
        {
            paths.push(decoded.into_owned());
        }
    }
    paths
}

#[must_use]
pub fn has_uri_scheme(value: &str) -> bool {
    let Some((scheme, _rest)) = value.split_once(':') else {
        return false;
    };
    let mut bytes = scheme.bytes();
    bytes.next().is_some_and(|byte| byte.is_ascii_alphabetic())
        && bytes.all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'+' | b'.' | b'-'))
}

#[must_use]
pub fn resolve_path(value: &str, cwd: Option<&Path>) -> String {
    let path = Path::new(value);
    let joined = if path.is_absolute() {
        path.to_path_buf()
    } else {
        cwd.map_or_else(|| path.to_path_buf(), |cwd| cwd.join(path))
    };
    lexical_normalize(&joined).to_string_lossy().into_owned()
}

#[must_use]
pub fn lexical_normalize(path: &Path) -> PathBuf {
    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                if !normalized.pop() && !path.is_absolute() {
                    normalized.push("..");
                }
            }
            other => normalized.push(other.as_os_str()),
        }
    }
    normalized
}

#[must_use]
pub fn diff_stats(diff: &str) -> (u64, u64) {
    let mut additions = 0_u64;
    let mut deletions = 0_u64;
    for line in diff.lines() {
        if line.starts_with("+++") || line.starts_with("---") {
            continue;
        }
        if line.starts_with('+') {
            additions = additions.saturating_add(1);
        } else if line.starts_with('-') {
            deletions = deletions.saturating_add(1);
        }
    }
    (additions, deletions)
}

#[must_use]
pub fn attachment_kind(name: &str, path: &str) -> AttachmentKind {
    let extension = Path::new(path)
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if matches!(
        extension.as_str(),
        "png" | "jpg" | "jpeg" | "gif" | "webp" | "bmp" | "avif" | "heic" | "heif"
    ) {
        AttachmentKind::Image
    } else if matches!(
        extension.as_str(),
        "wav" | "mp3" | "m4a" | "aac" | "ogg" | "flac"
    ) {
        AttachmentKind::Audio
    } else if name.to_ascii_lowercase().ends_with(".png") {
        AttachmentKind::Image
    } else {
        AttachmentKind::File
    }
}

#[must_use]
pub fn file_name(path: &str) -> String {
    Path::new(path)
        .file_name()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .unwrap_or("Attachment")
        .to_owned()
}

#[must_use]
pub fn remote_url(value: &str) -> bool {
    value.starts_with("https://") || value.starts_with("http://")
}

/// A short hash of the data's changes and attachments.
///
/// # Errors
///
/// Returns an error when the data cannot be serialized.
pub fn resource_revision(data: &ResourceData) -> Result<String, serde_json::Error> {
    let changes = data.changes.values().collect::<Vec<_>>();
    let raw = serde_json::to_string(&(changes, &data.attachments))?;
    let mut hash = 2_166_136_261_u32;
    for unit in raw.encode_utf16() {
        hash ^= u32::from(unit);
        hash = hash.wrapping_mul(16_777_619);
    }
    Ok(base36(hash))
}

pub fn availability_revision(changes: &[Value]) -> String {
    let mut raw = String::new();
    for (index, change) in changes.iter().enumerate() {
        if index > 0 {
            raw.push('\0');
        }
        raw.push_str(change.get("path").and_then(Value::as_str).unwrap_or(""));
        raw.push('\0');
        raw.push_str(
            change
                .get("availability")
                .and_then(Value::as_str)
                .unwrap_or("unavailable"),
        );
    }
    hex::encode(Sha256::digest(raw.as_bytes()))[..12].to_owned()
}

#[must_use]
pub fn base36(mut value: u32) -> String {
    if value == 0 {
        return "0".into();
    }
    let mut output = Vec::new();
    while value > 0 {
        let digit = u8::try_from(value % 36).unwrap_or(0);
        output.push(if digit < 10 {
            b'0' + digit
        } else {
            b'a' + digit - 10
        });
        value /= 36;
    }
    output.reverse();
    String::from_utf8(output).unwrap_or_default()
}
