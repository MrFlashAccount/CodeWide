//! A single TLS channel used only for terminal-confirmed enrollment.
use crate::{
    Result, denied,
    enrollment::{
        ChannelBinding, ClientMessage, ENDPOINT, EXPORTER_LABEL, ServerMessage, WIRE_VERSION,
        verification,
    },
    pairing::PairResponse,
    registry::validate_label,
    transport_tls::{certificate_pin, enrollment_client_config},
};
use futures_util::{SinkExt, StreamExt};
use std::time::Duration;
use tokio::{net::TcpStream, time::Instant};
use tokio_rustls::{TlsConnector, client::TlsStream};
use tokio_tungstenite::{
    WebSocketStream,
    tungstenite::{Message, protocol::WebSocketConfig},
};

pub struct EnrollmentClient {
    socket: WebSocketStream<TlsStream<TcpStream>>,
    pub code: String,
    pub pin: String,
    pub deadline: Instant,
}

impl EnrollmentClient {
    /// Starts a new channel and locally computes the code the user must compare.
    /// # Errors
    /// Rejects invalid input, unsupported servers, and closed enrollment windows.
    pub async fn connect(address: &str, label: &str) -> Result<Self> {
        validate_label(label)?;
        tokio::time::timeout(Duration::from_secs(10), Self::connect_inner(address, label)).await?
    }

    async fn connect_inner(address: &str, label: &str) -> Result<Self> {
        let url = reqwest::Url::parse(&format!("https://{address}"))?;
        if url.path() != "/"
            || url.query().is_some()
            || url.fragment().is_some()
            || !url.username().is_empty()
            || url.password().is_some()
        {
            return Err(denied());
        }
        let host = url.host_str().ok_or_else(denied)?.trim_matches(['[', ']']);
        let port = url.port_or_known_default().ok_or_else(denied)?;
        let tcp = TcpStream::connect((host, port)).await?;
        let name = rustls::pki_types::ServerName::try_from(host.to_owned())?;
        let tls = TlsConnector::from(enrollment_client_config()?)
            .connect(name, tcp)
            .await?;
        let connection = tls.get_ref().1;
        let binding = connection.export_keying_material([0_u8; 32], EXPORTER_LABEL, Some(&[]))?;
        let cert = connection
            .peer_certificates()
            .and_then(|certs| certs.first())
            .ok_or_else(denied)?;
        let pin = certificate_pin(cert.as_ref());
        let config = WebSocketConfig::default()
            .max_message_size(Some(4096))
            .max_frame_size(Some(4096));
        let (socket, _) = tokio_tungstenite::client_async_with_config(
            format!("wss://{address}{ENDPOINT}"),
            tls,
            Some(config),
        )
        .await?;
        let mut client = Self {
            socket,
            code: String::new(),
            pin,
            deadline: Instant::now() + Duration::from_mins(1),
        };
        let binding = ChannelBinding(binding);
        let client_nonce: [u8; 32] = rand::random();
        client
            .send(&ClientMessage::Hello {
                version: WIRE_VERSION,
                label: label.to_owned(),
                commitment: hex::encode(verification::commitment(&binding, &client_nonce)),
            })
            .await?;
        let ServerMessage::Challenge { nonce } = client.receive().await? else {
            return Err(denied());
        };
        let server_nonce = verification::decode(&nonce)?;
        client.code = verification::code(&binding, &client_nonce, &server_nonce);
        client
            .send(&ClientMessage::Reveal {
                nonce: hex::encode(client_nonce),
            })
            .await?;
        match client.receive().await? {
            ServerMessage::Confirm { remaining_seconds }
                if (1..=60).contains(&remaining_seconds) =>
            {
                // The server owns the actual deadline; this is a bounded local fallback.
                client.deadline = Instant::now() + Duration::from_secs(remaining_seconds);
                Ok(client)
            }
            _ => Err(denied()),
        }
    }

    /// Waits for terminal approval; no reusable credential is sent before it.
    /// # Errors
    /// Returns an error on cancellation, timeout, or protocol failure.
    pub async fn credentials(&mut self) -> Result<PairResponse> {
        match self.receive().await? {
            ServerMessage::Granted { credentials } => Ok(credentials),
            _ => Err(denied()),
        }
    }

    /// Confirms durable storage; the server also waits for the pinned adapter to connect.
    /// # Errors
    /// Returns an error if the enrollment was cancelled or expired.
    pub async fn complete(&mut self) -> Result<()> {
        self.send(&ClientMessage::Stored).await?;
        match self.receive().await? {
            ServerMessage::Complete => Ok(()),
            _ => Err(denied()),
        }
    }

    async fn send(&mut self, message: &ClientMessage) -> Result<()> {
        tokio::time::timeout_at(
            self.deadline,
            self.socket
                .send(Message::Text(serde_json::to_string(message)?.into())),
        )
        .await??;
        Ok(())
    }

    async fn receive(&mut self) -> Result<ServerMessage> {
        match tokio::time::timeout_at(self.deadline, self.socket.next())
            .await?
            .ok_or_else(denied)??
        {
            Message::Text(text) => Ok(serde_json::from_str(&text)?),
            _ => Err(denied()),
        }
    }
}
