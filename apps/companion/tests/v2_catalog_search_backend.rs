#![cfg(unix)]

use std::{error::Error, sync::Arc};

use codewide_companion::{
    auth::AuthorizationContext,
    catalog::SessionCatalog,
    history_service::HistoryService,
    store::IndexStore,
    sync_v2::{
        AuthenticatedContextKey, ProductionServices, SemanticSource, UpstreamSemanticSource,
        protocol::{CatalogPartition, ErrorCode, Query, QueryResult, V2Error},
    },
    upstream::UpstreamHandle,
};
use futures_util::{SinkExt, StreamExt};
use serde_json::{Value, json};
use tokio::net::{UnixListener, UnixStream};
use tokio_tungstenite::{WebSocketStream, accept_async, tungstenite::Message};

type TestResult<T = ()> = Result<T, Box<dyn Error + Send + Sync>>;

#[tokio::test]
async fn production_catalog_search_is_index_backed_root_only_and_cursor_exact() -> TestResult {
    let directory = tempfile::tempdir()?;
    let socket_path = directory.path().join("catalog-search.sock");
    let listener = UnixListener::bind(&socket_path)?;
    let server = tokio::spawn(run_search_server(listener));
    let upstream = UpstreamHandle::spawn(socket_path);
    let store = Arc::new(IndexStore::open(directory.path().join("state.redb"))?);
    let catalog = Arc::new(SessionCatalog::scan(directory.path()));
    let history = HistoryService::new(catalog.clone(), store.clone());
    let source = UpstreamSemanticSource::new(
        upstream,
        store,
        history,
        catalog,
        ProductionServices::default(),
    );
    v2_result(source.wait_until_available().await)?;
    let authorization = authorization();
    let context = v2_result(AuthenticatedContextKey::derive(&authorization))?;
    let generation = source.generation();
    assert_active_search_pages(&source, &authorization, &context, generation).await?;

    let archived = v2_result(
        source
            .query(
                Query::CatalogSearch {
                    partition: CatalogPartition::Archived,
                    text: "archived needle".into(),
                    cursor: None,
                    limit: 1,
                },
                &authorization,
                &context,
                generation,
            )
            .await,
    )?;
    let QueryResult::CatalogSearch { threads, .. } = archived else {
        return Err("archived catalog search returned the wrong result kind".into());
    };
    assert_eq!(threads.len(), 1);
    assert!(threads[0].archived);

    server.await??;
    Ok(())
}

async fn assert_active_search_pages(
    source: &UpstreamSemanticSource,
    authorization: &AuthorizationContext,
    context: &AuthenticatedContextKey,
    generation: u64,
) -> TestResult {
    let first = v2_result(
        source
            .query(
                Query::CatalogSearch {
                    partition: CatalogPartition::Active,
                    text: "  indexed needle  ".into(),
                    cursor: None,
                    limit: 2,
                },
                authorization,
                context,
                generation,
            )
            .await,
    )?;
    let QueryResult::CatalogSearch {
        threads,
        next_cursor,
    } = first
    else {
        return Err("catalog search returned the wrong result kind".into());
    };
    assert!(threads.is_empty());
    let continuation = next_cursor.ok_or("catalog search omitted continuation")?;
    assert!(continuation.starts_with("v2-catalog-search:"));

    for query in invalid_cursor_queries(&continuation) {
        let result = source
            .query(query, authorization, context, generation)
            .await;
        let Err(error) = result else {
            return Err("a query-mismatched catalog cursor was accepted".into());
        };
        assert_eq!(error.code, ErrorCode::InvalidCursor);
    }

    let second = v2_result(
        source
            .query(
                Query::CatalogSearch {
                    partition: CatalogPartition::Active,
                    text: "indexed needle".into(),
                    cursor: Some(continuation),
                    limit: 2,
                },
                authorization,
                context,
                generation,
            )
            .await,
    )?;
    let QueryResult::CatalogSearch {
        threads,
        next_cursor,
    } = second
    else {
        return Err("catalog search continuation returned the wrong result kind".into());
    };
    assert_eq!(threads.len(), 1);
    assert_eq!(threads[0].id.as_str(), "root-2");
    assert_eq!(next_cursor, None);
    Ok(())
}

fn invalid_cursor_queries(continuation: &str) -> [Query; 2] {
    [
        Query::CatalogSearch {
            partition: CatalogPartition::Active,
            text: "different query".into(),
            cursor: Some(continuation.to_owned()),
            limit: 2,
        },
        Query::CatalogSearch {
            partition: CatalogPartition::Archived,
            text: "indexed needle".into(),
            cursor: Some(continuation.to_owned()),
            limit: 2,
        },
    ]
}

fn authorization() -> AuthorizationContext {
    AuthorizationContext::Session {
        device_id: "catalog-search-device".into(),
        scopes: vec!["threads.read".into()],
        expires_at: u64::MAX,
    }
}

fn v2_result<T>(result: Result<T, V2Error>) -> TestResult<T> {
    result.map_err(|error| format!("{error:?}").into())
}

async fn run_search_server(listener: UnixListener) -> Result<(), Box<dyn Error + Send + Sync>> {
    let (stream, _) = listener.accept().await?;
    let mut socket = accept_async(stream).await?;
    initialize(&mut socket).await?;
    for step in 0..3 {
        let request = receive(&mut socket).await?;
        let id = request
            .get("id")
            .cloned()
            .ok_or("search request omitted id")?;
        if request["method"] != "thread/search" {
            return Err(format!("unexpected source method: {request}").into());
        }
        let response = search_response(step, &request)?;
        socket
            .send(Message::Text(
                json!({"id": id, "result": response}).to_string().into(),
            ))
            .await?;
    }
    Ok(())
}

fn search_response(step: usize, request: &Value) -> Result<Value, Box<dyn Error + Send + Sync>> {
    let params = &request["params"];
    match step {
        0 => {
            require_params(params, false, "indexed needle", None, 2)?;
            Ok(json!({
                "data": [
                    {"thread": thread("agent-1", Some("root-1")), "snippet": "needle"},
                    {"thread": thread("agent-2", Some("root-1")), "snippet": "needle"}
                ],
                "nextCursor": "opaque-active-2",
                "backwardsCursor": null
            }))
        }
        1 => {
            require_params(params, false, "indexed needle", Some("opaque-active-2"), 2)?;
            Ok(json!({
                "data": [{"thread": thread("root-2", None), "snippet": "needle"}],
                "nextCursor": null,
                "backwardsCursor": "opaque-active-back"
            }))
        }
        2 => {
            require_params(params, true, "archived needle", None, 1)?;
            Ok(json!({
                "data": [{"thread": thread("archived-1", None), "snippet": "needle"}],
                "nextCursor": null,
                "backwardsCursor": null
            }))
        }
        _ => Err("unexpected search request".into()),
    }
}

fn require_params(
    params: &Value,
    archived: bool,
    text: &str,
    cursor: Option<&str>,
    limit: u16,
) -> Result<(), Box<dyn Error + Send + Sync>> {
    let expected = json!({
        "archived": archived,
        "cursor": cursor,
        "limit": limit,
        "searchTerm": text,
        "sortDirection": "desc",
        "sortKey": "updated_at",
        "sourceKinds": ["cli", "vscode", "exec", "appServer", "unknown"],
    });
    if params != &expected {
        return Err(format!("catalog search params differ: {params}").into());
    }
    Ok(())
}

async fn initialize(
    socket: &mut WebSocketStream<UnixStream>,
) -> Result<(), Box<dyn Error + Send + Sync>> {
    let request = receive(socket).await?;
    socket
        .send(Message::Text(
            json!({"id": request["id"], "result": {}})
                .to_string()
                .into(),
        ))
        .await?;
    let initialized = receive(socket).await?;
    if initialized["method"] != "initialized" {
        return Err("App Server initialized notification was missing".into());
    }
    Ok(())
}

async fn receive(
    socket: &mut WebSocketStream<UnixStream>,
) -> Result<Value, Box<dyn Error + Send + Sync>> {
    let frame = socket.next().await.ok_or("App Server socket closed")??;
    Ok(serde_json::from_str(frame.into_text()?.as_str())?)
}

fn thread(id: &str, parent_id: Option<&str>) -> Value {
    json!({
        "id": id,
        "parentId": parent_id,
        "title": format!("Thread {id}"),
        "preview": "indexed needle",
        "cwd": "/workspace",
        "archived": false,
        "status": {"type": "idle"},
        "createdAt": "2026-09-03T09:00:00Z",
        "updatedAt": "2026-09-03T10:00:00Z",
        "headTurnId": null
    })
}
