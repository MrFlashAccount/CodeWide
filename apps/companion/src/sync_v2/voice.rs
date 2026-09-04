//! Authenticated generation-bound V2 Voice data plane.

use axum::{
    Router,
    extract::{
        State, WebSocketUpgrade,
        ws::{Message, WebSocket},
    },
    http::{HeaderMap, StatusCode},
    response::Response,
    routing::get,
};
use futures_util::SinkExt;
use tokio::sync::mpsc;

use crate::{
    dictation::{
        DictationError,
        v2::{FinishOutcome, VoiceBatch},
    },
    server::{AppState, Authorization, authenticated_session},
    session_authority::SessionAuthority,
};

use super::{
    AuthenticatedContextKey, http, parse_definition,
    protocol::{
        TransportError, TransportErrorCode, VoiceClientRecord, VoiceInputScope, VoiceServerRecord,
    },
    scalar::Id,
    serialize_definition,
};

struct ActiveVoiceSession {
    id: String,
    generation: u64,
    last_batch: Option<VoiceBatchIdentity>,
    input_scope: VoiceInputScope,
    thread_id: Option<Id>,
    authority: SessionAuthority,
    revocation_task: tokio::task::JoinHandle<()>,
}

#[derive(Clone, Copy, Eq, PartialEq)]
struct VoiceBatchIdentity {
    sequence: u64,
    payload: blake3::Hash,
}

struct VoiceRevocation {
    session_id: String,
    generation: u64,
}

impl ActiveVoiceSession {
    fn context_is_bound(&self) -> bool {
        let input_id = match &self.input_scope {
            VoiceInputScope::Generic { id }
            | VoiceInputScope::Chat { id }
            | VoiceInputScope::Review { id } => id,
        };
        self.generation > 0
            && !input_id.is_empty()
            && self
                .thread_id
                .as_ref()
                .is_none_or(|thread_id| !thread_id.as_str().is_empty())
    }
}

pub(crate) fn routes() -> Router<AppState> {
    Router::new().route("/v2/voice", get(voice_upgrade))
}

async fn voice_upgrade(
    State(state): State<AppState>,
    headers: HeaderMap,
    upgrade: WebSocketUpgrade,
) -> Response {
    if headers.get("origin").is_some() {
        return unauthorized();
    }
    let Some(authorization) = authenticated_session(&state, &headers).await else {
        return unauthorized();
    };
    let Ok(audience) = AuthenticatedContextKey::derive(&authorization) else {
        return http::error(
            StatusCode::FORBIDDEN,
            TransportErrorCode::Forbidden,
            "paired session required",
        );
    };
    let Some(runtime) = state.services.sync_v2.clone() else {
        return unavailable();
    };
    let Some(dictation) = state.sync.v2_dictation() else {
        return unavailable();
    };
    let registry = match &state.authorization {
        Authorization::Registry(registry) => Some(registry.clone()),
        Authorization::AdminOnly(_) => None,
    };
    upgrade
        .max_message_size(2 * 1024 * 1024)
        .max_frame_size(2 * 1024 * 1024)
        .on_upgrade(move |socket| async move {
            serve_voice(
                socket,
                dictation,
                authorization,
                audience.as_str().to_owned(),
                runtime,
                registry,
            )
            .await;
        })
}

async fn serve_voice(
    mut socket: WebSocket,
    dictation: std::sync::Arc<crate::dictation::DictationService>,
    authorization: crate::auth::AuthorizationContext,
    audience: String,
    runtime: super::SyncV2Runtime,
    registry: Option<std::sync::Arc<crate::auth::DeviceRegistry>>,
) {
    let mut active: Option<ActiveVoiceSession> = None;
    let (revoked_tx, mut revoked_rx) = mpsc::channel(8);
    let context = VoiceRecordContext {
        dictation: dictation.as_ref(),
        authorization: &authorization,
        audience: &audience,
        runtime: &runtime,
        registry: registry.as_ref(),
        revoked_tx: &revoked_tx,
    };
    loop {
        tokio::select! {
            received = socket.recv() => match received {
                Some(Ok(Message::Text(text))) => {
                    let Ok(record) = parse_definition::<VoiceClientRecord>("voiceClientRecord", &text) else {
                        send_error(&mut socket, active.as_ref().map(|session| session.id.as_str()), TransportErrorCode::InvalidRequest, "invalid Voice control record").await;
                        break;
                    };
                    if !handle_record(
                        &mut socket,
                        &context,
                        &mut active,
                        record,
                    ).await {
                        break;
                    }
                }
                Some(Ok(Message::Ping(bytes))) => {
                    if socket.send(Message::Pong(bytes)).await.is_err() {
                        break;
                    }
                }
                Some(Ok(Message::Pong(_))) => {}
                Some(Ok(Message::Close(_)) | Err(_)) | None => break,
                Some(Ok(Message::Binary(_))) => {
                    send_error(&mut socket, active.as_ref().map(|session| session.id.as_str()), TransportErrorCode::InvalidRequest, "Voice records must be JSON text").await;
                    break;
                }
            },
            revoked = revoked_rx.recv(), if active.is_some() => {
                let current = active.as_ref();
                if revoked.as_ref().is_some_and(|revoked| {
                    current.is_some_and(|session| {
                        let same_session = session.id == revoked.session_id;
                        let same_generation = session.generation == revoked.generation;
                        same_session && same_generation
                    })
                }) {
                    send_error(&mut socket, current.map(|session| session.id.as_str()), TransportErrorCode::Forbidden, "Voice session authorization lost").await;
                    break;
                }
            }
        }
    }
    if let Some(session) = active.take() {
        session.revocation_task.abort();
        if let Err(error) = dictation.v2_cancel(&audience, &session.id).await {
            tracing::error!(
                session_id = %session.id,
                code = ?dictation_error(&error).0,
                "V2 Voice cleanup failed; session ownership retained for bounded retry",
            );
        }
    }
    let _ = socket.close().await;
}

#[derive(Clone, Copy)]
struct VoiceRecordContext<'a> {
    dictation: &'a crate::dictation::DictationService,
    authorization: &'a crate::auth::AuthorizationContext,
    audience: &'a str,
    runtime: &'a super::SyncV2Runtime,
    registry: Option<&'a std::sync::Arc<crate::auth::DeviceRegistry>>,
    revoked_tx: &'a mpsc::Sender<VoiceRevocation>,
}

#[allow(clippy::too_many_lines)]
async fn handle_record(
    socket: &mut WebSocket,
    context: &VoiceRecordContext<'_>,
    active: &mut Option<ActiveVoiceSession>,
    record: VoiceClientRecord,
) -> bool {
    let VoiceRecordContext {
        dictation,
        authorization,
        audience,
        runtime,
        registry,
        revoked_tx,
    } = *context;
    match record {
        VoiceClientRecord::Start {
            version,
            generation,
            input_scope,
            thread_id,
            language,
        } => {
            if active.is_some() {
                send_error(
                    socket,
                    None,
                    TransportErrorCode::Conflict,
                    "Voice session already started",
                )
                .await;
                return false;
            }
            let Ok(generation) = generation.parse::<u64>() else {
                send_error(
                    socket,
                    None,
                    TransportErrorCode::InvalidRequest,
                    "invalid Voice generation",
                )
                .await;
                return false;
            };
            if version != 2 {
                send_error(
                    socket,
                    None,
                    TransportErrorCode::GenerationChanged,
                    "Voice generation changed",
                )
                .await;
                return false;
            }
            let thread_id = match thread_id {
                Some(thread_id) => {
                    if let Ok(thread_id) = Id::new(thread_id) {
                        Some(thread_id)
                    } else {
                        send_error(
                            socket,
                            None,
                            TransportErrorCode::InvalidRequest,
                            "invalid Voice thread",
                        )
                        .await;
                        return false;
                    }
                }
                None => None,
            };
            let authority_changes =
                || registry.map(|registry| registry.subscribe_authorization_changes());
            if runtime.generation() != generation {
                send_error(
                    socket,
                    None,
                    TransportErrorCode::GenerationChanged,
                    "Voice generation changed",
                )
                .await;
                return false;
            }
            let Some(mut authority) = SessionAuthority::new(authorization, authority_changes())
            else {
                send_error(
                    socket,
                    None,
                    TransportErrorCode::Forbidden,
                    "Voice session authorization unavailable",
                )
                .await;
                return false;
            };
            let Some(mut watcher) = SessionAuthority::new(authorization, authority_changes())
            else {
                send_error(
                    socket,
                    None,
                    TransportErrorCode::Forbidden,
                    "Voice session authorization unavailable",
                )
                .await;
                return false;
            };
            let Ok(session_id) = dictation.v2_start(audience, language.as_deref()).await else {
                send_error(
                    socket,
                    None,
                    TransportErrorCode::Unavailable,
                    "Voice service unavailable",
                )
                .await;
                return false;
            };
            if !authority.is_valid() {
                if let Err(error) = dictation.v2_cancel(audience, &session_id).await {
                    tracing::error!(session_id = %session_id, code = ?dictation_error(&error).0, "V2 Voice cleanup after revoked start failed");
                }
                send_error(
                    socket,
                    Some(&session_id),
                    TransportErrorCode::Forbidden,
                    "Voice session authorization lost",
                )
                .await;
                return false;
            }
            let revoked_tx = revoked_tx.clone();
            let revoked_session_id = session_id.clone();
            let revocation_task = tokio::spawn(async move {
                watcher.revoked().await;
                let _ = revoked_tx
                    .send(VoiceRevocation {
                        session_id: revoked_session_id,
                        generation,
                    })
                    .await;
            });
            *active = Some(ActiveVoiceSession {
                id: session_id.clone(),
                generation,
                last_batch: None,
                input_scope,
                thread_id,
                authority,
                revocation_task,
            });
            send_record(
                socket,
                &VoiceServerRecord::Started {
                    session_id,
                    generation: generation.to_string(),
                },
            )
            .await
            .is_ok()
        }
        VoiceClientRecord::Batch {
            session_id,
            sequence,
            sample_rate,
            num_channels,
            samples_per_channel,
            data,
        } => {
            let Some(session) = active.as_mut() else {
                send_error(
                    socket,
                    Some(&session_id),
                    TransportErrorCode::Conflict,
                    "Voice session not started",
                )
                .await;
                return false;
            };
            if runtime.generation() != session.generation
                || session.id != session_id
                || !session.context_is_bound()
                || !session.authority.is_valid()
            {
                send_error(
                    socket,
                    Some(&session_id),
                    TransportErrorCode::GenerationChanged,
                    "Voice audience or generation changed",
                )
                .await;
                return false;
            }
            let Ok(sequence) = sequence.parse::<u64>() else {
                send_error(
                    socket,
                    Some(&session_id),
                    TransportErrorCode::InvalidRequest,
                    "invalid Voice sequence",
                )
                .await;
                return false;
            };
            let identity = voice_batch_identity(
                sequence,
                sample_rate,
                num_channels,
                samples_per_channel,
                &data,
            );
            if let Some(last) = session.last_batch.filter(|last| last.sequence == sequence) {
                if last != identity {
                    send_error(
                        socket,
                        Some(&session_id),
                        TransportErrorCode::Conflict,
                        "Voice retry payload changed",
                    )
                    .await;
                    return false;
                }
                return send_record(
                    socket,
                    &VoiceServerRecord::Ack {
                        session_id,
                        sequence: sequence.to_string(),
                    },
                )
                .await
                .is_ok();
            }
            if session
                .last_batch
                .is_some_and(|last| sequence != last.sequence.saturating_add(1))
            {
                send_error(
                    socket,
                    Some(&session_id),
                    TransportErrorCode::Conflict,
                    "Voice sequence gap",
                )
                .await;
                return false;
            }
            let append = dictation.v2_append(
                audience,
                &session_id,
                VoiceBatch {
                    sequence,
                    sample_rate,
                    num_channels,
                    samples_per_channel,
                    data: &data,
                },
            );
            let result = tokio::select! {
                biased;
                () = session.authority.revoked() => {
                    send_error(socket, Some(&session_id), TransportErrorCode::Forbidden, "Voice session authorization lost").await;
                    return false;
                }
                result = append => result,
            };
            if let Err(error) = result {
                let (code, message) = dictation_error(&error);
                send_error(socket, Some(&session_id), code, message).await;
                return false;
            }
            if !session.authority.is_valid() {
                send_error(
                    socket,
                    Some(&session_id),
                    TransportErrorCode::Forbidden,
                    "Voice session authorization lost",
                )
                .await;
                return false;
            }
            session.last_batch = Some(identity);
            send_record(
                socket,
                &VoiceServerRecord::Ack {
                    session_id,
                    sequence: sequence.to_string(),
                },
            )
            .await
            .is_ok()
        }
        VoiceClientRecord::Finish { session_id } => {
            if active
                .as_ref()
                .is_none_or(|session| session.id != session_id)
            {
                send_error(
                    socket,
                    Some(&session_id),
                    TransportErrorCode::NotFound,
                    "Voice session not found",
                )
                .await;
                return false;
            }
            if !active_generation_valid(active, runtime, &session_id) {
                send_error(
                    socket,
                    Some(&session_id),
                    TransportErrorCode::GenerationChanged,
                    "Voice generation changed",
                )
                .await;
                return false;
            }
            #[cfg(feature = "e2e-command-fault")]
            if let Some(effect) = runtime
                .intercept_e2e_surface_fault(super::E2ESurfaceFaultTarget::VoiceFinish)
                .await
            {
                match effect {
                    super::E2ESurfaceFaultEffect::Continue => {}
                    super::E2ESurfaceFaultEffect::VoiceRetry(retry_after_ms) => {
                        return send_record(
                            socket,
                            &VoiceServerRecord::Retry {
                                session_id,
                                retry_after_ms,
                            },
                        )
                        .await
                        .is_ok();
                    }
                    super::E2ESurfaceFaultEffect::VoiceResult(text) => {
                        if dictation.v2_cancel(audience, &session_id).await.is_err() {
                            send_error(
                                socket,
                                Some(&session_id),
                                TransportErrorCode::Unavailable,
                                "Voice cleanup failed",
                            )
                            .await;
                            return false;
                        }
                        let sent = send_record(
                            socket,
                            &VoiceServerRecord::Result {
                                session_id: session_id.clone(),
                                text,
                            },
                        )
                        .await
                        .is_ok();
                        clear_active(active);
                        return sent;
                    }
                    super::E2ESurfaceFaultEffect::Fail(marker) => {
                        send_error_owned(
                            socket,
                            Some(&session_id),
                            TransportErrorCode::Unavailable,
                            format!("E2E fault: {marker}"),
                        )
                        .await;
                        return false;
                    }
                    super::E2ESurfaceFaultEffect::NotFound
                    | super::E2ESurfaceFaultEffect::ReplayUnavailable
                    | super::E2ESurfaceFaultEffect::InvalidCursor
                    | super::E2ESurfaceFaultEffect::PortExpire { .. }
                    | super::E2ESurfaceFaultEffect::QueueUncertain(_) => {
                        send_error(
                            socket,
                            Some(&session_id),
                            TransportErrorCode::Unavailable,
                            "E2E surface fault action did not match the Voice finish boundary",
                        )
                        .await;
                        return false;
                    }
                }
            }
            let outcome = {
                let Some(session) = active.as_mut() else {
                    return false;
                };
                tokio::select! {
                    biased;
                    () = session.authority.revoked() => {
                        send_error(socket, Some(&session_id), TransportErrorCode::Forbidden, "Voice session authorization lost").await;
                        return false;
                    }
                    outcome = dictation.v2_finish(audience, &session_id) => outcome,
                }
            };
            match outcome {
                Ok(FinishOutcome::Result(text)) => {
                    if !active_generation_valid(active, runtime, &session_id) {
                        send_error(
                            socket,
                            Some(&session_id),
                            TransportErrorCode::Forbidden,
                            "Voice session authorization lost",
                        )
                        .await;
                        return false;
                    }
                    if let Err(error) = dictation.v2_cancel(audience, &session_id).await {
                        tracing::error!(session_id = %session_id, code = ?dictation_error(&error).0, "V2 Voice cleanup after finish failed");
                        send_error(
                            socket,
                            Some(&session_id),
                            TransportErrorCode::Unavailable,
                            "Voice cleanup failed",
                        )
                        .await;
                        return false;
                    }
                    let sent = send_record(
                        socket,
                        &VoiceServerRecord::Result {
                            session_id: session_id.clone(),
                            text,
                        },
                    )
                    .await
                    .is_ok();
                    clear_active(active);
                    sent
                }
                Ok(FinishOutcome::Retry { retry_after_ms }) => {
                    if !active_generation_valid(active, runtime, &session_id) {
                        send_error(
                            socket,
                            Some(&session_id),
                            TransportErrorCode::Forbidden,
                            "Voice session authorization lost",
                        )
                        .await;
                        return false;
                    }
                    send_record(
                        socket,
                        &VoiceServerRecord::Retry {
                            session_id,
                            retry_after_ms,
                        },
                    )
                    .await
                    .is_ok()
                }
                Err(error) => {
                    let (code, message) = dictation_error(&error);
                    send_error(socket, Some(&session_id), code, message).await;
                    false
                }
            }
        }
        VoiceClientRecord::Cancel { session_id } => {
            if active
                .as_ref()
                .is_none_or(|session| session.id != session_id)
            {
                send_error(
                    socket,
                    Some(&session_id),
                    TransportErrorCode::NotFound,
                    "Voice session not found",
                )
                .await;
                return false;
            }
            if !active_generation_valid(active, runtime, &session_id) {
                send_error(
                    socket,
                    Some(&session_id),
                    TransportErrorCode::Forbidden,
                    "Voice session authorization lost",
                )
                .await;
                return false;
            }
            if dictation.v2_cancel(audience, &session_id).await.is_err() {
                send_error(
                    socket,
                    Some(&session_id),
                    TransportErrorCode::Unavailable,
                    "Voice cancel failed",
                )
                .await;
                return false;
            }
            clear_active(active);
            send_record(socket, &VoiceServerRecord::Cancelled { session_id })
                .await
                .is_ok()
        }
    }
}

fn voice_batch_identity(
    sequence: u64,
    sample_rate: u32,
    num_channels: u16,
    samples_per_channel: u64,
    data: &str,
) -> VoiceBatchIdentity {
    let mut hasher = blake3::Hasher::new();
    hasher.update(&sample_rate.to_le_bytes());
    hasher.update(&num_channels.to_le_bytes());
    hasher.update(&samples_per_channel.to_le_bytes());
    hasher.update(data.as_bytes());
    VoiceBatchIdentity {
        sequence,
        payload: hasher.finalize(),
    }
}

fn clear_active(active: &mut Option<ActiveVoiceSession>) {
    if let Some(session) = active.take() {
        session.revocation_task.abort();
    }
}

fn active_authority_valid(active: &mut Option<ActiveVoiceSession>, session_id: &str) -> bool {
    let Some(session) = active.as_mut().filter(|session| session.id == session_id) else {
        return false;
    };
    session.context_is_bound() && session.authority.is_valid()
}

fn active_generation_valid(
    active: &mut Option<ActiveVoiceSession>,
    runtime: &super::SyncV2Runtime,
    session_id: &str,
) -> bool {
    active_authority_valid(active, session_id)
        && active
            .as_ref()
            .is_some_and(|session| runtime.generation() == session.generation)
}

fn dictation_error(error: &DictationError) -> (TransportErrorCode, &'static str) {
    match error {
        DictationError::Missing => (TransportErrorCode::NotFound, "Voice session not found"),
        DictationError::Sealed | DictationError::FormatChanged => {
            (TransportErrorCode::Conflict, "Voice session state conflict")
        }
        DictationError::ChunkTooLarge
        | DictationError::RecordingTooLarge
        | DictationError::InvalidBatch => {
            (TransportErrorCode::LimitExceeded, "Voice limit exceeded")
        }
        DictationError::InvalidBase64
        | DictationError::InvalidChunkSize
        | DictationError::InvalidOpus
        | DictationError::Empty
        | DictationError::InvalidParams(_) => {
            (TransportErrorCode::InvalidRequest, "invalid Voice request")
        }
        DictationError::OAuthUnavailable
        | DictationError::OAuthPermissions
        | DictationError::OAuthUnreadable
        | DictationError::Timeout
        | DictationError::Transport
        | DictationError::InvalidResponse
        | DictationError::MissingText
        | DictationError::Http(_)
        | DictationError::Storage => (TransportErrorCode::Unavailable, "Voice service unavailable"),
    }
}

async fn send_error(
    socket: &mut WebSocket,
    session_id: Option<&str>,
    code: TransportErrorCode,
    message: &'static str,
) {
    send_error_owned(socket, session_id, code, message.to_owned()).await;
}

async fn send_error_owned(
    socket: &mut WebSocket,
    session_id: Option<&str>,
    code: TransportErrorCode,
    message: String,
) {
    let record = VoiceServerRecord::Error {
        session_id: session_id.unwrap_or("uninitialized").to_owned(),
        error: TransportError { code, message },
    };
    let _ = send_record(socket, &record).await;
}

async fn send_record(socket: &mut WebSocket, record: &VoiceServerRecord) -> Result<(), ()> {
    let text = serialize_definition("voiceServerRecord", record)?;
    socket
        .send(Message::Text(text.into()))
        .await
        .map_err(|_| ())
}

fn unauthorized() -> Response {
    http::error(
        StatusCode::UNAUTHORIZED,
        TransportErrorCode::Unauthorized,
        "authenticated device session required",
    )
}

fn unavailable() -> Response {
    http::error(
        StatusCode::SERVICE_UNAVAILABLE,
        TransportErrorCode::Unavailable,
        "Voice service unavailable",
    )
}
