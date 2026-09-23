import type { Thread } from "@codewide/codex-protocol/v0.155.1/v2";

import {
  cancelVoiceRecognition,
  startPcmCapture,
  startVoiceRecognition,
  type CapturedAudioChunk,
} from "../native/native-transport";
import { insertTranscriptAtSelection, type DraftSelection } from "./voice-draft";
import { transcriptionLanguageHint } from "./transcription-language";
import {
  createV1MicrophoneLeaseRegistry,
  type V1MicrophoneLeaseRegistry,
} from "./v1MicrophoneLease";
import type { VoiceInputRow, WorkspaceResourceDatabase } from "./workspace-resource-database";

export type VoiceTranscriptionOptions = {
  capture?: {
    automaticGainControl: boolean;
    noiseSuppressor: boolean;
    source: "voice_recognition" | "voice_communication" | "mic";
  };
  language?: string;
};

type AndroidFallbackRequest = {
  readonly binding: VoiceBinding;
  readonly operation: number;
  readonly releaseMicrophone: () => void;
  readonly renderTranscript: (text: string) => void;
};

export type VoiceTranscriptionEvent =
  | { text: string; type: "delta" }
  | { text: string; type: "done" }
  | { message: string; type: "error" }
  | { reason: string | null; type: "closed" };

export type VoiceTranscriptionSession = {
  appendAudio: (chunk: CapturedAudioChunk) => void;
  cancel: () => Promise<void>;
  finish: () => Promise<void>;
};

export type StartVoiceTranscription = (
  listener: (event: VoiceTranscriptionEvent) => void,
  options?: VoiceTranscriptionOptions,
) => Promise<VoiceTranscriptionSession>;

export class RetryableVoiceTranscriptionError extends Error {
  readonly retryAfterMs: number;

  constructor(message: string, retryAfterMs: number) {
    super(message);
    this.name = "RetryableVoiceTranscriptionError";
    this.retryAfterMs = retryAfterMs;
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
  selection: () => DraftSelection;
  send: (text: string) => void;
  source: () => string;
  startRemote?: StartVoiceTranscription;
  thread: Thread | null | undefined;
  updateDraft: (text: string) => void;
};

type AppLockDictationState =
  | { readonly status: "inactive" }
  | { readonly scope: string; readonly status: "paused" }
  | { readonly scope: string; readonly status: "resumeAllowed" };

const IDLE_VOICE = {
  backend: "remote" as const,
  error: null,
  level: 0,
  pendingSelection: null,
  phase: "idle" as const,
  retryAvailable: false,
  seconds: 0,
};

const VOICE_SESSION_START_RETRIES = 3;
const VOICE_SESSION_START_RETRY_BASE_MS = 250;
const VOICE_ERROR_VISIBLE_MS = 3000;
let compatibilityLeaseSequence = 0;

/**
 * Process owner for the single Android microphone. React binds callbacks and
 * renders its TanStack projection, but component mount/unmount never owns the
 * capture, remote dictation session or retry payload.
 */
export class VoiceInputController {
  private readonly resources: WorkspaceResourceDatabase;
  private readonly microphoneLeases: V1MicrophoneLeaseRegistry;
  private binding: VoiceBinding | null = null;
  private activeBinding: VoiceBinding | null = null;
  private retryBinding: VoiceBinding | null = null;
  private stopCapture: (() => void | Promise<void>) | null = null;
  private session: VoiceTranscriptionSession | null = null;
  private retrySession: VoiceTranscriptionSession | null = null;
  private sessionPromise: Promise<VoiceTranscriptionSession> | null = null;
  private finishPromise: Promise<void> | null = null;
  private readonly levelByScope = new Map<string, number>();
  private readonly levelSubscribers = new Map<string, Set<() => void>>();
  private readonly errorTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private operation = 0;
  // A recording survives recoverable attempts, but never an explicit discard.
  private recording: AbortController | null = null;
  private sendAfterFinish: ((text: string) => void) | null = null;
  private retrySendAfter: ((text: string) => void) | null = null;
  private insertionCursor = 0;
  private transcribedDraft: string | null = null;
  private originalDraft: string | null = null;
  private capturedAudioChunks = 0;
  private appLockDictation: AppLockDictationState = { status: "inactive" };

  constructor(
    resources: WorkspaceResourceDatabase,
    microphoneLeases: V1MicrophoneLeaseRegistry = createV1MicrophoneLeaseRegistry(
      () => `dictation-compatibility-${String(++compatibilityLeaseSequence)}`,
    ),
  ) {
    this.resources = resources;
    this.microphoneLeases = microphoneLeases;
  }

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
      if (subscribers.size === 0) {
        this.levelSubscribers.delete(scope);
      }
    };
  }

  level(scope: string): number {
    return this.levelByScope.get(scope) ?? 0;
  }

  bind(binding: VoiceBinding): void {
    this.binding = binding;
    if (!this.resources.voiceInputs.has(binding.scope)) {
      this.put(binding.scope, IDLE_VOICE);
    }
    if (
      this.appLockDictation.status === "resumeAllowed" &&
      this.appLockDictation.scope === binding.scope
    ) {
      void this.resumeAppLockDictation(binding).catch(() => {
        this.patch(binding.scope, { error: "Could not resume voice input" });
      });
    }
  }

  unbind(scope: string): void {
    if (this.binding?.scope === scope) {
      this.binding = null;
    }
  }

  async toggle(scope: string): Promise<void> {
    const binding = this.binding;
    if (binding === null || binding.scope !== scope || this.finishPromise !== null) {
      return;
    }
    const processBinding = this.activeBinding;
    if (processBinding !== null && processBinding.scope !== scope) {
      return;
    }
    if (this.retryBinding !== null && this.retryBinding.scope !== scope) {
      return;
    }
    const processState = this.state(processBinding?.scope ?? binding.scope);
    if (processBinding !== null || processState.phase !== "idle" || this.stopCapture !== null) {
      if (processState.phase === "starting") {
        this.operation += 1;
        this.recording?.abort();
        this.stopCaptureWithFeedback(processBinding?.scope ?? binding.scope);
        if (processBinding !== null) {
          this.resetUi(processBinding.scope);
        }
        this.activeBinding = null;
      } else if (processState.phase !== "finishing") {
        await this.finish(scope, false);
      }
      return;
    }
    const operation = ++this.operation;
    this.recording?.abort();
    const recording = new AbortController();
    this.recording = recording;
    const staleRetry = this.retrySession;
    this.retrySession = null;
    this.retryBinding = null;
    this.retrySendAfter = null;
    this.transcribedDraft = null;
    this.capturedAudioChunks = 0;
    this.publishLevel(binding.scope, 0);
    if (staleRetry !== null) {
      void staleRetry.cancel().catch(() => undefined);
    }
    this.put(binding.scope, { ...IDLE_VOICE, phase: "starting" });
    this.activeBinding = binding;
    let acquisition: Awaited<ReturnType<V1MicrophoneLeaseRegistry["acquireDictation"]>>;
    try {
      acquisition = await this.microphoneLeases.acquireDictation(binding.scope);
    } catch (error) {
      if (operation === this.operation) {
        this.failOperation(binding.scope, messageOf(error));
      }
      return;
    }
    // A cancelled start must not reset a replacement recording when handoff settles.
    if (operation !== this.operation || recording.signal.aborted) {
      if (acquisition.status === "acquired") {
        void acquisition.lease.release().catch(() => undefined);
      }
      return;
    }
    if (acquisition.status === "busy") {
      this.activeBinding = null;
      this.recording = null;
      this.resetUi(binding.scope, { error: "Microphone is already in use" });
      return;
    }
    const microphoneLease = acquisition.lease;
    const releaseMicrophone = (): void => {
      void microphoneLease.release().catch((error: unknown) => {
        if (operation === this.operation) {
          this.patch(binding.scope, {
            error: `Could not return microphone: ${messageOf(error)}`,
          });
        }
      });
    };
    const source = binding.source();
    this.originalDraft = source;
    const selection = binding.selection();
    this.transcribedDraft = source;
    const renderVoiceTranscript = (transcript: string, publishDraft = true) => {
      if (recording.signal.aborted) {
        return;
      }
      const insertion = insertTranscriptAtSelection(source, selection, transcript);
      this.insertionCursor = insertion.cursor;
      this.transcribedDraft = insertion.text;
      if (publishDraft) {
        binding.updateDraft(insertion.text);
      }
    };
    this.insertionCursor = Math.max(0, Math.min(source.length, selection.start));
    this.sendAfterFinish = null;
    if (binding.startRemote === undefined) {
      await this.startAndroidFallback({
        binding,
        operation,
        releaseMicrophone,
        renderTranscript: renderVoiceTranscript,
      });
      return;
    }
    const completedSegments: string[] = [];
    let activeTranscript = "";
    let streamingSession: VoiceTranscriptionSession | null = null;
    let startSession: (() => Promise<VoiceTranscriptionSession>) | null = null;
    const pendingAudio: CapturedAudioChunk[] = [];
    const renderTranscript = (publishDraft = true) => {
      renderVoiceTranscript(
        [...completedSegments, activeTranscript].filter((part) => part.trim() !== "").join(" "),
        publishDraft,
      );
    };
    try {
      const capture = await startPcmCapture(
        { purpose: "dictation", token: microphoneLease.token },
        (chunk) => {
          if (operation !== this.operation || recording.signal.aborted) {
            return;
          }
          this.capturedAudioChunks += 1;
          this.publishLevel(binding.scope, chunk.level);
          if (streamingSession !== null) {
            streamingSession.appendAudio(chunk);
          } else {
            pendingAudio.push(chunk);
          }
        },
        (message) => {
          if (operation === this.operation && !recording.signal.aborted) {
            this.failOperation(
              binding.scope,
              `Microphone stopped · ${message.replaceAll("_", " ")}`,
            );
          }
        },
      );
      if (operation !== this.operation) {
        Promise.resolve(capture.stop())
          .catch((error: unknown) => {
            this.patch(binding.scope, { error: `Could not stop microphone: ${messageOf(error)}` });
          })
          .finally(() => {
            void microphoneLease.release().catch(() => undefined);
          });
        return;
      }
      this.stopCapture = async () => {
        try {
          await capture.stop();
        } finally {
          // Capture is already closed. Reconnecting the assistant must not delay
          // transcript finalization or the user's Send/Stop feedback.
          releaseMicrophone();
        }
      };
      this.patch(binding.scope, { phase: "recording", seconds: 0 });
      const listener = (event: VoiceTranscriptionEvent) => {
        if (recording.signal.aborted) {
          return;
        }
        if (event.type === "delta") {
          activeTranscript += event.text;
          renderTranscript();
        } else if (event.type === "done") {
          if (event.text.trim() !== "") {
            completedSegments.push(event.text.trim());
          }
          activeTranscript = "";
          // Finish + Send owns the final transcript directly. Publishing it to
          // the native rich editor immediately before submission clears the
          // draft creates a setValue(final) -> setValue("") race; a delayed
          // native change callback can then resurrect or repeat sent text.
          renderTranscript(this.sendAfterFinish === null && this.retrySendAfter === null);
        } else if (event.type === "error") {
          this.failOperation(binding.scope, event.message);
        } else {
          this.failOperation(
            binding.scope,
            event.reason === null
              ? "Transcription connection closed"
              : `Transcription stopped · ${event.reason}`,
          );
        }
      };
      const language = transcriptionLanguageHint(binding.thread);
      const options: VoiceTranscriptionOptions = {
        ...(language === null ? {} : { language }),
        ...(capture.info === null ? {} : { capture: capture.info }),
      };
      const startRemote = binding.startRemote;
      startSession = async () =>
        startVoiceSessionWithRetry(startRemote, listener, options, recording.signal);
      const sessionPromise = startSession();
      this.sessionPromise = sessionPromise;
      const session = await sessionPromise;
      if (this.sessionPromise === sessionPromise) {
        this.sessionPromise = null;
      }
      if (operation !== this.operation) {
        await session.cancel().catch(() => undefined);
        return;
      }
      streamingSession = session;
      this.session = session;
      for (const chunk of pendingAudio.splice(0)) {
        session.appendAudio(chunk);
      }
    } catch (error) {
      releaseMicrophone();
      if (operation !== this.operation) {
        return;
      }
      const sendAfter = this.sendAfterFinish;
      this.operation += 1;
      this.stopCaptureWithFeedback(binding.scope);
      this.sessionPromise = null;
      this.session = null;
      if (pendingAudio.length > 0 && startSession !== null) {
        this.retrySession = deferredVoiceSession(startSession, pendingAudio);
        this.retryBinding = binding;
        this.retrySendAfter = sendAfter;
        this.resetUi(binding.scope, {
          error: `OpenAI transcription: ${messageOf(error)}`,
          retryAvailable: true,
        });
      } else {
        this.transcribedDraft = null;
        this.resetUi(binding.scope, { error: `OpenAI transcription: ${messageOf(error)}` });
      }
      this.sendAfterFinish = null;
      if (this.activeBinding === binding) {
        this.activeBinding = null;
      }
    }
  }

  /** Ends protected capture into its draft; only successful app unlock may resume it. */
  async pauseForAppLock(): Promise<void> {
    const binding = this.activeBinding;
    if (binding === null) {
      await this.finishPromise;
      return;
    }
    const state = this.state(binding.scope);
    if (state.phase === "starting") {
      this.appLockDictation = { scope: binding.scope, status: "paused" };
      await this.discard(binding.scope);
      return;
    }
    if (state.phase === "finishing") {
      await this.finishPromise;
      return;
    }
    this.appLockDictation = { scope: binding.scope, status: "paused" };
    await this.finish(binding.scope, false);
    if (this.appLockDictation.scope === binding.scope && this.state(binding.scope).retryAvailable) {
      this.appLockDictation = { status: "inactive" };
    }
  }

  /** Resumes only the dictation that biometric lock interrupted, never an already-finished input. */
  async resumeAfterAppUnlock(): Promise<void> {
    if (this.appLockDictation.status !== "paused") {
      return;
    }
    const scope = this.appLockDictation.scope;
    this.appLockDictation = { scope, status: "resumeAllowed" };
    const binding = this.binding;
    if (binding?.scope === scope) {
      await this.resumeAppLockDictation(binding);
    }
  }

  /** Only the recording's input may stop it or choose its send destination. */
  async finish(
    scope: string,
    sendAfter: boolean,
    sendOverride?: (text: string) => void,
  ): Promise<void> {
    const binding = this.activeBinding;
    if (binding === null || binding.scope !== scope) {
      return;
    }
    // There is no audio yet. Abort the pending native start so its eventual
    // completion cannot resurrect recording behind a closed input.
    if (this.state(scope).phase === "starting") {
      await this.discard(scope);
      return;
    }
    if (sendAfter) {
      this.sendAfterFinish = sendOverride ?? binding.send;
    }
    if (this.finishPromise !== null) {
      await this.finishPromise;
      return;
    }
    const finishing = this.finishCurrent(binding);
    this.finishPromise = finishing;
    try {
      await finishing;
    } finally {
      if (this.finishPromise === finishing) {
        this.finishPromise = null;
      }
    }
  }

  async retry(scope: string): Promise<void> {
    if (this.retryBinding?.scope !== scope) {
      return;
    }
    // The retry affordance can render from the same atomic state update that
    // finishes the previous attempt. Do not drop a fast tap during the tiny
    // interval before that attempt clears its promise.
    const previousFinish = this.finishPromise;
    if (previousFinish !== null) {
      await previousFinish.catch(() => undefined);
    }
    const binding = this.retryBinding;
    const session = this.retrySession;
    if (session === null) {
      return;
    }
    const sendAfter = this.retrySendAfter;
    const retryOperation = this.operation;
    this.patch(binding.scope, { error: null, phase: "finishing", retryAvailable: false });
    const operation = (async () => {
      try {
        await session.finish();
        if (retryOperation !== this.operation) {
          return;
        }
        this.recording?.abort();
        this.retrySession = null;
        this.retryBinding = null;
        this.retrySendAfter = null;
        if (this.activeBinding === binding) {
          this.activeBinding = null;
        }
        this.resetUi(binding.scope, {
          pendingSelection:
            sendAfter === null ? { end: this.insertionCursor, start: this.insertionCursor } : null,
        });
        const finalDraft = this.transcribedDraft ?? binding.source();
        this.transcribedDraft = null;
        this.originalDraft = null;
        sendAfter?.(finalDraft);
      } catch (error) {
        if (retryOperation !== this.operation) {
          return;
        }
        if (!(error instanceof UnretryableVoiceTranscriptionError)) {
          this.retrySession = session;
          this.retryBinding = binding;
          this.retrySendAfter = sendAfter;
          this.resetUi(binding.scope, { error: messageOf(error), retryAvailable: true });
        } else {
          this.recording?.abort();
          this.retrySession = null;
          this.retryBinding = null;
          this.retrySendAfter = null;
          this.transcribedDraft = null;
          void session.cancel().catch(() => undefined);
          if (this.activeBinding === binding) {
            this.activeBinding = null;
          }
          this.resetUi(binding.scope, { error: messageOf(error) });
        }
      }
    })();
    this.finishPromise = operation;
    try {
      await operation;
    } finally {
      if (this.finishPromise === operation) {
        this.finishPromise = null;
      }
    }
  }

  /** Discards the current/retryable recording and restores the pre-recording draft. */
  async discard(scope: string): Promise<void> {
    const owner = this.activeBinding ?? this.retryBinding;
    if (owner !== null && owner.scope !== scope) {
      return;
    }
    const binding =
      [this.activeBinding, this.retryBinding, this.binding].find(
        (candidate) => candidate?.scope === scope,
      ) ?? null;
    const originalDraft = this.originalDraft;
    this.operation += 1;
    this.recording?.abort();
    this.recording = null;
    this.finishPromise = null;
    this.stopCaptureWithFeedback(scope);
    cancelVoiceRecognition();
    const session = this.session;
    const retrySession = this.retrySession;
    const pendingSession = this.sessionPromise;
    this.session = null;
    this.retrySession = null;
    this.sessionPromise = null;
    this.activeBinding = null;
    this.retryBinding = null;
    this.sendAfterFinish = null;
    this.retrySendAfter = null;
    this.transcribedDraft = null;
    this.originalDraft = null;
    this.capturedAudioChunks = 0;
    if (binding !== null && originalDraft !== null) {
      binding.updateDraft(originalDraft);
    }
    this.resetUi(scope);
    await Promise.all([
      session?.cancel().catch(() => undefined),
      retrySession !== session ? retrySession?.cancel().catch(() => undefined) : undefined,
      pendingSession
        ?.then(async (pending) => {
          await pending.cancel();
        })
        .catch(() => undefined),
    ]);
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
    // End the recording animation immediately; final audio still has to flush
    // before finish() is sent to the transcription server.
    this.patch(binding.scope, { phase: "finishing" });
    try {
      await stop?.();
    } catch (error) {
      if (operation === this.operation) {
        this.failOperation(binding.scope, messageOf(error));
      }
      return;
    }
    if (operation !== this.operation) {
      return;
    }
    let session = this.session;
    if (session === null && this.sessionPromise !== null) {
      try {
        session = await this.sessionPromise;
      } catch (error) {
        if (operation === this.operation) {
          this.sessionPromise = null;
          if (this.activeBinding === binding) {
            this.activeBinding = null;
          }
          this.resetUi(binding.scope, { error: messageOf(error) });
        }
        return;
      }
    }
    if (operation !== this.operation) {
      return;
    }
    this.sessionPromise = null;
    const sendAfter = this.sendAfterFinish;
    if (binding.startRemote !== undefined && this.capturedAudioChunks === 0) {
      this.session = null;
      if (session !== null) {
        await session.cancel().catch(() => undefined);
      }
      if (operation === this.operation) {
        if (this.activeBinding === binding) {
          this.activeBinding = null;
        }
        this.transcribedDraft = null;
        this.resetUi(binding.scope, {
          error: "Recording was too short · hold the microphone and try again",
        });
        this.sendAfterFinish = null;
      }
      return;
    }
    let completed = false;
    try {
      if (session !== null) {
        await session.finish();
        if (operation !== this.operation) {
          return;
        }
        this.session = null;
      } else {
        cancelVoiceRecognition();
      }
      completed = true;
    } catch (error) {
      if (operation !== this.operation) {
        return;
      }
      this.session = null;
      if (session !== null && !(error instanceof UnretryableVoiceTranscriptionError)) {
        if (operation === this.operation) {
          this.retrySession = session;
          this.retryBinding = binding;
          this.retrySendAfter = sendAfter;
          if (this.activeBinding === binding) {
            this.activeBinding = null;
          }
          this.resetUi(binding.scope, { error: messageOf(error), retryAvailable: true });
        }
      } else {
        if (session !== null) {
          void session.cancel().catch(() => undefined);
        }
        if (operation === this.operation) {
          this.retryBinding = null;
          this.retrySendAfter = null;
          this.transcribedDraft = null;
          if (this.activeBinding === binding) {
            this.activeBinding = null;
          }
          this.resetUi(binding.scope, { error: messageOf(error) });
        }
      }
    } finally {
      if (operation === this.operation) {
        this.sendAfterFinish = null;
      }
      if (completed && operation === this.operation) {
        this.recording?.abort();
        if (this.activeBinding === binding) {
          this.activeBinding = null;
        }
        this.resetUi(binding.scope, {
          pendingSelection:
            sendAfter === null ? { end: this.insertionCursor, start: this.insertionCursor } : null,
        });
        const finalDraft = this.transcribedDraft ?? binding.source();
        this.transcribedDraft = null;
        this.originalDraft = null;
        sendAfter?.(finalDraft);
      }
    }
  }

  private async startAndroidFallback({
    binding,
    operation,
    releaseMicrophone,
    renderTranscript,
  }: AndroidFallbackRequest): Promise<void> {
    try {
      const stop = await startVoiceRecognition((event) => {
        if (operation !== this.operation) {
          return;
        }
        if ((event.type === "partial" || event.type === "final") && event.text !== undefined) {
          renderTranscript(event.text);
        }
        if (event.type === "final" || event.type === "error") {
          this.stopCaptureWithFeedback(binding.scope);
          this.resetUi(
            binding.scope,
            event.type === "error"
              ? {
                  error: `Voice input stopped${event.text === undefined ? "" : ` · ${event.text.replaceAll("_", " ")}`}`,
                }
              : {},
          );
          if (event.type === "final") {
            this.originalDraft = null;
          }
          if (this.activeBinding === binding) {
            this.activeBinding = null;
          }
        }
      });
      if (operation !== this.operation) {
        stop();
        releaseMicrophone();
        return;
      }
      this.stopCapture = () => {
        try {
          stop();
        } finally {
          releaseMicrophone();
        }
      };
      this.patch(binding.scope, { backend: "android", phase: "recording" });
    } catch (error) {
      releaseMicrophone();
      if (operation !== this.operation) {
        return;
      }
      this.resetUi(binding.scope, { error: messageOf(error) });
      if (this.activeBinding === binding) {
        this.activeBinding = null;
      }
    }
  }

  private async resumeAppLockDictation(binding: VoiceBinding): Promise<void> {
    if (
      this.appLockDictation.status !== "resumeAllowed" ||
      this.appLockDictation.scope !== binding.scope
    ) {
      return;
    }
    this.appLockDictation = { status: "inactive" };
    await this.toggle(binding.scope);
  }

  private failOperation(scope: string, message: string): void {
    this.operation += 1;
    this.recording?.abort();
    this.stopCaptureWithFeedback(scope);
    const session = this.session;
    this.session = null;
    this.sessionPromise = null;
    this.sendAfterFinish = null;
    this.retrySendAfter = null;
    this.transcribedDraft = null;
    if (session !== null) {
      void session.cancel().catch(() => undefined);
    }
    this.resetUi(scope, { error: message });
    if (this.activeBinding?.scope === scope) {
      this.activeBinding = null;
    }
  }

  private stopCaptureWithFeedback(scope: string): void {
    const stop = this.stopCapture;
    this.stopCapture = null;
    if (stop === null) {
      return;
    }
    Promise.resolve()
      .then(stop)
      .catch((error: unknown) => {
        this.patch(scope, { error: `Could not stop microphone: ${messageOf(error)}` });
      });
  }

  private resetUi(
    scope: string,
    patch: Partial<Omit<VoiceInputRow, "id" | "scope" | "updatedAt">> = {},
  ): void {
    this.publishLevel(scope, 0);
    this.put(scope, { ...IDLE_VOICE, ...patch });
  }

  private publishLevel(scope: string, rawLevel: number): void {
    const level = Number.isFinite(rawLevel) ? Math.max(0, Math.min(1, rawLevel)) : 0;
    if ((this.levelByScope.get(scope) ?? 0) === level) {
      return;
    }
    if (level === 0) {
      this.levelByScope.delete(scope);
    } else {
      this.levelByScope.set(scope, level);
    }
    for (const listener of this.levelSubscribers.get(scope) ?? []) {
      listener();
    }
  }

  private state(scope: string): VoiceInputRow {
    return (
      this.resources.voiceInputs.get(scope) ?? {
        id: scope,
        scope,
        updatedAt: Date.now(),
        ...IDLE_VOICE,
      }
    );
  }

  private patch(
    scope: string,
    patch: Partial<Omit<VoiceInputRow, "id" | "scope" | "updatedAt">>,
  ): void {
    const { id: _id, scope: _scope, updatedAt: _updatedAt, ...current } = this.state(scope);
    this.put(scope, { ...current, ...patch });
  }

  private put(scope: string, value: Omit<VoiceInputRow, "id" | "scope" | "updatedAt">): void {
    this.resources.putVoiceInput({ id: scope, scope, ...value });
    const previousTimer = this.errorTimers.get(scope);
    if (previousTimer !== undefined) {
      clearTimeout(previousTimer);
      this.errorTimers.delete(scope);
    }
    if (value.error === null) {
      return;
    }
    const error = value.error;
    const timer = setTimeout(() => {
      if (this.errorTimers.get(scope) !== timer) {
        return;
      }
      this.errorTimers.delete(scope);
      if (this.state(scope).error === error) {
        this.patch(scope, { error: null });
      }
    }, VOICE_ERROR_VISIBLE_MS);
    this.errorTimers.set(scope, timer);
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "Voice input failed";
}

async function startVoiceSessionWithRetry(
  start: StartVoiceTranscription,
  listener: (event: VoiceTranscriptionEvent) => void,
  options: VoiceTranscriptionOptions,
  signal: AbortSignal,
): Promise<VoiceTranscriptionSession> {
  for (let attempt = 0; ; attempt += 1) {
    if (signal.aborted) {
      throw new UnretryableVoiceTranscriptionError("Voice transcription was cancelled");
    }
    try {
      return await start(listener, options);
    } catch (error) {
      // WHY: The AbortSignal can change while the awaited session start is pending; TypeScript retains the earlier non-aborted narrowing.
      // oxlint-disable-next-line typescript/no-unnecessary-condition
      if (signal.aborted) {
        throw new UnretryableVoiceTranscriptionError("Voice transcription was cancelled");
      }
      if (
        error instanceof UnretryableVoiceTranscriptionError ||
        attempt >= VOICE_SESSION_START_RETRIES
      ) {
        throw error;
      }
      await wait(VOICE_SESSION_START_RETRY_BASE_MS * 2 ** attempt);
    }
  }
}

function deferredVoiceSession(
  start: () => Promise<VoiceTranscriptionSession>,
  capturedAudio: CapturedAudioChunk[],
): VoiceTranscriptionSession {
  let session: VoiceTranscriptionSession | null = null;
  let starting: Promise<VoiceTranscriptionSession> | null = null;
  let cancelled = false;
  const isCancelled = (): boolean => cancelled;
  const ensureSession = async () => {
    if (isCancelled()) {
      throw new UnretryableVoiceTranscriptionError("Voice transcription was cancelled");
    }
    if (session !== null) {
      return session;
    }
    if (starting === null) {
      starting = start();
    }
    try {
      session = await starting;
      if (isCancelled()) {
        throw new UnretryableVoiceTranscriptionError("Voice transcription was cancelled");
      }
      for (const chunk of capturedAudio.splice(0)) {
        session.appendAudio(chunk);
      }
      return session;
    } finally {
      starting = null;
    }
  };
  return {
    appendAudio: (chunk) => {
      if (session !== null) {
        session.appendAudio(chunk);
      } else if (!isCancelled()) {
        capturedAudio.push(chunk);
      }
    },
    cancel: async () => {
      cancelled = true;
      capturedAudio.length = 0;
      const live = session ?? (await starting?.catch(() => null)) ?? null;
      if (live !== null) {
        await live.cancel();
      }
    },
    finish: async () => {
      await (await ensureSession()).finish();
    },
  };
}

async function wait(delayMs: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, delayMs);
  });
}
