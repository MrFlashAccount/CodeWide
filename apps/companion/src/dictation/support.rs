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
            upload_metrics: session.upload_metrics.clone(),
            last_activity_ms: session.last_activity_ms,
        }
    }

    fn into_session(self, directory: PathBuf) -> Session {
        let mut upload_metrics = self.upload_metrics;
        if upload_metrics.created_at_unix_ms == 0 {
            upload_metrics.created_at_unix_ms = self.last_activity_ms;
        }
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
            opus_decoder: None,
            upload_metrics,
            last_activity_ms: self.last_activity_ms,
        }
    }
}

impl DictationUploadMetrics {
    fn record_batch(
        &mut self,
        received_at_unix_ms: u64,
        batch: &DecodedBatchMetrics,
        processing_ms: u64,
    ) {
        self.first_chunk_at_unix_ms
            .get_or_insert(received_at_unix_ms);
        self.last_chunk_at_unix_ms = Some(received_at_unix_ms);
        self.encoded_audio_bytes = self
            .encoded_audio_bytes
            .saturating_add(batch.encoded_audio_bytes);
        self.base64_audio_bytes = self
            .base64_audio_bytes
            .saturating_add(batch.base64_audio_bytes);
        self.opus_chunks = self.opus_chunks.saturating_add(batch.opus_chunks);
        self.pcm_chunks = self.pcm_chunks.saturating_add(batch.pcm_chunks);
        self.append_processing_ms_total = self
            .append_processing_ms_total
            .saturating_add(processing_ms);
        self.append_processing_ms_max = self.append_processing_ms_max.max(processing_ms);
    }
}

impl DecodedBatchMetrics {
    fn record(&mut self, chunk: &DecodedAudioChunk) {
        self.encoded_audio_bytes = self.encoded_audio_bytes.saturating_add(chunk.encoded_bytes);
        self.base64_audio_bytes = self.base64_audio_bytes.saturating_add(chunk.base64_bytes);
        if chunk.opus {
            self.opus_chunks = self.opus_chunks.saturating_add(1);
        } else {
            self.pcm_chunks = self.pcm_chunks.saturating_add(1);
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
        for (id, candidate, directory) in expired {
            if fs::remove_dir_all(directory).await.is_err() {
                continue;
            }
            let mut current = sessions.lock().await;
            if current
                .get(&id)
                .is_some_and(|session| Arc::ptr_eq(session, &candidate))
            {
                current.remove(&id);
            }
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

async fn bounded_response(
    response: reqwest::Response,
    request_id: u64,
) -> Result<Vec<u8>, DictationError> {
    let mut stream = response.bytes_stream();
    let mut body = Vec::new();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|error| {
            warn!(
                status = "dictation-openai-response-consume-failed",
                request_id,
                stage = "response-body",
                response_body_bytes = body.len(),
                err = ?error,
            );
            DictationError::Transport
        })?;
        if body.len().saturating_add(chunk.len()) > MAX_RESPONSE_BYTES {
            warn!(
                status = "dictation-openai-response-consume-failed",
                request_id,
                stage = "response-body-limit",
                response_body_bytes = body.len(),
                response_chunk_bytes = chunk.len(),
                max_response_bytes = MAX_RESPONSE_BYTES,
            );
            return Err(DictationError::InvalidResponse);
        }
        body.extend_from_slice(&chunk);
    }
    Ok(body)
}

fn decode_base64(raw: &str) -> Result<Vec<u8>, DictationError> {
    let raw = Some(raw)
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

fn decode_audio_chunk(
    chunk: &Value,
    max_chunk_bytes: usize,
    opus_decoder: &mut Option<OpusDecoder>,
) -> Result<DecodedAudioChunk, DictationError> {
    let sample_rate = bounded_u32(chunk, "sampleRate", 8_000, 96_000)?;
    let channels = bounded_u16(chunk, "numChannels", 1, 2)?;
    let samples_per_channel = bounded_u64(chunk, "samplesPerChannel", 1, 10_000_000)?;
    let data = chunk
        .get("data")
        .and_then(Value::as_str)
        .ok_or(DictationError::InvalidBase64)?;
    let base64_bytes = u64::try_from(data.len()).unwrap_or(u64::MAX);
    let wire_bytes = decode_base64(data)?;
    if wire_bytes.len() > max_chunk_bytes {
        return Err(DictationError::ChunkTooLarge);
    }
    let encoded_bytes = u64::try_from(wire_bytes.len()).unwrap_or(u64::MAX);
    let expected_bytes = samples_per_channel
        .checked_mul(u64::from(channels))
        .and_then(|value| value.checked_mul(2))
        .ok_or(DictationError::InvalidChunkSize)?;
    if expected_bytes > u64::try_from(max_chunk_bytes).unwrap_or(u64::MAX) {
        return Err(DictationError::ChunkTooLarge);
    }
    let encoding = chunk
        .get("encoding")
        .map(|value| {
            value
                .as_str()
                .ok_or(DictationError::InvalidParams("encoding"))
        })
        .transpose()?
        .unwrap_or("pcm_s16le");
    let opus = encoding == "opus";
    let bytes = if opus {
        match decode_opus_chunk(&wire_bytes, sample_rate, channels, opus_decoder) {
            Ok(decoded) => decoded,
            Err(error) => {
                *opus_decoder = None;
                return Err(error);
            }
        }
    } else if encoding == "pcm_s16le" {
        wire_bytes
    } else {
        return Err(DictationError::InvalidParams("encoding"));
    };
    if u64::try_from(bytes.len()).unwrap_or(u64::MAX) != expected_bytes {
        return Err(DictationError::InvalidChunkSize);
    }
    let signal_quality = quality(&bytes);
    let quality_samples = u32::try_from(signal_quality.samples.max(1))
        .map_err(|_| DictationError::InvalidChunkSize)?;
    Ok(DecodedAudioChunk {
        bytes,
        encoded_bytes,
        base64_bytes,
        opus,
        sample_rate,
        channels,
        samples_per_channel,
        rms_ppm: ratio_ppm(
            (signal_quality.sum_squares / f64::from(quality_samples)).sqrt(),
        ),
    })
}

fn elapsed_millis(duration: Duration) -> u64 {
    u64::try_from(duration.as_millis()).unwrap_or(u64::MAX)
}

fn log_dictation_metrics(session: &Session, observation: &DictationFinishObservation) {
    let metrics = &session.upload_metrics;
    let first_chunk_at_ms = metrics
        .first_chunk_at_unix_ms
        .unwrap_or(observation.finish_received_at_ms);
    let last_chunk_at_ms = metrics.last_chunk_at_unix_ms.unwrap_or(first_chunk_at_ms);
    let compression_ratio_x100 = if metrics.encoded_audio_bytes == 0 {
        0
    } else {
        session
            .bytes
            .saturating_mul(100)
            .checked_div(metrics.encoded_audio_bytes)
            .unwrap_or(0)
    };
    let accounted_finish_ms = observation
        .session_acquire_ms
        .saturating_add(observation.seal_persist_ms)
        .saturating_add(observation.transcription_ms)
        .saturating_add(observation.final_persist_ms);
    info!(
        status = "dictation-finish",
        completed = observation.completed,
        finish_total_ms = observation.finish_total_ms,
        session_acquire_ms = observation.session_acquire_ms,
        seal_persist_ms = observation.seal_persist_ms,
        transcription_ms = observation.transcription_ms,
        final_persist_ms = observation.final_persist_ms,
        unattributed_finish_ms = observation.finish_total_ms.saturating_sub(accounted_finish_ms),
        recording_ms = observation.recording_ms,
        session_to_first_chunk_ms = first_chunk_at_ms
            .saturating_sub(metrics.created_at_unix_ms),
        first_chunk_to_finish_ms = observation
            .finish_received_at_ms
            .saturating_sub(first_chunk_at_ms),
        upload_receive_span_ms = last_chunk_at_ms.saturating_sub(first_chunk_at_ms),
        last_chunk_to_finish_ms = observation
            .finish_received_at_ms
            .saturating_sub(last_chunk_at_ms),
        append_processing_ms_total = metrics.append_processing_ms_total,
        append_processing_ms_max = metrics.append_processing_ms_max,
        encoded_audio_bytes = metrics.encoded_audio_bytes,
        base64_audio_bytes = metrics.base64_audio_bytes,
        decoded_pcm_bytes = session.bytes,
        compression_ratio_x100,
        opus_chunks = metrics.opus_chunks,
        pcm_chunks = metrics.pcm_chunks,
        audio_chunks = session.audio_chunks,
        append_batches = session.append_batches,
        recording_segments = session.transcripts.len(),
        transcript_bytes = observation.transcript_bytes,
        transcript_chars = observation.transcript_chars,
        sample_rate = session.sample_rate,
        channels = session.channels,
    );
}

fn decode_opus_chunk(
    framed: &[u8],
    sample_rate: u32,
    channels: u16,
    decoder: &mut Option<OpusDecoder>,
) -> Result<Vec<u8>, DictationError> {
    if !matches!(sample_rate, 8_000 | 12_000 | 16_000 | 24_000 | 48_000) {
        return Err(DictationError::InvalidOpus);
    }
    let opus_channels = usize::from(channels);
    if decoder.is_none() {
        *decoder = Some(
            OpusDecoder::new(
                i32::try_from(sample_rate).map_err(|_| DictationError::InvalidOpus)?,
                opus_channels,
            )
                .map_err(|_| DictationError::InvalidOpus)?,
        );
    }
    let decoder = decoder.as_mut().ok_or(DictationError::InvalidOpus)?;
    let mut offset = 0_usize;
    let mut pcm = Vec::new();
    while offset < framed.len() {
        let header_end = offset.checked_add(2).ok_or(DictationError::InvalidOpus)?;
        let header = framed
            .get(offset..header_end)
            .ok_or(DictationError::InvalidOpus)?;
        let packet_bytes = usize::from(u16::from_be_bytes([header[0], header[1]]));
        if packet_bytes == 0 || packet_bytes > MAX_OPUS_PACKET_BYTES {
            return Err(DictationError::InvalidOpus);
        }
        let packet_end = header_end
            .checked_add(packet_bytes)
            .ok_or(DictationError::InvalidOpus)?;
        let packet = framed
            .get(header_end..packet_end)
            .ok_or(DictationError::InvalidOpus)?;
        let packet_samples = opus_pure::packet::samples(
            packet,
            i32::try_from(sample_rate).map_err(|_| DictationError::InvalidOpus)?,
        )
            .map_err(|_| DictationError::InvalidOpus)?;
        let sample_values = packet_samples
            .checked_mul(usize::from(channels))
            .ok_or(DictationError::InvalidOpus)?;
        let mut pcm_samples = vec![0_i16; sample_values];
        let decoded_samples = decoder
            .decode_s16(packet, packet_samples, &mut pcm_samples)
            .map_err(|_| DictationError::InvalidOpus)?;
        if decoded_samples != packet_samples {
            return Err(DictationError::InvalidOpus);
        }
        pcm.reserve(sample_values.saturating_mul(2));
        for sample in pcm_samples {
            pcm.extend_from_slice(&sample.to_le_bytes());
        }
        offset = packet_end;
    }
    if pcm.is_empty() {
        return Err(DictationError::InvalidOpus);
    }
    Ok(pcm)
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

    use opus_pure::{Application, MAX_PACKET_BYTES, OpusEncoder};

    use super::{
        DecodedBatchMetrics, DictationError, DictationService, DictationUploadMetrics,
        QualityFrame, cloudflare_retry_delay, decode_opus_chunk, transcription_bounds, wav_header,
    };

    #[test]
    fn dictation_upload_metrics_preserve_first_arrival_and_accumulate_batches() {
        let mut metrics = DictationUploadMetrics {
            created_at_unix_ms: 100,
            ..DictationUploadMetrics::default()
        };
        metrics.record_batch(
            150,
            &DecodedBatchMetrics {
                encoded_audio_bytes: 100,
                base64_audio_bytes: 136,
                opus_chunks: 5,
                pcm_chunks: 0,
            },
            3,
        );
        metrics.record_batch(
            1_150,
            &DecodedBatchMetrics {
                encoded_audio_bytes: 90,
                base64_audio_bytes: 120,
                opus_chunks: 4,
                pcm_chunks: 1,
            },
            5,
        );

        assert_eq!(metrics.first_chunk_at_unix_ms, Some(150));
        assert_eq!(metrics.last_chunk_at_unix_ms, Some(1_150));
        assert_eq!(metrics.encoded_audio_bytes, 190);
        assert_eq!(metrics.base64_audio_bytes, 256);
        assert_eq!(metrics.opus_chunks, 9);
        assert_eq!(metrics.pcm_chunks, 1);
        assert_eq!(metrics.append_processing_ms_total, 8);
        assert_eq!(metrics.append_processing_ms_max, 5);
    }

    #[test]
    fn opus_transport_decodes_framed_packets_to_pcm16() {
        let mut encoder = OpusEncoder::new(48_000, 1, Application::Voip)
            .unwrap_or_else(|error| panic!("{error}"));
        encoder.bitrate_bps = 24_000;
        let pcm = (0..960)
            .map(|index| i16::try_from((index % 200) * 100).unwrap_or_default())
            .collect::<Vec<_>>();
        let mut packet = vec![0_u8; MAX_PACKET_BYTES];
        let packet_bytes = encoder
            .encode_s16(&pcm, 960, &mut packet)
            .unwrap_or_else(|error| panic!("{error}"));
        packet.truncate(packet_bytes);
        let mut framed = Vec::with_capacity(packet.len() + 2);
        framed.extend_from_slice(&u16::try_from(packet.len()).unwrap_or_default().to_be_bytes());
        framed.extend_from_slice(&packet);

        let decoded = decode_opus_chunk(&framed, 48_000, 1, &mut None)
            .unwrap_or_else(|error| panic!("{error}"));

        assert_eq!(decoded.len(), 960 * 2);
        assert!(decoded.iter().any(|byte| *byte != 0));
    }

    #[test]
    fn opus_transport_rejects_truncated_packet_framing() {
        assert!(matches!(
            decode_opus_chunk(&[0, 3, 1, 2], 48_000, 1, &mut None),
            Err(DictationError::InvalidOpus)
        ));
    }

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

    #[tokio::test]
    async fn v2_cleanup_failure_retains_bounded_session_ownership() {
        let root = tempfile::tempdir().unwrap_or_else(|error| panic!("{error}"));
        let service = DictationService::open(
            root.path().join("absent-auth.json"),
            root.path().join("sessions"),
        )
        .await
        .unwrap_or_else(|error| panic!("{error}"));
        let session_id = service
            .v2_start("audience", None)
            .await
            .unwrap_or_else(|error| panic!("{error}"));
        let session = service
            .sessions
            .lock()
            .await
            .get(&session_id)
            .cloned()
            .unwrap_or_else(|| panic!("session missing"));
        let directory = session.lock().await.directory.clone();
        tokio::fs::remove_dir_all(&directory)
            .await
            .unwrap_or_else(|error| panic!("{error}"));
        tokio::fs::write(&directory, b"force remove_dir_all failure")
            .await
            .unwrap_or_else(|error| panic!("{error}"));

        assert!(matches!(
            service.v2_cancel("audience", &session_id).await,
            Err(DictationError::Storage)
        ));
        assert!(service.sessions.lock().await.contains_key(&session_id));
        assert!(matches!(
            service.v2_start("audience", None).await,
            Err(DictationError::Storage)
        ));
        let owned = service
            .sessions
            .lock()
            .await
            .values()
            .filter(|session| {
                session
                    .try_lock()
                    .is_ok_and(|session| session.client_id == "audience")
            })
            .count();
        assert_eq!(
            owned, 1,
            "failed replacement must retain exactly the old owner"
        );
    }
}
