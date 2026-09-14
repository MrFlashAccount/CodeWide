use super::*;
use futures_util::StreamExt;
use serde_json::Value;
use tokio_tungstenite::tungstenite::Message;

async fn inventory(client: &mut Client) -> Result<Value, Box<dyn Error>> {
    timeout(Duration::from_secs(20), async {
        loop {
            let message = client.next().await.ok_or("websocket closed")??;
            if let Message::Text(text) = message {
                let frame: Value = serde_json::from_str(&text)?;
                if frame["type"] == "portInventory" {
                    return Ok(frame);
                }
            }
        }
    })
    .await?
}

async fn subscribe(client: &mut Client) -> Result<Value, Box<dyn Error>> {
    send(
        client,
        json!({"type":"open","version":2,"intent":{
            "catalog":{"activeLimit":1,"archivedLimit":1},
            "currentThread":{"threadId":"thread-a","turnLimit":1},
            "pendingRequests":"currentThread","portInventory":true
        }}),
    )
    .await?;
    let snapshot = receive(client).await?;
    assert_eq!(snapshot["type"], "snapshot");
    send(
        client,
        json!({"type":"snapshotCommitted","epochId":snapshot["epochId"],
        "revision":snapshot["revision"],"watermark":snapshot["watermark"]}),
    )
    .await?;
    Ok(snapshot)
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn pushed_inventory_tracks_real_listeners_and_reconnects_without_client_polling()
-> Result<(), Box<dyn Error>> {
    let directory = tempfile::tempdir()?;
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await?;
    let port = listener.local_addr()?.port();
    // Concurrent transport fixtures may open arbitrary listeners. This inventory
    // owns only our listener, so their lifecycle is not a debounce input.
    let excluded = (1024..=u16::MAX)
        .filter(|candidate| *candidate != port)
        .collect();
    let ports = codewide_companion::port_inventory::PortInventory::new(excluded);
    let runtime = SyncV2Runtime::new(
        FakeSource::new(),
        directory.path().join("ports.redb"),
        TEST_PIN,
    )?
    .with_port_inventory(ports);
    let (address, server_task) = start_server(directory.path(), runtime).await?;
    let url = format!("ws://{address}/v2/sync");
    let mut client = connect(&url).await?;
    let snapshot = subscribe(&mut client).await?;
    let first = inventory(&mut client).await?;
    assert_eq!(first["epochId"], snapshot["epochId"]);
    assert_eq!(first["inventory"]["ports"][0]["port"], port);

    let mut restored = connect(&url).await?;
    let restored_snapshot = subscribe(&mut restored).await?;
    let replay = inventory(&mut restored).await?;
    assert_eq!(replay["epochId"], restored_snapshot["epochId"]);
    assert_eq!(replay["inventory"], first["inventory"]);
    assert_eq!(replay["revision"], first["revision"]);

    let mut not_subscribed = connect(&url).await?;
    open_and_commit(&mut not_subscribed, "thread-a").await?;
    send(
        &mut not_subscribed,
        json!({"type":"ping","nonce":"ports-independent"}),
    )
    .await?;
    assert_eq!(receive(&mut not_subscribed).await?["type"], "pong");

    drop(listener);
    let removed = inventory(&mut client).await?;
    assert!(
        removed["inventory"]["ports"]
            .as_array()
            .ok_or("inventory missing")?
            .is_empty()
    );
    assert_ne!(removed["revision"], first["revision"]);
    send(
        &mut restored,
        json!({"type":"ping","nonce":"messages-independent"}),
    )
    .await?;
    loop {
        let frame = receive(&mut restored).await?;
        if frame["type"] == "pong" {
            break;
        }
        assert!(frame["type"] == "portInventory" || frame["type"] == "live");
    }
    client.close(None).await?;
    restored.close(None).await?;
    not_subscribed.close(None).await?;
    server_task.abort();
    Ok(())
}
