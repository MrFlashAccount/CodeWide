#![cfg(unix)]

use std::{
    collections::HashMap,
    os::unix::fs::{MetadataExt, symlink},
    path::{Path, PathBuf},
    sync::Arc,
};

use codewide_companion::{
    catalog::SessionCatalog,
    files::FileService,
    history_service::HistoryService,
    server::{self, CompanionServices},
    store::IndexStore,
    sync::SyncHub,
    upstream::UpstreamHandle,
};
use sha2::{Digest, Sha256};
use tokio::net::TcpListener;

const TOKEN: &str = "file-test-admin-token-that-is-long-enough";

#[tokio::test]
async fn scoped_file_transport_matches_v1_safety_and_resume_contract()
-> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let directory = tempfile::tempdir()?;
    let root = directory.path().join("workspace");
    tokio::fs::create_dir(&root).await?;
    tokio::fs::write(root.join("source.txt"), b"abcdef").await?;
    tokio::fs::write(root.join("guide.md"), b"# Guide\n").await?;
    let outside = directory.path().join("outside.txt");
    tokio::fs::write(&outside, b"private").await?;
    symlink(&outside, root.join("escape.txt"))?;
    let mapped_preview_root = directory.path().join("private-tmp");
    tokio::fs::create_dir(&mapped_preview_root).await?;
    tokio::fs::write(mapped_preview_root.join("render.png"), b"observed").await?;
    tokio::fs::write(mapped_preview_root.join("private.png"), b"private").await?;
    let reported_preview_root = PathBuf::from("/tmp/codewide-mapped-preview");

    let files = Arc::new(
        FileService::open_with_preview_mappings(
            HashMap::from([("workspace".to_owned(), root.clone())]),
            Vec::new(),
            HashMap::from([(reported_preview_root.clone(), mapped_preview_root)]),
            Some(directory.path().join("preview-files.json")),
            None,
        )
        .await?,
    );
    files.observe_preview_path(&root.join("guide.md")).await;
    files
        .observe_preview_path(&reported_preview_root.join("render.png"))
        .await;
    let store = Arc::new(IndexStore::open(directory.path().join("state.redb"))?);
    let history = HistoryService::new(
        Arc::new(SessionCatalog::scan(directory.path())),
        store.clone(),
    );
    let sync = SyncHub::new(
        UpstreamHandle::spawn(directory.path().join("missing.sock")),
        store.clone(),
        history,
    );
    let app = server::router_with_services(
        store,
        Arc::from(TOKEN),
        sync,
        CompanionServices {
            files: Some(files.clone()),
            ..CompanionServices::default()
        },
    );
    let listener = TcpListener::bind("127.0.0.1:0").await?;
    let address = listener.local_addr()?;
    let task = tokio::spawn(async move {
        let _ = axum::serve(listener, app).await;
    });
    let client = reqwest::Client::new();
    let base = format!("http://{address}");

    assert_downloads(&client, &base, &root, &reported_preview_root).await?;
    assert_uploads(&client, &base, &root).await?;

    task.abort();
    Ok(())
}

#[tokio::test]
async fn managed_attachments_are_scoped_by_thread_and_share_cas_blobs()
-> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let directory = tempfile::tempdir()?;
    let root = directory.path().join("codex-home/attachments/codewide");
    tokio::fs::create_dir_all(&root).await?;
    let files = Arc::new(
        FileService::open_with_managed_attachments(
            HashMap::from([("attachments".to_owned(), root.clone())]),
            Vec::new(),
            HashMap::new(),
            None,
            "attachments".to_owned(),
            None,
        )
        .await?,
    );
    let store = Arc::new(IndexStore::open(directory.path().join("state.redb"))?);
    let history = HistoryService::new(
        Arc::new(SessionCatalog::scan(directory.path())),
        store.clone(),
    );
    let sync = SyncHub::new(
        UpstreamHandle::spawn(directory.path().join("missing.sock")),
        store.clone(),
        history,
    );
    let app = server::router_with_services(
        store,
        Arc::from(TOKEN),
        sync,
        CompanionServices {
            files: Some(files.clone()),
            ..CompanionServices::default()
        },
    );
    let listener = TcpListener::bind("127.0.0.1:0").await?;
    let address = listener.local_addr()?;
    let task = tokio::spawn(async move {
        let _ = axum::serve(listener, app).await;
    });
    let client = reqwest::Client::new();
    let bytes = b"same attachment bytes";
    let hash = sha256(bytes);
    for thread in ["thread-one", "thread-two"] {
        let path = format!("sessions/{thread}/files/upload-report.txt");
        let response = client
            .put(format!(
                "http://{address}/v1/files/upload?rootId=attachments&path={path}"
            ))
            .bearer_auth(TOKEN)
            .header("content-type", "text/plain")
            .header("x-content-sha256", &hash)
            .body(bytes.to_vec())
            .send()
            .await?;
        assert_eq!(response.status(), reqwest::StatusCode::CREATED);
        let manifest =
            tokio::fs::read_to_string(root.join(format!("sessions/{thread}/manifest.json")))
                .await?;
        assert!(manifest.contains("upload-report.txt"));
        assert!(manifest.contains(&hash));
    }
    let first = std::fs::metadata(root.join("sessions/thread-one/files/upload-report.txt"))?;
    let second = std::fs::metadata(root.join("sessions/thread-two/files/upload-report.txt"))?;
    let blob = std::fs::metadata(root.join(format!("blobs/sha256/{}/{hash}", &hash[..2])))?;
    assert_eq!(first.ino(), second.ino());
    assert_eq!(first.ino(), blob.ino());
    assert_eq!(blob.nlink(), 3);

    let invalid = client
        .put(format!(
            "http://{address}/v1/files/upload?rootId=attachments&path=sessions/bad/thread/file.txt"
        ))
        .bearer_auth(TOKEN)
        .header("x-content-sha256", sha256(b"bad"))
        .body(b"bad".to_vec())
        .send()
        .await?;
    assert_eq!(invalid.status(), reqwest::StatusCode::BAD_REQUEST);

    let legacy = client
        .put(format!(
            "http://{address}/v1/files/upload?rootId=attachments&path=legacy-client.txt"
        ))
        .bearer_auth(TOKEN)
        .header("x-content-sha256", sha256(b"legacy"))
        .body(b"legacy".to_vec())
        .send()
        .await?;
    assert_eq!(legacy.status(), reqwest::StatusCode::CREATED);
    assert_eq!(
        tokio::fs::read(root.join("legacy-client.txt")).await?,
        b"legacy"
    );

    for thread in ["thread-one", "thread-two"] {
        files.mark_thread_attachments_deleted(thread).await?;
        tokio::fs::write(root.join(format!("sessions/{thread}/.deleted-at")), b"0\n").await?;
    }
    files.gc_managed_attachments().await?;
    assert!(!root.join("sessions/thread-one").exists());
    assert!(!root.join("sessions/thread-two").exists());

    task.abort();
    Ok(())
}

async fn assert_downloads(
    client: &reqwest::Client,
    base: &str,
    root: &std::path::Path,
    reported_preview_root: &Path,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let download = client
        .get(format!(
            "{base}/v1/files/download?rootId=workspace&path=source.txt"
        ))
        .bearer_auth(TOKEN)
        .send()
        .await?;
    assert_eq!(download.status(), reqwest::StatusCode::OK);
    assert_eq!(download.headers()["x-content-sha256"], sha256(b"abcdef"));
    assert_eq!(download.text().await?, "abcdef");

    let range = client
        .get(format!(
            "{base}/v1/files/download?rootId=workspace&path=source.txt"
        ))
        .bearer_auth(TOKEN)
        .header("range", "bytes=2-2097151")
        .send()
        .await?;
    assert_eq!(range.status(), reqwest::StatusCode::PARTIAL_CONTENT);
    assert_eq!(range.headers()["content-range"], "bytes 2-5/6");
    assert_eq!(range.text().await?, "cdef");

    let preview = client
        .get(format!(
            "{base}/v1/files/preview?path={}",
            root.join("guide.md").to_str().ok_or("bad path")?
        ))
        .bearer_auth(TOKEN)
        .send()
        .await?;
    assert_eq!(preview.status(), reqwest::StatusCode::OK);
    assert_eq!(
        preview.headers()["content-type"],
        "text/markdown; charset=utf-8"
    );
    assert_eq!(preview.text().await?, "# Guide\n");

    let mapped_preview = client
        .get(format!(
            "{base}/v1/files/preview?path={}",
            reported_preview_root.join("render.png").display()
        ))
        .bearer_auth(TOKEN)
        .send()
        .await?;
    assert_eq!(mapped_preview.status(), reqwest::StatusCode::OK);
    assert_eq!(mapped_preview.text().await?, "observed");
    let mapped_sibling = client
        .get(format!(
            "{base}/v1/files/preview?path={}",
            reported_preview_root.join("private.png").display()
        ))
        .bearer_auth(TOKEN)
        .send()
        .await?;
    assert_eq!(mapped_sibling.status(), reqwest::StatusCode::FORBIDDEN);

    let escaped = client
        .get(format!(
            "{base}/v1/files/download?rootId=workspace&path=escape.txt"
        ))
        .bearer_auth(TOKEN)
        .send()
        .await?;
    assert_eq!(escaped.status(), reqwest::StatusCode::FORBIDDEN);
    let unauthorized = client
        .get(format!(
            "{base}/v1/files/download?rootId=workspace&path=source.txt"
        ))
        .send()
        .await?;
    assert_eq!(unauthorized.status(), reqwest::StatusCode::UNAUTHORIZED);

    Ok(())
}

async fn assert_uploads(
    client: &reqwest::Client,
    base: &str,
    root: &std::path::Path,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let uploaded = b"uploaded-content";
    let upload = client
        .put(format!(
            "{base}/v1/files/upload?rootId=workspace&path=uploaded.txt"
        ))
        .bearer_auth(TOKEN)
        .header("x-content-sha256", sha256(uploaded))
        .body(uploaded.to_vec())
        .send()
        .await?;
    assert_eq!(upload.status(), reqwest::StatusCode::CREATED);
    assert_eq!(tokio::fs::read(root.join("uploaded.txt")).await?, uploaded);

    let resumable = b"resumable-upload-content";
    let split = 9;
    let upload_id = format!("sha256-{}", sha256(resumable));
    let url = format!("{base}/v1/files/upload?rootId=workspace&path=resumed.txt");
    let first = client
        .put(&url)
        .bearer_auth(TOKEN)
        .header("x-upload-id", &upload_id)
        .header("x-content-sha256", sha256(resumable))
        .header(
            "content-range",
            format!("bytes 0-{}/{}", split - 1, resumable.len()),
        )
        .body(resumable[..split].to_vec())
        .send()
        .await?;
    assert_eq!(first.status().as_u16(), 308);
    assert_eq!(first.headers()["x-upload-offset"], split.to_string());
    let status = client
        .head(&url)
        .bearer_auth(TOKEN)
        .header("x-upload-id", &upload_id)
        .header("x-content-sha256", sha256(resumable))
        .send()
        .await?;
    assert_eq!(status.status(), reqwest::StatusCode::NO_CONTENT);
    assert_eq!(status.headers()["x-upload-offset"], split.to_string());
    let final_chunk = client
        .put(&url)
        .bearer_auth(TOKEN)
        .header("x-upload-id", &upload_id)
        .header("x-content-sha256", sha256(resumable))
        .header(
            "content-range",
            format!(
                "bytes {}-{}/{}",
                split,
                resumable.len() - 1,
                resumable.len()
            ),
        )
        .body(resumable[split..].to_vec())
        .send()
        .await?;
    assert_eq!(final_chunk.status(), reqwest::StatusCode::CREATED);
    assert_eq!(tokio::fs::read(root.join("resumed.txt")).await?, resumable);

    Ok(())
}

fn sha256(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}
