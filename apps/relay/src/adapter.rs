//! Companion-owned outbound WebSocket transport to the same relay used by Android.
use crate::{
    Result, auth,
    transport_tls::pinned_client_config,
    update::{
        ApplyRelayUpdateAccepted, ApplyRelayUpdateRequest, RelayUpdateOperation, RelayUpdatePhase,
        RelayUpdateStatus,
    },
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
    Connector, MaybeTlsStream, WebSocketStream, connect_async_tls_with_config,
    tungstenite::{Message, client::IntoClientRequest, http::HeaderValue},
};
use tokio_util::sync::CancellationToken;

type RelaySocket = WebSocketStream<MaybeTlsStream<TcpStream>>;
const MAX_UPDATE_RESPONSE_BYTES: usize = 64 * 1024;
const INITIAL_RETRY_MS: u64 = 250;
const MAX_RETRY_MS: u64 = 2_000;
const RETRY_JITTER_MS: u64 = 250;

#[derive(Debug, thiserror::Error)]
#[error("{message}")]
pub struct UpdateRequestError {
    pub message: String,
}

#[derive(serde::Deserialize)]
struct UpdateErrorBody {
    message: String,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum AdapterConnectionState {
    Connecting,
    Connected,
    Reconnecting,
}

#[derive(Clone)]
pub struct Adapter {
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
        validate_companion_url(&self.companion_url)?;
        pinned_client_config(&self.relay_tls_pin_sha256)?;
        crate::registry::validate_route_id(&self.route_id)?;
        auth::validate(&self.access_token)?;
        if !self.device_target.ip().is_loopback() || !self.pairing_target.ip().is_loopback() {
            return Err(crate::denied());
        }
        let mut backoff_ms = INITIAL_RETRY_MS;
        let mut first_attempt = true;
        loop {
            let _ = status.send(if first_attempt {
                AdapterConnectionState::Connecting
            } else {
                AdapterConnectionState::Reconnecting
            });
            first_attempt = false;
            let result = tokio::select! {
                () = stop.cancelled() => return Ok(()),
                result = self.session(&status) => result,
            };
            let reached_ready = *status.borrow() == AdapterConnectionState::Connected;
            let _ = status.send(AdapterConnectionState::Reconnecting);
            if reached_ready {
                backoff_ms = INITIAL_RETRY_MS;
            }
            let delay_ms = retry_delay_ms(backoff_ms, rand::random_range(0..=RETRY_JITTER_MS));
            let delay = Duration::from_millis(delay_ms);
            let error = result.as_ref().err().map_or_else(
                || "connection closed".to_owned(),
                std::string::ToString::to_string,
            );
            eprintln!("relay_adapter connection_closed err={error} retry_ms={delay_ms}");
            tokio::select! {
                () = stop.cancelled() => return Ok(()),
                () = tokio::time::sleep(delay) => {},
            }
            backoff_ms = (backoff_ms * 2).min(MAX_RETRY_MS);
        }
    }

    async fn session(&self, status: &watch::Sender<AdapterConnectionState>) -> Result<()> {
        let mut socket = self
            .connect_control(&format!("/relay/control/{}", self.route_id))
            .await
            .map_err(|error| contextual("control_connect", error))?;
        let welcome = tokio::time::timeout(DEADLINE, socket.next())
            .await
            .map_err(|error| contextual("control_welcome_timeout", error))?
            .transpose()
            .map_err(|error| contextual("control_welcome", error))?
            .ok_or_else(|| contextual("control_welcome", "connection closed"))?;
        let Message::Text(welcome) = welcome else {
            return Err(crate::denied());
        };
        match wire::decode(&welcome)? {
            Control::Welcome { .. } => {}
            Control::Open { .. } => return Err(crate::denied()),
        }
        let _ = status.send(AdapterConnectionState::Connected);
        eprintln!("relay_adapter connected");
        let reconciliation = self.clone();
        tokio::spawn(async move {
            // The update request is independent of the carrier and must not
            // delay control-channel readiness after a Relay restart.
            let _ = reconciliation.reconcile_update().await;
        });
        let mut tasks = JoinSet::new();
        loop {
            while let Some(result) = tasks.try_join_next() {
                report_data_result(result);
            }
            let message = tokio::time::timeout(DEADLINE, socket.next()).await?;
            match message.transpose()? {
                Some(Message::Text(text)) => match wire::decode(&text)? {
                    Control::Open { ticket, target } => {
                        if tasks.len() >= wire::STREAMS
                            && let Some(result) =
                                tokio::time::timeout(DEADLINE, tasks.join_next()).await?
                        {
                            report_data_result(result);
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
        let mut local = tokio::time::timeout(DEADLINE, TcpStream::connect(target))
            .await
            .map_err(|error| contextual("local_connect_timeout", error))?
            .map_err(|error| contextual("local_connect", error))?;
        local
            .set_nodelay(true)
            .map_err(|error| contextual("local_configure", error))?;
        let relay = self
            .connect_attach(&format!("/relay/attach/{}/{ticket}", self.route_id))
            .await
            .map_err(|error| contextual("relay_attach", error))?;
        let (mut local_read, mut local_write) = tokio::io::split(&mut local);
        let (mut relay_write, mut relay_read) = relay.split();
        let upload = copy_to_websocket(&mut local_read, &mut relay_write);
        let download = copy_from_websocket(&mut relay_read, &mut local_write);
        tokio::select! {
            result = upload => result.map_err(|error| contextual("bridge_upload", error)),
            result = download => result.map_err(|error| contextual("bridge_download", error)),
        }
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
        let url = format!("{}{path}", self.companion_url.trim_end_matches('/'));
        let tls = pinned_client_config(&self.relay_tls_pin_sha256)?;
        Ok(tokio::time::timeout(
            DEADLINE,
            connect_async_tls_with_config(url, None, true, Some(Connector::Rustls(tls))),
        )
        .await??
        .0)
    }

    /// Reads the authenticated Relay Updater projection over the pinned service plane.
    ///
    /// # Errors
    ///
    /// Returns an error when the pinned request or response is invalid.
    pub async fn update_status(&self) -> Result<RelayUpdateStatus> {
        self.update_request(
            reqwest::Method::GET,
            &format!("/relay/update/{}", self.route_id),
            None,
        )
        .await
    }

    /// Refreshes signed Relay release information.
    ///
    /// # Errors
    ///
    /// Returns an error when the Relay cannot authenticate or admit the release.
    pub async fn check_update(&self) -> Result<RelayUpdateStatus> {
        self.update_request(
            reqwest::Method::POST,
            &format!("/relay/update/{}/check", self.route_id),
            Some(serde_json::Value::Null),
        )
        .await
    }

    /// Requests one durable Relay update operation.
    ///
    /// # Errors
    ///
    /// Returns an error when the Relay rejects or cannot persist the operation.
    pub async fn apply_update(
        &self,
        request: &ApplyRelayUpdateRequest,
    ) -> Result<ApplyRelayUpdateAccepted> {
        self.update_request(
            reqwest::Method::POST,
            &format!("/relay/update/{}/apply", self.route_id),
            Some(serde_json::to_value(request)?),
        )
        .await
    }

    /// Reads one durable Relay update result.
    ///
    /// # Errors
    ///
    /// Returns an error when the operation cannot be read from the Relay.
    pub async fn update_operation(&self, operation_id: &str) -> Result<RelayUpdateOperation> {
        self.update_request(
            reqwest::Method::GET,
            &format!("/relay/update/{}/operations/{operation_id}", self.route_id),
            None,
        )
        .await
    }

    /// Proves that this paired Companion route reconnected to the updated Relay.
    ///
    /// # Errors
    ///
    /// Returns an error when the authenticated reconnect proof is rejected.
    pub async fn reconnect_update(&self, operation_id: &str) -> Result<RelayUpdateOperation> {
        self.update_request(
            reqwest::Method::POST,
            &format!(
                "/relay/update/{}/operations/{operation_id}/reconnect",
                self.route_id
            ),
            Some(serde_json::Value::Null),
        )
        .await
    }

    async fn reconcile_update(&self) -> Result<()> {
        let status = self.update_status().await?;
        if let Some(operation) = status.active_operation
            && operation.phase == RelayUpdatePhase::AwaitingReconnect
        {
            self.reconnect_update(&operation.operation_id).await?;
        }
        Ok(())
    }

    async fn update_request<T: serde::de::DeserializeOwned>(
        &self,
        method: reqwest::Method,
        path: &str,
        body: Option<serde_json::Value>,
    ) -> Result<T> {
        let origin = self
            .companion_url
            .strip_prefix("wss://")
            .ok_or_else(crate::denied)?;
        let tls = pinned_client_config(&self.relay_tls_pin_sha256)?;
        let client = reqwest::Client::builder()
            .https_only(true)
            .redirect(reqwest::redirect::Policy::none())
            .connect_timeout(DEADLINE)
            .timeout(Duration::from_secs(30))
            .use_preconfigured_tls((*tls).clone())
            .build()?;
        let mut request = client
            .request(method, format!("https://{origin}{path}"))
            .bearer_auth(self.access_token.as_ref());
        if let Some(body) = body {
            request = request.json(&body);
        }
        let mut response = request.send().await?;
        let status = response.status();
        let mut bytes = Vec::new();
        while let Some(chunk) = response.chunk().await? {
            if bytes.len() + chunk.len() > MAX_UPDATE_RESPONSE_BYTES {
                return Err(std::io::Error::other("Relay update response is oversized").into());
            }
            bytes.extend_from_slice(&chunk);
        }
        if !status.is_success() {
            let message = serde_json::from_slice::<UpdateErrorBody>(&bytes)
                .ok()
                .map(|body| body.message)
                .filter(|message| !message.is_empty() && message.len() <= 320)
                .unwrap_or_else(|| format!("Relay update request failed with status {status}"));
            return Err(UpdateRequestError { message }.into());
        }
        Ok(serde_json::from_slice(&bytes)?)
    }
}

fn retry_delay_ms(backoff_ms: u64, jitter_ms: u64) -> u64 {
    backoff_ms.saturating_add(jitter_ms).min(MAX_RETRY_MS)
}

fn contextual(stage: &'static str, error: impl std::fmt::Display) -> crate::Error {
    std::io::Error::other(format!("{stage}: {error}")).into()
}

fn report_data_result(result: std::result::Result<Result<()>, tokio::task::JoinError>) {
    match result {
        Ok(Ok(())) => {}
        Ok(Err(error)) => eprintln!("relay_adapter data_closed err={error}"),
        Err(error) => eprintln!("relay_adapter data_task_failed err={error}"),
    }
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

#[cfg(test)]
mod tests {
    use super::{INITIAL_RETRY_MS, MAX_RETRY_MS, RETRY_JITTER_MS, retry_delay_ms};

    #[test]
    fn reconnect_delay_is_bounded_for_a_critical_control_channel() {
        let mut backoff_ms = INITIAL_RETRY_MS;
        let mut worst_case_total_ms = 0;
        for _ in 0..11 {
            let delay_ms = retry_delay_ms(backoff_ms, RETRY_JITTER_MS);
            assert!(delay_ms <= MAX_RETRY_MS);
            worst_case_total_ms += delay_ms;
            backoff_ms = (backoff_ms * 2).min(MAX_RETRY_MS);
        }
        assert!(worst_case_total_ms <= 19_000);
    }
}
