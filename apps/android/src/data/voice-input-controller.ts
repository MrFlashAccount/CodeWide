import type { Thread } from "@codewide/codex-protocol/v0.155.1/v2";

import {
  cancelVoiceRecognition,
  startPcmCapture,
  startVoiceRecognition,
  type CapturedAudioChunk,
} from "../native/native-transport";
import { insertTranscriptAtSelection, type DraftSelection } from "./voice-draft";
import { voiceHandoffBehavior$ } from "./voiceHandoffState";
import type { VoiceHandoffBehavior } from "./voiceHandoffPreferences";
import { transcriptionLanguageHint } from "./transcription-language";
import {
  createV1MicrophoneLeaseRegistry,
  type V1MicrophoneLease,
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
  readonly operation: VoiceOperation;
  readonly releaseMicrophone: () => Promise<void>;
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

type VoiceOperation = {
  readonly binding: VoiceBinding;
  capturedAudioChunks: number;
  readonly captureStopped: Promise<void>;
  finishPromise: Promise<void> | null;
  insertionCursor: number;
  microphoneLease: V1MicrophoneLease | null;
  originalDraft: string;
  readonly recording: AbortController;
  readonly resolveCaptureStopped: () => void;
  retrySendAfter: ((text: string) => void) | null;
  retrySession: VoiceTranscriptionSession | null;
  sendAfterFinish: ((text: string) => void) | null;
  session: VoiceTranscriptionSession | null;
  sessionPromise: Promise<VoiceTranscriptionSession> | null;
  stopCapture: (() => void | Promise<void>) | null;
  transcribedDraft: string;
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
const noop = (): void => undefined;

/**
 * Process owner for the single Android microphone and scope-qualified
 * transcription jobs. Only live capture is exclusive; once capture stops,
 * remote transcription and retry payloads may coexist across input scopes.
 * React binds callbacks and renders its TanStack projection, but component
 * mount/unmount never owns either lifetime.
 */
export class VoiceInputController {
  private readonly resources: WorkspaceResourceDatabase;
  private readonly microphoneLeases: V1MicrophoneLeaseRegistry;
  private readonly handoffBehavior: () => VoiceHandoffBehavior;
  private binding: VoiceBinding | null = null;
  private activeOperation: VoiceOperation | null = null;
  private readonly activeCaptureSubscribers = new Set<() => void>();
  private readonly operations = new Map<string, VoiceOperation>();
  private readonly levelByScope = new Map<string, number>();
  private readonly levelSubscribers = new Map<string, Set<() => void>>();
  private readonly errorTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private appLockDictation: AppLockDictationState = { status: "inactive" };

  constructor(
    resources: WorkspaceResourceDatabase,
    microphoneLeases: V1MicrophoneLeaseRegistry = createV1MicrophoneLeaseRegistry(
      () => `dictation-compatibility-${String(++compatibilityLeaseSequence)}`,
    ),
    handoffBehavior: () => VoiceHandoffBehavior = () => voiceHandoffBehavior$.get(),
  ) {
    this.resources = resources;
    this.microphoneLeases = microphoneLeases;
    this.handoffBehavior = handoffBehavior;
  }

  activeCaptureScope(): string | null {
    return this.activeOperation?.binding.scope ?? null;
  }

  subscribeActiveCapture(listener: () => void): () => void {
    this.activeCaptureSubscribers.add(listener);
    return () => {
      this.activeCaptureSubscribers.delete(listener);
    };
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
    if (binding === null || binding.scope !== scope) {
      return;
    }
    const existing = this.operations.get(scope);
    if (existing !== undefined) {
      if (this.activeOperation !== existing) {
        return;
      }
      const processState = this.state(scope);
      if (processState.phase === "starting") {
        await this.discard(scope);
      } else if (processState.phase !== "finishing") {
        await this.finish(scope, false);
      }
      return;
    }
    if (this.activeOperation !== null) {
      const previous = this.activeOperation;
      const behavior = this.handoffBehavior();
      if (
        behavior === "disable" ||
        this.state(previous.binding.scope).phase !== "recording" ||
        previous.microphoneLease === null
      ) {
        return;
      }
      const replacement = this.microphoneLeases.replaceDictation(
        previous.microphoneLease,
        binding.scope,
      );
      if (replacement.status === "busy") {
        return;
      }
      const finishing = this.finish(previous.binding.scope, behavior === "send");
      await previous.captureStopped;
      void finishing.catch(() => undefined);
      await this.start(binding, replacement.lease);
      return;
    }
    await this.start(binding);
  }

  private async start(
    binding: VoiceBinding,
    preparedLease: V1MicrophoneLease | null = null,
  ): Promise<void> {
    const recording = new AbortController();
    const source = binding.source();
    const selection = binding.selection();
    let resolveCaptureStopped = noop;
    const captureStopped = new Promise<void>((resolve) => {
      resolveCaptureStopped = resolve;
    });
    const operation: VoiceOperation = {
      binding,
      capturedAudioChunks: 0,
      captureStopped,
      finishPromise: null,
      insertionCursor: Math.max(0, Math.min(source.length, selection.start)),
      microphoneLease: null,
      originalDraft: source,
      recording,
      resolveCaptureStopped,
      retrySendAfter: null,
      retrySession: null,
      sendAfterFinish: null,
      session: null,
      sessionPromise: null,
      stopCapture: null,
      transcribedDraft: source,
    };
    this.operations.set(binding.scope, operation);
    this.setActiveOperation(operation);
    this.publishLevel(binding.scope, 0);
    this.put(binding.scope, { ...IDLE_VOICE, phase: "starting" });
    let acquisition: Awaited<ReturnType<V1MicrophoneLeaseRegistry["acquireDictation"]>>;
    try {
      acquisition =
        preparedLease === null
          ? await this.microphoneLeases.acquireDictation(binding.scope)
          : { lease: preparedLease, status: "acquired" };
    } catch (error) {
      if (this.isCurrent(operation)) {
        await this.failOperation(operation, messageOf(error));
      }
      return;
    }
    // A cancelled start must not reset a replacement recording when handoff settles.
    if (!this.isCurrent(operation) || recording.signal.aborted) {
      if (acquisition.status === "acquired") {
        await acquisition.lease.release().catch(() => undefined);
      }
      return;
    }
    if (acquisition.status === "busy") {
      this.removeOperation(operation);
      this.resetUi(binding.scope, { error: "Microphone is already in use" });
      return;
    }
    const microphoneLease = acquisition.lease;
    operation.microphoneLease = microphoneLease;
    let microphoneReleased = false;
    const releaseMicrophone = async (): Promise<void> => {
      if (microphoneReleased) {
        return;
      }
      microphoneReleased = true;
      await microphoneLease.release().catch((error: unknown) => {
        if (this.isCurrent(operation)) {
          this.patch(binding.scope, {
            error: `Could not return microphone: ${messageOf(error)}`,
          });
        }
      });
    };
    const renderVoiceTranscript = (transcript: string, publishDraft = true) => {
      if (recording.signal.aborted) {
        return;
      }
      const insertion = insertTranscriptAtSelection(source, selection, transcript);
      operation.insertionCursor = insertion.cursor;
      operation.transcribedDraft = insertion.text;
      if (publishDraft) {
        binding.updateDraft(insertion.text);
      }
    };
    if (binding.startRemote === undefined) {
      await this.startAndroidFallback({
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
          if (!this.isCurrent(operation) || recording.signal.aborted) {
            return;
          }
          operation.capturedAudioChunks += 1;
          this.publishLevel(binding.scope, chunk.level);
          if (streamingSession !== null) {
            streamingSession.appendAudio(chunk);
          } else {
            pendingAudio.push(chunk);
          }
        },
        (message) => {
          if (this.isCurrent(operation) && !recording.signal.aborted) {
            this.failOperation(
              operation,
              `Microphone stopped · ${message.replaceAll("_", " ")}`,
            ).catch(() => undefined);
          }
        },
      );
      if (!this.isCurrent(operation)) {
        await capture.stop().catch(() => undefined);
        await microphoneLease.release().catch(() => undefined);
        return;
      }
      operation.stopCapture = async () => {
        try {
          await capture.stop();
        } finally {
          // Capture is closed. Global Voice may reconnect in the background;
          // its transport must not delay this dictation's finalization.
          releaseMicrophone().catch(() => undefined);
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
          renderTranscript(operation.sendAfterFinish === null && operation.retrySendAfter === null);
        } else if (event.type === "error") {
          this.failOperation(operation, event.message).catch(() => undefined);
        } else {
          this.failOperation(
            operation,
            event.reason === null
              ? "Transcription connection closed"
              : `Transcription stopped · ${event.reason}`,
          ).catch(() => undefined);
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
      operation.sessionPromise = sessionPromise;
      const session = await sessionPromise;
      if (operation.sessionPromise === sessionPromise) {
        operation.sessionPromise = null;
      }
      if (!this.isCurrent(operation)) {
        await session.cancel().catch(() => undefined);
        return;
      }
      streamingSession = session;
      operation.session = session;
      for (const chunk of pendingAudio.splice(0)) {
        session.appendAudio(chunk);
      }
    } catch (error) {
      releaseMicrophone().catch(() => undefined);
      if (!this.isCurrent(operation)) {
        return;
      }
      const sendAfter = operation.sendAfterFinish;
      await this.stopOperationCapture(operation).catch(() => undefined);
      operation.sessionPromise = null;
      operation.session = null;
      if (this.activeOperation === operation) {
        this.setActiveOperation(null);
      }
      if (pendingAudio.length > 0 && startSession !== null) {
        operation.retrySession = deferredVoiceSession(startSession, pendingAudio);
        operation.retrySendAfter = sendAfter;
        this.resetUi(binding.scope, {
          error: `OpenAI transcription: ${messageOf(error)}`,
          retryAvailable: true,
        });
      } else {
        this.removeOperation(operation);
        this.resetUi(binding.scope, { error: `OpenAI transcription: ${messageOf(error)}` });
      }
      operation.sendAfterFinish = null;
    }
  }

  /** Ends protected capture into its draft; only successful app unlock may resume it. */
  async pauseForAppLock(): Promise<void> {
    const operation = this.activeOperation;
    if (operation === null) {
      return;
    }
    const binding = operation.binding;
    const state = this.state(binding.scope);
    if (state.phase === "starting") {
      this.appLockDictation = { scope: binding.scope, status: "paused" };
      await this.discard(binding.scope);
      return;
    }
    if (state.phase === "finishing") {
      await operation.finishPromise;
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
    const operation = this.operations.get(scope);
    if (operation === undefined) {
      return;
    }
    const binding = operation.binding;
    if (sendAfter) {
      operation.sendAfterFinish = sendOverride ?? binding.send;
    }
    if (operation.finishPromise !== null) {
      await operation.finishPromise;
      return;
    }
    if (this.activeOperation !== operation) {
      return;
    }
    // There is no audio yet. Abort the pending native start so its eventual
    // completion cannot resurrect recording behind a closed input.
    if (this.state(scope).phase === "starting") {
      await this.discard(scope);
      return;
    }
    const finishing = this.finishCurrent(operation);
    operation.finishPromise = finishing;
    try {
      await finishing;
    } finally {
      if (operation.finishPromise === finishing) {
        operation.finishPromise = null;
      }
    }
  }

  async retry(scope: string): Promise<void> {
    const operation = this.operations.get(scope);
    if (operation === undefined) {
      return;
    }
    // The retry affordance can render from the same atomic state update that
    // finishes the previous attempt. Do not drop a fast tap during the tiny
    // interval before that attempt clears its promise.
    const previousFinish = operation.finishPromise;
    if (previousFinish !== null) {
      await previousFinish.catch(() => undefined);
    }
    if (!this.isCurrent(operation)) {
      return;
    }
    const binding = operation.binding;
    const session = operation.retrySession;
    if (session === null) {
      return;
    }
    const sendAfter = operation.retrySendAfter;
    this.patch(binding.scope, { error: null, phase: "finishing", retryAvailable: false });
    const retrying = (async () => {
      try {
        await session.finish();
        if (!this.isCurrent(operation)) {
          return;
        }
        operation.recording.abort();
        operation.retrySession = null;
        operation.retrySendAfter = null;
        this.removeOperation(operation);
        this.resetUi(binding.scope, {
          pendingSelection:
            sendAfter === null
              ? { end: operation.insertionCursor, start: operation.insertionCursor }
              : null,
        });
        sendAfter?.(operation.transcribedDraft);
      } catch (error) {
        if (!this.isCurrent(operation)) {
          return;
        }
        if (!(error instanceof UnretryableVoiceTranscriptionError)) {
          operation.retrySession = session;
          operation.retrySendAfter = sendAfter;
          this.resetUi(binding.scope, { error: messageOf(error), retryAvailable: true });
        } else {
          operation.recording.abort();
          operation.retrySession = null;
          operation.retrySendAfter = null;
          this.removeOperation(operation);
          void session.cancel().catch(() => undefined);
          this.resetUi(binding.scope, { error: messageOf(error) });
        }
      }
    })();
    operation.finishPromise = retrying;
    try {
      await retrying;
    } finally {
      if (operation.finishPromise === retrying) {
        operation.finishPromise = null;
      }
    }
  }

  /** Discards the current/retryable recording and restores the pre-recording draft. */
  async discard(scope: string): Promise<void> {
    const operation = this.operations.get(scope);
    if (operation === undefined) {
      return;
    }
    const { binding, originalDraft } = operation;
    operation.recording.abort();
    this.removeOperation(operation);
    const stopping = this.stopOperationCapture(operation).catch((error: unknown) => {
      this.patch(scope, { error: `Could not stop microphone: ${messageOf(error)}` });
    });
    cancelVoiceRecognition();
    const session = operation.session;
    const retrySession = operation.retrySession;
    const pendingSession = operation.sessionPromise;
    operation.session = null;
    operation.retrySession = null;
    operation.sessionPromise = null;
    operation.sendAfterFinish = null;
    operation.retrySendAfter = null;
    binding.updateDraft(originalDraft);
    this.resetUi(scope);
    await Promise.all([
      stopping,
      Promise.all([
        session?.cancel().catch(() => undefined),
        retrySession !== session ? retrySession?.cancel().catch(() => undefined) : undefined,
        pendingSession
          ?.then(async (pending) => {
            await pending.cancel();
          })
          .catch(() => undefined),
      ]),
    ]);
  }

  clearPendingSelection(scope: string): void {
    this.patch(scope, { pendingSelection: null });
  }

  setPendingSelection(scope: string, selection: DraftSelection): void {
    this.patch(scope, { pendingSelection: selection });
  }

  private async finishCurrent(operation: VoiceOperation): Promise<void> {
    const { binding } = operation;
    // End the recording animation immediately; final audio still has to flush
    // before finish() is sent to the transcription server.
    this.patch(binding.scope, { phase: "finishing" });
    try {
      await this.stopOperationCapture(operation);
    } catch (error) {
      if (this.isCurrent(operation)) {
        await this.failOperation(operation, messageOf(error));
      }
      return;
    }
    if (!this.isCurrent(operation)) {
      return;
    }
    if (this.activeOperation === operation) {
      this.setActiveOperation(null);
    }
    let session = operation.session;
    if (session === null && operation.sessionPromise !== null) {
      try {
        session = await operation.sessionPromise;
      } catch (error) {
        if (this.isCurrent(operation)) {
          operation.sessionPromise = null;
          this.removeOperation(operation);
          this.resetUi(binding.scope, { error: messageOf(error) });
        }
        return;
      }
    }
    if (!this.isCurrent(operation)) {
      return;
    }
    operation.sessionPromise = null;
    const sendAfter = operation.sendAfterFinish;
    if (binding.startRemote !== undefined && operation.capturedAudioChunks === 0) {
      operation.session = null;
      if (session !== null) {
        await session.cancel().catch(() => undefined);
      }
      if (this.isCurrent(operation)) {
        this.removeOperation(operation);
        this.resetUi(binding.scope, {
          error: "Recording was too short · hold the microphone and try again",
        });
        operation.sendAfterFinish = null;
      }
      return;
    }
    let completed = false;
    try {
      if (session !== null) {
        await session.finish();
        if (!this.isCurrent(operation)) {
          return;
        }
        operation.session = null;
      } else {
        cancelVoiceRecognition();
      }
      completed = true;
    } catch (error) {
      if (!this.isCurrent(operation)) {
        return;
      }
      operation.session = null;
      if (session !== null && !(error instanceof UnretryableVoiceTranscriptionError)) {
        if (this.isCurrent(operation)) {
          operation.retrySession = session;
          operation.retrySendAfter = sendAfter;
          this.resetUi(binding.scope, { error: messageOf(error), retryAvailable: true });
        }
      } else {
        if (session !== null) {
          void session.cancel().catch(() => undefined);
        }
        if (this.isCurrent(operation)) {
          operation.retrySession = null;
          operation.retrySendAfter = null;
          this.removeOperation(operation);
          this.resetUi(binding.scope, { error: messageOf(error) });
        }
      }
    } finally {
      if (this.isCurrent(operation)) {
        operation.sendAfterFinish = null;
      }
      if (completed && this.isCurrent(operation)) {
        operation.recording.abort();
        this.removeOperation(operation);
        this.resetUi(binding.scope, {
          pendingSelection:
            sendAfter === null
              ? { end: operation.insertionCursor, start: operation.insertionCursor }
              : null,
        });
        sendAfter?.(operation.transcribedDraft);
      }
    }
  }

  private async startAndroidFallback({
    operation,
    releaseMicrophone,
    renderTranscript,
  }: AndroidFallbackRequest): Promise<void> {
    const { binding } = operation;
    try {
      const stop = await startVoiceRecognition((event) => {
        if (!this.isCurrent(operation)) {
          return;
        }
        if ((event.type === "partial" || event.type === "final") && event.text !== undefined) {
          renderTranscript(event.text);
        }
        if (event.type === "final" || event.type === "error") {
          void this.stopOperationCapture(operation).catch((error: unknown) => {
            this.patch(binding.scope, {
              error: `Could not stop microphone: ${messageOf(error)}`,
            });
          });
          this.resetUi(
            binding.scope,
            event.type === "error"
              ? {
                  error: `Voice input stopped${event.text === undefined ? "" : ` · ${event.text.replaceAll("_", " ")}`}`,
                }
              : {},
          );
          this.removeOperation(operation);
        }
      });
      if (!this.isCurrent(operation)) {
        stop();
        releaseMicrophone().catch(() => undefined);
        return;
      }
      operation.stopCapture = () => {
        try {
          stop();
        } finally {
          releaseMicrophone().catch(() => undefined);
        }
      };
      this.patch(binding.scope, { backend: "android", phase: "recording" });
    } catch (error) {
      releaseMicrophone().catch(() => undefined);
      if (!this.isCurrent(operation)) {
        return;
      }
      this.removeOperation(operation);
      this.resetUi(binding.scope, { error: messageOf(error) });
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

  private async failOperation(operation: VoiceOperation, message: string): Promise<void> {
    if (!this.isCurrent(operation)) {
      return;
    }
    const scope = operation.binding.scope;
    operation.recording.abort();
    this.removeOperation(operation);
    await this.stopOperationCapture(operation).catch(() => undefined);
    const session = operation.session;
    operation.session = null;
    operation.sessionPromise = null;
    operation.sendAfterFinish = null;
    operation.retrySendAfter = null;
    if (session !== null) {
      void session.cancel().catch(() => undefined);
    }
    this.resetUi(scope, { error: message });
  }

  private async stopOperationCapture(operation: VoiceOperation): Promise<void> {
    const stop = operation.stopCapture;
    operation.stopCapture = null;
    if (stop === null) {
      operation.resolveCaptureStopped();
      return;
    }
    try {
      await stop();
    } finally {
      operation.resolveCaptureStopped();
    }
  }

  private isCurrent(operation: VoiceOperation): boolean {
    return this.operations.get(operation.binding.scope) === operation;
  }

  private removeOperation(operation: VoiceOperation): void {
    if (this.operations.get(operation.binding.scope) === operation) {
      this.operations.delete(operation.binding.scope);
    }
    if (this.activeOperation === operation) {
      this.setActiveOperation(null);
    }
  }

  private setActiveOperation(operation: VoiceOperation | null): void {
    if (this.activeOperation === operation) {
      return;
    }
    this.activeOperation = operation;
    for (const listener of this.activeCaptureSubscribers) {
      listener();
    }
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
