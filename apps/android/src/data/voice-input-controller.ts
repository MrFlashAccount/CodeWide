import type { Thread } from "@codewide/codex-protocol/v0.147.0/v2";

import { cancelVoiceRecognition, startPcmCapture, startVoiceRecognition, type PcmAudioChunk } from "../native/native-transport";
import { insertTranscriptAtSelection, type DraftSelection } from "./voice-draft";
import { transcriptionLanguageHint } from "./transcription-language";
import type { VoiceInputRow, WorkspaceResourceDatabase } from "./workspace-resource-database";

export type VoiceTranscriptionOptions = {
  language?: string;
  capture?: {
    source: "voice_recognition" | "voice_communication" | "mic";
    noiseSuppressor: boolean;
    automaticGainControl: boolean;
  };
};

export type VoiceTranscriptionEvent =
  | { type: "delta"; text: string }
  | { type: "done"; text: string }
  | { type: "error"; message: string }
  | { type: "closed"; reason: string | null };

export type VoiceTranscriptionSession = {
  appendAudio(chunk: PcmAudioChunk): void;
  finish(): Promise<void>;
  cancel(): Promise<void>;
};

export type StartVoiceTranscription = (
  listener: (event: VoiceTranscriptionEvent) => void,
  options?: VoiceTranscriptionOptions,
) => Promise<VoiceTranscriptionSession>;

export class RetryableVoiceTranscriptionError extends Error {
  constructor(message: string, readonly retryAfterMs: number) {
    super(message);
    this.name = "RetryableVoiceTranscriptionError";
  }
}

export class UnretryableVoiceTranscriptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnretryableVoiceTranscriptionError";
  }
}

type VoiceBinding = {
  scope: string;
  source(): string;
  selection(): DraftSelection;
  thread: Thread | null | undefined;
  updateDraft(text: string): void;
  send(text: string): void;
  startRemote?: StartVoiceTranscription;
};

const IDLE_VOICE = {
  phase: "idle" as const,
  backend: "remote" as const,
  level: 0,
  seconds: 0,
  error: null,
  retryAvailable: false,
  pendingSelection: null,
};

const VOICE_SESSION_START_RETRIES = 3;
const VOICE_SESSION_START_RETRY_BASE_MS = 250;

/**
 * Process owner for the single Android microphone. React binds callbacks and
 * renders its TanStack projection, but component mount/unmount never owns the
 * capture, remote dictation session or retry payload.
 */
export class VoiceInputController {
  private binding: VoiceBinding | null = null;
  private activeBinding: VoiceBinding | null = null;
  private retryBinding: VoiceBinding | null = null;
  private stopCapture: (() => void) | null = null;
  private session: VoiceTranscriptionSession | null = null;
  private retrySession: VoiceTranscriptionSession | null = null;
  private sessionPromise: Promise<VoiceTranscriptionSession> | null = null;
  private finishPromise: Promise<void> | null = null;
  private readonly levelByScope = new Map<string, number>();
  private readonly levelSubscribers = new Map<string, Set<() => void>>();
  private operation = 0;
  private sendAfterFinish = false;
  private retrySendAfter = false;
  private insertionCursor = 0;
  private transcribedDraft: string | null = null;
  private capturedAudioChunks = 0;

  constructor(private readonly resources: WorkspaceResourceDatabase) {}

  /**
   * Audio level is frame-rate UI telemetry, not durable application state.
   * Keep it outside TanStack so PCM callbacks cannot invalidate the workspace.
   */
  subscribeLevel(scope: string, listener: () => void): () => void {
    const subscribers = this.levelSubscribers.get(scope) ?? new Set<() => void>();
    subscribers.add(listener);
    this.levelSubscribers.set(scope, subscribers);
    return () => {
      subscribers.delete(listener);
      if (subscribers.size === 0) this.levelSubscribers.delete(scope);
    };
  }

  level(scope: string): number {
    return this.levelByScope.get(scope) ?? 0;
  }

  bind(binding: VoiceBinding): void {
    this.binding = binding;
    if (!this.resources.voiceInputs.has(binding.scope)) this.put(binding.scope, IDLE_VOICE);
  }

  unbind(scope: string): void {
    if (this.binding?.scope === scope) this.binding = null;
  }

  async toggle(): Promise<void> {
    const binding = this.binding;
    if (binding === null || this.finishPromise !== null) return;
    const processBinding = this.activeBinding;
    const processState = this.state(processBinding?.scope ?? binding.scope);
    if (processBinding !== null || processState.phase !== "idle" || this.stopCapture !== null) {
      if (processState.phase === "starting") {
        this.operation += 1;
        this.stopCapture?.();
        this.stopCapture = null;
        if (processBinding !== null) this.resetUi(processBinding.scope);
        this.activeBinding = null;
      } else if (processState.phase !== "finishing") await this.finish(false);
      return;
    }
    const operation = ++this.operation;
    const staleRetry = this.retrySession;
    this.retrySession = null;
    this.retryBinding = null;
    this.retrySendAfter = false;
    this.transcribedDraft = null;
    this.capturedAudioChunks = 0;
    this.publishLevel(binding.scope, 0);
    if (staleRetry !== null) void staleRetry.cancel().catch(() => undefined);
    this.put(binding.scope, { ...IDLE_VOICE, phase: "starting" });
    this.activeBinding = binding;
    const source = binding.source();
    const selection = binding.selection();
    this.transcribedDraft = source;
    const renderVoiceTranscript = (transcript: string) => {
      const insertion = insertTranscriptAtSelection(source, selection, transcript);
      this.insertionCursor = insertion.cursor;
      this.transcribedDraft = insertion.text;
      binding.updateDraft(insertion.text);
    };
    this.insertionCursor = Math.max(0, Math.min(source.length, selection.start));
    this.sendAfterFinish = false;
    if (binding.startRemote === undefined) {
      await this.startAndroidFallback(binding, operation, renderVoiceTranscript);
      return;
    }
    const completedSegments: string[] = [];
    let activeTranscript = "";
    let streamingSession: VoiceTranscriptionSession | null = null;
    let startSession: (() => Promise<VoiceTranscriptionSession>) | null = null;
    const pendingAudio: PcmAudioChunk[] = [];
    const renderTranscript = () => renderVoiceTranscript([...completedSegments, activeTranscript].filter((part) => part.trim() !== "").join(" "));
    try {
      const capture = await startPcmCapture(
        (chunk) => {
          this.capturedAudioChunks += 1;
          this.publishLevel(binding.scope, chunk.level);
          if (streamingSession !== null) streamingSession.appendAudio(chunk);
          else pendingAudio.push(chunk);
        },
        (message) => this.failOperation(binding.scope, `Microphone stopped · ${message.replaceAll("_", " ")}`),
      );
      if (operation !== this.operation) {
        capture.stop();
        if (this.activeBinding === binding) this.activeBinding = null;
        return;
      }
      this.stopCapture = capture.stop;
      this.patch(binding.scope, { phase: "recording", seconds: 0 });
      const listener = (event: VoiceTranscriptionEvent) => {
        if (event.type === "delta") {
          activeTranscript += event.text;
          renderTranscript();
        } else if (event.type === "done") {
          if (event.text.trim() !== "") completedSegments.push(event.text.trim());
          activeTranscript = "";
          renderTranscript();
        } else if (event.type === "error") this.failOperation(binding.scope, event.message);
        else if (event.type === "closed") this.failOperation(binding.scope, event.reason === null ? "Transcription connection closed" : `Transcription stopped · ${event.reason}`);
      };
      const options: VoiceTranscriptionOptions = {
        ...(transcriptionLanguageHint(binding.thread) === null ? {} : { language: transcriptionLanguageHint(binding.thread) as string }),
        ...(capture.info === null ? {} : { capture: capture.info }),
      };
      startSession = async () => await startVoiceSessionWithRetry(binding.startRemote as StartVoiceTranscription, listener, options);
      const sessionPromise = startSession();
      this.sessionPromise = sessionPromise;
      const session = await sessionPromise;
      if (this.sessionPromise === sessionPromise) this.sessionPromise = null;
      if (operation !== this.operation) {
        await session.cancel().catch(() => undefined);
        if (this.activeBinding === binding) this.activeBinding = null;
        return;
      }
      streamingSession = session;
      this.session = session;
      for (const chunk of pendingAudio.splice(0)) session.appendAudio(chunk);
    } catch (cause) {
      if (operation !== this.operation) return;
      const shouldSend = this.sendAfterFinish;
      this.operation += 1;
      this.stopCapture?.();
      this.stopCapture = null;
      this.sessionPromise = null;
      this.session = null;
      if (pendingAudio.length > 0 && startSession !== null) {
        this.retrySession = deferredVoiceSession(startSession, pendingAudio);
        this.retryBinding = binding;
        this.retrySendAfter = shouldSend;
        this.resetUi(binding.scope, {
          error: `OpenAI transcription: ${messageOf(cause)}`,
          retryAvailable: true,
        });
      } else {
        this.transcribedDraft = null;
        this.resetUi(binding.scope, { error: `OpenAI transcription: ${messageOf(cause)}` });
      }
      this.sendAfterFinish = false;
      if (this.activeBinding === binding) this.activeBinding = null;
    }
  }

  async finish(sendAfter: boolean): Promise<void> {
    const binding = this.activeBinding;
    if (binding === null) return;
    if (sendAfter) this.sendAfterFinish = true;
    if (this.finishPromise !== null) return await this.finishPromise;
    const finishing = this.finishCurrent(binding);
    this.finishPromise = finishing;
    try {
      await finishing;
    } finally {
      if (this.finishPromise === finishing) this.finishPromise = null;
    }
  }

  async retry(): Promise<void> {
    // The retry affordance can render from the same atomic state update that
    // finishes the previous attempt. Do not drop a fast tap during the tiny
    // interval before that attempt clears its promise.
    const previousFinish = this.finishPromise;
    if (previousFinish !== null) await previousFinish.catch(() => undefined);
    const binding = this.retryBinding;
    const session = this.retrySession;
    if (binding === null || session === null) return;
    const shouldSend = this.retrySendAfter;
    this.patch(binding.scope, { phase: "finishing", error: null, retryAvailable: false });
    const operation = (async () => {
      try {
        await session.finish();
        this.retrySession = null;
        this.retryBinding = null;
        this.retrySendAfter = false;
        if (this.activeBinding === binding) this.activeBinding = null;
        this.resetUi(binding.scope, { pendingSelection: shouldSend ? null : { start: this.insertionCursor, end: this.insertionCursor } });
        const finalDraft = this.transcribedDraft ?? binding.source();
        this.transcribedDraft = null;
        if (shouldSend) binding.send(finalDraft);
      } catch (cause) {
        if (!(cause instanceof UnretryableVoiceTranscriptionError)) {
          this.retrySession = session;
          this.retryBinding = binding;
          this.retrySendAfter = shouldSend;
          this.resetUi(binding.scope, { error: messageOf(cause), retryAvailable: true });
        } else {
          this.retrySession = null;
          this.retryBinding = null;
          this.transcribedDraft = null;
          void session.cancel().catch(() => undefined);
          if (this.activeBinding === binding) this.activeBinding = null;
          this.resetUi(binding.scope, { error: messageOf(cause) });
        }
      }
    })();
    this.finishPromise = operation;
    try {
      await operation;
    } finally {
      if (this.finishPromise === operation) this.finishPromise = null;
    }
  }

  clearPendingSelection(scope: string): void {
    this.patch(scope, { pendingSelection: null });
  }

  setPendingSelection(scope: string, selection: DraftSelection): void {
    this.patch(scope, { pendingSelection: selection });
  }

  private async finishCurrent(binding: VoiceBinding): Promise<void> {
    const operation = this.operation;
    const stop = this.stopCapture;
    this.stopCapture = null;
    stop?.();
    this.patch(binding.scope, { phase: "finishing" });
    let session = this.session;
    if (session === null && this.sessionPromise !== null) {
      try {
        session = await this.sessionPromise;
      } catch (cause) {
        this.sessionPromise = null;
        if (operation === this.operation) {
          if (this.activeBinding === binding) this.activeBinding = null;
          this.resetUi(binding.scope, { error: messageOf(cause) });
        }
        return;
      }
    }
    this.sessionPromise = null;
    const shouldSend = this.sendAfterFinish;
    if (binding.startRemote !== undefined && this.capturedAudioChunks === 0) {
      this.session = null;
      if (session !== null) await session.cancel().catch(() => undefined);
      if (operation === this.operation) {
        if (this.activeBinding === binding) this.activeBinding = null;
        this.transcribedDraft = null;
        this.resetUi(binding.scope, { error: "Recording was too short · hold the microphone and try again" });
      }
      this.sendAfterFinish = false;
      return;
    }
    let completed = false;
    try {
      if (session !== null) {
        await session.finish();
        this.session = null;
      } else cancelVoiceRecognition();
      completed = true;
    } catch (cause) {
      this.session = null;
      if (session !== null && !(cause instanceof UnretryableVoiceTranscriptionError)) {
        if (operation === this.operation) {
          this.retrySession = session;
          this.retryBinding = binding;
          this.retrySendAfter = shouldSend;
          if (this.activeBinding === binding) this.activeBinding = null;
          this.resetUi(binding.scope, { error: messageOf(cause), retryAvailable: true });
        }
      } else {
        if (session !== null) void session.cancel().catch(() => undefined);
        if (operation === this.operation) {
          this.retryBinding = null;
          this.transcribedDraft = null;
          if (this.activeBinding === binding) this.activeBinding = null;
          this.resetUi(binding.scope, { error: messageOf(cause) });
        }
      }
    } finally {
      this.sendAfterFinish = false;
      if (completed && operation === this.operation) {
        if (this.activeBinding === binding) this.activeBinding = null;
        this.resetUi(binding.scope, { pendingSelection: shouldSend ? null : { start: this.insertionCursor, end: this.insertionCursor } });
        const finalDraft = this.transcribedDraft ?? binding.source();
        this.transcribedDraft = null;
        if (shouldSend) binding.send(finalDraft);
      }
    }
  }

  private async startAndroidFallback(binding: VoiceBinding, operation: number, renderTranscript: (text: string) => void): Promise<void> {
    try {
      const stop = await startVoiceRecognition((event) => {
        if ((event.type === "partial" || event.type === "final") && event.text !== undefined) renderTranscript(event.text);
        if (event.type === "final" || event.type === "error") {
          this.stopCapture?.();
          this.stopCapture = null;
          this.resetUi(binding.scope, event.type === "error" ? { error: `Voice input stopped${event.text === undefined ? "" : ` · ${event.text.replaceAll("_", " ")}`}` } : {});
          if (this.activeBinding === binding) this.activeBinding = null;
        }
      });
      if (operation !== this.operation) {
        stop();
        if (this.activeBinding === binding) this.activeBinding = null;
        return;
      }
      this.stopCapture = stop;
      this.patch(binding.scope, { phase: "recording", backend: "android" });
    } catch (cause) {
      this.resetUi(binding.scope, { error: messageOf(cause) });
      if (this.activeBinding === binding) this.activeBinding = null;
    }
  }

  private failOperation(scope: string, message: string): void {
    this.operation += 1;
    this.stopCapture?.();
    this.stopCapture = null;
    const session = this.session;
    this.session = null;
    this.sessionPromise = null;
    this.transcribedDraft = null;
    if (session !== null) void session.cancel().catch(() => undefined);
    this.resetUi(scope, { error: message });
    if (this.activeBinding?.scope === scope) this.activeBinding = null;
  }

  private resetUi(scope: string, patch: Partial<Omit<VoiceInputRow, "id" | "scope" | "updatedAt">> = {}): void {
    this.publishLevel(scope, 0);
    this.put(scope, { ...IDLE_VOICE, ...patch });
  }

  private publishLevel(scope: string, rawLevel: number): void {
    const level = Number.isFinite(rawLevel) ? Math.max(0, Math.min(1, rawLevel)) : 0;
    if ((this.levelByScope.get(scope) ?? 0) === level) return;
    if (level === 0) this.levelByScope.delete(scope);
    else this.levelByScope.set(scope, level);
    for (const listener of this.levelSubscribers.get(scope) ?? []) listener();
  }

  private state(scope: string): VoiceInputRow {
    return this.resources.voiceInputs.get(scope) ?? { id: scope, scope, updatedAt: Date.now(), ...IDLE_VOICE };
  }

  private patch(scope: string, patch: Partial<Omit<VoiceInputRow, "id" | "scope" | "updatedAt">>): void {
    const { id: _id, scope: _scope, updatedAt: _updatedAt, ...current } = this.state(scope);
    this.put(scope, { ...current, ...patch });
  }

  private put(scope: string, value: Omit<VoiceInputRow, "id" | "scope" | "updatedAt">): void {
    this.resources.putVoiceInput({ id: scope, scope, ...value });
  }
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : "Voice input failed";
}

async function startVoiceSessionWithRetry(
  start: StartVoiceTranscription,
  listener: (event: VoiceTranscriptionEvent) => void,
  options: VoiceTranscriptionOptions,
): Promise<VoiceTranscriptionSession> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await start(listener, options);
    } catch (cause) {
      if (cause instanceof UnretryableVoiceTranscriptionError || attempt >= VOICE_SESSION_START_RETRIES) throw cause;
      await wait(VOICE_SESSION_START_RETRY_BASE_MS * (2 ** attempt));
    }
  }
}

function deferredVoiceSession(
  start: () => Promise<VoiceTranscriptionSession>,
  capturedAudio: PcmAudioChunk[],
): VoiceTranscriptionSession {
  let session: VoiceTranscriptionSession | null = null;
  let starting: Promise<VoiceTranscriptionSession> | null = null;
  let cancelled = false;
  const ensureSession = async () => {
    if (cancelled) throw new UnretryableVoiceTranscriptionError("Voice transcription was cancelled");
    if (session !== null) return session;
    if (starting === null) starting = start();
    try {
      session = await starting;
      for (const chunk of capturedAudio.splice(0)) session.appendAudio(chunk);
      return session;
    } finally {
      starting = null;
    }
  };
  return {
    appendAudio: (chunk) => {
      if (session !== null) session.appendAudio(chunk);
      else if (!cancelled) capturedAudio.push(chunk);
    },
    finish: async () => await (await ensureSession()).finish(),
    cancel: async () => {
      cancelled = true;
      capturedAudio.length = 0;
      const live = session ?? await starting?.catch(() => null) ?? null;
      if (live !== null) await live.cancel();
    },
  };
}

async function wait(delayMs: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
}
