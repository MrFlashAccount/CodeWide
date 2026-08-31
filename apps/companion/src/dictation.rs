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
use rand::TryRngCore;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tokio::{
    fs::{self, OpenOptions},
    io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt},
    sync::Mutex,
};
use tracing::{info, warn};

pub(crate) mod v2;

const DEFAULT_ENDPOINT: &str = "https://chatgpt.com/backend-api/transcribe";
const MAX_AUDIO_BYTES: u64 = 192 * 1024 * 1024;
const MAX_CHUNK_BYTES: usize = 1024 * 1024;
const MAX_BATCH_CHUNKS: usize = 64;
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
    last_activity_ms: u64,
}

#[derive(Clone, Deserialize, Serialize)]
struct QualityFrame {
    byte_start: u64,
    byte_length: u64,
    duration_ms: f64,
    rms_ppm: f64,
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
        let mut decoded = Vec::with_capacity(chunks.len());
        let mut appended_bytes = 0_u64;
        let mut sample_rate = session.sample_rate;
        let mut channels = session.channels;
        let mut frames = Vec::with_capacity(chunks.len());
        for chunk in chunks {
            let chunk_rate = bounded_u32(chunk, "sampleRate", 8_000, 96_000)?;
            let chunk_channels = bounded_u16(chunk, "numChannels", 1, 2)?;
            let samples = bounded_u64(chunk, "samplesPerChannel", 1, 10_000_000)?;
            let bytes = decode_base64(chunk.get("data"))?;
            if bytes.len() > self.options.max_chunk_bytes {
                return Err(DictationError::ChunkTooLarge);
            }
            let expected = samples
                .checked_mul(u64::from(chunk_channels))
                .and_then(|value| value.checked_mul(2))
                .ok_or(DictationError::InvalidChunkSize)?;
            if u64::try_from(bytes.len()).unwrap_or(u64::MAX) != expected {
                return Err(DictationError::InvalidChunkSize);
            }
            if sample_rate == 0 {
                sample_rate = chunk_rate;
                channels = chunk_channels;
            } else if sample_rate != chunk_rate || channels != chunk_channels {
                return Err(DictationError::FormatChanged);
            }
            let quality = quality(&bytes);
            let samples_u32 = u32::try_from(samples)
                .map_err(|_| DictationError::InvalidParams("samplesPerChannel"))?;
            let quality_samples = u32::try_from(quality.samples.max(1))
                .map_err(|_| DictationError::InvalidChunkSize)?;
            frames.push(QualityFrame {
                byte_start: session.bytes.saturating_add(appended_bytes),
                byte_length: expected,
                duration_ms: f64::from(samples_u32) * 1_000.0 / f64::from(chunk_rate),
                rms_ppm: ratio_ppm((quality.sum_squares / f64::from(quality_samples)).sqrt()),
            });
            appended_bytes = appended_bytes.saturating_add(expected);
            decoded.push(bytes);
        }
        if session.bytes.saturating_add(appended_bytes) > self.options.max_audio_bytes {
            return Err(DictationError::RecordingTooLarge);
        }
        let mut file = OpenOptions::new()
            .append(true)
            .open(&session.pcm_path)
            .await
            .map_err(|_| DictationError::Storage)?;
        for bytes in decoded {
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
        persist_session(&session).await?;
        Ok(json!({"accepted": true}))
    }

    async fn finish(&self, client_id: &str, params: &Value) -> Result<Value, DictationError> {
        let session = self.owned_session(client_id, params).await?;
        let mut session = session.lock().await;
        if let Some(text) = &session.completed {
            return Ok(json!({"text": text}));
        }
        session.sealed = true;
        session.last_activity_ms = unix_time_ms();
        persist_session(&session).await?;
        if session.bytes == 0 || session.sample_rate == 0 || session.channels == 0 {
            return Err(DictationError::Empty);
        }
        let started = std::time::Instant::now();
        let recording_ms = session
            .frames
            .iter()
            .map(|frame| frame.duration_ms)
            .sum::<f64>()
            .round();
        let outcome = self.transcribe_session(&mut session).await;
        info!(
            status = "dictation-finish",
            duration_ms = started.elapsed().as_millis(),
            recording_ms,
            audio_bytes = session.bytes,
            audio_chunks = session.audio_chunks,
            append_batches = session.append_batches,
            sample_rate = session.sample_rate,
            channels = session.channels,
            completed = matches!(&outcome, Ok(TranscriptionOutcome::Text(_)))
        );
        session.last_activity_ms = unix_time_ms();
        match outcome {
            Ok(TranscriptionOutcome::Text(text)) => {
                session.completed = Some(text.clone());
                persist_session(&session).await?;
                Ok(json!({"text": text}))
            }
            Ok(TranscriptionOutcome::Retryable {
                retry_after,
                message,
            }) => {
                persist_session(&session).await?;
                Ok(json!({
                    "retryable": true,
                    "retryAfterMs": u64::try_from(retry_after.as_millis()).unwrap_or(u64::MAX),
                    "message": message
                }))
            }
            Err(error) => {
                persist_session(&session).await?;
                Ok(json!({
                    "retryable": true,
                    "retryAfterMs": 1_000,
                    "message": error.to_string()
                }))
            }
        }
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
        let (start, end) = transcription_bounds(&session.frames, session.bytes);
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
            let bytes = segment_bytes.min(end - session.next_offset);
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
            match self
                .transcribe_segment(&wav, session.language.as_deref())
                .await?
            {
                TranscriptionOutcome::Text(text) => {
                    if !text.trim().is_empty() {
                        session.transcripts.push(text.trim().to_owned());
                    }
                    session.next_offset = session.next_offset.saturating_add(bytes);
                    session.last_activity_ms = unix_time_ms();
                    persist_session(session).await?;
                }
                retryable @ TranscriptionOutcome::Retryable { .. } => return Ok(retryable),
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
            let auth = read_oauth(self.auth_file.clone()).await?;
            let started = std::time::Instant::now();
            let mut response = self.request_transcription(wav, language, &auth).await;
            if let Ok(candidate) = &response
                && candidate.status() == reqwest::StatusCode::UNAUTHORIZED
            {
                let refreshed = read_oauth(self.auth_file.clone()).await?;
                if refreshed.access_token != auth.access_token {
                    response = self.request_transcription(wav, language, &refreshed).await;
                    reason = "oauth-refresh";
                }
            }
            match response {
                Ok(response) => {
                    let status = response.status();
                    info!(
                        status = "dictation-openai-request",
                        http_status = status.as_u16(),
                        duration_ms = started.elapsed().as_millis(),
                        attempt,
                        reason
                    );
                    if let Some((delay, message)) =
                        retry_response(&response, attempt, self.options.base_retry_delay)
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
                    let body = bounded_response(response).await?;
                    let parsed = serde_json::from_slice::<Value>(&body)
                        .map_err(|_| DictationError::InvalidResponse)?;
                    let text = parsed
                        .get("text")
                        .and_then(Value::as_str)
                        .ok_or(DictationError::MissingText)?;
                    return Ok(TranscriptionOutcome::Text(text.to_owned()));
                }
                Err(error) => {
                    warn!(
                        status = "dictation-openai-request-failed",
                        attempt,
                        reason,
                        is_connect = error.is_connect(),
                        is_timeout = error.is_timeout(),
                        is_request = error.is_request(),
                        is_body = error.is_body()
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
    ) -> Result<reqwest::Response, reqwest::Error> {
        // `Bytes::clone` is reference-counted. Retries reuse the same immutable
        // recording instead of allocating and copying the whole WAV again.
        let part = reqwest::multipart::Part::stream(reqwest::Body::from(wav.clone()))
            .file_name("dictation.wav")
            .mime_str("audio/wav")?;
        let mut form = reqwest::multipart::Form::new().part("file", part);
        if let Some(language) = language {
            form = form.text("language", language.to_owned());
        }
        self.client
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
            .send()
            .await
    }
}

include!("dictation/support.rs");
