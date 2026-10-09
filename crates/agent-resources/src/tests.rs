//! Behavior of the shared resource model, projection and reads.

#![allow(clippy::expect_used)]

use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
    sync::{Mutex, PoisonError},
};

use async_trait::async_trait;
use companion_host::{
    files::PreviewFiles,
    vcs::{VcsDiff, VcsFileStatus, VcsScope, VcsSnapshot},
};
use serde_json::json;

use crate::{
    data::{
        AttachmentKind, AttachmentOrigin, AttachmentResource, ChangeKind, ChangeScope,
        ResourceData, TurnResourceData, diff_stats, markdown_local_paths, resolve_path,
    },
    projection::{ResourceProjection, last_turn_patch, last_turn_summary},
    service::{
        available_change_scopes, changes_menu_scopes, project_vcs_diff, thread_resources_from_vcs,
    },
};

/// Records preview observations instead of authorizing host files.
#[derive(Default)]
struct RecordingPreviewFiles {
    within: Mutex<Vec<(PathBuf, Vec<PathBuf>)>>,
}

impl RecordingPreviewFiles {
    fn observed_within(&self) -> Vec<(PathBuf, Vec<PathBuf>)> {
        self.within
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .clone()
    }
}

#[async_trait]
impl PreviewFiles for RecordingPreviewFiles {
    async fn observe_preview_paths(&self, _paths: Vec<PathBuf>) {}

    async fn observe_preview_paths_within(&self, root: PathBuf, paths: Vec<PathBuf>) {
        self.within
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .push((root, paths));
    }

    async fn mark_thread_attachments_deleted(
        &self,
        _thread_id: &str,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        Ok(())
    }
}

#[test]
fn next_turn_commits_resources_from_an_interrupted_turn() {
    let mut projection = ResourceProjection::default();
    projection.started("interrupted");
    let pending = projection.pending_for("interrupted");
    assert!(pending.is_some());
    if let Some(pending) = pending {
        pending.local_attachment(
            "/tmp/photo.png",
            AttachmentKind::Image,
            AttachmentOrigin::User,
            "interrupted",
            "message",
            None,
            None,
        );
    }
    assert_eq!(projection.materialized_data().attachments.len(), 1);

    projection.started("next");

    assert_eq!(projection.turns.len(), 1);
    assert_eq!(projection.turns[0].turn_id, "interrupted");
    assert_eq!(projection.materialized_data().attachments.len(), 1);
    assert_eq!(projection.active_turn_id.as_deref(), Some("next"));
}

#[test]
fn normalizes_paths_diffs_and_metadata_attachments() {
    assert_eq!(
        resolve_path("src/../src/a.ts", Some(Path::new("/workspace/project"))),
        "/workspace/project/src/a.ts"
    );
    assert_eq!(diff_stats("--- a\n+++ b\n-old\n+new\n"), (1, 1));
    let mut data = ResourceData::default();
    data.mentioned_files(
        "# Files mentioned by the user:\n\n## Photo 1.jpg: `/tmp/photo.jpg`\n\n## My request for Codex:\nHi",
        "turn",
        "item",
        None,
    );
    assert_eq!(data.attachments.len(), 1);
    assert_eq!(data.attachments[0].kind, AttachmentKind::Image);
}

#[test]
fn extracts_only_local_markdown_links_from_agent_text() {
    assert_eq!(
        markdown_local_paths(
            "[relative](<../reports/final report.md>) [absolute](/tmp/result.png) \
             [web](https://example.com/a.md) [anchor](#details)"
        ),
        vec!["../reports/final report.md", "/tmp/result.png"]
    );
}

#[test]
fn streaming_patch_updates_replace_the_same_item() {
    let mut data = ResourceData::default();
    data.apply_change(
        "turn",
        "item",
        "/tmp/file.rs",
        &json!({"type":"update","diff":"+first\n"}),
        None,
    );
    data.apply_change(
        "turn",
        "item",
        "/tmp/file.rs",
        &json!({"type":"update","diff":"+second\n"}),
        None,
    );

    let bucket = data.patches.get("/tmp/file.rs").expect("patch bucket");
    assert_eq!(bucket.patches.len(), 1);
    assert_eq!(bucket.patches[0].diff, "+second\n");
    assert_eq!(bucket.chars, "+second\n".len());
}

#[test]
fn session_summary_retains_the_first_change_kind_across_turns() {
    let mut projection = ResourceProjection::default();
    for (turn_id, item_id, kind) in [
        ("turn-1", "item-1", "add"),
        ("turn-2", "item-2", "update"),
        ("turn-3", "item-3", "delete"),
    ] {
        let mut data = ResourceData::default();
        data.apply_change(
            turn_id,
            item_id,
            "/workspace/created.rs",
            &json!({ "type": kind, "diff": "content\n" }),
            None,
        );
        projection.turns.push(TurnResourceData {
            turn_id: turn_id.into(),
            data,
        });
    }
    let summary = projection.materialized_summary();
    let change = summary
        .changes
        .get("/workspace/created.rs")
        .expect("session change");
    assert!(change.created_in_scope);
    assert_eq!(change.kind, ChangeKind::Delete);

    let mut existing = ResourceData::default();
    existing.apply_change(
        "turn-1",
        "item-1",
        "/workspace/existing.rs",
        &json!({ "type": "update", "diff": "-old\n+new\n" }),
        None,
    );
    existing.apply_change(
        "turn-2",
        "item-2",
        "/workspace/existing.rs",
        &json!({ "type": "delete", "diff": "new\n" }),
        None,
    );
    assert!(!existing.changes["/workspace/existing.rs"].created_in_scope);
}

#[test]
fn last_turn_scope_excludes_changes_from_earlier_turns() {
    let mut projection = ResourceProjection {
        cwd: Some(PathBuf::from("/workspace")),
        ..ResourceProjection::default()
    };
    let mut first = ResourceData::default();
    first.apply_change(
        "turn-1",
        "item-1",
        "first.rs",
        &json!({ "type": "update", "diff": "-old\n+first\n" }),
        projection.cwd.as_deref(),
    );
    let mut second = ResourceData::default();
    second.apply_change(
        "turn-2",
        "item-2",
        "second.rs",
        &json!({ "type": "update", "diff": "-old\n+second\n" }),
        projection.cwd.as_deref(),
    );
    projection.turns = vec![
        TurnResourceData {
            turn_id: "turn-1".into(),
            data: first,
        },
        TurnResourceData {
            turn_id: "turn-2".into(),
            data: second,
        },
    ];

    let session = projection.materialized_summary();
    assert_eq!(session.changes.len(), 2);
    assert!(session.changes.contains_key("/workspace/first.rs"));
    assert!(session.changes.contains_key("/workspace/second.rs"));

    let selected = last_turn_summary(&projection, &BTreeMap::new(), None);
    assert_eq!(selected.changes.len(), 1);
    assert!(selected.changes.contains_key("/workspace/second.rs"));
    assert!(
        last_turn_patch(&projection, &BTreeMap::new(), None, "/workspace/first.rs")
            .patches
            .is_empty()
    );
    assert_eq!(
        last_turn_patch(&projection, &BTreeMap::new(), None, "/workspace/second.rs").patches[0]
            .item_id,
        "item-2"
    );

    let mut live = ResourceData::default();
    live.apply_change(
        "turn-live",
        "item-live",
        "live.rs",
        &json!({ "type": "update", "diff": "+live\n" }),
        projection.cwd.as_deref(),
    );
    let overlays = BTreeMap::from([("turn-live".into(), live)]);
    let selected_live = last_turn_summary(&projection, &overlays, Some("turn-live"));
    assert_eq!(selected_live.changes.len(), 1);
    assert!(selected_live.changes.contains_key("/workspace/live.rs"));
}

#[tokio::test]
async fn only_session_scope_is_selectable_without_vcs() {
    assert_eq!(
        available_change_scopes(None, None)
            .await
            .expect("change scopes"),
        vec![ChangeScope::Session]
    );
}

#[test]
fn changes_menu_keeps_only_supported_user_scopes() {
    assert_eq!(
        changes_menu_scopes(&[
            VcsScope::Staged,
            VcsScope::Unstaged,
            VcsScope::Uncommitted,
            VcsScope::Branch,
        ]),
        vec![
            ChangeScope::Session,
            ChangeScope::Uncommitted,
            ChangeScope::Branch,
        ]
    );
    assert_eq!(
        changes_menu_scopes(&[VcsScope::Staged, VcsScope::Unstaged, VcsScope::Branch]),
        vec![ChangeScope::Session, ChangeScope::Branch]
    );
}

#[test]
fn vcs_diff_projects_into_the_existing_android_patch_contract() {
    let value = project_vcs_diff(
        "thread",
        &VcsDiff {
            capability: companion_host::vcs::DIFF_CAPABILITY.into(),
            repository: companion_host::vcs::VcsRepository {
                provider: "arc".into(),
                root: PathBuf::from("/arcadia"),
                branch: Some("feature".into()),
                head: Some("abc".into()),
                base: Some("base".into()),
            },
            scope: VcsScope::Branch,
            snapshot_id: "snapshot".into(),
            file_id: "file".into(),
            path: PathBuf::from("/arcadia/file.rs"),
            old_path: None,
            status: VcsFileStatus::Modified,
            diff: "@@ -1 +1 @@\n-old\n+new\n".into(),
            source: Some("new\n".into()),
            truncated: false,
            binary: false,
            additions: 1,
            deletions: 1,
        },
    );
    assert_eq!(value["threadId"], "thread");
    assert_eq!(value["patches"][0]["kind"], "update");
    assert_eq!(value["patches"][0]["itemId"], "vcs:snapshot:file");
    assert_eq!(value["patches"][0]["diff"], "@@ -1 +1 @@\n-old\n+new\n");
    assert_eq!(value["source"], "new\n");
    assert_eq!(value["snapshotId"], "snapshot");
}

#[tokio::test]
#[cfg(unix)]
#[allow(clippy::too_many_lines)]
async fn vcs_snapshot_replaces_rollout_changes_without_dropping_attachments() {
    let directory = tempfile::tempdir().expect("temp directory");
    let repository = directory.path().join("repository");
    std::fs::create_dir(&repository).expect("repository directory");
    let changed = repository.join("changed.rs");
    std::fs::write(&changed, "changed").expect("changed file");
    let outside = directory.path().join("outside.rs");
    std::fs::write(&outside, "private").expect("outside file");
    let escaped = repository.join("escaped.rs");
    std::os::unix::fs::symlink(&outside, &escaped).expect("escaped symlink");
    let repository_root = repository.clone();
    let files = RecordingPreviewFiles::default();
    let mut rollout = ResourceData::default();
    rollout.attachments.push(AttachmentResource {
        key: "attachment".into(),
        name: "notes.md".into(),
        kind: AttachmentKind::File,
        path: Some("/tmp/notes.md".into()),
        url: None,
        origin: AttachmentOrigin::User,
        turn_id: "turn".into(),
        item_id: "message".into(),
    });
    let snapshot = VcsSnapshot {
        capability: companion_host::vcs::CHANGES_CAPABILITY.into(),
        repository: companion_host::vcs::VcsRepository {
            provider: "arc".into(),
            root: repository_root.clone(),
            branch: Some("feature".into()),
            head: Some("abc".into()),
            base: Some("base".into()),
        },
        scope: VcsScope::Branch,
        available_scopes: vec![VcsScope::Staged, VcsScope::Unstaged, VcsScope::Branch],
        snapshot_id: "snapshot".into(),
        state: companion_host::vcs::VcsState::Dirty,
        summary: companion_host::vcs::VcsSummary {
            total: 2,
            modified: 2,
            ..companion_host::vcs::VcsSummary::default()
        },
        files: vec![
            companion_host::vcs::VcsFile {
                id: "file".into(),
                path: changed.clone(),
                old_path: None,
                status: VcsFileStatus::Modified,
                staged: false,
                additions: Some(1),
                deletions: Some(1),
                binary: false,
                conflict: None,
            },
            companion_host::vcs::VcsFile {
                id: "escaped".into(),
                path: escaped.clone(),
                old_path: None,
                status: VcsFileStatus::Modified,
                staged: false,
                additions: Some(1),
                deletions: Some(1),
                binary: false,
                conflict: None,
            },
        ],
    };

    let value = thread_resources_from_vcs("thread".into(), snapshot, &rollout, &files)
        .await
        .expect("resources project");

    // Every changed path of the snapshot, including one that escapes the
    // repository through a symlink, is observed for preview within the root.
    assert_eq!(
        files.observed_within(),
        vec![(
            repository_root.clone(),
            vec![changed.clone(), escaped.clone()]
        )]
    );
    assert_eq!(
        value["changes"][0]["path"].as_str(),
        Some(changed.to_string_lossy().as_ref())
    );
    assert_eq!(value["changes"][0]["availability"], "available");
    assert_eq!(value["changes"][0]["additions"], 1);
    assert_eq!(value["changes"][0]["deletions"], 1);
    assert_eq!(value["changes"][0]["binary"], false);
    assert_eq!(value["changes"][0]["itemId"], "vcs:snapshot:file");
    assert_eq!(value["attachments"][0]["key"], "attachment");
    assert_eq!(value["changeScopes"], json!(["session", "branch"]));
    assert!(
        value["revision"]
            .as_str()
            .is_some_and(|revision| revision.starts_with("vcs.snapshot."))
    );
}

#[test]
fn neutral_turns_project_like_their_client_wire_items() {
    use agent_core::model::{
        AgentItem, AgentTurn, ExecutionStatus, FileChange, FileChangeKind, ItemId, MessagePhase,
        TurnId, TurnOrigin, TurnStatus, UserContent,
    };
    let item_id = |id: &'static str| ItemId::from_static(id);
    let turn = |id: &'static str, status: TurnStatus, items: Vec<AgentItem>| AgentTurn {
        turn_id: TurnId::from_static(id),
        status,
        origin: TurnOrigin::User,
        started_at: 0,
        completed_at: None,
        error: None,
        items,
        provenance: None,
    };
    let finished = turn(
        "turn-1",
        TurnStatus::Completed,
        vec![
            AgentItem::UserMessage {
                item_id: item_id("prompt"),
                provenance: None,
                client_message_id: None,
                content: vec![
                    UserContent::Text {
                        text: "look".into(),
                    },
                    UserContent::LocalImage {
                        path: "shot.png".into(),
                    },
                ],
            },
            AgentItem::FileChange {
                item_id: item_id("edit"),
                provenance: None,
                changes: vec![FileChange {
                    path: "src/a.rs".into(),
                    kind: FileChangeKind::Update,
                    move_path: None,
                    diff: "-old\n+new\n".into(),
                }],
                status: ExecutionStatus::Completed,
            },
            AgentItem::AgentMessage {
                item_id: item_id("answer"),
                provenance: None,
                text: "See [report](/tmp/report.md)".into(),
                phase: MessagePhase::Final,
            },
        ],
    );
    let running = turn(
        "turn-2",
        TurnStatus::InProgress,
        vec![AgentItem::ImageView {
            item_id: item_id("view"),
            provenance: None,
            path: "/tmp/view.png".into(),
        }],
    );

    let projection =
        ResourceProjection::from_turns(Some(PathBuf::from("/repo")), &[finished.clone(), running]);
    assert_eq!(projection.turns.len(), 1);
    assert_eq!(projection.active_turn_id.as_deref(), Some("turn-2"));
    let data = projection.materialized_summary();
    let change = &data.changes["/repo/src/a.rs"];
    assert_eq!((change.additions, change.deletions), (1, 1));
    let attachments = data
        .attachments
        .iter()
        .map(|attachment| attachment.path.as_deref().unwrap_or_default())
        .collect::<Vec<_>>();
    assert_eq!(
        attachments,
        ["/repo/shot.png", "/tmp/report.md", "/tmp/view.png"]
    );

    // The same items in their client-wire shape project identically.
    let mut wire = ResourceData::default();
    for item in [
        json!({"type": "userMessage", "id": "prompt", "content": [
            {"type": "text", "text": "look"}, {"type": "localImage", "path": "shot.png"}]}),
        json!({"type": "fileChange", "id": "edit", "changes": [
            {"path": "src/a.rs", "kind": {"type": "update", "move_path": null}, "diff": "-old\n+new\n"}]}),
        json!({"type": "agentMessage", "id": "answer", "text": "See [report](/tmp/report.md)"}),
    ] {
        wire.apply_materialized_item("turn-1", &item, Some(Path::new("/repo")));
    }
    let neutral = ResourceProjection::from_turns(Some(PathBuf::from("/repo")), &[finished])
        .materialized_summary();
    assert_eq!(
        serde_json::to_value(&neutral.changes).ok(),
        serde_json::to_value(&wire.changes).ok()
    );
    assert_eq!(
        serde_json::to_value(&neutral.attachments).ok(),
        serde_json::to_value(&wire.attachments).ok()
    );
}
