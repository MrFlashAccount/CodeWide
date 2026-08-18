use std::sync::Arc;

use codewide_host_rs::{
    catalog::SessionCatalog,
    history_service::HistoryService,
    media::MediaProxyService,
    server::{self, CompanionServices},
    store::IndexStore,
    sync::SyncHub,
    upstream::UpstreamHandle,
};
use serde_json::{Value, json};
use tokio::net::TcpListener;

const TOKEN: &str = "media-test-admin-token-that-is-long-enough";

#[tokio::test]
async fn remote_media_requires_auth_and_rejects_ssrf_targets()
-> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let directory = tempfile::tempdir()?;
    let store = Arc::new(IndexStore::open(directory.path().join("state.redb"))?);
    let history = HistoryService::new(Arc::new(SessionCatalog::scan(directory.path())));
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
            media: Some(Arc::new(MediaProxyService::new())),
            ..CompanionServices::default()
        },
    );
    let listener = TcpListener::bind("127.0.0.1:0").await?;
    let address = listener.local_addr()?;
    let task = tokio::spawn(async move {
        let _ = axum::serve(listener, app).await;
    });
    let client = reqwest::Client::new();
    let url = format!("http://{address}/v1/media/materialize");

    let unauthorized = client
        .post(&url)
        .json(&json!({"url": "https://127.0.0.1/private.png"}))
        .send()
        .await?;
    assert_eq!(unauthorized.status(), reqwest::StatusCode::UNAUTHORIZED);

    let unsafe_host = client
        .post(&url)
        .bearer_auth(TOKEN)
        .json(&json!({"url": "https://127.0.0.1/private.png"}))
        .send()
        .await?;
    assert_eq!(unsafe_host.status(), reqwest::StatusCode::BAD_REQUEST);
    assert_eq!(
        unsafe_host.json::<Value>().await?["error"],
        "unsafe_image_host"
    );

    let insecure = client
        .post(&url)
        .bearer_auth(TOKEN)
        .json(&json!({"url": "http://example.com/image.png"}))
        .send()
        .await?;
    assert_eq!(insecure.status(), reqwest::StatusCode::BAD_REQUEST);
    assert_eq!(
        insecure.json::<Value>().await?["error"],
        "https_image_required"
    );

    task.abort();
    Ok(())
}
