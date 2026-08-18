import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PcmAudioChunk } from "../src/native/native-transport";

const capture = vi.hoisted(() => ({
  onChunk: null as ((chunk: PcmAudioChunk) => void) | null,
}));

vi.mock("../src/native/native-transport", () => ({
  cancelVoiceRecognition: vi.fn(),
  startVoiceRecognition: vi.fn(),
  startPcmCapture: vi.fn(async (onChunk: (chunk: PcmAudioChunk) => void) => {
    capture.onChunk = onChunk;
    return {
      stop: vi.fn(),
      info: {
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
import type { VoiceInputRow, WorkspaceResourceDatabase } from "../src/data/workspace-resource-database";

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
  capture.onChunk?.({ data: "pcm", sampleRate: 24_000, numChannels: 1, samplesPerChannel: 6_000, level: 0.4 });
}

describe("VoiceInputController", () => {
  beforeEach(() => {
    capture.onChunk = null;
  });

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

    await controller.toggle();
    putVoiceInput.mockClear();
    const levelChanged = vi.fn();
    const unsubscribe = controller.subscribeLevel("thread", levelChanged);
    for (let index = 0; index < 100; index += 1) emitAudio();

    expect(putVoiceInput).not.toHaveBeenCalled();
    expect(controller.level("thread")).toBe(0.4);
    expect(levelChanged).toHaveBeenCalledOnce();

    unsubscribe();
    await controller.finish(false);
    expect(controller.level("thread")).toBe(0);
  });

  it("sends the final transcript rather than the draft captured when recording started", async () => {
    const { database } = resources();
    const controller = new VoiceInputController(database);
    let draft = "Existing ";
    const sent: string[] = [];
    controller.bind({
      scope: "thread",
      source: () => draft,
      selection: () => ({ start: draft.length, end: draft.length }),
      thread: null,
      updateDraft: (next) => { draft = next; },
      send: (text) => sent.push(text),
      startRemote: async (listener) => remoteSession(listener, ["second transcript"]),
    });

    await controller.toggle();
    emitAudio();
    await controller.finish(true);

    expect(draft).toContain("second transcript");
    expect(sent).toEqual([draft]);
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
      updateDraft: (next) => { draft = next; },
      send: (text) => sent.push(text),
      startRemote: async (listener) => remoteSession(listener, ["recovered transcript"], 1),
    });

    await controller.toggle();
    emitAudio();
    await controller.finish(true);
    expect(rows.get("thread")).toMatchObject({ phase: "idle", retryAvailable: true, error: "Rate limited" });

    await controller.retry();
    expect(draft).toContain("recovered transcript");
    expect(sent).toEqual([draft]);
    expect(rows.get("thread")).toMatchObject({ phase: "idle", retryAvailable: false, error: null });
  });

  it("retries session startup three times and keeps captured audio for a manual retry", async () => {
    vi.useFakeTimers();
    try {
      const { database, rows } = resources();
      const controller = new VoiceInputController(database);
      let draft = "";
      let starts = 0;
      const session = remoteSession((event) => {
        if (event.type === "done") draft = event.text;
      }, ["recovered startup transcript"]);
      controller.bind({
        scope: "thread",
        source: () => draft,
        selection: () => ({ start: draft.length, end: draft.length }),
        thread: null,
        updateDraft: (next) => { draft = next; },
        send: () => undefined,
        startRemote: async (listener) => {
          starts += 1;
          if (starts <= 4) throw new Error("Connection unavailable");
          return remoteSession(listener, ["recovered startup transcript"]);
        },
      });

      const starting = controller.toggle();
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

      await controller.retry();
      expect(starts).toBe(5);
      expect(draft).toContain("recovered startup transcript");
      expect(rows.get("thread")).toMatchObject({ phase: "idle", retryAvailable: false, error: null });
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
      updateDraft: (next) => { draft = next; },
      send: () => undefined,
      startRemote: async () => session,
    });

    await controller.toggle();
    emitAudio();
    await controller.finish(false);
    expect(rows.get("thread")).toMatchObject({ phase: "idle", retryAvailable: true, error: "Socket timed out" });

    await controller.retry();
    expect(session.finish).toHaveBeenCalledTimes(2);
    expect(rows.get("thread")).toMatchObject({ phase: "idle", retryAvailable: false, error: null });
  });

  it("does not offer retry when the session has already discarded its audio", async () => {
    const { database, rows } = resources();
    const controller = new VoiceInputController(database);
    const session: VoiceTranscriptionSession = {
      appendAudio: vi.fn(),
      cancel: vi.fn(async () => undefined),
      finish: vi.fn(async () => { throw new UnretryableVoiceTranscriptionError("Invalid microphone audio"); }),
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

    await controller.toggle();
    emitAudio();
    await controller.finish(false);

    expect(rows.get("thread")).toMatchObject({ phase: "idle", retryAvailable: false, error: "Invalid microphone audio" });
    expect(session.cancel).toHaveBeenCalledOnce();
  });

  it("appends a second recording and sends both the old and new transcript", async () => {
    const { database } = resources();
    const controller = new VoiceInputController(database);
    let draft = "";
    const sent: string[] = [];
    const transcripts = ["first transcript", "second transcript"];
    const bind = () => controller.bind({
      scope: "thread",
      source: () => draft,
      selection: () => ({ start: draft.length, end: draft.length }),
      thread: null,
      updateDraft: (next) => { draft = next; },
      send: (text) => sent.push(text),
      startRemote: async (listener) => remoteSession(listener, transcripts),
    });

    bind();
    await controller.toggle();
    emitAudio();
    await controller.finish(false);
    bind();
    await controller.toggle();
    emitAudio();
    await controller.finish(true);

    expect(draft).toContain("first transcript");
    expect(draft).toContain("second transcript");
    expect(sent).toEqual([draft]);
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
      updateDraft: (next) => { draft = next; },
      send: (text) => sent.push(text),
      startRemote: async () => session,
    });

    await controller.toggle();
    await controller.finish(true);

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
