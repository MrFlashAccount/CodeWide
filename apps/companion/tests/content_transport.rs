use std::sync::Arc;

use axum::http;
use base64::{Engine as _, engine::general_purpose};
use codewide_companion::{
    catalog::SessionCatalog,
    content::{
        ContentProjector, MAX_PROJECTED_ITEM_BYTES, MAX_PROJECTED_PAGE_BYTES,
        MAX_PROJECTED_TURN_BYTES, PrivateContentService,
    },
    history_service::HistoryService,
    server::{self, CompanionServices},
    store::IndexStore,
    sync::SyncHub,
    upstream::UpstreamHandle,
};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use tokio::net::TcpListener;

const TOKEN: &str = "content-test-admin-token-that-is-long-enough";
const PNG: &str =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

#[tokio::test]
async fn deterministic_large_content_projection_is_bounded()
-> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let directory = tempfile::tempdir()?;
    let projector = ContentProjector::new(PrivateContentService::open(
        directory.path().join("content"),
    ));
    let mut turns = Vec::new();

    for index in 0..64 {
        let item = json!({
            "id": format!("item-{index}"),
            "type": "commandExecution",
            "command": format!("cargo test --package component-{index}"),
            "aggregatedOutput": "compiled output\n".repeat(8_000),
            "changes": [{
                "path": format!("src/component_{index}.rs"),
                "diff": format!("@@ -1,1 +1,{} @@\n{}", 4_000, "+ changed line\n".repeat(4_000))
            }]
        });
        let projected_item = projector.project_item(item.clone());
        assert!(
            serde_json::to_vec(&projected_item)?.len() <= MAX_PROJECTED_ITEM_BYTES,
            "projected item exceeded its transport budget"
        );

        let turn = json!({
            "id": format!("turn-{index}"),
            "status": "completed",
            "items": [item, item]
        });
        let projected_turn = projector.project_turn(turn.clone());
        assert!(
            serde_json::to_vec(&projected_turn)?.len() <= MAX_PROJECTED_TURN_BYTES,
            "projected turn exceeded its transport budget"
        );
        turns.push(turn);
    }

    let projected_thread = projector.project_thread(json!({
        "id": "large-thread",
        "turns": turns
    }));
    let page_bytes = serde_json::to_vec(&projected_thread)?.len();
    assert!(
        page_bytes <= MAX_PROJECTED_PAGE_BYTES,
        "projected page exceeded its transport budget: {page_bytes} bytes"
    );
    eprintln!("projected_page_bytes={page_bytes}");
    Ok(())
}

#[tokio::test]
async fn large_text_and_inline_images_use_private_bounded_content()
-> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let directory = tempfile::tempdir()?;
    let content = PrivateContentService::open(directory.path().join("content"));
    let projector = ContentProjector::new(content.clone());
    let large_text = "Проверка длинного вывода.\n".repeat(4_000);
    let projected = projector.project_item(json!({
        "id": "item-large",
        "type": "agentMessage",
        "text": large_text,
        "contentItems": [{
            "type": "inputImage",
            "imageUrl": format!("data:image/png;base64,{PNG}")
        }]
    }));

    let encoded = serde_json::to_vec(&projected)?;
    assert!(encoded.len() <= 32 * 1024, "projected item is unbounded");
    let text_id = pointer(&projected, "/codewideContent/fields/~1text/id")?;
    let image_id = pointer(&projected, "/contentItems/0/codewideAsset/id")?;
    assert_eq!(pointer(&projected, "/contentItems/0/imageUrl")?, "");

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
            content: Some(content),
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

    let text = client
        .get(format!("{base}/v1/content/{text_id}?offset=1&limit=1024"))
        .bearer_auth(TOKEN)
        .send()
        .await?;
    assert_eq!(text.status(), reqwest::StatusCode::PARTIAL_CONTENT);
    let chunk = text.text().await?;
    assert!(chunk.len() <= 1024);
    assert!(chunk.is_char_boundary(chunk.len()));

    let image = client
        .get(format!("{base}/v1/content/{image_id}"))
        .bearer_auth(TOKEN)
        .send()
        .await?;
    assert_eq!(image.status(), reqwest::StatusCode::OK);
    assert_eq!(image.headers()["content-type"], "image/png");
    assert_eq!(
        image.bytes().await?.as_ref(),
        general_purpose::STANDARD.decode(PNG)?.as_slice()
    );

    let denied = client
        .get(format!("{base}/v1/content/{text_id}"))
        .send()
        .await?;
    assert_eq!(denied.status(), reqwest::StatusCode::UNAUTHORIZED);
    task.abort();
    Ok(())
}

fn pointer<'a>(value: &'a Value, pointer: &str) -> Result<&'a str, &'static str> {
    value
        .pointer(pointer)
        .and_then(Value::as_str)
        .ok_or("missing projected content reference")
}

#[tokio::test]
async fn legacy_content_reference_survives_companion_store_migration()
-> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let directory = tempfile::tempdir()?;
    let primary = directory.path().join("new-content");
    let legacy = directory.path().join("legacy-content");
    tokio::fs::create_dir_all(&legacy).await?;
    let bytes = general_purpose::STANDARD.decode(PNG)?;
    let digest = hex::encode(Sha256::digest(&bytes));
    tokio::fs::write(legacy.join(&digest), &bytes).await?;
    tokio::fs::write(
        legacy.join(format!("{digest}.meta.json")),
        r#"{"contentType":"image/png"}"#,
    )
    .await?;

    let content = PrivateContentService::open_with_fallbacks(primary, vec![legacy]);
    let response = content
        .serve(
            &digest,
            codewide_companion::content::ContentQuery {
                offset: None,
                limit: None,
            },
            &http::HeaderMap::new(),
            false,
        )
        .await?;

    assert_eq!(response.status(), http::StatusCode::OK);
    assert_eq!(response.headers()[http::header::CONTENT_TYPE], "image/png");
    assert_eq!(
        axum::body::to_bytes(response.into_body(), usize::MAX).await?,
        bytes,
    );
    Ok(())
}
