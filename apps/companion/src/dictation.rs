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
                        error = ?error
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

impl StoredSession {
    fn from_session(session: &Session) -> Self {
        Self {
            version: SESSION_MANIFEST_VERSION,
            client_id: session.client_id.clone(),
            sample_rate: session.sample_rate,
            channels: session.channels,
            bytes: session.bytes,
            audio_chunks: session.audio_chunks,
            append_batches: session.append_batches,
            frames: session.frames.clone(),
            language: session.language.clone(),
            sealed: session.sealed,
            next_offset: session.next_offset,
            transcripts: session.transcripts.clone(),
            completed: session.completed.clone(),
            accepted_batches: session.accepted_batches.clone(),
            last_activity_ms: session.last_activity_ms,
        }
    }

    fn into_session(self, directory: PathBuf) -> Session {
        Session {
            client_id: self.client_id,
            pcm_path: directory.join("recording.pcm"),
            directory,
            sample_rate: self.sample_rate,
            channels: self.channels,
            bytes: self.bytes,
            audio_chunks: self.audio_chunks,
            append_batches: self.append_batches,
            frames: self.frames,
            language: self.language,
            sealed: self.sealed,
            next_offset: self.next_offset,
            transcripts: self.transcripts,
            completed: self.completed,
            accepted_batches: self.accepted_batches,
            last_activity_ms: self.last_activity_ms,
        }
    }
}

async fn persist_session(session: &Session) -> Result<(), DictationError> {
    let bytes = serde_json::to_vec(&StoredSession::from_session(session))
        .map_err(|_| DictationError::Storage)?;
    let manifest = session.directory.join(SESSION_MANIFEST);
    let temporary = session
        .directory
        .join(format!("{SESSION_MANIFEST}.tmp-{}", std::process::id()));
    let mut file = OpenOptions::new()
        .create(true)
        .truncate(true)
        .write(true)
        .mode(0o600)
        .open(&temporary)
        .await
        .map_err(|_| DictationError::Storage)?;
    file.write_all(&bytes)
        .await
        .map_err(|_| DictationError::Storage)?;
    file.sync_all().await.map_err(|_| DictationError::Storage)?;
    fs::rename(temporary, manifest)
        .await
        .map_err(|_| DictationError::Storage)
}

async fn recover_sessions(
    root: &Path,
    max_audio_bytes: u64,
) -> HashMap<String, Arc<Mutex<Session>>> {
    let mut recovered = HashMap::new();
    let Ok(mut entries) = fs::read_dir(root).await else {
        return recovered;
    };
    while let Ok(Some(entry)) = entries.next_entry().await {
        let Some(id) = entry.file_name().to_str().map(ToOwned::to_owned) else {
            continue;
        };
        if id.len() != 48 || !id.bytes().all(|byte| byte.is_ascii_hexdigit()) {
            continue;
        }
        let directory = entry.path();
        let Ok(raw) = fs::read(directory.join(SESSION_MANIFEST)).await else {
            continue;
        };
        let Ok(stored) = serde_json::from_slice::<StoredSession>(&raw) else {
            continue;
        };
        if stored.version != SESSION_MANIFEST_VERSION
            || stored.client_id.is_empty()
            || stored.bytes > max_audio_bytes
            || stored.next_offset > stored.bytes
        {
            continue;
        }
        let pcm_path = directory.join("recording.pcm");
        let Ok(file) = OpenOptions::new()
            .read(true)
            .write(true)
            .open(&pcm_path)
            .await
        else {
            continue;
        };
        let Ok(metadata) = file.metadata().await else {
            continue;
        };
        if metadata.len() < stored.bytes {
            continue;
        }
        if metadata.len() != stored.bytes && file.set_len(stored.bytes).await.is_err() {
            continue;
        }
        recovered.insert(id, Arc::new(Mutex::new(stored.into_session(directory))));
    }
    recovered
}

async fn cleanup_idle_sessions(
    sessions: Arc<Mutex<HashMap<String, Arc<Mutex<Session>>>>>,
    ttl: Duration,
    interval: Duration,
) {
    let mut ticker = tokio::time::interval(interval);
    ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    loop {
        ticker.tick().await;
        let now = unix_time_ms();
        let ttl_ms = u64::try_from(ttl.as_millis()).unwrap_or(u64::MAX);
        let candidates = sessions
            .lock()
            .await
            .iter()
            .map(|(id, session)| (id.clone(), session.clone()))
            .collect::<Vec<_>>();
        let mut expired = Vec::new();
        for (id, session) in candidates {
            let state = session.lock().await;
            if now.saturating_sub(state.last_activity_ms) >= ttl_ms {
                expired.push((id, session.clone(), state.directory.clone()));
            }
        }
        if expired.is_empty() {
            continue;
        }
        let directories = {
            let mut current = sessions.lock().await;
            expired
                .into_iter()
                .filter_map(|(id, candidate, directory)| {
                    current
                        .get(&id)
                        .is_some_and(|session| Arc::ptr_eq(session, &candidate))
                        .then(|| current.remove(&id).map(|_| directory))
                        .flatten()
                })
                .collect::<Vec<_>>()
        };
        for directory in directories {
            let _ = fs::remove_dir_all(directory).await;
        }
    }
}

async fn read_oauth(path: PathBuf) -> Result<OAuth, DictationError> {
    tokio::task::spawn_blocking(move || {
        let mut options = StdOpenOptions::new();
        options.read(true).custom_flags(libc::O_NOFOLLOW);
        let file = options
            .open(path)
            .map_err(|_| DictationError::OAuthUnavailable)?;
        let metadata = file
            .metadata()
            .map_err(|_| DictationError::OAuthUnreadable)?;
        if !metadata.is_file() {
            return Err(DictationError::OAuthUnreadable);
        }
        if metadata.permissions().mode() & 0o077 != 0 {
            return Err(DictationError::OAuthPermissions);
        }
        let mut raw = Vec::new();
        file.take(1024 * 1024)
            .read_to_end(&mut raw)
            .map_err(|_| DictationError::OAuthUnreadable)?;
        let stored = serde_json::from_slice::<StoredAuth>(&raw)
            .map_err(|_| DictationError::OAuthUnreadable)?;
        let tokens = stored.tokens.ok_or(DictationError::OAuthUnavailable)?;
        let access_token = tokens
            .access_token
            .filter(|value| value.len() >= 32)
            .ok_or(DictationError::OAuthUnavailable)?;
        let account_id = tokens
            .account_id
            .filter(|value| !value.is_empty())
            .ok_or(DictationError::OAuthUnavailable)?;
        Ok(OAuth {
            access_token,
            account_id,
        })
    })
    .await
    .map_err(|_| DictationError::OAuthUnreadable)?
}

async fn wav_segment(
    path: &Path,
    offset: u64,
    bytes: u64,
    sample_rate: u32,
    channels: u16,
) -> Result<Vec<u8>, DictationError> {
    let pcm_len = usize::try_from(bytes).map_err(|_| DictationError::RecordingTooLarge)?;
    let mut output = Vec::with_capacity(44 + pcm_len);
    output.extend_from_slice(&wav_header(
        u32::try_from(bytes).map_err(|_| DictationError::RecordingTooLarge)?,
        sample_rate,
        channels,
    ));
    let mut file = fs::File::open(path)
        .await
        .map_err(|_| DictationError::Storage)?;
    file.seek(std::io::SeekFrom::Start(offset))
        .await
        .map_err(|_| DictationError::Storage)?;
    let mut pcm = vec![0_u8; pcm_len];
    file.read_exact(&mut pcm)
        .await
        .map_err(|_| DictationError::Storage)?;
    output.extend_from_slice(&pcm);
    Ok(output)
}

fn wav_header(pcm_bytes: u32, sample_rate: u32, channels: u16) -> [u8; 44] {
    let mut header = [0_u8; 44];
    header[0..4].copy_from_slice(b"RIFF");
    header[4..8].copy_from_slice(&pcm_bytes.saturating_add(36).to_le_bytes());
    header[8..12].copy_from_slice(b"WAVE");
    header[12..16].copy_from_slice(b"fmt ");
    header[16..20].copy_from_slice(&16_u32.to_le_bytes());
    header[20..22].copy_from_slice(&1_u16.to_le_bytes());
    header[22..24].copy_from_slice(&channels.to_le_bytes());
    header[24..28].copy_from_slice(&sample_rate.to_le_bytes());
    header[28..32].copy_from_slice(
        &sample_rate
            .saturating_mul(u32::from(channels))
            .saturating_mul(2)
            .to_le_bytes(),
    );
    header[32..34].copy_from_slice(&channels.saturating_mul(2).to_le_bytes());
    header[34..36].copy_from_slice(&16_u16.to_le_bytes());
    header[36..40].copy_from_slice(b"data");
    header[40..44].copy_from_slice(&pcm_bytes.to_le_bytes());
    header
}

struct Quality {
    samples: u64,
    sum_squares: f64,
}

fn quality(bytes: &[u8]) -> Quality {
    let mut samples = 0_u64;
    let mut sum_squares = 0.0;
    for sample in bytes.chunks_exact(2) {
        let value = f64::from(i16::from_le_bytes([sample[0], sample[1]])) / 32_768.0;
        samples = samples.saturating_add(1);
        sum_squares += value * value;
    }
    Quality {
        samples,
        sum_squares,
    }
}

fn transcription_bounds(frames: &[QualityFrame], total_bytes: u64) -> (u64, u64) {
    let Some(first) = frames
        .iter()
        .position(|frame| frame.rms_ppm >= QUIET_RMS_PPM)
    else {
        return (0, total_bytes);
    };
    let last = frames
        .iter()
        .rposition(|frame| frame.rms_ppm >= QUIET_RMS_PPM)
        .unwrap_or(first);
    let mut start = first;
    let mut padding = EDGE_PADDING_MS;
    while start > 0 && padding > 0.0 {
        start -= 1;
        padding -= frames[start].duration_ms;
    }
    let mut end = last;
    padding = EDGE_PADDING_MS;
    while end + 1 < frames.len() && padding > 0.0 {
        end += 1;
        padding -= frames[end].duration_ms;
    }
    (
        frames[start].byte_start,
        frames[end]
            .byte_start
            .saturating_add(frames[end].byte_length),
    )
}

fn retry_response(
    response: &reqwest::Response,
    attempt: usize,
    base: Duration,
) -> Option<(Duration, String)> {
    let status = response.status();
    if status == reqwest::StatusCode::TOO_MANY_REQUESTS {
        let delay = retry_after(response, attempt, base);
        return Some((
            delay,
            format!(
                "OpenAI transcription is rate limited; retry in {}s",
                delay.as_secs().max(1)
            ),
        ));
    }
    if status == reqwest::StatusCode::FORBIDDEN
        && response
            .headers()
            .get("cf-mitigated")
            .and_then(|value| value.to_str().ok())
            == Some("challenge")
    {
        return Some((
            cloudflare_retry_delay(attempt),
            "ChatGPT transcription was blocked by Cloudflare on the host network".into(),
        ));
    }
    if matches!(status.as_u16(), 408 | 425) || status.is_server_error() {
        return Some((
            automatic_delay(attempt, base),
            format!("ChatGPT transcription is temporarily unavailable (HTTP {status})"),
        ));
    }
    None
}

fn cloudflare_retry_delay(attempt: usize) -> Duration {
    automatic_delay(attempt, CLOUDFLARE_RETRY_BASE_DELAY)
}

fn retry_after(response: &reqwest::Response, attempt: usize, base: Duration) -> Duration {
    let Some(raw) = response
        .headers()
        .get("retry-after")
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
    else {
        return automatic_delay(attempt, base);
    };
    if let Ok(seconds) = raw.parse::<f64>()
        && seconds.is_finite()
        && seconds >= 0.0
    {
        let duration = Duration::try_from_secs_f64(seconds).unwrap_or(Duration::MAX);
        return Duration::from_millis(u64::try_from(duration.as_millis()).unwrap_or(u64::MAX));
    }
    if let Ok(when) = httpdate::parse_http_date(raw) {
        return when.duration_since(SystemTime::now()).unwrap_or_default();
    }
    automatic_delay(attempt, base)
}

fn automatic_delay(attempt: usize, base: Duration) -> Duration {
    let shift = u32::try_from(attempt).unwrap_or(u32::MAX);
    base.saturating_mul(1_u32.checked_shl(shift).unwrap_or(u32::MAX))
        .min(MAX_AUTOMATIC_DELAY)
}

async fn bounded_response(response: reqwest::Response) -> Result<Vec<u8>, DictationError> {
    let mut stream = response.bytes_stream();
    let mut body = Vec::new();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|_| DictationError::Transport)?;
        if body.len().saturating_add(chunk.len()) > MAX_RESPONSE_BYTES {
            return Err(DictationError::InvalidResponse);
        }
        body.extend_from_slice(&chunk);
    }
    Ok(body)
}

fn decode_base64(value: Option<&Value>) -> Result<Vec<u8>, DictationError> {
    let raw = value
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty() && value.len() % 4 == 0)
        .ok_or(DictationError::InvalidBase64)?;
    let decoded = STANDARD
        .decode(raw)
        .map_err(|_| DictationError::InvalidBase64)?;
    if STANDARD.encode(&decoded) != raw {
        return Err(DictationError::InvalidBase64);
    }
    Ok(decoded)
}

fn bounded_u64(
    params: &Value,
    name: &'static str,
    minimum: u64,
    maximum: u64,
) -> Result<u64, DictationError> {
    params
        .get(name)
        .and_then(Value::as_u64)
        .filter(|value| (minimum..=maximum).contains(value))
        .ok_or(DictationError::InvalidParams(name))
}

fn bounded_u32(
    params: &Value,
    name: &'static str,
    minimum: u32,
    maximum: u32,
) -> Result<u32, DictationError> {
    bounded_u64(params, name, u64::from(minimum), u64::from(maximum))?
        .try_into()
        .map_err(|_| DictationError::InvalidParams(name))
}

fn bounded_u16(
    params: &Value,
    name: &'static str,
    minimum: u16,
    maximum: u16,
) -> Result<u16, DictationError> {
    bounded_u64(params, name, u64::from(minimum), u64::from(maximum))?
        .try_into()
        .map_err(|_| DictationError::InvalidParams(name))
}

fn string_param<'a>(params: &'a Value, name: &'static str) -> Result<&'a str, DictationError> {
    params
        .get(name)
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .ok_or(DictationError::InvalidParams(name))
}

fn ratio_ppm(value: f64) -> f64 {
    (value.clamp(0.0, 1.0) * 1_000_000.0).round()
}

fn random_id() -> Result<String, DictationError> {
    let mut bytes = [0_u8; 24];
    rand::rngs::OsRng
        .try_fill_bytes(&mut bytes)
        .map_err(|_| DictationError::Storage)?;
    Ok(hex::encode(bytes))
}

fn unix_time_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .try_into()
        .unwrap_or(u64::MAX)
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use super::{QualityFrame, cloudflare_retry_delay, transcription_bounds, wav_header};

    #[test]
    fn wav_header_and_quiet_edge_bounds_match_pcm() {
        let header = wav_header(8, 24_000, 1);
        assert_eq!(&header[0..4], b"RIFF");
        assert_eq!(&header[8..12], b"WAVE");
        assert_eq!(
            u32::from_le_bytes(header[24..28].try_into().unwrap_or_default()),
            24_000
        );
        assert_eq!(
            u32::from_le_bytes(header[40..44].try_into().unwrap_or_default()),
            8
        );
        let frames = vec![
            QualityFrame {
                byte_start: 0,
                byte_length: 2,
                duration_ms: 100.0,
                rms_ppm: 0.0,
            },
            QualityFrame {
                byte_start: 2,
                byte_length: 2,
                duration_ms: 100.0,
                rms_ppm: 6_000.0,
            },
            QualityFrame {
                byte_start: 4,
                byte_length: 2,
                duration_ms: 100.0,
                rms_ppm: 0.0,
            },
        ];
        assert_eq!(transcription_bounds(&frames, 6), (0, 6));
    }

    #[test]
    fn cloudflare_challenges_do_not_use_rate_limit_backoff() {
        assert_eq!(cloudflare_retry_delay(0), Duration::from_millis(100));
        assert_eq!(cloudflare_retry_delay(1), Duration::from_millis(200));
        assert_eq!(cloudflare_retry_delay(2), Duration::from_millis(400));
    }
}
