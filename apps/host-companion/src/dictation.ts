import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { constants, createReadStream, createWriteStream } from "node:fs";
import { appendFile, mkdtemp, open, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";

type RpcObject = Record<string, unknown>;

type AudioFormat = {
  sampleRate: number;
  numChannels: number;
};

type AudioQualityFrame = {
  byteStart: number;
  byteLength: number;
  durationMs: number;
  rmsPpm: number;
  silentPpm: number;
};

type DictationSession = AudioFormat & {
  id: string;
  clientId: string;
  directory: string;
  pcmPath: string;
  pendingWrite: Promise<void>;
  bytes: number;
  audioChunks: number;
  appendBatches: number;
  sampleCount: number;
  sumSquares: number;
  peakAbsoluteSample: number;
  clippedSamples: number;
  silentSamples: number;
  qualityFrames: AudioQualityFrame[];
  language: string | null;
  captureSource: string | null;
  noiseSuppressor: boolean | null;
  automaticGainControl: boolean | null;
  lastActivityAt: number;
  sealed: boolean;
  nextOffset: number;
  transcripts: string[];
  completedResult: { text: string } | null;
  finishInFlight: Promise<DictationFinishResult> | null;
  acceptedBatchIds: Set<string>;
};

type DictationFinishResult =
  | { text: string }
  | { retryable: true; retryAfterMs: number; message: string };

type CodexOAuth = {
  accessToken: string;
  accountId: string;
};

export type LocalRpcHandler = {
  handles(method: string): boolean;
  handle(clientId: string, method: string, params: RpcObject): Promise<unknown>;
  releaseClient(clientId: string): void;
  close(): void;
};

export type DictationServiceOptions = {
  authFilePath?: string;
  endpoint?: string;
  fetchImpl?: typeof fetch;
  maxAudioBytes?: number;
  maxChunkBytes?: number;
  idleTimeoutMs?: number;
  requestTimeoutMs?: number;
  transcriptionSegmentMs?: number;
  automaticRetryBaseMs?: number;
  maximumAutomaticRetries?: number;
};

// One hour of the Android recorder's PCM16/24 kHz/mono stream is ~173 MB.
// Keep a finite safety boundary while making duration a product limit rather
// than a JS heap limit; bytes are persisted in PrivateTmp as they arrive.
const DEFAULT_MAX_AUDIO_BYTES = 192 * 1024 * 1024;
const DEFAULT_MAX_CHUNK_BYTES = 1024 * 1024;
const DEFAULT_IDLE_TIMEOUT_MS = 2 * 60 * 60_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 60_000;
const MAX_REQUEST_TIMEOUT_MS = 15 * 60_000;
const TRANSCRIPTION_SEGMENT_MS = 8 * 60_000;
const MAX_TRANSCRIPTION_RESPONSE_BYTES = 16 * 1024 * 1024;
const MAX_AUTOMATIC_TRANSCRIPTION_RETRIES = 3;
const MAX_AUTOMATIC_RETRY_DELAY_MS = 60_000;
const DEFAULT_RATE_LIMIT_RETRY_DELAY_MS = 1_000;
const MAX_AUDIO_BATCH_CHUNKS = 64;
const QUIET_FRAME_RMS_PPM = 5_000;
const EDGE_SPEECH_PADDING_MS = 300;
const DICTATION_ENDPOINT = "https://chatgpt.com/backend-api/transcribe";
const DICTATION_PREFIX = "companion/dictation/";

/**
 * Host-owned dictation bridge. OAuth credentials never enter the sync
 * protocol: the Android client uploads raw PCM and receives transcript text.
 */
export class DictationService implements LocalRpcHandler {
  readonly #authFilePath: string;
  readonly #endpoint: string;
  readonly #fetch: typeof fetch | undefined;
  readonly #maxAudioBytes: number;
  readonly #maxChunkBytes: number;
  readonly #idleTimeoutMs: number;
  readonly #requestTimeoutMs: number;
  readonly #transcriptionSegmentMs: number;
  readonly #automaticRetryBaseMs: number;
  readonly #maximumAutomaticRetries: number;
  readonly #sessions = new Map<string, DictationSession>();
  readonly #activeRequests = new Map<string, Set<AbortController>>();
  readonly #cleanupTimer: NodeJS.Timeout;
  #closed = false;

  constructor(options: DictationServiceOptions = {}) {
    this.#authFilePath = options.authFilePath ?? path.join(process.env.CODEX_HOME ?? path.join(homedir(), ".codex"), "auth.json");
    this.#endpoint = options.endpoint ?? DICTATION_ENDPOINT;
    this.#fetch = options.fetchImpl;
    this.#maxAudioBytes = positiveInteger(options.maxAudioBytes ?? DEFAULT_MAX_AUDIO_BYTES, "maxAudioBytes");
    this.#maxChunkBytes = positiveInteger(options.maxChunkBytes ?? DEFAULT_MAX_CHUNK_BYTES, "maxChunkBytes");
    this.#idleTimeoutMs = positiveInteger(options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS, "idleTimeoutMs");
    this.#requestTimeoutMs = positiveInteger(options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS, "requestTimeoutMs");
    this.#transcriptionSegmentMs = positiveInteger(options.transcriptionSegmentMs ?? TRANSCRIPTION_SEGMENT_MS, "transcriptionSegmentMs");
    this.#automaticRetryBaseMs = positiveInteger(options.automaticRetryBaseMs ?? DEFAULT_RATE_LIMIT_RETRY_DELAY_MS, "automaticRetryBaseMs");
    this.#maximumAutomaticRetries = nonNegativeInteger(options.maximumAutomaticRetries ?? MAX_AUTOMATIC_TRANSCRIPTION_RETRIES, "maximumAutomaticRetries");
    this.#cleanupTimer = setInterval(() => this.#expireIdleSessions(), Math.min(this.#idleTimeoutMs, 30_000));
    this.#cleanupTimer.unref();
  }

  handles(method: string): boolean {
    return method.startsWith(DICTATION_PREFIX);
  }

  async handle(clientId: string, method: string, params: RpcObject): Promise<unknown> {
    if (this.#closed) throw new Error("Dictation service is shutting down");
    if (method === "companion/dictation/start") return await this.#start(clientId, params);
    if (method === "companion/dictation/append") return await this.#append(clientId, params);
    if (method === "companion/dictation/appendBatch") return await this.#appendBatch(clientId, params);
    if (method === "companion/dictation/finish") return await this.#finish(clientId, params);
    if (method === "companion/dictation/cancel") return await this.#cancel(clientId, params);
    throw new Error("Unknown companion dictation method");
  }

  releaseClient(clientId: string): void {
    // A mobile transport disconnect is expected on weak networks and during
    // sleep/wake. Keep the device-owned private recording until it reconnects,
    // finishes/cancels, or reaches the idle retention boundary.
    void clientId;
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    clearInterval(this.#cleanupTimer);
    for (const session of this.#sessions.values()) void cleanupSession(session);
    this.#sessions.clear();
    for (const controllers of this.#activeRequests.values()) {
      for (const controller of controllers) controller.abort();
    }
    this.#activeRequests.clear();
  }

  async #start(clientId: string, params: RpcObject): Promise<{ sessionId: string }> {
    // A microphone UI has one active recording. Drop abandoned recordings for
    // this client instead of accumulating private audio after UI races.
    for (const [sessionId, session] of this.#sessions) {
      if (session.clientId !== clientId) continue;
      this.#sessions.delete(sessionId);
      await cleanupSession(session);
    }
    const sessionId = randomUUID();
    const directory = await mkdtemp(path.join(tmpdir(), "codewide-dictation-session-"));
    const pcmPath = path.join(directory, "recording.pcm");
    await writeFile(pcmPath, Buffer.alloc(0), { mode: 0o600 });
    this.#sessions.set(sessionId, {
      id: sessionId,
      clientId,
      directory,
      pcmPath,
      sampleRate: 0,
      numChannels: 0,
      pendingWrite: Promise.resolve(),
      bytes: 0,
      audioChunks: 0,
      appendBatches: 0,
      sampleCount: 0,
      sumSquares: 0,
      peakAbsoluteSample: 0,
      clippedSamples: 0,
      silentSamples: 0,
      qualityFrames: [],
      language: optionalLanguage(params.language),
      captureSource: optionalCaptureSource(params.captureSource),
      noiseSuppressor: optionalBoolean(params.noiseSuppressor),
      automaticGainControl: optionalBoolean(params.automaticGainControl),
      lastActivityAt: Date.now(),
      sealed: false,
      nextOffset: 0,
      transcripts: [],
      completedResult: null,
      finishInFlight: null,
      acceptedBatchIds: new Set(),
    });
    return { sessionId };
  }

  async #append(clientId: string, params: RpcObject): Promise<{ accepted: true }> {
    const session = this.#ownedSession(clientId, params);
    return await this.#appendChunks(session, [params]);
  }

  async #appendBatch(clientId: string, params: RpcObject): Promise<{ accepted: true }> {
    const session = this.#ownedSession(clientId, params);
    const batchId = typeof params.batchId === "string" && params.batchId.length > 0 ? params.batchId : null;
    if (batchId !== null && session.acceptedBatchIds.has(batchId)) return { accepted: true };
    const rawChunks = params.chunks;
    if (!Array.isArray(rawChunks) || rawChunks.length === 0 || rawChunks.length > MAX_AUDIO_BATCH_CHUNKS) {
      throw new Error("Audio batch must contain between 1 and 64 chunks");
    }
    const chunks = rawChunks.map((chunk) => {
      const value = asObject(chunk);
      if (value === null) throw new Error("Audio batch contains an invalid chunk");
      return value;
    });
    const result = await this.#appendChunks(session, chunks);
    if (batchId !== null) session.acceptedBatchIds.add(batchId);
    return result;
  }

  async #appendChunks(session: DictationSession, chunks: RpcObject[]): Promise<{ accepted: true }> {
    if (session.sealed) throw new Error("Dictation recording has already stopped");
    let sampleRate = session.sampleRate;
    let numChannels = session.numChannels;
    const decoded: Buffer[] = [];
    const appendedQualityFrames: AudioQualityFrame[] = [];
    let appendedBytes = 0;
    let appendedSamples = 0;
    let appendedSumSquares = 0;
    let appendedPeak = 0;
    let appendedClipped = 0;
    let appendedSilent = 0;
    for (const params of chunks) {
      const chunkSampleRate = boundedInteger(params.sampleRate, 8_000, 96_000, "sampleRate");
      const chunkChannels = boundedInteger(params.numChannels, 1, 2, "numChannels");
      const samplesPerChannel = boundedInteger(params.samplesPerChannel, 1, 10_000_000, "samplesPerChannel");
      const chunk = decodeBase64(params.data);
      if (chunk.length > this.#maxChunkBytes) throw new Error("Audio chunk is too large");
      const expectedBytes = samplesPerChannel * chunkChannels * 2;
      if (chunk.length !== expectedBytes) throw new Error("Audio chunk size does not match PCM16 metadata");
      if (sampleRate === 0) {
        sampleRate = chunkSampleRate;
        numChannels = chunkChannels;
      } else if (sampleRate !== chunkSampleRate || numChannels !== chunkChannels) {
        throw new Error("Audio format changed during dictation");
      }
      const quality = pcmQuality(chunk);
      appendedQualityFrames.push({
        byteStart: session.bytes + appendedBytes,
        byteLength: chunk.length,
        durationMs: samplesPerChannel * 1_000 / chunkSampleRate,
        rmsPpm: ratioPpm(Math.sqrt(quality.sumSquares / Math.max(1, quality.sampleCount))),
        silentPpm: ratioPpm(quality.silentSamples / Math.max(1, quality.sampleCount)),
      });
      decoded.push(chunk);
      appendedBytes += chunk.length;
      appendedSamples += quality.sampleCount;
      appendedSumSquares += quality.sumSquares;
      appendedPeak = Math.max(appendedPeak, quality.peakAbsoluteSample);
      appendedClipped += quality.clippedSamples;
      appendedSilent += quality.silentSamples;
    }
    if (session.bytes + appendedBytes > this.#maxAudioBytes) throw new Error("Dictation recording is too large");
    session.sampleRate = sampleRate;
    session.numChannels = numChannels;
    session.bytes += appendedBytes;
    session.audioChunks += chunks.length;
    session.appendBatches += 1;
    session.sampleCount += appendedSamples;
    session.sumSquares += appendedSumSquares;
    session.peakAbsoluteSample = Math.max(session.peakAbsoluteSample, appendedPeak);
    session.clippedSamples += appendedClipped;
    session.silentSamples += appendedSilent;
    session.qualityFrames.push(...appendedQualityFrames);
    session.lastActivityAt = Date.now();
    const payload = decoded.length === 1 ? decoded[0]! : Buffer.concat(decoded, appendedBytes);
    session.pendingWrite = session.pendingWrite.then(async () => await appendFile(session.pcmPath, payload));
    try {
      await session.pendingWrite;
    } catch (cause) {
      await cleanupSession(session);
      throw cause;
    }
    return { accepted: true };
  }

  async #finish(clientId: string, params: RpcObject): Promise<DictationFinishResult> {
    const session = this.#ownedSession(clientId, params);
    if (session.completedResult !== null) {
      session.lastActivityAt = Date.now();
      return session.completedResult;
    }
    if (session.finishInFlight !== null) return await session.finishInFlight;
    session.sealed = true;
    if (session.bytes === 0 || session.sampleRate === 0 || session.numChannels === 0) {
      this.#sessions.delete(session.id);
      await cleanupSession(session);
      throw new Error("No microphone audio was recorded");
    }
    await session.pendingWrite;
    const finishing = this.#transcribeSession(session);
    session.finishInFlight = finishing;
    try {
      const result = await finishing;
      if ("text" in result) {
        // Keep the small completed result idempotently addressable until the
        // idle boundary. A mobile client may lose the RPC response after the
        // host completed transcription; retry must return the same transcript
        // instead of losing the recording and the user's speech.
        session.completedResult = result;
        session.lastActivityAt = Date.now();
        await cleanupSession(session);
      } else {
        // Keep the private PCM file for an explicit client retry. The normal
        // idle-session cleanup remains the finite retention boundary.
        session.lastActivityAt = Date.now();
      }
      return result;
    } catch (cause) {
      // Upstream auth, timeout and network failures are recoverable from the
      // user's perspective. Retain the private PCM and make every such failure
      // an explicit manual retry instead of deleting the only recording.
      session.lastActivityAt = Date.now();
      return {
        retryable: true,
        retryAfterMs: DEFAULT_RATE_LIMIT_RETRY_DELAY_MS,
        message: cause instanceof Error ? cause.message : "ChatGPT transcription failed",
      };
    } finally {
      session.finishInFlight = null;
    }
  }

  async #transcribeSession(session: DictationSession): Promise<DictationFinishResult> {
    const clientId = session.clientId;
    const controller = new AbortController();
    const controllers = this.#activeRequests.get(clientId) ?? new Set<AbortController>();
    controllers.add(controller);
    this.#activeRequests.set(clientId, controllers);
    const recordingMs = session.bytes / (session.sampleRate * session.numChannels * 2) * 1_000;
    const transcriptionBudgetMs = 60_000 + Math.ceil(recordingMs / 4);
    const automaticRetryBudgetMs = this.#maximumAutomaticRetries * MAX_AUTOMATIC_RETRY_DELAY_MS;
    const requestTimeoutMs = Math.min(
      MAX_REQUEST_TIMEOUT_MS,
      Math.max(this.#requestTimeoutMs, transcriptionBudgetMs + automaticRetryBudgetMs),
    );
    const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
    timeout.unref();
    try {
      const bytesPerFrame = session.numChannels * 2;
      const profile = temporalAudioProfile(session.qualityFrames, session.bytes);
      if (session.nextOffset === 0) session.nextOffset = profile.transcriptionStartByte;
      const transcriptionEndByte = profile.transcriptionEndByte;
      const targetSegmentBytes = Math.max(bytesPerFrame, Math.floor(session.sampleRate * bytesPerFrame * this.#transcriptionSegmentMs / 1_000 / bytesPerFrame) * bytesPerFrame);
      for (let segment = Math.floor(session.nextOffset / targetSegmentBytes); session.nextOffset < transcriptionEndByte; segment += 1) {
        const segmentBytes = Math.min(targetSegmentBytes, transcriptionEndByte - session.nextOffset);
        const wavPath = path.join(session.directory, `segment-${segment}.wav`);
        await writeWavSegment(session.pcmPath, wavPath, session.nextOffset, segmentBytes, session.sampleRate, session.numChannels);
        try {
          let response: Response | null = null;
          const segmentMs = segmentBytes / (session.sampleRate * session.numChannels * 2) * 1_000;
          const transcribe = async (auth: CodexOAuth, attempt: number, reason: string): Promise<Response> => {
            const startedAt = Date.now();
            try {
              const result = await this.#transcribe(wavPath, auth, controller.signal, requestTimeoutMs, session.language);
              console.info(JSON.stringify({
                status: "dictation-openai-request",
                httpStatus: result.status,
                durationMs: Date.now() - startedAt,
                recordingMs: Math.round(recordingMs),
                segmentMs: Math.round(segmentMs),
                sampleRate: session.sampleRate,
                numChannels: session.numChannels,
                audioBytes: session.bytes,
                audioChunks: session.audioChunks,
                appendBatches: session.appendBatches,
                rmsPpm: ratioPpm(Math.sqrt(session.sumSquares / Math.max(1, session.sampleCount))),
                peakPpm: ratioPpm(session.peakAbsoluteSample / 32_768),
                clippedPpm: ratioPpm(session.clippedSamples / Math.max(1, session.sampleCount)),
                silentPpm: ratioPpm(session.silentSamples / Math.max(1, session.sampleCount)),
                quietFramePpm: profile.quietFramePpm,
                leadingQuietMs: profile.leadingQuietMs,
                trailingQuietMs: profile.trailingQuietMs,
                longestQuietMs: profile.longestQuietMs,
                rmsP10Ppm: profile.rmsP10Ppm,
                rmsP50Ppm: profile.rmsP50Ppm,
                rmsP90Ppm: profile.rmsP90Ppm,
                transcribedMs: profile.transcribedMs,
                language: session.language,
                captureSource: session.captureSource,
                noiseSuppressor: session.noiseSuppressor,
                automaticGainControl: session.automaticGainControl,
                segment,
                attempt,
                reason,
              }));
              return result;
            } catch (cause) {
              console.warn(JSON.stringify({
                status: "dictation-openai-request-failed",
                durationMs: Date.now() - startedAt,
                recordingMs: Math.round(recordingMs),
                segmentMs: Math.round(segmentMs),
                segment,
                attempt,
                reason,
                error: cause instanceof Error ? cause.name : "unknown",
              }));
              throw cause;
            }
          };
          let retryReason = "initial";
          for (let attempt = 0; attempt <= this.#maximumAutomaticRetries; attempt += 1) {
            try {
              const firstAuth = await this.#readCodexOAuth();
              response = await transcribe(firstAuth, attempt, retryReason);
              if (response.status === 401) {
                const refreshedAuth = await this.#readCodexOAuth();
                if (refreshedAuth.accessToken !== firstAuth.accessToken) {
                  response = await transcribe(refreshedAuth, attempt, "oauth-refresh");
                }
              }
            } catch (cause) {
              if (cause instanceof Error && cause.name === "AbortError") throw cause;
              if (attempt === this.#maximumAutomaticRetries) throw cause;
              const retryAfterMs = automaticRetryDelay(attempt, this.#automaticRetryBaseMs);
              logDictationRetry("transport", attempt, retryAfterMs, this.#maximumAutomaticRetries);
              await abortableDelay(retryAfterMs, controller.signal);
              retryReason = "transport-retry";
              continue;
            }
            const retry = transcriptionResponseRetry(response, attempt, this.#automaticRetryBaseMs);
            if (retry === null) break;
            if (attempt === this.#maximumAutomaticRetries || retry.retryAfterMs > MAX_AUTOMATIC_RETRY_DELAY_MS) {
              console.warn(JSON.stringify({
                status: "dictation-retries-exhausted",
                reason: retry.reason,
                httpStatus: response.status,
                retryAfterMs: retry.retryAfterMs,
                automaticRetries: attempt,
              }));
              return {
                retryable: true,
                retryAfterMs: retry.retryAfterMs,
                message: retry.message,
              };
            }
            logDictationRetry(retry.reason, attempt, retry.retryAfterMs, this.#maximumAutomaticRetries);
            await abortableDelay(retry.retryAfterMs, controller.signal);
            retryReason = `${retry.reason}-retry`;
          }
          if (response === null) throw new Error("ChatGPT transcription returned no response");
          const transcript = await transcriptFromResponse(response);
          if (transcript.text.trim() !== "") session.transcripts.push(transcript.text.trim());
          session.nextOffset += segmentBytes;
        } finally {
          await rm(wavPath, { force: true });
        }
      }
      return { text: session.transcripts.join(" ") };
    } catch (cause) {
      if (cause instanceof Error && cause.name === "AbortError") throw new Error("ChatGPT transcription timed out");
      throw cause;
    } finally {
      clearTimeout(timeout);
      controllers.delete(controller);
      if (controllers.size === 0) this.#activeRequests.delete(clientId);
    }
  }

  async #cancel(clientId: string, params: RpcObject): Promise<{ cancelled: boolean }> {
    const sessionId = stringValue(params.sessionId, "sessionId");
    const session = this.#sessions.get(sessionId);
    if (session === undefined || session.clientId !== clientId) return { cancelled: false };
    this.#sessions.delete(sessionId);
    await cleanupSession(session);
    return { cancelled: true };
  }

  #ownedSession(clientId: string, params: RpcObject): DictationSession {
    const sessionId = stringValue(params.sessionId, "sessionId");
    const session = this.#sessions.get(sessionId);
    if (session === undefined || session.clientId !== clientId) throw new Error("Dictation session is missing or expired");
    return session;
  }

  async #readCodexOAuth(): Promise<CodexOAuth> {
    const handle = await open(this.#authFilePath, constants.O_RDONLY | constants.O_NOFOLLOW).catch(() => null);
    if (handle === null) {
      throw new Error("Codex OAuth is unavailable on the host; run `codex login`");
    }
    let parsed: unknown;
    try {
      const file = await handle.stat();
      if (!file.isFile()) throw new Error("not_regular");
      if ((file.mode & 0o077) !== 0) throw new Error("permissions");
      parsed = JSON.parse(await handle.readFile("utf8")) as unknown;
    } catch (cause) {
      if (cause instanceof Error && cause.message === "permissions") {
        throw new Error("Codex OAuth file permissions are too broad");
      }
      throw new Error("Codex OAuth file is unreadable; run `codex login` on the host");
    } finally {
      await handle.close();
    }
    const root = asObject(parsed);
    const tokens = asObject(root?.tokens);
    const accessToken = tokens?.access_token;
    const accountId = tokens?.account_id;
    if (typeof accessToken !== "string" || accessToken.length < 32 || typeof accountId !== "string" || accountId.length === 0) {
      throw new Error("Codex OAuth is unavailable on the host; run `codex login`");
    }
    return { accessToken, accountId };
  }

  async #transcribe(wavPath: string, auth: CodexOAuth, signal: AbortSignal, timeoutMs: number, language: string | null): Promise<Response> {
    if (this.#fetch === undefined) {
      return await transcribeWithCurl(this.#endpoint, wavPath, auth, signal, timeoutMs, language);
    }
    const wav = await readFile(wavPath);
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(wav)], { type: "audio/wav" }), "dictation.wav");
    if (language !== null) form.append("language", language);
    return await this.#fetch(this.#endpoint, {
      method: "POST",
      headers: {
        authorization: `Bearer ${auth.accessToken}`,
        "chatgpt-account-id": auth.accountId,
        originator: "codex_desktop",
        origin: "https://chatgpt.com",
        referer: "https://chatgpt.com/",
        accept: "application/json, text/plain, */*",
        "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
        "sec-ch-ua": '"Chromium";v="138", "Not=A?Brand";v="24"',
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": '"Linux"',
      },
      body: form,
      signal,
    });
  }

  #expireIdleSessions(): void {
    const cutoff = Date.now() - this.#idleTimeoutMs;
    for (const [sessionId, session] of this.#sessions) {
      if (session.lastActivityAt >= cutoff) continue;
      this.#sessions.delete(sessionId);
      void cleanupSession(session);
    }
  }
}

function pcmQuality(chunk: Buffer): Pick<
  DictationSession,
  "sampleCount" | "sumSquares" | "peakAbsoluteSample" | "clippedSamples" | "silentSamples"
> {
  let sampleCount = 0;
  let sumSquares = 0;
  let peakAbsoluteSample = 0;
  let clippedSamples = 0;
  let silentSamples = 0;
  for (let offset = 0; offset < chunk.length; offset += 2) {
    const sample = chunk.readInt16LE(offset);
    const absolute = Math.abs(sample);
    const normalized = sample / 32_768;
    sampleCount += 1;
    sumSquares += normalized * normalized;
    peakAbsoluteSample = Math.max(peakAbsoluteSample, absolute);
    if (absolute >= 32_760) clippedSamples += 1;
    if (absolute <= 3) silentSamples += 1;
  }
  return { sampleCount, sumSquares, peakAbsoluteSample, clippedSamples, silentSamples };
}

function ratioPpm(value: number): number {
  return Math.max(0, Math.min(1_000_000, Math.round(value * 1_000_000)));
}

function temporalAudioProfile(frames: AudioQualityFrame[], totalBytes: number): {
  quietFramePpm: number;
  leadingQuietMs: number;
  trailingQuietMs: number;
  longestQuietMs: number;
  rmsP10Ppm: number;
  rmsP50Ppm: number;
  rmsP90Ppm: number;
  transcriptionStartByte: number;
  transcriptionEndByte: number;
  transcribedMs: number;
} {
  if (frames.length === 0) {
    return {
      quietFramePpm: 0,
      leadingQuietMs: 0,
      trailingQuietMs: 0,
      longestQuietMs: 0,
      rmsP10Ppm: 0,
      rmsP50Ppm: 0,
      rmsP90Ppm: 0,
      transcriptionStartByte: 0,
      transcriptionEndByte: totalBytes,
      transcribedMs: 0,
    };
  }
  const activeIndexes = frames.flatMap((frame, index) => frame.rmsPpm >= QUIET_FRAME_RMS_PPM ? [index] : []);
  const firstActive = activeIndexes[0];
  const lastActive = activeIndexes.at(-1);
  let leadingQuietMs = 0;
  let trailingQuietMs = 0;
  let longestQuietMs = 0;
  let currentQuietMs = 0;
  let quietMs = 0;
  let totalMs = 0;
  for (let index = 0; index < frames.length; index += 1) {
    const frame = frames[index]!;
    totalMs += frame.durationMs;
    if (frame.rmsPpm < QUIET_FRAME_RMS_PPM) {
      quietMs += frame.durationMs;
      currentQuietMs += frame.durationMs;
      longestQuietMs = Math.max(longestQuietMs, currentQuietMs);
      if (firstActive !== undefined && index < firstActive) leadingQuietMs += frame.durationMs;
      if (lastActive !== undefined && index > lastActive) trailingQuietMs += frame.durationMs;
    } else currentQuietMs = 0;
  }
  const sortedRms = frames.map((frame) => frame.rmsPpm).sort((left, right) => left - right);
  const percentile = (ratio: number) => sortedRms[Math.min(sortedRms.length - 1, Math.floor((sortedRms.length - 1) * ratio))] ?? 0;
  if (firstActive === undefined || lastActive === undefined) {
    return {
      quietFramePpm: ratioPpm(quietMs / Math.max(1, totalMs)),
      leadingQuietMs: Math.round(totalMs),
      trailingQuietMs: Math.round(totalMs),
      longestQuietMs: Math.round(longestQuietMs),
      rmsP10Ppm: percentile(0.1),
      rmsP50Ppm: percentile(0.5),
      rmsP90Ppm: percentile(0.9),
      transcriptionStartByte: 0,
      transcriptionEndByte: totalBytes,
      transcribedMs: Math.round(totalMs),
    };
  }
  let startIndex = firstActive;
  let startPadding = EDGE_SPEECH_PADDING_MS;
  while (startIndex > 0 && startPadding > 0) {
    startIndex -= 1;
    startPadding -= frames[startIndex]!.durationMs;
  }
  let endIndex = lastActive;
  let endPadding = EDGE_SPEECH_PADDING_MS;
  while (endIndex + 1 < frames.length && endPadding > 0) {
    endIndex += 1;
    endPadding -= frames[endIndex]!.durationMs;
  }
  const start = frames[startIndex]!;
  const end = frames[endIndex]!;
  return {
    quietFramePpm: ratioPpm(quietMs / Math.max(1, totalMs)),
    leadingQuietMs: Math.round(leadingQuietMs),
    trailingQuietMs: Math.round(trailingQuietMs),
    longestQuietMs: Math.round(longestQuietMs),
    rmsP10Ppm: percentile(0.1),
    rmsP50Ppm: percentile(0.5),
    rmsP90Ppm: percentile(0.9),
    transcriptionStartByte: start.byteStart,
    transcriptionEndByte: end.byteStart + end.byteLength,
    transcribedMs: Math.round(frames.slice(startIndex, endIndex + 1).reduce((sum, frame) => sum + frame.durationMs, 0)),
  };
}

async function transcribeWithCurl(
  endpoint: string,
  wavPath: string,
  auth: CodexOAuth,
  signal: AbortSignal,
  timeoutMs: number,
  language: string | null,
): Promise<Response> {
  if (!/^[A-Za-z0-9._-]+$/.test(auth.accessToken) || !/^[A-Za-z0-9._-]+$/.test(auth.accountId)) {
    throw new Error("Codex OAuth file contains invalid credentials");
  }
  const marker = `CODEWIDE_HTTP_${randomUUID()}_`;
  const config = [
    `header = "Authorization: Bearer ${auth.accessToken}"`,
    `header = "ChatGPT-Account-ID: ${auth.accountId}"`,
    'header = "Originator: codex_desktop"',
    'header = "Origin: https://chatgpt.com"',
    'header = "Referer: https://chatgpt.com/"',
    'header = "Accept: application/json, text/plain, */*"',
    'header = "User-Agent: Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36"',
    'header = "sec-ch-ua: \\"Chromium\\";v=\\"138\\", \\"Not=A?Brand\\";v=\\"24\\""',
    'header = "sec-ch-ua-mobile: ?0"',
    'header = "sec-ch-ua-platform: \\"Linux\\""',
    "",
  ].join("\n");
  let stdout: Buffer;
  stdout = await new Promise<Buffer>((resolve, reject) => {
      const child = spawn("curl", [
        "--silent",
        "--show-error",
        "--request", "POST",
        "--max-time", String(Math.ceil(timeoutMs / 1_000)),
        "--config", "-",
        "--form", `file=@${wavPath};type=audio/wav;filename=dictation.wav`,
        ...(language === null ? [] : ["--form", `language=${language}`]),
        "--write-out", `\n${marker}%{http_code}\t%header{cf-mitigated}\t%header{retry-after}`,
        endpoint,
      ], {
        stdio: ["pipe", "pipe", "pipe"],
        signal,
      });
      const output: Buffer[] = [];
      let outputBytes = 0;
      child.stdout.on("data", (chunk: Buffer) => {
        outputBytes += chunk.length;
        if (outputBytes > MAX_TRANSCRIPTION_RESPONSE_BYTES) {
          child.kill();
          reject(new Error("ChatGPT transcription response is too large"));
          return;
        }
        output.push(chunk);
      });
      // Drain curl diagnostics without surfacing network internals or secrets.
      child.stderr.resume();
      child.once("error", reject);
      child.once("close", (code) => {
        if (code !== 0) {
          reject(new Error(signal.aborted ? "ChatGPT transcription timed out" : "ChatGPT transcription transport failed"));
          return;
        }
        resolve(Buffer.concat(output));
      });
      child.stdin.on("error", () => undefined);
      // The OAuth header is sent through stdin, never argv, environment, or a
      // filesystem path. Only the audio body touches a mode-0600 PrivateTmp
      // file required by curl, and it is removed immediately below.
      child.stdin.end(config);
    });
  const markerBytes = Buffer.from(`\n${marker}`, "utf8");
  const markerOffset = stdout.lastIndexOf(markerBytes);
  if (markerOffset < 0) throw new Error("ChatGPT transcription transport returned no status");
  const metadata = stdout.subarray(markerOffset + markerBytes.length).toString("utf8");
  const [statusText, cfMitigated = "", retryAfter = ""] = metadata.split("\t", 3);
  const status = Number(statusText);
  if (!Number.isSafeInteger(status) || status < 100 || status > 599) {
    throw new Error("ChatGPT transcription transport returned an invalid status");
  }
  const headers = new Headers();
  if (cfMitigated.trim() !== "") headers.set("cf-mitigated", cfMitigated.trim());
  if (retryAfter.trim() !== "") headers.set("retry-after", retryAfter.trim());
  const body = new Uint8Array(markerOffset);
  body.set(stdout.subarray(0, markerOffset));
  return new Response(body, { status, headers });
}

function retryAfterMilliseconds(response: Response, attempt: number): number {
  const value = response.headers.get("retry-after")?.trim();
  if (value !== undefined && value !== "") {
    const seconds = Number(value);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1_000);
    const date = Date.parse(value);
    if (Number.isFinite(date)) return Math.max(0, date - Date.now());
  }
  return DEFAULT_RATE_LIMIT_RETRY_DELAY_MS * (2 ** attempt);
}

type TranscriptionRetry = {
  reason: "rate-limit" | "cloudflare" | "upstream";
  retryAfterMs: number;
  message: string;
};

function transcriptionResponseRetry(response: Response, attempt: number, retryBaseMs: number): TranscriptionRetry | null {
  if (response.status === 429) {
    const retryAfterMs = retryAfterMilliseconds(response, attempt);
    return {
      reason: "rate-limit",
      retryAfterMs,
      message: `OpenAI transcription is rate limited; retry in ${formatRetryDelay(retryAfterMs)}`,
    };
  }
  if (response.status === 403 && response.headers.get("cf-mitigated") === "challenge") {
    return {
      reason: "cloudflare",
      retryAfterMs: automaticRetryDelay(attempt, retryBaseMs),
      message: "ChatGPT transcription was blocked by Cloudflare on the host network",
    };
  }
  if (response.status === 408 || response.status === 425 || response.status >= 500) {
    return {
      reason: "upstream",
      retryAfterMs: automaticRetryDelay(attempt, retryBaseMs),
      message: `ChatGPT transcription is temporarily unavailable (HTTP ${response.status})`,
    };
  }
  return null;
}

function automaticRetryDelay(attempt: number, retryBaseMs: number): number {
  return Math.min(MAX_AUTOMATIC_RETRY_DELAY_MS, retryBaseMs * (2 ** attempt));
}

function logDictationRetry(reason: string, attempt: number, retryAfterMs: number, maximumRetries: number): void {
  console.warn(JSON.stringify({
    status: "dictation-retry-scheduled",
    reason,
    retryAfterMs,
    nextAttempt: attempt + 1,
    maximumRetries,
  }));
}

function formatRetryDelay(delayMs: number): string {
  return `${Math.max(1, Math.ceil(delayMs / 1_000))}s`;
}

async function abortableDelay(delayMs: number, signal: AbortSignal): Promise<void> {
  if (delayMs <= 0) return;
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(done, delayMs);
    const onAbort = () => done(new DOMException("Aborted", "AbortError"));
    function done(error?: Error): void {
      clearTimeout(timeout);
      signal.removeEventListener("abort", onAbort);
      if (error === undefined) resolve();
      else reject(error);
    }
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
  });
}

async function transcriptFromResponse(response: Response): Promise<{ text: string }> {
  if (response.status === 401) throw new Error("Codex OAuth expired; run `codex login` on the host");
  if (response.status === 403 && response.headers.get("cf-mitigated") === "challenge") {
    throw new Error("ChatGPT transcription was blocked by Cloudflare on the host network");
  }
  if (!response.ok) throw new Error(`ChatGPT transcription failed (HTTP ${response.status})`);
  let parsed: unknown;
  try {
    parsed = await response.json() as unknown;
  } catch {
    throw new Error("ChatGPT transcription returned an invalid response");
  }
  const text = asObject(parsed)?.text;
  if (typeof text !== "string") throw new Error("ChatGPT transcription returned no text");
  return { text };
}

function pcm16WavHeader(pcmBytes: number, sampleRate: number, numChannels: number): Buffer {
  const header = Buffer.allocUnsafe(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + pcmBytes, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * numChannels * 2, 28);
  header.writeUInt16LE(numChannels * 2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(pcmBytes, 40);
  return header;
}

async function writeWavSegment(pcmPath: string, wavPath: string, offset: number, pcmBytes: number, sampleRate: number, numChannels: number): Promise<void> {
  await writeFile(wavPath, pcm16WavHeader(pcmBytes, sampleRate, numChannels), { mode: 0o600 });
  await pipeline(
    createReadStream(pcmPath, { start: offset, end: offset + pcmBytes - 1 }),
    createWriteStream(wavPath, { flags: "a", mode: 0o600 }),
  );
}

async function cleanupSession(session: DictationSession): Promise<void> {
  await session.pendingWrite.catch(() => undefined);
  await rm(session.directory, { recursive: true, force: true });
}

function decodeBase64(value: unknown): Buffer {
  if (typeof value !== "string" || value.length === 0 || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    throw new Error("Audio data must be canonical base64");
  }
  const decoded = Buffer.from(value, "base64");
  if (decoded.toString("base64") !== value) throw new Error("Audio data must be canonical base64");
  return decoded;
}

function stringValue(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${name} must be a non-empty string`);
  return value;
}

function optionalLanguage(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !/^[a-z]{2,3}$/.test(value)) throw new Error("language must be an ISO-639 language code");
  return value;
}

function optionalCaptureSource(value: unknown): string | null {
  // Capture source is diagnostic metadata, not an audio compatibility gate.
  // Future Android vendors and client versions may introduce new source names;
  // valid PCM must continue through transcription regardless. Keep only a
  // bounded log-safe label and silently discard malformed metadata.
  if (typeof value !== "string" || !/^[a-z0-9._-]{1,64}$/i.test(value)) return null;
  return value;
}

function optionalBoolean(value: unknown): boolean | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "boolean") throw new Error("capture effect state must be boolean");
  return value;
}

function boundedInteger(value: unknown, min: number, max: number, name: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) {
    throw new Error(`${name} is outside the supported range`);
  }
  return value as number;
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
}

function nonNegativeInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${name} must be a non-negative integer`);
  return value;
}

function asObject(value: unknown): RpcObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as RpcObject : null;
}
