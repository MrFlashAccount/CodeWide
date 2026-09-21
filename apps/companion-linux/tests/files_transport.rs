#![cfg(unix)]

use std::{
    collections::HashMap,
    os::unix::fs::{MetadataExt, symlink},
    path::{Path, PathBuf},
    sync::Arc,
};

use base64::{Engine as _, engine::general_purpose};
use codewide_companion::{
    auth::{DeviceRegistry, PairingClaim, SessionProof, pairing_claim_message},
    catalog::SessionCatalog,
    files::{FileQuery, FileService},
    history_service::HistoryService,
    server::{self, CompanionServices},
    store::IndexStore,
    sync::SyncHub,
    sync_v2::WorkspaceUploadStore,
    upstream::UpstreamHandle,
};
use p256::{
    ecdsa::{Signature, SigningKey, signature::Signer},
    pkcs8::EncodePublicKey,
};
use sha2::{Digest, Sha256};
use tokio::net::TcpListener;

const TOKEN: &str = "file-test-admin-token-that-is-long-enough";

struct PairedFileDevice {
    id: String,
    session: String,
}

#[tokio::test]
async fn private_preview_streams_regular_files_larger_than_the_transfer_ceiling()
-> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let directory = tempfile::tempdir()?;
    let root = directory.path().join("workspace");
    tokio::fs::create_dir(&root).await?;
    let file = root.join("large.bin");
    tokio::fs::write(&file, b"abcdef").await?;
    let files = FileService::open(
        HashMap::from([("workspace".to_owned(), root)]),
        Vec::new(),
        None,
        Some(4),
    )
    .await?;
    files.observe_preview_path(&file).await;

    let response = files
        .download(
            FileQuery {
                path: Some(file.to_string_lossy().into_owned()),
                root_id: None,
            },
            &axum::http::HeaderMap::new(),
            false,
            true,
        )
        .await?;

    assert_eq!(response.status(), reqwest::StatusCode::OK);
    assert_eq!(response.headers()["x-content-sha256"], sha256(b"abcdef"));
    Ok(())
}

#[tokio::test]
async fn file_reads_are_host_wide_in_v1_and_v2_while_uploads_remain_resumable()
-> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let directory = tempfile::tempdir()?;
    let root = directory.path().join("workspace");
    tokio::fs::create_dir(&root).await?;
    tokio::fs::write(root.join("source.txt"), b"abcdef").await?;
    tokio::fs::write(root.join("guide.md"), b"# Guide\n").await?;
    let outside = directory.path().join("outside.txt");
    tokio::fs::write(&outside, b"private").await?;
    symlink(&outside, root.join("escape.txt"))?;
    let outside_directory = directory.path().join("outside-directory");
    tokio::fs::create_dir(&outside_directory).await?;
    symlink(&outside_directory, root.join("outside-link"))?;
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

    assert_downloads(&client, &base, &root, &reported_preview_root, &outside).await?;
    assert_uploads(&client, &base, &root, &outside_directory).await?;

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

#[tokio::test]
async fn v1_registry_upload_cannot_publish_after_device_revoke()
-> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let directory = tempfile::tempdir()?;
    let root = directory.path().join("workspace");
    tokio::fs::create_dir_all(&root).await?;
    let files = Arc::new(
        FileService::open(
            HashMap::from([("workspace".to_owned(), root.clone())]),
            Vec::new(),
            None,
            Some(1024),
        )
        .await?,
    );
    let staging = WorkspaceUploadStore::open(
        directory.path().join("workspace-uploads.redb"),
        files.clone(),
    )?;
    let registry = Arc::new(
        DeviceRegistry::open(
            Arc::from(TOKEN),
            directory.path().join("devices.json"),
            None,
        )
        .await?,
    );
    staging.start_revocation_cleanup(registry.subscribe_authorization_changes());
    let device = pair_file_device(&registry, 31, "file-device").await?;
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
    let app = server::router_with_registry_and_services(
        store,
        registry.clone(),
        sync,
        CompanionServices {
            files: Some(files),
            workspace_upload_staging: Some(staging),
            ..CompanionServices::default()
        },
    );
    let listener = TcpListener::bind("127.0.0.1:0").await?;
    let address = listener.local_addr()?;
    let server_task = tokio::spawn(async move {
        let _ = axum::serve(listener, app).await;
    });
    let (sender, receiver) = tokio::sync::mpsc::unbounded_channel();
    sender.send(Ok::<bytes::Bytes, std::io::Error>(
        bytes::Bytes::from_static(b"he"),
    ))?;
    let stream = futures_util::stream::unfold(receiver, |mut receiver| async {
        receiver.recv().await.map(|item| (item, receiver))
    });
    let expected_hash = sha256(b"hello");
    let client = reqwest::Client::new();
    let host_wide_upload = directory.path().join("outside-upload.txt");
    assert_v2_host_wide_upload(&client, address, &device.session, &host_wide_upload).await?;
    let request = client
        .put(format!(
            "http://{address}/v1/files/upload?rootId=workspace&path=revoked.txt"
        ))
        .bearer_auth(&device.session)
        .header("content-length", "5")
        .header("x-content-sha256", &expected_hash)
        .body(reqwest::Body::wrap_stream(stream));
    let upload = tokio::spawn(async move { request.send().await });
    let temporary = root.join(format!(".revoked.txt.upload-simple-{expected_hash}"));
    let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(2);
    while tokio::fs::symlink_metadata(&temporary).await.is_err() {
        if tokio::time::Instant::now() >= deadline {
            return Err("upload temporary file was not created".into());
        }
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    }
    assert!(registry.revoke(&device.id).await?);
    let response = tokio::time::timeout(std::time::Duration::from_secs(2), upload).await???;
    assert_eq!(response.status(), reqwest::StatusCode::UNAUTHORIZED);
    assert!(
        tokio::fs::symlink_metadata(root.join("revoked.txt"))
            .await
            .is_err()
    );
    assert!(tokio::fs::symlink_metadata(&temporary).await.is_err());
    drop(sender);
    server_task.abort();
    Ok(())
}

async fn assert_v2_host_wide_upload(
    client: &reqwest::Client,
    address: std::net::SocketAddr,
    session: &str,
    host_wide_upload: &Path,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let host_wide_bytes = b"host-wide";
    let host_wide_hash = sha256(host_wide_bytes);
    let host_wide_url = reqwest::Url::parse(&format!("http://{address}/v2/files/upload"))?;
    let resume = client
        .head(host_wide_url.clone())
        .query(&[
            ("rootId", "workspace"),
            ("path", &host_wide_upload.to_string_lossy()),
        ])
        .bearer_auth(session)
        .header("x-upload-id", format!("sha256-{host_wide_hash}"))
        .header("x-content-sha256", &host_wide_hash)
        .send()
        .await?;
    assert_eq!(resume.status(), reqwest::StatusCode::NOT_FOUND);
    let host_wide = client
        .put(host_wide_url)
        .query(&[
            ("rootId", "workspace"),
            ("path", &host_wide_upload.to_string_lossy()),
        ])
        .bearer_auth(session)
        .header("x-upload-id", format!("sha256-{host_wide_hash}"))
        .header("x-content-sha256", &host_wide_hash)
        .header(
            "content-range",
            format!(
                "bytes 0-{}/{}",
                host_wide_bytes.len() - 1,
                host_wide_bytes.len()
            ),
        )
        .body(host_wide_bytes.to_vec())
        .send()
        .await?;
    assert_eq!(host_wide.status(), reqwest::StatusCode::CREATED);
    assert_eq!(tokio::fs::read(host_wide_upload).await?, host_wide_bytes);
    Ok(())
}

async fn pair_file_device(
    registry: &DeviceRegistry,
    seed: u8,
    name: &str,
) -> Result<PairedFileDevice, Box<dyn std::error::Error + Send + Sync>> {
    let signing = SigningKey::from_bytes((&[seed; 32]).into())?;
    let public_key_spki =
        general_purpose::STANDARD.encode(signing.verifying_key().to_public_key_der()?.as_bytes());
    let pairing = registry.create_pairing().await?;
    let proof: Signature = signing.sign(&pairing_claim_message(
        &pairing.pairing_token,
        name,
        &public_key_spki,
    ));
    let claim = registry
        .claim(PairingClaim {
            pairing_token: pairing.pairing_token,
            device_name: name.to_owned(),
            public_key_spki,
            proof: general_purpose::STANDARD.encode(proof.to_der().as_bytes()),
        })
        .await?;
    let bearer = format!("Bearer {}", claim.capability_token);
    let challenge = registry.challenge(Some(&bearer)).await?;
    let signature: Signature =
        signing.sign(&general_purpose::URL_SAFE_NO_PAD.decode(&challenge.challenge)?);
    let session = registry
        .create_session(
            Some(&bearer),
            SessionProof {
                challenge_id: challenge.challenge_id,
                signature: general_purpose::STANDARD.encode(signature.to_der().as_bytes()),
            },
        )
        .await?
        .session_token;
    Ok(PairedFileDevice {
        id: claim.device_id,
        session,
    })
}

async fn assert_downloads(
    client: &reqwest::Client,
    base: &str,
    root: &std::path::Path,
    reported_preview_root: &Path,
    outside: &Path,
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
    assert_eq!(mapped_sibling.status(), reqwest::StatusCode::OK);
    assert_eq!(mapped_sibling.text().await?, "private");

    assert_host_wide_reads(client, base, reported_preview_root, outside).await?;

    let unauthorized = client
        .get(format!(
            "{base}/v1/files/download?rootId=workspace&path=source.txt"
        ))
        .send()
        .await?;
    assert_eq!(unauthorized.status(), reqwest::StatusCode::UNAUTHORIZED);
    let unauthorized_preview = client
        .get(format!(
            "{base}/v1/files/preview?path={}",
            reported_preview_root.join("private.png").display()
        ))
        .send()
        .await?;
    assert_eq!(
        unauthorized_preview.status(),
        reqwest::StatusCode::UNAUTHORIZED
    );

    Ok(())
}

async fn assert_host_wide_reads(
    client: &reqwest::Client,
    base: &str,
    reported_preview_root: &Path,
    outside: &Path,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let escaped = client
        .get(format!(
            "{base}/v1/files/download?rootId=workspace&path=escape.txt"
        ))
        .bearer_auth(TOKEN)
        .send()
        .await?;
    assert_eq!(escaped.status(), reqwest::StatusCode::OK);
    assert_eq!(escaped.text().await?, "private");
    let absolute_v1 = client
        .get(format!("{base}/v1/files/download"))
        .query(&[
            ("rootId", "workspace"),
            ("path", &outside.to_string_lossy()),
        ])
        .bearer_auth(TOKEN)
        .send()
        .await?;
    assert_eq!(absolute_v1.status(), reqwest::StatusCode::OK);
    assert_eq!(absolute_v1.text().await?, "private");
    let v2_preview = client
        .get(format!(
            "{base}/v2/files/preview?path={}",
            reported_preview_root.join("private.png").display()
        ))
        .bearer_auth(TOKEN)
        .send()
        .await?;
    assert_eq!(v2_preview.status(), reqwest::StatusCode::OK);
    assert_eq!(v2_preview.text().await?, "private");
    let v2_escaped = client
        .get(format!(
            "{base}/v2/files/download?rootId=workspace&path=escape.txt"
        ))
        .bearer_auth(TOKEN)
        .send()
        .await?;
    assert_eq!(v2_escaped.status(), reqwest::StatusCode::OK);
    assert_eq!(v2_escaped.text().await?, "private");
    let absolute_v2 = client
        .get(format!("{base}/v2/files/download"))
        .query(&[
            ("rootId", "workspace"),
            ("path", &outside.to_string_lossy()),
        ])
        .bearer_auth(TOKEN)
        .send()
        .await?;
    assert_eq!(absolute_v2.status(), reqwest::StatusCode::OK);
    assert_eq!(absolute_v2.text().await?, "private");
    Ok(())
}

async fn assert_uploads(
    client: &reqwest::Client,
    base: &str,
    root: &std::path::Path,
    outside_directory: &Path,
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

    let outside_bytes = b"outside-project";
    let outside_hash = sha256(outside_bytes);
    let outside_url =
        format!("{base}/v1/files/upload?rootId=workspace&path=outside-link%2Fuploaded.txt");
    let outside_status = client
        .head(&outside_url)
        .bearer_auth(TOKEN)
        .header("x-upload-id", format!("sha256-{outside_hash}"))
        .header("x-content-sha256", &outside_hash)
        .send()
        .await?;
    assert_eq!(outside_status.status(), reqwest::StatusCode::NOT_FOUND);
    let outside_upload = client
        .put(&outside_url)
        .bearer_auth(TOKEN)
        .header("x-content-sha256", &outside_hash)
        .body(outside_bytes.to_vec())
        .send()
        .await?;
    assert_eq!(outside_upload.status(), reqwest::StatusCode::CREATED);
    assert_eq!(
        tokio::fs::read(outside_directory.join("uploaded.txt")).await?,
        outside_bytes
    );

    Ok(())
}

fn sha256(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}
