use std::{
    collections::{HashMap, HashSet},
    fs::OpenOptions as StdOpenOptions,
    io::Read,
    os::unix::fs::{OpenOptionsExt, PermissionsExt},
    path::{Path, PathBuf},
    sync::Arc,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use base64::{Engine as _, engine::general_purpose::STANDARD};
use bytes::Bytes;
use futures_util::StreamExt;
use opus_pure::OpusDecoder;
use rand::TryRngCore;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tokio::{
    fs::{self, OpenOptions},
    io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt},
    sync::Mutex,
};
use tracing::{info, warn};

mod metrics;
pub(crate) mod v2;

use metrics::{
    MeasuredResponse, MetricsConnectorLayer, MetricsDnsResolver, RequestNetworkProbe,
    next_request_id, request_metrics,
};

const DEFAULT_ENDPOINT: &str = "https://chatgpt.com/backend-api/transcribe";
const MAX_AUDIO_BYTES: u64 = 192 * 1024 * 1024;
const MAX_CHUNK_BYTES: usize = 1024 * 1024;
const MAX_BATCH_CHUNKS: usize = 64;
const MAX_OPUS_PACKET_BYTES: usize = 1_275;
const SEGMENT_MS: u64 = 8 * 60 * 1_000;
const MAX_RESPONSE_BYTES: usize = 16 * 1024 * 1024;
const AUTOMATIC_RETRIES: usize = 3;
const MAX_AUTOMATIC_DELAY: Duration = Duration::from_mins(1);
const BASE_RETRY_DELAY: Duration = Duration::from_secs(1);
// A Cloudflare challenge is not server backpressure. Retrying it with the
// generic 1s/2s/4s backoff only adds dead time to an interactive dictation.
// Keep a tiny bounded delay so a transient edge decision can clear without
// turning every challenged recording into a multi-second pause.
const CLOUDFLARE_RETRY_BASE_DELAY: Duration = Duration::from_millis(100);
const QUIET_RMS_PPM: f64 = 5_000.0;
const EDGE_PADDING_MS: f64 = 300.0;
const IDLE_SESSION_TTL: Duration = Duration::from_hours(2);
const IDLE_SWEEP_INTERVAL: Duration = Duration::from_mins(15);
const SESSION_MANIFEST: &str = "session.json";
const SESSION_MANIFEST_VERSION: u8 = 1;

#[derive(Clone)]
pub struct DictationService {
    sessions: Arc<Mutex<HashMap<String, Arc<Mutex<Session>>>>>,
    v2_start_lock: Arc<Mutex<()>>,
    auth_file: PathBuf,
    endpoint: Arc<str>,
    client: reqwest::Client,
    temp_root: PathBuf,
    options: DictationLimits,
}

#[derive(Clone, Copy)]
struct DictationLimits {
    max_audio_bytes: u64,
    max_chunk_bytes: usize,
    segment_ms: u64,
    automatic_retries: usize,
    base_retry_delay: Duration,
}

struct Session {
    client_id: String,
    directory: PathBuf,
    pcm_path: PathBuf,
    sample_rate: u32,
    channels: u16,
    bytes: u64,
    audio_chunks: u64,
    append_batches: u64,
    frames: Vec<QualityFrame>,
    language: Option<String>,
    sealed: bool,
    next_offset: u64,
    transcripts: Vec<String>,
    completed: Option<String>,
    accepted_batches: HashSet<String>,
    opus_decoder: Option<OpusDecoder>,
    upload_metrics: DictationUploadMetrics,
    last_activity_ms: u64,
}

#[derive(Clone, Deserialize, Serialize)]
struct QualityFrame {
    byte_start: u64,
    byte_length: u64,
    duration_ms: f64,
    rms_ppm: f64,
}

struct DecodedAudioChunk {
    bytes: Vec<u8>,
    encoded_bytes: u64,
    base64_bytes: u64,
    opus: bool,
    sample_rate: u32,
    channels: u16,
    samples_per_channel: u64,
    rms_ppm: f64,
}

#[derive(Default)]
struct DecodedBatchMetrics {
    encoded_audio_bytes: u64,
    base64_audio_bytes: u64,
    opus_chunks: u64,
    pcm_chunks: u64,
}

struct DictationFinishObservation {
    finish_received_at_ms: u64,
    finish_total_ms: u64,
    session_acquire_ms: u64,
    seal_persist_ms: u64,
    transcription_ms: u64,
    final_persist_ms: u64,
    recording_ms: f64,
    transcript_bytes: u64,
    transcript_chars: u64,
    completed: bool,
}

#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct DictationUploadMetrics {
    created_at_unix_ms: u64,
    first_chunk_at_unix_ms: Option<u64>,
    last_chunk_at_unix_ms: Option<u64>,
    encoded_audio_bytes: u64,
    base64_audio_bytes: u64,
    opus_chunks: u64,
    pcm_chunks: u64,
    append_processing_ms_total: u64,
    append_processing_ms_max: u64,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct StoredSession {
    version: u8,
    client_id: String,
    sample_rate: u32,
    channels: u16,
    bytes: u64,
    audio_chunks: u64,
    append_batches: u64,
    frames: Vec<QualityFrame>,
    language: Option<String>,
    sealed: bool,
    next_offset: u64,
    transcripts: Vec<String>,
    completed: Option<String>,
    accepted_batches: HashSet<String>,
    #[serde(default)]
    upload_metrics: DictationUploadMetrics,
    last_activity_ms: u64,
}

#[derive(Debug, thiserror::Error)]
pub enum DictationError {
    #[error("Dictation session is missing or expired")]
    Missing,
    #[error("Dictation recording has already stopped")]
    Sealed,
    #[error("Audio data must be canonical base64")]
    InvalidBase64,
    #[error("Audio chunk is too large")]
    ChunkTooLarge,
    #[error("Audio chunk size does not match PCM16 metadata")]
    InvalidChunkSize,
    #[error("Opus audio packet is invalid")]
    InvalidOpus,
    #[error("Audio format changed during dictation")]
    FormatChanged,
    #[error("Dictation recording is too large")]
    RecordingTooLarge,
    #[error("Audio batch must contain between 1 and 64 chunks")]
    InvalidBatch,
    #[error("No microphone audio was recorded")]
    Empty,
    #[error("Codex OAuth is unavailable on the host; run `codex login`")]
    OAuthUnavailable,
    #[error("Codex OAuth file permissions are too broad")]
    OAuthPermissions,
    #[error("Codex OAuth file is unreadable; run `codex login` on the host")]
    OAuthUnreadable,
    #[error("ChatGPT transcription timed out")]
    Timeout,
    #[error("ChatGPT transcription transport failed")]
    Transport,
    #[error("ChatGPT transcription returned an invalid response")]
    InvalidResponse,
    #[error("ChatGPT transcription returned no text")]
    MissingText,
    #[error("ChatGPT transcription failed (HTTP {0})")]
    Http(u16),
    #[error("invalid dictation parameters: {0}")]
    InvalidParams(&'static str),
    #[error("dictation storage failed")]
    Storage,
}

#[derive(Debug, Clone)]
enum TranscriptionOutcome {
    Text(String),
    Retryable {
        retry_after: Duration,
        message: String,
    },
}

#[derive(Debug, Deserialize)]
struct StoredAuth {
    tokens: Option<StoredTokens>,
}

#[derive(Debug, Deserialize)]
struct StoredTokens {
    access_token: Option<String>,
    account_id: Option<String>,
}

#[derive(Clone)]
struct OAuth {
    access_token: String,
    account_id: String,
}

impl DictationService {
    /// Creates the companion-owned OAuth transcription service.
    ///
    /// # Errors
    ///
    /// Returns an error if its HTTP client or private temporary directory
    /// cannot be created.
    pub async fn open(auth_file: PathBuf, temp_root: PathBuf) -> Result<Self, DictationError> {
        Self::open_with_endpoint(auth_file, temp_root, DEFAULT_ENDPOINT.to_owned()).await
    }

    /// Creates the service with an explicit transcription endpoint. This is
    /// used by deterministic contract tests and private compatible gateways.
    ///
    /// # Errors
    ///
    /// Returns an error if its HTTP client or private temporary directory
    /// cannot be created.
    pub async fn open_with_endpoint(
        auth_file: PathBuf,
        temp_root: PathBuf,
        endpoint: String,
    ) -> Result<Self, DictationError> {
        Self::open_with_options(
            auth_file,
            temp_root,
            endpoint,
            DictationLimits {
                max_audio_bytes: MAX_AUDIO_BYTES,
                max_chunk_bytes: MAX_CHUNK_BYTES,
                segment_ms: SEGMENT_MS,
                automatic_retries: AUTOMATIC_RETRIES,
                base_retry_delay: BASE_RETRY_DELAY,
            },
        )
        .await
    }

    async fn open_with_options(
        auth_file: PathBuf,
        temp_root: PathBuf,
        endpoint: String,
        options: DictationLimits,
    ) -> Result<Self, DictationError> {
        fs::create_dir_all(&temp_root)
            .await
            .map_err(|_| DictationError::Storage)?;
        fs::set_permissions(&temp_root, std::fs::Permissions::from_mode(0o700))
            .await
            .map_err(|_| DictationError::Storage)?;
        let client = reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(15))
            .timeout(Duration::from_mins(15))
            .pool_idle_timeout(Duration::from_mins(30))
            .pool_max_idle_per_host(2)
            .tcp_keepalive(Duration::from_mins(1))
            .redirect(reqwest::redirect::Policy::none())
            .dns_resolver2(MetricsDnsResolver)
            .connector_layer(MetricsConnectorLayer)
            .build()
            .map_err(|_| DictationError::Transport)?;
        let sessions = Arc::new(Mutex::new(
            recover_sessions(&temp_root, options.max_audio_bytes).await,
        ));
        tokio::spawn(cleanup_idle_sessions(
            sessions.clone(),
            IDLE_SESSION_TTL,
            IDLE_SWEEP_INTERVAL,
        ));
        Ok(Self {
            sessions,
            v2_start_lock: Arc::new(Mutex::new(())),
            auth_file,
            endpoint: Arc::from(endpoint),
            client,
            temp_root,
            options,
        })
    }

    #[must_use]
    pub fn handles(method: &str) -> bool {
        method.starts_with("companion/dictation/")
    }

    /// Executes a private local dictation RPC. OAuth material is never
    /// returned or forwarded through the Codex App Server protocol.
    ///
    /// # Errors
    ///
    /// Validates session ownership, audio framing, storage, OAuth credentials,
    /// and the transcription response.
    pub async fn handle(
        &self,
        client_id: &str,
        method: &str,
        params: &Value,
    ) -> Result<Value, DictationError> {
        match method {
            "companion/dictation/start" => self.start(client_id, params).await,
            "companion/dictation/append" => self.append(client_id, params, false).await,
            "companion/dictation/appendBatch" => self.append(client_id, params, true).await,
            "companion/dictation/finish" => self.finish(client_id, params).await,
            "companion/dictation/cancel" => self.cancel(client_id, params).await,
            _ => Err(DictationError::InvalidParams("unknown method")),
        }
    }

    #[cfg(feature = "e2e-command-fault")]
    /// Validates that a V1 finish request owns a live dictation session before an E2E result is
    /// injected at the transport boundary.
    ///
    /// # Errors
    ///
    /// Returns the same ownership/parameter error as a normal finish request.
    pub(crate) async fn validate_e2e_finish_session(
        &self,
        client_id: &str,
        params: &Value,
    ) -> Result<(), DictationError> {
        self.owned_session(client_id, params).await.map(|_| ())
    }

    async fn start(&self, client_id: &str, params: &Value) -> Result<Value, DictationError> {
        let candidates = self
            .sessions
            .lock()
            .await
            .iter()
            .map(|(id, session)| (id.clone(), session.clone()))
            .collect::<Vec<_>>();
        let mut owned = Vec::new();
        for (id, session) in candidates {
            if session.lock().await.client_id == client_id {
                owned.push((id, session));
            }
        }
        let abandoned = {
            let mut sessions = self.sessions.lock().await;
            owned
                .into_iter()
                .filter_map(|(id, candidate)| {
                    sessions
                        .get(&id)
                        .is_some_and(|current| Arc::ptr_eq(current, &candidate))
                        .then(|| sessions.remove(&id))
                        .flatten()
                })
                .collect::<Vec<_>>()
        };
        for session in abandoned {
            let directory = session.lock().await.directory.clone();
            let _ = fs::remove_dir_all(directory).await;
        }
        self.create_session(client_id, params).await
    }

    pub(super) async fn create_session(
        &self,
        client_id: &str,
        params: &Value,
    ) -> Result<Value, DictationError> {
        let id = random_id()?;
        let directory = self.temp_root.join(&id);
        fs::create_dir(&directory)
            .await
            .map_err(|_| DictationError::Storage)?;
        fs::set_permissions(&directory, std::fs::Permissions::from_mode(0o700))
            .await
            .map_err(|_| DictationError::Storage)?;
        let pcm_path = directory.join("recording.pcm");
        let mut file = OpenOptions::new()
            .create_new(true)
            .write(true)
            .mode(0o600)
            .open(&pcm_path)
            .await
            .map_err(|_| DictationError::Storage)?;
        file.flush().await.map_err(|_| DictationError::Storage)?;
        let language = params
            .get("language")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty() && value.len() <= 32)
            .map(str::to_owned);
        let session = Session {
            client_id: client_id.to_owned(),
            directory,
            pcm_path,
            sample_rate: 0,
            channels: 0,
            bytes: 0,
            audio_chunks: 0,
            append_batches: 0,
            frames: Vec::new(),
            language,
            sealed: false,
            next_offset: 0,
            transcripts: Vec::new(),
            completed: None,
            accepted_batches: HashSet::new(),
            opus_decoder: None,
            upload_metrics: DictationUploadMetrics {
                created_at_unix_ms: unix_time_ms(),
                ..DictationUploadMetrics::default()
            },
            last_activity_ms: unix_time_ms(),
        };
        persist_session(&session).await?;
        self.sessions
            .lock()
            .await
            .insert(id.clone(), Arc::new(Mutex::new(session)));
        Ok(json!({"sessionId": id}))
    }

    async fn append(
        &self,
        client_id: &str,
        params: &Value,
        batch: bool,
    ) -> Result<Value, DictationError> {
        let append_started = std::time::Instant::now();
        let append_received_at_ms = unix_time_ms();
        let session = self.owned_session(client_id, params).await?;
        let mut session = session.lock().await;
        if session.sealed {
            return Err(DictationError::Sealed);
        }
        let batch_id = batch
            .then(|| params.get("batchId").and_then(Value::as_str))
            .flatten()
            .filter(|id| !id.is_empty());
        if batch_id.is_some_and(|id| session.accepted_batches.contains(id)) {
            return Ok(json!({"accepted": true}));
        }
        let chunks = if batch {
            let chunks = params
                .get("chunks")
                .and_then(Value::as_array)
                .filter(|chunks| !chunks.is_empty() && chunks.len() <= MAX_BATCH_CHUNKS)
                .ok_or(DictationError::InvalidBatch)?;
            chunks.iter().collect::<Vec<_>>()
        } else {
            vec![params]
        };
        let mut decoded_chunks = Vec::with_capacity(chunks.len());
        let mut appended_bytes = 0_u64;
        let mut sample_rate = session.sample_rate;
        let mut channels = session.channels;
        let mut frames = Vec::with_capacity(chunks.len());
        let mut batch_metrics = DecodedBatchMetrics::default();
        for chunk in chunks {
            let decoded_chunk = decode_audio_chunk(
                chunk,
                self.options.max_chunk_bytes,
                &mut session.opus_decoder,
            )?;
            if sample_rate == 0 {
                sample_rate = decoded_chunk.sample_rate;
                channels = decoded_chunk.channels;
            } else if sample_rate != decoded_chunk.sample_rate || channels != decoded_chunk.channels
            {
                return Err(DictationError::FormatChanged);
            }
            let samples_u32 = u32::try_from(decoded_chunk.samples_per_channel)
                .map_err(|_| DictationError::InvalidParams("samplesPerChannel"))?;
            let byte_length = u64::try_from(decoded_chunk.bytes.len())
                .map_err(|_| DictationError::InvalidChunkSize)?;
            frames.push(QualityFrame {
                byte_start: session.bytes.saturating_add(appended_bytes),
                byte_length,
                duration_ms: f64::from(samples_u32) * 1_000.0
                    / f64::from(decoded_chunk.sample_rate),
                rms_ppm: decoded_chunk.rms_ppm,
            });
            appended_bytes = appended_bytes.saturating_add(byte_length);
            batch_metrics.record(&decoded_chunk);
            decoded_chunks.push(decoded_chunk.bytes);
        }
        if session.bytes.saturating_add(appended_bytes) > self.options.max_audio_bytes {
            return Err(DictationError::RecordingTooLarge);
        }
        let mut file = OpenOptions::new()
            .append(true)
            .open(&session.pcm_path)
            .await
            .map_err(|_| DictationError::Storage)?;
        for bytes in decoded_chunks {
            file.write_all(&bytes)
                .await
                .map_err(|_| DictationError::Storage)?;
        }
        file.sync_data()
            .await
            .map_err(|_| DictationError::Storage)?;
        session.sample_rate = sample_rate;
        session.channels = channels;
        session.bytes = session.bytes.saturating_add(appended_bytes);
        session.audio_chunks = session
            .audio_chunks
            .saturating_add(u64::try_from(frames.len()).unwrap_or(u64::MAX));
        session.append_batches = session.append_batches.saturating_add(1);
        session.frames.extend(frames);
        session.last_activity_ms = unix_time_ms();
        if let Some(batch_id) = batch_id {
            session.accepted_batches.insert(batch_id.to_owned());
        }
        session.upload_metrics.record_batch(
            append_received_at_ms,
            &batch_metrics,
            elapsed_millis(append_started.elapsed()),
        );
        persist_session(&session).await?;
        Ok(json!({"accepted": true}))
    }

    async fn finish(&self, client_id: &str, params: &Value) -> Result<Value, DictationError> {
        let finish_started = std::time::Instant::now();
        let finish_received_at_ms = unix_time_ms();
        let session = self.owned_session(client_id, params).await?;
        let mut session = session.lock().await;
        let session_acquire_ms = elapsed_millis(finish_started.elapsed());
        if let Some(text) = &session.completed {
            return Ok(json!({"text": text}));
        }
        session.sealed = true;
        session.last_activity_ms = unix_time_ms();
        let seal_persist_started = std::time::Instant::now();
        persist_session(&session).await?;
        let seal_persist_ms = elapsed_millis(seal_persist_started.elapsed());
        if session.bytes == 0 || session.sample_rate == 0 || session.channels == 0 {
            return Err(DictationError::Empty);
        }
        let transcription_started = std::time::Instant::now();
        let recording_ms = session
            .frames
            .iter()
            .map(|frame| frame.duration_ms)
            .sum::<f64>()
            .round();
        let outcome = self.transcribe_session(&mut session).await;
        let transcription_ms = elapsed_millis(transcription_started.elapsed());
        session.last_activity_ms = unix_time_ms();
        let (completed, transcript_bytes, transcript_chars, result) = match outcome {
            Ok(TranscriptionOutcome::Text(text)) => {
                let transcript_bytes = u64::try_from(text.len()).unwrap_or(u64::MAX);
                let transcript_chars = u64::try_from(text.chars().count()).unwrap_or(u64::MAX);
                session.completed = Some(text.clone());
                (
                    true,
                    transcript_bytes,
                    transcript_chars,
                    json!({"text": text}),
                )
            }
            Ok(TranscriptionOutcome::Retryable {
                retry_after,
                message,
            }) => (
                false,
                0,
                0,
                json!({
                    "retryable": true,
                    "retryAfterMs": u64::try_from(retry_after.as_millis()).unwrap_or(u64::MAX),
                    "message": message
                }),
            ),
            Err(error) => (
                false,
                0,
                0,
                json!({
                    "retryable": true,
                    "retryAfterMs": 1_000,
                    "message": error.to_string()
                }),
            ),
        };
        let final_persist_started = std::time::Instant::now();
        persist_session(&session).await?;
        let final_persist_ms = elapsed_millis(final_persist_started.elapsed());
        log_dictation_metrics(
            &session,
            &DictationFinishObservation {
                finish_received_at_ms,
                finish_total_ms: elapsed_millis(finish_started.elapsed()),
                session_acquire_ms,
                seal_persist_ms,
                transcription_ms,
                final_persist_ms,
                recording_ms,
                transcript_bytes,
                transcript_chars,
                completed,
            },
        );
        Ok(result)
    }

    async fn cancel(&self, client_id: &str, params: &Value) -> Result<Value, DictationError> {
        let id = string_param(params, "sessionId")?;
        let candidate = self.sessions.lock().await.get(id).cloned();
        let owned = if let Some(session) = &candidate {
            session.lock().await.client_id == client_id
        } else {
            false
        };
        let session = if owned {
            let mut sessions = self.sessions.lock().await;
            sessions
                .get(id)
                .is_some_and(|current| {
                    candidate
                        .as_ref()
                        .is_some_and(|candidate| Arc::ptr_eq(current, candidate))
                })
                .then(|| sessions.remove(id))
                .flatten()
        } else {
            None
        };
        if let Some(session) = session {
            let directory = session.lock().await.directory.clone();
            let _ = fs::remove_dir_all(directory).await;
            Ok(json!({"cancelled": true}))
        } else {
            Ok(json!({"cancelled": false}))
        }
    }

    async fn owned_session(
        &self,
        client_id: &str,
        params: &Value,
    ) -> Result<Arc<Mutex<Session>>, DictationError> {
        let id = string_param(params, "sessionId")?;
        let session = self
            .sessions
            .lock()
            .await
            .get(id)
            .cloned()
            .ok_or(DictationError::Missing)?;
        if session.lock().await.client_id != client_id {
            return Err(DictationError::Missing);
        }
        Ok(session)
    }

    async fn transcribe_session(
        &self,
        session: &mut Session,
    ) -> Result<TranscriptionOutcome, DictationError> {
        let bounds_started = std::time::Instant::now();
        let (start, end) = transcription_bounds(&session.frames, session.bytes);
        let bounds_ms = elapsed_millis(bounds_started.elapsed());
        if session.next_offset == 0 {
            session.next_offset = start;
        }
        let bytes_per_frame = u64::from(session.channels) * 2;
        let segment_bytes = (u64::from(session.sample_rate)
            .saturating_mul(bytes_per_frame)
            .saturating_mul(self.options.segment_ms)
            / 1_000)
            .max(bytes_per_frame);
        while session.next_offset < end {
            let segment_started = std::time::Instant::now();
            let bytes = segment_bytes.min(end - session.next_offset);
            let wav_started = std::time::Instant::now();
            let wav = Bytes::from(
                wav_segment(
                    &session.pcm_path,
                    session.next_offset,
                    bytes,
                    session.sample_rate,
                    session.channels,
                )
                .await?,
            );
            let wav_build_ms = elapsed_millis(wav_started.elapsed());
            info!(
                status = "dictation-transcription-segment-prepared",
                bounds_ms,
                wav_build_ms,
                wav_bytes = wav.len(),
                pcm_bytes = bytes,
                segment_offset = session.next_offset,
            );
            let request_started = std::time::Instant::now();
            match self
                .transcribe_segment(&wav, session.language.as_deref())
                .await?
            {
                TranscriptionOutcome::Text(text) => {
                    let request_ms = elapsed_millis(request_started.elapsed());
                    if !text.trim().is_empty() {
                        session.transcripts.push(text.trim().to_owned());
                    }
                    session.next_offset = session.next_offset.saturating_add(bytes);
                    session.last_activity_ms = unix_time_ms();
                    let persist_started = std::time::Instant::now();
                    persist_session(session).await?;
                    let persist_ms = elapsed_millis(persist_started.elapsed());
                    let segment_total_ms = elapsed_millis(segment_started.elapsed());
                    info!(
                        status = "dictation-transcription-segment-completed",
                        segment_total_ms,
                        wav_build_ms,
                        request_ms,
                        persist_ms,
                        unattributed_ms = segment_total_ms.saturating_sub(
                            wav_build_ms
                                .saturating_add(request_ms)
                                .saturating_add(persist_ms)
                        ),
                        pcm_bytes = bytes,
                    );
                }
                retryable @ TranscriptionOutcome::Retryable { .. } => {
                    info!(
                        status = "dictation-transcription-segment-deferred",
                        segment_total_ms = segment_started.elapsed().as_millis(),
                        wav_build_ms,
                        request_ms = request_started.elapsed().as_millis(),
                        pcm_bytes = bytes,
                    );
                    return Ok(retryable);
                }
            }
        }
        Ok(TranscriptionOutcome::Text(session.transcripts.join(" ")))
    }

    async fn transcribe_segment(
        &self,
        wav: &Bytes,
        language: Option<&str>,
    ) -> Result<TranscriptionOutcome, DictationError> {
        let mut reason = "initial";
        for attempt in 0..=self.options.automatic_retries {
            let auth_started = std::time::Instant::now();
            let auth = read_oauth(self.auth_file.clone()).await?;
            let auth_read_ms = elapsed_millis(auth_started.elapsed());
            let mut response = self
                .request_transcription(wav, language, &auth, attempt, reason, auth_read_ms)
                .await;
            if let Ok(candidate) = &response
                && candidate.response.status() == reqwest::StatusCode::UNAUTHORIZED
            {
                let refresh_auth_started = std::time::Instant::now();
                let refreshed = read_oauth(self.auth_file.clone()).await?;
                let refresh_auth_read_ms = elapsed_millis(refresh_auth_started.elapsed());
                if refreshed.access_token != auth.access_token {
                    reason = "oauth-refresh";
                    response = self
                        .request_transcription(
                            wav,
                            language,
                            &refreshed,
                            attempt,
                            reason,
                            refresh_auth_read_ms,
                        )
                        .await;
                }
            }
            match response {
                Ok(measured) => {
                    let response = &measured.response;
                    let status = response.status();
                    if let Some((delay, message)) =
                        retry_response(response, attempt, self.options.base_retry_delay)
                    {
                        if attempt == self.options.automatic_retries || delay > MAX_AUTOMATIC_DELAY
                        {
                            return Ok(TranscriptionOutcome::Retryable {
                                retry_after: delay,
                                message,
                            });
                        }
                        warn!(
                            status = "dictation-retry-scheduled",
                            attempt,
                            retry_after_ms = delay.as_millis()
                        );
                        tokio::time::sleep(delay).await;
                        reason = "response-retry";
                        continue;
                    }
                    if status == reqwest::StatusCode::UNAUTHORIZED {
                        return Err(DictationError::OAuthUnavailable);
                    }
                    if !status.is_success() {
                        return Err(DictationError::Http(status.as_u16()));
                    }
                    return consume_transcription_response(measured, attempt, reason).await;
                }
                Err(error) => {
                    warn!(
                        status = "dictation-transcription-attempt-failed",
                        attempt,
                        reason,
                        is_connect = error.is_connect(),
                        is_timeout = error.is_timeout(),
                        is_request = error.is_request(),
                        is_body = error.is_body(),
                        err = ?error,
                    );
                    if attempt == self.options.automatic_retries {
                        return Err(if error.is_timeout() {
                            DictationError::Timeout
                        } else {
                            DictationError::Transport
                        });
                    }
                    let delay = automatic_delay(attempt, self.options.base_retry_delay);
                    warn!(
                        status = "dictation-retry-scheduled",
                        reason = "transport",
                        attempt,
                        retry_after_ms = delay.as_millis()
                    );
                    tokio::time::sleep(delay).await;
                    reason = "transport-retry";
                }
            }
        }
        Err(DictationError::Transport)
    }

    async fn request_transcription(
        &self,
        wav: &Bytes,
        language: Option<&str>,
        auth: &OAuth,
        attempt: usize,
        reason: &'static str,
        auth_read_ms: u64,
    ) -> Result<MeasuredResponse, reqwest::Error> {
        let request_id = next_request_id();
        let total_started = std::time::Instant::now();
        // `Bytes::clone` is reference-counted. Retries reuse the same immutable
        // recording instead of allocating and copying the whole WAV again.
        let (audio_body, upload_probe) =
            metrics::instrumented_audio_body(wav.clone(), total_started);
        let request_build_started = std::time::Instant::now();
        let part = reqwest::multipart::Part::stream_with_length(
            audio_body,
            u64::try_from(wav.len()).unwrap_or(u64::MAX),
        )
        .file_name("dictation.wav")
        .mime_str("audio/wav")?;
        let mut form = reqwest::multipart::Form::new().part("file", part);
        if let Some(language) = language {
            form = form.text("language", language.to_owned());
        }
        let request = self
            .client
            .post(self.endpoint.as_ref())
            .header("authorization", format!("Bearer {}", auth.access_token))
            .header("chatgpt-account-id", &auth.account_id)
            .header("originator", "codex_desktop")
            .header("origin", "https://chatgpt.com")
            .header("referer", "https://chatgpt.com/")
            .header("accept", "application/json, text/plain, */*")
            .header(
                "user-agent",
                "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/138.0.0.0 Safari/537.36",
            )
            // Keep the browser identity internally consistent. Advertising a
            // Chromium UA without its client hints made the private ChatGPT
            // route more likely to answer with a Cloudflare challenge.
            .header(
                "sec-ch-ua",
                "\"Chromium\";v=\"138\", \"Not=A?Brand\";v=\"24\"",
            )
            .header("sec-ch-ua-mobile", "?0")
            .header("sec-ch-ua-platform", "\"Linux\"")
            .header("sec-fetch-dest", "empty")
            .header("sec-fetch-mode", "cors")
            .header("sec-fetch-site", "same-origin")
            .multipart(form)
            .build()?;
        let request_build_ms = elapsed_millis(request_build_started.elapsed());
        let network_probe = RequestNetworkProbe::new(request_id);
        let response =
            request_metrics(Arc::clone(&network_probe), self.client.execute(request)).await;
        let request_to_headers_ms = elapsed_millis(total_started.elapsed());
        let observation = metrics::ResponseHeaderObservation {
            request_id,
            auth_read_ms,
            request_build_ms,
            request_to_headers_ms,
            audio_bytes: u64::try_from(wav.len()).unwrap_or(u64::MAX),
            attempt,
            reason,
        };
        let response = match response {
            Ok(response) => response,
            Err(error) => {
                metrics::log_request_failure(&error, &upload_probe, &network_probe, &observation);
                return Err(error);
            }
        };
        metrics::log_response_headers(&response, &upload_probe, &network_probe, &observation);
        Ok(MeasuredResponse {
            response,
            request_id,
            total_started,
        })
    }
}

async fn consume_transcription_response(
    measured: MeasuredResponse,
    attempt: usize,
    reason: &'static str,
) -> Result<TranscriptionOutcome, DictationError> {
    let response_body_started = std::time::Instant::now();
    let body = bounded_response(measured.response, measured.request_id).await?;
    let response_body_ms = elapsed_millis(response_body_started.elapsed());
    let parse_started = std::time::Instant::now();
    let parsed = serde_json::from_slice::<Value>(&body).map_err(|error| {
        warn!(
            status = "dictation-openai-response-consume-failed",
            request_id = measured.request_id,
            stage = "json-parse",
            response_body_ms,
            response_body_bytes = body.len(),
            err = ?error,
        );
        DictationError::InvalidResponse
    })?;
    let parse_ms = elapsed_millis(parse_started.elapsed());
    let Some(text) = parsed.get("text").and_then(Value::as_str) else {
        warn!(
            status = "dictation-openai-response-consume-failed",
            request_id = measured.request_id,
            stage = "missing-text",
            response_body_ms,
            response_body_bytes = body.len(),
            parse_ms,
        );
        return Err(DictationError::MissingText);
    };
    info!(
        status = "dictation-openai-response-consumed",
        request_id = measured.request_id,
        response_body_ms,
        response_body_bytes = body.len(),
        parse_ms,
        total_request_ms = measured.total_started.elapsed().as_millis(),
        attempt,
        reason,
    );
    Ok(TranscriptionOutcome::Text(text.to_owned()))
}

include!("dictation/support.rs");
