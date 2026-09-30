//! Loopback-only peer for exercising the real `pair` terminal in development.
use codewide_relay::{Result, adapter::Adapter, enrollment_client::EnrollmentClient};
use std::{io::Write, net::SocketAddr, sync::Arc};
use tokio_util::sync::CancellationToken;

#[tokio::main]
async fn main() -> Result<()> {
    let address: SocketAddr = std::env::args()
        .nth(1)
        .ok_or("Pass a loopback Relay IP:port")?
        .parse()?;
    if !address.ip().is_loopback() {
        return Err("This smoke peer only connects to a local test Relay".into());
    }
    let mut client = EnrollmentClient::connect(&address.to_string(), "CLI test Mac").await?;
    println!("code={}", serde_json::to_string(&client.code)?);
    std::io::stdout().flush()?;
    let credentials = client.credentials().await?;
    let target = "127.0.0.1:9".parse()?;
    let adapter = Adapter {
        companion_url: Arc::from(format!("wss://{address}")),
        relay_tls_pin_sha256: Arc::from(client.pin.clone()),
        route_id: Arc::from(credentials.route_id),
        access_token: Arc::from(credentials.access_token),
        device_target: target,
        pairing_target: target,
    };
    let stop = CancellationToken::new();
    let worker_stop = stop.clone();
    let task = tokio::spawn(async move { adapter.run(worker_stop).await });
    client.complete().await?;
    println!("connected");
    stop.cancel();
    task.await??;
    Ok(())
}
