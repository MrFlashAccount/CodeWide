//! Read-only live timing probe. Prints sizes and timings, never response content.

use std::{error::Error, time::Instant};

use codewide_companion::content::{ContentProjector, PrivateContentService};
use futures_util::{SinkExt, StreamExt};
use serde_json::{Value, json};
use tokio::net::UnixStream;
use tokio_tungstenite::{WebSocketStream, client_async, tungstenite::Message};

type ProbeError = Box<dyn Error + Send + Sync>;

async fn request(
    socket: &mut WebSocketStream<UnixStream>,
    method: &str,
    params: Value,
) -> Result<Value, ProbeError> {
    let started = Instant::now();
    let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(45);
    socket
        .send(Message::Text(
            json!({"id":"probe", "method":method, "params":params})
                .to_string()
                .into(),
        ))
        .await?;
    let sent_ms = started.elapsed().as_secs_f64() * 1000.0;
    loop {
        let frame = tokio::time::timeout_at(deadline, socket.next())
            .await?
            .ok_or("socket closed")??;
        let Message::Text(text) = frame else { continue };
        let received_ms = started.elapsed().as_secs_f64() * 1000.0;
        let decode = Instant::now();
        let mut value: Value = serde_json::from_str(&text)?;
        let decode_ms = decode.elapsed().as_secs_f64() * 1000.0;
        if value.get("id").and_then(Value::as_str) != Some("probe") {
            continue;
        }
        println!(
            "{}",
            json!({"phase":"upstream", "method":method, "view":params.get("itemsView"), "limit":params.get("limit"), "write_ms":sent_ms, "response_received_ms":received_ms, "decode_ms":decode_ms, "bytes":text.len(), "error_code":value.pointer("/error/code")})
        );
        if value.get("error").is_some() {
            return Err("RPC failed (response content omitted)".into());
        }
        return Ok(value.get_mut("result").ok_or("missing result")?.take());
    }
}

#[tokio::main]
async fn main() -> Result<(), ProbeError> {
    let mut args = std::env::args().skip(1);
    let socket_path = args.next().ok_or("expected socket path and thread id")?;
    let thread_id = args.next().ok_or("expected thread id")?;
    let limit: u64 = args.next().unwrap_or_else(|| "1".to_owned()).parse()?;
    let stream = UnixStream::connect(socket_path).await?;
    let (mut socket, _) = client_async("ws://localhost/", stream).await?;
    request(&mut socket, "initialize", json!({"clientInfo":{"name":"codewide_read_probe","version":"1"},"capabilities":{"experimentalApi":true}})).await?;
    socket
        .send(Message::Text(
            json!({"method":"initialized"}).to_string().into(),
        ))
        .await?;
    let directory = tempfile::tempdir()?;
    let projector =
        ContentProjector::new(PrivateContentService::open(directory.path().to_path_buf()));
    for iteration in 0..3 {
        request(
            &mut socket,
            "thread/read",
            json!({"threadId":thread_id,"includeTurns":false}),
        )
        .await?;
        for view in ["full", "summary"] {
            let result = request(&mut socket, "thread/turns/list", json!({"threadId":thread_id,"limit":limit,"cursor":null,"sortDirection":"desc","itemsView":view})).await?;
            let encoded = serde_json::to_vec(&result)?;
            let started = Instant::now();
            let parsed: Value = serde_json::from_slice(&encoded)?;
            let decode_ms = started.elapsed().as_secs_f64() * 1000.0;
            let started = Instant::now();
            let projected = projector.project_rpc_result("thread/turns/list", parsed);
            let projection_ms = started.elapsed().as_secs_f64() * 1000.0;
            let started = Instant::now();
            let output = serde_json::to_vec(&projected)?;
            let encode_ms = started.elapsed().as_secs_f64() * 1000.0;
            println!(
                "{}",
                json!({"phase":"processing", "iteration":iteration,"view":view,"turns":result.get("data").and_then(Value::as_array).map(Vec::len),"input_bytes":encoded.len(),"output_bytes":output.len(),"decode_ms":decode_ms,"projection_ms":projection_ms,"encode_ms":encode_ms})
            );
        }
    }
    socket.close(None).await?;
    Ok(())
}
