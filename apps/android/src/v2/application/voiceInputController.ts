import type {
  VoiceSessionHandle,
  VoiceTransport,
  VoiceTransportEvent,
  VoiceTransportStartInput,
} from "./ports/voiceTransport";
import type { SavedServerId } from "../domain/ids";
import type { VoiceInputScope } from "../domain/voiceInputScope";
import {
  VOICE_INPUT_IDLE_SNAPSHOT,
  VoiceInputPresentationStore,
  type VoiceInputSnapshot,
} from "./voiceInputPresentationStore";
import {
  createVoiceTranscriptSubmission,
  type VoiceTranscriptSubmission,
} from "./voiceTranscriptSubmission";

export type { VoiceInputSnapshot, VoiceInputState } from "./voiceInputPresentationStore";

type ActiveVoiceSession = Awaited<ReturnType<VoiceTransport["start"]>>;
const ZERO_CLOCK = (): number => 0;

export interface VoiceInputBinding extends Omit<VoiceTransportStartInput, "onEvent" | "signal"> {
  onSubmitTranscript?(text: string): Promise<boolean>;
  onTranscript(text: string): void;
}

interface VoiceProcessSession {
  abort: AbortController;
  binding: VoiceInputBinding;
  cancelRequested: boolean;
  handle: VoiceSessionHandle | null;
  resultAction: "insert" | "submit";
  startedAtMs: number;
  submission: VoiceTranscriptSubmission | null;
}

interface PendingVoiceStart {
  abort: AbortController;
  promise: Promise<ActiveVoiceSession>;
}

/** Process owner for the single V2 microphone and its original target binding. */
export class VoiceInputController {
  readonly transport: VoiceTransport;
  readonly #active = new Map<SavedServerId, Set<ActiveVoiceSession>>();
  readonly #pending = new Set<PendingVoiceStart>();
  readonly #bindings = new Map<string, VoiceInputBinding>();
  readonly #pendingTranscripts = new Map<string, string[]>();
  readonly #presentation = new VoiceInputPresentationStore();
  readonly #now: () => number;
  #lifecycleGeneration = 0;
  #process: VoiceProcessSession | null = null;

  constructor(transport: VoiceTransport, now: () => number = ZERO_CLOCK) {
    this.transport = transport;
    this.#now = now;
  }

  snapshot(key: string): VoiceInputSnapshot {
    return this.#presentation.snapshot(key);
  }

  subscribe(key: string, listener: () => void): () => void {
    return this.#presentation.subscribe(key, listener);
  }

  activeSnapshot(): VoiceInputSnapshot {
    return this.#presentation.activeSnapshot();
  }

  subscribeActive(listener: () => void): () => void {
    return this.#presentation.subscribeActive(listener);
  }

  level(key: string): number {
    return this.#presentation.level(key);
  }

  subscribeLevel(key: string, listener: () => void): () => void {
    return this.#presentation.subscribeLevel(key, listener);
  }

  activeLevel(): number {
    return this.#presentation.activeLevel();
  }

  subscribeActiveLevel(listener: () => void): () => void {
    return this.#presentation.subscribeActiveLevel(listener);
  }

  bind(binding: VoiceInputBinding): () => void {
    const key = bindingKey(binding);
    this.#bindings.set(key, binding);
    const pending = this.#pendingTranscripts.get(key);
    if (pending !== undefined) {
      for (const transcript of pending) binding.onTranscript(transcript);
      this.#pendingTranscripts.delete(key);
    }
    return () => {
      if (this.#bindings.get(key) === binding) this.#bindings.delete(key);
    };
  }

  async begin(binding: VoiceInputBinding): Promise<void> {
    if (this.#process !== null) return;
    const process: VoiceProcessSession = {
      abort: new AbortController(),
      binding,
      cancelRequested: false,
      handle: null,
      resultAction: "insert",
      startedAtMs: this.#now(),
      submission: null,
    };
    this.#setProcess(process);
    this.#publishLevel(binding, 0);
    this.#publish(binding, {
      message: null,
      startedAtMs: process.startedAtMs,
      state: "starting",
    });
    try {
      const started = await this.start({
        audience: binding.audience,
        onEvent: (event) => this.#onProcessEvent(process, event),
        scope: binding.scope,
        signal: process.abort.signal,
        sourceGeneration: binding.sourceGeneration,
        thread: binding.thread,
      });
      process.handle = started;
      if (this.#process !== process) {
        await this.cancelSession(started);
        return;
      }
    } catch (cause) {
      // User/runtime cancellation already retired this process and restored idle UI.
      if (this.#process !== process) return;
      this.#setProcess(null);
      this.#publish(binding, {
        message: `OpenAI transcription: ${errorOf(cause).message}`,
        state: "error",
      });
      throw cause;
    }
  }

  async activate(binding: VoiceInputBinding | null): Promise<void> {
    const process = this.#process;
    if (process === null) {
      if (binding !== null) await this.begin(binding);
      return;
    }
    const state = this.snapshot(bindingKey(process.binding)).state;
    if (state === "starting") {
      this.#abandonProcess();
      return;
    }
    if (state === "retry") {
      await this.retry();
      return;
    }
    if (state !== "finishing") await this.finish(false);
  }

  /** Discards capture and transcript output for the process-owned Voice session. */
  async cancel(): Promise<void> {
    const process = this.#process;
    if (process === null) return;
    const state = this.snapshot(bindingKey(process.binding)).state;
    if (state === "cancelling") return;
    process.cancelRequested = true;
    this.#publishLevel(process.binding, 0);
    this.#publish(process.binding, { message: "Cancelling voice…", state: "cancelling" });
    if (process.handle === null) {
      this.#abandonProcess();
      return;
    }
    try {
      await process.handle.cancel();
      if (this.#process === process) {
        process.submission?.reject(new Error("Voice input cancelled"));
        process.submission = null;
        this.#setProcess(null);
        this.#publish(process.binding, VOICE_INPUT_IDLE_SNAPSHOT);
      }
    } catch (cause) {
      if (this.#process !== process) {
        if (process.cancelRequested) return;
        throw cause;
      }
      this.#setProcess(null);
      this.#publish(process.binding, {
        message: "Voice input could not be cancelled. Try again.",
        state: "error",
      });
      throw errorOf(cause);
    }
  }

  /** Retries the server-owned finish operation without recapturing audio. */
  async retry(): Promise<void> {
    const process = this.#process;
    if (process === null || this.snapshot(bindingKey(process.binding)).state !== "retry") return;
    await this.finish(process.resultAction === "submit");
  }

  async finish(sendAfter: boolean): Promise<void> {
    const process = this.#process;
    if (
      process === null ||
      process.handle === null ||
      (this.snapshot(bindingKey(process.binding)).state !== "recording" &&
        this.snapshot(bindingKey(process.binding)).state !== "retry")
    )
      return;
    const submission = sendAfter ? createVoiceTranscriptSubmission() : null;
    process.resultAction = sendAfter ? "submit" : "insert";
    process.submission = submission;
    const processSnapshot = this.snapshot(bindingKey(process.binding));
    this.#publishLevel(process.binding, 0);
    this.#publish(process.binding, {
      message: processSnapshot.message,
      startedAtMs: process.startedAtMs,
      state: "finishing",
    });
    try {
      if (submission === null) await process.handle.finish();
      else await Promise.all([process.handle.finish(), submission.promise]);
    } catch (cause) {
      if (this.#process !== process) {
        if (process.cancelRequested) return;
        throw cause;
      }
      const error = errorOf(cause);
      if (process.submission === submission) {
        process.submission = null;
        submission?.reject(error);
      }
      this.#setProcess(null);
      this.#publishLevel(process.binding, 0);
      this.#publish(process.binding, {
        message: "Voice input is unavailable. Try again.",
        state: "error",
      });
      throw error;
    }
  }

  async start(input: Parameters<VoiceTransport["start"]>[0]): ReturnType<VoiceTransport["start"]> {
    const lifecycleGeneration = this.#lifecycleGeneration;
    const abort = new AbortController();
    const abortFromCaller = (): void => abort.abort();
    if (input.signal.aborted) abort.abort();
    else input.signal.addEventListener("abort", abortFromCaller, { once: true });
    const active = this.#activeFor(input.audience);
    let handle: ActiveVoiceSession | null = null;
    let endedBeforeStart = false;
    const remove = (): void => {
      if (handle === null) {
        endedBeforeStart = true;
        return;
      }
      active.delete(handle);
      if (active.size === 0) this.#active.delete(input.audience);
    };
    const starting = this.transport.start({
      ...input,
      signal: abort.signal,
      onEvent: (event) => {
        input.onEvent(event);
        if (event.type === "result" || event.type === "cancelled" || event.type === "error")
          remove();
      },
    });
    const pending = { abort, promise: starting };
    this.#pending.add(pending);
    try {
      handle = await starting;
    } finally {
      input.signal.removeEventListener("abort", abortFromCaller);
      this.#pending.delete(pending);
    }
    if (lifecycleGeneration !== this.#lifecycleGeneration)
      throw new Error("Voice input lifecycle changed");
    if (!endedBeforeStart) active.add(handle);
    return handle;
  }

  /** Stops every active Voice transport for one saved server before deletion. */
  async cancelSavedServer(savedServerId: SavedServerId): Promise<void> {
    if (this.#process?.binding.audience === savedServerId) this.#abandonProcess();
    const active = this.#active.get(savedServerId);
    if (active === undefined) return;
    await Promise.all([...active].map((handle) => handle.cancel().catch(() => undefined)));
    this.#active.delete(savedServerId);
  }

  /** Cancels only the exact session selected by process-owned lifecycle control. */
  async cancelSession(handle: ActiveVoiceSession): Promise<void> {
    for (const [savedServerId, active] of this.#active) {
      if (!active.delete(handle)) continue;
      if (active.size === 0) this.#active.delete(savedServerId);
      break;
    }
    await handle.cancel().catch(() => undefined);
  }

  /** Cancels Voice only for whole-runtime teardown, never for route or app-background changes. */
  async cancelAll(): Promise<void> {
    this.#lifecycleGeneration += 1;
    this.#abandonProcess();
    const cancellations: Array<Promise<void>> = [];
    for (const active of this.#active.values()) {
      for (const handle of active) cancellations.push(handle.cancel().catch(() => undefined));
    }
    this.#active.clear();
    for (const pending of this.#pending) {
      pending.abort.abort();
      cancellations.push(pending.promise.then((handle) => handle.cancel()).catch(() => undefined));
    }
    await Promise.all(cancellations);
  }

  #onProcessEvent(process: VoiceProcessSession, event: VoiceTransportEvent): void {
    if (this.#process !== process) return;
    if (event.type === "recording") {
      this.#publishLevel(process.binding, 0);
      this.#publish(process.binding, {
        message: "Listening…",
        startedAtMs: process.startedAtMs,
        state: "recording",
      });
      return;
    }
    if (event.type === "level") {
      const current = this.snapshot(bindingKey(process.binding));
      if (current.state !== "recording") return;
      this.#publishLevel(process.binding, event.level);
      return;
    }
    if (event.type === "result") {
      this.#completeResult(process, event.text).catch(() => undefined);
      return;
    }
    if (event.type === "retry") {
      process.submission?.resolve();
      process.submission = null;
      this.#publishLevel(process.binding, 0);
      this.#publish(process.binding, {
        message: `Voice is busy. Try again in ${Math.ceil(event.retryAfterMs / 1e3)} seconds.`,
        startedAtMs: process.startedAtMs,
        state: "retry",
      });
      return;
    }
    process.submission?.reject(new Error("Voice input ended without a transcript"));
    this.#setProcess(null);
    this.#publishLevel(process.binding, 0);
    this.#publish(
      process.binding,
      event.type === "cancelled"
        ? VOICE_INPUT_IDLE_SNAPSHOT
        : { message: "Voice input is unavailable. Try again.", state: "error" },
    );
  }

  async #completeResult(process: VoiceProcessSession, text: string): Promise<void> {
    this.#publishLevel(process.binding, 0);
    const submission = process.submission;
    if (process.resultAction === "submit" && process.binding.onSubmitTranscript !== undefined) {
      const completed = await process.binding.onSubmitTranscript(text).catch(() => false);
      if (this.#process !== process) return;
      process.submission = null;
      this.#setProcess(null);
      if (completed) {
        this.#publish(process.binding, VOICE_INPUT_IDLE_SNAPSHOT);
        submission?.resolve();
        return;
      }
      this.#deliverTranscript(process.binding, text);
      this.#publishLevel(process.binding, 0);
      this.#publish(process.binding, {
        message: "Voice transcript could not be sent. Try again.",
        state: "error",
      });
      submission?.reject(new Error("Voice transcript could not be sent"));
      return;
    }
    this.#deliverTranscript(process.binding, text);
    process.submission = null;
    this.#setProcess(null);
    this.#publish(process.binding, VOICE_INPUT_IDLE_SNAPSHOT);
    submission?.resolve();
  }

  #deliverTranscript(binding: VoiceInputBinding, text: string): void {
    const key = bindingKey(binding);
    const current = this.#bindings.get(key);
    if (current !== undefined) {
      current.onTranscript(text);
      return;
    }
    const pending = this.#pendingTranscripts.get(key) ?? [];
    pending.push(text);
    this.#pendingTranscripts.set(key, pending);
  }

  #abandonProcess(): void {
    const process = this.#process;
    process?.abort.abort();
    process?.submission?.reject(new Error("Voice input stopped"));
    this.#setProcess(null);
    if (process !== null) {
      this.#publishLevel(process.binding, 0);
      this.#publish(process.binding, VOICE_INPUT_IDLE_SNAPSHOT);
    }
  }

  #publish(binding: VoiceInputBinding, snapshot: VoiceInputSnapshot): void {
    this.#presentation.publishSnapshot(bindingKey(binding), snapshot);
    if (this.#process?.binding === binding) this.#presentation.publishActiveSnapshot(snapshot);
  }

  #publishLevel(binding: VoiceInputBinding, rawLevel: number): void {
    this.#presentation.publishLevel(bindingKey(binding), rawLevel);
    if (this.#process?.binding === binding) this.#presentation.publishActiveLevel(rawLevel);
  }

  #setProcess(process: VoiceProcessSession | null): void {
    this.#process = process;
    if (process === null) {
      this.#presentation.publishActiveLevel(0);
      this.#presentation.publishActiveSnapshot(VOICE_INPUT_IDLE_SNAPSHOT);
      return;
    }
    const key = bindingKey(process.binding);
    this.#presentation.publishActiveLevel(this.#presentation.level(key));
    this.#presentation.publishActiveSnapshot(this.#presentation.snapshot(key));
  }

  #activeFor(savedServerId: SavedServerId): Set<ActiveVoiceSession> {
    let active = this.#active.get(savedServerId);
    if (active === undefined) {
      active = new Set();
      this.#active.set(savedServerId, active);
    }
    return active;
  }
}

export function voiceInputScopeKey(audience: SavedServerId, scope: VoiceInputScope): string {
  return JSON.stringify([audience, scope.kind, scope.id]);
}

function bindingKey(binding: VoiceInputBinding): string {
  return voiceInputScopeKey(binding.audience, binding.scope);
}

function errorOf(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error("Voice input failed");
}
