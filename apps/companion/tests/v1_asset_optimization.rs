use std::{
    collections::HashMap,
    io::{Cursor, Read},
    sync::Arc,
};

use codewide_companion::{
    catalog::SessionCatalog,
    content::PrivateContentService,
    files::FileService,
    history_service::HistoryService,
    image_previews::ImagePreviewService,
    server::{self, CompanionServices},
    store::IndexStore,
    sync::SyncHub,
    upstream::UpstreamHandle,
};
use flate2::read::GzDecoder;
use image::{DynamicImage, ImageFormat, Rgba, RgbaImage};
use reqwest::{Client, StatusCode, header};
use tokio::net::TcpListener;

const TOKEN: &str = "asset-optimization-test-token";

#[tokio::test]
async fn v1_serves_gzipped_text_and_progressive_webp_variants()
-> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let directory = tempfile::tempdir()?;
    let root = directory.path().join("workspace");
    tokio::fs::create_dir_all(&root).await?;
    let markdown = "# Changes\n\n".repeat(40_000);
    tokio::fs::write(root.join("changes.md"), &markdown).await?;
    let image_path = root.join("screenshot.png");
    let image =
        DynamicImage::ImageRgba8(RgbaImage::from_pixel(1_600, 1_200, Rgba([24, 48, 96, 255])));
    let mut encoded = Cursor::new(Vec::new());
    image.write_to(&mut encoded, ImageFormat::Png)?;
    tokio::fs::write(&image_path, encoded.get_ref()).await?;

    let files = Arc::new(
        FileService::open(
            HashMap::from([("workspace".to_owned(), root.clone())]),
            vec![root.clone()],
            None,
            None,
        )
        .await?,
    );
    files.observe_preview_path(&image_path).await;
    let content = PrivateContentService::open(directory.path().join("content"));
    let content_reference = content.put_text(&markdown, "text/markdown; charset=utf-8");
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
            files: Some(files),
            content: Some(content),
            image_previews: Some(Arc::new(ImagePreviewService::new())),
            ..CompanionServices::default()
        },
    );
    let listener = TcpListener::bind("127.0.0.1:0").await?;
    let address = listener.local_addr()?;
    let task = tokio::spawn(async move {
        let _ = axum::serve(listener, app).await;
    });
    let client = Client::builder().build()?;
    let base = format!("http://{address}");

    assert_gzipped_text(&client, &base, &content_reference.id, &markdown).await?;
    assert_progressive_images(&client, &base).await?;

    task.abort();
    Ok(())
}

async fn assert_gzipped_text(
    client: &Client,
    base: &str,
    content_id: &str,
    markdown: &str,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let text = client
        .get(format!(
            "{base}/v1/files/text?rootId=workspace&path=changes.md"
        ))
        .bearer_auth(TOKEN)
        .header(header::ACCEPT_ENCODING, "gzip")
        .send()
        .await?;
    assert_eq!(text.status(), StatusCode::OK);
    assert_eq!(text.headers()[header::CONTENT_ENCODING], "gzip");
    assert!(text.headers().get(header::CONTENT_RANGE).is_none());
    assert_eq!(text.headers()["x-content-complete"], "true");
    let compressed = text.bytes().await?;
    let mut decoded = String::new();
    GzDecoder::new(compressed.as_ref()).read_to_string(&mut decoded)?;
    assert_eq!(decoded, markdown);

    let content_text = client
        .get(format!("{base}/v1/content/{content_id}/text"))
        .bearer_auth(TOKEN)
        .header(header::ACCEPT_ENCODING, "gzip")
        .send()
        .await?;
    assert_eq!(content_text.status(), StatusCode::OK);
    assert_eq!(content_text.headers()[header::CONTENT_ENCODING], "gzip");
    Ok(())
}

async fn assert_progressive_images(
    client: &Client,
    base: &str,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let preview_url = format!(
        "{base}/v1/image-previews/file?rootId=workspace&path=screenshot.png&variant=preview"
    );
    let preview = client.get(&preview_url).bearer_auth(TOKEN).send().await?;
    assert_eq!(preview.status(), StatusCode::OK);
    assert_eq!(preview.headers()[header::CONTENT_TYPE], "image/webp");
    assert_eq!(preview.headers()["x-image-width"], "640");
    assert_eq!(preview.headers()["x-image-height"], "480");
    let preview_etag = preview.headers()[header::ETAG].clone();
    let preview_bytes = preview.bytes().await?;
    assert_eq!(&preview_bytes[..4], b"RIFF");
    assert_eq!(&preview_bytes[8..12], b"WEBP");

    let not_modified = client
        .get(&preview_url)
        .bearer_auth(TOKEN)
        .header(header::IF_NONE_MATCH, preview_etag)
        .send()
        .await?;
    assert_eq!(not_modified.status(), StatusCode::NOT_MODIFIED);

    let detail = client
        .get(format!(
            "{base}/v1/image-previews/file?rootId=workspace&path=screenshot.png&variant=detail"
        ))
        .bearer_auth(TOKEN)
        .send()
        .await?;
    assert_eq!(detail.status(), StatusCode::OK);
    assert_eq!(detail.headers()["x-image-width"], "1600");
    assert_eq!(detail.headers()["x-image-height"], "1200");

    let original = client
        .head(format!(
            "{base}/v1/files/download?rootId=workspace&path=screenshot.png"
        ))
        .bearer_auth(TOKEN)
        .send()
        .await?;
    assert_eq!(original.status(), StatusCode::OK);
    assert!(original.headers().contains_key("x-content-sha256"));
    assert!(original.headers().contains_key(header::ETAG));

    Ok(())
}
