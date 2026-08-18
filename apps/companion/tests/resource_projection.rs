#![cfg(unix)]

use std::{collections::HashMap, path::Path, sync::Arc};

use axum::{
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
};
use codewide_companion::{
    catalog::SessionCatalog,
    files::{FileQuery, FileService},
    resources::ResourceService,
};
use serde_json::{Value, json};
use tokio::io::AsyncWriteExt;

const THREAD_ID: &str = "019fe7af-e2fa-70f3-88e8-99d59e10bd63";

#[tokio::test]
#[allow(clippy::too_many_lines)]
async fn canonical_resources_are_incremental_crash_safe_and_live()
-> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let directory = tempfile::tempdir()?;
    let sessions = directory.path().join("sessions/2026/08/16");
    let workspace = directory.path().join("workspace");
    tokio::fs::create_dir_all(&sessions).await?;
    tokio::fs::create_dir_all(workspace.join("src")).await?;
    tokio::fs::write(workspace.join("src/a.ts"), "export const current = 2;\n").await?;
    let photo = workspace.join("photo.png");
    tokio::fs::write(&photo, b"png").await?;
    let rollout = sessions.join(format!("rollout-2026-08-16T12-00-00-{THREAD_ID}.jsonl"));
    let first = [
        json!({"type":"session_meta","payload":{"cwd":workspace}}),
        json!({"type":"event_msg","payload":{"type":"task_started","turn_id":"turn-1"}}),
        json!({"type":"event_msg","payload":{
            "type":"user_message",
            "message":format!("# Files mentioned by the user:\n\n## Photo.png: `{}`\n\n## My request for Codex:\nReview", photo.display()),
            "images":[], "local_images":[photo], "audio":[], "local_audio":[]
        }}),
        json!({"type":"event_msg","payload":{
            "type":"patch_apply_end", "turn_id":"turn-1", "call_id":"edit-1", "changes":{
                "src/a.ts":{"type":"update","move_path":null,"unified_diff":"--- a\n+++ b\n-old\n+new\n"},
                "src/new.ts":{"type":"add","content":"one\ntwo\n"}
            }
        }}),
        json!({"type":"event_msg","payload":{"type":"task_complete","turn_id":"turn-1"}}),
    ];
    write_lines(&rollout, &first).await?;

    let files = Arc::new(
        FileService::open(
            HashMap::new(),
            Vec::new(),
            Some(directory.path().join("preview-files.json")),
            None,
        )
        .await?,
    );
    let catalog = Arc::new(SessionCatalog::scan(directory.path()));
    let service = ResourceService::open(
        directory.path().join("resources.redb"),
        catalog.clone(),
        files.clone(),
    )?;
    assert_eq!(preview_status(&files, &photo).await, StatusCode::FORBIDDEN);
    service.schedule_prewarm(THREAD_ID);
    wait_for_preview(&files, &photo).await?;

    let first_snapshot = service
        .handle(
            "companion/threadResources/read",
            &json!({"threadId":THREAD_ID}),
        )
        .await?;
    assert_eq!(first_snapshot["changes"].as_array().map(Vec::len), Some(2));
    assert_eq!(
        first_snapshot["attachments"].as_array().map(Vec::len),
        Some(1)
    );
    assert_eq!(
        first_snapshot["changes"][0]["path"],
        workspace.join("src/a.ts").to_string_lossy().as_ref()
    );
    assert_eq!(first_snapshot["changes"][0]["additions"], 1);
    assert_eq!(first_snapshot["changes"][0]["deletions"], 1);
    assert_eq!(first_snapshot["changes"][1]["additions"], 0);
    assert_eq!(first_snapshot["changes"][1]["deletions"], 0);
    assert_eq!(first_snapshot["changes"][0]["availability"], "available");
    let diff = service
        .handle(
            "companion/threadChange/read",
            &json!({"threadId":THREAD_ID,"path":"src/a.ts"}),
        )
        .await?;
    assert_eq!(diff["patches"][0]["itemId"], "edit-1");
    assert_eq!(diff["patches"][0]["diff"], "--- a\n+++ b\n-old\n+new\n");

    // An unterminated writer-owned record is never indexed.
    let mut append = tokio::fs::OpenOptions::new()
        .append(true)
        .open(&rollout)
        .await?;
    append
        .write_all(b"{\"type\":\"event_msg\",\"payload\":")
        .await?;
    append.flush().await?;
    let unchanged = service
        .handle(
            "companion/threadResources/read",
            &json!({"threadId":THREAD_ID}),
        )
        .await?;
    assert_eq!(unchanged["changes"], first_snapshot["changes"]);

    // Live, uncommitted changes appear from the in-memory overlay.
    service
        .observe(&json!({"method":"turn/started","params":{
            "threadId":THREAD_ID,
            "turn":{"id":"turn-live","status":"inProgress","items":[]}
        }}))
        .await;
    service
        .observe(&json!({"method":"item/fileChange/patchUpdated","params":{
            "threadId":THREAD_ID,"turnId":"turn-live","itemId":"edit-live",
            "changes":[{"path":"src/live.ts","kind":{"type":"update","move_path":null},"diff":"+live\n"}]
        }}))
        .await;
    let live_photo = workspace.join("live-photo.png");
    tokio::fs::write(&live_photo, b"live-png").await?;
    service
        .observe(&json!({"method":"item/completed","params":{
            "threadId":THREAD_ID,"turnId":"turn-live",
            "item":{"id":"message-live","type":"userMessage","content":[
                {"type":"localImage","path":live_photo}
            ]}
        }}))
        .await;
    assert_eq!(preview_status(&files, &live_photo).await, StatusCode::OK);
    let agent_file = workspace.join("agent-result.png");
    tokio::fs::write(&agent_file, b"agent-png").await?;
    service
        .observe(&json!({"method":"item/completed","params":{
            "threadId":THREAD_ID,"turnId":"turn-live",
            "item":{"id":"agent-image","type":"imageView","path":agent_file}
        }}))
        .await;
    assert_eq!(preview_status(&files, &agent_file).await, StatusCode::OK);
    let attached_document = workspace.join("attached-report.csv");
    tokio::fs::write(&attached_document, b"name,value\nanswer,42\n").await?;
    service
        .observe(&json!({"method":"item/completed","params":{
            "threadId":THREAD_ID,"turnId":"turn-live",
            "item":{"id":"attached-file","type":"userMessage","content":[
                {"type":"mention","name":"attached-report.csv","path":attached_document}
            ]}
        }}))
        .await;
    assert_eq!(
        preview_status(&files, &attached_document).await,
        StatusCode::OK
    );
    let unrelated_file = workspace.join("not-attached.txt");
    tokio::fs::write(&unrelated_file, b"private").await?;
    assert_eq!(
        preview_status(&files, &unrelated_file).await,
        StatusCode::FORBIDDEN
    );
    let live = service
        .handle(
            "companion/threadResources/read",
            &json!({"threadId":THREAD_ID}),
        )
        .await?;
    assert!(
        change_paths(&live).contains(&workspace.join("src/live.ts").to_string_lossy().as_ref())
    );

    // Reopening the projection store restores the immutable snapshot without
    // copying any message body or replaying it through React.
    drop(service);
    drop(catalog);
    let restored = ResourceService::open(
        directory.path().join("resources.redb"),
        Arc::new(SessionCatalog::scan(directory.path())),
        files,
    )?;
    let restored_snapshot = restored
        .handle(
            "companion/threadResources/read",
            &json!({"threadId":THREAD_ID}),
        )
        .await?;
    assert_eq!(change_paths(&restored_snapshot).len(), 2);

    // Atomic replacement/truncation invalidates the compact projection and
    // rebuilds solely from the new canonical rollout.
    let replacement = [
        json!({"type":"session_meta","payload":{"cwd":workspace}}),
        json!({"type":"event_msg","payload":{"type":"task_started","turn_id":"turn-aborted"}}),
        json!({"type":"event_msg","payload":{
            "type":"patch_apply_end", "turn_id":"turn-aborted", "call_id":"edit-aborted", "changes":{
                "src/must-not-leak.ts":{"type":"add","content":"+discarded\n"}
            }
        }}),
        json!({"type":"event_msg","payload":{"type":"turn_aborted","turn_id":"turn-aborted"}}),
        json!({"type":"event_msg","payload":{"type":"thread_rolled_back","num_turns":1}}),
        json!({"type":"event_msg","payload":{"type":"task_started","turn_id":"turn-2"}}),
        json!({"type":"event_msg","payload":{
            "type":"patch_apply_end", "turn_id":"turn-2", "call_id":"edit-2", "changes":{
                "src/replaced.ts":{"type":"update","move_path":null,"unified_diff":"-old\n+replacement\n"}
            }
        }}),
        json!({"type":"event_msg","payload":{"type":"task_complete","turn_id":"turn-2"}}),
    ];
    write_lines(&rollout, &replacement).await?;
    let rebuilt = restored
        .handle(
            "companion/threadResources/read",
            &json!({"threadId":THREAD_ID}),
        )
        .await?;
    let replaced_path = workspace
        .join("src/replaced.ts")
        .to_string_lossy()
        .into_owned();
    assert_eq!(change_paths(&rebuilt), [replaced_path.as_str()]);
    Ok(())
}

#[tokio::test]
async fn agent_linked_files_outside_the_workspace_are_authorized()
-> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let directory = tempfile::tempdir()?;
    let sessions = directory.path().join("sessions/2026/08/17");
    let workspace = directory.path().join("workspace");
    tokio::fs::create_dir_all(&sessions).await?;
    tokio::fs::create_dir_all(&workspace).await?;
    let attachment = directory.path().join("agent report.md");
    tokio::fs::write(&attachment, "# Agent report\n").await?;
    let name = format!("rollout-2026-08-17T12-00-00-{THREAD_ID}.jsonl");
    let live_rollout = sessions.join(&name);
    write_lines(
        &live_rollout,
        &[
            json!({"type":"session_meta","payload":{"cwd":workspace}}),
            json!({"type":"event_msg","payload":{"type":"task_started","turn_id":"turn-1"}}),
            json!({"type":"response_item","payload":{
                "type":"message","id":"agent-message","role":"assistant","phase":"final_answer",
                "content":[{"type":"output_text","text":format!("Open [report](<{}:7:3>)", attachment.display())}]
            }}),
            json!({"type":"event_msg","payload":{"type":"task_complete","turn_id":"turn-1"}}),
        ],
    )
    .await?;

    let files = Arc::new(
        FileService::open(
            HashMap::new(),
            Vec::new(),
            Some(directory.path().join("preview-files.json")),
            None,
        )
        .await?,
    );
    let catalog = Arc::new(SessionCatalog::scan(directory.path()));
    let service = ResourceService::open(
        directory.path().join("resources.redb"),
        catalog,
        files.clone(),
    )?;

    assert_eq!(
        preview_status(&files, &attachment).await,
        StatusCode::FORBIDDEN
    );
    service.schedule_prewarm(THREAD_ID);
    wait_for_preview(&files, &attachment).await?;

    let snapshot = service
        .handle(
            "companion/threadResources/read",
            &json!({"threadId":THREAD_ID}),
        )
        .await?;
    assert_eq!(snapshot["attachments"][0]["origin"], "agent");
    assert_eq!(
        snapshot["attachments"][0]["path"],
        format!("{}:7:3", attachment.display())
    );
    Ok(())
}

#[tokio::test]
async fn fresh_rpc_image_is_authorized_before_rollout_materializes()
-> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let directory = tempfile::tempdir()?;
    let image = directory.path().join("fresh-tool-image.png");
    tokio::fs::write(&image, b"fresh-png").await?;
    let files = Arc::new(
        FileService::open(
            HashMap::new(),
            Vec::new(),
            Some(directory.path().join("preview-files.json")),
            None,
        )
        .await?,
    );
    let service = ResourceService::open(
        directory.path().join("resources.redb"),
        Arc::new(SessionCatalog::scan(
            &directory.path().join("missing-sessions"),
        )),
        files.clone(),
    )?;

    assert_eq!(preview_status(&files, &image).await, StatusCode::FORBIDDEN);
    service
        .observe_rpc_result(
            "thread/turns/list",
            &json!({
                "data": [{
                    "id": "turn-fresh",
                    "items": [{
                        "id": "image-fresh",
                        "type": "imageView",
                        "path": image
                    }]
                }]
            }),
        )
        .await;

    assert_eq!(preview_status(&files, &image).await, StatusCode::OK);
    Ok(())
}

async fn write_lines(path: &Path, values: &[Value]) -> Result<(), std::io::Error> {
    let mut output = Vec::new();
    for value in values {
        output.extend_from_slice(value.to_string().as_bytes());
        output.push(b'\n');
    }
    tokio::fs::write(path, output).await
}

fn change_paths(snapshot: &Value) -> Vec<&str> {
    snapshot["changes"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|change| change["path"].as_str())
        .collect()
}

async fn preview_status(files: &FileService, path: &Path) -> StatusCode {
    match files
        .download(
            FileQuery {
                root_id: None,
                path: Some(path.to_string_lossy().into_owned()),
            },
            &HeaderMap::new(),
            false,
            true,
        )
        .await
    {
        Ok(response) => response.status(),
        Err(error) => error.into_response().status(),
    }
}

async fn wait_for_preview(
    files: &FileService,
    path: &Path,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    for _ in 0..100 {
        if preview_status(files, path).await == StatusCode::OK {
            return Ok(());
        }
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    }
    Err("resource prewarm did not authorize the attachment".into())
}
