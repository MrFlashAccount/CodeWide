//! Multi-tenant rendezvous for opaque inner-TLS WebSocket streams.
use crate::{
    Result, auth,
    pairing::{PairRequest, PairResponse},
    registry::{AuthorizedSession, Registry, validate_route_id},
    wire::{self, Control, DEADLINE, Target},
};
use axum::{
    Json, Router,
    extract::{
        DefaultBodyLimit, Path, State,
        ws::{Message, WebSocket, WebSocketUpgrade},
    },
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use futures_util::{SinkExt, StreamExt};
use hyper::server::conn::http1;
use hyper_util::{rt::TokioIo, service::TowerToHyperService};
use std::{
    collections::HashMap,
    net::SocketAddr,
    sync::{Arc, Mutex},
    time::Duration,
};
use tokio::{
    net::{TcpListener, TcpStream},
    sync::{OwnedSemaphorePermit, Semaphore, mpsc, oneshot},
    task::JoinSet,
};
use tokio_rustls::TlsAcceptor;
use tokio_util::sync::CancellationToken;

const ACCEPTED_CONNECTIONS: usize = 512;

struct Upstream {
    connection_id: String,
    opens: mpsc::Sender<Control>,
    cancel: CancellationToken,
    capacity: Arc<Semaphore>,
}

struct Pending {
    route_id: String,
    upstream: oneshot::Sender<WebSocket>,
}

struct Inner {
    registry: Registry,
    upstreams: Mutex<HashMap<String, Upstream>>,
    pending: Mutex<HashMap<String, Pending>>,
    capacity: Arc<Semaphore>,
    shutdown: CancellationToken,
}

#[derive(Clone)]
pub struct Relay(Arc<Inner>);

impl Relay {
    /// Creates a bounded relay that can host independent Companion routes.
    #[must_use]
    pub fn new(registry: Registry) -> Self {
        Self(Arc::new(Inner {
            registry,
            upstreams: Mutex::new(HashMap::new()),
            pending: Mutex::new(HashMap::new()),
            capacity: Arc::new(Semaphore::new(512)),
            shutdown: CancellationToken::new(),
        }))
    }

    /// Routes reachable by phones. This surface never accepts Relay credentials.
    pub fn public_router(&self) -> Router {
        Router::new()
            .route("/c/{route_id}/v1/e2ee-tunnel", get(device))
            .route("/c/{route_id}/v1/e2ee-bootstrap-tunnel", get(pairing))
            .route("/relay/attach/{route_id}/{ticket}", get(attach))
            .layer(DefaultBodyLimit::max(4096))
            .with_state(self.clone())
    }

    /// Routes reachable only through the built-in pinned TLS service plane.
    pub fn companion_router(&self) -> Router {
        Router::new()
            .route("/healthz", get(health))
            .route("/readyz", get(ready))
            .route("/relay/pair/{route_id}", post(pair))
            .route("/relay/control/{route_id}", get(control))
            .layer(DefaultBodyLimit::max(4096))
            .with_state(self.clone())
    }

    fn authenticate(&self, route_id: &str, headers: &HeaderMap) -> Result<AuthorizedSession> {
        self.0.registry.authorize(route_id, auth::bearer(headers)?)
    }

    async fn control(
        &self,
        socket: WebSocket,
        permit: OwnedSemaphorePermit,
        session: AuthorizedSession,
    ) -> Result<()> {
        let (sender, mut receiver) = mpsc::channel(wire::STREAMS);
        let cancel = CancellationToken::new();
        let connection_id = wire::nonce();
        let replaced = {
            let mut upstreams = self.0.upstreams.lock().map_err(|_| crate::denied())?;
            upstreams.insert(
                session.route_id.clone(),
                Upstream {
                    connection_id: connection_id.clone(),
                    opens: sender,
                    cancel: cancel.clone(),
                    capacity: Arc::new(Semaphore::new(wire::STREAMS)),
                },
            )
        };
        if let Some(replaced) = replaced {
            replaced.cancel.cancel();
        }
        let _guard = UpstreamGuard {
            relay: self.clone(),
            route_id: session.route_id.clone(),
            connection_id,
            cancel: cancel.clone(),
        };
        let _permit = permit;
        let (mut writer, mut reader) = socket.split();
        tokio::time::timeout(
            DEADLINE,
            writer.send(Message::Text(
                wire::encode(&Control::Welcome {
                    generation: session.generation,
                })?
                .into(),
            )),
        )
        .await??;
        let mut heartbeat = tokio::time::interval(Duration::from_secs(5));
        loop {
            tokio::select! {
                () = self.0.shutdown.cancelled() => return Ok(()),
                () = cancel.cancelled() => return Ok(()),
                _ = heartbeat.tick() => {
                    if !self.0.registry.is_current(
                        &session.route_id,
                        &session.access_token,
                        session.generation,
                    )? {
                        return Ok(());
                    }
                    tokio::time::timeout(
                        DEADLINE,
                        writer.send(Message::Ping(Vec::new().into())),
                    ).await??;
                }
                command = receiver.recv() => {
                    let command = command.ok_or_else(crate::denied)?;
                    tokio::time::timeout(
                        DEADLINE,
                        writer.send(Message::Text(wire::encode(&command)?.into())),
                    ).await??;
                }
                message = reader.next() => match message.transpose()? {
                    Some(Message::Ping(bytes)) => writer.send(Message::Pong(bytes)).await?,
                    Some(Message::Pong(_)) => {},
                    Some(Message::Close(_)) | None => return Ok(()),
                    Some(Message::Text(_) | Message::Binary(_)) => return Err(crate::denied()),
                }
            }
        }
    }

    fn open(&self, route_id: &str, target: Target, upgrade: WebSocketUpgrade) -> Result<Response> {
        validate_route_id(route_id)?;
        if self.0.shutdown.is_cancelled() {
            return Err(crate::denied());
        }
        let global = self.0.capacity.clone().try_acquire_owned()?;
        let ticket = wire::nonce();
        let (sender, receiver) = oneshot::channel();
        let (permit, cancel) = {
            let upstreams = self.0.upstreams.lock().map_err(|_| crate::denied())?;
            let active = upstreams.get(route_id).ok_or_else(crate::denied)?;
            let permit = active.capacity.clone().try_acquire_owned()?;
            self.0.pending.lock().map_err(|_| crate::denied())?.insert(
                ticket.clone(),
                Pending {
                    route_id: route_id.to_owned(),
                    upstream: sender,
                },
            );
            if active
                .opens
                .try_send(Control::Open {
                    ticket: ticket.clone(),
                    target,
                })
                .is_err()
            {
                self.remove_pending(&ticket);
                return Err(crate::denied());
            }
            (permit, active.cancel.clone())
        };
        let relay = self.clone();
        Ok(upgrade
            .max_message_size(wire::FRAME_BYTES)
            .max_frame_size(wire::FRAME_BYTES)
            .write_buffer_size(0)
            .max_write_buffer_size(wire::FRAME_BYTES * 2)
            .on_upgrade(move |phone| async move {
                let _guard = PendingGuard {
                    relay: relay.clone(),
                    ticket,
                };
                let _permits = (global, permit);
                let upstream = tokio::select! {
                    () = relay.0.shutdown.cancelled() => return,
                    () = cancel.cancelled() => return,
                    stream = tokio::time::timeout(DEADLINE, receiver) => match stream {
                        Ok(Ok(stream)) => stream,
                        _ => return,
                    },
                };
                tokio::select! {
                    () = relay.0.shutdown.cancelled() => {},
                    () = cancel.cancelled() => {},
                    _ = bridge(phone, upstream) => {},
                }
            }))
    }

    fn attach(&self, route_id: &str, ticket: &str) -> Result<oneshot::Sender<WebSocket>> {
        let mut pending = self.0.pending.lock().map_err(|_| crate::denied())?;
        if pending
            .get(ticket)
            .is_none_or(|pending| pending.route_id != route_id)
        {
            return Err(crate::denied());
        }
        Ok(pending.remove(ticket).ok_or_else(crate::denied)?.upstream)
    }

    fn remove_pending(&self, ticket: &str) {
        if let Ok(mut pending) = self.0.pending.lock() {
            pending.remove(ticket);
        }
    }

    fn ready(&self) -> bool {
        !self.0.shutdown.is_cancelled()
            && self
                .0
                .upstreams
                .lock()
                .is_ok_and(|upstreams| !upstreams.is_empty())
    }

    fn shutdown(&self) {
        self.0.shutdown.cancel();
    }

    fn pair(&self, route_id: &str, request: &PairRequest) -> Result<PairResponse> {
        let response = self.0.registry.pair(route_id, &request.invitation)?;
        self.cancel_route(route_id);
        Ok(response)
    }

    fn cancel_route(&self, route_id: &str) {
        if let Ok(upstreams) = self.0.upstreams.lock()
            && let Some(active) = upstreams.get(route_id)
        {
            active.cancel.cancel();
        }
    }
}

struct UpstreamGuard {
    relay: Relay,
    route_id: String,
    connection_id: String,
    cancel: CancellationToken,
}

impl Drop for UpstreamGuard {
    fn drop(&mut self) {
        self.cancel.cancel();
        if let Ok(mut upstreams) = self.relay.0.upstreams.lock()
            && upstreams
                .get(&self.route_id)
                .is_some_and(|active| active.connection_id == self.connection_id)
        {
            upstreams.remove(&self.route_id);
        }
    }
}

struct PendingGuard {
    relay: Relay,
    ticket: String,
}

impl Drop for PendingGuard {
    fn drop(&mut self) {
        self.relay.remove_pending(&self.ticket);
    }
}

async fn health() -> StatusCode {
    StatusCode::NO_CONTENT
}

async fn ready(State(relay): State<Relay>) -> StatusCode {
    if relay.ready() {
        StatusCode::NO_CONTENT
    } else {
        StatusCode::SERVICE_UNAVAILABLE
    }
}

async fn device(
    State(relay): State<Relay>,
    Path(route_id): Path<String>,
    upgrade: WebSocketUpgrade,
) -> Response {
    forward(&relay, &route_id, upgrade, Target::Device)
}

async fn pairing(
    State(relay): State<Relay>,
    Path(route_id): Path<String>,
    upgrade: WebSocketUpgrade,
) -> Response {
    forward(&relay, &route_id, upgrade, Target::Pairing)
}

async fn pair(
    State(relay): State<Relay>,
    Path(route_id): Path<String>,
    Json(request): Json<PairRequest>,
) -> Response {
    match relay.pair(&route_id, &request) {
        Ok(response) => (StatusCode::OK, Json(response)).into_response(),
        Err(_) => StatusCode::UNAUTHORIZED.into_response(),
    }
}

fn forward(relay: &Relay, route_id: &str, upgrade: WebSocketUpgrade, target: Target) -> Response {
    relay
        .open(route_id, target, upgrade)
        .unwrap_or_else(|_| StatusCode::SERVICE_UNAVAILABLE.into_response())
}

async fn control(
    State(relay): State<Relay>,
    Path(route_id): Path<String>,
    headers: HeaderMap,
    upgrade: WebSocketUpgrade,
) -> Response {
    let Ok(session) = relay.authenticate(&route_id, &headers) else {
        return StatusCode::UNAUTHORIZED.into_response();
    };
    let Ok(permit) = relay.0.capacity.clone().try_acquire_owned() else {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    };
    let worker = relay.clone();
    upgrade
        .max_message_size(4096)
        .max_frame_size(4096)
        .on_upgrade(move |socket| async move {
            let _ = worker.control(socket, permit, session).await;
        })
}

async fn attach(
    State(relay): State<Relay>,
    Path((route_id, ticket)): Path<(String, String)>,
    upgrade: WebSocketUpgrade,
) -> Response {
    let Ok(global) = relay.0.capacity.clone().try_acquire_owned() else {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    };
    let Ok(sender) = relay.attach(&route_id, &ticket) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    upgrade
        .max_message_size(wire::FRAME_BYTES)
        .max_frame_size(wire::FRAME_BYTES)
        .write_buffer_size(0)
        .max_write_buffer_size(wire::FRAME_BYTES * 2)
        .on_upgrade(move |socket| async move {
            let _permit = global;
            let _ = sender.send(socket);
        })
}

async fn bridge(left: WebSocket, right: WebSocket) -> Result<()> {
    let (mut left_write, mut left_read) = left.split();
    let (mut right_write, mut right_read) = right.split();
    let left_to_right = async {
        while let Some(message) =
            tokio::time::timeout(Duration::from_mins(1), left_read.next()).await?
        {
            match message? {
                Message::Binary(bytes) => {
                    tokio::time::timeout(DEADLINE, right_write.send(Message::Binary(bytes)))
                        .await??;
                }
                Message::Close(_) => break,
                Message::Ping(_) | Message::Pong(_) => {}
                Message::Text(_) => return Err(crate::denied()),
            }
        }
        Ok::<(), crate::Error>(())
    };
    let right_to_left = async {
        while let Some(message) =
            tokio::time::timeout(Duration::from_mins(1), right_read.next()).await?
        {
            match message? {
                Message::Binary(bytes) => {
                    tokio::time::timeout(DEADLINE, left_write.send(Message::Binary(bytes)))
                        .await??;
                }
                Message::Close(_) => break,
                Message::Ping(_) | Message::Pong(_) => {}
                Message::Text(_) => return Err(crate::denied()),
            }
        }
        Ok::<(), crate::Error>(())
    };
    tokio::select! { result = left_to_right => result, result = right_to_left => result }
}

/// Runs one listener for plain opaque carriers and pinned-TLS Companion service calls.
/// # Errors
/// Returns bind or listener failures.
pub async fn run(
    relay: Relay,
    listen: SocketAddr,
    tls: Arc<rustls::ServerConfig>,
    stop: CancellationToken,
) -> Result<()> {
    let listener = TcpListener::bind(listen).await?;
    serve(relay, listener, tls, stop).await
}

/// Serves an already-bound shared listener; cancellation drops all carriers.
///
/// TLS `ClientHello` records are routed to the pinned service-plane router. Plain HTTP Upgrade
/// requests are routed to the opaque carrier router. Both protocols share the same TCP address.
/// # Errors
/// Returns listener failures.
pub async fn serve(
    relay: Relay,
    listener: TcpListener,
    tls: Arc<rustls::ServerConfig>,
    stop: CancellationToken,
) -> Result<()> {
    let capacity = Arc::new(Semaphore::new(ACCEPTED_CONNECTIONS));
    let acceptor = TlsAcceptor::from(tls);
    let public = relay.public_router();
    let companion = relay.companion_router();
    let mut connections = JoinSet::new();
    loop {
        tokio::select! {
            () = stop.cancelled() => break,
            Some(_) = connections.join_next(), if !connections.is_empty() => {},
            accepted = listener.accept() => {
                let (socket, _) = accepted?;
                let Ok(permit) = capacity.clone().try_acquire_owned() else {
                    continue;
                };
                let acceptor = acceptor.clone();
                let public = public.clone();
                let companion = companion.clone();
                connections.spawn(async move {
                    let _permit = permit;
                    let mut first = [0_u8; 1];
                    let Ok(Ok(read)) = tokio::time::timeout(DEADLINE, socket.peek(&mut first)).await
                    else {
                        return;
                    };
                    if read == 0 {
                        return;
                    }
                    if first[0] == 0x16 {
                        let _ = serve_tls_connection(socket, acceptor, companion).await;
                    } else {
                        let _ = serve_plain_connection(socket, public).await;
                    }
                });
            }
        }
    }
    relay.shutdown();
    connections.abort_all();
    while connections.join_next().await.is_some() {}
    Ok(())
}

async fn serve_plain_connection(socket: TcpStream, router: Router) -> Result<()> {
    http1::Builder::new()
        .serve_connection(TokioIo::new(socket), TowerToHyperService::new(router))
        .with_upgrades()
        .await?;
    Ok(())
}

async fn serve_tls_connection(
    socket: TcpStream,
    acceptor: TlsAcceptor,
    router: Router,
) -> Result<()> {
    let stream = tokio::time::timeout(DEADLINE, acceptor.accept(socket)).await??;
    http1::Builder::new()
        .serve_connection(TokioIo::new(stream), TowerToHyperService::new(router))
        .with_upgrades()
        .await?;
    Ok(())
}
