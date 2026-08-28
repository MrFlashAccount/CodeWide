use std::sync::{Arc, Mutex};

use axum::{Router, extract::Request, http::StatusCode, response::IntoResponse, routing::any};
use codewide_companion::{
    auth::DeviceRegistry,
    build_shelf::BuildShelfProxy,
    catalog::SessionCatalog,
    history_service::HistoryService,
    server::{self, CompanionServices},
    store::IndexStore,
    sync::SyncHub,
    upstream::UpstreamHandle,
};
use tokio::net::TcpListener;

const TOKEN: &str = "build-shelf-test-admin-token-that-is-long-enough";

#[tokio::test]
async fn build_shelf_proxy_preserves_ota_headers_and_rejects_private_paths()
-> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let seen = Arc::new(Mutex::new(
        Vec::<(String, Option<String>, Option<String>)>::new(),
    ));
    let shelf_seen = seen.clone();
    let shelf = Router::new().fallback(any(move |request: Request| {
        let seen = shelf_seen.clone();
        async move {
            seen.lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .push((
                    request.uri().to_string(),
                    request
                        .headers()
                        .get("expo-runtime-version")
                        .and_then(|value| value.to_str().ok())
                        .map(ToOwned::to_owned),
                    request
                        .headers()
                        .get("authorization")
                        .and_then(|value| value.to_str().ok())
                        .map(ToOwned::to_owned),
                ));
            (StatusCode::OK, [("expo-protocol-version", "1")], "manifest").into_response()
        }
    }));
    let shelf_listener = TcpListener::bind("127.0.0.1:0").await?;
    let shelf_address = shelf_listener.local_addr()?;
    let shelf_task = tokio::spawn(async move {
        let _ = axum::serve(shelf_listener, shelf).await;
    });

    let directory = tempfile::tempdir()?;
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
    let registry = Arc::new(
        DeviceRegistry::open(
            Arc::from(TOKEN),
            directory.path().join("devices.json"),
            None,
        )
        .await?,
    );
    let routers = server::split_routers_with_registry_and_services(
        store,
        registry,
        sync,
        CompanionServices {
            build_shelf: Some(BuildShelfProxy::new(&format!("http://{shelf_address}"))?),
            ..CompanionServices::default()
        },
    );
    let listener = TcpListener::bind("127.0.0.1:0").await?;
    let address = listener.local_addr()?;
    let task = tokio::spawn(async move {
        let _ = axum::serve(listener, routers.public).await;
    });
    let client = reqwest::Client::new();
    let update = client
        .get(format!("http://{address}/api/updates?channel=production"))
        .header("expo-runtime-version", "0.2.8-native-21")
        .bearer_auth("must-not-leak")
        .send()
        .await?;
    assert_eq!(update.status(), reqwest::StatusCode::OK);
    assert_eq!(update.headers()["expo-protocol-version"], "1");
    assert_eq!(update.text().await?, "manifest");
    assert_eq!(
        seen.lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .as_slice(),
        &[(
            "/api/updates?channel=production".to_owned(),
            Some("0.2.8-native-21".to_owned()),
            None,
        )]
    );

    let private = client
        .get(format!("http://{address}/api/private"))
        .send()
        .await?;
    assert_eq!(private.status(), reqwest::StatusCode::NOT_FOUND);
    assert_eq!(
        seen.lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .len(),
        1
    );

    task.abort();
    shelf_task.abort();
    Ok(())
}
