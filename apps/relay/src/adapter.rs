//! Companion-owned outbound WebSocket transport to the same relay used by Android.
use crate::{
    Result, auth,
    transport_tls::pinned_client_config,
    wire::{self, Control, DEADLINE, Target},
};
use futures_util::{Sink, SinkExt, Stream, StreamExt};
use std::{net::SocketAddr, sync::Arc, time::Duration};
use tokio::{
    io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt},
    net::TcpStream,
    sync::watch,
    task::JoinSet,
};
use tokio_tungstenite::{
    Connector, MaybeTlsStream, WebSocketStream, connect_async, connect_async_tls_with_config,
    tungstenite::{Message, client::IntoClientRequest, http::HeaderValue},
};
use tokio_util::sync::CancellationToken;

type RelaySocket = WebSocketStream<MaybeTlsStream<TcpStream>>;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum AdapterConnectionState {
    Connecting,
    Connected,
    Reconnecting,
}

#[derive(Clone)]
pub struct Adapter {
    pub public_url: Arc<str>,
    pub companion_url: Arc<str>,
    pub relay_tls_pin_sha256: Arc<str>,
    pub route_id: Arc<str>,
    pub access_token: Arc<str>,
    pub device_target: SocketAddr,
    pub pairing_target: SocketAddr,
}

impl Adapter {
    /// Runs until shutdown; loss of control destroys all old streams before reconnect.
    /// # Errors
    /// Rejects non-loopback targets or invalid configuration before starting.
    pub async fn run(&self, stop: CancellationToken) -> Result<()> {
        let (status, _) = watch::channel(AdapterConnectionState::Connecting);
        self.run_with_status(stop, status).await
    }

    /// Runs the adapter and publishes the control-channel connection state.
    /// # Errors
    /// Rejects non-loopback targets or invalid configuration before starting.
    pub async fn run_with_status(
        &self,
        stop: CancellationToken,
        status: watch::Sender<AdapterConnectionState>,
    ) -> Result<()> {
        validate_public_url(&self.public_url)?;
        validate_companion_url(&self.companion_url)?;
        pinned_client_config(&self.relay_tls_pin_sha256)?;
        crate::registry::validate_route_id(&self.route_id)?;
        auth::validate(&self.access_token)?;
        if !self.device_target.ip().is_loopback() || !self.pairing_target.ip().is_loopback() {
            return Err(crate::denied());
        }
        let mut backoff = 1_u64;
        let mut first_attempt = true;
        loop {
            let _ = status.send(if first_attempt {
                AdapterConnectionState::Connecting
            } else {
                AdapterConnectionState::Reconnecting
            });
            first_attempt = false;
            let started = tokio::time::Instant::now();
            tokio::select! {
                () = stop.cancelled() => return Ok(()),
                _ = self.session(&status) => {},
            }
            let _ = status.send(AdapterConnectionState::Reconnecting);
            if started.elapsed() > Duration::from_mins(1) {
                backoff = 1;
            }
            let delay = Duration::from_millis(backoff * 1000 + rand::random_range(0..1000));
            eprintln!(
                "relay_adapter connection_closed retry_ms={}",
                delay.as_millis()
            );
            tokio::select! {
                () = stop.cancelled() => return Ok(()),
                () = tokio::time::sleep(delay) => {},
            }
            backoff = (backoff * 2).min(30);
        }
    }

    async fn session(&self, status: &watch::Sender<AdapterConnectionState>) -> Result<()> {
        let mut socket = self
            .connect_control(&format!("/relay/control/{}", self.route_id))
            .await?;
        let welcome = tokio::time::timeout(DEADLINE, socket.next())
            .await?
            .transpose()?
            .ok_or_else(crate::denied)?;
        let Message::Text(welcome) = welcome else {
            return Err(crate::denied());
        };
        match wire::decode(&welcome)? {
            Control::Welcome { .. } => {}
            Control::Open { .. } => return Err(crate::denied()),
        }
        let _ = status.send(AdapterConnectionState::Connected);
        eprintln!("relay_adapter connected");
        let mut tasks = JoinSet::new();
        loop {
            while tasks.try_join_next().is_some() {}
            let message = tokio::time::timeout(DEADLINE, socket.next()).await?;
            match message.transpose()? {
                Some(Message::Text(text)) => match wire::decode(&text)? {
                    Control::Open { ticket, target } => {
                        if tasks.len() >= wire::STREAMS {
                            let _ = tokio::time::timeout(DEADLINE, tasks.join_next()).await?;
                        }
                        if tasks.len() >= wire::STREAMS {
                            continue;
                        }
                        let adapter = self.clone();
                        tasks.spawn(async move { adapter.data(ticket, target).await });
                    }
                    Control::Welcome { .. } => return Err(crate::denied()),
                },
                Some(Message::Ping(bytes)) => socket.send(Message::Pong(bytes)).await?,
                Some(Message::Pong(_)) => {}
                Some(Message::Close(_) | Message::Binary(_) | Message::Frame(_)) | None => {
                    return Err(crate::denied());
                }
            }
        }
    }

    async fn data(&self, ticket: String, target: Target) -> Result<()> {
        let target = match target {
            Target::Device => self.device_target,
            Target::Pairing => self.pairing_target,
        };
        let mut local = tokio::time::timeout(DEADLINE, TcpStream::connect(target)).await??;
        local.set_nodelay(true)?;
        let relay = self
            .connect_attach(&format!("/relay/attach/{}/{ticket}", self.route_id))
            .await?;
        let (mut local_read, mut local_write) = tokio::io::split(&mut local);
        let (mut relay_write, mut relay_read) = relay.split();
        let upload = copy_to_websocket(&mut local_read, &mut relay_write);
        let download = copy_from_websocket(&mut relay_read, &mut local_write);
        tokio::select! { result = upload => result, result = download => result }
    }

    async fn connect_control(&self, path: &str) -> Result<RelaySocket> {
        let url = format!("{}{path}", self.companion_url.trim_end_matches('/'));
        let mut request = url.into_client_request()?;
        request.headers_mut().insert(
            "authorization",
            HeaderValue::from_str(&format!("Bearer {}", self.access_token))?,
        );
        let tls = pinned_client_config(&self.relay_tls_pin_sha256)?;
        Ok(tokio::time::timeout(
            DEADLINE,
            connect_async_tls_with_config(request, None, true, Some(Connector::Rustls(tls))),
        )
        .await??
        .0)
    }

    async fn connect_attach(&self, path: &str) -> Result<RelaySocket> {
        let url = format!("{}{path}", self.public_url.trim_end_matches('/'));
        Ok(tokio::time::timeout(DEADLINE, connect_async(url)).await??.0)
    }
}

fn validate_public_url(value: &str) -> Result<()> {
    let uri: tokio_tungstenite::tungstenite::http::Uri = value.parse()?;
    if !matches!(uri.scheme_str(), Some("ws" | "wss"))
        || uri.authority().is_none()
        || !matches!(uri.path(), "" | "/")
        || uri.query().is_some()
    {
        return Err(
            std::io::Error::other("Relay public URL must be a ws:// or wss:// origin").into(),
        );
    }
    Ok(())
}

fn validate_companion_url(value: &str) -> Result<()> {
    let uri: tokio_tungstenite::tungstenite::http::Uri = value.parse()?;
    if uri.scheme_str() != Some("wss")
        || uri.authority().is_none()
        || !matches!(uri.path(), "" | "/")
        || uri.query().is_some()
    {
        return Err(std::io::Error::other("Relay Companion URL must be a wss:// origin").into());
    }
    Ok(())
}

async fn copy_to_websocket(
    reader: &mut (impl AsyncRead + Unpin),
    writer: &mut (impl Sink<Message, Error = tokio_tungstenite::tungstenite::Error> + Unpin),
) -> Result<()> {
    let mut bytes = vec![0; 16 * 1024];
    loop {
        let length = reader.read(&mut bytes).await?;
        if length == 0 {
            writer.send(Message::Close(None)).await?;
            return Ok(());
        }
        tokio::time::timeout(
            DEADLINE,
            writer.send(Message::Binary(bytes[..length].to_vec().into())),
        )
        .await??;
    }
}

async fn copy_from_websocket(
    reader: &mut (
             impl Stream<Item = std::result::Result<Message, tokio_tungstenite::tungstenite::Error>>
             + Unpin
         ),
    writer: &mut (impl AsyncWrite + Unpin),
) -> Result<()> {
    while let Some(message) = tokio::time::timeout(Duration::from_mins(1), reader.next()).await? {
        match message? {
            Message::Binary(bytes) => {
                tokio::time::timeout(DEADLINE, writer.write_all(&bytes)).await??;
            }
            Message::Close(_) => break,
            Message::Ping(_) | Message::Pong(_) => {}
            Message::Text(_) | Message::Frame(_) => return Err(crate::denied()),
        }
    }
    writer.shutdown().await?;
    Ok(())
}
