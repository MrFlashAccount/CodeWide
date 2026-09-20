import { beforeEach, describe, expect, it, vi } from "vitest";

import { startPcmCapture, type CapturedAudioChunk } from "../src/native/native-transport";

const capture = vi.hoisted(() => ({
  onChunk: null as ((chunk: CapturedAudioChunk) => void) | null,
  stop: vi.fn(async () => undefined),
}));

vi.mock("../src/native/native-transport", () => ({
  cancelVoiceRecognition: vi.fn(),
  startVoiceRecognition: vi.fn(),
  startPcmCapture: vi.fn(async (_lease: unknown, onChunk: (chunk: CapturedAudioChunk) => void) => {
    capture.onChunk = onChunk;
    return {
      stop: capture.stop,
      info: {
        acousticEchoCancelerEnabled: true,
        acousticEchoCancelerSupported: true,
        sampleRate: 24_000,
        source: "voice_communication" as const,
        noiseSuppressor: true,
        automaticGainControl: true,
      },
    };
  }),
}));

import {
  RetryableVoiceTranscriptionError,
  UnretryableVoiceTranscriptionError,
  VoiceInputController,
  type VoiceTranscriptionEvent,
  type VoiceTranscriptionSession,
} from "../src/data/voice-input-controller";
import { createV1MicrophoneLeaseRegistry } from "../src/data/v1MicrophoneLease";
import type {
  VoiceInputRow,
  WorkspaceResourceDatabase,
} from "../src/data/workspace-resource-database";

function resources(): { database: WorkspaceResourceDatabase; rows: Map<string, VoiceInputRow> } {
  const rows = new Map<string, VoiceInputRow>();
  return {
    rows,
    database: {
      voiceInputs: {
        get: (id: string) => rows.get(id),
        has: (id: string) => rows.has(id),
      },
      putVoiceInput: (row) => rows.set(row.id, { ...row, updatedAt: Date.now() }),
    } as unknown as WorkspaceResourceDatabase,
  };
}

function remoteSession(
  listener: (event: VoiceTranscriptionEvent) => void,
  transcripts: string[],
  failures = 0,
): VoiceTranscriptionSession {
  let attempts = 0;
  return {
    appendAudio: vi.fn(),
    cancel: vi.fn(async () => undefined),
    finish: vi.fn(async () => {
      attempts += 1;
      if (attempts <= failures) throw new RetryableVoiceTranscriptionError("Rate limited", 1_000);
      listener({ type: "done", text: transcripts.shift() ?? "" });
    }),
  };
}

function emitAudio(): void {
  capture.onChunk?.({
    data: "pcm",
    sampleRate: 24_000,
    numChannels: 1,
    samplesPerChannel: 6_000,
    level: 0.4,
  });
}

describe("VoiceInputController", () => {
  beforeEach(() => {
    capture.onChunk = null;
    capture.stop.mockReset();
    capture.stop.mockImplementation(async () => undefined);
  });

  it("waits for Global Voice to yield capture, writes to the requesting input, then resumes it", async () => {
    const { database, rows } = resources();
    const leases = createV1MicrophoneLeaseRegistry(() => "microphone-token");
    const paused = Promise.withResolvers<void>();
    const resumed = Promise.withResolvers<void>();
    const assistant = leases.acquireGlobalSupervisor("activation", {
      pauseForDictation: vi.fn(() => paused.promise),
      resumeAfterDictation: vi.fn(() => resumed.promise),
    });
    if (assistant.status !== "acquired") throw new Error("Expected assistant lease");
    const controller = new VoiceInputController(database, leases);
    const updateDraft = vi.fn();
    controller.bind({
      scope: "review-comment",
      source: () => "Prefix ",
      selection: () => ({ end: 7, start: 7 }),
      thread: null,
      updateDraft,
      send: vi.fn(),
      startRemote: async (listener) => remoteSession(listener, ["dictated text"]),
    });

    const starting = controller.toggle("review-comment");
    await vi.waitFor(() => expect(leases.state().phase).toBe("handoffToDictation"));
    expect(startPcmCapture).not.toHaveBeenCalled();
    paused.resolve();
    await starting;
    expect(rows.get("review-comment")?.phase).toBe("recording");
    expect(leases.state().phase).toBe("dictationOwned");

    emitAudio();
    const finishing = controller.finish("review-comment", false);
    await vi.waitFor(() => expect(leases.state().phase).toBe("handoffBack"));
    await finishing;

    expect(updateDraft).toHaveBeenCalledWith("Prefix dictated text");
    expect(leases.state().phase).toBe("handoffBack");
    resumed.resolve();
    await vi.waitFor(() => expect(leases.state().phase).toBe("assistantOwned"));
    expect(leases.state()).toEqual({
      assistant: { activationId: "activation", kind: "globalSupervisor" },
      phase: "assistantOwned",
    });
    await assistant.lease.release();
  });

  it("sends the final transcript without waiting for the assistant transport to reconnect", async () => {
    const { database, rows } = resources();
    const leases = createV1MicrophoneLeaseRegistry(() => "microphone-token");
    const resumed = Promise.withResolvers<void>();
    const assistant = leases.acquireGlobalSupervisor("activation", {
      pauseForDictation: vi.fn(async () => undefined),
      resumeAfterDictation: vi.fn(() => resumed.promise),
    });
    if (assistant.status !== "acquired") throw new Error("Expected assistant lease");
    const controller = new VoiceInputController(database, leases);
    const send = vi.fn();
    controller.bind({
      scope: "composer",
      source: () => "",
      selection: () => ({ end: 0, start: 0 }),
      thread: null,
      updateDraft: vi.fn(),
      send,
      startRemote: async (listener) => remoteSession(listener, ["send now"]),
    });
    await controller.toggle("composer");
    emitAudio();

    await controller.finish("composer", true);

    expect(send).toHaveBeenCalledExactlyOnceWith("send now");
    expect(rows.get("composer")?.phase).toBe("idle");
    expect(leases.state().phase).toBe("handoffBack");
    resumed.resolve();
    await vi.waitFor(() => expect(leases.state().phase).toBe("assistantOwned"));
    await assistant.lease.release();
  });

  it("clears a transient microphone error after three seconds", async () => {
    vi.useFakeTimers();
    try {
      const { database, rows } = resources();
      const leases = createV1MicrophoneLeaseRegistry(() => "microphone-token");
      const occupied = await leases.acquireDictation("other-input");
      if (occupied.status !== "acquired") throw new Error("Expected occupied microphone");
      const controller = new VoiceInputController(database, leases);
      controller.bind({
        scope: "composer",
        source: () => "",
        selection: () => ({ end: 0, start: 0 }),
        thread: null,
        updateDraft: vi.fn(),
        send: vi.fn(),
        startRemote: vi.fn(),
      });

      await controller.toggle("composer");
      expect(rows.get("composer")?.error).toBe("Microphone is already in use");
      await vi.advanceTimersByTimeAsync(2999);
      expect(rows.get("composer")?.error).toBe("Microphone is already in use");
      await vi.advanceTimersByTimeAsync(1);
      expect(rows.get("composer")?.error).toBeNull();
      await occupied.lease.release();
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns capture to Global Voice when dictation permission or native start fails", async () => {
    const { database, rows } = resources();
    const leases = createV1MicrophoneLeaseRegistry(() => "microphone-token");
    const resumeAfterDictation = vi.fn(async () => undefined);
    const assistant = leases.acquireGlobalSupervisor("activation", {
      pauseForDictation: vi.fn(async () => undefined),
      resumeAfterDictation,
    });
    if (assistant.status !== "acquired") throw new Error("Expected assistant lease");
    vi.mocked(startPcmCapture).mockRejectedValueOnce(new Error("microphone permission denied"));
    const controller = new VoiceInputController(database, leases);
    const startRemote = vi.fn();
    controller.bind({
      scope: "composer",
      source: () => "",
      selection: () => ({ end: 0, start: 0 }),
      thread: null,
      updateDraft: vi.fn(),
      send: vi.fn(),
      startRemote,
    });

    await controller.toggle("composer");

    expect(resumeAfterDictation).toHaveBeenCalledOnce();
    expect(startRemote).not.toHaveBeenCalled();
    expect(rows.get("composer")).toMatchObject({
      error: "OpenAI transcription: microphone permission denied",
      phase: "idle",
    });
    expect(leases.state()).toEqual({
      assistant: { activationId: "activation", kind: "globalSupervisor" },
      phase: "assistantOwned",
    });
    await assistant.lease.release();
  });

  it("ends the recording presentation before native stop finishes, without truncating audio", async () => {
    const { database, rows } = resources();
    const controller = new VoiceInputController(database);
    const stopped = Promise.withResolvers<void>();
    capture.stop.mockImplementation(() => stopped.promise);
    const session: VoiceTranscriptionSession = {
      appendAudio: vi.fn(),
      cancel: vi.fn(async () => undefined),
      finish: vi.fn(async () => undefined),
    };
    controller.bind({
      scope: "thread",
      source: () => "",
      selection: () => ({ start: 0, end: 0 }),
      thread: null,
      updateDraft: vi.fn(),
      send: vi.fn(),
      startRemote: async () => session,
    });
    await controller.toggle("thread");
    emitAudio();
    const finish = controller.finish("thread", false);
    expect(rows.get("thread")?.phase).toBe("finishing");
    expect(session.finish).not.toHaveBeenCalled();
    emitAudio();
    stopped.resolve();
    await finish;
    expect(session.appendAudio).toHaveBeenCalledTimes(2);
    expect(session.finish).toHaveBeenCalledOnce();
    expect(rows.get("thread")?.phase).toBe("idle");
  });

  it("pauses biometric-lock dictation into the draft and resumes only after unlock", async () => {
    const { database, rows } = resources();
    const controller = new VoiceInputController(database);
    let draft = "Existing ";
    const send = vi.fn();
    controller.bind({
      scope: "thread",
      source: () => draft,
      selection: () => ({ end: draft.length, start: draft.length }),
      thread: null,
      updateDraft: (next) => {
        draft = next;
      },
      send,
      startRemote: async (listener) => remoteSession(listener, ["protected transcript"]),
    });
    await controller.toggle("thread");
    emitAudio();
    controller.unbind("thread");

    await controller.pauseForAppLock();

    expect(capture.stop).toHaveBeenCalledOnce();
    expect(draft).toBe("Existing protected transcript");
    expect(send).not.toHaveBeenCalled();
    expect(rows.get("thread")?.phase).toBe("idle");
    const captureStartsBeforeUnlock = vi.mocked(startPcmCapture).mock.calls.length;

    controller.bind({
      scope: "thread",
      source: () => draft,
      selection: () => ({ end: draft.length, start: draft.length }),
      thread: null,
      updateDraft: (next) => {
        draft = next;
      },
      send,
      startRemote: async (listener) => remoteSession(listener, ["continued transcript"]),
    });
    expect(startPcmCapture).toHaveBeenCalledTimes(captureStartsBeforeUnlock);
    await controller.resumeAfterAppUnlock();

    expect(startPcmCapture).toHaveBeenCalledTimes(captureStartsBeforeUnlock + 1);
    expect(rows.get("thread")?.phase).toBe("recording");
    expect(send).not.toHaveBeenCalled();
  });

  it("keeps recording and delivery owned by the original input after another input binds", async () => {
    const { database, rows } = resources();
    const controller = new VoiceInputController(database);
    const updateOwner = vi.fn();
    const sendOwner = vi.fn();
    const updateOther = vi.fn();
    const sendOther = vi.fn();
    const startOther = vi.fn();
    controller.bind({
      scope: "review-line-a",
      source: () => "",
      selection: () => ({ start: 0, end: 0 }),
      thread: null,
      updateDraft: updateOwner,
      send: sendOwner,
      startRemote: async (listener) => remoteSession(listener, ["original input transcript"]),
    });
    await controller.toggle("review-line-a");
    emitAudio();
    controller.unbind("review-line-a");
    controller.bind({
      scope: "composer-b",
      source: () => "",
      selection: () => ({ start: 0, end: 0 }),
      thread: null,
      updateDraft: updateOther,
      send: sendOther,
      startRemote: startOther,
    });
    await controller.toggle("composer-b");
    await controller.finish("composer-b", true, sendOther);
    await controller.discard("composer-b");
    await controller.retry("composer-b");
    expect(rows.get("review-line-a")?.phase).toBe("recording");
    expect(capture.stop).not.toHaveBeenCalled();
    expect(startOther).not.toHaveBeenCalled();
    await controller.finish("review-line-a", true);
    expect(updateOwner).not.toHaveBeenCalled();
    expect(sendOwner).toHaveBeenCalledExactlyOnceWith("original input transcript");
    expect(updateOther).not.toHaveBeenCalled();
    expect(sendOther).not.toHaveBeenCalled();
  });

  it("cancels a pending native start without resurrecting recording after its input closes", async () => {
    const { database, rows } = resources();
    const controller = new VoiceInputController(database);
    const ready = Promise.withResolvers<void>();
    vi.mocked(startPcmCapture).mockImplementationOnce(async () => {
      await ready.promise;
      return { stop: capture.stop, info: null };
    });
    const startRemote = vi.fn();
    controller.bind({
      scope: "thread",
      source: () => "draft",
      selection: () => ({ start: 5, end: 5 }),
      thread: null,
      updateDraft: vi.fn(),
      send: vi.fn(),
      startRemote,
    });
    const starting = controller.toggle("thread");
    expect(rows.get("thread")?.phase).toBe("starting");
    await vi.waitFor(() => expect(startPcmCapture).toHaveBeenCalled());
    await controller.finish("thread", false);
    ready.resolve();
    await starting;
    expect(rows.get("thread")?.phase).toBe("idle");
    expect(capture.stop).toHaveBeenCalledOnce();
    expect(startRemote).not.toHaveBeenCalled();
  });

  it("does not let another input steal, cancel or retry a failed recording", async () => {
    const { database, rows } = resources();
    const controller = new VoiceInputController(database);
    const sendOwner = vi.fn();
    controller.bind({
      scope: "thread",
      source: () => "",
      selection: () => ({ start: 0, end: 0 }),
      thread: null,
      updateDraft: vi.fn(),
      send: sendOwner,
      startRemote: async (listener) => remoteSession(listener, ["retried transcript"], 1),
    });
    await controller.toggle("thread");
    emitAudio();
    await controller.finish("thread", true);
    expect(rows.get("thread")?.retryAvailable).toBe(true);
    const startOther = vi.fn();
    controller.bind({
      scope: "other",
      source: () => "",
      selection: () => ({ start: 0, end: 0 }),
      thread: null,
      updateDraft: vi.fn(),
      send: vi.fn(),
      startRemote: startOther,
    });
    await controller.toggle("other");
    await controller.discard("other");
    await controller.retry("other");
    expect(startOther).not.toHaveBeenCalled();
    expect(rows.get("thread")?.retryAvailable).toBe(true);
    await controller.retry("thread");
    expect(sendOwner).toHaveBeenCalledExactlyOnceWith("retried transcript");
    expect(rows.get("thread")?.retryAvailable).toBe(false);
  });

  it.each([false, true])(
    "rejects a late transcript after discarding a finishing recording (send=%s)",
    async (sendAfter) => {
      const { database, rows } = resources();
      const controller = new VoiceInputController(database);
      const finished = Promise.withResolvers<void>();
      const cancelled = Promise.withResolvers<void>();
      const listeners: Array<(event: VoiceTranscriptionEvent) => void> = [];
      let draft = "original";
      const send = vi.fn();
      const session: VoiceTranscriptionSession = {
        appendAudio: vi.fn(),
        finish: vi.fn(() => finished.promise),
        cancel: vi.fn(() => cancelled.promise),
      };
      controller.bind({
        scope: "thread",
        source: () => draft,
        selection: () => ({ start: draft.length, end: draft.length }),
        thread: null,
        updateDraft: (text) => {
          draft = text;
        },
        send,
        startRemote: async (listener) => {
          listeners.push(listener);
          return session;
        },
      });
      await controller.toggle("thread");
      emitAudio();
      const finishing = controller.finish("thread", sendAfter);
      await vi.waitFor(() => expect(session.finish).toHaveBeenCalledOnce());
      const discarding = controller.discard("thread");
      expect(rows.get("thread")?.phase).toBe("idle");
      expect(session.cancel).toHaveBeenCalledOnce();
      // The server can finish while its cancellation acknowledgement is still pending.
      listeners[0]?.({ type: "delta", text: "late partial" });
      listeners[0]?.({ type: "error", message: "late error" });
      listeners[0]?.({ type: "closed", reason: "late close" });
      listeners[0]?.({ type: "done", text: "late transcript" });
      finished.resolve();
      cancelled.resolve();
      await Promise.all([finishing, discarding]);
      expect(draft).toBe("original");
      expect(send).not.toHaveBeenCalled();
      expect(rows.get("thread")).toMatchObject({
        phase: "idle",
        error: null,
        retryAvailable: false,
      });
    },
  );

  it.each([false, true])(
    "keeps a new recording intact when the discarded finish settles (reject=%s)",
    async (reject) => {
      const { database, rows } = resources();
      const controller = new VoiceInputController(database);
      const oldFinish = Promise.withResolvers<void>();
      const oldCancel = Promise.withResolvers<void>();
      const listeners: Array<(event: VoiceTranscriptionEvent) => void> = [];
      let draft = "original";
      const send = vi.fn();
      const oldSession: VoiceTranscriptionSession = {
        appendAudio: vi.fn(),
        finish: vi.fn(() => oldFinish.promise),
        cancel: vi.fn(() => oldCancel.promise),
      };
      const newSession = remoteSession((event) => listeners[1]?.(event), ["new transcript"]);
      controller.bind({
        scope: "thread",
        source: () => draft,
        selection: () => ({ start: draft.length, end: draft.length }),
        thread: null,
        updateDraft: (text) => {
          draft = text;
        },
        send,
        startRemote: async (listener) => {
          listeners.push(listener);
          return listeners.length === 1 ? oldSession : newSession;
        },
      });
      await controller.toggle("thread");
      emitAudio();
      const finishing = controller.finish("thread", true);
      await vi.waitFor(() => expect(oldSession.finish).toHaveBeenCalledOnce());
      const discarding = controller.discard("thread");
      await controller.toggle("thread");
      emitAudio();
      expect(listeners).toHaveLength(2);
      listeners[0]?.({ type: "done", text: "stale" });
      if (reject) oldFinish.reject(new Error("old failure"));
      else oldFinish.resolve();
      oldCancel.resolve();
      await Promise.all([finishing, discarding]);
      expect(rows.get("thread")).toMatchObject({
        phase: "recording",
        error: null,
        retryAvailable: false,
      });
      expect(draft).toBe("original");
      await controller.finish("thread", true);
      expect(newSession.finish).toHaveBeenCalledOnce();
      expect(draft).toBe("original");
      expect(send).toHaveBeenCalledExactlyOnceWith("original new transcript");
    },
  );

  it.each([false, true])(
    "does not restore a discarded retry or send its transcript (reject=%s)",
    async (reject) => {
      const { database, rows } = resources();
      const controller = new VoiceInputController(database);
      const retried = Promise.withResolvers<void>();
      const listeners: Array<(event: VoiceTranscriptionEvent) => void> = [];
      let draft = "original";
      const send = vi.fn();
      const session: VoiceTranscriptionSession = {
        appendAudio: vi.fn(),
        cancel: vi.fn(async () => undefined),
        finish: vi
          .fn(() => retried.promise)
          .mockRejectedValueOnce(new RetryableVoiceTranscriptionError("Try again", 1)),
      };
      controller.bind({
        scope: "thread",
        source: () => draft,
        selection: () => ({ start: draft.length, end: draft.length }),
        thread: null,
        updateDraft: (text) => {
          draft = text;
        },
        send,
        startRemote: async (listener) => {
          listeners.push(listener);
          return session;
        },
      });
      await controller.toggle("thread");
      emitAudio();
      await controller.finish("thread", true);
      const retrying = controller.retry("thread");
      await vi.waitFor(() => expect(session.finish).toHaveBeenCalledTimes(2));
      await controller.discard("thread");
      listeners[0]?.({ type: "done", text: "stale retry" });
      if (reject) retried.reject(new Error("late failure"));
      else retried.resolve();
      await retrying;
      expect(draft).toBe("original");
      expect(send).not.toHaveBeenCalled();
      expect(rows.get("thread")).toMatchObject({
        phase: "idle",
        error: null,
        retryAvailable: false,
      });
    },
  );

  it("keeps frame-rate microphone levels out of the reactive database", async () => {
    const { database } = resources();
    const putVoiceInput = vi.spyOn(database, "putVoiceInput");
    const controller = new VoiceInputController(database);
    controller.bind({
      scope: "thread",
      source: () => "",
      selection: () => ({ start: 0, end: 0 }),
      thread: null,
      updateDraft: () => undefined,
      send: () => undefined,
      startRemote: async (listener) => remoteSession(listener, ["done"]),
    });

    await controller.toggle("thread");
    putVoiceInput.mockClear();
    const levelChanged = vi.fn();
    const unsubscribe = controller.subscribeLevel("thread", levelChanged);
    for (let index = 0; index < 100; index += 1) emitAudio();

    expect(putVoiceInput).not.toHaveBeenCalled();
    expect(controller.level("thread")).toBe(0.4);
    expect(levelChanged).toHaveBeenCalledOnce();

    unsubscribe();
    await controller.finish("thread", false);
    expect(controller.level("thread")).toBe(0);
  });

  it("sends the final transcript without publishing it through the editor first", async () => {
    const { database } = resources();
    const controller = new VoiceInputController(database);
    let draft = "Existing ";
    const sent: string[] = [];
    controller.bind({
      scope: "thread",
      source: () => draft,
      selection: () => ({ start: draft.length, end: draft.length }),
      thread: null,
      updateDraft: (next) => {
        draft = next;
      },
      send: (text) => sent.push(text),
      startRemote: async (listener) => remoteSession(listener, ["second transcript"]),
    });

    await controller.toggle("thread");
    emitAudio();
    await controller.finish("thread", true);

    expect(draft).toBe("Existing ");
    expect(sent).toEqual(["Existing second transcript"]);
  });

  it("waits for native Opus tail packets before finishing the remote session", async () => {
    const { database } = resources();
    const controller = new VoiceInputController(database);
    let session: VoiceTranscriptionSession | null = null;
    capture.stop.mockImplementationOnce(async () => {
      capture.onChunk?.({
        encoding: "opus",
        data: "framed-opus-tail",
        sampleRate: 48_000,
        numChannels: 1,
        samplesPerChannel: 960,
        level: 0.1,
      });
    });
    controller.bind({
      scope: "thread",
      source: () => "",
      selection: () => ({ start: 0, end: 0 }),
      thread: null,
      updateDraft: () => undefined,
      send: () => undefined,
      startRemote: async (listener) => {
        session = remoteSession(listener, ["tail preserved"]);
        return session;
      },
    });

    await controller.toggle("thread");
    await controller.finish("thread", false);

    expect(session?.appendAudio).toHaveBeenCalledWith(
      expect.objectContaining({
        encoding: "opus",
        data: "framed-opus-tail",
      }),
    );
    expect(session?.finish).toHaveBeenCalledOnce();
  });

  it("finishes transcription before using a custom delivery action", async () => {
    const { database } = resources();
    const controller = new VoiceInputController(database);
    let draft = "";
    const defaultSent: string[] = [];
    const steered: string[] = [];
    controller.bind({
      scope: "thread",
      source: () => draft,
      selection: () => ({ start: draft.length, end: draft.length }),
      thread: null,
      updateDraft: (next) => {
        draft = next;
      },
      send: (text) => defaultSent.push(text),
      startRemote: async (listener) => remoteSession(listener, ["voice command"]),
    });

    await controller.toggle("thread");
    emitAudio();
    await controller.finish("thread", true, (text) => steered.push(text));

    expect(draft).toBe("");
    expect(defaultSent).toEqual([]);
    expect(steered).toEqual(["voice command"]);
  });

  it("keeps retryable audio and retries locally without recording again", async () => {
    const { database, rows } = resources();
    const controller = new VoiceInputController(database);
    let draft = "";
    const sent: string[] = [];
    controller.bind({
      scope: "thread",
      source: () => draft,
      selection: () => ({ start: draft.length, end: draft.length }),
      thread: null,
      updateDraft: (next) => {
        draft = next;
      },
      send: (text) => sent.push(text),
      startRemote: async (listener) => remoteSession(listener, ["recovered transcript"], 1),
    });

    await controller.toggle("thread");
    emitAudio();
    await controller.finish("thread", true);
    expect(rows.get("thread")).toMatchObject({
      phase: "idle",
      retryAvailable: true,
      error: "Rate limited",
    });

    await controller.retry("thread");
    expect(draft).toBe("");
    expect(sent).toEqual(["recovered transcript"]);
    expect(rows.get("thread")).toMatchObject({ phase: "idle", retryAvailable: false, error: null });
  });

  it("preserves a custom delivery action across a transcription retry", async () => {
    const { database, rows } = resources();
    const controller = new VoiceInputController(database);
    let draft = "";
    const defaultSent: string[] = [];
    const queued: string[] = [];
    controller.bind({
      scope: "thread",
      source: () => draft,
      selection: () => ({ start: draft.length, end: draft.length }),
      thread: null,
      updateDraft: (next) => {
        draft = next;
      },
      send: (text) => defaultSent.push(text),
      startRemote: async (listener) => remoteSession(listener, ["recovered queue transcript"], 1),
    });

    await controller.toggle("thread");
    emitAudio();
    await controller.finish("thread", true, (text) => queued.push(text));
    expect(rows.get("thread")).toMatchObject({ phase: "idle", retryAvailable: true });

    await controller.retry("thread");
    expect(defaultSent).toEqual([]);
    expect(draft).toBe("");
    expect(queued).toEqual(["recovered queue transcript"]);
  });

  it("retries session startup three times and keeps captured audio for a manual retry", async () => {
    vi.useFakeTimers();
    try {
      const { database, rows } = resources();
      const controller = new VoiceInputController(database);
      let draft = "";
      let starts = 0;
      const session = remoteSession(
        (event) => {
          if (event.type === "done") draft = event.text;
        },
        ["recovered startup transcript"],
      );
      controller.bind({
        scope: "thread",
        source: () => draft,
        selection: () => ({ start: draft.length, end: draft.length }),
        thread: null,
        updateDraft: (next) => {
          draft = next;
        },
        send: () => undefined,
        startRemote: async (listener) => {
          starts += 1;
          if (starts <= 4) throw new Error("Connection unavailable");
          return remoteSession(listener, ["recovered startup transcript"]);
        },
      });

      const starting = controller.toggle("thread");
      await Promise.resolve();
      emitAudio();
      await vi.advanceTimersByTimeAsync(1_750);
      await starting;

      expect(starts).toBe(4);
      expect(rows.get("thread")).toMatchObject({
        phase: "idle",
        retryAvailable: true,
        error: "OpenAI transcription: Connection unavailable",
      });

      await controller.retry("thread");
      expect(starts).toBe(5);
      expect(draft).toContain("recovered startup transcript");
      expect(rows.get("thread")).toMatchObject({
        phase: "idle",
        retryAvailable: false,
        error: null,
      });
      expect(session.finish).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the retry button for an unclassified finish failure", async () => {
    const { database, rows } = resources();
    const controller = new VoiceInputController(database);
    let draft = "";
    let attempts = 0;
    const session: VoiceTranscriptionSession = {
      appendAudio: vi.fn(),
      cancel: vi.fn(async () => undefined),
      finish: vi.fn(async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("Socket timed out");
        draft = "recovered";
      }),
    };
    controller.bind({
      scope: "thread",
      source: () => draft,
      selection: () => ({ start: draft.length, end: draft.length }),
      thread: null,
      updateDraft: (next) => {
        draft = next;
      },
      send: () => undefined,
      startRemote: async () => session,
    });

    await controller.toggle("thread");
    emitAudio();
    await controller.finish("thread", false);
    expect(rows.get("thread")).toMatchObject({
      phase: "idle",
      retryAvailable: true,
      error: "Socket timed out",
    });

    await controller.retry("thread");
    expect(session.finish).toHaveBeenCalledTimes(2);
    expect(rows.get("thread")).toMatchObject({ phase: "idle", retryAvailable: false, error: null });
  });

  it("discards retryable audio and restores the draft from before recording", async () => {
    const { database, rows } = resources();
    const controller = new VoiceInputController(database);
    let draft = "keep this";
    let listener: ((event: VoiceTranscriptionEvent) => void) | null = null;
    const session: VoiceTranscriptionSession = {
      appendAudio: vi.fn(),
      cancel: vi.fn(async () => undefined),
      finish: vi.fn(async () => {
        throw new RetryableVoiceTranscriptionError("Try again", 1_000);
      }),
    };
    controller.bind({
      scope: "thread",
      source: () => draft,
      selection: () => ({ start: draft.length, end: draft.length }),
      thread: null,
      updateDraft: (next) => {
        draft = next;
      },
      send: () => undefined,
      startRemote: async (nextListener) => {
        listener = nextListener;
        return session;
      },
    });

    await controller.toggle("thread");
    emitAudio();
    listener?.({ type: "delta", text: " temporary transcript" });
    expect(draft).toContain("temporary transcript");
    await controller.finish("thread", false);
    expect(rows.get("thread")).toMatchObject({
      phase: "idle",
      retryAvailable: true,
      error: "Try again",
    });

    await controller.discard("thread");

    expect(session.cancel).toHaveBeenCalledOnce();
    expect(draft).toBe("keep this");
    expect(rows.get("thread")).toMatchObject({ phase: "idle", retryAvailable: false, error: null });
  });

  it("cancels an active recording without accepting its partial transcript", async () => {
    const { database, rows } = resources();
    const controller = new VoiceInputController(database);
    let draft = "original";
    let listener: ((event: VoiceTranscriptionEvent) => void) | null = null;
    const session = remoteSession((event) => listener?.(event), []);
    controller.bind({
      scope: "thread",
      source: () => draft,
      selection: () => ({ start: draft.length, end: draft.length }),
      thread: null,
      updateDraft: (next) => {
        draft = next;
      },
      send: () => undefined,
      startRemote: async (nextListener) => {
        listener = nextListener;
        return session;
      },
    });

    await controller.toggle("thread");
    listener?.({ type: "delta", text: " partial" });
    await controller.discard("thread");

    expect(session.cancel).toHaveBeenCalledOnce();
    expect(draft).toBe("original");
    expect(rows.get("thread")).toMatchObject({ phase: "idle", retryAvailable: false, error: null });
  });

  it("does not offer retry when the session has already discarded its audio", async () => {
    const { database, rows } = resources();
    const controller = new VoiceInputController(database);
    const session: VoiceTranscriptionSession = {
      appendAudio: vi.fn(),
      cancel: vi.fn(async () => undefined),
      finish: vi.fn(async () => {
        throw new UnretryableVoiceTranscriptionError("Invalid microphone audio");
      }),
    };
    controller.bind({
      scope: "thread",
      source: () => "",
      selection: () => ({ start: 0, end: 0 }),
      thread: null,
      updateDraft: () => undefined,
      send: () => undefined,
      startRemote: async () => session,
    });

    await controller.toggle("thread");
    emitAudio();
    await controller.finish("thread", false);

    expect(rows.get("thread")).toMatchObject({
      phase: "idle",
      retryAvailable: false,
      error: "Invalid microphone audio",
    });
    expect(session.cancel).toHaveBeenCalledOnce();
  });

  it("appends a second recording and sends both the old and new transcript", async () => {
    const { database } = resources();
    const controller = new VoiceInputController(database);
    let draft = "";
    const sent: string[] = [];
    const transcripts = ["first transcript", "second transcript"];
    const bind = () =>
      controller.bind({
        scope: "thread",
        source: () => draft,
        selection: () => ({ start: draft.length, end: draft.length }),
        thread: null,
        updateDraft: (next) => {
          draft = next;
        },
        send: (text) => sent.push(text),
        startRemote: async (listener) => remoteSession(listener, transcripts),
      });

    bind();
    await controller.toggle("thread");
    emitAudio();
    await controller.finish("thread", false);
    bind();
    await controller.toggle("thread");
    emitAudio();
    await controller.finish("thread", true);

    expect(draft).toBe("first transcript");
    expect(sent).toEqual(["first transcript second transcript"]);
  });

  it("cancels an empty remote recording locally instead of asking the companion to finish zero audio", async () => {
    const { database, rows } = resources();
    const controller = new VoiceInputController(database);
    let draft = "keep me";
    const sent: string[] = [];
    const session = remoteSession(() => undefined, []);
    controller.bind({
      scope: "thread",
      source: () => draft,
      selection: () => ({ start: draft.length, end: draft.length }),
      thread: null,
      updateDraft: (next) => {
        draft = next;
      },
      send: (text) => sent.push(text),
      startRemote: async () => session,
    });

    await controller.toggle("thread");
    await controller.finish("thread", true);

    expect(session.finish).not.toHaveBeenCalled();
    expect(session.cancel).toHaveBeenCalledOnce();
    expect(sent).toEqual([]);
    expect(draft).toBe("keep me");
    expect(rows.get("thread")).toMatchObject({
      phase: "idle",
      retryAvailable: false,
      error: "Recording was too short · hold the microphone and try again",
    });
  });
});
