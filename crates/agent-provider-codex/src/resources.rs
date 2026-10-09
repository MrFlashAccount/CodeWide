//! Thread resources of Codex threads: the shared `agent-resources` reads
//! over a projection built from canonical rollout records, kept in a compact,
//! crash-safe redb store; plus the full change output read from the rollout.

use std::{
    fs::File,
    path::{Path, PathBuf},
    sync::Arc,
    time::{SystemTime, UNIX_EPOCH},
};

#[cfg(not(unix))]
use std::io::{Read, Seek, SeekFrom};
#[cfg(unix)]
use std::os::unix::fs::FileExt;

pub use agent_resources::ResourceError;
use agent_resources::{
    ProjectionSource, ResourceProjection, ThreadResources,
    data::{AttachmentKind, AttachmentOrigin, remote_url},
};
use async_trait::async_trait;
use companion_host::{
    files::PreviewFiles,
    index::StoreError,
    vcs::{VcsError, WorkspaceVcs},
};
use redb::{Database, ReadableDatabase, TableDefinition};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::{
    catalog::{CatalogError, SessionCatalog},
    rollout::{IndexError, index_rollout_fully, rollout_file_id},
    rollout_store::RolloutStore,
};

mod full_change_output;

const PROJECTIONS: TableDefinition<&str, &[u8]> = TableDefinition::new("thread_resources");
const PROJECTION_VERSION: u8 = 10;
const TAIL_CHECK_BYTES: u64 = 4_096;

/// Thread resources of Codex threads.
#[derive(Clone)]
pub struct ResourceService {
    resources: ThreadResources<RolloutProjections>,
    index: Arc<RolloutStore>,
}

/// Projections refreshed from canonical rollouts.
struct RolloutProjections {
    catalog: Arc<SessionCatalog>,
    index: Arc<RolloutStore>,
    store: Arc<ResourceStore>,
}

#[async_trait]
impl ProjectionSource for RolloutProjections {
    type Projection = PersistedProjection;

    async fn refresh(&self, thread_id: &str) -> Result<PersistedProjection, ResourceError> {
        let catalog = self.catalog.clone();
        let store = self.store.clone();
        let index = self.index.clone();
        let thread_id = thread_id.to_owned();
        tokio::task::spawn_blocking(move || {
            let path = catalog
                .resolve(&thread_id)
                .map_err(RolloutResourceError::from)?;
            store.refresh(&thread_id, &path, &index)
        })
        .await
        .map_err(|_| ResourceError::Join)?
        .map_err(ResourceError::from)
    }
}

struct ResourceStore {
    database: Arc<Database>,
}

/// The persisted projection of one rollout: its source checkpoint and the
/// shared resource projection.
#[derive(Clone, Debug, Deserialize, Serialize)]
struct PersistedProjection {
    version: u8,
    source_path: PathBuf,
    device: u64,
    inode: u64,
    indexed_bytes: u64,
    tail_hash: [u8; 32],
    #[serde(flatten)]
    projection: ResourceProjection,
}

impl AsRef<ResourceProjection> for PersistedProjection {
    fn as_ref(&self) -> &ResourceProjection {
        &self.projection
    }
}

impl PersistedProjection {
    fn empty(path: PathBuf, device: u64, inode: u64) -> Self {
        Self {
            version: PROJECTION_VERSION,
            source_path: path,
            device,
            inode,
            indexed_bytes: 0,
            tail_hash: [0; 32],
            projection: ResourceProjection::default(),
        }
    }
}

/// A failure of the rollout projection; it reaches the client through
/// [`ResourceError::Source`] with its own message.
#[derive(Debug, thiserror::Error)]
enum RolloutResourceError {
    #[error(transparent)]
    Catalog(#[from] CatalogError),
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Database(#[from] redb::Error),
    #[error(transparent)]
    DatabaseOpen(#[from] redb::DatabaseError),
    #[error(transparent)]
    Transaction(#[from] redb::TransactionError),
    #[error(transparent)]
    Table(#[from] redb::TableError),
    #[error(transparent)]
    Storage(#[from] redb::StorageError),
    #[error(transparent)]
    Commit(#[from] redb::CommitError),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
    #[error(transparent)]
    Index(#[from] IndexError),
    #[error(transparent)]
    Store(#[from] StoreError),
    #[error("path is required")]
    MissingPath,
    #[error("change output offset is invalid")]
    InvalidOffset,
    #[error("canonical change output record is invalid")]
    InvalidPatchRecord,
    #[error("resource projection task failed")]
    Join,
    #[error(transparent)]
    Vcs(#[from] VcsError),
}

impl From<RolloutResourceError> for ResourceError {
    fn from(error: RolloutResourceError) -> Self {
        Self::Source(Box::new(error))
    }
}

impl ResourceService {
    /// Opens the compact, crash-safe projection store. It contains only file
    /// metadata, attachment references, and bounded diffs; canonical JSONL
    /// remains the only full-history source.
    ///
    /// # Errors
    ///
    /// Returns an error when the redb projection store cannot be opened.
    pub fn open(
        path: impl AsRef<Path>,
        catalog: Arc<SessionCatalog>,
        index: Arc<RolloutStore>,
        files: Arc<dyn PreviewFiles>,
    ) -> Result<Self, ResourceError> {
        let path = path.as_ref();
        let store = match ResourceStore::open(path) {
            Ok(store) => store,
            Err(error) if recoverable_resource_database_error(&error) => {
                let backup = corrupt_backup_path(path);
                std::fs::rename(path, &backup)?;
                tracing::warn!(
                    path = %path.display(),
                    backup = %backup.display(),
                    reason = %error,
                    "quarantined corrupt derived resource index"
                );
                ResourceStore::open(path)?
            }
            Err(error) => return Err(error.into()),
        };
        let source = RolloutProjections {
            catalog,
            index: index.clone(),
            store: Arc::new(store),
        };
        Ok(Self {
            resources: ThreadResources::new(Arc::new(source), files),
            index,
        })
    }

    #[must_use]
    pub fn with_vcs(mut self, vcs: Arc<dyn WorkspaceVcs>) -> Self {
        self.resources = self.resources.with_vcs(vcs);
        self
    }

    fn vcs(&self) -> Option<&dyn WorkspaceVcs> {
        self.resources.vcs()
    }

    #[must_use]
    pub fn handles(method: &str) -> bool {
        ThreadResources::<RolloutProjections>::handles(method)
    }

    /// Refreshes the immutable projection from the canonical rollout and then
    /// overlays only the currently mutable turn observed on the live stream.
    ///
    /// # Errors
    ///
    /// Returns an error when the thread is invalid, its rollout cannot be
    /// read, or the compact projection cannot be committed.
    pub async fn handle(&self, method: &str, params: &Value) -> Result<Value, ResourceError> {
        if method == "companion/threadChangeOutput/read" {
            let context = self.resources.context(params).await?;
            return self
                .handle_thread_change_output(params, &context)
                .await
                .map_err(ResourceError::from);
        }
        self.resources.handle(method, params).await
    }

    /// Starts an idempotent background refresh for a thread as soon as its
    /// history is opened.
    pub fn schedule_prewarm(&self, thread_id: &str) {
        self.resources.schedule_prewarm(thread_id);
    }

    /// Observes App Server notifications for the live overlay.
    pub async fn observe(&self, payload: &Value) {
        self.resources.observe(payload).await;
    }

    /// Authorizes previewable files returned by trusted App Server history
    /// RPCs before the response is forwarded to a client.
    pub async fn observe_rpc_result(&self, method: &str, result: &Value) {
        self.resources.observe_rpc_result(method, result).await;
    }
}

fn recoverable_resource_database_error(error: &RolloutResourceError) -> bool {
    match error {
        RolloutResourceError::DatabaseOpen(redb::DatabaseError::Storage(
            redb::StorageError::Corrupted(_),
        )) => true,
        RolloutResourceError::DatabaseOpen(redb::DatabaseError::Storage(
            redb::StorageError::Io(error),
        )) => matches!(
            error.kind(),
            std::io::ErrorKind::InvalidData | std::io::ErrorKind::UnexpectedEof
        ),
        _ => false,
    }
}

fn corrupt_backup_path(path: &Path) -> PathBuf {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |duration| duration.as_millis());
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("resources.redb");
    path.with_file_name(format!(
        "{file_name}.corrupt.{timestamp}.{}",
        std::process::id()
    ))
}

impl ResourceStore {
    fn open(path: impl AsRef<Path>) -> Result<Self, RolloutResourceError> {
        let database = companion_host::database::open(path, "resources")?;
        let write = database.begin_write()?;
        write.open_table(PROJECTIONS)?;
        write.commit()?;
        Ok(Self { database })
    }

    fn load(&self, thread_id: &str) -> Result<Option<PersistedProjection>, RolloutResourceError> {
        let read = self.database.begin_read()?;
        let table = read.open_table(PROJECTIONS)?;
        table
            .get(thread_id)?
            .map(|value| serde_json::from_slice(value.value()).map_err(RolloutResourceError::from))
            .transpose()
    }

    fn save(
        &self,
        thread_id: &str,
        projection: &PersistedProjection,
    ) -> Result<(), RolloutResourceError> {
        let encoded = serde_json::to_vec(projection)?;
        let write = self.database.begin_write()?;
        {
            let mut table = write.open_table(PROJECTIONS)?;
            table.insert(thread_id, encoded.as_slice())?;
        }
        write.commit()?;
        Ok(())
    }

    fn refresh(
        &self,
        thread_id: &str,
        path: &Path,
        index: &RolloutStore,
    ) -> Result<PersistedProjection, RolloutResourceError> {
        // Resource projection consumes every source record, unlike the chat
        // head which can be served from a tail-first index.
        index_rollout_fully(index, path)?;
        let file_id = rollout_file_id(path);
        let state = index.file_state(&file_id)?.ok_or_else(|| {
            StoreError::CorruptedIndex("rollout checkpoint is missing after indexing".into())
        })?;
        let file = File::open(path)?;
        let mut projection = self.load(thread_id)?.filter(|candidate| {
            candidate.version == PROJECTION_VERSION
                && candidate.source_path == path
                && candidate.device == state.device
                && candidate.inode == state.inode
                && candidate.indexed_bytes <= state.indexed_bytes
                && tail_hash(&file, candidate.indexed_bytes).ok() == Some(candidate.tail_hash)
        });
        let mut projection = projection.take().unwrap_or_else(|| {
            PersistedProjection::empty(path.to_path_buf(), state.device, state.inode)
        });
        let initial_offset = projection.indexed_bytes;
        for record in index.records_from(&file_id, initial_offset)? {
            // session_meta, event_msg and response_item are the only canonical
            // record families that can affect changes or attachments.
            if !matches!(record.record_type, 1 | 3 | 4) {
                continue;
            }
            let mut line =
                vec![0_u8; usize::try_from(record.length).map_err(std::io::Error::other)?];
            read_exact_at(&file, record.offset, &mut line)?;
            apply_rollout_record(&mut projection.projection, record.offset, &line);
        }
        if projection.indexed_bytes != state.indexed_bytes {
            projection.indexed_bytes = state.indexed_bytes;
            projection.tail_hash = state.tail_hash;
            self.save(thread_id, &projection)?;
        }
        Ok(projection)
    }
}

#[allow(clippy::too_many_lines)]
fn apply_rollout_record(projection: &mut ResourceProjection, offset: u64, line: &[u8]) {
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
            projection.cwd = payload
                .get("cwd")
                .and_then(Value::as_str)
                .filter(|value| Path::new(value).is_absolute())
                .map(PathBuf::from);
        }
        "task_started" => {
            if let Some(turn_id) = payload.get("turn_id").and_then(Value::as_str) {
                projection.started(turn_id);
            }
        }
        "task_complete" => {
            let turn_id = payload
                .get("turn_id")
                .and_then(Value::as_str)
                .or(projection.active_turn_id.as_deref())
                .unwrap_or("")
                .to_owned();
            projection.completed(&turn_id);
        }
        "turn_aborted" => {
            let turn_id = payload
                .get("turn_id")
                .and_then(Value::as_str)
                .or(projection.active_turn_id.as_deref())
                .unwrap_or("")
                .to_owned();
            projection.aborted(&turn_id);
        }
        "thread_rolled_back" => {
            let turns = payload
                .get("num_turns")
                .and_then(Value::as_u64)
                .and_then(|value| usize::try_from(value).ok())
                .unwrap_or(1);
            projection.rollback(turns);
        }
        "user_message" => {
            let turn_id = projection
                .active_turn_id
                .as_deref()
                .unwrap_or("")
                .to_owned();
            let item_id = format!("rollout-{offset}");
            let cwd = projection.cwd.clone();
            let Some(data) = projection.pending_for(&turn_id) else {
                return;
            };
            if let Some(message) = payload.get("message").and_then(Value::as_str) {
                data.mentioned_files(message, &turn_id, &item_id, cwd.as_deref());
            }
            for (field, attachment_kind, local) in [
                ("local_images", AttachmentKind::Image, true),
                ("images", AttachmentKind::Image, false),
                ("local_audio", AttachmentKind::Audio, true),
                ("audio", AttachmentKind::Audio, false),
            ] {
                let Some(values) = payload.get(field).and_then(Value::as_array) else {
                    continue;
                };
                for value in values.iter().filter_map(Value::as_str) {
                    if local {
                        data.local_attachment(
                            value,
                            attachment_kind,
                            AttachmentOrigin::User,
                            &turn_id,
                            &item_id,
                            None,
                            cwd.as_deref(),
                        );
                    } else if remote_url(value) {
                        data.remote_attachment(
                            value,
                            match attachment_kind {
                                AttachmentKind::Image => "Image",
                                AttachmentKind::Audio => "Audio",
                                AttachmentKind::File => "Attachment",
                            },
                            attachment_kind,
                            AttachmentOrigin::User,
                            &turn_id,
                            &item_id,
                        );
                    }
                }
            }
        }
        "patch_apply_end" => {
            let turn_id = payload
                .get("turn_id")
                .and_then(Value::as_str)
                .or(projection.active_turn_id.as_deref())
                .unwrap_or("")
                .to_owned();
            let item_id = payload.get("call_id").and_then(Value::as_str).unwrap_or("");
            let cwd = projection.cwd.clone();
            let Some(data) = projection.pending_for(&turn_id) else {
                return;
            };
            if let Some(changes) = payload.get("changes").and_then(Value::as_object) {
                for (path, change) in changes {
                    data.apply_change(&turn_id, item_id, path, change, cwd.as_deref());
                }
            }
        }
        "item_completed" => {
            let turn_id = payload
                .get("turn_id")
                .and_then(Value::as_str)
                .or(projection.active_turn_id.as_deref())
                .unwrap_or("")
                .to_owned();
            let cwd = projection.cwd.clone();
            let Some(data) = projection.pending_for(&turn_id) else {
                return;
            };
            if let Some(item) = payload.get("item") {
                data.apply_materialized_item(&turn_id, item, cwd.as_deref());
            }
        }
        "view_image_tool_call" => {
            if let Some(path) = payload.get("path").and_then(Value::as_str) {
                let turn_id = projection.active_turn_id.clone().unwrap_or_default();
                let cwd = projection.cwd.clone();
                let Some(data) = projection.pending_for(&turn_id) else {
                    return;
                };
                data.local_attachment(
                    path,
                    AttachmentKind::Image,
                    AttachmentOrigin::Agent,
                    &turn_id,
                    payload.get("call_id").and_then(Value::as_str).unwrap_or(""),
                    None,
                    cwd.as_deref(),
                );
            }
        }
        "image_generation_end" => {
            let turn_id = projection.active_turn_id.clone().unwrap_or_default();
            let item_id = payload.get("call_id").and_then(Value::as_str).unwrap_or("");
            let cwd = projection.cwd.clone();
            let Some(data) = projection.pending_for(&turn_id) else {
                return;
            };
            if let Some(path) = payload.get("saved_path").and_then(Value::as_str) {
                data.local_attachment(
                    path,
                    AttachmentKind::Image,
                    AttachmentOrigin::Agent,
                    &turn_id,
                    item_id,
                    None,
                    cwd.as_deref(),
                );
            } else if let Some(url) = payload
                .get("result")
                .and_then(Value::as_str)
                .filter(|url| remote_url(url))
            {
                data.remote_attachment(
                    url,
                    "Generated image",
                    AttachmentKind::Image,
                    AttachmentOrigin::Agent,
                    &turn_id,
                    item_id,
                );
            }
        }
        "message" if payload.get("role").and_then(Value::as_str) == Some("assistant") => {
            let turn_id = projection.active_turn_id.clone().unwrap_or_default();
            let item_id = payload.get("id").and_then(Value::as_str).unwrap_or("");
            let cwd = projection.cwd.clone();
            let Some(data) = projection.pending_for(&turn_id) else {
                return;
            };
            if let Some(content) = payload.get("content").and_then(Value::as_array) {
                for text in content.iter().filter_map(|part| {
                    part.get("text").and_then(Value::as_str).filter(|_| {
                        matches!(
                            part.get("type").and_then(Value::as_str),
                            Some("output_text" | "text")
                        )
                    })
                }) {
                    data.agent_markdown_links(text, &turn_id, item_id, cwd.as_deref());
                }
            }
        }
        _ => {}
    }
}

#[cfg(unix)]
fn read_exact_at(file: &File, offset: u64, buffer: &mut [u8]) -> Result<(), std::io::Error> {
    let mut read = 0;
    while read < buffer.len() {
        let count = file.read_at(&mut buffer[read..], offset + read as u64)?;
        if count == 0 {
            return Err(std::io::Error::from(std::io::ErrorKind::UnexpectedEof));
        }
        read += count;
    }
    Ok(())
}

#[cfg(not(unix))]
fn read_exact_at(file: &File, offset: u64, buffer: &mut [u8]) -> Result<(), std::io::Error> {
    let mut snapshot = file.try_clone()?;
    snapshot.seek(SeekFrom::Start(offset))?;
    snapshot.read_exact(&mut buffer)?;
    Ok(())
}

#[cfg(unix)]
fn tail_hash(file: &File, indexed_bytes: u64) -> Result<[u8; 32], std::io::Error> {
    if indexed_bytes == 0 {
        return Ok([0; 32]);
    }
    let bytes = TAIL_CHECK_BYTES.min(indexed_bytes);
    let start = indexed_bytes - bytes;
    let mut buffer = vec![0_u8; usize::try_from(bytes).map_err(std::io::Error::other)?];
    read_exact_at(file, start, &mut buffer)?;
    Ok(*blake3::hash(&buffer).as_bytes())
}

#[cfg(not(unix))]
fn tail_hash(file: &File, indexed_bytes: u64) -> Result<[u8; 32], std::io::Error> {
    if indexed_bytes == 0 {
        return Ok([0; 32]);
    }
    let bytes = TAIL_CHECK_BYTES.min(indexed_bytes);
    let mut snapshot = file.try_clone()?;
    snapshot.seek(SeekFrom::Start(indexed_bytes - bytes))?;
    let mut buffer = vec![0_u8; usize::try_from(bytes).map_err(std::io::Error::other)?];
    snapshot.read_exact(&mut buffer)?;
    Ok(*blake3::hash(&buffer).as_bytes())
}
#[cfg(test)]
#[allow(clippy::expect_used)]
mod tests {
    use std::collections::BTreeMap;

    use agent_resources::projection::last_turn_summary;

    use super::*;

    #[test]
    fn resource_projection_consumes_the_shared_rollout_index()
    -> Result<(), Box<dyn std::error::Error>> {
        let directory = tempfile::tempdir()?;
        let rollout = directory.path().join("rollout.jsonl");
        std::fs::write(
            &rollout,
            concat!(
                "{\"type\":\"session_meta\",\"payload\":{\"type\":\"session_meta\",\"id\":\"thread\",\"cwd\":\"/repo\",\"source\":\"cli\"}}\n",
                "{\"type\":\"event_msg\",\"payload\":{\"type\":\"task_started\",\"turn_id\":\"turn\"}}\n",
                "{\"type\":\"event_msg\",\"payload\":{\"type\":\"patch_apply_end\",\"call_id\":\"patch\",\"changes\":{\"src/a.rs\":{\"type\":\"update\",\"diff\":\"-old\\n+new\\n\"}}}}\n",
                "{\"type\":\"event_msg\",\"payload\":{\"type\":\"item_completed\",\"turn_id\":\"turn\",\"item\":{\"type\":\"FileChange\",\"id\":\"modern-patch\",\"changes\":{\"src/modern.rs\":{\"type\":\"add\",\"unified_diff\":\"+modern\\n\",\"move_path\":null}}}}}\n",
                "{\"type\":\"response_item\",\"payload\":{\"type\":\"message\",\"id\":\"answer\",\"role\":\"assistant\",\"content\":[{\"type\":\"output_text\",\"text\":\"[report](/tmp/report.md)\"}]}}\n",
                "{\"type\":\"event_msg\",\"payload\":{\"type\":\"task_complete\",\"turn_id\":\"turn\"}}\n",
            ),
        )?;
        let index = crate::test_support::open_rollout_store(directory.path().join("index.redb"))?;
        let resources = ResourceStore::open(directory.path().join("resources.redb"))?;

        let projection = resources.refresh("thread", &rollout, &index)?;
        let data = projection.projection.materialized_data();
        let last_turn = last_turn_summary(&projection.projection, &BTreeMap::new(), None);

        assert!(data.changes.contains_key("/repo/src/a.rs"));
        assert!(data.changes.contains_key("/repo/src/modern.rs"));
        assert!(last_turn.changes.contains_key("/repo/src/modern.rs"));
        assert!(
            data.attachments
                .iter()
                .any(|attachment| attachment.path.as_deref() == Some("/tmp/report.md"))
        );
        assert_eq!(projection.indexed_bytes, std::fs::metadata(&rollout)?.len());

        std::fs::write(
            &rollout,
            concat!(
                "{\"type\":\"session_meta\",\"payload\":{\"type\":\"session_meta\",\"id\":\"thread\",\"cwd\":\"/repo\",\"source\":\"cli\"}}\n",
                "{\"type\":\"event_msg\",\"payload\":{\"type\":\"task_started\",\"turn_id\":\"turn\"}}\n",
                "{\"type\":\"event_msg\",\"payload\":{\"type\":\"patch_apply_end\",\"call_id\":\"patch\",\"changes\":{\"src/b.rs\":{\"type\":\"update\",\"diff\":\"-old\\n+new\\n\"}}}}\n",
                "{\"type\":\"event_msg\",\"payload\":{\"type\":\"task_complete\",\"turn_id\":\"turn\"}}\n",
            ),
        )?;
        let replaced = resources
            .refresh("thread", &rollout, &index)?
            .projection
            .materialized_data();
        assert!(!replaced.changes.contains_key("/repo/src/a.rs"));
        assert!(replaced.changes.contains_key("/repo/src/b.rs"));
        assert!(replaced.attachments.is_empty());
        Ok(())
    }
}
