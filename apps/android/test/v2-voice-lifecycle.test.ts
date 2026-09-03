import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type {
  V2OperationStore,
  V2ProjectionStore,
  V2SavedServerDeletionStore,
} from "@codewide/sync-client/v2";

import type { CommandCorrelationStore } from "../src/v2/application/commandCorrelation";
import type { ComposerAttachmentTransport } from "../src/v2/application/ports/composerAttachmentTransport";
import type { ComposerDraftStore } from "../src/v2/application/ports/composerDraftStore";
import type { PortTransport } from "../src/v2/application/ports/portTransport";
import type { SavedServerRepository } from "../src/v2/application/ports/savedServerRepository";
import type { TerminalTransport } from "../src/v2/application/ports/terminalTransport";
import type { VoiceTransport } from "../src/v2/application/ports/voiceTransport";
import type { PreviewTransport } from "../src/v2/application/preview/previewTransport";
import { V2Runtime, type RuntimeSessionProvider } from "../src/v2/application/v2Runtime";
import {
  VoiceInputController,
  voiceInputScopeKey,
} from "../src/v2/application/voiceInputController";
import { savedServerId } from "../src/v2/domain/ids";

describe("V2 Voice lifecycle", () => {
  it("acquires microphone foreground ownership before opening the remote Voice session", () => {
    const manifest = readFileSync(
      new URL("../android/app/src/main/AndroidManifest.xml", import.meta.url),
      "utf8",
    );
    const captureModule = readFileSync(
      new URL(
        "../android/app/src/main/java/dev/codewide/app/remote/V2VoiceCaptureModule.kt",
        import.meta.url,
      ),
      "utf8",
    );
    const foregroundService = readFileSync(
      new URL(
        "../android/app/src/main/java/dev/codewide/app/remote/V2VoiceCaptureForegroundService.kt",
        import.meta.url,
      ),
      "utf8",
    );
    const nativeTransport = readFileSync(
      new URL("../src/v2/infrastructure/voice/nativeVoiceTransport.native.ts", import.meta.url),
      "utf8",
    );

    expect(manifest).toContain(
      '<uses-permission android:name="android.permission.FOREGROUND_SERVICE_MICROPHONE"/>',
    );
    expect(manifest).toContain(
      'android:name="dev.codewide.app.remote.V2VoiceCaptureForegroundService"',
    );
    expect(manifest).toContain('android:foregroundServiceType="microphone"');
    expect(foregroundService).toContain("ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE");
    expect(captureModule.indexOf("V2VoiceCaptureForegroundService.acquire")).toBeLessThan(
      captureModule.indexOf("val created = AudioRecord("),
    );
    expect(nativeTransport.indexOf("abortableStart(capture.prepare(id)")).toBeLessThan(
      nativeTransport.indexOf("acquireSharedConnectionLease(input.audience)"),
    );
    expect(nativeTransport).toContain(
      "PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO)",
    );
    expect(nativeTransport).toContain('throw new Error("Microphone permission was denied")');
    expect(nativeTransport.indexOf("PermissionsAndroid.request")).toBeLessThan(
      nativeTransport.indexOf("abortableStart(capture.prepare(id)"),
    );
    expect(captureModule).toContain("V2VoiceCaptureForegroundService.release(pending.token)");
    expect(captureModule).toContain('putDouble("level", level)');
    expect(captureModule).toContain("VoiceAuraRenderEffect(context)");
    expect(nativeTransport).toContain('report({ level, type: "level" })');
    expect(nativeTransport).toContain('input.signal.addEventListener("abort", abortStart');
    expect(nativeTransport).toContain('channel.close(1000, "voice_finished")');
    expect(nativeTransport).toContain("void lateConnection.lease.release().catch");
  });

  it("cancels active Voice before closing the runtime shared sessions", async () => {
    const order: string[] = [];
    const cancel = vi.fn(async () => {
      order.push("voice");
    });
    const closeAll = vi.fn(async () => {
      order.push("sessions");
    });
    const closeRepository = vi.fn(() => {
      order.push("repository");
    });
    const voiceTransport: VoiceTransport = {
      start: async () => ({ cancel, finish: async () => undefined }),
    };
    const runtime = new V2Runtime({
      attachmentTransport: {} as ComposerAttachmentTransport,
      composerDrafts: {} as ComposerDraftStore,
      correlations: {} as CommandCorrelationStore,
      correlationId: () => "correlation-a",
      deletions: {} as V2SavedServerDeletionStore,
      now: () => 0,
      operationId: () => "operation-a",
      operations: {} as V2OperationStore,
      portTransport: {} as PortTransport,
      previewTransport: {} as PreviewTransport,
      projections: {} as V2ProjectionStore,
      repository: { close: closeRepository } as SavedServerRepository,
      savedServerId: () => savedServerId("generated-server"),
      sessions: { closeAll } as RuntimeSessionProvider,
      terminalTransport: {} as TerminalTransport,
      terminalLifecycle: {
        scheduleReconnect: () => () => undefined,
      },
      threadPins: {
        deleteSavedServer: async () => undefined,
        list: async () => [],
        setPinned: async () => undefined,
      },
      voiceTransport,
    });
    await runtime.voice.start(voiceStartInput());

    await runtime.stop();

    expect(cancel).toHaveBeenCalledTimes(1);
    expect(closeAll).toHaveBeenCalledTimes(1);
    expect(order).toEqual(["voice", "sessions", "repository"]);
  });

  it("preserves the exact microphone permission failure for frozen V1 presentation", async () => {
    const controller = new VoiceInputController({
      start: async () => {
        throw new Error("Microphone permission was denied");
      },
    });
    const binding = {
      audience: savedServerId("server-a"),
      onTranscript: () => undefined,
      scope: { id: "thread-a", kind: "composer" as const },
      sourceGeneration: "1",
      thread: null,
    };

    await expect(controller.begin(binding)).rejects.toThrow("Microphone permission was denied");
    expect(controller.snapshot(voiceInputScopeKey(binding.audience, binding.scope))).toEqual({
      message: "OpenAI transcription: Microphone permission was denied",
      state: "error",
    });
  });

  it("aborts a Voice transport that never finishes opening during shutdown", async () => {
    const transport: VoiceTransport = {
      start: (input) =>
        new Promise((_resolve, reject) => {
          input.signal.addEventListener("abort", () => reject(new Error("cancelled")), {
            once: true,
          });
        }),
    };
    const controller = new VoiceInputController(transport);
    const starting = controller.start(voiceStartInput());

    await controller.cancelAll();
    await expect(starting).rejects.toThrow("cancelled");
  });

  it("settles the UI when the user cancels a never-resolving server start", async () => {
    const transport: VoiceTransport = {
      start: (input) =>
        new Promise((_resolve, reject) => {
          input.signal.addEventListener("abort", () => reject(new Error("cancelled")), {
            once: true,
          });
        }),
    };
    const controller = new VoiceInputController(transport);
    const binding = {
      audience: savedServerId("server-a"),
      onTranscript: () => undefined,
      scope: { id: "thread-a", kind: "composer" as const },
      sourceGeneration: "1",
      thread: null,
    };
    const starting = controller.begin(binding);

    await controller.cancel();

    await expect(starting).resolves.toBeUndefined();
    expect(controller.snapshot(voiceInputScopeKey(binding.audience, binding.scope)).state).toBe(
      "idle",
    );
  });

  it("rejects a pending transcript submission when the whole runtime tears down", async () => {
    let startInput: Parameters<VoiceTransport["start"]>[0] | null = null;
    const cancel = vi.fn(async () => undefined);
    const controller = new VoiceInputController({
      start: async (input) => {
        startInput = input;
        input.onEvent({ type: "recording" });
        return {
          cancel,
          finish: async () => {
            startInput?.onEvent({ text: "pending transcript", type: "result" });
          },
        };
      },
    });
    await controller.begin({
      audience: savedServerId("server-a"),
      onSubmitTranscript: async () => {
        await new Promise<void>(() => undefined);
        return true;
      },
      onTranscript: () => undefined,
      scope: { id: "thread-a", kind: "composer" },
      sourceGeneration: "1",
      thread: null,
    });

    const finishing = controller.finish(true);
    const rejected = expect(finishing).rejects.toThrow("Voice input stopped");
    await controller.cancelAll();

    await rejected;
  });
});

function voiceStartInput() {
  return {
    audience: savedServerId("server-a"),
    onEvent: () => undefined,
    scope: { id: "thread-a", kind: "composer" as const },
    signal: new AbortController().signal,
    sourceGeneration: "1",
    thread: null,
  };
}
