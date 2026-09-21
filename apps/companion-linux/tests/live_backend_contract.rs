#![cfg(unix)]

use std::{
    collections::VecDeque,
    error::Error,
    path::{Path, PathBuf},
    sync::Arc,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use codewide_companion::{
    catalog::SessionCatalog,
    history_service::HistoryService,
    server,
    store::IndexStore,
    sync::SyncHub,
    upstream::{ConnectionStatus, UpstreamHandle},
};
use futures_util::{SinkExt, StreamExt};
use http::HeaderValue;
use serde_json::{Value, json};
use tokio::{
    io::copy_bidirectional,
    net::{TcpListener, UnixListener, UnixStream},
    sync::{broadcast, watch},
    task::JoinHandle,
    time::{sleep, timeout},
};
use tokio_tungstenite::{
    MaybeTlsStream, WebSocketStream, connect_async,
    tungstenite::{Message, client::IntoClientRequest},
};

const TOKEN: &str = "live-contract-token-that-is-long-enough";
const LIVE_TIMEOUT: Duration = Duration::from_mins(2);
type ClientSocket = WebSocketStream<MaybeTlsStream<tokio::net::TcpStream>>;
type TestResult<T = ()> = Result<T, Box<dyn Error>>;

/// Exercises the real managed Codex App Server and a temporary Companion.
///
/// This is deliberately ignored in normal CI because it creates a real thread
/// and starts real turns on the current account. Run it explicitly with:
///
/// ```text
/// CODEWIDE_LIVE_E2E=1 cargo test -p codewide-companion \
///   --test live_backend_contract -- --ignored --nocapture
/// ```
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
#[ignore = "requires the real managed Codex App Server and current account"]
async fn authoritative_refresh_recovers_without_cross_disconnect_replay() -> TestResult {
    require_live_opt_in()?;
    let socket_path = managed_app_server_socket()?;
    let temporary = tempfile::tempdir()?;
    let relay = ManagedSocketRelay::start(
        temporary.path().join("managed-app-server.sock"),
        socket_path.clone(),
    )?;

    let companion_upstream = UpstreamHandle::spawn(relay.path().to_owned());
    let companion_status = companion_upstream.clone();
    let observer = UpstreamHandle::spawn(socket_path);
    wait_for_live(&companion_upstream).await?;
    wait_for_live(&observer).await?;

    let store = Arc::new(IndexStore::open(temporary.path().join("state.redb"))?);
    // Keep the test independent of the production Companion index. A newly
    // created live thread therefore has to fall back to the real App Server's
    // bounded read APIs when the temporary rollout index has no coverage.
    let history = HistoryService::new(
        Arc::new(SessionCatalog::scan(temporary.path())),
        store.clone(),
    );
    let sync = SyncHub::with_mutations(companion_upstream, store.clone(), history);
    let (address, server_task) = start_server(store, sync).await?;
    let url = format!("ws://{address}/v1/sync");

    let mut control = SyncClient::connect(&url).await?;
    let mut reconnecting = SyncClient::connect(&url).await?;
    let run_id = unique_run_id();
    let thread_name = format!("CodeWide live contract {run_id}");
    let thread_id = create_test_thread(&observer, &thread_name).await?;
    let secondary_name = format!("CodeWide live contract secondary {run_id}");
    let secondary_thread_id = match create_test_thread(&observer, &secondary_name).await {
        Ok(thread_id) => thread_id,
        Err(error) => {
            let _ = observer
                .request(json!({
                    "method": "thread/delete",
                    "params": {"threadId": thread_id},
                }))
                .await;
            return Err(error);
        }
    };

    let outcome = run_authoritative_refresh_scenarios(
        &observer,
        &thread_id,
        &secondary_thread_id,
        &run_id,
        &url,
        &mut control,
        &mut reconnecting,
        &relay,
        &companion_status,
    )
    .await;

    let mut cleanup_errors = Vec::new();
    for cleanup_thread_id in [&thread_id, &secondary_thread_id] {
        if let Err(error) = observer
            .request(json!({
                "method": "thread/delete",
                "params": {"threadId": cleanup_thread_id},
            }))
            .await
        {
            cleanup_errors.push(format!("{cleanup_thread_id}: {error}"));
        }
    }
    server_task.abort();

    if !cleanup_errors.is_empty() {
        eprintln!("live E2E cleanup failed: {}", cleanup_errors.join(", "));
    }
    outcome
}

#[allow(clippy::too_many_arguments, clippy::too_many_lines)]
async fn run_authoritative_refresh_scenarios(
    observer: &UpstreamHandle,
    thread_id: &str,
    secondary_thread_id: &str,
    run_id: &str,
    url: &str,
    control: &mut SyncClient,
    reconnecting: &mut SyncClient,
    relay: &ManagedSocketRelay,
    companion_status: &UpstreamHandle,
) -> TestResult {
    eprintln!("stage=observe thread_id={thread_id}");
    for client in [&mut *control, &mut *reconnecting] {
        let response = client
            .rpc(
                "sync",
                "companion/thread/sync",
                json!({"threadId": thread_id, "afterTurnId": null, "limit": 36}),
            )
            .await?;
        require_rpc_result(&response)?;
    }
    let empty_snapshot = refresh_thread(control, thread_id).await?;
    if empty_snapshot
        .pointer("/history/turns")
        .and_then(Value::as_array)
        .is_none_or(|turns| !turns.is_empty())
    {
        return Err("new empty thread did not produce an authoritative empty snapshot".into());
    }

    let initial_message = format!("LIVE_INITIAL_{run_id}");
    eprintln!("stage=initial_turn token={initial_message}");
    start_turn(observer, thread_id, &initial_message).await?;
    let initial_cursor = control
        .wait_for_event(|event| user_item_has_client_id(event, &initial_message))
        .await?["cursor"]
        .as_u64()
        .ok_or("live user event cursor is missing")?;
    control
        .wait_for_event(|event| event_is_turn_completed(event, thread_id))
        .await?;
    eprintln!("stage=initial_turn_completed");
    // App Server does not materialize a just-created empty thread into the
    // durable catalog until its first turn exists.
    wait_until_catalog_contains(control, thread_id, false).await?;

    eprintln!("stage=two_client_snapshot");
    let control_snapshot = refresh_thread(control, thread_id).await?;
    let second_snapshot = refresh_thread(reconnecting, thread_id).await?;
    assert_snapshot_contains_completed_message(&control_snapshot, &initial_message)?;
    assert_snapshot_contains_completed_message(&second_snapshot, &initial_message)?;
    assert_eq!(
        normalized_turns(&control_snapshot)?,
        normalized_turns(&second_snapshot)?,
        "two live clients must receive equivalent authoritative snapshots"
    );

    reconnecting.close().await?;
    let missed_message = format!("LIVE_MISSED_{run_id}");
    eprintln!("stage=downstream_disconnected token={missed_message}");
    start_turn(observer, thread_id, &missed_message).await?;
    let missed_event = control
        .wait_for_event(|event| user_item_has_client_id(event, &missed_message))
        .await?;
    let missed_cursor = missed_event["cursor"]
        .as_u64()
        .ok_or("missed event cursor is missing")?;
    assert!(missed_cursor > initial_cursor);
    control
        .wait_for_event(|event| event_is_turn_completed(event, thread_id))
        .await?;

    // Reconnect without a cursor: intentionally discard replay and rebuild
    // from authoritative reads exactly as a first connection would.
    *reconnecting = SyncClient::connect(url).await?;
    eprintln!("stage=downstream_authoritative_refresh");
    let refreshed = refresh_thread(reconnecting, thread_id).await?;
    assert_snapshot_contains_completed_message(&refreshed, &initial_message)?;
    assert_snapshot_contains_completed_message(&refreshed, &missed_message)?;

    // Race a new external message against the refresh boundary. Correctness
    // permits either result: the message is already in the snapshot, or it is
    // delivered live after the snapshot. It must not fall into the gap.
    let raced_message = format!("LIVE_RACE_{run_id}");
    eprintln!("stage=refresh_race token={raced_message}");
    let refresh = refresh_thread(reconnecting, thread_id);
    let external_turn = start_turn(observer, thread_id, &raced_message);
    let (raced_snapshot, turn_result) = tokio::join!(refresh, external_turn);
    let raced_snapshot = raced_snapshot?;
    turn_result?;
    if !value_contains_string(&raced_snapshot, &raced_message) {
        reconnecting
            .wait_for_event(|event| user_item_has_client_id(event, &raced_message))
            .await?;
    }
    control
        .wait_for_event(|event| event_is_turn_completed(event, thread_id))
        .await?;
    let final_snapshot = refresh_thread(reconnecting, thread_id).await?;
    assert_snapshot_contains_completed_message(&final_snapshot, &raced_message)?;

    verify_idempotent_turn_start(control, reconnecting, thread_id, run_id).await?;
    verify_two_thread_delivery(
        observer,
        control,
        reconnecting,
        thread_id,
        secondary_thread_id,
        run_id,
    )
    .await?;

    eprintln!("stage=snapshot_live_seam_stress iterations=50");
    stress_snapshot_live_boundary(observer, thread_id, run_id, url, reconnecting).await?;
    verify_turn_pagination(observer, thread_id).await?;

    eprintln!("stage=upstream_disconnect");
    let generation = companion_status.generation();
    relay.pause();
    wait_for_status(companion_status, ConnectionStatus::Reconnecting).await?;
    let mut observer_events = observer.subscribe_events();
    let outage_message = format!("LIVE_UPSTREAM_OUTAGE_{run_id}");
    start_turn(observer, thread_id, &outage_message).await?;
    wait_for_upstream_event(&mut observer_events, |event| {
        upstream_event_is_turn_completed(event, thread_id)
    })
    .await?;

    let outage_name = format!("CodeWide outage {run_id}");
    observer_rpc(
        observer,
        "thread/name/set",
        json!({"threadId": thread_id, "name": outage_name}),
    )
    .await?;
    relay.resume();
    wait_for_generation(companion_status, generation).await?;

    // The reconnect itself intentionally carries no replay. The client-owned
    // refresh must recover both the completed turn and metadata written while
    // Companion had no App Server connection. Calling resume also restores the
    // live observation for the thread on the new upstream connection.
    let outage_snapshot = refresh_thread(control, thread_id).await?;
    assert_snapshot_contains_completed_message(&outage_snapshot, &outage_message)?;
    if outage_snapshot
        .pointer("/thread/name")
        .and_then(Value::as_str)
        != Some(&outage_name)
    {
        return Err("upstream reconnect refresh omitted the external thread rename".into());
    }

    let post_reconnect_message = format!("LIVE_AFTER_UPSTREAM_RECONNECT_{run_id}");
    start_turn(observer, thread_id, &post_reconnect_message).await?;
    control
        .wait_for_event(|event| user_item_has_client_id(event, &post_reconnect_message))
        .await?;
    control
        .wait_for_event(|event| event_is_turn_completed(event, thread_id))
        .await?;

    eprintln!("stage=archive_refresh");
    observer_rpc(observer, "thread/archive", json!({"threadId": thread_id})).await?;
    wait_until_catalog_contains(reconnecting, thread_id, true).await?;
    observer_rpc(observer, "thread/unarchive", json!({"threadId": thread_id})).await?;
    wait_until_catalog_contains(reconnecting, thread_id, false).await?;
    Ok(())
}

async fn verify_idempotent_turn_start(
    control: &mut SyncClient,
    sender: &mut SyncClient,
    thread_id: &str,
    run_id: &str,
) -> TestResult {
    eprintln!("stage=idempotent_send");
    let client_id = format!("LIVE_IDEMPOTENT_{run_id}");
    let params = json!({
        "threadId": thread_id,
        "clientUserMessageId": client_id,
        "input": [{
            "type": "text",
            "text": format!("Reply exactly with {client_id}"),
            "text_elements": [],
        }],
        "effort": "low",
    });
    let first = sender
        .rpc("idempotent-first", "turn/start", params.clone())
        .await?;
    require_rpc_result(&first)?;
    control
        .wait_for_event(|event| user_item_has_client_id(event, &client_id))
        .await?;
    control
        .wait_for_event(|event| event_is_turn_completed(event, thread_id))
        .await?;

    let repeated = control
        .rpc("idempotent-repeat", "turn/start", params)
        .await?;
    require_rpc_result(&repeated)?;
    let snapshot = refresh_thread(sender, thread_id).await?;
    let occurrences = count_page_user_items_with_client_id(&snapshot, &client_id)?;
    if occurrences != 1 {
        return Err(format!(
            "repeating one clientUserMessageId produced {occurrences} authoritative user items"
        )
        .into());
    }
    Ok(())
}

async fn verify_two_thread_delivery(
    observer: &UpstreamHandle,
    control: &mut SyncClient,
    reconnecting: &mut SyncClient,
    primary_thread_id: &str,
    secondary_thread_id: &str,
    run_id: &str,
) -> TestResult {
    eprintln!("stage=two_thread_external_delivery");
    for client in [&mut *control, &mut *reconnecting] {
        let response = client
            .rpc(
                "sync-secondary",
                "companion/thread/sync",
                json!({"threadId": secondary_thread_id, "afterTurnId": null, "limit": 36}),
            )
            .await?;
        require_rpc_result(&response)?;
    }

    let primary_message = format!("LIVE_PRIMARY_PARALLEL_{run_id}");
    let secondary_message = format!("LIVE_SECONDARY_PARALLEL_{run_id}");
    let primary = start_turn(observer, primary_thread_id, &primary_message);
    let secondary = start_turn(observer, secondary_thread_id, &secondary_message);
    let (primary_result, secondary_result) = tokio::join!(primary, secondary);
    primary_result?;
    secondary_result?;

    control
        .wait_for_event(|event| user_item_has_client_id(event, &primary_message))
        .await?;
    control
        .wait_for_event(|event| user_item_has_client_id(event, &secondary_message))
        .await?;
    control
        .wait_for_event(|event| event_is_turn_completed(event, primary_thread_id))
        .await?;
    control
        .wait_for_event(|event| event_is_turn_completed(event, secondary_thread_id))
        .await?;

    let primary_snapshot = refresh_thread(reconnecting, primary_thread_id).await?;
    let secondary_snapshot = refresh_thread(reconnecting, secondary_thread_id).await?;
    assert_snapshot_contains_completed_message(&primary_snapshot, &primary_message)?;
    assert_snapshot_contains_completed_message(&secondary_snapshot, &secondary_message)?;
    wait_until_catalog_contains(reconnecting, secondary_thread_id, false).await?;
    Ok(())
}

async fn stress_snapshot_live_boundary(
    observer: &UpstreamHandle,
    thread_id: &str,
    run_id: &str,
    url: &str,
    reconnecting: &mut SyncClient,
) -> TestResult {
    for iteration in 0..50 {
        reconnecting.close().await?;
        *reconnecting = SyncClient::connect(url).await?;
        let name = format!("CodeWide seam {run_id}-{iteration}");
        let refresh = refresh_thread(reconnecting, thread_id);
        let rename = observer_rpc(
            observer,
            "thread/name/set",
            json!({"threadId": thread_id, "name": name}),
        );
        let (snapshot, renamed) = tokio::join!(refresh, rename);
        let snapshot = snapshot?;
        renamed?;
        if snapshot.pointer("/thread/name").and_then(Value::as_str) != Some(&name) {
            reconnecting
                .wait_for_event(|event| thread_name_event_has_name(event, thread_id, &name))
                .await?;
        }
    }
    Ok(())
}

async fn verify_turn_pagination(observer: &UpstreamHandle, thread_id: &str) -> TestResult {
    eprintln!("stage=turn_pagination");
    let first = observer_rpc(
        observer,
        "thread/turns/list",
        json!({
            "threadId": thread_id,
            "cursor": null,
            "limit": 1,
            "sortDirection": "desc",
            "itemsView": "full",
        }),
    )
    .await?;
    let first_result = first.get("result").ok_or("first turn page is missing")?;
    let first_id = first_result
        .pointer("/data/0/id")
        .and_then(Value::as_str)
        .ok_or("first turn page is empty")?;
    let next_cursor = first_result
        .get("nextCursor")
        .and_then(Value::as_str)
        .ok_or("descending turn page omitted nextCursor")?;
    let backwards_cursor = first_result
        .get("backwardsCursor")
        .and_then(Value::as_str)
        .ok_or("descending turn page omitted backwardsCursor")?;

    let older = observer_rpc(
        observer,
        "thread/turns/list",
        json!({
            "threadId": thread_id,
            "cursor": next_cursor,
            "limit": 1,
            "sortDirection": "desc",
            "itemsView": "full",
        }),
    )
    .await?;
    let older_id = older
        .pointer("/result/data/0/id")
        .and_then(Value::as_str)
        .ok_or("older turn page is empty")?;
    if older_id == first_id {
        return Err("descending turn pagination repeated the same turn".into());
    }

    let reversed = observer_rpc(
        observer,
        "thread/turns/list",
        json!({
            "threadId": thread_id,
            "cursor": backwards_cursor,
            "limit": 1,
            "sortDirection": "asc",
            "itemsView": "full",
        }),
    )
    .await?;
    if reversed
        .pointer("/result/data/0/id")
        .and_then(Value::as_str)
        != Some(first_id)
    {
        return Err("backwardsCursor did not preserve its anchor turn".into());
    }

    let invalid = observer
        .request(json!({
            "method": "thread/turns/list",
            "params": {
                "threadId": thread_id,
                "cursor": "definitely-not-a-turn-cursor",
                "limit": 1,
                "sortDirection": "desc",
            },
        }))
        .await?;
    if invalid.get("error").is_none() {
        return Err("invalid turn pagination cursor was silently accepted".into());
    }
    Ok(())
}

async fn wait_for_upstream_event(
    events: &mut broadcast::Receiver<Value>,
    predicate: impl Fn(&Value) -> bool,
) -> TestResult<Value> {
    timeout(LIVE_TIMEOUT, async {
        loop {
            match events.recv().await {
                Ok(event) if predicate(&event) => return Ok(event),
                Ok(_) | Err(broadcast::error::RecvError::Lagged(_)) => {}
                Err(broadcast::error::RecvError::Closed) => {
                    return Err("Observer event stream closed".into());
                }
            }
        }
    })
    .await?
}

async fn create_test_thread(observer: &UpstreamHandle, name: &str) -> TestResult<String> {
    let response = observer_rpc(
        observer,
        "thread/start",
        json!({
            "cwd": std::env::current_dir()?.to_string_lossy(),
            "approvalPolicy": "never",
            "sandbox": "read-only",
            "baseInstructions": "You are a transport contract test. Reply exactly with the token requested by the user. Do not call tools.",
            "developerInstructions": "Return only the requested token and no other text.",
        }),
    )
    .await?;
    let thread_id = response
        .pointer("/result/thread/id")
        .and_then(Value::as_str)
        .ok_or("thread/start did not return a thread id")?
        .to_owned();
    observer_rpc(
        observer,
        "thread/name/set",
        json!({"threadId": thread_id, "name": name}),
    )
    .await?;
    Ok(thread_id)
}

async fn start_turn(observer: &UpstreamHandle, thread_id: &str, token: &str) -> TestResult {
    observer_rpc(
        observer,
        "turn/start",
        json!({
            "threadId": thread_id,
            "clientUserMessageId": token,
            "input": [{
                "type": "text",
                "text": format!("Reply exactly with {token}"),
                "text_elements": [],
            }],
            "effort": "low",
        }),
    )
    .await?;
    Ok(())
}

async fn observer_rpc(observer: &UpstreamHandle, method: &str, params: Value) -> TestResult<Value> {
    let response = timeout(
        LIVE_TIMEOUT,
        observer.request(json!({"method": method, "params": params})),
    )
    .await??;
    if let Some(error) = response.get("error") {
        return Err(format!("{method} failed: {error}").into());
    }
    Ok(response)
}

async fn refresh_thread(client: &mut SyncClient, thread_id: &str) -> TestResult<Value> {
    let response = client
        .rpc(
            "refresh-thread",
            "companion/thread/sync",
            json!({
                "threadId": thread_id,
                "afterTurnId": null,
                "limit": 36,
            }),
        )
        .await?;
    Ok(require_rpc_result(&response)?.clone())
}

async fn wait_until_catalog_contains(
    client: &mut SyncClient,
    thread_id: &str,
    archived: bool,
) -> TestResult {
    timeout(Duration::from_secs(20), async {
        loop {
            let response = client
                .rpc(
                    "catalog-refresh",
                    "thread/list",
                    json!({
                        "limit": 100,
                        "sortKey": "updated_at",
                        "sortDirection": "desc",
                        "archived": archived,
                        "useStateDbOnly": true,
                    }),
                )
                .await?;
            let result = require_rpc_result(&response)?;
            if result["data"]
                .as_array()
                .is_some_and(|threads| threads.iter().any(|thread| thread["id"] == thread_id))
            {
                return Ok::<_, Box<dyn Error>>(());
            }
            sleep(Duration::from_millis(100)).await;
        }
    })
    .await?
}

fn assert_snapshot_contains_completed_message(snapshot: &Value, client_id: &str) -> TestResult {
    if !value_contains_string(snapshot, client_id) {
        return Err(format!("authoritative snapshot omitted {client_id}").into());
    }
    let turns = snapshot
        .pointer("/history/turns")
        .and_then(Value::as_array)
        .ok_or("authoritative sync omitted history.turns")?;
    if !turns
        .iter()
        .any(|turn| turn["status"] == "completed" && value_contains_string(turn, client_id))
    {
        return Err(format!("message {client_id} was not in a completed turn").into());
    }
    Ok(())
}

fn normalized_turns(snapshot: &Value) -> TestResult<Value> {
    snapshot
        .pointer("/history/turns")
        .cloned()
        .ok_or_else(|| "authoritative snapshot omitted turns".into())
}

fn value_contains_string(value: &Value, needle: &str) -> bool {
    match value {
        Value::String(text) => text.contains(needle),
        Value::Array(values) => values
            .iter()
            .any(|value| value_contains_string(value, needle)),
        Value::Object(values) => values
            .values()
            .any(|value| value_contains_string(value, needle)),
        Value::Null | Value::Bool(_) | Value::Number(_) => false,
    }
}

fn count_page_user_items_with_client_id(snapshot: &Value, client_id: &str) -> TestResult<usize> {
    let turns = snapshot
        .pointer("/history/turns")
        .and_then(Value::as_array)
        .ok_or("authoritative sync omitted history.turns")?;
    Ok(turns
        .iter()
        .filter_map(|turn| turn.get("items").and_then(Value::as_array))
        .flatten()
        .filter(|item| {
            item.get("type").and_then(Value::as_str) == Some("userMessage")
                && item.get("clientId").and_then(Value::as_str) == Some(client_id)
        })
        .count())
}

fn user_item_has_client_id(event: &Value, client_id: &str) -> bool {
    event.pointer("/payload/method").and_then(Value::as_str) == Some("item/completed")
        && event
            .pointer("/payload/params/item/type")
            .and_then(Value::as_str)
            == Some("userMessage")
        && event
            .pointer("/payload/params/item/clientId")
            .and_then(Value::as_str)
            == Some(client_id)
}

fn event_is_turn_completed(event: &Value, thread_id: &str) -> bool {
    event.pointer("/payload/method").and_then(Value::as_str) == Some("turn/completed")
        && event
            .pointer("/payload/params/threadId")
            .and_then(Value::as_str)
            == Some(thread_id)
}

fn thread_name_event_has_name(event: &Value, thread_id: &str, name: &str) -> bool {
    event.pointer("/payload/method").and_then(Value::as_str) == Some("thread/name/updated")
        && event
            .pointer("/payload/params/threadId")
            .and_then(Value::as_str)
            == Some(thread_id)
        && value_contains_string(
            event.pointer("/payload/params").unwrap_or(&Value::Null),
            name,
        )
}

fn upstream_event_is_turn_completed(event: &Value, thread_id: &str) -> bool {
    event.get("method").and_then(Value::as_str) == Some("turn/completed")
        && event.pointer("/params/threadId").and_then(Value::as_str) == Some(thread_id)
}

fn require_rpc_result(response: &Value) -> TestResult<&Value> {
    if let Some(error) = response.pointer("/response/error") {
        return Err(format!("sync RPC failed: {error}").into());
    }
    response
        .pointer("/response/result")
        .ok_or_else(|| format!("sync RPC result missing: {response}").into())
}

struct SyncClient {
    socket: ClientSocket,
    pending: VecDeque<Value>,
}

impl SyncClient {
    async fn connect(url: &str) -> TestResult<Self> {
        let mut request = url.into_client_request()?;
        request.headers_mut().insert(
            "authorization",
            HeaderValue::from_str(&format!("Bearer {TOKEN}"))?,
        );
        let (socket, _) = connect_async(request).await?;
        let mut client = Self {
            socket,
            pending: VecDeque::new(),
        };
        client
            .send(&json!({"type": "hello", "protocolVersion": 1, "cursor": null}))
            .await?;
        let hello = client.receive_type("hello").await?;
        if hello["snapshotRequired"] != true {
            return Err(format!("fresh connection did not require a snapshot: {hello}").into());
        }
        client.receive_type("status").await?;
        client
            .send(&json!({"type": "snapshotApplied", "cursor": hello["headCursor"]}))
            .await?;
        let ready = client.receive_type("hello").await?;
        if ready["snapshotRequired"] != false {
            return Err(format!("snapshot handshake did not settle: {ready}").into());
        }
        client.receive_type("caughtUp").await?;
        Ok(client)
    }

    async fn rpc(&mut self, id: &str, method: &str, params: Value) -> TestResult<Value> {
        self.send(&json!({
            "type": "rpc",
            "request": {"id": id, "method": method, "params": params},
        }))
        .await?;
        timeout(LIVE_TIMEOUT, async {
            loop {
                let value = self.receive().await?;
                if value["type"] == "rpc" && value["response"]["id"] == id {
                    return Ok(value);
                }
                self.pending.push_back(value);
            }
        })
        .await?
    }

    async fn wait_for_event(&mut self, predicate: impl Fn(&Value) -> bool) -> TestResult<Value> {
        if let Some(index) = self.pending.iter().position(&predicate) {
            return self
                .pending
                .remove(index)
                .ok_or_else(|| "pending event disappeared".into());
        }
        timeout(LIVE_TIMEOUT, async {
            loop {
                let value = self.receive().await?;
                if value["type"] == "event" && predicate(&value) {
                    return Ok(value);
                }
                self.pending.push_back(value);
            }
        })
        .await?
    }

    async fn receive_type(&mut self, expected: &str) -> TestResult<Value> {
        if let Some(index) = self
            .pending
            .iter()
            .position(|value| value["type"] == expected)
        {
            return self
                .pending
                .remove(index)
                .ok_or_else(|| "pending frame disappeared".into());
        }
        timeout(LIVE_TIMEOUT, async {
            loop {
                let value = self.receive().await?;
                if value["type"] == expected {
                    return Ok(value);
                }
                self.pending.push_back(value);
            }
        })
        .await?
    }

    async fn receive(&mut self) -> TestResult<Value> {
        loop {
            let frame = self.socket.next().await.ok_or("WebSocket closed")??;
            match frame {
                Message::Text(raw) => return Ok(serde_json::from_str(&raw)?),
                Message::Ping(bytes) => self.socket.send(Message::Pong(bytes)).await?,
                Message::Close(frame) => {
                    return Err(format!("WebSocket closed: {frame:?}").into());
                }
                Message::Binary(_) | Message::Pong(_) | Message::Frame(_) => {}
            }
        }
    }

    async fn send(&mut self, value: &Value) -> TestResult {
        self.socket
            .send(Message::Text(value.to_string().into()))
            .await?;
        Ok(())
    }

    async fn close(&mut self) -> TestResult {
        self.socket.close(None).await?;
        Ok(())
    }
}

async fn start_server(
    store: Arc<IndexStore>,
    sync: SyncHub,
) -> TestResult<(std::net::SocketAddr, JoinHandle<()>)> {
    let listener = TcpListener::bind("127.0.0.1:0").await?;
    let address = listener.local_addr()?;
    let app = server::router(store, Arc::from(TOKEN), sync);
    let task = tokio::spawn(async move {
        let _ = axum::serve(listener, app).await;
    });
    Ok((address, task))
}

async fn wait_for_live(upstream: &UpstreamHandle) -> TestResult {
    wait_for_status(upstream, ConnectionStatus::Live).await
}

async fn wait_for_status(upstream: &UpstreamHandle, expected: ConnectionStatus) -> TestResult {
    let mut status = upstream.subscribe_status();
    timeout(Duration::from_secs(10), async {
        loop {
            if *status.borrow() == expected {
                return Ok::<_, Box<dyn Error>>(());
            }
            status
                .changed()
                .await
                .map_err(|_| "status channel closed")?;
        }
    })
    .await?
}

async fn wait_for_generation(upstream: &UpstreamHandle, previous: u64) -> TestResult {
    let mut status = upstream.subscribe_status();
    timeout(Duration::from_secs(30), async {
        loop {
            if *status.borrow() == ConnectionStatus::Live && upstream.generation() > previous {
                return Ok::<_, Box<dyn Error>>(());
            }
            status
                .changed()
                .await
                .map_err(|_| "status channel closed")?;
        }
    })
    .await?
}

struct ManagedSocketRelay {
    path: PathBuf,
    available: watch::Sender<bool>,
    task: JoinHandle<()>,
}

impl ManagedSocketRelay {
    fn start(path: PathBuf, target: PathBuf) -> TestResult<Self> {
        let listener = UnixListener::bind(&path)?;
        let (available, mut availability) = watch::channel(true);
        let task = tokio::spawn(async move {
            loop {
                while !*availability.borrow() {
                    if availability.changed().await.is_err() {
                        return;
                    }
                }
                let Ok((mut downstream, _)) = listener.accept().await else {
                    return;
                };
                if !*availability.borrow() {
                    continue;
                }
                let Ok(mut upstream) = UnixStream::connect(&target).await else {
                    continue;
                };
                loop {
                    tokio::select! {
                        _ = copy_bidirectional(&mut downstream, &mut upstream) => break,
                        changed = availability.changed() => {
                            if changed.is_err() || !*availability.borrow() {
                                break;
                            }
                        }
                    }
                }
            }
        });
        Ok(Self {
            path,
            available,
            task,
        })
    }

    fn path(&self) -> &Path {
        &self.path
    }

    fn pause(&self) {
        let _ = self.available.send(false);
    }

    fn resume(&self) {
        let _ = self.available.send(true);
    }
}

impl Drop for ManagedSocketRelay {
    fn drop(&mut self) {
        self.task.abort();
    }
}

fn require_live_opt_in() -> TestResult {
    if std::env::var("CODEWIDE_LIVE_E2E").as_deref() != Ok("1") {
        return Err("set CODEWIDE_LIVE_E2E=1 to run the real-account contract test".into());
    }
    Ok(())
}

fn managed_app_server_socket() -> TestResult<PathBuf> {
    let codex_home = std::env::var_os("CODEX_HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|home| Path::new(&home).join(".codex")))
        .ok_or("CODEX_HOME and HOME are unavailable")?;
    let path = codex_home.join("app-server-control/app-server-control.sock");
    if !path.exists() {
        return Err(format!("managed App Server socket is missing: {}", path.display()).into());
    }
    Ok(path)
}

fn unique_run_id() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .to_string()
}
